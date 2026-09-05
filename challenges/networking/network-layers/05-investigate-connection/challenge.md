---
title: "Investigate the Connection Evidence"
sectionSlug: how-do-tcp-connection-states-support-diagnosis
order: 5
---

The public endpoint `203.0.113.25` accepts TCP on `443`, but connections to legacy port `8443` do not complete. Compare evidence without changing policies. You start in `/home/dev`.

1. Probe both TCP ports and inspect existing TCP connection states.
2. Capture the authored conversation for host `203.0.113.25` on port `443`, using the outgoing interface and a limit of four packets.
3. Capture the same host on port `8443` with a limit of three packets. Preserve files and workloads.

The grader checks targeted observations and unchanged state, not copied text. This read-only IPv4 simulation has no live network access. Captures cover a bounded authored window; probes finish immediately.
