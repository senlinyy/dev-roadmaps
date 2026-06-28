---
title: "Cloud Storage"
description: "Design Cloud Storage buckets and objects for receipt PDFs and user uploads with private access, signed URLs, lifecycle rules, versioning, soft delete, retention, and practical gcloud and IaC examples."
overview: "Cloud Storage is the Google Cloud home for file-like objects such as receipts, exports, uploads, images, and generated artifacts. This article follows receipt PDFs and user uploads through bucket design, object naming, IAM, signed URLs, lifecycle, and recovery controls."
tags: ["gcp", "cloud-storage", "buckets", "objects"]
order: 2
id: article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects
aliases:
  - cloud-storage-buckets-and-objects
  - cloud-storage-buckets-objects
  - cloud-providers/gcp/storage-databases/cloud-storage-buckets-and-objects.md
---

## Table of Contents

1. [The Receipt And Upload Problem](#the-receipt-and-upload-problem)
2. [Buckets: The Boundary You Operate](#buckets-the-boundary-you-operate)
3. [Objects, Names, And Generations](#objects-names-and-generations)
4. [Upload Path And Metadata](#upload-path-and-metadata)
5. [IAM, Uniform Bucket-Level Access, And Public Access Prevention](#iam-uniform-bucket-level-access-and-public-access-prevention)
6. [Signed URLs For Browser Access](#signed-urls-for-browser-access)
7. [Versioning, Soft Delete, Retention, And Lifecycle](#versioning-soft-delete-retention-and-lifecycle)
8. [gcloud And IaC Baseline](#gcloud-and-iac-baseline)
9. [Production Checks](#production-checks)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Receipt And Upload Problem
<!-- section-summary: Cloud Storage fits receipt PDFs and user uploads because the app needs durable named objects outside the request-time database. -->

Let's keep following the Orders product from the previous article. A customer checks out, the API creates an order in Cloud SQL, the receipt renderer creates a PDF, and the browser may upload an address image for manual review. Those files can grow large, and the API team does not want them sitting inside relational rows or on a Cloud Run container filesystem.

**Cloud Storage** gives the team a managed object store. The app writes named objects into buckets, stores the object names in the database, and later grants short-lived access to one object when a customer or reviewer needs it. The database continues to answer business questions such as "which receipt belongs to this order," while Cloud Storage holds and serves the bytes.

The full flow moves through three handles: the order row keeps the business pointer, the object name points to the bytes, and the signed URL gives one temporary browser operation after the API checks the customer.

![Signed URL upload path](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/signed-url-path.png)
*The browser never receives bucket credentials. The backend signs a narrow URL for one object, Cloud Storage checks the signature and expiration, and the object lands in the bucket with the expected name.*

The bucket design matters because it sets the boundary for location, access, lifecycle, retention, and cost. The object design matters because your app and operations team use object names, metadata, and generations as handles during normal work and incidents.

## Buckets: The Boundary You Operate
<!-- section-summary: A bucket is the location, policy, lifecycle, and naming boundary for related Cloud Storage objects. -->

A **bucket** is a Cloud Storage container for objects. It has a globally unique name, a location, a default storage class, IAM policy, public access settings, lifecycle rules, retention settings, soft delete policy, labels, and other controls. For the Orders product, the bucket should represent a real operational boundary, not a random folder-like convenience.

A good first bucket for receipt PDFs might be `orders-prod-receipts-us`. That name tells a human the app, environment, data type, and region family. A separate bucket such as `orders-prod-user-uploads-us` can hold customer uploads because uploads often need different antivirus processing, lifecycle rules, and review access. Development and staging should use their own buckets, because mixing environments turns IAM and cleanup rules into a guessing game.

The bucket location deserves an early decision. A regional bucket near the Cloud Run service and Cloud SQL instance can reduce latency and keep the system simple. Dual-region or multi-region buckets can fit disaster recovery or global serving goals, but they also affect cost, replication behavior, and data residency discussions. Teams usually write the location choice into the architecture record so a future operator understands the reason.

A private production bucket can start like this:

```bash
gcloud storage buckets create gs://orders-prod-receipts-us \
  --project=orders-prod-123 \
  --location=us-central1 \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --soft-delete-duration=14d
```

This command creates one bucket with a Standard storage class, uniform IAM-based access, enforced public access prevention, and a 14-day soft delete window. Google Cloud's default soft delete duration is seven days unless another policy applies, so the command makes the recovery window explicit. That explicit value helps reviewers, auditors, and future maintainers see the intended protection level.

The important flags are `--location`, which fixes where the bucket stores data; `--uniform-bucket-level-access`, which makes IAM the access boundary; `--public-access-prevention`, which blocks public grants; and `--soft-delete-duration`, which sets the short recovery window for accidental deletion. The read-back command is the proof that the bucket carries the settings the design expected.

```bash
gcloud storage buckets describe gs://orders-prod-receipts-us \
  --format='yaml(name,location,storageClass,uniformBucketLevelAccess,publicAccessPrevention,softDeletePolicy)'
```

```yaml
name: orders-prod-receipts-us
location: US-CENTRAL1
storageClass: STANDARD
uniformBucketLevelAccess:
  enabled: true
publicAccessPrevention: enforced
softDeletePolicy:
  retentionDurationSeconds: '1209600'
```

![Bucket and object boundary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/bucket-object-boundary.png)
*The bucket owns policy and location. The object keyspace owns the durable file names the application stores in Cloud SQL and uses during restore work.*

## Objects, Names, And Generations
<!-- section-summary: Objects are named byte payloads, and names plus generations give the app safe handles for lookup and recovery. -->

An **object** is the file-like payload inside a bucket. Cloud Storage identifies an object by bucket name, object name, and generation. The generation changes when the object data changes, so it gives the team a precise version handle during debugging or recovery.

Object names can contain slashes, and tools often display those prefixes as folders. For ordinary receipt and upload buckets, the design should still treat the name as an object key that the app chooses. Cloud Storage also has folder-oriented features for buckets with hierarchical namespace and managed folders, but a receipt bucket usually needs stable object keys, IAM on the bucket, and database pointers.

For receipts, the app could use names like these:

```markdown
receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf
receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt-redacted.pdf
```

For user uploads, the app should avoid raw user file names as the primary object name. User file names can contain personal data, confusing characters, duplicates, and misleading extensions. A safer pattern uses an upload ID and stores the original file name as database metadata if the product needs to display it.

```markdown
uploads/tenant_42/user_cus_8842/2026/06/14/upload_upl_9QS2/original
uploads/tenant_42/user_cus_8842/2026/06/14/upload_upl_9QS2/thumbnail.webp
```

The database record can store the bucket, object name, generation, content type, size, checksum, uploader, and scan status. That record lets support and backend jobs find objects without listing the bucket as a search engine.

```sql
CREATE TABLE order_files (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  bucket_name TEXT NOT NULL,
  object_name TEXT NOT NULL,
  object_generation TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  scan_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This small table gives the application a clean pointer. Cloud Storage holds the object, and Cloud SQL keeps the business relationship, review state, and lookup path.

## Upload Path And Metadata
<!-- section-summary: Uploads should set content metadata and use overwrite protection so one bad retry cannot replace the wrong object. -->

The upload path has two jobs: place the bytes in the correct object and attach enough metadata for downstream clients and jobs. For a receipt PDF, the metadata should say that the content type is `application/pdf` and that caches should treat the file as private. For a user image, the metadata should reflect the detected content type after validation rather than trusting the browser blindly.

Here is a direct `gcloud` upload for a generated receipt. The `--if-generation-match=0` precondition means the copy only succeeds if no live object already exists at that name. That one flag prevents an accidental overwrite during retries or repeated jobs.

```bash
gcloud storage cp ./receipt.pdf \
  gs://orders-prod-receipts-us/receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf \
  --content-type=application/pdf \
  --cache-control="private, max-age=0, no-transform" \
  --custom-metadata=order-id=ord_7K2Q,tenant-id=tenant_42 \
  --if-generation-match=0
```

A production app usually performs the same idea through a client library. The code should generate the object name on the server, attach metadata, set an overwrite precondition, and then store the returned generation in the database after the upload succeeds.

```ts
import { Storage } from "@google-cloud/storage";

const storage = new Storage();
const bucket = storage.bucket("orders-prod-receipts-us");

await bucket.upload("/tmp/receipt.pdf", {
  destination: "receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf",
  metadata: {
    contentType: "application/pdf",
    cacheControl: "private, max-age=0, no-transform",
    metadata: {
      orderId: "ord_7K2Q",
      tenantId: "tenant_42"
    }
  },
  preconditionOpts: {
    ifGenerationMatch: 0
  }
});
```

Metadata helps clients and background jobs handle the object correctly, but it should not replace the application database. Listing millions of objects to find "all receipts for this customer" creates slow operations and weak access control. The database should answer business queries, and Cloud Storage should serve the object bytes by name.

After the upload, the team should read the object metadata back. The generation and metageneration values are useful because they prove which version the database should store and whether metadata changed later.

```bash
gcloud storage objects describe \
  gs://orders-prod-receipts-us/receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf \
  --format='yaml(name,generation,metageneration,contentType,size,metadata,crc32c)'
```

```yaml
name: receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf
generation: '1799948215814453'
metageneration: '1'
contentType: application/pdf
size: '184233'
metadata:
  order-id: ord_7K2Q
  tenant-id: tenant_42
crc32c: ImIEBA==
```

## IAM, Uniform Bucket-Level Access, And Public Access Prevention
<!-- section-summary: Private buckets should rely on IAM at the bucket boundary, avoid object ACL drift, and block accidental public exposure. -->

Cloud Storage supports access through IAM and, in older patterns, access control lists. **Uniform bucket-level access** turns off object ACLs and makes bucket-level IAM the access system for the bucket and its objects. Google Cloud generally recommends this mode because it simplifies access, prevents hidden object ACL exposure, and unlocks features such as IAM conditions on buckets.

For the Orders product, the Cloud Run runtime service account does not need broad storage administrator access. The API that writes receipts can receive `roles/storage.objectCreator` on the receipt bucket. A review worker that reads uploads after scanning can receive a reader role on the upload bucket. A cleanup job can receive a narrow delete-capable role only if the lifecycle rules do not cover that workflow.

```bash
gcloud storage buckets add-iam-policy-binding gs://orders-prod-receipts-us \
  --member="serviceAccount:orders-api@orders-prod-123.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"

gcloud storage buckets add-iam-policy-binding gs://orders-prod-receipts-us \
  --member="serviceAccount:receipt-url-signer@orders-prod-123.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

**Public access prevention** blocks public grants such as `allUsers` and `allAuthenticatedUsers` when the setting is enforced. That setting protects teams from the classic mistake where a bucket or object accidentally receives public access during a rushed support task. It still allows private access through IAM and signed URLs, which is exactly what receipt downloads need.

Uniform bucket-level access deserves care when a legacy bucket already relies on object ACLs. Enabling it revokes ACL-only access, and Cloud Storage prevents disabling it after it has stayed active on a bucket for 90 consecutive days. New production buckets should start with it enabled. Existing buckets should get an access inventory and migration plan before the switch.

## Signed URLs For Browser Access
<!-- section-summary: Signed URLs give one temporary object operation to a browser without handing out bucket credentials. -->

A **signed URL** is a temporary URL that grants access to one Cloud Storage operation, such as `GET` for a receipt download or `PUT` for a browser upload. The browser does not receive Google Cloud credentials. It only receives a URL with an embedded signature, method, object path, headers, and expiration.

This pattern keeps the API out of the file transfer path. The backend checks that the customer owns the order, creates a short-lived signed URL for the exact receipt object, and returns it to the browser. The browser downloads the file directly from Cloud Storage. The API handles authorization and business rules, while Cloud Storage handles the bytes.

For a 10-minute receipt download URL, the team can sign with an impersonated service account:

```bash
gcloud storage sign-url \
  gs://orders-prod-receipts-us/receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf \
  --duration=10m \
  --impersonate-service-account=receipt-url-signer@orders-prod-123.iam.gserviceaccount.com
```

For a direct browser upload, the backend can sign a `PUT` URL for the exact upload object. The signed request should include the content type header if the client must send that header, because signed URL validation includes signed headers.

```bash
gcloud storage sign-url \
  gs://orders-prod-user-uploads-us/uploads/tenant_42/user_cus_8842/2026/06/14/upload_upl_9QS2/original \
  --http-verb=PUT \
  --duration=15m \
  --headers=content-type=image/jpeg \
  --impersonate-service-account=upload-url-signer@orders-prod-123.iam.gserviceaccount.com
```

The application service account also needs permission to sign as the signer account. In many teams, platform engineers grant `roles/iam.serviceAccountTokenCreator` on the signer account to the API service account, then grant the signer account the narrow Cloud Storage role needed for the target operation.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  receipt-url-signer@orders-prod-123.iam.gserviceaccount.com \
  --member="serviceAccount:orders-api@orders-prod-123.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Signed URLs need small expiration windows and exact object names. Anyone who has the URL can use it until it expires, so the app should generate URLs after checking the caller, keep durations short, and avoid logging full signed URLs in application logs. For large uploads, a resumable upload session gives the browser a way to continue after a network interruption without starting over.

The command output prints the signed URL. In a real runbook, the team should avoid pasting the full URL into tickets or logs because the query string is the credential until expiration.

```console
URL: https://storage.googleapis.com/orders-prod-receipts-us/receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=receipt-url-signer%40orders-prod-123.iam.gserviceaccount.com%2F20260614%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260614T104500Z&X-Goog-Expires=600&X-Goog-SignedHeaders=host&X-Goog-Signature=...
```

## Versioning, Soft Delete, Retention, And Lifecycle
<!-- section-summary: Recovery and cost controls should be deliberate because object protection features keep extra data by design. -->

Cloud Storage gives several protection and lifecycle tools, and they solve different problems. **Object versioning** keeps noncurrent generations when a live object changes or gets deleted. **Soft delete** keeps deleted objects and buckets in a recoverable state for a configured duration. **Retention policies** prevent deletion for a minimum period. **Object Lifecycle Management** changes storage class or deletes objects based on conditions such as age, version state, creation time, or prefix.

The Orders team might enable versioning for receipts because a mistaken overwrite should not destroy the previous PDF immediately. The same team might use a shorter soft delete window for temporary upload staging, because temporary objects can multiply quickly. Retention policies fit compliance needs, but they can block deletion by design, so legal, security, and platform teams should agree on them before locking anything.

```bash
gcloud storage buckets update gs://orders-prod-receipts-us \
  --versioning \
  --soft-delete-duration=14d
```

Lifecycle rules keep recovery features from turning into unlimited cost. A receipts bucket might move older PDFs to Nearline after 90 days, delete noncurrent versions after 30 days, and delete abandoned temporary upload objects after seven days. The team can express that as JSON and apply it to the bucket.

```json
{
  "rule": [
    {
      "action": {
        "type": "SetStorageClass",
        "storageClass": "NEARLINE"
      },
      "condition": {
        "age": 90,
        "matchesPrefix": ["receipts/"]
      }
    },
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "age": 30,
        "isLive": false
      }
    },
    {
      "action": {
        "type": "Delete"
      },
      "condition": {
        "age": 7,
        "matchesPrefix": ["tmp/"]
      }
    }
  ]
}
```

```bash
gcloud storage buckets update gs://orders-prod-receipts-us \
  --lifecycle-file=receipts-lifecycle.json
```

The lifecycle file is consumed by the bucket update command. The read-back command should show the same rules after Google Cloud accepts the policy, and reviewers should check the `matchesPrefix`, `age`, and noncurrent-version condition before approving the change.

```bash
gcloud storage buckets describe gs://orders-prod-receipts-us \
  --format='json(lifecycle)'
```

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {
          "storageClass": "NEARLINE",
          "type": "SetStorageClass"
        },
        "condition": {
          "age": 90,
          "matchesPrefix": [
            "receipts/"
          ]
        }
      },
      {
        "action": {
          "type": "Delete"
        },
        "condition": {
          "age": 30,
          "isLive": false
        }
      }
    ]
  }
}
```

The practical rule is to pair every protection feature with a cleanup rule and a restore test. Versioning without noncurrent cleanup can surprise the bill. Retention without a restore procedure still leaves the team guessing during an incident. Lifecycle without labels or prefixes can delete the wrong class of object if the naming plan is sloppy.

![Cloud Storage summary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-storage-buckets-objects/cloud-storage-summary.png)
*Cloud Storage operations keep coming back to the same pieces: bucket boundary, object key, uniform access, signed URL, lifecycle, and versioned recovery.*

## gcloud And IaC Baseline
<!-- section-summary: Production buckets should be reproducible, so teams usually keep the bucket, IAM, lifecycle, and recovery settings in reviewed code. -->

The `gcloud` commands are useful for learning and incident work, but production bucket settings should usually live in infrastructure-as-code. Reviewed code gives the team a history of location, soft delete duration, lifecycle rules, IAM bindings, labels, and retention choices. It also reduces the chance that a console change quietly moves a bucket away from the agreed design.

Here is a Terraform-shaped baseline for the receipts bucket. The exact module layout can differ by team, but the important settings stay visible: location, uniform access, public access prevention, soft delete, versioning, lifecycle, and labels.

```hcl
resource "google_storage_bucket" "receipts" {
  name                        = "orders-prod-receipts-us"
  project                     = "orders-prod-123"
  location                    = "US-CENTRAL1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  soft_delete_policy {
    retention_duration_seconds = 1209600
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }

    condition {
      age            = 90
      matches_prefix = ["receipts/"]
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      age       = 30
      with_state = "ARCHIVED"
    }
  }

  labels = {
    app                 = "orders"
    environment         = "prod"
    data_classification = "customer-receipts"
  }
}

resource "google_storage_bucket_iam_member" "orders_api_receipt_creator" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:orders-api@orders-prod-123.iam.gserviceaccount.com"
}

resource "google_storage_bucket_iam_member" "receipt_signer_viewer" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:receipt-url-signer@orders-prod-123.iam.gserviceaccount.com"
}
```

Real teams often wrap this in a reusable bucket module. The module should still expose the settings that change risk: public access prevention, uniform access, lifecycle rules, soft delete duration, retention period, logging, labels, and IAM members. Hiding those decisions behind a one-line module call makes review weaker.

This Terraform resource is consumed by the platform pipeline, usually through `terraform plan` in a pull request and `terraform apply` after approval. The verification step should compare live metadata to the reviewed code instead of trusting that apply succeeded.

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan | sed -n '/google_storage_bucket.receipts/,/}/p'
```

```bash
# google_storage_bucket.receipts will be created
+ name                        = "orders-prod-receipts-us"
+ location                    = "US-CENTRAL1"
+ public_access_prevention    = "enforced"
+ uniform_bucket_level_access = true
+ storage_class               = "STANDARD"
```

## Production Checks
<!-- section-summary: A production Cloud Storage bucket needs checks for access, naming, upload safety, recovery, cost, and observability. -->

Before a bucket carries customer files, the Orders team should test the boring details. Boring storage details are exactly the ones that save the incident call later. A good review asks whether the service account can do only the required operations, whether a bad retry can overwrite an object, whether the signed URL expires quickly, and whether the team can restore a deleted object.

| Check | What the team verifies | Example evidence |
| --- | --- | --- |
| Bucket boundary | Production receipts, temporary uploads, and staging data live in separate buckets | Bucket names and labels show app, environment, and data class |
| IAM | Runtime service accounts have narrow roles on the bucket | `gcloud storage buckets get-iam-policy gs://orders-prod-receipts-us` |
| Public exposure | Public access prevention is enforced | Bucket metadata shows public access prevention as enforced |
| Upload safety | Writers use generation preconditions for unique names | Upload code sets `ifGenerationMatch: 0` |
| Signed URLs | URLs include exact object names, methods, headers, and short durations | Integration test downloads one receipt and rejects after expiration |
| Recovery | Soft delete, versioning, or backups match the data class | Restore drill recovers a test object into a private bucket |
| Lifecycle | Old objects transition or delete according to policy | Lifecycle JSON is reviewed and applied from code |
| Observability | Storage access and admin changes show up in audit logs | Audit log query records policy changes and object operations |

The team can also script a small smoke test after a bucket change. It uploads a test object with a generation precondition, signs a short GET URL, downloads it, verifies the checksum, deletes it, and restores it if the recovery policy supports that path. That test gives platform and app teams confidence that the happy path and the recovery path both work.

## Putting It All Together
<!-- section-summary: Cloud Storage works well when buckets own policy boundaries and objects own durable named bytes. -->

The Orders product stores receipt PDFs and user uploads in Cloud Storage because those files act like durable named byte payloads. The bucket gives the team the operational boundary for location, IAM, public access prevention, soft delete, versioning, lifecycle, retention, and labels. The object name gives the app a stable handle, and the generation gives operators a precise version during recovery.

The app should keep business meaning in Cloud SQL. It stores the bucket, object name, generation, owner, content type, scan state, and support metadata there. Cloud Storage holds the object bytes and serves them through authenticated requests or signed URLs after the backend checks the user.

The production version of this pattern has a few repeated habits. New buckets start private with uniform bucket-level access and public access prevention. Uploads use generated names and overwrite preconditions. Browser downloads and uploads use short-lived signed URLs. Lifecycle rules control cost. Versioning, soft delete, retention, and restore drills turn object storage from "the file is somewhere" into a system the team can operate during a real incident.

## What's Next

Receipts and uploads gave us the object-storage side of the Orders product. The next storage shape is the relational data behind checkout: orders, payments, line items, refunds, schema migrations, backups, connection handling, and point-in-time recovery with Cloud SQL.

---

**References**

- [Cloud Storage overview](https://cloud.google.com/storage/docs/introduction) - Explains the object storage model, buckets, objects, locations, storage classes, and common use cases.
- [Cloud Storage buckets](https://cloud.google.com/storage/docs/buckets) - Documents bucket naming, bucket metadata, locations, labels, and bucket-level settings.
- [About Cloud Storage objects](https://cloud.google.com/storage/docs/objects) - Defines objects, object names, metadata, generations, and object behavior.
- [gcloud storage buckets create](https://cloud.google.com/sdk/gcloud/reference/storage/buckets/create) - Documents bucket creation flags including location, storage class, public access prevention, soft delete, retention period, and uniform bucket-level access.
- [gcloud storage cp](https://cloud.google.com/sdk/gcloud/reference/storage/cp) - Documents upload metadata flags and generation precondition flags.
- [Uniform bucket-level access](https://cloud.google.com/storage/docs/uniform-bucket-level-access) - Explains IAM-only bucket access, disabled ACLs, migration considerations, and the 90-day disable limit.
- [Public access prevention](https://cloud.google.com/storage/docs/public-access-prevention) - Documents the enforced setting that blocks public grants on buckets and objects.
- [Signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls) - Explains signed URL behavior, temporary access, methods, headers, and expiration.
- [gcloud storage sign-url](https://cloud.google.com/sdk/gcloud/reference/storage/sign-url) - Documents signed URL CLI flags, impersonated service accounts, HTTP methods, headers, and duration limits.
- [Object Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle) - Documents lifecycle actions and conditions for deleting objects or changing storage classes.
- [Object Versioning](https://cloud.google.com/storage/docs/object-versioning) - Explains live and noncurrent object generations and restore behavior.
- [Soft delete](https://cloud.google.com/storage/docs/soft-delete) - Documents soft-deleted buckets and objects, the default seven-day policy, and restore behavior.
- [Retention policies and Bucket Lock](https://cloud.google.com/storage/docs/bucket-lock) - Documents minimum retention periods and locked retention policies.
- [Resumable uploads](https://cloud.google.com/storage/docs/resumable-uploads) - Explains upload sessions for large or interrupted object uploads.
