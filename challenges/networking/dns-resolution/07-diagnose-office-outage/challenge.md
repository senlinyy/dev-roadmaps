---
title: "Investigate an Office-Only Outage"
sectionSlug: how-do-you-diagnose-dns-failure-modes
order: 7
---

`https://new.example.com/health` works from home but fails at the office just after launch. Corporate clients use `10.20.0.53`; the public comparison resolver is `1.1.1.1`, and the authority is `192.0.2.53`. Investigate without changing a healthy zone or switching the host's resolver.

You start in `/home/dev`. Your job:

1. Compare full IPv4 responses for `new.example.com` from corporate DNS, public DNS, and authority before advancing time.
2. Inspect the response validity information, advance the lab clock by 60 seconds, and query corporate DNS again.
3. Using the hostname and unchanged configured resolver, inspect the HTTPS health response with connection and TLS details visible.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

