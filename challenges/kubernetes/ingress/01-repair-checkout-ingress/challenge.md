---
title: "Repair the Checkout Ingress"
sectionSlug: hosts-paths-and-backend-services
order: 1
---

The checkout team submitted an Ingress with approved identity and ownership metadata, but no controller, route, backend, or TLS contract. Build the public checkout route so it follows the reviewed Service contract.

Your job:

1. **Preserve the approved Ingress identity and metadata** for `checkout-web` in the `checkout` namespace with API version `networking.k8s.io/v1`.
2. **Assign controller ownership** with the exact Ingress class `public`.
3. **Build one HTTP route** for host `shop.devpolaris.example` and the `/checkout` path family using `Prefix` matching.
4. **Connect the route to the Service contract** named `checkout-web` through the named Service port `http`.
5. **Build TLS termination for the same host** using Secret `shop-devpolaris-example-tls`.

The grader checks the parsed Ingress identity, class, host, path rule, backend Service contract, and TLS configuration.
