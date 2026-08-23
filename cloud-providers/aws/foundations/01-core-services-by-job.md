---
title: "AWS Core Services by Job"
description: "Core AWS service families mapped to compute, traffic, network boundaries, state, access, signals, cost, and recovery."
overview: "AWS becomes easier to understand when each service name is attached to the application job it performs. Follow one request from DNS to compute and data, then use the same map to reason about permissions, failures, recovery, and cost."
tags: ["aws", "foundations", "ec2", "ecs", "lambda", "s3", "iam", "cloudwatch", "rds"]
order: 1
id: article-cloud-iac-cloud-providers-core-services
aliases:
  - cloud-iac/cloud-providers/core-services.md
  - child-cloud-providers-core-services
  - core-services
  - 04-core-services
  - cloud-providers/aws/foundations/04-core-services.md
---

## Table of Contents

1. [How Do AWS Services Map to Application Jobs?](#how-do-aws-services-map-to-application-jobs)
2. [Where Does the Code Run?](#where-does-the-code-run)
3. [How Do Network Paths and Security Rules Work Together?](#how-do-network-paths-and-security-rules-work-together)
4. [Where Does Application State Live?](#where-does-application-state-live)
5. [How Does a Queue Move Work Out of a Request?](#how-does-a-queue-move-work-out-of-a-request)
6. [How Do Workloads Receive Permissions and Secrets?](#how-do-workloads-receive-permissions-and-secrets)
7. [How Do Availability, Recovery, and Cost Shape the Design?](#how-do-availability-recovery-and-cost-shape-the-design)
8. [How Do You Follow One Request and Debug a Failure?](#how-do-you-follow-one-request-and-debug-a-failure)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

## How Do AWS Services Map to Application Jobs?
<!-- section-summary: AWS services are easier to learn when each one is connected to an application job instead of memorized as an isolated product name. -->

The easiest way to begin learning AWS is to set the product catalogue aside for a moment. Every real application has a small set of unavoidable jobs. Code needs a CPU on which to execute. Users need a stable route to that code. Network controls need to block connections that should never occur. Data must survive after a request or process ends. Applications and people must prove who they are before they act. Failures must leave useful evidence. The system must also tolerate expected failures without creating unlimited cost.

AWS services provide different ways to perform those jobs. The service names matter, but the job behind each name matters more. A first map looks like this:

```text
                    INTERNET
                       │
                  photos.example.com
                       │
                    Route 53
                       │
                  CloudFront
                       │
                 ALB / API Gateway
                       │
              ┌────────┴────────┐
              │      VPC        │
              │                 │
              │ EC2 / ECS / EKS │
              │   or Lambda     │
              │       │         │
              │   ┌───┴─────┐   │
              │   │         │   │
              │  RDS     DynamoDB
              │
              │  SQS ──→ workers
              └───────────────┘
                       │
                 S3 / other state

IAM controls who may call what.
Security Groups control who may connect to what.
CloudWatch shows what the system is doing.
CloudTrail records who changed AWS.
Cost tools show what the resources cost.
Redundancy and backups determine how the system survives failure.
```

The diagram is a job map, not a required architecture. A small application may use only some of these services. Another application may choose a different compute or database service. The important point is that the names occupy different places in the same physical story: a request arrives, code runs, data is read or written, permissions are checked, and evidence is produced.

The sections below answer these questions in order:

1. **How Do AWS Services Map to Application Jobs?**
2. **Where Does the Code Run?**
3. **How Do Network Paths and Security Rules Work Together?**
4. **Where Does Application State Live?**
5. **How Does a Queue Move Work Out of a Request?**
6. **How Do Workloads Receive Permissions and Secrets?**
7. **How Do Availability, Recovery, and Cost Shape the Design?**
8. **How Do You Follow One Request and Debug a Failure?**

These questions separate ideas that beginners often blend together. A route does not grant permission. Compute is not durable state. High availability is not backup. Once those boundaries are clear, the AWS service catalogue becomes a collection of tools for familiar application problems.

## Where Does the Code Run?
<!-- section-summary: EC2, ECS, Fargate, EKS, and Lambda differ mainly in how much of the runtime environment AWS manages for you. -->

An application eventually becomes instructions executed by a CPU. The first compute question is therefore: **who manages the environment around that CPU?** AWS offers a spectrum rather than one universally best compute service.

| What you want | AWS service | Useful mental model |
|---|---|---|
| A computer you control | **Amazon EC2** | Rent a virtual machine |
| AWS to schedule containers | **Amazon ECS** | Describe the containers that should run |
| Containers without managing their servers | **ECS with AWS Fargate** | Give AWS the container requirements and let it supply the hosts |
| Kubernetes | **Amazon EKS** | Use an AWS-managed Kubernetes control plane |
| Short or event-driven execution | **AWS Lambda** | Give AWS a function to run when an event arrives |

### EC2 gives you a virtual computer

With a physical Linux server, the layers might be:

```text
physical server
    ↓
operating system
    ↓
Python / Java / Node.js
    ↓
your application
```

EC2 moves the physical hardware into AWS while leaving the upper layers under your control:

```text
AWS hardware
    ↓
EC2 virtual machine
    ↓
your operating system
    ↓
your runtime
    ↓
your application
```

You still decide how to configure the operating system, install software, start processes, allocate memory and disk, and apply patches. That control is useful when an application needs host-level access or fits an existing server-operations model. The cost of that control is that the team owns more of the runtime.

The short mental model is: **EC2 gives the team a computer.**

### ECS and Fargate perform different jobs

A container packages an application with its runtime and dependencies:

```text
photo-app-container
├── application
├── runtime
└── dependencies
```

Packaging does not create CPU or memory. The container still needs a machine. ECS and Fargate answer two separate questions:

```text
ECS
Which containers should run, and where should they be scheduled?

Fargate
Which AWS-managed compute capacity should run those containers?
```

That is why common combinations are `ECS + EC2` and `ECS + Fargate`. ECS provides container orchestration in both cases. EC2 or Fargate provides the underlying compute. With EC2 capacity, the team also manages the container hosts. With Fargate, AWS manages those hosts and the team specifies the task's CPU, memory, networking, image, and other runtime requirements.

EKS occupies a related position for teams that need Kubernetes. AWS manages the EKS control plane, while Kubernetes objects and controllers describe the workloads. The worker compute can still come from different capacity choices underneath the cluster.

### Lambda starts from an event

Lambda removes another layer of infrastructure from the normal programming model. The deployable unit is closer to a function:

```python
def handle_request(event):
    ...
```

An API request, S3 upload, queue message, or scheduled event can invoke that function:

```text
API request / S3 upload / queue message / schedule
                         │
                         ▼
                       Lambda
                         │
                         ▼
                     execute code
```

The team does not choose a particular server to keep alive for that invocation. It focuses on the function, event, permissions, memory, timeout, and behavior. This model suits bounded event-driven work, while a continuously running server process may fit EC2 or a container service more naturally.

The compute choice can now be expressed as a control question:

```text
EC2       → the team manages the virtual machine.
ECS       → the team defines containers and AWS orchestrates them.
Fargate   → AWS also manages the container hosts.
EKS       → the team uses Kubernetes with an AWS-managed control plane.
Lambda    → the team mainly reasons about code and events.
```

Instead of asking which compute service is best in the abstract, ask how much of the runtime environment the application actually needs to control.

### How Do Users Reach the Application?
<!-- section-summary: Route 53, CloudFront, load balancers, API Gateway, ACM, and WAF solve different parts of the path from a public name to healthy application code. -->

Running code has no value to a user until the user can find and reach it. A request such as `https://photos.example.com/users/42` contains several separate jobs:

```text
photos.example.com
        │
        │ Where is this application?
        ▼
       DNS
        │
        │ Is a nearby cached response available?
        ▼
      Edge
        │
        │ Which backend should handle this request?
        ▼
load balancer / API endpoint
        │
        ▼
   application code
```

AWS maps those jobs to different services:

| Traffic job | Common AWS service |
|---|---|
| Translate a domain name into a destination | **Amazon Route 53** |
| Cache and serve content near users | **Amazon CloudFront** |
| Spread connections or requests across targets | **Elastic Load Balancing**, often an **Application Load Balancer** |
| Provide a managed HTTP or API front door | **Amazon API Gateway** |
| Supply TLS certificates for supported services | **AWS Certificate Manager (ACM)** |
| Filter malicious web requests | **AWS WAF** |

Route 53 is the DNS layer. It answers a location question such as, “Where should `photos.example.com` send the client?” It can direct a name toward resources including CloudFront distributions, API Gateway APIs, EC2 instances, and load balancers. DNS normally does not receive and process every application request.

An Application Load Balancer does receive requests. It listens for traffic, checks the health of registered targets, and selects a healthy application target:

```text
                    ALB
                 /   |   \
                /    |    \
             app-1 app-2 app-3
```

This distinction is important during troubleshooting. A correct DNS answer proves that the name points toward the intended entry layer. It does not prove that a backend process is healthy or listening on the port expected by the load balancer.

CloudFront performs another job. Imagine the application origin is in London while a user is in Sydney. Without an edge cache, every cacheable request travels to London. With CloudFront, the user first reaches a nearby edge location:

```text
Sydney user
     │
nearby CloudFront edge
     │
cached response?
   yes ──→ return it
    no
     ↓
London origin
```

CloudFront therefore reduces distance for cacheable content and can reduce traffic reaching the origin. It belongs to the edge and traffic part of the map, not the compute part. ACM provides the certificate used for HTTPS at supported entry services, while WAF can inspect and filter web requests. API Gateway can provide the managed entry point when the application exposes an API rather than routing directly through a conventional load balancer.

## How Do Network Paths and Security Rules Work Together?
<!-- section-summary: A VPC creates the address space, routes create packet paths, and security controls decide whether those paths may be used. -->

The public entry point leads to a second question: what is allowed to talk to what after the request enters AWS? A network can be understood as reachable addresses plus rules that decide where packets may travel. In AWS, the central private-network abstraction is the **Amazon Virtual Private Cloud**, or **VPC**.

A VPC is a logically isolated virtual network in a Region. It includes an IP address range and can contain subnets, routes, gateways, and endpoints. A simple layout might be:

```text
AWS Region
└── VPC 10.0.0.0/16
    ├── subnet 10.0.1.0/24 in Availability Zone A
    │   └── application target
    └── subnet 10.0.2.0/24 in Availability Zone B
        └── database target
```

A **subnet** divides the VPC address range into a smaller range, and each subnet exists in one Availability Zone. The subnet provides a placement and routing boundary for resources in that part of the network.

The most useful definition of a public subnet begins with its route table. A public subnet has a route to an **internet gateway**. A private subnet has no direct route to an internet gateway. A resource's public IP address is related to internet access, but it does not replace the routing requirement.

```text
Internet
   │
Internet Gateway
   │
public subnet
   │
Application Load Balancer
   │
private application subnet
   │
application
   │
private database subnet
   │
RDS
```

The database does not need direct internet reachability simply because the application has public users. Keeping the database behind the application minimizes reachability: fewer sources have a possible path to the data layer.

A private application sometimes still needs outbound internet access, perhaps to call `api.stripe.com`. The desired direction is `private application → internet`, without making `internet → private application` a valid inbound path. One common design sends the private subnet's outbound route through a **NAT gateway** placed in a public subnet, and the NAT gateway reaches the internet through the internet gateway.

Routing and security remain different decisions. A route answers, “Where should this packet go?” A security control answers, “Should this connection be allowed?” For example:

```text
Application Security Group
  allow inbound TCP 8080 from the ALB Security Group

Database Security Group
  allow inbound PostgreSQL 5432 from the Application Security Group
```

The rules express the intended trust path:

```text
Internet
   ↓
  ALB
   ↓ allowed
application
   ↓ allowed
database

Internet ──X──→ database
```

Security groups provide stateful filtering at the resource or network-interface level. A response to allowed traffic is recognized as part of the connection. Network ACLs operate at the subnet level and are stateless, so their rules must account for traffic in both directions. They can provide a coarser additional guardrail.

The durable rule is: **routes create possible paths; security controls decide whether those paths may be used.**

![The request path shows how DNS, HTTPS entry, load balancing, private compute, data storage, IAM, and logs cooperate for one application](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-service-request-path.png)

*One request crosses several service jobs, and each layer can succeed or fail independently.*

## Where Does Application State Live?
<!-- section-summary: EBS, EFS, S3, RDS, and DynamoDB preserve different shapes of state, so the access pattern should choose the service. -->

When a request creates an order, profile, image, or other value, that information must usually remain after the current process stops. If the only copy exists in memory, terminating the process removes it. **State** is the information that must outlive one request or one running process.

Storage is not one uniform job. The correct service depends on the shape of the data and the way the application accesses it.

| Data shape | Typical AWS service | Useful mental model |
|---|---|---|
| Disk attached to a virtual machine | **Amazon EBS** | A virtual hard drive |
| Files shared over a network | **Amazon EFS** | A shared NFS filesystem |
| Files, blobs, and named objects | **Amazon S3** | An object store addressed through an API |
| Relational rows and transactions | **Amazon RDS / Amazon Aurora** | A managed SQL database |
| Key-value or document records | **Amazon DynamoDB** | A managed NoSQL database |
| Work waiting to be processed | **Amazon SQS** | A durable queue |

### EBS stores disk-shaped state

An EC2 instance may need a device that behaves like `/dev/xvda` or a Windows drive. Amazon Elastic Block Store provides volumes that attach to EC2 instances and behave like block devices. The operating system can place filesystems and application data on the volume. EBS snapshots provide point-in-time backups of those volumes.

The short model is `EC2 → EBS volume`: compute uses a disk-shaped storage device.

### S3 stores named objects

An image, PDF, archive, or video may not need a mounted filesystem at all. The application may only need to map a name to bytes:

```text
bucket
├── users/42/avatar.jpg
├── invoices/1001.pdf
└── videos/demo.mp4
```

S3 stores each value as an object inside a bucket and identifies it by an object key. Applications normally use the S3 API to put or get the object. That API-shaped model is why S3 should not be treated as another local hard drive.

### EFS shares files across compute

Some applications genuinely need several machines to see the same filesystem:

```text
EC2 #1 ─┐
EC2 #2 ─┼── shared filesystem
EC2 #3 ─┘
```

Amazon Elastic File System provides shared NFS file storage that multiple compute systems can access over the network. The three storage shapes can therefore be separated cleanly:

```text
EBS → block storage attached to compute
EFS → shared filesystem reached over a network
S3  → named objects reached through an API
```

### RDS stores relational data

Data such as customers, orders, products, and order items often has relationships. The application may need transactions, constraints, and queries that join several tables:

```sql
SELECT ...
FROM customers
JOIN orders ...
JOIN order_items ...
```

RDS manages relational database engines such as PostgreSQL and MySQL while taking responsibility for operational work including backups, patching, and failure recovery. Aurora is an AWS relational database option in the same family of application decisions. The useful model is: the team keeps normal relational data and SQL behavior while AWS manages more of the database infrastructure.

### DynamoDB starts with access patterns

Other applications repeatedly ask direct questions such as:

```text
Give me cart USER#481
Give me session SESSION#ABC
Give me item DEVICE#123
```

That workload can be modeled as `key → item`. DynamoDB is a serverless, fully managed distributed NoSQL database that supports key-value and document models. Its design starts from the reads and writes the application must perform, then chooses keys and items to support those access patterns.

RDS and DynamoDB are therefore different data models rather than a simple slow-versus-fast choice:

```text
RDS
relationships → relational model → SQL queries

DynamoDB
access patterns → keys → items
```

Choosing among these services begins with the data shape and the questions the application asks of that data.

## How Does a Queue Move Work Out of a Request?
<!-- section-summary: SQS creates a durable handoff so user requests do not have to wait for every downstream task to finish. -->

State also includes work that has been requested but not completed. Consider a checkout request that tries to charge a card, send email, generate an invoice, update analytics, resize an image, and notify a warehouse before returning a response. The user's request now depends on six systems completing quickly and successfully.

```text
User presses Buy
       │
       ├── charge card
       ├── send email
       ├── generate invoice
       ├── update analytics
       ├── resize image
       └── notify warehouse
```

A queue separates accepting the work from performing all of it:

```text
User presses Buy
       │
       ▼
create order
       │
       ▼
send job to SQS
       │
       ▼
respond to user

SQS queue
   │
   ├── worker
   ├── worker
   └── worker
```

The queue absorbs the difference between the rate at which work arrives and the rate at which workers can process it. If 10,000 requests arrive while only ten workers are available, sending every task directly to those workers can overload them. Placing messages in SQS lets the ten workers drain the backlog at a sustainable rate.

Amazon SQS provides durable queues that decouple distributed components. Standard queues use at-least-once delivery semantics, so a worker must be prepared for the possibility that it receives the same message more than once. The central model is a durable handoff between the component that requests work and the component that eventually performs it.

SNS and EventBridge solve related messaging problems, especially broadcasting and rule-based event routing. SQS is the foundational queue when the main need is to retain work until a consumer can process it.

## How Do Workloads Receive Permissions and Secrets?
<!-- section-summary: IAM authorizes actions with temporary workload identities, while Secrets Manager stores the sensitive values those identities may retrieve. -->

A working network path does not authorize an AWS API operation. An application can successfully reach S3 and still receive `403 AccessDenied`. The opposite can also happen: IAM can allow an operation while a security group blocks the required network connection.

A successful interaction can require every part of this chain:

```text
network path exists
AND identity is authenticated
AND permission allows the action
AND resource policy allows the action
```

IAM, or AWS Identity and Access Management, answers four connected questions:

```text
WHO
may do WHAT
to WHICH RESOURCE
under WHICH CONDITIONS?
```

For example, an `OrderServiceRole` might allow `s3:GetObject` only for objects under `arn:aws:s3:::invoice-bucket/*`. The role can read invoice objects, but it cannot automatically read every bucket or perform every S3 action. Giving an identity only the actions and resources its job requires is **least privilege**.

### Roles provide temporary workload identity

Embedding permanent credentials in application code creates several leak paths:

```python
AWS_ACCESS_KEY = "..."
AWS_SECRET_KEY = "..."
```

The keys can escape through Git history, logs, container images, developer laptops, or backups. IAM roles replace that model with temporary credentials:

```text
EC2 instance / Lambda function / ECS task
                   │
                   │ assumes or receives
                   ▼
                IAM role
                   │
                   ▼
          temporary credentials
                   │
                   ▼
            permitted AWS APIs
```

An IAM role has no ordinary permanent user password or access key. A session using the role receives temporary credentials. A Lambda function might use an `OrderProcessorRole` that allows it to read an Orders table and send a message to an Emails queue, without granting unrelated account access. The mental model is that the workload wears a temporary identity for its job.

### Permissions and secrets remain separate

Applications also need sensitive values such as database passwords, OAuth client secrets, Stripe API keys, and third-party tokens. Those values are data, not IAM permissions. AWS Secrets Manager stores such credentials and can rotate supported secrets so applications do not need to hard-code them.

```text
application
    │
    │ IAM allows secretsmanager:GetSecretValue
    ▼
Secrets Manager
    │
    ▼
database password or API token
```

Three services now have separate jobs:

```text
IAM
Is this workload allowed to retrieve the value?

Secrets Manager
What is the sensitive value?

AWS KMS
Which cryptographic key protects encrypted data?
```

![The role boundary shows why an application should receive narrow temporary permissions instead of permanent keys or broad account access](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/task-role-boundary.png)

*IAM roles separate workload identity from the sensitive values a workload is permitted to retrieve.*

### Which Signals Explain Runtime Behavior and AWS Changes?
<!-- section-summary: Metrics, logs, traces, alarms, and audit events answer different questions about a running system. -->

When a user says the application is slow, the team needs evidence rather than a guess. Three kinds of operational evidence answer different questions:

```text
Metrics
What changed numerically?

Logs
What happened at a particular moment?

Traces
Where did one request spend its time?
```

Amazon CloudWatch is AWS's central family for metrics, logs, alarms, dashboards, and application or infrastructure monitoring. A metric is a series of numerical values over time. Examples include CPU utilization, request count, error rate, queue depth, and database connection count:

```text
CPUUtilization = 97%
RequestCount = 12,422/min
ErrorRate = 7%
QueueDepth = 63,291
DatabaseConnections = 100
```

A log preserves event detail:

```text
12:01 request started
12:01 query database
12:01 database timeout
12:01 returning HTTP 500
```

A trace connects the work performed by multiple components for one request. It can show that the frontend returned slowly because an application call spent most of its time waiting on a database or another downstream dependency.

An alarm turns a measured condition into a response:

```text
IF 5xx error rate is greater than 5%
FOR 5 minutes
THEN notify the operator
```

The chain is `metric → alarm → action`. The metric provides the time series, the alarm evaluates a condition, and the action informs a person or system that the condition needs attention.

CloudTrail answers a different question. CloudWatch explains what the workload is doing. CloudTrail records actions performed against AWS through the Console, CLI, SDKs, and APIs. If errors jump at `10:31`, CloudWatch can show the operational symptom. If a security group changed at `10:30`, CloudTrail can identify the API event and caller associated with the change.

```text
CloudWatch → operational telemetry
CloudTrail → AWS API audit trail
```

That distinction is valuable in both routine operations and incidents. A runtime symptom and a control-plane change may be related, but they are different forms of evidence.

## How Do Availability, Recovery, and Cost Shape the Design?
<!-- section-summary: Redundancy keeps a service available, backups recover earlier data, RPO and RTO define recovery needs, and every architecture choice has a cost. -->

AWS infrastructure can fail, application processes can crash, and people can delete or corrupt data. A reliable design asks what happens when each failure occurs instead of assuming that a component will never fail.

An AWS Region contains separate Availability Zones. A service can place application capacity across more than one zone:

```text
                    ALB
                  /     \
                 /       \
              AZ-A       AZ-B
               │           │
             app-1       app-2
                 \       /
                  \     /
               Multi-AZ database
```

Different mechanisms address different failures:

| Mechanism | Failure it helps address |
|---|---|
| Multiple application instances | One application instance stops working |
| Multiple Availability Zones | A larger zone-level infrastructure failure |
| Auto Scaling | Compute must be replaced or increased |
| Database Multi-AZ | The primary database infrastructure becomes unavailable |
| Backups and snapshots | Data is deleted, corrupted, or must be recovered from an earlier point |

High availability and backup are not interchangeable. If an application executes `DELETE FROM customers;`, replication may quickly copy that deletion to a standby. Replication can keep the service available after an infrastructure failure, but a backup is what provides an earlier copy of the data. AWS Backup can centralize backup policies across supported AWS resources.

Recovery requirements can be expressed with two measures. **Recovery Point Objective**, or **RPO**, asks how much data the organization can afford to lose. If the only backup is nearly 24 hours old, as much as a day of recent data may be missing after restoration. **Recovery Time Objective**, or **RTO**, asks how long the service can remain unavailable. If restoration takes four hours, the recovery time is four hours.

Before choosing a recovery technology, ask:

```text
How much data loss is acceptable?
How much downtime is acceptable?
Which failure are we protecting against?
```

Every answer has an economic consequence. More EC2 instances increase compute cost. More log volume increases ingestion, storage, and query cost. NAT traffic creates network-processing cost. A larger database increases database and storage cost. Cross-Region traffic adds transfer cost.

AWS Cost Explorer helps analyze cost and usage over time. Billing and Cost Management tools support allocation, budgets, and optimization. A useful production resource therefore carries enough ownership information to connect the bill back to the workload:

```text
resource
  + owner
  + environment
  + application
  + cost attribution
```

Accounts and tags commonly provide that attribution. Cost is not a detail discovered after the architecture is finished. It is a property of the architecture and its traffic, capacity, retention, and resilience choices.

## How Do You Follow One Request and Debug a Failure?
<!-- section-summary: Following a request from DNS through compute, data, permissions, and evidence provides both an architecture map and an outside-in debugging method. -->

Put the service jobs together by following one request through an online photo application:

```text
GET https://photos.example.com/users/42

1. The browser resolves photos.example.com
                         │
                         ▼
                      Route 53

2. The request reaches a nearby edge
                         │
                         ▼
                     CloudFront

3. A dynamic request reaches the application entry point
                         │
                         ▼
                    ALB / API Gateway

4. The entry point selects running application code
                         │
                         ▼
             EC2 / ECS / EKS / Lambda

5. Network rules permit the required connection
                         │
                         ▼
                  Security Groups

6. The application reads the user's record
                         │
                         ▼
                   RDS / DynamoDB

7. The application reads the avatar object
                         │
                         ▼
                         S3

8. The workload must be authorized to read it
                         │
                         ▼
                     IAM role

9. Thumbnail work is handed off without blocking the response
                         │
                         ▼
                        SQS
                         │
                         ▼
                  worker / Lambda

10. Runtime metrics and logs are recorded
                         │
                         ▼
                     CloudWatch

11. AWS configuration changes are recorded
                         │
                         ▼
                     CloudTrail
```

The same physical path provides an outside-in debugging order. Each step asks whether the current layer did its job before moving deeper:

1. **DNS:** Does the hostname resolve to the intended destination? An `NXDOMAIN` response suggests that the request never reached the application entry point.
2. **Edge and TLS:** Can the client establish HTTPS? Check the certificate, CloudFront behavior, WAF rules, and relevant listeners.
3. **Entry point:** Is the load balancer or API Gateway receiving traffic? Are load-balancer targets healthy? A `502` or `503` often means the front door was reached but the backend is unhealthy or answering incorrectly.
4. **Network:** Does a valid route exist? Do security groups permit the required source, destination, and port? If network ACLs are involved, check both directions because they are stateless. VPC Flow Logs can provide evidence about traffic accepted or rejected by network controls.
5. **Compute:** Is the EC2 process, container, or function running? Is the process listening on the expected port? Has it exhausted CPU, memory, or connections?
6. **Identity:** Did the call reach an AWS service and receive `AccessDenied`? Check the workload role, requested action, target resource, conditions, and any resource policy.
7. **Dependencies:** Can the application reach RDS, DynamoDB, S3, or SQS? Is the database healthy, is its connection pool exhausted, or is the queue backlog growing?
8. **Evidence:** Read CloudWatch metrics, logs, and traces. Correlate error rate, latency, compute pressure, queue depth, and dependency behavior.
9. **Changes:** Ask what changed immediately before the symptom began. Check deployments, configuration records, and CloudTrail events.

The visible error often points toward the first layer to inspect:

| Symptom | First service job to inspect |
|---|---|
| DNS failure | Route 53 and DNS records |
| TLS error | Certificate, CloudFront, API Gateway, or load-balancer listener |
| Connection timeout | Route, security group, network ACL, listener, or dead service |
| ALB `502` or `503` | Target health, target port, and application process |
| `AccessDenied` | IAM and resource policy |
| Application `500` | Application code or a downstream dependency |
| Slow requests | Metrics, traces, database behavior, and dependencies |
| Worked yesterday and fails today | CloudTrail, deployment, and configuration changes |

The complete foundations model is therefore a set of questions rather than a list of logos:

| Fundamental question | AWS job | Core services |
|---|---|---|
| Where does code execute? | Compute | EC2, ECS, Fargate, EKS, Lambda |
| How does a user find the application? | Naming and edge | Route 53, CloudFront |
| Which entry point receives the request? | Traffic distribution | ALB, NLB, API Gateway |
| What can connect to what? | Network | VPC, subnets, routes, internet gateway, NAT, security groups |
| Where do bytes survive? | Storage | S3, EBS, EFS |
| Where do structured records survive? | Database | RDS, Aurora, DynamoDB |
| How is work deferred? | Messaging | SQS |
| Who may perform an action? | Authorization | IAM |
| Where do passwords and API keys live? | Secret storage | Secrets Manager |
| Which key protects encrypted data? | Cryptographic keys | KMS |
| What is happening now? | Observability | CloudWatch |
| Who changed AWS? | Audit | CloudTrail |
| Can the workload recover? | Resilience | Multi-AZ, snapshots, AWS Backup |
| What does the workload cost? | Cost management | Cost Explorer, Billing, Budgets |

![The summary groups AWS services by the application job they perform and the evidence each layer provides](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-services-summary.png)

*Following the application job keeps service choices and debugging steps connected.*

Three distinctions explain much of the map:

```text
Route is different from permission.
Can I reach it? is different from Am I allowed to use it?

Compute is different from state.
Where code runs is different from Where information survives.

Availability is different from backup.
Can I keep serving? is different from Can I recover earlier data?
```

Once these boundaries are clear, AWS stops looking like hundreds of unrelated products. It becomes a set of services that solve the same compute, networking, data, identity, operations, recovery, and cost problems found in every distributed application.

## Check Your Answers

:::expand[How Do AWS Services Map to Application Jobs?]{kind="recap"}
AWS services are easier to learn when each one is connected to an application job instead of memorized as an isolated product name.
:::

:::expand[Where Does the Code Run?]{kind="recap"}
EC2, ECS, Fargate, EKS, and Lambda differ mainly in how much of the runtime environment AWS manages for you.

EC2 gives the team a virtual machine, ECS orchestrates containers, Fargate supplies managed container compute, EKS provides a managed Kubernetes control plane, and Lambda runs code in response to events. Choose by the amount of runtime control the workload needs.

Route 53, CloudFront, load balancers, API Gateway, ACM, and WAF solve different parts of the path from a public name to healthy application code.

Route 53 answers the DNS location question, CloudFront provides an edge cache, an ALB distributes requests to healthy targets, API Gateway can provide a managed API entry point, ACM supplies certificates, and WAF filters web requests.
:::

:::expand[How Do Network Paths and Security Rules Work Together?]{kind="recap"}
A VPC creates the address space, routes create packet paths, and security controls decide whether those paths may be used.

The VPC supplies an isolated address space, subnets divide it by Availability Zone, and routes create packet paths. Security groups and network ACLs decide whether traffic may use those paths.
:::

:::expand[Where Does Application State Live?]{kind="recap"}
EBS, EFS, S3, RDS, and DynamoDB preserve different shapes of state, so the access pattern should choose the service.

EBS provides attached block storage, EFS provides a shared filesystem, S3 stores named objects, RDS and Aurora store relational data, and DynamoDB stores key-value or document data designed around access patterns.
:::

:::expand[How Does a Queue Move Work Out of a Request?]{kind="recap"}
SQS creates a durable handoff so user requests do not have to wait for every downstream task to finish.

SQS creates a durable handoff between the component requesting work and the worker that eventually performs it. The queue absorbs a temporary difference between arrival rate and processing capacity.
:::

:::expand[How Do Workloads Receive Permissions and Secrets?]{kind="recap"}
IAM authorizes actions with temporary workload identities, while Secrets Manager stores the sensitive values those identities may retrieve.

IAM roles give workloads temporary identities and policies define allowed actions, resources, and conditions. Secrets Manager stores sensitive values, while KMS manages keys that protect encrypted data.

Metrics, logs, traces, alarms, and audit events answer different questions about a running system.

Metrics show numerical change, logs record events, traces show where a request spent time, and alarms turn measured conditions into actions. CloudWatch provides operational telemetry, while CloudTrail records AWS API activity.
:::

:::expand[How Do Availability, Recovery, and Cost Shape the Design?]{kind="recap"}
Redundancy keeps a service available, backups recover earlier data, RPO and RTO define recovery needs, and every architecture choice has a cost.

Redundant instances and Availability Zones improve availability, while backups recover earlier data. RPO defines acceptable data loss, RTO defines acceptable downtime, and every capacity, traffic, retention, and resilience choice affects cost.
:::

:::expand[How Do You Follow One Request and Debug a Failure?]{kind="recap"}
Following a request from DNS through compute, data, permissions, and evidence provides both an architecture map and an outside-in debugging method.

Map each service to the application problem it solves: compute runs code, traffic services route users, network controls limit connections, storage preserves data, IAM authorizes actions, observability provides evidence, and resilience and cost tools help the team own the system over time.

Follow the request outside-in through DNS, TLS and edge, entry point, network, compute, identity, dependencies, runtime evidence, and recent changes. The failing service job usually narrows the relevant evidence and AWS service.
:::

## References

- [Overview of AWS compute services](https://docs.aws.amazon.com/whitepapers/latest/aws-overview/compute-services.html)
- [Routing Route 53 traffic to a CloudFront distribution](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html)
- [How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)
- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [Troubleshoot NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-troubleshooting.html)
- [Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [What is Amazon EBS?](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [What is Amazon EFS?](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [AWS Secrets Manager User Guide](https://docs.aws.amazon.com/secretsmanager/latest/userguide/secretsmanager-userguide.pdf)
- [What is Amazon CloudWatch?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [CloudWatch metrics concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html)
- [What is CloudWatch Logs?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/pdfs/awscloudtrail/latest/userguide/awscloudtrail-ug.pdf)
- [AWS Backup Developer Guide](https://docs.aws.amazon.com/pdfs/aws-backup/latest/devguide/AWSBackup-dg.pdf)
- [Analyzing cost and usage with Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
