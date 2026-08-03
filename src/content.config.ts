import { defineCollection, z } from 'astro:content';

/**
 * Shared fields for both collections.
 * - slug: derived from the file name when omitted.
 * - lang: 'en' (default) | 'vi' — marks the LANGUAGE OF THE CONTENT.
 *   Reference mirrors keep the original article's language; the site UI
 *   itself stays English.
 * - private: hidden from public listings (index/archive) but still built and
 *   kept in the repo.
 * - draft: excluded from the build output until ready.
 */

const commonFields = {
  title: z.string(),
  slug: z.string().optional(),
  date: z.coerce.date(), // publication date (post) / mirror date (reference)
  lang: z.enum(['en', 'vi']).default('en'),
  private: z.boolean().default(false),
  draft: z.boolean().default(false),
};

/**
 * Author of the original article. Nested object — the canonical shape.
 * `handle` is the X username without the leading '@'.
 */
const authorSchema = z.object({
  name: z.string(),
  handle: z.string(),
});

/**
 * References collection — mirrors of X (Twitter) long-form articles.
 *
 * Full workflow convention (see docs/reference-convention.md):
 * - File placement: src/content/references/<slug>.md
 * - Slug: derived from the title (B choice from planning), so the file is
 *   placed at src/content/references/<slug-from-title>.md and the author
 *   lives in frontmatter, NOT in the path. URL = /references/<slug>/.
 * - Content: the original article text mirrored VERBATIM (original language,
 *   no edits). Only the site UI is English.
 * - Media: images are downloaded into public/references/<slug>/ by the media
 *   pipeline (scripts/download-reference-media.ts); `has_attachments` gates
 *   that. Image paths in content are absolute paths served from the Astro
 *   public dir: /references/<slug>/image.jpg. Every rewritten image keeps its
 *   original remote URL in an HTML comment (`<!-- image original: <url> -->`)
 *   and `images_original` records the full recovery list. Video links keep
 *   their original URLs as-is.
 * - Cover: the article cover is recorded in `cover_image` (a local path like
 *   `/references/<slug>/<file>`, or the original URL as a fallback) and
 *   rendered at the top of the page, above the article body. The media
 *   pipeline sets it (docs/reference-convention.md §4).
 * - Credit block: rendered at the bottom of the page by CreditBlock.astro —
 *   author name, @handle, link to the original X article, published date,
 *   and the constant mirror banner.
 */
const references = defineCollection({
  type: 'content',
  schema: z.object({
    ...commonFields,
    author: authorSchema, // { name, handle } — handle without '@'
    original_url: z.string().url(), // link to the original X article
    published_date: z.coerce.date(), // when it was published on X
    fetched_date: z.coerce.date(), // when the article was fetched/mirrored
    has_attachments: z.boolean().default(false), // ≥1 image downloaded to public/references/<slug>/
    images_original: z.array(z.string()).default([]), // original remote URLs (media pipeline, recovery list)
    cover_image: z.string().optional(), // article cover: local path /references/<slug>/<file> or original URL (media pipeline)
    description: z.string().default(''), // short summary, shown in listings
    tags: z.array(z.string()).default([]),
  }),
});

/**
 * Posts collection — the user's own writing.
 *
 * Bilingual convention (see docs/posts-convention.md):
 * - A post is ONE canonical identity with up to two language variants
 *   (`lang: 'en'` and `lang: 'vi'`), stored as two content entries.
 * - Both variants share a language-neutral canonical slug and render under
 *   the SAME URL: `/posts/<canonical-slug>/` (English, the default) and
 *   `/posts/<canonical-slug>/vi/` (Vietnamese).
 * - The canonical slug is derived from the FILE NAME (`.vi`/`.en` stripped,
 *   e.g. `my-note.vi.md` -> `my-note`). Do NOT set `slug` in frontmatter for
 *   posts: Astro treats `slug` as the entry id, so two variants setting the
 *   same slug would collide (one overwrites the other).
 * - `translation_of` holds the canonical slug of the sibling variant
 *   (e.g. `'sample-building-this-site'` for both files of the sample post).
 *   A standalone post (no translation) simply omits it.
 *
 * `based_on` / `references` hold slugs of reference entries this post is
 * based on / cites, enabling bidirectional linking with reference pages later.
 */
const posts = defineCollection({
  type: 'content',
  schema: z.object({
    ...commonFields,
    description: z.string().default(''),
    tags: z.array(z.string()).default([]),
    translation_of: z.string().optional(), // public slug of the sibling-language variant
    based_on: z.array(z.string()).default([]), // reference slugs this post is based on
    references: z.array(z.string()).default([]), // reference slugs cited by this post
  }),
});

export const collections = { references, posts };
