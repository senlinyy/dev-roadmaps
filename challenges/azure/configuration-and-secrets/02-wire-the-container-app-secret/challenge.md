---
title: "Wire the Container App Secret"
sectionSlug: how-to-wire-secrets-into-a-runtime
order: 2
---

Complete the runtime configuration for `ca-orders-api-prod`. Reference Key Vault secret `appinsights-orders` through user-assigned identity resource ID `/subscriptions/sub-prod/resourceGroups/rg-devpolaris-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod`. Map `APPLICATIONINSIGHTS_CONNECTION_STRING` to the named Container Apps secret `appinsights-connection`, and keep `LOG_LEVEL=info` as plain configuration.

The grader checks that the secret value is referenced, not copied, and that the environment mapping uses the same secret name.
