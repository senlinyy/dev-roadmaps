---
title: "Pinpoint Which Layer Broke"
sectionSlug: where-each-layer-breaks
order: 4
---

The on-call engineer dumped five diagnostic outputs into `/home/dev/postmortem/`, one per file, each captured during a different production incident this week. Each file contains the verbatim output of a real Linux network tool (`ip link`, `ip neigh`, `traceroute`, `ss -tlnp`, `curl -v`). Your job is to recursively grep the directory for the failure marker that identifies which OSI layer broke in each incident.

You start in `/home/dev`. Your job:

1. **List the postmortem files** with `ls /home/dev/postmortem/` so you know what is there.
2. **Find the Layer 1 incident** by recursively grepping for `NO-CARRIER` under `/home/dev/postmortem/`.
3. **Find the Layer 2 incident** by grepping for `FAILED` (the marker `ip neigh show` prints when ARP cannot resolve).
4. **Find the Layer 3 incident** by grepping for `Destination Host Unreachable`.
5. **Find the Layer 4 incident** by grepping for `Connection refused`.
6. **Find the Layer 7 incident** by grepping for `certificate has expired`.

The grader requires you to use `grep`, and checks that the combined output mentions `NO-CARRIER`, `FAILED`, `Destination Host Unreachable`, `Connection refused`, and `certificate has expired`.
