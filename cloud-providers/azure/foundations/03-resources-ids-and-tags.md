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

1. [Anatomy of the Azure Resource ID](#anatomy-of-the-azure-resource-id)
2. [Metadata Tagging: Standardizing Coordinates](#metadata-tagging-standardizing-coordinates)
3. [Protecting the Control Plane: Management Locks](#protecting-the-control-plane-management-locks)
4. [The CLI Scope: Inspecting Resources and Enforcing Locks](#the-cli-scope-inspecting-resources-and-enforcing-locks)
5. [Under-the-Hood: How ARM Locks Intercept the REST Pipeline](#under-the-hood-how-arm-locks-intercept-the-rest-pipeline)
6. [The Tagging Inheritance Trap](#the-tagging-inheritance-trap)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Anatomy of the Azure Resource ID

The primary defense against resource identity mistakes is the Azure Resource ID. A resource ID is Azure's absolute URI for one deployed resource, similar in structure to an API route or filesystem path that fully qualifies where an object lives.

Every Azure resource ID follows a strict, standardized REST API path structure:

```plain
/subscriptions/{subId}/resourceGroups/{rgName}/providers/{providerNamespace}/{resourceType}/{resourceName}
```

Let us dissect the complete anatomy of a production key vault resource ID segment-by-segment to see what stories its segments tell us:

```plain
/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod
```

Reading this path from left to right, we find critical management evidence that tells a clear story:

*   **`/subscriptions/88888888-4444-4444-4444-121212121212`**: This is the starting envelope. It tells ARM exactly which subscription billing container and quota pool owns the resource.
*   **`/resourceGroups/rg-orders-prod-uksouth`**: This is the lifecycle container. It defines the logical group that manages the resource's deployment lifecycle.
*   **`/providers/Microsoft.KeyVault`**: This is the Resource Provider namespace. It identifies the specific Azure API service team (here, the Key Vault team) responsible for handling requests to this resource.
*   **`/vaults`**: This is the logical Resource Type registry. It tells ARM what kind of resource we are looking at under that provider's domain.
*   **`/kv-orders-prod`**: This is the human-friendly, localized name given to the resource.

This path is the Azure equivalent of the AWS Amazon Resource Name (ARN). ARNs and Azure Resource IDs are styled differently, but both solve the exact same operational requirement: they locate one specific, absolute instance of a resource, eliminating all search ambiguity across global datacenters.

### Resource Provider Registration: The Routing Contract

Resource provider registration is the subscription-level switch that allows ARM to route deployment requests to a service namespace such as `Microsoft.KeyVault` or `Microsoft.ContainerService`. If you attempt to deploy a resource using a provider that has not been registered, ARM aborts the deployment and returns a `MissingSubscriptionRegistration` error.

In a mature enterprise cloud, subscription bootstrap scripts register all required namespaces before developers deploy resources. You can query the registration state and supported API versions of a provider directly from the Azure CLI:

```bash
$ az provider show --namespace "Microsoft.KeyVault" --query "{registrationState:registrationState, apiVersions:apiVersions[0]}" --output json
```

This returns the registration telemetry:

```json
{
  "apiVersions": "2023-07-01",
  "registrationState": "Registered"
}
```

If a namespace is unregistered, you can register it with a single CLI call:

```bash
$ az provider register --namespace "Microsoft.KeyVault"
```

This registration step updates the subscription metadata inside the ARM engine, opening the routing path for all downstream deployments of that service family.

## Metadata Tagging: Standardizing Coordinates

A tag is a simple key-value pair attached to an Azure resource. Tags exist so humans, automation, cost tools, and audit reports can group resources by owner, environment, service, or data class.

Example: `team=commerce-platform`, `env=prod`, and `service=orders-api` let cost reports and incident responders identify who owns a resource without guessing from its name.

To keep track of spending and manage thousands of resources across a global company, you must establish a clear tagging standard.

Metadata tags act as queryable labels on resource records. They give cost tools, policy reports, inventory searches, and automation scripts consistent fields for ownership, environment, service, cost center, and data classification.

Under the hood, tags are stored as a metadata collection of key-value string arrays within the resource's JSON block in the ARM directory database. Because they are indexed globally, billing engines and cost management dashboards can query these strings to partition costs. For our transactional orders API application, we enforce five standard metadata tags:

### 1. `team` (e.g., `commerce-platform`)
Identifies the engineering team holding budget and support authority. If a resource behaves unexpectedly or throws alerts, this tag tells operational engineers exactly who to contact in Slack or Teams, bypassing hours of diagnostic triage.

### 2. `env` (e.g., `prod`)
Distinguishes critical production environments from developer staging noise. Monitoring systems and deployment pipelines use this tag to apply environment-specific alerts, strict access controls, and firewall policies.

### 3. `service` (e.g., `orders-api`)
Maps the resource to a specific logical microservice boundary. This allows you to view all related compute, database, and storage costs as a unified application view in cost management dashboards, rather than looking at isolated virtual machine bills.

### 4. `cost-center` (e.g., `checkout-billing`)
Allocates the resource's monthly cost directly to business finance segments. Cost Management + Billing can group and filter spend by tags, and Cost Management tag inheritance can apply parent tags to usage records for reporting when that feature is enabled. This helps finance teams automate monthly chargebacks without treating the tag as an identity or security boundary.

### 5. `data-class` (e.g., `restricted-customer`)
Defines the compliance profile of the data stored within the resource. This tag dictates automated backup rules, snapshot retention policies, and encryption keys. If the tag is marked `restricted-customer`, automated compliance checkers verify that public network ingress is completely blocked.

> [!WARNING]
> **The Metadata Leakage Hazard**: Because tag keys and values are treated as public metadata within the control plane, they are exported in plain text to shared invoicing tools, third-party cost analyzers, and monthly billing reports. You must never write passwords, API credentials, private connection strings, or customer personal data (like email addresses or phone numbers) inside tag values. Keep tag values low-cardinality, clean, and strictly operational.

## Protecting the Control Plane: Management Locks

An Azure management lock is a control-plane protection rule that blocks selected management operations before they reach the resource provider. It is designed for production resources where an authorized user or automation script should still be forced through an extra removal step before deleting or freezing configuration.

Locks are control plane settings applied at the subscription, resource group, or individual resource scope. Azure supports two distinct lock types:

*   **`CanNotDelete` (Delete Lock)**: Authorized users can read and modify the resource, but any request to delete the resource through the control plane is instantly rejected. This is the ideal lock for production environments because it allows pipelines to deploy updates and engineers to inspect configurations while blocking accidental deletion.
*   **`ReadOnly` (Read Lock)**: Authorized users can only read resource properties. They are completely blocked from deleting the resource or making any state updates. It behaves as a control-plane write filter on the resource configuration.

Management locks apply to all users, including those holding the master `Owner` role. Before an engineer can delete or modify a locked resource, they must first explicitly locate the lock, verify the operational context, and delete the lock object itself. This multi-step process adds a deliberate control-plane interruption point before destructive automation or manual commands can succeed.

### The Control Plane vs. Data Plane Mismatch

A major architectural gotcha is the control-plane and data-plane mismatch. A `ReadOnly` lock placed on a database resource blocks control-plane alterations, such as scaling the database instance size or modifying firewall rules. It does not turn the database engine into a read-only database. Normal SQL transactions are data-plane operations, so application inserts and updates can still succeed if the database's own permissions allow them.

The confusing part is that some operations feel like data access but still depend on management-plane actions. For example, listing account keys, changing diagnostic settings, updating firewall rules, or modifying a service configuration can be blocked by a `ReadOnly` lock. To protect your systems, use `CanNotDelete` locks for most production resources, reserve `ReadOnly` locks for cases where you truly want to freeze management settings, and protect actual records with database permissions, Key Vault RBAC, storage data-plane RBAC, soft delete, versioning, and backups.

![A pseudo-code infographic showing a management lock blocking an ARM delete request while a SQL data-plane query bypasses the lock](/content-assets/articles/article-cloud-providers-azure-foundations-resource-groups-and-ids/management-lock-plane-split.png)

*Management locks protect resource configuration through ARM; the data inside a service still needs service-level permissions, recovery controls, and backups.*

## The CLI Scope: Inspecting Resources and Enforcing Locks

To audit resources and protect them without using the slow Web Portal, you use the Azure CLI to query exact resource IDs and provision management locks directly from your terminal.

Let us execute a terminal session to inspect our production key vault and apply a `CanNotDelete` lock:

```bash
$ az resource show --id "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod"
```

This terminal command queries the ARM engine to return the absolute configuration profile of the resource:

```json
{
  "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod",
  "location": "uksouth",
  "name": "kv-orders-prod",
  "properties": {
    "enableRbacAuthorization": true,
    "vaultUri": "https://kv-orders-prod.vault.azure.net/"
  },
  "resourceGroup": "rg-orders-prod-uksouth",
  "tags": {
    "cost-center": "checkout-billing",
    "env": "prod",
    "service": "orders-api",
    "team": "commerce-platform"
  },
  "type": "Microsoft.KeyVault/vaults"
}
```

This returns exact resource evidence. To lock this specific resource group from accidental deletion, you run the CLI lock command:

```bash
$ az lock create \
    --name "PreventProdGroupDelete" \
    --lock-type CanNotDelete \
    --resource-group "rg-orders-prod-uksouth"
```

This terminal execution establishes a solid protection layer:

```json
{
  "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.Authorization/locks/PreventProdGroupDelete",
  "level": "CanNotDelete",
  "name": "PreventProdGroupDelete",
  "resourceGroup": "rg-orders-prod-uksouth"
}
```

## Under-the-Hood: How ARM Locks Intercept the REST Pipeline

An ARM lock is a management-layer record that tells Azure Resource Manager to block selected write or delete operations. It protects the resource configuration path, not the files, rows, or runtime data inside the service.

Example: a `CanNotDelete` lock on `rg-orders-prod-uksouth` blocks `az group delete`, but it does not stop a SQL client from running a bad `DELETE FROM Orders` query inside the database.

To design a secure architecture, you must understand the control plane mechanism that occurs when a delete action is executed. When you apply a lock to `rg-orders-prod-uksouth`, the lock does not write custom settings inside the compute or database hardware. Instead, the lock exists as an independent metadata object managed by the `Microsoft.Authorization` resource provider.

When an operator or pipeline runs a delete command, the REST request is sent to the central Azure Resource Manager endpoint at `management.azure.com`. The incoming HTTP request payload looks like this:

```plain
DELETE /subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth?api-version=2021-04-01 HTTP/1.1
Host: management.azure.com
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIs...
Accept: application/json
```

Before ARM forwards this request to the `Microsoft.Resources` provider to delete the resource group, the ARM API Gateway intercepts the execution thread. It runs a pre-routing filter that scans the path hierarchy:

1.  **Hierarchy Extraction**: ARM parses the request URI and extracts all containing scopes: the target resource group, the parent subscription, and any parent management groups.
2.  **Lock Table Query**: ARM issues an internal query to the `Microsoft.Authorization` provider database to check if any lock resources exist at any of these parent scopes. To optimize performance and prevent adding database latency to every single REST call, ARM maintains a high-speed, distributed in-memory cache of these lock mappings.
3.  **Lock Detection**: If a lock is found (such as `PreventProdGroupDelete` at the resource group level), the evaluation loop halts immediately.
4.  **Immediate Rejection**: ARM aborts the request at its gateway boundary and returns a `409 Conflict` HTTP status code to the client. The actual resource provider (like Key Vault or SQL Database) is never contacted, and no delete signal is ever sent to the backend datacenter blades.

The raw JSON payload returned by the ARM gateway to your terminal or CI/CD runner provides explicit evidence of this security interception:

```json
{
  "error": {
    "code": "ScopeLocked",
    "message": "The scope '/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth' cannot perform this write or delete operation because of a conflict lock. Please remove the lock and try again."
  }
}
```

This central interception makes lock evaluation incredibly fast and robust. The target service never receives the `DELETE` HTTP verb. Because this check is performed on the absolute URI path, any lock applied to a parent container (such as a subscription or resource group) automatically cascades down the tree. It intercepts and blocks delete requests targeting any child resource inside that container, keeping the production blast radius fully protected.

## The Tagging Inheritance Trap

Tag inheritance is the expectation that labels from a parent container automatically copy to child resources. In Azure, resource group tags are useful coordinates, but they do not automatically become tags on the resources inside the group.

Example: tagging `rg-orders-prod-uksouth` with `team=commerce-platform` does not automatically tag `kv-orders-prod` or `ca-orders-api-prod`; your deployment template or policy must apply those tags too.

For engineers transitioning from AWS, this is the most common Azure metadata gotcha.

![An infographic showing that resource group tags do not automatically copy to child resources](/content-assets/articles/article-cloud-providers-azure-foundations-resource-groups-and-ids/tag-inheritance-trap-gpt.png)

*Resource group tags are a useful coordinate, but child resources still need their own tags or an audit process will find gaps.*

In many AWS environments, tags applied to a CloudFormation stack or an Account automatically cascade and apply to every child resource provisioned under that scope.

Azure resource tags do not automatically copy from a resource group to its child resources.

If you apply the tag `env=prod` to `rg-orders-prod-uksouth`, the child container app (`app-orders-prod`) and key vault (`kv-orders-prod`) inside that group will remain untagged as resources unless your deployment or policy applies the tag to them. Cost Management has a separate tag inheritance feature for usage reporting, but that does not change the resource object's own tag set.

Under the hood, ARM treats every single resource as an isolated REST API object with its own distinct properties block. A parent resource group is a metadata container; it does not cascade its tags to child properties during deployment.

If your finance team runs a billing report grouped by the tag key `env`, the resources inside the group will compile thousands of dollars under an "un-grouped" or "blank" category, blinding managers to the true cost driver.

To avoid this, construct your deployment pipelines (such as Bicep templates or GitHub Actions scripts) to explicitly apply the tag metadata block to both the parent resource group and every individual child resource defined in your templates. You can also deploy an Azure Policy rule that denies untagged deployments or uses a modify effect to copy resource group tags to child resources at creation time. For billing reports, enable Cost Management tag inheritance only when you understand that it changes reporting attribution, not the tags stored on the resource itself.

:::expand[The Idiomatic Bicep Tag Propagation Pattern]{kind="pattern"}
Unlike AWS CloudFormation, where stack-level tags can propagate to supported nested resources, Azure Resource Manager (ARM) does not automatically copy a resource group's tags to child resources. If you tag a Resource Group, the child resources inside it remain untagged unless your template, deployment pipeline, Azure Policy, or reporting configuration handles the propagation deliberately.

To solve this systematically, Azure practitioners use the **Bicep Tag Propagation Pattern**. Instead of copy-pasting tag blocks onto every resource - which leads to tag drift when new resources are added - you declare a single master tags object at the top of your Bicep file and pass it dynamically to every child resource.

Here is the before and after comparison:

*   **Before (Copy-Paste Drifting Pattern):**
    ```bicep
    resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
      name: 'sql-orders-prod'
      tags: { env: 'prod', team: 'commerce' }
    }
    resource kv 'Microsoft.KeyVault/vaults@2021-11-01' = {
      name: 'kv-orders-prod'
      tags: { env: 'production', team: 'commerce-team' } // Mismatched tag values
    }
    ```

*   **After (Idiomatic Bicep Propagation Pattern):**
    ```bicep
    var defaultTags = {
      env: 'prod'
      team: 'commerce-platform'
      service: 'orders-api'
      costCenter: 'checkout-billing'
    }

    resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
      name: 'sql-orders-prod'
      tags: defaultTags
    }
    ```

To enforce compliance for resources deployed outside of Bicep (such as manual portal creations), you can pair this pattern with Azure Policy:

| Tagging Approach | Enforcement Mechanism | Tradeoff / Strength |
| :--- | :--- | :--- |
| **Bicep `var` Propagation** | Client-side definition passed to each resource | **High consistency**, easily updated in one location; relies on developer compliance. |
| **Azure Policy `append`** | Automatically adds missing tags to resources during deploy | **Soft enforcement**; can mask developer omissions in source code repositories. |
| **Azure Policy `deny`** | Blocks deployments if required tags are missing | **Hard enforcement**; ensures 100% compliance but breaks non-compliant pipelines. |

**Rule of thumb:** Define your master tagging dictionary once at the root Bicep deployment and propagate it as a variable parameter to all downstream modules. Combine this with an Azure Policy `deny` guardrail to guarantee no untagged resource is ever deployed in production.
:::

## Putting It All Together

Operating a secure, transparent cloud hierarchy requires transitioning from friendly human names to absolute resource identifiers:

*   **Validate the Resource ID**: Rely on the complete `/subscriptions/.../resourceGroups/...` absolute URI path to identify targets; never execute scripts against friendly names.
*   **Tag Every Child Block**: Apply standard allocation tags (`team`, `env`, `service`) directly to individual resources, bypassing the Azure tagging inheritance limitation.
*   **Cable Delete Protection**: Enforce `CanNotDelete` locks on all production resource groups to block accidental human or automated deletions.
*   **Isolate Read Locks**: Avoid placing `ReadOnly` locks on active database or compute resources where runtime data-plane updates can trigger connection crashes.
*   **Audit before Execution**: Require incident responders to run `az resource show` in the shell to confirm active tenant and subscription paths before altering credentials.

## What's Next

We have established our resource identifiers, metadata tags, tagging flow behaviors, and management locks. Now we are ready to map our application jobs to physical Azure services. In the next article, we will construct the complete core services map, choosing the first Azure service families to inspect for public ingress, container runtime, persistent storage, secrets management, and observability.

![A six-tile Azure resource safety checklist covering exact IDs, provider routing, business tags, delete locks, read lock caution, and auditing first](/content-assets/articles/article-cloud-providers-azure-foundations-resource-groups-and-ids/resource-safety-checklist.png)

*Use this as the resource safety checklist: identify the exact resource path, understand which provider owns the action, apply business tags directly, protect production with delete locks, treat read locks carefully, and audit before changing anything.*

---

**References**

* [Azure Resource ID Syntax and Structures](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-group-overview) - Path format standards for Resource Providers.
* [Lock Resources to Protect Infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources) - Management lock types and inheritance behavior.
* [Tagging Azure Resources and Hierarchies](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources) - Best practices for cost allocation metadata.
* [Control Plane and Data Plane REST Operations](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/control-plane-and-data-plane) - Technical architecture of ARM interception loops.
