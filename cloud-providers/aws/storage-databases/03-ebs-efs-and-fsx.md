---
title: "EBS, EFS, and FSx"
description: "Choose block or filesystem storage by understanding EBS disks, EFS shared Linux files, FSx specialist filesystems, placement, protocols, permissions, performance, and recovery."
overview: "EBS, EFS, and FSx all persist bytes but expose different storage intelligence. This article explains when an application needs raw blocks, a general shared filesystem, or a specific filesystem ecosystem."
tags: ["aws", "ebs", "efs", "fsx", "filesystems"]
order: 3
id: article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute
aliases:
  - ebs-and-efs-storage-attached-to-compute
  - ebs-efs-storage-attached-compute
  - ebs-efs-and-fsx
  - cloud-providers/aws/storage-databases/ebs-and-efs-storage-attached-to-compute.md
  - cloud-providers/aws/storage-databases/ebs-efs-and-fsx.md
---

## Table of Contents

1. [Which Storage Interface Does the Application Need?](#which-storage-interface-does-the-application-need)
2. [How Do EBS Placement and Attachment Work?](#how-do-ebs-placement-and-attachment-work)
3. [How Should You Size and Back Up EBS?](#how-should-you-size-and-back-up-ebs)
4. [How Do EFS Networking and Permissions Work?](#how-do-efs-networking-and-permissions-work)
5. [How Should You Think About EFS Performance and Cost?](#how-should-you-think-about-efs-performance-and-cost)
6. [How Do EBS, EFS, and FSx Permissions Differ?](#how-do-ebs-efs-and-fsx-permissions-differ)
7. [How Do Backup and Replication Differ?](#how-do-backup-and-replication-differ)
8. [Which Common Mistakes Should You Avoid?](#which-common-mistakes-should-you-avoid)
9. [Check Your Understanding](#check-your-understanding)
10. [References](#references)

The sections below answer these questions in order:

1. **Which Storage Interface Does the Application Need?**
2. **How Do EBS Placement and Attachment Work?**
3. **How Should You Size and Back Up EBS?**
4. **How Do EFS Networking and Permissions Work?**
5. **How Should You Think About EFS Performance and Cost?**
6. **How Do EBS, EFS, and FSx Permissions Differ?**
7. **How Do Backup and Replication Differ?**
8. **Which Common Mistakes Should You Avoid?**

## Which Storage Interface Does the Application Need?
<!-- section-summary: Start with whether software expects raw blocks, files and directories, or objects accessed through an API. -->

RAM is fast and volatile. When a machine reboots or fails, database pages, application files, and user data must survive somewhere persistent. “Persistent storage,” however, is not one interface.

At the lowest layer, storage can expose numbered **blocks**. The storage system understands requests such as “read block 59,281” and “write block 91,823.” It does not know that those blocks form `/photos/cat.jpg`. An operating-system filesystem such as ext4, XFS, or NTFS creates file and directory meaning above the device. This is the world of **Amazon EBS**.

At a higher layer, a storage service can expose **files and directories** directly. Clients call `open`, `read`, `write`, `rename`, `chmod`, and locking operations against a shared namespace. This is the world of **Amazon EFS** and the **Amazon FSx** family.

Object storage such as S3 exposes a different API again: PUT, GET, and DELETE complete objects identified by bucket and key.

```text
application needs a disk and controls its own filesystem
       ↓
filesystem created by the client OS
       ↓
EBS block device

application needs /shared/image.jpg from many Linux clients
       ↓
EFS network filesystem

application needs SMB, Lustre, ONTAP, or OpenZFS behavior
       ↓
FSx specialist filesystem

application naturally PUTs and GETs whole objects
       ↓
S3 object API
```

An old application calling `open("/shared/config/settings.json")` expects filesystem semantics. Replacing that call with `s3.get_object()` changes the application and raises questions about partial writes, rename behavior, locking, permissions, concurrency, and metadata. That rewrite can be worthwhile, but it is not merely a storage configuration change.

Likewise, a database engine such as PostgreSQL already implements sophisticated data storage above a disk: pages, indexes, transaction logs, buffering, locking, flushes, and crash recovery. It often wants a dependable block device rather than another shared filesystem layer.

> **Choose the storage abstraction that matches the application’s natural I/O model.**

![The storage choice map separates block volumes, shared Linux filesystems, and specialist managed filesystems by how applications access them](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/filesystem-choice-map.png)

*The interface decision comes before the product name: blocks, general shared files, or specialist filesystem semantics.*

### What Does EBS Provide?
<!-- section-summary: EBS provides persistent block volumes to EC2, leaving filesystem layout and ordinary file operations to the guest operating system or application. -->

**Amazon Elastic Block Store (EBS)** provides block-level storage for EC2. A volume appears to Linux as a device such as `/dev/nvme1n1`. A new volume may contain no filesystem; the administrator can format it and mount it:

```text
EBS blocks
   ↓
ext4, XFS, NTFS, database-owned layout, or another supported consumer
   ↓
mounted path or direct block use
   ↓
application
```

The responsibility split is:

```text
EBS:                 store addressed blocks durably
OS or database:      turn blocks into meaningful data structures
application:         use the resulting files or records
```

After attachment, normal software does not call an EBS file API. PostgreSQL can continue using `/var/lib/postgresql/data` while the path ultimately resolves through its filesystem and Linux block layer to EBS.

This is why transactional databases naturally fit EBS. The database already manages page addresses, write-ahead logs, indexes, dirty buffers, `fsync`, locking, and crash recovery. Underneath, it needs random reads and writes, durable flushes, relatively predictable latency, and sufficient IOPS.

EBS volumes also support ordinary server storage: EC2 boot volumes, application data disks, and local persistent state tied to one compute placement. The volume can survive the instance depending on delete-on-termination settings, so the lifecycle should be explicit rather than assumed.

Do not call EBS a filesystem. The operating system may place a filesystem on the volume, but EBS itself exposes blocks.

A newly attached Linux volume makes the layers visible. After verifying the device identity, an administrator can create a filesystem, make a mount point, and mount it:

```bash
sudo mkfs -t xfs /dev/nvme1n1
sudo mkdir -p /var/lib/search-index
sudo mount /dev/nvme1n1 /var/lib/search-index
df -h /var/lib/search-index
```

`mkfs` writes a new filesystem, so running it on the wrong device destroys existing data. Verify the EBS volume-to-device mapping first. `mkdir` creates the path through which applications will access the disk, and `mount` connects that path to the new filesystem. The final `df` output should show the expected device and mount point rather than the root volume.

The mount also needs a reboot plan. Device names can change, so Linux systems commonly record a filesystem UUID in `/etc/fstab` rather than depending on a transient name. Test `mount -a`, reboot a non-production instance, and confirm that the application does not accept traffic before a required data volume is mounted. A durable EBS volume provides little value if a reboot quietly makes the application write to an empty directory on the root disk.

## How Do EBS Placement and Attachment Work?
<!-- section-summary: An EBS volume belongs to one Availability Zone and normally behaves like a disk attached to one EC2 instance in that same zone. -->

EBS is an **Availability Zone resource**. An instance and volume must be in the same zone for normal attachment.

```text
AZ A                              AZ B
EC2-A ── EBS-A                    EC2-B

EBS-A → EC2-A  valid
EBS-A → EC2-B  not a cross-zone attachment
```

Storage durability inside the zone does not automatically make the application Multi-AZ. A highly available self-managed database usually uses a database-aware primary and replica on separate EC2 instances, each with its own EBS volumes in its zone.

The useful default model is **one attached disk owned by one machine**. An instance can attach several volumes. A volume can be detached and attached to a different compatible instance in the same zone, conceptually like moving a disk between servers.

Certain Provisioned IOPS volumes support **EBS Multi-Attach** to several instances in the same zone. This specialist feature exposes the same blocks to multiple hosts. It does not turn EBS into EFS.

Two ordinary servers mounting the same ordinary ext4 filesystem read-write can corrupt it. Both may independently believe a block is free and allocate it to different files. Safe concurrent writers require a cluster-aware application or filesystem that coordinates ownership and locking.

```text
Multi-Attach: several hosts can access shared blocks
EFS:          the service coordinates one shared filesystem
```

Use Multi-Attach only when the workload explicitly understands shared-block coordination. It is not a shortcut for ordinary shared directories.

## How Should You Size and Back Up EBS?
<!-- section-summary: EBS performance has distinct latency, IOPS, and throughput dimensions, while snapshots need application-aware consistency planning. -->

Storage performance is not one number.

**Latency** is the time one I/O request takes. A transaction waiting for a durable log flush can be highly latency-sensitive.

**IOPS** is the number of input/output operations per second. A database performing many small random page reads and writes often needs high IOPS.

**Throughput** is the number of bytes transferred per second. A sequential log scan or large dataset transfer can care more about throughput than the count of operations.

```text
small random database writes → latency and IOPS
large sequential scans       → throughput
```

EBS volume families target different shapes. General Purpose SSD volumes such as `gp3` are common starting points. Provisioned IOPS SSD such as `io2` fits demanding latency- and IOPS-sensitive workloads. Throughput Optimized HDD `st1` and Cold HDD `sc1` target large sequential throughput patterns at different access temperatures. Always check current support and limits for the instance and Region, but learn the scarce resource before memorizing numbers.

An instance’s own EBS bandwidth and the application’s queue behavior can also bottleneck a correctly provisioned volume. Monitor storage and application latency together rather than assuming that adding volume size fixes every wait.

An **EBS snapshot** captures a point-in-time representation from which a new volume can be created. AWS Backup and Data Lifecycle Manager can automate snapshot policies.

Storage consistency and application consistency are different. Imagine database pages being modified, a transaction log buffered, and unwritten data still in the operating-system cache when a snapshot begins. The snapshot can resemble the disk after a sudden machine crash. A database with correct crash recovery may recover it, but that is not identical to a database-aware logical backup or a deliberately quiesced application.

For important databases, coordinate a safe method: pause or quiesce writes where appropriate, flush application state, use supported database backup tools, or confirm that crash-consistent recovery meets the requirement. Multi-volume snapshot coordination still does not automatically understand application transactions.

### What Does EFS Provide?
<!-- section-summary: EFS is a managed NFS filesystem whose shared namespace can be mounted concurrently by many Linux-style clients. -->

Suppose three web servers all need `/shared/uploads/cat.jpg`. Giving each server an independent EBS volume produces three separate copies. An upload reaching web server A does not appear on B or C without a synchronization system.

The actual requirement is one shared filesystem. **Amazon Elastic File System (EFS)** provides a managed network filesystem:

```text
EC2 A ─┐
EC2 B ─┼── NFS ──> EFS /shared
EC2 C ─┘
```

The core distinction is:

```text
EBS: client receives blocks and owns the filesystem
EFS: service owns the filesystem and clients access files
```

EFS provides filesystem semantics, strong consistency, and file locking. Linux clients use NFS through the normal filesystem API. A call to `open("/mnt/shared/report.txt")` becomes network filesystem operations through the NFS client.

The two data paths therefore differ even when the application uses a familiar path in both cases:

```text
EBS path
application → ext4/XFS → Linux block layer → EBS blocks

EFS path
application → Linux filesystem API → NFS client
            → VPC network → EFS filesystem service
```

With EBS, the client operating system owns directory structure, metadata, and locking. With EFS, the remote filesystem coordinates those semantics for all mounted clients. That coordination is precisely what lets one server create `/shared/uploads/cat.jpg` and another server open the same path without building a separate file-synchronization service.

That network layer enables natural sharing, and it adds network latency and configuration. EFS is not simply “a larger EBS volume.”

Regional EFS stores data redundantly across multiple Availability Zones, and clients in those zones can use the same shared namespace. EFS also offers a One Zone storage model for requirements that accept a different availability boundary and cost profile.

```text
AZ A clients ─┐
AZ B clients ─┼── Regional EFS
AZ C clients ─┘
```

This differs from EBS, where separate zone-local disks usually require the application or database to replicate state between them.

EFS fits shared web content, user-upload directories, CMS files, home directories, shared application configuration, container workloads needing a common filesystem, and elastic compute fleets sharing ordinary Linux file semantics.

The defining property is not merely “Linux.” It is **several clients need one NFS-style namespace**.

## How Do EFS Networking and Permissions Work?
<!-- section-summary: EFS access crosses VPC mount targets and TCP 2049, then passes filesystem policy, optional IAM authorization, access-point, and POSIX checks. -->

EFS exposes **mount targets** in VPC subnets. For a Regional filesystem, create mount targets in the Availability Zones where clients need access so that each client can use a local-zone network endpoint.

```text
EFS filesystem
├── mount target in AZ A ← clients in AZ A
├── mount target in AZ B ← clients in AZ B
└── mount target in AZ C ← clients in AZ C
```

NFS traffic normally uses TCP `2049`. A common security-group relationship permits inbound `2049` on the mount-target security group from the application client security group.

Unlike EBS attachment, EFS is a real network path. DNS resolution, subnets, routes, mount targets, client and mount-target security groups, and NFS configuration all participate. A mount timeout is not repaired by changing POSIX file mode, and a POSIX permission denial is not repaired by opening every network source.

Separate the security layers:

```text
AWS control plane: who may create or configure EFS resources?
network:           can the client reach TCP 2049?
client auth/policy: is this mount identity allowed?
filesystem:        may this UID/GID read or write this path?
encryption:        how is data protected at rest and in transit?
```

EFS applies Unix/POSIX ownership and mode bits using UIDs and GIDs. If the file is owned by UID 1001 and group 2001, ordinary read, write, and execute permissions still matter after the network connection succeeds.

**EFS Access Points** give an application a controlled entry. Suppose EFS contains `/app-a`, `/app-b`, and `/admin`. App A’s access point can present `/app-a` as its apparent filesystem root and enforce a chosen POSIX identity. The application need not mount the entire shared root or trust whatever UID the client happened to claim.

Access points are useful for containers, ECS, Lambda, and multi-application environments because they combine a restricted root directory with a predictable user and group identity. EFS can also use IAM authorization for NFS clients, adding an AWS identity layer before normal filesystem access.

For example, App A can mount through an access point that maps its apparent `/` to `/apps/a` and runs all operations as UID 10001 and GID 10001. App B can receive a separate access point rooted at `/apps/b`. Both use the same EFS filesystem, but neither needs a normal application mount of `/admin` or the other application directory. POSIX modes still decide which operations the enforced identity may perform.

Mount targets should exist in the zones where clients run. A client can reach a remote-zone target through VPC networking, but that creates an avoidable zone dependency and can change latency or data-transfer behavior. During a mount failure, check DNS resolution, target lifecycle, subnet placement, security-group source, TCP 2049, mount options, and then the file-level permission. That order separates connection failure from authorization failure.

![The mount access view shows how clients, mount targets, security groups, access points, and POSIX permissions all affect shared file access](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/mount-network-access.png)

*A successful EFS mount requires both a working network path and a valid filesystem identity and permission path.*

## How Should You Think About EFS Performance and Cost?
<!-- section-summary: EFS is elastic and distributed, so workload latency, operation size, parallelism, throughput mode, and storage class all matter. -->

Distributed sharing has a cost. A small operation such as `open`, `stat`, read 4 KB, and close may involve several network filesystem operations. EFS’s distributed design adds per-operation latency that is proportionally more visible for tiny, serial I/O than for larger or highly parallel work.

```text
one client doing tiny metadata-heavy operations
→ sensitive to per-operation latency

many clients performing large parallel reads
→ can use distributed throughput effectively
```

This is why one latency-sensitive database server often fits EBS better. A shared network filesystem would solve a sharing problem the database does not have and insert extra coordination into every small operation.

EFS capacity is elastic. With EBS, a team provisions and later expands a volume size. With EFS, the filesystem grows as files are added and storage usage shrinks as they are removed; there is normally no volume-resize operation for the team to schedule.

EFS storage classes can keep frequently used files in Standard and move colder data to Infrequent Access or Archive where appropriate. Lifecycle management can change the physical cost tier while applications continue seeing ordinary files. The retrieval profile and minimum storage or access charges of each class still need review.

Throughput remains a configuration and observation concern. General Purpose performance mode with Elastic throughput is a common default for many current workloads, letting throughput follow demand. Still reason about latency, IOPS, bandwidth, parallelism, and average I/O size. “Shared” does not mean infinitely fast.

A web fleet reading common images, a home-directory service, and a container fleet sharing configuration can have very different request shapes even though each mounts EFS. The web fleet may read larger files in parallel. Home directories can create many metadata operations. A content-management system may perform locks and frequent small writes. The filesystem choice is the same, but performance testing must reproduce the actual operation mix.

Storage class also does not repair an unsuitable interface. Moving an old file to Infrequent Access or Archive reduces the storage price for colder data while keeping it in the filesystem namespace, but later access can incur retrieval effects. Lifecycle timing should come from observed access and retention requirements rather than moving every file quickly because a colder class has a lower headline storage rate.

Measure a representative workload—especially small-file counts, metadata operations, concurrent clients, and cross-zone paths—rather than selecting a filesystem from headline throughput alone.

### What Does Each FSx Service Provide?
<!-- section-summary: FSx provides managed versions of established filesystem technologies for Windows, high-performance parallel compute, NetApp enterprise storage, and ZFS workflows. -->

**Amazon FSx** is not one filesystem. It is a family of AWS-operated specialist filesystem services. The architectural question is whether the application requires the behavior or ecosystem of a particular filesystem.

#### What does FSx for Windows File Server provide?

An organization with Windows clients, Windows servers, Active Directory, SMB shares, NTFS permissions, and paths such as `\\company-files\finance` expects Windows filesystem semantics.

**FSx for Windows File Server** provides managed Windows file shares with SMB, Active Directory integration, and Windows file and share permissions.

```text
Windows client
      ↓ SMB
FSx for Windows
      ↓ identity
Active Directory and Windows ACLs
```

EFS’s Linux/NFS/POSIX model is the wrong interface for that workload. Think “managed Windows file server,” not generic cloud bytes.

#### What does FSx for Lustre provide?

High-performance computing can involve hundreds or thousands of compute nodes streaming a scientific, genomics, rendering, analytics, or machine-learning dataset concurrently. These workloads need massive parallel throughput and IOPS.

**FSx for Lustre** supplies a filesystem architecture designed for highly parallel compute. It is not merely “a faster EFS”; it solves a workload in which many compute nodes need coordinated, high-performance data access.

#### What does FSx for NetApp ONTAP provide?

An enterprise already using NetApp can depend on NFS and SMB access, snapshots, clones, storage efficiencies, multi-protocol NAS workflows, and block protocols. **FSx for NetApp ONTAP** provides managed ONTAP capabilities in AWS.

Supported designs can serve Linux through NFS, Windows through SMB, and block clients through iSCSI, with newer supported configurations also offering NVMe/TCP. This is a richer enterprise storage environment than the general shared Linux role EFS usually fills.

#### What does FSx for OpenZFS provide?

ZFS users care about datasets, snapshots, clones, integrity features, and a known administration model. **FSx for OpenZFS** provides a managed AWS option for workloads or migrations that specifically benefit from ZFS-style behavior.

The summary is:

```text
general shared Linux NFS → EFS
Windows SMB and AD       → FSx for Windows File Server
parallel HPC filesystem  → FSx for Lustre
NetApp enterprise model  → FSx for NetApp ONTAP
ZFS behavior             → FSx for OpenZFS
```

“Filesystem” is not one universal personality. Protocol, identity, locking, performance, management tools, snapshots, clones, and migration ecosystem can all make a specialist engine the correct choice.

## How Do EBS, EFS, and FSx Permissions Differ?
<!-- section-summary: IAM controls resource operations, while the data path is governed by the operating-system filesystem, NFS and POSIX, or the chosen specialist identity model. -->

With EBS, IAM controls AWS operations such as creating, attaching, modifying, and snapshotting volumes. Once attached, ext4, XFS, NTFS, a database, and the guest operating system control ordinary data and file permissions.

```text
IAM → may attach volume
OS filesystem → may process read /data/report.txt
```

With EFS, permission evaluation spans filesystem policy or IAM mount authorization, VPC security groups, NFS access, POSIX UID/GID rules, and optionally an access point enforcing a root and identity.

With FSx for Windows, the data path uses VPC networking, Active Directory identity, Windows share permissions, and Windows ACLs. Other FSx families have their own supported protocols and filesystem security models.

This is why an application-storage design must name both the AWS infrastructure identity and the filesystem identity. “The role has permission” may not explain why UID 1001 lacks a POSIX write bit or why a domain user lacks a Windows ACL.

## How Do Backup and Replication Differ?
<!-- section-summary: Replication improves availability of current state, while backups preserve recoverable points in time after deletion or corruption. -->

Redundancy and backup solve different failures. If Alice deletes `customers.csv`, a replica can faithfully copy that deletion. Replication succeeds and the data is still gone.

```text
replication → availability when infrastructure fails
backup      → recovery of an earlier state after deletion or corruption
```

EBS snapshots create restorable volume points in time. EFS can be protected through AWS Backup with incremental backups and whole-filesystem or item-level restoration support. FSx backup behavior varies by filesystem family; for example, FSx for Windows supports automatic daily, user-initiated, and AWS Backup-managed backups with its documented consistency model.

Because FSx is a family, do not assume every filesystem uses identical backup operations or restore granularity. Review the chosen family.

Restore tests must include the application interface. An EBS snapshot should produce a volume that a test instance can attach and mount, and the application should read consistent data. An EFS recovery should restore expected ownership and paths. An FSx for Windows recovery should authenticate the expected domain identity and preserve share and file permissions.

High availability can keep current storage reachable. Only a tested historical recovery path proves that an earlier correct version can be restored.

### How Should You Choose and Combine These Services?
<!-- section-summary: Select the interface from the workload’s I/O and sharing pattern, then combine services when different application layers need different storage semantics. -->

Describe the actual requests before selecting a service.

```text
4 KB random durable writes, 10,000 per second
→ latency, IOPS, flush behavior
→ likely block-storage territory

50 application servers read and write the same directory
→ shared namespace, concurrency, availability
→ network-filesystem territory

500 HPC nodes stream a huge dataset together
→ parallel throughput and massive concurrency
→ possible Lustre territory
```

Use the decision tree:

```text
Does the application need a filesystem?
├── no  → object storage such as S3 may fit
└── yes
    ├── one machine mostly needs disk-like block storage → EBS
    └── many clients need shared files
        ├── general Linux/NFS semantics → EFS
        └── specialist filesystem
            ├── Windows → FSx Windows
            ├── HPC     → FSx Lustre
            ├── NetApp  → FSx ONTAP
            └── ZFS     → FSx OpenZFS
```

The services often coexist. A web application can use an EBS root volume for each EC2 server, EFS for `/shared/uploads`, S3 for durable object workflows, and an RDS database for structured business state. A self-managed PostgreSQL host can use EBS while three application servers share EFS. A Windows enterprise can use Active Directory and FSx for Windows without forcing Linux NFS semantics onto Windows users.

Consider the self-managed PostgreSQL example in more detail. PostgreSQL on EC2 uses EBS for its database pages and write-ahead log because it already owns transactions, buffering, and crash recovery. Three stateless web servers use EFS for a legacy shared upload directory because all replicas must see the same path. The application database stores user and upload records. The services do not compete: EBS serves one database engine’s disk interface, while EFS serves the web fleet’s shared-file interface.

Now consider a Windows organization. Domain users authenticate through Active Directory and open an SMB path backed by FSx for Windows. Windows ACLs control the finance and administration folders. Selecting EFS merely because its name contains “file system” would discard the required SMB, domain, and Windows-permission model. The protocol and identity requirement select the service before throughput tuning begins.

Storage products are not always competitors. Each can sit at a different layer because the application needs multiple interfaces.

The deeper principle is **where storage intelligence lives**:

```text
EBS:
application → client filesystem or database intelligence → simple block interface

EFS:
application → NFS → AWS-managed general filesystem intelligence

FSx:
application → SMB/NFS/Lustre/other protocol → specialist filesystem intelligence
```

## Which Common Mistakes Should You Avoid?
<!-- section-summary: Most errors come from confusing blocks with filesystems, sharing with availability, and generic file storage with specialist filesystem requirements. -->

Avoid these traps:

- **“EBS is a filesystem.”** EBS provides blocks. The operating system or application creates and operates the filesystem or storage format above them.
- **“EFS is a bigger EBS disk.”** EBS is an attached block device; EFS is a network file server. Their data paths, sharing, latency, placement, permissions, and capacity models differ.
- **“Multi-Attach turns EBS into EFS.”** Multi-Attach exposes shared blocks and requires cluster-aware coordination. EFS coordinates shared filesystem semantics.
- **“Regional EFS means backups are unnecessary.”** Regional redundancy helps availability and durability of current data. It can still reproduce deletion or corruption; backups preserve historical recovery points.
- **“FSx is one product directly comparable to EFS.”** FSx names a family. Specify Windows File Server, Lustre, ONTAP, or OpenZFS and compare the actual required semantics.
- **“Shared storage is always better.”** Sharing adds network calls, coordination, locking, and distributed metadata. If one database server needs a fast disk, shared filesystem complexity may add no value.
- **“The service with the highest throughput number wins.”** Small random operations, sequential transfers, metadata-heavy file access, and massively parallel compute stress different resources.

The shortest reliable memory aid is:

```text
EBS = a disk: blocks mainly for an EC2 placement
EFS = a shared Linux filesystem: managed NFS for many clients
FSx = a specialist filesystem: managed Windows, Lustre, ONTAP, or OpenZFS behavior
```

Choose among blocks, generic shared files, and specialist filesystem semantics. The product decision then becomes far less mysterious.

![The review summary compares EBS, EFS, and FSx by attachment model, sharing pattern, backup needs, and operational owner](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/attached-storage-review.png)

*The correct service follows from who owns the filesystem and which clients, protocols, performance pattern, and recovery behavior it must support.*

## Check Your Understanding

:::expand[Which Storage Interface Does the Application Need?]{kind="recap"}
Start with whether software expects raw blocks, files and directories, or objects accessed through an API.

Applications that read blocks, mount shared files, or call object APIs expect different operations and consistency. Matching the native I/O model avoids forcing filesystem or database software through the wrong abstraction.

EBS provides persistent block volumes to EC2, leaving filesystem layout and ordinary file operations to the guest operating system or application.

EBS stores addressed blocks. The guest operating system, a filesystem such as XFS, or a database engine turns those blocks into files, pages, and application data structures.

It lets several hosts access the same blocks but does not coordinate ordinary filesystem metadata and concurrent writers. A cluster-aware application or filesystem is required to avoid corruption.
:::

:::expand[How Do EBS Placement and Attachment Work?]{kind="recap"}
An EBS volume belongs to one Availability Zone and normally behaves like a disk attached to one EC2 instance in that same zone.

Each volume belongs to one Availability Zone and normally attaches to an instance there. Cross-zone availability usually comes from database- or application-level replication to separate compute and volumes.
:::

:::expand[How Should You Size and Back Up EBS?]{kind="recap"}
EBS performance has distinct latency, IOPS, and throughput dimensions, while snapshots need application-aware consistency planning.

Latency measures one request’s delay, IOPS counts operations per second, and throughput counts bytes per second. Small random database requests and large sequential transfers stress these dimensions differently.

It can capture a coherent disk point resembling sudden power loss while application transactions or caches are mid-update. Database-aware coordination or backups may be needed for the intended recovery guarantee.

EFS is a managed NFS filesystem whose shared namespace can be mounted concurrently by many Linux-style clients.

EBS gives a client a block device and the client owns the filesystem. EFS owns a managed NFS filesystem and lets many clients access one shared file and directory namespace.
:::

:::expand[How Do EFS Networking and Permissions Work?]{kind="recap"}
EFS access crosses VPC mount targets and TCP 2049, then passes filesystem policy, optional IAM authorization, access-point, and POSIX checks.

The client needs a reachable mount target and TCP 2049 path, permitted filesystem or IAM mount authorization, and a POSIX identity with permission on the target directory and file.
:::

:::expand[How Should You Think About EFS Performance and Cost?]{kind="recap"}
EFS is elastic and distributed, so workload latency, operation size, parallelism, throughput mode, and storage class all matter.

Each metadata or small file operation can require network communication with a distributed filesystem. Per-operation overhead matters more for tiny serial I/O than for large or highly parallel access.

FSx provides managed versions of established filesystem technologies for Windows, high-performance parallel compute, NetApp enterprise storage, and ZFS workflows.

Windows File Server supplies SMB, Active Directory, and Windows permissions; Lustre targets parallel compute; ONTAP supplies NetApp enterprise and multi-protocol behavior; OpenZFS supplies managed ZFS-style capabilities.
:::

:::expand[How Do EBS, EFS, and FSx Permissions Differ?]{kind="recap"}
IAM controls resource operations, while the data path is governed by the operating-system filesystem, NFS and POSIX, or the chosen specialist identity model.
:::

:::expand[How Do Backup and Replication Differ?]{kind="recap"}
Replication improves availability of current state, while backups preserve recoverable points in time after deletion or corruption.

Replication keeps current state available after infrastructure failure and can reproduce mistakes. Backups preserve earlier points in time so deletion or corruption can be reversed through a tested restore.

Select the interface from the workload’s I/O and sharing pattern, then combine services when different application layers need different storage semantics.

It can present a restricted root directory and enforce a chosen UID and GID for one application, giving containers or services a controlled view instead of the entire shared filesystem.
:::

:::expand[Which Common Mistakes Should You Avoid?]{kind="recap"}
Most errors come from confusing blocks with filesystems, sharing with availability, and generic file storage with specialist filesystem requirements.

The database already manages pages, transactions, logs, buffering, indexes, and crash recovery. It needs durable, low-latency random block I/O underneath rather than a shared file-server abstraction.
:::

## References

- [Amazon EBS features](https://docs.aws.amazon.com/ebs/latest/userguide/EBSFeatures.html)
- [Amazon EBS volume types](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html)
- [Attach an EBS volume](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-attaching-volume.html)
- [EBS Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)
- [Amazon EBS I/O characteristics](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-io-characteristics.html)
- [Amazon EBS snapshots](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/storage_ebs.html)
- [AWS Backup documentation](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
- [What is Amazon EFS?](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [EFS mount targets](https://docs.aws.amazon.com/efs/latest/ug/accessing-fs.html)
- [EFS VPC security groups](https://docs.aws.amazon.com/efs/latest/ug/network-access.html)
- [EFS NFS users and permissions](https://docs.aws.amazon.com/efs/latest/ug/accessing-fs-nfs-permissions.html)
- [EFS access-point root enforcement](https://docs.aws.amazon.com/efs/latest/ug/enforce-root-directory-access-point.html)
- [Amazon EFS features and storage classes](https://docs.aws.amazon.com/efs/latest/ug/features.html)
- [Amazon EFS performance tips](https://docs.aws.amazon.com/efs/latest/ug/performance-tips.html)
- [Managing EFS throughput](https://docs.aws.amazon.com/efs/latest/ug/managing-throughput.html)
- [Amazon FSx documentation](https://docs.aws.amazon.com/fsx/)
- [FSx for Windows best practices](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/windows-best-practices.html)
- [FSx for ONTAP supported clients](https://docs.aws.amazon.com/fsx/latest/ONTAPGuide/supported-fsx-clients.html)
- [IAM authorization for EFS NFS clients](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html)
- [Backing up EFS](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)
- [FSx for Windows backups](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/using-backups.html)
