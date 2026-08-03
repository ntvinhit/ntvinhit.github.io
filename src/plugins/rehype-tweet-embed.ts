/**
 * Rehype plugin — render the `<figure data-tweet-id="…">` placeholders the
 * DraftJS converter emits (scripts/lib/draftjs-to-markdown.ts, `TWEET`
 * entities) as live X widget iframes.
 *
 * The X widget (`https://platform.twitter.com/embed/Tweet.html?id=<id>`) is the
 * same embed X renders on its own article pages — interactive, with the full
 * post (text, media, metrics), and needs no API key. The figure also carries a
 * "View on X" link as a fallback for no-JS / blocked-network clients.
 *
 * Pipeline ordering: @astrojs/markdown-remark runs the configured rehypePlugins
 * BEFORE rehypeRaw, so at plugin time the placeholder is still an unparsed
 * `raw` node (a string), not an element — it only becomes an element after
 * rehypeRaw runs later in the pipeline. The plugin therefore rewrites the raw
 * string in place to the full embed markup (which rehypeRaw then parses), and
 * keeps a defensive branch that transforms an already-parsed element.
 */

import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';

/** A placeholder raw-HTML node exactly matching `<figure data-tweet-id="…">`. */
const FIGURE_RAW_RE = /^<figure\s+data-tweet-id="(\d+)"\s*><\/figure>\s*$/;

/** The live embed markup as an HTML string (parsed by rehypeRaw afterwards). */
function buildEmbedHtml(tweetId: string): string {
  const src = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}`;
  const url = `https://x.com/i/status/${tweetId}`;
  return (
    `<figure class="tweet-embed my-6">` +
    `<iframe src="${src}" title="Embedded tweet" loading="lazy" ` +
    `class="h-auto min-h-[200px] w-full overflow-hidden rounded-xl border ` +
    `border-line bg-paper dark:border-line-dark dark:bg-paper-dark" ` +
    `frameborder="0" scrolling="no" allowtransparency="true"></iframe>` +
    `<figcaption class="mt-2 text-sm">` +
    `<a href="${url}" class="no-underline hover:underline">View on X ↗</a>` +
    `</figcaption></figure>`
  );
}

/** The same embed as HAST nodes (for the already-parsed element path). */
function buildEmbedNodes(tweetId: string): Element[] {
  const src = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}`;
  const url = `https://x.com/i/status/${tweetId}`;
  return [
    {
      type: 'element',
      tagName: 'iframe',
      properties: {
        src,
        title: 'Embedded tweet',
        loading: 'lazy',
        className: [
          'h-auto',
          'min-h-[200px]',
          'w-full',
          'overflow-hidden',
          'rounded-xl',
          'border',
          'border-line',
          'bg-paper',
          'dark:border-line-dark',
          'dark:bg-paper-dark',
        ],
        frameborder: '0',
        scrolling: 'no',
        allowtransparency: 'true',
      },
      children: [],
    },
    {
      type: 'element',
      tagName: 'figcaption',
      properties: { className: ['mt-2', 'text-sm'] },
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: url,
            className: ['no-underline', 'hover:underline'],
          },
          children: [{ type: 'text', value: 'View on X ↗' }],
        },
      ],
    },
  ];
}

/** Turn every `<figure data-tweet-id>` into the live X widget embed. */
export function rehypeTweetEmbed() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type === 'raw') {
        // Pre-rehypeRaw: the placeholder is still an HTML string. Swap it for
        // the full embed markup, which rehypeRaw parses into elements next.
        const m = FIGURE_RAW_RE.exec(node.value);
        if (m) node.value = buildEmbedHtml(m[1]);
        return;
      }
      if (node.type === 'element') {
        // Defensive: if the placeholder was already parsed into an element,
        // transform the figure in place.
        if (node.tagName !== 'figure') return;
        const id = node.properties?.dataTweetId;
        if (typeof id !== 'string' || !/^\d+$/.test(id)) return;
        node.properties = { className: ['tweet-embed', 'my-6'] };
        node.children = buildEmbedNodes(id);
      }
    });
  };
}
