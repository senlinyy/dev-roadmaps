---
title: "Persistent Disk and Filestore"
description: "Use Google Cloud Persistent Disk, Hyperdisk, and Filestore for VM and legacy workloads that need block devices, mounted paths, or shared NFS directories."
overview: "Some workloads still expect Linux paths instead of object APIs or database drivers. This article follows a VM-based rendering workload through block disks, Hyperdisk choices, formatting, mounting, snapshots, regional disks, Filestore NFS, permissions, backups, and Terraform examples."
tags: ["gcp", "persistent-disk", "filestore", "attached-storage"]
order: 6
id: article-cloud-providers-gcp-storage-databases-persistent-disk-filestore
aliases:
  - persistent-disk-and-filestore
  - attached-storage
---

## Table of Contents

1. [Why Some Workloads Need Attached Storage](#why-some-workloads-need-attached-storage)
2. [Persistent Disk, Hyperdisk, and the VM Boundary](#persistent-disk-hyperdisk-and-the-vm-boundary)
3. [Linux Formatting, Mounting, and Growth](#linux-formatting-mounting-and-growth)
4. [Regional Disks, Snapshots, and Restore Practice](#regional-disks-snapshots-and-restore-practice)
5. [Filestore for Shared NFS Paths](#filestore-for-shared-nfs-paths)
6. [Permissions, Locking, and Operating Habits](#permissions-locking-and-operating-habits)
7. [Terraform Blueprint for VM Storage](#terraform-blueprint-for-vm-storage)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Some Workloads Need Attached Storage
<!-- section-summary: Attached storage gives VM workloads normal operating-system paths when the application interface expects disks, files, and directories. -->

Most modern cloud applications talk to storage through APIs. A web service uploads images to Cloud Storage, writes relational records to Cloud SQL, stores documents in Firestore, and sends analytical events to BigQuery. That style works beautifully when the application code already understands those services.

Older software often expects something simpler and lower-level: a path on a machine. A renderer writes frame caches to `/var/lib/render-cache`. A migration tool reads vendor files from `/mnt/incoming`. A commercial application opens lock files, renames directories, and assumes POSIX-style permissions. Rewriting that software to use object APIs can turn a small migration into a risky product rewrite.

**Attached storage** covers the cloud services that look familiar to the operating system. **Block storage** looks like a disk device, so Linux can format it with `ext4` or `xfs` and mount it at a local path. **File storage** looks like a shared network filesystem, so several VMs can mount the same directory tree over NFS.

In this article, we will follow Northstar Shop again, but now from the operations side. The checkout platform has a legacy invoice and media renderer running on Compute Engine. Each renderer VM needs a fast local cache at `/mnt/render-cache`, and all renderer VMs need a shared handoff area at `/mnt/media-shared` for incoming source files and completed PDFs. Persistent Disk or Hyperdisk handles the local block device. Filestore handles the shared NFS path.

The first choice is the most important one: one VM-owned disk, or one shared filesystem for many clients. That choice decides which service owns consistency, permissions, backups, and failure recovery.

## Persistent Disk, Hyperdisk, and the VM Boundary
<!-- section-summary: Persistent Disk and Hyperdisk provide durable network-attached block devices; the VM still owns the filesystem and mount behavior. -->

**Persistent Disk** is durable block storage for Compute Engine and supported Google Kubernetes Engine use cases. Google Cloud presents the disk to a VM as if it were a physical disk, even though the service stores the data on Google's managed network-attached storage. The disk can outlive the VM. A team can detach it, attach it to another compatible VM, snapshot it, encrypt it, and resize it upward.

**Hyperdisk** is Google Cloud's newer durable block storage family. Google recommends Hyperdisk for the highest performance and advanced features when the machine series supports it. The biggest practical difference for a junior engineer is performance control. Persistent Disk performance depends on the provisioned capacity, so increasing performance often means increasing disk size. Hyperdisk lets teams configure performance separately from capacity for supported types.

For Northstar's renderer, the cache disk stores temporary rendered frames and a small local work database. The VM owns the filesystem, so a normal single-writer block disk fits. The team starts with a balanced Persistent Disk because the workload needs durable storage, moderate cost, and predictable behavior.

```bash
gcloud compute disks create render-cache \
  --type=pd-balanced \
  --size=200GB \
  --zone=us-central1-a

gcloud compute instances attach-disk render-vm-01 \
  --disk=render-cache \
  --zone=us-central1-a \
  --device-name=render-cache
```

The `device-name` matters. Inside Linux, Google creates a stable path under `/dev/disk/by-id/` from that name. Stable device names protect the mount from changing when Linux sees disks in a different order after a reboot.

If the renderer later needs higher IOPS or throughput and runs on a compatible machine type, the team can evaluate Hyperdisk. For example, a render metadata database with heavier write pressure might use Hyperdisk Balanced with explicit performance settings.

```bash
gcloud compute disks create render-metadata \
  --type=hyperdisk-balanced \
  --size=500GB \
  --provisioned-iops=6000 \
  --provisioned-throughput=250 \
  --zone=us-central1-a
```

Block storage gives the VM a raw device. Linux still needs a filesystem and a mount point before application code can use it.

## Linux Formatting, Mounting, and Growth
<!-- section-summary: A block device needs a filesystem, a stable mount path, an fstab entry, and a tested resize process before an application should rely on it. -->

A raw block device is only a stream of blocks. Linux needs a filesystem to organize those blocks into directories and files. Formatting creates that filesystem. Mounting attaches the filesystem to a path such as `/mnt/render-cache`.

After the disk attachment, the renderer VM sees the device path. The team checks the stable name first:

```bash
ls -l /dev/disk/by-id/google-render-cache
lsblk
```

Then the team formats the disk, creates the mount directory, mounts the filesystem, and writes an `/etc/fstab` entry so the mount returns after reboot. That sequence turns a cloud disk resource into the Linux path that the renderer expects.

```bash
sudo mkfs.ext4 -F -E lazy_itable_init=0,lazy_journal_init=0,discard /dev/disk/by-id/google-render-cache

sudo mkdir -p /mnt/render-cache
sudo mount -o discard,defaults /dev/disk/by-id/google-render-cache /mnt/render-cache

DISK_UUID=$(sudo blkid -s UUID -o value /dev/disk/by-id/google-render-cache)
echo "UUID=${DISK_UUID} /mnt/render-cache ext4 discard,defaults,nofail 0 2" | sudo tee -a /etc/fstab

findmnt /mnt/render-cache
df -h /mnt/render-cache
```

The `nofail` option keeps the VM boot path more forgiving if the data disk has an attachment problem. Production teams still alert on missing mounts because an application that writes to an empty mount directory can fill the boot disk by accident. A simple startup check can prevent that class of incident:

```bash
test -d /mnt/render-cache/lost+found
findmnt --mountpoint /mnt/render-cache
```

Persistent Disk and Hyperdisk can grow. Shrinking requires migration to a smaller replacement disk. A common production runbook increases the cloud disk first, then grows the filesystem inside the guest. For `ext4` without a partition table, the Linux side is small:

```bash
gcloud compute disks resize render-cache \
  --size=300GB \
  --zone=us-central1-a

sudo resize2fs /dev/disk/by-id/google-render-cache
df -h /mnt/render-cache
```

If the disk uses partitions, the team grows the partition before growing the filesystem. If the filesystem uses XFS, the team uses `xfs_growfs` on the mounted path. The exact commands matter less than the habit: resize work belongs in a runbook, and the runbook should include verification before and after.

Now the renderer has a durable local path. The next problem is recovery. A durable disk still needs snapshots, restore tests, and a plan for zone failure.

## Regional Disks, Snapshots, and Restore Practice
<!-- section-summary: Snapshots protect block-device data across time, while regional disks help with zonal failure when the application has a tested failover path. -->

A **snapshot** is a point-in-time copy of a disk. Google Cloud snapshots store changed blocks incrementally, so later snapshots can reuse data from earlier ones. Snapshots help with deleted files, bad deployments, failed migrations, and test restores.

A snapshot of a busy filesystem may capture the same kind of state as a sudden power loss. The filesystem journal can recover many cases, but an application such as a database, queue, or renderer index may need its own flush or pause step. For Northstar's renderer cache, the team can rebuild many files from source media, so crash-consistent snapshots are acceptable for the cache. For local metadata databases, the team coordinates with the application first.

One manual maintenance window might look like this:

```bash
sudo systemctl stop northstar-renderer
sudo fsfreeze -f /mnt/render-cache
```

```bash
gcloud compute snapshots create render-cache-before-upgrade \
  --source-disk=render-cache \
  --source-disk-zone=us-central1-a \
  --storage-location=us
```

```bash
sudo fsfreeze -u /mnt/render-cache
sudo systemctl start northstar-renderer
```

Real teams automate that pattern carefully. Google Cloud supports snapshot schedules and guest flush scripts for Linux application-consistent disk snapshots. The team keeps the freeze period short, tests the pre- and post-snapshot scripts, and alerts when a scheduled snapshot fails. A backup with no restore test is only a hopeful file in another place.

Regional disks solve a different problem. A **zonal disk** lives in one zone. A **regional Persistent Disk** synchronously replicates data between two zones in the same region. If `us-central1-a` has a problem, the team can fail over to a VM in the replica zone and attach the regional disk as part of the failover process. The application still needs a tested startup and recovery procedure.

```bash
gcloud compute disks create render-cache-regional \
  --region=us-central1 \
  --replica-zones=us-central1-a,us-central1-f \
  --type=pd-balanced \
  --size=300GB
```

Regional disks help when one VM owns a stateful path and the business needs faster recovery from a zone outage. The filesystem still follows the single-owner block-storage pattern. When many VMs need to read and write the same directory at the same time, Northstar reaches for Filestore.

## Filestore for Shared NFS Paths
<!-- section-summary: Filestore gives multiple clients a managed NFS filesystem for shared directories, handoff files, and applications that need file locking. -->

**Filestore** is Google Cloud's managed file storage service. It runs managed file servers that clients can mount over NFS. A Filestore instance exposes a file share, such as `media`, at an IP address. Each VM mounts that share to a local directory path.

Northstar uses Filestore for `/mnt/media-shared`. The ingest worker writes raw source files into `incoming/`. Renderer VMs claim files into `processing/`, write output PDFs into `complete/`, and move broken inputs into `error/`. Every worker sees the same directory tree.

The team creates a zonal Filestore instance for the local rendering fleet. A regional tier would make sense for more critical shared state that needs regional resilience. Enterprise multishares fit GKE-heavy designs that need high availability and multiple shares. Basic HDD and Basic SSD still exist for legacy and simpler file-sharing cases.

```bash
gcloud filestore instances create render-shared \
  --location=us-central1-a \
  --tier=ZONAL \
  --file-share=name=media,capacity=1TiB \
  --network=name=default
```

After creation, the team reads the instance IP address and mounts the share on each renderer VM:

```bash
gcloud filestore instances describe render-shared \
  --location=us-central1-a \
  --format="value(networks.ipAddresses[0])"
```

```bash
sudo apt-get update
sudo apt-get install -y nfs-common
sudo mkdir -p /mnt/media-shared
sudo mount -t nfs \
  -o hard,timeo=600,retrans=3,rsize=524288,wsize=524288,resvport,tcp \
  10.0.1.2:/media \
  /mnt/media-shared
```

The Filestore mounting guide recommends NFS options such as `hard`, `timeo=600`, `retrans=3`, tuned read and write sizes, and privileged source ports. For supported newer Linux kernels and tiers, `nconnect` can improve throughput by opening multiple TCP connections between the client and server. The exact mount options should match the tier, kernel, and workload, so the team measures with the renderer's real file sizes and avoids relying on a tiny test file.

The boot-time mount belongs in `/etc/fstab` or `autofs`. `autofs` is helpful when a VM should boot even if the network filesystem has a temporary issue and only mount the share on first access. A simple `/etc/fstab` entry looks like this:

```bash
echo "10.0.1.2:/media /mnt/media-shared nfs hard,timeo=600,retrans=3,rsize=524288,wsize=524288,resvport,tcp,_netdev,nofail 0 0" | sudo tee -a /etc/fstab
```

Now several VMs can see the same files. That shared power also creates shared responsibility: permissions, locks, and naming rules need care.

## Permissions, Locking, and Operating Habits
<!-- section-summary: Filestore access combines Google Cloud IAM for managing instances, POSIX permissions for files, and application rules for safe multi-writer behavior. -->

Filestore uses two access layers that beginners often mix up. Google Cloud **IAM** controls who can create, update, view, or delete Filestore resources. POSIX permissions inside the file share control who can read, write, or execute files after a client mounts the share. Granting someone Filestore Editor still leaves Linux file ownership and mode bits in charge of writes to `/mnt/media-shared`.

For Northstar, the renderer VMs run processes as the `renderer` Linux user and group. The team sets matching users and groups across all renderer VMs so files have consistent ownership everywhere. Then it creates shared directories with group ownership and the setgid bit, which makes new files inherit the directory group.

```bash
sudo groupadd --gid 2200 mediaworkers
sudo usermod -aG mediaworkers renderer

sudo mkdir -p /mnt/media-shared/incoming /mnt/media-shared/processing /mnt/media-shared/complete /mnt/media-shared/error /mnt/media-shared/locks
sudo chgrp -R mediaworkers /mnt/media-shared/incoming /mnt/media-shared/processing /mnt/media-shared/complete /mnt/media-shared/error /mnt/media-shared/locks
sudo chmod -R 2770 /mnt/media-shared/incoming /mnt/media-shared/processing /mnt/media-shared/complete /mnt/media-shared/error /mnt/media-shared/locks
```

File locking needs the same production attitude. Filestore supports POSIX features such as file locking, and NFSv4.1 adds richer security options on supported tiers. The application still needs to use locks correctly. A worker can use `flock` around one order or asset:

```bash
flock /mnt/media-shared/locks/order-o_7818.lock ./render-invoice o_7818
```

A simple staging protocol also helps. The ingest process writes to `incoming/order-o_7818.tmp`, closes the file, then renames it to `incoming/order-o_7818.ready`. A renderer moves the ready file to `processing/order-o_7818.render-vm-01`, renders it, then writes the result to `complete/order-o_7818.pdf`. Atomic rename operations make partial files much less likely to fool another worker.

Backups finish the shared filesystem story. Filestore backups capture file share data and metadata as point-in-time copies. Standard backups and enhanced backups have different management features, and support varies by tier and restore target. The important production habit is the same as disks: restore a backup into a test instance before an incident forces the first restore attempt.

```bash
gcloud filestore backups create render-shared-before-import \
  --instance=render-shared \
  --instance-location=us-central1-a \
  --file-share=media \
  --location=us-central1
```

The team now has the operational pieces. The final section shows how the same design usually lands in infrastructure as code.

## Terraform Blueprint for VM Storage
<!-- section-summary: Infrastructure as code keeps disks, attachments, and Filestore instances reviewable, repeatable, and tied to the workload that uses them. -->

Manual commands teach the moving parts. Production teams usually encode the storage layout in Terraform or another infrastructure-as-code tool so changes go through review. The Terraform below sketches the same Northstar design: one VM, one attached block disk, and one Filestore share.

```hcl
resource "google_compute_disk" "render_cache" {
  name = "render-cache"
  zone = "us-central1-a"
  type = "pd-balanced"
  size = 200

  labels = {
    app  = "renderer"
    data = "cache"
  }
}

resource "google_compute_instance" "renderer" {
  name         = "render-vm-01"
  zone         = "us-central1-a"
  machine_type = "e2-standard-4"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  attached_disk {
    source      = google_compute_disk.render_cache.id
    device_name = "render-cache"
    mode        = "READ_WRITE"
  }

  network_interface {
    network = "default"
  }
}

resource "google_filestore_instance" "render_shared" {
  name     = "render-shared"
  location = "us-central1-a"
  tier     = "ZONAL"

  file_shares {
    name        = "media"
    capacity_gb = 1024
  }

  networks {
    network = "default"
    modes   = ["MODE_IPV4"]
  }

  labels = {
    app  = "renderer"
    data = "shared-media"
  }
}
```

Terraform creates the cloud resources, and guest configuration still handles disk formatting, mount directories, and `/etc/fstab` unless the team adds a configuration-management step. In real environments, teams often pair Terraform with startup scripts, Ansible, cloud-init, image baking, or a Kubernetes CSI driver depending on the compute platform. The same rule keeps the design reliable: cloud resource creation, guest OS mounting, application ownership, and restore testing all need ownership.

## Putting It All Together
<!-- section-summary: Persistent Disk, Hyperdisk, and Filestore solve different attached-storage jobs, so the right design starts with the application's file behavior. -->

Northstar's renderer needed two storage shapes. The local cache needed a block device owned by one VM, so the team used Persistent Disk and kept Hyperdisk available for higher performance needs. Linux formatted the device, mounted it by a stable `/dev/disk/by-id/` name, persisted the mount in `/etc/fstab`, and included resize checks in the runbook.

The shared media handoff needed one directory tree across many VMs, so the team used Filestore. The VMs mounted the NFS share at `/mnt/media-shared`, used group ownership and setgid directories for predictable permissions, and followed a staging protocol so workers avoided half-written files. IAM controlled Filestore resource management, while POSIX permissions controlled file access.

Recovery ties both choices together. Disk snapshots help restore block-device state. Regional disks help with zonal failure when the application has a failover process. Filestore backups and snapshots protect shared file data. Every protection mechanism needs a restore test, because a backup process that nobody has restored from still leaves a question mark in the incident room.

The practical selection rule is plain. Use a block disk when one VM or workload instance owns a filesystem. Use Filestore when multiple clients need the same shared filesystem. Use Cloud Storage when the application can work with object APIs and can live without POSIX filesystem behavior.

## What's Next
<!-- section-summary: Attached storage still needs broader retention, restore, and disaster recovery planning across the whole storage module. -->

Persistent Disk and Filestore explain the VM-facing storage pieces. The next article zooms out to backups and retention across storage services, including what teams keep, how long they keep it, where they restore it, and how they prove recovery works before production data is at risk.

---

**References**

- [Google Cloud: Choose a disk type](https://cloud.google.com/compute/docs/disks)
- [Google Cloud: Persistent Disk documentation](https://cloud.google.com/compute/docs/disks/persistent-disks)
- [Google Cloud: Hyperdisk overview](https://cloud.google.com/compute/docs/disks/hyperdisks)
- [Google Cloud: Create and manage regional disks](https://cloud.google.com/compute/docs/disks/regional-persistent-disk)
- [Google Cloud: Format and mount a non-boot disk on Linux](https://cloud.google.com/compute/docs/disks/format-mount-disk-linux)
- [Google Cloud: Change the size of a Persistent Disk](https://cloud.google.com/compute/docs/disks/resize-persistent-disk)
- [Google Cloud: Create disk snapshots](https://cloud.google.com/compute/docs/disks/create-snapshots)
- [Google Cloud: Create Linux application-consistent disk snapshots](https://cloud.google.com/compute/docs/disks/creating-linux-application-consistent-pd-snapshots)
- [Google Cloud: Filestore overview](https://cloud.google.com/filestore/docs/overview)
- [Google Cloud: Filestore service tiers](https://cloud.google.com/filestore/docs/service-tiers)
- [Google Cloud: Create a Filestore instance](https://cloud.google.com/filestore/docs/creating-instances)
- [Google Cloud: Mount Filestore file shares](https://cloud.google.com/filestore/docs/mounting-fileshares)
- [Google Cloud: Filestore supported protocols](https://cloud.google.com/filestore/docs/about-supported-protocols)
- [Google Cloud: Filestore access control](https://cloud.google.com/filestore/docs/access-control)
- [Google Cloud: Filestore backups](https://cloud.google.com/filestore/docs/backups)
