---
title: "Virtual Machines"
description: "Use Azure Virtual Machines when the workload needs server-level control, and understand the image, size, disk, network, startup, process, patching, and log responsibilities that come with it."
overview: "Virtual Machines are the most familiar compute shape, but they carry the most operating responsibility. This article explains what Azure provides and what the team must still own."
tags: ["azure", "virtual-machines", "servers", "disks", "networking"]
order: 5
id: article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines
aliases:
  - azure-virtual-machines
  - cloud-providers/azure/compute-application-hosting/azure-virtual-machines.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is A VM](#what-is-a-vm)
3. [Image](#image)
4. [VM Size](#vm-size)
5. [Disks](#disks)
6. [Network Interface](#network-interface)
7. [Startup](#startup)
8. [Process Management](#process-management)
9. [Patching And Logs](#patching-and-logs)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

Most modern Azure apps should not start with a virtual machine. App Service, Container Apps, Functions, and AKS can remove a lot of server work. But some workloads still need a server-shaped home.

The checkout platform has one awkward worker:

- It needs a vendor binary installed from a private package feed.
- It writes temporary files to a mounted disk during each batch.
- It is supervised by systemd today, and the team already knows the failure modes.
- It must run a custom network diagnostic tool during migration.

For this piece, a VM may be honest. The team is not choosing a VM because servers are fashionable. They are choosing one because the workload needs operating system control that the managed application platforms do not expose cleanly.

## What Is A VM

An Azure Virtual Machine is a cloud server. Azure provides virtualized compute, storage attachments, network resources, platform APIs, and integration with monitoring and management tools. You choose the image, size, disks, network placement, access model, and operating system behavior.

If you know AWS, the broad comparison is EC2. The same warning applies: a VM gives control, and control brings chores. Azure manages the physical infrastructure. Your team still owns much of what happens inside the guest operating system.

The useful beginner split looks like this:

| Azure provides | Your team still owns |
| --- | --- |
| Virtualized server capacity | OS configuration and hardening |
| VM sizes and hardware families | Runtime installation and updates |
| Managed disks and snapshots | Disk layout and data lifecycle |
| Network interface placement | Firewall, ports, routes, and access choices |
| Platform health signals | Application logs and process supervision |
| Management APIs | Patch policy, backups, recovery, and incident playbooks |

A VM is not wrong. It is just explicit. If the workload really needs server control, say so. If it only needs a place to run a normal HTTP app, a managed app platform is usually the simpler first answer.

## Image

The image is the starting operating system and software shape for the VM. It may be a marketplace image, a custom image, or an image built through a golden-image pipeline. The image decides what exists before your startup script or configuration tool runs.

This matters because image drift creates hard-to-debug production differences. If one VM was created from Ubuntu 22.04 last year and another from a newer image today, the package versions, kernel behavior, and default settings may differ. If a human installed a package after creation and never captured that change, the next VM may not work the same way.

For long-lived systems, the better habit is to make the image and bootstrap path repeatable. The team should be able to answer: which image created this VM, what was installed after boot, and how would we recreate it?

## VM Size

The VM size defines the CPU, memory, temporary storage, network bandwidth characteristics, and sometimes special hardware such as GPUs. Choosing a size is more than choosing "small" or "large." It is choosing the capacity envelope for the process.

A CPU-bound batch worker may need a compute-optimized size. A memory-heavy service may need more RAM before it needs more cores. A disk-heavy workload may need attention to disk throughput, IOPS, and VM vCPU count together.

The size also shapes cost. A VM costs while it is allocated, even if the process inside is idle. If the workload only runs for short windows and does not require a server shape, a job-oriented service may be cheaper. If the workload must stay warm and needs OS control, the VM cost is the price of that control.

## Disks

A VM normally has an OS disk and may have one or more data disks. The OS disk holds the operating system. Data disks hold application data, mounted working directories, or other persistent files. Some VM sizes also expose temporary local storage that should not be treated as durable.

The main gotcha is local state. A file written to a VM is not automatically the same as durable application state. If the VM is replaced, recreated, or restored from an old snapshot, the state story changes. Databases, uploads, logs, and business records usually belong in managed storage or database services unless the VM is specifically operating that data layer.

For the legacy worker, a data disk might be reasonable for temporary batch workspace. The durable output should still land in a storage account, database, or another managed destination that survives VM replacement.

## Network Interface

The network interface connects the VM to a virtual network subnet. It is where private IP addressing, network security group rules, and sometimes public IP association come together.

This is where server familiarity can create cloud mistakes. A VM with SSH open to the internet is easy to understand and often too broad. A database port exposed from a VM is easy to test and dangerous to leave public. The network interface and subnet placement should match the role of the machine.

For most application VMs, start private. Put the VM in an application subnet, control inbound access with network security groups, and use safer administration paths such as Bastion, VPN, private connectivity, or just-in-time access. A public IP should be a deliberate exception.

## Startup

Startup is everything that happens between "Azure created the VM" and "the workload is ready." It can include cloud-init, custom script extensions, package installation, configuration management, service registration, secrets retrieval, and application start.

This is where a VM often feels easy in development and fragile in production. If the startup sequence depends on a human SSH session, the machine cannot be reproduced reliably. If package installation sometimes fails because a repository is unavailable, the VM can exist but the app can be missing. If secrets are copied by hand, recovery becomes memory work.

A production VM should have a written, automated startup path. It should also have a clear health signal after startup, because "the VM is running" only means the hypervisor started the guest. It does not prove the application process is healthy.

## Process Management

Inside the VM, something must keep the application process alive. On Linux, that might be systemd. On Windows, it might be a Windows service or another supervisor. The process manager defines how the app starts on boot, restarts after failure, receives environment variables, and writes logs.

This is the layer managed app platforms hide from you. On a VM, it is yours again. A process that was started manually over SSH can vanish after a reboot. A systemd unit with the wrong working directory can fail even when the binary exists. A restart loop can look like "the server is up" from Azure's point of view while the app is constantly crashing.

Use the process manager as evidence. A good incident check asks whether the VM is reachable, whether the service is enabled, whether it is active, which version is running, and what the last logs say.

## Patching And Logs

VMs need patching. The operating system, runtime, vendor packages, agents, and security configuration all age. Azure provides management tools, but the team still needs a policy: when patches apply, how reboots are handled, how compatibility is tested, and how emergency fixes roll out.

Logs need the same ownership. Application logs written only to a local file are easy to lose and hard to search. Platform metrics can tell you CPU or disk pressure, but they cannot explain an application exception unless the app emits useful logs somewhere central.

The practical baseline is simple: send application logs to a central place, collect VM metrics, monitor disk space, know the patch posture, and make restore or rebuild possible. A VM without this baseline is not simple. It is just quiet until something breaks.

## Putting It All Together

The opener's legacy worker needed a vendor binary, a mounted workspace, systemd, and direct diagnostics. A VM can fit that shape because it gives the team server-level control.

The cost is visible now. The image defines the starting system. The size defines the capacity and cost envelope. The disks define the local storage story. The network interface defines reachability. Startup defines reproducibility. The process manager defines whether the app actually stays alive. Patching and logs define whether the team can operate the server over time.

Use Virtual Machines when those controls are requirements. Do not use them merely because a VM is easy to picture. The easiest compute choice to understand is not always the easiest one to operate.

## What's Next

Next we will look at AKS, where the unit of operation moves from one server to a Kubernetes cluster with nodes, pods, deployments, services, and ingress.

---

**References**

- [Virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/overview)
- [Sizes for virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview)
- [Managed disks overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)
- [Create, change, or delete a network interface](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-network-interface)
