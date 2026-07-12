---
title: "Persistent Disk and Filestore"
description: "Use Google Cloud Persistent Disk, Hyperdisk, and Filestore for VM and legacy workloads that need block devices, mounted paths, shared NFS folders, snapshots, permissions, and locking."
overview: "Some workloads still need filesystem paths. The guide follows a media rendering workstation and legacy importer through Persistent Disk, Hyperdisk, block storage, formatting, mounting, snapshots, Filestore, NFS, permissions, locking, and AWS anchors."
tags: ["gcp", "persistent-disk", "filestore", "attached-storage"]
order: 6
id: article-cloud-providers-gcp-storage-databases-persistent-disk-filestore
aliases:
  - persistent-disk-and-filestore
  - attached-storage
---

## Table of Contents

1. [Why Some Software Needs a Disk Path](#why-some-software-needs-a-disk-path)
2. [Persistent Disk and Hyperdisk](#persistent-disk-and-hyperdisk)
3. [Block Storage](#block-storage)
4. [Formatting and Mounting](#formatting-and-mounting)
5. [Snapshots](#snapshots)
6. [Filestore and NFS](#filestore-and-nfs)
7. [Permissions and Locking](#permissions-and-locking)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Why Some Software Needs a Disk Path
<!-- section-summary: Persistent Disk, Hyperdisk, and Filestore fit workloads that need operating-system paths rather than object APIs or database drivers. -->

Many cloud-native apps can use Cloud Storage for files and Cloud SQL or Firestore for records. Some software still expects a path on a machine. A render tool writes frames to `/mnt/render-cache`. A legacy importer watches `/var/import/incoming`. A media processing workstation reads and writes shared project folders. A commercial package may only support mounted files.

That is the job of attached storage and shared file storage. The app is asking the operating system for a path, not asking a cloud API for an object name. Google Cloud gives you block disks for VM-local filesystems and Filestore for shared NFS paths.

This topic exists for software that cannot easily change its storage behavior. A modern web app might call Cloud Storage with an object name. A legacy media tool may only know how to open `/mnt/media-shared/project-a/source.mov`. The cloud design has to respect that filesystem expectation while still giving the team backup, permissions, and restore controls.

The first choice is local path versus shared path. A render cache used by one VM can live on a Persistent Disk or Hyperdisk attached to that VM. A media inbox used by several workers needs a shared filesystem such as Filestore. If you choose the wrong shape, the software may run while coordination, locking, backup, and failure recovery stay unclear.

A small studio runs render workers on Compute Engine. Each worker needs a fast local cache at `/mnt/render-cache`. Several workers also need a shared handoff folder at `/mnt/media-shared` so the legacy pipeline can drop source files, claim work, and collect rendered outputs.

![Disk and file share choices](/content-assets/articles/article-cloud-providers-gcp-storage-databases-persistent-disk-filestore/disk-file-share-choices.png)
*Use block storage for one VM that needs a disk-like device. Use shared file storage for several clients that need the same filesystem path.*

## Persistent Disk and Hyperdisk
<!-- section-summary: Persistent Disk and Hyperdisk are durable block storage options that attach to Compute Engine workloads. -->

**Persistent Disk** is Google Cloud's durable block storage for Compute Engine. A VM can attach a disk, the operating system can format it, and software can read and write normal filesystem paths. Persistent Disk has types such as balanced, SSD, and extreme choices that trade cost and performance.

**Hyperdisk** is a newer block storage family for workloads that need more explicit performance choices. Depending on the Hyperdisk type, teams can provision performance characteristics such as IOPS or throughput separately from capacity. It fits high-performance databases, analytics scratch work, and demanding VM workloads after the team has measured what the software needs.

For the render-cache example, `pd-balanced` is a reasonable starting point because the workload mostly needs durable scratch capacity and ordinary filesystem behavior. If render jobs later spend most of their time waiting on disk reads or writes, the team should measure disk latency, throughput, and queue depth before moving to Hyperdisk. The point is not "newer disk type first." The point is to match the disk family to observed workload pressure.

A Hyperdisk review might say: the render worker needs 1 TiB of space, at least 20,000 IOPS during peak thumbnail generation, and enough throughput for several concurrent video segments. That is the kind of evidence that justifies a more explicit performance disk choice. Without those numbers, the simpler Persistent Disk path teaches the storage lifecycle more clearly.

For AWS readers, Persistent Disk and Hyperdisk fill the block-storage job that EBS fills for EC2. The exact performance types and replication options differ, but the workflow is familiar: create a disk, attach it to a VM, format it, mount it, monitor it, snapshot it, and test restore.

## Block Storage
<!-- section-summary: Block storage gives a VM a raw disk-like device, and the operating system turns that device into a filesystem. -->

**Block storage** presents storage as blocks to the operating system. The VM sees a disk device. Linux can format that device with a filesystem such as ext4 or xfs, mount it at a path, and let software use normal file operations.

Cloud Storage stores named objects through an object API. A block disk gives a VM something that behaves like a disk. Use block disks for software that expects file locks, directory scans, local caches, or database files.

The low-level idea is simple: the cloud gives the VM a raw device, and the operating system decides how to organize files on it. Before formatting, the device is just addressable storage blocks. After formatting and mounting, your software sees directories and files. That is why block storage feels familiar to Linux tools and older software.

This also explains the responsibility boundary. Google Cloud gives durable disk storage and attachment behavior. Your team chooses filesystem, mount path, permissions, backup plan, and cleanup rules. A block disk can be the right answer, but it brings operating-system storage work with it.

Create a balanced disk for a render cache:

```bash
gcloud compute disks create render-cache \
  --project=studio-prod \
  --zone=us-central1-a \
  --size=500GB \
  --type=pd-balanced
```

Important details in this command:

- `--zone=us-central1-a` places the disk in one zone.
- `--size=500GB` sets capacity and affects performance characteristics for some disk types.
- `--type=pd-balanced` is a practical starting point for general VM workloads.

Attach it to the render VM:

```bash
gcloud compute instances attach-disk render-worker-1 \
  --project=studio-prod \
  --zone=us-central1-a \
  --disk=render-cache
```

Important details in this command:

- `render-worker-1` is the VM that will see the block device.
- The disk and VM must be in the same zone for this zonal disk attachment.
- After attachment, the operating system still needs formatting and mounting before software can use a path.

## Formatting and Mounting
<!-- section-summary: Formatting creates a filesystem on the block device, and mounting makes that filesystem available at a path. -->

**Formatting** creates a filesystem on a block device. **Mounting** attaches that filesystem to a directory path. These are Linux operations, so the VM image, filesystem choice, and boot behavior matter.

Formatting is like preparing an empty drive so the operating system can store directories and files on it. Mounting is the step that connects that prepared filesystem to a path such as `/mnt/render-cache`. Until the mount exists, the render software has no normal path to use.

This is a dangerous section in real operations because the commands can destroy data if the wrong device is selected. A beginner should always identify the disk first, confirm it has no existing filesystem that matters, and keep the mount process repeatable through startup automation or `/etc/fstab`.

On the VM, inspect disks first:

```bash
lsblk
```

Example output:

```console
NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
sda       8:0    0   20G  0 disk
└─sda1    8:1    0   20G  0 part /
sdb       8:16   0  500G  0 disk
```

Important details in this output:

- `sdb` is the new 500 GB disk with no mount point yet.
- The root disk is already mounted at `/`.
- Formatting the wrong disk can destroy data, so device identification is a real operational step.

Format and mount the new disk:

```bash
sudo mkfs.ext4 -m 0 -F /dev/sdb
sudo mkdir -p /mnt/render-cache
sudo mount -o discard,defaults /dev/sdb /mnt/render-cache
sudo chmod 775 /mnt/render-cache
```

Important details in these commands:

- `mkfs.ext4` creates the filesystem on the new disk.
- `/mnt/render-cache` is the path the render software uses.
- `discard` can help with space reclamation on supported disk types.
- Permissions should match the Linux user that runs the renderer.

For a durable mount across reboot, add a stable device entry to `/etc/fstab` using a persistent disk identifier rather than a device name that may change.

![Persistent Disk lifecycle](/content-assets/articles/article-cloud-providers-gcp-storage-databases-persistent-disk-filestore/persistent-disk-lifecycle.png)
*The disk lifecycle includes create, attach, format, mount, monitor, snapshot, and restore.*

## Snapshots
<!-- section-summary: Snapshots keep point-in-time copies of block disks so teams can restore after corruption, deletion, or failed changes. -->

A **snapshot** is a point-in-time copy of a disk. Snapshots help after a VM script deletes files, a renderer corrupts cache metadata, an upgrade damages local state, or a restore drill needs a copy of a known-good disk.

Think of a snapshot as a recoverable photo of the disk at one point in time. Later, you can use that copy source to create a new disk, inspect files, or roll back a broken host path after validation.

Snapshots need the same seriousness as database backups. If the application is actively writing files, the snapshot may capture a crash-consistent view. That might be fine for a rebuildable cache and risky for a local database. The snapshot plan should say whether the workload must pause, flush, or use application-aware steps before the copy is taken.

For simple caches, a crash-consistent snapshot may be enough because the cache can rebuild some files. For application data, coordinate with the application before taking the snapshot. Stop the service, flush files, or use application-aware scripts for data with consistency requirements.

Manual snapshot flow:

```bash
sudo systemctl stop studio-renderer
sudo sync

gcloud compute snapshots create render-cache-before-upgrade \
  --project=studio-prod \
  --source-disk=render-cache \
  --source-disk-zone=us-central1-a \
  --storage-location=us

sudo systemctl start studio-renderer
```

Important details in this flow:

- Stopping the renderer reduces writes during the snapshot.
- `sync` asks Linux to flush buffered filesystem writes.
- `--storage-location=us` controls where snapshot data is stored.
- Production teams usually automate scheduled snapshots and alert on failures.

Restore practice should create a new disk from the snapshot and mount it on a test VM before anyone trusts the policy:

```bash
gcloud compute disks create render-cache-restore \
  --project=studio-prod \
  --zone=us-central1-a \
  --source-snapshot=render-cache-before-upgrade

gcloud compute instances attach-disk render-restore-test \
  --project=studio-prod \
  --zone=us-central1-a \
  --disk=render-cache-restore
```

Important details in these commands:

- The restored disk is new, so the team can inspect it without replacing production.
- The test VM should be isolated from the production renderer so no worker accidentally writes to the restored data.
- The snapshot name should match the incident timeline or scheduled snapshot policy.

On the test VM, mount the restored disk read-only first:

```bash
sudo mkdir -p /mnt/render-cache-restore
sudo mount -o ro /dev/sdb /mnt/render-cache-restore
find /mnt/render-cache-restore -maxdepth 2 -type f | head
du -sh /mnt/render-cache-restore
```

Example output:

```console
/mnt/render-cache-restore/jobs/job_8842/frame_0001.tmp
/mnt/render-cache-restore/jobs/job_8842/frame_0002.tmp
/mnt/render-cache-restore/manifests/render-state.json
487G    /mnt/render-cache-restore
```

That output proves the restored disk mounts, expected files exist, and the size roughly matches the known workload. The application owner should still inspect a few files or run a renderer validation before any production replacement.

## Filestore and NFS
<!-- section-summary: Filestore provides managed NFS file shares for workloads that need the same mounted path from multiple clients. -->

**Filestore** is Google Cloud's managed file storage service. It exposes file shares over **NFS**, Network File System. Several clients can mount the same share and read or write files through normal filesystem paths.

The studio uses Filestore for `/mnt/media-shared`. Ingest workers write source media into `incoming/`. Render workers claim files into `processing/`. Completed outputs land in `complete/`. Support tools can open the same shared tree without copying every file through object storage first.

Create a Filestore instance for the shared media path:

```bash
gcloud filestore instances create media-shared \
  --project=studio-prod \
  --zone=us-central1-a \
  --tier=BASIC_SSD \
  --file-share=name=media,capacity=1TiB \
  --network=name=studio-vpc
```

Important details in this command:

- `--file-share=name=media,capacity=1TiB` names the exported share and sets capacity.
- `--network=name=studio-vpc` makes the share reachable inside the chosen VPC.
- The tier choice should match performance, availability, and cost needs.

Mount the share on a VM after you know the Filestore IP address:

```bash
sudo mkdir -p /mnt/media-shared
sudo mount -t nfs 10.42.0.18:/media /mnt/media-shared
```

Important details in these commands:

- `10.42.0.18:/media` is the Filestore export path.
- `/mnt/media-shared` is the local path seen by the application.
- Persistent mounts should be added carefully to `/etc/fstab` with boot behavior tested.

For AWS readers, Filestore is the GCP anchor for shared NFS-style storage, close to EFS for many Linux shared-file designs. FSx is the broader AWS family for teams that need specific filesystem engines.

## Permissions and Locking
<!-- section-summary: Shared filesystems need Linux permissions, application ownership, and locking behavior designed before multiple clients write the same path. -->

Shared storage adds coordination work. Linux file permissions decide which users and groups can read or write paths. Application ownership decides which process should create, move, and delete files. Locking behavior decides how two workers avoid processing the same file at the same time.

Locks are agreements between processes. Some software uses operating-system file locks. Some software uses a lock file such as `job_913.lock`. Some pipelines avoid separate lock files and use an atomic move or rename as the claim operation. The important point is that every worker must follow the same rule. A lock file helps little if another worker ignores it and opens the source file directly.

A safe shared workflow usually uses directories with clear meaning:

| Directory | Owner | Purpose |
|---|---|---|
| `/mnt/media-shared/incoming` | Ingest worker | New files arrive here |
| `/mnt/media-shared/processing` | Render workers | Claimed files move here |
| `/mnt/media-shared/complete` | Render workers | Finished outputs land here |
| `/mnt/media-shared/error` | Render workers | Failed files move here with logs |

The application should use atomic operations where possible. For example, a worker can move a file from `incoming/` to `processing/worker-17/` to claim it. Keep the source and destination on the same Filestore share so Linux can use a rename operation instead of a copy-and-delete flow.

A tiny worker claim flow might look like this:

```bash
worker_id="worker-17"
mkdir -p "/mnt/media-shared/processing/${worker_id}"

for source in /mnt/media-shared/incoming/*.mov; do
  file_name="$(basename "$source")"
  claimed="/mnt/media-shared/processing/${worker_id}/${file_name}"

  if mv -n "$source" "$claimed"; then
    echo "claimed ${file_name} for ${worker_id}"
    ./render-media "$claimed" "/mnt/media-shared/complete/${file_name%.mov}.mp4" \
      && rm "$claimed"
  else
    echo "skipped ${file_name}; another worker claimed it first"
  fi
done
```

Important details in this flow:

- The move from `incoming/` to `processing/worker-17/` is the claim signal.
- Each worker writes to its own processing directory, which makes stuck work easier to inspect.
- The command checks the result of `mv`; a failed move means the worker should skip that file.
- Finished output lands in `complete/`, and failed work should move to `error/` with a log file.

This file-based claim pattern fits small importers and simple media pipelines. Use a queue or database for coordination once the workflow needs retries, priorities, deadlines, duplicate detection, idempotency keys, worker heartbeats, or human-visible job state. In that design, Filestore stores the bytes and the queue or database owns the work status.

![Filestore shared workflow](/content-assets/articles/article-cloud-providers-gcp-storage-databases-persistent-disk-filestore/filestore-shared-workflow.png)
*Shared file storage needs workflow rules alongside the mounted path.*

## Putting It Together
<!-- section-summary: Attached and shared storage fit VM-era software that depends on filesystem paths, block devices, snapshots, and NFS semantics. -->

Persistent Disk and Hyperdisk fit software that needs a disk-like device attached to a VM. The required order is create, attach, format, mount, monitor, snapshot, and restore. Filestore fits software that needs a shared NFS path across clients, with permissions and locking designed as part of the workflow.

Use Cloud Storage for whole objects if the app can work through an object API. Use Cloud SQL, Firestore, or BigQuery for records, documents, or analytics. Use attached or shared filesystems for software that truly needs operating-system paths.

## References

- [Persistent Disk documentation](https://cloud.google.com/compute/docs/disks/persistent-disks) - Documents durable block storage for Compute Engine VMs.
- [Hyperdisk documentation](https://cloud.google.com/compute/docs/disks/hyperdisks) - Documents Hyperdisk options for performance and capacity planning.
- [Format and mount a persistent disk](https://cloud.google.com/compute/docs/disks/format-mount-disk-linux) - Documents Linux formatting and mount steps for attached disks.
- [Persistent Disk snapshots](https://cloud.google.com/compute/docs/disks/snapshots) - Documents disk snapshot creation and restore behavior.
- [Filestore documentation](https://cloud.google.com/filestore/docs) - Official documentation for managed NFS file shares.
- [Mount Filestore file shares](https://cloud.google.com/filestore/docs/mounting-fileshares) - Documents client mount steps for Filestore shares.
- [Filestore access control](https://cloud.google.com/filestore/docs/access-control) - Documents network and permissions controls for Filestore access.
