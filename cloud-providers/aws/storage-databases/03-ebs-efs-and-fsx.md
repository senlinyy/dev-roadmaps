---
title: "EBS, EFS, and FSx"
description: "Choose AWS storage that appears to applications as a disk or filesystem by comparing EBS block volumes, EFS shared Linux file storage, and FSx managed specialist filesystems."
overview: "Some workloads need normal operating system storage instead of an object API or database driver. This article explains when to use EBS, EFS, and FSx, how they attach or mount, and what teams check in production."
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

1. [When Apps Need a Filesystem](#when-apps-need-a-filesystem)
2. [EBS for Block Storage Attached to One Placement](#ebs-for-block-storage-attached-to-one-placement)
3. [EFS for Shared Linux File Storage](#efs-for-shared-linux-file-storage)
4. [FSx for Managed Specialist Filesystems](#fsx-for-managed-specialist-filesystems)
5. [Mounting, Networking, and Access Control](#mounting-networking-and-access-control)
6. [Backups, Snapshots, and Performance Signals](#backups-snapshots-and-performance-signals)
7. [Choosing Between EBS, EFS, and FSx](#choosing-between-ebs-efs-and-fsx)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## When Apps Need a Filesystem
<!-- section-summary: EBS, EFS, and FSx exist for workloads that need disk or filesystem behavior instead of an object API. -->

The previous article focused on S3, where applications store whole objects through an API. That works beautifully for invoices, photos, logs, exports, and archives. Some software still expects the operating system to give it a mounted disk or a shared folder. The code calls `open()`, `read()`, `write()`, `rename()`, and `fsync()`. The storage choice must fit that interface.

Maple Market has three workloads like this. Its admin search service keeps a local index on a fast disk. Its warehouse workers share a Linux folder of imported supplier files. Its finance department has an old Windows application that reads reports from an SMB file share joined to Active Directory. Those three needs all sound like "storage," but each one needs a different AWS service.

**Amazon EBS** provides block storage volumes for EC2 instances. Block storage means the operating system receives a virtual disk and formats it with a filesystem such as XFS, ext4, or NTFS. **Amazon EFS** provides a managed shared Linux filesystem over NFS, so many compute clients can mount the same file tree. **Amazon FSx** provides managed filesystems for specific ecosystems, including Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.

The useful question is: **does the application need a disk, a shared Linux filesystem, or a specialist managed filesystem?** Once that question is clear, the service choice gets much easier. The remaining design work is placement, permissions, backup, and performance.

## EBS for Block Storage Attached to One Placement
<!-- section-summary: EBS gives one compute placement a durable block device that behaves like a local disk to the operating system. -->

Amazon Elastic Block Store, usually called **EBS**, gives EC2 instances durable block volumes. After an EBS volume attaches to an instance, the operating system sees it like a disk. The instance can partition it, format it, mount it, and write files to it. Under the hood, AWS provides network-attached block storage that persists independently from the instance lifecycle.

Maple Market's search index is a good EBS example. The search service runs on one EC2 instance at a time. It needs low-latency local filesystem calls and lots of small writes while it builds an index. S3 would force the application to rewrite whole objects. EFS would add shared-filesystem network behavior the service does not need. EBS gives the instance a disk-like target that fits the software.

The important placement rule is that an EBS volume lives in one Availability Zone. A volume in `us-east-1a` attaches to EC2 instances in `us-east-1a`. If the workload moves to another zone, the team usually restores or creates a volume from a snapshot in the target zone. This matters for disaster recovery, Auto Scaling, and manual replacement work.

Teams also choose a **volume type**. General purpose SSD volumes are common for everyday boot volumes and application disks. Provisioned IOPS SSD volumes fit workloads that need predictable high I/O performance. Throughput optimized HDD and cold HDD volumes fit large sequential workloads where cost per GiB matters more than small random I/O. The exact type should come from measured IOPS, throughput, latency, and cost needs, not from guessing.

Here is what the setup flow looks like on a Linux EC2 instance after a new empty EBS volume is attached as `/dev/nvme1n1`. The commands show the operating system view of the AWS volume.

```bash
lsblk
sudo mkfs -t xfs /dev/nvme1n1
sudo mkdir -p /var/lib/search-index
sudo mount /dev/nvme1n1 /var/lib/search-index
df -h /var/lib/search-index
```

For a production host, the mount should survive reboot. Teams usually add an `/etc/fstab` entry using the filesystem UUID instead of a device name, because device names can change across boots. The entry also makes replacement work easier to audit:

```bash
sudo blkid /dev/nvme1n1
sudo sh -c 'echo "UUID=11111111-2222-3333-4444-555555555555 /var/lib/search-index xfs defaults,nofail 0 2" >> /etc/fstab'
sudo mount -a
```

EBS gives one compute placement a durable disk. When many compute clients need the same file tree, Maple Market needs a different service.

## EFS for Shared Linux File Storage
<!-- section-summary: EFS gives Linux clients a managed NFS filesystem that can be mounted by many compute resources. -->

Amazon Elastic File System, usually called **EFS**, provides shared file storage for Linux-style workloads. It uses the NFS protocol, so EC2 instances, ECS tasks, EKS pods, Lambda functions, and some on-premises clients can mount the same filesystem and use normal file paths.

Maple Market's warehouse workflow fits EFS. Several worker tasks need to read supplier import files from the same directory while another job writes new files into that directory. The workers already use file paths, and rewriting the old workflow to use S3 object calls would take more time than the team has. EFS gives the team a managed shared filesystem while the application remains mostly unchanged.

EFS is elastic. The filesystem can grow and shrink as files are added and removed, and teams do not provision a fixed disk size in the same way they do for EBS. That helps with shared workloads where capacity grows unpredictably. EFS also has performance and throughput modes, so production teams still need to watch throughput, client count, metadata-heavy operations, and latency.

Access to EFS comes through **mount targets** in a VPC. A mount target is an elastic network interface in a subnet. Clients mount the filesystem through those network interfaces. Security groups control which clients can reach the NFS port. For a regional filesystem, teams usually place mount targets in multiple Availability Zones so clients can use a local network path in each zone.

EFS **access points** give applications a controlled entry point into a filesystem. An access point can enforce a root directory and POSIX user/group settings for a workload. That is useful when many applications share one filesystem but each application should land in its own path with predictable Linux permissions.

A typical Linux mount uses the EFS mount helper from `amazon-efs-utils`. The helper supports TLS mounts and the EFS-specific options teams normally want.

```bash
sudo mkdir -p /mnt/supplier-files
sudo mount -t efs -o tls fs-1234567890abcdef0:/ /mnt/supplier-files
df -h /mnt/supplier-files
```

EFS helps with shared Linux file paths. The next workload, Maple Market's old finance application, needs Windows SMB and directory integration. That points to FSx.

## FSx for Managed Specialist Filesystems
<!-- section-summary: FSx provides managed filesystems for established ecosystems such as Windows File Server, Lustre, NetApp ONTAP, and OpenZFS. -->

Amazon FSx is a family of managed filesystems. Instead of giving you one generic shared filesystem, FSx gives you managed versions of established filesystem ecosystems. That matters when the application needs a specific protocol, performance model, feature set, or administrative toolchain.

**FSx for Windows File Server** provides managed Windows file storage over SMB. It integrates with Microsoft Active Directory, supports Windows ACLs, and fits applications that expect Windows file shares. Maple Market's old finance reporting tool can keep using a path like `\\fileserver\finance\reports` while AWS operates the file server infrastructure.

**FSx for Lustre** provides a high-performance parallel filesystem often used for high-performance computing, machine learning, media processing, and large scratch workloads. It can connect with S3 data repositories, which helps when large datasets live in S3 but processing needs fast filesystem access.

**FSx for NetApp ONTAP** provides managed NetApp ONTAP features in AWS. Teams use it when they already depend on ONTAP capabilities such as snapshots, clones, multiprotocol access, storage efficiency, or existing NetApp operational practices.

**FSx for OpenZFS** provides managed OpenZFS file storage with features familiar to teams that already use ZFS-style snapshots, clones, and data management. It fits workloads that need OpenZFS behavior without running and patching file servers themselves.

Here is what Maple Market's finance share could look like with FSx for Windows File Server. The file system is joined to AWS Managed Microsoft AD or a self-managed Active Directory domain, because Windows users and groups need to authenticate through the domain. The FSx security group allows SMB traffic on TCP 445 from the finance application and approved Windows jump host security groups. The share path is published as something like `\\maple-fsx.corp.example.com\finance\reports`, and Windows ACLs give `MAPLE\FinanceReportsWriters` write access while `MAPLE\FinanceReportReaders` gets read access.

The operating plan should name backups and a client validation check. FSx for Windows File Server supports automatic daily backups and manual backups, and many teams also manage backup policy through AWS Backup. After migration, a finance user or test Windows instance can map the share and write a small validation file:

```powershell
New-PSDrive -Name Z -PSProvider FileSystem -Root "\\maple-fsx.corp.example.com\finance\reports"
Get-ChildItem Z:\
"migration-check" | Out-File Z:\migration-check.txt
Get-Content Z:\migration-check.txt
```

That small check proves DNS, domain authentication, SMB network access, share permissions, and file write behavior at the same time. It is a better launch signal than only seeing the FSx file system marked available in the AWS console.

The FSx decision often starts outside AWS. If the application, vendor, or operations team already names SMB, Lustre, ONTAP, or OpenZFS as a requirement, FSx is usually the first AWS family to review. EFS is simpler for general shared Linux files. FSx fits more specific filesystem expectations.

## Mounting, Networking, and Access Control
<!-- section-summary: Attached and shared storage must be designed with placement, subnets, security groups, IAM, and filesystem permissions together. -->

EBS, EFS, and FSx all touch compute, so storage design has to include placement and networking. This is different from S3, where the application calls a regional API endpoint and IAM policy carries most of the access story.

For **EBS**, placement starts with the Availability Zone. The EC2 instance and the EBS volume need to be in the same zone for normal attachment. The operating system controls filesystem permissions after the volume is mounted. IAM controls who can create, attach, detach, snapshot, and delete volumes through AWS APIs, but Linux or Windows permissions control what application processes can do on the mounted filesystem.

For **EFS**, placement starts with VPC mount targets. Clients need network reachability to a mount target, usually through private subnets and security groups. Linux permissions still matter after mount. EFS access points can enforce application-specific paths and POSIX identities, which helps keep one application's files away from another application's files.

For **FSx**, the access model depends on the filesystem type. Windows File Server uses SMB, Active Directory, Windows ACLs, and network security controls. Lustre has its own client and mount flow. ONTAP and OpenZFS have their own protocol and management details. The AWS layer creates and protects the managed filesystem, while the filesystem's native permission model still matters.

This is why a production design should name both AWS access and OS access. A good design note says: "the warehouse ECS tasks mount EFS through an access point at `/supplier-imports`, the task security group can reach EFS mount targets on NFS, and the application runs as UID 10001 with write permission only under its directory." That statement is much clearer than "we use EFS."

## Backups, Snapshots, and Performance Signals
<!-- section-summary: Disk and filesystem services need recovery copies and performance monitoring because they sit directly on application request paths. -->

EBS, EFS, and FSx store data that applications often depend on during runtime, so the day-two work matters. The team needs to know how to recover data, how to replace failed compute, and how to notice performance pressure before users notice it.

EBS uses **snapshots** for point-in-time backup copies. Snapshots are incremental, so later snapshots store changed blocks after the earlier snapshot. A snapshot can create a new volume, and that volume can attach to a replacement instance in the right Availability Zone. For an application with active writes, teams should think about consistency before snapshotting. Some workloads need filesystem flushes, application quiescing, database-native backup coordination, or AWS Backup plans.

EFS and FSx can use AWS Backup for supported backup workflows. The exact features vary by filesystem type, so teams should check the current AWS docs and test restore procedures. For shared filesystems, restore testing should include permissions and mount behavior, not only file existence. A restored share that loses critical ACLs can still break the application.

Performance checks depend on the service. For EBS, teams watch volume queue length, throughput, IOPS, latency, burst balance where relevant, and instance-level limits. For EFS, teams watch throughput, percent I/O limit, client connections, metadata-heavy operations, and mount errors. For FSx, teams watch the metrics and health signals for the chosen filesystem type.

A small restore drill is worth doing before launch. Maple Market can create a test file, run a backup, delete or corrupt the test file, restore into a separate location, mount it from a test client, and verify the file contents and permissions. That drill proves the recovery path with the same tools the team would use during an incident.

## Choosing Between EBS, EFS, and FSx
<!-- section-summary: The best choice comes from the filesystem behavior the workload needs, then placement, sharing, performance, and operations narrow it further. -->

Here is the short comparison Maple Market can use during design review. It starts with the interface the workload expects, then maps that interface to the AWS service family.

| Need | Usually review first | Why |
|---|---|---|
| One EC2 instance needs a durable disk | EBS | It behaves like a block device attached to the instance |
| A boot volume or application disk needs snapshot recovery | EBS | Volumes and snapshots fit host-level disk management |
| Many Linux clients need the same file tree | EFS | It provides managed shared NFS file storage |
| Containers or Lambda need a shared Linux path | EFS | It can mount from supported compute services through VPC access |
| Windows applications need SMB and Active Directory | FSx for Windows File Server | It gives managed Windows file shares and Windows permissions |
| HPC or ML jobs need a high-performance parallel filesystem | FSx for Lustre | It fits large parallel file workloads and S3-linked datasets |
| Existing NetApp operations need ONTAP features | FSx for NetApp ONTAP | It provides managed ONTAP capabilities in AWS |
| OpenZFS features matter to the workload | FSx for OpenZFS | It gives managed OpenZFS file storage |

One anti-pattern deserves a clear callout. Teams sometimes use EBS for data that many instances need to share. That usually creates a fragile handoff because normal EBS volumes attach to one instance for normal read/write use. If many clients need the same files, EFS or FSx usually fits better. EBS shines when one compute placement needs a disk.

Another common mistake is choosing EFS just because it feels flexible. Shared filesystems are useful, but they introduce network dependency, permission coordination, and shared-state behavior. If the application can use S3 objects cleanly, S3 is often simpler for files that do not need POSIX filesystem semantics.

## Putting It All Together
<!-- section-summary: EBS, EFS, and FSx cover disk and filesystem workloads that object storage and databases do not naturally serve. -->

Maple Market now has a clean split. The search index uses EBS because it needs one fast block volume attached to one EC2 placement. The warehouse import workers use EFS because several Linux tasks need the same shared directory. The finance reporting application uses FSx for Windows File Server because it needs SMB, Windows permissions, and directory integration.

The operating plan is part of the decision. EBS needs volume type, Availability Zone placement, snapshots, mount persistence, and instance replacement steps. EFS needs mount targets, access points, security groups, throughput monitoring, and backup tests. FSx needs the right filesystem family, network access, native permissions, backups, and service-specific metrics.

The storage service should match the interface the application expects. Object API points to S3. SQL points to RDS or Aurora. Key-based item access points to DynamoDB. Disk and filesystem behavior points to EBS, EFS, and FSx.

## What's Next
<!-- section-summary: The next article moves from filesystems to relational databases for structured business records. -->

Mounted storage solves disk and shared-file problems. The checkout system still needs tables, constraints, transactions, and SQL. The next article covers relational databases with RDS and Aurora.

---

**References**

- [What is Amazon EBS?](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html) - Defines EBS volumes as block storage for EC2 instances.
- [Amazon EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html) - Explains attachment behavior, durability, and live modification options for current-generation volumes.
- [Amazon EBS volume types](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html) - Documents SSD and HDD volume type choices and performance characteristics.
- [Amazon EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html) - Covers point-in-time incremental backup behavior.
- [Make an Amazon EBS volume available for use](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-using-volumes.html) - Shows formatting, mounting, and filesystem setup after volume attachment.
- [What is Amazon EFS?](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html) - Describes elastic shared file storage and supported compute clients.
- [How Amazon EFS works](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html) - Explains mounting EFS through VPC mount targets and NFS.
- [Amazon EFS access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html) - Documents application-specific entry points and POSIX identity controls.
- [Amazon FSx Documentation](https://docs.aws.amazon.com/fsx/) - Provides official guides for FSx filesystem types including Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.
- [What is FSx for Windows File Server?](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html) - Explains managed Windows file shares, SMB access, backups, and Active Directory integration.
- [Working with Microsoft Active Directory for FSx for Windows File Server](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/aws-ad-integration-fsxW.html) - Documents domain join behavior and file or folder access control through Active Directory identities.
