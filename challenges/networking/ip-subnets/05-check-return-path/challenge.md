---
title: "Check the Return Path"
sectionSlug: how-do-you-diagnose-address-prefix-and-route-failures
order: 5
---

Requests reach a two-interface API node, but clients in one office never receive replies. Check the route the API would use for each client network.

1. Inspect all interface addresses and all routes.
2. Resolve the return route to working client `10.60.8.44`.
3. Resolve the return route to failing client `10.70.8.44`.
4. Leave the route table unchanged so the missing return-path evidence survives review.
