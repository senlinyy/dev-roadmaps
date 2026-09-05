---
title: "Find the Listener Boundary"
sectionSlug: what-scope-does-each-layer-own
order: 4
---

A diagnostic API on port `9000` works through localhost but is unavailable through this worker's interface address. A teammate proposes changing a firewall. Gather local evidence first. You start in `/home/dev`.

1. Inspect TCP listeners with their owning process details.
2. Inspect the owner, PID, and full command of the process holding port `9000`.
3. Compare TCP probes to `127.0.0.1:9000` and `10.20.0.10:9000`. Keep the process and its binding unchanged.

The grader checks targeted observations and unchanged state, not copied text. This read-only IPv4 simulation has no live network access. Captures cover a bounded authored window; probes finish immediately.
