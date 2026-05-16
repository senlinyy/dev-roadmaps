---
title: "Blob Storage"
description: "Use Azure Blob Storage for durable file-like data by understanding storage accounts, containers, blobs, names, access, tiers, and lifecycle rules."
overview: "Blob Storage is the Azure home for generated files such as receipts, exports, images, and archives. This article explains the storage account boundary, containers, blob names, access paths, and lifecycle tradeoffs."
tags: ["azure", "blob-storage", "storage-account", "containers", "lifecycle"]
order: 2
id: article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage
aliases:
  - storage-accounts-and-blob-storage
  - cloud-providers/azure/storage-databases/storage-accounts-and-blob-storage.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Blob Storage](#what-is-blob-storage)
3. [Storage Account](#storage-account)
4. [Containers](#containers)
5. [Blobs](#blobs)
6. [Names](#names)
7. [Access](#access)
8. [Tiers](#tiers)
9. [Lifecycle](#lifecycle)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The previous article separated data shapes. Now focus on the file-shaped part of `devpolaris-orders-api`.

The checkout system creates files that should outlive the process that made them:

- A receipt PDF should still exist after the API container is replaced.
- A finance export should be downloadable even if the export worker scales to zero.
- A support attachment should not disappear because one App Service instance restarted.
- A year-old archive should not cost the same as a receipt downloaded every day.

Writing these files to a local app folder is easy on a laptop and fragile in the cloud. Blob Storage exists so file-like data has a durable service boundary outside compute.

## What Is Blob Storage

Azure Blob Storage stores objects called blobs. A blob can be a PDF, image, CSV, JSON export, log archive, backup artifact, or any other bytes the app needs to keep as a file-like object.

The important difference from a local filesystem is that Blob Storage is a service. Your app sends a request to store or read a named object. The file is not tied to one container, VM, or function invocation. Many compute instances can refer to the same blob by account, container, and blob name.

The basic shape is:

| Azure noun | Beginner meaning |
| --- | --- |
| Storage account | The outer Azure Storage boundary for name, network, redundancy, security, and billing behavior. |
| Container | A grouping boundary for blobs inside the storage account. |
| Blob | The object itself: the bytes and metadata. |
| Blob name | The object's string name inside the container. It can look like a path. |
| Access tier | Cost and access behavior for how often the blob is used. |
| Lifecycle rule | A policy that moves or deletes blobs as they age or change state. |

If you know S3, Blob Storage is the object storage part of Azure Storage. The extra Azure habit is to notice the storage account. A storage account can hold blob containers, file shares, queues, and tables, so it is wider than an S3 bucket.

## Storage Account

A storage account is the outer resource boundary. It gives the app a namespace, region, redundancy choice, account kind, network rules, security settings, and billing container for Azure Storage data.

This boundary matters more than beginners expect. A storage account name becomes part of the endpoint. Network restrictions and public access behavior live at the account and container levels. Redundancy is chosen for the account. Some account choices, such as account kind, are not casually changeable later. Microsoft documentation notes that once a storage account is created, the account type cannot be changed, so the first boundary deserves real review.

For the orders system, a storage account such as `stordersprodweu` might contain containers for receipts, exports, and support uploads. That does not mean every product in the company should share it. The account should match ownership, network needs, redundancy, compliance, and lifecycle policy.

## Containers

A container groups blobs inside a storage account. It is not a Docker container. It is a storage grouping boundary.

Containers help the team separate access and lifecycle behavior. Receipts, finance exports, and temporary imports may deserve different containers because they have different readers, retention needs, and deletion rules. A receipt container might allow app writes and customer-specific downloads through controlled URLs. An export container might be private to finance jobs. A temporary import container might delete old files quickly.

Container names help humans, but policy makes the boundary real. A container called `private-receipts` is not private because of the name. It is private because account settings, container public access, identity permissions, SAS usage, and network rules do not expose it broadly.

## Blobs

A blob is the stored object. For this module, think of a blob as a file-like thing with bytes, metadata, and a name. Azure supports different blob types, but block blobs are the common shape for files such as documents, images, and exports.

The app should treat the blob as durable file storage, not as the source of every business fact. A receipt PDF can live in Blob Storage, while the order table stores the receipt blob name, customer ID, and generated time. That split keeps the file in object storage and the queryable business relationship in the database.

Large files are another reason object storage matters. Blob clients can upload blocks and commit them as one blob, letting large uploads retry parts instead of forcing one fragile local write. The article does not need the full API sequence yet, but the design idea matters: object storage is built for durable file operations at cloud scale.

## Names

Blob names are strings inside a container. They often include slashes, such as `receipts/2026/05/order-417.pdf`, which makes them look like folders. The slashes are part of the object name. They are useful for organization and prefix-based listing, but they are not a relational schema.

That detail prevents a common mistake. If support needs to find all receipts for customer `cust_91`, do not depend only on scanning blob names unless that is truly the access pattern you designed. Store the customer-to-receipt relationship in a database, then use the blob name as the pointer to the file.

Names should be stable enough to survive app changes. A generated name that includes a random temp directory from one worker is weak. A name based on business identifiers and dates can be easier to audit, as long as it does not leak sensitive information.

## Access

Start private. Most production Blob Storage data should not be broadly public by default. The app or user should get access through an intentional path: managed identity, Azure RBAC, service-specific authorization, a short-lived shared access signature, private network access, or an application endpoint that streams the file after checking authorization.

The tricky part is that access is layered. A request can fail because identity lacks permission, because network rules block the caller, because public access is disabled, because the SAS expired, or because the blob name is wrong. A useful design names the expected access path.

For receipt downloads, one safe shape is: app verifies the customer, then issues a short-lived download link or streams the blob through an authorized backend path. The customer does not need broad storage account permission.

## Tiers

Access tiers let the team trade access cost and retrieval behavior for storage cost. Hot is for frequently accessed data. Cool and cold are for less frequently accessed data. Archive is for data that can tolerate rehydration before access.

The tier is a cost and latency decision. A fresh receipt may belong in Hot because customers download it soon after checkout. A one-year-old export might move to Cool or Cold. A compliance archive might move to Archive if the team accepts that it must be rehydrated before reading. Archive is not a place for files that must open instantly during a support call.

Do not use lifecycle tiers as decoration. Write down why a blob moves tiers and what recovery or download experience changes when it does.

## Lifecycle

Lifecycle management applies rules to blobs based on age, tier, version, or other conditions. A rule might move exports to Cool after 30 days, archive them after a year, or delete temporary imports after a week.

Lifecycle rules are useful because storage grows quietly. Exports, uploads, and logs can accumulate long after the feature shipped. A lifecycle rule makes the cleanup policy part of the data design.

The gotcha is that lifecycle rules delete or move data automatically. That is the point, but it means the policy must match product, compliance, and recovery needs. If a rule deletes receipt versions after 30 days and the business needs them for seven years, the cloud did exactly what the team asked and the design was wrong.

## Putting It All Together

The opener had receipts, exports, support attachments, and archives. Blob Storage gives those files a durable home outside the compute runtime.

The storage account is the outer Azure Storage boundary. Containers group related blobs and their policies. Blobs hold the file bytes. Blob names help organize objects but do not replace database records. Access starts private and should name the intended authorization path. Tiers and lifecycle rules turn age and access patterns into cost decisions.

Blob Storage is the right first Azure home for file-like data. Keep business relationships and queryable metadata in a database, and keep the bytes in object storage.

## What's Next

Next we will look at Azure SQL Database, where the data is not a file but a set of connected business records that need transactions, relationships, and queries.

---

**References**

- [Introduction to Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-overview)
- [Azure Storage account overview](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-overview)
- [Access tiers for blob data](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview)
- [Lifecycle management overview](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview)
