---
title: "Follow the Alias to Its Target"
sectionSlug: which-dns-record-types-describe-a-service
order: 2
---

The release owns `app.example.com`, while customers enter `www.example.com`. Establish whether the customer-facing name follows the intended target.

You start in `/home/dev`. Your job:

1. Inspect the CNAME record for `www.example.com` through the configured resolver.
2. Inspect the target hostname's IPv4 record independently.
3. Query the original customer-facing name for IPv4 and expose both the alias and destination in one full response.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

