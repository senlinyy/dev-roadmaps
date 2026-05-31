---
title: "AWS Core Services Map"
description: "Map your application's functional requirements to AWS service families and trace request paths to debug systemic failures."
overview: "AWS services are easier to understand when grouped by the jobs they perform. This article details the core service map for traffic, compute, state, access, signals, and operations."
tags: ["aws", "foundations", "ecs", "s3", "iam", "cloudwatch"]
order: 4
id: article-cloud-iac-cloud-providers-core-services
aliases:
  - cloud-iac/cloud-providers/core-services.md
  - child-cloud-providers-core-services
  - core-services
---

## Table of Contents

1. [Connecting the Standalone Pieces](#connecting-the-standalone-pieces)
2. [The Job-Based Service Map](#the-job-based-service-map)
3. [Networking: Private IP Network Rooms](#networking-private-ip-network-rooms)
4. [Traffic: Public DNS and HTTP Load Balancing](#traffic-public-dns-and-http-load-balancing)
5. [Compute: Containerized Scaling Under Surges](#compute-containerized-scaling-under-surges)
6. [State: Relational Databases and Object Buckets](#state-relational-databases-and-object-buckets)
7. [Access Authorization and Secret Delivery](#access-authorization-and-secret-delivery)
8. [Signals: Observability Pipelines and Logs](#signals-observability-pipelines-and-logs)
9. [Operations: Image Registries, Budgets, and Backups](#operations-image-registries-budgets-and-backups)
10. [A Systematic Request Path Diagnostic Walkthrough](#a-systematic-request-path-diagnostic-walkthrough)
11. [Putting It All Together](#putting-it-all-together)

## Connecting the Standalone Pieces

At this stage of your cloud journey, the standalone pieces are visible: compute runs code, accounts and Regions place resources, and ARNs plus tags identify targets. However, having a running container, a relational database, and an object storage bucket does not yet produce a live website. The pieces must be connected into one request path.

To share your application with the public reliably, you must connect these isolated pieces into a unified, secure, and cooperative system. You face a new set of real-world operational challenges:

* You want a custom domain name so customers can load your website, and you need a way to distribute incoming traffic so a surge of requests does not crash your servers.
* You need your compute tasks to scale up automatically when traffic spikes, and scale back down when the surge passes to save money.
* You must protect your private database from direct internet threats, while allowing your application servers to read keys safely.
* You need instant alerts sent to your team if the application begins throwing connection errors.

To build this production-grade architecture, you must learn how the core families of AWS work together as a single system. Once you understand the request path and communication flows between traffic, compute, storage, security, and logging, you can confidently run, scale, and debug any public system in the cloud.

## The Job-Based Service Map

This job-based map groups services by the specific operational role they perform. Instead of asking which service is "best", ask what job your application needs completed and select the family built to handle it.

**Core Service Families**

* **Traffic Routing**: Manages public DNS records and handles how internet requests enter your private VPC boundary. Key services include Route 53 and Application Load Balancers.
* **Compute Execution**: Provides CPU, memory, network identity, and lifecycle rules for your application runtime process. Key services include EC2, ECS Fargate, and Lambda.
* **State Persistence**: Houses structured and unstructured data, ensuring records survive system restarts. Key services include RDS and S3.
* **Access and Secrets**: Grants secure permissions to compute jobs and encrypts private API keys. Key services include IAM roles and Secrets Manager.
* **Observability Signals**: Aggregates stdout logs, performance metrics, and API audit logs. Key services include CloudWatch Logs and CloudTrail.
* **Release Operations**: Manages safe container images, cost budgets, and centralized data protection. Key services include ECR, AWS Budgets, and AWS Backup.

![An infographic showing a customer request flowing from browser to Route 53, load balancer, target health, ECS task, and supporting VPC services such as Secrets Manager, RDS, S3, and CloudWatch Logs](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-request-path.png)

*The production request path is a chain of jobs. DNS finds the entry point, the load balancer checks healthy targets, compute runs the container, state lives outside compute, and signals leave a trail for debugging.*

## Networking: Private IP Network Rooms

Before public requests can enter or internal systems can communicate, you must establish the private IP network room for your workloads. In AWS, this foundation is the Virtual Private Cloud, commonly referred to as a VPC. A VPC is a logically isolated private network block that you define inside a single Region. It defines the IP address coordinates and route tables that decide where packets can travel.

To protect your system from threat actors, you must design a structured three-tier subnet architecture inside your VPC:

* **Public Tier Subnets**: These narrow subnets host only public-facing entry points, such as Application Load Balancers and zonal public NAT gateways. Their route tables contain a default route to an Internet Gateway. Public reachability still depends on public IP mapping, security groups, network ACLs, and the service configuration. AWS now also supports Regional NAT gateways, which do not require hosting the gateway inside a public subnet.
* **Private Application Tier Subnets**: These subnets host core compute workloads, such as application containers or workers. Their route tables do not send internet-bound traffic directly to an Internet Gateway, so public clients cannot open direct inbound connections to the tasks. If the tasks require outbound access, they route through a NAT gateway or use VPC endpoints for supported AWS services.
* **Isolated Data Tier Subnets**: These subnets host transactional database engines and caches. Their route tables have no internet exit, and their security groups accept traffic only from the application tier. This keeps database access dependent on private routes and explicit firewall rules.

By separating your VPC network into these three tiers, you establish a solid architectural boundary. The database is not kept private because of a loose naming convention; it is private because route tables, security groups, and service settings leave no direct public path to it.

![An infographic showing a three-tier VPC with public load balancer and NAT gateway, private ECS tasks, isolated RDS database, and no internet route for the data tier](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/three-tier-vpc.png)

*The VPC tiering rule is simple: public subnets expose only entry points, private app subnets run compute, and isolated data subnets keep databases away from direct internet routes.*

## Traffic: Public DNS and HTTP Load Balancing

Traffic routing is the system's public gatekeeper. When a customer enters `orders.devpolaris.com` in their browser, the request must traverse a structured entry chain before it can reach your app containers.

This traffic entry path uses Route 53 and an Application Load Balancer (ALB):

* Route 53 acts as your global DNS telephone book. It translates the human name `orders.devpolaris.com` into the specific, dynamic public IP addresses of your ALB nodes cabled in the Region.
* The ALB receives the incoming public HTTP request. It manages TLS certificates, evaluates listener rules, and forwards accepted requests to healthy targets. DDoS and application-layer filtering are handled by related services such as AWS Shield and AWS WAF, not by the ALB alone.
* The target group continuously audits the health of your compute tasks by sending recurring HTTP health probes to the container's health path. If the tasks are healthy, the ALB forwards the HTTP packet directly to their private IP and port inside the private subnet.

This pipeline introduces a major operational gotcha: target group health checks. If your container task boots successfully but listens on port 8080 while the target group probes port 3000, the ALB will declare the targets unhealthy. If at least one healthy target exists, traffic moves away from the failing target. If every target is unhealthy, the load balancer can fail open and route to all targets anyway, so health checks are a protection signal, not a substitute for working application readiness.

## Compute: Containerized Scaling Under Surges

Compute is the runtime engine that executes your application code. AWS provides three distinct compute paradigms based on how much server infrastructure your team wants to manage:

* **EC2 (Virtual Servers)**: Provides complete administrative access to virtual server operating systems. You are responsible for patching kernels, scaling capacity, and configuring network routing directly.
* **ECS with Fargate (Containers)**: Packages your application into Docker containers. Fargate runs the containers serverless, managing the virtual machine hosts underneath so you only focus on task configurations.
* **Lambda (Functions)**: Executes code blocks when invoked by an API gateway request or event payload, scaling capacity automatically. Standard on-demand functions do not bill while no invocations run, while provisioned concurrency keeps environments warm and bills for that reserved readiness.

For long-running checkout APIs, ECS Fargate is the standard choice.

**ECS Structural Elements**

* **Task Definition**: The immutable blueprint declaring which Docker image version, processor limits, memory boundaries, log settings, and access roles your container requires to run.
* **Task**: A single active container instance running in the cloud.
* **Service**: The orchestrator that tries to maintain your desired running task count, registers new tasks with the ALB target group, and manages rolling deployments within the health and capacity limits you configure.

Fargate compute can scale under surges when you configure ECS Service Auto Scaling. If a Black Friday shopping promotion spikes traffic, Application Auto Scaling can watch ECS CPU, memory, or custom metrics and adjust the desired task count from 2 running containers to 10. ECS then launches replacement tasks, pulls images, assigns network interfaces, waits for target health, and shifts traffic to the healthy capacity.

## State: Relational Databases and Object Buckets

State represents the persistent business data that must survive after your dynamic compute tasks exit. In the cloud, compute tasks are ephemeral; they are constantly created and destroyed by the orchestrator. You must separate state entirely from the compute hosts, matching the storage service to your data contract:

* **Amazon RDS**: Runs managed relational database engines like PostgreSQL and MySQL. The database engine provides SQL transactions and ACID behavior, while RDS automates infrastructure work such as provisioning, backups, patch windows, and failover features you configure.
* **Amazon S3**: Houses serverless object storage buckets. S3 is designed for cost-efficient, high-volume file persistence, storing flat CSV exports, system logs, or user attachments indexed by text keys.
* **DynamoDB**: Houses managed NoSQL tables. DynamoDB is cabled for single-digit millisecond latency at massive scale, using specific primary key queries rather than complex relational joins.

**State Service Mapping Checklist**

* Transactional ledgers and consistent tables go to Amazon RDS.
* Flat CSV exports, system logs, and media assets go to Amazon S3 buckets.
* High-volume, key-value document records go to Amazon DynamoDB.
* Dynamic local cache disks attached directly to a virtual server go to Amazon EBS.

By separating relational databases in RDS from flat file assets in S3 object buckets, you protect your database memory and ensure your data architecture is highly performant and cost-effective.

## Access Authorization and Secret Delivery

Access control governs what API actions your compute tasks are allowed to perform, while secrets management protects sensitive configuration keys.

AWS Identity and Access Management (IAM) enforces a default-deny gate. Every AWS API call must be explicitly authorized. For compute tasks, we assign a dedicated, low-privilege IAM Task Role that allows only the specific actions required:

* `s3:PutObject` on the exports bucket.
* `secretsmanager:GetSecretValue` on the database secret.

This locked-down configuration reduces credential blast radius. Instead of hardcoding access keys into Docker images, the ECS runtime exposes temporary task-role credentials to the container, and the AWS SDK uses those credentials to sign service API calls.

AWS Secrets Manager vaults sensitive database connection strings. ECS can fetch a referenced secret at task startup and place the value into an environment variable, or the application can call Secrets Manager at runtime and cache the value in process memory. If a startup-injected secret is rotated, running containers continue using the old value until the ECS service launches fresh tasks.

## Signals: Observability Pipelines and Logs

Signals are the durable operational evidence that tells you what your application experienced. Because cloud compute containers are ephemeral and can be destroyed at any moment, all evidence must exit the compute host immediately:

* **CloudWatch Logs**: Collects stdout and stderr streams from compute tasks, routing them to persistent log groups. If a container crashes, its trace history remains readable in CloudWatch.
* **CloudWatch Metrics**: Aggregates numeric trends over time, such as CPU consumption, memory leaks, database connection spikes, and ALB 5xx error rates.
* **CloudWatch Alarms**: Triggers automated alerts (such as paged notifications or auto-scaling rules) when a metric crosses a defined threshold.
* **CloudTrail**: Records management API events across the AWS account and can be configured for selected data events, helping prove who created a bucket, modified an IAM role, or deleted a database.

Observability is not a passive logging configuration. It is an active diagnostic practice. By setting up CloudWatch Alarms for target group health and routing those signals to your team, you resolve failures before users notice a service outage.

## Operations: Image Registries, Budgets, and Backups

Release operations, cost tracking, and disaster recovery are essential lifecycle controls that keep cloud systems manageable over time:

* **Amazon ECR**: The private Docker image registry where your deployment pipelines push compiled container images before updating ECS task definitions.
* **AWS Budgets**: Tracks monthly billing allocations and triggers automated alerts when actual or forecasted cloud costs cross a defined spending limit.
* **Cost Explorer**: Provides detailed visual charts of your monthly spend, allowing you to group costs by services, environments, or custom metadata tags.
* **AWS Backup**: Automates and centralizes backup policies across RDS databases, S3 objects, and EBS disks, enforcing retention limits.

Applying metadata tags (like `Application=orders`) to these operational services ensures that you can filter cost reports and group recovery pipelines by workload.

## A Systematic Request Path Diagnostic Walkthrough

When an incident occurs, use the core services map to trace the path of the failure. Avoid guessing or editing random configurations; follow the request from entry to storage:

* **Symptom**: Customers receive a 502 Bad Gateway or 503 Service Unavailable error when checking out.
* **Step 1: Traffic Check**: Inspect the Application Load Balancer target group screen. Are the backend tasks registered, or are target health checks failing?
  * *Evidence*: If 0 targets are healthy, the load balancer cannot route traffic. Proceed to the Compute family.
* **Step 2: Compute Check**: Search the ECS service console. Are tasks actively running, or is the service stuck in a crash loop?
  * *Evidence*: If tasks are boot-looping, check the CloudWatch Logs group for the compute task.
* **Step 3: Signal Check**: Read the container stdout trace logs inside `/aws/ecs/orders-api`.
  * *Evidence*: The logs state `Connection refused on orders-prod.cluster-a1b2c3d4e5f6.eu-west-2.rds.amazonaws.com`. The app cannot reach its database. Proceed to the State and Access families.
* **Step 4: Access and State Check**: Inspect Secrets Manager. Was the database connection URL rotated recently? Verify the ECS task IAM role can assume permissions.
  * *Evidence*: The secret was rotated, but the running ECS tasks were not restarted to pull the new value.
* **Resolution**: Execute an ECS service update with force new deployment to spin up fresh containers with the current secret injected.

This systematic trace stops you from wasting hours debugging the DNS configuration when the actual failure lies inside a rotated database secret.

![An infographic showing a 502 incident traced through traffic health, ECS compute, CloudWatch logs, and state plus access checks before redeploying tasks](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/request-diagnostic-trace.png)

*Trace incidents along the request path instead of guessing. A 502 may start at traffic, but the evidence can lead through compute logs to a stale secret or state connection issue.*

## Putting It All Together

The AWS core services map organizes a massive catalog of services into a cohesive, cooperative system.

Instead of searching for floating product names, professional cloud engineers translate application needs into functional families that work together to run the workload:

* Private network foundations start at the VPC, which isolates resources into public entry tiers, private application subnets, and isolated data subnets.
* Public Route 53 DNS records point traffic to an Application Load Balancer, which checks target group health before forwarding packets to the app.
* Compute runs as ECS Fargate tasks, pulling Docker images from ECR and receiving or retrieving connection secrets through Secrets Manager with IAM roles.
* State is divided intentionally: transactional ledgers reside in RDS tables, while unstructured files are written to S3 buckets.
* Ephemeral runtimes export their diagnostic evidence to CloudWatch Logs, metrics, and alarms, while CloudTrail records control-plane changes.
* Budgets, Cost Explorer, and AWS Backup protect the business lifecycle from spending surprises and data loss.

By following this functional map and tracing failures along the request path, you replace random console clicks with deliberate, structured diagnostics.

![A six-part summary infographic for the AWS core services map covering traffic entry, VPC tier separation, compute tasks, persistent state, IAM and secrets, and operational signals](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-services-summary.png)

*Use this as the short service map checklist: traffic enters through DNS and load balancing, the VPC separates tiers, compute runs tasks, state persists outside compute, IAM and secrets protect access, and signals guide operations.*

---

**References**

- [Amazon Route 53 Documentation](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html) - Official guide on domain registration, DNS routing, and global health checks.
- [Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) - Guide on ALB listeners, target groups, routing rules, and HTTP health check targets.
- [Amazon ECS on Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html) - Introduction to serverless container execution, task definition blueprints, and service scheduling.
- [Amazon RDS Postgres Engine Guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html) - Documentation on provisioning relational databases, Multi-AZ backups, and engine settings.
- [Amazon S3 Buckets Overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingBucket.html) - Guide on S3 bucket structure, global name requirements, and object key structures.
- [AWS Secrets Manager Integration](https://docs.aws.amazon.com/secretsmanager/latest/userguide/integration.html) - Guide on securely vaulting credentials and dynamically injecting secrets into ECS runtimes.
- [Amazon CloudWatch Logs Overview](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html) - Documentation on centralized logging, agent setups, and log stream retentions.
- [Regional NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html) - Documents regional NAT mode and how it differs from zonal NAT gateways.
