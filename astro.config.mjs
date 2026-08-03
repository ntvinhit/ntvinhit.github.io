// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

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
  vite: {
    plugins: [tailwindcss()],
  },
});
