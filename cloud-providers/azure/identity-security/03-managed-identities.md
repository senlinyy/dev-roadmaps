---
title: "Workload Identities, Service Principals, And Managed Identities"
description: "Understand how Azure workloads prove identity with app registrations, service principals, managed identities, workload identity federation, tokens, RBAC, and runtime evidence."
overview: "Azure workload access is about giving software its own caller identity instead of shipping long-lived secrets. This article follows the Orders API and its deployment pipeline through service principals, managed identities, workload identity federation, Azure SDK credential choices, RBAC role assignments, and the evidence teams use when runtime access fails."
tags: ["azure", "microsoft-entra-id", "managed-identity", "service-principal", "workload-identity", "rbac"]
order: 3
id: article-cloud-providers-azure-identity-security-managed-identities-and-workload-access
aliases:
  - managed-identities
  - workload-identities
  - service-principals
  - service-principals-and-managed-identities
  - workload-identities-service-principals-and-managed-identities
  - managed-identities-and-workload-access
  - azure-managed-identities
  - cloud-providers/azure/identity-security/managed-identities.md
---

## Table of Contents

1. [The Access Story](#the-access-story)
2. [Workload Identities](#workload-identities)
3. [The Problem](#the-problem)
4. [App Registrations And Service Principals](#app-registrations-and-service-principals)
5. [Service Principal Credentials](#service-principal-credentials)
6. [Managed Identities](#managed-identities)
7. [System-Assigned And User-Assigned Identities](#system-assigned-and-user-assigned-identities)
8. [Runtime Identity In Application Code](#runtime-identity-in-application-code)
9. [RBAC Still Grants Permission](#rbac-still-grants-permission)
10. [Workload Identity Federation](#workload-identity-federation)
11. [Runtime Identity Vs Pipeline Identity](#runtime-identity-vs-pipeline-identity)
12. [Failure Evidence](#failure-evidence)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## The Access Story
<!-- section-summary: This article follows one Orders system so service principals, managed identities, workload identity federation, RBAC, and runtime evidence stay connected. -->

In the previous article, we looked at **Azure RBAC** as the place where Azure connects a known caller to a role at a scope. That gave us the authorization side. Now we need to spend a full article on the software callers themselves, because production systems have more than human users. APIs call Key Vault. Background workers write blobs. Deployment pipelines update Container Apps. Monitoring jobs read logs. Those callers need identity too.

The Orders team runs `ca-orders-api-prod`, an Azure Container Apps workload that reads database credentials from `kv-devpolaris-prod` and writes invoice exports to Blob Storage. The same team also has a GitHub Actions workflow that deploys new revisions. Both pieces are software, but they have different jobs. The running API needs runtime access to Key Vault and Storage. The pipeline needs deployment access to update Azure resources.

This article follows those two callers through the whole path. We will talk about **workload identities** as the broad category, **app registrations** as identity configuration for software, **service principals** as the tenant-local software principals that receive access, **managed identities** as Azure-managed workload identities for Azure-hosted resources, and **workload identity federation** as the secretless path for external automation such as GitHub Actions.

![Orders workload identity map showing GitHub Actions using a deployment service principal, the Container App using a managed identity, Azure RBAC gates, and evidence logs](/content-assets/articles/article-cloud-providers-azure-identity-security-managed-identities-and-workload-access/orders-workload-identity-map.png)

*The map separates the two callers in the Orders system: the deployment pipeline uses a deployment identity, while the running API uses a managed identity, and both still pass through RBAC and evidence logs.*

The important thread is simple. **Identity gives software a caller name. RBAC gives that caller permission. Evidence proves which caller actually made the request.** If those three pieces blur together, teams end up with secrets in app settings, broad Contributor assignments, pipeline tests that prove the wrong identity, and production failures that feel random.

So we will start with the broad word first: workload identity. After that, each section adds one production detail to the Orders story.

## Workload Identities
<!-- section-summary: A workload identity is an identity for software, automation, or a running service that needs to authenticate without pretending to be a human. -->

A **workload identity** is an identity used by software. The workload might be an API, a batch job, a container, a virtual machine script, a CI/CD workflow, an integration service, or a scheduled cleanup process. In Microsoft Entra ID, workload identities include applications, service principals, and managed identities.

That definition matters because a readable audit trail points software actions at software identities. If `ca-orders-api-prod` reads a secret from Key Vault, the log should point at the Orders API identity. If GitHub Actions updates a production revision, the log should point at the deployment identity. If a cleanup job deletes old blobs, the log should point at the cleanup job. The caller name should match the system doing the work.

For the Orders team, we can describe three different identity shapes:

| Caller | Identity shape | Main job |
|---|---|---|
| `orders-admin-web` | App registration plus service principal | Sign users in and call the Orders API |
| `ca-orders-api-prod` | Managed identity | Read Key Vault secrets and write invoice blobs at runtime |
| GitHub Actions deploy workflow | Service principal or user-assigned managed identity with federation | Deploy Azure resources without storing a client secret |

The word **principal** means the thing that can receive access. A human user can be a principal. A group can be a principal. A service principal or managed identity can also be a principal. Azure RBAC uses that principal record when it decides whether the caller can perform an action at a scope.

The first production habit is to name the workload identity by job and environment. `mi-orders-api-prod` tells us this is a managed identity for the production Orders API. `spn-orders-deploy-prod` tells us this is a service principal for production deployment. Access still comes from role assignments, and good names make those assignments, reviews, and incident logs much easier to read.

Once the team gives software its own identity, the next question is why this is worth the trouble. The answer is usually a secret that has already spread farther than anyone planned.

## The Problem
<!-- section-summary: Long-lived application secrets create leak, rotation, ownership, and audit problems, so production teams move software access toward token-based workload identity. -->

A **client secret** is a password-like value that an application can use with Microsoft Entra ID to request tokens. A **connection string** or **access key** is another kind of secret that lets software reach a service directly. These values are common because they are quick to set up. A developer can paste a value into an app setting, run a deployment, and make the first version of the app work.

The problem arrives after the first version works. The same secret can appear in local `.env` files, CI variables, app settings, support tickets, shell history, build logs, screenshots, and old release notes. A leaked secret can keep working until the team rotates or deletes it. A secret with a long expiration date can outlive the person who created it, the pipeline that used it, and the environment where it first belonged.

The Orders API carries a shape like this during an early prototype:

```yaml
ORDERS_KEY_VAULT_URL: https://kv-devpolaris-prod.vault.azure.net
AZURE_TENANT_ID: tenant-devpolaris
AZURE_CLIENT_ID: client-orders-api-prod
AZURE_CLIENT_SECRET: copied-secret-value
```

This configuration tells the app how to authenticate as a software identity. The tenant ID names the directory. The client ID names the app identity. The client secret proves the app can use that identity. The vault URL names the target service. The code may be clean, but the runtime now carries a reusable password.

Rotation is where this causes operational pain. The team has to create a new secret, update every place that stores it, deploy safely, verify the app is using the new value, and remove the old value. During an incident, the team has to ask where the old value was copied. If a pipeline uses the same secret as the running API, the logs are also harder to read because deployment and runtime activity can share one caller.

Azure gives us several better paths. A service principal can use a certificate instead of a secret, which improves some handling but still creates a credential lifecycle. A managed identity lets Azure-hosted workloads request tokens without developers managing the underlying credential. Workload identity federation lets external automation exchange a trusted external token for a Microsoft Entra token. To understand those paths, we first need the app registration and service principal split.

## App Registrations And Service Principals
<!-- section-summary: An app registration describes software integration with Microsoft Entra ID, while a service principal is the tenant-local security principal that receives access. -->

An **app registration** is the identity configuration for an application in Microsoft Entra ID. It describes how the software integrates with Microsoft sign-in and token flows. A registration can include the client ID, supported account types, redirect URIs, secrets or certificates, API permissions, exposed scopes, app roles, and token settings.

A **service principal** is the tenant-local identity for that application. Microsoft describes the application object as the global application representation, and the service principal as the local representation inside a tenant. The service principal is the object that receives permissions, appears in enterprise application records, shows up in sign-in evidence, and participates in authorization decisions.

For a single-tenant internal tool, the app registration and its service principal may both live in `devpolaris.com`. For a multitenant SaaS app, the application object lives in the vendor tenant, while each customer tenant gets its own service principal after consent. That lets each tenant manage its own assignments, consent records, and policies for the same application.

The Orders deployment identity has a record shape like this:

```json
{
  "displayName": "spn-orders-deploy-prod",
  "appId": "client-orders-deploy-prod",
  "objectId": "principal-orders-deploy-prod",
  "servicePrincipalType": "Application"
}
```

The `appId` is also called the client ID. Code and token flows often use it. The `objectId` is the service principal object ID in this tenant. Azure RBAC role assignments use that principal ID when they grant access. A reviewer usually needs both fields because the client ID explains which app configuration is being used, while the object ID explains which tenant-local principal received the Azure role.

This is the place where portal names can confuse beginners. **App registrations** is where developers manage app configuration such as redirect URIs, credentials, API permissions, scopes, and app roles. **Enterprise applications** is where operators often inspect service principals, user assignment, consent, sign-in logs, and tenant-local application access. Both areas describe the same software story from different angles.

Service principals are useful, and they can still carry credentials. The Orders pipeline can authenticate as `spn-orders-deploy-prod` with a client secret or certificate. That gets us back to the credential problem, so the next section looks at when that is acceptable and where teams usually move next.

## Service Principal Credentials
<!-- section-summary: Service principals can use secrets or certificates, but those credentials need owners, expiration, rotation, and a reason they still exist. -->

A **service principal credential** is proof that software can use a service principal. The most familiar credential is a client secret. A certificate is another option. In both cases, the app presents credential material to Microsoft Entra ID, and Microsoft Entra ID can issue a token if the credential is valid and the token request matches the configured application.

This pattern still appears in production. A legacy deployment tool might only support a service principal secret. A third-party integration might need a client secret because managed identity or federation support is missing from the integration. A certificate might fit an internal automation service where certificate storage and rotation already have strong controls.

For the Orders team, a service principal secret might appear in GitHub Actions like this:

```yaml
AZURE_CLIENT_ID: client-orders-deploy-prod
AZURE_TENANT_ID: tenant-devpolaris
AZURE_CLIENT_SECRET: stored-in-ci-secrets
AZURE_SUBSCRIPTION_ID: sub-devpolaris-prod
```

This works, but it creates a maintenance promise. Someone owns the secret. Someone knows the expiration date. Someone can rotate it safely. Someone can revoke it during an incident. Someone can prove which environments had a copy. If the same secret supports several environments, the blast radius grows because one leaked value can affect more than one place.

A cleaner service principal design has a narrow job and narrow access. `spn-orders-deploy-prod` should deploy Orders production resources. Runtime secret reads, local development scripts, and staging deployments should use their own identities when they are separate jobs. The service principal should receive only the Azure RBAC roles it needs, at the smallest useful scope, and its credential setup should match the risk of production deployment.

Many teams now move CI/CD service principals from client secrets to **workload identity federation**. We will come back to that later in the article because the deployment pipeline is an external workload. First, we need the Azure-hosted runtime path, because the running Orders API has an even better option: managed identity.

## Managed Identities
<!-- section-summary: A managed identity gives an Azure resource a Microsoft Entra workload identity whose credential lifecycle Azure manages. -->

A **managed identity** is a Microsoft Entra workload identity that can be assigned to an Azure resource. The running code can request Microsoft Entra tokens through the Azure hosting environment, and Azure manages the underlying credential. Microsoft describes managed identities as a way for applications to obtain Microsoft Entra tokens without developers managing credentials.

For the Orders API, this means `ca-orders-api-prod` can use `mi-orders-api-prod` when it needs to read `kv-devpolaris-prod` or write invoice blobs. The application code can drop `AZURE_CLIENT_SECRET`, the container image can avoid storage account keys, and the pipeline can stop pasting runtime secrets into app settings. The runtime asks Azure for a token, and Azure issues a token for the identity attached to the workload.

If you know AWS, the closest anchors are EC2 instance profiles, ECS task roles, Lambda execution roles, and EKS pod identity patterns. The shared idea is short-lived cloud credentials for a running workload, while Azure packages the identity through Microsoft Entra and attaches it to Azure resources as a managed identity.

![Managed identity runtime path showing a Container App using a managed identity endpoint, Microsoft Entra token issuance, Azure RBAC, Key Vault, and Storage](/content-assets/articles/article-cloud-providers-azure-identity-security-managed-identities-and-workload-access/managed-identity-runtime-path.png)

*This runtime path shows the part that changes when a team adopts managed identity: the app still requests a token and still needs RBAC, but the long-lived client secret leaves app settings.*

Managed identities create a special service principal in Microsoft Entra ID. That detail connects this article back to the service principal section. A managed identity is still a principal that can receive Azure RBAC assignments and appear in sign-in evidence. The difference is ownership of the credential lifecycle. Azure owns the credential material behind the managed identity path, while the team owns the role assignments, attachment to resources, naming, and review process.

The Orders team can inspect a user-assigned managed identity like this:

```bash
az identity show \
  --name mi-orders-api-prod \
  --resource-group rg-devpolaris-orders-prod
```

The useful fields are the name, client ID, principal ID, resource ID, location, and tags. The client ID helps application code choose the right user-assigned identity when several identities are available. The principal ID is the object ID Azure RBAC evaluates. The resource ID names the managed identity as an Azure resource.

```json
{
  "name": "mi-orders-api-prod",
  "clientId": "client-mi-orders-api-prod",
  "principalId": "principal-mi-orders-api-prod",
  "id": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mi-orders-api-prod",
  "tags": {
    "service": "orders-api",
    "env": "prod"
  }
}
```

This gives the Orders API a caller identity. Key Vault and Storage access still come from roles at those target services, and the app still has to run on a hosting platform that supports the managed identity type the team selected. That takes us to the two managed identity types.

## System-Assigned And User-Assigned Identities
<!-- section-summary: System-assigned identities belong to one Azure resource, while user-assigned identities are standalone resources that can attach to one or more workloads. -->

A **system-assigned managed identity** is enabled directly on one Azure resource. Azure creates the identity for that resource, only that resource can use it to request tokens, and the identity lifecycle follows the resource lifecycle. If the resource is deleted, Azure deletes the system-assigned identity too.

A **user-assigned managed identity** is a standalone Azure resource. The team creates it separately, then attaches it to one or more Azure resources. Its lifecycle is independent from any one compute resource, so the team has to delete it when it is no longer needed. The same user-assigned identity can be shared across resources when those resources should share the same caller and permissions.

| Identity type | Plain-English shape | Orders example | Best fit |
|---|---|---|---|
| **System-assigned** | One identity attached to one resource | Identity on one `ca-orders-api-prod` app | One workload with simple lifecycle |
| **User-assigned** | Standalone identity attached to one or more resources | `mi-orders-api-prod` attached to API revisions | Shared, preapproved, or stable workload identity |

The Orders team chooses a user-assigned identity for production because the identity should stay stable while container revisions change. The team can create `mi-orders-api-prod`, grant it Key Vault and Storage permissions, attach it to the Container App, and keep the identity through future revision rollouts. That gives release reviewers a stable object to inspect even when the app image and revision name change.

Sharing a user-assigned identity needs care. If the API only needs Blob read access and a background worker needs Blob write access, sharing one identity can give the API more power than its job requires. Separate identities often make least privilege clearer because each workload receives the roles for its own behavior. A shared identity fits when the workloads truly share the same job and the same access.

There is also an operational reason user-assigned identities show up in larger systems. Fast creation and deletion of many system-assigned identities can create Microsoft Entra object churn and replication timing issues. A pre-created user-assigned identity can reduce that churn for workloads that recycle often. The choice still depends on the workload lifecycle, access shape, and review process, so platform teams treat user-assigned identity as a stable design option rather than a universal default.

Now that the Orders API has an identity attached, the code has to use it. The next section moves from Azure resource setup into the application runtime.

## Runtime Identity In Application Code
<!-- section-summary: Azure SDK credential classes let application code request tokens from the runtime identity instead of reading a stored client secret. -->

Runtime code should use token-based authentication when the target Azure service supports Microsoft Entra authentication. In JavaScript and TypeScript applications, the Azure Identity library provides credential classes that can request tokens through local developer tools during development and through managed identity when the app runs in Azure.

For a user-assigned managed identity in production, the Orders API can use `ManagedIdentityCredential` with the managed identity client ID. This makes the production code ask the Azure hosting environment for a token tied to `mi-orders-api-prod`.

```ts
import { ManagedIdentityCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const credential = new ManagedIdentityCredential({
  clientId: process.env.AZURE_CLIENT_ID
});

const vaultUrl = "https://kv-devpolaris-prod.vault.azure.net";
const secrets = new SecretClient(vaultUrl, credential);

const databasePassword = await secrets.getSecret("orders-db-password");
```

The code carries the vault URL and the managed identity client ID. The secret value for authentication is gone. The app still needs the `AZURE_CLIENT_ID` setting when a user-assigned identity is used, because the hosting resource might have more than one identity attached. That client ID is a public identifier used to choose the right managed identity.

Local development usually uses a different credential source. A developer running the Orders API on a laptop uses local developer credentials rather than the Container App managed identity. During development, `DefaultAzureCredential` can discover local developer credentials from tools such as Azure CLI or Visual Studio Code, depending on the developer environment and the configured SDK chain.

```ts
import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";

function createCredential() {
  if (process.env.NODE_ENV === "production") {
    return new ManagedIdentityCredential({
      clientId: process.env.AZURE_CLIENT_ID
    });
  }

  return new DefaultAzureCredential();
}
```

This split keeps the production path explicit. Production uses the managed identity. Local development uses a developer sign-in path. A clean release test should still prove the production runtime identity works, because a local developer account with access to Key Vault says very little about the identity attached to `ca-orders-api-prod`.

The code can now request a token. The next step is authorization, because Key Vault and Storage still check whether that identity has the right role at the right scope.

## RBAC Still Grants Permission
<!-- section-summary: Managed identity proves the workload caller, and Azure RBAC or service-specific authorization still grants what that caller can do. -->

Enabling a managed identity gives the workload a caller identity. **Authorization still comes from Azure RBAC or the target service access model.** This is the most important production distinction in the whole article. Identity answers who the app is. Permission answers what that known app can do.

The Orders API needs to read secret values from `kv-devpolaris-prod`. If the vault uses Azure RBAC for its data plane, the managed identity needs a role such as **Key Vault Secrets User** at the vault scope. That role allows reading secret contents on vaults using the Azure RBAC permission model. The same API might need **Storage Blob Data Contributor** at a storage account or container scope to write invoice exports.

```bash
az role assignment create \
  --assignee principal-mi-orders-api-prod \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.KeyVault/vaults/kv-devpolaris-prod
```

That command has the same RBAC shape from the previous article. The principal is `principal-mi-orders-api-prod`. The role is `Key Vault Secrets User`. The scope is the production vault. The result is one access grant for one workload identity at one target.

Blob access is a separate grant because the target service and operation are different:

```bash
az role assignment create \
  --assignee principal-mi-orders-api-prod \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.Storage/storageAccounts/stordersprodexports
```

A successful Key Vault read proves one access path: secret read at the vault. A blob write needs its own role assignment at the storage scope. One identity can have several role assignments, and each assignment has its own reason. This is why access review should list identity, role, scope, and purpose for every target.

Broad roles deserve special attention. Granting Contributor at a resource group might make a blocked workload move again, but the app may receive permission to update many resources it never needs to touch. Runtime identities usually deserve data roles or narrow custom roles. A workload that reads one secret and writes one blob container should receive permissions shaped around those two jobs, with broader management power reserved for reviewed production reasons.

The runtime path is now clear: Azure-hosted workload, managed identity, token request, RBAC at target services. The deployment path is different because GitHub Actions runs outside Azure. That takes us to workload identity federation.

## Workload Identity Federation
<!-- section-summary: Workload identity federation lets trusted external workloads exchange external IdP tokens for Microsoft Entra access tokens without storing client secrets. -->

**Workload identity federation** lets an external workload use a trusted token from its own identity provider to get a Microsoft Entra access token. The external workload might be GitHub Actions, Azure Pipelines, a Kubernetes workload, Google Cloud, AWS, or another platform that can issue OIDC tokens. Instead of storing a Microsoft Entra client secret, the workload proves itself with a short-lived external token.

For the Orders deployment pipeline, GitHub Actions can request an OIDC token from GitHub. Microsoft Entra ID can trust that token only when a configured federated identity credential matches the issuer, subject, and audience. After the match succeeds, Microsoft Entra ID issues an access token for the configured application or user-assigned managed identity. Azure RBAC then decides what that deployment identity can do.

![Workload identity federation flow showing GitHub Actions receiving an OIDC token, matching issuer subject and audience in Microsoft Entra ID, receiving an access token, and deploying through RBAC](/content-assets/articles/article-cloud-providers-azure-identity-security-managed-identities-and-workload-access/workload-identity-federation.png)

*Federation replaces a stored Azure client secret with a short-lived external token exchange, so the review shifts to the issuer, subject, audience, deployment identity, and RBAC scope.*

The **issuer** names the external identity provider, such as GitHub's OIDC issuer. The **subject** narrows which workload is trusted, such as one repository, branch, tag, pull request, or environment pattern. The **audience** names the intended token exchange target, commonly `api://AzureADTokenExchange` for Azure token exchange scenarios. These fields must match the token sent by the external identity provider.

A simplified federated credential shape for the Orders production deploy might look like this:

```json
{
  "name": "github-orders-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:devpolaris/orders-api:environment:production",
  "audiences": [
    "api://AzureADTokenExchange"
  ]
}
```

That credential says which GitHub workload Microsoft Entra ID should trust for this identity. The Azure RBAC assignment still belongs to the deployment identity. The repository rule and environment protection decide whether GitHub can issue the matching token. Microsoft Entra ID checks the federated credential. Azure RBAC checks the deployment action and scope.

This gives the Orders team a secretless CI/CD path. The GitHub workflow can use OIDC token exchange for this flow, so review moves to the federated credential, GitHub environment protections, the deployment identity, and Azure RBAC assignments. The long-lived client secret leaves the workflow, which reduces the places the team has to inspect during a deployment credential incident.

Now we have two software callers in the same system. The running app uses managed identity. The deployment pipeline uses a federated deployment identity. The next section separates those identities because many production incidents happen when teams test one caller and ship another.

## Runtime Identity Vs Pipeline Identity
<!-- section-summary: The identity that deploys a workload is different from the identity the workload uses after it starts, and both need separate evidence. -->

The **pipeline identity** deploys or updates Azure resources. The **runtime identity** is the identity the running workload uses after deployment. These identities usually need different roles because their jobs are different. The pipeline might update Container Apps revisions and app settings. The runtime API might read secrets and write blobs. Each identity path needs its own release evidence.

The Orders release has two callers:

| Job | Caller | Useful permissions |
|---|---|---|
| Deploy new production revision | `spn-orders-deploy-prod` through GitHub federation | Update Container Apps revision, read deployment state |
| Read secrets and write invoice blobs at runtime | `mi-orders-api-prod` attached to `ca-orders-api-prod` | Key Vault secret read, Blob data write |

A common failure can come from a good pipeline check. The deployment workflow reads a Key Vault secret before release and succeeds. The new production revision starts, handles traffic, and then fails with `Forbidden` when it reads the same secret. The pipeline proved the pipeline identity could read the secret. The runtime failure points at the managed identity attached to the app.

The release record should carry both identities. It should show which identity deployed the resources and which identity the running app will use. It should also show the target role assignments for each identity. That makes rollback and incident response more precise because identity changes are part of release state, just like image tags, configuration, routes, and secret references.

This separation also protects production. The deployment identity can focus on deployment actions while the app reads secrets at runtime through managed identity. The runtime identity can focus on service-to-service calls instead of role assignment creation or Container Apps revision updates. Each caller gets the power for its own job, and the logs point at the system that made each request.

Once the two callers are separate, troubleshooting needs concrete evidence. The next section turns a runtime failure into a small set of checks.

## Failure Evidence
<!-- section-summary: Runtime identity failures become clearer when teams inspect the attached identity, its principal ID, target role assignments, token path, and denied action. -->

**Failure evidence** is the set of records that proves which workload identity was used, which role assignments existed, and which target service denied or allowed the request. For managed identity problems, the useful evidence usually comes from the hosting resource identity, the managed identity object, Azure RBAC role assignments, target service logs, and Microsoft Entra sign-in logs.

The first evidence record is the running app. The Orders team can inspect the identity attached to the Container App and confirm which caller the deployed revision can actually use:

```bash
az containerapp identity show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-orders-prod
```

The useful output should connect the running app to `mi-orders-api-prod` and show the client ID or principal ID. An app with no attached identity lacks the managed identity token path. An app with a different attached identity points the team toward a role assignment mismatch.

The next evidence record is the managed identity object itself:

```bash
az identity show \
  --name mi-orders-api-prod \
  --resource-group rg-devpolaris-orders-prod
```

This confirms the client ID, principal ID, resource ID, location, and tags for the identity. The principal ID is the value the RBAC check uses, so the next step is listing assignments for that principal:

```bash
az role assignment list \
  --assignee principal-mi-orders-api-prod \
  --all
```

A useful output for the Key Vault path has the identity, the Key Vault role, and the vault scope in one place:

```json
[
  {
    "principalName": "mi-orders-api-prod",
    "principalType": "ServicePrincipal",
    "roleDefinitionName": "Key Vault Secrets User",
    "scope": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.KeyVault/vaults/kv-devpolaris-prod"
  }
]
```

The target service matters too. Key Vault has a control plane and a data plane. Managing the vault resource and reading a secret value are different operations. A role that lets a person view the vault resource gives control-plane visibility, while secret content reads need an appropriate Key Vault data role at a suitable scope when the vault uses Azure RBAC on the data plane.

The strongest troubleshooting sentence sounds like this: **the running Container App has `mi-orders-api-prod` attached, that identity has principal ID `principal-mi-orders-api-prod`, and that principal has `Key Vault Secrets User` at the `kv-devpolaris-prod` scope.** If the request still fails after that, the team can look at propagation timing, vault permission model, network access, secret name, token audience, SDK configuration, and target service logs.

This evidence gives the team a repeatable path. The final section brings the whole article back together so the Orders design can be read as one system.

## Putting It All Together
<!-- section-summary: A clean Azure workload identity design separates software callers, removes unnecessary long-lived secrets, grants narrow RBAC, and keeps evidence for each access path. -->

Workload identity has a simple idea behind it: software should have its own caller identity. The Orders API gets its own runtime identity, the deployment pipeline gets its own deployment identity, and a background worker can get a separate identity when it needs different access. Each production job gets a principal that matches the work it performs.

Service principals give software a tenant-local identity that can receive permissions and appear in evidence. App registrations describe how software integrates with Microsoft Entra ID. Service principal secrets and certificates can still work, but they create ownership, rotation, and leak questions. Managed identities improve the Azure-hosted runtime path because Azure manages the underlying credential and the workload can request tokens through its hosting environment.

The Orders production shape now has clean boundaries:

| Access path | Identity | Authentication path | Authorization path |
|---|---|---|---|
| GitHub Actions deploys a revision | `spn-orders-deploy-prod` | Workload identity federation from GitHub OIDC | Azure RBAC deploy role at Container App or resource group scope |
| Orders API reads database password | `mi-orders-api-prod` | Managed identity token from Azure runtime | `Key Vault Secrets User` at vault scope |
| Orders API writes invoice exports | `mi-orders-api-prod` | Managed identity token from Azure runtime | `Storage Blob Data Contributor` at storage scope |

The design removes the shipped secret from the app. It separates runtime access from deployment access. It keeps RBAC assignments narrow enough to review. It gives incident responders names, principal IDs, roles, scopes, and logs that match the actual callers.

The important habit is to keep asking four plain questions. **Which workload is calling? Which identity does it use? How does it get a token? What role lets that identity touch the target resource?** Those four questions turn workload identity from a portal mystery into a production access story the team can test, monitor, and review.

![Azure workload identity checklist summarizing the workload caller, chosen identity, token path, role and scope, and evidence records](/content-assets/articles/article-cloud-providers-azure-identity-security-managed-identities-and-workload-access/azure-workload-identity-checklist.png)

*The checklist turns the article into one repeatable review path: name the software job, attach the right identity, prove the token path, grant the narrow role, and keep evidence for the request.*

## What's Next

Now we have the workload identity pieces: app registrations, service principals, managed identities, workload identity federation, RBAC assignments, and runtime evidence. The next step is putting those pieces into one complete production setup where the whole access path can be built, tested, and reviewed together.

In **Practical: Set Up Azure Identity And Access For A Startup**, we take the Orders scenario from zero to launch. We create the team groups, set the production subscription and resource group boundary, protect sign-in with Conditional Access, use PIM for privileged changes, register the support dashboard, attach managed identities, grant Key Vault and Storage roles, connect Azure DevOps with workload identity federation, and rehearse the evidence the team keeps before launch.

---

**References**

- [What are managed identities for Azure resources?](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview)
- [Application and service principal objects in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals)
- [Workload identity federation concepts](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [Authenticate Azure-hosted JavaScript apps to Azure resources using a user-assigned managed identity](https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication/user-assigned-managed-identity)
- [Provide access to Key Vault keys, certificates, and secrets with Azure role-based access control](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Managed identity best practice recommendations](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations)
