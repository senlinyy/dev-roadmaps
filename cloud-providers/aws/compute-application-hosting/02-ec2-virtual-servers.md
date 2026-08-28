---
title: "EC2 Virtual Servers"
description: "Understand EC2 instances, AMIs, instance types, EBS volumes, instance roles, boot configuration, process supervision, load balancing, Auto Scaling, deployments, and incident response."
overview: "EC2 turns a server-shaped unit of computing into an AWS resource. This article builds one instance from first principles, then turns it into a reproducible and replaceable application fleet."
tags: ["ec2", "virtual-servers", "ami", "systemd", "aws"]
order: 2
id: article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers
aliases:
  - ec2-virtual-servers
  - cloud-providers/aws/compute-application-hosting/ec2-virtual-servers.md
---

## Table of Contents

1. [What Is an EC2 Instance?](#what-is-an-ec2-instance)
2. [How Do AMIs, Instance Types, and EBS Work Together?](#how-do-amis-instance-types-and-ebs-work-together)
3. [How Does an EC2 Application Get AWS Permissions?](#how-does-an-ec2-application-get-aws-permissions)
4. [How Does a New Instance Become Ready?](#how-does-a-new-instance-become-ready)
5. [Why Should Fleet Instances Be Replaceable?](#why-should-fleet-instances-be-replaceable)
6. [How Do You Deploy and Roll Back an EC2 Fleet?](#how-do-you-deploy-and-roll-back-an-ec2-fleet)
7. [How Do You Investigate an EC2 Incident?](#how-do-you-investigate-an-ec2-incident)
8. [How Should You Think About EC2 as a Whole?](#how-should-you-think-about-ec2-as-a-whole)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start without AWS. An application that runs continuously needs processors to execute instructions, memory for its working data, storage for an operating system and application files, a network interface, and a process that remains alive to handle work. On traditional infrastructure, a team bought a physical server, installed an operating system, connected the machine to a network, copied the application onto it, and maintained everything for the life of that server.

**Amazon Elastic Compute Cloud (EC2)** changes how the team obtains the machine. AWS owns the physical server and exposes virtual machines that customers can create through an API. Each virtual machine is an **EC2 instance**.

```text
AWS physical server
┌─────────────────────────────────────────────┐
│ processors, memory, disks, and networking   │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ instance │  │ instance │  │ instance │ │
│  │ Linux    │  │ Linux    │  │ Windows  │ │
│  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────┘
```

Keep these questions in view as you work through the lesson:

1. **What Is an EC2 Instance?**
2. **How Do AMIs, Instance Types, and EBS Work Together?**
3. **How Does an EC2 Application Get AWS Permissions?**
4. **How Does a New Instance Become Ready?**
5. **Why Should Fleet Instances Be Replaceable?**
6. **How Do You Deploy and Roll Back an EC2 Fleet?**
7. **How Do You Investigate an EC2 Incident?**
8. **How Should You Think About EC2 as a Whole?**

## What Is an EC2 Instance?
<!-- section-summary: EC2 provides a programmable virtual machine with familiar server capabilities and operating-system responsibilities. -->

Virtualization isolates the instances and gives each one a machine-like environment. AWS maintains the physical data center, hardware, and virtualization platform. Inside the guest machine, you still meet normal server concepts: users, processes, files, filesystems, ports, package managers, background daemons, scheduled jobs, logs, kernel settings, and network sockets.

That is why EC2 is best understood as **server-shaped compute**. An instance is not just the application. It is a machine in which one or more applications run.

Compare the abstraction with a function service:

```text
Function service                   EC2
----------------                   ---
provide code                       describe a machine
AWS invokes the code               AWS boots the machine
                                    the operating system starts
                                    you choose the long-running processes
```

The extra control is useful when software needs a particular operating system, native package, host agent, filesystem layout, kernel setting, or long-running background process. It also creates extra work. Your team generally maintains the guest operating system, installed software, configuration, updates, security patches, and application lifecycle.

A useful starting equation is:

```text
EC2 instance
= machine image
+ virtual hardware shape
+ writable storage
+ network attachment
+ AWS identity
+ boot-time configuration
```

The next sections separate these parts so that “the server” does not remain one vague box.

## How Do AMIs, Instance Types, and EBS Work Together?
<!-- section-summary: An AMI supplies the bootable baseline, an instance type supplies the compute shape, and EBS supplies live writable block storage. -->

A new virtual machine needs bootable software. In EC2, that starting template is an **Amazon Machine Image (AMI)**. An AMI includes the software image and block-device mapping needed to start an instance. It might contain Linux, system libraries, a language runtime, Nginx, a monitoring agent, and a prepared application release.

```text
AMI: company-web-v17
├── Linux
├── system libraries
├── Java runtime
├── Nginx
├── monitoring agent
└── application release
```

The AMI is a template, not the running server. One AMI can produce many instances:

```text
Web AMI ──┬──> web-1
          ├──> web-2
          ├──> web-3
          └──> web-4
```

The AMI answers “Which software baseline should boot?” It does not decide how much computing capacity the new instance receives. The **instance type** answers that second question by selecting a combination of CPU, memory, storage capabilities, and networking capacity.

The same image can run on different instance types:

```text
                   same AMI
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
  2 vCPU / 4 GiB  8 vCPU / 32 GiB  64 vCPU / 256 GiB
```

Different workload shapes create different pressures. A web API may need balanced CPU, memory, and networking. Video encoding can be CPU-intensive. An in-memory system needs more RAM. Machine-learning workloads may need accelerators, while high-I/O systems care strongly about storage and network performance. The instance type lets the hardware envelope change without rebuilding the software image.

The running operating system also needs writable storage for logs, configuration, package changes, and application files. The common EC2 answer is **Amazon Elastic Block Store (EBS)**. An EBS volume appears to the operating system like a disk. The instance sends block reads and writes to it, and the operating system places a filesystem such as `ext4` or `xfs` on those blocks.

```text
EC2 instance
┌─────────────────┐
│ Linux           │
│ application     │
│ CPU and memory  │
└────────┬────────┘
         │ block I/O
         ▼
┌─────────────────┐
│ EBS volume      │
│ filesystem      │
│ writable files  │
└─────────────────┘
```

These three resources therefore have distinct roles:

```text
AMI            immutable starting template
instance type  CPU, memory, and performance envelope
EBS            live writable block storage
```

An EBS volume has a lifecycle independent of the running compute instance when configured to remain after termination. EBS snapshots provide point-in-time backups from which new volumes can be created. Whether a particular volume is deleted with an instance depends on its block-device settings, so do not assume all attached data survives or disappears—inspect the configuration.

Separating image and live disk also exposes **configuration drift**. Suppose operators log into ten instances and update the application manually. One server gets the new release, another keeps an old runtime, and a third receives an emergency setting no one records. Those servers no longer match the original AMI or one another.

```text
server 1  app 8.0, Java 21
server 2  app 8.0, Java 21
server 3  app 7.9, Java 17
server 4  app 8.0, plus an undocumented fix
```

A reproducible alternative is to build a new image, launch new instances, verify them, and discard the old instances. This idea will later turn application deployment into a change to the fleet specification.

### How Does Traffic Reach an EC2 Application?
<!-- section-summary: VPC placement, routes, addresses, security groups, and the application listener must all agree before a request can reach an instance. -->

Running code is not automatically reachable. If an application listens on TCP port `8080`, several separate layers must work:

```text
Where does the instance exist?       VPC
Which network segment contains it?   subnet
Where should packets travel?         routes
Which addresses identify it?         private or public IP
Which traffic is permitted?          security group
Which process receives the packet?   application on :8080
```

A **security group** is a stateful network control associated with resources such as EC2 network interfaces. Its inbound rules describe permitted incoming connections; its outbound rules describe permitted outgoing connections. Because the control is stateful, response traffic for an allowed connection is handled automatically.

A common web path places an Application Load Balancer in front of private application instances:

```text
Internet
   │ HTTPS :443
   ▼
Application Load Balancer
   │ TCP :8080
   ▼
instance security group
   │
   ▼
EC2 application listening on :8080
```

The instance security group can allow port `8080` from the load balancer’s security group rather than from every internet address. That rule says which source may send packets to the port. It does not start the application or make it listen.

This produces two similar-looking but different failures:

```text
app listens on :8080 + security group blocks the path
= unreachable

security group permits :8080 + no process listens there
= unreachable
```

Good troubleshooting tests both the network path and the process. Opening a broader firewall rule cannot repair a crashed process, and restarting the process cannot repair a missing route.

## How Does an EC2 Application Get AWS Permissions?
<!-- section-summary: An instance role gives software temporary AWS credentials, while network controls answer the separate question of packet reachability. -->

Suppose the application must read `s3://company-config/production.json`. Reaching an AWS endpoint over HTTPS does not authorize `s3:GetObject`. Network connectivity answers “Can packets travel?” AWS authorization answers “May this principal perform this API action?”

An **IAM role for EC2** gives code on the instance an AWS identity. The role policy can permit `s3:GetObject` for only the required bucket and prefix. The application does not need a permanent access key stored in a file or environment variable.

EC2 makes temporary role credentials available through the **Instance Metadata Service (IMDS)**. AWS SDK credential providers can obtain those credentials and refresh them as they rotate.

```text
application on EC2
       │ asks for role credentials
       ▼
Instance Metadata Service
       │ returns temporary credentials
       ▼
AWS SDK signs an API request
       │
       ▼
S3 evaluates the role permission
```

The role is associated with the instance through an instance profile. From the application’s perspective, however, the important fact is that AWS supplies temporary credentials for the attached role.

Keep the distinction explicit:

| Control | Question it answers |
|---|---|
| Security group | May these network packets reach or leave the resource? |
| IAM role | May this AWS identity call this API action on this resource? |

An application can have network access to S3 and still receive `AccessDenied`. It can also possess IAM permission while lacking a working network path to an AWS endpoint. Diagnose the two layers independently.

## How Does a New Instance Become Ready?
<!-- section-summary: User data configures a new machine during initialization, while systemd supervises the application after boot. -->

The EC2 console may show an instance as `running` as soon as its virtual machine has booted. That does not prove the application is ready for traffic. Readiness has more steps:

```text
virtual hardware created
        ↓
boot volume attached
        ↓
operating-system kernel starts
        ↓
system services start
        ↓
machine configuration runs
        ↓
application process starts
        ↓
dependencies initialize
        ↓
health check passes
        ↓
traffic becomes safe
```

**User data** supplies launch-time instructions. On Linux it commonly contains a shell script or `cloud-init` configuration processed during initialization. By default, ordinary user-data scripts run during the first boot after launch.

```bash
#!/bin/bash
set -eux

dnf install -y java-21
mkdir -p /opt/myapp
aws s3 cp s3://company-releases/myapp-42.jar /opt/myapp/app.jar
```

Several earlier concepts meet here. The AMI boots Linux. The instance role authorizes the S3 download. User data builds the launch-specific state. The EBS root volume stores the downloaded artifact.

User data should not be treated as a secret store. Instance metadata and user data are inspectable by principals with sufficient access to the instance, so passwords and long-lived keys belong in a purpose-built secret mechanism.

User data is also not a complete process supervisor. If it runs `java -jar app.jar` once, what restarts the program after a crash or a reboot? On most modern Linux systems, **systemd** manages that continuing lifecycle.

```ini
[Unit]
Description=My Application
After=network-online.target
Wants=network-online.target

[Service]
User=myapp
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/java -jar /opt/myapp/app.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The service runs as the `myapp` user, starts from the application directory, and restarts five seconds after a failure. Enabling it connects the service to normal machine boot:

```bash
systemctl daemon-reload
systemctl enable myapp
systemctl start myapp
```

The boundary is simple:

```text
user data  constructs or configures the newborn machine
systemd    keeps the application running throughout machine life
```

If a new instance never becomes healthy, inspect `/var/log/cloud-init-output.log` for bootstrap output, `systemctl status myapp` for supervisor state, and `journalctl -u myapp` for application logs.

![The runtime stack shows the layers a team owns when it chooses a virtual server: network, instance, operating system, role, boot script, and app process](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-runtime-stack.png)

*An instance can be running while the application above it is still configuring, starting, or failing.*

### How Do You Turn One Instance into a Fleet?
<!-- section-summary: A load balancer distributes traffic, a launch template describes new servers, and an Auto Scaling group reconciles the desired fleet. -->

One correctly configured instance is still one failure domain. If it stops, the service stops. Multiple instances let traffic continue when one copy fails, but clients should not discover and select individual server addresses themselves.

An **Application Load Balancer (ALB)** provides one entry point, routes requests to registered targets, and performs health checks. Unhealthy targets stop receiving normal requests while healthy targets continue serving.

```text
                   Application Load Balancer
                         /    |    \
                        ▼     ▼     ▼
                      EC2-A EC2-B EC2-C
```

To create interchangeable instances, the fleet needs a repeatable manufacturing recipe. A **launch template** can record the AMI, instance type, security groups, block-device mappings, key pair, IAM instance profile, user data, and other launch settings. Launch-template versions let the team retain old and new specifications.

```text
Launch Template v17
├── AMI: application 17
├── instance type
├── IAM role
├── security group
├── EBS settings
└── user data
        │
        ├──> EC2-A
        ├──> EC2-B
        └──> EC2-C
```

An **Auto Scaling group (ASG)** changes the unit of management from a named server to a desired fleet. For example:

```text
minimum capacity = 2
desired capacity = 3
maximum capacity = 10
```

The group behaves like a reconciliation loop:

```text
desired: 3 healthy instances
actual:  2 healthy instances
difference: one missing
action: launch one instance
```

When actual and desired state match, the group has nothing to correct. When an instance becomes unhealthy, Auto Scaling can replace it. Scaling policies can also raise or lower desired capacity as demand changes.

Production fleets normally span multiple Availability Zones. That prevents one zone failure from containing every application copy. Load balancing, health checking, zone spread, and reconciliation together make the service more resilient than any individual server.

![The fleet view shows how a load balancer, health checks, launch template, desired capacity, and replacement instances work together](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-fleet-autoscaling.png)

*The durable product is the fleet definition and external state, not the identity of EC2-A.*

## Why Should Fleet Instances Be Replaceable?
<!-- section-summary: Keeping durable business state outside fleet instances lets Auto Scaling destroy and recreate compute without losing the service. -->

Automatic replacement is only safe if a new instance can take over. Imagine a user upload exists only at `/user-uploads/photo.jpg` on EC2-A’s local root volume. When the group replaces EC2-A, that unique file can disappear with it.

This leads to a central fleet rule:

> Data required after an instance dies should normally live outside that replaceable instance.

For example:

```text
EC2 application fleet
   ├── database records ─────> managed database
   ├── uploaded objects ─────> S3
   ├── shared cache ─────────> cache service
   └── durable work items ───> message queue
```

The application instances still have local files and disks, but no instance should be the only owner of business state the service must retain. If EC2-A dies, the ASG creates EC2-D, and EC2-D reconnects to the same external stores.

Such application servers are called **stateless** in the fleet sense. They still hold temporary state in memory and on disk while processing work. “Stateless” means the fleet can discard that local state and reconstruct service from code, configuration, and external durable data.

Replaceability changes operations. Engineers stop asking how to keep a particular instance alive forever and start asking whether the fleet can manufacture a healthy replacement predictably.

## How Do You Deploy and Roll Back an EC2 Fleet?
<!-- section-summary: EC2 deployment changes the desired server specification and moves the fleet to it gradually, keeping a known-good specification for rollback. -->

An application release ultimately changes what runs on the servers. EC2 supports several deployment styles.

In a **mutable deployment**, an operator or tool changes the existing instances in place:

```text
existing instance
      ↓
replace application 41 with 42
      ↓
restart process
```

This can work in small environments, but every partial change creates drift, and reversing an unknown collection of changes becomes difficult.

In a **bootstrap deployment**, the AMI remains generic and each fresh instance downloads a versioned application during user data:

```text
generic AMI
    ↓ boot
user data downloads app 42
    ↓
systemd starts app 42
```

Instances are fresh, but their readiness depends on the boot-time artifact and configuration path.

In an **immutable deployment**, the release pipeline bakes a new image:

```text
source code
    ↓ build and test
application 42
    ↓ bake
AMI for release 42
    ↓
Launch Template v42
    ↓
new EC2 instances
```

The old machines do not get repaired into version 42. The fleet replaces them with machines manufactured from the new specification.

Replacing the whole fleet at once would remove healthy capacity and make one defect affect every target immediately. A rolling deployment changes instances in batches:

```text
41 41 41 41 41
42 41 41 41 41
42 42 41 41 41
42 42 42 41 41
42 42 42 42 42
```

An Auto Scaling **Instance Refresh** supports this process with controls for minimum healthy capacity, warm-up, and health checks between replacement batches. The deeper model is:

```text
deployment
= update the desired machine definition
+ reconcile the fleet gradually
```

If release 42 fails, immutable versioning makes rollback concrete. Launch Template v41 and its AMI remain the known-good specification. Point the group back to that version and replace version 42 instances through the same controlled mechanism. Under supported prerequisites, Instance Refresh can also perform manual or automatic rollback.

Avoid release labels such as `latest`, which do not identify a recoverable state. A useful release record ties together the application commit, artifact or AMI ID, launch-template version, deployment time, and known rollback version.

### Who Patches and Administers EC2 Instances?
<!-- section-summary: EC2 customers own the guest operating-system lifecycle and can choose mutable patching or replacement with newly patched images. -->

EC2’s largest trade-off follows directly from its abstraction. Because the service gives you a guest operating system, your team generally owns updates and security patches inside that operating system.

One approach patches a mutable fleet in place:

```text
running instance
      ↓
install package updates
      ↓
reboot when required
```

AWS Systems Manager Patch Manager and Maintenance Windows can automate scheduled patching of managed nodes. The process still needs health checks, staged rollout, reboot planning, and proof that every intended node received the update.

Another approach builds a patched AMI, tests a fresh instance, and replaces the fleet:

```text
old image
   ↓ apply and test patches during image build
new image
   ↓
new launch-template version
   ↓
replace instances
```

This immutable approach is often easier to reason about for disposable application servers because every replacement begins from the same tested baseline.

Administration also needs a deliberate access path. Traditional SSH requires an inbound route, port `22`, and SSH-key management. **AWS Systems Manager Session Manager** can provide interactive access using IAM authorization and the Systems Manager channel, without requiring inbound SSH ports, bastion hosts, or SSH keys.

```text
application traffic:  ALB → instance :8080
administrative access: IAM → Session Manager → instance
```

The important principle is that administrative access does not have to share the public network path used by application traffic.

## How Do You Investigate an EC2 Incident?
<!-- section-summary: Follow the real request path from DNS and the load balancer through instance health, the process, bootstrap, dependencies, and the changed fleet specification. -->

Suppose users receive `502 Bad Gateway`. “EC2 is broken” is too broad to guide an investigation. Follow the layers a request actually crosses.

1. **Start outside the instance.** Verify DNS, TLS, and whether requests arrive at the load balancer. Logging into a server cannot repair a DNS record that sends users elsewhere.

2. **Inspect target health.** Determine whether one target or the entire fleet is unhealthy. Load-balancer reason codes can reveal timeouts, connection errors, or unexpected response codes.

3. **Check the network path.** Confirm that the load balancer can reach the application port through the intended subnets, routes, and security-group rules.

4. **Check the virtual machine.** Verify its state and EC2 status checks, then look for CPU saturation, memory pressure, full filesystems, I/O problems, or host issues.

5. **Check the supervisor and process.** `systemctl status myapp` shows whether systemd considers the service active. `journalctl -u myapp` reveals startup failures and runtime errors.

6. **Inspect initialization.** For a newly launched instance, read the cloud-init and user-data logs. A download, package installation, or configuration command may have failed before the service started.

7. **Separate dependency reachability from authorization.** The process may be alive but unable to resolve DNS, reach a database, retrieve a secret, or call S3. Ask both “Can packets reach the dependency?” and “Does the role permit the action?”

8. **Correlate with fleet changes.** Auto Scaling activity and CloudTrail can reveal a recent launch-template update, instance refresh, security-group change, or automated replacement.

Consider a concrete rollout. Release 42 updates the group to Launch Template v42. The first new target times out during health checks. On the instance, `systemctl status myapp` shows a failed service, and `journalctl -u myapp` reports `DATABASE_URL is missing`.

The causal chain is now precise:

```text
load balancer marks target unhealthy
        ↓ because
nothing answers correctly on :8080
        ↓ because
systemd cannot keep the app running
        ↓ because
DATABASE_URL is missing
        ↓ because
Launch Template v42 produces incomplete configuration
```

The safest containment follows from that evidence: stop the rollout, return the desired specification to the known-good version, and replace bad instances. Manually adding the environment variable to one failing instance would create drift and leave future replacements broken.

![The incident ladder shows where to look as evidence moves from target health to instance checks, logs, scaling activity, and audit events](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-incident-path.png)

*Each observation narrows the failing layer and points to the next piece of evidence.*

## How Should You Think About EC2 as a Whole?
<!-- section-summary: Keeping specification, compute, traffic, state, identity, initialization, and supervision separate makes EC2 application hosting manageable. -->

The complete design is easier to reason about as several cooperating systems:

| Concern | Common mechanism | Question |
|---|---|---|
| Specification | AMI and launch template | What should a new server look like? |
| Compute | EC2 and Auto Scaling | How many running servers should exist? |
| Traffic | VPC, security groups, and ALB | How do requests reach healthy servers? |
| Durable state | EBS, S3, databases, and other stores | What must survive server replacement? |
| Identity | IAM role | Which AWS operations may the application perform? |
| Initialization | User data and cloud-init | How does a fresh machine configure itself? |
| Supervision | systemd | What keeps the application running after boot? |

```text
clients
   ↓
Application Load Balancer
   ↓
Auto Scaling group
├── EC2 → systemd → app
├── EC2 → systemd → app
└── EC2 → systemd → app
          ↑
   Launch Template
      ├── AMI
      └── launch configuration

applications ── IAM role ──> AWS APIs
applications ──────────────> external durable state
```

EC2 is therefore not fundamentally a high-level web-hosting product. It provides programmable machines. Application hosting emerges as you boot an operating system, start and supervise a process, connect the machine to a network, give the application an identity, reproduce the specification, add copies, balance traffic, and replace unhealthy copies.

The operational leap is from “this particular server is precious” to “this particular server is disposable.” The AMI, launch template, external state, deployment record, and desired fleet are the durable things.

## Check Your Answers

:::expand[What Is an EC2 Instance?]{kind="recap"}
EC2 provides a programmable virtual machine with familiar server capabilities and operating-system responsibilities.

An EC2 instance exposes a machine-like environment with an operating system, processes, users, filesystems, ports, packages, logs, and host configuration. AWS operates the physical infrastructure and virtualization, while the customer generally operates the guest OS and software inside it.

The EC2 running state means the virtual machine booted. The operating system, configuration, application process, and dependencies may still be initializing or failing, and the application health check may not yet pass.
:::

:::expand[How Do AMIs, Instance Types, and EBS Work Together?]{kind="recap"}
An AMI supplies the bootable baseline, an instance type supplies the compute shape, and EBS supplies live writable block storage.

The AMI is the bootable software template. The instance type supplies the CPU, memory, network, and performance shape. EBS supplies live writable block storage and can be snapshotted or given a lifecycle separate from the compute instance.

VPC placement, routes, addresses, security groups, and the application listener must all agree before a request can reach an instance.

The rule only permits packets. A valid route must still exist, and an application process must be running and listening on the expected address and port.
:::

:::expand[How Does an EC2 Application Get AWS Permissions?]{kind="recap"}
An instance role gives software temporary AWS credentials, while network controls answer the separate question of packet reachability.

They answer different questions. The security group controls network reachability. The role controls which AWS API operations the software identity may perform after it reaches an AWS service endpoint.
:::

:::expand[How Does a New Instance Become Ready?]{kind="recap"}
User data configures a new machine during initialization, while systemd supervises the application after boot.

User data performs launch-time initialization, usually during the first boot. systemd supervises the application throughout the machine lifecycle, including restarts after a crash and startup after a reboot.

A load balancer distributes traffic, a launch template describes new servers, and an Auto Scaling group reconciles the desired fleet.

The launch template describes how to manufacture an instance. The Auto Scaling group reconciles the number and health of those instances. The load balancer directs requests to healthy registered targets.
:::

:::expand[Why Should Fleet Instances Be Replaceable?]{kind="recap"}
Keeping durable business state outside fleet instances lets Auto Scaling destroy and recreate compute without losing the service.

Auto Scaling may terminate and replace any instance. External databases, object stores, caches, or queues let a replacement reconnect to shared state instead of losing unique business data with the old machine.
:::

:::expand[How Do You Deploy and Roll Back an EC2 Fleet?]{kind="recap"}
EC2 deployment changes the desired server specification and moves the fleet to it gradually, keeping a known-good specification for rollback.

EC2 customers own the guest operating-system lifecycle and can choose mutable patching or replacement with newly patched images.

A mutable deployment changes existing instances. A bootstrap deployment launches fresh instances that download the release during initialization. An immutable deployment bakes a new image and replaces old machines with instances built from that versioned image.

The customer generally owns guest operating-system updates, security patches, packages, application processes, host configuration, access paths, monitoring, and the safe rollout of changes within the instances.
:::

:::expand[How Do You Investigate an EC2 Incident?]{kind="recap"}
Follow the real request path from DNS and the load balancer through instance health, the process, bootstrap, dependencies, and the changed fleet specification.

Follow the request path: DNS and TLS, load-balancer target health, network reachability, EC2 status, systemd and application logs, bootstrap history, dependency network and IAM access, and recent fleet configuration changes.
:::

:::expand[How Should You Think About EC2 as a Whole?]{kind="recap"}
Keeping specification, compute, traffic, state, identity, initialization, and supervision separate makes EC2 application hosting manageable.
:::

## References

- [Amazon EC2 concepts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)
- [Security in Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security.html)
- [Amazon Machine Images](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html)
- [Amazon EC2 instance types](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-type-specifications.html)
- [Amazon EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)
- [Amazon EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)
- [Security groups for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Use temporary credentials with AWS resources](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_use-resources.html)
- [EC2 user data](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html)
- [Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [Create Auto Scaling groups using launch templates](https://docs.aws.amazon.com/autoscaling/ec2/userguide/create-auto-scaling-groups-launch-template.html)
- [Auto Scaling groups](https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-groups.html)
- [Use an instance refresh](https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html)
- [Instance refresh rollback](https://docs.aws.amazon.com/autoscaling/ec2/userguide/instance-refresh-rollback.html)
- [Systems Manager Patch Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-patching-operations.html)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [Application Load Balancer health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
