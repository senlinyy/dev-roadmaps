---
title: "Trace the Stale-Deploy Outage to a Missing TTL Drop"
sectionSlug: ttl-and-caching-the-migration-trap
order: 4
---

Yesterday's deploy moved `app.example.com` to a new IP, but customer reports of "old behavior" are still trickling in this morning. Three artifacts were saved before the on-call lead handed it off: the current authoritative zone at `/etc/bind/zones/db.example.com.current`, the migration runbook checklist at `/var/log/change/app-cutover.log`, and a public-resolver survey at `/var/log/dns/cache-survey.log`. You need to find the TTL on the changed record, confirm the runbook step that was skipped, and count how many resolvers still serve the old IP.

You start in `/home/dev`. Your job:

1. **Surface the current TTL on `app.example.com`** from `/etc/bind/zones/db.example.com.current`.
2. **Find the runbook step that should have lowered the TTL before the cutover** in `/var/log/change/app-cutover.log`.
3. **Count how many resolvers in `/var/log/dns/cache-survey.log` still serve the old IP** so the stale-cache blast radius is explicit.

The grader requires you to use `grep`, and checks that your combined output contains the TTL `3600`, the word `SKIPPED`, and the count `2`.
