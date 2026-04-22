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

1. **Inspect the cheatsheet** at `/home/dev/runbook/osi-cheatsheet.txt` so you can see the layer-to-symptom mapping the team uses during incidents.
2. **Find the row for the transport-layer reachability symptom** so the ticket about a blocked/refused connection is mapped to the right layer.
3. **Find the row for the physical-link symptom** so the cable-swap incident is classified correctly.
4. **Find the row for the ARP-resolution symptom** so the same-subnet neighbor failure is routed to the right part of the stack.

The grader requires you to use `cat` and `grep`, and checks that the combined output mentions `Layer 4`, `Layer 1`, and `Layer 2`.
