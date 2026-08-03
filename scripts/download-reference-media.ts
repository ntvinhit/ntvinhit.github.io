#!/usr/bin/env bun
/**
 * download-reference-media — process media for an existing reference mirror.
 *
 * Usage:
 *   bun scripts/download-reference-media.ts <file.md> [<slug>]
 *   bun scripts/download-reference-media.ts <slug>
 *   bun scripts/download-reference-media.ts <slug> --status-url <x-status-url>
 *
 * Resolves the target the same way the rest of the site does:
 * - `<file.md>`   → an existing markdown file (absolute or site-relative,
 *                   e.g. `src/content/references/my-article.md`).
 * - `<slug>`      → looks up `src/content/references/<slug>.md`.
 *
 * What it does (see docs/reference-convention.md §4):
 * 1. Scans the body for remote image URLs (plus any `--image <url>` extras
 *    from the X API media objects).
 * 2. With `--status-url <url>`: resolves the X Article's cover + inline
 *    images from the article's status page (the X API returns article media
 *    as opaque ids without URLs — see scripts/lib/resolve-article-media.ts)
 *    and adds them to the download set. Inline images are inserted into the
 *    body at their positions (anchored on the preceding article text).
 * 3. Downloads each image into `public/references/<slug>/` (X CDN URLs are
 *    normalized to `?format=jpg&name=large` unless already sized).
 * 4. Rewrites the body: successful images → `/references/<slug>/<file>`,
 *    failed ones keep their remote URL — both carry an
 *    `<!-- image original: <url> -->` comment.
 * 5. Sets `has_attachments` (true when ≥1 image was stored) and records the
 *    full original URL list in `images_original` in frontmatter.
 * 6. Prints a per-image report; exits 1 when any image failed to download.
 *
 * Never throws for a single image failure — failures are collected, reported,
 * and the fallback remote URL stays in the content.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { processReferenceMedia } from './lib/reference-media';

// Resolve `src/` from this file's location. Avoids import.meta.dir, which is
// Bun-specific and fails the Astro tsconfig's ImportMeta typing.
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const REFS_DIR = path.join(SRC_DIR, 'content', 'references');

function parseArgs(argv: string[]): {
  target: string;
  extraImages: string[];
  statusUrl: string | undefined;
  timeoutMs: number;
  noRewrite: boolean;
} {
  const extraImages: string[] = [];
  let statusUrl: string | undefined;
  let timeoutMs = 30_000;
  let noRewrite = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--image') {
      extraImages.push(argv[++i] ?? '');
    } else if (a === '--status-url') {
      statusUrl = argv[++i] ?? '';
    } else if (a === '--timeout') {
      timeoutMs = Number(argv[++i]) || 30_000;
    } else if (a === '--no-rewrite') {
      noRewrite = true;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    throw new Error(
      'usage: bun scripts/download-reference-media.ts <file.md | slug> ' +
        '[--image <url>]... [--status-url <x-status-url>] [--no-rewrite]',
    );
  }
  return { target: positional[0]!, extraImages, statusUrl, timeoutMs, noRewrite };
}

function resolveTargetFile(target: string): { file: string; slug: string } {
  if (target.endsWith('.md')) {
    const file = path.resolve(target);
    return { file, slug: path.basename(file, '.md') };
  }
  const file = path.join(REFS_DIR, `${target}.md`);
  return { file, slug: target };
}

async function main(): Promise<void> {
  const { target, extraImages, statusUrl, timeoutMs, noRewrite } = parseArgs(
    process.argv.slice(2),
  );
  const { file, slug } = resolveTargetFile(target);

  const { access } = await import('node:fs/promises');
  try {
    await access(file);
  } catch {
    console.error(`✗ reference file not found: ${file}`);
    process.exit(1);
  }

  console.log(`Downloading media for reference \`${slug}\` → ${file}`);
  if (statusUrl) console.log(`  resolving article media from ${statusUrl}`);
  const result = await processReferenceMedia({
    file,
    slug,
    extraImageUrls: extraImages,
    articleStatusUrl: statusUrl,
    timeoutMs,
    noRewrite,
  });

  for (const ok of result.ok) {
    console.log(`  ✓ ${ok.url}\n      → ${path.relative(process.cwd(), ok.dest)} (${ok.size} bytes)`);
  }
  for (const f of result.failed) {
    console.error(`  ✗ ${f.url}\n      → ${f.reason}`);
  }

  console.log(
    `\n${result.ok.length} downloaded, ${result.failed.length} failed. ` +
      `Body rewritten; original URLs kept in HTML comments.`,
  );

  if (result.failed.length > 0) {
    console.error(
      'Some images could not be downloaded — their remote URLs were kept in the content.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
