---
title: "Projects, Billing, and Regions"
description: "Learn how GCP projects, folders, billing accounts, APIs, quotas, regions, and zones work together when placing a workload."
overview: "A GCP workload needs more than a service choice. This article follows one checkout API through the project boundary, parent folder, billing link, API gates, quota checks, and location choices that make the deployment ready for production."
tags: ["gcp", "projects", "billing", "regions", "zones"]
order: 2
id: article-cloud-providers-gcp-foundations-organizations-folders-projects-billing-accounts
aliases:
  - organizations-folders-projects-and-billing-accounts
  - regions-and-zones
  - article-cloud-providers-gcp-foundations-regions-and-zones
  - cloud-providers/gcp/foundations/organizations-folders-projects-and-billing-accounts.md
  - cloud-providers/gcp/foundations/regions-and-zones.md
---

## Table of Contents

1. [The Placement Questions](#the-placement-questions)
2. [Projects](#projects)
3. [Organizations and Folders Add Parent Controls](#organizations-and-folders-add-parent-controls)
4. [Billing Accounts](#billing-accounts)
5. [Enabled APIs Open the Service Gates](#enabled-apis-open-the-service-gates)
6. [Quotas Set the Launch Ceiling](#quotas-set-the-launch-ceiling)
7. [Global, Regional, and Zonal](#global-regional-and-zonal)
8. [A Production Placement Plan](#a-production-placement-plan)
9. [What's Next](#whats-next)

## The Placement Questions
<!-- section-summary: A GCP workload needs clear answers for ownership, billing, service activation, capacity, and location before resources are created. -->

The previous GCP foundation article gave us a service map. Our sample checkout API uses **Cloud Run** for the HTTP service, **Cloud SQL** for relational data, **Secret Manager** for credentials, **Artifact Registry** for container images, **Cloud Build** for builds, and **Cloud Logging** plus **Cloud Monitoring** for operations. That map tells us what kinds of services we plan to use.

The next job is placement. Placement means deciding where the workload lives inside Google Cloud, who owns that space, who pays for it, which service APIs are allowed to run there, how much capacity the project can consume, and which geographic location the workload uses. A team can choose the right compute service and still have a broken production setup if these placement choices stay vague.

For the checkout API, the team needs answers to a small set of concrete questions. Each answer gives a reviewer one practical coordinate for the production setup.

| Question | GCP concept involved | Checkout API example |
|---|---|---|
| Where do the resources live? | **Project** | `devpolaris-checkout-prod` |
| Where does the project sit in the company hierarchy? | **Organization and folder** | `folders/production/applications` |
| Who pays for the resources? | **Cloud Billing account** | Production application billing account |
| Which services can the project use? | **Enabled APIs** | Cloud Run, Cloud SQL Admin, Secret Manager, Artifact Registry |
| How much can the project consume? | **Quotas and system limits** | Cloud Run instances, database capacity, build rate |
| Where should the workload run? | **Region and zone** | Primary region `us-central1`, database HA across zones |

Those ideas connect tightly. The project gives the workload a boundary. The organization and folders place that boundary under company controls. The billing link lets paid services run. API enablement opens the specific service doors. Quotas define capacity guardrails. Regions and zones place the actual runtime near users and inside chosen failure domains. We start with projects because almost every practical GCP conversation eventually asks, "Which project are we talking about?"

## Projects
<!-- section-summary: A project is the main GCP workspace for resources, APIs, IAM policies, quotas, logs, billing links, and cleanup. -->

A **Google Cloud project** is the main workspace for a workload. It contains resources such as Cloud Run services, Cloud SQL instances, Cloud Storage buckets, service accounts, enabled APIs, quota usage, audit logs, and the link to the billing account. Google Cloud documentation calls the project the fundamental organizing entity because you need a project to create, enable, and use most Google Cloud services.

The checkout API should have separate projects for separate environments. A production project could be `devpolaris-checkout-prod`, a staging project could be `devpolaris-checkout-stg`, and a development sandbox could be `devpolaris-checkout-dev`. The names look related because the application is the same, but each project gives the team a separate boundary for permissions, quotas, logs, budgets, and cleanup.

Every project has three names that show up in different places. The **project ID** is the unique ID humans and tools usually type, such as `devpolaris-checkout-prod`. The **project number** is a numeric identifier that Google Cloud assigns and many service agents use behind the scenes. The **project name** is a mutable display name in the console, such as `Checkout API Production`.

That distinction matters in production. A service account email often includes the project ID, while Google-managed service agents often include the project number. A beginner may grant IAM access to the wrong principal because the project ID and project number both appear in logs, APIs, and generated identities. The placement record should capture both.

```bash
gcloud projects create devpolaris-checkout-prod \
  --name="Checkout API Production" \
  --folder=123456789012

gcloud projects describe devpolaris-checkout-prod \
  --format="value(projectNumber)"
```

The project also affects daily command safety. The `gcloud` CLI can use an active default project from local configuration, and many commands accept an explicit `--project` flag. A developer who has access to staging and production should treat the active project as change evidence, because creating a database in staging and creating a database in production are very different actions.

```bash
gcloud config get-value project

gcloud run services list \
  --project=devpolaris-checkout-prod \
  --region=us-central1
```

In a mature team, project creation usually happens through Terraform, an internal project vending tool, or a platform request. The workflow sets the project ID, parent folder, labels, initial IAM groups, billing link, required APIs, log routing, budget alert, and contacts. A project is small enough for one workload team to understand, but important enough that security, finance, and platform teams should review it.

The project gives the checkout API its working boundary. The next question is where that boundary sits inside the company.

## Organizations and Folders Add Parent Controls
<!-- section-summary: Organizations and folders place projects under inherited IAM roles, organization policies, and administrative ownership. -->

An **organization resource** is the company root in Google Cloud. It usually comes from a Google Workspace or Cloud Identity domain, and it can contain folders and projects. A **folder** is a grouping layer under the organization that helps teams apply administration patterns to sets of projects.

For DevPolaris, the checkout API might sit under a production applications folder. The staging and development projects might sit under a non-production folder. That structure lets the company apply stricter rules to production without slowing every sandbox in the same way.

```mermaid
flowchart TD
    Org["Organization: devpolaris.example"] --> Prod["Folder: production"]
    Org --> NonProd["Folder: non-production"]
    Prod --> Apps["Folder: applications"]
    Apps --> CheckoutProd["Project: devpolaris-checkout-prod"]
    NonProd --> CheckoutStg["Project: devpolaris-checkout-stg"]
    NonProd --> CheckoutDev["Project: devpolaris-checkout-dev"]
    Billing["Cloud Billing account: prod-apps"] -. "pays for" .-> CheckoutProd
```

Folders matter because policies can be inherited. IAM roles granted at an organization or folder can flow down to projects. Organization policies can also flow down and restrict how resources may be configured. For example, a production folder might restrict allowed resource locations, block public IP addresses on VMs, limit external sharing, or require specific security settings.

This is a common production surprise. A developer can have strong permissions inside `devpolaris-checkout-prod` and still see a deployment fail because a policy inherited from the production folder rejects the resource shape. The project IAM page may look fine, while the real answer sits one or two levels above the project.

```bash
gcloud projects get-ancestors devpolaris-checkout-prod
```

That command gives the parent chain for the project. During an access or deployment review, the parent chain tells the team which folder and organization policies may apply. The important habit is to review the project together with its ancestors, because the effective behavior comes from the full path.

Now the checkout API has a project and a parent folder. The next question is financial: which billing account pays for this workload, and who can control that link? That financial choice can block or approve the first real deployment.

## Billing Accounts
<!-- section-summary: A Cloud Billing account defines who pays, while the project records which billing account funds its usage. -->

A **Cloud Billing account** is the Google Cloud resource that defines who pays for a set of linked projects. It tracks charges and savings for usage in those projects, has its own IAM roles, and connects to a Google payments profile for invoices and payment instruments. The project owns the workload resources, while the billing account pays for their usage.

For the checkout API, finance might own a production application billing account. Platform automation links `devpolaris-checkout-prod` to that billing account during project setup. From that point, Cloud Run requests, Cloud SQL storage, Artifact Registry storage, Cloud Build minutes, logs, metrics, and network charges from the project accrue under that billing account.

```bash
gcloud billing accounts list

gcloud billing projects link devpolaris-checkout-prod \
  --billing-account=0X0X0X-0X0X0X-0X0X0X

gcloud billing projects describe devpolaris-checkout-prod
```

Billing has a separate permission boundary from the project. A developer may have permission to deploy Cloud Run services in the project without permission to link the project to a billing account. A finance or platform engineer may have billing account permissions without daily access to application resources. That split is healthy because the person who deploys code and the person who controls payment usually need different access.

Budgets belong in this conversation too. A **budget** tracks spend for a billing account or a scoped set of projects and sends alerts at configured thresholds. A budget gives the team an early warning system, while hard spend control needs additional governance, quota review, and incident processes.

For checkout production, a budget might alert at 50%, 90%, and 100% of the monthly target. The alert should go to the workload owner, platform on-call, and finance contact. If a bad deployment suddenly creates too many logs or build retries, the budget alert gives the team a cost signal before the monthly invoice delivers the first clue.

The billing link lets paid services run and gives finance a place to see cost. GCP still requires a project-level service API gate before the workload can use individual products.

## Enabled APIs Open the Service Gates
<!-- section-summary: Google Cloud service APIs must be enabled per project before deployments can create or use many managed services. -->

An **enabled API** is a project-level switch that allows a Google Cloud service API to be used in that project. Many GCP products have an API name ending in `googleapis.com`, such as `run.googleapis.com` for Cloud Run and `sqladmin.googleapis.com` for Cloud SQL administration. A disabled API gives the project a clear setup error when deployment tries to create or operate that service through the normal API path.

The checkout API needs a short API list before the first deployment. Cloud Run needs the Cloud Run API. Cloud SQL needs the Cloud SQL Admin API. Secret Manager needs the Secret Manager API. Artifact Registry needs the Artifact Registry API. Cloud Build, Logging, and Monitoring need their own APIs for the build and operations path.

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --project=devpolaris-checkout-prod

gcloud services list \
  --enabled \
  --project=devpolaris-checkout-prod
```

API enablement should live in the same setup workflow as project creation. A one-off manual click in the console can rescue a demo, but it creates drift in production. Terraform, a project vending tool, or a platform pipeline gives every new project the same approved API list and makes later changes reviewable.

Enabled APIs also help keep the service map honest. If the checkout API suddenly needs `bigquery.googleapis.com`, the pull request should explain why the checkout service now talks to BigQuery. The API list serves as a lightweight change record for which product surfaces this workload is allowed to use.

Enabling an API opens the door, and capacity still needs its own review. The next placement question is quota, because a service can be enabled while the project has too little allowance for launch traffic.

## Quotas Set the Launch Ceiling
<!-- section-summary: Quotas and system limits define how much resource capacity or API activity the project, folder, organization, region, or zone can consume. -->

**Quotas** are Google Cloud limits that control how much of a resource or API a consumer can use. Allocation quotas limit how many resources can exist, such as VM cores, IP addresses, or load balancers. Rate quotas limit how quickly API calls can happen, such as requests per minute. Concurrent quotas limit how many operations can run at the same time.

Most quotas apply at the project level, and many also include a location dimension such as global, regional, or zonal. Resource use in one project generally stays inside that project quota pool. Within one project, the applications and automation in that project share the same allowance.

For checkout production, quota review starts from the expected launch shape. The team estimates peak requests, Cloud Run maximum instances, Cloud SQL tier, database storage, number of static IP addresses, build frequency, expected log volume, and deployment concurrency. That estimate turns quota review into a practical release task instead of a last-minute error message.

| Quota area | Checkout API review question | Evidence the team should record |
|---|---|---|
| Cloud Run capacity | Can the service scale to the planned maximum instances in `us-central1`? | Current quota, planned max, owner of increase request |
| Cloud SQL capacity | Does the region support the planned database tier, HA shape, and storage growth? | Instance shape, storage forecast, regional capacity note |
| Build and deploy rate | Can Cloud Build and deployment automation handle release-day activity? | Build frequency, retry behavior, rate quota check |
| Networking resources | Are there enough IP addresses, load balancer resources, and connector capacity? | Regional resource count and expected growth |
| Logging and monitoring | Can logs, metrics, and alert policies handle expected traffic? | Log volume estimate and retention choice |

System limits sit next to quotas. A **system limit** is a fixed product constraint set by product design, such as a maximum field size or a product-specific design limit. Quota planning asks, "Do we have enough allowance?" System-limit planning asks, "Does this design fit inside the product shape?"

The Google Cloud console has an IAM & Admin page called **Quotas & System Limits** that shows current usage, values, filters by service, and usage charts. For production planning, the review record should include the quota name, service, location, current value, current usage, planned peak, and whether an adjustment request is already approved. That record gives launch day a clean answer when a `RESOURCE_EXHAUSTED` error appears.

Quota planning tells the team how much the project can consume. The final placement question is where that consumption should happen.

## Global, Regional, and Zonal
<!-- section-summary: Global, regional, and zonal scopes tell the team where a resource is managed and which failure domains can affect it. -->

A **global resource** or global service operates across the Google Cloud control plane instead of being placed in one customer-selected region. IAM policies, many project settings, and some networking resources show up this way. A **region** is an independent geographic area where Google Cloud offers service capacity. A **zone** is a deployment area inside a region and should be treated as a single failure domain.

A region generally consists of multiple zones, and many production architectures spread across zones inside one region for higher availability. The practical skill is knowing which scope each resource uses before an incident or compliance review forces the question.

The checkout API might choose `us-central1` because most customers, payment partners, and support teams sit in North America. Cloud Run is regional, so the service uses a region such as `us-central1`. Cloud SQL can use a regional high availability configuration. Some lower-level resources, such as a single Compute Engine VM or a zonal disk, use one specific zone such as `us-central1-a`.

Location choice should include four practical checks. These checks keep the region decision tied to customer traffic, compliance, product support, and the team's ability to operate the service.

| Check | What the team asks | Checkout API example |
|---|---|---|
| User latency | Where are the main users and integrations? | Payment calls and customer traffic mostly come from North America. |
| Data residency | Which legal or customer requirements control data location? | Order and payment metadata must stay in approved US locations. |
| Service availability | Does every required product and feature exist in the chosen location? | Cloud Run, Cloud SQL HA, Secret Manager, Artifact Registry, and monitoring all need support in the plan. |
| Operations and cost | Can the team operate the region well, and does the price fit the budget? | On-call coverage, support hours, and regional pricing go into the review. |

The team should write down the location type for each important resource. IAM policies and many project settings are global. Cloud Run services are regional. Cloud SQL HA uses a regional design. A single VM or attached disk can be zonal. Cloud Storage can use regional, dual-region, or multi-region locations depending on the bucket choice.

That list helps during incidents. If `us-central1-a` has a zonal problem, the team can quickly see whether checkout depends on a zonal VM or whether the main application path sits behind regional services. If the whole primary region has a severe issue, the team already knows which resources need a disaster recovery plan in another region.

Regions and zones connect cost, latency, compliance, and reliability. Now we can turn the whole placement discussion into one production record.

## A Production Placement Plan
<!-- section-summary: A placement plan records the project, hierarchy, billing, APIs, quotas, regions, owners, and review evidence before production launch. -->

The checkout API placement plan is the working agreement between application, platform, security, finance, and operations. It takes the service map and adds the GCP coordinates needed for a real deployment. The exact tool can be Terraform, an internal project vending form, a pull request template, or a release checklist, but the same facts should appear every time.

```yaml
workload: checkout-api
environment: production
project:
  id: devpolaris-checkout-prod
  display_name: Checkout API Production
  parent_folder: folders/123456789012
  labels:
    app: checkout
    environment: production
    owner: commerce-platform
billing:
  account_id: 0X0X0X-0X0X0X-0X0X0X
  budget_name: checkout-api-prod-monthly
  alert_recipients:
    - platform-oncall@example.com
    - finance@example.com
apis:
  - run.googleapis.com
  - sqladmin.googleapis.com
  - secretmanager.googleapis.com
  - artifactregistry.googleapis.com
  - cloudbuild.googleapis.com
  - logging.googleapis.com
  - monitoring.googleapis.com
location:
  primary_region: us-central1
  disaster_recovery_region: us-east4
quota_review:
  cloud_run_max_instances: approved
  cloud_sql_regional_capacity: approved
  build_rate: approved
  logging_volume: reviewed
required_reviews:
  - inherited organization policies
  - production IAM groups
  - billing link and budget alerts
  - API enablement list
  - regional quota evidence
  - data location approval
  - on-call and owner contacts
```

This kind of record prevents the common production scramble. A deployment failure can be checked against the API list, parent policies, quotas, and region decision. A cost spike can be traced to the project, labels, billing account, and budget alert. An access request can name the project, folder, and owner instead of asking someone to search the whole organization.

The important point is that GCP placement is one connected decision. The project is the workload boundary, the folder path gives inherited controls, the billing account pays, enabled APIs define the service surface, quotas set the capacity ceiling, and regions and zones place the runtime. A strong production setup records all of those facts before the first customer request arrives.

## What's Next

The checkout API now has a place to live. It has a project boundary, parent folder, billing account, API list, quota review, and region plan. The next foundation problem is identification inside that project.

The next article covers **Resources, Names, and Labels**. It explains how resource names, labels, tags, and paths help teams find resources, filter costs, write policies, review incidents, and keep ownership clear as the project grows.

---

**References**

- [Google Cloud resource hierarchy](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy) - Explains organizations, folders, projects, inherited policies, and project identifiers.
- [Organization Policy overview](https://cloud.google.com/resource-manager/docs/organization-policy/overview) - Describes organization policy constraints and how they apply across the resource hierarchy.
- [Cloud Billing overview](https://cloud.google.com/billing/docs/concepts) - Defines Cloud Billing accounts, linked projects, billing IAM, and how project usage accrues charges.
- [gcloud billing projects link](https://docs.cloud.google.com/sdk/gcloud/reference/billing/projects/link) - Documents linking a project to a valid, active billing account.
- [Create, edit, or delete budgets and budget alerts](https://cloud.google.com/billing/docs/how-to/budgets) - Explains budget scope, alert thresholds, permissions, and budget alerts.
- [Enable and disable services](https://cloud.google.com/service-usage/docs/enable-disable) - Documents project-level service API enablement and the required Service Usage permission.
- [Cloud Quotas overview](https://cloud.google.com/docs/quotas/overview) - Explains allocation, rate, and concurrent quotas, plus project, folder, organization, regional, and zonal dimensions.
- [View and manage quotas](https://cloud.google.com/docs/quotas/view-manage) - Shows how to review quotas, usage, system limits, and quota adjustments in Google Cloud.
- [Geography and regions](https://cloud.google.com/docs/geography-and-regions) - Defines regions, zones, zonal resources, regional resources, multi-regional services, and deployment considerations.
