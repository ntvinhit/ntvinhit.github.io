/**
 * Convert an X Article's DraftJS content_state (from the status page's
 * server-rendered seroval/Relay payload, `window.__INITIAL_DATA__`) into
 * markdown — the REAL serialized structure, not a plain-text heuristic.
 *
 * X Articles are DraftJS documents. On the logged-out status page the
 * article's content_state serializes as ordered records:
 *
 *   - Blocks:        `__typename:"DraftJsBlock",key:"…",text:"…",type:"…"`
 *                    with `entity_ranges` and `inline_style_ranges` records
 *                    carrying the same `content_state:blocks:<n>` id.
 *   - entity_ranges: `__typename:"DraftJsEntityRange",key:<k>,length:1,offset:0`
 *                    (one per atomic block, in block order).
 *   - entity_map:    `__typename:"DraftJsEntityMap",key:"<k>",value:$R[…]={
 *                    __ref:"…:content_state:entity_map:<i>:value"}` — order
 *                    index `i` is the entity-record index.
 *   - Entities:      `__typename:"DraftJsEntity",type:"MEDIA|DIVIDER|MARKDOWN"`
 *                    in entity_map order. Their `data` record follows with:
 *                    MEDIA    → media_items → `ArticleMediaKey`,media_id:"…"
 *                    DIVIDER  → (all null)
 *                    MARKDOWN → `markdown:"<fenced code block>"` (escaped)
 *   - Mentions:      `__typename:"DraftJsBlockMention",from_index,text,to_index`
 *                    serialized with `__id:"…:content_state:blocks:<n>:data:
 *                    mentions:<m>"` — the owning block number is IN the id.
 *   - Inline styles: `__typename:"DraftJsInlineStyleRange",length,offset,style`
 *                    with `__id:"…:content_state:blocks:<n>:inline_style_ranges:
 *                    <i>"` — the owning block number is in the id too.
 *
 * Everything is associated by those `blocks:<n>` ids (and the entity_map order
 * index), never by guessing from text.
 *
 * Block-type → markdown mapping:
 *   header-one            → `## <text>`
 *   unstyled              → paragraph (blank-line separated)
 *   unordered-list-item   → `- <text>` (consecutive items = one list)
 *   ordered-list-item     → `1. <text>` (consecutive items = numbered list)
 *   atomic + MEDIA        → `![Image](<local>)` when `mediaByEntityKey`
 *                           resolves it, else a blank placeholder line
 *   atomic + DIVIDER      → `---`
 *   atomic + MARKDOWN     → the entity's fenced code block (verbatim from
 *                           `entityData.markdown`; the block text is a single
 *                           space and is ignored)
 *   atomic + unknown      → `---` (visual separator, keeps block position)
 *
 * Inline pass per text block (exactly what the convention specifies):
 *   - mention spans (from DraftJsBlockMention) → `[@handle](https://x.com/handle)`
 *   - bare `https?://…` URLs                   → `[url](url)` (autolink)
 *
 * Inline *style* ranges are extracted into the parse result but deliberately
 * NOT rendered: some X articles store `Bold` spans in `inline_style_ranges`
 * (the probe article carries 35 of them), but the reference convention renders
 * mirrors without bold — the inline pass emits only mentions and autolinks, so
 * a mirror never "invents" formatting. The ranges stay available in
 * `DraftJsParseResult.stylesByBlock` for tooling that wants them.
 *
 * Escaped characters in seroval strings (`\"`, `\n`, `\uXXXX`, `\\`, `\t`)
 * are decoded as JS string escapes.
 */

import { parseArticleMediaFromPage } from './resolve-article-media';

// ── Seroval string decoding ──────────────────────────────────────────────────

const SEROVAL_ESCAPE_RE = /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g;

/** Decode a seroval/JSON string literal (without surrounding quotes). */
function decodeSerovalString(raw: string): string {
  return raw.replace(SEROVAL_ESCAPE_RE, (_m, esc: string) => {
    switch (esc[0]) {
      case 'u':
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      case 'x':
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '0':
        return '\0';
      default:
        return esc;
    }
  });
}

// ── Seroval/Relay regexes (mirror of resolve-article-media.ts) ───────────────

/** DraftJS blocks in document order: captured text + type. */
const DRAFT_BLOCK_RE =
  /__typename:"DraftJsBlock",key:"[^"]*",text:"((?:[^"\\]|\\.)*)",type:"([^"]+)"/g;
/** Block → entity range: the `blocks:<n>:entity_ranges:0` record. */
const ENTITY_RANGE_BLOCK_RE =
  /"client:[^"]*:content_state:blocks:(\d+):entity_ranges:0":\$R\[\d+\]=\{__id:"[^"]*",__typename:"DraftJsEntityRange",key:(\d+),length:\d+,offset:\d+\}/g;
/** entity_map entries in document order: DraftJS key → entity record index. */
const ENTITY_MAP_ORDER_RE =
  /__typename:"DraftJsEntityMap",key:"(\d+)",value:\$R\[\d+\]=\{__ref:"[^"]*:content_state:entity_map:(\d+):value"\}/g;
/** Entity records in entity_map order → their type. */
const ENTITY_TYPE_SEQ_RE = /__typename:"DraftJsEntity",type:"([A-Z]+)"/g;
/** MEDIA entity data → media_items → ArticleMediaKey.media_id (document order). */
const MEDIA_ITEM_RE = /__typename:"ArticleMediaKey",media_id:"(\d+)"/g;
/** MARKDOWN entity data records → their fenced code content (escaped). */
const MARKDOWN_ENTITY_DATA_RE =
  /__typename:"DraftJsEntityData",caption:null,markdown:"((?:[^"\\]|\\.)*)"/g;
/** Mention records: the `blocks:<n>:data:mentions:<m>` id carries the block. */
const MENTION_BLOCK_RE =
  /"client:[^"]*:content_state:blocks:(\d+):data:mentions:\d+":\$R\[\d+\]=\{__id:"[^"]*",__typename:"DraftJsBlockMention",from_index:(\d+),text:"([^"]*)",to_index:(\d+)\}/g;
/** Inline style records: the `blocks:<n>:inline_style_ranges:<i>` id carries the block. */
const STYLE_BLOCK_RE =
  /"client:[^"]*:content_state:blocks:(\d+):inline_style_ranges:\d+":\$R\[\d+\]=\{__id:"[^"]*",__typename:"DraftJsInlineStyleRange",length:(\d+),offset:(\d+),style:"([^"]+)"\}/g;

// ── Shared types ─────────────────────────────────────────────────────────────

/** The raw structure the parser needs to make decisions. */
export interface DraftJsParseResult {
  /** Blocks in document order (text already unescaped). */
  blocks: {
    /** Block index in the serialized `blocks[]` array (0-based). */
    index: number;
    text: string;
    type: string;
  }[];
  /** DraftJS entity key → entity record index (entity_map order). */
  entityKeyToRecord: Map<number, number>;
  /** Entity record index → entity type, in entity_map order. */
  entityTypes: string[];
  /** Entity record index → media_id (only for MEDIA entities). */
  mediaIdByEntityRecord: Map<number, string>;
  /** Entity record index → markdown (only for MARKDOWN entities). */
  markdownByEntityRecord: Map<number, string>;
  /** Block index → entity key of its atomic range. */
  atomicEntityKeyByBlock: Map<number, number>;
  /** Block index → mentions (from_index, to_index, text) of that block. */
  mentionsByBlock: Map<number, { from: number; to: number; text: string }[]>;
  /** Block index → inline style ranges (offset, length, style) of that block. */
  stylesByBlock: Map<number, { offset: number; length: number; style: string }[]>;
}

/**
 * Parse the DraftJS content_state out of a status-page HTML document.
 * Returns `null` when the page carries no DraftJS blocks (not an article /
 * layout changed / blocked).
 */
export function parseDraftJsContentState(html: string): DraftJsParseResult | null {
  // ── Blocks, in order ───────────────────────────────────────────────────────
  const blocks: DraftJsParseResult['blocks'] = [];
  for (const m of html.matchAll(DRAFT_BLOCK_RE)) {
    blocks.push({
      index: blocks.length,
      text: decodeSerovalString(m[1]!),
      type: m[2]!,
    });
  }
  if (blocks.length === 0) return null;

  // ── entity_map → entity types → media ids / markdown, in map order ────────
  const entityKeyToRecord = new Map<number, number>();
  for (const m of html.matchAll(ENTITY_MAP_ORDER_RE)) {
    entityKeyToRecord.set(Number(m[1]!), Number(m[2]!));
  }

  const entityTypes: string[] = [];
  for (const m of html.matchAll(ENTITY_TYPE_SEQ_RE)) {
    entityTypes.push(m[1]!);
  }

  // ArticleMediaKey records are emitted in entity_map order for MEDIA entities.
  const mediaIdByEntityRecord = new Map<number, string>();
  {
    let mediaIdx = 0;
    const mediaKeys: string[] = [];
    for (const m of html.matchAll(MEDIA_ITEM_RE)) mediaKeys.push(m[1]!);
    entityTypes.forEach((type, recordIdx) => {
      if (type === 'MEDIA') {
        const id = mediaKeys[mediaIdx];
        if (id) mediaIdByEntityRecord.set(recordIdx, id);
        mediaIdx++;
      }
    });
  }

  // MARKDOWN entity data records are emitted in entity_map order.
  const markdownByEntityRecord = new Map<number, string>();
  {
    let markdownIdx = 0;
    const markdowns: string[] = [];
    for (const m of html.matchAll(MARKDOWN_ENTITY_DATA_RE)) {
      markdowns.push(decodeSerovalString(m[1]!));
    }
    entityTypes.forEach((type, recordIdx) => {
      if (type === 'MARKDOWN') {
        const md = markdowns[markdownIdx];
        if (md) markdownByEntityRecord.set(recordIdx, md);
        markdownIdx++;
      }
    });
  }

  // ── Atomic blocks → entity key (via their entity_ranges record) ───────────
  const atomicEntityKeyByBlock = new Map<number, number>();
  for (const m of html.matchAll(ENTITY_RANGE_BLOCK_RE)) {
    atomicEntityKeyByBlock.set(Number(m[1]!), Number(m[2]!));
  }

  // ── Mentions and inline styles, keyed by their owning block index ─────────
  const mentionsByBlock = new Map<
    number,
    { from: number; to: number; text: string }[]
  >();
  for (const m of html.matchAll(MENTION_BLOCK_RE)) {
    const block = Number(m[1]!);
    const list = mentionsByBlock.get(block) ?? [];
    list.push({
      from: Number(m[2]!),
      text: decodeSerovalString(m[3]!),
      to: Number(m[4]!),
    });
    mentionsByBlock.set(block, list);
  }

  const stylesByBlock = new Map<
    number,
    { offset: number; length: number; style: string }[]
  >();
  for (const m of html.matchAll(STYLE_BLOCK_RE)) {
    const block = Number(m[1]!);
    const list = stylesByBlock.get(block) ?? [];
    list.push({
      length: Number(m[2]!),
      offset: Number(m[3]!),
      style: m[4]!,
    });
    stylesByBlock.set(block, list);
  }

  return {
    blocks,
    entityKeyToRecord,
    entityTypes,
    mediaIdByEntityRecord,
    markdownByEntityRecord,
    atomicEntityKeyByBlock,
    mentionsByBlock,
    stylesByBlock,
  };
}

// ── Inline rendering ─────────────────────────────────────────────────────────

/** Escape a markdown link destination when it needs protection. */
function linkTarget(url: string): string {
  const trimmed = url.trim();
  // Angle brackets protect destinations containing parens/spaces; a plain URL
  // with no such characters stays bare so the rendered `href` is exactly it.
  if (/[()\s<>]/.test(trimmed)) {
    return `<${trimmed.replace(/ /g, '%20')}>`;
  }
  return trimmed;
}

/**
 * Build the inline pass over one text block.
 *
 * Only mention spans and bare URLs are rendered (see the module doc — inline
 * style ranges are intentionally not rendered). Runs are emitted in document
 * order; overlapping runs never occur for mentions (a mention is one span).
 */
function inlineText(
  text: string,
  opts: {
    mentions: { from: number; to: number; text: string }[];
  },
): string {
  const mentions = opts.mentions
    .map((m) => ({
      start: Math.max(0, Math.min(m.from, text.length)),
      end: Math.max(0, Math.min(m.to, text.length)),
    }))
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (mentions.length === 0) return autolinkText(text);

  let out = '';
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) {
      out += autolinkText(text.slice(cursor, mention.start));
    }
    const span = text.slice(mention.start, mention.end);
    const handle = span.startsWith('@') ? span.slice(1) : span;
    out += `[@${handle}](${linkTarget(`https://x.com/${handle}`)})`;
    cursor = mention.end;
  }
  if (cursor < text.length) out += autolinkText(text.slice(cursor));
  return out;
}

const URL_RE = /https?:\/\/[^\s<>")\]]+/g;

/** Autolink bare `https?://…` URLs → `[url](url)`. */
function autolinkText(text: string): string {
  return text.replace(URL_RE, (url) => {
    const target = url.endsWith('.') ? url.slice(0, -1) : url;
    return `[${target}](${linkTarget(target)})`;
  });
}

// ── Markdown assembly ────────────────────────────────────────────────────────

/** A resolved MEDIA entity: local path + the original remote URL (provenance). */
export interface ResolvedMediaEntity {
  /** Local path served by the site, e.g. `/references/<slug>/<file>`. */
  path: string;
  /** Original CDN URL (kept in the `<!-- image original: … -->` comment). */
  originalUrl?: string;
}

export interface DraftJsToMarkdownOptions {
  /**
   * DraftJS entity key → local image reference for MEDIA entities (see
   * `resolveMediaByEntityKey`). When an atomic MEDIA block's key is missing
   * from this map the image renders as an empty line — a placeholder the
   * media pipeline can later fill via `inline-images.ts` (anchored on the
   * preceding text block).
   */
  mediaByEntityKey?: Map<number, string | ResolvedMediaEntity>;
}

/**
 * Render a parsed DraftJS content_state as markdown. Block types map as
 * documented at the top of this file. Consecutive list items of the same
 * kind are grouped into one list (no blank lines between them); everything
 * else is blank-line separated.
 */
export function renderDraftJsMarkdown(
  parsed: DraftJsParseResult,
  options: DraftJsToMarkdownOptions = {},
): string {
  const mediaByEntityKey = options.mediaByEntityKey ?? new Map<number, string>();
  const out: string[] = [];
  let pendingUl: string[] = [];
  let pendingOl: string[] = [];
  let olCounter = 0;

  const flushLists = () => {
    if (pendingUl.length > 0) {
      out.push(pendingUl.join('\n'));
      pendingUl = [];
    }
    if (pendingOl.length > 0) {
      out.push(pendingOl.join('\n'));
      pendingOl = [];
    }
    olCounter = 0;
  };

  const blockHasInline = (index: number): boolean =>
    (parsed.mentionsByBlock.get(index)?.length ?? 0) > 0;

  const renderTextBlock = (index: number, text: string): string => {
    if (!blockHasInline(index)) return autolinkText(text);
    return inlineText(text, {
      mentions: parsed.mentionsByBlock.get(index) ?? [],
    });
  };

  const renderMediaRef = (entityKey: number): string => {
    const resolved = mediaByEntityKey.get(entityKey);
    if (resolved === undefined) return '';
    if (typeof resolved === 'string') return `![Image](${resolved})`;
    const base = `![Image](${resolved.path})`;
    return resolved.originalUrl
      ? `${base} <!-- image original: ${resolved.originalUrl} -->`
      : base;
  };

  for (const block of parsed.blocks) {
    const { index, text, type } = block;

    if (type === 'atomic') {
      flushLists();
      const entityKey = parsed.atomicEntityKeyByBlock.get(index);
      let rendered: string | null = null;
      if (entityKey !== undefined) {
        const recordIdx = parsed.entityKeyToRecord.get(entityKey);
        const entityType =
          recordIdx !== undefined ? parsed.entityTypes[recordIdx] : undefined;
        if (entityType === 'MEDIA') {
          rendered = renderMediaRef(entityKey);
        } else if (entityType === 'MARKDOWN') {
          const md =
            recordIdx !== undefined
              ? parsed.markdownByEntityRecord.get(recordIdx)
              : undefined;
          // The entity data holds the article's fenced code block verbatim.
          rendered = md && md.trim().length > 0 ? md : '---';
        } else if (entityType === 'DIVIDER') {
          rendered = '---';
        } else {
          // Unknown entity — keep the position with a visual separator.
          rendered = '---';
        }
      } else {
        // Atomic block with no entity range record — keep its position.
        rendered = '';
      }
      out.push(rendered);
      continue;
    }

    if (type === 'unordered-list-item') {
      pendingUl.push(`- ${renderTextBlock(index, text)}`);
      continue;
    }
    if (type === 'ordered-list-item') {
      olCounter++;
      pendingOl.push(`${olCounter}. ${renderTextBlock(index, text)}`);
      continue;
    }

    // Non-list text blocks flush any pending lists.
    flushLists();

    // Any DraftJS header block (header-one/header-two/...) becomes a `##`
    // section heading. X articles never nest below the page title (h1), so a
    // single heading level is correct regardless of the source level.
    if (type.startsWith('header-')) {
      out.push(`## ${renderTextBlock(index, text)}`);
    } else if (type === 'unstyled') {
      const rendered = renderTextBlock(index, text);
      if (rendered.trim().length === 0) continue; // empty paragraph → nothing
      out.push(rendered);
    } else {
      // Unknown block type — render as a plain paragraph.
      out.push(renderTextBlock(index, text));
    }
  }
  flushLists();

  // Blank-line separate everything.
  return out.join('\n\n');
}

/**
 * Convert a status-page HTML document's DraftJS content_state to markdown.
 * Returns `null` when the page has no DraftJS blocks.
 */
export function draftjsBlocksToMarkdown(
  html: string,
  options: DraftJsToMarkdownOptions = {},
): string | null {
  const parsed = parseDraftJsContentState(html);
  if (!parsed) return null;
  return renderDraftJsMarkdown(parsed, options);
}

/**
 * Media resolver for the parser: map DraftJS entity key → LOCAL image
 * reference by pairing the content_state MEDIA ids with the page's
 * ApiMedia → ApiImage records (the same pairing resolve-article-media.ts
 * performs — this reuses its parser). Missing URLs simply stay unmapped; the
 * parser renders a placeholder line for those images.
 */
export function resolveMediaByEntityKey(
  html: string,
  slug: string,
): Map<number, string | ResolvedMediaEntity> {
  const map = new Map<number, string | ResolvedMediaEntity>();
  const media = parseArticleMediaFromPage(html);
  if (!media) return map;

  const urlByMediaId = new Map<string, string>();
  for (const img of media.inline) urlByMediaId.set(img.mediaId, img.url);

  const parsed = parseDraftJsContentState(html);
  if (!parsed) return map;
  parsed.mediaIdByEntityRecord.forEach((mediaId, recordIdx) => {
    const url = urlByMediaId.get(mediaId);
    if (!url) return;
    // Find the entity key that maps to this record index.
    for (const [key, rec] of parsed.entityKeyToRecord) {
      if (rec === recordIdx) {
        const file = url.split('/').pop() ?? '';
        if (file) {
          map.set(key, {
            path: `/references/${slug}/${file}`,
            originalUrl: url,
          });
        }
        break;
      }
    }
  });
  return map;
}
