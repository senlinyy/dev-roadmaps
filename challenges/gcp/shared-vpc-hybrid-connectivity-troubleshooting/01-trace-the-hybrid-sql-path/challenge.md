---
title: "Trace the Hybrid SQL Path"
sectionSlug: troubleshooting-ladder
order: 1
---

An application in service project `devpolaris-orders-prod` cannot reach the on-premises SQL endpoint. Inspect the saved connectivity test `orders-to-sql` in host project `devpolaris-network-host`, then run it to gather the current reachability result.

Record the source, destination, verdict, and the first failing network control. Do not change routes or firewall rules before collecting this evidence.
