---
title: "Inspect DNS Cutover Evidence"
sectionSlug: evidence-you-should-check-before-a-cutover
order: 2
---

The public zone is `devpolaris.com` in `rg-devpolaris-dns-prod`. The custom domain is `orders.devpolaris.com`, and the ownership proof record is `asuid.orders`.

Your job:

1. **Inspect** the public CNAME record for `orders`.
2. **Inspect** the TXT ownership record `asuid.orders`.
3. **Confirm** the CNAME target and the ownership proof value before the cutover.

The grader checks that you gathered DNS cutover evidence from Azure.
