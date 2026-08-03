// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { rehypeTweetEmbed } from './src/plugins/rehype-tweet-embed.ts';

// Deploys to the user page root: https://ntvinhit.github.io/
export default defineConfig({
  site: 'https://ntvinhit.github.io/',
  base: '/',
  // Static assets live in the repo-root `public/` dir — Astro copies it into
  // the build verbatim and serves it at the site root. Reference media goes in
  // `public/references/<slug>/` and is referenced from content as
  // `/references/<slug>/<file>` (see docs/reference-convention.md §4).
  // NOTE: a top-level `assets/` dir is NOT served by Astro — do not put media
  // there (cover-image.JPG was moved to public/ for this reason).
  publicDir: 'public',
  integrations: [],
  markdown: {
    // Render `<figure data-tweet-id>` placeholders (emitted by the DraftJS
    // converter for embedded X posts) as live X widget iframes. Applies to all
    // markdown; posts never contain the placeholder so it is a no-op there.
    rehypePlugins: [rehypeTweetEmbed],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
