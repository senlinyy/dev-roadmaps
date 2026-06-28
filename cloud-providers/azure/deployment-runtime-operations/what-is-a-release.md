---
title: "What Is a Release in Azure"
description: "Understand an Azure release as a controlled production change across artifact, runtime target, configuration, traffic, health evidence, and rollback."
overview: "A build can pass and a deployment command can succeed while the release still carries risk. This article explains what actually changes during an Azure release so slots, revisions, settings, health checks, and rollback decisions have a clear place."
tags: ["azure", "deployment", "release", "runtime", "rollback"]
order: 1
id: article-cloud-providers-azure-deployment-runtime-operations-mental-model
aliases:
  - what-is-a-release
  - azure-deployment-and-runtime-operations-mental-model
  - cloud-providers/azure/deployment-runtime-operations/azure-deployment-and-runtime-operations-mental-model.md
---

## Table of Contents

1. [From Local Deploy to Azure Release](#from-local-deploy-to-azure-release)
2. [Artifact: The Exact Package](#artifact-the-exact-package)
3. [Runtime Target: Where the Package Runs](#runtime-target-where-the-package-runs)
4. [Runtime Settings and Identity](#runtime-settings-and-identity)
5. [Traffic Movement and Health Evidence](#traffic-movement-and-health-evidence)
6. [Rollback Belongs in the Release](#rollback-belongs-in-the-release)
7. [A Release Record Example](#a-release-record-example)
8. [Official References](#official-references)

## From Local Deploy to Azure Release
<!-- section-summary: A release moves production from one known state to another known state with evidence. -->

Imagine a tiny app on one virtual machine. You build the code, copy the files to the server, edit an `.env` file, restart the process, run `curl /health`, and keep the previous folder nearby in case the new build hurts users. That simple workflow already contains the pieces of a release: a package, a place to run it, settings, traffic, health checks, and a path back.

Azure keeps those same practical pieces, but Azure gives each piece a resource name. The copied folder maps to a container image in Azure Container Registry. The restarted process maps to an Azure Container Apps revision, an App Service deployment slot, an AKS rollout, or a Function App version. The `.env` file maps to app settings, secret references, managed identity, and platform configuration. The health check maps to probes, Application Insights telemetry, Azure Monitor alerts, and a release record.

This module follows `devpolaris-orders-api`, a checkout service for a training platform. A customer buys a course, the API writes an order row to Azure SQL, uploads a receipt to Azure Storage, and sends telemetry to Application Insights. Production currently runs revision `devpolaris-orders-api--v30`. The team wants to release revision `devpolaris-orders-api--v31`, which adds retry logic when receipt uploads hit a short storage outage.

That sounds like a code change, but production needs more than the new image. The release must prove the exact image digest, the runtime revision, the storage setting, the Key Vault reference, the managed identity permission, the traffic split, the health signal, and the rollback target. The table gives the release pieces before we walk through them.

| Release part | Plain meaning | Azure example |
|---|---|---|
| Artifact | The exact package production should run | ACR image digest for `devpolaris-orders-api:v31` |
| Runtime target | The Azure resource that runs the package | Container Apps revision `devpolaris-orders-api--v31` or App Service `staging` slot |
| Runtime settings | Values the app reads while it runs | `RECEIPT_CONTAINER`, `FEATURE_RECEIPT_RETRY`, telemetry connection string |
| Identity | The permissions the running app uses | Managed identity with Key Vault and Storage roles |
| Traffic | How users reach the candidate | Revision weights, slot swap, slot traffic routing |
| Evidence | Proof that the new state works | Probes, smoke tests, logs, metrics, alerts, release note |
| Rollback | The known-good state to restore | Move traffic to `--v30` or swap the previous App Service slot back |

![A release flow from build artifact through runtime, settings, traffic exposure, health evidence, and recovery decision](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-mental-model/release-flow.png)

*A release is the controlled path from a candidate artifact to user traffic, health evidence, and a continue-or-recover decision.*

## Artifact: The Exact Package
<!-- section-summary: The artifact is the immutable package that production should run. -->

An **artifact** is the thing you deploy. For this API, the artifact is a container image in Azure Container Registry. For another Azure app, it might be a ZIP package for App Service, a Function App package, a Helm chart, a Bicep file, or a VM image. The artifact gives the release a concrete object instead of a loose phrase like "the new code."

Image tags help people talk about a build, but a tag can move. A release record should also capture an immutable identifier. For container images, that identifier is the **image digest**. The digest is a hash of the image content. If someone asks exactly which bytes production received, the digest answers that question.

The release owner checks the image in the registry before deploying it:

```bash
az acr manifest list-metadata \
  --registry acrlearningprod \
  --name devpolaris-orders-api \
  --query "[?contains(tags, '2026-06-24.3')].{Digest:digest, Tags:tags, Pushed:lastUpdateTime}" \
  --output json
```

Example output:

```json
[
  {
    "Digest": "sha256:8a7b6c5d4e3f2111111111111111111111111111111111111111111111111111",
    "Tags": [
      "2026-06-24.3",
      "release-candidate"
    ],
    "Pushed": "2026-06-24T09:41:12.312000+00:00"
  }
]
```

The command asks Azure Container Registry for manifest metadata and filters to the manifest that carries tag `2026-06-24.3`. `Digest` is the stable artifact identity. `Tags` shows the human labels attached to the image. `Pushed` places the image in the release timeline. The next action is to copy the digest into the release record and compare it with the image used by the runtime target.

For App Service, the artifact check may point at a ZIP package, a deployment ID, or a container image. For Functions, it may point at a package URL or a deployment history entry. The format changes, but the habit stays the same: record the exact package before traffic moves.

## Runtime Target: Where the Package Runs
<!-- section-summary: The runtime target is the Azure resource that receives the artifact and exposes a candidate state. -->

A **runtime target** is the Azure place that runs the artifact. In Azure Container Apps, a meaningful target is a revision. A revision is a snapshot of a container app version, including the container image and revision-scoped template settings. Azure Container Apps can keep several active revisions at the same time in multiple revision mode, which makes it useful for canaries, blue-green releases, and quick rollback.

In App Service, a meaningful target is often a deployment slot. A slot is a separate live app under the same App Service app. Teams deploy a candidate to `staging`, warm it up, test it through the slot URL, and then swap it into production. After the swap, the previous production app sits in the other slot, which gives rollback a simple shape.

For the `devpolaris-orders-api` release, the main API runs in Container Apps. The team first records the current production state:

```bash
az containerapp revision list \
  --name devpolaris-orders-api \
  --resource-group rg-learning-prod \
  --query "[].{Revision:name, Active:properties.active, Traffic:properties.trafficWeight, Image:properties.template.containers[0].image}" \
  --output table
```

Example output:

```console
Revision                         Active    Traffic    Image
-------------------------------  --------  ---------  --------------------------------------------------------------
devpolaris-orders-api--v30       True      100        acrlearningprod.azurecr.io/devpolaris-orders-api@sha256:5e...
devpolaris-orders-api--v29       False     0          acrlearningprod.azurecr.io/devpolaris-orders-api@sha256:1c...
```

`Revision` names the running snapshot. `Traffic` shows which revision currently receives user requests. `Image` gives the package reference for each revision. The next action is to record `devpolaris-orders-api--v30` as the rollback target before the pipeline creates `--v31`.

After the candidate deploys, the team checks the new revision before it receives production traffic:

```bash
az containerapp revision show \
  --name devpolaris-orders-api \
  --resource-group rg-learning-prod \
  --revision devpolaris-orders-api--v31 \
  --query "{Revision:name, Provisioning:properties.provisioningState, Running:properties.runningState, Image:properties.template.containers[0].image}" \
  --output json
```

Example output:

```json
{
  "Revision": "devpolaris-orders-api--v31",
  "Provisioning": "Provisioned",
  "Running": "Running",
  "Image": "acrlearningprod.azurecr.io/devpolaris-orders-api@sha256:8a7b6c5d4e3f2111111111111111111111111111111111111111111111111111"
}
```

`Provisioned` and `Running` mean Azure accepted the candidate and has at least one healthy replica for that revision. The digest in `Image` should match the registry evidence from the artifact check. The next action is to prove the candidate can start with the intended settings and identity.

![The artifact-to-evidence path ties the image digest to the candidate revision, direct smoke test, and live telemetry](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-mental-model/candidate-release-checks.png)

*The artifact-to-evidence path ties the image digest to the candidate revision, direct smoke test, and live telemetry.*

## Runtime Settings and Identity
<!-- section-summary: Runtime settings and managed identity must match the artifact being released. -->

**Runtime settings** are the values the app reads after Azure starts it. They include environment variables, app settings, connection strings, feature flags, telemetry connection strings, and secret references. The same artifact can behave differently in staging and production because each environment supplies different values.

**Managed identity** is the Azure identity attached to the running app. Instead of putting a storage key or Key Vault credential in code, the app asks Azure for a token as its managed identity. Azure RBAC then decides whether that identity can read a Key Vault secret, write to a storage container, or connect to another protected resource.

For `devpolaris-orders-api--v31`, the retry code needs a setting that enables the feature and a secret reference for the receipt storage connection. It also needs the runtime identity to read Key Vault and write receipt blobs. The release should check these pieces before sending user traffic to the candidate.

This small runtime configuration sketch shows the values the app expects. It is a simplified release-review fragment, not a full Azure resource template:

```yaml
app: devpolaris-orders-api
candidateRevision: devpolaris-orders-api--v31
settings:
  FEATURE_RECEIPT_RETRY: "true"
  RECEIPT_CONTAINER: "receipts-v2"
  APPLICATIONINSIGHTS_CONNECTION_STRING: "@Microsoft.KeyVault(SecretUri=https://kv-learning-prod.vault.azure.net/secrets/appinsights-connection-string/)"
secrets:
  RECEIPT_STORAGE_CONNECTION: "secretref:receipt-storage-connection"
identity:
  name: mi-orders-api-prod
  requiredAccess:
    - Key Vault Secrets User on kv-learning-prod
    - Storage Blob Data Contributor on stlearningprod/receipts-v2
```

`FEATURE_RECEIPT_RETRY` controls the new behavior. `RECEIPT_CONTAINER` points the app at the receipt destination. The Key Vault reference lets the platform resolve a secret without placing the value in source code or the release note. `secretref:receipt-storage-connection` is the Container Apps pattern for exposing an application-level secret as an environment variable. The managed identity section names the permissions the running app needs.

The release owner can verify the identity assignment and role evidence:

```bash
az containerapp identity show \
  --name devpolaris-orders-api \
  --resource-group rg-learning-prod \
  --query "{PrincipalId:principalId, Type:type, UserAssigned:userAssignedIdentities}" \
  --output json
```

Example output:

```json
{
  "PrincipalId": "6f0180a7-8c52-4f0c-9a6a-111111111111",
  "Type": "SystemAssigned, UserAssigned",
  "UserAssigned": {
    "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-learning-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod": {
      "clientId": "c4f2d2b1-1111-4444-8888-999999999999",
      "principalId": "91d2b7e7-3333-4444-8888-111111111111"
    }
  }
}
```

`PrincipalId` is the service principal object Azure RBAC evaluates. `Type` shows whether the app has system-assigned identity, user-assigned identity, or both. The next action is to confirm that the expected principal has the expected roles at the narrow resource scopes. A missing Key Vault role often appears later as a startup failure or a secret reference that never resolves.

## Traffic Movement and Health Evidence
<!-- section-summary: Traffic movement exposes the candidate to users, so it needs direct checks and telemetry checks. -->

**Traffic movement** is the moment the release starts touching users. Container Apps can split traffic between active revisions by percentage. App Service can swap a warmed slot into production or route a percentage of production traffic to a slot. The release plan should say which mechanism the team uses and which evidence must stay healthy after each step.

For the first exposure, the orders team sends 10 percent of production traffic to the candidate revision and keeps 90 percent on the stable revision:

```bash
az containerapp ingress traffic set \
  --name devpolaris-orders-api \
  --resource-group rg-learning-prod \
  --revision-weight devpolaris-orders-api--v30=90 devpolaris-orders-api--v31=10
```

Example output:

```json
{
  "name": "devpolaris-orders-api",
  "traffic": [
    {
      "revisionName": "devpolaris-orders-api--v30",
      "weight": 90
    },
    {
      "revisionName": "devpolaris-orders-api--v31",
      "weight": 10
    }
  ]
}
```

The weights must add up to 100. The stable revision still handles most traffic while the candidate receives enough real requests to prove the release. The next action is a watch window: smoke tests, logs, request failure rate, dependency failures, latency, and alert state.

Start with a safe direct check:

```bash
curl -fsS https://api.devpolaris.example.com/health

curl -fsS https://api.devpolaris.example.com/version
```

Example output:

```json
{
  "status": "ok",
  "dependencies": {
    "sql": "ok",
    "storage": "ok"
  }
}
```

```json
{
  "service": "devpolaris-orders-api",
  "revision": "devpolaris-orders-api--v31",
  "imageDigest": "sha256:8a7b6c5d4e3f2111111111111111111111111111111111111111111111111111",
  "receiptRetry": true
}
```

`-f` makes `curl` fail on HTTP error responses. `-sS` hides progress output while still printing errors. The health response proves the app and critical dependencies respond. The version response ties the request to the candidate revision, image digest, and feature flag. The next action is to compare real traffic telemetry with the release threshold.

## Rollback Belongs in the Release
<!-- section-summary: Rollback is planned before traffic moves so recovery uses known commands and known targets. -->

**Rollback** means restoring a previously known-good production state. In Container Apps, rollback often means moving traffic back to the stable revision. In App Service, rollback often means swapping the previous production slot back or routing traffic away from the candidate slot. In both cases, rollback should be written before the release begins.

For the orders API, the rollback command is small because the team kept revision `--v30` active:

```bash
az containerapp ingress traffic set \
  --name devpolaris-orders-api \
  --resource-group rg-learning-prod \
  --revision-weight devpolaris-orders-api--v30=100 devpolaris-orders-api--v31=0
```

Example output:

```json
{
  "traffic": [
    {
      "revisionName": "devpolaris-orders-api--v30",
      "weight": 100
    },
    {
      "revisionName": "devpolaris-orders-api--v31",
      "weight": 0
    }
  ]
}
```

This command restores user traffic to the stable revision. It does not erase the candidate revision. That is useful because the team can still inspect logs, compare settings, and run direct checks while users are protected.

Rollback planning also needs configuration notes. If the release changed a shared Key Vault secret, storage container, feature flag, or App Service app setting, moving traffic back may be only half of the recovery. The previous code may read the new value unless the config rollback is documented. That is why the release record should name previous setting values or previous secret versions where the release changed them.

## A Release Record Example
<!-- section-summary: The release record gives operators the exact state, evidence, owner, and recovery path. -->

A **release record** is the written proof of what changed, why it changed, which checks passed, and how to recover. It can live in a deployment system, pull request, incident timeline, ticket, or runbook. The important part is that another operator can open it during stress and find concrete resource names, commands, and thresholds.

For `devpolaris-orders-api--v31`, a useful release record might look like this:

```yaml
release: orders-api-2026-06-24.3
owner: maya.release
resourceGroup: rg-learning-prod
runtime: Azure Container Apps
containerApp: devpolaris-orders-api
stableRevision: devpolaris-orders-api--v30
candidateRevision: devpolaris-orders-api--v31
artifact:
  registry: acrlearningprod
  image: devpolaris-orders-api
  tag: 2026-06-24.3
  digest: sha256:8a7b6c5d4e3f2111111111111111111111111111111111111111111111111111
settings:
  FEATURE_RECEIPT_RETRY: "true"
  RECEIPT_CONTAINER: receipts-v2
identityEvidence:
  managedIdentity: mi-orders-api-prod
  keyVaultRole: Key Vault Secrets User on kv-learning-prod
  storageRole: Storage Blob Data Contributor on stlearningprod/receipts-v2
trafficPlan:
  - "10 percent candidate for 20 minutes and 500 checkout attempts"
  - "50 percent candidate after errors and latency stay within threshold"
  - "100 percent candidate after release owner approves"
healthRule:
  errors: "5xx rate under 1 percent for candidate traffic"
  latency: "p95 checkout latency under 900 ms"
  dependencies: "Azure SQL and Storage dependency failures near baseline"
rollback:
  command: "az containerapp ingress traffic set --revision-weight devpolaris-orders-api--v30=100 devpolaris-orders-api--v31=0"
  configRollback: "restore FEATURE_RECEIPT_RETRY=false if retry path causes duplicate receipts"
```

The record names the runtime target, the artifact digest, the settings, the identity evidence, the traffic plan, the health rule, and the rollback command. It also gives the rollback a config note because receipt retry changes behavior even if the image moves back.

![The release record keeps previous version, new version, health rule, rollback command, and owner visible during the rollout](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-mental-model/release-record-inputs.png)

*The release record keeps previous version, new version, health rule, rollback command, and owner visible during the rollout.*

The next article zooms into the two places where release mistakes often hide: runtime configuration and safe rollout controls. We will keep the same orders API and turn the settings, Key Vault references, slots, revisions, traffic weights, and rollback notes into a practical release workflow.

## Official References

- [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Traffic splitting in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting)
- [Set up staging environments in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots)
- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common)
- [az acr manifest](https://learn.microsoft.com/en-us/cli/azure/acr/manifest) - Azure CLI commands for listing and inspecting Azure Container Registry manifest metadata.
- [az acr repository](https://learn.microsoft.com/en-us/cli/azure/acr/repository) - Azure CLI commands for repository and image attributes in Azure Container Registry.
