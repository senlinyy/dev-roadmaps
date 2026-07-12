---
title: "Repair the Orders HTTPRoute"
sectionSlug: httproute-for-the-application-team
order: 2
---

The orders team has an approved HTTPRoute identity, but the application-owned routing contract is missing. Build the attachment, request match, and backend relationship without changing the shared Gateway.

Your job:

1. **Keep HTTPRoute `orders-api`** in namespace `orders` with API version `gateway.networking.k8s.io/v1`.
2. **Build a parent attachment** to Gateway `public-api` in namespace `platform-networking` through listener `https`.
3. **Build the request contract** for hostname `api.devpolaris.local` and the `/orders` path family with type `PathPrefix`.
4. **Build the backend contract** that forwards matching requests to Service `orders-api` on Service port `80`.

The grader checks the parsed HTTPRoute identity, parent attachment, hostname, path match, and backend Service reference.
