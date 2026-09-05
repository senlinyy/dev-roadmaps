---
title: "Trace a Layered Reachability Block"
sectionSlug: how-do-you-diagnose-firewall-and-reachability-failures
order: 5
---

HTTPS on a host times out even though the web process is running. Collect enough evidence to localize the failure without weakening unrelated policy.

1. Confirm the selected route to the host address.
2. Inspect the HTTPS listener and owner.
3. Inspect INPUT rules and counters.
4. Probe HTTPS, then reinspect the chain to identify the matching layer.
5. Do not change routes, listeners, or firewall rules.
