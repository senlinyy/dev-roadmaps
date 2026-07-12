---
title: "Repair the Orders API Service"
sectionSlug: the-first-service
order: 1
---

The checkout application needs a stable in-cluster contract for the orders API. The manifest has approved identity and ownership metadata, but its networking contract is still missing. Build that contract without exposing the API outside the cluster.

Your job:

1. **Preserve the approved Service identity and metadata** for `orders-api` in the `orders` namespace.
2. **Build an internal-only Service contract** using the exact type `ClusterIP`.
3. **Define the complete Pod selection contract** with `app.kubernetes.io/name: orders-api` and `app.kubernetes.io/component: api`.
4. **Publish one named `http` port** to callers on numeric port `80` over `TCP`.
5. **Connect that caller port to the Pod port named `http`** so a container port number change does not break the Service.

The grader checks the parsed Service identity, selector, exposure type, and port mapping.
