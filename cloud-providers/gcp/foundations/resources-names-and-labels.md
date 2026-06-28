---
title: "Resources, Names, and Labels"
description: "Learn how GCP resource names, project IDs, bucket names, labels, and tags keep production changes reviewable."
overview: "Once a workload has a project and region, every alert, deploy, cost review, and access request needs exact resource identity. This article follows an Orders API through resource paths, project IDs, bucket names, labels, tags, and the evidence bundle a team should collect before changing production."
tags: ["gcp", "resources", "labels", "names"]
order: 3
id: article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths
aliases:
  - resource-names-labels-and-resource-paths
  - resource-names-labels-resource-paths
  - cloud-providers/gcp/foundations/resource-names-labels-and-resource-paths.md
---

## Table of Contents

1. [The Pieces We Need](#the-pieces-we-need)
2. [Resource Names](#resource-names)
3. [Project IDs](#project-ids)
4. [Bucket Names](#bucket-names)
5. [Labels](#labels)
6. [Tags](#tags)
7. [Evidence Before Changes](#evidence-before-changes)
8. [A Production Naming Review](#a-production-naming-review)

## The Pieces We Need
<!-- section-summary: A production GCP resource needs an exact address, a project boundary, a local name, useful metadata, and stronger governed tags when policy depends on metadata. -->

In the previous article, the workload got placed inside the GCP control plane. The team picked a project, linked billing, enabled service APIs, checked quota, and chose a primary region. Now imagine the commerce team has an **Orders API** running in that project. It has a Cloud Run service, a Cloud SQL database, a Cloud Storage bucket for receipts, a Secret Manager secret for payment webhooks, and a service account used by the runtime.

At first, the names feel obvious because the team is small. Everyone knows what "orders" means in Slack, and the console search bar usually finds something close. That habit starts to break as soon as there is staging, production, old migration infrastructure, dashboards, incident tickets, and cost reports. The word `orders` can point at several resources across several projects.

This article is about turning loose names into reviewable resource identity. We need five ideas, and they connect in a practical order.

| Piece | Simple definition | Orders API example |
|---|---|---|
| **Resource name** | The API address for one managed object. | `projects/devpolaris-orders-prod/locations/us-central1/services/orders-api` |
| **Project ID** | The stable project identifier used by many commands and APIs. | `devpolaris-orders-prod` |
| **Resource ID** | The short name of a resource inside its parent scope. | `orders-api`, `orders-db`, `stripe-webhook-secret` |
| **Labels** | Lightweight key-value metadata for inventory, ownership, and cost reporting. | `env=prod`, `team=commerce`, `service=orders-api` |
| **Tags** | Governed key-value resources that supported policy systems can evaluate. | `environment=prod` attached through Resource Manager tags |

![Exact identity for one resource](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/exact-resource-identity.png)
*Exact identity combines the project, location, resource type, short ID, labels, and governed tags so another engineer can find the same target.*

The important habit is simple: a production change should point to one exact target. A ticket that says "fix the orders bucket" still leaves room for confusion. A ticket that names the project, resource type, bucket name, location, labels, and supporting evidence gives another engineer enough information to find the same thing.

## Resource Names
<!-- section-summary: A resource name is the API address that tells Google Cloud which managed object a request means. -->

A **resource name** is the address an API uses for a Google Cloud resource. It usually follows a path shape with collection names and IDs, such as `projects/{project}/locations/{location}/services/{service}`. The collection names are words like `projects`, `locations`, and `services`; the IDs are the actual values for your project, region, and service.

For the Orders API, the Cloud Run service can be described with this resource name. This YAML snippet is a simplified inventory record, not a deployable config. It gives reviewers the exact coordinates they need before changing production.

```yaml
cloud_run_service: projects/devpolaris-orders-prod/locations/us-central1/services/orders-api
```

That string gives us the project, the location, the resource type, and the local service ID. The short name `orders-api` helps humans, and the resource name gives the API enough coordinates to find the right service. The same short service name can exist in another region or another project, so the coordinates matter during deploys and incidents.

Different GCP services use different path shapes because their resources live under different parents. A Cloud Run service is regional, so the path includes `locations/us-central1`. A Secret Manager secret lives under a project, so its common path leaves the region out. A Cloud SQL instance belongs to a project and also has region configuration on the instance. The exact fields vary by service, and the review habit stays the same: collect the parent project, the resource type, the location when the service has one, and the exact ID.

```yaml
cloud_run_service: projects/devpolaris-orders-prod/locations/us-central1/services/orders-api
cloud_sql_instance: projects/devpolaris-orders-prod/instances/orders-db
secret: projects/devpolaris-orders-prod/secrets/stripe-webhook-secret
bucket_uri: gs://devpolaris-orders-receipts-prod
```

You will also see **full resource names** in places where one Google service needs to point at resources from many possible APIs. A full resource name adds the owning API service name at the front, with a double slash. Tag bindings are a common place to see this shape because a tag can attach to supported resources across Google Cloud.

```yaml
project_full_resource_name: //cloudresourcemanager.googleapis.com/projects/123456789012
cloud_run_full_resource_name: //run.googleapis.com/projects/devpolaris-orders-prod/locations/us-central1/services/orders-api
```

This is separate from an HTTPS URL. The HTTPS URL talks to an API endpoint. The resource name identifies the resource inside the API. That distinction matters because logs, IAM conditions, tag bindings, APIs, and CLI output may each show a different form of the same target.

For daily work, the `gcloud` CLI helps you pin down a resource before changing it. This command describes the Cloud Run service and prints only the fields that help a reviewer recognize the target. The variables make the target explicit, `--project` avoids hidden local defaults, `--region` selects the regional service, and `--format` keeps the output focused.

```bash
PROJECT_ID=devpolaris-orders-prod
REGION=us-central1
SERVICE=orders-api

gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="yaml(metadata.name,metadata.labels,status.url,spec.template.spec.serviceAccountName)"
```

Useful output should show the service name, labels, URL, and runtime service account. If the incident is about secret access, the service account will matter as much as the service name.

```yaml
metadata:
  labels:
    component: api
    env: prod
    service: orders-api
    team: commerce
  name: orders-api
spec:
  template:
    spec:
      serviceAccountName: orders-api-prod@devpolaris-orders-prod.iam.gserviceaccount.com
status:
  url: https://orders-api-uc.a.run.app
```

Resource names give production changes an address. The next layer is the project ID, because many resource names and service account emails carry the project identity directly.

## Project IDs
<!-- section-summary: A project ID identifies the project in commands and resource names, while display names and project numbers serve different roles. -->

A **project ID** is the project identifier you choose during project creation. Google Cloud requires it to be globally unique, and after creation it stays permanent. It appears in many commands, resource names, service account emails, billing exports, logs, and dashboards, so it deserves more care than a friendly display label.

A project also has a **display name** and a **project number**. The display name helps people scan the console, and teams can make it friendlier, such as `Orders API Production`. The project number is generated by Google Cloud and appears in service agents, some full resource names, APIs, and audit evidence. The project ID is the value engineers usually type in commands.

This read-only command prints all three identifiers and the parent location. A runbook should keep this output or an equivalent record because generated identities may use the project number while humans use the project ID.

```bash
gcloud projects describe devpolaris-orders-prod \
  --format="yaml(projectId,projectNumber,name,parent)"
```

```yaml
projectId: devpolaris-orders-prod
projectNumber: '123456789012'
name: Orders API Production
parent:
  id: '345678901234'
  type: folder
```

Service account emails show why the project ID matters. A runtime service account like this tells you its home project immediately. This YAML snippet belongs in an inventory or runbook, and IAM policy evidence should sit next to it during review.

```yaml
runtime_service_account: orders-api-prod@devpolaris-orders-prod.iam.gserviceaccount.com
```

That email reveals the account's home project. IAM bindings still decide permissions, so the email and the policy evidence belong together in the review. During an incident, the service account email helps you connect the Cloud Run service to IAM evidence, Secret Manager access, Cloud SQL access, and audit logs.

Short **resource IDs** live under a parent scope. The Cloud Run service ID `orders-api` makes sense inside `devpolaris-orders-prod` and `us-central1`. The Secret Manager secret ID `stripe-webhook-secret` makes sense inside its project. The Cloud SQL instance ID `orders-db` makes sense inside its project. The bucket name has different rules, and we will slow down on that in the next section.

| Short thing someone says | Stronger production evidence |
|---|---|
| "the orders service" | Project ID, region, Cloud Run service ID, URL, runtime service account |
| "the orders database" | Project ID, Cloud SQL instance ID, region, database engine, connection name |
| "the Stripe secret" | Project ID, secret ID, replication setting, IAM policy, latest enabled version |
| "the receipts bucket" | Bucket name, location, labels, retention or lifecycle settings, access configuration |

This is where naming standards help. A project ID such as `devpolaris-orders-prod` carries company, workload, and environment. A service ID such as `orders-api` stays short because the project and region already carry the bigger context. A database ID such as `orders-db` tells engineers what role the instance has. Names should help people recognize the target, and the full evidence should prove the target.

## Bucket Names
<!-- section-summary: Cloud Storage bucket names live in a global namespace, so they need stronger naming care than many local resource IDs. -->

A **Cloud Storage bucket** is a named container for objects, such as receipts, exports, uploads, backups, and data files. Bucket names have a special rule that surprises many beginners: all Cloud Storage users share one bucket-name namespace. Every bucket name must be globally unique across Cloud Storage, across all projects and organizations.

That means a generic name like `orders` or `receipts` will probably fail during creation because another organization can already own it. A production bucket name should include enough ownership context to avoid collisions and still avoid sensitive data. For the Orders API, a name like `devpolaris-orders-receipts-prod` gives the company, workload, purpose, and environment without adding customer data.

This command creates the receipts bucket in the approved region. `--location` places the data, and `--uniform-bucket-level-access` makes IAM the main access control path for bucket objects.

```bash
gcloud storage buckets create gs://devpolaris-orders-receipts-prod \
  --location=us-central1 \
  --uniform-bucket-level-access
```

Useful output is short, but it should confirm the exact bucket URI. If the bucket name already exists globally, the command will fail before any application deploy should depend on it.

```console
Creating gs://devpolaris-orders-receipts-prod/...
```

Bucket names are visible enough that they need privacy review. Customer email addresses, user IDs, project numbers, internal ticket IDs, and security-sensitive names should stay out of bucket names. People can probe for bucket existence, and bucket names often appear in URLs, logs, documentation, config files, and error messages.

Deletion also needs more care with buckets. After a bucket is deleted, Google Cloud may release the name for reuse, and another party may claim it. If old clients, scripts, DNS records, documentation, or exports still send requests to that old bucket name, those requests can point at someone else's new bucket. Teams often remove references first, keep redirects and clients under control, and sometimes keep an empty bucket reserved while old dependencies age out.

This bucket behavior explains why the naming standard needs different rules for different resources. A Cloud Run service called `orders-api` can exist in staging and production because the project and region separate those services. A bucket name acts more like a public global name, so it needs stronger collision resistance and less sensitive information.

## Labels
<!-- section-summary: Labels are lightweight key-value metadata that help teams search resources, group ownership, and analyze cost. -->

**Labels** are key-value metadata pairs attached to Google Cloud resources. They help people and tools answer inventory and cost questions: which resources belong to the Orders API, which team owns them, which environment they run in, and which cost center should pay for them. Labels also flow into billing analysis for supported resources, which makes them useful for chargeback and budget reviews.

For the Orders API, a small shared label set can cover most day-to-day questions. The table below uses short values because labels work best as stable metadata rather than long descriptions.

| Label key | Example value | What it helps answer |
|---|---|---|
| `env` | `prod` | Which environment is this resource part of? |
| `team` | `commerce` | Which team owns the alerts and reviews? |
| `service` | `orders-api` | Which application or product area uses it? |
| `component` | `api`, `db`, `receipts` | Which part of the service map is this? |
| `cost_center` | `commerce-platform` | Which budget should receive the cost? |
| `managed_by` | `terraform` | Which workflow should make changes? |

The key idea is shared vocabulary. If one team uses `prod`, another uses `production`, and a third uses `live`, cost reporting turns into cleanup work. A small allowed list for `env`, `team`, `service`, and `cost_center` gives finance, platform, and engineering one language for reports.

![Labels and tags do different jobs](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/labels-tags-different-jobs.png)
*Labels help reporting and inventory. Governed tags help supported policy systems make conditional decisions.*

Labels have limits and shape rules. A resource can have up to 64 labels, each label has one key and one value, and keys must stay unique on that resource. Keys and values have length and character restrictions, so labels work best as small metadata fields rather than long notes.

Sensitive data should stay out of labels. Customer emails, person names, ticket numbers with private details, request IDs, and one-off timestamps create risk and clutter. High-cardinality labels also hurt reporting because every unique value adds another slice to inventory and billing views. Labels should describe stable ownership and purpose instead of individual requests.

In infrastructure as code, labels should come from one shared map instead of being hand-typed on every resource. Terraform is a common way teams manage GCP resources, and a local label map keeps the naming vocabulary visible during review. This config is consumed by Terraform when it creates the Cloud Run service and bucket. `common_labels` is safe to reuse across environments when values such as `env` and `cost_center` come from reviewed variables.

```hcl
locals {
  common_labels = {
    env         = "prod"
    team        = "commerce"
    service     = "orders-api"
    cost_center = "commerce-platform"
    managed_by  = "terraform"
  }
}

resource "google_cloud_run_v2_service" "orders_api" {
  name     = "orders-api"
  location = var.region
  labels   = merge(local.common_labels, { component = "api" })
}

resource "google_storage_bucket" "receipts" {
  name     = "devpolaris-orders-receipts-prod"
  location = var.region
  labels   = merge(local.common_labels, { component = "receipts" })
}
```

After Terraform applies the config, a read-only command should confirm labels on live resources. The command below checks the bucket because bucket labels show up in inventory and billing workflows.

```bash
gcloud storage buckets describe gs://devpolaris-orders-receipts-prod \
  --format="yaml(name,location,labels)"
```

```yaml
labels:
  component: receipts
  cost_center: commerce-platform
  env: prod
  managed_by: terraform
  service: orders-api
  team: commerce
location: US-CENTRAL1
name: devpolaris-orders-receipts-prod
```

The important boundary is that labels organize resources and costs. IAM, organization policy, network controls, retention settings, and runtime configuration decide whether production has the right protection. A label can say `env=prod`, while the service configuration still needs its own review.

## Tags
<!-- section-summary: Tags are governed metadata resources that supported IAM, organization policy, and network systems can use for conditional decisions. -->

**Tags** in Resource Manager are governed key-value resources. They may look like labels because they also have keys and values. Tags are managed more strictly because administrators create tag keys and tag values under an organization or project, control who can attach them, and supported policy systems can evaluate them.

For the Orders API, the platform or security team might create a tag key called `environment` with allowed values such as `prod` and `non-prod`. That tag vocabulary gives policies a controlled value to reference. A random label value can drift across teams; a governed tag value has IAM around who can create it and who can bind it.

These commands create a tag key and a production tag value. `--parent` places the key under the organization, and the second command places the value under the key returned by the first command. The numeric tag key ID in the example is realistic placeholder output; in production, copy it from the create or describe command.

```bash
gcloud resource-manager tags keys create environment \
  --parent=organizations/123456789012 \
  --description="Environment classification for policy decisions"

gcloud resource-manager tags values create prod \
  --parent=tagKeys/456789012345 \
  --description="Production resources"
```

Expected output should give the names that later commands use. A beginner should save the `tagKeys/...` and `tagValues/...` identifiers because display names alone are not enough for binding commands.

```yaml
name: tagKeys/456789012345
shortName: environment
parent: organizations/123456789012

name: tagValues/567890123456
shortName: prod
parent: tagKeys/456789012345
```

After a tag value exists, an authorized user or automation can bind it to a supported resource. The binding needs the target resource's full resource name, which brings us back to exact addresses.

```bash
gcloud resource-manager tags bindings create \
  --tag-value=tagValues/567890123456 \
  --parent=//cloudresourcemanager.googleapis.com/projects/123456789012
```

Healthy output should show the tag value and the parent full resource name. If the parent is wrong, the policy signal attaches to the wrong target.

```yaml
name: tagBindings/%2F%2Fcloudresourcemanager.googleapis.com%2Fprojects%2F123456789012/tagValues/567890123456
parent: //cloudresourcemanager.googleapis.com/projects/123456789012
tagValue: tagValues/567890123456
```

Tags show up in policy work. IAM Conditions can use tags for conditional access on supported resources. Organization policies can use tags to scope rules. Firewall features can use tag concepts too, although Google Cloud has multiple tag types in networking, including older VM network tags and newer secure tags for firewall policy designs. The exact feature decides which tag type it understands, so production designs should check the service documentation before building a control around tags.

The split between labels and tags is practical. Labels answer reporting questions: owner, service, environment, cost center, and management tool. Tags answer governed policy questions when a supported control needs reliable metadata. Many resources need both: labels for humans and billing, tags for conditional control.

## Evidence Before Changes
<!-- section-summary: Production changes should start with a small evidence bundle that lets another engineer find the same resource and understand why it is the target. -->

Now bring the pieces together during a real incident. A ticket says, "Orders API fails to read the Stripe webhook secret in production." That sentence gives a symptom and still leaves the target unproven. Before changing IAM, the engineer needs evidence for the caller, the resource, the project, and the access path.

![Evidence bundle before a change](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/change-evidence-bundle.png)
*A good change ticket names the project, target resource, caller identity, policy evidence, labels, and reason before production is changed.*

A reviewable evidence bundle for this incident can include the Cloud Run service, runtime identity, secret, IAM policy, labels, and region. The commands below keep the project and region explicit so the evidence comes from command inputs rather than a local CLI default.

```bash
PROJECT_ID=devpolaris-orders-prod
REGION=us-central1
SERVICE=orders-api
SECRET=stripe-webhook-secret

gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="yaml(metadata.name,metadata.labels,status.url,spec.template.spec.serviceAccountName)"

gcloud secrets describe "$SECRET" \
  --project="$PROJECT_ID" \
  --format="yaml(name,labels,replication)"

gcloud secrets get-iam-policy "$SECRET" \
  --project="$PROJECT_ID" \
  --format="yaml(bindings)"
```

Useful output should connect the service to the identity and the identity to the secret policy. If the service account is missing from the policy, the change request can name the exact binding being added and the exact secret receiving it.

```yaml
bindings:
- members:
  - serviceAccount:orders-api-prod@devpolaris-orders-prod.iam.gserviceaccount.com
  role: roles/secretmanager.secretAccessor
```

The same habit applies to bucket work. A ticket that says "fix the orders bucket" should identify which bucket, which project owns the workload, where the bucket lives, which labels show ownership, which object prefix is affected, and which setting needs review.

```bash
BUCKET=devpolaris-orders-receipts-prod

gcloud storage buckets describe "gs://$BUCKET" \
  --format="yaml(name,location,labels,iamConfiguration.uniformBucketLevelAccess.enabled,retentionPolicy)"
```

Expected output should show the bucket name, location, labels, uniform bucket-level access setting, and retention policy if one exists. A missing label or disabled uniform access setting may be the real review finding.

```yaml
iamConfiguration:
  uniformBucketLevelAccess:
    enabled: true
labels:
  component: receipts
  env: prod
  service: orders-api
  team: commerce
location: US-CENTRAL1
name: devpolaris-orders-receipts-prod
retentionPolicy:
  retentionPeriod: '31536000'
```

A good evidence bundle helps the review. It lets another engineer open the same project, find the same resource, understand the caller, and review the exact change. It also helps after the incident because the ticket records why the team touched that resource instead of a similarly named staging service or old migration bucket.

| Change request field | Strong Orders API example |
|---|---|
| Project | `devpolaris-orders-prod` plus project number from `gcloud projects describe` |
| Resource type | Cloud Run service, Secret Manager secret, Cloud Storage bucket, Cloud SQL instance |
| Location | `us-central1` for regional resources, or the bucket location for Cloud Storage |
| Exact target | Resource path, service ID, secret ID, bucket URI, or full resource name |
| Caller identity | Runtime service account or human identity requesting access |
| Labels | `env=prod`, `team=commerce`, `service=orders-api`, `component=api` |
| Policy evidence | IAM binding, organization policy, tag binding, retention setting, or network rule |
| Reason | The alert, deploy, access request, or cost report that points to this target |

This section connects back to the first table in the article. Project IDs narrow the boundary. Resource names identify the object. Bucket names need global-name care. Labels show ownership and reporting context. Tags support governed policy where the service can use them. Evidence ties those pieces to a real production decision.

## A Production Naming Review
<!-- section-summary: A naming review checks that resource identity, labels, tags, and evidence habits are ready before production resources multiply. -->

A naming and metadata review should happen while the workload is still small. Later, renaming resources often means recreating infrastructure, migrating data, changing dashboards, updating IAM bindings, rewriting runbooks, and coordinating downtime. Early review costs much less than late cleanup.

For the Orders API, the review can be plain and concrete. It checks the names people will say out loud and the exact identifiers tools will use.

| Review item | Healthy production answer |
|---|---|
| Project ID | `devpolaris-orders-prod` includes organization, workload, and environment. |
| Project number | Recorded in the runbook because service agents, APIs, and full resource names may use it. |
| Primary region | `us-central1` appears in deploy variables, dashboards, alerts, and service paths. |
| Cloud Run service ID | `orders-api` stays consistent across deploys, logs, alerts, and runbooks. |
| Runtime service account | `orders-api-prod@devpolaris-orders-prod.iam.gserviceaccount.com` maps to one runtime purpose. |
| Database ID | `orders-db` clearly maps to the relational database for the service. |
| Bucket name | `devpolaris-orders-receipts-prod` avoids generic global names and sensitive values. |
| Secret IDs | `stripe-webhook-secret` and similar IDs describe purpose without storing secret values in the name. |
| Required labels | `env`, `team`, `service`, `component`, `cost_center`, and `managed_by` exist on supported resources. |
| Governed tags | Production classification uses Resource Manager tags when IAM, organization policy, or firewall policy needs governed metadata. |
| Change evidence | Production tickets include project, resource type, location, exact target, labels, caller identity, and policy evidence. |

The final result is a workload that people can operate under pressure. An alert points to a specific service instead of a loose word. A cost report groups resources by service and team. A security review can tell the difference between helpful labels and governed tags. A production change has enough evidence for another engineer to reach the same conclusion.

That is the foundation this article is trying to build. Before IAM, networking, compute, databases, and observability get more detailed, every resource needs a name people can recognize and an identity tools can verify.

---

**References**

- [Google API resource names](https://cloud.google.com/apis/design/resource_names) - Defines resource names, full resource names, and the path-style patterns used by Google APIs.
- [Google Cloud resource hierarchy](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy) - Explains organizations, folders, projects, project IDs, project numbers, and hierarchy relationships.
- [Create and manage projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects) - Documents project ID uniqueness, project number behavior, project names, and project ID requirements.
- [Cloud Storage bucket naming guidelines](https://cloud.google.com/storage/docs/buckets#naming) - Documents bucket-name rules, global uniqueness, public visibility, and reuse risks after deletion.
- [Labels overview](https://cloud.google.com/resource-manager/docs/labels-overview) - Explains labels, label limits, billing use cases, sensitive-data guidance, and the difference between labels and tags.
- [Best practices for labels](https://cloud.google.com/resource-manager/docs/best-practices-labels) - Gives practical label design guidance for ownership, cost, and operational reporting.
- [Tags overview](https://cloud.google.com/resource-manager/docs/tags/tags-overview) - Explains tag keys, tag values, tag bindings, inheritance, and supported policy integrations.
- [Create and manage tags](https://cloud.google.com/resource-manager/docs/tags/tags-creating-and-managing) - Documents the CLI flow for tag keys, tag values, and tag bindings.
- [Tags and conditional access](https://cloud.google.com/iam/docs/tags-access-control) - Explains how IAM Conditions can use tags for conditional access on supported resources.
- [Secure tags for firewalls](https://cloud.google.com/firewall/docs/tags-firewalls-overview) - Explains secure tags, network tags, and firewall policy support.
