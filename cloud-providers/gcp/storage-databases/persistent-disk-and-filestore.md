---
title: "Persistent Disk and Filestore"
description: "Choose between Persistent Disk and Filestore when GCP compute needs block storage or a shared filesystem instead of object storage or a database."
overview: "Not every storage need starts with an API. Some workloads need a disk attached to compute, and some need a shared file path. This article explains Persistent Disk and Filestore through the workloads that make those shapes necessary."
tags: ["gcp", "persistent-disk", "filestore", "attached-storage"]
order: 6
id: article-cloud-providers-gcp-storage-databases-persistent-disk-filestore
aliases:
  - persistent-disk-and-filestore
  - attached-storage
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Attached Storage](#attached-storage)
3. [Persistent Disk](#persistent-disk)
4. [Block Storage](#block-storage)
5. [Snapshots](#snapshots)
6. [Placement](#placement)
7. [Filestore](#filestore)
8. [Shared Files](#shared-files)
9. [Cloud Storage Comparison](#cloud-storage-comparison)
10. [Sample Storage Shape](#sample-storage-shape)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Problem

The storage module has covered objects, relational records, document data, and analytics tables. Then a different kind of workload appears.

- A Compute Engine worker needs durable local disk space while rebuilding a search index.
- A vendor tool expects input files in `/mnt/incoming` and writes output beside them.
- Several VMs need to share a file tree.
- A GKE workload needs storage that can be mounted into Pods.

These are attached-storage questions. The workload asks for a disk or filesystem path, not an object API, SQL table, document path, or analytics warehouse.

## Attached Storage

Attached storage means storage presented to compute as a disk or filesystem. The application or tool reads and writes through operating-system paths. That can be the right model when the software expects a mounted device or shared directory.

Attached storage is powerful because it matches traditional server behavior. It is risky when teams use it as a reflex. A file path on a VM can feel simple until the VM is replaced, the disk is full, the zone fails, or multiple workers need safe shared access.

The first question is: does the workload truly need storage attached to compute, or would an object, database, or analytics service express the data better?

## Persistent Disk

Persistent Disk is block storage for Compute Engine and supported GCP workloads. A disk can be attached to a VM so the operating system sees it as a block device. The VM formats it with a filesystem and mounts it at a path.

This is a good fit for durable local state tied to a VM-shaped workload: database data disks for self-managed databases, working storage for an index builder, or application data that a server process expects to find on a mounted volume.

Persistent Disk is not a replacement for Cloud Storage receipts or Cloud SQL order records. It is storage attached to compute. If the app needs to fetch one receipt by object name, Cloud Storage is clearer. If it needs transactions between orders and payments, Cloud SQL is clearer.

## Block Storage

Block storage gives the operating system a device. The filesystem, file permissions, mount options, and application process decide how files appear.

That means your team owns more of the operating behavior. If the disk is not mounted after reboot, the app may start with an empty path. If the filesystem fills, writes fail. If a disk is zonal and the VM moves, placement becomes part of recovery.

Block storage is honest when the software needs a disk. It is extra operational surface when the data really wanted a managed API.

## Snapshots

Snapshots capture a point-in-time copy of a disk. They are useful for backup, migration, cloning, and rollback patterns around disk-shaped state.

A snapshot is not the same thing as application consistency. If the app is writing while the snapshot is taken, the snapshot may capture an on-disk state the application still needs to recover from. For databases or important state, coordinate snapshots with application flush, quiesce, or database backup procedures where required.

Snapshot review should answer:

```text
disk: orders-worker-index
attached to: orders-indexer-01
snapshot schedule: daily
restore target: new worker disk in us-central1
consistency: app can rebuild index from source if snapshot is stale
```

The restore target matters as much as the snapshot.

## Placement

Persistent Disk placement matters. Disks are zonal or regional depending on type and configuration. A zonal disk lives in one zone. A regional disk replicates across zones in a region for higher availability patterns.

That placement should match the workload. A low-risk worker scratch disk may be zonal. A more important VM workload may need regional disk or an application-level recovery design. If the data can be rebuilt from Cloud Storage or BigQuery, the disk recovery requirement may be lower.

Placement is where attached storage becomes more than "add a disk." It ties data to compute failure behavior.

## Filestore

Filestore is managed file storage. It provides a filesystem that clients can mount, commonly through NFS. This is useful when multiple clients need a shared directory tree or when software expects a POSIX-like filesystem rather than an object API.

Examples include shared media processing workspaces, application migration paths, machine learning datasets for workloads that expect files, or vendor tools that read and write from shared directories.

Filestore is a better fit than Cloud Storage when the workload truly needs shared file semantics. Cloud Storage is a better fit when the app wants durable named objects through an object API.

## Shared Files

Shared files create coordination questions. If several workers write to the same path, who owns file names? What happens when two writers update the same file? How are permissions managed? How is throughput monitored?

The filesystem makes sharing feel simple, but the application still needs rules. A shared directory without ownership conventions can become an unstructured dumping ground.

For a vendor import workflow, a simple convention might be:

| Path | Owner | Meaning |
| --- | --- | --- |
| `/mnt/incoming` | Upload process | Files waiting to be processed |
| `/mnt/processing` | Worker | Files currently claimed |
| `/mnt/complete` | Worker | Finished result files |
| `/mnt/error` | Worker | Inputs that failed validation |

The path structure is part of the application protocol.

## Cloud Storage Comparison

Cloud Storage and Filestore can both hold file-like data, but they do not behave the same way.

| Need | Better first thought |
| --- | --- |
| Store receipt PDF by object name | Cloud Storage |
| Give customer a temporary download URL | Cloud Storage signed URL |
| Mount a shared directory for legacy software | Filestore |
| Attach a durable local disk to one VM | Persistent Disk |
| Analyze many event rows | BigQuery |

Cloud Storage is object storage. Persistent Disk is block storage. Filestore is file storage. Those words matter because they describe how the workload interacts with the data.

## Sample Storage Shape

For the Orders system, attached storage might look like this:

| Workload | Storage | Why |
| --- | --- | --- |
| Search index rebuild worker | Persistent Disk | Needs local working data tied to one VM |
| Vendor import tool | Filestore | Expects shared mounted directories |
| Receipt PDFs | Cloud Storage | Object bytes with signed access |
| Checkout records | Cloud SQL | Relational state and transactions |

The first two are attached-storage cases. The second two are not, even though all four involve data.

## Putting It All Together

Return to the opening problems.

The index rebuild worker needs disk-shaped working space. Persistent Disk fits when the VM or workload needs a mounted block device.

The vendor tool expects a directory tree. Filestore fits when several clients or migrated software need shared file semantics.

Snapshots help protect disk-shaped data, but restore and consistency still need thought.

Cloud Storage remains the better object home for receipts and exports. Attached storage is for workloads that truly need a disk or filesystem path.

## What's Next

The module has now mapped the main data shapes. The final storage question is recovery: what previous copy exists when data is corrupted, overwritten, or deleted?

---

**References**

- [Google Cloud: Persistent Disk documentation](https://cloud.google.com/compute/docs/disks)
- [Google Cloud: Filestore overview](https://cloud.google.com/filestore/docs/overview)
- [Google Cloud: Create and manage disk snapshots](https://cloud.google.com/compute/docs/disks/create-snapshots)
- [Google Cloud: Regional Persistent Disk](https://cloud.google.com/compute/docs/disks/regional-persistent-disk)
