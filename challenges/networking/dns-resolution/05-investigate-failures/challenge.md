---
title: "Separate Missing Data from Lookup Failure"
sectionSlug: how-do-you-diagnose-dns-failure-modes
order: 5
---

Three reports all say 'DNS is broken': `missing.example.com`, `mail.example.com`, and `app.example.com`. Determine what each response actually says rather than treating every empty address list as a missing hostname.

You start in `/home/dev`. Your job:

1. Inspect full IPv4 responses for all three names through the configured corporate resolver.
2. Inspect the MX record for `mail.example.com` to test whether it exists with another type.
3. Query the application IPv4 record directly at authority `192.0.2.53` to compare with the recursive failure.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

