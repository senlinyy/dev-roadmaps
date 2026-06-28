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

1. [Start With One Uploaded File](#start-with-one-uploaded-file)
2. [Buckets, Keys, and Objects](#buckets-keys-and-objects)
3. [Access Control Layers](#access-control-layers)
4. [Presigned Uploads](#presigned-uploads)
5. [Versioning and Lifecycle](#versioning-and-lifecycle)
6. [Events and Large Operations](#events-and-large-operations)
7. [Operating Checklist](#operating-checklist)
8. [References](#references)

## Start With One Uploaded File
<!-- section-summary: S3 is the AWS home for durable whole-file data that applications read and write through an API. -->

Maple Market lets a customer upload a return photo. The photo is a whole file. The app stores it, reads it later, maybe scans it, and eventually expires it according to a retention policy. That is a natural fit for Amazon S3.

**Amazon S3** stores objects in buckets. An object is the file bytes plus metadata, tags, permissions, and a key. The app usually keeps business records in a database and stores the object key in that record. For example, the order row can contain `returns/2026/06/ord_123/photo-1.jpg` as the pointer to the file.

S3 works well when the app treats data as whole objects through an API. It is used for uploads, exports, logs, static assets, backups, analytics files, and partner feeds.

The app should keep business truth outside the object body. For the return photo, the order database stores the order ID, customer ID, expected object key, upload status, scan status, and retention state. S3 stores the file and object metadata. That split lets support find the file through the order record, and it lets lifecycle rules clean up objects without guessing business meaning from filenames alone.

## Buckets, Keys, and Objects
<!-- section-summary: Buckets hold administrative policy, while keys give every object a stable address inside the bucket. -->

A **bucket** is the top-level container. It has a globally unique name, a Region, bucket policy, encryption settings, versioning settings, lifecycle rules, event notifications, and public access controls.

An **object key** is the object's name inside the bucket. Keys look like paths, but S3 is an object store. Prefixes such as `returns/2026/06/` are naming conventions that help humans, applications, lifecycle rules, and analytics jobs organize objects.

A practical key plan might be:

- `returns/{year}/{month}/{order_id}/{uuid}.jpg`
- `exports/orders/{date}/orders.parquet`
- `logs/api/{year}/{month}/{day}/{hour}/part-{uuid}.json.gz`

Good keys avoid putting too much meaning in one flat name. Include enough structure for lifecycle, access review, and operations, but keep the database as the source of truth for business state.

Key design affects performance and operations too. Modern S3 automatically scales request rates across prefixes, but operational humans still need prefixes that are easy to filter, expire, inventory, and audit. A prefix such as `returns/year=2026/month=06/` can help analytics jobs and lifecycle rules. A random UUID at the end helps avoid collisions and keeps customer-supplied filenames out of the trusted key path.

The application should store the S3 key beside the business record. A small database row for a return photo might store `order_id`, `uploaded_by`, `s3_bucket`, `s3_key`, `scan_status`, and `retention_until`. The app reads the row, then calls S3 for the bytes. That makes support work easier because the order screen can show whether the file is expected, uploaded, scanned, quarantined, or expired.

```sql
insert into return_photos (
  order_id,
  s3_bucket,
  s3_key,
  scan_status
) values (
  'ord_123',
  'maple-returns-prod',
  'returns/2026/06/ord_123/photo-1.jpg',
  'waiting_for_scan'
);
```

This split is also useful during cleanup. Lifecycle rules can expire `tmp/` objects after seven days, while the application decides whether an accepted return photo still belongs to an active order. The object key is the bridge between the app workflow and the S3 object store.

![The object path view shows how bucket name, key prefix, object metadata, versioning, and encryption describe one uploaded file](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-object-path.png)

*The object path view shows how bucket name, key prefix, object metadata, versioning, and encryption describe one uploaded file.*


## Access Control Layers
<!-- section-summary: S3 access comes from IAM, bucket policies, public access settings, encryption settings, and sometimes KMS key policy. -->

S3 access usually involves several layers. The application role needs IAM permission. The bucket policy may allow or deny certain principals, VPC endpoints, TLS settings, or account paths. S3 Block Public Access settings protect against accidental public exposure. If the bucket uses AWS KMS encryption, the KMS key policy must also allow the needed use.

A small IAM policy for writes to one prefix can look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::maple-returns-prod/returns/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::maple-returns-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": "returns/*"
        }
      }
    }
  ]
}
```

Notice the two resource shapes. Bucket-level actions such as `ListBucket` use the bucket ARN. Object-level actions such as `GetObject` and `PutObject` use the object ARN with `/*`.

Production buckets often add explicit guardrails. Block Public Access should usually stay enabled. Bucket policies can require TLS with `aws:SecureTransport`, require a VPC endpoint with `aws:SourceVpce`, or restrict access to principals in an AWS Organization. If the bucket uses SSE-KMS, the KMS key policy must allow the same application role to use the key for the needed S3 operations.

A bucket policy guardrail often uses an explicit deny. This example denies requests that do not use TLS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::maple-returns-prod",
        "arn:aws:s3:::maple-returns-prod/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

`Sid` gives the statement a human-readable name for review. `Principal: "*"` makes the deny apply to any caller. `Action: "s3:*"` covers all S3 actions on the listed bucket and object ARNs. The `Bool` condition checks `aws:SecureTransport`, and the request is denied when that value is `false`. This guardrail protects the bucket even if a future identity policy accidentally grants broader access.

When KMS encryption is involved, there are two permission checks. The role needs S3 permission to read or write the object, and it also needs KMS permission such as `kms:Decrypt` or `kms:GenerateDataKey` on the key. Many `AccessDenied` incidents come from fixing one layer while the other layer still blocks the request.

## Presigned Uploads
<!-- section-summary: Presigned URLs let an application delegate one temporary S3 upload or download without exposing AWS credentials. -->

A browser can upload a return photo without receiving AWS access keys. A common pattern is a **presigned URL**. The application authenticates the customer, decides the customer may upload one file, asks AWS to sign a short-lived S3 request, and gives that URL to the browser.

The browser uploads directly to S3 using the URL. The app keeps control because it chooses the key, expiry, content type, and allowed operation. After upload, an S3 event or application callback can start scanning and processing.

A small JavaScript shape with the AWS SDK might look like this:

```js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({ region: "us-east-1" });

const command = new PutObjectCommand({
  Bucket: "maple-returns-prod",
  Key: "returns/2026/06/ord_123/photo-1.jpg",
  ContentType: "image/jpeg"
});

const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
```

Keep the expiry short and store the expected object key in the order workflow. The URL grants exactly the signed operation until it expires.

A safer flow has the server choose a key under a customer- and order-scoped prefix, record an expected upload, sign only that operation, and verify content type and size through application rules or later scanning. The browser receives a delegated upload path, while the server keeps control of the trusted final key. Presigned URLs are delegation; they still need product and security boundaries.

![The presigned upload path shows how the browser can upload directly to S3 while the app controls permission and object naming](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/presigned-url-upload-path.png)

*The presigned upload path shows how the browser can upload directly to S3 while the app controls permission and object naming.*


## Versioning and Lifecycle
<!-- section-summary: Versioning and lifecycle rules control how S3 keeps old copies, cleans temporary objects, and moves colder data to cheaper storage classes. -->

**Versioning** keeps older object versions when an object is overwritten or deleted. It helps with accidental deletes and bad uploads, but it also means old versions can add storage cost. Turn it on deliberately and pair it with lifecycle rules.

**Lifecycle rules** move or expire objects based on age, prefix, tags, or version status. Maple Market might keep return photos in S3 Standard for 30 days, transition older photos to S3 Standard-IA, and delete temporary upload objects after 7 days.

A lifecycle rule can look like this:

```json
{
  "Rules": [
    {
      "ID": "expire-temporary-uploads",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "tmp/"
      },
      "Expiration": {
        "Days": 7
      }
    }
  ]
}
```

`Rules` holds one or more lifecycle rules. `ID` gives this rule a reviewable name. `Status` turns the rule on. `Filter.Prefix` limits the rule to keys that start with `tmp/`. `Expiration.Days` tells S3 to expire matching current objects after seven days. A production rule may also include transitions to another storage class, cleanup for noncurrent versions, or cleanup for incomplete multipart uploads.

Lifecycle should match the business retention policy. Keep data that support, finance, legal, or analytics still needs, even when the objects are old.

Versioning changes delete behavior. A delete usually creates a delete marker while older versions remain. That can save the team after an accidental delete, and it can also create unexpected storage cost. Lifecycle rules should cover current objects, noncurrent versions, incomplete multipart uploads, and temporary prefixes when those paths exist.

## Events and Large Operations
<!-- section-summary: S3 can start workflows when objects change and can handle large object management jobs without custom scripts scanning every key. -->

S3 can send event notifications when objects are created or removed. A return photo upload can trigger an SQS message, Lambda function, or EventBridge rule. The next step might scan the image, generate a thumbnail, or mark the return record as ready for review.

For large object sets, avoid writing one-off scripts that list millions of keys and perform changes slowly from a laptop. S3 Inventory can produce object listings, and S3 Batch Operations can apply actions to large sets of objects. This is useful for backfills, tagging, restores, or metadata cleanup.

Operations should also include server access logs or CloudTrail data events when the audit need justifies the volume and cost. Access evidence matters when a bucket stores customer data.

A realistic processing path might be: object uploaded to `tmp/`, S3 event sends a message to SQS, a scanner reads the object, the scanner writes a clean copy to `returns/`, and the app marks the return photo ready. If scanning fails, the object stays in `quarantine/` or expires from `tmp/`. That workflow gives operations a place to retry and a place to investigate bad files.

Operations should keep the event path idempotent. S3 event delivery can retry, and a scanner may see the same object more than once. Store a scan record keyed by bucket, key, version ID when versioning is enabled, and checksum or ETag where useful. If the scanner already processed the object, return success instead of creating a duplicate support record.

When an object workflow fails, check the object first, then the event path:

```bash
aws s3api head-object \
  --bucket maple-returns-prod \
  --key returns/2026/06/ord_123/photo-1.jpg

aws sqs get-queue-attributes \
  --queue-url "$RETURN_SCAN_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

`--bucket` names the bucket, and `--key` names the object inside that bucket. `head-object` proves the object exists and shows metadata, encryption, version, and size without downloading the image. A healthy response might look like this:

```json
{
  "AcceptRanges": "bytes",
  "LastModified": "2026-06-24T10:19:04+00:00",
  "ContentLength": 482391,
  "ETag": "\"9b2cf535f27731c974343645a3985328\"",
  "VersionId": "3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrH",
  "ContentType": "image/jpeg",
  "ServerSideEncryption": "aws:kms",
  "SSEKMSKeyId": "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
  "Metadata": {
    "uploaded-by": "cust_123"
  }
}
```

`ContentLength` gives the size in bytes, `VersionId` matters when versioning is enabled, and `ServerSideEncryption` shows how the object is encrypted. If the command returns `403`, check read permission, bucket policy, endpoint policy, and KMS permission. If it returns `404`, confirm the key and whether the caller has list permission.

For the queue command, `--queue-url` selects the exact scanner queue and `--attribute-names` limits the response to the two backlog counters the operator needs. A quiet queue looks like this:

```json
{
  "Attributes": {
    "ApproximateNumberOfMessages": "0",
    "ApproximateNumberOfMessagesNotVisible": "1"
  }
}
```

`ApproximateNumberOfMessages` is waiting work. `ApproximateNumberOfMessagesNotVisible` is work currently held by consumers. If the app says "photo missing," the S3 object check and the queue check separate object storage from workflow processing.

## Operating Checklist
<!-- section-summary: A small checklist catches most S3 design mistakes before files start piling up. -->

Review these items before production:

- Bucket name, Region, owner account, and data classification are documented.
- Block Public Access is enabled unless a reviewed public website pattern needs otherwise.
- IAM policy, bucket policy, VPC endpoint policy, and KMS key policy agree.
- Object keys support lifecycle, operations, and support lookup.
- Versioning and lifecycle rules match recovery and retention needs.
- Presigned URLs use short expiry and server-chosen keys.
- Events, inventory, and batch operations are planned for processing and cleanup.

S3 stays manageable when object naming, access, lifecycle, and automation are designed together. Treat the bucket as a production data boundary with policies, recovery choices, and operating rules.

Common mistakes include allowing `s3:*` on every bucket because a first upload failed, using one bucket for unrelated data with different retention rules, turning on versioning without noncurrent-version lifecycle, and treating `AccessDenied` as only an IAM problem. S3 authorization can involve IAM, bucket policy, endpoint policy, public access settings, object ownership, and KMS key policy.

![The operating loop connects permissions, encryption, lifecycle, events, inventory, monitoring, and restore tests for an S3 bucket](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-operating-loop.png)

*The operating loop connects permissions, encryption, lifecycle, events, inventory, monitoring, and restore tests for an S3 bucket.*


## References

- [Amazon S3 documentation: What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [Amazon S3 documentation: Bucket policies](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html)
- [Amazon S3 documentation: Blocking public access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [Amazon S3 documentation: Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Amazon S3 documentation: Lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
