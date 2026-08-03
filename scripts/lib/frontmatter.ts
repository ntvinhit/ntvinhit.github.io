/**
 * Minimal frontmatter helpers for the reference pipeline.
 *
 * Parsing stays deliberately conservative: we only need to read and rewrite
 * the frontmatter of reference entries, and we must never destroy a verbatim
 * body. We therefore parse with a small line-based YAML-subset parser rather
 * than pulling in a full YAML dependency.
 *
 * Supported: `key: value` scalars, inline arrays (`[a, b]`), and one level of
 * nested objects (the `author: { name, handle }` block).
 */

export interface Frontmatter {
  [key: string]: unknown;
}

const FM_DELIM = /^---\s*$/;

/** Split a markdown file into its frontmatter block (or null) and body. */
export function splitFrontmatter(
  raw: string,
): { fm: string | null; body: string } {
  const lines = raw.split('\n');
  if (lines.length === 0 || !FM_DELIM.test(lines[0]!)) {
    return { fm: null, body: raw };
  }
  const end = lines.findIndex((l, i) => i > 0 && FM_DELIM.test(l));
  if (end === -1) return { fm: null, body: raw };
  return {
    fm: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  };
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0);
  }
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value; // includes ISO dates — kept as strings, coerced by Zod
}

/** Parse the frontmatter block (already without the `---` delimiters). */
export function parseFrontmatterText(text: string): Frontmatter {
  const fm: Frontmatter = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const rawValue = (m[2] ?? '').trim();
    if (rawValue === '') {
      // Nested block — collect indented children (one level).
      const children: Record<string, unknown> = {};
      while (i < lines.length) {
        const child = lines[i]!;
        if (!/^\s+/.test(child) || !child.trim()) break;
        i++;
        const cm = child.match(/^\s+(\w+):\s*(.*)$/);
        if (!cm) continue;
        children[cm[1]!] = parseScalar(cm[2] ?? '');
      }
      fm[key] = children;
    } else {
      fm[key] = parseScalar(rawValue);
    }
  }
  return fm;
}

/** Extract the parsed frontmatter from a raw markdown file. */
export function extractFrontmatter(raw: string): Frontmatter {
  const { fm } = splitFrontmatter(raw);
  return fm === null ? {} : parseFrontmatterText(fm);
}

/** The markdown body, with the frontmatter block removed. */
export function stripFrontmatter(raw: string): string {
  return splitFrontmatter(raw).body;
}

/** Serialize a frontmatter object back into `key: value` lines (no delimiters). */
export function serializeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(
        `${key}: [${value.map((v) => JSON.stringify(String(v))).join(', ')}]`,
      );
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        lines.push(`  ${k}: ${JSON.stringify(String(v))}`);
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      // Booleans/numbers must stay unquoted or the Zod schema rejects them.
      lines.push(`${key}: ${String(value)}`);
    } else if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}/.test(value)
    ) {
      // ISO dates stay unquoted — the site convention writes them bare.
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  return lines.join('\n');
}
