---
title: "AWS Core Services by Job"
description: "Core AWS service families mapped to traffic, compute, network boundaries, data, access, signals, cost, and recovery."
overview: "A first AWS app needs a clear job for each service. This article starts with a small localhost app, then maps the same app to common AWS services before later articles handle service-specific configuration."
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

1. [Start With the Local App](#start-with-the-local-app)
2. [Compute: Where the Code Runs](#compute-where-the-code-runs)
3. [Traffic: How Users Reach the App](#traffic-how-users-reach-the-app)
4. [Network Boundaries: What Stays Private](#network-boundaries-what-stays-private)
5. [State: Rows, Files, and Background Work](#state-rows-files-and-background-work)
6. [Access and Secrets: How Services Trust Each Other](#access-and-secrets-how-services-trust-each-other)
7. [Signals: What the System Tells You](#signals-what-the-system-tells-you)
8. [Cost and Recovery: Owning the App After Launch](#cost-and-recovery-owning-the-app-after-launch)
9. [A First Debugging Path](#a-first-debugging-path)
10. [What's Next](#whats-next)
11. [References](#references)

## Start With the Local App
<!-- section-summary: AWS service names map cleanly to jobs your local app already has. -->

Picture a small app running on your laptop. It is called `northstar-photos`, and it lets users create a profile, upload an avatar, and browse a simple gallery. During development, the whole thing may fit into one terminal window: `npm run dev`, a local Postgres database, an `uploads/` folder, and a browser tab at `http://localhost:3000`.

That local setup hides many jobs inside one machine. The web process receives requests. The database stores rows. The folder stores files. Your shell has credentials. The terminal prints logs. Your laptop network decides who can connect. One person owns all the pieces, and the app has no real production traffic yet.

AWS splits those jobs apart because production adds pressure. Users need a stable public address. The app needs a place to run after your laptop closes. The database needs backups. Uploaded files need durable storage. The app needs permission to call AWS services without a secret key pasted into code. Operators need logs, metrics, cost alerts, and a restore plan.

This article uses one question all the way through: **which job does this AWS service perform for the app?** That question keeps the first AWS map readable. A beginner can understand the shape of a production app before memorizing every service name.

| App job | Local version | Common AWS service family |
|---|---|---|
| Run code | A process on your laptop | EC2, ECS with Fargate, Lambda |
| Receive public traffic | `localhost:3000` | Route 53, Certificate Manager, Application Load Balancer |
| Keep boundaries | Home network and one machine | VPC, subnets, route tables, security groups |
| Store rows | Local Postgres or SQLite | RDS, DynamoDB |
| Store files | `uploads/` folder | S3 |
| Send background work | In-process jobs or a local worker | SQS, EventBridge, Lambda, ECS workers |
| Grant access | Local credentials | IAM roles and policies |
| Store secrets | `.env` file | Secrets Manager, SSM Parameter Store |
| Watch behavior | Terminal output | CloudWatch, CloudTrail, X-Ray, OpenTelemetry |
| Control spend and restore data | Notes and manual checks | Cost Explorer, Budgets, AWS Backup, service backups |

The rest of this article walks through those jobs in the order a request usually touches them. We start with the code, then add the public door, then protect the private parts, then give the app data, permissions, signals, and recovery.

## Compute: Where the Code Runs
<!-- section-summary: Compute services provide CPU, memory, storage, and network access for application code. -->

The first production question for `northstar-photos` is simple: where does the web process run? On your laptop, the process uses your CPU and memory. In AWS, **compute** means the service family that gives your code CPU, memory, storage, and network placement inside an AWS account.

**Amazon EC2** gives you virtual servers. You choose a machine image, pick an instance type, install packages, run your app, patch the operating system, and decide how the process restarts after failure. EC2 works well when a team wants server-level control, needs special software on the host, or runs workloads that fit a traditional server operations style.

**Amazon ECS** runs containers. A container packages the app and its runtime dependencies into an image, then ECS starts copies of that image as tasks. With **AWS Fargate**, AWS provides the server capacity behind those tasks, so the team focuses on the image, CPU and memory size, networking, ports, permissions, and logs.

**AWS Lambda** runs a function for a specific event. It fits bounded work such as resizing an image after upload, reacting to an S3 event, processing a queue message, or running a small API handler. A long-running web app can run on Lambda through specific patterns, but a normal server process or container service often gives beginners a clearer starting point.

For the first production version of `northstar-photos`, the team might choose ECS with Fargate because the app already builds a Docker image and listens on port `3000`. A later ECS article can walk through the real task definition, service, cluster, deployment circuit breaker, health checks, and capacity options. Here, the useful level of detail is the planning shape.

```yaml
app: northstar-photos
runtime: ECS service on Fargate
image: northstar/photos:2026-06-24.1
container_port: 3000
cpu: 0.5 vCPU
memory: 1 GB
copies: 2
logs: CloudWatch Logs group for the web service
```

This sketch belongs in the first article because it shows the decisions every compute option must answer. `runtime` names where the code runs. `image` names the deployable artifact. `container_port` tells the traffic layer where the app listens. `cpu`, `memory`, and `copies` describe the amount of work the app can handle. `logs` tells the team where the process output goes after the laptop terminal disappears.

The same job could use EC2 or Lambda in a different app. A legacy app that needs direct host access may start on EC2. A thumbnail generator may run as Lambda. A containerized web app with several long-running copies often starts on ECS with Fargate. The service choice changes, but the compute job stays the same: **run the code in a controlled place**.

## Traffic: How Users Reach the App
<!-- section-summary: Traffic services give users a stable name, encrypted connection, and healthy route into compute. -->

Once the app runs in AWS, users still need a stable way to reach it. A single task or server can receive traffic, but its private IP can change during deployment, scaling, or replacement. Production traffic needs a public name, HTTPS, and a routing layer that sends requests only to healthy app copies.

**Amazon Route 53** handles DNS. DNS maps a name such as `photos.example.com` to the AWS entry point for the app. For a beginner, DNS is the public address book: the browser asks where `photos.example.com` lives, and Route 53 answers with the target AWS should use.

**AWS Certificate Manager**, often shortened to ACM, manages TLS certificates for supported AWS services. TLS is the security layer behind HTTPS. The certificate proves the site identity to the browser and helps encrypt traffic between the user and the AWS entry point.

**Elastic Load Balancing** receives user traffic and spreads it across healthy targets. For a normal HTTP app, an **Application Load Balancer** is a common choice. It listens on ports such as `443`, checks a path such as `/health`, and forwards requests to the app copies that pass the health check.

For `northstar-photos`, the public path might look like this:

| Step | Service job | Example |
|---|---|---|
| Public name | Give users one stable address | Route 53 record for `photos.example.com` |
| HTTPS | Protect browser traffic | ACM certificate for `photos.example.com` |
| Routing | Receive requests and choose targets | Application Load Balancer listener on `443` |
| Health check | Avoid broken app copies | Target group calls `/health` |
| Runtime target | Serve the request | ECS tasks listening on port `3000` |

The health check matters because deployment constantly changes compute underneath the public address. One ECS task can stop and another can start with a different private IP. Users keep using the same domain name while the load balancer updates its target list behind the scenes.

A useful first `/health` endpoint proves the app process can answer a simple request. As the app grows, teams often separate a lightweight liveness check from a readiness check that confirms required dependencies such as database connectivity or critical configuration. The load balancer should get a fast and reliable answer, because that answer controls whether real user traffic reaches the target.

![The request path shows how DNS, HTTPS entry, load balancing, private compute, data storage, IAM, and logs cooperate for one small production app](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-service-request-path.png)

*The request path shows how DNS, HTTPS entry, load balancing, private compute, data storage, IAM, and logs cooperate for one small production app.*


## Network Boundaries: What Stays Private
<!-- section-summary: VPC, subnets, routing, and security groups let public traffic reach the app while databases stay private. -->

Traffic gives the app a public door. The next job is deciding which parts should stay behind that door. Users need to reach the load balancer from the internet, while the database should only accept traffic from the app layer. AWS uses **Amazon VPC** for this private network boundary.

A **VPC** is a private network space inside an AWS Region. It has an IP range, subnets, route tables, gateways, and security controls. A **subnet** is a smaller IP range inside one Availability Zone. Public subnets usually hold resources that need a route to the internet, such as a load balancer. Private subnets usually hold application tasks, servers, databases, caches, and workers.

For a beginner production layout, `northstar-photos` might use two public subnets and two private application subnets across two Availability Zones. The load balancer sits in the public subnets. The ECS tasks sit in private application subnets. The database sits in private database subnets. This layout lets the public internet reach the load balancer while the database only receives traffic from approved internal callers.

| Layer | Placement | Main inbound rule |
|---|---|---|
| Application Load Balancer | Public subnets in two Availability Zones | Internet to HTTPS `443` |
| Web app tasks | Private application subnets | Load balancer security group to app port `3000` |
| RDS database | Private database subnets | App security group to database port `5432` |
| S3 bucket | Regional service outside your subnets | IAM permission, optionally private VPC endpoint access |

**Security groups** act like virtual firewalls attached to load balancers, instances, tasks, and databases. Strong rules name the layer that should talk instead of a broad internet range. For example, the database security group can allow inbound PostgreSQL on port `5432` from the app security group. New tasks can come and go, but the rule still follows the app layer.

Route tables and gateways decide where network traffic can go. A public subnet usually has a route to an internet gateway. A private subnet may use a NAT gateway for outbound internet access or a VPC endpoint for private access to services such as S3. Those choices affect security, cost, and troubleshooting, so network design gets its own deeper articles later in the roadmap.

## State: Rows, Files, and Background Work
<!-- section-summary: Data services split relational rows, object files, and asynchronous work into services designed for each access pattern. -->

The local app used a database and an `uploads/` folder. Production keeps the same ideas, but the storage jobs need clearer ownership. **State** means data the app must keep after a request finishes, after a process restarts, or after a deployment replaces every running copy.

**Amazon RDS** manages relational databases such as PostgreSQL and MySQL. Relational data works well for users, profiles, permissions, billing records, audit events, and other records where the app needs transactions, constraints, joins, and SQL queries. For `northstar-photos`, RDS can store users, gallery records, upload metadata, and references to the files stored elsewhere.

**Amazon DynamoDB** manages key-value and document-style tables. It fits access patterns where the app can ask direct questions such as "give me the profile summary for this user ID" or "give me the upload job status for this job ID." DynamoDB can scale very far, but the table design depends heavily on the exact reads and writes the app needs.

**Amazon S3** stores objects such as images, exports, logs, backups, reports, and static assets. S3 uses buckets and object keys rather than folders on a disk. The app might upload `profiles/user-123/avatar.png` to a private bucket, then store that key in an RDS row with the owning user ID and content type.

**Amazon SQS** and **Amazon EventBridge** help with work that should happen outside the user request. When a user uploads an avatar, the web app can store the original file, create a database row, and send a message for a worker to resize the image. The user request can finish quickly while background compute handles slower processing.

| Need | Good first AWS fit | What the app stores or sends |
|---|---|---|
| User records and gallery metadata | RDS PostgreSQL | Rows with user IDs, file keys, timestamps, and status |
| Uploaded images | S3 | Private objects such as `profiles/user-123/avatar.png` |
| Fast lookup by one key | DynamoDB | Profile summaries, idempotency keys, job status |
| Background processing | SQS plus Lambda or ECS worker | "Resize this uploaded image" messages |

The important beginner detail is that S3 object storage and database rows usually work together. The database should store the facts the app queries, while S3 stores the larger file content. If the database says an image exists, the restore plan should prove the S3 object still exists too.

## Access and Secrets: How Services Trust Each Other
<!-- section-summary: IAM roles and secrets services let the app call AWS APIs without permanent keys in code. -->

The app now runs, receives traffic, sits in private subnets, and stores data. It still needs permission to call AWS services. During local development, a `.env` file or AWS CLI profile may feel enough. In production, hardcoded keys create a long-lived secret that can leak through logs, images, tickets, screenshots, or source control.

**AWS IAM** answers who is calling AWS and what that caller can do. An **IAM role** is an AWS identity that can receive temporary credentials. For application code, that means an ECS task, EC2 instance, or Lambda function can call AWS APIs without storing a permanent access key in the application.

For `northstar-photos`, the web app role might have permission to read and write objects under `s3://northstar-photos-prod/profiles/`, read one database secret, and write logs. It should have no permission to delete unrelated buckets, change IAM policies, or read every secret in the account. That is the start of **least privilege**, which means each identity gets only the permissions needed for its job.

**AWS Secrets Manager** and **AWS Systems Manager Parameter Store** store sensitive configuration such as database passwords, API tokens, and signing keys. Secrets Manager adds managed rotation features and metadata that help teams review changes. Parameter Store can work well for simpler configuration values and some secret use cases. The main idea is the same: the app fetches sensitive values through its role instead of carrying them in source code.

For ECS, beginners often see two role names and wonder why both exist. The **task execution role** lets ECS pull the container image and send logs for the platform work around the task. The **task role** is the identity the application code uses inside the running container. Keeping those jobs separate helps reviewers see which permissions belong to the platform and which belong to the app.

Access design also connects to the data design from the previous section. A private S3 bucket can stay private while the application checks the user and then creates a short-lived pre-signed URL for one object. The user receives time-limited access to the specific file, while the bucket stays private by default.

![The role boundary shows why the app should receive narrow runtime permissions instead of long-lived keys or broad account access](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/task-role-boundary.png)

*The role boundary shows why the app should receive narrow runtime permissions instead of long-lived keys or broad account access.*


## Signals: What the System Tells You
<!-- section-summary: Logs, metrics, traces, and audit events show runtime behavior and AWS control-plane changes. -->

After launch, the team needs evidence. A local terminal gave one stream of logs. A production system has many moving parts, so the signals need structure. **Observability** is the practice of collecting useful evidence from the app and platform so the team can understand behavior during normal operation and incidents.

**Amazon CloudWatch** collects logs, metrics, alarms, and dashboards. Logs explain individual events, such as a request failing with `AccessDenied`. Metrics explain patterns, such as rising latency, CPU, memory, 5xx responses, database connections, or queue depth. Alarms watch selected metrics and notify the team when a threshold or anomaly needs attention.

**AWS CloudTrail** records AWS API activity. If someone changes a security group, updates an ECS service, edits a bucket policy, rotates a secret, or modifies a database, CloudTrail can show the event, caller, time, source, and request details. CloudWatch helps explain what the workload experienced. CloudTrail helps explain what changed in AWS.

**Traces** show the path of one request through multiple services. AWS X-Ray and OpenTelemetry can connect a browser request to the app, then to RDS, S3, a queue, or another service. Many teams use OpenTelemetry instrumentation because it is an open standard and can send data to AWS tools or third-party observability platforms.

A useful first dashboard for `northstar-photos` groups signals by job:

| Job | First signals to watch | Why the team cares |
|---|---|---|
| Traffic | ALB request count, target 5xx count, target response time | Shows whether users reach healthy targets |
| Compute | Running task count, CPU, memory, restarts | Shows whether the app has enough runtime capacity |
| Data | RDS connections, CPU, storage, slow queries | Shows whether database pressure affects requests |
| Files | S3 errors, object count, bucket size | Shows whether uploads and storage trends look normal |
| Background work | Queue depth, oldest message age, worker errors | Shows whether async work keeps up |
| Changes | CloudTrail deployment, policy, network, and secret events | Shows what changed before symptoms appeared |

The app should also write structured logs. A useful log event includes a timestamp, request ID, route or operation name, safe user identifier, status code, duration, and error code. This gives responders a way to connect a user report, a load balancer metric, an app log, and a database symptom without guessing.

## Cost and Recovery: Owning the App After Launch
<!-- section-summary: Cost and recovery services help teams keep the app affordable, tagged, backed up, and restorable. -->

The first successful deployment creates two quiet responsibilities. The team needs to know what the app costs, and the team needs to know how to recover important data. These jobs matter early because cost and recovery plans are much cheaper to set up before the incident or surprise bill.

**AWS Cost Explorer** helps analyze spend by service, account, Region, usage type, and tags. **AWS Budgets** sends alerts when cost or usage crosses a threshold. For `northstar-photos`, a first production budget might track the whole workload, and a second budget might watch a noisy area such as NAT Gateway data processing, CloudWatch Logs ingestion, or RDS storage.

Tags make cost ownership possible. A simple tag set such as `Service=northstar-photos`, `Environment=prod`, and `Owner=platform-learning` lets Cost Explorer and reports group spend by workload. Without tags, a monthly bill can turn into a service-name puzzle with no clear owner.

Recovery starts with the data map. RDS can use automated backups, snapshots, and point-in-time recovery. S3 can use versioning, lifecycle rules, replication, and retention controls where the workload needs them. AWS Backup can centralize backup policy and reporting for supported services. The feature name matters less than the proof that the app can restore the data users care about.

A practical restore test for `northstar-photos` might restore an RDS snapshot into a non-production environment, start the app against that restored database, open a sample profile, and confirm the S3 object keys referenced by the database still point to real objects. That test connects database backup, object storage, app configuration, and access permissions into one user-visible result.

Cost and recovery also shape service choices. A NAT gateway can solve outbound access for private subnets, but it can create surprise data processing costs. Detailed logs help operations, but unlimited retention can grow the bill. Multi-AZ databases improve availability, but they cost more than a single instance. A real team writes these choices down so future responders understand the tradeoffs.

## A First Debugging Path
<!-- section-summary: A beginner troubleshooting path follows the failing job from traffic to compute, data, permissions, and signals. -->

Now the service map can do useful work. Imagine users report that avatar uploads fail. The app still loads, sign-in works, and existing gallery images show up, but new uploads return an error. A beginner might jump straight to S3 because uploads involve files. A steadier path follows the jobs in order and lets the evidence move the investigation.

| Check | Evidence | What it means |
|---|---|---|
| Traffic | The load balancer shows healthy targets and normal request count | Users can reach the app, so the public door is probably working |
| Compute | The app tasks are running and CPU/memory look normal | The web process is alive, so the failure may sit deeper in the request |
| Logs | CloudWatch Logs show `AccessDenied` during `PutObject` | The app reached AWS, but the call lacked permission |
| Access | The app role allows `s3:PutObject` under `profile/*` | The policy names the wrong prefix for current uploads |
| Data | New code writes to `profiles/2026/06/` | The app and policy disagree about the object path |
| Change history | CloudTrail shows a deployment shortly before the errors | The new image introduced the changed object prefix |
| Fix evidence | Policy updated in IaC, app redeployed, upload succeeds, logs stay clean | The team confirmed the failing job and the recovery signal |

This walkthrough uses evidence rather than a long command sequence. In real work, a responder may use the AWS Console, CLI, dashboards, logs queries, IaC diffs, deployment records, and CloudTrail events. The important habit is to name the job that is failing before changing resources.

Notice how the service names connect instead of floating around as trivia. Route 53 and the load balancer handled the public path. ECS or EC2 ran the code. S3 stored the object. IAM allowed or denied the call. CloudWatch showed the runtime error. CloudTrail explained the recent AWS change. The article did its job if those names now have a place in the request path.

![The summary groups core AWS services by the job they do so a beginner can choose the next evidence layer during an incident](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-services-summary.png)

*The summary groups core AWS services by the job they do so a beginner can choose the next evidence layer during an incident.*


## What's Next
<!-- section-summary: The next articles zoom into the service families one layer at a time. -->

You now have the first AWS service map for a small production app. The goal was to know what job each service family performs and where it appears in a request path, so later service details have a place to land.

The next AWS articles can go deeper one layer at a time. Networking can explain VPCs, subnets, routes, NAT, endpoints, and security groups. Compute can expand the ECS planning sketch into real services and task definitions. Identity can unpack IAM roles, policies, and temporary credentials. Storage and operations can turn the first S3, RDS, CloudWatch, cost, and recovery ideas into working production patterns.

## References

- [What is Amazon EC2?](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)
- [What is Amazon Elastic Container Service?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
- [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [What is Amazon Route 53?](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html)
- [What is AWS Certificate Manager?](https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html)
- [What is an Application Load Balancer?](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [What is Amazon Relational Database Service?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
- [What is Amazon CloudWatch?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [What is AWS CloudTrail?](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html)
- [Analyzing your costs and usage with AWS Cost Explorer](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [What is AWS Backup?](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
