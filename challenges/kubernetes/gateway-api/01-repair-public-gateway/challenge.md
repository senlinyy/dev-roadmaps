---
title: "Repair the Shared Public Gateway"
sectionSlug: a-shared-gateway-for-the-platform-team
order: 1
---

The platform networking team has approved the shared Gateway identity and implementation class, but its edge contract is missing. Build the listener and namespace attachment contract before application teams attach production routes.

Your job:

1. **Keep Gateway `public-api`** in namespace `platform-networking` with API version `gateway.networking.k8s.io/v1`.
2. **Keep GatewayClass `shared-public`** as the approved implementation contract.
3. **Build one listener named `https`** for protocol `HTTPS`, port `443`, and hostname `api.devpolaris.local`.
4. **Give that listener a TLS termination contract** backed by Secret `devpolaris-api-tls`.
5. **Give that listener a route attachment policy** that selects only namespaces labeled exactly `shared-gateway: public-api`.

The grader checks the parsed Gateway identity, class, listener, TLS reference, and namespace attachment policy.
