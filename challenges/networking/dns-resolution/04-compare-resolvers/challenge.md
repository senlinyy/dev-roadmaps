---
title: "Compare Internal and Public Views"
sectionSlug: how-do-you-debug-dns-with-dig
order: 4
---

The service intentionally uses a private load balancer for employees and a public one for customers. A teammate calls their different DNS answers a stale-cache bug. Gather evidence from both views.

You start in `/home/dev`. Your job:

1. Inspect the full IPv4 response for `app.example.com` from corporate resolver `10.20.0.53`.
2. Query the same name and type through public resolver `1.1.1.1`.
3. Check private authority `192.0.2.55` directly and compare its answer with the corporate response.

This is a bounded DNS simulation with authored servers and records, not live internet access. Queries complete immediately; only foreground sleep advances the lab clock. The grader checks targeted query evidence and unchanged configuration, not a written diagnosis.

