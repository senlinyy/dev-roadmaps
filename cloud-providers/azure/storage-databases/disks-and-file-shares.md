---
title: "Disks and File Shares"
description: "Use Managed Disks and Azure Files when a workload needs VM-attached block storage or a mounted shared folder rather than object storage."
overview: "Some storage needs to look like a disk or file path to an operating system. This article explains Managed Disks, OS disks, data disks, temporary storage, Azure Files, and when Blob Storage is still the simpler answer."
tags: ["azure", "managed-disks", "azure-files", "virtual-machines", "storage"]
order: 5
id: article-cloud-providers-azure-storage-databases-managed-disks-azure-files
aliases:
  - managed-disks-and-azure-files
  - cloud-providers/azure/storage-databases/managed-disks-and-azure-files.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Managed Disks](#managed-disks)
3. [OS Disks](#os-disks)
4. [Data Disks](#data-disks)
5. [Temporary Storage](#temporary-storage)
6. [Azure Files](#azure-files)
7. [Blob Storage Comparison](#blob-storage-comparison)
8. [VM-Shaped Workloads](#vm-shaped-workloads)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

Blob Storage stores durable objects. Azure SQL stores relational records. Cosmos DB stores item-shaped data. But some workloads still expect a disk or a mounted folder.

The orders system has a legacy import worker during migration:

- It runs on a VM because it needs a vendor binary and custom OS packages.
- It writes temporary files during a batch import.
- It expects a mounted directory for shared templates.
- It produces final CSV outputs that finance downloads later.

Those needs are easy to blur. A disk, a file share, and object storage can all hold bytes. They solve different problems. This article separates storage that belongs to VM-shaped work from storage that belongs to the application data model.

## Managed Disks

Azure Managed Disks are block-level storage volumes managed by Azure and used with Azure Virtual Machines. Block storage means the operating system sees something disk-like: a volume it can format, mount, and use through normal disk operations.

Managed disks belong close to VMs. Every VM has an OS disk, and many VMs have data disks. Azure manages disk placement and durability at the platform level, but the guest operating system and application still decide what is written to the disk.

If you know AWS, Managed Disks are closest to EBS volumes. The useful habit transfers: use disk storage when a machine needs a disk, not when an app merely needs durable files.

## OS Disks

The OS disk contains the operating system and boot files for a VM. Without it, the VM does not boot. It is part of the machine's identity and lifecycle.

The OS disk should not become the app's general storage plan. If the app writes customer uploads, receipts, exports, or business records onto the OS disk, recovery and scaling become tied to one machine. Replacing the VM becomes dangerous because the machine now holds business data that should have lived elsewhere.

Keep the OS disk focused on the operating system and installed runtime. Put application records in databases, generated files in Blob Storage, and shared filesystem needs in a data disk or Azure Files when the workload truly needs that shape.

## Data Disks

A data disk is an additional managed disk attached to a VM. It can hold application workspace, imported files, local caches, or data that a VM-shaped workload needs close to the machine.

For the legacy import worker, a data disk might be a good place for batch scratch files while the job runs. It might also hold a local cache that can be rebuilt. The final export should still move to Blob Storage if finance needs to download it later and the file should survive VM replacement.

Data disks need operational thinking. They have size and performance characteristics. They can be snapshotted. They can fill up. They can be detached or reattached in some recovery flows. None of that makes them a relational database or an object store.

## Temporary Storage

Some Azure VMs include temporary local storage. Temporary storage can be useful for scratch files, paging, or ephemeral work. It is not durable application storage.

This is one of the most important gotchas in the article. Temporary storage can be lost when the VM is moved, redeployed, resized, or otherwise affected by platform operations. If losing the file would hurt the business, it does not belong there.

Use temporary storage only for data the workload can recreate. A batch intermediate file may fit. A customer's receipt PDF does not.

## Azure Files

Azure Files provides managed file shares. A file share is a folder-like storage surface clients can mount and use through file protocols such as SMB and, in some configurations, NFS.

Azure Files is useful when software expects a shared path. A legacy app may read templates from `\\share\templates`. Several VMs may need to see the same import folder. A migration may need a managed file share before the app can be rewritten to use object storage.

The file share still needs design. Who mounts it? Over which network path? Which identity or key authorizes access? What performance tier fits the workload? How are snapshots or backups handled? A managed share removes file server maintenance, but it does not remove filesystem operations.

## Blob Storage Comparison

Blob Storage and Azure Files both store file-like bytes, but the access model is different.

| Need | Better first fit | Why |
| --- | --- | --- |
| Customer downloads a receipt PDF | Blob Storage | The app stores and serves an object by name. |
| Finance downloads a generated CSV | Blob Storage | Durable object storage fits generated exports. |
| Legacy VM reads templates from a mounted path | Azure Files | The software expects a filesystem path. |
| VM needs an extra local working volume | Managed Disk | The workload needs block storage attached to one VM. |
| App stores business records | Azure SQL Database | Records need relationships, queries, and transactions. |

This table prevents a common mistake: choosing a mounted folder because it feels familiar. If the app does not need filesystem semantics, object storage is often simpler, more portable, and easier to use across compute runtimes.

## VM-Shaped Workloads

Disks and file shares are most natural around VM-shaped workloads. A VM needs an OS disk. It may need data disks. A legacy app may need a mounted file share. A migration may temporarily keep filesystem behavior while the team modernizes the application.

That does not mean every VM should keep important data locally. The stronger cloud habit is to ask what survives VM replacement. A rebuild should not destroy customer data. If the VM is replaced and the app cannot recover because data lived only on one disk, the architecture is fragile.

For the orders system, the legacy worker can use a data disk for scratch space and Azure Files for shared templates. Final exports move to Blob Storage. Business records stay in Azure SQL. Temporary files can be recreated.

## Putting It All Together

The opener had a legacy worker, batch scratch files, shared templates, and final exports. Managed Disks and Azure Files solve only the parts that need disk or folder behavior.

Managed Disks attach block storage to VMs. OS disks boot machines. Data disks support VM-local workload storage. Temporary storage is disposable. Azure Files gives managed shared folders. Blob Storage remains the better first home for generated files that should outlive compute and be downloaded later.

Use disks and file shares when the workload truly needs operating-system storage. Do not let a familiar folder path become the default design for cloud application data.

## What's Next

Next we will look at Backups and Retention, because storage is only trustworthy when the team knows how to recover from deletion, corruption, and bad changes.

---

**References**

- [Azure Managed Disks overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)
- [What is Azure Files?](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-introduction)
- [Azure Files planning guide](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-planning)
- [Temporary disk on Azure VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview#temporary-disk)
