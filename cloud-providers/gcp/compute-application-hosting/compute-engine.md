---
title: "Compute Engine"
description: "Understand the GCP virtual machine fit and the server responsibility your team keeps after choosing it."
overview: "Compute Engine gives you cloud servers in GCP through virtual machines, images, machine types, disks, zones, startup scripts, systemd, identity, networking, and operations."
tags: ["gcp", "compute-engine", "vms", "servers"]
order: 3
id: article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines
aliases:
  - compute-engine-virtual-machines
  - cloud-providers/gcp/compute-application-hosting/compute-engine-virtual-machines.md
---

## Table of Contents

1. [Why Some Software Expects a Server](#why-some-software-expects-a-server)
2. [Virtual Machine](#virtual-machine)
3. [Image](#image)
4. [Machine Type](#machine-type)
5. [Disk](#disk)
6. [Zone](#zone)
7. [Startup Script](#startup-script)
8. [systemd](#systemd)
9. [Identity, Network, and Repeatability](#identity-network-and-repeatability)
10. [Operations Runbook](#operations-runbook)
11. [Putting It All Together](#putting-it-all-together)
12. [References](#references)

## Why Some Software Expects a Server
<!-- section-summary: Compute Engine fits software that needs the operating system and long-running server behavior as part of the runtime. -->

Some software expects a server. An invoice renderer may need a licensed native PDF package, a long-running Linux daemon, a local spool directory, a mounted disk, and process supervision from the operating system. The team may want to rewrite it later, but the safe first cloud step is to keep the server shape and make that server reproducible.

**Compute Engine** is Google Cloud's virtual machine service. It gives your team cloud servers while Google operates the physical hardware and virtualization layer. Your team still owns the guest operating system, packages, patching, startup behavior, process manager, disks, network exposure, and application health inside the server.

The invoice renderer gives us a concrete job. It polls for approved invoices, renders PDF files with a vendor library, stores finished files, records status, and writes logs for finance support. It has no reason to receive public web traffic. It does need host-level control.

For AWS readers, Compute Engine maps closely to EC2. Images map to AMIs, Persistent Disk maps to EBS, and startup scripts play a role similar to user data. The IAM, metadata, disk, and networking details are GCP-specific, so the operating habit transfers while the exact controls need GCP review.

![Invoice worker reasons for choosing a VM](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/invoice-worker-vm-fit.png)
*The invoice renderer fits a VM because the operating system, daemon model, disk behavior, and patch plan are part of the workload.*

## Virtual Machine
<!-- section-summary: A VM is a software-defined server with an operating system and server responsibilities your team still owns. -->

A **virtual machine**, or **VM**, is a software-defined server. It runs an operating system such as Debian, Ubuntu, Red Hat Enterprise Linux, or Windows Server on Google-managed infrastructure. The VM has CPU, memory, a boot disk, a network interface, metadata, a service account, and a location.

For the invoice renderer, the VM is the place where the vendor PDF package and long-running worker process live. The server can run a Linux service, write temporary files to a known path, and expose no public IP address. That is a good fit for workloads that depend on the operating system instead of only on an HTTP container contract.

The first design sketch is small:

| Runtime piece | Invoice renderer choice | Why it exists |
|---|---|---|
| **VM name** | `invoice-renderer-prod-01` | Operators need a clear server identity. |
| **Operating system** | Debian 12 or a hardened custom image | The renderer needs approved Linux packages and baseline security settings. |
| **Process model** | Linux service manager | The worker needs restart behavior and process logs. |
| **Network path** | Internal IP only | The worker talks to private services and should not expose SSH or HTTP publicly. |
| **Runtime identity** | `invoice-renderer-runtime@...` | The process needs narrow access to artifacts, secrets, logs, and storage. |

The VM definition leads to the boot image, because every replacement server needs to know what operating system and baseline files it starts from.

## Image
<!-- section-summary: An image is the boot template that supplies the operating system and baseline files for a VM. -->

An **image** is the boot disk template for a VM. Public images are maintained by Google, operating-system projects, or vendors. A **custom image** belongs to your project or organization and can include approved packages, agents, certificates, security settings, and baseline configuration.

Think of the image as the starting recipe for a new server. If the VM disappears, the image is the first thing the replacement VM uses to rebuild the operating-system layer. A public Debian image gives you a clean operating system. A custom image can give you the clean operating system plus the approved monitoring agent, security baseline, and vendor package already installed.

The invoice renderer can use a public Debian image plus a startup script for the first migration. After the migration settles, the team may build a custom image with Packer or an image pipeline so the vendor package and agents are already present. The image should avoid secrets because images are copied and reused; secrets belong in Secret Manager or another runtime access path.

The image choice answers a simple recovery question: if this server disappears, can a new server boot from a known baseline? A public image plus deterministic startup may be enough. A custom image may reduce boot time and reduce package-install risk for sensitive vendor dependencies.

The useful split is baseline versus runtime. The image should contain stable baseline items that many VMs share. Runtime values such as database passwords, API tokens, feature flags, and per-environment settings should come from metadata, Secret Manager, or configuration management during boot.

## Machine Type
<!-- section-summary: A machine type chooses the CPU and memory shape for the VM. -->

A **machine type** is the concrete CPU and memory shape of the VM, such as `e2-standard-2`, `n2-standard-4`, or a memory-optimized type. Google Cloud groups machine types into families and series for different workload needs.

The invoice renderer can use a general-purpose machine because PDF rendering and database polling need moderate CPU and memory. The team should size from evidence: render duration, CPU saturation, memory pressure, disk throughput, and backlog age. A month-end batch that misses the finance window may justify a larger machine type or more workers through a managed instance group.

Useful sizing signals:

| Signal | What it means | Possible response |
|---|---|---|
| **CPU near saturation** | PDF rendering uses most available CPU for long periods. | Test a larger general-purpose type or a compute-optimized type. |
| **Memory pressure** | The process swaps or exits during large invoice batches. | Increase memory or split work into smaller batches. |
| **Disk wait** | The worker waits on local file writes. | Use a better disk type, resize the disk, or move finished files to Cloud Storage sooner. |
| **Backlog age** | Invoices wait too long before rendering. | Add capacity if the job is safe to run concurrently. |

The machine type should live in Terraform, an instance template, or another reviewed path. A production sizing change deserves the same review trail as an application deploy.

## Disk
<!-- section-summary: A disk gives the VM block storage for the operating system and any local data the workload needs. -->

A **disk** is block storage attached to the VM. The boot disk holds the operating system. Additional Persistent Disks can hold local application data, spool files, or large working directories. Persistent Disk data survives VM stop and restart, and snapshots can help with backup and recovery.

Think of the VM as the computer and the disk as the drive attached to it. The boot disk is the drive the operating system starts from. A data disk is a separate drive for application files. Keeping application data on a separate disk gives the team more choices during repair: replace the VM, reattach the disk, restore from a snapshot, or inspect files without rebuilding the whole host.

The disk is still a server responsibility. A disk can fill up, use the wrong filesystem, miss a snapshot schedule, or hold hidden state that no other system can recreate. A good VM design says which data is allowed to live on the disk and which data must move to Cloud Storage, Cloud SQL, or another durable service.

For the invoice renderer, split data by purpose:

| Data | Good home | Reason |
|---|---|---|
| Operating system and baseline packages | Boot disk from image | A replacement VM can recreate the host. |
| Temporary render spool | Separate Persistent Disk or clearly managed temp path | In-flight work may need controlled cleanup or recovery. |
| Finished invoice PDFs | Cloud Storage | Finished files need object storage, lifecycle rules, and downstream access. |
| Invoice state | Database | The worker should not rely on a local file as the source of truth. |

A separate data disk can help during recovery because the disk lifecycle is not tied as tightly to one VM object. The team still needs a clear rule for stuck spool files, retries, and cleanup so the disk does not turn into hidden application state.

## Zone
<!-- section-summary: A zone is the location and failure boundary for a VM. -->

A **zone** is a deployment location inside a region, such as `us-central1-a`. A Compute Engine VM is a zonal resource. If the zone has an outage, a single VM in that zone is affected.

For a development renderer, one zone may be fine. For production finance work, the team should document what happens if the VM or zone is unavailable. A queue-backed renderer can run replacement workers in another zone if the database or message queue preserves the work list. A managed instance group can recreate VMs from a template. Finished PDFs should land in Cloud Storage rather than only on the VM disk.

Here is a compact VM creation command that shows VM, image, machine type, disk, zone, network, identity, and startup input together:

```bash
gcloud compute instances create invoice-renderer-prod-01 \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --subnet=apps-us-central1 \
  --no-address \
  --service-account=invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --metadata=app-version=2026.07.04 \
  --metadata-from-file=startup-script=startup-invoice-renderer.sh
```

Important parts:

- `--zone` places the VM in one zonal failure boundary.
- `--machine-type` chooses CPU and memory.
- `--image-family` and `--image-project` choose the boot image.
- `--boot-disk-*` chooses boot disk size and type.
- `--no-address` avoids a public external IP.
- `--service-account` attaches the runtime identity.
- `--scopes=https://www.googleapis.com/auth/cloud-platform` lets the VM request Google Cloud API tokens; IAM roles on the service account still decide which API actions are allowed.
- `--metadata` and `--metadata-from-file` pass startup inputs to the VM.

Expected output should show an internal IP and no external IP:

```console
Created [https://www.googleapis.com/compute/v1/projects/PROJECT_ID/zones/us-central1-a/instances/invoice-renderer-prod-01].
NAME                      ZONE           MACHINE_TYPE   INTERNAL_IP  EXTERNAL_IP  STATUS
invoice-renderer-prod-01  us-central1-a  e2-standard-2  10.40.2.15               RUNNING
```

## Startup Script
<!-- section-summary: A startup script turns a fresh VM boot into a ready application host. -->

A **startup script** is a file of commands that runs during VM boot. Compute Engine supplies startup scripts through metadata. The script gives a fresh VM a repeatable path from generic server to ready invoice renderer host.

The startup script is the handoff between "the server exists" and "the application is ready." A VM can be running at the infrastructure level while the renderer service is still missing packages, config, directories, or permissions. The script closes that gap by doing the same setup on every boot or replacement.

The startup script should be deterministic. It should fetch a pinned app version, create users and directories, write config, place the service manager file, and fail clearly if an input is missing. If a human fixes a server only through SSH, the replacement server misses that fix.

Treat the startup script like production code. It should be versioned, reviewed, tested on a disposable VM, and written so repeated runs do not damage the host. A script that only works once can make recovery harder during an incident.

Here is a small startup script shape:

```bash
set -euo pipefail

APP_VERSION="$(curl -fsS -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/app-version")"

useradd --system --home /opt/invoice-renderer --shell /usr/sbin/nologin invoice-renderer || true
mkdir -p /opt/invoice-renderer /etc/invoice-renderer /var/lib/invoice-renderer

gcloud storage cp "gs://billing-artifacts/invoice-renderer/${APP_VERSION}/renderer.tar.gz" /tmp/renderer.tar.gz
tar -xzf /tmp/renderer.tar.gz -C /opt/invoice-renderer
chown -R invoice-renderer:invoice-renderer /opt/invoice-renderer /var/lib/invoice-renderer

cat >/etc/invoice-renderer/env <<ENV
PROJECT_ID=PROJECT_ID
DATABASE_HOST=10.40.0.12
SPOOL_DIR=/var/lib/invoice-renderer
ENV

install -m 0644 /opt/invoice-renderer/service/invoice-renderer.service /tmp/invoice-renderer.service
```

Important parts:

- The script reads `app-version` from the metadata server.
- The artifact path includes the exact app version, which supports rollback.
- A dedicated Linux user runs the worker.
- Local config lives in `/etc/invoice-renderer/env`.
- The service manager file is staged for the next step, where the long-running process is installed and started.

## systemd
<!-- section-summary: systemd keeps the long-running process supervised after startup completes. -->

**systemd** is the service manager used by many Linux distributions. It starts services during boot, restarts them after failures, sends logs to the journal, and exposes status through tools such as `systemctl` and `journalctl`.

For the invoice renderer, startup prepares the host and systemd owns the worker process. A useful service unit makes the runtime contract visible:

![Compute Engine metadata, startup script, and systemd bootstrap path](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/vm-bootstrap-path.png)
*Metadata supplies inputs, the startup script prepares the host, and systemd owns the long-running invoice process.*

```ini
[Unit]
Description=Invoice renderer worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=invoice-renderer
Group=invoice-renderer
WorkingDirectory=/opt/invoice-renderer
EnvironmentFile=/etc/invoice-renderer/env
ExecStart=/usr/bin/node /opt/invoice-renderer/dist/worker.js
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Important parts:

- The process runs as `invoice-renderer`, not root.
- `EnvironmentFile` keeps runtime configuration outside the app binary.
- `Restart=on-failure` restarts after ordinary crashes.
- `TimeoutStopSec=30` gives the worker time to stop cleanly.
- Journal output can be collected by the Ops Agent for Cloud Logging.

The worker should handle `SIGTERM` safely. If it is rendering one invoice, it can finish the file or mark the invoice for retry before exiting. That behavior protects patching, VM replacement, and controlled restarts.

The startup path can install and start the unit after the file exists:

```bash
cp /tmp/invoice-renderer.service /etc/systemd/system/invoice-renderer.service
systemctl daemon-reload
systemctl enable --now invoice-renderer.service
```

Important parts:

- `cp` places the unit where systemd reads service definitions.
- `systemctl daemon-reload` refreshes systemd after the new unit file appears.
- `systemctl enable --now` enables the service at boot and starts it immediately.

## Identity, Network, and Repeatability
<!-- section-summary: A production VM still needs narrow IAM, private network design, and a reproducible replacement path. -->

The VM's **service account** is the identity the renderer uses for Google Cloud API calls. It might read one Secret Manager secret, download one artifact path, write finished PDFs to one bucket, and send logs. It should not receive broad project administration roles.

Network design should match the job. The invoice renderer does not serve browser traffic, so an internal IP and no public IP is a good default. Firewall rules can target the service account or network tags so only required internal paths are open. SSH access should use controlled administrative paths such as Identity-Aware Proxy or a bastion pattern if the organization requires SSH at all.

Repeatability is the part that separates a managed VM from a hand-built server. The image, machine type, disk, zone, metadata, startup script, service account, firewall rule, and service unit should be represented in infrastructure as code or an instance template. That lets the team replace a failed server without reconstructing it from memory.

An evidence bundle for `invoice-renderer-prod-01` should prove three things: the VM runs with the intended identity, the network posture matches a private worker, and the replacement source exists.

```bash
gcloud compute instances describe invoice-renderer-prod-01 \
  --zone=us-central1-a \
  --format="yaml(serviceAccounts,networkInterfaces,tags.items,metadata.items)"

gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com" \
  --format="table(bindings.role)"

gcloud compute firewall-rules list \
  --filter='targetServiceAccounts:invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com OR targetTags:invoice-renderer' \
  --format="table(name,direction,allowed,sourceRanges,targetServiceAccounts,targetTags)"

gcloud compute instance-templates describe invoice-renderer-template-v7 \
  --format="yaml(properties.machineType,properties.disks,properties.serviceAccounts,properties.metadata.items)"
```

Important parts:

- The instance describe output shows the service account, OAuth scopes, internal IP, public access configuration, tags, and startup metadata.
- The IAM policy output shows which roles the runtime service account can use.
- The firewall output shows which paths can reach the VM.
- The instance template output proves the team has a reusable source for replacement.

Good evidence might look like this:

```yaml
serviceAccounts:
  - email: invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com
    scopes:
      - https://www.googleapis.com/auth/cloud-platform
networkInterfaces:
  - networkIP: 10.40.2.15
    subnetwork: projects/PROJECT_ID/regions/us-central1/subnetworks/private-workers
tags:
  items:
    - invoice-renderer
metadata:
  items:
    - key: startup-script-url
      value: gs://platform-startup/invoice-renderer/startup-v7.sh
```

The service account line names the workload identity. The `cloud-platform` access scope allows the VM to request Google Cloud API tokens, while IAM roles still decide what those tokens can do. The IAM evidence should be narrow, for example `roles/logging.logWriter`, a Secret Manager accessor grant for the renderer secret, and a bucket-specific write path for finished PDFs. Broad roles such as project editor would fail the review because the worker only renders invoices.

For the network side, the useful signal is the missing `accessConfigs` block in `networkInterfaces`. That means the instance has an internal IP without a direct external NAT IP. Firewall evidence should show inbound access only from approved administrative or worker paths:

```console
NAME                         DIRECTION  ALLOW      SOURCE_RANGES  TARGET_SERVICE_ACCOUNTS
allow-iap-ssh-renderers      INGRESS    tcp:22     35.235.240.0/20 invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com
allow-queue-to-renderer      INGRESS    tcp:8080   10.40.0.0/16   invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com
```

The interpretation is practical. SSH, if allowed, comes through an approved Identity-Aware Proxy range. Application traffic comes from the private network. The review should find narrow source ranges instead of a broad `0.0.0.0/0` inbound rule aimed at the renderer service account or tag.

The replacement source should point to a reviewed template or IaC file. A release note can record `invoice-renderer-template-v7`, the image family, startup script URL, systemd unit version, and the Terraform file such as `infra/compute/invoice-renderer.tf`. If the VM is deleted during recovery, the team should be able to recreate it from that source and verify the same service account, private subnet, metadata, disk, and startup behavior.

An **instance template** stores VM configuration for reuse. A **managed instance group** can create and replace VMs from a template. For a renderer that is safe to run concurrently, a managed instance group can give replacement behavior and more capacity. The application still needs a queue or database claim pattern so two workers do not render the same invoice.

## Operations Runbook
<!-- section-summary: VM operations need checks for instance health, process health, startup evidence, disk pressure, patches, and backups. -->

A VM runbook should separate server health from application health. A VM can be running while the invoice renderer is stopped. A renderer can run while it fails every invoice because the vendor license expired. Operators need checks at both layers.

Useful first checks:

```bash
gcloud compute instances describe invoice-renderer-prod-01 \
  --zone=us-central1-a \
  --format="value(status,networkInterfaces[0].networkIP,serviceAccounts[0].email)"

gcloud compute instances get-serial-port-output invoice-renderer-prod-01 \
  --zone=us-central1-a

systemctl status invoice-renderer.service
journalctl -u invoice-renderer.service --since "30 minutes ago"
```

Important parts:

- The first command confirms VM status, internal IP, and runtime service account.
- Serial port output helps with boot and startup-script failures.
- `systemctl` confirms whether the Linux service is active.
- `journalctl` shows recent worker logs on the VM.

Healthy output should include a running instance and an active service:

```console
RUNNING    10.40.2.15    invoice-renderer-runtime@PROJECT_ID.iam.gserviceaccount.com

invoice-renderer.service - Invoice renderer worker
   Loaded: loaded (/etc/systemd/system/invoice-renderer.service; enabled)
   Active: active (running)
```

The runbook should also cover patching and recovery:

| Area | Practical check |
|---|---|
| **OS patches** | Define patch windows or replacement-image rollout through templates. |
| **Disk backups** | Snapshot any disk that holds recoverable local work. |
| **Artifact rollback** | Keep the previous app version available in the artifact bucket. |
| **Log review** | Alert on repeated renderer failures, license errors, and backlog age. |
| **Capacity** | Watch CPU, memory, disk, and render duration during finance peaks. |
| **Replacement** | Prove a new VM can boot from image, metadata, startup script, and service account alone. |

![Compute Engine VM operations evidence board](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/vm-operations-evidence.png)
*A useful VM review checks both layers: cloud instance state and the application process inside the guest OS.*

## Putting It All Together
<!-- section-summary: Compute Engine is the right choice for workloads that require server control and a team ready to own the operating work. -->

Compute Engine fits the invoice renderer because the software needs a server-shaped runtime. The VM gives OS control, packages, disk behavior, startup scripts, and `systemd` supervision. The same choice also gives the team guest OS patching, process health, disk care, network rules, and replacement planning.

The practical design path is direct: define the VM, choose the image, choose the machine type, design the disk, choose the zone, automate startup, hand the process to `systemd`, attach a narrow service account, keep the network private, and write a runbook that proves the server can be replaced.

The next article moves to work that should happen after an event, where keeping a whole server around is usually unnecessary.

## References

- [Create and start a Compute Engine instance](https://docs.cloud.google.com/compute/docs/instances/create-start-instance) - Official guide for creating VM instances.
- [OS images](https://docs.cloud.google.com/compute/docs/images) - Official documentation for public and custom images.
- [Machine families resource and comparison guide](https://docs.cloud.google.com/compute/docs/machine-resource) - Official guide for machine families, series, and machine types.
- [About startup scripts](https://docs.cloud.google.com/compute/docs/instances/startup-scripts) - Official overview of startup scripts for VM boot behavior.
- [Instance templates](https://docs.cloud.google.com/compute/docs/instance-templates) - Official documentation for reusable VM configuration and managed instance groups.
