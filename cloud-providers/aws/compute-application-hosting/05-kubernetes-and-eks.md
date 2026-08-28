---
title: "EKS"
description: "Understand Amazon EKS from containers and desired state through control planes, workers, Pods, Deployments, Services, networking, workload identity, scaling, operations, and debugging."
overview: "EKS is AWS-managed Kubernetes. This article explains what Kubernetes adds to containers, which parts AWS manages, how applications reach workers and AWS services, and when the platform is worth its operating surface."
tags: ["eks", "kubernetes", "containers", "pods", "aws"]
order: 5
id: article-cloud-providers-aws-compute-application-hosting-eks
aliases:
  - amazon-eks
  - elastic-kubernetes-service
  - kubernetes-on-aws
  - eks
  - cloud-providers/aws/compute-application-hosting/eks.md
---

## Table of Contents

1. [Why Do Containers Need an Orchestrator?](#why-do-containers-need-an-orchestrator)
2. [What Does EKS Manage in a Cluster?](#what-does-eks-manage-in-a-cluster)
3. [What Are Pods, Deployments, and Services?](#what-are-pods-deployments-and-services)
4. [How Does EKS Networking Work?](#how-does-eks-networking-work)
5. [How Do Pods and Humans Get Permissions?](#how-do-pods-and-humans-get-permissions)
6. [How Do Scaling, Health, and Resilience Work?](#how-do-scaling-health-and-resilience-work)
7. [What Must a Team Operate in EKS?](#what-must-a-team-operate-in-eks)
8. [How Do You Debug an EKS Application?](#how-do-you-debug-an-eks-application)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start with one application named `payments-api`. On a plain EC2 instance, a team can install Linux, Python, libraries, application files, and a long-running process. That works, but deployments depend on the exact state of the server. Which runtime and libraries are installed? Does production match testing? Can two versions run together? How can the application move to another machine?

A container image packages the application, runtime, libraries, and startup assumptions into a versioned artifact:

```text
payments:v7
┌───────────────────────────┐
│ application               │
│ language runtime          │
│ libraries                 │
│ configuration assumptions │
└───────────────────────────┘
```

The operating goal changes from “configure this particular server correctly” to “run this immutable application image on a compatible runtime.” Containers improve portability and reproducibility, but they create the next layer of questions when the service needs several copies across several machines.

```text
worker A                 worker B
├── payments container  ├── payments container
├── payments container  └── payments container
└── payments container
```

Keep these questions in view as you work through the lesson:

1. **Why Do Containers Need an Orchestrator?**
2. **What Does EKS Manage in a Cluster?**
3. **What Are Pods, Deployments, and Services?**
4. **How Does EKS Networking Work?**
5. **How Do Pods and Humans Get Permissions?**
6. **How Do Scaling, Health, and Resilience Work?**
7. **What Must a Team Operate in EKS?**
8. **How Do You Debug an EKS Application?**

## Why Do Containers Need an Orchestrator?
<!-- section-summary: Containers package applications, but an orchestrator coordinates placement, replacement, scaling, networking, health, and deployment across many machines. -->

Who notices when worker A fails? Who recreates its containers? Who changes four replicas to twelve when traffic grows? Who gradually replaces version 7 with version 8? How do clients find replicas whose addresses can change? Who assigns CPU and memory and checks health?

A **container orchestrator** coordinates placement, restart, scaling, networking, service discovery, deployment, health checking, and resource allocation. Kubernetes is one orchestrator. **Amazon Elastic Kubernetes Service (EKS)** is AWS’s managed Kubernetes platform.

The useful opening model is:

> **EC2 provides machines. Containers package applications. Kubernetes coordinates containerized applications across machines. EKS operates the critical Kubernetes control plane for you.**

```text
users
  ↓
AWS load balancer
  ↓
Kubernetes Service
  ↓
Pods
  ↓
worker compute: EC2, Fargate, or EKS Auto Mode
  ↓
AWS VPC, IAM, networking, and storage
```

### How Does Kubernetes Use Desired State?
<!-- section-summary: Kubernetes controllers continually compare declared intent with actual cluster state and correct differences. -->

Traditional administration often issues imperative commands: start container A, restart container B, move container C. Kubernetes favors a declaration of the result you want:

```yaml
replicas: 3
image: payments:v8
```

This says “three instances of version 8 should exist.” It does not name the exact workers or individual containers that must survive.

Kubernetes continuously compares **desired state** with **actual state**:

```text
desired: 3 payments:v8 Pods
actual:  2 payments:v8 Pods
difference: 1 missing
action: create another Pod
```

This repeating feedback process is **reconciliation**:

```text
desired state
      ↓
controller compares
      ↓
actual state
      ↓
correct a difference
      └──> repeat
```

The durable object is the declaration that three healthy replicas should exist. A particular Pod is replaceable. This desired-state pattern appears throughout Kubernetes: Deployments maintain replicas, schedulers place pending Pods, node agents start required containers, and other controllers reconcile networking, load balancing, storage, and policy objects.

Kubernetes is therefore more than a remote way to run `docker`. It is a distributed control system that keeps trying to make reality match a collection of API objects.

## What Does EKS Manage in a Cluster?
<!-- section-summary: EKS operates the highly available Kubernetes control plane, while application containers execute on a separately chosen data plane. -->

A Kubernetes cluster has two conceptual halves:

```text
CONTROL PLANE                     DATA PLANE
-------------                     ----------
API server                        worker node
scheduler                         ├── Pod
controllers                       ├── Pod
etcd                              └── Pod
```

The **control plane decides**, and the **workers execute**. EKS operates the Kubernetes control plane and distributes its critical components across Availability Zones for availability.

The **API server** is the front door to Kubernetes state. When `kubectl apply -f app.yaml` runs, it does not log into a worker and start a container. It submits desired objects to the API server, which authenticates and validates the request and stores the accepted state.

Kubernetes keeps authoritative cluster state in the distributed key-value store **etcd**. That state includes declarations such as a Deployment’s replica count, a Service port, and the node selected for a Pod. EKS manages the control-plane persistence layer.

The **scheduler** finds a worker for a new Pod. It considers requested CPU and memory, available capacity, node labels, affinity, taints and tolerations, topology rules, and other constraints. A GPU workload should not land on an ordinary worker; a Pod without enough memory cannot be scheduled just because a node exists.

**Controllers** perform reconciliation. If a Deployment wants four replicas and only three exist, its controllers arrange for another Pod object. Other controllers observe other API resources and take the appropriate corrective action.

Workers supply the real processors and memory. A typical EC2 worker contains an operating system, container runtime, networking components, the **kubelet**, and scheduled Pods. The kubelet is the node agent: the control plane declares that a Pod belongs on Node 7, and the kubelet on Node 7 makes the required containers run.

EKS manages the control plane, not automatically every application or all worker operations. Later sections separate standard node choices from more managed modes.

## What Are Pods, Deployments, and Services?
<!-- section-summary: Pods execute tightly coupled containers, Deployments maintain replaceable replicas, and Services give those replicas a stable network identity. -->

Kubernetes schedules **Pods**, not bare containers. A Pod usually contains one main application container:

```text
Pod
└── payments-api container
```

It can also contain tightly coupled supporting containers that share the Pod lifecycle and network identity:

```text
Pod
├── payments-api
└── supporting sidecar
```

The hierarchy is:

```text
container image → running container → Pod → node → cluster
```

Treat Pods as disposable. You generally do not need `payments-pod-37bf9` itself to survive; you need the requested number of healthy payments replicas.

A **Deployment** describes how a stateless application should run. It manages ReplicaSets, which in turn maintain Pods:

```text
Deployment
    ↓
ReplicaSet
├── Pod
├── Pod
└── Pod
```

If one Pod disappears, desired count 3 and actual count 2 cause the controller to create a replacement. If the image changes from `payments:v8` to `payments:v9`, the Deployment can perform a rolling update rather than stopping every old replica at once.

Individual Pod IP addresses are not good application identities. A Pod at `10.0.14.23` may disappear, and its replacement may receive `10.0.19.44`. A **Service** gives a stable logical endpoint to a changing set of Pods.

```text
payments Service
       │ selects label app=payments
       ├──> Pod A
       ├──> Pod B
       └──> Pod C
```

The Service commonly selects Pods through labels. The stable Service name and address survive while individual targets change. CoreDNS lets another workload use a name such as `payments` instead of memorizing a Pod IP.

This separation—ephemeral application copies behind a stable service identity—is one of Kubernetes’ central design ideas.

### How Does Traffic Enter an EKS Application?
<!-- section-summary: Ingress and load-balancer controllers translate external routing intent into AWS load balancers that forward to Kubernetes Services and Pods. -->

A Service solves stable application discovery, but public users still need an external path such as `https://shop.example.com/payments`.

```text
internet
   ↓
Ingress and AWS load balancer
   ↓
payments Service
   ↓
ready payments Pods
```

An **Ingress** can describe HTTP routing rules, such as `/api/users` to `users-service`, `/api/orders` to `orders-service`, and `/api/payments` to `payments-service`. On standard EKS, the AWS Load Balancer Controller watches supported Kubernetes resources and provisions AWS load-balancing infrastructure. An Ingress can result in an Application Load Balancer, while an appropriate Service of type `LoadBalancer` can result in a Network Load Balancer.

A complete request might travel through Route 53, an ALB, the Kubernetes Ingress rule, a Service, and a ready Pod. Each layer has a different failure mode.

The deployment path travels the opposite direction—from desired state toward execution:

1. A pipeline pushes `payments:v12` to Amazon ECR.
2. A developer or deployment system applies a Kubernetes manifest.
3. The API server records the desired Deployment.
4. controllers determine that three replicas are required.
5. Pod objects are created.
6. The scheduler chooses workers.
7. Each worker’s kubelet pulls the image through the container runtime.
8. Containers start.
9. readiness checks succeed.
10. The Service and load-balancing path begin sending traffic to the ready Pods.

The deployment tool never needs to SSH to a worker and run containers directly. It changes desired state; controllers, scheduler, and node agents realize it.

![The cluster shape shows the managed control plane, worker nodes, pods, services, ingress, and health checks in one picture](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-cluster-shape.png)

*EKS separates declarations at the API from execution on workers and traffic through stable service objects.*

## How Does EKS Networking Work?
<!-- section-summary: Pod connectivity, external application traffic, AWS API reachability, DNS, and network policy are separate network concerns. -->

Avoid treating “EKS networking” as one question. At minimum, ask:

```text
Can one Pod reach another Pod?
Can a user reach the application?
Can a Pod reach an AWS API or external dependency?
```

On common EC2-backed EKS designs, the Amazon VPC CNI attaches network interfaces to workers and assigns Pods private addresses associated with VPC networking.

```text
VPC 10.0.0.0/16
└── worker 10.0.10.17
    ├── Pod 10.0.10.52
    ├── Pod 10.0.10.53
    └── Pod 10.0.10.54
```

This makes subnet address capacity a scheduling concern. A cluster can have spare CPU and memory yet fail to add Pods because the selected subnets cannot supply more addresses.

Applications should use stable DNS names such as `payments` rather than Pod addresses. CoreDNS resolves the Service name, and Kubernetes routes the request toward a matching ready endpoint.

Working connectivity is not the same as appropriately restricted connectivity. Kubernetes Pods are not automatically isolated from all one another by default. **NetworkPolicy** resources can restrict allowed Pod traffic when the cluster networking setup supports enforcement.

Network access to an AWS endpoint also does not grant AWS authorization:

```text
networking: Can packets reach S3?
IAM:        May this workload call s3:GetObject on this object?
```

A timeout and an `AccessDenied` point to different layers. Preserve that distinction during design and incidents.

## How Do Pods and Humans Get Permissions?
<!-- section-summary: Workloads receive scoped AWS identities through Kubernetes service accounts, while humans combine API reachability, IAM authentication, and Kubernetes authorization. -->

Different applications should not inherit one broad IAM role from every worker machine. The payments application may need DynamoDB operations, an image worker may need S3 objects, and analytics may need Kinesis. Each should receive only its own permissions.

Kubernetes gives a workload a **ServiceAccount**. A modern EC2-backed EKS path can associate that account with IAM through **EKS Pod Identity**:

```text
Pod
 ↓ uses
Kubernetes ServiceAccount
 ↓ associated through EKS
IAM role
 ↓ supplies temporary credentials
AWS API
```

For example, `payments-sa` can map to `payments-role`, whose policy grants only required DynamoDB actions. AWS SDKs inside the Pod receive temporary credentials rather than static access keys stored in the image.

IAM Roles for Service Accounts, usually called **IRSA**, is another supported workload identity mechanism. EKS Pod Identity has compatibility boundaries—for example, it does not apply to Pods running on Fargate—so IRSA remains relevant where Pod Identity is not applicable. The durable principle is more important than the mechanism: give AWS application permissions to the workload identity, not blanket privilege to every worker below it.

Human access follows a separate path. An engineer running `kubectl get pods` must first reach the EKS Kubernetes API endpoint, authenticate, and then be authorized. EKS can use AWS IAM identities and access entries at the AWS integration boundary, while Kubernetes RBAC controls permitted operations within the cluster.

```text
network access: Can the engineer reach the API endpoint?
AWS IAM:       Which identity authenticated?
Kubernetes RBAC: Which cluster actions may it perform?
```

The EKS API endpoint can have public access, private VPC access, or both. It is not the public URL of your application. `kubectl → Kubernetes API server` and `user → ALB → application` are entirely separate endpoints and security paths.

![The pod path separates network reachability from cloud permission delivery so pod IPs and role credentials do not blur together](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-pod-network-permissions.png)

*Pod network connectivity, workload IAM, and human Kubernetes access are related but independent controls.*

### Where Does EKS Worker Compute Come From?
<!-- section-summary: EKS workloads can run on managed or self-managed EC2 nodes, Fargate, hybrid capacity, or infrastructure managed through EKS Auto Mode. -->

Containers ultimately need processors and memory. EKS supports several worker-capacity approaches.

With **managed node groups**, EC2 instances run in your AWS account while AWS automates much of provisioning and node-lifecycle work. You still choose instance families, capacity ranges, subnets, and important node configuration.

```text
EKS cluster
   ↓
managed node group
   ↓
EC2 Auto Scaling capacity
   ↓
worker nodes
   ↓
Pods
```

With **self-managed nodes**, your team controls more of the EC2 lifecycle. That allows deep customization and creates a larger patching, upgrade, and scaling burden. Hybrid nodes extend supported EKS worker patterns to other environments.

With **Fargate**, selected Pods receive on-demand compute without your team managing an EC2 worker pool. You think in terms of the Pod’s required CPU and memory, while AWS supplies the underlying virtual-machine capacity. Compatibility and workload-identity differences still matter; Fargate does not make every Kubernetes feature or integration identical to EC2 nodes.

**EKS Auto Mode** extends AWS management beyond the control plane into more data-plane infrastructure. It can provision and scale nodes, maintain the operating system, and manage integrated compute, networking, and storage components. Kubernetes APIs and workload semantics remain, while AWS owns more of the infrastructure underneath them.

The management trend is:

```text
standard EKS: AWS manages control plane;
              team operates significant worker/platform infrastructure

EKS Auto Mode: AWS manages control plane plus more node,
               scaling, networking, and storage infrastructure
```

No mode removes responsibility for application manifests, resource sizing, health checks, workload permissions, policy, availability design, and release correctness.

## How Do Scaling, Health, and Resilience Work?
<!-- section-summary: Pods and workers scale through different control loops, health separates process life from traffic readiness, and resilience depends on placement choices. -->

EKS scales at two levels. **Application scaling** changes the number of Pods. A Horizontal Pod Autoscaler can react to metrics and increase three replicas to twelve. **Infrastructure scaling** adds worker capacity when those Pods no longer fit.

```text
traffic rises
  ↓
Horizontal Pod Autoscaler
  ↓
3 Pods → 12 Pods

new Pods remain unscheduled because nodes are full
  ↓
node autoscaling mechanism
  ↓
additional worker capacity
```

EKS Auto Mode, Karpenter, or Cluster Autoscaler can participate in node-side capacity depending on the architecture. The two loops need accurate resource requests. If a Pod requests too little, the scheduler can pack workloads onto a node that later suffers pressure. If requests are far too large, schedulable capacity is wasted.

Kubernetes also separates **liveness** from **readiness**. Liveness asks whether an application is stuck and should be restarted. Readiness asks whether this instance can safely receive traffic.

```text
Pod starts
├── process is alive
├── configuration loads
├── database connection is established
└── readiness becomes true
       ↓
Service may send traffic
```

A running process can be unready. Restarting it may not repair a temporary dependency that simply requires the target to remain out of service.

Multiple replicas do not automatically create high availability. Three replicas on one node share that node’s failure. Three nodes in one Availability Zone still share a zone failure. Topology spread, affinity and anti-affinity, zone-aware worker capacity, and disruption settings determine whether the workload actually uses the resilience mechanisms Kubernetes provides.

## What Must a Team Operate in EKS?
<!-- section-summary: Managed control-plane infrastructure still leaves application, Kubernetes platform, worker, networking, identity, storage, and upgrade operations. -->

Think of production operations as layers:

```text
Layer 5  application: deployments, configuration, health
Layer 4  workloads: Pods, Services, autoscaling
Layer 3  platform: DNS, networking, storage, controllers
Layer 2  workers: nodes, capacity, images, patching
Layer 1  AWS: VPC, subnets, IAM, load balancers

beside them: AWS-managed EKS control plane
```

Important concerns include CPU and memory requests and limits, readiness and liveness probes, Pod autoscaling, worker autoscaling, Availability Zone distribution, logs and metrics, secrets, persistent storage, network policy, workload IAM, Kubernetes upgrades, add-on upgrades, and node patching.

Kubernetes has an active version lifecycle. EKS offers defined support periods, but upgrading still requires coordination. The control plane, worker kubelet versions, managed add-ons such as VPC CNI and CoreDNS, controllers, deprecated APIs, and applications must remain compatible.

Standard EKS therefore does not mean “nothing remains to operate.” It means AWS takes ownership of the critical control-plane infrastructure. More managed worker modes can reduce the infrastructure burden, while the Kubernetes platform and application contract remain yours.

### When Should You Choose EKS Instead of ECS?
<!-- section-summary: ECS is often simpler for AWS-native container hosting, while EKS fits when Kubernetes itself is an organizational platform requirement. -->

Both ECS and EKS schedule, run, replace, and scale containerized applications. The difference is the orchestration API and platform surface.

ECS uses AWS-native objects:

```text
ECS cluster → task definition → service → task → container
```

EKS uses Kubernetes objects and ecosystem:

```text
EKS cluster → Deployment → ReplicaSet → Pod → container
```

ECS is often the simpler choice when the requirement is “run containers well on AWS,” the team does not need Kubernetes, AWS-native orchestration is acceptable, and reducing the platform surface matters.

EKS is a stronger candidate when Kubernetes itself is part of the platform strategy: the organization already standardizes on it, teams know its operating model, Kubernetes-native tools are required, operators or custom controllers extend the API, portability matters, or a platform team maintains sophisticated shared workflows.

A useful first filter is:

```text
Do we need Kubernetes as a platform contract?
       ├── no  → ECS is often simpler
       └── yes → EKS is likely the relevant AWS service
```

This is not a universal rule, but it prevents choosing EKS merely because the application uses containers. Container packaging alone does not create a Kubernetes requirement.

## How Do You Debug an EKS Application?
<!-- section-summary: Follow desired state through creation, scheduling, process health, service selection, ingress, networking, and AWS permissions. -->

Suppose `https://api.example.com/payments` fails. Treat the cluster as a sequence of layers rather than one giant system.

1. **Is the application desired and available?** `kubectl get deployment` compares desired, updated, and available replicas. If the Deployment wants three and zero are available, an ALB is not the first problem.

2. **Do Pods exist, and what state are they in?** `kubectl get pods` distinguishes `Pending`, `CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`, and healthy-looking `Running` Pods.

3. **Why is a Pod pending?** `kubectl describe pod` can reveal insufficient CPU or memory, unmatched node constraints, a taint without toleration, unavailable storage, or no free Pod IP. That is a scheduling or capacity problem.

4. **Why does a container crash?** `kubectl logs`, including previous-container logs when relevant, moves the investigation toward an invalid command, bad image, missing configuration, unavailable database, or application exception.

5. **Is the Pod ready?** `Running` with `Ready=False` points toward readiness probes, initialization, or dependencies. A Service should not send normal traffic to unready endpoints.

6. **Does the Service select endpoints?** Compare the Service selector with Pod labels. `app=payment` does not match `app=payments`. A selector mismatch creates a stable Service with no backing addresses.

7. **Can external traffic reach the Service?** Inspect Ingress status and events, AWS Load Balancer Controller evidence, ALB or NLB target health, security groups, subnets, DNS, and NetworkPolicy.

8. **Can the application reach dependencies?** An AWS `AccessDenied` suggests workload identity or IAM policy. A timeout suggests DNS, routes, security groups, network policy, NAT, or the dependency itself.

The order to memorize is:

```text
desired object
   ↓
Pod created?
   ↓
Pod scheduled?
   ↓
container started?
   ↓
application healthy?
   ↓
Pod ready?
   ↓
Service selects it?
   ↓
Ingress and load balancer work?
   ↓
network path works?
   ↓
AWS IAM and dependencies work?
```

Do not begin by broadening security groups because “EKS is broken.” Find the earliest layer whose contract is not satisfied, then repair that layer.

![The debugging path gives an investigation order from rollout and pod events through target health, node capacity, networking, and permissions](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-eks/eks-debugging-path.png)

*Kubernetes evidence narrows creation, scheduling, and health; AWS evidence narrows load balancing, VPC capacity, and IAM.*

The entire system fits into one picture:

```text
developer or CI/CD
       ↓ kubectl/API
EKS API endpoint
       ↓
AWS-managed control plane
├── API server
├── scheduler
└── controllers
       ↓ desired state
worker compute
├── Node A → Pods
└── Node B → Pods
       ↑
Kubernetes Service
       ↑
Ingress and ALB/NLB
       ↑
users

alongside: ECR images, IAM workload roles,
VPC Pod networking, EBS/EFS storage, observability
```

The shortest useful definition is: **Amazon EKS is AWS’s managed Kubernetes platform. You declare how containerized applications should run, Kubernetes continuously reconciles that state, and EKS operates the critical control plane while integrating workloads with AWS compute, networking, identity, storage, and load balancing.**

## Check Your Answers

:::expand[Why Do Containers Need an Orchestrator?]{kind="recap"}
Containers package applications, but an orchestrator coordinates placement, replacement, scaling, networking, health, and deployment across many machines.

It coordinates placement, replacement, scaling, service discovery, networking, health checks, resource allocation, and rolling deployments across a changing pool of machines and container replicas.

Kubernetes controllers continually compare declared intent with actual cluster state and correct differences.

You declare the result that should exist, such as three Pods running a particular image. Controllers repeatedly compare that declaration with actual state and take corrective action when they differ.
:::

:::expand[What Does EKS Manage in a Cluster?]{kind="recap"}
EKS operates the highly available Kubernetes control plane, while application containers execute on a separately chosen data plane.

The control plane exposes the API, stores cluster state, schedules Pods, and runs controllers. Workers provide CPU and memory, and their kubelets start the containers assigned to them.
:::

:::expand[What Are Pods, Deployments, and Services?]{kind="recap"}
Pods execute tightly coupled containers, Deployments maintain replaceable replicas, and Services give those replicas a stable network identity.

A Pod is the smallest scheduling and lifecycle unit. It can contain one application container or multiple tightly coupled containers that share resources such as network identity.

Ingress and load-balancer controllers translate external routing intent into AWS load balancers that forward to Kubernetes Services and Pods.

A Deployment maintains and rolls out Pod replicas. A Service gives matching ready Pods a stable internal endpoint. Ingress describes external HTTP routing that a controller can realize through an AWS load balancer.
:::

:::expand[How Does EKS Networking Work?]{kind="recap"}
Pod connectivity, external application traffic, AWS API reachability, DNS, and network policy are separate network concerns.
:::

:::expand[How Do Pods and Humans Get Permissions?]{kind="recap"}
Workloads receive scoped AWS identities through Kubernetes service accounts, while humans combine API reachability, IAM authentication, and Kubernetes authorization.

Reachability only proves packets can travel. The Pod’s AWS workload identity must also receive IAM permission for `s3:GetObject` on the requested resource.

Pod Identity maps a Kubernetes service account to an IAM role for application API calls. A human must reach the EKS API, authenticate through the configured AWS identity path, and then pass Kubernetes RBAC authorization.

EKS workloads can run on managed or self-managed EC2 nodes, Fargate, hybrid capacity, or infrastructure managed through EKS Auto Mode.

Options include managed node groups, self-managed EC2 nodes, Fargate for supported Pod patterns, hybrid nodes, and EKS Auto Mode, which lets AWS manage more node and integrated infrastructure work.

They can share one node or one Availability Zone. Topology rules, zone-spread worker capacity, and disruption settings determine whether replicas actually avoid shared failure domains.
:::

:::expand[How Do Scaling, Health, and Resilience Work?]{kind="recap"}
Pods and workers scale through different control loops, health separates process life from traffic readiness, and resilience depends on placement choices.

The application controller can request more Pods, but those Pods still need sufficient node CPU, memory, constraints, and IP addresses. A second capacity loop may need to add workers before Pods can schedule.
:::

:::expand[What Must a Team Operate in EKS?]{kind="recap"}
Managed control-plane infrastructure still leaves application, Kubernetes platform, worker, networking, identity, storage, and upgrade operations.

With common VPC CNI networking on EC2 workers, Pods receive VPC private addresses. New Pods may fail to obtain addresses even when workers still have spare CPU and memory.

ECS is often simpler for AWS-native container hosting, while EKS fits when Kubernetes itself is an organizational platform requirement.

When the goal is straightforward AWS container hosting and the organization does not specifically need Kubernetes APIs, ecosystem tools, operators, or a Kubernetes platform contract, ECS often has less operating surface.
:::

:::expand[How Do You Debug an EKS Application?]{kind="recap"}
Follow desired state through creation, scheduling, process health, service selection, ingress, networking, and AWS permissions.

Trace desired state, Pod creation, scheduling, container startup, application health, readiness, Service endpoints, Ingress and load balancer, network path, then AWS IAM and dependencies. Stop at the first failed layer.
:::

## References

- [Kubernetes concepts in Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-concepts.html)
- [EKS reliability best practices](https://docs.aws.amazon.com/eks/latest/best-practices/reliability.html)
- [EKS control plane](https://docs.aws.amazon.com/eks/latest/best-practices/control-plane.html)
- [EKS compute resources](https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html)
- [AWS Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html)
- [Amazon VPC CNI](https://docs.aws.amazon.com/eks/latest/userguide/managing-vpc-cni.html)
- [Kubernetes network policies on EKS](https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy.html)
- [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)
- [EKS access control](https://docs.aws.amazon.com/eks/latest/userguide/cluster-auth.html)
- [EKS cluster API endpoint](https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html)
- [EKS managed node groups](https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html)
- [AWS Fargate with Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)
- [What is Amazon EKS?](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [EKS data-plane best practices](https://docs.aws.amazon.com/eks/latest/best-practices/data-plane.html)
- [EKS Kubernetes version lifecycle](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)
