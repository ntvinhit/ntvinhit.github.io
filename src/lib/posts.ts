import type { CollectionEntry } from 'astro:content';

export type PostEntry = CollectionEntry<'posts'>;
export type Lang = 'en' | 'vi';

export interface PostGroup {
  /** Language-neutral canonical slug shared by all variants (e.g. `my-note`). */
  slug: string;
  /** Variants of this post, keyed by language. May hold 1 or 2 entries. */
  variants: Partial<Record<Lang, PostEntry>>;
}

/**
 * Bilingual post model (see docs/posts-convention.md):
 * - Each post is ONE canonical identity with up to two language variants,
 *   stored as two content entries.
 * - The canonical slug is derived from the FILE NAME with the `.vi`/`.en`
 *   language marker stripped (`my-note.vi.md` -> `my-note`). Do NOT set
 *   `slug` in frontmatter for posts: Astro treats `slug` as the entry id, so
 *   two variants setting the same slug would collide.
 * - The canonical URL is `/posts/<canonical-slug>/` (English variant, the
 *   default) and `/posts/<canonical-slug>/vi/` (Vietnamese variant).
 */

/**
 * Resolve the canonical (language-neutral) slug for a post variant.
 * Derived from the file name, stripping the `.md`/`.mdx` extension AND a
 * `.vi`/`.en` language marker, e.g. `my-note.vi.md` -> `my-note`.
 */
export function postSlug(entry: PostEntry): string {
  const fileSlug = entry.id.replace(/\.(md|mdx)$/, '');
  return fileSlug.replace(/\.(vi|en)$/, '');
}

/** Public URL path for a post variant: `/posts/<canonical-slug>/` (en) or `/posts/<canonical-slug>/vi/`. */
export function postUrl(slug: string, lang: Lang = 'en'): string {
  return lang === 'en' ? `/posts/${slug}/` : `/posts/${slug}/vi/`;
}

/**
 * Group post entries into one group per canonical slug. A group holds the
 * English variant under `variants.en` and the Vietnamese under `variants.vi`
 * whenever either exists. `translation_of` is NOT required to pair variants —
 * matching canonical slugs is authoritative — but when set it is validated as
 * a consistency check.
 */
export function groupPosts(posts: PostEntry[]): PostGroup[] {
  const groups = new Map<string, PostGroup>();
  for (const entry of posts) {
    const slug = postSlug(entry);
    let group = groups.get(slug);
    if (!group) {
      group = { slug, variants: {} };
      groups.set(slug, group);
    }
    group.variants[entry.data.lang] = entry;

    // Consistency check: translation_of must point at the shared canonical slug.
    if (
      entry.data.translation_of &&
      entry.data.translation_of !== slug
    ) {
      console.warn(
        `[posts] ${entry.id}: translation_of (${entry.data.translation_of}) does not match canonical slug (${slug}).`
      );
    }
  }
  return [...groups.values()];
}

/**
 * Flatten post groups back to one entry per post, preferring the English
 * variant (the default language) so listings show each post exactly once.
 */
export function dedupePosts(posts: PostEntry[]): PostEntry[] {
  return groupPosts(posts).map((group) => group.variants.en ?? group.variants.vi!);
}

/**
 * Find the sibling-language variant of `entry` within a set of all posts
 * (e.g. `await getCollection('posts')`). Returns `undefined` when the post
 * has no translation. Used by the post page to build the language switcher.
 */
export function findTranslation(
  entry: PostEntry,
  allPosts: PostEntry[]
): PostEntry | undefined {
  const slug = postSlug(entry);
  const sibling = allPosts.find(
    (candidate) =>
      candidate.id !== entry.id &&
      postSlug(candidate) === slug &&
      candidate.data.lang !== entry.data.lang
  );
  return sibling ?? undefined;
}
