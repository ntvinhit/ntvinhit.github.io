---
# SAMPLE — frontmatter shape mirrors a real reference entry.
title: "Why we stopped tuning our Kafka partition keys (SAMPLE)"
# Slug convention: slug by title. The file lives at src/content/references/<slug>.md
# so this file must be named `why-we-stopped-tuning-our-kafka-partition-keys.md`.
slug: "sample-event-pipeline"
date: 2026-03-10 # date the article was mirrored into this repo
lang: "en" # language of the ORIGINAL article — mirrors are verbatim, never translated
private: false
draft: false
# Nested author object: display name + X handle (without the leading '@').
author:
  name: "Jane Developer"
  handle: "janedev"
original_url: "https://x.com/janedev/status/1899999999999999999"
published_date: 2026-03-08 # when the article was published on X
fetched_date: 2026-03-10 # when the mirror was fetched via the X API
has_attachments: true # images copied to assets/references/sample-event-pipeline/
description: "A realistic (fake) mirror showing the full reference convention: how a verbatim X article body, attachments placeholder, and credit fields look together."
tags: ["engineering", "systems", "sample"]
---

> **SAMPLE CONTENT** — Fake-but-realistic mirror used to verify the reference
> workflow. The body below demonstrates the verbatim-mirror convention.
> Delete once real references are added.

We spent two quarters treating Kafka partition keys as a scaling lever. This
is the story of why we stopped.

## What we believed

Partitioning by `customer_id` gave us per-customer ordering and let us scale
consumers linearly. It worked — until one customer's event volume dominated
the cluster and every hot partition became a queue of its own.

## What we actually changed

1. Kept `customer_id` keys, but moved the unbounded fan-out into a buffering
   layer between producers and consumers.
2. Made consumers stateless so the group could rebalance without drama.
3. Reserved ordering guarantees for the few flows that genuinely needed them.

## The lesson

The partition key matters less than the admission control around it. We kept
the key; we stopped pretending it was the whole design.

<!--
  IMAGE PLACEHOLDER — attachments for this reference live in
  public/references/sample-event-pipeline/

  The media pipeline (bun scripts/download-reference-media.ts sample-event-pipeline)
  downloads the article's images there and rewrites the body, e.g.:

    ![Event pipeline diagram](/references/sample-event-pipeline/pipeline.png) <!-- image original: https://pbs.twimg.com/media/... -->

  Until that step runs, this file stays attachment-free.
-->
