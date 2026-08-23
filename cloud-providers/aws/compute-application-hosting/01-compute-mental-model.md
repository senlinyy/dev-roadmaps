---
title: "AWS Compute Foundation"
description: "Choose among EC2, ECS and Fargate, Lambda, and EKS by matching the workload's natural deployment unit and responsibility boundary."
overview: "Every application ultimately needs CPU, memory, networking, identity, scaling, and recovery. AWS compute services differ in whether you deploy a machine, container, invocation, or Kubernetes workload and in how much of the machinery remains visible to your team."
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

1. [What Does Every Application Need to Run?](#what-does-every-application-need-to-run)
2. [Which Workload Shape Are You Deploying?](#which-workload-shape-are-you-deploying)
3. [When Is EC2 the Right Shape?](#when-is-ec2-the-right-shape)
4. [How Do ECS and Fargate Divide the Container Job?](#how-do-ecs-and-fargate-divide-the-container-job)
5. [When Is EKS the Right Shape?](#when-is-eks-the-right-shape)
6. [How Do Control and Responsibility Move Together?](#how-do-control-and-responsibility-move-together)
7. [How Do You Choose With the Workload in Front of You?](#how-do-you-choose-with-the-workload-in-front-of-you)
8. [Why Is the Production Runtime Bigger Than Compute?](#why-is-the-production-runtime-bigger-than-compute)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

At the lowest level, every application has the same physical requirement:

> Its instructions must execute on a CPU, use memory, and communicate with other systems.

The cloud does not remove servers from reality. It changes which server decisions your team must make and which AWS makes on your behalf.

Three first-principles questions explain most AWS compute choices:

1. **What unit do you deploy?**
2. **Who decides where and when it runs?**
3. **Who operates the machine underneath it?**

EC2, ECS with Fargate, Lambda, and EKS draw their responsibility boundaries in different places. These three questions make those boundaries visible before any service comparison begins.

The sections below answer these questions in order:

1. **What Does Every Application Need to Run?**
2. **Which Workload Shape Are You Deploying?**
3. **When Is EC2 the Right Shape?**
4. **How Do ECS and Fargate Divide the Container Job?**
5. **When Is EKS the Right Shape?**
6. **How Do Control and Responsibility Move Together?**
7. **How Do You Choose With the Workload in Front of You?**
8. **Why Is the Production Runtime Bigger Than Compute?**

## What Does Every Application Need to Run?
<!-- section-summary: Application code needs a runtime, operating system, CPU, memory, networking, identity, observability, scaling, and recovery even when AWS hides some layers. -->

Consider a simple function:

```python
def checkout(order):
    charge_card(order)
    create_shipment(order)
```

The code cannot execute in isolation. Somewhere below it is a stack:

```text
application code
        ↓
language runtime and libraries
        ↓
operating system
        ↓
CPU and memory
        ↓
physical machine
```

A production workload also needs network paths to users, databases, queues, and APIs; an identity for AWS calls; logs and metrics; capacity that changes with demand; and recovery when one execution environment fails.

```text
users or events → workload → databases and APIs
                     │
                     ├─ CPU and memory
                     ├─ networking and identity
                     ├─ logs, metrics, and traces
                     └─ scaling and recovery
```

Choosing compute therefore means deciding which layers your team operates and which layers AWS operates.

![The compute shape map compares EC2, ECS with Fargate, Lambda, and EKS by the kind of workload each one is meant to run](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-shapes-map.png)

*Every compute option eventually reaches CPU and memory; the difference is which layers remain part of your operational interface.*

This is a responsibility-boundary decision, not a contest between different kinds of CPUs.

## Which Workload Shape Are You Deploying?
<!-- section-summary: The natural deployment unit—machine, container, invocation, or Kubernetes workload—provides the first strong signal toward a compute service. -->

Start with the workload shape instead of asking which AWS service is best.

| Workload shape | Natural deployment unit | Strong initial signal |
|---|---|---|
| Server-shaped | Machine | EC2 |
| Container-shaped | Container or ECS task | ECS and possibly Fargate |
| Event-shaped | Invocation | Lambda |
| Kubernetes-shaped | Pod and Kubernetes workload objects | EKS |

The names describe what matters to the application and organization.

For **server-shaped work**, the host's OS, filesystem, kernel, agents, drivers, or long-lived identity is part of the requirement.

For **container-shaped work**, the useful statement is, "Run this packaged process with these CPU, memory, port, environment, and IAM settings." The particular VM should be replaceable and unimportant.

For **event-shaped work**, an event arrives, bounded computation runs, and the invocation finishes. The architecture does not require a continuously running service just to wait.

For **Kubernetes-shaped work**, the organization deliberately wants the Kubernetes API, controllers, workload objects, policies, operators, and ecosystem as its platform contract.

The mapping is not absolute. An image processor can be built on any of the four. The workload shape reveals the operating model each version chooses.

## When Is EC2 the Right Shape?
<!-- section-summary: EC2 provides a virtual machine whose guest OS and application environment remain under customer control. -->

Amazon EC2 is the abstraction closest to receiving a computer in a data centre. You select CPU and memory through an instance type, an Amazon Machine Image for the operating system, networking, storage, and other configuration. AWS provides a virtual server.

The responsibility stack is:

```text
application                 → you
runtime and libraries       → you
guest operating system      → you
virtual machine boundary
hypervisor and physical host→ AWS
```

With ordinary EC2, your team patches and secures the guest OS, installs application software, manages processes, and owns much of the instance configuration.

That control is valuable when the machine matters. A workload may depend on:

```text
/opt/company/software
systemd
specific kernel configuration
special networking software
GPU drivers
particular filesystem layout
host-bound licensed software
```

A traditional application migrated from an existing server platform may also fit EC2 because its assumptions are already server-shaped.

The operational surface follows from the same control:

```text
OS patching
runtime installation
process management
capacity planning
instance replacement
scaling
deployment
```

AWS removes physical-server procurement and hypervisor operations. It does not remove server administration inside the guest.

The EC2 trade-off is:

> Maximum infrastructure control in exchange for maximum infrastructure responsibility among these options.

Use EC2 when that control solves a real requirement, not merely because a VM feels familiar.

## How Do ECS and Fargate Divide the Container Job?
<!-- section-summary: ECS schedules and maintains container workloads, while Fargate supplies underlying capacity without exposing an EC2 host fleet to the customer. -->

Sometimes the machine does not matter. The application only needs its code, language runtime, libraries, and system dependencies.

A container image packages those parts together. Instead of assigning an app to `web-01` and installing packages by hand, you say, "Here is the image; run three copies."

```dockerfile
FROM python:3.13

COPY . /app
RUN pip install -r /app/requirements.txt

CMD ["python", "/app/server.py"]
```

The abstraction moves from machine to container:

```text
packaging → container image
scheduling and desired state → orchestrator
physical capacity → compute underneath the orchestrator
```

ECS and Fargate solve different parts.

**Amazon ECS** answers, "How should these containers be scheduled and maintained?" Its central ideas include task definitions, tasks, services, and clusters. A task can run and finish; a service maintains a long-running desired count.

A task definition might say:

```text
image: checkout:v17
CPU: 1 vCPU
memory: 2 GB
port: 8080
environment and secrets
task IAM role
```

The ECS scheduler places tasks on available compute.

**AWS Fargate** answers, "Who supplies and operates that capacity?" With ECS on customer-managed EC2, your team maintains enough instances for the scheduler. Container scaling and fleet scaling must work together:

```text
demand rises → need more tasks → need enough EC2 capacity
            → add instances if required → place tasks
```

With Fargate, you specify task CPU, memory, networking, and IAM configuration. AWS provisions underlying capacity, so you do not create and manage an EC2 container fleet.

```text
ECS on EC2:
app → container → ECS → your EC2 fleet → AWS hardware

ECS with Fargate:
app → container → ECS → Fargate capacity → AWS infrastructure
```

This is why "serverless containers" is useful shorthand for Fargate. Servers still exist, but they are not part of your operational interface.

ECS capacity can also come from managed instance options and customer-managed Auto Scaling groups. Capacity providers are the modern mechanism for describing how ECS uses those sources.

Container-shaped workloads include APIs, workers, consumers, web services, scheduled jobs, batch processes, and microservices. The strong signal is that you care about image, CPU, memory, ports, variables, IAM, and replica count, but not hostname, SSH, manual package installation, or OS patching.

If no host-level requirement remains, ECS with Fargate is often a natural starting point.

### When Is Lambda the Right Shape?
<!-- section-summary: Lambda runs bounded computation in response to events, scales with concurrent work, and treats execution environments as disposable. -->

Consider an image uploaded to S3. The requirement is:

```text
file uploaded → resize(file) → save result → finish
```

The system may not need a server or container service waiting all day. It needs computation when the event occurs.

AWS Lambda receives an event, prepares an execution environment, passes the event to a handler, and runs the code. AWS manages that environment.

```text
S3 upload → Lambda invocation → resized object
```

The natural scaling dimension changes. One event creates roughly one unit of work. One thousand independent events can create many concurrent invocations.

```text
EC2:   How many machines?
ECS:   How many tasks?
Lambda:How many invocations are concurrent?
```

Lambda is easiest to design when the environment is disposable. AWS may reuse an execution environment for efficiency, but correctness must not depend on a particular one surviving.

This global variable is not durable state:

```python
counter = 0

def handler(event, context):
    global counter
    counter += 1
```

Important state belongs in durable systems such as S3, DynamoDB, RDS, SQS, or another external store.

```text
disposable Lambda compute
  ├─ reads and writes DynamoDB
  ├─ reads and writes S3
  ├─ connects to RDS where appropriate
  └─ sends or consumes SQS messages
```

Ordinary Lambda invocations are deliberately bounded. The source documents a maximum standard invocation duration of 900 seconds, or 15 minutes. That makes the service strongest when work looks like:

```text
event → bounded computation → result or next event
```

Examples include an HTTP request, S3 object processing, SQS message handling, scheduled cleanup, or a database event that updates another system.

Lambda becomes less natural when the essential design is, "Boot once, remain alive indefinitely, hold important local state, and accept arbitrary work forever." That is server or container shape.

AWS has added models such as Lambda Durable Functions and Lambda Managed Instances, but the ephemeral event-and-invocation model remains the clearest foundation for ordinary Lambda.

## When Is EKS the Right Shape?
<!-- section-summary: EKS provides managed Kubernetes, which is valuable when Kubernetes APIs and ecosystem semantics are themselves an organizational requirement. -->

Containers answer how an application is packaged. Kubernetes answers what API an organization uses to describe and operate distributed applications.

Kubernetes includes concepts such as:

```text
Pod
Deployment
Service
StatefulSet
DaemonSet
Ingress
Namespace
ConfigMap and Secret
Job and CronJob
Custom Resource and Operator
```

That makes Kubernetes a platform contract, not merely a way to run an OCI image.

Amazon EKS is AWS's managed Kubernetes service. AWS runs the Kubernetes control plane. Workloads still execute on underlying compute.

```text
kubectl or delivery pipeline
  ↓
Kubernetes API
  ├─ Deployments and Pods
  ├─ Services and Ingress
  ├─ Jobs and StatefulSets
  └─ operators and policies
  ↓
worker compute
```

The worker capacity can use EC2 or Fargate. EKS on Fargate lets Pods use the Kubernetes API without your team independently managing VM groups for those Pods.

EKS Auto Mode pushes more infrastructure responsibility toward AWS. It can manage substantial portions of compute, node scaling, networking integration, load balancing, and storage infrastructure. Your team still owns the Kubernetes application definitions, containers, and Kubernetes policies and configuration.

Auto Mode reduces the node and add-on burden; it does not remove Kubernetes concepts or complexity. Choosing EKS still means choosing Kubernetes APIs, controllers, upgrades, policies, and operational reasoning.

Do not choose EKS merely because you have containers. ECS can operate many containerized services. Strong Kubernetes reasons include:

- the organization standardizes on Kubernetes APIs;
- the software requires operators or custom resources;
- platform engineering is built around Kubernetes;
- the ecosystem assumes Kubernetes; or
- compatibility with Kubernetes environments is a deliberate requirement.

Use Kubernetes when Kubernetes itself provides value.

## How Do Control and Responsibility Move Together?
<!-- section-summary: Higher managed abstractions remove infrastructure decisions but also reduce the underlying control available to the customer. -->

The rough infrastructure ladder is:

```text
more host control
    EC2                    "Give me a machine."
    ECS on EC2             "Schedule containers on my fleet."
    ECS with Fargate       "Schedule containers; AWS owns capacity."
    Lambda                 "Run code when work arrives."
less infrastructure to manage
```

EKS sits on a different axis because it chooses the Kubernetes orchestration ecosystem:

```text
container workloads
  ├─ ECS → AWS-native scheduling → Fargate, EC2, managed capacity
  └─ EKS → Kubernetes API → EC2, Fargate, Auto Mode
```

As the abstraction rises, decisions disappear.

With EC2, you choose machine, OS, patching, runtime, processes, deployment, capacity, and scaling. With Fargate, you mainly choose container, CPU, memory, network, and desired count. With Lambda, you choose function, memory, event source, permission, timeout, and concurrency behavior.

Every unneeded decision removed is one less thing to misconfigure, patch late, fail to scale, or repair during the night.

The cost of abstraction is constraint:

```text
more abstraction → less low-level control → more platform constraints
```

You cannot ask AWS to manage every underlying detail while also retaining unrestricted control of those details.

```text
control increases ⇒ responsibility increases
```

If the customer can modify the guest OS, AWS cannot guarantee its configuration. If AWS guarantees a managed environment, it must restrict what the customer can modify. This relationship is a property of managed computing, not an arbitrary AWS rule.

![The choice review keeps the four compute shapes side by side and ties them to runtime ownership, scaling, deployment, networking, and observability](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-choice-review.png)

*The decision is a trade between required control, accepted constraints, and the operational surface the team can own.*

## How Do You Choose With the Workload in Front of You?
<!-- section-summary: A runtime checklist and decision tree select the highest managed abstraction that still satisfies the workload's real constraints. -->

Use the workload, not service popularity.

| Question | Why it matters | Signal |
|---|---|---|
| Does the app require OS or machine control? | Higher abstractions hide the host | EC2 |
| Can it be packaged naturally as a container? | Machine identity may not matter | ECS or EKS |
| Is it a long-running service? | Persistent process lifecycle matters | ECS, EKS, or EC2 |
| Does work arrive as independent events? | Invocation compute may fit | Lambda |
| Is execution short and bounded? | Strong Lambda signal | Lambda |
| Are Kubernetes APIs, operators, or CRDs required? | Kubernetes is the requirement | EKS |
| Are host privileges or special host settings required? | Fargate and Lambda may hide too much | EC2 or ECS on EC2 |
| Should the team avoid VM fleet operations? | Push responsibility downward | Fargate, Lambda, or EKS Auto Mode |
| Does local machine state matter? | Disposable compute is harder | Often EC2 |
| Does traffic change sharply and unpredictably? | Fine-grained elasticity helps | Lambda or Fargate |
| Is utilization high and predictable? | Pooled owned capacity can be attractive | EC2 or ECS on EC2 |
| Does the organization already run Kubernetes as a platform? | Organizational architecture matters | EKS |

The default principle is:

> Choose the highest-level managed abstraction that still provides the control the workload actually requires.

Test the shapes in order:

```text
bounded independent event work?
  ├─ yes → Lambda
  └─ no  → container-shaped?
           ├─ yes → Kubernetes required?
           │        ├─ yes → EKS
           │        └─ no  → ECS, often with Fargate
           └─ no  → machine-level control required?
                    └─ yes → EC2
```

This is a guide rather than a universal theorem.

An image-processing system illustrates the choices. EC2 can run a web server and worker while the team manages servers. ECS with Fargate can run API and worker images without a host fleet. S3 can trigger Lambda directly if processing is event-shaped. EKS can host Deployments, GPU node pools, a custom image operator, and standard platform policy when Kubernetes itself is valuable.

The business outcome is the same; the responsibility model changes.

## Why Is the Production Runtime Bigger Than Compute?
<!-- section-summary: A compute service answers how code executes but not where state lives, how traffic enters, how identity works, or how the system is observed and recovered. -->

Selecting ECS, Lambda, EC2, or EKS does not finish the hosting architecture.

```text
internet or events
  ↓
DNS, CDN, load balancer, or API entry
  ↓
compute: EC2, ECS, Lambda, or EKS
  ├─ database and cache
  └─ object storage

surrounding concerns:
IAM and secrets
logs, metrics, and traces
deployment pipeline
scaling
backup and recovery
```

The compute choice primarily answers, "How does application code execute?" It does not automatically decide where durable state belongs, how requests enter, how secrets and identities work, how deployments roll out, how failures are observed, or how recovery happens.

The distinction worth retaining is:

| Service | What you ask AWS for |
|---|---|
| EC2 | Give me a computer. |
| ECS | Keep these containers running. |
| Fargate | Supply container capacity without making me operate servers. |
| Lambda | Run this code when work arrives. |
| EKS | Give me Kubernetes for describing and operating applications. |

Under every option are physical data centres, servers, CPU, memory, and networking. The service decides how much of that machinery is visible between your code and the CPU.

![The checklist summary turns compute choice into review questions about runtime owner, scaling, deployment, network placement, and observability](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-compute-mental-model/compute-checklist-summary.png)

*Compute fits inside a larger application runtime that still needs networking, state, identity, observability, delivery, and recovery decisions.*

## Check Your Answers
<!-- section-summary: Review workload shapes, responsibility boundaries, scaling units, disposable state, Kubernetes value, and surrounding runtime concerns. -->

:::expand[What Does Every Application Need to Run?]{kind="recap"}
Application code needs a runtime, operating system, CPU, memory, networking, identity, observability, scaling, and recovery even when AWS hides some layers.

Code uses a language runtime and libraries on an operating system, which uses CPU and memory on physical hardware. AWS services differ in which of those layers the customer operates.
:::

:::expand[Which Workload Shape Are You Deploying?]{kind="recap"}
The natural deployment unit—machine, container, invocation, or Kubernetes workload—provides the first strong signal toward a compute service.

Server-shaped work deploys a machine, container-shaped work deploys a packaged process or task, event-shaped work deploys an invocation handler, and Kubernetes-shaped work deploys Kubernetes resources and APIs.
:::

:::expand[When Is EC2 the Right Shape?]{kind="recap"}
EC2 provides a virtual machine whose guest OS and application environment remain under customer control.

EC2 exposes the guest machine and OS for maximum control, while the customer owns patching, runtimes, process management, capacity, replacement, scaling, and deployment on that server layer.
:::

:::expand[How Do ECS and Fargate Divide the Container Job?]{kind="recap"}
ECS schedules and maintains container workloads, while Fargate supplies underlying capacity without exposing an EC2 host fleet to the customer.

ECS orchestrates tasks and services: what runs, how many copies, and how they are maintained. Fargate supplies underlying capacity so the customer does not operate an EC2 container fleet.

Lambda runs bounded computation in response to events, scales with concurrent work, and treats execution environments as disposable.

It scales with concurrent invocations or units of event work rather than with a customer-chosen number of servers. Each event can trigger bounded computation.

In durable external services such as S3, DynamoDB, RDS, or queues. Execution environments can be reused, but correctness must not depend on one environment persisting.

When the essential model is an indefinitely running process with important local state or host behavior. Ordinary Lambda is strongest for bounded event-to-result work and has a standard 15-minute invocation limit.
:::

:::expand[When Is EKS the Right Shape?]{kind="recap"}
EKS provides managed Kubernetes, which is valuable when Kubernetes APIs and ecosystem semantics are themselves an organizational requirement.

ECS also runs containers. EKS is justified when Kubernetes APIs, controllers, operators, policies, ecosystem, or platform compatibility provide specific organizational value.

It reduces work around nodes, scaling, networking, load balancing, and storage infrastructure. The team still chose Kubernetes objects, APIs, policies, and operational reasoning.
:::

:::expand[How Do Control and Responsibility Move Together?]{kind="recap"}
Higher managed abstractions remove infrastructure decisions but also reduce the underlying control available to the customer.

More low-level control creates more configuration and operational responsibility. More AWS management removes decisions but imposes constraints because AWS must control the layers it guarantees.
:::

:::expand[How Do You Choose With the Workload in Front of You?]{kind="recap"}
A runtime checklist and decision tree select the highest managed abstraction that still satisfies the workload's real constraints.

Choose the highest managed abstraction that still satisfies the workload's actual control, duration, packaging, platform, state, and utilization requirements.
:::

:::expand[Why Is the Production Runtime Bigger Than Compute?]{kind="recap"}
A compute service answers how code executes but not where state lives, how traffic enters, how identity works, or how the system is observed and recovered.

It does not by itself decide state storage, traffic entry, IAM, secrets, deployment, logs, metrics, traces, backup, or recovery. Those surrounding systems complete the production runtime.
:::

## References

- [Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Instances.html) - Defines instance types, AMIs, networking, storage, and virtual-server control.
- [Shared responsibility](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/shared-responsibility.html) - Explains customer responsibility for the guest OS and applications on EC2.
- [What is Amazon ECS?](https://docs.aws.amazon.com/en_gb/AmazonECS/latest/developerguide/Welcome.html) - Introduces task definitions, tasks, services, and clusters.
- [ECS launch types and capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html) - Compares Fargate, EC2 Auto Scaling groups, and managed capacity.
- [AWS Fargate for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html) - Describes serverless task capacity and configuration.
- [How Lambda runs code](https://docs.aws.amazon.com/lambda/latest/dg/concepts-how-lambda-runs-code.html) - Explains events, handlers, and execution environments.
- [Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) - Covers reuse and disposable execution assumptions.
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) - Documents the standard invocation timeout.
- [Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/) - Introduces the managed Kubernetes control plane and operating models.
- [EKS with Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html) - Explains Pods on Fargate capacity.
- [EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html) - Describes AWS-managed compute, networking, load-balancing, and storage integration.
