/**
 * Low-level media downloader for the X Article mirror pipeline.
 *
 * Part 1 of the media-handling pipeline (see docs/reference-convention.md §4):
 * downloads images to a local media folder, one file per image, and never
 * throws for a single image failure — failures are collected and returned so
 * the caller can surface them (and keep the original remote URL in the
 * content as a fallback).
 *
 * Design notes:
 * - X image URLs (pbs.twimg.com / video.twimg.com) are served at different
 *   sizes via query params; `normalizeImageUrl()` maps a bare CDN URL to the
 *   conventional `?format=<ext>&name=large` variant. Callers that already
 *   carry the full variant (e.g. from the X API media object) pass the URL
 *   through unchanged — we never downgrade an explicit variant.
 * - `downloadImages()` fetches exactly the URLs it is given; normalization is
 *   a separate, opt-in step (the reference-media layer applies it).
 * - A `file://` URL is read straight off disk (used by the fixture test and
 *   for local debugging); `http(s)` is fetched.
 *
 * Runs on Bun (site runtime) but only uses Node-compatible APIs so it also
 * type-checks and runs under Node.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One image to download. `dest` is a filesystem path (absolute or cwd-relative). */
export interface DownloadSpec {
  url: string;
  dest: string;
}

/** A successfully downloaded image. */
export interface DownloadedFile {
  url: string;
  dest: string;
  size: number; // bytes written
}

/** A failed download — `reason` is a human-readable summary (HTTP status, network error, …). */
export interface FailedDownload {
  url: string;
  dest?: string;
  reason: string;
}

export interface DownloadResult {
  ok: DownloadedFile[];
  failed: FailedDownload[];
}

/** Per-image fetch timeout. Blocked/black-holed URLs hang forever without one. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Reasonable UA — some CDNs refuse empty user agents. */
const USER_AGENT =
  'Mozilla/5.0 (X Article Mirror; research-notes bot) AppleWebKit/537.36';

const TWIMG_HOST_RE = /(^|\.)(pbs|video|abs)\.twimg\.com$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif)$/i;

/**
 * Map an X CDN image URL to the conventional size variant.
 *
 * `https://pbs.twimg.com/media/<id>` (no query) becomes
 * `https://pbs.twimg.com/media/<id>?format=<ext>&name=large`.
 *
 * - URLs that already carry a query string (`?format=…&name=…`) are returned
 *   unchanged — the caller picked the variant (e.g. `name=orig` from the
 *   X API) and we respect it.
 * - The format follows the path extension when present (`.gif` stays a gif),
 *   otherwise defaults to `jpg` (the X API's usual delivery format).
 * - Non-X URLs pass through untouched.
 */
export function normalizeImageUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.search) return url; // explicit variant already chosen — keep it
  if (!TWIMG_HOST_RE.test(u.hostname)) return url;
  const ext = u.pathname.match(IMAGE_EXT_RE)?.[1]?.toLowerCase() ?? 'jpg';
  const format = ext === 'jpeg' ? 'jpg' : ext;
  return `${url}?format=${format}&name=large`;
}

/** Small helper: is this a URL we can actually download? */
export function isDownloadableUrl(url: string): boolean {
  return /^(https?|file):\/\//i.test(url);
}

const VIDEO_HOST_RE = /(^|\.)video\.twimg\.com$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m3u8|avi|mkv)(\?|#|$)/i;

/**
 * Is this a video URL? Video is never downloaded (see convention §5) — the
 * original URL stays inline in the content. Matches the X video host and
 * common video file extensions.
 */
export function isVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (VIDEO_HOST_RE.test(u.hostname)) return true;
  } catch {
    /* fall through to extension check */
  }
  return VIDEO_EXT_RE.test(url);
}

/**
 * Download a single image. Throws on failure (caller decides how to surface
 * it); `downloadImages` is the never-throw wrapper.
 */
export async function downloadImage(
  spec: DownloadSpec,
  opts: { timeoutMs?: number } = {},
): Promise<DownloadedFile> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dest = path.resolve(spec.dest);
  await mkdir(path.dirname(dest), { recursive: true });

  let bytes: Uint8Array;
  if (spec.url.startsWith('file://')) {
    // Local file — used by tests/fixtures and local debugging.
    bytes = new Uint8Array(await readFile(fileURLToPath(spec.url)));
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(spec.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.8' },
      });
    } catch (err) {
      const cause =
        err instanceof Error && err.name === 'AbortError'
          ? `timeout after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(`network error: ${cause}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
    // A blocked/proxied X returns an HTML login/error page with 200 — catch it.
    const ctype = res.headers.get('content-type') ?? '';
    if (ctype.startsWith('text/html')) {
      throw new Error(`blocked or error page (Content-Type: ${ctype})`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  }

  await writeFile(dest, bytes);
  return { url: spec.url, dest, size: bytes.byteLength };
}

/**
 * Download a list of images, collecting failures instead of throwing.
 *
 * - Creates destination directories as needed.
 * - One failed image never aborts the rest.
 * - Runs downloads concurrently; each URL is attempted once (a transient
 *   failure is reported as-is — the mirror keeps the remote URL so a re-run
 *   is always safe).
 */
export async function downloadImages(
  images: DownloadSpec[],
  opts: { timeoutMs?: number } = {},
): Promise<DownloadResult> {
  const results = await Promise.all(
    images.map(async (spec) => {
      try {
        const file = await downloadImage(spec, opts);
        return { ok: [file], failed: [] } satisfies DownloadResult;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          ok: [],
          failed: [{ url: spec.url, dest: path.resolve(spec.dest), reason }],
        } satisfies DownloadResult;
      }
    }),
  );

  return results.reduce<DownloadResult>(
    (acc, r) => {
      acc.ok.push(...r.ok);
      acc.failed.push(...r.failed);
      return acc;
    },
    { ok: [], failed: [] },
  );
}
