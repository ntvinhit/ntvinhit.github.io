/**
 * Reference media pipeline — the part that ties image downloads into the
 * mirror workflow for a single reference entry (see
 * docs/reference-convention.md §4).
 *
 * Responsibilities:
 * - Discover the image URLs embedded in a reference markdown body.
 * - Rewrite the body so downloaded images point at local files under
 *   `public/references/<slug>/` while the ORIGINAL remote URL stays
 *   recoverable (kept in an HTML comment on the same line).
 * - Update `has_attachments`, `images_original` and `cover_image` in
 *   frontmatter to match.
 *
 * Rewrite scheme (documented in the convention):
 * - Successful download → `![alt](/references/<slug>/<file>) <!-- image original: <url> -->`
 * - Failed download     → `![alt](<url>) <!-- image original: <url> -->`
 *   (remote URL kept in the src so the image still renders when reachable;
 *   the comment records provenance either way).
 * - Non-downloaded images (e.g. already-local `./x.png`) are left untouched.
 * - Video URLs (mp4 / video.twimg.com) are never downloaded — left as-is.
 *
 * Inline-image insertion (anchored on the preceding article text) lives in
 * the shared `./inline-images` module so both CLIs use the same logic.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  downloadImages,
  isDownloadableUrl,
  isVideoUrl,
  normalizeImageUrl,
  type DownloadSpec,
  type DownloadResult,
} from './fetch-media';
import {
  extractFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from './frontmatter';
import { resolveArticleMediaFromStatusPage } from './resolve-article-media';
import { insertInlineImages } from './inline-images';

/** A resolved image reference inside the body. */
export interface BodyImageRef {
  /** URL as it appears in the markdown. */
  url: string;
  /** Alt text, may be empty. */
  alt: string;
}

/** Markdown image reference: `![alt](url)` with an optional title. */
const IMAGE_REF_RE =
  /!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+|file:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;

/** Extract the remote image refs from a body string (deduplicated, order kept). */
export function findBodyImages(body: string): BodyImageRef[] {
  const seen = new Set<string>();
  const refs: BodyImageRef[] = [];
  for (const m of body.matchAll(IMAGE_REF_RE)) {
    const url = m[2];
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ url, alt: m[1] ?? '' });
  }
  return refs;
}

/** Pick a local file name for a remote image URL (basename of the path). */
export function imageFileName(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const base = path.basename(pathname).replace(/\?.*$/, '');
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned;
  // No usable path segment — hash the URL for a stable name.
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return `image-${(h >>> 0).toString(16)}.jpg`;
}

/** Name of the HTML comment that records the original URL. */
export const ORIGINAL_COMMENT = 'image original';

/** Render an image markdown line with its provenance comment appended. */
export function withOriginalComment(rendered: string, url: string): string {
  return `${rendered} <!-- ${ORIGINAL_COMMENT}: ${url} -->`;
}

/**
 * Rewrite one image occurrence. `useLocal` embeds `publicUrl`; otherwise the
 * original `url` is kept. Either way the original URL stays recoverable via
 * the trailing HTML comment.
 */
export function rewriteImageRef(
  ref: BodyImageRef,
  opts: {
    /** Absolute URL under which the downloaded file is served. */
    publicUrl: string | null;
    /** Original remote URL (kept in the comment / used as fallback src). */
    url: string;
    /** When true, embed the local file (download succeeded). */
    useLocal: boolean;
  },
): string {
  const src = opts.useLocal && opts.publicUrl ? opts.publicUrl : opts.url;
  return withOriginalComment(`![${ref.alt}](${src})`, opts.url);
}

/**
 * Rewrite the whole body:
 * - successfully downloaded images → local absolute path `/references/<slug>/<file>`;
 * - attempted but failed downloads → original remote src kept;
 * - both get the `<!-- image original: <url> -->` comment so the original
 *   URL is always recoverable. Local (`./x.png`) and video refs are untouched.
 */
export function rewriteBodyImages(
  body: string,
  opts: {
    slug: string;
    /** Original URL → local file name actually written. */
    downloaded: Map<string, string>;
    /** Every URL we attempted to download (fallbacks get the comment too). */
    considered: Set<string>;
  },
): string {
  let out = body;
  for (const m of body.matchAll(IMAGE_REF_RE)) {
    const url = m[2];
    const rendered = m[0];
    const localName = opts.downloaded.get(url);
    if (localName) {
      const publicUrl = `/references/${opts.slug}/${localName}`;
      const replacement = withOriginalComment(
        `![${m[1] ?? ''}](${publicUrl})`,
        url,
      );
      out = out.split(rendered).join(replacement);
    } else if (opts.considered.has(url)) {
      // Failed download — keep the remote URL, still record provenance.
      const replacement = withOriginalComment(
        `![${m[1] ?? ''}](${url})`,
        url,
      );
      out = out.split(rendered).join(replacement);
    }
  }
  return out;
}

/**
 * Insert an X Article's inline images into the body at their positions.
 *
 * Implementation lives in the shared `./inline-images` module (also used by
 * `add-reference.ts`); re-exported here for the pipeline's existing callers.
 * See that module for the anchoring rules and idempotency guarantees.
 */
export { insertInlineImages } from './inline-images';

/**
 * The pipeline entry point — run AFTER the reference markdown already exists
 * (generated by the add-reference flow or by hand). Downloads all remote
 * images in the body into `public/references/<slug>/`, rewrites the body, and
 * updates frontmatter. Never throws for a single image failure.
 *
 * X Article media: the X API returns article media as opaque ids
 * (`article.media_entities: ["3_…", …]`, `article.cover_media: "3_…"`) without
 * URLs. Pass `articleMedia` (already resolved, as add-reference.ts does) or
 * `articleStatusUrl` (the pipeline resolves the cover + inline images itself
 * from the public status page) and the pipeline downloads every image and
 * inserts the inline ones into the body at the correct spots (see
 * `insertInlineImages`).
 *
 * @returns the download result (ok + failed) for reporting.
 */
export async function processReferenceMedia(opts: {
  /** Path to the reference markdown file. */
  file: string;
  /** Public slug used for the URL and media folder (e.g. `my-article`). */
  slug: string;
  /** Root of the static dir that Astro serves at `/` (repo `public/`). */
  publicDir?: string;
  /** Extra image URLs from the X API media objects (media_key → url). */
  extraImageUrls?: string[];
  /**
   * URL of the article's status page (e.g. `https://x.com/<handle>/status/<id>`).
   * When set, the article's cover + inline media are resolved from the page's
   * SSR payload and added to the download set (inline images are also inserted
   * into the body at their positions).
   */
  articleStatusUrl?: string;
  /**
   * Already-resolved article media (cover + inline images). When set, the
   * pipeline uses it directly instead of fetching the status page — lets
   * callers that already resolved the media (e.g. `add-reference.ts`) pass it
   * through, and keeps a working media step even when the status page is
   * blocked/unavailable. `cover` may be a single URL (string) or the full
   * resolver record.
   */
  articleMedia?: {
    cover?: string | { url: string; altText?: string | null };
    inline?: {
      url: string;
      altText?: string | null;
      precedingText: string;
    }[];
  };
  timeoutMs?: number;
  /**
   * Download-only mode: write the files but leave the markdown untouched.
   * Useful when the file's frontmatter cannot be safely reserialized (e.g.
   * it carries inline comments) and the caller will handle the rewrite.
   */
  noRewrite?: boolean;
}): Promise<DownloadResult> {
  const publicDir = opts.publicDir ?? path.resolve(process.cwd(), 'public');
  const file = path.resolve(opts.file);
  const raw = await readFile(file, 'utf8');

  let body: string;
  let fm: Frontmatter;
  if (opts.noRewrite) {
    body = raw;
    fm = {};
  } else {
    const { fm: fmText, body: rawBody } = splitFrontmatter(raw);
    if (fmText === null) {
      throw new Error(`no frontmatter block found in ${file}`);
    }
    // Reserialize the frontmatter (line comments are stripped — see
    // docs/reference-convention.md §9) while keeping the body byte-for-byte.
    // Safety guard: if reserializing would change the frontmatter text at
    // all, refuse to touch the file (a verbatim mirror must not be mangled).
    const newFm0 = extractFrontmatter(raw);
    const reserialized = serializeFrontmatter(newFm0);
    if (reserialized !== fmText) {
      throw new Error(
        `refusing to rewrite ${file}: its frontmatter cannot be round-tripped ` +
          `exactly (line comments or unsupported YAML are stripped). Strip the ` +
          `comments first, or run with --no-rewrite to only download files.`,
      );
    }
    body = rawBody;
    fm = newFm0;
  }
  const found = findBodyImages(body);

  // Resolve X Article media (cover + inline) — either already-resolved by the
  // caller (`articleMedia`, e.g. add-reference.ts) or from the status page via
  // `articleStatusUrl` (download-reference-media.ts --status-url). The API
  // hands us opaque ids only; the page SSR carries the real CDN URLs.
  let articleImages: {
    cover?: { url: string; altText: string | null };
    inline: { url: string; altText: string | null; precedingText: string }[];
  } | null = null;
  if (opts.articleMedia) {
    articleImages = {
      cover:
        typeof opts.articleMedia.cover === 'string'
          ? { url: opts.articleMedia.cover, altText: null }
          : opts.articleMedia.cover
            ? { url: opts.articleMedia.cover.url, altText: opts.articleMedia.cover.altText ?? null }
            : undefined,
      inline: (opts.articleMedia.inline ?? []).map((i) => ({
        url: i.url,
        altText: i.altText ?? null,
        precedingText: i.precedingText,
      })),
    };
  } else if (opts.articleStatusUrl) {
    try {
      articleImages = await resolveArticleMediaFromStatusPage(
        opts.articleStatusUrl,
      );
    } catch (err) {
      console.warn(
        `  ! could not resolve article media from ${opts.articleStatusUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Merge body images + X API media + resolved article media, deduped; keep
  // only downloadable non-video URLs (video stays inline per convention §5).
  const allUrls = [
    ...new Set([
      ...found.map((f) => f.url),
      ...(opts.extraImageUrls ?? []),
      ...(articleImages?.cover ? [articleImages.cover.url] : []),
      ...(articleImages?.inline ?? []).map((i) => i.url),
    ]),
  ].filter((u) => isDownloadableUrl(u) && !isVideoUrl(u));

  const mediaDir = path.join(publicDir, 'references', opts.slug);
  // Keep the original → normalized mapping so downloads can be looked up by
  // BOTH forms: body/resolver refs carry the bare URL, downloadImages fetches
  // the normalized one.
  const normalizedOf = new Map<string, string>();
  const specs: DownloadSpec[] = allUrls.map((url) => {
    const normalized = normalizeImageUrl(url);
    normalizedOf.set(url, normalized);
    return { url: normalized, dest: path.join(mediaDir, imageFileName(url)) };
  });

  const result = await downloadImages(specs, { timeoutMs: opts.timeoutMs });

  // Original URL → local file name actually written. Keyed by BOTH the
  // original (bare) URL and the normalized URL (what downloadImages fetched)
  // so lookups from the body (bare) and from the article resolver (bare)
  // resolve unambiguously.
  const byNormalized = new Map<string, string>();
  for (const ok of result.ok) byNormalized.set(ok.url, path.basename(ok.dest));
  const downloaded = new Map<string, string>();
  for (const url of allUrls) {
    const name = byNormalized.get(normalizedOf.get(url) ?? url);
    if (name) {
      downloaded.set(url, name);
      const normalized = normalizedOf.get(url);
      if (normalized && normalized !== url) downloaded.set(normalized, name);
    }
  }

  // Rewrite body + frontmatter (skipped in download-only mode).
  if (!opts.noRewrite) {
    let rewritten = rewriteBodyImages(body, {
      slug: opts.slug,
      downloaded,
      considered: new Set(allUrls),
    });
    // Insert the article's inline images at their positions (anchored on the
    // verbatim text block that precedes each image in the article). Re-runs on
    // an already-processed mirror find the images already inserted and leave
    // them untouched (idempotent — see scripts/lib/inline-images.ts).
    if (articleImages) {
      const inserted = insertInlineImages(rewritten, {
        slug: opts.slug,
        inline: articleImages.inline,
        downloaded,
      });
      if (inserted != null) rewritten = inserted;
    }
    const hasAttachments = downloaded.size > 0;
    const newFm: Frontmatter = {
      ...fm,
      has_attachments: hasAttachments,
      images_original: [
        ...new Set([...(Array.isArray(fm.images_original) ? fm.images_original : []), ...allUrls]),
      ],
    };
    if (!hasAttachments) delete newFm.images_original;

    // Cover: record the local path of the article's cover image when it was
    // downloaded (the page template renders it between title and body); keep
    // the original remote URL as a fallback when the download failed.
    if (articleImages?.cover) {
      const coverName = downloaded.get(articleImages.cover.url);
      newFm.cover_image = coverName
        ? `/references/${opts.slug}/${coverName}`
        : articleImages.cover.url;
    } else {
      // No article media resolved — never leave a stale cover path pointing at
      // a previous mirror's artwork.
      delete newFm.cover_image;
    }

    const out = `---\n${serializeFrontmatter(newFm)}\n---\n\n${rewritten}`;
    await writeFile(file, out, 'utf8');
  }

  return {
    ok: result.ok.map((o) => ({ url: o.url, dest: o.dest, size: o.size })),
    failed: result.failed,
  };
}
