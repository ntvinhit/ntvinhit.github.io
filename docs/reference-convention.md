# X Article Mirror — Reference Convention

This document defines how an X (Twitter) long-form article is mirrored into
this site. It is the single source of truth for the **references** content
collection — follow it exactly whenever a new article is mirrored.

Workflow at a glance: fetch the original text verbatim via the X API (agent
driven), place it in `src/content/references/<slug>.md`, run the media
pipeline (`bun scripts/download-reference-media.ts <slug>`), and the site
renders the page at `/references/<slug>/` with the required credit block.
The pipeline downloads images into `public/references/<slug>/`, rewrites the
body to local paths, and reports any image it could not download (§4, §9).

---

## 1. Frontmatter schema

All fields are validated by the Zod schema in
`src/content.config.ts` (collection `references`).

| Field             | Type      | Required | Default   | Meaning                                                            |
| ----------------- | --------- | -------- | --------- | ------------------------------------------------------------------ |
| `title`           | string    | yes      | —         | Article title                                                      |
| `slug`            | string    | no       | file name | Public URL slug (`/references/<slug>/`); usually omitted, see §2    |
| `date`            | date      | yes      | —         | Date the article was **mirrored** into this repo                   |
| `lang`            | `'en'\|'vi'` | no     | `'en'`    | Language of the **original** content (mirror stays verbatim)       |
| `private`         | boolean   | no       | `false`   | Hide from public listings; still built and kept in repo (see §7)   |
| `draft`           | boolean   | no       | `false`   | Exclude from the build output entirely                             |
| `author.name`     | string    | yes      | —         | Original author display name                                       |
| `author.handle`   | string    | yes      | —         | X username **without** the leading `@`                             |
| `original_url`    | string    | yes      | —         | Link to the original X article (must be a valid URL)               |
| `published_date`  | date      | yes      | —         | When the article was published on X                                |
| `fetched_date`    | date      | yes      | —         | When the mirror was fetched via the X API                          |
| `has_attachments` | boolean   | no       | `false`   | Whether ≥1 image was downloaded to `public/references/<slug>/` (see §4). Set by the media pipeline |
| `images_original` | string[]  | no       | —         | Original remote URLs of every image in the article (the mirror's recovery list, see §4). Written by the media pipeline when `has_attachments` is true |
| `cover_image`     | string    | no       | —         | The article's cover image: local path `/references/<slug>/<file>` when the download succeeded, or the original remote URL as a fallback (see §4). Rendered at the top of the page. Written by the media pipeline |
| `description`     | string    | no       | `''`      | Short summary shown in listings                                    |
| `tags`            | string[]  | no       | `[]`      | Free-form tags                                                     |

> **Note on `mirror_banner`:** the credit block banner is a constant rendered
> by the component — it is **not** stored in frontmatter.

### Example

```yaml
---
title: "Why we stopped tuning our Kafka partition keys"
date: 2026-03-10        # mirror date
lang: "en"              # language of the original article
private: false
draft: false
author:
  name: "Jane Developer"
  handle: "janedev"     # no leading '@'
original_url: "https://x.com/janedev/status/1899999999999999999"
published_date: 2026-03-08
fetched_date: 2026-03-10
has_attachments: true
cover_image: "/references/why-we-stopped-tuning-our-kafka-partition-keys/cover.jpg"
description: "A short summary shown in the references listing."
tags: ["engineering", "systems"]
---
```

---

## 2. File placement and slug

- One file per article: `src/content/references/<slug>.md`.
- **Slug by title** (B choice from planning): derive the slug from the
  article title — lowercase, spaces → hyphens, strip punctuation.
  - e.g. *"Why we stopped tuning our Kafka partition keys"* →
    `why-we-stopped-tuning-our-kafka-partition-keys`
- The **author lives in frontmatter**, never in the path.
- Do **not** set `slug` in frontmatter unless the title-derived slug would
  collide or you need to keep a legacy path. When set, it overrides the file
  name (the URL always follows the slug).
- Final URL: `/references/<slug>/`.

---

## 3. Verbatim-content rule

The mirrored text is the original article **verbatim**:

- Copy the X article text exactly — no rewriting, no summarising, no
  editorialising.
- Keep the article in its **original language** (`lang` in frontmatter marks
  it). Only the site UI is English; the mirror itself is never translated.
- Markdown is fine for structure (headings, lists, code blocks) but must not
  alter the wording.
- The preferred way to structure the body is the automatic converter — it
  rebuilds the body from the article's **DraftJS content_state** on the status
  page (`scripts/lib/draftjs-to-markdown.ts`), which is deterministic, tuned
  to the X article conventions, and guaranteed to keep the wording
  byte-for-byte (§12). The converter is used by `add-reference.ts` and by the
  `--apply-converter` re-run hook.
- Embedded X posts (`TWEET` entities) in the article are rendered by the
  converter as a raw-HTML placeholder `<figure data-tweet-id="…">`, which the
  reference page shows as a live X widget (see §12). Twemoji entities
  (`TWEMOJI`) become an inline `<img>` of the Twemoji SVG — never collapsed.
- Do not add your own commentary inside the body. If a note is genuinely
  needed, keep it to an HTML comment (`<!-- ... -->`), which never renders.

---

## 4. Image / attachment convention

**Where files go.** Astro serves static files from the repo-root `public/`
directory (configured via `publicDir` in `astro.config.mjs`) — a top-level
`assets/` directory is **not** copied into the build. Reference media lives in

```
public/references/<slug>/<file>
```

and is referenced from the body with absolute paths:

```md
![Event pipeline diagram](/references/sample-event-pipeline/pipeline.png)
```

The downloader (`scripts/lib/fetch-media.ts`) creates the folder, writes one
file per image, and never throws for a single image failure.

**Body-rewrite scheme.** The media pipeline rewrites the body so images are
served locally, while the **original remote URL always stays recoverable** —
every rewritten image keeps an HTML comment on the same line:

```md
![Event pipeline diagram](/references/sample-event-pipeline/pipeline.png) <!-- image original: https://pbs.twimg.com/media/ABC123?format=jpg&name=large -->
```

- **Download succeeded** → local path in the image src + `<!-- image original: <url> -->`.
- **Download failed** (blocked, 404, timeout) → the **original remote URL is
  kept as the image src** (content still renders when reachable) plus the same
  comment. Failures are collected and reported by the pipeline (see §9).
- **Already-local images** (`./x.png`) and **video URLs** are left untouched.
- `images_original` in frontmatter holds the full list of original URLs
  (written when at least one image was stored) — the recovery list in case a
  local file is ever lost.

**X CDN sizes.** `pbs.twimg.com` URLs often need a size variant: bare URLs are
normalized to `?format=<ext>&name=large` (keeping `.gif` as a gif). URLs that
already carry a variant (e.g. `?format=jpg&name=orig` from the X API media
object) are used as-is.

**`has_attachments`** is `true` once ≥1 image has been downloaded to
`public/references/<slug>/`; the media pipeline sets it (and deletes it when
nothing was downloaded).

**Cover image (`cover_image`).** An X article often has a **cover** — the
banner X shows at the top of the article (the first `pbs.twimg.com` photo,
used verbatim as the article header). When a cover exists, the media pipeline
records it in the `cover_image` frontmatter field and the reference page
renders it **between the title and the article body** (`src/pages/references/
[...slug].astro`), constrained to the content width (`max-w-[640px]`) — never
full-bleed. `alt` is the article title.

- `cover_image` holds the **local path** `/references/<slug>/<file>` when the
  cover download succeeded, or the **original remote URL** when it failed
  (same fallback policy as body images, above). `images_original` still lists
  the cover's original URL, so it stays recoverable.
- The cover may or may not also appear in the body. When it does, it is
  downloaded and rewritten exactly like any other body image — the pipeline
  records it in `cover_image` in addition to the body rewrite.
- **Pipeline contract:** `processReferenceMedia()` in
  `scripts/lib/reference-media.ts` accepts the resolved article media (the
  `articleMedia` option — cover + inline images, as produced by
  `scripts/lib/resolve-article-media.ts`), downloads the cover into
  `public/references/<slug>/` like any other image, and sets `cover_image` in
  frontmatter — to the local path on success (`/references/<slug>/<file>`) or
  the original URL on failure. When no cover is supplied it leaves
  `cover_image` unset. `add-reference.ts` resolves the media from the status
  page automatically and passes it through; `download-reference-media.ts`
  resolves it itself when given `--status-url`.

## 5. Video rule

Videos embedded in the original article keep their **original URLs as-is**
in the content — do not download or rehost video. Link/embed the original
URL exactly as it appeared. The media pipeline ignores video URLs.

---

## 6. Credit block (rendered automatically)

Every reference page renders `src/components/CreditBlock.astro` at the
**bottom of the page** — after the article body and the "Cited in" section,
just before the "← All references" back-link — so the mirrored content stays
the visual focus. It is styled as a compact, muted attribution footer (small
text, low-contrast, thin top border), not a prominent panel. It shows:

1. Author name
2. `@handle`, linked to `https://x.com/<handle>`
3. **"Original article"** link to `original_url`
4. **Published date** (`published_date`, formatted)
5. The constant mirror banner:

   > Mirrored from X for personal reference. All rights belong to the original
   > author.

Nothing else is needed in the file — the component pulls everything from
frontmatter. Do not hand-write a credit line in the body.

---

## 7. `private` flag

- `private: true` hides the entry from all **public listings** (the
  references index and the home page).
- The page is **still built** and reachable at its URL if you know it, and
  the file stays in the repo — use it for articles you want to keep
  searchable-in-repo but out of the public index.
- `draft: true` is the stronger flag: it excludes the entry from the build
  entirely.
- A `private` **post** never appears in this reference's **"Cited in"**
  listing either (§11) — only non-draft, non-private posts are shown there.

---

## 8. Checklist for mirroring a new article

1. Fetch the article text verbatim via the X API.
2. Derive `<slug>` from the title (§2).
3. Create `src/content/references/<slug>.md` with the frontmatter above and
   the verbatim body — generated from the article's DraftJS content_state on
   the status page, or by hand following §3 and §12.
4. Run the media pipeline: `bun scripts/download-reference-media.ts <slug>`.
   It downloads images to `public/references/<slug>/`, rewrites the body to
   local paths (keeping the originals in HTML comments), sets
   `has_attachments` / `images_original` / `cover_image`, and reports failed
   downloads (§4, §9). Keep video URLs as-is (§5).
5. Run `bunx astro check` and `bun run build` — both must pass.
6. The page appears at `/references/<slug>/` with the credit block as a slim
   attribution footer at the bottom (§6).

---

## 9. Media pipeline (scripts)

The downloader is a small two-layer pipeline under `scripts/`:

- `scripts/lib/fetch-media.ts` — the reusable core.
  - `downloadImages(images: {url, dest}[]): Promise<{ok, failed}>` downloads
    each image with `fetch` (or reads `file://`), creates destination dirs,
    and returns per-file results. **Never throws for a single image failure** —
    failures are collected with reasons (`HTTP <status>`, network error,
    timeout, blocked HTML error page).
  - `normalizeImageUrl()` maps bare X CDN URLs to the size variant
    `?format=<ext>&name=large` (used for the article's `pbs.twimg.com`
    URLs; the X API media objects' URLs pass through as-is).
- `scripts/lib/reference-media.ts` — ties downloads into one reference entry:
  `processReferenceMedia({ file, slug })` scans the body for remote image
  URLs (plus optional X API media URLs via `extraImageUrls`), downloads them
  into `public/references/<slug>/`, rewrites the body (§4), and updates
  `has_attachments` / `images_original` / `cover_image` in frontmatter. The
  `articleMedia` option accepts already-resolved cover + inline images (from
  `scripts/lib/resolve-article-media.ts`); `articleStatusUrl` makes the
  pipeline resolve them itself from the status page. Inline-image insertion
  (anchored on the preceding article text) lives in the shared
  `scripts/lib/inline-images.ts`.
- `scripts/download-reference-media.ts` — the CLI entry point:

  ```sh
  bun scripts/download-reference-media.ts <slug>        # src/content/references/<slug>.md
  bun scripts/download-reference-media.ts <file.md>     # explicit file
  bun scripts/download-reference-media.ts <slug> --image <x-api-media-url>
  bun scripts/download-reference-media.ts <slug> --status-url <x-status-url>
  ```

  It prints a per-image report (`✓`/`✗`), keeps failed URLs in the content,
  and exits non-zero when any image failed. `add-reference.ts` resolves the
  article media from the status page automatically and passes it to
  `processReferenceMedia` as `articleMedia` (no flags needed); the
  `--status-url` flag here remains useful for re-processing an existing
  mirror that was written before media resolution ran.

> **Why `public/references/<slug>/` and not `assets/references/<slug>/`?** The
> original convention pointed at a repo-root `assets/` directory, but Astro
> only serves static files that live under `publicDir` (`public/` by
> default) — a top-level `assets/` folder is never copied into `dist/` (the
> old `assets/cover-image.JPG` was not being served; it now lives at
> `public/cover-image.JPG`). All reference media therefore lives under
> `public/references/<slug>/` and is referenced as
> `/references/<slug>/<file>`. The repo-root `public/` folder is committed
> like any other source (this is a static mirror — media is part of the
> content, not a build artifact).

---

## 10. Automation: add-reference script

`scripts/add-reference.ts` (wired as `bun run add-reference`) is a **fallback
tool** that fetches an X article via the X API, generates the mirror file, and
**automatically resolves + downloads ALL of the article's media** — cover and
inline images — without any `--image` or `--status-url` flags. The primary
workflow remains agent-driven (the agent fetches the article and writes the
file by hand for full control over title, summary, tags and media). Use the
script for quick, consistent mirrors — then review the generated file, because
a few fields are derived heuristically (see "Generated-by-default values"
below).

### Usage

```sh
bun run add-reference -- https://x.com/<handle>/status/<id>            # basic mirror
bun run add-reference -- https://x.com/<handle>/status/<id> --private  # hidden from public listings
bun run add-reference -- https://x.com/<handle>/status/<id> --draft    # excluded from build
bun run add-reference -- --help                                        # usage
```

- `<url>` may be an `x.com` or `twitter.com` post URL; the numeric post id is
  extracted and looked up.
- `--private` sets `private: true`, `--draft` sets `draft: true` (§7).
- The script **never overwrites** an existing file — it exits non-zero with a
  clear message if `src/content/references/<slug>.md` already exists.
- **Media is automatic**: after writing the mirror the script resolves the
  article's cover + inline images from the public status page and runs them
  through the media pipeline (§9). If that step fails, the mirror file is
  still written (with remote image URLs) and the download can be re-run later
  with `bun scripts/download-reference-media.ts <slug> --status-url <url>`.
- Exit codes: `0` success/help, `1` usage or runtime error, `2` API error.

### Environment variable

| Variable             | Required | Meaning                                    |
| -------------------- | -------- | ------------------------------------------ |
| `X_API_BEARER_TOKEN` | yes*     | X API v2 app-only Bearer token for fetching |

\* `X_API_TOKEN` is accepted as a fallback alias. Tokens come from
<https://developer.x.com/> (Project → Keys & tokens → Bearer Token).

### What the script does

1. `GET https://api.x.com/2/tweets/{id}` with
   `expansions=author_id,attachments.media_keys` and
   `tweet.fields`/`user.fields`/`media.fields` set so the post, author and
   media are returned in one call.
2. Long-form articles ("X Articles" / note Tweets) come back as a regular post
   whose full text lives in `note_tweet.text` — there is **no public read
   endpoint for Articles** (the Articles API only supports create/publish), so
   the mirror is built from the post lookup.
3. Derives the frontmatter fields below and writes
   `src/content/references/<slug>.md` (`slug` from the title, §2). The body is
   generated from the article's **DraftJS content_state** on its public status
   page (`scripts/lib/draftjs-to-markdown.ts` — §12): headings, lists, code
   blocks, images and mentions, keeping the wording verbatim (§3). If the
   status page cannot be fetched/parsed (blocked, layout change), the script
   falls back to the X API's flat `plain_text` as the body and reports the
   failure.
4. **Media (automatic, no flags):** the same status page fetched for the body
   is parsed for the real CDN image URLs (the X API itself returns article
   media only as opaque ids — `scripts/lib/resolve-article-media.ts`). The
   cover image is downloaded into `public/references/<slug>/` and recorded in
   `cover_image` (local path on success, original URL on failure, §4); every
   inline image is downloaded and inserted into the body at its position
   (anchored on the preceding article text — shared
   `scripts/lib/inline-images.ts` logic). `has_attachments` /
   `images_original` are set to match. Video URLs stay inline as-is (§5).
5. If the status page cannot be fetched/parsed (blocked, layout change), the
   script still writes the mirror (with remote image URLs), reports the
   failure, and the media step can be re-run later with
   `bun scripts/download-reference-media.ts <slug> --status-url <url>`.

### Generated-by-default values (review after running)

| Field              | How the script fills it                                        |
| ------------------ | -------------------------------------------------------------- |
| `title`            | X API `article.title` when present, else the first non-empty line of the article text |
| `slug`             | Slugified title (§2)                                           |
| `date` / `fetched_date` | Today (mirror date — `date` is the mirror date per §1) |
| `published_date`   | Post `created_at` (falls back to today if absent)              |
| `lang`             | Post `lang`, mapped to `'en' \| 'vi'` (anything else → `'en'`) |
| `author`           | `includes.users` — `name` + `username` (falls back to "Unknown author" / "unknown") |
| `original_url`     | The URL you passed in                                          |
| `has_attachments`  | `true` when the post has photo attachments (set to `false` by the media pipeline if none were stored) |
| `images_original`  | Written by the media pipeline after download (§4)              |
| `description`      | `''` — **fill in a short summary after running**               |
| `tags`             | `[]` — **fill in after running**                               |

### Limitations

- **Requires a Bearer token** — there is no unauthenticated fetch path.
- **7-day window**: the X API *search* endpoints (`/2/tweets/search/recent`,
  `/2/tweets/counts/recent`) only index the last 7 days. The script itself
  looks up a post **by id** (not time-limited), but any agent/script that must
  *find* an article by searching cannot see posts older than 7 days — mirror
  those with the agent-driven workflow instead.
- **Title is heuristic** — derived from the first line of the article text,
  since the API does not expose a separate article title on read.
- **Media depends on the status page** — the body AND the media are built from
  the article's public status page (needs network access to x.com; the X API
  itself does not return article media URLs). If the page is blocked or its
  layout changes, the mirror is still written (body falls back to the API's
  plain `plain_text`, images to remote URLs) and the media step can be re-run
  later with `bun scripts/download-reference-media.ts <slug> --status-url
  <url>`.
- The script lives under `scripts/` and is never imported by the Astro site,
  so it cannot affect `astro check` or the build.

Samples: `src/content/references/sample-event-pipeline.md` (public, full
convention) and `src/content/references/sample-private-note.md` (`private:
true` filtering demo).

---

## 12. Body generation: DraftJS → markdown

Reference bodies are **generated from the article's real structure**, not from
plain text. X Articles are DraftJS documents; their serialized content_state
is embedded in the public status page's server-rendered payload
(`window.__INITIAL_DATA__`, seroval/Relay records). The converter
(`scripts/lib/draftjs-to-markdown.ts`) parses that payload and renders
markdown. This is what `add-reference.ts` uses to write the body and what
`--apply-converter` uses to re-structure an existing mirror.

**What the parser reads (all associated by record id, never by text
guessing):**

- `DraftJsBlock` records — ordered `blocks[]`: `text` + `type`, with escaped
  seroval strings (`\"`, `\n`, `\uXXXX`, …) decoded.
- `DraftJsEntityRange` records — the atomic block's entity key (the record's
  `content_state:blocks:<n>:entity_ranges:0` id gives the owning block).
- `DraftJsEntityMap` + `DraftJsEntity` records — DraftJS key → entity record
  index → entity type (`MEDIA` / `DIVIDER` / `MARKDOWN` / `TWEET` / `TWEMOJI`), in map order.
- `ArticleMediaKey` records — `media_id` for MEDIA entities (paired with the
  page's `ApiMedia` → `ApiImage` records for the CDN URL / local file).
- `DraftJsEntityData` records for TWEET entities — the embedded post's
  `tweet_id`, in map order; for TWEMOJI entities — the Twemoji SVG `url`.
- `DraftJsBlockMention` records — mention spans; the record's
  `content_state:blocks:<n>:data:mentions:<m>` id gives the owning block.
- `DraftJsInlineStyleRange` records — inline styles (currently only `Bold`).
  They are **parsed but not rendered**: X articles may store bold spans, but
  the mirror convention renders without bold so a mirror never invents
  formatting.
- No `LINK` entities exist in X articles — URLs appear as plain text in
  blocks and are autolinked.

**Block-type → markdown mapping:**

| DraftJS type          | Markdown                                    |
| --------------------- | ------------------------------------------- |
| `header-one`          | `## <text>`                                 |
| `unstyled`            | paragraph (blank-line separated)            |
| `unordered-list-item` | `- <text>` (consecutive items = one list)   |
| `ordered-list-item`   | `1. <text>` (consecutive items = numbered list) |
| `atomic` + `MEDIA`    | `![Image](/references/<slug>/<file>)` (from the resolved media map; a blank placeholder line when the media is not resolvable) |
| `atomic` + `DIVIDER`  | `---`                                       |
| `atomic` + `MARKDOWN` | the entity's fenced code block, verbatim from `entityData.markdown` |
| `atomic` + `TWEET`    | `<figure data-tweet-id="…">` — raw-HTML placeholder for the embedded X post |
| `atomic` + `TWEMOJI`  | `<img src="…abs.twimg.com/emoji/…" alt="emoji">` — the Twemoji SVG, kept inline |
| `atomic` + unknown    | `---` (keeps the block's position)          |

The `<figure data-tweet-id>` placeholder is rendered as the live X widget
iframe by the rehype plugin `src/plugins/rehype-tweet-embed.ts` (registered in
`astro.config.mjs`), with a "View on X" link as the no-JS fallback.

**Inline pass on text blocks:**

- Mention spans (`DraftJsBlockMention`) → `[@handle](https://x.com/handle)`.
- Bare `https?://…` URLs → `[url](url)` (autolink).
- Inline style ranges are intentionally not rendered (no bold in mirrors).

The wording is preserved byte-for-byte; only structure is added (§3).

---

## 11. Reverse linking — "Cited in" (posts that cite this reference)

Bidirectional linking with posts works in both directions (see
`docs/posts-convention.md` §8 for the post-side rules):

- A **post** cites this reference through its `based_on` and/or `references`
  frontmatter arrays, which hold **reference slugs** (this entry's public
  slug, §2).
- This reference page then renders a **"Cited in"** section near the end of
  the page (after the body, before the attribution footer and the
  "← All references" link), listing
  every post that cites it as title (+ an **EN · VI** badge when the post is
  bilingual), each linking to `/posts/<slug>/`.
- The section only renders when at least one **public** post cites the
  reference. Private and draft posts are always excluded — a `private: true`
  post never leaks into this listing (§7).

Missing-target tolerance: if a post cites a reference slug that no longer
exists, the broken link is skipped with a build-time warning
(`console.warn`) — the build never crashes. A reference entry whose slug no
longer matches any citing post simply renders without a "Cited in" section.

Implementation: the reverse map is built by `postsCitingReferences` in
`src/lib/relationships.ts` (it collapses a bilingual post's variants into one
row and prefers the English variant for display); the section itself is
`src/components/CitedInSection.astro`.
