---
title: "Inspect the Next Local Hop"
sectionSlug: how-does-encapsulation-preserve-several-addresses-at-once
order: 3
---

A worker cannot reach peer `10.20.0.22`, while the public application is in another network. Establish whose link-layer address is needed for each path. You start in `/home/dev`.

1. Inspect the selected route and targeted neighbor entry for peer `10.20.0.22`.
2. Inspect the selected route to public endpoint `203.0.113.25`.
3. Use that route to inspect its next-hop neighbor on the selected interface. Preserve network state.

The grader checks targeted observations and unchanged state, not copied text. This read-only IPv4 simulation has no live network access. Captures cover a bounded authored window; probes finish immediately.
