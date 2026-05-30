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

1. [What Is A Virtual Machine](#what-is-a-virtual-machine)
2. [Image](#image)
3. [VM Size](#vm-size)
4. [Disks](#disks)
5. [Network Interface](#network-interface)
6. [Startup](#startup)
7. [Process Management](#process-management)
8. [Patching And Logs](#patching-and-logs)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is A Virtual Machine

An Azure Virtual Machine (VM) is a cloud-based guest operating system instance executed by a physical hypervisor using software-defined virtualized hardware allocations. Azure manages the physical datacenter facilities, server blade hardware, hypervisor scheduling, and cooling infrastructure. Your team, however, retains full administrative control and operational ownership over everything inside the guest operating system boundary.

:::expand[Under the Hood: VM Sizing and Host Isolation]{kind="design"}
Azure VMs run as guest operating systems on Azure-managed physical hosts. The VM size you choose defines the virtual CPU count, memory amount, disk throughput limits, network throughput limits, and sometimes the local temporary storage available to the guest.

The important operational constraint is that the VM size is a hard ceiling. Attaching a faster managed disk does not help if the VM size has a lower disk throughput cap. Moving a memory-hungry process onto a VM with too little RAM causes paging or crashes no matter how healthy the Azure host is. Choosing a VM is therefore a capacity-planning decision, not only an operating system preference.

Azure isolates guests from each other at the virtualization layer and manages the physical host, but your team owns everything inside the guest OS. That includes users, packages, kernel settings, service supervisors, firewall rules, data mounts, and application recovery behavior.
:::

If you operate servers on AWS, Azure VMs are the direct equivalent of AWS EC2 instances. Both provide raw virtual guest servers in the cloud. However, they integrate differently with adjacent cloud resources. In AWS, persistent block storage commonly uses Elastic Block Store (EBS), whereas in Azure, persistent volumes use Managed Disks. Azure VMs also commonly run a guest VM Agent and can use the Instance Metadata Service (IMDS) for instance metadata and managed identity token requests.

Choosing a Virtual Machine is a deliberate engineering tradeoff. You accept the operational overhead of server patching, security compliance audits, backup policies, and process monitoring in exchange for the absolute runtime freedom required by specialized systems.

| Resource Provider | Operational Owner | Systems Detail |
| --- | --- | --- |
| Physical Hardware | Azure Fabric | Core hypervisor updates, server blade hardware, and power units |
| Operating System OS | Your Team | Guest OS updates, security hardening, package updates, and kernels |
| Storage Volumes | Your Team | Partition tables, file systems, disk mounts, and directory trees |
| Process Supervision | Your Team | Keeping systemd daemons active and monitoring process restarts |
| Logging Pipelines | Your Team | Installing log agents to forward files to centralized log workspaces |
| Network Routing NIC | Your Team | Configuring firewalls, network interfaces, and guest routing tables |

## Image

The image is the template file that contains the pre-configured operating system, kernel version, default libraries, and system configurations used to boot the virtual machine. When you provision a VM, Azure uses that image to create the VM's OS disk.

Relying on raw marketplace images can introduce configuration drift over time. If a developer boots a generic Ubuntu image and manually installs packages, updates libraries, and edits system files, the machine cannot be easily reproduced. If the VM's host hardware fails and the platform migrates the workload to a new node, recreating the configuration by hand creates serious recovery latency.

To ensure consistency, automate the image creation path using golden-image pipelines (such as HashiCorp Packer). These pipelines compile your application binaries, install required security daemons, and configure system libraries into a custom, versioned image. You register this image in an Azure Compute Gallery, ensuring that every VM launched in your scaling group boots from the exact same pre-tested template.

## VM Size

The VM Size (also referred to as the VM SKU) defines the compute, memory, local ephemeral disk space, and network bandwidth characteristics of the virtualized environment. Selecting a size is a critical step that must match the physical resource needs of your guest processes.

Azure categorizes VM sizes into specialized families designed for distinct workloads:
* **D-Family (General Purpose)**: Balanced CPU-to-memory ratios; designed for standard web backends, small databases, and testing environments.
* **E-Family (Memory Optimized)**: High RAM-to-core ratios; designed for in-memory databases, large cache layers, and high-volume data engines.
* **F-Family (Compute Optimized)**: High core-to-RAM ratios; designed for CPU-bound batch processing, compilation engines, and video encoding.

The VM Size also imposes strict, non-adjustable hardware limits on network interface card (NIC) throughput and disk input/output operations per second (IOPS). If you select a small VM size (such as `Standard_B2s`), the hypervisor limits your network bandwidth to a low rate and caps your disk IOPS. Even if you attach a high-performance SSD capable of 20,000 IOPS, the VM's virtual disk controller will throttle I/O operations to match the VM size limits, creating disk queue bottlenecks.

## Disks

An Azure Virtual Machine normally utilizes two distinct categories of storage: managed disks (durable, network-attached storage) and temporary local disks (ephemeral, physically attached SSDs).

![An infographic showing a VM attached to disks and a network interface](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/disk-nic-attachment.png)

*VM behavior is shaped by attached resources: disks hold state and the network interface controls where traffic can flow.*

```mermaid
flowchart LR
    OSFS["Guest OS Block I/O<br/>(/dev/sda)"] --> VController["Virtual Disk Controller"]
    VController -- "Azure-managed block storage path" --> ManagedDisk["Azure Managed Disk"]
```

```mermaid
flowchart LR
    TempFS["Temporary Mount<br/>(/dev/sdb)"] --> LocalSSD["Physical Local NVMe SSD<br/>(on Hypervisor Host Blade)"]
```

Managed disks represent Azure-managed block storage attached to your VM. The guest operating system sees a disk device, while Azure handles the storage account placement, redundancy option, durability, and disk resource lifecycle behind the scenes. The exact redundancy and performance behavior depends on the disk type, SKU, size, and regional features you choose.

Temporary disks, conversely, are local temporary storage exposed by many VM sizes. On Linux VMs, this drive is typically mounted at `/mnt` or `/mnt/resource`. This storage is ephemeral. Data on the temporary disk can be lost during stop/deallocate, resize, redeploy, maintenance, or host recovery events. Never store database logs, source code, application state, or critical files on the temporary disk; restrict its use to system swap space and volatile caches.

:::expand[Writing to the Temporary Disk]{kind="pitfall"}
Many Azure VM sizes include a temporary local disk (`/dev/sdb` or `/dev/disk/cloud/azure_resource` on Linux, `D:` on Windows). This disk is designed for temporary data. If the VM is stopped (deallocated), resized, redeployed, or moved during maintenance, data written to the temporary drive can be lost.

This matches the behavior of AWS **EC2 Instance Store** volumes, which provide high-speed, local ephemeral block storage that is wiped clean the moment the EC2 instance is stopped, terminated, or undergoes hardware retirement.

Common victims of this behavior include application log directories, local session caches, SQLite databases, and cron configuration templates that developers accidentally write to `/mnt` or `D:\`. The files are perfectly readable for days, creating a false sense of security, until the next host maintenance event triggers a reboot and wipes the drive clean.

Consider this before-and-after storage architecture:

*   **Before (The Volatile Trap):** Storing active log files on the local temp disk:
    ```bash
    # App config targets the volatile ephemeral mount
    LOG_DIR="/mnt/app-logs/"
    ```
*   **After (The Durable Pattern):** Write persistent logs to a network-attached Azure Managed Disk, or stream them off-box to a central workspace:
    ```bash
    # Mount durable Managed Disk partition
    mount /dev/sdc1 /data/app-logs
    LOG_DIR="/data/app-logs/"
    ```

**Rule of thumb:** Treat the temporary local disk exactly like system RAM—it is completely volatile by design. Use it strictly for transient swap files, sorting buffers, or short-lived build artifact caches where data loss is fully expected and has zero impact on application durability.
:::

## Network Interface

The Network Interface Card (NIC) is the virtualized resource that connects your VM to a virtual network subnet. It owns the private IP address mapping, links to public IP resources, and ties directly to Network Security Group (NSG) packet filtering rules.

Under the hood, when packets reach the host blade's physical network adapter, the hypervisor's software-defined virtual switch inspects the VLAN headers. It routes the packets to the virtual NIC assigned to your VM, where the guest OS kernel parses the Ethernet frames. To bypass this virtual switch overhead and achieve near-line-rate network performance under high traffic, enable Accelerated Networking.

Accelerated Networking utilizes Single Root I/O Virtualization (SR-IOV) technology. When enabled, the hypervisor bypasses the virtual switch entirely, presenting the physical NIC's virtual functions directly to the guest VM's PCIe bus. Packets are copied directly from the physical network adapter to the guest VM's memory buffers, reducing CPU utilization, cutting network jitter, and minimizing round-trip latency.

## Startup

The VM startup path represents the bridge between virtual machine creation and application process readiness. When the guest OS boots, the system must parse configuration metadata to set hostnames, wire network routing, retrieve secrets, and install runtimes.

![An infographic showing a VM boot path from image to OS to agent to application process](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-boot-path.png)

*A VM has a startup chain, and any broken step before the app process can make the service appear down.*

To automate this provisioning flow without manual SSH commands, rely on the guest VM Agent (`waagent`) and cloud-init. During the boot sequence, the guest OS starts the VM Agent daemon. The agent can use the Instance Metadata Service (IMDS) at the private IP `169.254.169.254` to retrieve metadata such as the VM's resource group, subscription, private IP, and user-provided custom data scripts.

The VM Agent parses this metadata, configures the local network interfaces, writes host files, and executes your cloud-init shell scripts. A production-ready VM should utilize these scripts to pull configuration files from private repositories, register the machine with configuration engines (like Ansible or Chef), mount persistent data disks, retrieve database secrets via managed identity tokens, and start your application processes automatically.

## Process Management

Once the operating system boots and the VM Agent finishes executing configuration scripts, you must ensure that your application processes are supervised and restarted automatically on failure. Because there is no managed platform to monitor process states, you must configure a local process supervisor inside the guest OS.

On modern Linux distributions, the standard tool is `systemd`. You write a systemd service unit file (typically located in `/etc/systemd/system/`) that defines the process environment, specifies the working directory, maps the user privileges, and sets restart rules.

```ini
[Unit]
Description=DevPolaris Checkout API Service
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/var/www/checkout-api
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Using a systemd service ensures that if your Node.js or Python application crashes due to an unhandled exception or memory exhaustion, the guest OS kernel detects the process termination and restarts the service automatically. It also integrates application logs directly with `journald`, providing a local logging system that can be queried using `journalctl`.

## Patching And Logs

Virtual Machines do not become safe just because Azure manages the host. As operating system kernels, SSL/TLS libraries, runtime engines, and system daemons age, they accumulate security vulnerabilities. Your team must implement an automated patching policy, using tools such as Azure Update Manager or automatic VM guest patching where appropriate, and schedule guest OS reboots in a controlled way.

Logging requires the same active ownership. Application logs written only to local files inside the VM are highly volatile. If a disk controller fails or a developer deallocates the machine, those logs are lost. Furthermore, logging into active production servers via SSH to run `tail -f` or `grep` commands is slow and creates operational security risks.

To secure your telemetry, install a centralized log collector agent (such as the Azure Monitor Agent or Fluent Bit) inside the guest OS. Configure the agent to tail your application log files and stream them in real-time to a central Log Analytics workspace. Set up host alerts to monitor CPU spikes, disk space exhaustion on persistent volumes, and memory utilization, ensuring you receive warnings before a filled OS disk crashes your databases.

## Putting It All Together

Virtual Machines provide low-level guest OS access at the cost of high operational overhead.

* **VM Size Limits**: Virtual machines run inside Azure-managed virtualization boundaries, and the VM size defines hard CPU, memory, disk, and network ceilings.
* **Guest OS Ownership**: Azure manages the host, while your team manages users, packages, patches, services, and local security inside the guest.
* **Managed Disks**: Managed disks provide Azure-managed durable block storage, with performance and redundancy determined by disk type, size, and SKU.
* **Temporary Disk Volatility**: Temporary local disks are designed for disposable data, and their contents can be lost during deallocation, resize, redeploy, maintenance, or host recovery.
* **VM Agent Provisioning**: The guest `waagent` fetches custom data scripts from link-local IMDS requests (`169.254.169.254`), orchestrating automated package installations via cloud-init.

By managing guest operating systems, process supervisors, and storage mounts systematically, you can run highly customized workloads that require absolute runtime control.

## What's Next

In the next chapter, we will go up the compute abstraction ladder to explore Azure Kubernetes Service (AKS). We will analyze managed control plane architectures, contrast Kubenet with Azure CNI overlay networks, and inspect Entra ID Workload Identity cryptographic token exchanges.

![An infographic showing the Azure virtual machine responsibility stack from Azure host and managed disk up to NIC, OS image, processes, patching, backup, monitoring, and hardening](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-responsibility-stack.png)

*Use this as the VM responsibility stack: Azure supplies the virtual hardware, but the team still owns the operating system, processes, patching, backups, monitoring, and hardening.*


---

**References**

- [Virtual Machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/overview) - Introduction to Azure's IaaS compute platform.
- [Sizes for Virtual Machines](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview) - Technical reference for compute, memory, and storage VM SKU families.
- [Managed Disks Overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Architecture details of remote network-attached durable storage LUNs.
- [Accelerated Networking SR-IOV](https://learn.microsoft.com/en-us/virtual-network/create-vm-accelerated-networking-cli) - Performance guide on Single Root I/O Virtualization.
