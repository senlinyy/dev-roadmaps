---
title: "Observe a Cached Answer Expire"
sectionSlug: how-do-caching-and-ttl-shape-a-safe-cutover
order: 6
---

The approved cutover changed `app.example.com` from `198.51.100.10` to `203.0.113.25`. The corporate resolver retains an old copy with 60 seconds remaining. Observe the transition without changing records or flushing caches.

You start in `/home/dev`. Your job:

1. Inspect the corporate resolver's full IPv4 answer before expiry.
2. Inspect the current IPv4 source data directly at `192.0.2.53`.
3. Advance the lab clock by 60 seconds, then query corporate resolver `10.20.0.53` again and verify the new address.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

