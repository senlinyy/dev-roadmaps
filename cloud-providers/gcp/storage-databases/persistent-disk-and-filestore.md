---
title: "Persistent Disk and Filestore"
description: "Use Google Cloud Persistent Disk, Hyperdisk, and Filestore for VM and legacy workloads that need block devices, mounted paths, shared NFS folders, snapshots, permissions, and locking."
overview: "Some workloads still need filesystem paths. The guide follows a self-hosted database and shared rendering workers through Persistent Disk, Hyperdisk, block storage, formatting, mounting, snapshots, Filestore, NFS, permissions, and locking."
tags: ["gcp", "persistent-disk", "filestore", "attached-storage"]
order: 6
id: article-cloud-providers-gcp-storage-databases-persistent-disk-filestore
aliases:
  - persistent-disk-and-filestore
  - attached-storage
---

## Table of Contents

1. [Why Do Some Programs Need a Filesystem Path?](#why-do-some-programs-need-a-filesystem-path)
2. [How Do Persistent Disk and Hyperdisk Behave Like Disks?](#how-do-persistent-disk-and-hyperdisk-behave-like-disks)
3. [How Do Formatting, Mounting, and Permissions Create a Usable Path?](#how-do-formatting-mounting-and-permissions-create-a-usable-path)
4. [What Does a Disk Snapshot Preserve?](#what-does-a-disk-snapshot-preserve)
5. [Why Is One Writable Filesystem Hard to Share Across Machines?](#why-is-one-writable-filesystem-hard-to-share-across-machines)
6. [How Does Filestore Provide a Shared NFS Filesystem?](#how-does-filestore-provide-a-shared-nfs-filesystem)
7. [How Do Identity, Permissions, and Locks Protect Shared Files?](#how-do-identity-permissions-and-locks-protect-shared-files)
8. [How Do You Choose Between Block, File, and Object Storage?](#how-do-you-choose-between-block-file-and-object-storage)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Some applications do not issue object API requests, SQL queries, or document reads. They call operations such as:

```text
open("/var/lib/myapp/data.db")
seek(...)
write(...)
rename(...)
fsync(...)
```

They may create directories, change permissions, lock files, and overwrite small byte ranges. These are **filesystem semantics**. Linux packages, SQLite, PostgreSQL, MySQL, Git, legacy enterprise systems, media tools, scientific software, and content-management systems commonly assume this interface. A self-hosted PostgreSQL engine ultimately writes its pages and logs under ordinary paths; it does not naturally think in Cloud Storage objects.

Object storage offers a different contract: upload, download, delete, and list named objects. That is excellent for photographs, videos, archives, backups, and other large immutable payloads. It does not automatically supply the operating-system behavior expected by `open`, `seek`, small overwrites, and `fsync`.

The first decision is therefore an interface question:

```text
Does the program address named objects through an API?
→ object storage may fit

Does it require ordinary files and directories?
→ it needs disk or file-storage semantics
```

Keep these questions in view as you work through the lesson:

1. **Why Do Some Programs Need a Filesystem Path?**
2. **How Do Persistent Disk and Hyperdisk Behave Like Disks?**
3. **How Do Formatting, Mounting, and Permissions Create a Usable Path?**
4. **What Does a Disk Snapshot Preserve?**
5. **Why Is One Writable Filesystem Hard to Share Across Machines?**
6. **How Does Filestore Provide a Shared NFS Filesystem?**
7. **How Do Identity, Permissions, and Locks Protect Shared Files?**
8. **How Do You Choose Between Block, File, and Object Storage?**

## Why Do Some Programs Need a Filesystem Path?
<!-- section-summary: Filesystem-oriented software expects paths and file operations, which require a filesystem above persistent storage. -->

To understand those semantics, start with a physical disk. At a low level, the operating system does not initially see `/photos` or `report.txt`. It sees addressable units:

```text
block 0 | block 1 | block 2 | block 3 | ...
```

**Block storage** can read or write ranges of blocks. It does not inherently understand filenames, directories, owners, or `/home`. A **filesystem** such as `ext4` adds that structure. It tracks directory entries, free space, file ownership, timestamps, and the mapping between file contents and blocks.

The complete stack is:

```text
application
    │ open("/data/file")
    ▼
filesystem
    │ block reads and writes
    ▼
block device
    ▼
storage hardware or service
```

This layered model explains why a blank cloud disk is not yet a directory, why formatting and mounting are separate steps, and why a block-storage service is infrastructure for a database rather than a database itself.

### Translate one file write through the stack

When a process changes bytes in `/data/inventory.db`, the application first issues ordinary file operations. The filesystem decides which data and metadata blocks must change, how its journal records the operation, and when the write becomes stable. The block device receives block-level I/O without understanding that those bytes represent inventory. Persistent Disk or Hyperdisk persists logical blocks without understanding filenames.

That ownership boundary matters during incidents. A missing `/data` path might mean the volume was never attached, the filesystem was not mounted, or a startup mount failed. A present but read-only path may indicate filesystem state or mount options. A writable path followed by database corruption may belong to the engine or application rather than the block service. Naming the layer prevents random fixes at the wrong boundary.

## How Do Persistent Disk and Hyperdisk Behave Like Disks?
<!-- section-summary: Google Cloud block volumes give Compute Engine durable network-backed devices whose lifetimes and performance can be managed separately from VMs. -->

Persistent Disk gives a Compute Engine VM a network-backed block device. The guest operating system experiences it much like a physical disk, while reads and writes travel through Google infrastructure to distributed managed storage. Its data is not tied to the physical host currently running the VM.

That is the significance of **persistent**. Compute and storage can have separate lifetimes:

```text
VM 1 attached to Disk A
        ↓
detach Disk A
        ↓
delete VM 1
        ↓
create VM 2
        ↓
attach Disk A
```

This model supports operating-system boot disks, database files, application state, VM-hosted repositories, persistent caches, and legacy software. A **boot disk** contains the operating system and its root filesystem. A separate **data disk** can hold `/var/lib/postgresql` or `/data`. Separating them can make it possible to replace a damaged boot environment while retaining an application data volume, depending on the workload design.

Google Cloud also offers **Hyperdisk**, its newer durable block-storage family. Google recommends Hyperdisk for supported workloads, while Persistent Disk remains available where Hyperdisk does not fit or is unavailable. Both expose the same broad abstraction:

```text
VM → block device
```

Hyperdisk makes capacity and performance more independently configurable. Depending on volume type, a team can provision capacity, input/output operations per second, and throughput, then adjust supported performance settings while the volume remains in use. Hyperdisk Balanced is positioned for many general-purpose workloads; other types target high IOPS, throughput-heavy workloads, machine learning, or high-availability needs.

**IOPS** means input/output operations per second. Many small random 4 KiB reads and writes, as a database page workload may produce, can be IOPS-sensitive. **Throughput** measures the amount of data transferred per second, such as MiB/s or GiB/s. A workload that reads 100 GB sequentially may care more about throughput. Latency is another dimension: it describes how long one operation takes.

These measures are not interchangeable:

```text
many small random database operations
→ IOPS and latency matter greatly

large sequential scanning or streaming
→ throughput often dominates
```

![Disk and file share choices](/content-assets/articles/article-cloud-providers-gcp-storage-databases-persistent-disk-filestore/disk-file-share-choices.png)
*Block storage normally belongs to one coordinated machine, while a file service mediates a namespace shared by multiple clients.*

Choosing a disk therefore requires more than capacity. The team must understand block performance, attachment and availability needs, expected filesystem, and the workload's recovery plan.

### Keep capacity, IOPS, throughput, and latency separate

A one-terabyte capacity requirement says how much logical data the volume must hold. It does not state how quickly that data must move. A database issuing thousands of small random reads can exhaust IOPS while transferring relatively few megabytes per second. A media scanner can reach a throughput ceiling through large sequential operations while its operation count remains modest.

Measure the shape the workload generates: typical I/O size, random or sequential access, read/write mix, required latency, peak operations, and sustained transfer. Hyperdisk's supported ability to provision performance characteristics separately makes those requirements explicit instead of assuming that buying more capacity automatically produces the required behavior.

Boot and data disks also have different operational roles. Recreating an operating system from an image is often easier than reconstructing authoritative database files. Separating data can give it an independent lifecycle, snapshot schedule, and replacement process. The separation helps only when the application actually stores its important state on that data volume and the recovery procedure knows how to reattach and mount it.

## How Do Formatting, Mounting, and Permissions Create a Usable Path?
<!-- section-summary: Attaching a disk exposes blocks; formatting creates a filesystem, mounting connects it to the directory tree, and permissions admit the application. -->

Attaching a new disk may make `/dev/sdb` appear, but it does not automatically create `/data`. The device is a block interface. A new blank device generally needs to be formatted and mounted before applications can store normal files.

**Formatting** writes filesystem structures onto the blocks. Creating `ext4`, for example, establishes free-space metadata, inode structures, a journal, and a filesystem identity. Formatting is destructive to existing filesystem content, so an existing disk that already contains a filesystem should be mounted rather than reformatted.

After formatting, **mounting** connects the filesystem to one point in Linux's single directory tree:

```text
/dev/sdb filesystem
        ↓ mount
      /data
        ├── database.db
        └── uploads/
```

The application opens `/data/file.txt`; the filesystem maps that request to blocks on the attached volume. Google recommends stable identifiers such as a filesystem UUID instead of relying only on device names that can change.

A manual mount disappears from the namespace after a reboot until it is recreated. `/etc/fstab` records filesystems that should mount during startup. This exposes an important boundary: cloud attachment and guest mounting are different operations. An administrator may successfully attach the volume while the operating system has not mounted it anywhere useful.

Filesystem permissions form another layer. Suppose `/data` is mounted but owned by `root`, while the application runs as user `app`. The program can still receive “Permission denied.” A complete success path is:

```text
volume exists
    ↓
attached to VM
    ↓
correct filesystem exists
    ↓
mounted at intended path
    ↓
owner and permissions admit the process
    ↓
application can read or write
```

Troubleshooting should identify the failing layer rather than collapsing all failures into “the disk is broken.”

This stack works naturally for a self-hosted database:

```text
PostgreSQL
    ↓ database files and WAL
/var/lib/postgresql
    ↓
ext4
    ↓
Hyperdisk or Persistent Disk
```

PostgreSQL supplies tables, queries, transactions, indexes, locks, and database recovery. The filesystem supplies files and directories. The block service supplies durable blocks. Cloud SQL is a different choice because Google operates the database service itself; with self-hosted PostgreSQL, the team remains responsible for the database and guest filesystem.

![Persistent Disk lifecycle](/content-assets/articles/article-cloud-providers-gcp-storage-databases-persistent-disk-filestore/persistent-disk-lifecycle.png)
*A usable and recoverable disk passes through attachment, filesystem creation, mounting, verification, snapshot, and restore.*

## What Does a Disk Snapshot Preserve?
<!-- section-summary: A snapshot records historical block state for reconstruction, while application coordination determines whether that state is transactionally meaningful. -->

If today's disk becomes unusable tomorrow, the team needs historical state. Compute Engine supports snapshots for Persistent Disk and Hyperdisk. Standard snapshots are incremental: the first captures the disk state, while later snapshots store new or changed blocks and refer to unchanged data already preserved.

A snapshot is not normally another writable mounted filesystem. It is a preserved disk state from which a new disk can be created:

```text
current disk
    ↓ snapshot
historical state
    ↓ restore
new disk
    ↓ attach and mount
recovery VM
```

Snapshots can be taken from attached running disks, but the word “snapshot” does not automatically imply application consistency. By default, a disk snapshot is **crash consistent**: it resembles the on-disk state after sudden power loss at that instant. Journaling filesystems and databases may be designed to recover from such a state, but a cleaner application boundary may require more coordination.

For an **application-consistent** snapshot, the workload can pause or quiesce changes, finish transactions, flush application buffers, sync the filesystem, capture the snapshot, and resume activity. The application knows which related writes form one logical operation; the storage service only sees blocks.

Google documents guest-coordinated application-consistent procedures for Persistent Disk. Hyperdisk workloads that need application consistency currently require suitable workload-level coordination because Hyperdisk does not support the same `guest-flush` mechanism. The mechanism differs, but the principle remains: storage cannot infer database transaction boundaries from block writes alone.

Snapshot policy also differs from high availability. A snapshot helps recover older state. Replication or an HA design keeps current service available through infrastructure failure. If an application deletes the wrong directory, a highly available system can replicate that deletion. Historical recovery and current availability solve different failures.

### Plan a snapshot as a reconstruction path

The useful unit is not “a snapshot exists.” The useful sequence is: select the intended point, create a new volume from it, attach that volume to an isolated VM, mount the existing filesystem without formatting it, run filesystem or application recovery if required, and validate the data. Treating the snapshot as an immediately browsable directory skips the reconstruction step.

Incremental storage does not make later snapshots disposable manual deltas. The service can reference unchanged blocks while presenting each retained snapshot as a recovery point. Operationally, the team chooses one snapshot and creates a disk; the provider manages its incremental representation.

For a running database, coordinate the desired consistency level before capture. Crash consistency can be appropriate when the engine and filesystem recover exactly as after power loss. Application consistency is stronger when the business needs a deliberately quiet checkpoint, but quiescing writes can affect availability. The plan must say who initiates the pause, how buffers are flushed, how long the pause may last, and how the team confirms activity resumed.

## Why Is One Writable Filesystem Hard to Share Across Machines?
<!-- section-summary: Ordinary filesystems assume coordinated ownership, so attaching the same writable block device to independent hosts can corrupt shared metadata. -->

Scaling from one VM to three introduces a new requirement: all of them may need `/shared/uploads`. It is tempting to attach one block volume to every VM and mount the same ordinary filesystem. The danger lies in filesystem ownership.

Each operating system may cache and update directory metadata, free-space maps, file allocations, and locks while assuming it controls the disk. VM A and VM B can modify the same structures without understanding each other's state. Ordinary single-instance filesystems such as EXT4, XFS, and NTFS are not automatically safe shared-writer filesystems. Without suitable clustering and fencing, simultaneous writers can corrupt data.

Google Cloud supports specialized multi-writer Hyperdisk configurations, but they require software designed to coordinate shared block access. Multi-attach is not a shortcut that turns a single-node application into a distributed one.

The simpler shared-file design places one file server in the middle:

```text
VM A ─┐
VM B ─┼──→ file server → underlying filesystem
VM C ─┘
```

The server mediates opening, reading, writing, renaming, status, and locking operations. It becomes the coordinator for one shared namespace. This is the basic model of network file storage.

**NFS**, the Network File System protocol, lets Unix and Linux clients mount a remote filesystem into the local directory tree. An application still sees `/shared/report.csv`, but operations cross the network to the NFS server. That network boundary adds latency, connectivity, identity, permissions, and distributed-locking concerns that do not exist in exactly the same form on a local disk.

### Shared blocks and shared files assign coordination differently

In a specialized shared-block system, the participating application or clustered filesystem understands that several hosts see the same blocks. It supplies cluster membership, fencing, shared metadata coordination, and recovery after one writer fails. Hyperdisk multi-writer support provides the shared block capability, not the complete clustered application design.

In a file service, Filestore owns the shared filesystem and mediates operations over NFS. Clients still need application-level coordination, but they are not independently changing one `ext4` free-space map. This is why “many ordinary clients need the same files” and “cluster-aware software needs shared blocks” are different requirements.

One client can also mount Filestore incorrectly or lose its network path while other clients remain healthy. Troubleshooting therefore expands from device, filesystem, mount, and permissions to include routing, firewall behavior, NFS protocol negotiation, server reachability, and client identity.

## How Does Filestore Provide a Shared NFS Filesystem?
<!-- section-summary: Filestore supplies the managed filesystem server, so several clients mount the same paths without creating the underlying filesystem themselves. -->

Filestore is Google Cloud's managed NFS file-storage service. Multiple clients can mount the same share and observe the same namespace:

```text
                 Filestore
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
        VM A      VM B      VM C
     /mnt/shared /mnt/shared /mnt/shared
```

Filestore supports NFS protocols, including NFSv4.1 on current Zonal, Regional, and Enterprise tiers. The mount command may look conceptually similar to a local filesystem mount, but the ownership model underneath is different.

With Persistent Disk or Hyperdisk, the guest receives raw logical blocks, chooses a filesystem, formats it, chooses a mount point, and manages the filesystem. With Filestore, Google supplies an already existing network filesystem. The client mounts `server:/share` at `/shared`; it does not run `mkfs.ext4` against Filestore.

This distinction explains the usual workloads. A rendering farm may need `/assets/models`, `/assets/textures`, and `/jobs/output` on every worker. Legacy applications may require shared NFS content. Media pipelines, high-performance-computing workloads, shared home directories, and content repositories can all depend on ordinary shared paths.

Persistent Disk and Hyperdisk usually mean “disk for a machine.” Advanced shared block modes exist for coordinated software, but a requirement that simply says “many clients need one managed file share” normally points to Filestore.

Filestore also supports snapshots. A Filestore snapshot preserves a point-in-time view inside the instance using copy-on-write-style mechanics. Creation does not require an immediate duplicate of all data, while later changes can consume capacity because older file data must remain available. Supported tiers can recover individual files and may offer broader revert behavior.

Consistency still requires application reasoning. Filestore can preserve NFS stable writes and commits, but it cannot know that seventeen files together form one business transaction. A workload that needs application-consistent snapshot state may need to quiesce activity and unmount as appropriate before capture.

Filestore snapshot recovery and Filestore high availability remain separate concerns. Replication or resilient service tiers aim to continue current service. Snapshots preserve history. A deletion can be replicated just as faithfully as a desired write.

### Follow a rendering share through normal work and recovery

Suppose rendering workers mount one Filestore share at `/assets`. A producer writes a model file, and several workers read it. The file server provides one shared directory entry and data state rather than requiring object downloads or per-VM disk synchronization. POSIX permissions decide which worker identities can read or write the paths.

If a worker accidentally replaces the model, a Filestore snapshot can preserve older file-share state. Recovering one file from snapshot state differs from failing over the current file service after infrastructure loss. If the application writes a logical asset across several files, quiescing or coordinating the producer before snapshot may be required to make the group meaningful.

Capacity planning must account for current data and copy-on-write history. A snapshot can be quick to create because unchanged data is shared internally, while later overwrites preserve older blocks and consume capacity. A snapshot policy therefore needs retention and capacity monitoring rather than an assumption that snapshots have no storage effect.

## How Do Identity, Permissions, and Locks Protect Shared Files?
<!-- section-summary: IAM controls the Filestore resource, while network reachability, Unix identities, POSIX permissions, NFS authentication, and locks govern actual file use. -->

Filestore has more than one access layer. IAM controls the service resource: who may create, resize, inspect, or delete a Filestore instance. It does not by itself decide whether Unix user Alice may open `/shared/payroll.csv`. File access belongs to filesystem and NFS controls.

Standard POSIX-style permissions associate files with an owner, group, and mode. A file such as `-rw-r----- alice finance report.csv` lets Alice read and write, lets the finance group read, and denies everyone else. Directory read, write, and execute bits control listing, entry changes, and traversal.

Unix permissions operate on numeric user and group identifiers, or UIDs and GIDs. If UID 1001 represents Alice on VM A but Bob on VM B, the NFS server sees the same numeric identity and can grant Bob Alice's effective access. Shared filesystems therefore require consistent identity mapping across clients. Google recommends consistent user permissions on connected Filestore clients to prevent privilege-escalation mistakes.

Traditional NFSv3 commonly uses the `sys` security model. The client reports a UID and GID, and the server trusts those values. Network restrictions and trustworthy clients therefore matter. NFSv3 was not built around strong end-user authentication.

Filestore NFSv4.1 can integrate with Managed Microsoft Active Directory and Kerberos for supported configurations. Its security flavours include:

```text
krb5  → authentication
krb5i → authentication plus message integrity
krb5p → authentication, integrity, and encryption in transit
```

This exposes four independent questions:

```text
Can the client reach Filestore?        → networking
Who is the client or user?             → authentication
May that identity open this file?      → permissions or ACLs
Can someone inspect network traffic?   → encryption
```

Concurrent access creates another problem. Two applications can read the same old file and then overwrite each other's independent changes. A **file lock** lets cooperating software signal that one participant is modifying the file while another should wait.

On Unix-like systems and NFS, locks are commonly **advisory**. A well-behaved application checks and respects the lock; a non-cooperating application can ignore the convention. The lock coordinates participants rather than creating an impenetrable wall around the bytes.

Distributed locking is harder than local locking because state crosses kernels and a network. It must account for delays, lost connections, client crashes, and server recovery. Filestore's NFSv4.1 uses lease-based advisory locking and stateful recovery behavior. NFSv3 locking has different operational behavior and may require firewall rules for its locking services.

This is especially important for database files. Storing `/shared/app.db` on NFS does not prove that several machines can safely open it as one distributed database. The engine must explicitly support the NFS version, locking and `fsync` semantics, network-partition behavior, and multiple-node access pattern. A shared filesystem cannot supply relational coordination the database engine was never designed to provide.

### Separate four checks before granting file access

Start with reachability: can the client route to the Filestore endpoint and pass required network controls? Then check authentication: under NFSv3 `sys`, the service commonly relies on client-reported numeric identity, while supported NFSv4.1 Kerberos configurations can provide stronger authentication. Next check authorization: do UID, GID, mode bits, or supported ACLs permit the operation? Finally check transport protection: does the selected security flavour provide only authentication, add integrity, or also encrypt traffic?

These questions explain why an IAM grant cannot repair a POSIX permission denial. IAM may let an administrator inspect the instance while the application user still lacks read permission on one file. Conversely, permissive modes do not help a client that cannot reach or mount the NFS endpoint.

Lock testing should include failure, not only the happy path. A process can crash while holding a lock, a connection can break, or a server can recover. Lease and recovery behavior determine when another client may proceed. An application whose correctness depends on locks should be tested against the selected NFS protocol and failure scenarios rather than assuming all network filesystems behave like one local kernel.

## How Do You Choose Between Block, File, and Object Storage?
<!-- section-summary: Choose the lowest-level interface the application actually requires, then assign filesystem ownership and recovery accordingly. -->

The three abstractions can be compared directly:

| Abstraction | Addressed unit | Google Cloud example | Filesystem owner |
|---|---|---|---|
| Block storage | Blocks or sectors | Persistent Disk, Hyperdisk | Guest operating system |
| File storage | Paths and files | Filestore | Managed file service |
| Object storage | Objects and keys | Cloud Storage | No ordinary POSIX filesystem required |

A single Compute Engine VM running PostgreSQL can use Hyperdisk Balanced, `ext4`, and `/var/lib/postgresql`. One database host needs a durable, performance-appropriate block device. PostgreSQL supplies the database behavior above it.

A legacy web application with four servers may insist that every upload appears immediately at `/app/uploads`. Giving each VM a separate disk creates four different namespaces; a file received by web-2 will be missing on web-1. Filestore can centralize that path for all servers.

Cloud Storage may still be a better redesign when the program can naturally upload and download complete objects. Multiple machines needing access to finished files does not by itself require NFS. Filestore is compelling for an application that truly depends on paths, directories, POSIX-like operations, NFS compatibility, and shared filesystem behavior.

A practical decision chain is:

```text
Does the application need ordinary filesystem paths?
        │
        ├── no → consider object or database services
        │
        └── yes
             ↓
Does one VM mainly own the writable filesystem?
        │
        ├── yes → Hyperdisk or Persistent Disk
        │          format, mount, permission, snapshot
        │
        └── no
             ↓
Do multiple machines require the same namespace?
        │
        ├── yes → Filestore and NFS
        │          network, identity, permissions,
        │          locking, snapshots
        │
        └── maybe → reconsider Cloud Storage or redesign
```

A combined architecture can give one database VM a Hyperdisk-backed local filesystem while several application workers mount Filestore for shared uploads. Every layer has one job: Hyperdisk persists blocks for one host; `ext4` turns them into local files; mounting gives them a path; Filestore supplies a shared filesystem; NFS carries remote file operations; POSIX permissions control files; locks coordinate cooperating users; and snapshots retain historical storage state.

The complete first-principles chain runs from application path, to filesystem, to block device for one owner—or from application path, through NFS, to a managed shared filesystem for many owners. Persistent Disk and Hyperdisk say “here are blocks; create and mount your filesystem.” Filestore says “here is a filesystem; mount it over NFS.” That distinction explains formatting, mounting, shared access, identity, permissions, locking, and why the products remain separate.

### Compare two complete ownership stacks

For one PostgreSQL VM, the engine owns database pages, transaction logs, indexes, and crash recovery. `ext4` owns filenames, allocation, journaling, and local file permissions. The guest owns formatting, mounting, `/etc/fstab`, operating-system users, and database operation. Hyperdisk owns durable network-backed blocks and their configured performance. A snapshot preserves block history but cannot decide whether the database was between related writes.

The operator must therefore validate the whole stack. The volume must attach to the intended VM, the existing filesystem must mount at `/var/lib/postgresql`, ownership must admit the database user, provisioned IOPS and throughput must match the engine's work, and snapshot restore must produce a volume the database can recover and use. Cloud SQL would move more database operation to Google, but a self-hosted VM keeps these responsibilities visible.

For four web servers sharing `/app/uploads`, Filestore owns the file service and one shared namespace. NFS transports each client's file requests. The clients own their mount points and consistent Unix identities. POSIX modes or supported ACLs decide file access, and application locks coordinate cooperating writers. A Filestore snapshot preserves file-share history but does not automatically turn a group of partially written files into one application-consistent transaction.

This second stack has no `mkfs.ext4` step on each client. Formatting belongs to the block-owned model. It does require network reachability and NFS protocol choices, which the local disk model does not expose in the same way.

### Decide whether shared data needs a filesystem at all

The four web servers may only need to upload finished photographs and download them later. If they can use object operations, Cloud Storage avoids mounting one network filesystem and can give every disposable server access to the same named objects. Prefix listing can provide organization without POSIX directories.

Filestore remains the right abstraction when the existing software performs directory scans, expects atomic file renames, uses file-oriented tooling, shares ordinary paths, or otherwise depends on NFS behavior. Persistent Disk or Hyperdisk remains the right abstraction when one coordinated host must own a writable filesystem and the application expects disk-like performance.

The decision should be made from the strongest required semantic operation, not from the sentence “we have files.” Almost every storage service can contain bytes that people call files; only some provide the exact path, mutation, sharing, and locking contract the software expects.

### Include recovery in the initial mount design

For block storage, document which snapshots cover boot and data volumes, which consistency level they provide, how a new disk is created, and how a recovery VM mounts it without formatting. For Filestore, document snapshot retention, file-level recovery or supported revert behavior, capacity consumed by preserved history, and application quiescing requirements.

Then separate recovery from availability. A resilient volume or Filestore tier can protect service against infrastructure failure while retaining the newest state. Snapshot history protects an older state after a harmful write. Neither automatically supplies the other's promise.

Finally, test permissions and locks after restore. Numeric identities may differ on a newly created VM, a missing NFS firewall path can prevent mounting, and an application may react differently to a recovered lock or crash-consistent database state. Recovery succeeds when the application can safely use the data, not merely when the provider creates a resource.

The last comparison is filesystem ownership. With block storage, the guest chooses and repairs the filesystem, manages its UUID, mount options, startup entry, permissions, and application-consistency procedure. With Filestore, Google supplies the filesystem service, while clients manage mounts, shared identity, permissions, protocol security, and application coordination. This boundary explains why a blank disk needs formatting and Filestore does not.

Document the expected writer model explicitly. “One VM” supports an ordinary single-instance filesystem. “Several clients” suggests a managed share. “Several cluster-aware nodes writing the same blocks” requires specialized software and fencing. If that sentence cannot be completed, attaching storage should wait until ownership is clear.

Use the same precision for performance and recovery. Record whether the workload is limited by random IOPS, sequential throughput, latency, or capacity; whether its snapshot is crash-consistent or application-consistent; and whether recovery creates a new disk or retrieves files from a Filestore snapshot. A statement such as “the data is persistent and snapshotted” leaves all of those operational choices unresolved. Persistence separates the data lifetime from compute, while tested reconstruction proves that the application can use an older state after the current one is wrong.

Also record protocol and identity assumptions for shared storage. NFSv3 client-reported UID/GID trust, NFSv4.1 Kerberos security flavours, POSIX modes, supported ACLs, and advisory locking are separate controls. A recovered share is not ready until clients map users consistently, reach the endpoint, mount the intended export, and coordinate file use under the same rules as production.

## Check Your Answers

:::expand[Why Do Some Programs Need a Filesystem Path?]{kind="recap"}
Filesystem-oriented software expects paths, directories, small writes, permissions, and locking. Those semantics require a filesystem above durable storage rather than only an object API.
:::

:::expand[How Do Persistent Disk and Hyperdisk Behave Like Disks?]{kind="recap"}
They provide durable network-backed block devices to Compute Engine. Hyperdisk is the recommended starting family where supported and can separate capacity from provisioned performance more explicitly.
:::

:::expand[How Do Formatting, Mounting, and Permissions Create a Usable Path?]{kind="recap"}
Formatting creates the filesystem, mounting connects it to the directory tree, `/etc/fstab` restores the mount at boot, and file permissions admit the application process.
:::

:::expand[What Does a Disk Snapshot Preserve?]{kind="recap"}
A snapshot preserves historical block state from which a new disk can be built. Application-consistent state requires workload coordination because storage sees blocks rather than transactions.
:::

:::expand[Why Is One Writable Filesystem Hard to Share Across Machines?]{kind="recap"}
Ordinary filesystems assume coordinated ownership. Independent hosts can corrupt shared filesystem metadata unless specialized clustering and fencing coordinate multi-writer block access.
:::

:::expand[How Does Filestore Provide a Shared NFS Filesystem?]{kind="recap"}
Filestore supplies the managed filesystem server. Several clients mount the same namespace over NFS without formatting the service as a local block device.
:::

:::expand[How Do Identity, Permissions, and Locks Protect Shared Files?]{kind="recap"}
IAM governs the Filestore resource; network access, UID/GID mapping, POSIX permissions or ACLs, NFS authentication, encryption, and advisory locks govern file use.
:::

:::expand[How Do You Choose Between Block, File, and Object Storage?]{kind="recap"}
Use block storage for one machine-owned filesystem, Filestore for a genuinely shared mounted namespace, and Cloud Storage when the application can work naturally with whole objects.
:::

## References

- [Persistent Disk](https://docs.cloud.google.com/compute/docs/disks/persistent-disks)
- [Hyperdisk overview](https://docs.cloud.google.com/compute/docs/disks/hyperdisks)
- [Format and mount a Linux disk](https://docs.cloud.google.com/compute/docs/disks/format-mount-disk-linux)
- [Compute Engine snapshots](https://docs.cloud.google.com/compute/docs/disks/snapshots)
- [Snapshot best practices](https://docs.cloud.google.com/compute/docs/disks/snapshot-best-practices)
- [Sharing disks between VMs](https://docs.cloud.google.com/compute/docs/disks/sharing-disks-between-vms)
- [Filestore NFSv4.1](https://docs.cloud.google.com/filestore/docs/configure-nfsv4)
- [Filestore IAM](https://docs.cloud.google.com/filestore/docs/iam)
- [Filestore access control](https://docs.cloud.google.com/filestore/docs/access-control)
- [Filestore supported protocols](https://docs.cloud.google.com/filestore/docs/about-supported-protocols)
- [Filestore snapshots](https://docs.cloud.google.com/filestore/docs/snapshots)
- [Filestore replication](https://docs.cloud.google.com/filestore/docs/instance-replication)
