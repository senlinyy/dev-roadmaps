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

1. [Why Does Some Software Need a Server?](#why-does-some-software-need-a-server)
2. [What Does a Virtual Machine Give You?](#what-does-a-virtual-machine-give-you)
3. [How Do Images, Machine Types, Disks, and Zones Define a VM?](#how-do-images-machine-types-disks-and-zones-define-a-vm)
4. [How Does a Fresh VM Become an Application Server?](#how-does-a-fresh-vm-become-an-application-server)
5. [Who Keeps the Application Running?](#who-keeps-the-application-running)
6. [How Do Networking and Identity Control the VM?](#how-do-networking-and-identity-control-the-vm)
7. [How Do You Make VMs Replaceable and Operable?](#how-do-you-make-vms-replaceable-and-operable)
8. [What Does the Complete Compute Engine Path Look Like?](#what-does-the-complete-compute-engine-path-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Begin with an ordinary network program. It waits for a request, does some work, sends a response, and waits again. The program needs instructions executed by a CPU, temporary working data held in RAM, durable files on storage, a network path to other computers, an operating system that supplies the environment, an identity that grants permissions, and operational machinery that recovers it after failure.

Your laptop can provide all of those things during development. It is still a poor production host. Closing the lid can stop the program, Wi-Fi can disappear, the machine can reboot, and its public address can change. A production application needs a computer that remains powered, has predictable networking, stores its files, runs the required operating system, restarts its processes, and can be administered remotely.

Before cloud APIs, an organization might buy a physical server and place it in a data centre. Compute Engine changes the acquisition model. Instead of ordering hardware, waiting for delivery, and installing it in a rack, you request a computer-like execution environment through Google Cloud. Google classifies this service as Infrastructure as a Service, or IaaS, because the unit you receive is infrastructure shaped like a machine rather than only an application runtime.

Keep these questions in view as you work through the lesson:

1. **Why Does Some Software Need a Server?**
2. **What Does a Virtual Machine Give You?**
3. **How Do Images, Machine Types, Disks, and Zones Define a VM?**
4. **How Does a Fresh VM Become an Application Server?**
5. **Who Keeps the Application Running?**
6. **How Do Networking and Identity Control the VM?**
7. **How Do You Make VMs Replaceable and Operable?**
8. **What Does the Complete Compute Engine Path Look Like?**

## Why Does Some Software Need a Server?
<!-- section-summary: Compute Engine fits software that needs a continuously running operating system and direct control over the machine environment. -->

The virtual-machine shape matters because many programs expect more than a single input-and-output function. A traditional server program may listen on port `8080` continuously, write under `/var/lib/myapp`, start child processes, run scheduled tasks, install native packages, retain an in-memory cache for hours, respond to Unix signals, rely on a kernel feature, or coordinate several local processes. PostgreSQL, Nginx, Redis, older Java servers, game servers, vendor appliances, and custom enterprise systems can all carry assumptions like these.

A higher-level platform usually asks for the application and chooses much of the surrounding runtime. Compute Engine gives your team the machine and lets the team configure what belongs inside it. That is why virtual machines remain valuable: software that expects an ordinary Linux or Windows server can keep those semantics without your organization owning the physical hardware.

The first decision is therefore about the application's requirements. If the operating system, installed packages, daemon layout, local disk behavior, or machine-level networking are part of the design, a VM is a natural abstraction. If the only requirement is to receive an HTTP request and run a container, a more managed runtime may remove work that the application does not need.

## What Does a Virtual Machine Give You?
<!-- section-summary: A VM behaves like an independent computer while Google owns the data centre, hardware, and virtualization underneath it. -->

Suppose one Google-owned physical server contains dozens of CPU cores, hundreds of gigabytes of memory, network interfaces, and storage connections. Assigning that entire host to a small application would waste much of its capacity. A **hypervisor** divides the physical resources into several isolated, computer-like environments.

```text
                  physical server
                         |
                    hypervisor
              +----------+----------+
              |          |          |
            VM A       VM B       VM C
            Linux      Linux     Windows
```

Each **virtual machine**, or VM, sees virtual CPUs, RAM, disks, network interfaces, firmware, and an operating system environment. Those resources ultimately come from Google's infrastructure, but ordinary operating systems and server software can run as though the VM were a separate computer. Compute Engine's normal VM offering uses KVM-based virtualization.

That computer-like behavior is the key abstraction. On a Linux VM, an administrator can connect with SSH, install packages, create users, edit files under `/etc`, compile software, run containers, start a database, and configure services. The VM gives substantially more machine control than an application platform that accepts only source or a container image.

Control also moves responsibility to the team using it. Google operates the data centre, the physical servers, and the virtualization layer. Your team largely operates the guest operating system, installed packages, language runtime, application, configuration, patching approach, process supervision, and much of backup and recovery. A healthy physical host does not patch your Linux packages or restart an application process that your own service definition omitted.

It helps to stop treating a VM instance as one indivisible object. Creating an instance combines several distinct choices:

| Question | Compute Engine concept |
|---|---|
| Where should the machine run? | **Zone** |
| How much CPU and memory should it have? | **Machine type** |
| What starting software should it contain? | **Image** |
| Where should ongoing files live? | **Disk** |
| What Google Cloud permissions should the workload have? | **Service account** |
| Which network paths can reach it? | **VPC and firewall rules** |
| What should happen during boot? | **Startup configuration** |

These choices can change independently. Increasing memory does not replace Debian with Windows. Rebuilding a disk from a newer image does not move the VM to another zone. Attaching a different service account changes permissions rather than network reachability. Separating the concepts makes both design and debugging easier.

## How Do Images, Machine Types, Disks, and Zones Define a VM?
<!-- section-summary: An image supplies the starting software, a machine type supplies CPU and RAM, disks preserve ongoing state, and the zone chooses the failure domain. -->

An **image** answers what the machine should contain at the beginning. Imagine receiving a blank laptop: before it can boot, it needs disk contents that include an operating system. Compute Engine can use a public Debian, Ubuntu, Rocky Linux, or Windows Server image, or a customized image that already includes a runtime, dependencies, security configuration, and monitoring software.

The image starts a chain:

```text
image template
      |
      v
new boot disk
      |
      v
VM boots from that disk
      |
      v
running operating system
```

An image is a master disk template, not a running machine. It does not contain the VM's live processes or RAM. Ten VMs created from one image begin with similar disk contents, but their disks can diverge after packages, logs, configuration, and application data change.

A **machine type** answers a different question: how much computer should the software receive? It determines the VM's compute resources, especially its virtual CPUs and memory. Google offers machine families, series, predefined shapes, and custom configurations in supported cases. Moving from two vCPUs and 4 GB of RAM to eight vCPUs and 32 GB of RAM resizes the execution capacity. It does not redefine the operating system stored on the boot disk.

This is the useful separation:

```text
image        -> starting software environment
machine type -> CPU and RAM capacity
```

RAM and disk also have different jobs. RAM holds fast working state while the program runs. That state disappears when power is removed. A **disk** stores block data that can persist beyond the lifetime of one process and, depending on its lifecycle settings, beyond a VM restart or replacement. The boot disk normally contains Linux or Windows, installed packages, configuration, application files, and local logs. Additional data disks can hold application data. Compute Engine provides durable block-storage options including Persistent Disk and Hyperdisk, and a disk can be used for boot or application data.

An image and a disk are easy to confuse because an image initializes a disk. After a month, the running VM's disk may include updates, changed configuration, temporary files, logs, and uploads. None of those changes automatically update the original image. The compact model is: **the image describes the starting state; the disk carries the ongoing state.**

The fourth defining choice is geography. Cloud infrastructure still occupies physical places. Google Cloud organizes locations into regions and zones, and a normal Compute Engine VM is a zonal resource. A zone acts as a failure domain within a region. Selecting one is therefore part of reliability design, not merely choosing a nearby label in a form.

One VM creates one failure point. Two VMs can protect against the loss of one instance, and placing those instances in different zones adds protection against failures that affect an entire zone. A load balancer can send requests to healthy instances across those locations.

```text
                 users
                   |
             load balancer
              /          \
             v            v
          Zone A        Zone B
            VM            VM
```

The image, machine type, disks, and zone together answer four independent questions: what begins on the computer, how much execution capacity it receives, what data remains, and which failure domain contains it.

## How Does a Fresh VM Become an Application Server?
<!-- section-summary: Startup automation turns a generic operating-system VM into a configured server and should be safe to run more than once. -->

Creating an Ubuntu VM with two vCPUs, 4 GB of RAM, and a boot disk does not make the application appear. Ubuntu does not know that the team wanted Python, a particular release, configuration files, directories, and a listening service. Someone must install packages, obtain the application, install dependencies, write configuration, create users and directories, and start the right service.

Doing that through an interactive SSH session can work for the first machine. Repeating that manual process is unreliable. Configuring a hundred servers by hand creates a hundred opportunities for a missed command or a one-off change. Operators eventually own machines whose true configuration exists only in a person's memory.

A **startup script** moves that work into executable boot automation. Compute Engine runs a Linux startup script during VM startup after networking is available, and the script runs as `root`. It can install packages, create an application user, download a release, prepare directories, write configuration, register monitoring, and install operating-system service definitions.

```text
create VM
   |
Linux boots
   |
startup script runs
   |
machine receives application configuration
   |
application service becomes usable
```

Root execution makes the script powerful enough to configure the whole machine. It also means a mistake can change almost anything on that machine, so startup logic should be reviewed and kept predictable.

Boot automation must also account for repeated execution. A command that creates `/opt/myapp` only when it does not already exist works on both the first and a later boot. A command that fails whenever the directory already exists can leave a restarted VM half-configured. The property of producing the same desired result after repeated runs is **idempotence**.

The desired pattern is:

```text
first run  -> configured machine
second run -> configured machine
later run  -> configured machine
```

That is more reliable than a sequence that works once but fails or becomes mysterious on later runs. Idempotent startup automation supports a larger operational rule: a production system should not depend on remembering the manual history of one special server.

![Compute Engine startup automation prepares a fresh VM and installs a systemd-managed service](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-compute-engine-virtual-machines/vm-bootstrap-path.png)

*The startup phase prepares the machine; the long-running service manager takes over after configuration finishes.*

Startup scripts prepare the machine, but preparation alone does not supervise a process for months. That leads to the next layer: the operating system needs a component that starts the application at boot and responds if it later crashes.

## Who Keeps the Application Running?
<!-- section-summary: systemd supervises long-running Linux processes, while network-path checks prove whether a healthy process is reachable. -->

Suppose the startup script simply runs `python app.py`. The process begins successfully and then crashes five hours later. The VM can remain healthy while the application is unavailable. VM uptime and application uptime describe different layers.

On most modern Linux distributions, **systemd** manages long-running operating-system services. A service definition can tell it which command starts the application, which user should run it, whether it starts during boot, what it depends on, how it handles crashes, and where its standard logs go. The same system supervises services such as `sshd`, Nginx, monitoring agents, and the application.

```text
Linux
  |
systemd
  |-- sshd
  |-- nginx
  |-- monitoring-agent
  `-- myapp.service
```

This creates a clean ownership boundary. Startup automation installs and configures the machine. systemd remains active and manages the long-lived process. A typical boot path is VM start, Linux boot, startup configuration, systemd service start, and the application listening on its configured port. If the process crashes, its service policy can restart it without rebooting the whole VM.

A running process is still only one part of availability. If the application reports that it listens on `0.0.0.0:8080`, a public caller must cross several other layers:

```text
caller
  |
DNS
  |
public endpoint or load balancer
  |
Google Cloud network and firewall
  |
VM network interface
  |
Linux network stack
  |
port 8080
  |
systemd-managed process
```

Any break in that chain can appear to the user as the same symptom: the site is unavailable. The process might answer successfully from inside the VM while a firewall blocks the remote caller. Conversely, the network path can be open while systemd reports a crashed service.

That is why operational checks should move through layers. First ask whether the instance is running. Then ask whether the service is active, whether the application is listening on the expected interface and port, and whether a local request succeeds. Only then follow the remote path through firewall rules, load balancing, and DNS. Separating those questions narrows the fault rather than treating every outage as an application bug.

## How Do Networking and Identity Control the VM?
<!-- section-summary: VPC and firewall controls decide who can communicate with a VM, while its service account decides what the workload may do. -->

Compute Engine instances attach to a **Virtual Private Cloud**, or VPC, network. At a simplified level, each VM receives a virtual network interface and an internal IP address. Other VMs and managed resources can occupy the same private network, while firewall rules decide which traffic is allowed.

```text
VPC
|-- VM A       10.x.x.x
|-- VM B       10.x.x.x
`-- database   10.x.x.x
```

The rules can allow public HTTPS, restrict SSH to approved sources, block direct public database access, and allow an application tier to reach a database privately. This makes two checks explicit: is the process listening, and may this caller reach that listener? A `LISTEN` state inside Linux does not override a cloud firewall, and an open firewall cannot start a missing process.

Network authorization answers who can communicate with the machine. **Identity and Access Management**, or IAM, answers what the workload is allowed to do after it runs. Suppose the application must read one Cloud Storage bucket and write application logs. Embedding a long-lived Google credential in `config.json` would create a new secret that has to be distributed, protected, and rotated.

Instead, a Compute Engine VM can have a **service account** attached. Code uses Google's workload authentication mechanisms, including Application Default Credentials and the metadata server, to obtain credentials for that attached identity. IAM roles then grant the service account only the operations the application requires.

```text
application on VM
       |
runs with attached service account
       |
IAM authorization
       |
Cloud Storage or another Google API
```

The workload identity belongs to the application environment rather than the developer who logged in or the particular physical server underneath it. A narrow service account might read a named bucket and write logs while lacking permission to administer the project.

Keep the two security directions separate:

```text
VPC and firewall rules -> who can exchange packets with the VM
service account and IAM -> which Google Cloud actions the workload may perform
```

A remote request can fail because the packet is blocked. A local application call to Cloud Storage can fail because IAM denies the service account. The remedies differ, so debugging begins by identifying which question failed.

## How Do You Make VMs Replaceable and Operable?
<!-- section-summary: Images, templates, startup automation, managed groups, and runbooks turn one manually maintained server into repeatable infrastructure. -->

Imagine a server fails during the night. In one operating model, the team needs that exact machine restored because somebody configured it months ago and no one knows every change. In the other, the team creates a replacement from a declared image or template, boot automation installs the current release, identity and networking attach predictably, and traffic moves to the healthy replacement.

The second model changes the goal. The team no longer tries to preserve one named machine forever. It makes replacement cheap and dependable. This direction is sometimes summarized as treating servers as cattle rather than pets, but the practical idea matters more than the phrase: manual history becomes executable configuration.

Compute Engine supplies building blocks for repeatability, including images, instance templates, managed instance groups, startup scripts, and APIs. Infrastructure-as-code tools such as Terraform can declare those resources as well. A managed instance group can use a shared instance template, recreate failed VMs, and adjust the number of machines. Regardless of tool, the important sequence is:

```text
manual knowledge
      |
executable configuration
      |
repeatable and replaceable infrastructure
```

Replacement does not eliminate operations. Unexpected behavior still needs a human response, and a **runbook** records what an operator should check and which actions are safe. A useful Compute Engine runbook covers several layers:

- Confirm that the instance exists and is running, then inspect CPU, memory, and disk pressure.
- Check the systemd service state and application logs.
- Verify that the process listens on the expected address and port.
- Follow VPC, firewall, load-balancer, and DNS paths when local health is good but remote access fails.
- Test important dependencies such as databases and external APIs.
- Distinguish a safe application restart from a full VM restart.
- Describe how to replace the VM from declared configuration instead of repairing drift indefinitely.
- Record backup, restore, rollback, escalation, and recovery procedures.

The runbook is created by the team operating the application; it is not a Compute Engine feature that appears automatically. It connects the platform's machine controls to the real decisions an operator must make during an incident.

Repeatability and runbooks serve different failure moments. Automation recreates the expected system. The runbook helps a person identify whether the fault is the machine, process, packet path, dependency, or data, then choose a safe repair or replacement action.

## What Does the Complete Compute Engine Path Look Like?
<!-- section-summary: A hosted application combines location, capacity, software, storage, networking, identity, boot automation, process supervision, and an end-to-end request path. -->

Consider a Python API for `example.com` whose requirements include full Linux control. The design can be derived in a clear sequence.

First, choose the region and zone. That places the VM in a real Google Cloud failure domain. Second, select a machine type, perhaps two vCPUs and 4 GB of RAM, to provide the CPU and memory capacity. Third, choose a Debian image to define the starting operating-system contents. Fourth, create a boot disk from that image and attach any additional durable data disks the workload requires.

Fifth, connect the VM to a VPC, give it an internal address, and declare firewall rules. A public HTTPS load balancer can expose the application while the VM itself remains privately addressed or otherwise restricted. Sixth, attach a service account that grants the API permission to read only the storage resources it needs.

Seventh, let startup automation install Python, create a `myapp` operating-system user, download the current release, write configuration, install a systemd unit, and enable it. Eighth, let systemd run `python /opt/myapp/app.py` and supervise the process on port `8080`.

The resulting request path is:

```text
browser
   |
example.com and DNS
   |
HTTPS load balancer or public endpoint
   |
VPC and firewall policy
   |
VM network interface
   |
Linux TCP stack on port 8080
   |
systemd-managed Python process
   |
application logic
```

When the same program calls a Google Cloud API, a second path applies:

```text
application
   |
attached VM service-account identity
   |
IAM authorization
   |
Google Cloud API
```

The concepts now form one coherent machine model:

| Concept | Question it answers |
|---|---|
| **Compute Engine** | Where can the team obtain a computer without buying hardware? |
| **VM** | Which computer-like environment runs the operating system? |
| **Image** | What should the new boot disk initially contain? |
| **Machine type** | How much CPU and RAM should the VM receive? |
| **Disk** | Which state should persist beyond a process or reboot? |
| **Zone** | Where does the machine run, and which failure domain contains it? |
| **Startup script** | How does a fresh machine configure itself? |
| **systemd** | Which component supervises the long-running Linux process? |
| **Service account** | Which Google Cloud identity does the workload use? |
| **VPC and firewall** | Which callers may communicate with the machine? |
| **Templates and automation** | Can the team reproduce the server instead of hand-repairing it? |
| **Runbook** | What should an operator do when automation is not enough? |

Compute Engine is the right fit when the machine is genuinely part of the application architecture: the workload needs root or OS control, specific system packages, long-running daemons, legacy installers, custom agents, unusual runtimes, specialized networking, or normal-server behavior.

That flexibility carries the machine's operating work. If the application only needs a managed HTTP runtime, then patching Linux, supervising systemd, caring for disks, replacing VMs, and planning capacity may be unnecessary. The final tradeoff is direct: Compute Engine supplies more machine control and leaves more machine responsibility with your team. Higher-level hosting hides more of the server and therefore limits some low-level choices.

## Check Your Answers

:::expand[Why Does Some Software Need a Server?]{kind="recap"}
Some programs assume a continuously running operating system, installed packages, daemons, local files, process signals, or machine-level networking. Compute Engine preserves those server semantics while Google owns the physical infrastructure.
:::

:::expand[What Does a Virtual Machine Give You?]{kind="recap"}
A VM supplies a computer-like environment with virtual CPU, memory, disks, networking, and an operating system. Google manages the data centre and virtualization; your team largely manages the guest OS and software inside it.
:::

:::expand[How Do Images, Machine Types, Disks, and Zones Define a VM?]{kind="recap"}
The image supplies starting software, the machine type supplies CPU and RAM, disks carry ongoing state, and the zone chooses the machine's location and failure domain.
:::

:::expand[How Does a Fresh VM Become an Application Server?]{kind="recap"}
A root-level startup script installs and configures the application during boot. Making that automation idempotent lets it reach the same desired configuration after repeated runs.
:::

:::expand[Who Keeps the Application Running?]{kind="recap"}
systemd starts and supervises the long-running Linux process. Operators still verify the process, listening port, and complete remote network path separately.
:::

:::expand[How Do Networking and Identity Control the VM?]{kind="recap"}
VPC and firewall controls decide who can exchange packets with the VM. The attached service account and IAM roles decide what the running workload may do in Google Cloud.
:::

:::expand[How Do You Make VMs Replaceable and Operable?]{kind="recap"}
Images, templates, startup automation, groups, and APIs make machines reproducible. A runbook tells operators how to diagnose, restart, replace, restore, or escalate when the system misbehaves.
:::

:::expand[What Does the Complete Compute Engine Path Look Like?]{kind="recap"}
A complete deployment combines zone, machine type, image, disks, VPC, firewall, service account, startup automation, systemd, and an end-to-end request path. Choose it when the application truly needs machine-level control.
:::

## References

- [Compute Engine overview](https://docs.cloud.google.com/compute/docs/overview?authuser=1) - Official overview of Compute Engine's IaaS and virtual machine model.
- [Create Compute Engine instances](https://docs.cloud.google.com/compute/docs/instances/instance-creation-overview?hl=en) - Official guide to images, disks, and the instance creation path.
- [Machine families and resource comparison](https://docs.cloud.google.com/compute/docs/machine-resource?authuser=0) - Official machine type and resource guidance.
- [Compute Engine disks API](https://docs.cloud.google.com/compute/docs/reference/rest/v1/disks) - Official reference for boot and data disks.
- [Regions, zones, and resource scope](https://docs.cloud.google.com/compute/docs/regions-zones/global-regional-zonal-resources?hl=en) - Official location and failure-domain model.
- [Linux startup scripts](https://docs.cloud.google.com/compute/docs/instances/startup-scripts/linux) - Official behavior and requirements for startup automation.
- [Authenticate Compute Engine workloads](https://docs.cloud.google.com/compute/docs/access/authenticate-workloads) - Official service account, Application Default Credentials, and metadata-server guidance.
