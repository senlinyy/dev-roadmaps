---
title: "Resources, Names, and Labels"
description: "Learn how GCP resource names, project IDs, bucket names, labels, and tags keep production changes reviewable."
overview: "Once resources exist, every alert, deploy, cost review, and access request needs exact identity. Follow a photo gallery backend through resource names, project IDs, resource IDs, bucket names, labels, tags, and evidence bundles."
tags: ["gcp", "resources", "labels", "names"]
order: 3
id: article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths
aliases:
  - resource-names-labels-and-resource-paths
  - resource-names-labels-resource-paths
  - cloud-providers/gcp/foundations/resource-names-labels-and-resource-paths.md
---

## Table of Contents

1. [Why Exact Identity Matters](#why-exact-identity-matters)
2. [Resource Names](#resource-names)
3. [Project IDs and Resource IDs](#project-ids-and-resource-ids)
4. [Bucket Names Need Extra Care](#bucket-names-need-extra-care)
5. [Labels Help People and Cost Reports](#labels-help-people-and-cost-reports)
6. [Tags Support Governed Policy](#tags-support-governed-policy)
7. [Evidence Bundles Before Changes](#evidence-bundles-before-changes)
8. [A Production Naming Review](#a-production-naming-review)
9. [References](#references)

## Why Exact Identity Matters
<!-- section-summary: Once resources exist, exact names let another engineer find, bill, change, and debug the same target. -->

Once resources exist, you need exact names to find them, bill them, change them, and debug them. A loose phrase like "the gallery bucket" might work for three people sharing one project. It breaks down once production, staging, old migration buckets, dashboards, alerts, cost exports, and incident tickets enter the picture.

Use a photo gallery backend as the running example. Users upload photos, the backend stores originals and thumbnails, a metadata database tracks albums, a secret stores the image moderation API key, and operations needs evidence after upload failures. Every one of those resources needs identity that a second engineer can verify.

![Exact identity for one resource](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/exact-resource-identity.png)
*Exact identity combines the project, location, resource type, short ID, labels, and governed tags so another engineer can find the same target.*

The identity pieces connect in a simple order:

| Piece | Plain definition | Photo gallery example |
|---|---|---|
| **Resource name** | The API path that identifies one managed object. | `projects/devpolaris-gallery-prod/locations/us-central1/services/gallery-api` |
| **Project ID** | The permanent project identifier people and tools usually type. | `devpolaris-gallery-prod` |
| **Resource ID** | The short name of a resource inside its parent scope. | `gallery-api`, `gallery-db`, `moderation-api-key` |
| **Bucket name** | The globally unique name of a Cloud Storage bucket. | `devpolaris-gallery-uploads-prod` |
| **Labels** | Lightweight key-value metadata for search, ownership, and cost reporting. | `env=prod`, `team=media`, `service=gallery` |
| **Tags** | Governed key-value resources that supported policy systems can evaluate. | `environment=prod` attached through Resource Manager tags |
| **Evidence bundle** | The small set of facts proving the exact target before a change. | Project, location, resource name, caller identity, labels, and policy output |

For AWS readers, this is the same habit from incident tickets that include an account ID, Region, ARN, tag set, and IAM evidence. GCP resource names and tags are shaped differently, so the safest approach is to collect GCP's exact identifiers instead of translating everything into AWS terms.

## Resource Names
<!-- section-summary: A resource name is the API path that tells Google Cloud which managed object a request means. -->

A **resource name** is the address an API uses for a Google Cloud resource. It usually follows a path shape with collection names and IDs, such as `projects/{project}/locations/{location}/services/{service}`. The collection names are words like `projects`, `locations`, and `services`; the IDs are your actual project, region, and service values.

For the photo gallery, the backend service can have this Cloud Run-style resource name:

```yaml
gallery_api_service: projects/devpolaris-gallery-prod/locations/us-central1/services/gallery-api
```

Important details in that string:

- `projects/devpolaris-gallery-prod` identifies the project boundary.
- `locations/us-central1` identifies the regional placement for the service.
- `services/gallery-api` identifies the local service ID inside that parent path.
- The full path removes ambiguity across projects or regions with similar service names.

Different Google Cloud services use different path shapes because their resources live under different parents. A regional service includes a location. A Secret Manager secret commonly sits under a project path. A bucket often appears as a `gs://` URI in storage workflows. The review habit stays the same: collect the parent project, resource type, location for location-scoped services, and exact ID.

```yaml
gallery_api_service: projects/devpolaris-gallery-prod/locations/us-central1/services/gallery-api
metadata_database: projects/devpolaris-gallery-prod/instances/gallery-db
moderation_secret: projects/devpolaris-gallery-prod/secrets/moderation-api-key
uploads_bucket: gs://devpolaris-gallery-uploads-prod
```

You may also see a **full resource name** in cross-API references. A full resource name adds the owning API service name at the front with a double slash.

```yaml
project_full_resource_name: //cloudresourcemanager.googleapis.com/projects/123456789012
gallery_service_full_resource_name: //run.googleapis.com/projects/devpolaris-gallery-prod/locations/us-central1/services/gallery-api
```

For AWS readers, a full resource name often plays the cross-service identity role you may expect from an ARN. It uses a different format from an ARN or HTTPS URL. The resource name identifies the managed object; an HTTPS endpoint is how a client reaches an API or application.

The `gcloud` CLI helps you prove a resource before changing it. The command below describes the gallery backend and prints only the fields that help another engineer recognize the target.

```bash
PROJECT_ID=devpolaris-gallery-prod
REGION=us-central1
SERVICE=gallery-api

gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="yaml(metadata.name,metadata.labels,status.url,spec.template.spec.serviceAccountName)"
```

Useful output connects the service ID, labels, URL, and runtime service account:

```yaml
metadata:
  labels:
    component: api
    env: prod
    service: gallery
    team: media
  name: gallery-api
spec:
  template:
    spec:
      serviceAccountName: gallery-api-prod@devpolaris-gallery-prod.iam.gserviceaccount.com
status:
  url: https://gallery-api-uc.a.run.app
```

The output is more useful than a screenshot of a console page because the command records the project, region, and service inputs. During an incident, those inputs tell the reviewer which target you inspected.

## Project IDs and Resource IDs
<!-- section-summary: Project IDs identify the workload boundary, while resource IDs identify a specific object inside its parent scope. -->

A **project ID** is the permanent project identifier you choose during project creation. Google Cloud requires it to be globally unique, and many commands, resource names, service account emails, billing exports, logs, and dashboards use it. A display name can be friendly, but the project ID is the value engineers usually type.

A **resource ID** is the short name of a resource inside its parent scope. The service ID `gallery-api` makes sense inside `devpolaris-gallery-prod` and `us-central1`. The secret ID `moderation-api-key` makes sense inside its project. The database ID `gallery-db` makes sense inside its product and project.

For AWS readers, the project ID gives part of the boundary you might normally look for in an AWS account ID. A GCP resource ID is closer to the final named segment inside an ARN, but it usually needs its project and location to be unambiguous.

This read-only command prints the project identifiers. Keep this output or an equivalent inventory record because generated identities can use the project number while humans use the project ID.

```bash
gcloud projects describe devpolaris-gallery-prod \
  --format="yaml(projectId,projectNumber,name,parent)"
```

```yaml
projectId: devpolaris-gallery-prod
projectNumber: '123456789012'
name: Gallery Production
parent:
  id: '345678901234'
  type: folder
```

Service account emails show why the project ID matters. A runtime identity like this tells you which project owns the workload identity:

```yaml
runtime_service_account: gallery-api-prod@devpolaris-gallery-prod.iam.gserviceaccount.com
```

The email alone is not permission evidence. IAM bindings still decide what the identity can do. During a review, keep the service account email next to policy output, secret access evidence, database access evidence, and audit logs.

Short names work well only with the larger coordinates already present:

| Loose phrase | Stronger production evidence |
|---|---|
| "the gallery service" | Project ID, region, service ID, URL, runtime service account |
| "the gallery database" | Project ID, database instance ID, region, engine, connection name |
| "the moderation secret" | Project ID, secret ID, replication setting, IAM policy, latest enabled version |
| "the uploads bucket" | Bucket name, location, labels, retention or lifecycle settings, access configuration |

Good naming standards make the short IDs predictable. The project ID `devpolaris-gallery-prod` carries organization, workload, and environment. The service ID `gallery-api` stays short because the project and region carry the bigger context. The secret ID `moderation-api-key` describes the purpose without storing the secret value in the name.

## Bucket Names Need Extra Care
<!-- section-summary: Cloud Storage bucket names live in a global namespace, so they need stronger collision and privacy review. -->

A **Cloud Storage bucket** is a named container for objects, such as uploaded photos, thumbnails, exports, backups, and data files. Bucket names have a rule that surprises many beginners: all Cloud Storage users share one bucket-name namespace. Every bucket name must be globally unique across Cloud Storage.

That global namespace means names like `photos`, `uploads`, or `gallery` are poor production names. Another organization may already own them, and even if the name is available, it tells the world too little about ownership. A name like `devpolaris-gallery-uploads-prod` gives the company, workload, purpose, and environment without exposing customer data.

For AWS readers, this part maps closely to S3 bucket naming. GCP Cloud Storage bucket names, like S3 bucket names, are globally unique and visible enough that naming should avoid sensitive information.

The command below creates the upload bucket in the approved location. It uses uniform bucket-level access so IAM is the main access path for objects.

```bash
gcloud storage buckets create gs://devpolaris-gallery-uploads-prod \
  --location=us-central1 \
  --uniform-bucket-level-access
```

Important details in that command:

- `gs://devpolaris-gallery-uploads-prod` is the exact bucket URI.
- `--location=us-central1` places the bucket data in the approved location.
- `--uniform-bucket-level-access` keeps access control centered on IAM for the bucket.

Expected output should confirm the bucket URI:

```console
Creating gs://devpolaris-gallery-uploads-prod/...
```

Bucket names need privacy review. Customer emails, user IDs, project numbers, private ticket IDs, and security-sensitive names should stay out of bucket names. Bucket names can appear in URLs, logs, docs, config files, and error messages, so treat them as visible identifiers.

Deletion needs care too. After a bucket is deleted, the name may later be available for reuse. If old scripts, clients, docs, or redirects still point at that name, a future owner of the same bucket name could receive traffic or requests meant for the original bucket. Many teams remove references first, keep old names reserved during migration, or empty a bucket instead of deleting it while old dependencies age out.

## Labels Help People and Cost Reports
<!-- section-summary: Labels are lightweight key-value metadata that help teams search resources, group ownership, and analyze cost. -->

**Labels** are lightweight key-value metadata attached to Google Cloud resources. They help people and tools answer inventory and cost questions: which environment is this, which team owns it, which service uses it, which component is it, and which cost center should see the spend.

For the photo gallery, a shared label set can cover most day-to-day questions. The values should be stable and low-cardinality. A label value like `prod` is useful. A label value containing a request ID, customer email, or one-off incident number creates noise and risk.

| Label key | Example value | What it helps answer |
|---|---|---|
| `env` | `prod` | Which environment owns this resource? |
| `team` | `media` | Which team receives alerts and reviews? |
| `service` | `gallery` | Which product or workload uses it? |
| `component` | `api`, `uploads`, `db` | Which part of the service map is this? |
| `cost_center` | `media-platform` | Which budget should see the cost? |
| `managed_by` | `terraform` | Which workflow should make changes? |

For AWS readers, GCP labels are closest to AWS cost and inventory tags in everyday reporting work. The important difference is that GCP also has Resource Manager tags for governed policy, so avoid assuming the word "tag" means the same thing in both clouds.

![Labels and tags do different jobs](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/labels-tags-different-jobs.png)
*Labels help reporting and inventory. Governed tags help supported policy systems make conditional decisions.*

Labels need a shared vocabulary to stay useful. If one team uses `prod`, another uses `production`, and another uses `live`, cost reporting needs cleanup before it can answer simple questions. A small approved list for `env`, `team`, `service`, and `cost_center` gives finance, platform, and engineering one language.

Infrastructure as code should apply labels from one shared map instead of hand-typing them on every resource. This Terraform snippet is a small review example that shows how a shared label map can flow into a service and a bucket.

```hcl
locals {
  common_labels = {
    env         = "prod"
    team        = "media"
    service     = "gallery"
    cost_center = "media-platform"
    managed_by  = "terraform"
  }
}

resource "google_cloud_run_v2_service" "gallery_api" {
  name     = "gallery-api"
  location = var.region
  labels   = merge(local.common_labels, { component = "api" })
}

resource "google_storage_bucket" "uploads" {
  name     = "devpolaris-gallery-uploads-prod"
  location = var.region
  labels   = merge(local.common_labels, { component = "uploads" })
}
```

Important details in the snippet:

- `common_labels` keeps shared ownership and cost metadata in one visible place.
- `component` changes per resource because the API and bucket do different jobs.
- `managed_by=terraform` tells operators which workflow should own changes.
- Labels describe metadata; IAM, retention, network, and runtime configuration still need their own review.

After deployment, a read-only command should confirm labels on live resources:

```bash
gcloud storage buckets describe gs://devpolaris-gallery-uploads-prod \
  --format="yaml(name,location,labels)"
```

```yaml
labels:
  component: uploads
  cost_center: media-platform
  env: prod
  managed_by: terraform
  service: gallery
  team: media
location: US-CENTRAL1
name: devpolaris-gallery-uploads-prod
```

Labels organize resources and costs. Access, production controls, and safety evidence come from settings such as IAM, retention, network policy, and runtime configuration. A bucket can have `env=prod` and still need a separate review for IAM, retention, lifecycle, encryption, and public exposure.

## Tags Support Governed Policy
<!-- section-summary: Tags are governed metadata resources that supported IAM, organization policy, and network systems can use for conditional decisions. -->

**Tags** in Resource Manager are governed key-value resources. Administrators create tag keys and tag values, control who can attach them, and supported policy systems can evaluate them. Tags may look like labels, but they serve a stronger governance role.

For the photo gallery, the platform team might create a tag key called `environment` with values such as `prod` and `non-prod`. Security policy can then refer to that governed production classification instead of trusting every team to type the same label value correctly.

For AWS readers, this is a place to slow down. AWS tags often cover cost, inventory, automation, and sometimes policy conditions. In GCP, labels handle much of the cost and inventory job, while Resource Manager tags are the governed metadata used by supported policy systems.

These commands create a tag key and a production tag value. In a real organization, platform automation usually owns this vocabulary because tags affect governance.

```bash
gcloud resource-manager tags keys create environment \
  --parent=organizations/123456789012 \
  --description="Environment classification for policy decisions"

gcloud resource-manager tags values create prod \
  --parent=tagKeys/456789012345 \
  --description="Production resources"
```

Important details in those commands:

- `--parent=organizations/...` places the tag key under the organization.
- The tag value belongs under a tag key, such as `tagKeys/456789012345`.
- The numeric names from output are the identifiers later binding commands use.

Expected output gives the identifiers to save:

```yaml
name: tagKeys/456789012345
shortName: environment
parent: organizations/123456789012

name: tagValues/567890123456
shortName: prod
parent: tagKeys/456789012345
```

After a tag value exists, an authorized user or automation can bind it to a supported resource. The binding needs the target resource's full resource name.

```bash
gcloud resource-manager tags bindings create \
  --tag-value=tagValues/567890123456 \
  --parent=//cloudresourcemanager.googleapis.com/projects/123456789012
```

Healthy output should show the tag value and the parent full resource name:

```yaml
name: tagBindings/%2F%2Fcloudresourcemanager.googleapis.com%2Fprojects%2F123456789012/tagValues/567890123456
parent: //cloudresourcemanager.googleapis.com/projects/123456789012
tagValue: tagValues/567890123456
```

Tags can support IAM Conditions, organization policies, and some network policy designs, depending on the feature. Google Cloud also has older VM network tags and newer secure tags for firewall policy designs, so check the service documentation before building a control around the word "tag." The safe habit is to name which tag type a policy uses and save the binding evidence with the change.

## Evidence Bundles Before Changes
<!-- section-summary: A production change should include enough evidence for another engineer to find the same resource and understand why it is the target. -->

An **evidence bundle** is the small set of facts that proves the target before a production change. It should tell another engineer which project, resource, location, identity, labels, and policy output you used to reach your conclusion. The goal is simple: another engineer should be able to find the same resource and understand why it is the one being changed.

Imagine an alert says photo uploads are failing because the backend cannot access the moderation API key. The symptom gives only part of the story. Before changing IAM, you need evidence for the caller, the secret, the project, and the current policy.

![Evidence bundle before a change](/content-assets/articles/article-cloud-providers-gcp-foundations-resource-names-labels-resource-paths/change-evidence-bundle.png)
*A good change ticket names the project, target resource, caller identity, policy evidence, labels, and reason before production is changed.*

The commands below collect the service, runtime identity, secret metadata, and secret IAM policy. They keep project and region explicit so the evidence comes from command inputs.

```bash
PROJECT_ID=devpolaris-gallery-prod
REGION=us-central1
SERVICE=gallery-api
SECRET=moderation-api-key

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

Important details in those commands:

- The service output identifies the caller through `serviceAccountName`.
- The secret output confirms the exact secret and its labels.
- The IAM policy output shows whether the caller already has secret access.
- The explicit variables make the evidence repeatable in a review.

Useful output should connect the runtime service account to the secret policy:

```yaml
bindings:
- members:
  - serviceAccount:gallery-api-prod@devpolaris-gallery-prod.iam.gserviceaccount.com
  role: roles/secretmanager.secretAccessor
```

The same habit applies to bucket work. A ticket about failed image uploads should identify the exact bucket, its location, labels, access mode, retention policy, and the object prefix affected.

```bash
BUCKET=devpolaris-gallery-uploads-prod

gcloud storage buckets describe "gs://$BUCKET" \
  --format="yaml(name,location,labels,iamConfiguration.uniformBucketLevelAccess.enabled,retentionPolicy)"
```

Expected output should show enough facts for review:

```yaml
iamConfiguration:
  uniformBucketLevelAccess:
    enabled: true
labels:
  component: uploads
  env: prod
  service: gallery
  team: media
location: US-CENTRAL1
name: devpolaris-gallery-uploads-prod
retentionPolicy:
  retentionPeriod: '31536000'
```

A strong evidence bundle does not need to be huge. It needs to be specific:

| Change request field | Strong photo gallery example |
|---|---|
| Project | `devpolaris-gallery-prod` plus project number |
| Resource type | Backend service, secret, bucket, database, service account |
| Location | `us-central1` for regional resources, or bucket location for Cloud Storage |
| Exact target | Resource name, service ID, secret ID, bucket URI, or full resource name |
| Caller identity | Runtime service account or human identity requesting access |
| Labels | `env=prod`, `team=media`, `service=gallery`, `component=api` |
| Policy evidence | IAM binding, organization policy, tag binding, retention setting, or network rule |
| Reason | Alert, deploy, access request, cost report, or audit finding |

Evidence ties the naming pieces together. Project IDs narrow the boundary. Resource names identify the object. Bucket names need global-name care. Labels show ownership and reporting context. Tags support governed policy where the service can use them.

## A Production Naming Review
<!-- section-summary: A naming review checks that resource identity, labels, tags, and evidence habits are ready before production resources multiply. -->

A naming and metadata review should happen while the workload is still small. Later renames can require data migration, IAM updates, dashboard changes, alert changes, runbook edits, and coordinated downtime. Early review gives the team a clean vocabulary before production depends on confusing names.

For the photo gallery, the review can stay plain and concrete. It checks the names people say out loud and the identifiers tools use.

| Review item | Healthy production answer |
|---|---|
| Project ID | `devpolaris-gallery-prod` includes organization, workload, and environment. |
| Project number | Recorded because service agents, APIs, and full resource names may use it. |
| Primary region | `us-central1` appears in deploy variables, dashboards, alerts, and resource paths. |
| Backend service ID | `gallery-api` stays consistent across deploys, logs, alerts, and runbooks. |
| Runtime service account | `gallery-api-prod@devpolaris-gallery-prod.iam.gserviceaccount.com` maps to one runtime purpose. |
| Database ID | `gallery-db` clearly maps to the metadata database. |
| Bucket name | `devpolaris-gallery-uploads-prod` avoids generic global names and sensitive values. |
| Secret IDs | `moderation-api-key` describes purpose without exposing the secret value. |
| Required labels | `env`, `team`, `service`, `component`, `cost_center`, and `managed_by` exist on supported resources. |
| Governed tags | Production classification uses Resource Manager tags where IAM, organization policy, or firewall policy needs governed metadata. |
| Change evidence | Production tickets include project, resource type, location, exact target, labels, caller identity, and policy evidence. |

The result is a workload people can operate under pressure. An alert points to a specific service instead of a loose word. A cost report groups resources by service and team. A security review can tell the difference between reporting labels and governed tags. A production change has enough evidence for another engineer to reach the same target.

## References

- [Google API resource names](https://cloud.google.com/apis/design/resource_names) - Defines resource names, full resource names, and path-style resource identity.
- [Google Cloud resource hierarchy](https://cloud.google.com/resource-manager/docs/cloud-platform-resource-hierarchy) - Explains organizations, folders, projects, project IDs, project numbers, and hierarchy relationships.
- [Create and manage projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects) - Documents project ID uniqueness, project numbers, project names, and project creation.
- [Cloud Storage bucket naming guidelines](https://cloud.google.com/storage/docs/buckets#naming) - Documents bucket-name rules, global uniqueness, public visibility, and reuse risk after deletion.
- [Labels overview](https://cloud.google.com/resource-manager/docs/labels-overview) - Explains labels, label limits, billing use cases, sensitive-data guidance, and differences between labels and tags.
- [Best practices for labels](https://cloud.google.com/resource-manager/docs/best-practices-labels) - Gives practical label design guidance for ownership, cost, and operational reporting.
- [Tags overview](https://cloud.google.com/resource-manager/docs/tags/tags-overview) - Explains tag keys, tag values, tag bindings, inheritance, and supported policy integrations.
- [Create and manage tags](https://cloud.google.com/resource-manager/docs/tags/tags-creating-and-managing) - Documents CLI flows for tag keys, tag values, and tag bindings.
- [Tags and conditional access](https://cloud.google.com/iam/docs/tags-access-control) - Explains how IAM Conditions can use tags for conditional access on supported resources.
- [Secure tags for firewalls](https://cloud.google.com/firewall/docs/tags-firewalls-overview) - Explains secure tags, network tags, and firewall policy support.
