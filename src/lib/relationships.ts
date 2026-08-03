import type { CollectionEntry } from 'astro:content';
import { entrySlug } from './slug';
import { postSlug } from './posts';

export type PostEntry = CollectionEntry<'posts'>;
export type ReferenceEntry = CollectionEntry<'references'>;

/**
 * Bidirectional linking between posts and reference mirrors.
 *
 * Forward direction (post -> reference): a post cites reference slugs via its
 * `based_on` and/or `references` frontmatter arrays; the post page renders a
 * "References" section linking to each cited reference page.
 *
 * Reverse direction (reference -> post): the reference page renders a
 * "Cited in" section listing the posts that cite it. Only PUBLIC posts
 * (non-draft, non-private) are included — a private or draft post never leaks
 * into a public listing.
 *
 * Missing/deleted targets are handled gracefully: the broken slug is skipped
 * with a build-time warning (console.warn) — the broken link is never
 * rendered and the build never crashes.
 *
 * See docs/posts-convention.md and docs/reference-convention.md.
 */

/** Reference slugs a post entry cites: `based_on` + `references`, deduped, order preserved. */
export function citedReferenceSlugs(post: PostEntry): string[] {
  return [...new Set([...post.data.based_on, ...post.data.references])];
}

/** True when a post entry cites at least one reference. */
export function citesReferences(post: PostEntry): boolean {
  return citedReferenceSlugs(post).length > 0;
}

/** Public-list filter for posts (same rule the listings use: hidden entries never surface). */
export function isPublicPost(post: PostEntry): boolean {
  return !post.data.draft && !post.data.private;
}

/** Public-list filter for reference entries. */
export function isPublicReference(reference: ReferenceEntry): boolean {
  return !reference.data.draft && !reference.data.private;
}

/**
 * Resolve a reference slug to its entry, using `entrySlug` semantics
 * (frontmatter `slug` first, else the file name without extension).
 * Returns `undefined` when the target does not exist (deleted/renamed).
 */
export function findReference(
  references: ReferenceEntry[],
  slug: string
): ReferenceEntry | undefined {
  return references.find((reference) => entrySlug(reference) === slug);
}

/**
 * Resolve every reference a post cites to its entry, in citation order.
 * Missing/deleted targets are logged as a build-time warning and skipped —
 * the broken link is never rendered and the build never crashes.
 */
export function resolvePostReferences(
  post: PostEntry,
  references: ReferenceEntry[]
): ReferenceEntry[] {
  const resolved: ReferenceEntry[] = [];
  for (const slug of citedReferenceSlugs(post)) {
    const reference = findReference(references, slug);
    if (reference) {
      resolved.push(reference);
    } else {
      console.warn(
        `[relationships] ${post.id}: cited reference "${slug}" not found — skipping broken link.`
      );
    }
  }
  return resolved;
}

/** One post row in a reference page's "Cited in" section. */
export interface CitingPost {
  /** Canonical, language-neutral post slug (the URL slug). */
  slug: string;
  /** Display entry — English variant preferred, any variant as fallback. */
  entry: PostEntry;
  /** True when both language variants of the post exist (EN · VI badge). */
  bilingual: boolean;
}

/**
 * Build the reverse map: reference slug -> posts that cite it.
 *
 * Only posts passing `filter` are included (default: public, so private and
 * draft posts never leak into a reference page's "Cited in" listing).
 * Language variants of the same post are collapsed into one row keyed by the
 * canonical slug; a post counts as citing a reference when ANY of its
 * variants cites it, and the English variant is preferred for display.
 */
export function postsCitingReferences(
  posts: PostEntry[],
  filter: (post: PostEntry) => boolean = isPublicPost
): Map<string, CitingPost[]> {
  // Group variants of the same post by canonical slug.
  const groups = new Map<string, PostEntry[]>();
  for (const post of posts) {
    if (!filter(post)) continue;
    const key = postSlug(post);
    const list = groups.get(key) ?? [];
    list.push(post);
    groups.set(key, list);
  }

  const map = new Map<string, CitingPost[]>();
  for (const [slug, variants] of groups) {
    const citedSet = new Set<string>();
    for (const variant of variants) {
      for (const refSlug of citedReferenceSlugs(variant)) {
        citedSet.add(refSlug);
      }
    }
    if (citedSet.size === 0) continue;

    const preferred = variants.find((v) => v.data.lang === 'en') ?? variants[0];
    const citingPost: CitingPost = {
      slug,
      entry: preferred,
      bilingual:
        variants.some((v) => v.data.lang === 'en') &&
        variants.some((v) => v.data.lang === 'vi'),
    };
    for (const refSlug of citedSet) {
      const list = map.get(refSlug) ?? [];
      list.push(citingPost);
      map.set(refSlug, list);
    }
  }
  return map;
}
