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

The primary defense against resource identity mistakes is the Azure Resource ID. You can think of a resource ID as the cloud equivalent of a complete, absolute file path on your computer's filesystem. Just like `/var/log/nginx/access.log` tells you the exact directory tree leading to a specific file, an Azure Resource ID is a globally unique URI path that locates one specific resource across every subscription and region in the entire Azure cloud.

Every Azure resource ID follows a strict, standardized REST API path structure:

```text
/subscriptions/{subId}/resourceGroups/{rgName}/providers/{providerNamespace}/{resourceType}/{resourceName}
```

Let us dissect the complete anatomy of a production key vault resource ID segment-by-segment to see what stories its segments tell us:

```text
/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.KeyVault/vaults/kv-orders-prod
```

Reading this path from left to right, we find critical management evidence that tells a clear story:

*   **`/subscriptions/88888888-4444-4444-4444-121212121212`**: This is the starting envelope. It tells ARM exactly which subscription billing container and quota pool owns the resource.
*   **`/resourceGroups/rg-orders-prod-uksouth`**: This is the lifecycle folder. It defines the logical group that manages the resource's deployment lifecycle.
*   **`/providers/Microsoft.KeyVault`**: This is the Resource Provider namespace. It identifies the specific Azure API service team (here, the Key Vault team) responsible for handling requests to this resource.
*   **`/vaults`**: This is the logical Resource Type registry. It tells ARM what kind of resource we are looking at under that provider's domain.
*   **`/kv-orders-prod`**: This is the human-friendly, localized name given to the resource.

This path is the Azure equivalent of the AWS Amazon Resource Name (ARN). ARNs and Azure Resource IDs are styled differently, but both solve the exact same operational requirement: they locate one specific, absolute instance of a resource, eliminating all search ambiguity across global datacenters.

Under the hood, ARM uses this path string as a literal routing key to find the correct Resource Provider. When you send a command, ARM parses the `/providers/Microsoft.KeyVault` segment and knows exactly which internal Azure microservice API to route your JSON payload to. It is an extremely clean, RESTful architectural design. 

This routing mechanism behaves exactly like a web server's routing middleware or a Linux filesystem's inode path lookup. When a REST command hits the ARM endpoint (`management.azure.com`), ARM treats the URI segments as database keys. It checks its global registry index (Azure Resource Graph) to verify that the subscription and resource group exist, and then resolves the provider namespace to find the HTTP endpoint of the service controller. Only after this lookup is successful does ARM sign the management request and proxy the parameters forward, eliminating any risk of command routing ambiguity.

## Metadata Tagging: Standardizing Coordinates

To keep track of spending and manage thousands of resources across a global company, you must establish a clear tagging standard. A tag is a simple key-value pair attached directly to an Azure resource.

Think of metadata tags like sticky notes that you paste onto your resource boxes. In a clean, organized warehouse, every box has a label that tells you which department bought it, what project it belongs to, and who is responsible for paying its shelf space fee. Without these sticky notes, the warehouse quickly devolves into an un-auditable heap of anonymous boxes where no one knows who owns what.

Under the hood, tags are stored as a metadata collection of key-value string arrays within the resource's JSON block in the ARM directory database. Because they are indexed globally, billing engines and cost management dashboards can query these strings to partition costs. For our transactional orders API application, we enforce five standard metadata tags:

### 1. `team` (e.g., `commerce-platform`)
Identifies the engineering team holding budget and support authority. If a resource behaves unexpectedly or throws alerts, this tag tells operational engineers exactly who to contact in Slack or Teams, bypassing hours of diagnostic triage.

### 2. `env` (e.g., `prod`)
Distinguishes critical production environments from developer staging noise. Monitoring systems and deployment pipelines use this tag to apply environment-specific alerts, strict access controls, and firewall policies.

### 3. `service` (e.g., `orders-api`)
Maps the resource to a specific logical microservice boundary. This allows you to view all related compute, database, and storage costs as a unified application view in cost management dashboards, rather than looking at isolated virtual machine bills.

### 4. `cost-center` (e.g., `checkout-billing`)
Allocates the resource's monthly cost directly to business finance segments. You must activate this tag key inside the Microsoft Entra Billing portal to allow cost reporting engines to partition monthly spend. This helps finance teams automate monthly chargebacks.

### 5. `data-class` (e.g., `restricted-customer`)
Defines the compliance profile of the data stored within the resource. This tag dictates automated backup rules, snapshot retention policies, and encryption keys. If the tag is marked `restricted-customer`, automated compliance checkers verify that public network ingress is completely blocked.

> [!WARNING]
> **The Metadata Leakage Hazard**: Because tag keys and values are treated as public metadata within the control plane, they are exported in plain text to shared invoicing tools, third-party cost analyzers, and monthly billing reports. You must never write passwords, API credentials, private connection strings, or customer personal data (like email addresses or phone numbers) inside tag values. Keep tag values low-cardinality, clean, and strictly operational.

## Protecting the Control Plane: Management Locks

Have you ever accidentally deleted a file you spent hours working on? In the cloud, a single misclicked button in the web portal or a typo in a automated cleanup script can delete a whole database or network in seconds. To prevent these midnight mistakes, Azure provides a safety switch called a **Management Lock**.

Locks are control plane settings applied at the subscription, resource group, or individual resource scope. Azure supports two distinct lock types:

*   **`CanNotDelete` (Delete Lock)**: Authorized users can read and modify the resource, but any request to delete the resource through the control plane is instantly rejected. This is the ideal lock for production environments—it allows your pipelines to deploy updates and your engineers to inspect configurations, but blocks any accidental deletion.
*   **`ReadOnly` (Read Lock)**: Authorized users can only read resource properties. They are completely blocked from deleting the resource or making any state updates. It behaves like a write-protect switch on an SD card.

Management locks apply to all users, including those holding the master `Owner` role. Before an engineer can delete or modify a locked resource, they must first explicitly locate the lock, verify the operational context, and delete the lock object itself. This multi-step process introduces a critical physical firewall against accidental automation runs or late-night manual typing errors.

### The Control Plane vs. Data Plane Mismatch

A major architectural gotcha is the Read-Only lock data-plane mismatch. A `ReadOnly` lock placed on a database resource blocks control plane alterations (such as scaling the database instance size or modifying firewall rules), but it can also block applications from writing actual data records to the database. 

Under the hood, many database services utilize temporary control plane writes to handle normal queries. For example, database engines frequently write active connection lists, renew private DNS dynamic records, or update temporary session metadata to the central ARM controllers during runtime. 

Applying a `ReadOnly` lock to a running database blocks these metadata updates at the ARM level. When the database engine attempts to write its dynamic session state, ARM intercepts the request and rejects it, causing the database's runtime engine to hang or its client connection pool to crash with dynamic state errors. To protect your systems, use `ReadOnly` locks strictly for static networking or auditing resources, keeping them far away from volatile, active database or compute nodes.

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

To design a secure architecture, you must understand the physical control plane mechanism that occurs when a delete action is executed. When you apply a lock to `rg-orders-prod-uksouth`, the lock does not write custom settings inside the compute or database hardware. Instead, the lock exists as an independent metadata object managed by the `Microsoft.Authorization` resource provider.

When an operator or pipeline runs a delete command, the REST request is sent to `management.azure.com`. The ARM engine intercepts the request and parses the target resource ID:

```text
DELETE REST Request -> management.azure.com
                       -> 1. ARM checks target Resource ID
                       -> 2. Query Microsoft.Authorization Provider
                       -> 3. Lock detected (CanNotDelete)
                       -> 4. Return 409 Conflict (ARM rejects request)
```

Because the lock is evaluated at the central ARM endpoint, the delete request is blocked and rejected *before* it can be routed to the Key Vault or Storage Resource Provider.

This central interception makes lock evaluation incredibly fast and robust. The target service (like `Microsoft.KeyVault`) never receives the `DELETE` HTTP verb. ARM evaluates the lock check at its API gateway layer by querying the lock tables owned by the `Microsoft.Authorization` provider. Since this check is performed on the absolute URI path, any lock applied to a parent container (such as a subscription or resource group) automatically intercepts and blocks delete requests targeting any child resource inside that container.

## The Tagging Inheritance Trap

For engineers transitioning from AWS, the most common Azure metadata gotcha is the tagging inheritance trap.

In many AWS environments, tags applied to a CloudFormation stack or an Account automatically cascade and apply to every child resource provisioned under that scope. 

**Azure does not support automatic tag inheritance.**

If you apply the tag `env=prod` to `rg-orders-prod-uksouth`, the child container app (`app-orders-prod`) and key vault (`kv-orders-prod`) inside that group will remain completely un-tagged in Cost Explorer. 

Under the hood, ARM treats every single resource as an isolated REST API object with its own distinct properties block. A parent resource group is simply a metadata folder; it does not cascade its tags to child properties during deployment.

If your finance team runs a billing report grouped by the tag key `env`, the resources inside the group will compile thousands of dollars under an "un-grouped" or "blank" category, blinding managers to the true cost driver.

To avoid this, you must construct your deployment pipelines (such as Bicep templates or GitHub Actions scripts) to explicitly apply the tag metadata block to both the parent resource group and every individual child resource defined in your templates. You can also deploy an Azure Policy compliance rule that automatically intercepts non-compliant, un-tagged deployments or copies resource group tags to child resources at creation time.

## Putting It All Together

Operating a secure, transparent cloud hierarchy requires transitioning from friendly human names to absolute resource identifiers:

*   **Validate the Resource ID**: Rely on the complete `/subscriptions/.../resourceGroups/...` absolute URI path to identify targets; never execute scripts against friendly names.
*   **Tag Every Child Block**: Apply standard allocation tags (`team`, `env`, `service`) directly to individual resources, bypassing the Azure tagging inheritance limitation.
*   **Cable Delete Protection**: Enforce `CanNotDelete` locks on all production resource groups to block accidental human or automated deletions.
*   **Isolate Read Locks**: Avoid placing `ReadOnly` locks on active database or compute resources where runtime data-plane updates can trigger connection crashes.
*   **Audit before Execution**: Require incident responders to run `az resource show` in the shell to confirm active tenant and subscription paths before altering credentials.

## What's Next

We have established our resource identifiers, metadata tags, tagging flow behaviors, and management locks. Now we are ready to map our application jobs to physical Azure services. In the next article, we will construct the complete core services map, choosing the first Azure service families to inspect for public ingress, container runtime, persistent storage, secrets management, and observability.

---

**References**

* [Azure Resource ID Syntax and Structures](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-group-overview) - Path format standards for Resource Providers.
* [Lock Resources to Protect Infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources) - Management lock types and inheritance behavior.
* [Tagging Azure Resources and Hierarchies](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/tag-resources) - Best practices for cost allocation metadata.
* [Control Plane and Data Plane REST Operations](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/control-plane-and-data-plane) - Technical architecture of ARM interception loops.
