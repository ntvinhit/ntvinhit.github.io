#!/usr/bin/env bun
/**
 * add-reference — mirror an X (Twitter) long-form article into
 * `src/content/references/<slug>.md` per docs/reference-convention.md.
 *
 * FALLBACK TOOL: the primary workflow is agent-driven (an agent fetches the
 * article via the X API and writes the file by hand). This script exists for
 * quick, consistent manual/agent use. It generates the mirror AND resolves +
 * downloads ALL of the article's media automatically — no `--image` or
 * `--status-url` flags needed (see "Media" below).
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 *   Env var:  X_API_BEARER_TOKEN  (X API v2 app-only Bearer token)
 *   (X_API_TOKEN is accepted as a fallback alias.)
 *   Get one at https://developer.x.com/ (Project → Keys & tokens → Bearer Token).
 *
 * ── API used ────────────────────────────────────────────────────────────────
 *   GET https://api.x.com/2/tweets/{id}
 *     ?expansions=author_id,attachments.media_keys
 *     &tweet.fields=created_at,lang,note_tweet,attachments,entities
 *     &user.fields=name,username
 *     &media.fields=type,url,variants
 *
 *   Long-form articles ("X Articles" / note Tweets) are returned as a regular
 *   Post whose full text lives in `data.note_tweet.text`. There is currently
 *   NO public read endpoint for Articles (the Articles API only supports
 *   create-draft/publish), so the mirror is built from the post lookup.
 *   The title is derived from the first line of the article text; the slug is
 *   derived from that title (convention §2: "slug by title").
 *
 *   ── 7-day limitation ──────────────────────────────────────────────────────
 *   The X API *search* endpoints (search/recent, counts/recent) only cover the
 *   last 7 days. A direct post lookup by ID is NOT time-limited, but any
 *   workflow that finds the article by searching (rather than by URL) cannot
 *   see posts older than 7 days. If the article is older, mirror it with the
 *   agent-driven workflow instead.
 *
 * ── Media (images/video) ────────────────────────────────────────────────────
 *   Media is handled AUTOMATICALLY — no flags required:
 *   1. The article's status page
 *      (`https://x.com/<handle>/status/<postId>`) is fetched and its
 *      server-rendered payload is parsed for the real CDN image URLs (the X
 *      API itself returns article media only as opaque ids — see
 *      scripts/lib/resolve-article-media.ts).
 *   2. The cover image is downloaded into `public/references/<slug>/` and
 *      `cover_image` is set in frontmatter: the local path on success, the
 *      original URL as a fallback (convention §4).
 *   3. Every inline image is downloaded into `public/references/<slug>/` and
 *      inserted into the body at its position (anchored on the preceding
 *      article text — shared scripts/lib/inline-images.ts logic).
 *   4. `has_attachments` / `images_original` are set correctly.
 *   Video URLs are kept inline as-is (convention §5 — never download or
 *   rehost video).
 *   If the status page cannot be fetched/parsed (blocked, layout change), the
 *   script falls back to just writing the mirror file (with remote image
 *   URLs), reports the failure, and the media step can be re-run later with
 *   `bun scripts/download-reference-media.ts <slug> --status-url <url>`.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   bun run add-reference -- <x-article-url> [flags]
 *   Flags: --private   set `private: true` in frontmatter
 *          --draft     set `draft: true` in frontmatter (excluded from build)
 *          --help, -h  print this help and exit
 *   Hidden test hook (no network):
 *          --slugify <title>  print the slug for a title and exit
 *   Offline re-structuring of an existing mirror (no network, no token):
 *          --apply-converter <file.md | slug>
 *            re-run the DraftJS → markdown converter on an existing reference
 *            mirror, using the article's status page (headings, lists, code
 *            blocks, images, mentions — see scripts/lib/draftjs-to-markdown.ts).
 *
 *   Exit codes: 0 success/help, 1 usage or runtime error, 2 API error.
 *
 * NOTE: the script lives under scripts/ and is never imported by the Astro
 * site, so it cannot break `astro check` or the build.
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processReferenceMedia } from './lib/reference-media';
import {
  parseArticleMediaFromPage,
  resolveArticleMediaFromStatusPage,
} from './lib/resolve-article-media';
import {
  parseFrontmatterText,
  serializeFrontmatter,
  splitFrontmatter,
  type Frontmatter,
} from './lib/frontmatter';
import {
  draftjsBlocksToMarkdown,
  resolveMediaByEntityKey,
} from './lib/draftjs-to-markdown';

// ── Types (loose mirrors of the X API v2 response shapes we consume) ────────

interface MediaEntity {
  media_key?: string;
  type?: string; // "photo" | "video" | "animated_gif"
  url?: string; // photos
  variants?: { url?: string; bit_rate?: number; content_type?: string }[];
}

interface UserEntity {
  id?: string;
  name?: string;
  username?: string;
}

interface ApiIncludes {
  media?: MediaEntity[];
  users?: UserEntity[];
}

interface ApiTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string; // ISO-8601, e.g. 2026-03-08T12:34:56.000Z
  lang?: string;
  note_tweet?: { text?: string };
  attachments?: { media_keys?: string[] };
}

interface ApiResponse {
  data?: ApiTweet;
  includes?: ApiIncludes;
  errors?: { title?: string; detail?: string; status?: number }[];
  title?: string;
  detail?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const API_BASE = 'https://api.x.com/2/tweets';
const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCES_DIR = resolve(SITE_ROOT, 'src/content/references');
const LANG_MAP: Record<string, 'en' | 'vi'> = {
  en: 'en',
  'en-us': 'en',
  vi: 'vi',
  'vi-vn': 'vi',
};

const HELP = `add-reference — mirror an X (Twitter) long-form article into the site

USAGE
  bun run add-reference -- <x-article-url> [flags]
  bun run add-reference -- --apply-converter <file.md | slug>

ARGS
  <x-article-url>   URL of the X article, e.g. https://x.com/<handle>/status/<id>
                    (twitter.com and x.com URLs both work; the numeric post id
                    is extracted and fetched via the X API v2)

FLAGS
  --private         set private: true in frontmatter (hidden from public
                    listings, still built and kept in the repo)
  --draft           set draft: true in frontmatter (excluded from the build)
  --apply-converter <file.md | slug>
                    re-run the DraftJS → markdown converter on an EXISTING
                    reference mirror (e.g. one written before the converter
                    existed). Fetches the article's status page and rebuilds
                    the stored body from its DraftJS content_state (headings,
                    lists, code blocks, images, mentions), preserving
                    frontmatter and any already-downloaded images.
  -h, --help        show this help and exit

ENV
  X_API_BEARER_TOKEN   X API v2 Bearer token (required for fetching)
                       (X_API_TOKEN is also accepted)

OUTPUT
  Writes src/content/references/<slug>.md (slug derived from the article
  title) with frontmatter matching the references schema and the article text
  mirrored VERBATIM, generated from the article's DraftJS content_state on
  the status page (headings, lists, code blocks, images, mentions — see
  scripts/lib/draftjs-to-markdown.ts).
  Media is handled AUTOMATICALLY: the cover + inline images are resolved from
  the article's status page, downloaded into public/references/<slug>/,
  inserted into the body at their positions, and recorded in frontmatter
  (cover_image / has_attachments / images_original). Video URLs stay inline
  as-is (convention §5).

EXIT CODES
  0  success (or --help / --slugify / --apply-converter)
  1  usage or runtime error
  2  X API returned an error (auth / not found / rate limit)

LIMITATIONS
  - Requires an X API Bearer token; there is no public unauthenticated fetch.
  - X API *search* endpoints only cover the last 7 days (direct post lookup
    by id is not time-limited).
  - Article title/slug are derived from the first line of the article text
    (no public article-title endpoint).
  - The body is generated from the article's DraftJS content_state on the
    status page. If the page cannot be fetched/parsed (blocked, layout
    change), the mirror falls back to the plain article text (convention §12)
    and the failure is reported.
  - Media resolution reads the article's public status page; if that page
    cannot be fetched/parsed (blocked, layout change) the mirror file is
    still written with remote image URLs and the failure is reported. Re-run
    media later with "bun scripts/download-reference-media.ts <slug>
    --status-url <url>".`;

// ── Pure, unit-testable helpers ─────────────────────────────────────────────

/** Slugify a title per convention §2: lowercase, spaces→hyphens, strip punctuation. */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/['’]/g, '') // apostrophes (incl. typographic) -> nothing
    .replace(/[^a-z0-9]+/g, '-') // everything else -> hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse runs of hyphens
}

/** Date -> `YYYY-MM-DD` (local time), the format used across the site. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Title — subtitle" -> "Title". Used to derive a title from article text. */
export function firstTitleLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
}

/** Map an X BCP-47 lang tag to the schema's `'en' | 'vi'`; default 'en'. */
export function normalizeLang(lang?: string): 'en' | 'vi' {
  if (!lang) return 'en';
  const key = lang.toLowerCase();
  return LANG_MAP[key] ?? LANG_MAP[key.split('-')[0] ?? ''] ?? 'en';
}

/** The last video variant URL of a media object (if it is a video/gif). */
function videoUrlFor(
  key: string,
  media: MediaEntity[] | undefined
): string | undefined {
  const m = media?.find((mm) => mm.media_key === key);
  if (!m) return undefined;
  if (m.type === 'video' || m.type === 'animated_gif') {
    return m.variants?.filter((v) => v.url)?.at(-1)?.url;
  }
  return undefined;
}

/** Collect inline image URLs (photo attachments) + cover/poster media keys. */
export function collectMedia(
  attachments: string[] | undefined,
  media: MediaEntity[] | undefined
): { imageUrls: string[]; videoUrls: string[] } {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  if (!attachments?.length) return { imageUrls, videoUrls };
  for (const key of attachments) {
    const m = media?.find((mm) => mm.media_key === key);
    if (!m) continue;
    if (m.type === 'photo' && m.url) {
      imageUrls.push(m.url);
    } else if (m.type === 'video' || m.type === 'animated_gif') {
      const v = videoUrlFor(key, media);
      if (v) videoUrls.push(v);
    }
  }
  return { imageUrls, videoUrls };
}

/**
 * Build the body from the article's status-page HTML: the DraftJS
 * content_state is parsed into markdown (headings, lists, code blocks,
 * images, mentions — see scripts/lib/draftjs-to-markdown.ts).
 *
 * Inline images are emitted at their exact DraftJS positions with their
 * LOCAL paths (resolved from the same page via `resolveMediaByEntityKey`)
 * plus the `<!-- image original: … -->` provenance comment, so a later
 * media-pipeline run finds them already inserted and skips them
 * (scripts/lib/inline-images.ts is idempotent on that marker).
 *
 * @param statusHtml status-page HTML (fetched once, shared with media
 *                   resolution — never double-fetched)
 * @param slug       reference slug (local image path prefix)
 * @param fallback   plain article text used when the page carries no DraftJS
 *                   blocks (blocked / layout changed)
 */
export function buildBody(
  statusHtml: string,
  slug: string,
  fallback: string,
): string {
  const mediaByEntityKey = resolveMediaByEntityKey(statusHtml, slug);
  const markdown = draftjsBlocksToMarkdown(statusHtml, { mediaByEntityKey });
  if (markdown !== null) {
    return markdown.trimEnd() + '\n';
  }
  // No DraftJS content_state on the page — fall back to the plain article
  // text verbatim (the old behaviour; structure is limited to what plain text
  // carries). Media is still handled by the pipeline below.
  return fallback.trimEnd() + '\n';
}

/**
 * Build the frontmatter block as a `Frontmatter` object, serialized with the
 * pipeline's own frontmatter serializer. `slug` is intentionally NOT written:
 * the file name `src/content/references/<slug>.md` already defines the slug
 * (convention §2 — set it in frontmatter only on collision). The generated
 * block includes the reference fields the media pipeline updates after
 * download (`has_attachments` / `images_original`).
 */
export function buildFrontmatter(input: {
  title: string;
  lang: 'en' | 'vi';
  author: { name: string; handle: string };
  originalUrl: string;
  publishedDate: string;
  fetchedDate: string;
  hasAttachments: boolean;
  description: string;
  tags: string[];
  private: boolean;
  draft: boolean;
}): string {
  const fm: Frontmatter = {
    title: input.title,
    date: input.publishedDate,
    lang: input.lang,
    private: input.private,
    draft: input.draft,
    author: { name: input.author.name, handle: input.author.handle },
    original_url: input.originalUrl,
    published_date: input.publishedDate,
    fetched_date: input.fetchedDate,
    has_attachments: input.hasAttachments,
    description: input.description,
    tags: input.tags,
  };
  if (input.hasAttachments) fm.images_original = [];
  return `---\n${serializeFrontmatter(fm)}\n---\n\n`;
}

/** Compose the complete markdown file (frontmatter + body). */
export function buildMarkdown(input: {
  title: string;
  lang: 'en' | 'vi';
  author: { name: string; handle: string };
  originalUrl: string;
  publishedDate: string;
  fetchedDate: string;
  hasAttachments: boolean;
  description: string;
  tags: string[];
  private: boolean;
  draft: boolean;
  body: string;
}): string {
  const { body, ...fm } = input;
  return buildFrontmatter(fm) + body.trimEnd() + '\n';
}

/**
 * Re-run the DraftJS → markdown converter on an EXISTING reference mirror
 * (written before the converter existed). Fetches the article's status page
 * (from `original_url` in frontmatter) and rebuilds the stored body from its
 * DraftJS content_state, keeping the frontmatter block and any
 * already-downloaded images untouched.
 *
 * Target: `<slug>` (resolved to src/content/references/<slug>.md) or an
 * explicit `.md` path. Exits non-zero if the file is missing or empty.
 */
export async function applyConverterToReference(target: string): Promise<void> {
  const isMarkdownPath = target.endsWith('.md');
  const file = isMarkdownPath
    ? resolve(target)
    : resolve(REFERENCES_DIR, `${target}.md`);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    fail(`reference file not found: ${file}`);
  }

  const { fm, body } = splitFrontmatter(raw);
  if (fm === null) {
    fail(`no frontmatter block found in ${file} — not a reference mirror`);
  }
  const plain = body.trim();
  if (!plain) {
    fail(`reference body is empty: ${file}`);
  }

  // The mirror's original article URL lives in frontmatter — rebuild the body
  // from that article's DraftJS structure.
  const originalUrl =
    parseFrontmatterText(fm).original_url ??
    fail(`no original_url in frontmatter — cannot fetch the status page`);
  let statusHtml: string;
  try {
    statusHtml = await fetchStatusPage(String(originalUrl));
  } catch (err) {
    fail(
      `could not fetch the article status page ${originalUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const slug = basename(file, '.md');
  const converted = buildBody(statusHtml, slug, plain).trimEnd();
  const out = `---\n${fm}\n---\n\n${converted}\n`;
  await writeFile(file, out, 'utf8');

  const headings = (converted.match(/^##\s/gm) ?? []).length;
  const lists = (converted.match(/^- /gm) ?? []).length;
  const links = (converted.match(/\[[^\]]+\]\(https?:\/\//g) ?? []).length;
  console.log(`Converted ${file} (from ${originalUrl})`);
  console.log(`  ${headings} heading(s), ${lists} list item(s), ${links} link(s) in body`);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

export interface CliOptions {
  url?: string;
  private: boolean;
  draft: boolean;
  help: boolean;
  slugify?: string;
  applyConverter?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { private: false, draft: false, help: false };
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--private') {
      opts.private = true;
    } else if (arg === '--draft') {
      opts.draft = true;
    } else if (arg === '--slugify') {
      opts.slugify = ''; // value taken from the next positional
    } else if (arg === '--apply-converter') {
      opts.applyConverter = ''; // value taken from the next positional
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (opts.slugify === '') {
      opts.slugify = arg;
    } else if (opts.applyConverter === '') {
      opts.applyConverter = arg;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error(
      `Expected a single article URL, got ${positional.length} arguments.`
    );
  }
  opts.url = positional[0];
  return opts;
}

/** Parse an x.com / twitter.com status URL into a numeric post id. */
export function extractPostId(url: string): string {
  const m = url.match(/\/status\/(\d{1,19})/i);
  if (!m)
    throw new Error(`Not an X post URL (expected .../<handle>/status/<id>): ${url}`);
  return m[1];
}

// ── X API ───────────────────────────────────────────────────────────────────

function bearerToken(): string {
  const token = process.env.X_API_BEARER_TOKEN ?? process.env.X_API_TOKEN;
  if (!token) {
    throw new Error(
      'X_API_BEARER_TOKEN is not set. Export a Bearer token (https://developer.x.com/) or set X_API_TOKEN.'
    );
  }
  return token;
}

/** Fetch the article post via GET /2/tweets/{id} with the expansions we need. */
async function fetchArticle(postId: string): Promise<ApiResponse> {
  const params = new URLSearchParams({
    expansions: 'author_id,attachments.media_keys',
    'tweet.fields': 'created_at,lang,note_tweet,attachments,entities',
    'user.fields': 'name,username',
    'media.fields': 'type,url,variants',
  });
  const res = await fetch(`${API_BASE}/${postId}?${params}`, {
    headers: { Authorization: `Bearer ${bearerToken()}` },
  });
  const body = (await res.json()) as ApiResponse;
  if (!res.ok) {
    const detail =
      body.errors?.[0]?.detail ?? body.detail ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(detail), { apiStatus: res.status });
  }
  return body;
}

/** Fetch a public status page (same UA/headers as the media resolver). */
async function fetchStatusPage(statusUrl: string): Promise<string> {
  const res = await fetch(statusUrl, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`status page returned HTTP ${res.status}`);
  return res.text();
}

// ── Main ────────────────────────────────────────────────────────────────────

function fail(message: string, code = 1): never {
  console.error(`error: ${message}`);
  console.error(`Run "bun run add-reference -- --help" for usage.`);
  process.exit(code);
}

async function run(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Test hook — verify slugify without touching the network.
  if (opts.slugify !== undefined) {
    console.log(slugify(opts.slugify));
    process.exit(0);
  }

  // Offline re-structuring of an existing mirror (no URL, no network, no token).
  if (opts.applyConverter !== undefined) {
    await applyConverterToReference(opts.applyConverter);
    process.exit(0);
  }

  if (!opts.url) {
    fail('missing article URL. Usage: bun run add-reference -- <x-article-url>');
  }

  let postId: string;
  try {
    postId = extractPostId(opts.url);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  let api: ApiResponse;
  try {
    api = await fetchArticle(postId);
  } catch (err) {
    const e = err as Error & { apiStatus?: number };
    const code = typeof e.apiStatus === 'number' ? 2 : 1;
    fail(
      `failed to fetch post ${postId} from the X API${
        e.apiStatus ? ` (HTTP ${e.apiStatus})` : ''
      }: ${e.message}`,
      code
    );
  }

  const tweet = api.data;
  if (!tweet) {
    fail(`the X API returned no post data for id ${postId}.`, 2);
  }

  const articleText = tweet.note_tweet?.text?.trim() ?? tweet.text?.trim() ?? '';
  if (!articleText) {
    fail(
      `post ${postId} has no article/note content (is it a long-form article?). ` +
        `Only long-form posts can be mirrored.`,
      2
    );
  }

  const title = firstTitleLine(articleText) || `X article ${postId}`;
  const slug = slugify(title);
  const today = toIsoDate(new Date());
  const published = tweet.created_at
    ? toIsoDate(new Date(tweet.created_at))
    : today;

  const author = api.includes?.users?.find((u) => u.id === tweet.author_id);
  const authorName = author?.name || author?.username || 'Unknown author';
  const authorHandle = author?.username || 'unknown';

  const media = api.includes?.media;
  const attachments = tweet.attachments?.media_keys;
  const { imageUrls, videoUrls } = collectMedia(attachments, media);
  const lang = normalizeLang(tweet.lang);

  // ── Status page: fetch ONCE, share between body generation and media ───────
  // The body is generated from the article's DraftJS content_state on this
  // page (the real structure — headings, lists, code blocks, images,
  // mentions); media resolution reads the same page's ApiMedia/ApiImage
  // records. If the page cannot be fetched/parsed, the mirror falls back to
  // the plain article text and remote image URLs (media re-runnable later).
  let statusHtml: string | null = null;
  try {
    statusHtml = await fetchStatusPage(opts.url);
    console.log(`  status page:  fetched (${statusHtml.length} bytes)`);
  } catch (err) {
    console.warn(
      `  status page:  could not fetch ${opts.url}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.warn('                mirror will use the plain article text.');
  }

  // Build the body: DraftJS structure when the page parsed, else plain text.
  const body = buildBody(
    statusHtml ?? '',
    slug,
    articleText,
  );
  const hasAttachments = imageUrls.length > 0;

  const markdown = buildMarkdown({
    title,
    lang,
    author: { name: authorName, handle: authorHandle },
    originalUrl: opts.url,
    publishedDate: published,
    fetchedDate: today,
    hasAttachments,
    description: '',
    tags: [],
    private: opts.private,
    draft: opts.draft,
    body,
  });

  const outPath = resolve(REFERENCES_DIR, `${slug}.md`);

  // Never silently overwrite an existing mirror.
  try {
    await access(outPath);
    fail(
      `a mirror already exists at ${outPath} — refusing to overwrite. ` +
        `If you meant to update it, edit that file (or remove it first).`
    );
  } catch {
    /* not present — good */
  }

  try {
    await mkdir(REFERENCES_DIR, { recursive: true });
    await writeFile(outPath, markdown, 'utf8');
  } catch (err) {
    fail(
      `could not write ${outPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  console.log(`Wrote ${outPath}`);
  console.log(`  title:        ${title}`);
  console.log(`  author:       ${authorName} (@${authorHandle})`);
  console.log(`  lang:         ${lang}`);
  console.log(`  published:    ${published}`);
  console.log(`  fetched:      ${today}`);
  console.log(
    `  media:        ${imageUrls.length} image(s), ${videoUrls.length} video(s)`
  );
  console.log(`  private:      ${opts.private}`);
  console.log(`  draft:        ${opts.draft}`);

  // ── Media (automatic) ─────────────────────────────────────────────────────
  // 1. Resolve the article's cover + inline images from the public status page
  //    (the X API returns article media as opaque ids without URLs — the page's
  //    SSR payload carries the real CDN URLs, see lib/resolve-article-media.ts).
  // 2. Hand everything to the shared media pipeline (§9): it downloads the
  //    cover + inline images into public/references/<slug>/, inserts the inline
  //    images into the body at their positions (shared lib/inline-images.ts
  //    anchoring logic), and sets cover_image / has_attachments /
  //    images_original in frontmatter.
  //
  // The mirror file is already written, so ANY failure here is reported but
  // does not lose the mirror — the media step can be re-run later with
  // `bun scripts/download-reference-media.ts <slug> --status-url <url>`.

  let articleMedia: {
    cover?: string | { url: string; altText?: string | null };
    inline?: {
      url: string;
      altText?: string | null;
      precedingText: string;
    }[];
  } | undefined;
  try {
    // Reuse the status page already fetched for body generation — parse the
    // media records out of it directly (no second fetch). When the initial
    // fetch failed, retry once here so a body-fallback mirror can still get
    // its media.
    const resolved = statusHtml
      ? parseArticleMediaFromPage(statusHtml)
      : await resolveArticleMediaFromStatusPage(opts.url);
    if (resolved && (resolved.cover || resolved.inline.length > 0)) {
      articleMedia = {
        cover: resolved.cover
          ? { url: resolved.cover.url, altText: resolved.cover.altText }
          : undefined,
        inline: resolved.inline.map((i) => ({
          url: i.url,
          altText: i.altText,
          precedingText: i.precedingText,
        })),
      };
      console.log(
        `  status page:  resolved ${
          resolved.inline.length
        } inline image(s)${resolved.cover ? ' + cover' : ''}`
      );
    } else {
      console.warn(
        '  status page:  no article media found on the page — mirror written without media.'
      );
    }
  } catch (err) {
    console.warn(
      `  status page:  could not resolve article media from ${opts.url}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.warn(
      '                mirror written without media — re-run later with ' +
        `"bun scripts/download-reference-media.ts ${slug} --status-url ${opts.url}".`
    );
  }

  try {
    const result = await processReferenceMedia({
      file: outPath,
      slug,
      extraImageUrls: imageUrls,
      articleMedia,
    });
    console.log(
      `  media pipeline: ${result.ok.length} image(s) downloaded, ${result.failed.length} failed`
    );
    for (const f of result.failed) {
      console.error(`    ✗ ${f.url} — ${f.reason} (remote URL kept in the body)`);
    }
    if (result.failed.length > 0) {
      console.error(
        `note: some images failed to download — re-run ` +
          `"bun scripts/download-reference-media.ts ${slug}" later.`
      );
    }
  } catch (err) {
    console.error(
      `note: media pipeline could not run: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    console.error(
      `      the mirror is saved with remote image URLs; re-run ` +
        `"bun scripts/download-reference-media.ts ${slug}" to download them.`
    );
  }
}

if (import.meta.main) {
  run().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
