/**
 * Resolve X Article media from the article's public status page.
 *
 * The X API v2 `GET /2/tweets/{id}` response exposes article media only as
 * opaque ids — `article.media_entities: ["3_2050456359536353280", ...]` and
 * `article.cover_media: "3_2050455934913413120"` — and never includes the
 * media objects in `includes`, so the actual `pbs.twimg.com` URLs cannot be
 * derived from the API alone (`pbs.twimg.com/media/<id>.jpg` 404s because the
 * CDN filename is the base64url-encoded media id, not the raw numeric id).
 *
 * The reliable public source is the **logged-out status page**:
 * `https://x.com/<handle>/status/<postId>` — its server-rendered payload
 * (`window.__INITIAL_DATA__` → `$tsr` stream, Relay/seroval records) carries:
 *
 *   - `__typename:"ApiMedia"` records, each immediately followed by an
 *     `ApiImage` record with `original_img_url:"https://pbs.twimg.com/media/<X>.jpg"`
 *     (the real CDN URL) plus width/height. Inline media records carry
 *     `media_id:"<numeric>"`; the cover's record omits it but its ApiImage
 *     record is the first one on the page (the article cover renders first).
 *   - The article DraftJS `content_state`: ordered `blocks[]` (text blocks +
 *     atomic `type:"atomic"` blocks) and `entity_map[]` (`type:"MEDIA"`
 *     entities whose `media_items[].media_id` is the numeric media id). This
 *     gives each inline image its exact position.
 *
 * This module implements that resolution: fetch the page, extract the
 * records, and return every image (cover + inline) with URL, CDN media id,
 * opaque id, dimensions, and the text block that precedes each inline image.
 *
 * Network: requires public internet access to x.com. No auth needed.
 */

export interface ArticleInlineMedia {
  /** Numeric CDN media id (e.g. `2050456359536353280`). */
  mediaId: string;
  /** Opaque article media id as returned by the X API (`3_<mediaId>`). */
  opaqueId: string;
  /** Direct CDN image URL. */
  url: string;
  /** Alt text if the article set one (usually null). */
  altText: string | null;
  width: number;
  height: number;
  /** Verbatim text of the article block that immediately precedes this image. */
  precedingText: string;
}

export interface ArticleMedia {
  cover?: {
    mediaId: string;
    opaqueId: string;
    url: string;
    altText: string | null;
    width: number;
    height: number;
  };
  inline: ArticleInlineMedia[];
}

/** ApiMedia records (inline carry `media_id`, cover does not). */
const API_MEDIA_RE =
  /__typename:"ApiMedia"(?:,media_id:"(\d+)")?,media_info:\$R\[(\d+)\]=/g;
/** Inline ApiImage record: `alt_text, original_img_url, width, height`. */
const API_IMAGE_RE =
  /__typename:"ApiImage",alt_text:([^,]*),original_img_url:"([^"]+)",original_img_width:(\d+),original_img_height:(\d+)/g;
/** Cover ApiImage record (different field order). */
const COVER_IMAGE_RE =
  /__typename:"ApiImage",original_img_height:(\d+),original_img_url:"([^"]+)",original_img_width:(\d+),alt_text:([^,]*)/g;

/** DraftJS blocks: text + type, in document order. */
const DRAFT_BLOCK_RE =
  /__typename:"DraftJsBlock",key:"[^"]*",text:"((?:[^"\\]|\\.)*)",type:"([^"]+)"/g;
/** Entity-range records (atomic blocks), in order → entity key. */
const ENTITY_RANGE_RE =
  /__typename:"DraftJsEntityRange",key:(\d+),length:1,offset:0\}/g;
/** entity_map entries: DraftJS key → entity record index (document order). */
const ENTITY_MAP_ORDER_RE =
  /__typename:"DraftJsEntityMap",key:"(\d+)",value:\$R\[\d+\]=\{__ref:"[^"]*:entity_map:\d+:value"\}/g;
/** Entity records in document order → their type. */
const ENTITY_TYPE_SEQ_RE = /__typename:"DraftJsEntity",type:"([A-Z]+)"/g;
/** MEDIA entity data records → media_items.media_id (document order). */
const MEDIA_ITEM_RE = /__typename:"ArticleMediaKey",media_id:"(\d+)"/g;

/**
 * Fetch a status page and resolve every image of its article.
 *
 * @param statusUrl e.g. `https://x.com/<handle>/status/<postId>`
 * @returns resolved article media, or `null` when the page has no article /
 *          the records could not be found (page layout changed / blocked).
 */
export async function resolveArticleMediaFromStatusPage(
  statusUrl: string,
): Promise<ArticleMedia | null> {
  const res = await fetch(statusUrl, {
    redirect: 'follow',
    headers: {
      // The logged-out SSR page is served to plain browsers; a normal UA
      // avoids bot-sniffing or empty-UA refusals.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`status page returned HTTP ${res.status}`);
  const html = await res.text();
  return parseArticleMediaFromPage(html);
}

/**
 * Parse an article's media out of a status-page HTML document (exported for
 * tests / offline use). Returns `null` when the page has no article media.
 */
export function parseArticleMediaFromPage(
  html: string,
): ArticleMedia | null {
  // ── 1. ApiMedia records + ApiImage records, paired by document order. ────
  // Document order: the cover's ApiMedia/ApiImage records come first (the
  // article header renders before the body), then the 6 inline records in the
  // same order as `article.media_entities`.
  interface ApiMediaRec {
    mediaId: string | null; // null for the cover
    opaqueId: string;
    index: number;
  }
  interface ApiImageRec {
    url: string;
    altText: string | null;
    width: number;
    height: number;
    index: number;
  }

  const apiMedia: ApiMediaRec[] = [];
  for (const m of html.matchAll(API_MEDIA_RE)) {
    apiMedia.push({
      mediaId: m[1] ?? null,
      opaqueId: m[1] ? `3_${m[1]}` : '',
      index: m.index ?? 0,
    });
  }
  const images: ApiImageRec[] = [];
  for (const m of html.matchAll(API_IMAGE_RE)) {
    const altRaw = m[1]!;
    images.push({
      altText: altRaw === 'null' ? null : altRaw.slice(1, -1),
      url: m[2]!,
      width: Number(m[3]),
      height: Number(m[4]),
      index: m.index ?? 0,
    });
  }
  for (const m of html.matchAll(COVER_IMAGE_RE)) {
    const altRaw = m[4]!;
    images.push({
      altText: altRaw === 'null' ? null : altRaw.slice(1, -1),
      url: m[2]!,
      width: Number(m[3]),
      height: Number(m[1]),
      index: m.index ?? 0,
    });
  }
  apiMedia.sort((a, b) => a.index - b.index);
  images.sort((a, b) => a.index - b.index);
  if (apiMedia.length !== images.length || apiMedia.length === 0) {
    return null;
  }

  const imageByMediaId = new Map<
    string,
    { url: string; altText: string | null; width: number; height: number }
  >();
  let cover: ArticleMedia['cover'] | undefined;
  for (let i = 0; i < apiMedia.length; i++) {
    const rec = apiMedia[i]!;
    const img = images[i]!;
    if (rec.mediaId) {
      imageByMediaId.set(rec.mediaId, {
        url: img.url,
        altText: img.altText,
        width: img.width,
        height: img.height,
      });
    } else {
      // Cover: no numeric media_id in its record. Derive it from the opaque
      // id suffix if the caller supplied one, else leave it — the URL is what
      // matters for download. (Position on the page identifies it as cover.)
      cover = {
        mediaId: '',
        opaqueId: rec.opaqueId,
        url: img.url,
        altText: img.altText,
        width: img.width,
        height: img.height,
      };
    }
  }

  // ── 2. DraftJS content: ordered blocks + entity_map + media keys. ────────
  const blocks: { text: string; type: string }[] = [];
  for (const m of html.matchAll(DRAFT_BLOCK_RE)) {
    blocks.push({ text: m[1]!, type: m[2]! });
  }

  const entityMapOrder: number[] = [];
  for (const m of html.matchAll(ENTITY_MAP_ORDER_RE)) {
    entityMapOrder.push(Number(m[1]!));
  }
  const entityTypeSeq: string[] = [];
  for (const m of html.matchAll(ENTITY_TYPE_SEQ_RE)) {
    entityTypeSeq.push(m[1]!);
  }
  const mediaItems: string[] = [];
  for (const m of html.matchAll(MEDIA_ITEM_RE)) {
    mediaItems.push(m[1]!);
  }

  // Entity record index → DraftJS entity key, then → media_id for MEDIA
  // entities (media_items are listed in entity-map order for MEDIA entities).
  let mediaItemIdx = 0;
  const mediaIdByEntityKey = new Map<number, string>();
  entityMapOrder.forEach((key, idx) => {
    if (entityTypeSeq[idx] === 'MEDIA') {
      const id = mediaItems[mediaItemIdx];
      if (id) mediaIdByEntityKey.set(key, id);
      mediaItemIdx++;
    }
  });

  // ── 3. Walk blocks in order; atomic blocks consume their entity. ────────
  const rangeKeys: number[] = [];
  for (const m of html.matchAll(ENTITY_RANGE_RE)) {
    rangeKeys.push(Number(m[1]!));
  }

  const inline: ArticleInlineMedia[] = [];
  let precedingText = '';
  let rangeIdx = 0;
  for (const block of blocks) {
    if (block.type === 'atomic') {
      const entityKey = rangeKeys[rangeIdx] ?? -1;
      rangeIdx++;
      const mediaId = mediaIdByEntityKey.get(entityKey);
      if (mediaId) {
        const img = imageByMediaId.get(mediaId);
        if (img) {
          inline.push({
            mediaId,
            opaqueId: `3_${mediaId}`,
            url: img.url,
            altText: img.altText,
            width: img.width,
            height: img.height,
            precedingText,
          });
        }
      }
    } else if (block.text.trim().length > 0) {
      precedingText = block.text;
    }
  }

  if (inline.length === 0) return null;

  return { cover, inline };
}
