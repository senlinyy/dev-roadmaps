---
title: "Compute Engine"
description: "Understand when a GCP virtual machine is the right runtime and what server responsibility your team keeps when choosing it."
overview: "Compute Engine gives you cloud servers in GCP. This article explains machine types, images, disks, zones, startup, process management, service accounts, network access, logs, and patching as one server-shaped runtime."
tags: ["gcp", "compute-engine", "vms", "servers"]
order: 3
id: article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines
aliases:
  - compute-engine-virtual-machines
  - cloud-providers/gcp/compute-application-hosting/compute-engine-virtual-machines.md
---

## Table of Contents

1. [What Compute Engine Gives You](#what-compute-engine-gives-you)
2. [The Invoice Worker Scenario](#the-invoice-worker-scenario)
3. [When a VM Fits](#when-a-vm-fits)
4. [Machine Families and Machine Types](#machine-families-and-machine-types)
5. [Images, Disks, and Zones](#images-disks-and-zones)
6. [Startup Scripts and Metadata](#startup-scripts-and-metadata)
7. [Keeping the Worker Running with systemd](#keeping-the-worker-running-with-systemd)
8. [Service Accounts, Scopes, and Network Access](#service-accounts-scopes-and-network-access)
9. [Instance Templates and Managed Instance Groups](#instance-templates-and-managed-instance-groups)
10. [Operations Runbook](#operations-runbook)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Compute Engine Gives You
<!-- section-summary: Compute Engine gives your team a real VM, so your team controls the operating system and also owns the server work that comes with it. -->

**Compute Engine** is Google Cloud's virtual machine service. A virtual machine, or **VM**, is a software-defined server that runs an operating system such as Debian, Ubuntu, Red Hat Enterprise Linux, or Windows Server on Google-managed hardware. Your team chooses the CPU and memory shape, the boot image, the disks, the zone, the network, the service account, and the startup behavior.

That server-shaped control is the point. A VM gives you root access, local processes, host agents, custom packages, scheduled jobs, mounted disks, and deep operating system control. The tradeoff is simple to understand: Google runs the data center and the virtualization platform, while your team still operates the guest operating system and the application process inside it.

For our running example, imagine the same Orders team also owns the billing side of checkout. The main Orders API already has a modern home, but a legacy **invoice worker** still runs as a Linux daemon. It polls an internal database, calls an old PDF rendering library, writes invoice files to a mounted data disk, and depends on a vendor package that expects a normal Linux host. At the same time, the team plans to move receipt emails and file-processing jobs into event-driven functions. That split is healthy: the legacy worker keeps the server it genuinely needs, and the newer background jobs can use smaller event handlers.

So in this article, the VM choice comes from this workload's server-shaped needs rather than habit. Then we will walk through the exact pieces that make the VM reproducible, secure, and operable in production.

![Invoice worker reasons for choosing a VM](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/invoice-worker-vm-fit.png)
*The invoice worker keeps a VM because it needs host packages, a daemon model, disk behavior, and a patch plan that match a server-shaped workload.*

## The Invoice Worker Scenario
<!-- section-summary: A concrete workload helps connect machine sizing, images, disks, startup, identity, networking, and operations into one VM design. -->

The invoice worker has a very plain job. Every few minutes it reads invoices that are ready to generate, renders PDFs with a legacy native library, stores the PDFs, marks each invoice as completed, and sends a small status message back to the billing system. The worker serves no customer web traffic directly, but the finance team depends on it every morning.

That detail matters because production design starts from the job the machine performs. A web API cares about request latency, horizontal scaling, and load balancer health checks. This worker cares about process supervision, a predictable filesystem path for the renderer, controlled access to a database, a safe disk backup path, and clear logs for failed invoice IDs.

Here is the first sketch of the runtime shape:

| Runtime piece | What the team chooses | Why it matters for the invoice worker |
|---|---|---|
| **Machine type** | `e2-standard-2` at first | The worker needs moderate CPU and memory for PDF rendering without paying for a specialized machine. |
| **Image** | Debian public image or a custom hardened image | The OS must include the packages, agents, and baseline security settings the worker expects. |
| **Persistent Disk** | Balanced boot disk plus optional data disk | The worker can keep local spool files without tying the data lifecycle to the VM object. |
| **Zone** | `us-central1-a` for one VM, multi-zone for a group | A single VM has a single zonal failure boundary, while a group can spread replacements across zones. |
| **Startup script** | Metadata-driven bootstrap | A fresh VM can install or configure the worker without a person SSHing in. |
| **Service account** | `invoice-worker-runtime@...` | The process receives only the Google Cloud permissions it needs. |
| **Firewall rules** | Targeted by service account | The worker reaches the database and logging endpoints while avoiding broad inbound access. |

Notice the story already points to the next sections. First we decide whether a VM fits. Then we size it, choose what it boots from, decide where its durable data lives, automate startup, supervise the process, give it identity, and create an operational routine around it.

## When a VM Fits
<!-- section-summary: VMs fit workloads that need operating-system control, host agents, block storage, special packages, or a migration path for legacy software. -->

A **VM runtime** fits when the application needs the operating system as part of the product. That includes legacy software with native dependencies, daemons that expect long-lived local processes, commercial packages licensed by host, monitoring or security agents that run on the guest OS, workloads that need attached block storage, and migrations from an on-premises server where the first cloud step should minimize application change.

Our invoice worker checks several of those boxes. The renderer depends on a native library. The worker already runs under Linux process supervision. The finance team wants a low-risk migration before rewriting the worker. Compute Engine lets the team keep that shape while still using Google Cloud IAM, VPC networking, snapshots, Cloud Logging, and automated instance creation.

The same platform would be a poor first choice for the receipt email job. A receipt handler receives one event, sends one email, records one result, and then waits for the next event. That job has no reason to keep a whole server warm all day. The next article moves that work into Cloud Run functions, but the important design habit starts here: each workload gets the runtime that matches its actual shape.

For a production review, teams usually ask these questions before approving a VM:

| Question | VM-friendly answer | Runtime to consider if the answer differs |
|---|---|---|
| Does the app require OS-level packages, agents, or kernel-adjacent settings? | Yes, the worker depends on host packages and a daemon model. | Cloud Run service if it can run cleanly in a container. |
| Does the app need local block storage or special disk attachment behavior? | Yes, it uses a local spool and controlled disk snapshots. | Cloud Storage, Cloud SQL, or another managed data service. |
| Does the team need a lift-and-shift path before a rewrite? | Yes, migration risk matters more than immediate redesign. | Serverless or containers after the workflow is simplified. |
| Can the app tolerate one zonal VM failing? | Only for a low-criticality worker, or during an early migration stage. | Managed instance group across zones for higher availability. |

This is the first production rule for Compute Engine: the VM is only the beginning. The real design is the surrounding operating model.

## Machine Families and Machine Types
<!-- section-summary: Machine families describe workload-optimized hardware categories, and machine types choose the concrete CPU and memory shape. -->

A **machine family** is a category of VM hardware profiles optimized for a type of workload. Google Cloud groups Compute Engine machines into families such as general-purpose, compute-optimized, memory-optimized, storage-optimized, and accelerator-optimized. A **machine series** is a generation inside a family, and a **machine type** is the concrete shape you create, such as `e2-standard-2` or `n2-standard-4`.

The beginner-friendly way to read a machine type is by asking how much CPU, memory, and special hardware the workload needs. The invoice worker starts with PDF rendering and database polling, so a general-purpose machine is a reasonable first production shape. If rendering turns CPU-heavy, the team can test a compute-optimized type. If a future report generator holds large in-memory datasets, a memory-optimized family may enter the conversation.

The choice should come from measurement and observed bottlenecks. A safe rollout starts with a modest machine type, installs Cloud Monitoring and the Ops Agent, watches CPU, memory, disk throughput, and process restarts, then changes the template if the evidence points to a different shape. For a worker, the useful question moves from "Can this VM run the code?" to "Can this VM clear the invoice backlog inside the business window with headroom?"

Here is a practical sizing pass for the invoice worker:

| Signal | What to watch | What the team does next |
|---|---|---|
| **CPU saturation** | PDF renders keep CPU above 80 percent for long stretches | Test a larger general-purpose type or a compute-optimized type. |
| **Memory pressure** | The process swaps or gets killed during large invoice batches | Increase memory or split large batches into smaller units. |
| **Disk throughput** | PDF writes queue up and the worker waits on local I/O | Use balanced or SSD Persistent Disk, resize the disk, or move finished files to Cloud Storage sooner. |
| **Backlog age** | Old invoices wait too long during month-end | Add more workers through a managed instance group if the job is safe to run concurrently. |

Treat the machine type as a configuration value that lives in Terraform, an instance template, or another reviewed deployment path. That keeps sizing changes visible and repeatable.

## Images, Disks, and Zones
<!-- section-summary: A production VM needs a repeatable boot image, durable disk decisions, and a clear understanding of the zonal failure boundary. -->

An **image** is the boot disk template for a VM. Public images give you common operating systems maintained by Google or OS vendors. A **custom image** is a boot disk image owned by your project or organization, often built from a hardened baseline that already includes agents, certificates, approved packages, and security configuration.

For the invoice worker, the team has two reasonable paths. Early in the migration, a public Debian image plus a startup script may be enough. After the worker stabilizes, a custom image built by Packer or an image pipeline can reduce boot time and remove package-install surprises. The custom image should still avoid embedding secrets; secrets belong in Secret Manager or another controlled runtime path.

A **Persistent Disk** is Google Cloud's durable block storage for Compute Engine. The VM sees it as a disk device, but Google manages the storage behind the scenes. Persistent Disk data has built-in redundancy, and snapshots can protect against user error. Zonal Persistent Disks belong to one zone. Regional Persistent Disks replicate across two zones in the same region for workloads that need a lower recovery point and recovery time than snapshot-only recovery can provide.

For a worker, the disk decision is usually split into three buckets:

| Data type | Good home | Reason |
|---|---|---|
| Application binary and OS packages | Image or startup-managed install | A replacement VM can recreate the runtime. |
| Temporary spool files | Separate Persistent Disk or local temp path with cleanup | The team can control recovery and retention for in-flight files. |
| Final invoice PDFs | Cloud Storage | Finished files need object storage, lifecycle rules, and easy downstream access. |

A **zone** is a deployment location inside a region, such as `us-central1-a`. A VM is a zonal resource, so one VM depends on one zone. That is fine for a development worker or a low-criticality migration stage. Production teams document that boundary clearly, then decide whether they need a regional managed instance group, a regional disk pattern, or a queue-based design where another worker can continue from the next invoice.

Here is a compact creation command that shows the main decisions together:

```bash
gcloud compute instances create invoice-worker-prod-01 \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --subnet=apps-us-central1 \
  --no-address \
  --service-account=invoice-worker-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --metadata-from-file=startup-script=startup-invoice-worker.sh
```

This command is intentionally explicit. It names the zone, machine type, image, disk, subnet, absence of a public IP address, runtime identity, OAuth scope, and startup script. In a real team, this shape should move into Terraform or another infrastructure-as-code workflow so review and rollback stay out of shell history.

Healthy output confirms that the VM object exists and has an internal IP but no public IP. That tells the beginner the instance can still run inside the VPC while public SSH exposure stays off the design path.

```console
Created [https://www.googleapis.com/compute/v1/projects/PROJECT_ID/zones/us-central1-a/instances/invoice-worker-prod-01].
NAME                    ZONE           MACHINE_TYPE   INTERNAL_IP  EXTERNAL_IP  STATUS
invoice-worker-prod-01  us-central1-a  e2-standard-2  10.40.2.15               RUNNING
```

## Startup Scripts and Metadata
<!-- section-summary: Metadata gives a VM runtime facts, and startup scripts turn a fresh boot into a working application server without hand setup. -->

**VM metadata** is key-value configuration that Compute Engine stores for the project or instance. A VM can read metadata from the metadata server at `metadata.google.internal` without extra authorization. Google-managed guest software and your own scripts can use it for startup scripts, attributes, service account tokens, host information, and other runtime facts.

A **startup script** is a file of commands that runs when the VM boots. For our invoice worker, the startup script handles the last mile between a generic VM and a ready worker host. It can create a Linux user, fetch a pinned application artifact, write a configuration file, install a `systemd` unit, start the service, and leave logs that explain what happened during boot.

The clean production habit is to keep startup scripts small and deterministic. The script should pin package versions where that matters, fetch artifacts by immutable version, fail loudly on missing configuration, and avoid one-off manual repair. If the team fixes a VM only by SSHing into it, the next replacement VM will miss that fix.

Here is a startup script shape for the invoice worker:

```bash
set -euo pipefail

APP_VERSION="$(curl -fsS -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/app-version")"

useradd --system --home /opt/invoice-worker --shell /usr/sbin/nologin invoice-worker || true
mkdir -p /opt/invoice-worker /etc/invoice-worker /var/lib/invoice-worker

gcloud storage cp "gs://billing-artifacts/invoice-worker/${APP_VERSION}/worker.tar.gz" /tmp/worker.tar.gz
tar -xzf /tmp/worker.tar.gz -C /opt/invoice-worker
chown -R invoice-worker:invoice-worker /opt/invoice-worker /var/lib/invoice-worker

cat >/etc/invoice-worker/env <<ENV
PROJECT_ID=PROJECT_ID
DATABASE_HOST=10.40.0.12
SPOOL_DIR=/var/lib/invoice-worker
ENV

cp /opt/invoice-worker/systemd/invoice-worker.service /etc/systemd/system/invoice-worker.service
systemctl daemon-reload
systemctl enable --now invoice-worker.service
```

The important detail is the data flow. The VM receives `app-version` through metadata, uses its attached service account to fetch the artifact, writes local configuration, and hands long-running process ownership to `systemd`. This gives the team a repeatable boot path. A broken replacement VM points to a version, a startup log, a service state, and a small number of inputs.

![Compute Engine metadata, startup script, and systemd bootstrap path](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/vm-bootstrap-path.png)
*Metadata supplies the version, the startup script prepares the host, systemd owns the long-running process, and boot logs explain where setup failed.*

## Keeping the Worker Running with systemd
<!-- section-summary: Startup gets the VM ready, while systemd keeps the invoice worker alive and records process-level evidence. -->

**systemd** is the service manager used by many Linux distributions. It starts services during boot, restarts them after failures, sends logs to the journal, controls stop behavior, and exposes status through tools such as `systemctl` and `journalctl`. The startup script should prepare the host, then systemd should own the long-running worker process.

This matters because a billing worker should survive ordinary process crashes. A worker may hit a bad PDF input, lose a database connection, or receive a termination signal during maintenance. The service manager gives the process a stable contract: start this command, run as this user, read this environment file, restart on failure, and write output to the system journal.

A practical unit for the invoice worker looks like this:

```ini
[Unit]
Description=Legacy invoice worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=invoice-worker
Group=invoice-worker
WorkingDirectory=/opt/invoice-worker
EnvironmentFile=/etc/invoice-worker/env
ExecStart=/usr/bin/node /opt/invoice-worker/dist/worker.js
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

The unit makes a few production choices visible. The worker runs as a dedicated Linux user instead of root. `Restart=on-failure` recovers from ordinary crashes without hiding clean shutdowns. `TimeoutStopSec=30` gives the worker a short drain window, which is useful if it marks an invoice attempt before exiting. The journal settings let the Ops Agent collect the process output for Cloud Logging.

The team should also teach the worker how to stop safely. For example, when it receives `SIGTERM`, it can finish the current invoice or put the invoice back into the queue before exiting. That makes restarts, patch windows, and VM replacement much less risky because the process has a graceful stop path.

Daily debugging then uses normal Linux and Google Cloud tools:

```bash
systemctl status invoice-worker.service
journalctl -u invoice-worker.service --since "30 minutes ago"
gcloud compute instances get-serial-port-output invoice-worker-prod-01 --zone=us-central1-a
```

Those commands answer different questions. `systemctl` tells you whether the service is running. `journalctl` shows process logs on the VM. Serial port output helps with early boot and startup-script failures, especially when SSH access is unavailable.

The beginner should look for `active (running)` in `systemctl`, recent invoice progress in `journalctl`, and a completed startup script in serial output. A failed service with clean serial output usually points to the worker process; a missing artifact or package install error usually appears in serial or startup logs.

```console
● invoice-worker.service - Legacy invoice worker
     Loaded: loaded (/etc/systemd/system/invoice-worker.service; enabled)
     Active: active (running) since Sat 2026-06-27 20:10:41 UTC; 18min ago
   Main PID: 1842 (node)

Jun 27 20:24:12 invoice-worker-prod-01 worker[1842]: {"invoice_id":"INV-10492","status":"rendered","worker_version":"2026.06.27.1"}
Jun 27 20:24:14 invoice-worker-prod-01 worker[1842]: {"invoice_id":"INV-10492","status":"uploaded","bucket":"billing-invoices-prod"}
```

## Service Accounts, Scopes, and Network Access
<!-- section-summary: A VM needs a runtime identity for Google APIs and VPC controls for traffic entering and leaving the machine. -->

A **service account** is a Google Cloud identity meant for workloads. When a service account is attached to a VM, applications on that VM can use the service account's credentials to call Google Cloud APIs. IAM roles granted to that service account decide what the workload can do, such as reading a Secret Manager secret or writing objects to one Cloud Storage bucket.

Compute Engine also has **access scopes**, a legacy OAuth scope mechanism. IAM roles decide the service account's permission level, while access scopes can further limit OAuth-based calls from the VM. Google recommends using the broad `cloud-platform` scope and controlling actual access with IAM roles. That pattern avoids confusing failures where IAM allows an API call but the VM's scope blocks it.

For the invoice worker, the runtime service account should be narrow:

| Need | IAM direction |
|---|---|
| Read the worker artifact from one bucket | Grant object read access to the artifact bucket. |
| Write finished invoices to one output bucket | Grant object create access to the invoice output bucket. |
| Read database credentials | Grant Secret Manager secret accessor only for the required secret. |
| Write logs and metrics | Use the standard logging and monitoring roles or agent setup required by the environment. |

The VM network path matters just as much as identity. A **VPC firewall rule** allows or denies connections to or from VM instances, and Google Cloud enforces enabled VPC firewall rules regardless of the guest operating system state. A VM without a public IP address can still reach private resources in the VPC. If it needs Google APIs privately from a subnet without external IP addresses, the subnet design should include Private Google Access or an approved private access pattern.

Targeting firewall rules by service account gives the rule a stronger workload meaning than a loose network tag. For example, the database egress rule can follow the invoice worker identity:

```bash
gcloud compute firewall-rules create allow-invoice-worker-to-db \
  --project=PROJECT_ID \
  --network=prod-vpc \
  --direction=EGRESS \
  --target-service-accounts=invoice-worker-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --destination-ranges=10.40.0.12/32 \
  --rules=tcp:5432
```

Inbound access deserves the same discipline. Many production VMs can avoid public SSH. Teams often use OS Login with IAM, Identity-Aware Proxy for controlled administrative access, or a private bastion path. The invoice worker is a background process, so the normal operational path should be logs, metrics, serial output, and controlled replacement rather than casual interactive repair.

## Instance Templates and Managed Instance Groups
<!-- section-summary: Templates capture the VM recipe, and managed instance groups use that recipe to replace or scale workers. -->

An **instance template** stores a VM configuration: machine type, boot disk image, labels, startup script, service account, network settings, and other instance properties. Google Cloud uses templates to create individual VMs and managed instance groups. Templates are designed for identical VM creation, so teams create a new template when the recipe changes instead of editing the existing template in place.

For one invoice worker, an instance template can seem like extra setup. It earns its keep the first time a boot disk fails, a zone has capacity trouble, or a patch rollout needs a clean replacement. The template says, "This is the server recipe," while the startup script and image say, "This is how the server turns into the invoice worker."

A **Managed Instance Group**, or **MIG**, creates and maintains a group of VM instances from an instance template. A MIG can recreate unhealthy instances, roll out a new template, autoscale in some patterns, and spread instances across zones when configured as a regional group. For the invoice worker, a MIG makes sense only if the job can safely run on more than one VM at a time. The queue or database must prevent two workers from generating the same invoice simultaneously.

Here is the design review for turning one invoice worker into a small group:

| Check | Why it matters |
|---|---|
| **Idempotent claim** | Each invoice job needs a database claim or lock so two workers cannot process it twice. |
| **Externalized output** | Finished PDFs should land in Cloud Storage or another shared destination instead of only one VM disk. |
| **Health signal** | The worker should expose or write a signal that distinguishes "alive" from "clearing work." |
| **Template versioning** | New app versions should create a new template or update path with a rollback target. |
| **Zone spread** | A regional MIG can reduce dependence on one zone if the database and storage path also support that design. |

The invoice worker may stay as a single VM during migration. That is acceptable if the business risk is documented. The production direction should still be clear: one-off VMs are for narrow cases, while repeatable server fleets belong behind templates and groups.

## Operations Runbook
<!-- section-summary: VM ownership includes patching, logging, backups, replacement, and a short incident routine that engineers can follow under pressure. -->

A **runbook** is the written operating routine for a system. It tells the team what to check, what evidence to collect, how to recover, and which actions need approval. Compute Engine reduces hardware work, but the guest OS and the invoice process still need runbook ownership.

Start with patching. **VM Manager** can apply on-demand and scheduled patches, report patch compliance, collect OS inventory, and manage OS policies. A practical team tests patches in development, rolls them through staging, then patches production during a low-risk window. If the worker runs in a MIG, the safer pattern is often replacement from a fresh image or template rollout rather than long-lived hand-patched pets.

Logging and monitoring come next. Compute Engine provides VM observability metrics, and the **Ops Agent** collects more detailed telemetry such as memory and process metrics. The worker should emit structured JSON logs that include `invoice_id`, `attempt_id`, `worker_version`, and a clear status such as `claimed`, `rendered`, `uploaded`, or `failed`. That gives an on-call engineer a clean path from a finance complaint to one invoice attempt.

Backups need a specific answer. Persistent Disk snapshots are incremental and can be scheduled for zonal and regional disks. If the worker writes only temporary files, a short-retention snapshot may be enough. If it writes important local state, the team should prefer moving that state to Cloud Storage, Cloud SQL, or another managed service, because a VM disk backup is a recovery tool rather than a full application consistency guarantee.

Here is a sample operations table for the invoice worker:

| Situation | First checks | Recovery action |
|---|---|---|
| Worker stopped | `systemctl status`, recent `journalctl`, Cloud Logging errors | Restart the service once, then replace the VM from the template if the failure repeats. |
| Startup failed | Serial port output, startup-script logs, metadata values | Fix the script or metadata in source control and create a replacement VM. |
| Invoice backlog rising | CPU, memory, database latency, oldest queued invoice age | Increase machine type, add workers only after job claiming is safe, or reduce batch size. |
| Disk filling | `df -h`, spool directory growth, upload failures | Clear confirmed temporary files, increase disk size, and repair the cleanup path. |
| Security patch due | VM Manager patch status, image pipeline status | Patch lower environments first, then roll production through a replacement or scheduled patch window. |
| Bad deploy | Worker version in logs, instance template version, artifact path | Roll back to the previous artifact version or previous template and confirm new attempts succeed. |

The recurring tasks can also be represented as commands. A snapshot schedule can back up the worker disk:

```bash
gcloud compute resource-policies create snapshot-schedule invoice-worker-daily \
  --project=PROJECT_ID \
  --region=us-central1 \
  --daily-schedule \
  --start-time=03:00 \
  --max-retention-days=14

gcloud compute disks add-resource-policies invoice-worker-data \
  --project=PROJECT_ID \
  --zone=us-central1-a \
  --resource-policies=invoice-worker-daily
```

The create command should show the snapshot schedule policy, and the attach command should confirm the disk now has that policy. If the disk name or zone is wrong, the attach step fails before the team assumes backups exist.

```console
Created [https://www.googleapis.com/compute/v1/projects/PROJECT_ID/regions/us-central1/resourcePolicies/invoice-worker-daily].
Updated [https://www.googleapis.com/compute/v1/projects/PROJECT_ID/zones/us-central1-a/disks/invoice-worker-data].
```

And log review can start with a narrow Cloud Logging query:

```bash
gcloud logging read \
  'resource.type="gce_instance" AND jsonPayload.invoice_id="INV-10492"' \
  --project=PROJECT_ID \
  --limit=50 \
  --format=json
```

The output should show one invoice attempt moving through claim, render, upload, and completion. If the logs stop after `claimed`, the team checks the renderer and process logs. If they stop after `rendered`, the team checks upload permissions and bucket access.

```console
jsonPayload.invoice_id="INV-10492" jsonPayload.status="claimed"  jsonPayload.worker_version="2026.06.27.1"
jsonPayload.invoice_id="INV-10492" jsonPayload.status="rendered" jsonPayload.path="/var/lib/invoice-worker/INV-10492.pdf"
jsonPayload.invoice_id="INV-10492" jsonPayload.status="uploaded" jsonPayload.bucket="billing-invoices-prod"
```

![Compute Engine VM operations evidence board](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/vm-operations-evidence.png)
*A VM runbook needs server evidence and application evidence: instance status, process state, logs, snapshots, firewall scope, and the patch window all matter.*

The runbook should be boring in the best way. During an incident, the team should have already settled how the VM was built, where logs live, which service account it uses, and whether the disk has backups. Those answers should already be in the recipe.

## Putting It All Together
<!-- section-summary: A production VM is a complete recipe: machine shape, image, disk, zone, startup, service supervision, identity, networking, and operations. -->

The invoice worker starts as a legacy server-shaped workload, so Compute Engine is a reasonable home for it. The team chooses a general-purpose machine type, boots from a known image, attaches durable disk where local state is unavoidable, places the VM in a chosen zone, and keeps finished files in Cloud Storage. That covers the physical shape of the runtime.

Then the team makes the server reproducible. Metadata passes in the app version and configuration values. The startup script prepares the host and installs the worker. systemd runs the process, restarts it after ordinary failures, and sends output to the journal. The Ops Agent and Cloud Logging give operators the evidence they need without treating SSH as the main debugging tool.

Finally, the team wraps the VM in production controls. A dedicated service account grants narrow API access. Access scopes use `cloud-platform` while IAM holds the real permissions. Firewall rules target the runtime identity and keep the VM off the public internet. Instance templates document the server recipe, and a MIG enters the design once the invoice claiming logic can handle multiple workers safely.

The Compute Engine takeaway is practical. Use a VM when the workload truly needs a server, then make that server replaceable, observable, patched, backed up, and routine to operate.

## What's Next
<!-- section-summary: The next article moves smaller background jobs out of the VM and into event-driven Cloud Run functions. -->

The invoice worker can stay on Compute Engine while the team modernizes jobs with no full-server dependency. Receipt emails, file upload processing, and small cleanup tasks usually fit an event-driven shape. They need a handler, a trigger, idempotency, retries, and logs rather than a persistent Linux host.

The next article follows those jobs into Cloud Run functions. We will keep the same Orders and billing scenario and look at how Pub/Sub, Eventarc, CloudEvents, service accounts, and retry-safe handler code work together.


---

**References**

- [Compute Engine VM instances](https://docs.cloud.google.com/compute/docs/instances) - Google Cloud's guide to creating and managing VM instances.
- [Machine families resource and comparison guide](https://docs.cloud.google.com/compute/docs/machine-resource) - Defines machine families, series, and machine types.
- [OS images](https://docs.cloud.google.com/compute/docs/images) - Explains public and custom images for Compute Engine boot disks.
- [Persistent Disk](https://docs.cloud.google.com/compute/docs/disks/persistent-disks) - Documents Persistent Disk behavior, zonal and regional disks, snapshots, scaling, and reliability notes.
- [About startup scripts](https://docs.cloud.google.com/compute/docs/instances/startup-scripts) - Describes startup scripts for Linux and Windows VMs.
- [About VM metadata](https://docs.cloud.google.com/compute/docs/metadata/overview) - Explains the metadata server and metadata key-value model.
- [Service accounts for Compute Engine](https://docs.cloud.google.com/compute/docs/access/service-accounts) - Covers VM service accounts, IAM roles, and access scopes.
- [Networking overview for VMs](https://docs.cloud.google.com/compute/docs/networking/network-overview) - Documents VM networking and VPC firewall rule behavior.
- [Instance templates](https://docs.cloud.google.com/compute/docs/instance-templates) - Explains templates, managed instance group usage, and template update behavior.
- [About VM Manager](https://docs.cloud.google.com/compute/docs/vm-manager) - Describes patching, OS inventory, and OS policy services for VMs.
- [Observe and monitor VMs](https://docs.cloud.google.com/compute/docs/instances/observe-monitor-vms) - Covers VM observability and Ops Agent guidance.
- [Create schedules for disk snapshots](https://docs.cloud.google.com/compute/docs/disks/scheduled-snapshots) - Documents scheduled snapshots for Persistent Disk and Hyperdisk volumes.
