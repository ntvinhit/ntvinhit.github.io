---
title: "Notes on building this site (SAMPLE)"
date: 2026-03-12
lang: "en"
private: false
draft: false
description: "A sample post documenting how this Astro + Bun + Tailwind site is put together."
tags: ["astro", "meta", "sample"]
translation_of: "sample-building-this-site"
based_on: ["sample-event-pipeline"]
references: []
---

> **SAMPLE CONTENT** — This is a placeholder post used to verify rendering.
> Delete it once real posts are added.

This is a sample post to prove the Posts section works end to end.

> **Bilingual demo** — a Vietnamese version of this post lives in
> `src/content/posts/sample-building-this-site.vi.md`. The canonical slug is
> derived from the file names (`sample-building-this-site`), so both variants
> render under the same URL: `/posts/sample-building-this-site/` (English, the
> default) and `/posts/sample-building-this-site/vi/` (Vietnamese). Use the
> **EN | VI** switcher at the top of this page to jump between them.

## Stack

- **Astro 5** for the static site
- **Bun** as the package manager and runtime
- **Tailwind CSS v4** via `@tailwindcss/vite`

## Content model

Both references and posts live in Astro content collections defined in
`src/content.config.ts`. The schema is deliberately a superset of what we need
today so we can refine it later.

## Citing a reference

This post is `based_on` the sample reference `sample-event-pipeline` — see the
**References** section below. The reference page for it, in turn, shows a
**Cited in** section linking back to this post.
