---
title: "Build the Revision Contract"
sectionSlug: revisions
order: 3
---

Complete the production Container Apps contract for `orders-api` in `rg-orders-prod`. Use multiple revision mode, external ingress on port 3000, two minimum replicas and ten maximum replicas. The container must use image `ghcr.io/devpolaris/orders-api:2026.08.1`, run as the system-assigned identity, and read `PAYMENTS_API_TOKEN` from the Key Vault-backed secret named `payments-token`.

The grader checks the nested revision, ingress, scale, identity, and secret relationships.
