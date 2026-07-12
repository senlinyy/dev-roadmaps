---
title: "Cloud Storage"
description: "Design Cloud Storage buckets and objects for profile photos, ticket PDFs, inspection documents, signed URLs, metadata, lifecycle, versioning, soft delete, and retention."
overview: "Cloud Storage gives applications a durable home for whole files outside app servers and relational databases. The guide follows uploaded documents through buckets, objects, names, generations, metadata, IAM, signed URLs, lifecycle, and retention."
tags: ["gcp", "cloud-storage", "buckets", "objects"]
order: 2
id: article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects
aliases:
  - cloud-storage-buckets-and-objects
  - cloud-storage-buckets-objects
  - cloud-providers/gcp/storage-databases/cloud-storage-buckets-and-objects.md
---

## Table of Contents

1. [Why Apps Store Files Outside the App](#why-apps-store-files-outside-the-app)
2. [Buckets](#buckets)
3. [Objects and Object Names](#objects-and-object-names)
4. [Generations and Metadata](#generations-and-metadata)
5. [IAM and Private Access](#iam-and-private-access)
6. [Signed URLs](#signed-urls)
7. [Lifecycle, Versioning, Soft Delete, and Retention](#lifecycle-versioning-soft-delete-and-retention)
8. [A Practical Bucket Baseline](#a-practical-bucket-baseline)
9. [Production Checks](#production-checks)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## Why Apps Store Files Outside the App
<!-- section-summary: Cloud Storage solves the file/object problem for apps that keep whole uploaded or generated files outside runtime and database storage. -->

Many applications need to keep whole files. A user uploads a profile photo. A venue sends a ticket PDF. A field team uploads inspection documents. The app server can receive those bytes, yet the server process should not be the long-term home for them.

Relational databases are usually the wrong default for large file bytes because the database also has to manage tables, indexes, transactions, backups, and query performance. App containers are even more temporary. A new deploy, scale-down event, or instance restart can remove local files from the runtime.

Think of the app server as the front desk, not the archive room. It can accept the uploaded file, check permissions, and write a database record. The long-term bytes need a storage service designed for objects, durability, access control, lifecycle, and recovery. That keeps the runtime small and keeps the database focused on business records.

For example, a ticketing app might store the order, payment status, and ticket ownership in Cloud SQL, then store the finished PDF ticket in Cloud Storage. The database record keeps the object name. The browser receives the file only through a controlled path such as a signed URL after the app verifies the user may view it.

**Cloud Storage** is Google Cloud's object storage service. It gives you buckets for durable object storage, access control, signed links, metadata, lifecycle rules, versioning, soft delete, and retention controls. The app stores the object name in its database and lets Cloud Storage store the bytes.

![Signed URL upload path](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/signed-url-path.png)
*The app can keep business records in a database while Cloud Storage owns the file bytes and time-limited upload or download paths.*

## Buckets
<!-- section-summary: A bucket is the named operational boundary for Cloud Storage objects and their location, access, lifecycle, and retention settings. -->

A **bucket** is the top-level container for objects. Bucket names are globally unique, so a production name often includes the product, environment, purpose, and region, such as `venue-prod-ticket-docs-us`. The bucket also owns settings that affect every object inside it.

For an inspection platform, you might create separate buckets for production documents, staging documents, and temporary upload staging. Separation gives the team clearer IAM, lifecycle, retention, and incident response boundaries.

Important bucket decisions include:

| Bucket decision | What it controls | Example choice |
|---|---|---|
| Location | Where object data is stored | `us-central1` for a regional app, or a dual/multi-region choice for broader resilience |
| Storage class | Cost and access pattern | `STANDARD` for active documents |
| IAM style | How access is granted | Uniform bucket-level access for IAM-only object access |
| Public exposure | Whether public object access is allowed | Public access prevention for private documents |
| Recovery and retention | How previous copies survive | Soft delete, versioning, lifecycle, and retention policies |

For AWS readers, a bucket is the closest GCP equivalent to an S3 bucket. The same design habit applies: use bucket boundaries for environment, ownership, access, and retention rather than dumping unrelated files into one global bucket.

![Bucket and object boundary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/bucket-object-boundary.png)
*Bucket policy owns the broad boundary. Object names and metadata make individual files understandable inside that boundary.*

## Objects and Object Names
<!-- section-summary: An object is the stored byte payload, and its object name is the stable handle your app saves and uses later. -->

An **object** is a stored byte payload plus metadata. A profile photo, ticket PDF, invoice export, inspection image, or ZIP archive can all be objects. Cloud Storage does not require folders in the filesystem sense; names with slashes are still object names.

The **object name** is the path-like string your app uses to find the object again. A weak name such as `photo.jpg` collides quickly. A useful name carries enough context for operations while keeping the database as the source of business search.

Think of the bucket as a large labeled cabinet and the object name as the label on one stored item. The slash characters in `ticket-pdfs/event_20260704/order_913812/ticket.pdf` make the name readable for humans and tools, but Cloud Storage still stores an object under one name. The app should treat that full name as an important identifier.

Good object names often include purpose, tenant or account, date, and record ID:

- `profile-photos/user_8492/avatar/current.jpg`
- `ticket-pdfs/event_20260704/order_913812/ticket.pdf`
- `inspections/site_4471/2026/07/report_771/front-door.jpg`

The database should still store the record owner, status, and permissions. Cloud Storage stores the bytes at the object name. The app joins those ideas by saving the object name on the business record.

This split keeps search and authorization clear. A support screen should find an inspection by site ID, inspector, date, and review status in the database. After the app decides the user may view it, the stored object name tells Cloud Storage which bytes to serve through a controlled path such as a signed URL.

## Generations and Metadata
<!-- section-summary: A generation identifies one specific write of an object, while metadata stores object facts used for serving, auditing, and cleanup. -->

Every time Cloud Storage writes an object, it assigns a **generation**. The object name may stay the same, while the generation distinguishes one write from another. This is useful for regenerated ticket PDFs, replaced inspection photos, and restore runbooks that copy a previous version back.

An object also has **metadata**. Some metadata is system-managed, such as size, content type, checksum, creation time, and generation. You can also attach custom metadata for operational hints, such as source app, upload flow, or document category.

Think of the object name as the public label and the generation as the exact write behind that label. The name `ticket-pdfs/event_20260704/order_913812/ticket.pdf` can stay stable while the file is regenerated. The generation lets support and restore runbooks point at one specific version of the bytes instead of guessing which replacement they are seeing.

Metadata is the small card attached to the object. It should help tools and humans understand the file without opening it. Content type helps browsers handle a PDF as a PDF. Checksums help verify bytes. Custom metadata can record safe operational hints such as `source=checkout` or `document_type=ticket`. It should not carry secrets, long notes, or the business database record.

A small upload might include a content type and custom metadata:

```bash
gcloud storage cp ./ticket.pdf \
  gs://venue-prod-ticket-docs-us/ticket-pdfs/event_20260704/order_913812/ticket.pdf \
  --content-type=application/pdf \
  --custom-metadata=source=checkout,document_type=ticket
```

Important details in this command:

- `gs://venue-prod-ticket-docs-us/...` is the bucket and object name.
- `--content-type=application/pdf` helps browsers and downstream tools handle the file correctly.
- `--custom-metadata` adds small operational labels to the object; it should not hold secrets or large business records.

A quick describe command shows the exact object metadata and generation:

```bash
gcloud storage objects describe \
  gs://venue-prod-ticket-docs-us/ticket-pdfs/event_20260704/order_913812/ticket.pdf \
  --format="yaml(name,generation,contentType,metadata,size)"
```

Example output:

```yaml
contentType: application/pdf
generation: '1719858400123456'
metadata:
  document_type: ticket
  source: checkout
name: ticket-pdfs/event_20260704/order_913812/ticket.pdf
size: '184233'
```

## IAM and Private Access
<!-- section-summary: IAM controls who can use a bucket or object, and private-by-default buckets are the safer default for user documents. -->

**IAM**, Identity and Access Management, controls which principals can perform actions on Cloud Storage resources. A principal can be a user, group, service account, or workload identity. For app-owned documents, the app service account should receive only the roles it needs on the specific bucket.

The key beginner idea is that bucket access and application permission are different layers. Cloud Storage IAM decides whether a principal can use the bucket or object. Your application still decides whether this customer, support agent, or internal tool is allowed to see a specific business document. Do not make the bucket public just because browsers need to download files.

Two bucket settings make private storage easier to operate. **Uniform bucket-level access** makes IAM the main access model for the bucket and objects. **Public access prevention** blocks common public exposure paths. Together, they support a private-by-default design for tickets, photos, and inspection documents.

For private user documents, the usual shape is: the app service account can read or write the bucket, normal users cannot access the bucket directly, and the app hands out short-lived URLs only after its own business permission check. That keeps cloud storage credentials and broad bucket permissions away from browsers.

An app service account might receive object create and read access on the document bucket:

```bash
gcloud storage buckets add-iam-policy-binding gs://venue-prod-ticket-docs-us \
  --member="serviceAccount:ticket-docs-api@venue-prod.iam.gserviceaccount.com" \
  --role="roles/storage.objectUser"
```

Important details in this command:

- The member is the workload identity used by the API, not a human developer account.
- `roles/storage.objectUser` allows object work without handing out broad project administration.
- Bucket-scoped grants make review easier because the permission sits near the data it protects.

## Signed URLs
<!-- section-summary: A signed URL gives time-limited access to one object operation without making the bucket public. -->

A **signed URL** is a URL with a cryptographic signature that grants temporary access to a specific Cloud Storage operation. It is useful for browser uploads or downloads of one object while broad bucket permissions stay on the server side.

For example, the app can ask Cloud Storage for a 10-minute upload URL for `inspections/site_4471/2026/07/report_771/front-door.jpg`. The browser uploads directly to Cloud Storage. The app records the object name and later decides who can view or replace the file.

```bash
gcloud storage sign-url \
  gs://inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg \
  --duration=10m \
  --http-verb=PUT \
  --headers=Content-Type=image/jpeg \
  --format=yaml
```

Important details in this command:

- `--duration=10m` limits how long the URL can be used.
- `--http-verb=PUT` signs an upload operation; a download URL would use `GET`.
- The signed headers should match the browser upload request, including content type if required.
- `--format=yaml` makes the example output easy to read in a review ticket.

Example redacted output:

```yaml
expiration: '2026-07-04 18:12:44'
http_verb: PUT
resource: gs://inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg
signed_url: https://storage.googleapis.com/inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=inspection-uploader%40inspection-prod.iam.gserviceaccount.com%2F20260704%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260704T180244Z&X-Goog-Expires=600&X-Goog-SignedHeaders=content-type%3Bhost&X-Goog-Signature=REDACTED
```

The app should return the signed URL and the object name together. The browser uses the URL for the upload request. The app stores the object name, such as `inspections/site_4471/2026/07/report_771/front-door.jpg`, on the inspection record. Later screens should use that stored object name to request a fresh download URL after the app checks that the current user can view the inspection.

That handoff keeps storage credentials on the server. The browser receives a narrow temporary capability for one object and one HTTP verb. If the user refreshes the page after the URL expires, the old URL should fail with a 403-style response from Cloud Storage, and the browser should ask the app for a new URL. The object is still present; only the temporary access path expired.

For downloads, the flow is similar. The app checks the user's business permission, signs a short-lived `GET` URL for the stored object name, and returns it to the browser. Store object names in the database instead of signed URLs; signed URLs expire, and anyone with a copied URL can use it until the expiry time.

For AWS readers, signed URLs are the Cloud Storage counterpart to S3 presigned URLs. One practical GCP detail is that object generations can give you an exact previous write to inspect or restore after a replace.

## Lifecycle, Versioning, Soft Delete, and Retention
<!-- section-summary: Lifecycle and retention controls decide how old objects, deleted objects, previous generations, and compliance records survive over time. -->

Files need a cleanup and recovery plan. Temporary upload objects should expire. Ticket PDFs may need long retention. Inspection photos may need a recent recovery window. Replaced documents may need older generations for support investigations.

**Object Versioning** keeps noncurrent generations after objects are replaced or deleted. **Soft delete** keeps recently deleted objects or buckets recoverable for a configured period. **Object Lifecycle Management** applies rules such as deleting temporary files after a set age or removing old noncurrent versions. A **retention policy** prevents objects from being removed until they satisfy the retention period.

Here is a lifecycle rule for upload staging objects:

```json
{
  "rule": [
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "age": 7,
        "matchesPrefix": ["upload-staging/"]
      }
    },
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "isLive": false,
        "age": 90
      }
    }
  ]
}
```

Important details in this config:

- The first rule deletes old temporary upload objects after seven days.
- The second rule deletes noncurrent object versions after 90 days.
- Lifecycle rules should match the business record policy so storage cleanup does not remove evidence the app still needs.

Apply the rule with:

```bash
gcloud storage buckets update \
  gs://inspection-prod-docs-us \
  --lifecycle-file=inspection-lifecycle.json
```

Important details in this command:

- `--lifecycle-file` points Cloud Storage at the reviewed JSON policy.
- The update changes bucket behavior, so staging should prove it before production.
- After applying it, describe the bucket and confirm the lifecycle rule is present.

Retention policy deserves a separate review because it blocks deletion before the retention age. A seven-year retention policy for submitted inspection reports might look like this:

```bash
gcloud storage buckets update gs://inspection-prod-docs-us \
  --retention-period=7y
```

Important details in this command:

- `--retention-period=7y` protects objects from deletion before the retention age.
- Test retention behavior in a non-production bucket before applying it to required production records.
- Locking a retention policy is a serious compliance action because it restricts later removal or shortening.

Verify the retention setting before any lock decision:

```bash
gcloud storage buckets describe gs://inspection-prod-docs-us \
  --format="yaml(retentionPolicy,metageneration)"
```

Example output:

```yaml
metageneration: 8
retentionPolicy:
  effectiveTime: '2026-07-04T12:15:03.124Z'
  retentionPeriod: '220752000'
```

This output gives reviewers the effective time and retention period. A production lock should require explicit approval, because the lock is meant for records the organization must keep.

![Cloud Storage summary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/cloud-storage-summary.png)
*Cloud Storage design combines naming, metadata, access, signed URLs, lifecycle, and recovery controls.*

## A Practical Bucket Baseline
<!-- section-summary: A first production bucket should be private, location-aware, lifecycle-managed, and easy to inspect. -->

After the concepts are clear, a practical production baseline can create a private regional bucket for inspection documents:

The baseline is the minimum production story a reviewer should be able to follow. It should say where the objects live, whether public access is blocked, how IAM is handled, how old versions survive, how deleted files can be recovered, and how temporary files age out. A bucket without that story is only a container, not an operating design.

The baseline is deliberately boring. A first production bucket should be private, regionally intentional, named for its purpose, protected from accidental public exposure, and covered by lifecycle or recovery controls that match the business record. Fancy settings are less important than a design a new teammate can explain.

For inspection documents, the bucket should not be a dumping ground for unrelated app files. It should hold inspection document objects, use object names the inspection app stores on records, and expose access through the app or signed URLs after business permission checks. That makes bucket policy, incident response, and cleanup much easier to review.

```bash
gcloud storage buckets create gs://inspection-prod-docs-us \
  --project=inspection-prod \
  --location=us-central1 \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Important details in this command:

- `--location=us-central1` keeps the bucket close to the app and its users if that region is the agreed home.
- `--uniform-bucket-level-access` keeps access decisions in IAM.
- `--public-access-prevention` helps prevent accidental public document exposure.

Then enable object versioning and choose a soft delete duration:

```bash
gcloud storage buckets update gs://inspection-prod-docs-us --versioning

gcloud storage buckets update \
  gs://inspection-prod-docs-us \
  --soft-delete-duration=30d
```

Important details in these commands:

- `--versioning` keeps previous generations after replacement or deletion.
- `--soft-delete-duration=30d` keeps recently deleted objects recoverable for 30 days.
- Versioning and soft delete should pair with lifecycle cleanup so old copies do not grow forever.

A verification command should show the settings you expect:

```bash
gcloud storage buckets describe gs://inspection-prod-docs-us \
  --format="yaml(name,location,iamConfiguration.uniformBucketLevelAccess.enabled,publicAccessPrevention,versioning,softDeletePolicy)"
```

Example output:

```yaml
iamConfiguration:
  uniformBucketLevelAccess:
    enabled: true
location: US-CENTRAL1
name: inspection-prod-docs-us
publicAccessPrevention: enforced
softDeletePolicy:
  retentionDurationSeconds: '2592000'
versioning:
  enabled: true
```

## Production Checks
<!-- section-summary: Production Cloud Storage checks prove that the bucket, object names, access, recovery, and cleanup policy match the application job. -->

Before trusting the bucket, walk through the full file path. Upload a test file, describe its metadata, read it through the app path, generate a signed URL, replace it, inspect the previous generation, delete a test object, and practice restoring it during the soft delete window.

Use a short checklist:

| Check | What good evidence shows |
|---|---|
| Bucket settings | Correct location, uniform bucket-level access, public access prevention, versioning, soft delete |
| Object naming | Names include purpose, owner or record ID, and date if useful |
| Metadata | Content type and custom metadata support serving and operations |
| IAM | App service account has narrow bucket access; humans use reviewed roles |
| Signed URLs | URLs expire quickly and allow only the intended method |
| Lifecycle | Temporary objects and old versions age out on purpose |
| Restore | A previous generation or soft-deleted object can be recovered in a sandbox drill |

Treat the checklist as a staging upload and restore drill. Upload one harmless file through the same browser path production uses, then save the request ID, object name, object generation, metadata output, and app record ID in the release notes or runbook ticket. That evidence proves the bucket settings and naming rules apply to the real app path and the bucket configuration.

The IAM check should use the app service account and a human account with reviewed permissions. The app service account should upload or read exactly the object path it needs. A human account without object access should fail cleanly. Those two results prove both sides of the boundary: the application can do its job, and casual project access does not expose private documents.

The signed URL check should include one successful `PUT`, one attempted `GET` against the upload URL, and one retry after expiry. The successful upload proves the app and browser agree on method, content type, and object name. The wrong-method and expired attempts should fail, which proves the URL is narrow and time-limited.

The lifecycle and restore checks need their own evidence. In staging, use a short-lived test prefix such as `upload-staging/drills/` and confirm the bucket lifecycle rule targets that prefix. Then replace or delete a test object, list generations or soft-deleted state, restore the previous copy into a sandbox prefix, and compare size, checksum, content type, and app metadata. A restore drill only counts after someone proves the recovered object is the file the app expected.

## Putting It Together
<!-- section-summary: Cloud Storage is the file/object layer for apps that need durable bytes, controlled access, and recoverable object history. -->

Cloud Storage fits whole files that live outside the app runtime and outside the relational database. A good design defines the bucket boundary, object names, generations, metadata, IAM, signed URLs, lifecycle, soft delete, versioning, and retention before the first production upload matters.

Keep the pattern direct: the database stores business meaning and object names; Cloud Storage stores the bytes and object-level controls.

## References

- [Cloud Storage buckets](https://cloud.google.com/storage/docs/buckets) - Documents bucket boundaries, naming, locations, and operational settings.
- [Cloud Storage objects](https://cloud.google.com/storage/docs/objects) - Documents objects, object names, metadata, and generations.
- [Signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls) - Documents temporary signed access for specific Cloud Storage operations.
- [Object Versioning](https://cloud.google.com/storage/docs/object-versioning) - Documents previous object generations and recovery after overwrite or delete.
- [Soft delete](https://cloud.google.com/storage/docs/soft-delete) - Documents recoverable object and bucket deletion windows.
- [Object Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle) - Documents lifecycle rules for aging, deleting, and transitioning objects.
- [Bucket retention policies](https://cloud.google.com/storage/docs/bucket-lock) - Documents retention controls that prevent early deletion.
