---
title: "Walk the Layers to the Real Fault"
sectionSlug: where-each-layer-breaks
order: 5
---

The checkout API is failing from an edge worker, and the incident channel is split between "the network is down" and "the app is down." An on-call captured layer-specific command output into `/var/log/network/layer-checks` so you can prove which layer actually breaks.

You start in `/home/dev`. Your job:

1. **Move into `/var/log/network/layer-checks`** so every check uses the captured evidence.
2. **List the available check files** before inspecting them.
3. **Clear Layers 1-3** by surfacing the link, neighbor, and route evidence.
4. **Clear Layer 4** by showing that TCP connected to the checkout endpoint.
5. **Find the final failing layer** by surfacing the HTTP response and gateway log that explain the real issue.

The grader requires you to use `cd`, `find`, `cat`, and `grep`, finish in `/var/log/network/layer-checks`, and show evidence that the link is up, ARP is reachable, the route exists, TCP connected, and the real failure is `no healthy upstream` at the application layer.
