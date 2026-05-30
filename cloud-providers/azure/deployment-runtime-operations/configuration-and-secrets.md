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

The release question asks how the secret reaches the running app:

| Question | Why it matters |
| --- | --- |
| Which secret name does the app reference? | A secret can exist while the environment variable points elsewhere. |
| Which revision uses the mapping? | A new revision may be needed for certain template changes. |
| Was the secret value changed separately from the image? | Rollback may need both traffic and secret state restored. |
| Does the app log prove it loaded the expected config safely? | Saved configuration is not the same as working behavior. |

Secrets are especially easy to mishandle during rollouts because teams want to fix quickly. Avoid broad fixes like adding several duplicate secret names or temporarily hardcoding a value. Those fixes make the next release harder to reason about.

## Key Vault References

Key Vault references let an Azure app refer to a secret in Key Vault instead of storing the secret value directly in the app setting. That keeps sensitive values out of code and ordinary configuration reviews.

![An infographic showing an app setting resolving a Key Vault reference through managed identity at runtime](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration/secret-reference-resolution.png)

*Key Vault references let the runtime resolve secret values without putting plaintext secrets in code or deployment artifacts.*

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

:::expand[Pitfall: The Two-Door Key Vault Reference Failure]{kind="pitfall"}
A frustrating release error occurs when an App Service setting shows a valid Key Vault reference structure, but the application code fails to receive the resolved secret at runtime. When you inspect the Azure Portal, you might see a valid-looking setting such as `@Microsoft.KeyVault(SecretUri=https://kv-prod.vault.azure.net/secrets/db-pass/)`, suggesting the pointer is shaped correctly. Yet the booted application throws database connection errors because the platform could not resolve the value successfully for that app instance.

This is the "two-door" configuration hazard. Door 1 is the syntax of the reference pointer, which only proves that the path is well-formed. Door 2 is the actual data-plane authorization and network connectivity. If the App Service's managed identity lacks the required Key Vault data-plane role, or if the Key Vault's private network firewall blocks requests from the App Service path, App Service cannot resolve the reference. The result is a runtime configuration failure even though the deployment itself succeeded.

This identical trap exists in AWS ECS and Lambda. If you reference a secret from AWS Secrets Manager or a parameter from SSM Parameter Store in your task definition, the ECS agent must have both the `secretsmanager:GetSecretValue` permission and the corresponding KMS key decryption permission in its Task Execution Role. If either permission is missing, or if VPC security groups block the path, the container will either fail to boot or receive blank environment variables.

The top-down diagram below maps the two doors required for a successful Key Vault reference:

```mermaid
flowchart TD
    AppService["App Service Container Boot"] -->|"1. Parse App Settings"| Door1{"Door 1: Syntax Valid?"}

    Door1 -->|"No"| Fail1["Literal Reference Injected (Syntax Error)"]
    Door1 -->|"Yes"| Door2{"Door 2: Decryption Authorized?"}

    Door2 -->|"No (Missing RBAC or VNet Block)"| Fail2["Reference Resolution Fails"]
    Door2 -->|"Yes"| Decrypt["App Service resolves secret value"]

    Decrypt -->|"3. Injects Raw Password"| Code["App Code reads decrypted value in RAM"]
```

**Rule of thumb:** Never assume a green checkmark in the Azure Portal guarantees that your application can read the secret. Always verify that your compute's active managed identity has a verified `Key Vault Secrets User` role assignment, and test that your app can open database sockets successfully during your rollout's watch window.
:::

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

![An infographic showing an App Service package swapping while sticky settings remain attached to each slot](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration/slot-sticky-settings-map.png)

*Slot-sticky settings stay with the slot during a swap, which prevents staging-only values from accidentally becoming production values.*

Imagine `staging` has a feature flag used only for pre-production smoke tests. If that flag moves into production during a swap, the production app may behave in a way the team did not intend. Now imagine the production slot has the production storage account. If that value moves away from production unexpectedly, checkout may write receipts to the wrong account.

Use sticky settings to protect environment-specific values. But do not rely on memory. Before a swap, the release record should name the values that stay with the slot and the values that move with the version.

```text
Swap check:
  Moves with candidate: APP_VERSION, image/package version
  Stays with production slot: ORDERS_DB_SERVER, RECEIPTS_STORAGE_ACCOUNT, Key Vault references
  Verify after swap: checkout smoke test, Application Insights telemetry
```

The exact choices depend on the app. The habit is stable: know which values are part of the candidate and which values are part of the environment.

:::expand[Pattern: The Sticky Settings Manifest]{kind="pattern"}
A common slot swap disaster occurs when a team relies on memory to configure which App Service settings are "slot-sticky" (staying with the environment) and which are "mutable" (moving with the code version). If an engineer forgets to mark a critical database endpoint like `ORDERS_DB_SERVER` as sticky, a subsequent slot swap will accidentally pull the staging connection string into the production slot, causing the production application to write live customer orders to the staging database.

To eliminate this human error, adopt **The Sticky Settings Manifest** pattern. Rather than setting slot stickiness manually in the Azure Portal, declare the sticky state of your settings as version-controlled code inside your Bicep or Terraform templates. In Bicep, you configure this using the `Microsoft.Web/sites/config` resource with the `slotConfigNames` property:

```bicep
resource siteConfig 'Microsoft.Web/sites/config@2022-03-01' = {
  name: 'slotConfigNames'
  parent: appService
  properties: {
    appSettingNames: [
      'ORDERS_DB_SERVER'
      'RECEIPTS_STORAGE_ACCOUNT'
      'APPINSIGHTS_CONNECTION_STRING'
    ]
  }
}
```

This manifest guarantees that the specified settings remain anchored to their physical slot during every swap. Any environment-specific credentials or logging connection strings are locked, while version-related settings (like `APP_VERSION`) are allowed to travel with the candidate code.

This pattern is equivalent to separating task-level variables from environment-level variables on AWS. In AWS, you do not swap compute environments; you deploy immutable task definitions. To keep environment variables stable, you reference path-scoped SSM Parameter Store hierarchies (such as `/dev/orders/db` vs `/prod/orders/db`) based on the target account, preventing deployment packages from carrying hardcoded environment parameters.

The top-down diagram below illustrates how a sticky manifest anchors configurations during a slot swap:

```mermaid
flowchart TD
    subgraph PreSwap["1. Pre-Swap State"]
        StagingSlot["Staging Slot (v2)"] -->|"ORDERS_DB_SERVER=db-staging"| StagingDB[("Staging Database")]
        ProdSlot["Production Slot (v1)"] -->|"ORDERS_DB_SERVER=db-prod"| ProdDB[("Production Database")]
    end

    subgraph SwapWithManifest["2. Swap Swaps CODE only"]
        StagingSlot2["Staging Slot (v1)"] -->|"ORDERS_DB_SERVER=db-staging"| StagingDB
        ProdSlot2["Production Slot (v2)"] -->|"ORDERS_DB_SERVER=db-prod"| ProdDB
    end

    SwapWithManifest ---|"Sticky Manifest Anchors Database Settings!"| PreSwap
```

**Rule of thumb:** Never configure slot settings manually in the Azure Portal. Always declare your slot-sticky settings explicitly inside a version-controlled Bicep `slotConfigNames` block, ensuring that environment boundaries are hard-gated by your deployment pipeline.
:::

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

![An infographic showing runtime configuration flowing through app settings, Key Vault references, managed identity, slot sticky settings, and config rollback](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration/runtime-configuration-map.png)

*Use this as the runtime configuration map: keep non-secret settings, secret references, identity, slot behavior, and rollback controls separate so configuration changes stay reversible.*


---

**References**

- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common)
- [Use Key Vault references for App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
- [Managed identities in App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity)
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Revisions in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
