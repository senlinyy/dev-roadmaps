---
title: "Blob Storage"
description: "Store uploads, generated files, exports, and logs in Azure Blob Storage by understanding accounts, containers, blob names, access, tiers, lifecycle, and recovery."
overview: "Blob Storage is Azure's object store for file-like bytes. This article follows one production receipt system through storage accounts, containers, blob names, metadata, access control, SAS links, lifecycle rules, and recovery settings."
tags: ["azure", "blob-storage", "storage-account", "objects", "lifecycle"]
order: 1
id: article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage
aliases:
  - storage-accounts-and-blob-storage
  - cloud-providers/azure/storage-databases/storage-accounts-and-blob-storage.md
---

## Table of Contents

1. [What Storage Contract Does Blob Storage Provide?](#what-storage-contract-does-blob-storage-provide)
2. [How Do Containers, Names, Types, and Metadata Identify Objects?](#how-do-containers-names-types-and-metadata-identify-objects)
3. [How Does Upload and Download Work?](#how-does-upload-and-download-work)
4. [How Should Identity and Authorization Protect Blobs?](#how-should-identity-and-authorization-protect-blobs)
5. [When Should You Use SAS Tokens?](#when-should-you-use-sas-tokens)
6. [How Do Redundancy and Network Reachability Affect Access?](#how-do-redundancy-and-network-reachability-affect-access)
7. [How Do Tiers and Lifecycle Rules Control Cost?](#how-do-tiers-and-lifecycle-rules-control-cost)
8. [How Do Versioning, Soft Delete, and Retention Protect Data?](#how-do-versioning-soft-delete-and-retention-protect-data)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Blob Storage is Azure's object storage service for **unstructured data**, which usually means text or binary bytes with no table schema. Receipt PDFs, profile photos, support attachments, CSV exports, backup files, media uploads, and archived logs all fit this shape. The application reads or writes the file as one named object through an HTTP API.

The basic contract is **name to bytes**. Given an account, container, and blob name, an authorized client can store or retrieve a byte payload plus a small amount of descriptive information. Blob Storage does not interpret a PDF as an invoice or enforce that it belongs to a real customer. The application and database keep that business meaning.

That explains why object storage is not a replacement for every database or filesystem. A relational database is the natural place for rows, joins, constraints, and multi-row transactions. A mounted filesystem is useful when software expects operating-system file APIs, file locks, shared directories, or in-place updates. Blob Storage instead favors HTTP-based object operations, enormous flat namespaces, independent objects, and compute that can be replaced without losing files on one machine.

The storage decision includes both the bytes and the policies that govern their access, placement, cost, retention, and recovery.

Keep these questions in view as you work through the lesson:

1. **What Storage Contract Does Blob Storage Provide?**
2. **How Do Containers, Names, Types, and Metadata Identify Objects?**
3. **How Does Upload and Download Work?**
4. **How Should Identity and Authorization Protect Blobs?**
5. **When Should You Use SAS Tokens?**
6. **How Do Redundancy and Network Reachability Affect Access?**
7. **How Do Tiers and Lifecycle Rules Control Cost?**
8. **How Do Versioning, Soft Delete, and Retention Protect Data?**

## What Storage Contract Does Blob Storage Provide?
<!-- section-summary: Blob Storage is for durable named byte payloads, so application compute can stay replaceable and the database can keep business meaning. -->

A local filesystem also ties data to a host unless another storage service sits beneath it. If three app instances accept uploads, a file written to instance A may be invisible when the next request reaches instance B. Putting the object in Blob Storage gives every approved instance the same durable service address and removes the file from the lifecycle of one process or VM.

Let's use one production example through the whole article. The `devpolaris-orders-api` creates a receipt PDF after checkout. The order record belongs in Azure SQL Database because it has customer IDs, payment state, line items, constraints, and queries. The PDF bytes belong in Blob Storage because they are a file-like payload. The database stores the order facts and the blob name, while Blob Storage stores the PDF itself.

This split matters when the app runs on App Service, Container Apps, Functions, AKS, or virtual machines. Compute can restart, scale out, recycle, deploy a new image, or move to a different host. A receipt saved only on the local filesystem of one instance can disappear from the user path or stay hidden from the next instance. Blob Storage gives the receipt a durable service address that every approved runtime can use.

Blob Storage has three main coordinates:

| Coordinate | What it means | Example |
| --- | --- | --- |
| **Storage account** | The Azure resource that owns the endpoint, region, redundancy, network rules, encryption settings, and billing boundary | `stordersreceiptsprod` |
| **Container** | A named group of blobs inside the account | `receipts` |
| **Blob** | The object itself, including bytes, properties, metadata, and a name inside the container | `2026/05/order-417.pdf` |

That structure gives us the article path. First we choose the account boundary, then containers and names, then upload behavior, then access, then cost and recovery. The same receipt example will keep showing why each layer exists.

![Azure Blob Storage object path from order database to storage account, container, and blob URL](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/blob-object-path.png)

*The receipt path has two jobs: the database keeps the business meaning, and Blob Storage keeps the file bytes behind an account, container, and blob name.*

### Storage Accounts
<!-- section-summary: The storage account is the real operational boundary for endpoint, region, redundancy, network access, encryption, and billing. -->

A **storage account** is the Azure resource that contains Blob Storage data and exposes the storage namespace. The account name is part of the service endpoint. If the account is named `stordersreceiptsprod`, the Blob endpoint is usually `https://stordersreceiptsprod.blob.core.windows.net`.

The account name has production consequences because it must be unique across Azure, can contain only lowercase letters and numbers, and is between 3 and 24 characters long. That endpoint is a stable address in application configuration, logs, runbooks, private DNS, and monitoring. Choose names that identify the workload and environment without leaking sensitive business details.

For our receipt system, one production account might hold private customer receipt PDFs. A separate development account should hold test receipts. A separate public assets account might hold marketing images. Those boundaries give the team cleaner access reviews because a developer script pointed at development has no route to production receipts in the same account.

Many important controls live at the storage account level:

| Account decision | Why it matters in production |
| --- | --- |
| **Region** | Keeps storage close to the app and affects data residency, latency, and egress cost |
| **Redundancy** | Decides how many extra copies Azure keeps and which infrastructure failures the account can survive |
| **Network rules** | Controls whether callers can reach the public endpoint, approved virtual networks, or private endpoints |
| **Public blob access setting** | Lets the account block anonymous public container access |
| **Shared Key access setting** | Lets the account reject account-key authorization for stronger identity-based access patterns |
| **Encryption settings** | Controls platform-managed or customer-managed encryption choices |
| **Billing boundary** | Groups capacity, transactions, redundancy, data transfer, and tier costs |

So the account is more than a folder. It is the place where storage works as a production resource with security, cost, network, and recovery settings.

## How Do Containers, Names, Types, and Metadata Identify Objects?
<!-- section-summary: Containers group related objects, while blob names provide the exact lookup path inside a flat object namespace. -->

After the account exists, the next layer is the **container**. A container groups blobs inside a storage account. For the orders system, `receipts`, `exports`, and `temporary-imports` can be separate containers because they have different access and lifecycle needs. Receipts need customer download links and long retention. Exports may move to colder storage after a short active window. Temporary imports may disappear after a week.

A **blob name** is the full object name inside the container. A name like `2026/05/order-417.pdf` looks like a normal folder path, but in a standard account without hierarchical namespace, the slashes are part of one name string. Tools can list blobs by prefix, so the slash pattern still helps people and automation group objects by year, month, tenant, or purpose.

The flat namespace is part of why ordinary object storage scales well. Azure does not need to walk a chain of directory records before addressing every object; the complete blob name is the lookup key. Prefix listings create the directory-like experience for people and tools. Renaming a virtual folder is therefore not necessarily one cheap filesystem metadata change—it can require copying or renaming the objects whose names carry that prefix.

This detail changes how you design names. A prefix such as `receipts/2026/05/` can help an operator list one month of receipts. A tenant prefix such as `tenant-42/receipts/2026/05/` can help cleanup and cost review for one tenant. Those prefixes support operations, while the application database remains the business index.

The database should answer business questions. If support needs every paid order for customer `cust_91`, the app should query the order database, find the exact blob names for that customer's receipts, and then fetch those blobs. Blob listing is useful for storage operations. It is a poor way to answer product questions about customers, payments, refunds, or subscriptions.

Here is the receipt address we will use:

| Part | Value |
| --- | --- |
| Storage account | `stordersreceiptsprod` |
| Container | `receipts` |
| Blob name | `2026/05/order-417.pdf` |
| URL shape | `https://stordersreceiptsprod.blob.core.windows.net/receipts/2026/05/order-417.pdf` |

Azure also supports accounts with **hierarchical namespace** for Azure Data Lake Storage Gen2. A hierarchical namespace adds directory-style behavior that helps analytics workloads and big data tools. For a normal web application that stores receipts and support attachments, clear prefix naming in a standard Blob Storage account is often enough.

The hierarchy changes the contract in useful ways. Analytics engines often rename directories, manage permissions at directory boundaries, and scan partitioned paths such as `year=2026/month=05`. With hierarchical namespace enabled, those directories become real namespace objects rather than only shared name prefixes, so directory operations and access-control patterns can better match data-lake tools.

That choice belongs at account design time because it affects supported features, APIs, and workload behavior. A receipt application that only writes and reads complete objects by known name may gain little from the extra hierarchy. A data lake whose processing jobs depend on directory operations may gain a lot. The correct question is whether the clients need object-prefix grouping or filesystem-like directory semantics.

### Blob Types and Metadata
<!-- section-summary: Most application files use block blobs, while metadata and properties explain how clients should handle the bytes. -->

Azure Blob Storage supports several blob types. A beginner usually meets **block blobs** first. A block blob stores text or binary data and can be uploaded in blocks, then committed as one object. This is the normal fit for PDFs, images, CSV files, JSON exports, archives, and uploaded documents.

**Append blobs** are optimized for append operations. They fit scenarios where new data gets added to the end of an object, such as some logging patterns. **Page blobs** support random read and write operations over fixed-size pages and are used for Azure virtual hard disk files. If you are storing customer receipts or profile images, start with block blobs.

The difference comes from the update pattern. A block blob is assembled from a block list and normally behaves like one replaceable object. An append blob accepts new blocks at the end, which fits append-only writers but not arbitrary edits in the middle. A page blob exposes fixed-size ranges that clients can update independently, which supports virtual disk workloads. Picking the blob type from the file extension misses the point; pick it from how clients write and update the bytes.

The blob also has **properties** and **metadata**. Properties include service-understood values such as content type, content length, ETag, last modified time, and access tier. Metadata is a small set of custom key-value pairs you store with the blob. For `order-417.pdf`, the app should set `Content-Type: application/pdf` so browsers handle the file correctly.

```bash
az storage blob upload \
  --account-name stordersreceiptsprod \
  --container-name receipts \
  --name 2026/05/order-417.pdf \
  --file ./order-417.pdf \
  --content-type application/pdf \
  --metadata orderId=417 documentType=receipt \
  --auth-mode login
```

This upload example uses Azure CLI with Microsoft Entra sign-in through `--auth-mode login`. The caller still needs an Azure role that grants Blob data access. The metadata can help operations and downstream processing, but the order database remains the source of truth for order status, customer ownership, and receipt lookup.

The useful output is the blob's service record, not a cheerful success message. In a healthy response, the reviewer should see the intended object name, a PDF content type, and metadata that matches the upload job.

| Field from the response | Healthy value |
| --- | --- |
| `name` | `2026/05/order-417.pdf` |
| `properties.contentSettings.contentType` | `application/pdf` |
| `metadata.orderId` | `417` |
| `metadata.documentType` | `receipt` |

The read-back command should inspect the blob that storage actually saved:

```bash
az storage blob show \
  --account-name stordersreceiptsprod \
  --container-name receipts \
  --name 2026/05/order-417.pdf \
  --query "{name:name,contentType:properties.contentSettings.contentType,metadata:metadata}" \
  --auth-mode login
```

Example output:

```json
{
  "contentType": "application/pdf",
  "metadata": {
    "documentType": "receipt",
    "orderId": "417"
  },
  "name": "2026/05/order-417.pdf"
}
```

Metadata can feel tempting because it sits next to the file. Keep it modest. Store values that describe the object at the storage layer, such as document type, source job, or processing state. Keep business queries in the database where indexes, constraints, joins, and audit behavior are designed for that job.

Metadata is different from **system properties**. Blob Storage owns properties such as content length, last-modified time, ETag, blob type, and access tier. Clients can set some HTTP-related properties, including content type and cache control, but the service maintains their defined meaning. Custom metadata is application-defined and is returned when the client reads the object's properties.

**Blob index tags** solve another, narrower problem. Tags are indexed key-value attributes that Azure can search across blobs in an account, while ordinary metadata is not a general account-wide query index. Tags can help an operations job find objects by a storage-oriented attribute such as a processing state. They still should not become a second customer database with duplicated business truth.

## How Does Upload and Download Work?
<!-- section-summary: Blob Storage keeps heavy file transfer out of the app server path while the app keeps validation and business ownership. -->

Now the receipt exists as a blob. The next question is how bytes move between the app, browser, and storage account.

For a small internal job, the backend can upload directly to Blob Storage through an Azure SDK or the Azure CLI shape shown above. The app validates the order, creates the PDF, writes the blob, stores the blob name in the database, and returns a normal application response. That path is straightforward for generated files.

For large user uploads, routing all bytes through the API tier can become expensive. Imagine customers upload 500 MB support bundles. If every bundle passes through `devpolaris-orders-api`, the app spends connection slots, bandwidth, CPU, retry handling, and timeout budget on file transfer. Blob Storage can receive those bytes directly after the app decides the user is allowed to upload.

The cleaner production flow has two parts: the API makes the business decision, then Blob Storage handles the byte transfer.

![Azure Blob Storage SAS direct handoff showing browser, Orders API, order database, and Blob Storage](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/sas-direct-handoff.png)

*The browser asks the API for access, the API validates the order, and the browser uses a short-lived SAS to move bytes directly with Blob Storage.*

The API still owns the business decision. It checks who the user is, which order they can access, what file size is allowed, and which blob name should be used. Blob Storage owns the heavy byte transfer. That split keeps compute focused on application rules and lets storage handle storage work.

Every upload follows the same five decisions even when an SDK hides them:

1. Identify the destination account, container, and full blob name.
2. Establish network reachability to the public endpoint or private endpoint.
3. Authenticate the caller and authorize the required Blob data action.
4. Transfer the bytes, properties, metadata, and any request conditions.
5. Commit the object so Blob Storage can expose the completed state and maintain the selected redundancy copies.

Block blobs make large transfers practical by dividing the payload into blocks. A client can upload blocks independently, retry only failed blocks, and then commit a block list that defines the final object. Until that commit, uploaded blocks are uncommitted work rather than the current blob. This matters for resumable uploads: the application must know whether it finished the commit, not merely whether several block requests succeeded.

Suppose a 2 GB support archive is split into four blocks. The client uploads blocks A, B, C, and D, retrying C after one network timeout. Those requests do not need to expose a half-built archive under the final blob name. The final commit supplies the ordered block list `[A, B, C, D]`; that commit is the boundary that creates the new visible object state. A worker can resume by checking which blocks reached the service instead of retransmitting the entire 2 GB payload.

Downloads reverse the path, and clients do not always need the whole object. HTTP range reads can request selected byte ranges, which helps media streaming and large-file processing. The caller still needs reachability and read permission, and the returned ETag identifies the specific object state the response describes.

Blob Storage provides strong consistency for object reads and writes, so a successful write is visible to later reads. Strong consistency does not decide how two writers should coordinate. If two workers overwrite the same blob name, the later accepted write can replace the earlier one. Conditional requests using an ETag can express "write only if the object still matches the version I read," while leases can coordinate supported exclusive-write scenarios. The application must choose a concurrency rule that fits the business workflow.

Consider two receipt-regeneration workers. Both read version `etag-17`. Worker A writes the corrected PDF and the service returns `etag-18`. Worker B then tries to write its older result with an `If-Match: etag-17` condition. Blob Storage rejects the second write because the current object no longer matches the version B originally read. The condition turns an unnoticed lost update into an explicit conflict the application can retry or send for review.

The complete download path is the same design in reverse. The browser presents a narrow read SAS over HTTPS. DNS and routing take it to the approved endpoint. Blob Storage checks the SAS resource, time window, protocol, and permission. It returns the selected bytes, properties, and current ETag. The application database still decides which blob name belongs to the signed-in customer; the token merely carries the storage permission for that already-approved object.

## How Should Identity and Authorization Protect Blobs?
<!-- section-summary: Production Blob access should start with Microsoft Entra ID and narrow data roles instead of shared account keys in application code. -->

Blob access answers who may create, read, list, overwrite, or delete objects. In Azure, the safest everyday starting point is **Microsoft Entra ID** plus Azure role-based access control for Blob data operations.

For our receipt system, the production API can run with a managed identity. A **managed identity** is an Azure identity attached to the runtime, such as an App Service app, Function app, VM, Container App, or AKS workload integration. The app uses that identity to request tokens from Azure instead of carrying a storage account key in configuration.

Then the storage team grants a narrow Blob data role. For example, the API may need permission to create and read receipts in the `receipts` container. A support export job may need read access to `exports`. A cleanup automation may need delete access only where lifecycle rules leave a gap. The role assignment should match the job instead of the convenience of the engineer writing the first script.

Account keys deserve special care. A storage account key can authorize broad access to the account. If someone pastes that key into frontend code, a ticket, a notebook, a CI variable with wide visibility, or a laptop script, the blast radius grows far beyond one receipt. Azure lets teams prevent Shared Key authorization on a storage account, which pushes callers toward Entra-based access and user delegation SAS patterns.

Here is the practical habit. Application code should use managed identity where it can. Human operators should use their own Entra sign-in and data roles. Account keys should stay out of normal app paths, especially browser code and shared scripts.

It helps to review Blob security as three separate layers. **Authorization** decides which data operations an identity or SAS may perform. **Network reachability** decides whether the request can reach the endpoint at all. **Encryption** protects data in transit and at rest. Passing one layer does not imply passing another. A managed identity can have `Storage Blob Data Contributor` and still fail because private DNS points to the wrong address; a reachable endpoint can still reject a caller with no data role.

Azure management-plane permissions and Blob data permissions are also separate. Reader on the storage account can let someone inspect the Azure resource configuration without reading receipt bytes. A Blob data role controls object operations such as read, write, list, and delete. Production reviews should name the exact plane instead of assuming that seeing the account in the portal proves data access.

## When Should You Use SAS Tokens?
<!-- section-summary: A SAS gives one caller limited temporary storage access without handing over the account key or a broad identity. -->

Sometimes a caller needs direct storage access with no Azure credentials of its own. A browser needs to download one receipt. A partner process needs to upload one file. A customer support tool needs a temporary link to one export. This is where a **Shared Access Signature**, usually called a **SAS**, appears.

A SAS is a signed token added to a storage URL. It says which resource the caller may use, which permissions are allowed, and how long the token works. The token travels with the URL, so anyone who gets the URL can use it until it expires or the surrounding design invalidates it. That is why SAS links should use HTTPS, short expiration windows, narrow permissions, and careful logging behavior.


There are three common SAS types:

| SAS type | How it is signed | Beginner guidance |
| --- | --- | --- |
| **User delegation SAS** | Microsoft Entra credentials through a user delegation key | Prefer this for Blob Storage when the app can use Entra-based authorization |
| **Service SAS** | Storage account key | Use carefully for one storage service when legacy or operational needs require it |
| **Account SAS** | Storage account key | Treat as broad and sensitive because it can cover more services and operations |

For a customer receipt download, the orders API can create a 15-minute read-only user delegation SAS for one blob:

```bash
az storage blob generate-sas \
  --account-name stordersreceiptsprod \
  --container-name receipts \
  --name 2026/05/order-417.pdf \
  --permissions r \
  --expiry <expires-at-utc> \
  --as-user \
  --auth-mode login \
  --https-only
```

The browser receives the blob URL with that token attached. The browser gets read access for that one PDF during the short window. The token excludes listing every receipt, deleting the object, overwriting the file, and using the URL after expiry.

The command prints a query-string token, not a whole application decision. A reviewer should check that the token shape matches the story before the API returns it to the browser:

| Token part | Healthy value for this download |
| --- | --- |
| `sp` | `r` for read-only access |
| `spr` | `https` when HTTPS-only is enforced |
| `se` | A UTC expiry about 15 minutes in the future |
| Missing permissions | No list, write, create, or delete permission |

SAS design should follow the actual user story. Download needs read permission. Upload needs create or write permission for a specific name. Listing is rarely needed by a browser. Long expiry values turn temporary links into long-lived secrets, so use the shortest useful duration and make the app capable of asking for a fresh link.

A SAS is a **capability**: possession of the signed URL is enough to exercise the included permissions. Browsers, proxies, analytics tools, screenshots, support tickets, and server logs can accidentally copy URLs, so applications should avoid logging the query string and should never send SAS links over plain HTTP. The token should be scoped as narrowly as the signing model permits.

Revocation is not identical for every SAS type. Waiting for a short token to expire is often the simplest control. Rotating an account key can invalidate SAS tokens signed with that key, but it is a disruptive account-wide action. A service SAS tied to a stored access policy can be changed through that policy. A user delegation SAS follows the lifetime and controls of its user delegation key. These differences are another reason to keep permissions and expiry narrow instead of treating revocation as an easy emergency button.

## How Do Redundancy and Network Reachability Affect Access?
<!-- section-summary: Redundancy protects against infrastructure failures, while network controls decide which callers can reach the storage endpoint. -->

After access is clear, the next production question is where the bytes live and who can reach the endpoint.

**Redundancy** controls how Azure stores extra copies of the data. Locally redundant storage, or LRS, keeps multiple copies in one physical location within the primary region. Zone-redundant storage, or ZRS, spreads synchronous copies across availability zones in supported regions. Geo-redundant options add asynchronous replication to a secondary region. Geo-zone-redundant options combine zone redundancy in the primary region with geo replication.

The names can be read as failure boundaries:

| Option | Primary-region copies | Secondary-region copy | Normal read access to secondary |
| --- | --- | --- | --- |
| **LRS** | Multiple copies in one local datacenter location | No | No |
| **ZRS** | Synchronous copies across availability zones | No | No |
| **GRS** | LRS-style primary protection | Asynchronous geo copy | Not before failover |
| **GZRS** | ZRS-style primary protection | Asynchronous geo copy | Not before failover |
| **RA-GRS / RA-GZRS** | Same primary and geo pattern as the matching option | Yes | Yes, through the secondary endpoint |

More copies do not automatically make the application recoverable. The app needs to know who initiates failover, whether the secondary may lag, which DNS or endpoint it uses, and whether other state systems fail over to a compatible point. Replication is a durability mechanism; it is not a substitute for versions, deletion recovery, or an application recovery plan.

The receipt system might use ZRS because customers expect downloads during a zone failure. A short-lived import staging account might use a cheaper redundancy option because the data can be recreated from the source. A compliance archive may care about regional disaster recovery and choose a geo-redundant option. The choice should match the consequence of losing access or losing data.

Redundancy handles infrastructure failure. Logical mistakes need their own recovery layer. If a buggy cleanup job deletes the wrong receipt and the delete operation is replicated, every current replica now agrees that the receipt is gone. Versioning, soft delete, retention, and restore procedures answer that different recovery question.

Network reachability is the other half. A storage account has service endpoints that can be reached over HTTPS. Many production systems add firewall rules, virtual network integration, private endpoints, and private DNS so storage traffic follows approved network paths. Public endpoint reachability and anonymous public access are separate decisions. A private receipt account should block anonymous access and use narrow network paths where the system requires them.

A storage firewall narrows which networks may use the public service endpoint; it does not turn that endpoint into a private IP. A **private endpoint** creates a network interface with a private address in a chosen VNet and maps Blob access through Azure Private Link. Private DNS must then resolve the normal Blob hostname to that private address for callers on the approved network path. Authentication and Blob data authorization still happen after the packets arrive.

Geo-redundant variants also differ in read behavior. GRS and GZRS replicate asynchronously to a secondary region for disaster recovery. Read-access variants, RA-GRS and RA-GZRS, additionally expose a secondary read endpoint before failover. Because replication is asynchronous, the secondary may lag the primary. Choosing read access therefore requires an application rule for potentially older data, not just a checkbox for "more redundancy."

## How Do Tiers and Lifecycle Rules Control Cost?
<!-- section-summary: Access tiers control storage cost and retrieval behavior, while lifecycle rules automate tier movement and deletion as objects age. -->

Files change value over time. A receipt PDF may be downloaded often during the first week after purchase. After the refund window closes, it may be accessed only during support cases or audits. Temporary imports may have no value after processing finishes. Blob Storage uses **access tiers** and **lifecycle management** to control this cost pattern.


The common access tiers are:

| Tier | Practical fit | Read behavior |
| --- | --- | --- |
| **Hot** | Active files that users or services read often | Online and fast, with higher storage cost |
| **Cool** | Infrequently accessed files that still need online access | Online, with lower storage cost and higher access cost |
| **Cold** | Rarely accessed files that still need online access | Online, with lower storage cost and higher access cost |
| **Archive** | Long-term data where hours of retrieval delay are acceptable | Offline until rehydrated into an online tier |

Archive needs a clear warning in production conversations. Archived blobs are offline for normal reads. The team must rehydrate the blob to an online tier before normal reads work, and that can take time. Archive can fit legal archives or old exports. It is a painful choice for incident logs, active customer support files, or anything the team needs during a live outage.

Tier selection is an expected-cost decision, not a simple colder-is-cheaper ladder. The estimate must combine stored capacity, operation counts, data retrieval, rehydration delay, minimum storage durations, early-deletion charges, and the chance that users will need the object again. A tier with cheaper monthly capacity can cost more overall when the application repeatedly reads or moves the same objects.

For access patterns that are hard to predict, Azure also offers an automatic or smart tiering option for supported block blobs. It can move objects between online tiers according to observed access without moving them to Archive. This reduces some manual guesswork, while lifecycle and retention design still need explicit ownership.

![Azure Blob Storage lifecycle tiers and recovery rails for versioning, blob soft delete, and container soft delete](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/lifecycle-recovery-rails.png)

*Lifecycle rules help control long-term storage cost, while versioning and soft delete give the team recovery paths after overwrites and deletes.*

**Lifecycle management** lets the storage account apply rules based on age, prefix, blob type, version state, and related conditions. For our receipt container, a rule might keep new receipts in Hot, move older receipts to Cool, archive very old receipts, and delete old noncurrent versions after the recovery window.

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "receipt-tiering",
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["receipts/"]
        },
        "actions": {
          "baseBlob": {
            "tierToCool": {
              "daysAfterModificationGreaterThan": 30
            },
            "tierToArchive": {
              "daysAfterModificationGreaterThan": 365
            }
          },
          "version": {
            "delete": {
              "daysAfterCreationGreaterThan": 90
            }
          }
        }
      }
    }
  ]
}
```

The exact numbers should come from product, legal, support, and cost requirements. The important habit is to write the lifecycle rule as part of the storage design. Without lifecycle rules, old files, old versions, and temporary objects can quietly become a large monthly bill.

In practice, the JSON belongs in source control beside the storage infrastructure, then the deployment applies it to the storage account's management policy. A verification read should show the rule name, enabled flag, prefix, and version cleanup window before the team trusts the automation.

| Policy field | Expected review value |
| --- | --- |
| `rules[0].name` | `receipt-tiering` |
| `rules[0].enabled` | `true` |
| `definition.filters.prefixMatch` | `["receipts/"]` |
| `baseBlob.tierToCool.daysAfterModificationGreaterThan` | `30` |
| `version.delete.daysAfterCreationGreaterThan` | `90` |

## How Do Versioning, Soft Delete, and Retention Protect Data?
<!-- section-summary: Blob data protection features preserve recoverable previous states after overwrites, deletes, and container mistakes. -->

Now we can talk about the painful production moment: the app wrote the wrong bytes, a script deleted the wrong prefix, or a person removed a container. Redundancy keeps the storage service resilient, but recovery needs previous useful states.

**Blob versioning** keeps previous versions when a blob changes. If a PDF generator bug overwrites `2026/05/order-417.pdf` with a blank file, versioning can preserve the older good version. The current name still points at the current version, while previous versions remain available for recovery until lifecycle or retention policy removes them.

Versioning changes object identity in an important way. The container and blob name identify the logical object, while a version ID identifies one immutable historical state of that name. A restore procedure should therefore record both the name and the version selected for recovery. Simply saying "restore the receipt" is ambiguous after several overwrites. Operators need to compare timestamps, ETags, metadata, and version IDs so they promote the correct state instead of recovering another bad revision.

Old versions also keep consuming storage. Lifecycle rules should remove noncurrent versions only after the recovery and retention window has passed. Otherwise versioning can protect data correctly while creating an unbounded cost problem.

**Blob soft delete** keeps deleted blobs recoverable for a configured retention period. **Container soft delete** gives a recovery path when someone deletes an entire container. These settings help with common logical mistakes, especially cleanup jobs and human errors.


For important receipt files, the team might choose:

| Protection | Production purpose |
| --- | --- |
| **Blob versioning** | Recover a previous PDF after overwrite or bad regeneration |
| **Blob soft delete** | Recover a deleted blob during the retention window |
| **Container soft delete** | Recover after accidental container deletion |
| **Lifecycle cleanup for versions** | Keep recovery useful without storing every old version forever |
| **Restore drill** | Prove the team can find and restore the right version under pressure |

These features cost money because recoverable versions and soft-deleted data still consume storage. That cost can be reasonable for customer receipts, contracts, evidence files, and audit exports. It can be wasteful for temporary imports that can be recreated. The storage design should name which data needs recovery and how long that recovery window lasts.

**Immutability** answers a stronger question than soft delete. A time-based retention policy or legal hold can place protected blob versions under write-once, read-many behavior, often shortened to **WORM**. During the protected period, an authorized user cannot simply overwrite or delete the retained version. That can support regulatory records or evidence that must resist ordinary administrator mistakes.

Soft delete promises that a deleted object remains recoverable for a window. Immutability promises that the protected object state cannot be changed or deleted during its retention. Versioning preserves multiple identities over time, and lifecycle rules eventually remove states that no longer need protection. These controls complement one another, but each one protects a different failure or compliance requirement.

### Putting It All Together
<!-- section-summary: A good Blob Storage design names the account boundary, object path, access path, cost plan, and recovery plan before production traffic arrives. -->

Blob Storage is the Azure home for object-shaped bytes. In the receipt system, Azure SQL Database stores the business record and Blob Storage stores the PDF. The storage account owns the endpoint, region, redundancy, network rules, encryption settings, and billing boundary. Containers group related objects. Blob names give each object an exact address and useful operational prefixes.

The access plan should start with Microsoft Entra ID, managed identity, and narrow Blob data roles. A SAS gives a browser or partner a small temporary permission for one task, such as reading one receipt or uploading one support bundle. The account key should stay out of normal application paths.

The operations plan should cover redundancy, network reachability, tiers, lifecycle rules, versioning, soft delete, and restore drills. Replication helps with infrastructure failures. Versioning and soft delete help with logical mistakes. Lifecycle rules keep long-lived object storage from growing forever without review.

When you review a Blob Storage design, ask five plain questions:

| Question | Good answer shape |
| --- | --- |
| What account owns the endpoint and controls? | A named account per environment and risk boundary |
| What container and blob name pattern stores the object? | Containers by lifecycle/access pattern, names by useful prefixes |
| Who can read, write, list, and delete? | Managed identities and narrow data roles, with short SAS links for clients |
| How does cost change as files age? | Hot, Cool, Cold, Archive, and lifecycle rules tied to real retention needs |
| What happens after overwrite or delete mistakes? | Versioning, soft delete, retention windows, and tested restore steps |

That is the production shape. Blob Storage holds durable file-like bytes, while the application and database keep business ownership, validation, and meaning.

Compare the contracts to clarify the final service choice:

| Need | Natural Azure storage choice | Why |
| --- | --- | --- |
| Fetch a receipt, image, export, or media object by name through an API | **Blob Storage** | The main contract is a durable object name mapped to bytes |
| Mount a shared directory that existing software reads with SMB or NFS-style file operations | **Azure Files** | The workload expects filesystem paths, directories, and file protocols |
| Attach low-level block storage to a virtual machine | **Managed Disks** | The operating system expects a disk device for its filesystem or database files |
| Query related rows and enforce keys, constraints, and transactions | **Azure SQL Database** | The workload needs structured business state rather than independent objects |

Real systems often combine them. The Orders database can store `order_id`, `customer_id`, amount, payment state, and the exact receipt blob name. Blob Storage keeps `receipts/2026/05/order-417.pdf`. A transaction can protect the relational facts, while the application uses an idempotent workflow to create the object and record its name. Choosing more than one service is often simpler than forcing every kind of state into one contract.

A complete production account can now be described without product-name fog. `stordersreceiptsprod` lives in the approved region with ZRS, rejects anonymous and Shared Key access, exposes a private Blob endpoint to the application VNet, and uses private DNS for the normal service hostname. The Orders managed identity receives only its required Blob data role. Browsers receive short read-only user delegation SAS links. Receipts start in Hot, lifecycle rules move older files to Cool, and archived data is used only where delayed retrieval is acceptable. Versioning and soft delete cover ordinary mistakes; an immutability policy protects records that require WORM retention.

When reviewing another design, ask five first-principles questions before choosing settings:

1. What is the object's stable account, container, and blob-name identity?
2. Which identities or temporary capabilities may perform each data action?
3. From which networks can those requests reach the endpoint?
4. Which infrastructure failures must the redundancy choice survive?
5. What should happen to the object as it ages, is overwritten, is deleted, or enters a retention period?

Those answers connect the storage contract to access, networking, durability, cost, and recovery. If any answer is vague, the Azure resource can exist while the production design remains unfinished.

The shortest mental model is a layered one: the blob name identifies the object, the service stores and replicates its bytes, identity and network controls bound access, lifecycle rules manage its economic age, and protection settings preserve the states the business may need again. Keeping those layers separate makes both design reviews and incidents easier to reason about.

![Azure Blob Storage production checklist with account boundary, object path, identity access, SAS handoff, lifecycle cost, and recovery window](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/blob-production-checklist.png)

*Use the checklist as the last pass before production: account boundary, object path, identity, SAS links, lifecycle cost, and recovery window.*

### What's Next

Next we move from file-like objects to relational records in Azure SQL Database, where the important questions are schemas, constraints, transactions, indexes, connection behavior, and restore.

---

## Check Your Answers

:::expand[What Storage Contract Does Blob Storage Provide?]{kind="recap"}
Blob Storage is for durable named byte payloads, so application compute can stay replaceable and the database can keep business meaning. The storage account is the real operational boundary for endpoint, region, redundancy, network access, encryption, and billing.
:::

:::expand[How Do Containers, Names, Types, and Metadata Identify Objects?]{kind="recap"}
Containers group related objects, while blob names provide the exact lookup path inside a flat object namespace. Most application files use block blobs, while metadata and properties explain how clients should handle the bytes.
:::

:::expand[How Does Upload and Download Work?]{kind="recap"}
Blob Storage keeps heavy file transfer out of the app server path while the app keeps validation and business ownership.
:::

:::expand[How Should Identity and Authorization Protect Blobs?]{kind="recap"}
Production Blob access should start with Microsoft Entra ID and narrow data roles instead of shared account keys in application code.
:::

:::expand[When Should You Use SAS Tokens?]{kind="recap"}
A SAS gives one caller limited temporary storage access without handing over the account key or a broad identity.
:::

:::expand[How Do Redundancy and Network Reachability Affect Access?]{kind="recap"}
Redundancy protects against infrastructure failures, while network controls decide which callers can reach the storage endpoint.
:::

:::expand[How Do Tiers and Lifecycle Rules Control Cost?]{kind="recap"}
Access tiers control storage cost and retrieval behavior, while lifecycle rules automate tier movement and deletion as objects age.
:::

:::expand[How Do Versioning, Soft Delete, and Retention Protect Data?]{kind="recap"}
Blob data protection features preserve recoverable previous states after overwrites, deletes, and container mistakes. A good Blob Storage design names the account boundary, object path, access path, cost plan, and recovery plan before production traffic arrives.
:::

## References

* [Introduction to Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction) - Blob Storage concepts, accounts, containers, blob types, and object access.
* [Overview of storage accounts](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-overview) - Storage account types, names, endpoints, redundancy, and billing boundaries.
* [Naming and referencing containers, blobs, and metadata](https://learn.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata) - Container and blob naming rules.
* [Authorize access to blobs with Microsoft Entra ID](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory) - Identity-based Blob access and Azure roles.
* [Grant limited access with shared access signatures](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) - SAS types, permissions, expiration, and security guidance.
* [Prevent Shared Key authorization](https://learn.microsoft.com/en-us/azure/storage/common/shared-key-authorization-prevent) - Guidance for disabling account-key authorization where appropriate.
* [Azure Storage redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy) - LRS, ZRS, GRS, and GZRS redundancy models.
* [Access tiers for blob data](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview) - Hot, Cool, Cold, Archive, and rehydration behavior.
* [Blob lifecycle management overview](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview) - Rule-based tier movement and deletion.
* [Data protection overview for Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview) - Versioning, soft delete, container soft delete, and recovery features.
