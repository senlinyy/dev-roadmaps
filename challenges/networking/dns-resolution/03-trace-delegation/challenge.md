---
title: "Locate the Delegation Break"
sectionSlug: how-does-the-resolution-chain-reach-an-authoritative-answer
order: 3
---

`app.example.com` resolves, but `api.stage.example.com` fails after a DNS-provider move. The intended staging authority is `192.0.2.54`. Compare the hierarchy with that source before proposing a record change.

You start in `/home/dev`. Your job:

1. Trace the healthy IPv4 lookup for `app.example.com` through the hierarchy.
2. Trace `api.stage.example.com` and expose the last referral and failure boundary.
3. Query `192.0.2.54` directly for the staging IPv4 record, retaining the authority flag and answer.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. Traces follow authored referrals, not the configured recursive cache. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

