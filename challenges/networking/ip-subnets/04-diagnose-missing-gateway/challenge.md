---
title: "Diagnose a Missing Gateway"
sectionSlug: how-do-you-diagnose-address-prefix-and-route-failures
order: 4
---

An isolated application worker reaches its same-subnet cache but cannot reach the deployment service. Determine whether transport testing is justified yet.

1. Inspect its addresses and complete route table.
2. Resolve the route to the local cache at `192.168.50.40`.
3. Resolve the route to the deployment service at `203.0.113.80`.
4. Preserve the failure evidence and leave the host unchanged.
