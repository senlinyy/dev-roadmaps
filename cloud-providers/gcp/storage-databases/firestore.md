---
title: "Firestore"
description: "Use Firestore for app-friendly document data by designing paths, queries, indexes, transactions, security, backups, and verification commands around real access patterns."
overview: "Firestore can feel natural because documents look like application objects, but production success comes from planned paths, planned queries, explicit indexes, careful transactions, and clear operating checks. This article follows checkout drafts from schema design to gcloud and Terraform."
tags: ["gcp", "firestore", "documents", "nosql"]
order: 4
id: article-cloud-providers-gcp-storage-databases-firestore-document-data-models
aliases:
  - firestore-and-document-data-models
  - firestore-document-data-models
  - cloud-providers/gcp/storage-databases/firestore-and-document-data-models.md
---

## Table of Contents

1. [Why Checkout Drafts Fit Firestore](#why-checkout-drafts-fit-firestore)
2. [Documents, Collections, and Paths](#documents-collections-and-paths)
3. [Design Queries Before Documents Grow](#design-queries-before-documents-grow)
4. [Indexes as Production Configuration](#indexes-as-production-configuration)
5. [Transactions, Batched Writes, and Idempotent Work](#transactions-batched-writes-and-idempotent-work)
6. [Security Rules, IAM, and Backend Access](#security-rules-iam-and-backend-access)
7. [Hotspots, Limits, and Data Shape Fixes](#hotspots-limits-and-data-shape-fixes)
8. [Backups, PITR, TTL, and Export Habits](#backups-pitr-ttl-and-export-habits)
9. [gcloud and Terraform Baseline](#gcloud-and-terraform-baseline)
10. [Verification and Debugging Runbook](#verification-and-debugging-runbook)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## Why Checkout Drafts Fit Firestore
<!-- section-summary: Firestore fits application records that are read by path or by planned query shape, especially when each record can live as one document. -->

**Firestore** is Google Cloud's managed document database. A document database stores records as structured documents instead of rows spread across several related tables. The application reads a document by path, writes fields on that document, or queries a collection through indexes that Firestore maintains for the team.

Let's keep using the Orders product from this storage module. The checkout page lets a customer build a cart, choose delivery options, and pause before payment. That state is a **checkout draft**. It changes often, the browser wants to load it quickly, and support tools sometimes need to find drafts by user, status, or last update time. Firestore is a good candidate because the active draft can be one document with fields that match the application object.

That same product still needs Cloud SQL for completed orders and payments, because those records need relational constraints, transactions across normalized tables, and reporting-friendly structure. Firestore earns its place for the draft state, support notes, user preferences, device sessions, and other document-shaped records where the app usually knows the document path or a small set of query patterns.

The structure for this article follows the order a real team should use. First, design the document path. Then name the query shapes. After that, create indexes, write safe transactions, choose the right access control layer, and add backup and verification habits. That order matters because Firestore rewards planned access patterns.

## Documents, Collections, and Paths
<!-- section-summary: Firestore stores records as documents inside collections, and the path is part of the application contract. -->

A **document** is one addressable record. A **collection** is a container for documents. A **path** alternates collection IDs and document IDs, such as `checkoutDrafts/draft_usr_99812`. That path gives the application a direct lookup target, and direct lookups are one of the simplest and fastest Firestore patterns.

A practical checkout draft document can look like this:

```json
{
  "userId": "usr_99812",
  "status": "pending",
  "itemCount": 3,
  "currency": "USD",
  "updatedAt": "2026-06-14T14:04:12Z",
  "expiresAt": "2026-06-15T14:04:12Z",
  "items": [
    {
      "productId": "prod_8492",
      "quantity": 1,
      "unitPriceCents": 2999
    },
    {
      "productId": "prod_1038",
      "quantity": 2,
      "unitPriceCents": 1450
    }
  ]
}
```

This shape works because the draft is small, the page usually reads the whole draft, and the application updates a few fields at a time. The document contains the current state, while completed order history moves to Cloud SQL and analytics events move to BigQuery. Firestore holds the interactive app state; the other systems hold durable business records and analytical history.

The first design choice is the document ID. A path like `checkoutDrafts/draft_usr_99812` makes one active draft easy to find for one user. A path like `users/usr_99812/checkoutDrafts/draft_20260614` groups drafts below the user. A top-level collection is simpler for support queries across all users. A user subcollection can be clearer for user-owned mobile data. The better choice follows the reads the application must perform.

Subcollections help when part of the data grows independently. A draft document can hold the current cart summary, while `checkoutDrafts/draft_usr_99812/events/event_001` stores edit events or validation notes. That keeps the active draft under the document size limit and gives the application a clean way to page through history.

Here is the production habit: write the expected paths before writing application code.

```yaml
documents:
  active draft: checkoutDrafts/{draftId}
  draft events: checkoutDrafts/{draftId}/events/{eventId}
  support notes: supportCases/{caseId}/notes/{noteId}

direct reads:
  - checkoutDrafts/draft_usr_99812
  - supportCases/case_20260614_009
```

Those paths are part of the app contract. After the path contract is clear, the team can move to the query contract.

## Design Queries Before Documents Grow
<!-- section-summary: Firestore queries should come from named product screens and jobs, because every important query needs a supported index path. -->

A **query** asks Firestore for documents from a collection or collection group that match filters and ordering. In production, queries should come from actual screens, jobs, and support workflows. A query such as "find every pending draft for one user ordered by update time" is useful. A vague need such as "search drafts by anything" usually belongs in a different search or analytics system.

For the checkout product, the first query list might look like this:

| Screen or job | Query shape | Why it exists |
|---|---|---|
| Checkout page resume | Read `checkoutDrafts/{draftId}` directly | Load the user's active draft quickly |
| Support search | `userId == X` and `status == pending`, ordered by `updatedAt desc` | Help support find a stuck checkout |
| Cleanup job | `status == abandoned` and `expiresAt < now` | Delete expired drafts or mark them closed |
| Fraud review | `riskScore >= 80` ordered by `updatedAt desc` | Review high-risk drafts without scanning every record |

This table is more than documentation. It tells the team which fields need stable names, which values need predictable cardinality, and which indexes should exist before launch. If the team only creates documents and waits for errors, the first missing index may appear during a customer incident.

Firestore Standard edition uses indexes for queries. Simple single-field cases often work through automatic indexes. Multi-field filters and ordering usually need a composite index. The useful beginner rule is to treat each important query shape as configuration that belongs in the repo, just like a Cloud Run service or a Cloud SQL instance.

A Node backend query for support search can look like this:

```javascript
import { Firestore } from "@google-cloud/firestore";

const db = new Firestore();

const snapshot = await db.collection("checkoutDrafts")
  .where("userId", "==", "usr_99812")
  .where("status", "==", "pending")
  .orderBy("updatedAt", "desc")
  .limit(20)
  .get();

for (const doc of snapshot.docs) {
  console.log(doc.id, doc.get("updatedAt")?.toDate?.().toISOString());
}
```

This query has a clear business job. It filters to one user and one status, then orders by update time. The next section turns that shape into index configuration.

## Indexes as Production Configuration
<!-- section-summary: Firestore indexes are deployed infrastructure, and composite indexes should live beside the code that depends on them. -->

An **index** is a maintained lookup structure that lets Firestore answer a query without scanning every document. Firestore automatically maintains many single-field indexes, and the team creates composite indexes for planned multi-field queries. A write to a document can update document data and index entries, so indexes affect both query ability and write cost.

For the support search query, the composite index can be created with the current `gcloud` command shape:

```bash
gcloud firestore indexes composite create \
  --project=shop-prod \
  --database="(default)" \
  --collection-group=checkoutDrafts \
  --query-scope=collection \
  --field-config=field-path=userId,order=ascending \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=updatedAt,order=descending
```

The same shape in Terraform makes the index reviewable in pull requests:

```hcl
resource "google_firestore_index" "checkout_drafts_user_status_updated" {
  project     = var.project_id
  database    = "(default)"
  collection  = "checkoutDrafts"
  query_scope = "COLLECTION"

  fields {
    field_path = "userId"
    order      = "ASCENDING"
  }

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "updatedAt"
    order      = "DESCENDING"
  }
}
```

There are two practical details here. The first detail is deployment timing. Composite indexes build in the background, and a new application release that needs a new index should wait until the index is ready. Teams often apply index changes before routing traffic to the code path that depends on them.

The second detail is index hygiene. Automatic indexes on fields with values that always increase, such as timestamps, can create write pressure for workloads that write at high rates into a narrow collection. If the application never queries a field, a single-field index exemption can reduce index work. The team should make that decision intentionally and keep it with infrastructure configuration.

Index verification should be boring and repeatable:

```bash
gcloud firestore indexes composite list \
  --project=shop-prod \
  --database="(default)" \
  --filter='COLLECTION_GROUP:checkoutDrafts' \
  --format='table(name,state,queryScope)'
```

If the index state is still building, the application path should stay behind a release flag or rollout gate. After indexes support the reads, the next production concern is writes that happen at the same time.

## Transactions, Batched Writes, and Idempotent Work
<!-- section-summary: Transactions protect read-then-write decisions, while batched writes group known writes that use known paths. -->

A **transaction** is a Firestore operation that reads documents, decides what to change, and commits the writes as one consistent unit. Firestore can retry the transaction when another client changes a document that the transaction read. That retry behavior is helpful, and it also creates a rule for application code: the transaction function should only read and write Firestore data.

For checkout drafts, a transaction is useful when the API moves a draft from `pending` to `submitted`. The code needs to read the current status, reject a second submission, and write the submitted state. A simplified Node example looks like this:

```javascript
import { Firestore, FieldValue } from "@google-cloud/firestore";

const db = new Firestore();
const draftRef = db.collection("checkoutDrafts").doc("draft_usr_99812");

await db.runTransaction(async (transaction) => {
  const draft = await transaction.get(draftRef);

  if (!draft.exists) {
    throw new Error("draft missing");
  }

  if (draft.get("status") === "submitted") {
    return;
  }

  transaction.update(draftRef, {
    status: "submitted",
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
});
```

This block stays side-effect free. Keep card charges, emails, Pub/Sub publishes, and third-party provider calls outside the transaction. If Firestore retries the transaction, those external side effects would run more than once. A production checkout usually writes an outbox document or publishes after the transaction with an idempotency key so duplicate attempts can be recognized.

A **batched write** fits a different case. It groups writes for exact document paths that the application already knows. For example, a cleanup job can mark several expired draft event documents as archived if the job already knows the exact paths. A batch commits together. A transaction protects a read-then-write decision.

Concurrency mode also matters for server libraries. Firestore supports database-level concurrency modes, and server client libraries use the database's configured behavior. Mobile and web SDKs use optimistic transaction behavior. The practical lesson for backend teams stays the same: expect retries, keep transaction blocks small, avoid hot documents, and make external work idempotent.

## Security Rules, IAM, and Backend Access
<!-- section-summary: Firestore Security Rules protect Firebase client access, while backend services use IAM and service account identity. -->

Firestore has two access-control stories that beginners often mix together. **Firestore Security Rules** protect direct client access from Firebase mobile and web SDKs. **IAM** controls Google Cloud API access for backend services, administrators, CI/CD systems, and server client libraries. A production system can use both, but each one protects a different entry path.

If the browser or mobile app reads and writes Firestore directly, Security Rules become part of the application boundary. A draft rule might allow a signed-in user to read and update only their own draft:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /checkoutDrafts/{draftId} {
      allow read, update: if request.auth != null
        && resource.data.userId == request.auth.uid
        && request.resource.data.userId == resource.data.userId;
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
    }
  }
}
```

This example shows the access shape. A complete security review also needs tests, validation for fields that may change, and a clear answer for support tooling, admin jobs, and cleanup jobs. A rule that starts simple can become risky when new fields like `discountApproved` or `riskOverride` appear without matching validation.

If a Cloud Run backend owns Firestore access, the browser calls the backend and the backend uses a service account. In that design, IAM is the main cloud access layer:

```bash
gcloud projects add-iam-policy-binding shop-prod \
  --member="serviceAccount:checkout-api@shop-prod.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

The backend should still validate user identity and authorization in application code. IAM says the Cloud Run service account can call Firestore APIs. Application code still decides whether user `usr_99812` may update draft `draft_usr_99812`. That separation keeps cloud permissions narrow while preserving product-level rules.

For local development and CI, teams should avoid shared owner credentials. The cleaner pattern uses separate service accounts, least-privilege roles, and test projects or emulators. The Firestore emulator is helpful for local tests, but production transaction behavior and rules need real environment checks before launch.

## Hotspots, Limits, and Data Shape Fixes
<!-- section-summary: Firestore scales planned workloads well, but hot documents, sequential indexes, large documents, and unbounded arrays need design fixes. -->

Firestore removes a lot of server management, and it still has product contracts. The most visible contract is the document size limit. A Firestore document can hold rich nested data. Long event history, raw audit logs, and growing arrays belong in subcollections, Cloud Storage, BigQuery, or a stream.

A **hot document** is a document that many clients update at the same time. A global counter stored in one document is the classic example. Every click, checkout, or page view updates the same document, so Firestore has to coordinate all those writes against one place. The application sees higher latency, retries, and failures under pressure.

The common fix is to spread writes across documents. A distributed counter uses several shard documents. Each request updates one shard, and a reader sums the shards when it needs the count:

```yaml
counters/checkouts:
  shardCount: 20

counters/checkouts/shards/00:
  count: 194

counters/checkouts/shards/01:
  count: 221
```

Sequential indexed fields deserve the same attention. A collection that receives many new documents with a monotonically increasing indexed timestamp can push pressure into a narrow index range. Firestore best-practice guidance calls out index exemptions and sharding approaches for these cases. The team should ask one simple question for every high-write field: do we query by this field? If the answer is no, the index may be wasted work.

Document IDs also need care. IDs such as `draft_000001`, `draft_000002`, and `draft_000003` are easy to read, but sequential IDs can concentrate traffic. Random or well-distributed IDs usually fit high-write collections better. A product-facing order number can still exist as a field while the Firestore document ID stays distribution-friendly.

The practical data shape fixes are specific:

| Risk | Symptom | Better shape |
|---|---|---|
| Large draft document | Writes fail near size limit or reads carry too much data | Move history to `checkoutDrafts/{draftId}/events/{eventId}` |
| Global counter | Transaction retries and high latency | Use sharded counter documents |
| High-write sequential indexed timestamp | Write latency rises as traffic grows | Exempt unused timestamp indexes or shard the query pattern |
| Unplanned support search | Missing index errors in production | Define the query and composite index before release |
| Analytics from Firestore queries | Expensive reads and slow reports | Export events to BigQuery |

These fixes keep Firestore focused on app state. Recovery and retention controls keep that app state safe.

## Backups, PITR, TTL, and Export Habits
<!-- section-summary: Firestore recovery needs planned backups, point-in-time recovery where required, TTL for expired data, and restore practice. -->

Production Firestore data needs a recovery plan. **Backups** create restorable copies on a schedule. **Point-in-time recovery**, usually shortened to **PITR**, lets the team recover from certain accidental writes or deletes within the configured recovery window. **TTL policies** delete expired documents based on a timestamp field. These controls solve different problems, so the team should name the problem first.

For checkout drafts, TTL can clear expired drafts after the product no longer needs them. The document has an `expiresAt` field, and the TTL policy removes old draft documents. That helps with cost, privacy, and operational clutter. TTL is a cleanup control, so teams should design it around data retention requirements rather than using it as the only recovery mechanism.

Backups and PITR protect against mistakes such as a bad cleanup job, accidental deletes, or a release that overwrites fields incorrectly. The recovery runbook should include where to restore, who approves the restore, how to compare restored records with production, and how to replay or repair data safely. A restore into a separate database or project is often safer for investigation than immediately writing over production.

Basic operational checks look like this:

```bash
gcloud firestore databases describe \
  --project=shop-prod \
  --database="(default)" \
  --format='yaml(name,locationId,type,deleteProtectionState,pointInTimeRecoveryEnablement)'

gcloud firestore backups schedules list \
  --project=shop-prod \
  --database="(default)" \
  --format='table(name,retention,dailyRecurrence)'
```

Some teams also export selected collections to Cloud Storage for migration or offline review. Exports are useful for movement and inspection. A tested restore plan is still the recovery control the team needs during a bad write or accidental delete.

## gcloud and Terraform Baseline
<!-- section-summary: A production Firestore baseline creates the database, protects deletion, declares indexes, grants backend IAM, and verifies the deployed state. -->

A small production baseline should create the database in the intended location, protect it from accidental deletion, declare important indexes, and grant backend access through a service account. The exact location choice depends on latency, availability, data residency, and company policy. The important habit is that the choice is reviewed before the first production data lands.

Here is a `gcloud` shape for a native-mode database with delete protection and PITR enabled:

```bash
gcloud services enable firestore.googleapis.com \
  --project=shop-prod

gcloud firestore databases create \
  --project=shop-prod \
  --location=nam5 \
  --delete-protection \
  --enable-pitr
```

Here is the same kind of baseline in Terraform:

```hcl
resource "google_project_service" "firestore" {
  project = var.project_id
  service = "firestore.googleapis.com"
}

resource "google_firestore_database" "default" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = "nam5"
  type                              = "FIRESTORE_NATIVE"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"

  depends_on = [google_project_service.firestore]
}

resource "google_project_iam_member" "checkout_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:checkout-api@${var.project_id}.iam.gserviceaccount.com"
}
```

Provider versions can add fields over time, so teams should pin and review the Google provider version in the infrastructure repo. The intent is stable even when exact provider support changes: database location, native mode, deletion protection, recovery settings, index resources, and least-privilege service account access should be visible in code review.

For index rollout, the release sequence is practical:

1. Apply the database and index Terraform changes.
2. Verify the new composite index reaches `READY`.
3. Deploy application code that uses the new query.
4. Watch logs for missing-index errors and transaction contention.
5. Keep rollback ready if query volume or write latency changes.

The next section gives the on-call version of those checks.

## Verification and Debugging Runbook
<!-- section-summary: Firestore debugging works best when the team separates database state, index state, IAM, rules, query shape, contention, and recovery evidence. -->

When Firestore breaks, the symptom often sounds vague: the app cannot save a draft, support search fails, or checkout feels slow. A good runbook turns that into layers.

Start with database state. Confirm the project, database ID, location, PITR setting, and deletion protection. Many teams now use more than one database in a project, so the database ID in the client configuration matters. A service accidentally pointed at `(default)` in staging while production uses a named database will produce confusing evidence.

```bash
gcloud firestore databases list \
  --project=shop-prod \
  --format='table(name,locationId,type)'

gcloud firestore databases describe \
  --project=shop-prod \
  --database="(default)" \
  --format=json
```

Then check indexes. Missing composite indexes usually show up as explicit errors from the client library. The error often includes a direct creation link, but production teams should still add the index through reviewed infrastructure. During an incident, list the index state and confirm the query shape matches the deployed index.

```bash
gcloud firestore indexes composite list \
  --project=shop-prod \
  --database="(default)" \
  --filter='COLLECTION_GROUP:checkoutDrafts' \
  --format='table(name,state,queryScope)'
```

Then check access. A backend access failure should show the service account and permission problem. Verify the Cloud Run service account, IAM role, and any deny policy or organization guardrail. If the browser talks directly to Firestore, test Security Rules with a realistic authenticated user and a realistic document payload.

Then check query and write behavior. A query that returns too many documents can create latency and read cost. A write path that updates one shared document can create contention. Logs should include operation names such as `loadDraft`, `submitDraft`, and `supportSearch`, plus error codes for missing index, permission denied, transaction aborted, and deadline exceeded.

Finally, check recovery evidence. If a bad deploy changed data, identify the time window, affected collection paths, backup schedule, PITR state, and restore target. The safest first recovery action is often restoring or cloning into a separate environment for comparison before changing production data.

Here is the compact incident checklist:

| Layer | Evidence command or check | What it answers |
|---|---|---|
| Database | `gcloud firestore databases describe` | Which database and recovery settings are active |
| Indexes | `gcloud firestore indexes composite list` | Whether planned query indexes are ready |
| Backend IAM | Cloud Run service account plus IAM policy | Whether the runtime may call Firestore APIs |
| Client rules | Security Rules tests | Whether browser and mobile clients can access only allowed documents |
| Query shape | Application logs and missing-index errors | Whether the query matches the planned index |
| Contention | Transaction retry logs and latency metrics | Whether one document or narrow key range is too hot |
| Recovery | Backup/PITR state and restore test | Whether the team can repair bad writes |

This runbook keeps Firestore practical. The team treats the document database as layers: configuration, indexes, access, code shape, and recovery.

## Putting It All Together
<!-- section-summary: Firestore works best when path design, query design, index configuration, safe writes, access control, and recovery are planned together. -->

Firestore fits the checkout draft because the application has a small, document-shaped record that users read and update during an interactive flow. The draft lives at a predictable path, support queries use declared fields, composite indexes live in infrastructure, and transactions protect state changes such as `pending` to `submitted`.

The production design also keeps boundaries clear. Security Rules protect direct Firebase clients when they exist. IAM protects backend service accounts. Large histories move to subcollections or analytical systems. Hot counters spread across shard documents. Backups, PITR, TTL, and restore drills turn the data model into something the team can operate after a mistake.

The final beginner checkpoint is this: **Firestore combines path design, query design, index configuration, safe write design, and recovery design in one service**.

## What's Next
<!-- section-summary: The next article moves from document-shaped app state to analytical event data in BigQuery. -->

Checkout drafts are active application state. After checkout completes, the business also wants questions such as "which campaigns convert best?", "which regions have payment failures?", and "how did order volume change over six months?" Those questions scan many records and belong in an analytics warehouse.

The next article moves to BigQuery. We will keep the Orders product and follow checkout events into datasets, partitioned tables, clustering, cost controls, views, IAM, and recovery habits.

---

**References**

- [Firestore overview](https://cloud.google.com/firestore/docs/overview) - Defines Firestore as a scalable document database and explains its app development use cases.
- [Firestore data model](https://cloud.google.com/firestore/docs/data-model) - Documents collections, documents, subcollections, and path structure.
- [Create and manage Firestore databases](https://docs.cloud.google.com/firestore/native/docs/manage-databases) - Covers database creation, database IDs, locations, delete protection, PITR, cloning, and deletion.
- [gcloud firestore databases create](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/create) - Shows current CLI flags for native-mode database creation, delete protection, PITR, tags, and CMEK.
- [gcloud firestore indexes composite create](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/indexes/composite/create) - Documents the current composite index creation command and `--field-config` shape.
- [Firestore Standard edition index overview](https://docs.cloud.google.com/firestore/native/docs/standard-index-overview) - Explains automatic indexes, manual indexes, and index-backed query behavior.
- [Firestore transactions and batched writes](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions) - Explains transaction retries, read/write ordering, and batched write behavior.
- [Firestore transaction contention](https://docs.cloud.google.com/firestore/native/docs/transaction-data-contention) - Covers concurrency modes, locks, retries, and contention behavior.
- [Firestore best practices](https://docs.cloud.google.com/firestore/native/docs/best-practices) - Documents hotspot avoidance, index fanout, and workload-dependent write behavior.
- [Firestore quotas and limits](https://docs.cloud.google.com/firestore/quotas) - Lists document, index, request, and database limits.
- [Firestore backups](https://docs.cloud.google.com/firestore/native/docs/backups) - Documents scheduled backups, retention, restore workflows, and backup operations.
- [Firestore TTL policies](https://docs.cloud.google.com/firestore/native/docs/ttl) - Explains document expiration with TTL fields and operational behavior.
