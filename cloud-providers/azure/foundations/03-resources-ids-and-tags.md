---
title: "Resources, IDs, and Tags"
description: "Identify the exact Azure resource behind an alert, deployment, cost line, or access request before changing apps, databases, vaults, networks, or policies."
overview: "After placement comes exact resource identity. This article follows an Orders API investigation and uses resource names, resource IDs, provider types, tags, locks, and evidence to make Azure resources findable and safe to change."
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

1. [The Resource Story](#the-resource-story)
2. [Resource Names](#resource-names)
3. [Resource IDs](#resource-ids)
4. [Resource Providers and Types](#resource-providers-and-types)
5. [Tags](#tags)
6. [Locks](#locks)
7. [Evidence Before Changes](#evidence-before-changes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Resource Story
<!-- section-summary: Azure resources become safer to operate when the team can connect a friendly name, full resource ID, provider type, tags, locks, and change evidence. -->

In the previous Azure foundations article, the Orders team chose the home for `orders-api-prod`: the `devpolaris.com` tenant, the `sub-orders-prod` subscription, the `rg-orders-app-prod-uksouth` and `rg-orders-data-prod-uksouth` resource groups, and the `uksouth` region. That placement work answers where the workload belongs, but daily operations need one more layer. The team has to identify the exact object behind an alert, a bill, a deployment plan, or an access request.

An **Azure resource** is one manageable object in Azure. A resource can be a storage account, a Key Vault vault, a Container App, a database, a virtual network, a diagnostic setting, or a resource group. Azure Resource Manager, usually shortened to ARM, is the management system that accepts create, read, update, and delete requests for those objects through the Azure portal, CLI, SDKs, Bicep, Terraform, and REST APIs.

Here is the situation for this article. The Orders API starts failing during checkout while it tries to read one secret from Key Vault. At the same time, finance sees a new cost line for a storage account that claims to belong to Orders. Maya, the on-call engineer, needs to work out which resources are real production resources, which ones are staging, which ones are shared platform resources, and which ones need protection before anyone runs a fix.

Azure gives Maya several pieces of identity evidence. A **resource name** is the human-friendly label, such as `kv-orders-prod`. A **resource ID** is the full ARM path that points to one exact object. A **resource type** tells her which Azure provider owns the API surface, such as `Microsoft.KeyVault/vaults`. **Tags** hold searchable business metadata such as service, team, environment, and cost center. **Locks** add control-plane protection against accidental deletion or broad configuration changes.

Those pieces work together, and each one answers a different question. The table below gives the first version of the checklist Maya will use through the rest of the article.

| Evidence | Beginner definition | Orders example |
|---|---|---|
| **Name** | The short label people see first | `kv-orders-prod` |
| **Resource ID** | The full ARM path to one exact object | `/subscriptions/.../resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod` |
| **Type** | The provider family and resource kind | `Microsoft.KeyVault/vaults` |
| **Tags** | Key-value metadata for ownership, environment, cost, and automation | `service=orders-api`, `env=prod`, `team=commerce-platform` |
| **Lock** | A management-layer protection rule | `CanNotDelete` on `rg-orders-data-prod-uksouth` |

That table is the structure for the article. First we talk about names, because that is what humans search for. Then we move into resource IDs, because the full path removes ambiguity. After that we look at providers and types, because Azure routes requests through provider namespaces. Then we use tags to make inventory and cost reports useful. Finally we add locks and a small evidence workflow so the team changes the right target.

## Resource Names
<!-- section-summary: Resource names help humans recognize Azure objects quickly, but each resource type has its own uniqueness scope, length rules, and naming limits. -->

A **resource name** is the name assigned to one Azure object when the team creates it. In the Orders environment, `rg-orders-data-prod-uksouth`, `kv-orders-prod`, `stordersprodevents`, and `ca-orders-api-prod` are resource names. They are useful because humans can scan them quickly and see workload, environment, region, and sometimes resource type.

Names carry the first layer of meaning. In `rg-orders-data-prod-uksouth`, `rg` hints that the object is a resource group, `orders` names the workload, `data` names the role, `prod` names the environment, and `uksouth` names the region. In a production incident, that kind of name saves time because Maya can see that the resource probably belongs to the Orders data layer before she opens the full JSON record.

Names also have Azure rules behind them. Microsoft documents different naming restrictions for different resource types. Some names are unique only inside a resource group, while some public endpoint names must be globally unique across Azure because they become part of a public DNS name. Some resource types allow hyphens, some require lowercase letters and numbers, and some have short length limits that force teams to use abbreviations.

That is why a naming standard needs to stay practical. A good Azure name usually includes stable facts such as resource type, workload, environment, region, and instance number. Changing business labels, temporary owners, ticket numbers, or personal names belong in tags instead. Many resource names are expensive or impossible to rename cleanly after creation, and a renamed or moved resource can also affect dashboards, scripts, logs, and Terraform state that point at it.

For the Orders team, the naming pattern can look like this:

| Resource | Name | Why the name helps |
|---|---|---|
| Resource group for app resources | `rg-orders-app-prod-uksouth` | Shows lifecycle, workload, environment, and region |
| Resource group for data resources | `rg-orders-data-prod-uksouth` | Separates long-lived data resources from release-heavy app resources |
| Key Vault vault | `kv-orders-prod` | Shows the service role and production environment |
| Container App | `ca-orders-api-prod` | Shows the compute type and application name |
| Storage account | `stordersprodevents` | Uses a compressed format because storage account names have stricter naming rules |

This gives Maya a first pass during an incident. If an alert says `kv-orders-prod`, the name strongly suggests a production Key Vault for Orders. The name still needs proof, because another subscription or resource group can hold a resource with the same short name. The next layer gives that proof, and that layer is the resource ID.

## Resource IDs
<!-- section-summary: A resource ID is the full Azure Resource Manager path that identifies one exact resource across subscription, resource group, provider, type, and name. -->

A **resource ID** is the full management path for one Azure object. It is the address ARM uses when a tool asks for a specific resource. A friendly name can repeat in different places, but the resource ID includes the subscription, resource group, provider namespace, resource type, and resource name, so it points at one exact target.

The Orders production Key Vault has a resource ID like this:

```
/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod
```

That path reads left to right. The subscription segment names the production Azure estate. The resource group segment names the lifecycle container. The provider segment names the Azure API family. The `vaults` segment names the resource kind inside Key Vault. The final segment names this particular vault.

Here is the same path split into the pieces Maya checks during the incident. Each segment narrows the target until the short name becomes one exact Azure object.

| Segment | Meaning | Orders value |
|---|---|---|
| `/subscriptions/{subscriptionId}` | The Azure subscription that owns billing, quota, access, and provider registration | `88888888-4444-4444-4444-121212121212` |
| `/resourceGroups/{resourceGroupName}` | The resource group that holds the resource | `rg-orders-data-prod-uksouth` |
| `/providers/{providerNamespace}` | The resource provider namespace that serves the API | `Microsoft.KeyVault` |
| `/{resourceType}` | The resource kind inside the provider | `vaults` |
| `/{resourceName}` | The short name of this resource | `kv-orders-prod` |

This is the value that belongs in exact automation. A deployment script, incident record, dashboard tile, role assignment review, and deletion request should carry the resource ID when the change affects a specific resource. The short name helps a human recognize the object, while the ID tells Azure which object the human means.

Resource IDs also explain why moving a resource is a serious operation. If the Orders Key Vault moved to another resource group or subscription, one of the path segments would change. Any automation, monitoring rule, dashboard, export, or access review that stored the old ID would need an update, because the full path changed even though the friendly name might look familiar.

The Azure CLI exposes this exact identity evidence. Maya can inspect the production resource group first, because the challenge in this topic also asks you to prove the full group ID, name, location, and tags. That proof starts with one simple `az group show` call:

```bash
az group show \
  --name "rg-orders-data-prod-uksouth" \
  --query "{id:id,name:name,location:location,tags:tags}" \
  --output json
```

The response gives the resource group ID and the tags in one place:

```json
{
  "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth",
  "location": "uksouth",
  "name": "rg-orders-data-prod-uksouth",
  "tags": {
    "env": "prod",
    "service": "orders-api",
    "team": "commerce-platform"
  }
}
```

For an individual resource, Maya can query by ID:

```bash
az resource show \
  --ids "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod" \
  --query "{id:id,name:name,type:type,resourceGroup:resourceGroup,location:location,tags:tags}" \
  --output json
```

That output gives her the exact target:

```json
{
  "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod",
  "location": "uksouth",
  "name": "kv-orders-prod",
  "resourceGroup": "rg-orders-data-prod-uksouth",
  "tags": {
    "data-class": "restricted-customer",
    "env": "prod",
    "service": "orders-api",
    "team": "commerce-platform"
  },
  "type": "Microsoft.KeyVault/vaults"
}
```

Now the team can prove the subscription, resource group, type, name, location, and tags. The `type` field is worth its own section, because it tells us which Azure provider owns the resource and which API shape the resource follows.

## Resource Providers and Types
<!-- section-summary: Resource providers are Azure service API families, and resource types describe the specific resource kind managed by that provider. -->

A **resource provider** is an Azure service API family that ARM can route management requests to. Key Vault uses the `Microsoft.KeyVault` provider. Container Apps uses `Microsoft.App`. Storage uses `Microsoft.Storage`. Authorization resources such as role assignments and locks use `Microsoft.Authorization`.

A **resource type** combines the provider namespace and the resource kind. Microsoft describes the type format as `{resource-provider}/{resource-type}`. A Key Vault vault uses `Microsoft.KeyVault/vaults`, a storage account uses `Microsoft.Storage/storageAccounts`, and a Container App uses `Microsoft.App/containerApps`.

This matters during troubleshooting because the provider owns the valid API versions, locations, operations, and naming rules for its resource types. If Maya sees `Microsoft.KeyVault/vaults`, she knows she is dealing with the Key Vault management API. If she sees `Microsoft.Authorization/locks`, she is looking at a lock resource that protects another scope.

Provider registration is the subscription-level switch that lets the subscription work with a provider namespace. Many providers register automatically through the portal, CLI, Bicep, or ARM templates, but some scenarios still need a manual check. When the Orders team deploys a new service family into a fresh subscription, `MissingSubscriptionRegistration` means the subscription needs the provider namespace registered before that resource type can deploy.

The Azure CLI can show registration state, resource types, supported locations, and API versions:

```bash
az provider show \
  --namespace "Microsoft.KeyVault" \
  --query "{namespace:namespace,registrationState:registrationState,resourceTypes:resourceTypes[].resourceType}" \
  --output json
```

A trimmed response looks like this:

```json
{
  "namespace": "Microsoft.KeyVault",
  "registrationState": "Registered",
  "resourceTypes": [
    "vaults",
    "vaults/keys",
    "vaults/secrets",
    "vaults/certificates"
  ]
}
```

If the provider needs registration, the platform team can register the namespace after confirming that the subscription should use that service family:

```bash
az provider register --namespace "Microsoft.KeyVault"
```

So far, Maya can recognize the resource by name, prove the exact target by ID, and understand the provider type that owns the API. The next problem is ownership at scale. A company can have thousands of resources, and names alone make cost reports, inventories, and automation hard to trust. That is where tags come in.

## Tags
<!-- section-summary: Tags are key-value metadata that make resources searchable by owner, service, environment, cost, and operational purpose. -->

A **tag** is a key-value metadata pair attached to a subscription, resource group, or resource. Tags help humans and tools group resources by business meaning. In the Orders environment, `service=orders-api`, `env=prod`, and `team=commerce-platform` tell finance, support, security, and automation which application a resource belongs to.

Tags answer questions that resource names carry poorly. A name can show a short workload and environment, but it has strict length and character rules. Tags can hold owner, cost center, data class, support contact, deployment tool, expiration date, and change policy. A good name helps someone recognize a resource, and a good tag set helps the whole organization search, report, and govern it.

The Orders team uses a small standard tag set:

| Tag key | Example value | Production reason |
|---|---|---|
| `service` | `orders-api` | Groups all resources that support the Orders API |
| `env` | `prod` | Separates production from staging, development, and shared resources |
| `team` | `commerce-platform` | Gives incident responders a real owner to contact |
| `cost-center` | `checkout-billing` | Lets finance group monthly spend by business area |
| `data-class` | `restricted-customer` | Helps compliance checks find resources that hold sensitive customer data |
| `managed-by` | `bicep` | Shows which deployment system owns normal changes |

Those tags become useful the moment Maya has to search across a subscription. A storage account named `stordersprodevents` might look like Orders production, but the tags prove whether it belongs to the production Orders API, a staging test, or a shared export process. In a larger company, the tag set is also what cost tools and inventory scripts use to build clean reports.

The Azure CLI can create a tagged resource group:

```bash
az group create \
  --name "rg-orders-app-prod-uksouth" \
  --location "uksouth" \
  --tags service=orders-api env=prod team=commerce-platform cost-center=checkout-billing
```

For an existing resource, a merge operation can add a tag while keeping the existing set:

```bash
az tag update \
  --resource-id "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod" \
  --operation Merge \
  --tags data-class=restricted-customer managed-by=bicep
```

Tags have important limits. Microsoft documents a maximum of 50 tag name-value pairs on each resource, resource group, and subscription. Tag names are case-insensitive for operations, while tag values are case-sensitive. Tag names also have character restrictions, and some resource types have extra tag behavior that the team needs to check during design.

Tags are plain-text metadata, so secrets and personal data have no place there. A tag value can appear in cost reports, deployment history, exported templates, commands, monitoring logs, and third-party inventory tools. A tag such as `owner=orders-oncall` is useful, while a tag containing an email address, password, connection string, customer identifier, or private token creates avoidable exposure.

Tag inheritance is another common beginner trap. Azure stores tags on the subscription, resource group, or resource where the tag was applied. A tag on `rg-orders-data-prod-uksouth` stays on the resource group record, and child resources need their own tags through the deployment template, pipeline, Azure Policy, or reporting configuration. Cost Management has reporting features that can inherit tags for usage attribution, but that reporting behavior is separate from the actual tag set stored on each child resource.

This is why the Orders team's Bicep and Terraform modules keep common tags in one variable and pass them to every resource. That way the resource group, vault, storage account, database, private endpoint, and diagnostics all carry the same `service`, `env`, `team`, and `cost-center` values. The result is boring in the best way: every inventory query returns the same ownership story.

Tags make the resources findable, while locks add the deletion protection story for a production database or vault. Once Maya knows which resources belong to the Orders data layer, the next question is how Azure can add a deliberate pause before dangerous management changes. That is where locks enter the story.

## Locks
<!-- section-summary: Azure management locks protect subscriptions, resource groups, or resources from accidental deletion or broad control-plane modification. -->

An **Azure management lock** is a control-plane protection rule applied to a subscription, resource group, or resource. It affects Azure Resource Manager operations, so it protects the management path that creates, updates, moves, or deletes resources. The lock applies across users and roles, which means a person with broad permissions still has to deal with the lock before the blocked operation can succeed.

Azure has two lock levels. **CanNotDelete** lets authorized users read and modify a resource, while deletion is blocked. **ReadOnly** lets authorized users read a resource, while deletion and updates through the management plane are blocked. In the Azure portal, these appear as Delete and Read-only locks, while the CLI uses `CanNotDelete` and `ReadOnly`.

For most production data resources, the Orders team starts with `CanNotDelete`. A delete lock on `rg-orders-data-prod-uksouth` adds protection around the database, Key Vault, storage account, private endpoints, and other child resources in that group. A pipeline can still update configuration when it has normal permissions, but a delete attempt hits the lock and fails before the resource disappears.

The team uses `ReadOnly` more carefully. A read-only lock can block operations that feel like normal administration because many actions use POST requests against `https://management.azure.com`. For example, listing storage account keys, starting or restarting some resources, changing diagnostic settings, scaling an App Service plan, and creating child management objects can be affected. That behavior is useful for a freeze window, but it can surprise an on-call engineer during an incident.

Locks inherit downward from parent scopes. A lock on a resource group reaches resources inside that group, including resources added later. A stricter inherited lock can also win over a lighter lock closer to the resource. This makes a resource group lock powerful for production data groups, because the team can protect a whole set of long-lived resources with one control-plane rule.

Locks protect the management plane, and the data plane has its own permissions and safety controls. A `CanNotDelete` lock on a storage account protects the storage account resource from deletion through ARM, but blob data still needs storage data-plane permissions, versioning, soft delete, lifecycle rules, and backup choices. A `ReadOnly` lock on an Azure SQL logical server protects server configuration through ARM, while SQL permissions still control what happens inside the database.

The CLI can create a delete lock on the Orders data resource group:

```bash
az lock create \
  --name "prevent-orders-data-delete" \
  --lock-type CanNotDelete \
  --resource-group "rg-orders-data-prod-uksouth" \
  --notes "Production Orders data resources require review before deletion."
```

The team can list locks before a change window:

```bash
az lock list \
  --resource-group "rg-orders-data-prod-uksouth" \
  --query "[].{name:name,level:level,id:id,notes:notes}" \
  --output table
```

A lock is also a resource with its own ID under `Microsoft.Authorization/locks`. Creating or deleting locks requires permissions such as `Microsoft.Authorization/locks/*`, which Owner and User Access Administrator roles include. That permission model matters because removing a lock is itself a serious control-plane action, and production teams usually route it through a reviewed change.

Now Maya has the pieces: name, ID, provider type, tags, and locks. The last step is a habit that turns those pieces into safe operations. Before any change, the team collects evidence and looks for conflicts.

## Evidence Before Changes
<!-- section-summary: A safe Azure change starts by collecting subscription, resource ID, type, tags, lock state, and recent activity evidence before touching the target. -->

**Evidence before changes** means the team proves the target before changing it. In Azure, the wrong target can look very close to the right target. A staging group and production group can share a workload name. Two subscriptions can contain the same short resource name. A cost report can show a tag that was copied incorrectly. A deployment output can carry an old resource ID after a move.

The Orders incident gives us a concrete flow. Maya sees a checkout failure that mentions `kv-orders-prod`, and a teammate suggests updating the Key Vault firewall. Before she changes anything, she gathers a small evidence packet: active subscription, resource group, full ID, type, location, tags, locks, and recent activity. If any field disagrees with the story, the change pauses until the mismatch is explained.

The first check is the active Azure CLI context:

```bash
az account show \
  --query "{name:name,subscriptionId:id,tenantId:tenantId}" \
  --output json
```

The output should match the production subscription the incident expects:

```json
{
  "name": "sub-orders-prod",
  "subscriptionId": "88888888-4444-4444-4444-121212121212",
  "tenantId": "11111111-2222-3333-4444-555555555555"
}
```

Then Maya lists candidate Orders resources by tags and projects only the fields that matter:

```bash
az resource list \
  --query "[?tags.service=='orders-api' && tags.env=='prod'].{name:name,type:type,resourceGroup:resourceGroup,location:location,id:id}" \
  --output table
```

The table gives her a clean inventory:

```json
[
  {
    "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-data-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod",
    "location": "uksouth",
    "name": "kv-orders-prod",
    "resourceGroup": "rg-orders-data-prod-uksouth",
    "type": "Microsoft.KeyVault/vaults"
  },
  {
    "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-app-prod-uksouth/providers/Microsoft.App/containerApps/ca-orders-api-prod",
    "location": "uksouth",
    "name": "ca-orders-api-prod",
    "resourceGroup": "rg-orders-app-prod-uksouth",
    "type": "Microsoft.App/containerApps"
  }
]
```

For a larger subscription, Azure Resource Graph gives a stronger inventory query across subscriptions:

```kusto
Resources
| where tags["service"] == "orders-api"
| where tags["env"] == "prod"
| project name, type, resourceGroup, location, id
| order by resourceGroup asc, name asc
```

The evidence packet can stay small. It needs to answer the operational questions that prevent the most common mistakes.

| Evidence field | Question it answers | Bad sign |
|---|---|---|
| Active subscription | Which Azure estate will receive the command? | CLI points at staging during a production incident |
| Resource group | Which lifecycle container holds the resource? | A data resource appears in an app cleanup group |
| Resource ID | Which exact object will the command touch? | Stored ID points to an old resource group after a move |
| Resource type | Which provider API owns the object? | Script expects Key Vault but target type is Storage |
| Tags | Which service, environment, and team own the object? | Name says prod while `env` tag says staging |
| Lock state | Which management operations are intentionally blocked? | Delete request has no lock review for production data |
| Recent activity | Who or what changed it recently? | A deployment pipeline changed tags outside the normal release |

This habit keeps automation honest. A cleanup job might start with all resources tagged `env=dev`, but one resource could have `service=orders-api` and a production-looking resource ID because someone copied the wrong tag. A safe job checks multiple fields together and treats disagreement as evidence that the target needs review.

This also helps access reviews. When someone asks for Contributor on a resource group, the reviewer can look at the group ID, tags, resource types, and lock state. Contributor on `rg-orders-app-prod-uksouth` means something very different from Contributor on `rg-orders-data-prod-uksouth`, even though both names contain Orders and production.

By this point, Maya can prove the target before she changes anything. The final section ties the whole flow together from alert to safe action.

## Putting It All Together
<!-- section-summary: The Orders team combines names, IDs, types, tags, locks, and evidence into one repeatable resource review before production changes. -->

The Orders API alert starts with a friendly name: `kv-orders-prod`. Maya uses that name to find the likely resource, but she treats the name as the beginning of the investigation. The resource ID proves the exact subscription and resource group. The type proves that the object is a Key Vault vault. The tags prove that it belongs to `orders-api`, `prod`, and `commerce-platform`.

The resource group tells her the lifecycle boundary. `rg-orders-data-prod-uksouth` holds long-lived data resources, so changes need more care than a normal app redeploy. The lock list shows a `CanNotDelete` lock, which means deletion has a deliberate guardrail. The activity log and deployment outputs can then show which pipeline or person changed the vault configuration recently.

That sequence gives the team a repeatable production review:

| Step | What the team checks | Why it matters |
|---|---|---|
| 1 | Resource name | Humans find the likely resource quickly |
| 2 | Resource ID | Azure receives one exact target |
| 3 | Resource type | The team knows which provider API and rules apply |
| 4 | Tags | Ownership, environment, service, and cost story line up |
| 5 | Locks | Destructive management operations have a deliberate pause |
| 6 | Evidence packet | The change request contains proof instead of a guess |

This is the foundation for safer Azure operations. Names make resources readable. IDs make resources exact. Provider types explain the API family. Tags make resources searchable and reportable. Locks add protection around important management operations. Evidence before changes turns all of that into a habit the team can use during incidents, deployments, access reviews, and cost cleanup.

## What's Next

The Orders team can now find and verify exact Azure resources before touching them. The next foundation article zooms back out to the Azure service map: traffic entry, compute, state, identity, telemetry, and release paths.

That service map helps connect a production symptom to the right Azure service family. Once you can identify the exact resource, the next useful skill is knowing which service block owns the behavior you are debugging.

---

**References**

- [Define your naming convention](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) - Microsoft guidance on naming components, name permanence, resource name scope, and example Azure naming patterns.
- [Naming rules and restrictions for Azure resources](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules) - Resource-specific length, character, and uniqueness rules for Azure resource names.
- [Azure resource providers and types](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-providers-and-types) - Official explanation of provider namespaces, resource types, registration state, API versions, and supported locations.
- [Move Azure resources to a new resource group or subscription](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-resource-group-and-subscription) - Documents the standard resource ID format and the fact that moving a resource changes the ID path.
- [Use tags to organize your Azure resources and management hierarchy](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources) - Tag limits, case behavior, inheritance behavior, sensitive-data warning, and tag management guidance.
- [Lock your Azure resources to protect your infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources) - Lock levels, inheritance, control-plane scope, CLI commands, and data-plane considerations.
- [Azure Resource Graph sample queries by category](https://learn.microsoft.com/en-us/azure/governance/resource-graph/samples/samples-by-category) - Official query examples for resource inventory and projection patterns.
