/**
 * Inline-image insertion for X Article mirrors.
 *
 * The X article editor is DraftJS: each inline image is an atomic block that
 * sits between text blocks. `resolve-article-media` returns each inline image
 * with `precedingText` — the verbatim article text block that appears
 * immediately before it. We anchor on that text: find its occurrence in the
 * mirrored body and insert the image right after it.
 *
 * Anchoring keeps the verbatim text untouched (convention §3) and places the
 * image where the article shows it. When an anchor cannot be found (body was
 * reformatted), the image is appended after the LAST successfully anchored
 * image (or at the end of the body) — a documented fallback that never loses
 * an image. Images whose download failed are skipped here (their remote URL
 * stays recoverable via `images_original`).
 *
 * Shared by:
 * - `scripts/lib/reference-media.ts` (`processReferenceMedia`) — the pipeline
 *   used by `download-reference-media.ts` (--status-url) and by
 *   `add-reference.ts` (automatic media resolution).
 *
 * Idempotency: insertion is anchored on the same rendered image line
 * (`![alt](/references/<slug>/<file>) <!-- image original: <url> -->`), so a
 * re-run on an already-processed mirror finds each image already inserted and
 * does nothing — never duplicating images (see `findInsertedInlineImages`).
 */

import { withOriginalComment } from './reference-media';

/** One resolved inline image ready to be inserted (download succeeded). */
export interface InlineInsertion {
  /** Original remote URL (kept in the `<!-- image original: … -->` comment). */
  url: string;
  /** Alt text; falls back to `Image` when null. */
  altText: string | null;
  /** Verbatim article text block that immediately precedes this image. */
  precedingText: string;
}

/**
 * Scan the body for inline images that were previously inserted by
 * `insertInlineImages` (their rendered form carries the original URL in an
 * `<!-- image original: … -->` comment on the same line). This is what makes
 * re-runs idempotent: an image whose rendered form is already present is
 * skipped instead of being inserted a second time.
 */
export function findInsertedInlineImages(
  body: string,
): Set<string> {
  const found = new Set<string>();
  // Any markdown image line carrying the provenance comment — both the local
  // (`![...](/references/<slug>/<file>)`) and the failed-remote
  // (`![...](<remote-url>)`) forms are already-inserted markers.
  const re =
    /!\[[^\]]*\]\([^)]*\)\s*<!--\s*image original:\s*([^\s>]+)\s*-->/g;
  for (const m of body.matchAll(re)) {
    found.add(m[1]!);
  }
  return found;
}

/**
 * Insert X Article inline images into the body at their positions.
 *
 * Anchors on `precedingText` (the verbatim article text block that precedes
 * each image in the article) and inserts the rendered image right after it.
 * Images that are already present in the body (found by
 * `findInsertedInlineImages` — a re-run of an already-processed mirror) are
 * skipped so nothing is ever duplicated. Images whose anchor cannot be found
 * are appended at the end (in article order) so no resolved image is dropped.
 *
 * @returns the new body, or `null` when nothing was inserted (no inline media
 *          / all anchors missing / everything already inserted).
 */
export function insertInlineImages(
  body: string,
  opts: {
    slug: string;
    inline: InlineInsertion[];
    downloaded: Map<string, string>;
  },
): string | null {
  const alreadyInserted = findInsertedInlineImages(body);
  let out = body;
  let lastAnchorEnd = -1;
  let inserted = 0;
  let fallbackBefore: string[] = [];

  for (const item of opts.inline) {
    const localName = opts.downloaded.get(item.url);
    if (!localName) continue; // failed download — skip (URL kept in images_original)
    if (alreadyInserted.has(item.url)) continue; // already in the body — idempotent re-run
    const publicUrl = `/references/${opts.slug}/${localName}`;
    const rendered = withOriginalComment(
      `![${item.altText ?? 'Image'}](${publicUrl})`,
      item.url,
    );

    const anchor = item.precedingText?.trim();
    const anchorIndex = anchor
      ? out.indexOf(anchor, Math.max(0, lastAnchorEnd))
      : -1;
    if (anchor && anchorIndex >= 0) {
      const insertAt = anchorIndex + anchor.length;
      out =
        out.slice(0, insertAt) + `\n\n${rendered}` + out.slice(insertAt);
      lastAnchorEnd = insertAt + rendered.length;
      inserted++;
    } else {
      fallbackBefore.push(rendered);
    }
  }

  if (inserted === 0 && fallbackBefore.length === 0) return null;

  // Fallback: anchors that could not be matched are appended at the end (in
  // article order) so no resolved image is ever dropped.
  if (fallbackBefore.length > 0) {
    const tail = `\n\n${fallbackBefore.join('\n\n')}`;
    out = out.endsWith('\n') ? out + tail.trimStart() : out + tail;
  }
  return out;
}
