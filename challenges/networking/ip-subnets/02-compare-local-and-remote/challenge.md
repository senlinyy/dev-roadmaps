---
title: "Compare Local and Remote Delivery"
sectionSlug: how-does-routing-decide-between-local-and-remote-delivery
order: 2
---

A worker can reach a database on its own subnet and an API in another network. Prove whether each destination is delivered directly or through a gateway.

1. Ask the routing table how it would reach `10.42.7.80`.
2. Ask how it would reach `10.90.12.20`.
3. Inspect the complete route table to connect each decision to its prefix.
4. Leave network state unchanged.
