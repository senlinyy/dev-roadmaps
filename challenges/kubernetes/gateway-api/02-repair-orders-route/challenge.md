---
title: "Attach the Orders Route to a Shared Gateway"
sectionSlug: httproute-for-the-application-team
order: 2
---

The platform team owns a shared HTTPS Gateway and the orders team owns its Service. Inspect both supplied resources, then author the application-owned HTTPRoute that joins those contracts without editing either dependency.

Your job:

1. **Keep HTTPRoute `orders-api`** in namespace `orders` with API version `gateway.networking.k8s.io/v1`.
2. **Build a parent attachment** to Gateway `public-api` in namespace `platform-networking` through listener `https`.
3. **Build the request contract** for hostname `api.devpolaris.local` and the `/orders` path family with type `PathPrefix`.
4. **Build the backend contract** that forwards matching requests to Service `orders-api` on Service port `80`.

The grader parses all three resources, checks the route contract, and proves that both the parent Gateway and backend Service references resolve to supplied objects in the correct namespaces.
