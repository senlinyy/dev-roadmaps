---
title: "Trace the Stale-Deploy Outage to a Missing TTL Drop"
sectionSlug: ttl-and-caching-the-migration-trap
order: 4
---

Yesterday's deploy moved `app.example.com` to a new IP, but customer reports of "old behavior" are still trickling in this morning. Three artifacts were saved before the on-call lead handed it off: the current authoritative zone at `/home/dev/dns-debug/zone-current.txt`, the migration runbook checklist at `/home/dev/dns-debug/migration-checklist.txt`, and a public-resolver survey at `/home/dev/dns-debug/cache-survey.txt`. You need to find the TTL on the changed record, confirm the runbook step that was skipped, and count how many resolvers still serve the old IP.

You start in `/home/dev`. Your job:

1. **Show the TTL on the changed A record** by running `grep "app.example.com" /home/dev/dns-debug/zone-current.txt` so the `3600` TTL is visible.
2. **Show the skipped checklist step** by running `grep "TTL" /home/dev/dns-debug/migration-checklist.txt` so the SKIPPED line jumps out.
3. **Count resolvers still serving the old IP** by running `grep -c "93.184.216.34" /home/dev/dns-debug/cache-survey.txt` so the number of stale resolvers is on screen.

The grader requires you to use `grep`, and checks that your combined output contains the TTL `3600`, the word `SKIPPED`, and the count `2`.
