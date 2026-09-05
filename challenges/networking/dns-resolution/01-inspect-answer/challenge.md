---
title: "Inspect a DNS Answer"
sectionSlug: how-do-you-debug-dns-with-dig
order: 1
---

A release check reports an address for `app.example.com`, but hides the resolver and record details. Establish what this host receives before testing the application.

You start in `/home/dev`. Your job:

1. Inspect the IPv4 answer for `app.example.com` through the configured resolver, retaining status, TTL, type, and responding-server fields.
2. Inspect the IPv6 answer for the same hostname with those fields visible.
3. Leave host configuration unchanged. An AAAA answer is DNS evidence, not a test of IPv6 connectivity.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

