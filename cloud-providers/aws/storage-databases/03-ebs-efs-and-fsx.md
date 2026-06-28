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

1. [When an API Is the Wrong Shape](#when-an-api-is-the-wrong-shape)
2. [EBS for One Attached Disk](#ebs-for-one-attached-disk)
3. [EFS for Shared Linux Files](#efs-for-shared-linux-files)
4. [FSx for Specialist Filesystems](#fsx-for-specialist-filesystems)
5. [Network and Permission Design](#network-and-permission-design)
6. [Backups and Performance](#backups-and-performance)
7. [Choosing Between Them](#choosing-between-them)
8. [References](#references)

## When an API Is the Wrong Shape
<!-- section-summary: EBS, EFS, and FSx exist for workloads that need disk or filesystem behavior instead of an object API. -->

Maple Market already uses S3 for uploaded return photos. Then a search service needs a local index directory, a group of web servers needs shared uploaded assets during a migration, and an old Windows reporting app expects an SMB file share. These workloads want disks or filesystems, not object API calls.

AWS has several storage services for this shape. **Amazon EBS** gives an EC2 instance a block volume that looks like a disk. **Amazon EFS** gives Linux clients a managed NFS filesystem that multiple clients can mount. **Amazon FSx** gives managed filesystems for specific ecosystems such as Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.

The service choice starts with the interface the application expects. Does it need one disk, shared Linux files, Windows shares, high-performance compute files, or ONTAP-style enterprise features?

That interface choice matters because the operating model changes. A disk attached to one EC2 instance has instance placement and snapshot questions. A shared Linux filesystem has mount targets, NFS security groups, POSIX permissions, and throughput questions. A Windows share has SMB, Active Directory, Windows ACLs, and backup questions. The application interface tells you which operational checklist to use.

## EBS for One Attached Disk
<!-- section-summary: EBS gives one compute placement a durable block device that behaves like a local disk to the operating system. -->

**Amazon EBS** provides block storage volumes for EC2 instances. After attachment, the operating system sees a device such as `/dev/nvme1n1`. You create a filesystem, mount it, and use normal file paths.

For the search service, EBS can store an index on one EC2 instance. The volume lives in one Availability Zone, so the EC2 instance must be in the same zone. If the instance fails, you can attach the volume to another compatible instance in that zone, or restore a snapshot to a new volume.

Basic Linux setup after attaching a new volume might look like this:

```bash
sudo mkfs -t xfs /dev/nvme1n1
sudo mkdir -p /var/lib/search-index
sudo mount /dev/nvme1n1 /var/lib/search-index
```

`mkfs -t xfs` creates an XFS filesystem on the attached block device, so verify the device and volume ID before running it. `mkdir -p` creates the mount directory if it does not already exist. `mount` attaches the filesystem at that directory. A quick follow-up such as `df -h /var/lib/search-index` should show the mounted volume and available space.

A healthy `df` check after the mount might look like this:

```bash
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme1n1    100G  4.2G   96G   5% /var/lib/search-index
```

The important fields are `Filesystem`, which should match the expected device, and `Mounted on`, which should match the application path. If the mount path still shows the root disk, the app may write index data to the wrong volume.

EBS is a good fit when one compute placement needs durable disk behavior, predictable performance, snapshots, and encryption. Use EFS or FSx when many servers need to write the same files at the same time.

Add a persistence entry after mounting so the volume returns after reboot. The exact `/etc/fstab` line depends on the device name and filesystem, but the launch checklist should include formatting only once, mounting on boot, testing a reboot, and confirming the application starts after the mount is present. Formatting the wrong device is a real production mistake, so verify the device and volume ID before running `mkfs`.

Volume type matters because each type has a different performance shape. `gp3` is a common general-purpose starting point because size, IOPS, and throughput can be configured. `io2` fits workloads that need higher sustained IOPS and stronger durability characteristics. Throughput-oriented volume types fit large sequential workloads better than small random database-style I/O. The app owner should know whether the disk waits come from IOPS, throughput, queue depth, or the instance's own EBS bandwidth limit.

A practical EC2 boot path records the volume by filesystem UUID instead of a changing device name:

```bash
sudo blkid /dev/nvme1n1
echo 'UUID=11111111-2222-3333-4444-555555555555 /var/lib/search-index xfs defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
df -h /var/lib/search-index
```

`blkid` prints the filesystem UUID. The `/etc/fstab` line uses that UUID because Linux device names can change across boots. `tee -a` appends the mount entry to the file with elevated permissions, `mount -a` tests all configured mounts, and `df -h` should show `/var/lib/search-index` mounted with human-readable size and free-space values.

The `nofail` option can keep the instance booting if the extra data volume is absent, but the application may still fail if that directory is required. For critical disks, add a service dependency or startup check so the app refuses traffic until the mount is present.

![The storage choice map separates block volumes, shared Linux filesystems, and specialist managed filesystems by how applications access them](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/filesystem-choice-map.png)

*The storage choice map separates block volumes, shared Linux filesystems, and specialist managed filesystems by how applications access them.*


## EFS for Shared Linux Files
<!-- section-summary: EFS gives Linux clients a managed NFS filesystem that can be mounted by many compute resources. -->

**Amazon EFS** provides managed NFS file storage. Multiple EC2 instances, ECS tasks, EKS pods, Lambda functions, and other supported compute services can mount the same filesystem. It grows and shrinks as files are added or removed.

For Maple Market, EFS can help during a migration where several web servers still expect a shared upload directory. Each server mounts the filesystem and reads or writes normal paths. The service handles storage capacity management.

A typical mount command looks like this:

```bash
sudo mount -t efs -o tls fs-12345678:/ /mnt/shared-uploads
```

`-t efs` uses the EFS mount helper, `-o tls` encrypts traffic in transit, `fs-12345678:/` mounts the filesystem root, and `/mnt/shared-uploads` is the local path. Verify the mount with `df -h /mnt/shared-uploads` or by writing a small test file from one client and reading it from another authorized client.

EFS access involves network and filesystem permissions. Security groups must allow NFS port `2049` from clients to mount targets. POSIX ownership and permissions still matter inside the filesystem. IAM authorization and access points can help standardize how applications enter the filesystem.

Mount targets are the network anchors. Create them in the Availability Zones where clients run so clients can mount locally and avoid cross-zone dependency. EFS access points are useful when each application should enter a fixed directory with a fixed POSIX identity, such as `/supplier-imports` as UID `10001`. That keeps shared storage from turning into one writable root directory for every service.

EFS performance has its own vocabulary. Throughput can scale with stored data or use configured throughput, depending on the mode. Small-file-heavy workloads can spend more time on metadata operations than on large reads and writes. A shared upload directory during a migration may be fine, while a high-volume build cache or image-processing scratch space may need measurement before production.

Containers need the mount path wired into their runtime definition. An ECS task using EFS might declare a volume and mount it into the container:

```json
{
  "volumes": [
    {
      "name": "supplier-imports",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-0123456789abcdef0",
          "iam": "ENABLED"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "worker",
      "mountPoints": [
        {
          "sourceVolume": "supplier-imports",
          "containerPath": "/mnt/supplier-imports"
        }
      ]
    }
  ]
}
```

Read the fragment from storage outward:

| Field | What it tells the reader |
|---|---|
| `fileSystemId` | The EFS filesystem that will be mounted. |
| `transitEncryption` | ECS should use encrypted NFS traffic between the task and EFS. |
| `accessPointId` | The task enters through a controlled EFS access point instead of the filesystem root. |
| `authorizationConfig.iam` | IAM authorization is enabled, so the task role must be allowed to use that access point. |
| `sourceVolume` | The container mount refers back to the named ECS volume. |
| `containerPath` | The application sees the mounted files at `/mnt/supplier-imports`. |

The network still matters. The task security group needs a path to the EFS mount target security group on NFS port `2049`, and the mount targets should exist in the same AZs as the tasks. The full ECS task-definition shape belongs in the ECS article; the storage point here is how a filesystem ID, access point, IAM authorization setting, and container path combine into one usable directory.

## FSx for Specialist Filesystems
<!-- section-summary: FSx provides managed filesystems for established ecosystems such as Windows File Server, Lustre, NetApp ONTAP, and OpenZFS. -->

**Amazon FSx** is a family of managed filesystems for specific needs. FSx for Windows File Server provides SMB file shares for Windows workloads and Active Directory integration. FSx for Lustre supports high-performance file access for compute-heavy workloads. FSx for NetApp ONTAP and FSx for OpenZFS support teams with those filesystem expectations.

The old Windows reporting app is a clear FSx for Windows File Server candidate. It expects an SMB share, Windows permissions, and domain integration. Rewriting the app to use S3 may be a project for later, but a managed Windows file share can unblock migration.

A Windows client might map the share like this:

```powershell
New-PSDrive -Name M -PSProvider FileSystem -Root "\\amznfsxexample.corp.local\share" -Persist
```

`-Name M` creates the `M:` drive mapping, `-PSProvider FileSystem` says this is a filesystem drive, `-Root` is the SMB UNC path, and `-Persist` keeps the mapping for the user session. A quick `Get-PSDrive M` should show the mapped share and provider.

Choose FSx when the workload's filesystem ecosystem is the requirement. The value comes from protocol compatibility, permissions, performance behavior, and managed operations for that filesystem type.

For FSx for Windows File Server, review the domain join and the user path together. A working file system in the AWS console is only one part. A Windows client should resolve the share name, authenticate through the domain, reach TCP `445`, map the share, read expected files, and write only where its Windows ACL allows it.

The FSx family names matter:

| FSx option | Typical reason to choose it |
| --- | --- |
| FSx for Windows File Server | Windows SMB shares, Active Directory, Windows ACLs, lift-and-shift reporting apps |
| FSx for Lustre | High-performance file access for analytics, machine learning, simulation, or S3-linked processing |
| FSx for NetApp ONTAP | Teams that already depend on ONTAP features, snapshots, clones, or multi-protocol enterprise storage patterns |
| FSx for OpenZFS | ZFS-style snapshots, cloning, and file workflows with managed AWS operations |

Choosing FSx should start with the application protocol and operating expectation. A Windows reporting tool needs SMB and Windows identity. A compute job may need Lustre throughput. An enterprise migration may need ONTAP behavior because other tooling and teams already rely on it.

## Network and Permission Design
<!-- section-summary: Attached and shared storage must be designed with placement, subnets, security groups, IAM, and filesystem permissions together. -->

Disk and filesystem storage lives on network paths. EBS attaches inside one Availability Zone. EFS uses mount targets in subnets, usually across multiple Availability Zones. FSx file systems create network endpoints in selected subnets.

Security groups should describe the client relationship. EFS mount targets allow NFS `2049` from the application security group. FSx for Windows allows SMB `445` from approved Windows clients. EBS access is tied to the EC2 instance attachment and operating system permissions.

IAM and filesystem permissions work together. EFS can use IAM authorization for mounts, while POSIX user and group permissions still control file operations. FSx for Windows uses Windows ACLs and Active Directory identity. Real designs document both the AWS network path and the filesystem permission path.

A good design sentence is specific: "warehouse tasks mount EFS through access point `fsap-...` at `/supplier-imports`, the task security group can reach EFS mount targets on TCP `2049`, and the container writes as UID `10001` only under that directory." That statement is much easier to review than "the app uses EFS."

Use this review shape when a team asks for mounted storage:

| Question | EBS | EFS | FSx |
| --- | --- | --- | --- |
| Which compute can attach or mount it? | One instance or specific attachment pattern | Many supported Linux clients | Clients supported by the chosen filesystem |
| Which network path is required? | Instance placement in the same AZ | NFS to mount targets | SMB, Lustre, ONTAP, or OpenZFS endpoints |
| Which permission layer controls files? | OS users and disk permissions | POSIX, access points, optional IAM mount auth | Filesystem-specific identity such as Windows ACLs |
| How is recovery tested? | Snapshot restored to a new volume | Backup restored to a test filesystem or path | Backup restored and mounted by a test client |

![The mount access view shows how clients, mount targets, security groups, access points, and POSIX permissions all affect shared file access](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/mount-network-access.png)

*The mount access view shows how clients, mount targets, security groups, access points, and POSIX permissions all affect shared file access.*


## Backups and Performance
<!-- section-summary: Disk and filesystem services need recovery copies and performance monitoring because they sit directly on application request paths. -->

EBS snapshots provide point-in-time backups for volumes. AWS Backup can manage backup plans across EBS, EFS, FSx, and other services. For EFS and FSx, backup policies should match the business recovery target and retention needs.

Performance is different for each service. EBS volume type, size, IOPS, and throughput shape disk behavior. EFS performance depends on throughput mode, access pattern, and filesystem size or configured throughput. FSx performance depends on the filesystem family and provisioned settings.

Useful checks include:

```bash
aws ec2 describe-volumes \
  --filters Name=tag:App,Values=search \
  --query 'Volumes[].{Volume:VolumeId,Type:VolumeType,Size:Size,IOPS:Iops,Throughput:Throughput,Encrypted:Encrypted,State:State,Instance:Attachments[0].InstanceId}'

aws efs describe-file-systems \
  --query 'FileSystems[].{FileSystem:FileSystemId,State:LifeCycleState,Encrypted:Encrypted,ThroughputMode:ThroughputMode,SizeBytes:SizeInBytes.Value}'

aws fsx describe-file-systems \
  --query 'FileSystems[].{FileSystem:FileSystemId,Type:FileSystemType,Lifecycle:Lifecycle,Capacity:StorageCapacity,Subnets:SubnetIds}'
```

The EBS command uses a tag filter to find volumes for the search app. The `--query` keeps the output focused on fields operators usually need first: type, size, IOPS, throughput, encryption, state, and attached instance. The EFS and FSx commands use the same idea so the response is small enough to read during an incident.

Example output for the three checks might look like this:

```json
[
  {
    "Volume": "vol-0123456789abcdef0",
    "Type": "gp3",
    "Size": 100,
    "IOPS": 3000,
    "Throughput": 125,
    "Encrypted": true,
    "State": "in-use",
    "Instance": "i-0123456789abcdef0"
  }
]
```

```json
[
  {
    "FileSystem": "fs-12345678",
    "State": "available",
    "Encrypted": true,
    "ThroughputMode": "elastic",
    "SizeBytes": 21474836480
  }
]
```

```json
[
  {
    "FileSystem": "fs-0abc123def4567890",
    "Type": "WINDOWS",
    "Lifecycle": "AVAILABLE",
    "Capacity": 1024,
    "Subnets": ["subnet-0aaa1111", "subnet-0bbb2222"]
  }
]
```

For EBS, confirm the volume is attached to the expected instance and that the performance fields match the workload. For EFS, confirm the file system is available, encrypted, and using the intended throughput mode. For FSx, confirm the filesystem family, lifecycle state, capacity, and subnet placement before debugging the application.

Also monitor from the application side. Cloud metrics can show storage throughput, but application latency tells you whether users are waiting on disk or filesystem operations.

A restore drill should prove more than file existence. For EBS, restore a snapshot to a new volume, attach it to a test instance, mount it read-only where appropriate, and verify the application can read expected data. For EFS or FSx, restore into a separate location or test file system and verify permissions, ownership, share access, and sample application behavior.

Performance symptoms also point to different checks. EBS latency can come from volume type, IOPS, throughput, queue depth, or instance limits. EFS latency can come from many small file operations, throughput mode, cross-AZ access, or client mount behavior. FSx checks depend on the filesystem family, such as SMB sessions and Windows ACLs for FSx for Windows or metadata-heavy workloads for Lustre and OpenZFS.

During an incident, collect the service metric and the client symptom together. A CloudWatch graph that shows throughput is useful, and a timed application read or write tells you whether users are waiting on storage. Storage incidents are easier to solve when the team can connect the AWS service limit to the actual file path the app uses.

Useful evidence might include:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/EBS \
  --metric-name VolumeQueueLength \
  --dimensions Name=VolumeId,Value=vol-0123456789abcdef0 \
  --start-time 2026-06-24T10:00:00Z \
  --end-time 2026-06-24T10:30:00Z \
  --period 60 \
  --statistics Average Maximum

aws efs describe-mount-targets \
  --file-system-id fs-12345678
```

The first command checks whether an EBS volume has a queue building up. A short response can look like this:

```json
{
  "Label": "VolumeQueueLength",
  "Datapoints": [
    {
      "Timestamp": "2026-06-24T10:12:00+00:00",
      "Average": 0.8,
      "Maximum": 4.0,
      "Unit": "Count"
    }
  ]
}
```

`Average` shows the typical queue depth during the period, while `Maximum` catches spikes. Queue length alone does not diagnose the cause, but it tells the team whether requests are waiting on the volume.

The EFS command shows where mount targets exist:

```json
{
  "MountTargets": [
    {
      "MountTargetId": "fsmt-0123456789abcdef0",
      "FileSystemId": "fs-12345678",
      "SubnetId": "subnet-0aaa1111",
      "LifeCycleState": "available",
      "AvailabilityZoneName": "us-east-1a"
    }
  ]
}
```

If clients run in an Availability Zone with no nearby mount target, the team has a placement problem to investigate before changing application code.

## Choosing Between Them
<!-- section-summary: The best choice comes from the filesystem behavior the workload needs, then placement, sharing, performance, and operations narrow it further. -->

Choose EBS when one EC2 instance needs a durable disk. Choose EFS when many Linux clients need shared NFS file paths. Choose FSx when the workload needs a managed specialist filesystem such as SMB, Lustre, ONTAP, or OpenZFS.

Then check placement and operations. Does the storage need multiple Availability Zones? Which clients mount it? Which security groups allow the protocol? Which identity system controls file permissions? Which backup plan has been restored in a test? Which metric tells you the workload is close to a limit?

For Maple Market, the search index uses EBS, the migration upload directory uses EFS, and the old Windows reporting app uses FSx for Windows File Server. S3 still handles object uploads. The services work together because each one matches a different application interface.

Two mistakes show up often. The first is using EBS as shared storage for several instances, which creates fragile handoffs because normal EBS use is one compute placement. The second is choosing EFS because it seems flexible when S3 object storage would be simpler for whole-file workflows. Choose the storage interface the application really needs, then accept the operations that come with it.

![The review summary compares EBS, EFS, and FSx by attachment model, sharing pattern, backup needs, and operational owner](/content-assets/articles/article-cloud-providers-aws-storage-databases-ebs-efs-storage-attached-compute/attached-storage-review.png)

*The review summary compares EBS, EFS, and FSx by attachment model, sharing pattern, backup needs, and operational owner.*


## References

- [Amazon EBS documentation](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)
- [Amazon EBS documentation: Volume types](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html)
- [Amazon EBS documentation: Snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)
- [Amazon EFS documentation](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [Amazon EFS documentation: Access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html)
- [Amazon FSx for Windows File Server documentation](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html)
