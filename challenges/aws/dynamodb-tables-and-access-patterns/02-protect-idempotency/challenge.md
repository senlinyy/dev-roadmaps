---
title: "Protect Idempotency"
sectionSlug: conditional-writes
order: 2
---

Two checkout requests with the same idempotency key are racing during payment retry. Use the conditional write evidence to keep retries safe without hiding real client mistakes.
