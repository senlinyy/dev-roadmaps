---
title: "Tenants, Subscriptions, and Regions"
description: "Place an Azure workload by choosing the right tenant, subscription, resource group, region, and availability-zone shape before resources drift into accidental homes."
overview: "After the Azure mental model, the first concrete decision is placement. This article follows one Orders API from an AWS-style account and Region habit into Azure tenants, subscriptions, resource groups, regions, and availability zones."
tags: ["azure", "tenants", "subscriptions", "regions", "zones"]
order: 2
id: article-cloud-providers-azure-foundations-tenants-and-subscriptions
aliases:
  - tenants-and-subscriptions
  - tenants-subscriptions-and-regions
  - tenants-subscriptions-and-resource-groups
  - tenants-subscriptions-resource-groups
  - azure-boundaries-and-resource-organization
  - azure-boundaries-and-resource-organisation
  - regions-and-zones
  - azure-regions-and-core-services
  - regions-and-availability-zones
  - article-cloud-providers-azure-foundations-regions-and-availability-zones
  - cloud-providers/azure/foundations/tenants-and-subscriptions.md
  - cloud-providers/azure/foundations/tenants-subscriptions-resource-groups.md
  - cloud-providers/azure/foundations/regions-and-zones.md
  - cloud-providers/azure/foundations/azure-regions-and-core-services.md
  - cloud-providers/azure/foundations/regions-and-availability-zones.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Tenants](#tenants)
3. [Management Groups](#management-groups)
4. [Subscriptions](#subscriptions)
5. [Scope Inheritance](#scope-inheritance)
6. [Separate Subscriptions](#separate-subscriptions)
7. [Resource Groups](#resource-groups)
8. [Regions](#regions)
9. [Availability Zones](#availability-zones)
10. [Placement Review](#placement-review)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Problem

The previous article built the first Azure map: app jobs, Azure resources, Resource Manager, scopes, and callers. Now the Orders API needs a home.

If you learned AWS first, you may expect one account decision to carry most of the early weight. Azure asks for a more split answer. Which tenant holds identity? Which subscription owns resources and cost? Which resource group owns lifecycle? Which region hosts the workload? Which zone shape makes local failure survivable?

The app can run before those answers are clean. That is the trap. A quick Azure test can become a production-like system whose resources sit in a convenient subscription, a generic resource group, and whichever region the portal remembered.

The placement question is:

> Where should this Azure workload live, and what boundary am I creating?

This article follows that question from tenant to subscription to resource group to region and availability zones.

## Tenants

A tenant is the identity home. In Azure, tenants are tied to Microsoft Entra. Users, groups, service principals, app registrations, enterprise applications, and many identity settings belong to a tenant.

That makes the tenant the first context check. If a teammate signs into the wrong tenant, the right subscription may not appear. If a pipeline service principal belongs to one tenant but the deployment targets a subscription in another, the failure is not a compute problem or a region problem. It is an identity-home problem.

AWS learners often expect the account to be the first identity and resource container. Azure separates those ideas. The tenant is where identity starts. The subscription is where most Azure resources are created and paid for.

For Orders, the tenant answer should be boring and explicit:

```text
Tenant: DevPolaris Microsoft Entra tenant
Human access: engineering users and groups
Workload access: deployment service principal and managed identities
```

Do not treat the tenant as a decorative label in the portal. It decides which directory issued the identity that Azure sees.

## Management Groups

Management groups organize subscriptions above the subscription level. They are useful when an organization has several subscriptions and wants consistent policy, access, and governance across them.

A beginner does not need an elaborate management group tree to understand Azure. The useful first idea is inheritance. If a policy is assigned above a subscription, a deployment inside that subscription can be blocked even when the resource group looks empty and the user has a role there.

For a small learning environment, the management group may be invisible. For a real company, it may explain why production subscriptions all require certain regions, tags, security settings, or public access restrictions.

Use a management group when the rule is meant for many subscriptions. Use the subscription or resource group when the rule belongs to one workload boundary.

## Subscriptions

A subscription is the main Azure resource and billing boundary that most engineers touch every day. Resources are created in a subscription. Costs are tracked through subscriptions. Quotas and many policy decisions are subscription-shaped. Role assignments at subscription scope can affect every resource group inside it.

This is the Azure boundary that often feels closest to an AWS account in day-to-day work. The comparison helps, but it is not exact:

| AWS habit | Azure translation |
| --- | --- |
| Check the account before changing resources | Check the tenant and subscription |
| Split prod and dev accounts | Usually split prod and dev subscriptions |
| Use account boundaries for blast radius | Use subscriptions, resource groups, policies, and roles together |
| Find spend by account | Start with subscription cost, then resource groups and tags |

The subscription choice matters before service choice. A production database in a shared experiment subscription is still in the wrong place even if the database service is technically correct.

For Orders, a simple first split might be:

```text
sub-orders-dev
sub-orders-prod
```

That gives development a safer place to break things and production a clearer place to control access, budgets, policies, quotas, and evidence.

## Scope Inheritance

Azure management settings can apply at several scopes. A role assignment, policy, or lock at a parent scope can affect child scopes below it.

That inheritance is useful when the rule is intentional. A production management group can require approved regions across every production subscription. A subscription policy can require tags across all resource groups. A resource group role assignment can let a release pipeline update only the resources for one workload.

It is also confusing when the team looks in the wrong place. A deployment to `rg-orders-prod-uksouth` may fail because of a policy assigned above the resource group. Giving someone a role on one resource will not automatically override a deny or requirement inherited from a broader scope.

Use the smallest scope that fits the job, and check parent scopes when behavior does not match the resource group you are staring at.

## Separate Subscriptions

You do not need a separate subscription for every tiny component. You need one when the boundary itself should be different.

Production and non-production often deserve separate subscriptions because they have different access risk, budget expectations, change controls, and data sensitivity. A load test or sandbox might also deserve separation if it can burn quota or cost in a way that should not affect production.

Resource groups and tags are useful, but they are not the same as a subscription boundary. A resource group can help organize lifecycle. Tags can help reporting. A subscription can make billing, policy, access, quotas, and blast radius clearer at a broader level.

| Boundary question | Usually same subscription | Usually separate subscription |
| --- | --- | --- |
| Same environment? | App, database, vault, and logs for one production workload | Production and development |
| Same budget owner? | Components paid by the same team budget | Experiments or shared platforms with separate cost ownership |
| Same access model? | One team operates the full workload | Teams need different admin paths |
| Same policy needs? | Similar compliance and region rules | Regulated data and open sandbox work |
| Same quota risk? | Small related services | Load tests or bursty experiments |

The point is not bureaucracy. The point is to make the default mistake smaller.

## Resource Groups

A resource group is a lifecycle and management container inside a subscription. This is one of Azure's most important differences from AWS foundations.

The resource group should answer a practical question: which resources do we deploy, review, tag, grant access to, and delete together? If the app runtime, Key Vault, database, and logs share ownership and lifecycle, they might live in one resource group for the first version. If the database has a different lifecycle, owner, or recovery process, it may deserve a separate group.

Resource groups are also scopes. You can assign roles, policies, tags, and locks at a resource group. You can deploy a template to a resource group. You can delete a resource group and delete the resources inside it.

Two gotchas matter early.

First, a resource can exist in only one resource group. You can move many resources later, but a move changes the management path and can affect scripts, alerts, dashboards, role assignments, and assumptions.

Second, a resource group has a location for its metadata, but the resources inside the group can be in different regions. That is sometimes valid. It is also a common source of confusion. For a beginner production map, keep the resource group location and main resource region aligned unless there is a written reason not to.

## Regions

After the boundary comes the geographic home. An Azure region is a set of datacenters in a geographic area. Regions affect latency, data residency, service availability, cost, and recovery design.

AWS Regions and Azure regions play the same broad role: they are geographic homes for many resources and service endpoints. The specific region list, service availability, naming, and reliability features differ, so do not assume every service exists in every region or supports the same options.

Choose a region by asking what the workload needs to be near:

| Region pressure | Question |
| --- | --- |
| Users | Where should requests feel close? |
| Data rules | Where is the data allowed or expected to live? |
| Dependencies | Where do nearby systems already run? |
| Service support | Does the chosen Azure service and SKU exist there? |
| Recovery | Is this a single-region or multi-region design? |
| Team operations | Where will control plane operations and support expectations be simplest? |

For Orders, the placement note might say:

```text
Primary region: uksouth
Reason: customer latency, data posture, team familiarity, service support
Exception: none for first release
```

The region is not a cosmetic field in a command. It is part of the system design.

## Availability Zones

Availability zones are separated groups of datacenters inside many Azure regions. They reduce the chance that one local datacenter failure removes every running copy of a workload.

The AWS idea carries over: zones are local failure boundaries inside a region. Azure adds service-specific language that matters: zonal, zone-redundant, and nonzonal.

| Azure zone shape | Meaning | First question |
| --- | --- | --- |
| Zonal | The resource is placed in one selected zone | What happens if that zone has a problem? |
| Zone-redundant | The service spreads or replicates across zones | Does this service and SKU support that in this region? |
| Nonzonal or regional | You do not choose a zone shape | Is that acceptable for this workload's availability target? |

Some Azure services automatically use zones in supported regions. Others require you to configure zone redundancy or deploy multiple zonal resources yourself. Some services or SKUs do not support the zone shape you want. That means "use zones" is not a design by itself. The design has to say which resources are zone-redundant, which are zonal, and which remain regional.

There is one more Azure gotcha for AWS learners: logical zone numbers can map differently between subscriptions. Zone 1 in one subscription is not guaranteed to be the same physical zone as Zone 1 in another subscription. For most beginner workloads, the main lesson is simpler: do not compare zone numbers across subscriptions as if they are physical datacenter names.

## Placement Review

Before creating the first production resources, write a short placement review. It should be small enough to read during a pull request.

| Question | Orders answer |
| --- | --- |
| Which tenant? | DevPolaris Microsoft Entra tenant |
| Which subscription? | `sub-orders-prod` |
| Which resource group? | `rg-orders-prod-uksouth` |
| Which region? | `uksouth` |
| Which zone shape? | Zone-redundant where supported for entry and data, multiple instances for compute |
| Which exceptions? | None for the first release |
| Which evidence proves context? | `az account show`, resource IDs, tags, deployment record |

This review is not only documentation. It prevents accidental homes. If a command, portal screen, Terraform provider, or pipeline variable disagrees with the review, the team has found the mistake before the resource becomes important.

## Putting It All Together

The opening problem was that Azure placement is split across several boundaries. AWS experience helps, but it does not remove the Azure-specific questions.

The tenant is the identity home. Management groups can apply governance above subscriptions. The subscription is the main resource, cost, quota, and policy boundary. Resource groups organize lifecycle and management inside the subscription. Regions choose geographic placement. Availability zones shape local failure behavior.

The Orders API now has a real home: tenant, subscription, resource group, region, and zone strategy. That is enough context to create resources without guessing where they belong.

## What's Next

Now that the workload has a home, the next problem is exact identity. Azure names are useful, but scripts, policies, alerts, and tickets need stronger evidence. The next article explains resource IDs, resource types, tags, locks, and safer resource identification.

---

**References**

- [What is Microsoft Entra?](https://learn.microsoft.com/en-us/entra/fundamentals/what-is-entra). Supports tenant and identity-home framing.
- [What are Azure management groups?](https://learn.microsoft.com/en-us/azure/governance/management-groups/overview). Supports management group hierarchy and inheritance.
- [What is Azure Resource Manager?](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/overview). Supports subscription, resource group, scope, and resource group location behavior.
- [What are Azure regions?](https://learn.microsoft.com/en-us/azure/reliability/regions-overview). Supports the region and geography placement explanation.
- [What are Azure availability zones?](https://learn.microsoft.com/en-us/azure/reliability/availability-zones-overview). Supports zonal, zone-redundant, nonzonal, and logical zone mapping explanations.
- [Azure region pairs and nonpaired regions](https://learn.microsoft.com/en-us/azure/reliability/regions-paired). Supports the caution that region pairs are service-specific and not the whole resilience design.
