# Posts — Bilingual Convention

This document defines how **posts** (the user's own writing) are authored in
this site, including the bilingual mechanism. It is the single source of truth
for the **posts** content collection — follow it whenever a new post (or a
translation) is added.

Companion doc: [`reference-convention.md`](reference-convention.md) covers the
**references** collection (mirrored X articles).

---

## 1. Core idea: one post, up to two language variants

A post is **one canonical identity** with up to two language variants:

- **English (`en`) is the default** — every post should have an English
  version.
- **Vietnamese (`vi`) is an alternate version of the SAME post**, never a
  separate post.

The two variants are stored as **two content entries** that share a
language-neutral **canonical slug**, and they render under **the same URL**:

| Variant      | File in `src/content/posts/`          | URL                              |
| ------------ | ------------------------------------- | -------------------------------- |
| English (default) | `<slug>.md`                      | `/posts/<slug>/`                 |
| Vietnamese   | `<slug>.vi.md`                        | `/posts/<slug>/vi/`              |

A post that only exists in one language is perfectly fine — it simply gets a
single entry and no language switcher.

---

## 2. File naming and the canonical slug

- English variant: `src/content/posts/<slug>.md`
- Vietnamese variant: `src/content/posts/<slug>.vi.md` (`.en.md` also works
  for an English variant if you ever want it explicit)

`<slug>` is the **canonical slug**: language-neutral, derived from the English
title (lowercase, spaces → hyphens, strip punctuation).

**The canonical slug is derived from the file name**, with the `.vi` / `.en`
marker stripped (`my-note.vi.md` → `my-note`). **Do NOT set `slug` in the
frontmatter of posts** — Astro treats `slug` as the entry id, so if both
variants set the same slug they collide and one silently overwrites the other.
Keep the frontmatter `slug` field unset (or set it identically in a way that
is unique per file — simplest is to omit it entirely).

The canonical slug is what appears in the URL — it is the stable identity of
the post. Changing it later should be treated as a rename.

---

## 3. Frontmatter schema

All fields are validated by the Zod schema in `src/content.config.ts`
(collection `posts`). Fields common to both collections: `title`, `slug`
(optional), `date`, `lang` (`'en' | 'vi'`, default `'en'`), `private`,
`draft`.

| Field            | Type      | Required | Default | Meaning                                                                |
| ---------------- | --------- | -------- | ------- | ---------------------------------------------------------------------- |
| `title`          | string    | yes      | —       | Title **in the variant's own language**                                |
| `slug`           | string    | no       | file name | **Do NOT set for posts** — Astro uses it as the entry id; variants collide if both set the same value. The canonical slug comes from the file name (§2). |
| `date`           | date      | yes      | —       | Publication date (use the same date in both variants)                  |
| `lang`           | `'en'\|'vi'` | yes for variants | `'en'` | Language of THIS variant's content                             |
| `private`        | boolean   | no       | `false` | Hide from public listings; still built and kept in repo                |
| `draft`          | boolean   | no       | `false` | Exclude from the build output entirely                                 |
| `description`    | string    | no       | `''`    | Short summary in the variant's language, shown in listings             |
| `tags`           | string[]  | no       | `[]`    | Free-form tags                                                         |
| `translation_of` | string    | no       | —       | **Canonical slug of the sibling-language variant** (§4)                |
| `based_on`       | string[]  | no       | `[]`    | Reference slugs this post is based on (bidirectional linking, §7)      |
| `references`     | string[]  | no       | `[]`    | Reference slugs cited by this post (bidirectional linking, §7)         |

### Example — a bilingual post

`src/content/posts/my-note.md`:

```yaml
---
title: "My note"
date: 2026-04-01
lang: "en"
private: false
draft: false
description: "A short English summary."
tags: ["note"]
translation_of: "my-note"
based_on: []
references: []
---
```

`src/content/posts/my-note.vi.md`:

```yaml
---
title: "Ghi chú của tôi"
date: 2026-04-01
lang: "vi"
private: false
draft: false
description: "Tóm tắt ngắn bằng tiếng Việt."
tags: ["note"]
translation_of: "my-note"  # canonical slug, derived from the file name
based_on: []
references: []
---
```

> Note: no `slug` field in either file — the canonical slug `my-note` comes
> from the file names (§2).

---

## 4. `translation_of`

- A string holding the **canonical slug** of the sibling-language variant.
  Because both variants share the same canonical slug, both files write the
  same value (e.g. `translation_of: "my-note"`).
- It is **informational + consistency-checked**: the site pairs variants by
  matching canonical slugs, and warns at build time if `translation_of` does
  not match the canonical slug or has no sibling. Omit it entirely for a
  standalone post.
- Both variants are discovered automatically even if `translation_of` were
  wrong or missing — matching canonical slugs is authoritative. Keep
  `translation_of` accurate anyway so the warning stays quiet and the intent
  is explicit.

---

## 5. URL scheme and the language switcher

- **Canonical URL:** `/posts/<slug>/` renders the **English** variant by
  default (English is the default language).
- **Vietnamese URL:** `/posts/<slug>/vi/` renders the Vietnamese variant.
- If only one language exists, there is exactly one page (`/posts/<slug>/`)
  and **no switcher** is rendered.
- If both variants exist, `src/components/LanguageSwitcher.astro` renders an
  **EN | VI** toggle at the top of both pages, linking to the other variant's
  URL. The current language is highlighted; the other is a link.

Both URLs are statically generated by `src/pages/posts/[...slug].astro`
(`getStaticPaths` emits `{ slug }` for the English variant and `{ slug: 'vi' }`
path segments for Vietnamese variants), so no runtime logic is involved.

Listing pages (`/posts/`, home page) list each post **once**, deduped by
canonical slug, showing the English title by default; when both variants exist
a small **EN · VI** badge marks the post as bilingual.

---

## 6. `private` / `draft` behavior

- `private: true` hides the entry from all public listings; the page is still
  built and reachable at its URL.
- `draft: true` excludes the entry from the build entirely. Apply it to each
  variant independently (e.g. draft only the translation while it is in
  progress — the English page then shows without a switcher).
- Keep the `private`/`draft` values **consistent across variants** unless you
  deliberately want a half-published pair.

---

## 7. Bidirectional linking with references (`based_on` / `references`)

A post can cite reference mirrors (the **references** collection) in two
frontmatter arrays:

- **`based_on`** — reference slugs the post is **based on** (the mirror was a
  primary source for this post).
- **`references`** — reference slugs the post **cites** (mentioned / linked as
  further reading).

Both hold **reference slugs** — the public URL slug resolved with the same
semantics as `src/lib/slug.ts`: the reference's frontmatter `slug` field, or
its file name without extension when unset (see `docs/reference-convention.md`
§2). A single reference may appear in either array, but keep each slug in the
array where it belongs; the arrays are merged and deduped when rendered.

The linking is **bidirectional** and rendered automatically:

- **Post page** — a **"References"** section appears near the end of the post
  (after the content, before the "← All posts" link), listing every cited
  reference as title + `author @handle`, each linking to
  `/references/<slug>/`. The section only renders when the post cites at
  least one reference.
- **Reference page** — a **"Cited in"** section lists every **public** post
  that cites this reference, as title (+ an **EN · VI** badge when the post
  is bilingual), linking to `/posts/<slug>/`. Only rendered when at least one
  public post cites the reference. See `docs/reference-convention.md` §11.

Rules and tolerances:

- **Bilingual posts**: set `based_on` / `references` **identically on both
  variants**. The reverse map collapses variants of the same post into one
  row (keyed by canonical slug) and prefers the English variant for display —
  a post counts as citing a reference when **any** of its variants cites it.
- **Missing targets are tolerated**: if a cited reference slug has no
  matching entry (deleted or renamed), the broken link is **skipped** with a
  build-time warning (`console.warn`) — the build never crashes and the
  broken slug is never rendered.
- **Private / draft posts never leak**: the "Cited in" listings only include
  non-draft, non-private posts. A `private: true` post is still built, but it
  never appears on any public reference page.

Implementation: the shared helper lives in `src/lib/relationships.ts`
(`citedReferenceSlugs`, `resolvePostReferences`, `postsCitingReferences`,
`findReference`) and the sections in
`src/components/ReferencesSection.astro` /
`src/components/CitedInSection.astro`.

---

## 8. Checklist for adding a bilingual post

1. Pick the canonical slug from the English title (§2).
2. Write `src/content/posts/<slug>.md` (`lang: "en"`).
3. Write the Vietnamese version at `src/content/posts/<slug>.vi.md`
   (`lang: "vi"`), with the same `slug` and `translation_of` (§3, §4).
4. Run `bunx astro check` and `bun run build` — both must pass.
5. Verify: `/posts/<slug>/` shows the English variant with an EN | VI switcher
   linking to `/posts/<slug>/vi/` (and vice versa), and `/posts/` lists the
   post exactly once.

Samples: `src/content/posts/sample-building-this-site.md` and
`src/content/posts/sample-building-this-site.vi.md` demonstrate the full
bilingual pattern.
