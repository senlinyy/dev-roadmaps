---
title: "Validate Conditional Caching"
sectionSlug: how-do-methods-status-codes-headers-and-cookies-carry-meaning
order: 5
---

A static manifest returns an ETag, but the team is unsure whether clients can revalidate it without downloading the body again.

1. Request only response headers for `https://cdn.example.com/manifest.json`.
2. Repeat the request with `If-None-Match: "release-42"`.
3. Preserve the original 200 response metadata and the conditional result.
