---
title: "Disks and File Shares"
description: "Understand when Azure workloads need VM-attached block storage or shared mounted folders instead of object storage APIs."
overview: "Managed Disks and Azure Files provide operating-system storage contracts. This article explains block devices, shared filesystems, host caching, VM limits, temporary storage, and when Blob Storage is the simpler choice."
tags: ["azure", "managed-disks", "azure-files", "vm", "file-shares"]
order: 5
id: article-cloud-providers-azure-storage-databases-disks-file-shares
aliases:
  - azure-managed-disks-and-file-shares
  - cloud-providers/azure/storage-databases/azure-managed-disks-and-file-shares.md
---

## Table of Contents

1. [What Is a Disk or File Share](#what-is-a-disk-or-file-share)
2. [Blob Storage Comparison](#blob-storage-comparison)
3. [Managed Disks](#managed-disks)
4. [Temporary Storage](#temporary-storage)
5. [Disk Performance](#disk-performance)
6. [Host Caching](#host-caching)
7. [Shared Disks](#shared-disks)
8. [Azure Files](#azure-files)
9. [File Locking and Protocols](#file-locking-and-protocols)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is a Disk or File Share

Managed Disks and Azure Files provide storage through operating system paths instead of object or database APIs. They are useful when the workload expects a disk device, a mounted folder, or normal filesystem calls.

![Azure managed disk versus Azure Files share showing block storage attached to one VM and shared file storage over the network](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/disk-vs-file-share.png)

*Managed Disks attach block storage to a VM; Azure Files exposes a shared filesystem over the network.*


A managed disk is block storage attached to a virtual machine. The guest operating system sees it as a disk, formats it, mounts it, and reads or writes blocks through the OS storage stack. A file share is a network-mounted folder that multiple clients can access using SMB or NFS.

Example: a vendor application running on a VM may require a data drive mounted at `/var/lib/vendor`. A legacy report generator may require a shared folder at `/mnt/templates` across two VMs. Those are operating system storage contracts, so Managed Disks and Azure Files are the relevant Azure services to understand.

## Blob Storage Comparison

Blob Storage is usually the simpler choice when the application can use an object API for files. A generated PDF, uploaded image, CSV export, or log archive usually does not need a mounted filesystem. It needs durable object storage and a secure URL or SDK operation.

Managed Disks and Azure Files fit a narrower set of needs. Choose them when the workload truly needs filesystem semantics, block-device behavior, shared mounts, or compatibility with software that cannot be changed easily.

| Need | Better first choice | Reason |
| --- | --- | --- |
| Customer receipt PDF download | Blob Storage | Object API, durable bytes, SAS links, no VM dependency |
| VM boot volume | Managed Disk | Operating system needs a block device |
| Self-managed database on a VM | Managed Disk | Database engine writes to local files and logs |
| Shared legacy templates | Azure Files | Multiple hosts need the same mounted path |
| Temporary build cache | VM temporary disk or scratch storage | Data can disappear without business loss |

The decision is about the access contract. If the app can ask a service for an object by name, use object storage. If the app must call `open()`, `read()`, `write()`, `fsync()`, or mount a path, use a disk or file share shape.

## Managed Disks

A managed disk is Azure-managed block storage for a virtual machine. The VM sees it as a disk device, while Azure manages the backing storage resource, durability behavior, and integration with VM attachment.

Example: `disk-orders-db-prod` can be attached to `vm-orders-db-01` as a data disk. Inside Linux, the disk may appear as a device such as `/dev/sdc`, then be formatted and mounted at `/var/lib/postgresql`.

The important boundary is attachment. A normal managed disk is attached to one VM for ordinary use. That makes it a good fit for a single VM's operating system or data path. It does not make a shared folder for several application servers. If several machines need the same directory, Azure Files is usually the simpler managed service.

Managed Disks come in different performance and cost tiers, including Standard HDD, Standard SSD, Premium SSD, Premium SSD v2, and Ultra Disk. The right disk type depends on latency, IOPS, throughput, size, and cost needs.

## Temporary Storage

Temporary storage is scratch space that can disappear when a VM is moved, redeployed, resized, stopped, or replaced. Many Azure VM sizes include a temporary disk or local temporary path. It can be useful for caches, sort space, build outputs, swap, and intermediate files.

Temporary storage should not hold business data. If losing the data would require customer recovery, billing repair, manual reconstruction, or a database restore, it is not temporary data.

Example: a worker can use temporary storage while converting a large image, because the job can retry from the original blob. The same worker should not keep the only copy of the uploaded image on temporary storage. The original belongs in Blob Storage or another durable service.

The beginner rule is to name the consequence of loss. If the answer is "the job reruns," temporary storage may fit. If the answer is "the customer loses data," use durable storage.

## Disk Performance

Disk performance is the amount of read and write work the VM and disk can complete. It is shaped by disk type, disk size, configured IOPS, configured throughput, caching mode, and the VM size itself.

![Azure disk performance envelope showing IOPS, throughput, latency, VM workload, and VM size limit](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/disk-performance-envelope.png)

*Disk performance is bounded by both disk configuration and the VM size that submits the I/O.*


Premium SSD v1 ties performance levels to disk sizes. Premium SSD v2 lets you configure size, IOPS, and throughput more independently. Ultra Disk targets very demanding workloads that need very low latency and high performance controls.

The VM size can become the bottleneck even when the disk is powerful. If the attached disk can handle `10,000` IOPS but the VM size can only submit `3,200` uncached IOPS, the workload is still capped by the VM. Azure Monitor metrics can show whether pressure is at the disk or VM boundary.

For databases, watch latency and queue depth. A growing disk queue means requests are arriving faster than the storage path can complete them. The fix may be disk tier, VM size, caching, query behavior, or database layout.

## Host Caching

Host caching is a read or write buffer on the VM host placed in front of the managed disk path. It can improve some workloads, but it must match the durability needs of the data.

Example: a read-heavy data file may benefit from ReadOnly caching because repeated reads can come from host cache. A transaction log should usually avoid write caching because a database commit must not be acknowledged before the write is durable.

The main caching modes are:

| Mode | Practical meaning | Common fit |
| --- | --- | --- |
| None | Reads and writes go to the storage path without host cache | Transaction logs and write-sensitive data |
| ReadOnly | Reads can be cached, writes still go through safely | Read-heavy data files and static content |
| ReadWrite | Reads and writes can use host cache | Temporary or scratch workloads that can tolerate loss |

The risk is not that caching is bad. The risk is using the wrong caching mode for the file type. Databases treat log writes differently from cache files. The storage settings should reflect that difference.

## Shared Disks

Shared disks are managed disks that can be attached to more than one VM for specialized clustered workloads. They do not turn a normal disk into a safe shared folder by themselves.

Example: a failover cluster may attach the same shared disk to two VMs, but cluster software controls which node writes. The operating system and application must understand the clustered storage model.

If two ordinary VMs mount and write the same block filesystem at the same time without cluster-aware coordination, they can corrupt the filesystem. Use shared disks only for workloads designed for them. For normal shared files, use Azure Files.

## Azure Files

Azure Files is Azure's managed file share service. It provides SMB and NFS shares that clients can mount from Azure or supported network paths. It is useful when a workload expects a shared directory rather than an object API.

Example: three VMs running a legacy content workflow can mount an Azure Files share at `/mnt/templates` so they all read the same template files. A Windows workload may mount a share through SMB. A Linux workload may use NFS where that protocol fits the requirements.

Azure Files removes the need to operate your own file server VM for many scenarios. The team still needs to design identity, network access, protocol choice, performance tier, backup, and recovery behavior.

## File Locking and Protocols

File locking is the coordination that prevents clients from trampling each other's file changes. It matters because multiple machines may open the same file at the same time.

SMB is commonly used by Windows workloads and supported Linux clients. It includes mature file sharing behavior, access controls, and locking semantics. NFS is common in Linux and Unix-style environments and uses its own state and lease behavior. Azure Files supports both, but the exact feature set and performance choices depend on account type, tier, and protocol.

Example: if two report workers open `month-end.csv`, the file protocol has to coordinate caching and writes. One client may need to flush changes before another client can safely write. That protocol overhead is part of the cost of shared filesystem semantics.

If the application does not need shared file semantics, avoid paying this complexity tax. Use Blob Storage for object-like files. Use Azure Files when the mounted directory is truly part of the workload contract.

## Putting It All Together

Managed Disks and Azure Files are for workloads that need operating system storage behavior. Managed Disks give a VM block devices for boot volumes, data volumes, and VM-bound software. Azure Files gives multiple clients a managed shared directory through SMB or NFS.

Use Blob Storage for object-shaped files whenever the application can work through APIs or signed URLs. Use Managed Disks when the workload needs a disk attached to one VM. Use Azure Files when several clients need the same mounted path. Treat temporary storage as disposable. Match caching and performance settings to the actual file type and loss tolerance.

## What's Next

Next we look at Backups and Retention, where the question becomes what previous copy exists and how the team can restore it safely.


![Azure disk snapshot consistency window showing app writes, memory buffer, managed disk, snapshot, crash consistency, and app consistency](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/snapshot-consistency-window.png)

*Use this as the attached-storage recovery reminder: snapshots are most useful when the application has flushed the writes that matter.*

---

**References**

* [Azure managed disk types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types) - Disk type choices and performance targets.
* [Azure premium storage performance](https://learn.microsoft.com/en-us/azure/virtual-machines/premium-storage-performance) - VM and disk performance considerations, including host caching.
* [Azure managed disks overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Managed disk concepts and VM attachment.
* [Plan for an Azure Files deployment](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-planning) - SMB, NFS, tiers, and deployment planning.
* [Improve SMB Azure file share performance](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-smb-multichannel-performance) - SMB performance and protocol considerations.
