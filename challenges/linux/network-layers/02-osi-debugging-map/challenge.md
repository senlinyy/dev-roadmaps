---
title: "Map Symptoms to OSI Layers"
sectionSlug: the-osi-model-as-a-debugging-map
order: 2
---

The platform team keeps a one-page OSI debugging cheatsheet at `/home/dev/runbook/osi-cheatsheet.txt`. During an incident, the on-call engineer's job is to look at the symptom they are seeing and grep the cheatsheet for the layer to investigate first.

Three open tickets just hit the queue:

- "ssh hangs from the bastion, no `Connection refused`, just silence" → blocked port (Layer 4 territory).
- "switch port shows `NO-CARRIER` after the cable swap" → physical link issue.
- "`ip neigh show` reports `FAILED` for the database host on the same subnet" → ARP problem.

You start in `/home/dev`. Your job:

1. **Open the cheatsheet** with `cat /home/dev/runbook/osi-cheatsheet.txt` so you can see the layer→symptom rows.
2. **Find which layer owns "Connection refused"** by running `grep "Connection refused" /home/dev/runbook/osi-cheatsheet.txt`.
3. **Find which layer owns "NO-CARRIER"** with another `grep`.
4. **Find which layer owns ARP failures** by grepping for `ARP`.

The grader requires you to use `cat` and `grep`, and checks that the combined output mentions `Layer 4`, `Layer 1`, and `Layer 2`.
