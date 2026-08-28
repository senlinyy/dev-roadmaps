---
title: "S3: Buckets, Objects, Permissions, and Lifecycle"
description: "Understand S3 from its bucket-key-object model through key design, consistency, permissions, presigned requests, versioning, lifecycle, multipart uploads, events, and bulk operations."
overview: "S3 gives durable names to object bytes at enormous scale. This article derives its application, security, recovery, retention, and event-driven behavior from that object-addressing model."
tags: ["aws", "s3", "buckets", "objects", "lifecycle"]
order: 2
id: article-cloud-providers-aws-storage-databases-s3-object-storage-buckets
aliases:
  - s3-object-storage-and-buckets
  - s3-object-storage-buckets
  - s3-buckets-objects-permissions-and-lifecycle
  - cloud-providers/aws/storage-databases/s3-object-storage-and-buckets.md
  - cloud-providers/aws/storage-databases/s3-buckets-objects-permissions-and-lifecycle.md
---

## Table of Contents

1. [What Is the S3 Object Model?](#what-is-the-s3-object-model)
2. [How Does S3 Differ from a File or Database Record?](#how-does-s3-differ-from-a-file-or-database-record)
3. [How Should an Application Combine S3 and a Database?](#how-should-an-application-combine-s3-and-a-database)
4. [How Do Presigned Uploads Work?](#how-do-presigned-uploads-work)
5. [How Do Versioning and Delete Markers Work?](#how-do-versioning-and-delete-markers-work)
6. [How Should Large Objects Be Uploaded?](#how-should-large-objects-be-uploaded)
7. [How Do S3 Events and Batch Operations Differ?](#how-do-s3-events-and-batch-operations-differ)
8. [What Should You Review Before Production?](#what-should-you-review-before-production)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

At its core, **Amazon S3** solves a simple problem: give some bytes a durable name, store them remotely, and retrieve them later at enormous scale.

A relational database answers a different need: store structured facts and query, relate, update, constrain, and transact over them. A filesystem answers another: arrange files in directories and expose filesystem operations. S3 is object storage.

For a traditional general-purpose S3 bucket, imagine a distributed map:

```text
(bucket, key, optional version ID) → object
```

The object is more than its payload:

```text
object
├── bytes
├── key
├── metadata
├── tags
├── storage class
├── encryption information
├── checksum information
└── version ID, when applicable
```

For example, bucket `my-app-files` and key `users/42/avatar.jpg` identify JPEG bytes plus their object information. The bucket is the high-level administrative boundary. The key is the name inside that bucket. Together with an optional version ID, they identify a particular object value.

Keep these questions in view as you work through the lesson:

1. **What Is the S3 Object Model?**
2. **How Does S3 Differ from a File or Database Record?**
3. **How Should an Application Combine S3 and a Database?**
4. **How Do Presigned Uploads Work?**
5. **How Do Versioning and Delete Markers Work?**
6. **How Should Large Objects Be Uploaded?**
7. **How Do S3 Events and Batch Operations Differ?**
8. **What Should You Review Before Production?**

## What Is the S3 Object Model?
<!-- section-summary: S3 maps a bucket, key, and optional version ID to a complete object containing bytes and descriptive information. -->

S3's bucket-and-key model is more useful than calling S3 a remote disk because its natural operations are object operations:

```text
PUT    bucket + key + complete bytes
GET    bucket + key
HEAD   bucket + key
DELETE bucket + key
LIST   bucket + prefix
```

Object storage trades many database and filesystem operations for very large scale, high durability, throughput, and object-oriented storage economics. It fits photos, videos, PDFs, ZIP files, backups, logs, datasets, assets, archives, and many other whole blobs.

It does not natively expose relational joins, a transaction updating 17 objects, or normal in-place edits to arbitrary byte ranges. Those are clues that another data abstraction may own part of the problem.

### How Do Buckets, Keys, and Prefixes Work?
<!-- section-summary: Buckets define administrative configuration, while keys form a flat namespace that applications organize through prefix conventions. -->

Break apart this address:

```text
s3://acme-production/users/123/invoices/2026-08.pdf
```

The bucket is `acme-production`. The key is `users/123/invoices/2026-08.pdf`. The object is the PDF bytes and associated information stored at that key.

A bucket is primarily an **administrative boundary**, not a folder. Permissions, versioning, lifecycle rules, event notifications, encryption defaults, replication, and logging can be configured around buckets. A production design may use buckets such as `acme-prod-assets`, `acme-prod-logs`, and `acme-prod-backups`, each containing enormous numbers of objects. Creating one bucket per user is usually not the natural organizational model.

The key is the object identifier inside the bucket. In a general-purpose S3 bucket, `/` in a key does not create a physical directory tree. The namespace is fundamentally flat. Consoles and tools interpret shared key prefixes as folders for navigation.

```text
users/123/avatar.jpg
```

is one key string. `users/123/` is a prefix shared by keys such as:

```text
users/123/avatar.jpg
users/123/resume.pdf
users/123/photos/1.jpg
```

Key design affects more than appearance. Listing can select a prefix. Policies can limit resources under a prefix. Lifecycle rules can expire `tmp/`. Event filters can react only to `incoming/images/`. An upload namespace such as `uploads/{userId}/{generatedId}` makes those controls easier to express.

Treat keys as an application namespace. Use predictable prefixes for operational groups, but generate trusted object identifiers when user-supplied filenames can collide or attempt to escape the intended naming scheme.

The object can also contain standard metadata such as `Content-Type`, custom metadata such as `uploaded-by=user-42`, and tags such as `type=avatar` or `environment=production`. Policies and lifecycle rules can work with prefixes or tags without understanding that the payload is a photograph.

![The object path view shows how bucket name, key prefix, object metadata, versioning, and encryption describe one uploaded file](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-object-path.png)

*Slash-separated names provide useful prefixes, but the object is still addressed by one complete key string.*

## How Does S3 Differ from a File or Database Record?
<!-- section-summary: S3 replaces complete object values atomically at one key but does not edit in place or provide transactions across several keys. -->

Suppose `report.csv` is 500 MB and one logical row changes. A database may update affected records or pages. A filesystem allows the application to seek and write ranges. With ordinary S3 object semantics, think in terms of a replacement object:

```text
old object → new complete value written to the same key
```

An overwrite is another PUT for that key, not an in-place edit to bytes 1,030 through 1,080. This matters for data formats and update frequency: a workload that constantly changes small independent fields may fit a database better.

S3 provides strong read-after-write consistency for object PUT and DELETE operations. An update to one key is atomic, so a reader observes the old complete object or the new complete object rather than a half-written mixture.

That atomicity does not become a multi-object transaction:

```text
PUT a.json succeeds
PUT b.json succeeds
process fails before PUT c.json

result:
a = new
b = new
c = old
```

S3 has not violated its contract; the application attempted three independent operations. If several pieces of application state must commit or roll back together, a database or explicit coordination protocol normally owns that guarantee.

The distinction is not that S3 objects cannot contain structured data. JSON, Parquet, CSV, and database backups are common. The question is whether the application mainly stores and retrieves object bytes or needs a system to query and transactionally update the internal facts.

## How Should an Application Combine S3 and a Database?
<!-- section-summary: A database stores searchable application truth and workflow state, while S3 stores the bulk object bytes referenced by that truth. -->

A common architecture gives each service the job it is good at:

```text
database
├── file_id
├── owner_id
├── original filename
├── status
└── s3_key ───────────> S3 object containing bytes
```

For a tax document, a database row can record ID `7812`, user `42`, filename `tax-return.pdf`, status `uploaded`, and key `documents/42/c6c734...pdf`. S3 stores the 12 MB PDF at that key.

The database can answer “Find all PDFs Alice uploaded last month” because it has indexed business metadata. S3 can answer “Return the exact bytes at this bucket and key.”

The default rule is:

> **Database = searchable application truth. S3 = bulk object bytes.**

This split also protects workflow meaning. A list of object keys does not necessarily tell support whether an upload belongs to a real order, passed malware scanning, was accepted by a user, or should remain under retention. Keep those business facts in a suitable database and use the key as the bridge.

### How Does S3 Authorization Work?
<!-- section-summary: Every request is evaluated through identity, action, resource, condition, policy, guardrail, ownership, endpoint, and encryption layers. -->

Every storage request asks:

```text
May this principal perform this action
on this resource under these conditions?
```

For example, may `UploadServiceRole` call `s3:PutObject` on `arn:aws:s3:::acme-files/uploads/42/photo.jpg`?

AWS begins with implicit deny. A relevant policy must allow the request, and an applicable explicit `Deny` overrides an `Allow`. The principal is commonly an IAM role, AWS service, user, or identity from another account. Applications should normally obtain temporary role credentials rather than store long-lived user keys.

An **identity policy** answers what that identity may do. A role policy can allow `s3:GetObject` only under `acme-images/incoming/*`.

A **bucket policy** is a resource-based policy answering which principals may access the bucket or objects and under what conditions. It is especially useful for cross-account or AWS service access, organization restrictions, network or IP conditions, and enforced security requirements.

Bucket-level and object-level permissions use different resource shapes:

```text
s3:ListBucket → arn:aws:s3:::my-bucket
s3:GetObject  → arn:aws:s3:::my-bucket/*
```

The `/*` is not cosmetic. `ListBucket` acts on the bucket, while `GetObject` acts on object resources.

S3 Access Control Lists are an older access mechanism that can grant per-object or bucket permissions and create complicated ownership behavior. Modern S3 defaults new buckets to **Bucket owner enforced** Object Ownership, which disables ACLs. Prefer IAM policies, bucket policies, and access points where appropriate.

Authorization is layered:

```text
request identity and credentials
   ↓
identity policy and session policy
   ↓
bucket or other resource policy
   ↓
permissions boundary
   ↓
AWS Organizations SCP or RCP
   ↓
S3 Block Public Access
   ↓
VPC endpoint policy or conditions
   ↓
KMS permissions for SSE-KMS objects
   ↓
allow or deny
```

You do not need to memorize every layer at once. Remember: default is deny, a relevant allow is required, and explicit deny wins. “The role policy says `s3:*`” does not prove that a bucket policy, organizational guardrail, endpoint policy, Block Public Access setting, object-ownership rule, or KMS key policy allows the request.

Keep Block Public Access enabled unless a reviewed requirement genuinely needs public access. Private application data should not become public merely to fix an `AccessDenied` symptom.

## How Do Presigned Uploads Work?
<!-- section-summary: A trusted identity can sign one time-limited S3 operation so an uncredentialed client transfers data directly without making the bucket public. -->

Proxying a 5 GB browser upload through an application server sends the same body through two network legs and turns the API into an expensive relay.

```text
browser ──5 GB──> API ──5 GB──> S3
```

A presigned flow keeps authorization at the application and bulk transfer at S3:

```text
1. browser asks API for permission to upload
2. API authenticates, authorizes, chooses a key, and signs a request
3. browser uploads directly to S3 with the presigned request
```

A **presigned URL** does not make the bucket public. A trusted AWS identity cryptographically signs permission for a particular S3 operation, bucket, key, and expiry in advance. The browser receives a bearer capability and does not need its own AWS credentials.

The signed request cannot grant more than the signing credentials possess. It remains usable until expiry subject to credential validity and current permissions, so treat the URL as a secret while active.

A secure upload flow should not blindly sign a client-supplied key such as `admin/private/database-backup.sql`. The server authenticates user 42, checks whether an upload is allowed, generates an unpredictable key under a controlled prefix such as `uploads/42/{uuid}.jpg`, issues a short-lived signature, and verifies or processes the result asynchronously.

A presigned PUT to an existing key can replace that object, another reason to prefer server-chosen unique keys. For browser uploads requiring conditions such as a key prefix, accepted content type, or content-length range, a signed POST policy can express those constraints.

![The presigned upload path shows how the browser can upload directly to S3 while the app controls permission and object naming](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/presigned-url-upload-path.png)

*The API delegates one upload operation; it does not delegate general bucket access or carry the object body.*

## How Do Versioning and Delete Markers Work?
<!-- section-summary: Versioning preserves complete historical variants, while an ordinary delete adds a current delete marker instead of erasing older versions. -->

Without versioning, writing `cat.jpg` value B at the same key replaces the easy path back to value A. With S3 Versioning, each write can create another complete version:

```text
cat.jpg
├── v1 → object A
└── v2 → object B, current
```

Object identity is now closer to `(bucket, key, version ID)`. S3 retains complete variants, not merely a diff between them. This improves recovery from accidental overwrite and can multiply storage consumption.

Deletion in a versioning-enabled bucket is subtle. If `report.pdf` has current v2 and older v1, an ordinary DELETE without a version ID generally adds a **delete marker**:

```text
report.pdf
├── delete marker, current
├── v2
└── v1
```

An ordinary GET behaves as if the object is absent because the delete marker is current. Older bytes still exist. Removing the delete marker can reveal an older version again.

Versioning therefore answers “Can prior complete variants continue to exist?” It does not answer how long to retain them. Without an explicit policy, `file.zip` versions 1 through 500 can keep accumulating.

### How Do Lifecycle Rules Control Retention and Cost?
<!-- section-summary: Lifecycle rules encode how current objects, old versions, and unfinished uploads transition or disappear as their value changes over time. -->

Data value changes with age. A log may be important on day 1, occasionally useful on day 30, compliance-only after a year, and worthless after the retention requirement ends. Keeping every byte in the same storage class forever wastes money.

S3 Lifecycle can apply transition and expiration actions:

```text
day 0     S3 Standard
day 30    lower-cost infrequent-access class
day 365   archive class
year 7    delete
```

Rules can select objects through prefixes, tags, or other supported filters. They should encode a business retention policy, not an arbitrary cost target that deletes needed data.

Versioned buckets have two clocks. The **current version** can transition or expire under current-object actions. Older **noncurrent versions** need their own transition and expiration configuration.

```text
invoice.pdf
├── v3 current       → archive after 365 days
├── v2 noncurrent    → permanently delete after 90 days
└── v1 noncurrent    → permanently delete after 90 days
```

Expiring a current object in a versioning-enabled bucket normally adds a delete marker. `NoncurrentVersionExpiration` permanently removes eligible older versions. An “expire after 30 days” rule therefore does not necessarily make all storage disappear after 30 days.

Lifecycle also cleans invisible leftovers. A multipart client can upload several parts and vanish before completing the object. Those unassembled parts continue consuming storage until the upload is completed or aborted. A lifecycle rule can abort incomplete multipart uploads after a chosen period.

Versioning and lifecycle belong together: versioning creates recoverable history; lifecycle defines its retention and cost boundary.

## How Should Large Objects Be Uploaded?
<!-- section-summary: Multipart upload divides a large transfer into retryable parallel parts and requires an explicit complete or abort outcome. -->

Uploading one 40 GB object in one request is fragile. If the network fails after 39 GB, a single-request strategy starts over.

**Multipart upload** divides the object:

```text
part 1 ✓
part 2 ✓
part 3 ✓
part 4 failed
part 5 ✓
```

The client retries only part 4, then calls `CompleteMultipartUpload`. S3 assembles the uploaded parts into the final object. Parts can upload concurrently, which can improve throughput. AWS recommends considering multipart upload around 100 MB and above.

The lifecycle is explicit:

```text
initiate multipart upload
       ↓
upload numbered parts
       ↓
complete to create final object
   or abort to remove parts
```

Abandoned uploads do not magically clean themselves up, so production buckets handling large objects should have an incomplete-multipart lifecycle rule and monitoring appropriate to their volume.

## How Do S3 Events and Batch Operations Differ?
<!-- section-summary: Event notifications react to recent object changes with at-least-once semantics, while Batch Operations applies managed work across large object lists. -->

Polling a bucket every second to discover a newly uploaded video is wasteful. S3 event notifications can publish object-change information into supported destinations and event-driven architectures.

```text
client PUTs incoming/video-381.mp4
       ↓
S3 emits ObjectCreated notification
       ↓
worker transcodes, creates thumbnail, updates database
```

Do not treat the notification as an exactly-once database trigger. S3 Event Notifications are designed for at-least-once delivery, can arrive out of order, and can occasionally be duplicated.

Consumers must be **idempotent**. If an upload event arrives twice, a worker that charges £5 per event can charge £10. A safer consumer identifies work by bucket, key, and version where available, records whether that object version was processed, and makes repeated attempts converge on one logical result.

```text
event for bucket/key/version
       ↓
already processed?
├── yes → return success
└── no  → process and record completion safely
```

S3 supplies notification delivery; the application supplies its transactional and idempotency semantics.

Events fit “something just happened to this object.” They do not naturally fit “change tags on 600 million existing objects.” **S3 Batch Operations** uses a manifest of selected objects, applies a supported operation at massive scale, tracks progress, and produces completion reporting.

```text
event notification → streaming reaction to changes
Batch Operations   → bulk maintenance or migration over a known list
```

A custom laptop loop listing millions of objects is usually less durable, observable, and restartable than a managed batch job designed for that scale.

### How Does a Complete S3 Application Fit Together?
<!-- section-summary: A video workflow combines database truth, presigned transfer, S3 events, idempotent processing, derivatives, and lifecycle policies. -->

Imagine a video-sharing application. The database first creates video `982` for user `42`, with status `awaiting_upload` and expected key `videos/42/982/original.mp4`. The database owns searchable state and authorization facts.

The user calls `POST /videos/982/upload`. The backend authenticates the user, confirms ownership and upload state, and signs a short-lived PUT for the server-chosen key. The browser transfers the 2 GB video directly to S3, so the API does not relay it.

An object-created notification starts an idempotent processor. It reads the original and writes:

```text
videos/42/982/720p.mp4
videos/42/982/1080p.mp4
videos/42/982/thumbnail.jpg
```

After successful processing, the database changes video `982` to `ready`. PostgreSQL or another suitable database answers what videos exist, who owns them, what state they are in, and which object keys belong to them. S3 returns the actual bytes.

Lifecycle can then encode retention:

```text
original.mp4           → archive after 90 days
processing-temp/*      → expire after 7 days
noncurrent versions    → delete after 30 days
incomplete multipart   → abort after 1 day
```

This is one coherent design, not a collection of independent S3 checkboxes. Namespace, authorization, transfer, workflow truth, duplicate-safe processing, version recovery, and retention all follow from the object model.

## What Should You Review Before Production?
<!-- section-summary: A production bucket needs deliberate namespace, security, upload, recovery, retention, event, and bulk-operation decisions. -->

Use this operating checklist:

- **Namespace:** Define what prefixes mean. Prefer generated identifiers when untrusted filenames or collisions create risk.
- **Ownership and security:** Keep buckets private by default, enable Block Public Access unless reviewed otherwise, disable ACL-based access through modern Object Ownership defaults, and grant least privilege through policies.
- **Resource policy:** Distinguish bucket actions from object actions and check identity, bucket, endpoint, organization, and KMS layers during denials.
- **Uploads:** Let the server choose trusted keys and issue short-lived presigned requests instead of proxying large bodies through the API.
- **Large objects:** Use multipart upload and ensure incomplete uploads are aborted.
- **Recovery:** Decide whether accidental overwrite and deletion justify versioning, then test how to retrieve or restore a prior version.
- **Retention:** Define transitions and permanent deletion for current and noncurrent versions, temporary prefixes, and incomplete multipart parts.
- **Events:** Assume duplicate and out-of-order notification delivery; make consumers idempotent and monitor failed work.
- **Application truth:** Do not use bucket listing as a relational application database when business metadata and workflow state need queries or transactions.
- **Bulk changes:** Prefer Inventory and Batch Operations when managed bulk processing fits instead of building a fragile one-off loop.

Reduce S3 to one model before reasoning about it:

```text
(bucket, key, version?) → object bytes and metadata

policies decide who may perform object operations
presigned requests delegate one constrained operation
versioning preserves historical object identities
lifecycle controls the economics and retention of ageing objects
events turn object changes into asynchronous work
databases store structured truth surrounding the objects
```

![The operating loop connects permissions, encryption, lifecycle, events, inventory, monitoring, and restore tests for an S3 bucket](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-operating-loop.png)

*A bucket is a production data boundary whose access, retention, recovery, and workflow behavior should be designed together.*

## Check Your Answers

:::expand[What Is the S3 Object Model?]{kind="recap"}
S3 maps a bucket, key, and optional version ID to a complete object containing bytes and descriptive information.

S3 maps a bucket, key, and optional version ID to a complete object containing bytes and descriptive information such as metadata, tags, storage class, encryption, and checksums.

Bucket actions such as `ListBucket` use `arn:aws:s3:::bucket`. Object actions such as `GetObject` use object resources like `arn:aws:s3:::bucket/*`.

Buckets define administrative configuration, while keys form a flat namespace that applications organize through prefix conventions.

It is an administrative boundary for policies, versioning, lifecycle, encryption, notifications, replication, and other configuration. Object organization inside it comes from key and prefix conventions.

No. In a general-purpose bucket, the namespace is flat and the entire value is one key string. Consoles and APIs use shared prefixes and delimiters to present folder-like navigation.
:::

:::expand[How Does S3 Differ from a File or Database Record?]{kind="recap"}
S3 replaces complete object values atomically at one key but does not edit in place or provide transactions across several keys.

PUT and DELETE operations have strong read-after-write consistency, and an update to one key is atomic. A reader sees the old or new complete object, but S3 does not provide a transaction across several keys.
:::

:::expand[How Should an Application Combine S3 and a Database?]{kind="recap"}
A database stores searchable application truth and workflow state, while S3 stores the bulk object bytes referenced by that truth.

The database can query ownership, names, statuses, relationships, and workflow truth. S3 efficiently stores and returns the bulk bytes referenced by an object key in that record.

Every request is evaluated through identity, action, resource, condition, policy, guardrail, ownership, endpoint, and encryption layers.

Other layers may restrict the request, including bucket policies, explicit denies, permissions boundaries, session policies, organization guardrails, Block Public Access, VPC endpoint policies, ownership settings, and KMS key permissions.
:::

:::expand[How Do Presigned Uploads Work?]{kind="recap"}
A trusted identity can sign one time-limited S3 operation so an uncredentialed client transfers data directly without making the bucket public.

A trusted identity signs one particular request with a limited lifetime and only the capability that the signing credentials possess. The URL is a bearer secret, not a general public policy.
:::

:::expand[How Do Versioning and Delete Markers Work?]{kind="recap"}
Versioning preserves complete historical variants, while an ordinary delete adds a current delete marker instead of erasing older versions.

S3 normally adds a current delete marker. Ordinary retrieval treats the key as deleted, while older complete versions remain and can be recovered by removing the marker or selecting a version.

Lifecycle rules encode how current objects, old versions, and unfinished uploads transition or disappear as their value changes over time.

Versioning preserves complete historical variants but does not choose their retention. Lifecycle separately controls transitions and permanent expiration for current objects, noncurrent versions, and unfinished multipart uploads.
:::

:::expand[How Should Large Objects Be Uploaded?]{kind="recap"}
Multipart upload divides a large transfer into retryable parallel parts and requires an explicit complete or abort outcome.

It divides a large object into retryable parts that can transfer in parallel. A failed part can be retried without retransmitting the whole file, then the client explicitly completes or aborts the upload.
:::

:::expand[How Do S3 Events and Batch Operations Differ?]{kind="recap"}
Event notifications react to recent object changes with at-least-once semantics, while Batch Operations applies managed work across large object lists.

Notifications use at-least-once semantics and can be duplicated or out of order. Consumers must identify the logical object event so repeated attempts create one intended business effect.

Use it for managed operations over very large selected object lists, such as mass tagging or restoration. Event notifications fit streaming reactions to recent changes; custom loops are often a weaker bulk-control mechanism.

A video workflow combines database truth, presigned transfer, S3 events, idempotent processing, derivatives, and lifecycle policies.
:::

:::expand[What Should You Review Before Production?]{kind="recap"}
A production bucket needs deliberate namespace, security, upload, recovery, retention, event, and bulk-operation decisions.
:::

## References

- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [Naming Amazon S3 objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)
- [Policies and permissions in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html)
- [Bucket policies for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)
- [IAM policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [S3 POST policies](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html)
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [Deleting Amazon S3 objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjects.html)
- [Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Deleting object versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html)
- [Lifecycle and other bucket configurations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-and-other-bucket-config.html)
- [Multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)
- [S3 Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html)
