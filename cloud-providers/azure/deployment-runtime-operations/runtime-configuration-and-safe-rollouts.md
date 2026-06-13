---
title: "Runtime Configuration and Safe Rollouts"
description: "Manage Azure app settings, Key Vault references, managed identity, slots, revisions, traffic splitting, and config rollback as one release workflow."
overview: "A safe Azure rollout needs more than a candidate artifact. This article explains how runtime configuration and controlled traffic movement work together so a team can test a version, expose it gradually, and recover when a setting or candidate behaves badly."
tags: ["configuration", "secrets", "slots", "revisions", "traffic-splitting"]
order: 2
id: article-cloud-providers-azure-deployment-runtime-operations-runtime-settings-secrets-configuration
aliases:
  - runtime-configuration-and-safe-rollouts
  - configuration-and-secrets
  - safe-rollouts
  - runtime-settings-secrets-and-configuration-changes
  - deployment-slots-revisions-and-safe-rollouts
  - article-cloud-providers-azure-deployment-runtime-operations-slots-revisions-safe-rollouts
  - cloud-providers/azure/deployment-runtime-operations/runtime-settings-secrets-and-configuration-changes.md
  - cloud-providers/azure/deployment-runtime-operations/deployment-slots-revisions-and-safe-rollouts.md
  - cloud-providers/azure/deployment-runtime-operations/configuration-and-secrets.md
  - cloud-providers/azure/deployment-runtime-operations/safe-rollouts.md
---

## Table of Contents

1. [What This Article Covers](#what-this-article-covers)
2. [Runtime Configuration](#runtime-configuration)
3. [App Settings and Connection Values](#app-settings-and-connection-values)
4. [How To Change App Settings](#how-to-change-app-settings)
5. [Feature Flags In Real Teams](#feature-flags-in-real-teams)
6. [Key Vault References](#key-vault-references)
7. [Container Apps Secrets](#container-apps-secrets)
8. [How To Wire Secrets Into A Runtime](#how-to-wire-secrets-into-a-runtime)
9. [Config Rollback](#config-rollback)
10. [How To Restore Config](#how-to-restore-config)
11. [Candidate Version](#candidate-version)
12. [App Service Slots](#app-service-slots)
13. [How To Use Slots For A Release](#how-to-use-slots-for-a-release)
14. [Traffic Splitting](#traffic-splitting)
15. [How To Move Container Apps Traffic](#how-to-move-container-apps-traffic)
16. [Rollback Shape](#rollback-shape)
17. [Putting It All Together](#putting-it-all-together)
18. [What's Next](#whats-next)

## What This Article Covers
<!-- section-summary: Runtime settings and rollout controls belong in the same release conversation because both decide what users experience. -->

The previous article named the release pieces: artifact, runtime, infrastructure, configuration, identity, traffic, health, rollback, and release record. This article zooms into the two pieces that create many production surprises in Azure: **runtime configuration** and **safe rollout controls**.

We will keep using `devpolaris-orders-api`, the checkout API from the first article. The team has a candidate container image with a new receipt retry feature. The image runs successfully in Azure Container Apps, but the feature depends on runtime values: the feature flag, the storage account target, the Application Insights connection string, and the managed identity permissions for storage and Key Vault.

This article has two connected halves. First, we talk about **app settings**, **connection values**, **Key Vault references**, **Container Apps secrets**, and **config rollback**. Then we talk about **candidate versions**, **App Service slots**, **Container Apps revisions**, **traffic splitting**, and **rollback shape**. In real releases, those halves meet because a rollout only stays safe when the candidate and its runtime values move together.

## Runtime Configuration
<!-- section-summary: Runtime configuration is the environment-specific state that the application reads after Azure starts it. -->

**Runtime configuration** is the set of values your application receives from the hosting platform while it runs. These values usually include environment variables, app settings, connection strings, feature flags, service endpoints, secret references, telemetry connection strings, and sometimes platform settings such as scale or probes.

The important idea is that runtime configuration changes behavior while the team reuses the same artifact. The same container image can run in staging with a staging database and in production with a production database. The same App Service package can run with a feature flag off in production and on in a staging slot. The code stays the same, while the runtime values decide which outside systems the code reaches.

For `devpolaris-orders-api`, the candidate image contains the receipt retry code. These runtime values decide what the code actually does, so the release owner should read them with the same care as the image digest:

```yaml
CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
ORDERS_DB_SERVER: sqldevpolarisprod.database.windows.net
RECEIPTS_STORAGE_ACCOUNT: stdevpolarisprodreceipts
APPLICATIONINSIGHTS_CONNECTION_STRING: "@Microsoft.KeyVault(SecretUri=https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders)"
```

Each value carries release risk. If `CHECKOUT_RECEIPT_RETRY_ENABLED` turns on the new branch too early, the team may send every checkout request through code that only saw staging traffic. If `RECEIPTS_STORAGE_ACCOUNT` points to a staging account, receipt uploads can succeed technically while production receipts land in the wrong place. If the Application Insights connection string fails to resolve, the team loses the telemetry needed during the watch window.

This is why runtime configuration deserves the same review as the image digest. A release record that names the candidate image but leaves settings vague gives the team only half the production story. The artifact tells us which code runs. Configuration tells us what that code connects to and which branches it takes. The most common Azure place for these values is app settings.

## App Settings and Connection Values
<!-- section-summary: App settings are Azure-managed environment values, and changing them can restart or reshape runtime behavior. -->

**App settings** are name-value pairs that Azure exposes to the running application as environment variables. App Service, Azure Functions, and Container Apps all have configuration surfaces that eventually become values the process can read at runtime. The exact portal page and deployment command differ by runtime, but the application usually reads the values through normal language APIs such as `process.env` in Node.js or `Environment.GetEnvironmentVariable` in .NET.

For a beginner, app settings are the cloud version of local `.env` values with extra production behavior around encryption, deployment slots, restarts, revisions, and platform ownership. The app code might read `CHECKOUT_RECEIPT_RETRY_ENABLED`, while Azure stores the production value. When the team changes that value, the same build can take a different path.

Here is a small Node.js example from the orders API. The same deployed code changes behavior based on the values Azure injects at runtime:

```js
const retryEnabled = process.env.CHECKOUT_RECEIPT_RETRY_ENABLED === "true";
const receiptsAccount = process.env.RECEIPTS_STORAGE_ACCOUNT;

export async function uploadReceipt(orderId, receiptBody) {
  if (retryEnabled) {
    return uploadReceiptWithRetry(receiptsAccount, orderId, receiptBody);
  }

  return uploadReceiptOnce(receiptsAccount, orderId, receiptBody);
}
```

This code looks simple, but the production behavior depends on values outside the code. A release review should name the old value, the new value, and the expected user effect. The team should keep secret values out of the record and still record targets and intent so people can reason during rollout.

```yaml
settings_review:
  CHECKOUT_RECEIPT_RETRY_ENABLED:
    old: "false"
    new: "true"
    expected_effect: checkout receipt upload uses retry branch
  RECEIPTS_STORAGE_ACCOUNT:
    old_target: stdevpolarisprodreceipts
    new_target: stdevpolarisprodreceipts
    expected_effect: production receipts stay in production storage
  ORDERS_DB_SERVER:
    old_target: sqldevpolarisprod.database.windows.net
    new_target: sqldevpolarisprod.database.windows.net
    expected_effect: checkout writes remain on production SQL
```

Connection strings are the same kind of release concern. App Service has a separate connection strings area because many frameworks understand those names and formats. In production review, the point stays practical: connection values can move a runtime to a different database, queue, cache, or telemetry resource while the code stays unchanged.

App Service app setting changes restart the app. Azure does this so the running process receives the new environment. Container Apps also needs running containers to observe new values through a new revision, restart, or other runtime update path depending on whether the change is revision-scoped or application-scoped. Because settings can restart workloads, a config-only release still deserves a watch window.

Some settings hold harmless values such as feature flags and public endpoints. Secrets need a different treatment because a leak can turn a routine config review into a security incident.

## How To Change App Settings
<!-- section-summary: Changing runtime settings starts with reading the current value, setting the new value, and confirming the runtime received it. -->

The practical workflow for app settings has three parts: read the current value, apply the intended change, then verify the app is running with the new value. For App Service, the release owner can read the current production value and then set the feature flag. App Service recycles the app after app setting updates, so the watch window should expect a restart.

```bash
az webapp config appsettings list \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[?name=='CHECKOUT_RECEIPT_RETRY_ENABLED']" \
  --output table

az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --settings CHECKOUT_RECEIPT_RETRY_ENABLED=true
```

If the app uses a staging slot, the release owner usually changes and tests the setting on the staging slot first. That gives the team a real host name where the candidate can be tested before production receives traffic.

```bash
az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --slot staging \
  --settings CHECKOUT_RECEIPT_RETRY_ENABLED=true
```

For Container Apps, environment variable changes live in the app template and can create a new revision. The release owner should give the revision a suffix so it can be named in traffic rules and telemetry.

```bash
az containerapp update \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-suffix v31-config \
  --set-env-vars CHECKOUT_RECEIPT_RETRY_ENABLED=true

az containerapp revision list \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[].{name:name,active:active,trafficWeight:trafficWeight}" \
  --output table
```

This is the missing "how" for app settings. The release owner reads the current value, changes the setting in the right runtime or slot, and checks which revision or slot now contains the value. The next step is secret handling, because some runtime values should point to Key Vault rather than carry the secret directly.

## Feature Flags In Real Teams
<!-- section-summary: Feature flags are runtime controls that let a team release code separately from enabling behavior for users. -->

A feature flag is a runtime decision point. The code contains both paths, and the flag decides which path runs for a request, tenant, cohort, region, or environment. Teams use this pattern heavily with Azure because it lets them deploy a candidate artifact while keeping risky behavior off, then enable the behavior gradually after the runtime is healthy.

Azure App Configuration is one Azure-native place to store feature flags, and many teams use a broader flag platform such as LaunchDarkly, Unleash, ConfigCat, or a homegrown service. **OpenFeature** is the industry-standard API layer that can sit between application code and the flag provider, so the application code asks for a flag value without being tightly coupled to one vendor. The important release habit is the same across providers: the flag key, default value, rollout rule, owner, and rollback action should be visible before production traffic moves.

Here is how the orders API can read a flag through OpenFeature. The provider setup happens during application startup, and the request handler asks for the flag with a safe default. If the flag provider is unavailable, the default keeps receipt retry off rather than surprising production traffic.

```js
import { OpenFeature } from "@openfeature/server-sdk";

const featureClient = OpenFeature.getClient();

export async function shouldRetryReceiptUpload(user) {
  return featureClient.getBooleanValue("checkout.receiptRetry", false, {
    userId: user.id,
    tenant: user.tenant,
    environment: "production"
  });
}
```

The release record should treat a flag change as a production change. This example names the source of truth, the default behavior, the rollout rule, the owner, and the recovery action:

```yaml
feature_flag_review:
  key: checkout.receiptRetry
  source_of_truth: Azure App Configuration
  default_value: false
  production_rule:
    enabled_for: 10 percent canary cohort
    excluded_tenants:
      - enterprise-contract-tests
  owner: platform-api-oncall
  rollback_action: disable checkout.receiptRetry
```

If the team stores flags in Azure App Configuration, the release owner can inspect and toggle the flag with Azure CLI. The exact targeting filters depend on the application and flag design, but the rollback move is deliberately simple: disable the flag and verify the application stops taking the risky branch.

```bash
az appconfig feature show \
  --name appcs-devpolaris-prod \
  --feature checkout.receiptRetry \
  --label prod \
  --auth-mode login

az appconfig feature enable \
  --name appcs-devpolaris-prod \
  --feature checkout.receiptRetry \
  --label prod \
  --auth-mode login

az appconfig feature disable \
  --name appcs-devpolaris-prod \
  --feature checkout.receiptRetry \
  --label prod \
  --auth-mode login
```

Feature flags and traffic splitting solve different rollout problems. Traffic splitting controls which runtime version receives requests, while flags control which behavior runs inside that version. A strong rollout can use both: deploy `v31` with the retry code, send 10 percent of traffic to `v31`, enable `checkout.receiptRetry` only for a small cohort, then widen either traffic or flag exposure based on the watch-window evidence.

## Key Vault References
<!-- section-summary: Key Vault references let an app setting point to a secret while the runtime identity retrieves the value. -->

**Azure Key Vault** stores secrets, keys, and certificates. A **Key Vault reference** is an app setting value that points to a Key Vault secret instead of storing the secret value directly in the app configuration. App Service and Azure Functions can resolve these references at runtime by using the app's managed identity. Container Apps can also reference Key Vault secrets through its secrets configuration when a managed identity has permission to read the secret.

This is useful because secret ownership moves away from the app setting itself. The app setting can say "use this secret in Key Vault," while the actual secret value stays in the vault. People reviewing a release can see which secret the app targets while the secret value stays hidden.

Here is the shape of an App Service Key Vault reference. The setting value points to Key Vault rather than carrying the Application Insights connection string directly:

```yaml
APPLICATIONINSIGHTS_CONNECTION_STRING: "@Microsoft.KeyVault(SecretUri=https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders)"
```

Three pieces need to line up for this to work. First, the app needs a **managed identity**. The managed identity is the Entra ID identity Azure gives to the running app. Second, Key Vault needs to allow that identity to read the secret, usually through Azure RBAC such as `Key Vault Secrets User` or through a vault access policy depending on the vault configuration. Third, the reference must point to the correct vault and secret.

For the orders API, the release review can capture the secret target and identity check like this. The record gives enough detail for verification while keeping the secret value inside Key Vault:

```yaml
secret_review:
  setting: APPLICATIONINSIGHTS_CONNECTION_STRING
  secret_uri: https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders
  runtime_identity: mi-orders-api-prod
  expected_permission: Key Vault Secrets User
  verification:
    - Key Vault reference resolves
    - telemetry appears in appi-devpolaris-prod
```

The verification lines matter because Key Vault references can fail for ordinary reasons. The managed identity may lack permission. The URI may point to the wrong vault. The secret may have a disabled version. A private endpoint or firewall setting may block the app's path to the vault. These failures can show up as startup errors, missing environment values, or broken telemetry during the release.

App Service caches Key Vault reference values and refreshes them periodically. A configuration change can also cause the app to restart and fetch values again. If a release needs a specific secret version, use a versioned secret URI and write that version into the release record. If a release should always use the latest secret version, write that expectation down too, because secret rotation and app rollout become connected.

Key Vault references help with secrets on App Service and Functions. Container Apps uses its own secret model, and that model changes how the team thinks about revisions and restarts.

## Container Apps Secrets
<!-- section-summary: Container Apps secrets are application-scoped values that containers consume through environment variables or volume mounts. -->

**Azure Container Apps secrets** are sensitive values stored on the container app and exposed to containers through environment variables or secret volumes. They are application-scoped rather than revision-scoped. That means secret definitions belong to the container app as a whole, while a revision consumes them through its container template.

This detail matters during rollout. A container image change creates a new revision because the container template changed. Many application-scope changes, including secret definitions, sit outside the revision template. Existing running revisions need a restart or a new revision path to pick up changed secret values. A safe release record should say which revision consumes which secret name and whether a restart or new revision will happen.

For the orders API running in Container Apps, the secret setup may look like this. The app consumes secret names through environment variables, while the actual values come from Key Vault:

```yaml
container_app: ca-orders-api-prod
secrets:
  appinsights-connection:
    source: Key Vault
    secret_uri: https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders
    identity: mi-orders-api-prod
  sql-connection:
    source: Key Vault
    secret_uri: https://kv-devpolaris-prod.vault.azure.net/secrets/orders-sql-connection
    identity: mi-orders-api-prod
environment_variables:
  APPLICATIONINSIGHTS_CONNECTION_STRING:
    secretRef: appinsights-connection
  ORDERS_SQL_CONNECTION:
    secretRef: sql-connection
```

The app code still reads environment variables. The platform handles secret storage and injection. The release review should confirm that the secret names match the template, the Key Vault references resolve, and the managed identity has secret read access.

Secret mistakes often look like application bugs at first. A container starts but fails to connect to Azure SQL. A telemetry connection string resolves to an old value, so errors disappear from the expected Application Insights resource. A secret name changes from `sql-connection` to `orders-sql-connection`, while the environment variable still references the old name. The application may fail only when it reaches a dependency, which makes direct smoke tests important before traffic moves.

Once settings and secrets have real release risk, the team needs a rollback plan for configuration by itself. That plan should exist before the team starts changing traffic.

## How To Wire Secrets Into A Runtime
<!-- section-summary: Secret wiring becomes concrete when the release owner sets the secret reference, maps it into the app, and verifies the app can read it. -->

For App Service, a Key Vault reference is just an app setting value with special syntax. The release owner sets the app setting to the secret URI, and the app's managed identity must have permission to read that secret.

```bash
az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --slot staging \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="@Microsoft.KeyVault(SecretUri=https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders)"
```

The verification step should happen before the slot swap. The team can call the staging health endpoint, check that telemetry reaches the expected Application Insights resource, and inspect startup logs if the setting fails to resolve. A Key Vault reference problem often appears as a missing environment value inside the app rather than as a clean Azure deployment failure.

For Container Apps, the release owner usually creates or updates a Container Apps secret and then maps an environment variable to that secret name. The secret can store a literal value or reference Key Vault through `keyvaultref` and `identityref`.

```bash
az containerapp secret set \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --secrets appinsights-connection=keyvaultref:https://kv-devpolaris-prod.vault.azure.net/secrets/appinsights-orders,identityref:/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-devpolaris-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod

az containerapp update \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-suffix v31-secrets \
  --set-env-vars APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights-connection
```

The long identity resource ID is ugly, but it is useful because it makes the runtime identity explicit. In a real runbook, the team usually stores that identity ID as a variable so the command is easier to read. After the update, the release owner checks the new revision, runs a smoke test, and confirms telemetry appears in the expected Application Insights component.

## Config Rollback
<!-- section-summary: Config rollback restores known-good runtime values when a setting or secret reference causes production trouble. -->

**Config rollback** means returning runtime values to a known-good state. It can involve a feature flag, app setting, connection string, Key Vault reference, secret version, scale value, or traffic setting. It often happens faster than rebuilding an artifact because the team can restore a value directly in the runtime configuration.

For the orders API, imagine `CHECKOUT_RECEIPT_RETRY_ENABLED` moves from `"false"` to `"true"` at the same time revision `v31` gets 10 percent traffic. Checkout failures rise, and Application Insights shows errors in the retry branch. The first safe recovery might restore the flag to `"false"` and keep traffic at 10 percent long enough to confirm that the failure came from the branch. If the candidate still misbehaves, the team can move traffic back to `v30`.

A good config rollback plan names the previous values before the change. The record below separates values that actually changed from values that stayed stable:

```yaml
config_rollback:
  CHECKOUT_RECEIPT_RETRY_ENABLED:
    current_candidate_value: "true"
    previous_stable_value: "false"
    restore_action: set value back to "false"
  APPLICATIONINSIGHTS_CONNECTION_STRING:
    current_target: appinsights-orders secret latest version
    previous_target: appinsights-orders secret version 8f20b
    restore_action: point reference back to version 8f20b if telemetry stops
  ORDERS_DB_SERVER:
    current_target: sqldevpolarisprod.database.windows.net
    previous_target: sqldevpolarisprod.database.windows.net
    restore_action: no config rollback expected
```

This plan separates values that changed from values that stayed stable. During an incident, that helps people avoid broad, nervous changes. If the database target stayed stable, the team can spend energy on the retry flag, storage path, identity access, and candidate revision instead of touching the database setting.

Configuration rollback also needs runtime awareness. In App Service, restoring an app setting can restart the app. In Container Apps, a setting inside the revision template may create a new revision, while an application-scope secret change may require restart or a new consuming revision for running containers. In both cases, the team should expect a short period where old and new runtime behavior can overlap.

After settings have a rollback path, the team can name the actual candidate version that will receive traffic. That candidate name becomes the bridge between configuration review and rollout control.

## How To Restore Config
<!-- section-summary: Restoring config means putting the previous value back in the same runtime surface and checking that the app actually uses it. -->

For App Service, feature flag rollback is a direct app setting update. The release owner restores the previous value and then watches the app restart and serve requests again.

```bash
az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --settings CHECKOUT_RECEIPT_RETRY_ENABLED=false

az webapp config appsettings list \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[?name=='CHECKOUT_RECEIPT_RETRY_ENABLED']" \
  --output table
```

For Container Apps, restoring a revision-scoped environment variable usually means creating another revision from the current template with the previous value. The release owner should name that revision and keep traffic controlled while the team verifies it.

```bash
az containerapp update \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-suffix v31-flag-off \
  --set-env-vars CHECKOUT_RECEIPT_RETRY_ENABLED=false

az containerapp revision list \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[].{name:name,active:active,trafficWeight:trafficWeight}" \
  --output table
```

Secret rollback follows the same idea. If the new Key Vault secret version breaks telemetry, the release owner points the setting or Container Apps secret back to the previous known-good versioned URI. The record should name the previous secret version before the release starts, because nobody wants to search Key Vault history while checkout is failing.

## Candidate Version
<!-- section-summary: A candidate version is the specific runtime version being evaluated before or during production exposure. -->

A **candidate version** is the specific version the team wants to evaluate for production exposure. It includes the artifact and the runtime state that runs it. In App Service, the candidate may be the staging slot that holds the new package and slot settings. In Container Apps, the candidate may be a revision with a particular image digest, environment variables, scale rules, and probes.

The word "candidate" is useful because it reminds the team that deployment and exposure can happen in stages. The candidate can exist, start, pass direct checks, and still receive zero production traffic. That gives the team room to inspect it before users depend on it.

For Container Apps, a candidate record should name the revision. The revision gives the team a specific runtime object to test and watch:

```yaml
candidate:
  platform: Azure Container Apps
  app: ca-orders-api-prod
  revision: orders-api--v31
  image: acrdevpolaris.azurecr.io/orders-api@sha256:8a7b2f42c49d
  traffic: 0
  direct_checks:
    - startup probe passed
    - readiness probe passed
    - direct revision smoke test passed
```

For App Service, the candidate record should name the slot. The slot gives the team a live host name for validation before production exposure:

```yaml
candidate:
  platform: Azure App Service
  app: app-orders-api-prod
  candidate_slot: staging
  production_slot: production
  package: orders-api-v31.zip
  direct_checks:
    - staging slot responds on its host name
    - checkout smoke test passes against staging slot
    - Key Vault references resolve in staging slot
```

Direct checks should match the release risk. A receipt retry release needs a smoke test that exercises checkout and receipt upload. A telemetry settings release needs proof that requests and exceptions reach the expected Application Insights resource. A Key Vault reference change needs proof that the app can read the secret using its managed identity.

Once the candidate is named, App Service gives a common rollout tool: deployment slots. Slots are the App Service version of preparing a candidate beside production before the final traffic move.

## App Service Slots
<!-- section-summary: App Service slots let a team run a candidate beside production and swap traffic after direct validation. -->

**App Service deployment slots** are live apps attached to the same App Service app. A common setup has a production slot and a staging slot. Each slot has its own host name, so the team can deploy the candidate to staging, warm it up, run tests against the staging URL, and then swap it with production.

Slots are powerful because they separate candidate preparation from production exposure. The orders API can run `v31` in the staging slot while production still serves `v30`. The team can verify startup, Key Vault references, database connectivity, and smoke tests through the staging host name. When the team swaps, Azure exchanges the slot content and configuration according to the swap rules.

Slot settings need attention. Some settings should move with the app during a swap. Other settings should stay attached to the slot. Azure calls those **slot settings** or **deployment slot settings**. For example, `ORDERS_DB_SERVER` might stay slot-specific so the staging slot keeps pointing at staging data during tests, while production keeps pointing at production data. A setting that accidentally swaps into production can cause a very real outage.

Here is a slot review. It records the package, database target, sticky settings, and checks that must pass before swap:

```yaml
app_service_slots:
  app: app-orders-api-prod
  production_slot:
    package: orders-api-v30.zip
    ORDERS_DB_SERVER: sqldevpolarisprod.database.windows.net
  staging_slot:
    package: orders-api-v31.zip
    ORDERS_DB_SERVER: sqldevpolarisprod.database.windows.net
    CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
  sticky_settings:
    - APPLICATIONINSIGHTS_CONNECTION_STRING
    - ORDERS_DB_SERVER
  pre_swap_checks:
    - staging host responds
    - Key Vault references resolve
    - checkout smoke test passes
```

The production database target in this example stays production because the team wants a production-like final validation before swap. Another team may keep staging pointed at a staging database until the final moment. The key is that the release record says which choice the team made and why. Hidden assumptions around slot settings cause painful swaps.

Swaps also give a rollback shape. If production hurts after the swap, the team can swap back to the previous slot state, assuming the old version and compatible configuration remain available. The next article will talk about the verification and decision side of that move.

Container Apps uses revisions and traffic weights rather than slots, so the safe rollout shape looks different there. The team still prepares a candidate first, then controls exposure through traffic percentages.

## How To Use Slots For A Release
<!-- section-summary: A slot release has a concrete sequence: deploy to staging, set staging config, test staging, swap, and keep the old slot ready. -->

An App Service slot release is a step-by-step workflow. The team deploys the candidate to staging, sets or checks staging configuration, runs a smoke test against the staging host, swaps staging into production, then keeps the previous production state available for rollback.

```bash
az webapp deployment slot list \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[].{name:name,host:defaultHostName,state:state}" \
  --output table

az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --slot staging \
  --settings CHECKOUT_RECEIPT_RETRY_ENABLED=true

curl -fsS https://app-orders-api-prod-staging.azurewebsites.net/healthz
```

After staging passes the health check and smoke test, the release owner swaps staging into production. The `--slot staging --target-slot production` command means "move the staging slot into the production target."

```bash
az webapp deployment slot swap \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --slot staging \
  --target-slot production
```

The old production version now sits on the other side of the swap. That is why the release owner should avoid deleting or overwriting the staging slot immediately after the swap. Keeping it available gives the team a direct swap-back path during the watch window.

## Traffic Splitting
<!-- section-summary: Traffic splitting exposes a candidate to a controlled percentage of users before full promotion. -->

**Traffic splitting** means sending only part of production traffic to a candidate. Azure Container Apps supports traffic splitting across active revisions when the app uses multiple revision mode. App Service can route a percentage of traffic to slots. The release idea stays the same: the team controls exposure while it watches health evidence.

For Container Apps, a rollout might start with the stable revision at 100 percent and the candidate at 0 percent. That first state lets the team test the candidate directly before users reach it:

```yaml
traffic_step_0:
  orders-api--v30: 100
  orders-api--v31: 0
```

After direct checks pass, the team sends a small percentage to the candidate. This first exposure is where the watch window starts:

```yaml
traffic_step_1:
  orders-api--v30: 90
  orders-api--v31: 10
watch_window: 20 minutes
```

If the candidate stays healthy, the team can continue. Each increase should have its own watch window rather than one big jump to full traffic:

```yaml
traffic_step_2:
  orders-api--v30: 50
  orders-api--v31: 50
watch_window: 30 minutes
```

The important part is the decision rule attached to each step. A traffic percentage with no watch window turns into a slow version of "hope." A traffic percentage with signals gives the team a clear checkpoint: request failures, p95 latency, Azure SQL dependency failures, receipt upload failures, exceptions, and customer support signals.

Traffic splitting has a real production tradeoff. A 10 percent canary reduces blast radius, but it also means some users see the candidate while others see the stable version. If the release changes API responses, database writes, cache keys, or message formats, the team must confirm old and new versions can run side by side. For the orders API, `v30` and `v31` both need to understand the same order records and receipt storage layout while traffic is split.

Many Azure teams run this same idea through Kubernetes tooling on AKS. Helm or Kustomize often packages the manifests, while Argo Rollouts, Flagger, ingress controllers, or a service mesh can drive canary and blue-green behavior. App Service slots and Container Apps revision weights remain useful in the same family of controls. The release principle is portable: prepare a candidate, expose it gradually, watch agreed signals, and keep the recovery move ready in the platform that actually routes traffic.

Traffic splitting gives the team control over exposure. The rollback shape tells the team how to recover from each exposure level.

## How To Move Container Apps Traffic
<!-- section-summary: Container Apps traffic movement uses revision weights, and the release owner should show the split before and after each change. -->

For Container Apps, traffic movement is a command against revision weights. The release owner first shows the current split, then changes the weights, then shows the split again. That before-and-after check prevents a lot of confusion during a release.

```bash
az containerapp ingress traffic show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --output table

az containerapp ingress traffic set \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-weight orders-api--v30=90 orders-api--v31=10

az containerapp ingress traffic show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --output table
```

Promotion is the same command with different weights. If the 10 percent watch window stays healthy, the team can move to 50 percent. If that stays healthy, the team can move to 100 percent. Each step should create a release record entry with time, weights, owner, and the evidence that allowed the next move.

```bash
az containerapp ingress traffic set \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-weight orders-api--v30=50 orders-api--v31=50

az containerapp ingress traffic set \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-weight orders-api--v31=100
```

Rollback uses the same tool. That is why traffic splitting is such a useful release control: the same command that exposes the candidate gradually can also move users back to the stable revision quickly.

## Rollback Shape
<!-- section-summary: Rollback shape names the exact recovery action for the runtime and configuration that changed. -->

**Rollback shape** means the concrete move that returns users to a stable path. It depends on what changed. A bad candidate image, a bad app setting, and a bad Key Vault reference can all hurt users, but they may need different first actions.

For App Service, rollback might mean swapping slots back. If `v31` moved into production through a slot swap and `v30` still lives in the previous slot, the team can swap back and restore the earlier production content. If the failure came from a sticky production setting, a swap alone may leave the bad setting in place, so the rollback plan must include the setting restore.

For Container Apps, rollback often means traffic movement. If `orders-api--v31` starts failing at 10 percent, the team can set `orders-api--v30` to 100 percent and `orders-api--v31` to 0 percent. The candidate can remain active for inspection or receive no traffic until the team deactivates it.

For configuration, rollback means restoring the known-good value or target. The team may turn off `CHECKOUT_RECEIPT_RETRY_ENABLED`, point a Key Vault reference back to a previous secret version, or restore a previous app setting snapshot. Because config changes can restart an app or require a new revision path, the rollback plan should include the expected runtime effect.

Here is a combined rollback shape for the orders API. It separates candidate, config, secret, and slot failures so the first recovery action matches the evidence:

```yaml
rollback_shape:
  bad_candidate_code:
    action: move 100 percent traffic to orders-api--v30
    expected_effect: new checkout requests use stable revision
  bad_feature_flag:
    action: set CHECKOUT_RECEIPT_RETRY_ENABLED to "false"
    expected_effect: retry branch stops running
  bad_secret_reference:
    action: restore Application Insights secret reference to previous version
    expected_effect: telemetry returns to expected resource
  bad_slot_swap:
    action: swap production back to previous slot state
    expected_effect: production serves previous package and slot state
```

This record gives the on-call engineer a menu based on evidence. If only the retry branch fails, the feature flag rollback may be enough. If every request on `v31` fails before reaching the branch, traffic rollback comes first. If telemetry disappears but users stay healthy, restoring the telemetry secret may solve the operational problem while traffic stays steady.

Now we can connect runtime configuration and safe rollout controls in one release. The same orders API story shows why these topics belong together.

## Putting It All Together
<!-- section-summary: A safe rollout keeps the candidate, settings, secret access, traffic movement, and rollback target connected. -->

The orders API team starts with a candidate image for revision `orders-api--v31`. Before any production traffic moves, the team reviews runtime configuration. The retry flag turns on, the storage account target stays production, the Application Insights connection string comes from Key Vault, and the managed identity can read the required secrets.

The team then verifies the candidate directly. In Container Apps, the candidate revision starts with zero traffic and passes startup and readiness probes. The team runs a direct smoke test against the candidate path. In App Service, the equivalent flow would deploy to a staging slot, warm the slot, verify Key Vault references, and run checkout tests against the staging host name.

Traffic moves gradually. The first step sends 10 percent to `v31` and keeps 90 percent on `v30`. The watch window focuses on the actual release risk: checkout failures, p95 checkout duration, Azure SQL dependency failures, receipt upload failures, exceptions, and telemetry health. If those signals stay near baseline, the team can move to 50 percent and then 100 percent.

The rollback shape stays ready for each kind of failure. A candidate code failure sends traffic back to `v30`. A bad feature flag restores the previous setting. A bad secret reference points back to a known-good version. A bad App Service swap swaps back and restores any sticky setting that caused the problem.

This is the connection the article is trying to make. Runtime configuration decides what the candidate does. Rollout controls decide who experiences it. A safe Azure release names both before production users become the test plan.

## What's Next
<!-- section-summary: The final article focuses on watch windows, verification signals, rollback decisions, and runtime operations after traffic moves. -->

The candidate now has settings, secret access, rollout controls, and a rollback shape. The next article starts when real traffic reaches the candidate. We will talk about watch windows, health checks, smoke tests, Application Insights, Azure Monitor alerts, rollback versus fix-forward decisions, release records, and the runtime operations that happen after the first release decision.

We will keep the same orders API story. The next question changes from "can we expose the candidate safely?" to "what evidence tells us whether to continue, roll back, fix forward, or operate through a smaller runtime issue?"

---

**References**

- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common) - Explains app settings, connection strings, environment variable behavior, encryption, and restart behavior after app setting changes.
- [Use Key Vault references as app settings in Azure App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) - Documents Key Vault reference syntax, managed identity use, caching, refresh behavior, and access requirements.
- [Managed identities for Azure resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) - Explains how Azure resources use managed identities to authenticate without storing credentials in code.
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) - Documents Container Apps secrets, Key Vault references, managed identity access, application-scope behavior, and revision restart considerations.
- [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions) - Describes revisions, revision modes, revision-scope changes, application-scope changes, readiness checks, labels, and reverting to a previous revision.
- [Traffic splitting in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting) - Documents weighted traffic splitting across active revisions in multiple revision mode.
- [Set up staging environments in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots) - Documents deployment slots, slot-specific settings, swap behavior, swap with preview, and swap rollback.
- [az webapp config appsettings](https://learn.microsoft.com/en-us/cli/azure/webapp/config/appsettings) - Documents Azure CLI commands for listing and setting App Service app settings.
- [az containerapp](https://learn.microsoft.com/en-us/cli/azure/containerapp) - Documents Azure CLI commands for updating Container Apps environment variables and revision settings.
- [az containerapp secret](https://learn.microsoft.com/en-us/cli/azure/containerapp/secret) - Documents Azure CLI commands for creating and updating Container Apps secrets, including Key Vault references.
- [az containerapp ingress traffic](https://learn.microsoft.com/en-us/cli/azure/containerapp/ingress/traffic) - Documents Azure CLI commands for showing and setting Container Apps traffic weights.
- [az webapp deployment slot](https://learn.microsoft.com/en-us/cli/azure/webapp/deployment/slot) - Documents Azure CLI commands for App Service slot operations, including swaps.
- [Azure App Configuration feature management](https://learn.microsoft.com/en-us/azure/azure-app-configuration/concept-feature-management) - Explains feature flags, feature filters, variants, and dynamic feature management concepts.
- [Manage feature flags in Azure App Configuration](https://learn.microsoft.com/en-us/azure/azure-app-configuration/manage-feature-flags) - Shows how Azure App Configuration stores and manages feature flags outside application code.
- [az appconfig feature](https://learn.microsoft.com/en-us/cli/azure/appconfig/feature) - Documents Azure CLI commands for showing, enabling, disabling, and setting App Configuration feature flags.
- [OpenFeature reference introduction](https://openfeature.dev/docs/reference/intro/) - Describes the OpenFeature API, providers, hooks, evaluation context, and vendor-neutral feature flag usage.
