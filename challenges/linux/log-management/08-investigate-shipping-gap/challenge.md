---
title: "Investigate a Shipping Gap"
sectionSlug: why-should-important-logs-leave-the-vm
order: 8
---

Central search has no new records from this host, although the application still runs. You start in `/home/dev`; the simulated clock is 2026-09-01 10:30:00 UTC. This exercise covers local evidence only, not a live collector connection.

1. **Check `rsyslog.service` status and its latest twenty journal records**, without restarting it.
2. **Measure the retained buffer under `/var/spool/rsyslog`** as one human-readable total, preserving its contents.
3. **Send a new local journal message** with tag `shipping-probe` and text `devpolaris shipping probe 20260901`.
4. **Query that tag’s records from the last minute** to confirm the marker reached the local journal.

The grader checks a newly emitted marker, targeted forwarding evidence, and preserved queued data. Local receipt and an active process do not prove delivery to central storage.
