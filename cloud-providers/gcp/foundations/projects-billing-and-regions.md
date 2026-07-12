---
title: "Projects, Billing, and Regions"
description: "Learn how GCP projects, folders, billing accounts, APIs, quotas, regions, and zones work together during workload placement."
overview: "A GCP workload needs more than a service choice. Follow one photo sharing backend through the project boundary, billing link, API gates, quota checks, and location choices that make the deployment ready for production."
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
2. [Projects Give the Workload a Home](#projects-give-the-workload-a-home)
3. [Folders Add Company Controls](#folders-add-company-controls)
4. [Billing Accounts Decide Who Pays](#billing-accounts-decide-who-pays)
5. [Enabled APIs Open Product Access](#enabled-apis-open-product-access)
6. [Quotas Set the Capacity Ceiling](#quotas-set-the-capacity-ceiling)
7. [Regions, Zones, and Global Resources](#regions-zones-and-global-resources)
8. [A Production Placement Plan](#a-production-placement-plan)
9. [References](#references)

## The Placement Questions
<!-- section-summary: Placement connects a known application shape to its GCP home, payer, enabled product APIs, capacity limits, and location choices. -->

After you know which services your app needs, the next question is placement. **Placement** means deciding where those services live, who pays for them, which APIs are allowed in the project, which limits could block launch, and which location choices affect users. A team can choose good services and still struggle if the project, billing, API, quota, and region decisions stay vague.

Picture a small photo sharing backend. Users upload photos, the app stores image files, a database keeps album metadata, and operations needs logs after upload failures. Those are normal application jobs first. GCP placement turns them into reviewable cloud coordinates.

![Workload placement coordinates](/content-assets/articles/article-cloud-providers-gcp-foundations-organizations-folders-projects-billing-accounts/workload-placement-coordinates.png)
*A production workload needs several coordinates before the first resource exists: project, folder, billing, APIs, quota, and region.*

The beginner path stays easier if the questions stay plain:

| Placement question | GCP concept | Photo app example |
|---|---|---|
| Where do the resources live? | **Project** | `devpolaris-gallery-prod` |
| Where does that project sit in the company? | **Folder** | `folders/production/apps` |
| Who pays for usage? | **Cloud Billing account** | Production application billing account |
| Which Google Cloud products can the project use? | **Enabled APIs** | Storage, database, runtime, secrets, logging |
| How much can the project consume? | **Quotas and system limits** | Upload traffic, storage operations, build rate |
| Where should the resources run or store data? | **Region, zone, global resource** | Primary region `us-central1`, multi-zone database design |

For AWS readers, this is the same kind of setup work you do before launching an AWS workload: account boundary, billing ownership, service access, limits, and Region/AZ choices. GCP uses a lighter project boundary inside a larger organization hierarchy, so a single company often has many projects under one organization rather than treating every workload boundary as a separate full cloud account.

## Projects Give the Workload a Home
<!-- section-summary: A project is the main GCP workspace for resources, API enablement, IAM policy, quota usage, logs, and billing linkage. -->

A **Google Cloud project** is the main workspace where a workload's cloud resources live. Most Google Cloud resources need a project before they can exist. The project also carries enabled APIs, IAM policy, quota usage, audit logs, labels, and the link to the billing account.

For the photo app, production can live in `devpolaris-gallery-prod`, staging can live in `devpolaris-gallery-stg`, and personal experiments can live in a sandbox project. Those projects can use similar service names while keeping production access, logs, quota, and cleanup separate from non-production work.

Every project has three identifiers. The **project ID** is the unique string people and tools usually type, such as `devpolaris-gallery-prod`. The **project number** is a Google-assigned number that service agents and some APIs use behind the scenes. The **project name** is a display name people see in the console, such as `Gallery Production`.

For AWS readers, a GCP project often maps to an AWS account for workload boundaries, IAM scoping, budgets, and cleanup. The difference is weight: a GCP organization can contain many projects, and teams often create a project per app environment while sharing organization-level controls above them.

Many teams create projects through Terraform, an internal project vending workflow, or a platform pipeline. The commands below show the moving parts so you can recognize them during a review. The first command creates the project under a folder, and the second command reads back the identifiers.

```bash
gcloud projects create devpolaris-gallery-prod \
  --name="Gallery Production" \
  --folder=123456789012

gcloud projects describe devpolaris-gallery-prod \
  --format="yaml(projectId,projectNumber,name,parent)"
```

Important details in those commands:

- `devpolaris-gallery-prod` is the project ID that later commands can target.
- `--name` sets a human-friendly display name, not the permanent project ID.
- `--folder` places the project under a parent folder, where inherited controls may apply.
- The `describe` command gives review evidence before the team creates more resources.

Useful output should show the project ID, project number, display name, and parent folder:

```yaml
projectId: devpolaris-gallery-prod
projectNumber: '918273645012'
name: Gallery Production
parent:
  id: '123456789012'
  type: folder
```

Daily commands should name the project explicitly for production work. The `gcloud` CLI can have a local default project, and that default may point at staging while you are trying to check production.

```bash
gcloud config get-value project

gcloud storage buckets list \
  --project=devpolaris-gallery-prod
```

Example output might show a staging default and a production command target:

```console
devpolaris-gallery-stg

gs://devpolaris-gallery-uploads-prod
gs://devpolaris-gallery-thumbnails-prod
```

The default project and the command target are separate facts. Naming `--project` in production commands gives the next reviewer a clear signal about which workspace you meant to inspect or change.

## Folders Add Company Controls
<!-- section-summary: Folders place projects under inherited IAM roles, organization policies, and administrative ownership. -->

An **organization resource** is the company root in Google Cloud. A **folder** is a grouping layer under that organization, and projects sit under folders or directly under the organization. Folders help platform teams apply shared controls to a group of projects without configuring every project one by one.

The photo app might use a production folder for `devpolaris-gallery-prod` and a non-production folder for staging and sandbox projects. The production folder can carry stricter rules, such as allowed locations, required security settings, or restrictions on public exposure.

![Hierarchy and billing path](/content-assets/articles/article-cloud-providers-gcp-foundations-organizations-folders-projects-billing-accounts/hierarchy-billing-path.png)
*Folders explain which inherited controls can affect the project, while the billing account explains who pays for usage inside it.*

Inherited controls can surprise beginners because the project page does not show the whole story. You might have permission inside the project and still see a deployment fail because an organization policy inherited from the production folder blocks that resource shape. During a production review, the folder path helps you ask the right platform owner why a policy exists.

```bash
gcloud projects get-ancestors devpolaris-gallery-prod
```

Useful output should show the project, folder, and organization:

```console
ID                           TYPE
devpolaris-gallery-prod      project
123456789012                 folder
987654321098                 organization
```

For AWS readers, folders are closest to organizational units in AWS Organizations because they group accounts or projects for inherited governance. The GCP project is still the workload home, while the folder path explains which company-level controls can affect it.

## Billing Accounts Decide Who Pays
<!-- section-summary: A Cloud Billing account pays for usage from linked projects, while billing IAM stays separate from project IAM. -->

A **Cloud Billing account** is the Google Cloud resource that pays for usage from linked projects. It connects to payment settings, invoices, billing exports, budgets, and billing IAM. The project owns the workload resources, and the billing account pays for the charges those resources create.

For the photo app, finance might own a production application billing account. Platform automation links `devpolaris-gallery-prod` to that billing account during setup. From that point, storage, runtime, database, build, logging, monitoring, and network usage in the project accrue under the linked billing account.

For AWS readers, this differs from the usual AWS account billing shape. In AWS, an account is often both the workload boundary and the billing member under consolidated billing. In GCP, the project is the workload boundary, and a separate Cloud Billing account can pay for one or many projects.

These commands list billing accounts the caller can see, link the project to the approved account, and verify the link. A real team usually runs this through a controlled setup workflow because billing links affect spend and access to paid services.

```bash
gcloud billing accounts list

gcloud billing projects link devpolaris-gallery-prod \
  --billing-account=0X0X0X-0X0X0X-0X0X0X

gcloud billing projects describe devpolaris-gallery-prod
```

Important details in those commands:

- `billing accounts list` only shows accounts the caller has permission to view.
- `projects link` attaches the workload project to the billing account that pays.
- `projects describe` confirms whether billing is enabled for that project.

Healthy output should show the expected billing account and `billingEnabled: true`:

```yaml
billingAccountName: billingAccounts/0X0X0X-0X0X0X-0X0X0X
billingEnabled: true
name: projects/devpolaris-gallery-prod/billingInfo
projectId: devpolaris-gallery-prod
```

Billing permissions and project permissions are separate. A developer may deploy the photo app without being allowed to link the project to a billing account. A finance owner may manage billing without being allowed to change app resources. That separation helps because payment control and production change control are different jobs.

A **budget** tracks spend for a billing account, project, or filtered set of costs and sends alerts at thresholds. A useful production budget sends alerts to the workload owner, platform on-call, and finance contact. If a bad release creates too many image-processing retries or too many logs, the budget alert gives the team a cost signal while the issue is still fresh.

## Enabled APIs Open Product Access
<!-- section-summary: An enabled API is a project-level gate that lets deployment tools create or operate a Google Cloud product in that project. -->

An **enabled API** is a project-level switch that allows a Google Cloud service API to be used in that project. Many Google Cloud products have API names ending in `googleapis.com`. If an API is disabled, deployment can fail even if the project exists, billing works, and the user has the right IAM role.

For the photo app, the project might need the Cloud Storage API for image files, a database API for metadata, a runtime API for the backend service, Secret Manager for private values, and Logging or Monitoring for operations. The exact list should match the services the app actually uses.

For AWS readers, API enablement has no perfect one-to-one match. AWS services are usually available in an account and Region unless policy, opt-in Region settings, quotas, or service-specific setup blocks them. In GCP, many product APIs are explicitly enabled per project, so the API list acts like an approved service surface.

The setup command below enables a small service set for the production project. The verification command is read-only and gives evidence for the setup record.

```bash
gcloud services enable \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  --project=devpolaris-gallery-prod

gcloud services list \
  --enabled \
  --project=devpolaris-gallery-prod \
  --filter="name:(storage.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com)"
```

Important details in those commands:

- `services enable` changes the project and should be reviewed like setup infrastructure.
- API names use the `googleapis.com` form, such as `storage.googleapis.com`.
- `--project` keeps the service gate tied to production instead of a local default.
- The filtered list helps reviewers see the required APIs without scanning every enabled service.

Useful output should list the enabled service names:

```console
NAME                              TITLE
artifactregistry.googleapis.com   Artifact Registry API
secretmanager.googleapis.com      Secret Manager API
storage.googleapis.com            Cloud Storage API
```

API enablement should live near project creation in the same repeatable workflow. A console click can unblock a demo, but production needs a reviewable record. If the photo app later needs a new API, the pull request should explain which application job requires it.

## Quotas Set the Capacity Ceiling
<!-- section-summary: Quotas and system limits define how much resource capacity or API activity the project, folder, organization, region, or zone can consume. -->

**Quotas** are Google Cloud limits that control how much resource capacity or API activity a consumer can use. Allocation quotas limit resource amounts, such as cores or addresses. Rate quotas limit API activity over time. Concurrent quotas limit how many operations can run at once.

Most quota planning starts at the project. Some quotas also have a location dimension, such as global, regional, or zonal. A service can be enabled and still fail at launch if the project does not have enough quota in the location where the app runs.

For AWS readers, quota planning maps closely to AWS service quotas and request-rate limits. The key GCP habit is checking the project and location together because a regional quota in `us-central1` can be separate from the same quota in another region.

For the photo app, quota review should come from the expected launch shape. The team estimates upload traffic, backend scaling, database capacity, storage operation rate, build frequency, log volume, and alert policy needs. That turns quota into a release task instead of a surprise `RESOURCE_EXHAUSTED` error.

Quota is a deliberate capacity and safety control. Google Cloud services share regional and global capacity across many customers, and your own project may contain several apps, scripts, and release pipelines. A quota gives the team a visible ceiling before one workload consumes too much capacity, spends unexpectedly, or asks a region for more resources than the current project allowance supports.

| Quota area | Photo app review question | Evidence to record |
|---|---|---|
| Runtime capacity | Can the backend scale to the planned upload traffic in the primary region? | Current quota, planned peak, owner of adjustment request |
| Storage activity | Can upload, thumbnail, and download operations handle expected traffic? | Request-rate estimate and bucket design note |
| Database capacity | Does the chosen region support the database shape and storage growth? | Instance shape, storage forecast, regional capacity note |
| Build and deploy rate | Can build automation handle release-day activity and retries? | Build frequency and rate quota check |
| Logging and monitoring | Can logs, metrics, and alert policies handle expected volume? | Log volume estimate, retention choice, alert owner |

A small review record makes the check concrete. These numbers are examples, but the shape is the important part: service, location, current limit, current usage, planned peak, and a named owner for the next action.

| Service | Location | Current limit | Current usage | Planned peak | Owner / action |
|---|---|---:|---:|---:|---|
| Cloud Run backend scaling | `us-central1` | 1,000 container instances | 18 during load test | 180 | App owner sets max instances to 150 and asks platform before raising it. |
| Cloud SQL regional capacity | `us-central1` | Approved regional instance class and storage plan | One primary instance, one standby | 2 TB over first year | Database owner confirms storage growth and backup budget. |
| Cloud Build release activity | Global | 10 concurrent builds | 2 during normal deploys | 6 during launch day | Release owner staggers retries and opens a request if parallel builds rise. |
| Cloud Logging ingestion | Global | Reviewed daily ingestion budget | 12 GiB per day in staging test | 60 GiB per day | Operations owner sets exclusions for noisy debug logs before launch. |
| External IP and load balancing resources | Global / regional | 8 reserved addresses and approved load balancer plan | 2 addresses | 4 addresses | Platform owner confirms public entry design before DNS cutover. |

The interpretation is simple. If the planned peak is close to the current limit, the owner either lowers the workload setting, changes the design, or requests a quota adjustment before launch. If current usage is already high, the team also checks which other workloads share the same project quota. The quota review record should sit beside the release checklist, so a failed launch has a known capacity page to inspect before people start guessing at application bugs.

A CLI check can collect the current quota information for one service:

```bash
gcloud beta quotas info list \
  --project=photo-prod \
  --billing-project=photo-prod \
  --service=run.googleapis.com \
  --format="table(quotaId,dimensions,metric,unit,containerType)"
```

Example output:

```console
QUOTA_ID                    DIMENSIONS              METRIC                                  UNIT                    CONTAINER_TYPE
container_instances         {'region': 'us-central1'} run.googleapis.com/container_instances  1/{project}/{region}    PROJECT
requests_per_minute         {}                      run.googleapis.com/requests              1/min/{project}          PROJECT
```

The useful fields are the quota ID, service metric, location dimension, and unit. Planning still owns the capacity decision, and this output gives the release review a concrete quota name to track. If the launch needs a higher ceiling, the quota request should name the same quota ID and region that appear in this check.

A **system limit** is a fixed product constraint from the service design, such as a maximum field size, maximum label count, or product-specific limit. Quota review asks whether your project has enough allowance. System-limit review asks whether your design fits inside the product shape.

The Google Cloud console has an IAM & Admin page called **Quotas & System Limits**. A production record should capture the quota name, service, location, current value, current usage, planned peak, and any approved adjustment request. If launch traffic fails, that record gives the team a concrete place to check before changing application code.

## Regions, Zones, and Global Resources
<!-- section-summary: Regions, zones, and global resources explain where resources are placed and which failure domains can affect them. -->

A **region** is an independent geographic area where Google Cloud offers services. A **zone** is a deployment area inside a region, and Google Cloud tells customers to treat a zone as a single failure domain. A **global resource** is managed across Google Cloud rather than placed in one customer-selected region.

The photo app might choose `us-central1` because most users, support staff, and partner systems are in North America. Regional services use a region such as `us-central1`. A zonal resource, such as a single VM or disk, uses one zone such as `us-central1-a`. Global resources, such as many IAM policies or global load balancer configurations, are not placed in one app region in the same way.

For AWS readers, GCP regions and zones map closely to AWS Regions and Availability Zones for failure-domain thinking. One important difference appears later in networking: GCP VPC networks are global resources with regional subnets, so network placement can differ from a regional AWS VPC.

Location choice should answer four practical questions:

| Check | What you ask | Photo app example |
|---|---|---|
| User latency | Where are the main users and integrations? | Uploads mostly come from North America. |
| Data residency | Which legal or customer rules control data location? | Photo metadata and uploaded files stay in approved US locations. |
| Product availability | Does every required product and feature exist there? | Storage, runtime, secrets, database, and operations tools must support the plan. |
| Reliability plan | What happens if a zone or region has trouble? | Regional service design, backup location, and restore plan are documented. |

The team should write down the scope for each important resource. IAM policies and many project settings are global. A backend service may be regional. A single VM or disk may be zonal. A storage bucket can use regional, dual-region, or multi-region locations depending on the data design.

That list helps during incidents. If `us-central1-a` has a zonal issue, the team can quickly see whether the app depends on a zonal VM or whether the user path runs through regional services. If the primary region has a severe issue, the team already knows which backups, replicas, or redeploy steps matter for recovery.

## A Production Placement Plan
<!-- section-summary: A placement plan records project, hierarchy, billing, enabled APIs, quota evidence, region choices, owners, and review facts before launch. -->

A placement plan is the working agreement between application, platform, security, finance, and operations. It takes the service map and adds the GCP coordinates needed for production. The exact tool can be Terraform, an internal project request, a release checklist, or a pull request template, but the same facts should appear in one reviewable place.

![Placement plan before launch](/content-assets/articles/article-cloud-providers-gcp-foundations-organizations-folders-projects-billing-accounts/placement-plan-checklist.png)
*A launch review should prove that project setup, API gates, quota evidence, owner contacts, budget alerts, and region choices are already recorded.*

The YAML below is a simplified review record, written separately from a deployable Terraform module. It shows the facts reviewers need before production resources multiply.

```yaml
workload: photo-gallery
environment: production
project:
  id: devpolaris-gallery-prod
  display_name: Gallery Production
  parent_folder: folders/123456789012
  labels:
    app: gallery
    environment: production
    owner: media-platform
billing:
  account_id: 0X0X0X-0X0X0X-0X0X0X
  budget_name: gallery-prod-monthly
  alert_recipients:
    - platform-oncall@example.com
    - finance@example.com
apis:
  - storage.googleapis.com
  - secretmanager.googleapis.com
  - artifactregistry.googleapis.com
  - cloudbuild.googleapis.com
  - logging.googleapis.com
  - monitoring.googleapis.com
location:
  primary_region: us-central1
  backup_region: us-east4
quota_review:
  runtime_scaling: reviewed
  storage_operations: reviewed
  database_capacity: approved
  build_rate: reviewed
  logging_volume: reviewed
required_reviews:
  - inherited organization policies
  - production IAM groups
  - billing link and budget alerts
  - API enablement list
  - regional quota evidence
  - data location approval
  - owner and on-call contacts
```

Important details in this record:

- `project.id` names the workload boundary that commands, logs, and billing reports use.
- `billing.account_id` tells finance which account pays for project usage.
- `apis` lists the Google Cloud product surfaces the project is allowed to use.
- `location` records the primary placement choice before resource creation spreads.
- `quota_review` turns capacity checks into launch evidence instead of tribal knowledge.
- `required_reviews` names the people and controls that should be checked before launch.

The placement story is one connected setup. The project gives the workload a home, the folder path brings inherited controls, the billing account pays, enabled APIs open product access, quotas set the capacity ceiling, and regions or zones place resources near users and inside known failure domains. Once those coordinates are clear, the next foundation problem is naming the actual resources inside the project so people can find, bill, change, and debug them.

## References

- [Google Cloud resource hierarchy](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy) - Explains organizations, folders, projects, hierarchy relationships, and inherited policy context.
- [Create and manage projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects) - Documents project creation, project IDs, project numbers, and project metadata.
- [Cloud Billing overview](https://cloud.google.com/billing/docs/concepts) - Defines Cloud Billing accounts, linked projects, billing IAM, and payment responsibility.
- [Verify the billing status of your projects](https://cloud.google.com/billing/docs/how-to/verify-billing-enabled) - Shows how to confirm whether billing is enabled for a project.
- [Create, edit, or delete budgets and budget alerts](https://cloud.google.com/billing/docs/how-to/budgets) - Explains budget scope, thresholds, permissions, and alert behavior.
- [Enable and disable services](https://cloud.google.com/service-usage/docs/enable-disable) - Documents project-level service API enablement through Service Usage.
- [Cloud Quotas overview](https://cloud.google.com/docs/quotas/overview) - Explains quota types and global, regional, and zonal quota dimensions.
- [View and manage quotas](https://cloud.google.com/docs/quotas/view-manage) - Shows how to review quotas, usage, system limits, and quota adjustments.
- [Geography and regions](https://cloud.google.com/docs/geography-and-regions) - Defines regions, zones, zonal resources, regional resources, multi-regional services, and global services.
