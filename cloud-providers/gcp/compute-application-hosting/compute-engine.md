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

1. [The Problem](#the-problem)
2. [What Is Compute Engine](#what-is-compute-engine)
3. [Machine Type](#machine-type)
4. [Images](#images)
5. [Disks](#disks)
6. [Zones](#zones)
7. [Startup](#startup)
8. [Process Management](#process-management)
9. [Service Accounts](#service-accounts)
10. [Network Access](#network-access)
11. [Logs And Patching](#logs-and-patching)
12. [Sample Server Shape](#sample-server-shape)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## The Problem

Cloud Run is a good first home for many backend APIs, but not every workload fits a managed service shape. Sometimes the team needs a server.

- A legacy import worker needs a host agent that expects a normal Linux machine.
- A migration has a startup script that installs packages before the app runs.
- An application writes large temporary files and needs explicit disk planning.
- A security team requires a specific OS image, patch flow, or host-level monitoring agent.

Compute Engine is the GCP runtime for that server-shaped work. It gives your team more control than Cloud Run. It also gives your team more to operate.

## What Is Compute Engine

Compute Engine provides virtual machines, usually called VMs. A VM is a cloud server with CPU, memory, disks, network interfaces, an operating system image, metadata, and optional service account identity.

If EC2 or Azure VMs are familiar, the broad idea transfers. You choose a machine, place it in a zone, attach storage, connect it to a VPC, and run processes on it. The GCP details still matter: projects own the instance, zones place it, VPC firewall rules control packet access, and attached service accounts let software call Google APIs.

The key difference from Cloud Run is ownership. Cloud Run asks for an application contract. Compute Engine gives you a server and expects you to manage the server story.

| Runtime question | Cloud Run | Compute Engine |
| --- | --- | --- |
| Who manages the OS? | Google abstracts it away | Your team manages the VM OS |
| How does the app start? | Container startup contract | Startup script, systemd, process manager, or manual setup |
| Where is local disk? | Ephemeral container filesystem | Boot disk and attached disks you plan |
| What evidence starts debugging? | Revision and service logs | VM status, startup logs, process logs, disk and OS state |

Choose the VM when those server details are part of the requirement.

## Machine Type

A machine type defines the VM's CPU and memory shape. This sounds like a sizing detail, but it is also an operating promise. Too small, and the app thrashes or fails under load. Too large, and the team pays for idle capacity.

Unlike Cloud Run, a VM normally exists whether traffic arrives or not. If the Orders import worker runs on an `e2-standard-2`, that capacity is reserved and billed while the instance runs. Scaling requires additional automation, such as managed instance groups, scripts, or another orchestration layer.

The first sizing question should be boring: what does this process actually need? CPU-heavy image processing, memory-heavy imports, and lightweight background jobs should not all inherit the same VM shape because it was in the first tutorial.

## Images

An image is the operating system starting point for a VM. It might be a public Linux image, a hardened organization image, or a custom image built from a known server state.

Images matter because they define what exists before your startup script runs. Package repositories, agents, kernel settings, and the Google guest environment can all affect how the instance behaves. A custom image can speed up startup and standardize security, but it also becomes something the team must rebuild and patch.

The beginner trap is treating an instance as a snowflake. Someone SSHs in, installs packages, changes a config file, and the app works. Then the VM is replaced, and the undocumented changes disappear. A healthy VM design can explain which image starts the machine and which automation turns it into the app server.

## Disks

Compute Engine VMs use persistent disks for boot and attached storage. The boot disk holds the operating system and often the application install. Additional disks can hold data or large working files.

Disks make local state visible, but they also make it dangerous. If the app writes important data only to a VM disk, replacing the VM becomes a data migration problem. If the app writes temporary data to a disk that is too small, the failure can look like an application bug.

For backend systems, keep durable application state in managed data services when possible. Use VM disks for OS, local working space, caches, or explicit server workloads that truly need attached storage.

## Zones

Compute Engine instances live in zones. A zone is a location inside a region. If the Orders worker is in `us-central1-a`, that placement matters for latency, availability, disk attachment, and failure planning.

A single VM in one zone is a single point of failure. That may be acceptable for a dev worker or low-risk migration tool. It is usually not enough for a production API. Production VM designs often use multiple zones, managed instance groups, load balancing, and automation that can replace failed instances.

Cloud Run hides much of this placement surface. Compute Engine makes it explicit. That is useful when you need control, and it is extra work when you only wanted to run a normal HTTP app.

## Startup

Startup is how a blank VM becomes useful. It might install packages, pull an artifact, write config files, register an agent, and start the application process.

Compute Engine supports startup scripts through instance metadata. That gives you a repeatable way to run commands when the VM boots. The script should be treated like production code. If it fails halfway through, the VM may exist but not serve the app.

Good startup evidence names what happened:

```text
instance: orders-import-01
zone: us-central1-a
image: debian-12-orders-base
startup script: installed agent, pulled worker artifact, wrote env file
status: process started by systemd
```

If nobody can explain how a new VM becomes the app server, the VM is not really reproducible.

## Process Management

A VM does not automatically know how to keep your app alive. Something must start the process, restart it after crashes, and expose its logs. On Linux, that is often systemd, a supervisor, or another process manager.

Manual `ssh` plus `node server.js` is not a production runtime. It works until the shell exits, the VM reboots, or the process crashes. A server-shaped runtime needs a server-shaped process plan.

For the Orders import worker, the process manager should answer:

| Question | Example answer |
| --- | --- |
| What starts the process? | systemd unit |
| What restarts it? | Restart policy |
| Where are logs written? | Journald plus Cloud Logging agent or Ops Agent |
| How is config loaded? | Environment file or metadata-driven config |

Compute Engine gives control. Process management turns that control into a reliable runtime.

## Service Accounts

A VM can have an attached service account. Code running on the VM can use that identity to call Google APIs without storing a human password or long-lived key in the app.

This is powerful and easy to overgrant. The VM's service account should match the workload. An import worker might need to read from Cloud Storage and write to Cloud SQL. It probably does not need permission to deploy Cloud Run services or administer the whole project.

The identity lesson from earlier modules still applies: separate runtime identity from human identity and deployment identity. A VM feels like a server, but it is still a cloud workload with an IAM principal attached.

## Network Access

Compute Engine instances attach to VPC networks through network interfaces. Firewall rules, routes, subnets, and public IP behavior all matter directly.

If the VM needs to receive traffic, the path must be allowed through the VPC and any public entry layer. If it only needs outbound access, the route and egress controls decide where it can call. A VM with an external IP is different from a private VM behind controlled egress.

The networking module covered the deeper model. In this compute article, remember the VM-specific point: unlike Cloud Run, the VM is directly on a subnet through its network interface. That makes subnet, zone, firewall target, and service account targeting very concrete.

## Logs And Patching

Compute Engine keeps more operating responsibility with your team. Logs do not become useful just because the VM exists. The app, process manager, OS, and agents need a plan to send evidence where operators can read it.

Patching is the same. Google provides infrastructure and images, but your running VM's OS and packages still need an update strategy. If you build custom images, those images need refresh. If you patch in place, you need maintenance windows and restart behavior. If you replace VMs, startup automation must be reliable.

This is the honest tradeoff. VMs are not bad. They are explicit. They ask the team to be clear about server operations.

## Sample Server Shape

A simple Compute Engine shape for the Orders import worker might be:

| Part | Example |
| --- | --- |
| Instance | `orders-import-01` |
| Zone | `us-central1-a` |
| Machine type | `e2-standard-2` |
| Image | Hardened Debian base image |
| Boot disk | OS and worker install |
| Service account | `orders-import-runtime` |
| Startup | Metadata startup script installs config and starts systemd service |
| Network | Private subnet with restricted egress |
| Evidence | Startup logs, systemd status, app logs, disk metrics |

That shape is more work than Cloud Run. It is worth it only when the server-shaped requirements are real.

## Putting It All Together

Return to the opening problems.

The host agent and OS package requirements point toward a VM because the server itself matters. Compute Engine gives that control.

The startup script must be repeatable because a replaced VM should become the same application server without someone reconstructing it by hand.

The disk plan must be explicit because a VM gives local storage choices that managed services hide.

The security and monitoring requirements belong in the image, service account, network rules, logs, and patch flow. Choosing Compute Engine means choosing to own those details.

## What's Next

Compute Engine handles server-shaped workloads. Some work is smaller and event-shaped: a file arrives, a message is published, or a schedule fires. Next, we look at Cloud Run functions for those small handlers.

---

**References**

- [Google Cloud: Compute Engine instances](https://cloud.google.com/compute/docs/instances)
- [Google Cloud: Machine families resource and comparison guide](https://cloud.google.com/compute/docs/machine-resource)
- [Google Cloud: About startup scripts](https://cloud.google.com/compute/docs/instances/startup-scripts)
- [Google Cloud: Service accounts and access scopes](https://cloud.google.com/compute/docs/access/service-accounts)
