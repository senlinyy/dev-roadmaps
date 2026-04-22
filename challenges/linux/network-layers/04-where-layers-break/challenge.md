---
title: "Pinpoint Which Layer Broke"
sectionSlug: where-each-layer-breaks
order: 4
---

The on-call engineer dumped five diagnostic outputs into `/home/dev/postmortem/`, one per file, each captured during a different production incident this week. Each file contains the verbatim output of a real Linux network tool (`ip link`, `ip neigh`, `traceroute`, `ss -tlnp`, `curl -v`). Your job is to recursively grep the directory for the failure marker that identifies which OSI layer broke in each incident.

You start in `/home/dev`. Your job:

1. **Inventory the saved postmortem artifacts** under `/home/dev/postmortem/` so you know which diagnostic outputs you can search.
2. **Find the artifact that proves a Layer 1 physical-link failure** and print the evidence line.
3. **Find the artifact that proves a Layer 2 neighbor-resolution failure** and print the evidence line.
4. **Find the artifact that proves a Layer 3 routing failure** and print the evidence line.
5. **Find the artifact that proves a Layer 4 transport failure** and print the evidence line.
6. **Find the artifact that proves a Layer 7 application/TLS failure** and print the evidence line.

The grader requires you to use `grep`, and checks that the combined output mentions `NO-CARRIER`, `FAILED`, `Destination Host Unreachable`, `Connection refused`, and `certificate has expired`.
