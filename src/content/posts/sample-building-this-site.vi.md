---
title: "Ghi chú về việc xây dựng trang web này (MẪU)"
date: 2026-03-12
lang: "vi"
private: false
draft: false
description: "Bài viết mẫu mô tả cách trang web Astro + Bun + Tailwind này được xây dựng."
tags: ["astro", "meta", "sample"]
translation_of: "sample-building-this-site"
based_on: ["sample-event-pipeline"]
references: []
---

> **NỘI DUNG MẪU** — Đây là bài viết giữ chỗ dùng để kiểm tra khả năng
> hiển thị. Hãy xoá nó khi có bài viết thật.

Đây là bản **tiếng Việt** của bài viết mẫu, dùng để kiểm chứng cơ chế song ngữ
của trang: một bài viết có một danh tính duy nhất với tối đa hai phiên bản ngôn
ngữ, chia sẻ chung một slug chuẩn (canonical slug) và cùng một URL.

> **Trải nghiệm song ngữ** — bản tiếng Anh của bài viết này nằm ở
> `src/content/posts/sample-building-this-site.md`. Slug chuẩn được suy ra từ
> tên tệp (`sample-building-this-site`), do đó cả hai phiên bản được hiển thị
> tại cùng một URL: `/posts/sample-building-this-site/` (tiếng Anh, mặc định)
> và `/posts/sample-building-this-site/vi/` (tiếng Việt). Dùng công tắc **EN |
> VI** ở đầu trang để chuyển giữa hai phiên bản.

## Công nghệ

- **Astro 5** cho trang tĩnh
- **Bun** là trình quản lý gói và runtime
- **Tailwind CSS v4** qua `@tailwindcss/vite`

## Mô hình nội dung

Cả references lẫn posts đều nằm trong content collections của Astro, được khai
báo trong `src/content.config.ts`. Schema được thiết kế rộng hơn nhu cầu hiện
tại một chút để dễ tinh chỉnh về sau.

## Trích dẫn một reference

Bài viết này có trường `based_on` trỏ tới reference mẫu `sample-event-pipeline`
— xem phần **References** bên dưới. Trang của reference đó cũng hiển thị mục
**Cited in** trỏ ngược lại bài viết này.
