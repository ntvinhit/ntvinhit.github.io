# Vinh N.T. — personal site

Personal blog and mirror of X (Twitter) articles worth keeping around. Built
from scratch with **Astro 5**, **Bun**, and **Tailwind CSS v4** — no theme
framework.

Deploys to <https://ntvinhit.github.io/> (GitHub Pages user site, root path).

## Sections

- **Home** — recent posts + recent references.
- **References** — mirrored X articles. Each page shows the full article with a
  credit block: original author, @handle, link to the original X post, publish
  date on X, and a mirror banner noting that all rights belong to the original
  author.
- **Posts** — my own writing.

## Stack

| Piece    | Choice                                            |
| -------- | ------------------------------------------------- |
| Runtime  | [Bun](https://bun.sh) 1.3.x (`/Users/ntvinh/.bun/bin/bun`) |
| Framework| [Astro](https://astro.build) 5.x (content collections)     |
| Styling  | [Tailwind CSS](https://tailwindcss.com) v4 via `@tailwindcss/vite` |
| Language | TypeScript / `.astro` components                  |

## Commands

```sh
bun install     # install dependencies
bun run dev     # start the dev server at http://localhost:4321
bun run build   # build the static site into dist/
bun run preview # preview the production build locally
bunx astro check # type-check the project (incl. content collections)

# Media pipeline — download & rehost images for an existing reference mirror
bun scripts/download-reference-media.ts <slug>

# Fallback tool — mirror an X article URL into src/content/references/ (needs
# X_API_BEARER_TOKEN; see docs/reference-convention.md §10)
bun run add-reference -- https://x.com/<handle>/status/<id>
```

## Project structure

```
site/
├── astro.config.mjs          # Astro config: site URL, base '/', publicDir 'public', Tailwind plugin
├── tsconfig.json
├── package.json
├── public/                   # Astro static dir — served at '/' (committed; media is content)
│   ├── cover-image.JPG
│   └── references/<slug>/    # downloaded reference images
├── scripts/                  # Bun scripts (agent-driven tasks)
│   ├── download-reference-media.ts   # CLI: download + rewrite media for a reference
│   ├── add-reference.ts              # fallback: fetch an X article URL + scaffold the mirror
│   └── lib/
│       ├── fetch-media.ts            # reusable downloader (downloadImages + URL normalization)
│       ├── reference-media.ts        # body-rewrite + frontmatter pipeline
│       └── frontmatter.ts            # minimal YAML-subset frontmatter parse/serialize
└── src/
    ├── content.config.ts     # content collections: 'references' + 'posts'
    ├── content/
    │   ├── references/       # mirrored X articles (markdown)
    │   └── posts/            # own writing (markdown)
    ├── layouts/BaseLayout.astro
    ├── components/CreditBlock.astro
    ├── pages/
    │   ├── index.astro
    │   ├── references/       # index + [...slug]
    │   └── posts/            # index + [...slug]
    └── styles/global.css     # Tailwind v4 + design tokens
```

## Content model

Both collections share: `title`, `slug` (derived from the file name when
omitted), `date`, `lang` (`en` | `vi`), `private`, `draft`.

- **References** (mirrors of X articles — full convention in
  [`docs/reference-convention.md`](docs/reference-convention.md)) add:
  `author` (nested `{ name, handle }`), `original_url`, `published_date`,
  `fetched_date`, `has_attachments`, `images_original`, `description`,
  `tags`. Each page renders a credit block at the bottom as a compact
  attribution footer (author, @handle, link to the original article,
  published date, mirror banner). Images are
  downloaded to `public/references/<slug>/` by the media pipeline
  (`bun scripts/download-reference-media.ts <slug>`); the body is rewritten
  to local paths and the original URLs stay recoverable in
  `<!-- image original: … -->` comments plus the `images_original` field.
  Video URLs are kept as-is.
- **Posts** add: `description`, `tags`, `translation_of` (the sibling-language
  variant's canonical slug — see the bilingual convention in
  [`docs/posts-convention.md`](docs/posts-convention.md)), and
  `based_on` / `references` (reference slugs for bidirectional linking later).

Posts are **bilingual**: each post is one canonical identity with up to two
variants (`en` default, `vi` alternate) that share a canonical slug derived
from the file name (`my-note.md` + `my-note.vi.md` → `my-note`). Both variants
render under the same URL — `/posts/<slug>/` (English) and `/posts/<slug>/vi/`
(Vietnamese) — with an EN | VI switcher. See
[`docs/posts-convention.md`](docs/posts-convention.md) for the full convention.

## Samples

`src/content/references/sample-event-pipeline.md` (public, full convention),
`src/content/references/sample-private-note.md` (`private: true` filtering
demo), and `src/content/posts/sample-building-this-site.md` are clearly
marked sample entries used to verify rendering — safe to delete once real
content lands.

## Notes

- Site UI language is English; `lang` on entries lets us mark Vietnamese
  content while keeping the UI English.
- Static media lives in the committed `public/` folder (Astro serves it at
  `/`). A top-level `assets/` directory would NOT be served — `cover-image.JPG`
  was moved from `assets/` to `public/` accordingly.
- No CI (GitHub Actions) yet — separate task.
