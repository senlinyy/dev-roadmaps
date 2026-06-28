---
title: "Virtual Machines"
description: "Use Azure Virtual Machines when a workload needs server-level control, and understand the image, size, disk, network, startup, access, patching, scale, and evidence responsibilities that come with that choice."
overview: "Azure Virtual Machines give a team a familiar server in the cloud. This article explains what Azure provides, what the team still owns, and how to operate a VM without turning every old workload into permanent server sprawl."
tags: ["azure", "virtual-machines", "servers", "disks", "networking"]
order: 5
id: article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines
aliases:
  - azure-virtual-machines
  - cloud-providers/azure/compute-application-hosting/azure-virtual-machines.md
---

## Table of Contents

1. [The VM Map](#the-vm-map)
2. [When A VM Is The Honest Choice](#when-a-vm-is-the-honest-choice)
3. [The Shared Responsibility Boundary](#the-shared-responsibility-boundary)
4. [Images And First Boot](#images-and-first-boot)
5. [VM Sizes And Performance Limits](#vm-sizes-and-performance-limits)
6. [Managed Disks And Temporary Storage](#managed-disks-and-temporary-storage)
7. [Network Interfaces And Access](#network-interfaces-and-access)
8. [Extensions, Agents, And Runtime Configuration](#extensions-agents-and-runtime-configuration)
9. [Process Supervision And Health](#process-supervision-and-health)
10. [Patching, Backups, And Recovery](#patching-backups-and-recovery)
11. [Scale Sets And VM Sprawl](#scale-sets-and-vm-sprawl)
12. [Runtime Evidence](#runtime-evidence)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## The VM Map
<!-- section-summary: An Azure VM is easiest to understand as a server made from an image, a size, disks, a network interface, startup configuration, access rules, health checks, and an operations plan. -->

An **Azure Virtual Machine**, or VM, is Azure's server-shaped compute option. Azure gives your team a guest operating system, virtual CPU and memory, disks, a network interface, and administrator access inside the machine. The word "virtual" means the server runs on Azure-managed physical hardware through a virtualization layer, while the operating system inside the VM behaves like a normal Linux or Windows server.

If you know AWS, an Azure VM fills the same broad job as an EC2 instance. The surrounding names line up this way: an Azure image is closest to an AMI, a VM size is closest to an EC2 instance type, a managed disk is closest to EBS, temporary storage is closest to instance store, and a network interface is closest to an ENI.

We will keep one example in our hands for the whole article. The `devpolaris-orders` system has a legacy inventory worker called `vm-devpolaris-orders-legacy-01` in `rg-devpolaris-orders-prod`. This worker still needs a vendor package installed at the operating system level, a mounted data disk, a local service file, and a monitoring agent that reads host logs. The team would rather run new services on Container Apps or App Service, but this one workload still has a real server requirement.

That gives us a clear structure for the article. A VM is a bundle of connected decisions. The team chooses a **VM image**, a **VM size**, **managed disks**, **temporary storage**, a **network interface**, **access paths**, **startup configuration**, **process supervision**, **patching**, **backup**, and **monitoring**. Each choice affects the next one during a real incident.

| Concept | Plain meaning | Orders legacy worker example |
|---|---|---|
| **Image** | The boot template for the operating system and baseline software. | Ubuntu image plus the vendor package and security baseline. |
| **Size** | The CPU, memory, disk throughput, and network capacity profile. | A general-purpose size that can run the worker and submit enough disk I/O. |
| **Managed disk** | Durable block storage Azure attaches to the VM. | OS disk plus a mounted data disk for worker state. |
| **Temporary storage** | Scratch space that can disappear when Azure moves or recreates the VM. | Cache files only, never the only copy of order data. |
| **Network interface** | The VM's private IP and subnet attachment. | Private IP in the application subnet, with no public IP. |
| **Access path** | The approved way humans administer the machine. | Azure Bastion or private VPN path, with Azure RBAC and OS-level users reviewed. |
| **Startup path** | The sequence from image boot to working application process. | Cloud-init, disk mount, environment file, systemd service, and health check. |
| **Operations plan** | The routine work that keeps the server safe and recoverable. | Patching, backups, logs, metrics, alerts, and restore drills. |

This map matters because VMs feel familiar. A team can SSH into a VM, install a package, edit a file, restart a service, and get something working. That familiarity helps during migrations and vendor software work, but it can also hide responsibility. The machine may live in Azure, but the team still owns the inside of the operating system.

Microsoft's Azure VM overview explains the same core idea from the platform side: a VM gives you an on-demand computing resource where you choose the operating system, size, and related resources. In production language, that means the team gets a lot of control and also keeps a lot of server work.

![Azure VM decision map showing server-level reasons to choose a VM and the operating responsibilities the team owns](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-decision-map.png)

*Use this as the VM decision reminder: the same server control that helps a legacy worker also brings patching, access, process health, and backup ownership.*

## When A VM Is The Honest Choice
<!-- section-summary: A VM is justified when the workload truly needs server-level control such as OS packages, local agents, custom services, mounted disks, or compatibility with software that cannot fit a managed runtime yet. -->

A **server-level control requirement** is a need that sits inside the operating system or very close to it. The application might need a kernel module, a local daemon, a vendor installer, a mounted block device, a specific Windows service, a special network agent, or a runtime layout that a managed web platform cannot provide. A VM fits that kind of requirement because the team can administer the guest operating system directly.

For the Orders system, the inventory worker is a good VM candidate for now. The vendor package expects a normal Linux filesystem, writes state to `/var/lib/vendor-inventory`, and ships a service definition that runs under `systemd`. The team also has to install a host-based security agent and collect logs from files under `/var/log/vendor-inventory`. Those are ordinary server operations, and a VM gives the team the control to do them.

This is different from choosing a VM because the team feels comfortable with SSH. Comfort is real, and it matters during learning, but production compute choices need a workload reason. A normal HTTP API that can run as a container may fit Container Apps. A standard web app may fit App Service. An event handler may fit Functions. A VM earns its place when the software needs the operating system shape.

The early decision record should name the reason in plain language. For example: "`vm-devpolaris-orders-legacy-01` stays on Azure Virtual Machines because the vendor inventory worker needs a Linux service, local package installation, a mounted data disk, and host-level monitoring. The team owns OS patching, access review, disk capacity, backups, startup scripts, and process supervision." That sentence gives future reviewers enough context to revisit the choice later.

The next natural question is who owns what. Azure runs the physical platform. The team runs the guest server. That boundary is where most VM surprises come from.

## The Shared Responsibility Boundary
<!-- section-summary: Azure operates the physical host and virtualization platform, while the team owns the guest operating system, packages, users, processes, mounts, logs, and application recovery behavior. -->

The **shared responsibility boundary** is the line between Azure's platform work and your team's server work. Azure owns the datacenter, physical servers, host networking, storage platform, virtualization layer, and control plane APIs. Your team owns the guest operating system, application packages, service accounts, firewall settings inside the OS, mounted filesystems, application processes, log forwarding, backup choices, and recovery steps.

This boundary can feel subtle because Azure creates the VM resource for you. The portal shows a friendly resource page, and the CLI can start, stop, resize, and inspect the machine. Azure resource state and guest application health are two separate facts. Azure can report that the VM is running while the application process inside the guest OS is crashed.

For the Orders worker, the production runbook needs two layers of evidence. The Azure layer answers questions like "is the VM allocated, which size is it, which subnet is it in, which disks are attached, and is the VM agent healthy?" The guest layer answers questions like "did cloud-init finish, did `/data` mount, did the vendor package load, did systemd start the worker, and are logs leaving the machine?"

| Layer | Azure helps with | Team still owns |
|---|---|---|
| Physical platform | Host hardware, physical networking, datacenter power, platform maintenance. | Choosing region, availability design, and recovery approach. |
| VM resource | VM lifecycle, VM size, image reference, disk attachment, NIC attachment. | Naming, tagging, sizing, access design, cost review, and change control. |
| Guest operating system | VM agent integration and extension delivery when the agent is healthy. | Users, packages, firewall, SSH or RDP hardening, OS updates, and local config. |
| Application process | Health extension integration if configured. | Service file, restart policy, environment variables, ports, logs, and incident response. |
| Data on disks | Managed disk resource, durability options, snapshots, backup integration. | Filesystem, mount points, database consistency, capacity alerts, and restore testing. |

This is why a VM is the most flexible compute choice in this Azure compute section and also the one with the most daily operations. After the team accepts that boundary, the first technical object to understand is the image, because every VM starts from a boot template.

## Images And First Boot
<!-- section-summary: A VM image is the boot template, and first boot turns that template into a configured server through metadata, cloud-init or custom data, disk mounts, packages, and service startup. -->

A **VM image** is the template Azure uses to create the operating system disk. It contains the operating system and may include baseline packages, configuration, security settings, and company software. A marketplace Ubuntu image gives you a clean general-purpose server. A custom image can already include the vendor package, log agent, approved users, and a hardened SSH configuration.

The image matters because servers drift when people configure them by hand. Imagine one engineer installs `vendor-inventory-agent` on Monday, another edits `/etc/vendor/config.yml` on Wednesday, and a third changes a systemd unit during an incident. The VM may work, but the team cannot confidently recreate it. If the machine has to be replaced in another zone or rebuilt after corruption, those hidden manual steps become downtime.

A stronger pattern is to build a versioned image and keep late-binding configuration small. The image might contain Ubuntu, the vendor package, the Azure Monitor Agent dependency, and baseline hardening. First boot can then inject environment-specific values such as the resource group name, the data disk mount, the Log Analytics workspace target, and the service enablement step.

Azure VMs can receive **custom data** or **user data** at provisioning time, and Linux images often use **cloud-init** to process early boot configuration. Cloud-init is a common Linux initialization system that can create files, install packages, run commands, configure users, and start services during first boot. Azure also exposes the **Instance Metadata Service**, often called IMDS, from inside the VM so software can read facts about the current VM, such as compute, network, and maintenance metadata.

Here is a small cloud-init sketch for the Orders worker. The important idea is not the exact package name. The important idea is that first boot should be repeatable and reviewable.

```yaml
#cloud-config
packages:
  - vendor-inventory-agent

write_files:
  - path: /etc/devpolaris/orders-worker.env
    permissions: "0640"
    content: |
      ORDERS_ENV=prod
      WORKER_QUEUE=orders-inventory

runcmd:
  - mkdir -p /data/vendor-inventory
  - systemctl enable orders-inventory.service
  - systemctl start orders-inventory.service
```

The first boot chain gives the operator a useful troubleshooting path. When the worker fails to start after the VM is recreated, useful first checks include boot diagnostics, cloud-init logs, extension status, disk mounts, environment files, and the systemd service. Azure's boot diagnostics feature exists exactly for the early part of that path because it collects serial log information and screenshots to help diagnose VM boot failures.

![Azure VM first boot chain from image to OS disk, cloud-init, data mount, systemd service, and health evidence](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-first-boot-chain.png)

*Use this as the startup debugging path: a recreated VM must move from image to mounted disk to supervised service before the worker can look healthy.*

Once the VM can boot repeatably, the next decision is capacity. The image decides what starts. The VM size decides how much CPU, memory, disk throughput, and network throughput the machine can actually use.

## VM Sizes And Performance Limits
<!-- section-summary: A VM size is the capacity profile for CPU, memory, disk throughput, network bandwidth, and sometimes local temporary storage, so it can cap performance even when attached resources look powerful. -->

A **VM size** is the capacity profile for the virtual server. It defines how many virtual CPUs the VM gets, how much memory it has, what disk throughput and IOPS limits apply, what network bandwidth range the VM can reach, and whether a local temporary disk is available. Microsoft groups sizes into families for different workload shapes, such as general purpose, compute optimized, memory optimized, storage optimized, and GPU accelerated.

For the Orders worker, a small general-purpose size may be enough during normal traffic. The worker reads messages, calls the vendor package, writes small state files, and reports results. If the team later sees CPU saturation or memory pressure, a larger size may help. If the worker spends most of its time waiting on disk, the team has to look at both the managed disk and the VM size because either one can be the bottleneck.

That last point is worth slowing down on. A managed disk may advertise a high performance tier, but the VM size also has limits. If the disk can deliver more I/O than the VM size can submit, the workload still waits. From inside the guest OS, this often appears as growing disk queue depth, high latency, slow package operations, or a service that falls behind even though CPU is not busy.

Here is a practical review table for a VM size choice.

| Question | Why it matters for production |
|---|---|
| How many vCPUs does the process need during peak work? | CPU-bound workers fall behind when the scheduler stays saturated. |
| How much memory does the process and OS need together? | Memory pressure causes swapping, crashes, or slow garbage collection. |
| What disk IOPS and throughput can the size submit? | A fast disk cannot help if the VM size has the lower limit. |
| What network throughput does the size support? | Backup, log shipping, API calls, and package downloads all share network capacity. |
| Does this size include temporary storage? | Scratch storage can be useful, but it must not hold business data. |
| Is the size available in the target region and zone? | A design can look fine and still fail placement if the size is unavailable. |

The team should choose a size from measured workload evidence rather than guesses. Start with the workload's expected CPU, memory, disk, and network needs. Watch Azure Monitor metrics after realistic traffic. Resize when evidence says the current capacity profile is wrong. Resizing may require a restart, and some sizes may not be available in every cluster or zone, so capacity changes belong in normal change planning.

Capacity leads directly into storage. The size gives the VM a performance envelope, but the disks decide where the operating system and application data live.

## Managed Disks And Temporary Storage
<!-- section-summary: Managed disks provide durable block storage for VM operating systems and data, while temporary storage is scratch space that can disappear during moves, redeploys, resizes, or host recovery. -->

A **managed disk** is Azure-managed block storage attached to a VM. The guest operating system sees it like a normal disk device. Linux may expose it as a device such as `/dev/sdc`, and the team formats it, mounts it, and uses normal filesystem paths. Azure manages the backing storage resource, while the team owns the filesystem, mount configuration, data layout, and application consistency.

The Orders worker has two common disk types. The **OS disk** holds the operating system and base files. A **data disk** holds application state under a mount such as `/data/vendor-inventory`. Keeping application data on a data disk makes replacement and recovery planning clearer because the team can reason about the OS lifecycle separately from the application data lifecycle.

Azure managed disks come in several performance and cost tiers, including Standard HDD, Standard SSD, Premium SSD, Premium SSD v2, and Ultra Disk. A beginner can start without memorizing every SKU. The useful production question is what the workload needs: low cost, steady latency, high IOPS, high throughput, or very low latency for a demanding database-like workload.

The team also has to understand **temporary storage**. Many VM sizes expose local scratch space on the physical host. It can be useful for cache files, swap, build output, sorting buffers, or temporary extraction work. Treat it as disposable storage. Data on temporary storage can be lost when the VM is moved, redeployed, resized, stopped and deallocated, or recovered on another host.

For the Orders worker, temporary storage can hold a retryable package extraction cache. Durable storage must hold the only copy of inventory state, order processing results, database files, and logs that the team needs after an incident. The easiest test is to ask what happens if the temporary path is empty after the next reboot. If the answer is "the worker rebuilds the cache," that is fine. If the answer is "we lost customer or recovery data," the design is wrong.

Mounting a Linux data disk also creates an operating responsibility. The disk needs a filesystem, a mount point, an `/etc/fstab` entry that survives reboot, permissions that match the service account, and capacity alerts before the partition fills. A VM can be running and still fail the application because `/data` did not mount or because the service account cannot write to the directory.

Here is a small guest-side check after the data disk is attached and mounted. The first command confirms the mount target, source device, and filesystem type. The second confirms the worker has room on the durable path.

```bash
findmnt /data
df -h /data
```

```console
TARGET SOURCE    FSTYPE OPTIONS
/data  /dev/sdc1 xfs    rw,relatime,attr2,inode64,logbufs=8,logbsize=32k

Filesystem      Size  Used Avail Use% Mounted on
/dev/sdc1       256G   84G  173G  33% /data
```

Healthy output shows `/data` mounted from the expected data disk and enough free space for the worker. Suspicious output includes no `/data` mount, an unexpected temporary device, a read-only mount, or high disk usage that can stop the service even while the Azure VM resource still looks healthy.

Here is the thread connecting storage back to startup. A rebuild from image is only useful when the startup path can attach or mount the right data disk and start the service against the expected path. That is why boot troubleshooting includes disk evidence. After storage, the next big piece is the network interface, because the worker must reach dependencies without opening the VM to unsafe access.

## Network Interfaces And Access
<!-- section-summary: A VM network interface gives the machine a private network identity, while production access design controls whether humans and traffic reach the VM through public, private, or brokered paths. -->

A **network interface**, often shortened to NIC, is the VM's attachment to an Azure virtual network subnet. It gives the VM a private IP address, connects it to route tables and network security groups, and serves as the network identity Azure uses for packets moving in and out of the machine. The guest operating system also sees a network adapter and configures its own network stack.

For the Orders worker, the clean production shape is private. The NIC sits in a subnet such as `snet-orders-app-prod`, receives a private IP such as `10.40.12.14`, and has no public IP address. The worker reaches internal APIs, storage private endpoints, package mirrors, and log collection endpoints through approved routes. Human administration goes through a controlled path such as Azure Bastion, a VPN, a private jump host, or another approved access pattern.

This is where beginners often mix up two different access systems. **Azure RBAC** controls who can manage the Azure VM resource through Azure APIs, such as start, stop, read metadata, attach disks, or change network settings. **Operating system access** controls who can sign in to the guest OS through SSH, RDP, or another administration method. A person may have Azure permission to view the VM resource and still lack OS login access. Another person may have an old SSH key on the machine and bypass the clean Azure review path.

The VM access record should answer a few production questions.

| Access question | Production answer to record |
|---|---|
| Does the VM have a public IP? | Prefer no public IP for private workers. Record any exception and owner. |
| How do administrators connect? | Bastion, VPN, private admin subnet, or another approved path. |
| Who can manage the Azure resource? | Azure RBAC role assignments at the narrowest useful scope. |
| Who can sign in to the guest OS? | OS users, SSH keys, groups, RDP policy, and rotation process. |
| Which ports are reachable? | NSG rules, guest firewall rules, and expected listening services. |
| How are changes audited? | Azure Activity Log, OS authentication logs, and session or command logging where required. |

Network evidence also matters during incidents. If the worker cannot reach a database, the answer may live in DNS, routes, NSGs, a private endpoint, the guest firewall, or the application config. If humans cannot connect, the answer may live in Azure RBAC, Bastion, the VM power state, the NIC, NSG rules, SSH daemon status, or OS users.

![Azure VM capacity and access board showing size envelope, durable managed disk, disposable temporary disk, private IP, NSG rules, and approved admin path](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-capacity-access-board.png)

*Use this as the capacity and access checklist: the VM size, disk choice, temporary storage, and private access path all shape production behavior.*

Networking gives the VM a place to live. Startup and agents give Azure a way to help configure and observe the guest operating system, so we can talk about extensions next.

## Extensions, Agents, And Runtime Configuration
<!-- section-summary: The Azure VM Agent and VM extensions let Azure run configuration, monitoring, security, and utility tasks inside the guest OS, but the team still needs to design repeatable configuration and inspect extension failures. -->

The **Azure VM Agent** is software inside the guest operating system that helps Azure interact with the VM. On supported images, it enables capabilities such as extension handling. A **VM extension** is a small package Azure can install or run inside the VM for configuration, monitoring, security, or utility work. Microsoft describes extensions as post-deployment configuration and automation for Azure VMs.

For the Orders worker, extensions can handle work that should happen the same way across machines. The Azure Monitor Agent extension can connect the VM to monitoring. A custom script extension can run a bootstrap script that prepares a mount, writes a config file, or registers the worker. A security extension can install endpoint protection according to the organization's baseline.

Extensions are useful operating hooks, and they still follow normal guest OS failure modes. They run inside the guest OS through the agent path. If the VM agent is unhealthy, network access is blocked, the script URL is unreachable, the script exits with an error, or the operating system blocks execution, the extension can fail. In a real incident, the operator checks extension provisioning status and then reads the extension logs inside the VM.

Here is a small Bicep sketch for a Custom Script Extension. It shows the relationship between the Azure resource and the in-guest command.

```bicep
resource bootstrap 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  name: 'vm-devpolaris-orders-legacy-01/bootstrap'
  location: resourceGroup().location
  properties: {
    publisher: 'Microsoft.Azure.Extensions'
    type: 'CustomScript'
    typeHandlerVersion: '2.1'
    autoUpgradeMinorVersion: true
    settings: {
      fileUris: [
        'https://storage.example.invalid/bootstrap-orders-worker.sh'
      ]
      commandToExecute: 'bash bootstrap-orders-worker.sh'
    }
  }
}
```

In production, the script should come from a controlled artifact location, not a random personal URL. It should be idempotent, which means running it twice should leave the machine in the same intended state rather than duplicating users, remounting incorrectly, or corrupting files. That one property makes extension retries much less scary.

Extensions connect Azure automation to the guest. The next piece is what actually keeps the application running after all setup finishes.

## Process Supervision And Health
<!-- section-summary: The team manages the application process inside a VM through a service supervisor, restart policy, logs, metrics, and health evidence inside the guest OS. -->

**Process supervision** means a local system watches an application process and controls how it starts, stops, restarts, and reports status. On modern Linux VMs, that system is usually `systemd`. On Windows, it may be a Windows service. A VM gives your team the operating system, so the team must define how the actual application process behaves.

For the Orders worker, the vendor process should run as a service instead of relying on someone running a command in an SSH session. It should use a dedicated OS user, a working directory, an environment file, a restart policy, and logs. If the process crashes at 2:00 a.m., the service manager should try a controlled restart and leave useful evidence.

Here is a small Linux service example.

```ini
[Unit]
Description=DevPolaris Orders Inventory Worker
After=network-online.target
Wants=network-online.target

[Service]
User=orders-worker
Group=orders-worker
EnvironmentFile=/etc/devpolaris/orders-worker.env
WorkingDirectory=/opt/devpolaris/orders-worker
ExecStart=/opt/devpolaris/orders-worker/bin/inventory-worker
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

The service file makes the process visible to standard operating tools. An operator can check `systemctl status orders-inventory.service`, read journal logs, confirm the environment file, and see recent restarts. That is much better than a process launched from a terminal and forgotten.

Health needs two views. The guest OS can know whether the process is active, whether a port is listening, whether logs show errors, and whether disk usage is safe. Azure can receive metrics and logs when the team installs and configures agents. Some VM availability and patching workflows can also use application health extensions, but the team still has to define what healthy means for this workload.

The practical health question for the Orders worker is simple: "Can this VM prove the worker is running, processing messages, writing state safely, and shipping logs?" If the answer requires a human to log in and poke around every time, the VM is under-instrumented.

Now we have a running service. The next responsibility is keeping the server safe over time and proving it can recover after failure.

## Patching, Backups, And Recovery
<!-- section-summary: VM operations include OS patching, application updates, disk backups, restore testing, and recovery plans because the team owns the guest server lifecycle. -->

**Patching** means applying operating system and software updates that fix security issues, reliability bugs, and compatibility problems. Azure can help govern patching through services such as Azure Update Manager, which Microsoft describes as a unified service for managing updates across Windows and Linux machines in Azure, on-premises, and other clouds through Azure Arc. The team still has to choose maintenance windows, test updates, and handle workload-specific risk.

For the Orders worker, patching should have a rhythm. Development or staging VMs receive updates first. Production updates happen during an agreed window. The team watches service health after patching. If the vendor package breaks after a kernel or library update, the team needs a rollback or rebuild plan. That plan may involve a previous image version, disk backup, or replacement VM.

**Backup** means keeping recoverable copies of data or machine state. For VM workloads, backup planning can include managed disk snapshots, Azure Backup, application-level dumps, database-native backups, and exported configuration. The right approach depends on what the data is and how consistent it must be. A crash-consistent disk snapshot may help with some files, while a database may need application-aware backup steps.

For the Orders worker, the team should separate what can be rebuilt from what must be restored. The OS can usually be rebuilt from the image and first boot scripts. The vendor package should come from the image or package repository. The service file should come from source control. The data disk and any business state need backup and restore testing. Logs should stream off the machine so they survive VM replacement.

Recovery needs a drill with more detail than a checkbox. A useful drill might recreate `vm-devpolaris-orders-legacy-01` from the current image in a test resource group, attach a restored copy of the data disk, run first boot configuration, start the service, and prove it can process a sample message. This reveals missing packages, broken mount scripts, stale keys, firewall assumptions, and backup consistency problems before a real outage.

Once recovery is clear for one VM, the next question is whether the workload should be one machine at all. Some VM workloads need a fleet pattern, and some old VMs need retirement instead.

## Scale Sets And VM Sprawl
<!-- section-summary: Virtual Machine Scale Sets manage fleets of VM instances for repeated server-shaped workloads, while VM sprawl review keeps single machines from becoming permanent by accident. -->

A **Virtual Machine Scale Set** is an Azure resource for creating and managing a group of load-balanced VM instances. The scale set uses a VM model and can increase or decrease instance count based on demand or a schedule. It is useful when a server-shaped workload needs multiple similar instances instead of one hand-managed machine.

For example, imagine the Orders worker is stateless after the team moves state to Azure SQL or Blob Storage. At that point, the team could run several identical worker VMs from the same image behind a queue-based processing model. A scale set can help create the fleet, keep instances aligned to a model, distribute them across availability choices, and apply updates in a controlled way.

Scale sets keep the server responsibility and spread it across every instance. The image must be solid because every instance comes from it. Startup must be repeatable because new instances appear automatically. Logs must leave every instance. Health checks must identify bad instances. Updates need a rollout policy so the fleet stays available during change. Capacity rules need testing so scaling events avoid surprise cost or downstream overload.

The other side of this topic is **VM sprawl**. VM sprawl happens when machines remain from habit, history, or fear of touching them after the original server-level requirement has faded. A VM created for a migration can become a permanent pet server if the team never records ownership, rebuild steps, patching, cost, access, and retirement criteria.

A simple VM review works well every quarter.

| Review question | What a good answer sounds like |
|---|---|
| What OS-level control does this workload still need? | A specific package, agent, service model, disk contract, or compatibility need. |
| Can the workload move to a managed runtime now? | Evidence from App Service, Container Apps, Functions, AKS, or vendor support. |
| Can the VM rebuild from image and automation? | Image version, startup script, config source, and restore steps are known. |
| Who owns patching and access review? | A named team, schedule, and escalation path. |
| What would let us retire this VM? | Dependency removal, vendor upgrade, containerization, or data migration. |

This review keeps the VM choice honest. Some VMs should stay because they are the correct shape. Some should become scale sets. Some should move to managed compute. Some should be deleted after the migration finishes.

All of those decisions need evidence. That is the last major operating skill for a VM: knowing what to inspect before changing anything.

## Runtime Evidence
<!-- section-summary: VM troubleshooting starts with Azure resource evidence, then moves into guest OS evidence such as boot logs, service status, disk mounts, process logs, patch state, and access records. -->

**Runtime evidence** is the set of facts an operator checks before making a change or explaining an incident. For VMs, evidence lives in two places. Azure has resource evidence: size, image, power state, provisioning state, disk attachments, NIC, private IP, public IP, NSG, identity, extension status, and instance view. The guest OS has server evidence: boot logs, users, packages, mounts, services, firewall, process logs, CPU, memory, disk usage, and patch state.

The Orders worker challenge starts from a healthy habit: inspect before touching the service. This command asks Azure for basic VM shape and placement.

```bash
az vm show \
  --resource-group rg-devpolaris-orders-prod \
  --name vm-devpolaris-orders-legacy-01 \
  --show-details \
  --query "{name:name,powerState:powerState,location:location,size:hardwareProfile.vmSize,privateIps:privateIps,publicIps:publicIps}"
```

```console
{
  "name": "vm-devpolaris-orders-legacy-01",
  "powerState": "VM running",
  "location": "eastus",
  "size": "Standard_D4s_v5",
  "privateIps": "10.40.12.14",
  "publicIps": ""
}
```

This is a good first VM result for a private worker: the VM is running, the size matches the design, the private IP is present, and no public IP is attached. It still says nothing about the service process inside the guest operating system.

Instance view gives provisioning and guest agent status. That matters because extension failures and guest agent problems often explain why Azure automation did not reach the machine.

```bash
az vm get-instance-view \
  --resource-group rg-devpolaris-orders-prod \
  --name vm-devpolaris-orders-legacy-01 \
  --query "instanceView.statuses[].displayStatus"
```

```console
[
  "Provisioning succeeded",
  "VM running"
]
```

Disk and NIC checks complete the Azure side of the first pass.

```bash
az vm show \
  --resource-group rg-devpolaris-orders-prod \
  --name vm-devpolaris-orders-legacy-01 \
  --query "{osDisk:storageProfile.osDisk.name,dataDisks:storageProfile.dataDisks[].name,nics:networkProfile.networkInterfaces[].id}"
```

```console
{
  "osDisk": "osdisk-vm-devpolaris-orders-legacy-01",
  "dataDisks": [
    "disk-orders-legacy-data-prod"
  ],
  "nics": [
    "/subscriptions/.../networkInterfaces/nic-vm-devpolaris-orders-legacy-01"
  ]
}
```

This output confirms that Azure still sees the expected OS disk, data disk, and network interface. If the guest cannot find `/data`, this Azure check helps separate "disk not attached" from "disk attached but not mounted."

After the Azure facts look reasonable, the operator moves inside the guest OS through the approved access path. The guest checks might include cloud-init status, boot diagnostics, disk mounts, service status, journal logs, available disk space, and recent authentication events.

```bash
cloud-init status --long
findmnt /data
systemctl status orders-inventory.service
journalctl -u orders-inventory.service --since "30 minutes ago"
df -h /data
```

```console
status: done
/data /dev/sdc1 xfs rw,relatime
orders-inventory.service - DevPolaris Orders Inventory Worker
   Active: active (running) since Thu 2026-06-11 09:18:04 UTC
Jun 11 09:19:12 vm-devpolaris-orders-legacy-01 inventory-worker[1842]: processed batch=42 queue=orders-inventory
Filesystem      Size  Used Avail Use% Mounted on
/dev/sdc1       256G   84G  173G  33% /data
```

This output tells a better story than "the VM is up." First boot finished, the durable data path is mounted, the service is active, the worker is processing messages, and the data disk still has room. If one line is missing or unhealthy, the operator now has a specific layer to investigate.

This evidence path prevents random fixes. If the VM is stopped, start with the Azure power state. If the data disk is missing, start with attachment and mount evidence. If the service is failed, start with systemd and logs. If extension status is failed, inspect the extension result and logs. The point is to follow the layer where the failure appears.

With all the pieces on the table, we can put the VM story back into one production flow.

## Putting It All Together
<!-- section-summary: A production VM is a deliberate server choice with a rebuildable image, right-sized capacity, durable storage, private network access, repeatable startup, supervised processes, patching, backups, and clear evidence. -->

Azure Virtual Machines give a team the most familiar compute shape in Azure: a server. That is useful when the workload genuinely needs server-level control. The Orders legacy inventory worker is a good example because it needs OS packages, a mounted disk, a service supervisor, and host-level monitoring. A VM makes that possible.

The cost of that control is operating responsibility. The team owns the guest operating system, packages, users, access paths, disk mounts, application service, logs, patching, backups, and restore drills. Azure owns the physical platform and gives useful resource controls, managed disks, networking, extensions, monitoring hooks, boot diagnostics, and scale-set options. The production design has to connect both sides.

The healthy VM pattern looks like this: build from a versioned image, configure first boot through repeatable automation, choose a size from workload evidence, keep durable data on managed disks, treat temporary storage as disposable, avoid public administration paths, supervise the process with a service manager, stream logs off-box, patch on a schedule, test restore, and inspect Azure plus guest OS evidence before changing anything.

The VM should also keep proving that it deserves to exist. If the vendor worker later runs as a container image with no special OS needs, Container Apps may become the better home. If it runs as a fleet of identical server-shaped workers, a scale set may fit. If it remains a single specialized server, keep the operations plan explicit so the machine stays understandable instead of turning into tribal knowledge.

![Production Azure VM operating loop showing image, size, storage, private access, supervised service, patch and restore, plus evidence checks](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-virtual-machines/vm-operating-loop.png)

*Use this as the production VM loop: keep the machine rebuildable, observable, privately reachable, patched, and restorable before changing it during an incident.*

## What's Next

The final article in this module looks at Azure Kubernetes Service. A VM gives one workload full server control. AKS gives a platform team Kubernetes control across many containerized workloads, which means the next article moves from guest operating systems to clusters, node pools, pods, services, ingress, workload identity, and Kubernetes production evidence.

---

**References**

- [Overview of virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/overview)
- [Sizes for virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview)
- [Overview of Azure Disk Storage](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)
- [Azure managed disk types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types)
- [Azure VM extensions and features](https://learn.microsoft.com/en-us/azure/virtual-machines/extensions/overview)
- [Azure Instance Metadata Service for virtual machines](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service)
- [Azure boot diagnostics](https://learn.microsoft.com/en-us/azure/virtual-machines/boot-diagnostics)
- [Azure Update Manager overview](https://learn.microsoft.com/en-us/azure/update-manager/overview)
- [Azure Virtual Machine Scale Sets overview](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/overview)
