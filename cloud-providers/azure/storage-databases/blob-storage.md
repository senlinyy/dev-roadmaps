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

1. [The Blob Storage Shape](#the-blob-storage-shape)
2. [Storage Accounts](#storage-accounts)
3. [Containers and Blob Names](#containers-and-blob-names)
4. [Blob Types and Metadata](#blob-types-and-metadata)
5. [The Upload and Download Path](#the-upload-and-download-path)
6. [Access Without Account Keys](#access-without-account-keys)
7. [SAS Tokens](#sas-tokens)
8. [Redundancy and Network Reachability](#redundancy-and-network-reachability)
9. [Access Tiers and Lifecycle Rules](#access-tiers-and-lifecycle-rules)
10. [Versioning, Soft Delete, and Retention](#versioning-soft-delete-and-retention)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Blob Storage Shape
<!-- section-summary: Blob Storage is for durable named byte payloads, so application compute can stay replaceable and the database can keep business meaning. -->

Blob Storage is Azure's object storage service for **unstructured data**, which usually means text or binary bytes with no table schema. Receipt PDFs, profile photos, support attachments, CSV exports, backup files, media uploads, and archived logs all fit this shape. The application reads or writes the file as one named object through an HTTP API.

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

## Storage Accounts
<!-- section-summary: The storage account is the real operational boundary for endpoint, region, redundancy, network access, encryption, and billing. -->

A **storage account** is the Azure resource that contains Blob Storage data and exposes the storage namespace. The account name becomes part of the service endpoint. If the account is named `stordersreceiptsprod`, the Blob endpoint is usually `https://stordersreceiptsprod.blob.core.windows.net`.

The account name has production consequences because it must be unique across Azure, can contain only lowercase letters and numbers, and is between 3 and 24 characters long. That endpoint becomes a stable address in application configuration, logs, runbooks, private DNS, and monitoring. Choose names that identify the workload and environment without leaking sensitive business details.

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

So the account is more than a folder. It is the place where storage becomes a production resource with security, cost, network, and recovery settings.

## Containers and Blob Names
<!-- section-summary: Containers group related objects, while blob names provide the exact lookup path inside a flat object namespace. -->

After the account exists, the next layer is the **container**. A container groups blobs inside a storage account. For the orders system, `receipts`, `exports`, and `temporary-imports` can be separate containers because they have different access and lifecycle needs. Receipts need customer download links and long retention. Exports may move to colder storage after a short active window. Temporary imports may disappear after a week.

A **blob name** is the full object name inside the container. A name like `2026/05/order-417.pdf` looks like a normal folder path, but in a standard account without hierarchical namespace, the slashes are part of one name string. Tools can list blobs by prefix, so the slash pattern still helps people and automation group objects by year, month, tenant, or purpose.

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

## Blob Types and Metadata
<!-- section-summary: Most application files use block blobs, while metadata and properties explain how clients should handle the bytes. -->

Azure Blob Storage supports several blob types. A beginner usually meets **block blobs** first. A block blob stores text or binary data and can be uploaded in blocks, then committed as one object. This is the normal fit for PDFs, images, CSV files, JSON exports, archives, and uploaded documents.

**Append blobs** are optimized for append operations. They fit scenarios where new data gets added to the end of an object, such as some logging patterns. **Page blobs** support random read and write operations over fixed-size pages and are used for Azure virtual hard disk files. If you are storing customer receipts or profile images, start with block blobs.

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

Metadata can feel tempting because it sits next to the file. Keep it modest. Store values that describe the object at the storage layer, such as document type, source job, or processing state. Keep business queries in the database where indexes, constraints, joins, and audit behavior are designed for that job.

## The Upload and Download Path
<!-- section-summary: Blob Storage keeps heavy file transfer out of the app server path while the app keeps validation and business ownership. -->

Now the receipt exists as a blob. The next question is how bytes move between the app, browser, and storage account.

For a small internal job, the backend can upload directly to Blob Storage through an Azure SDK or the Azure CLI shape shown above. The app validates the order, creates the PDF, writes the blob, stores the blob name in the database, and returns a normal application response. That path is straightforward for generated files.

For large user uploads, routing all bytes through the API tier can become expensive. Imagine customers upload 500 MB support bundles. If every bundle passes through `devpolaris-orders-api`, the app spends connection slots, bandwidth, CPU, retry handling, and timeout budget on file transfer. Blob Storage can receive those bytes directly after the app decides the user is allowed to upload.

The cleaner production flow has two parts: the API makes the business decision, then Blob Storage handles the byte transfer.

![Azure Blob Storage SAS direct handoff showing browser, Orders API, order database, and Blob Storage](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/sas-direct-handoff.png)

*The browser asks the API for access, the API validates the order, and the browser uses a short-lived SAS to move bytes directly with Blob Storage.*

The API still owns the business decision. It checks who the user is, which order they can access, what file size is allowed, and which blob name should be used. Blob Storage owns the heavy byte transfer. That split keeps compute focused on application rules and lets storage handle storage work.

## Access Without Account Keys
<!-- section-summary: Production Blob access should start with Microsoft Entra ID and narrow data roles instead of shared account keys in application code. -->

Blob access answers who may create, read, list, overwrite, or delete objects. In Azure, the safest everyday starting point is **Microsoft Entra ID** plus Azure role-based access control for Blob data operations.

For our receipt system, the production API can run with a managed identity. A **managed identity** is an Azure identity attached to the runtime, such as an App Service app, Function app, VM, Container App, or AKS workload integration. The app uses that identity to request tokens from Azure instead of carrying a storage account key in configuration.

Then the storage team grants a narrow Blob data role. For example, the API may need permission to create and read receipts in the `receipts` container. A support export job may need read access to `exports`. A cleanup automation may need delete access only where lifecycle rules leave a gap. The role assignment should match the job instead of the convenience of the engineer writing the first script.

Account keys deserve special care. A storage account key can authorize broad access to the account. If someone pastes that key into frontend code, a ticket, a notebook, a CI variable with wide visibility, or a laptop script, the blast radius becomes much larger than one receipt. Azure lets teams prevent Shared Key authorization on a storage account, which pushes callers toward Entra-based access and user delegation SAS patterns.

Here is the practical habit. Application code should use managed identity where it can. Human operators should use their own Entra sign-in and data roles. Account keys should stay out of normal app paths, especially browser code and shared scripts.

## SAS Tokens
<!-- section-summary: A SAS gives one caller limited temporary storage access without handing over the account key or a broad identity. -->

Sometimes a caller needs direct storage access with no Azure credentials of its own. A browser needs to download one receipt. A partner process needs to upload one file. A customer support tool needs a temporary link to one export. This is where a **Shared Access Signature**, usually called a **SAS**, appears.

A SAS is a signed token added to a storage URL. It says which resource the caller may use, which permissions are allowed, and how long the token works. The token travels with the URL, so anyone who gets the URL can use it until it expires or becomes invalid through the design around it. That is why SAS links should use HTTPS, short expiration windows, narrow permissions, and careful logging behavior.

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

SAS design should follow the actual user story. Download needs read permission. Upload needs create or write permission for a specific name. Listing is rarely needed by a browser. Long expiry values turn temporary links into long-lived secrets, so use the shortest useful duration and make the app capable of asking for a fresh link.

## Redundancy and Network Reachability
<!-- section-summary: Redundancy protects against infrastructure failures, while network controls decide which callers can reach the storage endpoint. -->

After access is clear, the next production question is where the bytes live and who can reach the endpoint.

**Redundancy** controls how Azure stores extra copies of the data. Locally redundant storage, or LRS, keeps multiple copies in one physical location within the primary region. Zone-redundant storage, or ZRS, spreads synchronous copies across availability zones in supported regions. Geo-redundant options add asynchronous replication to a secondary region. Geo-zone-redundant options combine zone redundancy in the primary region with geo replication.

The receipt system might use ZRS because customers expect downloads during a zone failure. A short-lived import staging account might use a cheaper redundancy option because the data can be recreated from the source. A compliance archive may care about regional disaster recovery and choose a geo-redundant option. The choice should match the consequence of losing access or losing data.

Redundancy handles infrastructure failure. Logical mistakes need their own recovery layer. If a buggy cleanup job deletes the wrong receipt and the delete operation is replicated, every current replica now agrees that the receipt is gone. Versioning, soft delete, retention, and restore procedures answer that different recovery question.

Network reachability is the other half. A storage account has service endpoints that can be reached over HTTPS. Many production systems add firewall rules, virtual network integration, private endpoints, and private DNS so storage traffic follows approved network paths. Public endpoint reachability and anonymous public access are separate decisions. A private receipt account should block anonymous access and use narrow network paths where the system requires them.

## Access Tiers and Lifecycle Rules
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

## Versioning, Soft Delete, and Retention
<!-- section-summary: Blob data protection features preserve recoverable previous states after overwrites, deletes, and container mistakes. -->

Now we can talk about the painful production moment: the app wrote the wrong bytes, a script deleted the wrong prefix, or a person removed a container. Redundancy keeps the storage service resilient, but recovery needs previous useful states.

**Blob versioning** keeps previous versions when a blob changes. If a PDF generator bug overwrites `2026/05/order-417.pdf` with a blank file, versioning can preserve the older good version. The current name still points at the current version, while previous versions remain available for recovery until lifecycle or retention policy removes them.

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

## Putting It All Together
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

![Azure Blob Storage production checklist with account boundary, object path, identity access, SAS handoff, lifecycle cost, and recovery window](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/blob-production-checklist.png)

*Use the checklist as the last pass before production: account boundary, object path, identity, SAS links, lifecycle cost, and recovery window.*

## What's Next

Next we move from file-like objects to relational records in Azure SQL Database, where the important questions are schemas, constraints, transactions, indexes, connection behavior, and restore.

---

**References**

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
