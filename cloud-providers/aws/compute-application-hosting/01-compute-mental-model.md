---
title: "AWS Compute Foundation"
description: "Choose where application code runs in AWS by matching EC2, ECS with Fargate, Lambda, and EKS to the workload shape and team ownership model."
overview: "Compute is where your application code gets CPU, memory, network access, startup behavior, scaling behavior, and runtime evidence. This article builds the foundation for choosing between server-shaped, container-shaped, event-shaped, and Kubernetes-shaped compute."
tags: ["compute", "ec2", "ecs", "fargate", "lambda", "aws"]
order: 1
id: article-cloud-providers-aws-compute-application-hosting-compute-mental-model
aliases:
  - compute-mental-model
  - choosing-ec2-ecs-or-lambda
  - article-cloud-providers-aws-compute-application-hosting-choosing-ec2-ecs-lambda
  - cloud-providers/aws/compute-application-hosting/choosing-ec2-ecs-or-lambda.md
---

## Table of Contents

1. [From Localhost to AWS Compute](#from-localhost-to-aws-compute)
2. [The Runtime Checklist](#the-runtime-checklist)
3. [EC2 for Server-Shaped Work](#ec2-for-server-shaped-work)
4. [ECS and Fargate for Container-Shaped Work](#ecs-and-fargate-for-container-shaped-work)
5. [Lambda for Event-Shaped Work](#lambda-for-event-shaped-work)
6. [EKS for Kubernetes-Shaped Work](#eks-for-kubernetes-shaped-work)
7. [Choosing With the Workload in Front of You](#choosing-with-the-workload-in-front-of-you)
8. [References](#references)

## From Localhost to AWS Compute
<!-- section-summary: AWS compute starts with the simple need to run application code with CPU, memory, network access, credentials, and operational evidence. -->

Start with a small service on your laptop. Maybe it is a Node.js API called `orders-api`. It listens on port `3000`, reads a database URL, writes logs, and calls S3 after an order is created. On localhost, the command might look like this:

```bash
PORT=3000 DATABASE_URL=postgres://localhost/orders npm start
```

`PORT=3000` tells the app which network port to listen on. `DATABASE_URL` tells it where the database lives. `npm start` runs the start script from the application package. Your laptop quietly supplies the operating system, CPU, memory, filesystem, network, process lifetime, and your local credentials.

AWS compute gives the same application a real place to run outside your laptop. **Compute** means the runtime that supplies CPU, memory, network access, startup behavior, scaling behavior, permissions, and evidence for operations. The app still has the same basic needs, but those needs now have to be written down clearly enough for AWS and your team to repeat them.

For this module, keep one practical story in mind. `orders-api` begins as a simple web API. Later it needs a background receipt job, container packaging, a few scheduled tasks, and maybe a shared platform for many services. Each AWS compute service answers a different version of the same question: what kind of runtime does this piece of code need?

The four main shapes in this module are:

| Shape | AWS service | Plain-English fit |
|---|---|---|
| **Server-shaped** | EC2 | You want a virtual machine with operating system control. |
| **Container-shaped** | ECS with Fargate | You have a container image and want AWS to run copies of it. |
| **Event-shaped** | Lambda | You want code to run after an event, finish bounded work, and stop. |
| **Kubernetes-shaped** | EKS | Your organization wants Kubernetes APIs and platform tools as the deployment layer. |

The rest of this article keeps the examples small enough to compare the compute shapes. The later articles go deeper into real commands, config files, outputs, and incident paths.

![The compute shape map compares EC2, ECS with Fargate, Lambda, and EKS by the kind of workload each one is meant to run](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-shapes-map.png)

*The compute shape map compares EC2, ECS with Fargate, Lambda, and EKS by the kind of workload each one is meant to run.*


## The Runtime Checklist
<!-- section-summary: Every compute choice has to answer artifact, startup, network, identity, scaling, and evidence questions. -->

Before choosing a service, look at the work your application actually does. A compute service has to know what to run, how to start it, who can reach it, which AWS APIs it can call, how it grows under load, and where operators can see what happened.

Use this checklist for any workload:

| Runtime question | What it means for `orders-api` |
|---|---|
| **Artifact** | Is the release a server package, container image, function bundle, or Kubernetes manifest? |
| **Startup** | Which command starts the app, and how does the runtime know it is ready? |
| **Network path** | Does traffic come from users, a load balancer, a queue, S3, or an internal service? |
| **AWS identity** | Which role lets the code read secrets, write receipts, or publish events? |
| **Scaling signal** | Does the workload scale by request count, CPU, queue depth, event volume, or scheduled work? |
| **Failure evidence** | Where are logs, metrics, deployment events, health checks, and audit records? |

These questions connect the laptop version to the cloud version. On your laptop, the artifact might be the current folder, the startup command is in your terminal, and logs print to your screen. In AWS, those details need a durable home because a replacement server, task, function, or pod should run the same way without a person rebuilding the steps from memory.

The next question is where you want the operating boundary. EC2 gives you the server. ECS and Fargate give you a container runtime. Lambda gives you event-driven execution. EKS gives you Kubernetes as the platform contract.

![The choice review keeps the four compute shapes side by side and ties them to runtime ownership, scaling, deployment, networking, and observability](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-choice-review.png)

*The choice review keeps the four compute shapes side by side and ties them to runtime ownership, scaling, deployment, networking, and observability.*


## EC2 for Server-Shaped Work
<!-- section-summary: EC2 gives familiar virtual servers and leaves the operating system layer in your team's hands. -->

**Amazon EC2** gives you virtual servers. You choose an Amazon Machine Image, an instance type, storage, subnet, security groups, and an IAM role. Then you run your application using normal operating system tools such as `systemd`, Nginx, shell scripts, package managers, and log files.

EC2 fits server-shaped work. A legacy app may need a specific Linux package, a PDF renderer, a host-level monitoring agent, or a license manager that expects a virtual machine. A migration from an existing VM platform can also start on EC2 because the application already understands the server shape.

A lightweight EC2 startup flow for `orders-api` might use `systemd`:

```bash
sudo systemctl start orders-api
sudo systemctl status orders-api
sudo journalctl -u orders-api -n 50
```

`systemctl start orders-api` asks the Linux service manager to run the app now. `systemctl status orders-api` shows whether the service is active, failed, or restarting. `journalctl -u orders-api -n 50` prints the latest 50 log lines for that service, which helps you catch missing environment files, failed database connections, or a process crash during startup.

The value of EC2 is control. The cost of that control is responsibility. Your team owns operating system patches, AMI updates, process supervision, disk cleanup, host access, log shipping, and replacement behavior. A single hand-maintained instance can serve a demo, but a production EC2 service should have a repeatable launch template, an Auto Scaling group, a load balancer, private subnets, instance roles, and a replacement plan.

That operating work leads naturally to containers. If the team wants the application and its runtime dependencies to travel together as one image, ECS and Fargate move the boundary away from individual servers.

## ECS and Fargate for Container-Shaped Work
<!-- section-summary: ECS runs container images as tasks and services, while Fargate supplies the compute capacity without daily server management. -->

**Amazon ECS** runs containers. A **task definition** describes one copy of the workload: the image, CPU, memory, port, environment, secrets, roles, and logs. An **ECS service** keeps a desired number of task copies running. **AWS Fargate** supplies the compute capacity for those tasks, so the team can run containers without managing EC2 container hosts for the first version.

The local version might start like this:

```bash
docker run -p 3000:3000 -e DATABASE_URL=postgres://localhost/orders orders-api:dev
```

`-p 3000:3000` maps port `3000` on the laptop to port `3000` inside the container. `-e DATABASE_URL=...` passes a runtime setting into the container. `orders-api:dev` names the local image. ECS takes the same ideas and turns them into a versioned AWS task definition, service, security group path, IAM roles, and CloudWatch log stream.

For `orders-api`, ECS with Fargate is often a strong first production shape after the app has a clean Docker image. The API can run as three tasks in private subnets. An Application Load Balancer sends requests only to healthy task IPs. The task role gives the app permission to read one database secret and write receipt files to one S3 prefix. CloudWatch Logs receives the container output.

The container shift changes the team conversation. Instead of asking which server has the correct package installed, the team asks which image digest is deployed, which task definition revision is active, how many tasks are desired, how many are running, and whether the load balancer target group sees the task IPs as healthy.

The ECS article goes deep on the full task definition JSON, service counts, target health, logs, roles, deployment rollback, and common rollout failures. This foundation article only needs the big idea: ECS is a good fit when the application package is a container image and the team wants AWS-native operations around that image.

## Lambda for Event-Shaped Work
<!-- section-summary: Lambda runs bounded handlers in response to events and shifts design attention toward retries, idempotency, and concurrency. -->

**AWS Lambda** runs a function handler when an event arrives. The event might come from S3, SQS, EventBridge, API Gateway, DynamoDB Streams, or another source. Lambda creates the runtime environment, invokes your code, records logs, and stops billing for that invocation after the handler finishes or times out.

A small handler might look like this:

```js
export const handler = async (event) => {
  for (const record of event.Records) {
    const key = record.s3.object.key;
    console.log(`Create receipt preview for ${key}`);
  }
};
```

`handler` is the function Lambda calls. `event.Records` is the list of records from this event source. In an S3 notification, each record includes the bucket and object key. The example logs the key only; a real receipt worker would read the object, create the preview, write the result, and return.

Lambda fits bounded work. The receipt preview job begins because an S3 object arrived. A queue consumer begins because an SQS message is ready. A nightly cleanup begins because an EventBridge schedule fired. Each unit of work should have a clear input, a clear output, and a retry plan.

The Lambda shift changes the operating questions. Instead of choosing task count or server size first, you choose memory, timeout, runtime, execution role, trigger, retry behavior, failure destination, and concurrency limit. The platform handles the long-running server layer, but the application has to handle repeated events. If an S3 notification or queue message arrives twice, the function should still leave the system in a correct state.

Lambda is a good partner to the other compute shapes. `orders-api` might run on ECS, while Lambda handles receipt previews, scheduled cleanup, webhook validation, or small event processing jobs. The Lambda article goes deeper into handlers, event samples, execution roles, versions, aliases, metrics, and failure recovery.

## EKS for Kubernetes-Shaped Work
<!-- section-summary: EKS fits teams that want Kubernetes APIs, controllers, and shared platform conventions for many services. -->

**Amazon EKS** is AWS-managed Kubernetes. Kubernetes gives a platform API for Deployments, Services, ConfigMaps, Secrets, Ingress, Jobs, service accounts, policies, and many ecosystem controllers. AWS manages the EKS control plane. Your team still owns worker capacity, add-ons, networking choices, upgrades, observability, and platform guardrails.

A tiny Kubernetes deployment points at the same container image:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/orders-api:2026-06-24
```

`kind: Deployment` tells Kubernetes to keep a set of pods running. `metadata.name` names the object. `replicas: 3` asks for three pod copies. `containers.image` points to the container image. A production manifest needs selectors, labels, resource requests, readiness probes, service accounts, Services, and Ingress or Gateway configuration, which the EKS article covers in detail.

EKS fits an organization-level platform need. One app packaged as a container may run well on ECS, while many teams sharing Kubernetes APIs, Helm charts, GitOps workflows, admission policies, service mesh rules, or custom controllers may make EKS the right platform. In that environment, `orders-api` may be one small service inside a shared platform contract.

EKS also creates a two-tool operating path. Kubernetes explains pod scheduling, image pulls, readiness, restarts, services, and rollout state. AWS explains load balancers, target groups, VPC subnets, IAM roles, node groups, and CloudWatch signals. Responders need to connect both layers during incidents.

That extra platform layer can be powerful. It also needs clear ownership. The EKS article goes deeper into clusters, control planes, workers, manifests, Pod Identity, node operations, add-ons, and the ECS-versus-EKS decision.

## Choosing With the Workload in Front of You
<!-- section-summary: The first compute choice should match how the code runs, what the team can operate, and which failure evidence they can use. -->

A compute choice should start with the workload and the team that will operate it. Ask how the code starts, how long it runs, what triggers it, what network path reaches it, what AWS permissions it needs, how it scales, and what evidence responders can read during an incident.

Use this table as a first review:

| Choose | It usually fits when | Early warning signs |
|---|---|---|
| **EC2** | The app needs server control, custom agents, legacy packages, long-running VM behavior, or a migration path from existing servers. | Hand changes on instances, unclear patching, SSH exposure, root disk pressure, and no tested replacement path. |
| **ECS with Fargate** | The app has a clean container image and needs AWS-native load balancing, IAM roles, logs, and rolling deployments without daily host management. | Weak health checks, missing task role boundaries, oversized or undersized tasks, and no rollback record. |
| **Lambda** | Work starts from events and finishes inside clear time, retry, and idempotency boundaries. | Long-running jobs, database connection pressure, duplicate side effects, and missing failure destinations. |
| **EKS** | The organization needs Kubernetes APIs, GitOps, controllers, policy, service mesh, or one platform contract across many services. | No platform owner, unclear upgrade plan, weak resource requests, and responders who cannot connect Kubernetes and AWS evidence. |

Many production systems use more than one shape. `orders-api` can run on ECS, a legacy PDF worker can stay on EC2 until it is repackaged, receipt previews can use Lambda, and a larger platform team can later move selected services to EKS if Kubernetes standards matter across the organization.

The next four articles take each shape seriously. EC2 gets a server and fleet operating path. ECS and Fargate get a full task definition, service, roles, logs, and load balancer checks. Lambda gets event samples, configuration, retries, aliases, and monitoring. EKS gets Kubernetes manifests, cluster operations, Pod Identity, and mixed AWS/Kubernetes debugging.

![The checklist summary turns compute choice into review questions about runtime owner, scaling, deployment, network placement, and observability](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-checklist-summary.png)

*The checklist summary turns compute choice into review questions about runtime owner, scaling, deployment, network placement, and observability.*


## References

- [Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)
- [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [Amazon ECS task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [Best practices for working with AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
