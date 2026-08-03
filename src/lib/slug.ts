import type { CollectionEntry } from 'astro:content';

type AnyEntry = CollectionEntry<'posts'> | CollectionEntry<'references'>;

/**
 * Resolve the public slug for a content entry.
 * Prefers the explicit `slug` frontmatter field; otherwise derives it from
 * the file name (stripping the `.md`/`.mdx` extension), e.g.
 * `my-note.md` -> `my-note`.
 */
export function entrySlug(entry: AnyEntry): string {
  if (entry.data.slug) return entry.data.slug;
  return entry.id.replace(/\.(md|mdx)$/, '');
}
