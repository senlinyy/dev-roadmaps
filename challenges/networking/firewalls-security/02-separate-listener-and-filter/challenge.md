---
title: "Separate Listener and Filter Evidence"
sectionSlug: how-do-you-diagnose-firewall-and-reachability-failures
order: 2
---

A local API is reported down on port 8443. Determine whether the process is absent, bound incorrectly, or blocked by the host firewall.

1. Inspect the TCP listener and its process owner.
2. Inspect the numbered INPUT rules and counters.
3. Probe `10.20.5.10:8443`.
4. Reinspect INPUT so the matching counter reveals which decision handled the attempt.
5. Make no configuration changes.
