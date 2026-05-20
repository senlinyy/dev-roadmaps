---
title: "Resources, IDs, and Tags"
description: "Identify the exact Azure resource behind an alert, deployment, cost line, or access request before changing apps, databases, vaults, networks, or policies."
overview: "After placement comes exact resource identity. This article follows an Orders API investigation and uses names, resource IDs, resource types, tags, locks, and evidence to make Azure resources findable and safe to change."
tags: ["azure", "resources", "resource-ids", "tags", "locks"]
order: 3
id: article-cloud-providers-azure-foundations-resource-groups-and-ids
aliases:
  - resource-groups-and-ids
  - resources-ids-and-tags
  - resource-names-tags-and-resource-ids
  - resource-names-tags-and-ids
  - names-tags-and-ids
  - article-cloud-providers-azure-foundations-resource-names-tags-and-resource-ids
  - cloud-providers/azure/foundations/resource-groups-and-ids.md
  - cloud-providers/azure/foundations/resources-ids-and-tags.md
  - cloud-providers/azure/foundations/resource-names-tags-and-resource-ids.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Names](#names)
3. [Resource IDs](#resource-ids)
4. [Resource Types](#resource-types)
5. [Resource Groups In The ID](#resource-groups-in-the-id)
6. [Tags](#tags)
7. [Locks](#locks)
8. [Safer Naming](#safer-naming)
9. [Evidence Before Changes](#evidence-before-changes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The Orders API now has a tenant, subscription, resource group, region, and zone plan. That tells the team where the workload should live. It does not yet prove which exact resource an engineer is looking at.

An alert says the Orders backend cannot read a secret. A teammate searches Azure for `orders` and finds an App Service, a Container Apps environment, two Key Vaults, a SQL server, a storage account, a managed identity, and several old test resources with similar names.

The risky move is to change the first resource that looks familiar.

The better question is:

> How do I know which exact Azure resource I am looking at?

If AWS taught you to copy the ARN before changing a role, bucket, service, or policy, Azure asks for the same habit with a different string: the Azure resource ID.

## Names

Names are for humans first. A name like `app-orders-prod` helps a teammate search, scan the portal, read a dashboard, and recognize a diagram. Good names carry intent.

Azure names vary by service and scope. Some names must be globally unique because they become public endpoints. Some only need to be unique inside a resource group. Some resource types have parent resources. Some services expose display names that are helpful but not strong enough for automation.

That means a name can start an investigation, but it should not end one.

| Human phrase | What it might mean | What is still missing |
| --- | --- | --- |
| `orders app` | App Service app, Container App, Function App, VM, or AKS workload | Resource type, subscription, resource group, region, and exact ID |
| `prod vault` | Key Vault for production secrets | Vault name, subscription, resource group, access model, and resource ID |
| `orders database` | Azure SQL database, SQL server, Cosmos DB container, or storage account | Service type, parent resource, region, and owning group |
| `managed identity` | System-assigned identity or user-assigned managed identity | Principal ID, resource ID, role assignments, and scope |

In the alert story, the name tells the engineer where to begin. It does not prove the app is using that vault or that the vault is in the right subscription.

## Resource IDs

An Azure resource ID is the full management path to a resource. It names the subscription, resource group, resource provider, resource type, and resource name.

Here is a web app resource ID:

```text
/subscriptions/11111111-2222-3333-4444-555555555555
/resourceGroups/rg-orders-prod-uksouth
/providers/Microsoft.Web
/sites/app-orders-prod
```

Written on one line, it looks like this:

```text
/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.Web/sites/app-orders-prod
```

Read it from left to right:

| Part | What it tells you |
| --- | --- |
| `/subscriptions/...` | Which subscription owns the resource |
| `/resourceGroups/...` | Which resource group contains it |
| `/providers/Microsoft.Web` | Which resource provider supplies the resource type |
| `/sites/app-orders-prod` | Which type and name identify this resource under that provider |

This is the Azure equivalent of the AWS habit: copy the strong identifier alongside the friendly name. An ARN and an Azure resource ID are formatted differently, but both answer the same operational need: "this exact resource, in this exact boundary."

## Resource Types

The resource provider and type are the part many beginners skip. They are also the part that prevents name confusion.

`app-orders-prod` might be a web app under `Microsoft.Web/sites`. A managed identity might be under `Microsoft.ManagedIdentity/userAssignedIdentities`. A Key Vault might be under `Microsoft.KeyVault/vaults`. A SQL database has a parent SQL server in the path.

That type path matters because many Azure resources have similar human names. The fix for a Key Vault secret access problem probably belongs near `Microsoft.KeyVault/vaults`, `Microsoft.ManagedIdentity/userAssignedIdentities`, or role assignments. It probably does not belong near a storage account whose name also contains `orders`.

For Orders, a small inventory should include the type:

| Job | Human name | Resource type |
| --- | --- | --- |
| Runtime | `app-orders-prod` | `Microsoft.Web/sites` |
| Secrets | `kv-orders-prod` | `Microsoft.KeyVault/vaults` |
| Workload identity | `mi-orders-prod` | `Microsoft.ManagedIdentity/userAssignedIdentities` |
| Records | `sqldb-orders-prod` | `Microsoft.Sql/servers/databases` |
| Files | `stordersprod` | `Microsoft.Storage/storageAccounts` |
| Logs | `log-orders-prod` | `Microsoft.OperationalInsights/workspaces` |

That table is more useful than a list of names because it shows what each resource is.

## Resource Groups In The ID

Resource groups are part of most Azure resource IDs, so they show up inside the identity string. That is a powerful clue.

If an alert points at:

```text
/subscriptions/sub-prod/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod
```

then a vault with a similar name in `rg-orders-dev-uksouth` is not the same management resource. The friendly name may look close. The resource group path says otherwise.

Resource groups are lifecycle and management containers. Deleting a resource group can delete its resources. Assigning a role at resource group scope can affect resources inside it. Applying a lock at resource group scope can affect delete and update operations under it.

The gotcha is that resource group names can lie by accident. A group called `rg-orders-prod` inside a development subscription is still in the development subscription. Automation should trust the full resource ID and subscription context first, then use names and tags as supporting evidence.

## Tags

Tags are key-value metadata. They help with ownership, cost reporting, inventory, and operational search.

Good tags answer questions humans ask during review:

| Tag | Example | Why it helps |
| --- | --- | --- |
| `team` | `orders` | Who owns the resource |
| `env` | `prod` | Which environment it belongs to |
| `service` | `orders-api` | Which app or service uses it |
| `cost-center` | `commerce` | How finance should group spend |
| `data-class` | `customer` | What kind of data risk is nearby |

Tags are not permissions. A tag that says `env=prod` does not make a resource protected. A tag that says `owner=platform` does not grant the platform team access. Tags make resources easier to find, report, and reason about.

There is also an Azure-specific surprise: tags from a resource group do not automatically flow down to every resource inside it. If the team needs tags on resources for cost, policy, or inventory, the deployment process should apply them where they are needed.

## Locks

Management locks protect resources, resource groups, or subscriptions from accidental changes through the Azure control plane. The two common lock levels are delete protection and read-only protection.

Locks are useful when a mistake would be expensive: deleting a production resource group, changing a shared networking object, or removing a critical database by accident. They are not a replacement for good RBAC, backups, or data protection.

The important Azure gotcha is that locks apply to control plane operations. They do not automatically protect every data operation inside a service. A lock on a storage account can block management changes, but you still need data access controls and retention design for blob data.

Locks can also surprise operators. A read-only lock may block actions that feel like reads because the operation uses a control plane POST under the hood. Use locks deliberately, document why they exist, and include them in change reviews.

## Safer Naming

Names should make the system easier to scan, but they should not try to carry every fact.

A useful Azure name usually hints at:

| Name part | Example |
| --- | --- |
| Resource type | `app`, `kv`, `sql`, `st`, `log`, `mi` |
| Workload | `orders` |
| Environment | `prod` |
| Region when helpful | `uksouth` |

That might produce names such as:

```text
rg-orders-prod-uksouth
app-orders-prod
kv-orders-prod
mi-orders-prod
log-orders-prod
```

Do not make names the source of truth. Names can drift. Resources can move. Abbreviations can become obscure. The strong evidence is still the resource ID, type, subscription, resource group, tags, deployment record, and live service configuration.

## Evidence Before Changes

Before changing a resource, gather the evidence that proves it is the right one.

For the Orders secret alert, the evidence chain should look like this:

| Question | Evidence |
| --- | --- |
| Which app failed? | App resource ID and logs |
| Which identity did it use? | Managed identity resource or principal ID |
| Which vault did it call? | Key Vault name and resource ID |
| Which secret was requested? | Secret name from logs or configuration |
| Which scope grants access? | Role assignment or access policy scope |
| Which boundary owns it? | Tenant, subscription, resource group, region |

Only after that should the team change access. Otherwise the fix may update the wrong vault, assign a broad role at the wrong scope, or hide the real deployment problem.

This habit is the same one AWS Foundations taught with ARNs. The provider changed. The safety move did not.

## Putting It All Together

The opening problem was search noise. `orders` matched too many resources, and a friendly name was not enough to prove what the app was using.

Azure solves that with stronger evidence. Names help humans begin. Resource IDs identify exact resources. Resource types tell which service owns the object. Resource groups show lifecycle and management context. Tags add ownership and cost metadata. Locks protect important resources from accidental management-plane changes. Evidence before changes keeps scripts and humans from fixing the wrong thing.

With exact resource identity in place, the next question is which Azure service family owns each app job.

## What's Next

The next article builds the Azure core services map. It starts from the Orders API need, then maps public traffic, compute, state, access, signals, deployment, cost, and recovery to the first Azure service families to recognize.

---

**References**

- [What is Azure Resource Manager?](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/overview). Supports resource, resource group, resource provider, scope, tag, and resource ID concepts.
- [Use tags to organize your Azure resources and management hierarchy](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources). Supports tag behavior and organization guidance.
- [Lock your Azure resources to protect your infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources). Supports lock levels, inheritance, and control plane caveats.
- [Control plane and data plane operations](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/control-plane-and-data-plane). Supports the management-plane versus data-plane distinction.
