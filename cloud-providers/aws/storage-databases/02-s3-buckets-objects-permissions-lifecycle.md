---
title: "S3: Buckets, Objects, Permissions, and Lifecycle"
description: "Use S3 for object-shaped data by understanding buckets, object keys, IAM and bucket policies, presigned URLs, versioning, lifecycle rules, events, and bulk operations."
overview: "S3 stores whole objects behind a regional API. This article follows customer uploads and finance exports through bucket design, object naming, access control, lifecycle cleanup, and production operating checks."
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

1. [S3 Stores Whole Objects](#s3-stores-whole-objects)
2. [Buckets and Object Keys](#buckets-and-object-keys)
3. [Permissions, Public Access, and Encryption](#permissions-public-access-and-encryption)
4. [Application Uploads with Presigned URLs](#application-uploads-with-presigned-urls)
5. [Versioning, Lifecycle, and Retention](#versioning-lifecycle-and-retention)
6. [Events, Inventory, and Bulk Operations](#events-inventory-and-bulk-operations)
7. [Production Checklist](#production-checklist)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## S3 Stores Whole Objects
<!-- section-summary: S3 is the AWS home for durable whole-file data that applications read and write through an API. -->

Amazon S3 stores **objects**. An object is a file-like value plus metadata, addressed by a bucket name and an object key. The object can be a product photo, a receipt PDF, a compressed log archive, a model artifact, a backup export, or a CSV report. Your application calls the S3 API to upload, download, copy, tag, list, and delete those objects.

Back in the Maple Market example, product photos and invoice PDFs fit S3 very naturally. The customer uploads a complete image. The invoice worker writes a complete PDF. Finance downloads a complete CSV export. The application needs durable storage, object-level access rules, and a way to serve downloads without keeping files on a web server's local disk.

S3 sits behind an HTTP API, so the application does not mount it like a normal disk. A service usually writes an object with `PutObject`, reads it with `GetObject`, lists a prefix with `ListBucket`, and lets S3 handle the storage fleet behind that API. That API boundary is useful because many workers, web servers, and batch jobs can reach the same object store without sharing a host filesystem.

The main pieces are easy to name. These names show up in IAM policies, logs, lifecycle rules, and support tickets.

| Piece | Plain meaning | Maple Market example |
|---|---|---|
| **Bucket** | Top-level container and policy boundary | `maple-prod-customer-media` |
| **Object** | The stored payload plus metadata | A product photo file |
| **Key** | The object's unique name inside the bucket | `uploads/raw/2026/06/item-8821.jpg` |
| **Metadata** | Extra facts stored with the object | `Content-Type: image/jpeg` |
| **Tags** | Key-value labels used by lifecycle, cost, and workflows | `purpose=temporary-upload` |

Those pieces lead naturally into bucket and key design. A good bucket and key structure makes every later S3 feature easier to operate.

## Buckets and Object Keys
<!-- section-summary: Buckets hold administrative policy, while keys give every object a stable address inside the bucket. -->

A **bucket** is the outer container for S3 objects. It carries settings such as encryption, versioning, access policies, lifecycle rules, event notifications, replication, and logging. In production, teams usually create separate buckets when data has different security, retention, ownership, or billing needs.

Maple Market could use one bucket for customer media and another bucket for finance exports. Customer media is written by the web application and read through short-lived download URLs. Finance exports are written by a batch job and read by finance and analytics roles. Keeping those workloads in separate buckets makes policies and lifecycle rules much easier to review.

An **object key** is the name of an object inside a bucket. S3 keys look like paths because they often contain slashes, such as `invoices/2026/06/order-1004.pdf`. Those slashes are part of the key string. They help humans group objects and help tools list objects by prefix, but S3 is still addressing an object by bucket and key.

Good key design makes operations easier. A key should carry enough structure to support listing, lifecycle rules, and incident response. For Maple Market, these keys are easier to operate than one flat pile of random names:

```markdown
uploads/raw/2026/06/13/customer-771/item-8821.jpg
uploads/processed/2026/06/13/customer-771/item-8821.webp
invoices/2026/06/order-1004.pdf
exports/sales/dt=2026-06-13/orders.csv
```

The prefix tells you the workflow. The date helps lifecycle and analytics. The customer or order identifier helps support engineers find the right object. The suffix helps browsers and processing jobs understand file type. For analytics exports, partition-like prefixes such as `dt=2026-06-13/` also help query engines scan less data later.

Bucket names need planning because general purpose bucket names are globally unique within an AWS partition and cannot be renamed. Teams usually include the company or product name, environment, data purpose, and sometimes Region. A name like `maple-prod-customer-media` is easier to own than `uploads`.

After the object has a home and a name, the next question is who can reach it. S3 access control brings IAM, resource policies, public access settings, and encryption into the same review.

## Permissions, Public Access, and Encryption
<!-- section-summary: S3 access comes from IAM, bucket policies, public access settings, encryption settings, and sometimes KMS key policy. -->

S3 permissions use the same IAM policy language as the rest of AWS, but S3 has a few details that trip up beginners. A caller usually needs permissions for both the bucket and the objects inside the bucket. Listing a bucket is an action on the bucket ARN. Reading an object is an action on the object ARN with `/*` at the end.

Here is a scoped policy for Maple Market's invoice worker. It can list only the invoice prefix and write or read invoice objects. Notice that listing uses the bucket ARN, while object reads and writes use the object ARN pattern:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::maple-prod-finance-exports",
      "Condition": {
        "StringLike": {
          "s3:prefix": "invoices/*"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::maple-prod-finance-exports/invoices/*"
    }
  ]
}
```

That policy is an **identity-based policy** because it attaches to the application role. A **bucket policy** attaches to the bucket itself and controls who can use the bucket from the resource side. In real systems, teams often use both. IAM roles grant the application what it needs, and bucket policies add resource-side controls such as requiring TLS, limiting cross-account access, or allowing a specific partner account.

S3 **Block Public Access** is a major safety layer. It can block public ACLs and public bucket policies at account or bucket scope. New S3 buckets also use Object Ownership settings that disable ACLs by default in common workflows, which pushes teams toward IAM and bucket policies instead of object-level ACL habits. For beginner production work, that is a healthy default: keep Block Public Access on unless a reviewed public-hosting design explicitly requires otherwise.

Encryption also belongs in the access conversation. S3 now applies server-side encryption by default for new objects, and many production teams still choose an explicit encryption setting so the design is visible in infrastructure code. If the bucket uses AWS KMS keys, the caller needs both S3 permissions and KMS permissions for actions such as encrypting, decrypting, and generating data keys. An `AccessDenied` on an encrypted object can come from S3 policy, bucket policy, KMS key policy, or a missing KMS grant.

With permissions in place, Maple Market can let the browser upload safely without handing AWS credentials to customers. The application stays in charge of authorization while S3 handles the file transfer.

## Application Uploads with Presigned URLs
<!-- section-summary: Presigned URLs let an application delegate one temporary S3 upload or download without exposing AWS credentials. -->

A common S3 production pattern is **direct browser upload**. The browser sends a file to S3 instead of streaming the whole file through the application server. This saves application CPU, memory, bandwidth, and timeout trouble. The application still controls the object key, content type, size policy, and expiration window.

The usual flow has four steps. First, the customer chooses a product image in the Maple Market web app. Second, the web app calls Maple Market's API and asks for an upload slot. Third, the API checks that the customer is allowed to upload, chooses a key such as `uploads/raw/2026/06/13/customer-771/item-8821.jpg`, and creates a short-lived **presigned URL**. Fourth, the browser uploads the file directly to S3 with that URL.

A presigned URL is a temporary signed request. It carries the permissions of the IAM principal that generated it, within the specific operation, key, and expiration time used during signing. The customer never receives AWS access keys. They receive one time-limited URL for one S3 operation.

Here is a simplified Node-style example. The production version would also validate file size, customer ownership, and content type before returning the URL.

```js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: "us-east-1" });

export async function createUploadUrl({ customerId, itemId, contentType }) {
  const key = `uploads/raw/2026/06/13/${customerId}/${itemId}.jpg`;
  const command = new PutObjectCommand({
    Bucket: "maple-prod-customer-media",
    Key: key,
    ContentType: contentType,
    Tagging: "purpose=temporary-upload"
  });

  return {
    key,
    url: await getSignedUrl(s3, command, { expiresIn: 300 })
  };
}
```

The important production work happens around this small function. The API should validate customer identity before creating the URL. It should choose the key itself instead of trusting the browser to choose any path. It should restrict content types and sizes in the application flow. It should record the expected upload in a database so a later worker can process the object and mark the upload complete.

After upload, S3 can trigger an event notification. Maple Market might send an object-created event to EventBridge, SQS, or Lambda so an image worker can resize the photo, write the processed image to `uploads/processed/`, and update the product record in the database.

Now the object path exists. The next question is how long it should stay in each state.

## Versioning, Lifecycle, and Retention
<!-- section-summary: Versioning and lifecycle rules control how S3 keeps old copies, cleans temporary objects, and moves colder data to cheaper storage classes. -->

S3 **Versioning** keeps multiple versions of an object under the same key. When a new object is written to the same key, S3 keeps the old version with its own version ID. When a delete happens in a versioned bucket, S3 can create a delete marker instead of immediately erasing every historical version. This gives teams a recovery path for accidental overwrites and deletes.

Versioning helps Maple Market with invoices and processed customer files. If a bug overwrites `invoices/2026/06/order-1004.pdf`, the team can recover the previous version. Versioning also needs cost and retention planning because old versions continue to occupy storage until lifecycle rules remove or transition them.

S3 **Lifecycle** rules apply actions to objects over time. A rule can transition objects to another storage class, expire current versions, delete noncurrent versions, or clean up incomplete multipart uploads. The rule can match prefixes and tags, which is why key and tag design matter.

Here is a lifecycle configuration for temporary raw uploads. It expires abandoned raw uploads, keeps processed files longer, and cleans incomplete multipart upload parts. The exact days should come from product support, compliance, and cost requirements:

```json
{
  "Rules": [
    {
      "ID": "ExpireTemporaryRawUploads",
      "Status": "Enabled",
      "Filter": {
        "And": {
          "Prefix": "uploads/raw/",
          "Tags": [
            {
              "Key": "purpose",
              "Value": "temporary-upload"
            }
          ]
        }
      },
      "Expiration": {
        "Days": 7
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 2
      }
    },
    {
      "ID": "TransitionOldInvoices",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "invoices/"
      },
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "STANDARD_IA"
        }
      ],
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 365
      }
    }
  ]
}
```

Retention is a separate conversation from ordinary lifecycle cleanup. If a compliance process requires write-once protection, S3 Object Lock can place retention controls or legal holds on object versions. That should be planned carefully because compliance-mode retention can prevent deletion until the retention date passes. For normal application cleanup, lifecycle rules are usually the right tool. For regulated immutability, Object Lock needs a reviewed bucket design.

S3 gives you the tools to keep files, recover old versions, and reduce storage cost. The operating habit is to write those decisions down per prefix instead of letting every object live forever by accident.

## Events, Inventory, and Bulk Operations
<!-- section-summary: S3 can start workflows when objects change and can handle large object management jobs without custom scripts scanning every key. -->

Once objects accumulate, the next production need is workflow automation. S3 **event notifications** can publish events when objects are created, deleted, restored, or changed in other supported ways. Maple Market can route new raw uploads to an image processor, new finance exports to a data catalog job, and deleted sensitive files to an audit workflow.

For large buckets, teams also need visibility. S3 **Inventory** can produce scheduled reports about objects and metadata in a bucket. This is useful when you need to answer questions like "which objects are missing encryption metadata," "which old objects are still in Standard storage," or "which prefixes are growing fastest." Inventory is much safer than writing a one-off script that lists a massive bucket from a laptop during business hours.

S3 **Batch Operations** runs large jobs across object lists. The job can copy objects, replace tags, invoke Lambda, restore archive objects, or perform other supported operations across very large object sets. For example, Maple Market could use Batch Operations to tag every old invoice object with `data-class=finance` based on an inventory manifest, then apply lifecycle rules to that tag.

Replication is another bulk-adjacent tool. S3 replication can copy new objects asynchronously to another bucket, account, or Region. It is useful for data locality, compliance copies, and account separation. Existing objects need a different plan, such as Batch Replication or a migration job. The key point is that replication is a policy-driven data path, so it needs monitoring, permissions, KMS planning, and failure visibility.

S3 can look simple on day one and very large by month twelve. Events, Inventory, Batch Operations, and replication keep object operations visible and repeatable as the bucket grows.

## Production Checklist
<!-- section-summary: A small checklist catches most S3 design mistakes before files start piling up. -->

Before Maple Market ships a new S3-backed feature, the team should review the bucket as an operated resource, not just a place where files land. The checklist should be short enough to use during normal feature work.

| Area | Production check |
|---|---|
| Bucket ownership | Owner team, environment, data class, and cost tags are present |
| Key design | Prefixes support support lookup, lifecycle, analytics, and incident response |
| Public access | Block Public Access stays enabled unless a reviewed public design exists |
| IAM | Application roles have only required bucket and object actions |
| Bucket policy | Resource policy enforces required conditions such as TLS or account boundaries |
| Encryption | Default encryption is visible, and KMS permissions are tested if KMS is used |
| Upload path | Presigned URLs are short-lived, scoped, and generated after app authorization |
| Lifecycle | Temporary objects, noncurrent versions, archive transitions, and incomplete uploads have rules |
| Recovery | Versioning or another recovery path exists for important prefixes |
| Observability | CloudTrail, S3 server access logs or access patterns, Inventory, metrics, and event failures are reviewable |

One useful test is a full upload drill in a development account. Upload a file, verify the object key and tags, read it through the application path, trigger the processing event, check the IAM role used in CloudTrail, and confirm the lifecycle rule matches the prefix or tag. That small drill catches wrong prefixes, missing KMS permissions, broken event destinations, and accidental public exposure before production data arrives.

## Putting It All Together
<!-- section-summary: S3 works well when object naming, access, lifecycle, and automation are designed together. -->

Maple Market uses S3 for object-shaped data: product photos, invoice PDFs, exports, logs, and archives. The team creates separate buckets when ownership or access rules differ. It names objects with prefixes that support operations. It gives applications scoped IAM policies. It keeps Block Public Access on for private buckets. It uses presigned URLs so browsers can upload directly without AWS credentials. It enables versioning where recovery matters and lifecycle rules where temporary and older objects need cleanup.

That is the S3 pattern. The bucket is not just a folder. It is a policy boundary, lifecycle boundary, event source, recovery surface, and cost surface. Once those pieces are designed together, S3 gives the application a durable object API that can grow far beyond one server's disk.

## What's Next
<!-- section-summary: The next article moves from object APIs to storage that appears as disks and filesystems inside compute. -->

S3 is great for whole objects. Some workloads still need a mounted disk or shared filesystem because the software expects normal operating system file paths. The next article covers EBS, EFS, and FSx, which handle those compute-attached and shared-filesystem cases.

---

**References**

- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) - Defines S3 objects, buckets, keys, bucket policies, and storage behavior.
- [Object key names](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html) - Explains S3 key naming and prefix-like organization.
- [Object Ownership and disabling ACLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html) - Documents bucket-owner-enforced ownership and ACL-disabled bucket behavior.
- [Policies and permissions in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html) - Explains bucket policies, user policies, actions, resources, conditions, and principals.
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) - Documents the account-level and bucket-level public access protection settings.
- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) - Explains temporary signed S3 download and upload URLs.
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) - Covers version IDs, overwrite behavior, delete markers, and recovery behavior.
- [Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html) - Documents transition and expiration lifecycle actions.
- [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) - Explains multipart upload behavior and incomplete upload cleanup concerns.
- [S3 Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html) - Describes fully managed bulk operations across large object sets.
- [Replicating objects within and across Regions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html) - Documents asynchronous S3 object replication.
