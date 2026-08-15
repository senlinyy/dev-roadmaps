---
title: "Build the Launch Access Workbook"
sectionSlug: write-the-access-workbook-first
order: 2
---

Complete the startup access workbook before production launch. Human production access must flow through the `support-prod-readers` group with quarterly review. The `orders-api` workload must use a system-assigned managed identity and receive only `Key Vault Secrets User` at the `kv-orders-prod` vault. The `azure-devops-prod` deployment connection must use workload identity federation and must not carry a client secret.

The grader checks the structured caller, role, scope, review, and credential boundaries.
