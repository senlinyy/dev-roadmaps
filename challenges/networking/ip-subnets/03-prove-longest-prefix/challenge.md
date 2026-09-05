---
title: "Prove Longest-Prefix Selection"
sectionSlug: how-does-routing-decide-between-local-and-remote-delivery
order: 3
---

Traffic to one production range must use a private transit router, while ordinary traffic uses the internet gateway. Prove that the more specific route wins.

1. Inspect all routes.
2. Resolve the route for `10.80.24.50`, which belongs to the specific production range.
3. Resolve the route for `10.81.24.50`, which matches only the broader private route.
4. Resolve the route for `198.51.100.20`, which needs the default route.
