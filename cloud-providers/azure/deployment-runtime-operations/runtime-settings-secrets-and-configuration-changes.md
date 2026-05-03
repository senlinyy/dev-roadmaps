---
title: "Runtime Settings, Secrets, and Configuration Changes"
description: "Manage Azure app settings, environment variables, secrets, Key Vault references, and managed identity as part of release safety."
overview: "A healthy artifact can fail when runtime configuration changes. This article teaches how Azure app settings, Container Apps secrets, Key Vault references, and managed identity affect releases."
tags: ["app-settings", "secrets", "key-vault", "managed-identity"]
order: 3
id: article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration
---

## Table of Contents

1. [Config Can Break A Good Build](#config-can-break-a-good-build)
2. [If You Know AWS Runtime Config](#if-you-know-aws-runtime-config)
3. [Settings Are Runtime Promises](#settings-are-runtime-promises)
4. [App Service App Settings Become Environment Variables](#app-service-app-settings-become-environment-variables)
5. [Container Apps Uses Environment Variables And Secrets](#container-apps-uses-environment-variables-and-secrets)
6. [Key Vault References Keep Secret Values Out Of App Code](#key-vault-references-keep-secret-values-out-of-app-code)
7. [Managed Identity Must Be Part Of The Release Check](#managed-identity-must-be-part-of-the-release-check)
8. [Config Changes Need Their Own Rollback Plan](#config-changes-need-their-own-rollback-plan)
9. [Failure Modes And First Checks](#failure-modes-and-first-checks)
10. [A Practical Runtime Config Review](#a-practical-runtime-config-review)

## Config Can Break A Good Build

The image did not change, the tests still pass, and the app still starts on a developer machine. Production still breaks.

That often means configuration changed.

Configuration means the values the app receives from its runtime rather than from source code. Database names, storage account names, feature flags, API endpoints, telemetry settings, and secret references all count as configuration.

Secrets are sensitive configuration values, such as passwords, connection strings, API keys, or private tokens. Runtime settings are the values Azure gives the app when it starts.

This distinction matters because a release can fail even when the artifact is good.

`devpolaris-orders-api` may need these values:

```text
NODE_ENV=production
ORDERS_DB_SERVER=devpolaris-prod-sql.database.windows.net
ORDERS_DB_NAME=orders
RECEIPTS_STORAGE_ACCOUNT=devpolarisprodorders
APPLICATIONINSIGHTS_CONNECTION_STRING=<from environment>
PAYMENT_PROVIDER_BASE_URL=https://payments.example.internal
```

The code can be correct and still fail if `ORDERS_DB_NAME` is missing. It can fail if the managed identity cannot read a Key Vault secret. It can fail if staging and production settings swap by accident.

This article teaches runtime configuration as part of deployment safety, not as a separate admin chore.

## If You Know AWS Runtime Config

If you know AWS, the familiar ideas are Parameter Store, Secrets Manager, IAM roles, ECS task environment variables, Lambda environment variables, and CloudWatch configuration evidence. Azure has similar patterns with different names.

| AWS idea you may know | Azure idea to compare first | Shared release question |
|---|---|---|
| ECS task environment variables | Container Apps environment variables | What values does the container receive at startup? |
| Lambda environment variables | App Service app settings or function app settings | Which runtime values are injected into code? |
| Secrets Manager | Key Vault | Where should sensitive values live? |
| IAM role for a task or function | Managed identity | Which Azure identity does the app use at runtime? |
| Parameter Store config | App settings or external config source | Which non-secret values can change without rebuilding? |

The useful habit is:

> Separate artifact changes from runtime value changes.

If you change both at once, debugging becomes harder. When a release fails, you do not know whether the image is bad, the config is wrong, or the identity permission changed.

Sometimes changing both is necessary. When it is, write that down in the release record.

## Settings Are Runtime Promises

Every required setting is a promise from the runtime to the app.

The app says, "I will look for `ORDERS_DB_NAME`." The runtime says, "I will provide `ORDERS_DB_NAME` before the app starts."

If that promise is broken, the app should fail clearly. That is better than starting half-broken.

For `devpolaris-orders-api`, the startup check might validate required settings:

```text
startup config check
  NODE_ENV: ok
  ORDERS_DB_SERVER: ok
  ORDERS_DB_NAME: missing
  RECEIPTS_STORAGE_ACCOUNT: ok
  APPLICATIONINSIGHTS_CONNECTION_STRING: ok

result: fail fast before accepting traffic
```

Failing fast means the app refuses to run when a required condition is missing. That can feel harsh, but it protects users.

The dangerous alternative is an app that starts, receives traffic, then fails only when checkout touches the missing setting.

Runtime settings also need names that humans can understand:

- `DB` is vague. `ORDERS_DB_NAME` is better.
- `SECRET` is vague. `PAYMENT_PROVIDER_API_KEY` is better, though the value itself should not be logged.

Good names make release reviews easier.

## App Service App Settings Become Environment Variables

In Azure App Service, app settings are passed to the application as environment variables. That means Node.js code can read them through `process.env`.

The exact setup path can be portal, CLI, infrastructure as code, or deployment tooling. The important release idea is that App Service app settings are part of the runtime contract.

If the team deploys `devpolaris-orders-api` to App Service, it should review app settings as part of release safety.

For example:

```text
App Service app settings
  NODE_ENV=production
  ORDERS_DB_SERVER=devpolaris-prod-sql.database.windows.net
  ORDERS_DB_NAME=orders
  RECEIPTS_STORAGE_ACCOUNT=devpolarisprodorders
  FEATURE_RECEIPT_RETRY=true
```

Some values are safe to store as plain app settings. Some are secrets and should use Key Vault or another secret-management path.

The difference is not always technical. It is also about audit, rotation, and access. A feature flag may be a normal setting. A database password is a secret. A managed identity client ID may be configuration, but the permission behind it is still security-sensitive.

If deployment slots are used, some settings should be slot-specific. Production should keep production database settings. Staging should keep staging database settings. Do not let a slot swap move environment-specific values into the wrong slot.

## Container Apps Uses Environment Variables And Secrets

Azure Container Apps also gives containers environment variables, and the app reads them like normal environment variables.

Container Apps also has secrets at the application level. Those secrets can be referenced by revisions.

One important Container Apps detail is that not every change creates a new revision. Changing a container image is revision-scoped and creates a new revision. Changing secret values is application-scoped and does not automatically create a new revision.

Existing revisions may need a restart or a new revision to pick up updated secret values. This matters during release and rollback.

Imagine the team rotates `PAYMENT_PROVIDER_API_KEY`. The image does not change, but the secret value changes. The app may need a restart or new revision before the running container sees the new value, depending on how the secret is referenced and deployed.

Here is a release note that makes the distinction clear:

```text
service: devpolaris-orders-api
runtime: Azure Container Apps
artifact changed: false
secret changed: PAYMENT_PROVIDER_API_KEY
identity changed: false
runtime action: restart active revision after secret update
verification: fake payment authorization succeeds
rollback: restore previous secret version and restart revision
```

That is a runtime operation, not a code deployment. Treat it with the same care.

## Key Vault References Keep Secret Values Out Of App Code

Azure Key Vault is the Azure service for storing secrets, keys, and certificates. A Key Vault reference lets an app setting or Container Apps secret point to a Key Vault secret instead of embedding the secret value directly.

The app can read the setting like a normal runtime value, while the secret value is managed outside the app code.

That separation helps with rotation, keeps secret values out of source control, gives security teams a clearer audit point, and lets access be controlled through Azure identity and Key Vault permissions.

For App Service, a Key Vault reference may appear as the value of an app setting. For Container Apps, a secret can reference a Key Vault secret when managed identity and permission are configured.

The beginner lesson is not the exact reference syntax. The lesson is that the app setting name remains stable, while the secret value can be managed in Key Vault.

For `devpolaris-orders-api`:

```text
setting name: PAYMENT_PROVIDER_API_KEY
value source: Key Vault secret
app code reads: process.env.PAYMENT_PROVIDER_API_KEY
release risk: managed identity cannot read secret, or secret version changed unexpectedly
```

This is why secret references are both deployment and identity topics. The setting can exist, the secret can exist, and the app can still fail if its managed identity lacks permission to read the secret.

## Managed Identity Must Be Part Of The Release Check

Managed identity lets an Azure resource get an Azure identity without storing a credential in the app. For deployment and runtime operations, managed identity often decides whether the app can read Key Vault, access Blob Storage, or call another Azure service.

That means identity is part of release safety.

If `devpolaris-orders-api` runs in Container Apps and uses managed identity to read Key Vault, the release needs to check:

- Is the identity enabled on this app?
- Does Key Vault allow this identity to read the secret?
- Does the storage account allow this identity to write receipt blobs?
- Are staging and production identities separate?
- Did we accidentally grant staging access to production secrets?

Here is a realistic failure:

```text
2026-05-03T19:42:10.451Z ERROR service=devpolaris-orders-api
operation=startup-config
message="failed to resolve PAYMENT_PROVIDER_API_KEY"
source=key-vault
error="Forbidden"
identity="devpolaris-orders-api-prod"
```

The app setting may be correct, and the Key Vault secret may be correct. The missing piece is permission.

That is why runtime config review includes identity review. For beginners, this is one of the most important cloud lessons:

> Secret names and secret access are different things.

The app can know the name and still be denied.

## Config Changes Need Their Own Rollback Plan

Config changes should have rollback targets. That sounds obvious after the first outage, but it is easy to forget before then.

If a feature flag breaks checkout, rollback may mean turning the flag off. If a Key Vault secret rotation breaks payment calls, rollback may mean restoring the previous secret version. If a storage account name changes incorrectly, rollback may mean restoring the previous app setting. If a managed identity permission was removed, rollback may mean restoring the role assignment.

These are not all the same operation, so the release record should name the rollback action.

For example:

```text
config change: FEATURE_RECEIPT_RETRY=true
risk: retry loop may increase Blob Storage calls
verification: receipt upload succeeds and dependency calls stay normal
rollback: set FEATURE_RECEIPT_RETRY=false and restart app if needed
```

For a secret rotation:

```text
config change: PAYMENT_PROVIDER_API_KEY now references Key Vault version 2026-05-03
risk: payment provider rejects new key
verification: fake payment authorization succeeds
rollback: restore previous secret version and force app to refresh or restart
```

The words "if needed" should be used carefully. Some runtime systems need restart or revision change before a setting takes effect. The team should know which one applies.

## Failure Modes And First Checks

Runtime config failures are easier to debug when the team names the symptom first.

| Symptom | First check |
|---|---|
| The app starts locally but fails in Azure | Required app settings, environment variable names, and whether Azure passes them to the app |
| The app fails only after slot swap | Slot-specific settings and whether staging values moved to production or production values moved to staging |
| The app cannot read Key Vault | Managed identity, Key Vault permissions, network restrictions, and secret reference status |
| The app still uses the old secret after rotation | Runtime caching, restart or refresh behavior, and whether the app references a specific secret version |
| The Container Apps revision keeps running with old config | Whether the change was revision-scope or application-scope, and whether the revision was restarted or recreated |
| The feature flag changed but behavior did not | Spelling, environment, config refresh behavior, and whether the flag is read only at startup |

Here is the same idea as a compact release table.

| Symptom | First check |
|---|---|
| Missing variable at startup | App setting or environment variable name |
| Works in staging, fails after swap | Slot-specific setting review |
| Secret reference shows forbidden | Managed identity and Key Vault access |
| Secret rotation not picked up | Refresh, restart, or new revision behavior |
| Blob upload now denied | Managed identity role assignment on storage |
| Telemetry missing after deploy | Application Insights setting or connection string |

The common thread is simple:

> Config failures are runtime failures.

Debug them as runtime failures, not as mysterious code bugs.

## A Practical Runtime Config Review

Before a release, ask what configuration changed. If the answer is "nothing," confirm it. If the answer is "something," name it.

For `devpolaris-orders-api`, use this review:

```text
service: devpolaris-orders-api
runtime: Container Apps
artifact changed: devpolaris.azurecr.io/orders-api:4c91b7f
settings changed:
  FEATURE_RECEIPT_RETRY=true
secrets changed:
  none
identity changed:
  none
slot or revision impact:
  new revision uses same secret references
verification:
  startup config check passed
  fake checkout succeeded
  receipt upload dependency succeeded
rollback:
  route traffic to previous revision
  no config rollback required
```

When config does change, make it explicit:

```text
settings changed:
  RECEIPTS_STORAGE_ACCOUNT=devpolarisprodorders2
verification:
  GET /health checks Blob Storage access
  fake receipt upload writes to expected account
rollback:
  restore RECEIPTS_STORAGE_ACCOUNT=devpolarisprodorders
  restart app after setting change
```

This habit prevents a lot of "but the code did not change" confusion.

Azure runtime settings are part of production. Treat them like code in the release conversation, even when they live outside the repository.

---

**References**

- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common) - Microsoft explains App Service app settings and how they are exposed to application code.
- [Environment variables and app settings in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings) - Microsoft documents App Service environment variables and app setting behavior.
- [Use Key Vault references as app settings](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) - Microsoft explains Key Vault references for App Service, Functions, and Logic Apps Standard.
- [Manage environment variables on Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/environment-variables) - Microsoft explains environment variable behavior for Container Apps.
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) - Microsoft explains Container Apps secrets, Key Vault references, and revision behavior around secret changes.
- [Managed identities in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity) - Microsoft explains how Container Apps can use managed identities to access Azure resources.
