---
title: "Inspect the Live Firewall Policy"
sectionSlug: how-does-a-stateful-host-firewall-handle-traffic
order: 1
---

A web host accepts HTTPS but monitoring cannot reach its metrics port. Inspect the active host firewall before changing either service.

1. List every chain with numeric addresses, packet counters, and rule numbers.
2. Inspect the INPUT chain by itself with the same detail.
3. Identify the default policy and the explicit decisions for established traffic, SSH, HTTPS, and metrics.
4. Leave the firewall and services unchanged.
