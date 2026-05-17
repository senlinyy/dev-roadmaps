---
title: "Configuration and Secrets"
description: "Manage Azure app settings, Container Apps secrets, Key Vault references, and managed identity as release-critical runtime state."
overview: "A healthy artifact can fail when runtime values change. This article explains configuration and secrets as part of release safety, not as a side note after deployment."
tags: ["configuration", "app-settings", "secrets", "key-vault", "managed-identity"]
order: 3
id: article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration
aliases:
  - runtime-settings-secrets-and-configuration-changes
  - cloud-providers/azure/deployment-runtime-operations/runtime-settings-secrets-and-configuration-changes.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Runtime Configuration](#runtime-configuration)
3. [App Settings](#app-settings)
4. [Container Apps Secrets](#container-apps-secrets)
5. [Key Vault References](#key-vault-references)
6. [Managed Identity](#managed-identity)
7. [Slot Sticky Settings](#slot-sticky-settings)
8. [Config Rollback](#config-rollback)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The previous article gave the new version a safer rollout path. The candidate started, the direct test worked, and traffic moved slowly. Then checkout failed only in production.

The artifact did not change between staging and production. The bug is in the values around it:

- `RECEIPTS_STORAGE_ACCOUNT` points at the staging storage account.
- The Key Vault reference names the right secret, but the app's managed identity cannot read it.
- A feature flag was tested in the staging slot, then unexpectedly stayed with the slot during swap.
- A Container Apps secret was updated, but the active revision still uses the old environment mapping.

Configuration is runtime state. Secrets are runtime state. Identity is runtime state. A release that ignores them is only half a release.

## Runtime Configuration

Runtime configuration is the set of values Azure gives the app outside the source code. These values tell the same artifact how to behave in dev, staging, and production.

For `devpolaris-orders-api`, configuration might include:

```text
NODE_ENV=production
ORDERS_DB_SERVER=sql-devpolaris-prod.database.windows.net
ORDERS_DB_NAME=orders
RECEIPTS_STORAGE_ACCOUNT=stordersprod
CHECKOUT_PAYMENTS_ENABLED=true
APPINSIGHTS_CONNECTION_STRING=...
```

This is powerful because the same artifact can run in more than one environment. It is risky for the same reason. A wrong value can make good code fail.

The release habit is to treat configuration like a first-class change. If a release changes code and config, record both. If a rollback returns code to an older version but leaves new config in place, users may still be on a broken path.

## App Settings

In Azure App Service, app settings are exposed to the app as environment variables. That means application code can read them the same way it reads environment variables in many other hosting environments.

App settings are useful for non-secret and secret-like runtime values, but they deserve careful handling. Changing settings can restart the app. Settings can differ between slots. Secret values should not be copied into code, logs, pull requests, or screenshots.

For the orders API, an App Service app setting review might look like this:

| Setting | Expected production value | Release risk |
| --- | --- | --- |
| `ORDERS_DB_SERVER` | Production SQL server | Wrong value sends checkout to the wrong database. |
| `RECEIPTS_STORAGE_ACCOUNT` | Production storage account | Wrong value writes or reads receipts from the wrong place. |
| `APPINSIGHTS_CONNECTION_STRING` | Production telemetry target | Wrong value hides release evidence. |
| `CHECKOUT_PAYMENTS_ENABLED` | Planned flag state | Wrong value changes user behavior during rollout. |

The gotcha is that "setting saved" does not prove "app healthy." The app still has to restart or refresh as required, receive the value, and use it successfully.

## Container Apps Secrets

Azure Container Apps can store secrets and expose values to containers through environment variables or other configuration references. Secrets are scoped to the container app, and revisions can reference them through their environment configuration.

The release question is not just "does the secret exist?" It is:

| Question | Why it matters |
| --- | --- |
| Which secret name does the app reference? | A secret can exist while the environment variable points elsewhere. |
| Which revision uses the mapping? | A new revision may be needed for certain template changes. |
| Was the secret value changed separately from the image? | Rollback may need both traffic and secret state restored. |
| Does the app log prove it loaded the expected config safely? | Saved configuration is not the same as working behavior. |

Secrets are especially easy to mishandle during rollouts because teams want to fix quickly. Avoid broad fixes like adding several duplicate secret names or temporarily hardcoding a value. Those fixes make the next release harder to reason about.

## Key Vault References

Key Vault references let an Azure app refer to a secret in Key Vault instead of storing the secret value directly in the app setting. That keeps sensitive values out of code and ordinary configuration reviews.

The mental model has two doors:

1. The app setting or environment value points to the Key Vault secret.
2. The app's identity must be allowed to read that secret.

If either door is wrong, the app may fail. A perfect reference string does not help if the identity lacks permission. A valid identity does not help if the reference points to the wrong secret or vault.

For checkout, a Key Vault reference might hold a payment provider token or database credential. A release that changes the reference should include:

| Evidence | Why it matters |
| --- | --- |
| Vault name and secret name | Shows the target. |
| App identity | Shows who is trying to read. |
| Access permission | Shows whether the identity is allowed. |
| App behavior after restart or refresh | Shows whether the runtime received the value. |

Do not log the resolved secret value to prove it worked. Prove behavior with safe evidence: successful dependency calls, no secret resolution errors, and expected request behavior.

## Managed Identity

A managed identity gives the Azure resource an identity in Microsoft Entra ID. The app can use that identity to access other Azure resources without storing credentials in code.

For releases, managed identity matters because it is easy to test with one identity and run production with another. A staging slot, production slot, Container Apps environment, or new app resource may not have the same identity or role assignments.

The orders API might need identity-based access to:

| Target | Needed permission shape |
| --- | --- |
| Key Vault | Read selected secrets. |
| Blob Storage | Upload receipts to the right container. |
| Azure SQL | Connect as the expected application principal. |
| Application Insights or Monitor | Send telemetry to the expected destination. |

The beginner mistake is fixing identity by granting a broad role at a broad scope. That may make the release pass, but it weakens security and hides the actual boundary. The safer first move is to identify the exact caller, target, action, and scope.

## Slot Sticky Settings

App Service slots create a special configuration problem. Some settings should stay with the slot during a swap. These are often called slot-specific or sticky settings.

Imagine `staging` has a feature flag used only for pre-production smoke tests. If that flag moves into production during a swap, the production app may behave in a way the team did not intend. Now imagine the production slot has the production storage account. If that value moves away from production unexpectedly, checkout may write receipts to the wrong account.

Use sticky settings to protect environment-specific values. But do not rely on memory. Before a swap, the release record should name the values that stay with the slot and the values that move with the version.

```text
Swap check:
  Moves with candidate: APP_VERSION, image/package version
  Stays with production slot: ORDERS_DB_SERVER, RECEIPTS_STORAGE_ACCOUNT, Key Vault references
  Verify after swap: checkout smoke test, Application Insights telemetry
```

The exact choices depend on the app. The habit is stable: know which values are part of the candidate and which values are part of the environment.

## Config Rollback

Configuration rollback is restoring runtime values to a known working state. It may be separate from code rollback.

If a release changed only code, routing traffic back to the old revision may be enough. If the release also changed `RECEIPTS_STORAGE_ACCOUNT`, a feature flag, or a Key Vault reference, traffic rollback may leave the broken value in place. That is why a release record should include configuration changes explicitly.

Useful config rollback notes look like this:

| Change | Rollback target | Evidence rollback worked |
| --- | --- | --- |
| `RECEIPTS_STORAGE_ACCOUNT` changed to `stordersv2prod` | Restore `stordersprod` | Receipt upload smoke test succeeds. |
| Key Vault secret reference changed | Restore previous secret reference | Secret resolution errors stop. |
| Payment feature flag enabled | Disable flag | Checkout failure rate returns to baseline. |

Config rollback can restart apps or create new revisions depending on the runtime and setting. Account for that in the watch window. The rollback itself is a release.

## Putting It All Together

Return to the failed production checkout.

- The artifact was good, but runtime configuration still had to be proven.
- App settings became environment variables the app actually used.
- Container Apps secrets had to be named, mapped, and active in the right revision behavior.
- Key Vault references had two doors: the reference and the identity permission.
- Managed identity made secret and resource access part of release safety.
- Slot sticky settings decided whether values stayed with the environment or moved with the candidate.
- Config rollback needed exact previous values and evidence that behavior recovered.

Configuration is not cleanup after deployment. It is part of what the release changes.

## What's Next

The next article closes the module with verification and rollback. Once traffic moves, the team needs a watch window, health checks, smoke tests, real request evidence, and a decision path for keeping, rolling back, or fixing forward.

---

**References**

- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common)
- [Use Key Vault references for App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
- [Managed identities in App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity)
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Revisions in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
