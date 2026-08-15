---
title: "Inspect the API Ingress Rule"
sectionSlug: verification-and-troubleshooting
order: 2
---

The load balancer cannot reach `orders-api`. Inspect firewall rule `allow-lb-to-orders-api` and verify its network, direction, priority, action, source range, target service account, protocol, and port.

Use the returned rule evidence to decide whether the intended load-balancer-to-API path is represented. Do not change the rule.
