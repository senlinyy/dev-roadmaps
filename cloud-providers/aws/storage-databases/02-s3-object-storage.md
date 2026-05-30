---
title: "S3 Object Storage"
description: "Store uploads, exports, generated files, and static objects in S3 by understanding buckets, keys, objects, access, versioning, lifecycle rules, multipart uploads, and presigned URLs."
overview: "S3 is the AWS home for object-shaped data. This article follows receipt PDFs and export files through buckets, keys, access rules, versions, lifecycle cleanup, large uploads, and browser-safe upload paths."
tags: ["aws", "s3", "buckets", "objects"]
order: 2
id: article-cloud-providers-aws-storage-databases-s3-object-storage-buckets
aliases:
  - s3-object-storage-and-buckets
  - s3-object-storage-buckets
  - cloud-providers/aws/storage-databases/s3-object-storage-and-buckets.md
---

## Table of Contents

1. [S3 and the Object Storage Interface](#s3-and-the-object-storage-interface)
2. [Buckets as Administrative Boundaries](#buckets-as-administrative-boundaries)
3. [Keys and the Flat Namespace](#keys-and-the-flat-namespace)
4. [Securing Buckets from Public Leakage](#securing-buckets-from-public-leakage)
5. [Object Versioning](#object-versioning)
6. [Lifecycle Rules for Cost Containment](#lifecycle-rules-for-cost-containment)
7. [Parallel Multipart Uploads](#parallel-multipart-uploads)
8. [Direct Uploads via Presigned URLs](#direct-uploads-via-presigned-urls)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## S3 and the Object Storage Interface

Amazon Simple Storage Service, commonly called S3, is the default AWS implementation of the object storage shape. As established in the choosing data shapes module, decoupling durable state from stateless, ephemeral compute nodes is the foundational requirement for building resilient cloud systems. When your application must store user-uploaded files, media assets, spreadsheet exports, or database backups, you do not write them to a local filesystem directory. Instead, you delegate file persistence to S3, which operates as a massive, network-accessible object storage engine cabled directly to the regional backbone.

Traditional filesystems organize data using block partitions, directory trees, and pointer-based file paths. To read or write a file locally, an operating system must open file descriptors, acquire locks on directories, and write changes in place to physical disk sectors. S3 avoids this directory complexity entirely by presenting a flat, API-driven HTTP interface. Rather than treating files as streams of mutable disk blocks, S3 manages every file as a single, complete, and immutable unit called an **object**.

To store, retrieve, and secure files over the cloud network, S3 unifies object storage under three primary structural coordinates:

* **Buckets**: Named storage containers that act as the outer administrative, security, and billing boundaries.
* **Objects**: The immutable binary payloads themselves, representing files like receipt PDFs or images.
* **Keys**: Unique flat character strings, such as `invoices/2026/05/order-104.pdf`, used to address and locate the object.

Because S3 is a highly distributed regional service, it automatically replicates objects across multiple physical datacenter facilities within the active region. When an application container issues an API request to write or read a file, S3 resolves the path and delivers the payload over the network. This network-based delivery ensures that your files survive the termination of individual compute nodes, remaining instantly accessible to thousands of concurrent microservice instances without the bottleneck of local host storage.

## Buckets as Administrative Boundaries

Before your application can write a single file to the regional S3 API, you must provision an administrative container called a bucket. When you create a bucket, you assign it a globally unique name that is registered across the entire AWS cloud network. Because this name forms the base URL for every file address, it cannot be changed after creation and must adhere to strict DNS naming rules.

A common beginner mistake is creating a separate bucket for every application subdirectory. A better operational habit is to define buckets strictly around administrative boundaries:

* **The Ownership Boundary**: Group files by the engineering team or microservice responsible for managing them. Grouping files by ownership simplifies the application of cost-allocation tags, enables team-specific billing dashboards, and allows security teams to audit high-volume requests to pinpoint which workload generated the traffic.
* **The Environment Boundary**: Establish a complete separation between production data, staging environments, and development sandboxes by placing them in entirely separate S3 buckets. Enforcing separate buckets prevents developer test scripts, local debugging sessions, or staging pipelines from accidentally overwriting or deleting live customer files.
* **The Access Boundary**: Isolate static public assets like web images and CSS stylesheets from highly confidential internal documents like customer invoices, tax forms, or database snapshots. Segmenting files by access level allows you to keep S3 Block Public Access enabled globally on all sensitive buckets, completely eliminating the threat of accidental internet exposure.
* **The Lifecycle Boundary**: Group files that share identical lifespans and retention requirements into their own dedicated buckets. For example, temporary logs that should expire after 14 days belong in a different container than business transaction records that must be retained for seven years. This alignment allows you to write simple, bucket-wide lifecycle rules that automate transitions to cold storage without the risk of accidentally purging critical historical archives.

## Keys and the Flat Namespace

Once your S3 bucket is created, you can upload objects by assigning them a unique name called a key. A key like `receipts/2026/05/order-1042.pdf` looks exactly like a traditional folder path. In S3, however, directories do not exist. S3 is a flat key-value namespace, meaning the key is one flat string of characters, and the value is the raw binary data.

This flat structure introduces critical engineering differences from traditional filesystems:

* **Directory Deletion Overhead**: Because directories are simulated, deleting a simulated folder in the S3 console is actually a massive batch job. The system must run a prefix scan to locate every single key starting with that prefix and issue individual delete API calls. For buckets with millions of objects, this operation can take hours and incur heavy request fees.
* **Rename Penalties**: In a standard local filesystem, renaming a directory is a fast pointer update. In S3, renaming a folder requires copying every single object key to a new key name and then deleting the old key name. S3 now provides strong read-after-write consistency for object operations, but the rename pattern is still expensive because it creates many copy and delete requests, can temporarily duplicate storage, and can fail partway through a large prefix move.
* **Listing Bottlenecks**: S3 restricts list results to 1,000 objects per API call. If your code needs to search or query millions of objects dynamically, treating S3 as a queryable database index will cause your application to lag.

To build clean, performant systems, you must let S3 handle what it does best: storing and fetching raw bytes by exact key. Your application should maintain a primary index of S3 object keys inside a high-speed database like RDS or DynamoDB. When a user requests a file, your code queries the database for the exact key, and then calls S3 to retrieve the binary payload directly, bypassing simulated directory scans entirely.

## Securing Buckets from Public Leakage

Because S3 is an HTTP-based service cabled to the regional cloud network, securing access to your buckets is paramount. If you fail to configure precise permissions, you risk exposing confidential customer files to the public internet. S3 access is controlled using a double-layered security architecture:

* **IAM Workload Policies**: Define what an individual application server, container task, or developer identity is allowed to do. For example, a background billing server is granted permission to write receipts but is explicitly blocked from deleting them.
* **Bucket Policies**: Define rules attached directly to the bucket itself, governing who can call the bucket, from what network paths, and under what conditions. A robust bucket policy should explicitly deny any HTTP requests that do not utilize secure SSL/TLS connections.

To prevent accidental public exposure, AWS enforces a powerful administrative barrier: **S3 Block Public Access**. When enabled, this blockade overrides all other settings, completely blocking any attempts to apply public access control lists (ACLs) or public bucket policies. In modern cloud architecture, you should keep Block Public Access enabled globally across all buckets, bypassing it only for specific buckets built explicitly to serve static public web assets.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnforceHTTPSOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
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

The bucket policy JSON above blocks unencrypted network transit. The `Sid` (Statement ID) is a human-readable identifier for the block. The `Effect` is set to `Deny`, which takes absolute precedence over any allow rules. The `Principal` wildcard `*` targets every network caller, while the `Action` array blocks any S3 operation (`s3:*`). The `Resource` array applies this deny blockade to both the bucket itself and every key inside it. Finally, the `Condition` block evaluates `aws:SecureTransport` (the encrypted SSL/TLS state of the incoming socket connection). If the request is made over plain HTTP rather than HTTPS, the value is evaluated as `false`, triggering the `Deny` statement and immediately dropping the connection.

## Object Versioning

Securing the network path protects your files from external attackers, but it does not protect them from internal software bugs or developer mistakes. If your application code contains a bug that writes blank bytes to an existing S3 key, the old file is instantly overwritten and lost. S3 is designed to persist whatever you send it, meaning it will durably preserve your corrupted files.

To defend against destructive updates, you must enable **Object Versioning** on your bucket. When versioning is active, S3 does not replace existing bytes when a key is modified. Instead, it maintains a historical stack of objects under the same key name, assigning each copy a unique version ID.

You can audit these historical versions from the terminal using the AWS CLI `list-object-versions` tool:

```bash
$ aws s3api list-object-versions --bucket my-secure-bucket --prefix invoices/order-101.pdf
{
    "Versions": [
        {
            "ETag": "\"a1b2c3d4e5f67890abcdef1234567890\"",
            "Size": 102400,
            "StorageClass": "STANDARD",
            "Key": "invoices/order-101.pdf",
            "VersionId": "v-active-998877",
            "IsLatest": true,
            "LastModified": "2026-05-26T18:30:00Z"
        },
        {
            "ETag": "\"c1d2e3f4a5b67890abcdef1234567890\"",
            "Size": 98400,
            "StorageClass": "STANDARD",
            "Key": "invoices/order-101.pdf",
            "VersionId": "v-legacy-112233",
            "IsLatest": false,
            "LastModified": "2026-05-26T18:00:00Z"
        }
    ]
}
```

The terminal output reveals the underlying stack structure of versioned objects. Both copies share the same S3 Key, but they hold unique `VersionId` values and distinct file sizes. The `IsLatest` boolean flag designates the top of the stack. When your application requests the file without specifying a version, S3 queries this metadata and returns the standard active version (`v-active-998877`). If you delete this active version, S3 appends a lightweight delete marker as the new latest version. The file disappears from normal prefix lists, but you can recover the file simply by deleting the delete marker, returning the legacy version to the top of the stack.

## Lifecycle Rules for Cost Containment

While Object Versioning gives you a strong recovery path for overwrites and accidental deletes, it also introduces a significant billing trap. Because S3 preserves every historical version and every deleted file until lifecycle rules remove them, your storage footprint can grow continuously. If your application overwrites temporary finance exports every hour, you will quickly accumulate thousands of hidden, noncurrent versions that continuously drive up your monthly AWS storage bill.

To prevent unexpected billing growth, you must pair versioning with **S3 Lifecycle Policies**. A lifecycle policy automates the transition and expiration of objects based on prefix paths, file age, and version state. A robust cost containment strategy organizes objects into distinct operational tiers:

* **The Transition Stage**: Automatically migrate objects that are accessed infrequently, such as billing receipts or compliance reports older than 90 days, from high-performance S3 Standard storage into cheaper cold tiers like S3 Glacier Flexible Retrieval or Glacier Deep Archive. While these archive tiers charge a fraction of the S3 Standard price per gigabyte, they introduce rehydration delays (ranging from minutes to hours) and fetch fees. Therefore, this transition stage should only be applied to objects where immediate read latency is no longer a business requirement.
* **The Expiration Stage**: Configure rules to permanently purge temporary, short-lived assets that hold zero business or compliance value after a specified age. For instance, nightly database exports, temporary zip archives, and cached API responses can be scheduled to expire automatically after 14 days. S3 deletes these objects asynchronously behind the scenes, completely removing their bytes from your storage totals and ensuring they no longer contribute to your monthly billing.
* **The Noncurrent Version Stage**: Design rules to clean up historical version stacks to prevent versioning safety features from doubling your storage footprint. While you may want to retain the active version of a customer profile document indefinitely, you can set a noncurrent version rule that automatically transitions older versions to Glacier after 30 days and permanently purges them after 90 days. This ensures that you maintain an emergency safety net without accumulating endless historical clutter.

## Parallel Multipart Uploads

As your application grows, you will eventually need to handle large, multi-gigabyte files, such as raw database snapshots or massive media uploads. Sending these large files to S3 in a single HTTP PUT request is highly risky. If your application server is 99% complete with a 5GB upload and a minor network hiccup occurs, the entire connection is severed, forcing the transfer to restart from zero.

S3 resolves this reliability bottleneck by supporting **Multipart Uploads**. When initiated, the upload splits the large file into multiple smaller chunks (ranging from 5 megabytes up to 5 gigabytes) and streams them in parallel.

This process can be executed directly from your terminal using the AWS CLI `s3api` tool. Walking through this sequence step-by-step illustrates the underlying API lifecycle:

```bash
$ aws s3api create-multipart-upload --bucket my-app-uploads --key video.mp4
{
    "UploadId": "mpu-xyz-987654321",
    "Key": "video.mp4",
    "Bucket": "my-app-uploads"
}

$ aws s3api upload-part --bucket my-app-uploads --key video.mp4 --upload-id mpu-xyz-987654321 --part-number 1 --body part1.mp4
{
    "ETag": "\"1b2c3d4e5f67890abcdef1234567890ab\""
}

$ aws s3api upload-part --bucket my-app-uploads --key video.mp4 --upload-id mpu-xyz-987654321 --part-number 2 --body part2.mp4
{
    "ETag": "\"a1b2c3d4e5f67890abcdef1234567890ab\""
}

$ aws s3api complete-multipart-upload --bucket my-app-uploads --key video.mp4 --upload-id mpu-xyz-987654321 --multipart-upload '{"Parts":[{"ETag":"\"1b2c3d4e5f67890abcdef1234567890ab\"","PartNumber":1},{"ETag":"\"a1b2c3d4e5f67890abcdef1234567890ab\"","PartNumber":2}]}'
{
    "Location": "https://my-app-uploads.s3.amazonaws.com/video.mp4",
    "Bucket": "my-app-uploads",
    "Key": "video.mp4",
    "ETag": "\"c1d2e3f4a5b67890abcdef1234567890ab-2\""
}
```

The `create-multipart-upload` command registers the upload with S3 and returns a unique `UploadId` that acts as the transaction identifier. Next, you call `upload-part` for each chunk, specifying the `UploadId`, a sequential `part-number` (which S3 uses to assemble the file in the correct order), and the local body file. S3 returns an `ETag` (a unique checksum value representing the uploaded chunk) upon successful write. Finally, the `complete-multipart-upload` command passes the list of part numbers and ETags back to S3, prompting the system to merge the chunks transactionally into a single, cohesive file within the regional network.

Operating multipart uploads introduces a critical billing trap: if an upload is initiated but never completed or aborted, the uploaded chunks remain stored in S3 staging space indefinitely, and AWS will charge you for the storage. To prevent this, always place a bucket lifecycle rule that automatically purges incomplete multipart uploads after 7 days.

## Direct Uploads via Presigned URLs

Even with parallel multipart uploads cabled, routing large user file transfers directly through your application API servers is a dangerous architectural mistake. When a user uploads a 500 megabyte file to your API server, the server must buffer those incoming bytes in system memory before writing them to S3. This memory buffering consumes valuable CPU cycles, exhausts server network bandwidth, and leaves your API servers highly vulnerable to denial-of-service memory crashes.

To protect your API servers, you must delegate secure upload permissions directly to the client's web browser using **Presigned URLs**. A presigned URL is tied to one HTTP method. A URL signed for `GET` downloads an object, while a URL signed for `PUT` uploads object bytes. For browser uploads, your API server should generate a short-lived signed `PUT` URL or a presigned POST policy.

```python
import boto3

s3 = boto3.client("s3")

upload_url = s3.generate_presigned_url(
    ClientMethod="put_object",
    Params={
        "Bucket": "my-app-uploads",
        "Key": "uploads/video.mp4",
        "ContentType": "video/mp4",
    },
    ExpiresIn=900,
    HttpMethod="PUT",
)

print(upload_url)
```

The generated URL contains cryptographic query parameters that allow temporary upload authority. The browser must send the upload with the same method and signed headers the server used when generating the URL:

| Parameter | Purpose | Example |
| --- | --- | --- |
| `X-Amz-Algorithm` | The hashing algorithm used to sign the request | `AWS4-HMAC-SHA256` |
| `X-Amz-Credential` | The access key and scope used for authentication | `AKIAIOSFODNN7EXAMPLE/20260526/us-east-1/s3/aws4_request` |
| `X-Amz-Date` | The timestamp when the signature was created | `20260526T180000Z` |
| `X-Amz-Expires` | The duration in seconds before the URL expires | `900` (15 minutes) |
| `X-Amz-SignedHeaders` | The HTTP headers that must match the request exactly | `host;content-type` |
| `X-Amz-Signature` | The cryptographic signature generated by your IAM role | `1a2b3c4d5e6f7g8h9i0j` |

To leverage this, your client browser first makes a lightweight metadata request to your API server (specifying file name, size, and content type). The API server validates user permissions and programmatically generates the presigned URL using its own secure execution role. Finally, the browser uploads the raw file bytes directly to the S3 bucket's regional HTTP endpoint using `PUT` and the signed headers. The entire heavy payload transfer completely bypasses your application server RAM, keeping your API hosts lightweight and responsive.

```mermaid
flowchart TD
    Browser["Customer Browser"] -->|1. Request upload permission| API["API Server (sg-api)"]
    API -->|2. Validate & sign S3 PUT URL| SignedURL["Signed HTTP PUT URL"]
    SignedURL -->|3. Return URL to browser| Browser
    Browser -->|4. Upload raw bytes directly| S3["S3 Bucket (direct)"]
    S3 -->|5. Fire upload success event| API
```

![S3 object path showing browser signed upload, private bucket, object key, version stack, multipart chunks, lifecycle cleanup, and Block Public Access](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-object-path.png)

*S3 is easiest to reason about as one object path with several safety rails. The API signs permission, the browser sends bytes directly, the bucket keeps object versions, multipart upload stages large files, and lifecycle rules clean up old versions or unfinished chunks.*

## Putting It All Together

Transitioning from local filesystem directories to regional object APIs secures your files against server lifecycle crashes and horizontal scaling errors:

* **S3 Decoupling**: Decouples unstructured file binaries from ephemeral compute nodes, delivering highly durable regional HTTP endpoints.
* **Flat Namespace**: Operates on flat character string keys, requiring a primary database index (RDS or DynamoDB) to coordinate fast file lookups and avoid simulated directory deletions.
* **Layered Permissions**: Secures confidential user files via IAM Workload roles, secure Bucket Policies, and global S3 Block Public Access overrides.
* **Versioning Stack**: Safeguards critical data from destructive application overwrites and accidental deletions by maintaining historical version stacks.
* **Lifecycle Automation**: Restricts billing inflation by automating object transitions to cold Glacier tiers and purging noncurrent versions.
* **Direct Egress Delegation**: Generates short-lived, cryptographically signed Presigned URLs to route heavy file streams directly from client browsers to S3, protecting server memory.

S3 is the baseline regional container for all unstructured files in AWS. By planning your keys, securing your network gates, and automating cleanup lifespans, you construct a durable file layer that scales dynamically, securely, and cost-effectively.

## What's Next

S3 is the premier home for complete, unstructured files. However, when application data consists of highly structural, relational records that require database transactions and complex tables, such as orders, line items, and customer accounts, a flat namespace will not suffice. In the next article, we will transition to managed relational databases in RDS.

![Six-tile S3 checklist covering bucket boundary, flat keys, block public access, version stack, lifecycle rules, and presigned uploads](/content-assets/articles/article-cloud-providers-aws-storage-databases-s3-object-storage-buckets/s3-checklist.png)

*Use this as the S3 checklist: choose the bucket boundary deliberately, treat keys as flat strings, keep public access blocked, enable version recovery where needed, control cost with lifecycle rules, and delegate heavy uploads with short-lived signed URLs.*

---

**References**

- [Amazon S3 user guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) - Compiles all S3 features, object limits, and durability guidelines.
- [Object key names](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html) - Explains flat character namespaces, folder simulations, and S3 prefix structures.
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) - Details the Block Public Access barrier and its priority overrides.
- [S3 Versioning concepts](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) - Focuses on version IDs, delete marker behaviors, and historical file recovery.
- [Managing object lifecycles](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html) - Outlines transition and expiration actions for current and noncurrent versions.
- [Multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) - Details parallel chunk uploads, assembly commands, and incomplete chunk retention.
- [Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) - Explains temporary credential delegation and direct client upload protocols.
