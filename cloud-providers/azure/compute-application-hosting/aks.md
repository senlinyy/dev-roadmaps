---
title: "AKS"
description: "Use Azure Kubernetes Service when Kubernetes is the platform your team means to operate, with clear control plane, node pool, pod, deployment, service, ingress, scaling, networking, and identity boundaries."
overview: "AKS is Azure's managed Kubernetes service. This article follows one production application from container image to live traffic so the cluster pieces connect to each other in a practical way."
tags: ["azure", "aks", "kubernetes", "containers", "node-pools"]
order: 6
id: article-cloud-providers-azure-compute-application-hosting-aks
aliases:
  - azure-kubernetes-service
  - kubernetes-on-azure
---

## Table of Contents

1. [What Is AKS](#what-is-aks)
2. [The AKS Shape](#the-aks-shape)
3. [Cluster Modes](#cluster-modes)
4. [Control Plane And Nodes](#control-plane-and-nodes)
5. [Pods And Deployments](#pods-and-deployments)
6. [Services](#services)
7. [Ingress And Gateway Traffic](#ingress-and-gateway-traffic)
8. [Node Pools](#node-pools)
9. [Scaling](#scaling)
10. [Workload Identity](#workload-identity)
11. [Networking Choices](#networking-choices)
12. [Operating AKS In Production](#operating-aks-in-production)
13. [When AKS Fits](#when-aks-fits)
14. [Putting It All Together](#putting-it-all-together)
15. [Official References](#official-references)

## What Is AKS
<!-- section-summary: AKS gives your team Kubernetes on Azure, with Azure running the control plane while your workloads still use Kubernetes objects. -->

**Azure Kubernetes Service**, usually shortened to **AKS**, is Azure's managed Kubernetes service. Kubernetes is a platform for running containers across many machines, keeping the desired number of application copies alive, restarting failed containers, connecting services through stable names, and rolling out new versions through declarative objects.

If you know Amazon EKS, AKS fills the same managed Kubernetes job in Azure. Node pools are the everyday Azure place to think about worker capacity, similar to managed node groups, while the surrounding Azure pieces include Microsoft Entra integration, Azure networking, Azure Monitor, and managed identities.

Think about a small commerce team. At first, the team has one container called `orders-api`, and Azure Container Apps runs it just fine. A few months later, the system has `orders-api`, `inventory-api`, `payments-worker`, `receipt-worker`, a background fraud check, a private admin API, and a platform team that wants the same deployment pattern across every service. The team also wants service discovery, internal routing, custom traffic rules, workload identity, separate worker capacity, and Kubernetes tools like Helm, KEDA, and policy controllers. That is the point where AKS is a real platform choice because the team now wants Kubernetes as the shared operating layer.

AKS gives you a Kubernetes cluster, but Azure owns the most painful control plane work. Azure creates and operates the Kubernetes API server, scheduler, controller manager, cloud controller manager, and backing state store. Your team still owns the application shape inside the cluster: container images, manifests, namespaces, node pool design, resource requests, network exposure, identity, monitoring, upgrades, and rollout safety.

This article follows one application through the AKS story. First we name the cluster pieces. Then we walk through the request path from a customer reaching the app to a pod answering the request. After that, we talk about node pools, scaling, identity, networking, and the practical question that matters most for beginners: when is AKS worth the operational responsibility?

## The AKS Shape
<!-- section-summary: The main AKS objects fit together as one path from desired state to running containers and customer traffic. -->

An AKS cluster has a few core pieces that show up again and again. The **control plane** stores the desired state and makes scheduling decisions. **Nodes** provide the virtual machines where containers run. **Pods** wrap running containers. **Deployments** keep the right number of pod copies alive. **Services** give changing pods a stable network name. **Ingress** or **Gateway API** resources route HTTP traffic from outside the cluster to the right service.

Here is the same idea as a visual path. A platform engineer applies YAML to the Kubernetes API. Kubernetes creates pods on nodes. A service gives those pods a stable address. An ingress or gateway layer decides which HTTP request path should go to which service.

![AKS request path showing desired state through control plane, deployment, pods on nodes, and customer traffic through ingress, service, and ready pods](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/aks-request-path.png)

*The desired-state path creates and maintains the app, while the customer-traffic path reaches ready pods through ingress and service routing.*

The important detail is that Kubernetes separates **what you want** from **where it runs today**. You say that `orders-api` should have three healthy replicas. Kubernetes decides which nodes can host those pods, restarts them after failures, and keeps the service pointing at the current healthy copies. That separation is the reason Kubernetes feels powerful in production, and it is also the reason the vocabulary matters.

| AKS concept | Beginner definition | Commerce example |
| --- | --- | --- |
| **Cluster** | One Kubernetes environment with an API, worker capacity, and networking | `aks-commerce-prod` |
| **Control plane** | Azure-managed Kubernetes brain that stores desired state and runs schedulers/controllers | The API that receives `kubectl apply` |
| **Node** | An Azure VM that runs pod workloads | A `Standard_D4s_v5` Linux worker VM |
| **Node pool** | A group of similar nodes with the same VM shape and operating mode | `systempool`, `api-linux`, `worker-spot` |
| **Pod** | The smallest Kubernetes runtime unit, usually one app container plus its local helpers | One running copy of `orders-api` |
| **Deployment** | A desired-state object that manages pod replicas and rolling updates | Keep three `orders-api` pods healthy |
| **Service** | A stable network name and virtual IP in front of changing pods | `orders-api.prod-orders.svc.cluster.local` |
| **Ingress or Gateway** | HTTP routing rules that send external traffic to services | `/orders` goes to the orders service |
| **Workload identity** | A way for pods to get Microsoft Entra tokens without storing Azure secrets | `orders-api` reads Key Vault using a managed identity |

The rest of the article expands this table in the same order a production request follows. We start with the cluster mode because that decides how much Azure manages for you, then we move into the objects that your application actually uses.

## Cluster Modes
<!-- section-summary: AKS has Automatic and Standard modes, and the mode changes how much node management, scaling, security, monitoring, and upgrades Azure handles. -->

AKS currently has two broad cluster modes: **AKS Automatic** and **AKS Standard**. Both modes run Kubernetes and both use the same basic objects, but the operating agreement is different. Automatic gives you a managed starting point with more defaults already configured. Standard gives platform teams deeper control over node pools, networking, scaling, security settings, and upgrade choices.

**AKS Automatic** is useful when the team wants Kubernetes but wants Azure to own more of the day-two platform work. Microsoft describes Automatic as production-ready by default, with managed node provisioning, scaling defaults, security guardrails, monitoring defaults, and upgrades handled more directly by Azure. For a small product team that wants to deploy Kubernetes-shaped apps without building a full platform team first, Automatic is often the first AKS mode to evaluate.

**AKS Standard** is useful when the team needs explicit infrastructure control. A platform team may need custom VNet placement, special VM SKUs, Windows node pools, GPU pools, precise autoscaler settings, private networking rules, custom ingress topology, or existing Terraform modules that already describe cluster infrastructure. Standard gives that team room to design those details, and it also gives that team more things to operate.

The beginner trap is treating the mode as a personality quiz. The real question is responsibility. If the commerce team only needs a reliable Kubernetes landing zone for a few services, Automatic can reduce the platform burden. If the same team has a platform group that must control node pool boundaries, private networking, ingress controllers, and upgrade waves across many clusters, Standard gives them the knobs they are asking for.

| Question | AKS Automatic usually points to | AKS Standard usually points to |
| --- | --- | --- |
| Who should manage most node provisioning decisions? | Azure | Your platform team |
| Do you need custom node pools and VM choices? | Some defaults are managed for you | You design them directly |
| Do you want built-in production defaults quickly? | Yes | Only if you configure them |
| Do you already have a mature Kubernetes platform workflow? | Maybe | Often |
| Are you learning the Kubernetes object model? | Still useful | Very visible because you touch more parts |

That mode decision gives us the next boundary to understand. In every AKS cluster, Azure manages the control plane, and application capacity runs on nodes.

## Control Plane And Nodes
<!-- section-summary: The control plane is the Azure-managed Kubernetes API layer, while nodes are Azure VMs that run your pods. -->

The **control plane** is the management side of Kubernetes. It includes the API server that receives requests, the scheduler that decides where new pods should run, controllers that reconcile desired state, and the backing store that records cluster state. In AKS, Azure operates those control plane components for you, which removes a large amount of raw Kubernetes administration from your team.

The control plane still matters to you because every Kubernetes change passes through it. When a CI pipeline applies a deployment, it calls the API server. When the scheduler places a pod, it uses the requests and constraints in your manifests. When a node disappears, controllers notice the gap and create replacement pods if your workload asks for replicas.

**Nodes** are the worker machines where your application actually runs. In AKS, nodes are Azure virtual machines. Each node runs components such as `kubelet`, `kube-proxy`, and a container runtime. The `kubelet` is the agent that keeps pods running on that node. The container runtime pulls images and starts containers. The network pieces make pod-to-pod and service traffic work.

Here is the first command a beginner often runs after connecting to a cluster. It shows the worker machines while the Azure-managed control plane stays behind the service boundary. The point is simple: your application lands on nodes, so node health directly affects pod health.

```bash
az aks get-credentials \
  --resource-group rg-commerce-prod \
  --name aks-commerce-prod

kubectl get nodes
```

In a healthy production cluster, that command should show ready nodes across the pools you expect. If every pod for `orders-api` is pending, this is one of the first places to look. The scheduler can only place pods on nodes that exist, are ready, match the workload constraints, and have enough allocatable CPU and memory.

This control-plane-and-node split is the main ownership boundary in AKS. Azure keeps the Kubernetes management layer alive. Your team designs the worker capacity, applies manifests, watches upgrades, and makes sure the workloads ask for resources in a way the cluster can actually satisfy.

## Pods And Deployments
<!-- section-summary: Pods are running workload units, and Deployments keep the desired number of pod replicas alive through changes and failures. -->

A **pod** is the smallest unit Kubernetes schedules. Most beginner examples use one container per pod, and that is a good default for normal application services. A pod can also include helper containers that share the same network namespace and local volumes. Kubernetes schedules pods as the unit you describe in YAML, and application containers run inside those pods.

A **Deployment** is a Kubernetes object that says how many pod replicas should exist and which container image they should run. For the commerce team, the deployment can say, "run three copies of `orders-api` from this image, expose port 8080 inside each pod, and replace old copies gradually during a rollout." Kubernetes then creates ReplicaSets and pods behind the scenes to make that desired state real.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: prod-orders
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: orders-api
          image: acrcommerce.azurecr.io/orders-api:1.8.3
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
```

There are a few production ideas hiding in this small file. The `replicas` value asks for three running copies, which gives the service room to survive one pod failure. The `readinessProbe` tells Kubernetes when a pod can receive traffic. The `resources.requests` values tell the scheduler how much node capacity to reserve before placing the pod.

Resource requests deserve special attention in AKS because nodes have **allocatable** CPU and memory, which is lower than the full advertised VM size. Azure, the operating system, kubelet, and system daemons reserve some space. A pod that requests more memory than any node can allocate will stay pending even if the cluster autoscaler adds more copies of the same small VM. In that situation, the fix is a different pod request, a different node pool VM size, or a separate node pool for that workload.

Pods and Deployments create running application copies, but pod IPs change all the time. A rollout replaces pods. A node drain moves pods. A crash creates a new pod name and a new pod IP. The next piece solves that unstable addressing problem.

## Services
<!-- section-summary: Services give changing pods a stable network identity so other workloads and traffic layers have something reliable to call. -->

A **Kubernetes Service** is a stable network front door for a group of pods. It selects pods by label and gives callers a consistent virtual IP and DNS name. The selected pods can change every minute, and the service name can stay the same.

For the commerce team, `orders-api` pods may roll from version `1.8.3` to `1.8.4`. During the rollout, old pods and new pods overlap. The inventory service calls one stable service name while pods rotate behind it. Kubernetes sends the request to a healthy selected pod.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: prod-orders
spec:
  type: ClusterIP
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

This service creates a stable internal address. Inside the cluster, another pod can call `http://orders-api.prod-orders.svc.cluster.local`. The service receives traffic on port 80 and forwards it to port 8080 on healthy `orders-api` pods. The selector is the important link: `app: orders-api` on the service must match `app: orders-api` on the pods.

AKS supports the normal Kubernetes service types. **ClusterIP** is the default internal service type and is the right shape for service-to-service calls inside the cluster. **LoadBalancer** creates an Azure load balancer resource and can expose a service externally or internally, depending on configuration. **NodePort** opens a port on each node and usually works as supporting plumbing under another exposure pattern. **ExternalName** gives a Kubernetes DNS alias to something outside the cluster.

The common beginner bug is a selector mismatch. The deployment labels pods as `app: order-api`, while the service selects `app: orders-api`. The service exists, DNS resolves, and traffic goes nowhere because the service has no matching endpoints. In real incidents, `kubectl get endpoints orders-api -n prod-orders` or `kubectl describe service orders-api -n prod-orders` can reveal that gap quickly.

Services solve stable internal addressing. Customer traffic still needs an HTTP entry layer that understands hostnames, paths, TLS, and routing rules. That is where ingress and gateway traffic come in.

## Ingress And Gateway Traffic
<!-- section-summary: Ingress and Gateway API resources route HTTP traffic to services, while a controller or managed add-on performs the actual traffic handling. -->

An **Ingress** is a Kubernetes object for HTTP and HTTPS routing. It says things like, "requests for `shop.example.com/orders` should go to the `orders-api` service." The Ingress object is only the rule. An **ingress controller** is the running software that watches those rules and configures load balancing, TLS, and HTTP routing behavior.

In AKS, a team can use the application routing add-on, Application Gateway for Containers, Istio ingress, or another supported controller. Microsoft Learn currently points beginners toward the managed application routing path for most production AKS workloads, while also describing Gateway API as the long-term direction for layer 7 traffic management. The practical lesson is that your YAML needs a controller behind it, and the controller choice is part of the platform design.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: commerce-ingress
  namespace: prod-orders
spec:
  ingressClassName: webapprouting.kubernetes.azure.com
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: orders-api
                port:
                  number: 80
```

This example connects the public HTTP path to the internal service from the previous section. The service then selects pods. That gives us the full request chain: customer request, ingress controller, ingress rule, service, selected pod, container port.

Layer 4 and layer 7 traffic solve different problems. A `LoadBalancer` service is useful when the workload needs raw TCP or a simple external endpoint. An ingress or gateway layer is useful when many HTTP services share a hostname, need path-based routing, central TLS behavior, certificate integration, redirect rules, or more detailed request handling. The commerce team may expose `shop.example.com/orders`, `shop.example.com/inventory`, and `shop.example.com/admin` through one traffic layer while each route lands on a different Kubernetes service.

Traffic routing is only half of the production story. Those pods still need somewhere to run, and the shape of that worker capacity affects cost, reliability, scheduling, and blast radius.

## Node Pools
<!-- section-summary: Node pools group similar worker VMs so system pods, application pods, special hardware, and cost-sensitive work can run on the right capacity. -->

A **node pool** is a group of AKS nodes with the same basic configuration. In AKS Standard, node pools usually map to Azure Virtual Machine Scale Sets. A pool has a VM size, OS type, Kubernetes version, scaling settings, labels, taints, and upgrade behavior. Kubernetes sees the nodes; Azure manages the underlying VM group.

AKS uses **system node pools** and **user node pools**. A system node pool is for critical cluster pods such as CoreDNS and other required add-ons. A user node pool is for your application workloads. Production clusters usually keep system work and business application work separated so a large app rollout leaves enough room for the cluster services that keep DNS, metrics, and connectivity healthy.

The commerce platform might use one system pool and several user pools. `api-linux` hosts normal HTTP services. `worker-spot` runs retryable background jobs on cheaper spot capacity. `memory-cache` hosts memory-heavy workloads. `windows-legacy` exists only if the company still has Windows containers. Those names matter because they turn capacity into an explicit platform decision.

![AKS node pools and scaling showing system pool, API user pool, worker pool, HPA adding pods, pending pods, and cluster autoscaler adding nodes](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/node-pools-and-scaling.png)

*Node pools separate capacity lanes, while HPA and the cluster autoscaler work together when traffic creates more pod demand than the current nodes can hold.*

```bash
az aks nodepool add \
  --resource-group rg-commerce-prod \
  --cluster-name aks-commerce-prod \
  --name api \
  --mode User \
  --node-count 3 \
  --node-vm-size Standard_D4s_v5 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 12
```

Node pools become useful when workloads have different needs. A payment API may need steady reserved capacity and zone spreading. A batch import worker may tolerate interruption and fit spot nodes. A machine learning job may need GPU nodes. An ingress controller may deserve its own pool so customer traffic has a capacity lane apart from noisy background jobs.

Kubernetes gives you scheduling tools to express these boundaries. **Labels** describe nodes, **taints** repel pods that lack a matching toleration, and **node selectors** or affinity rules attract pods to the right place. For example, the platform team can taint the `worker-spot` pool and allow only retry-safe jobs to tolerate that taint. This keeps the checkout API away from interruptible capacity.

Node pools connect directly to resource requests. If a pod requests `4Gi` of memory, the scheduler needs a node with at least that much allocatable memory remaining. If every node in the target pool is full, the pod waits. If cluster autoscaler is enabled, AKS can add nodes to that pool. If the request is bigger than the VM shape can ever satisfy, adding more of the same VM type will still leave the pod pending.

Node pool design is both an infrastructure concern and an application contract. Application teams and platform teams need a shared agreement: what does this workload request, what failure class does it belong to, how fast should it scale, and which pool is allowed to host it?

## Scaling
<!-- section-summary: AKS scaling has separate layers for pod replicas, node capacity, event-driven workloads, and right-sized resource requests. -->

AKS scaling has two different jobs that often get mixed together. **Horizontal Pod Autoscaler**, or **HPA**, changes the number of pod replicas for a workload. **Cluster autoscaler** changes the number of nodes in a node pool when pods cannot be scheduled because the pool lacks enough capacity.

Imagine the checkout traffic doubles during a sale. HPA sees higher CPU or another configured metric on `orders-api` and raises the deployment from three replicas to eight. If the existing nodes have room, the new pods start quickly. If the existing nodes are full, some pods stay pending while the cluster autoscaler asks Azure for more VM nodes.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-api
  namespace: prod-orders
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
```

This HPA keeps at least three replicas and can grow to twenty. It reacts to pod-level CPU utilization, so it can spread work across more pods. Node capacity comes from a separate autoscaling layer. If the cluster lacks room, the scheduler queues pods, and the node autoscaling layer has to catch up.

AKS also supports **KEDA**, which scales workloads from event sources such as queues, streams, and message backlogs. KEDA is useful for `receipt-worker` because a quiet queue can run a small number of workers, while a holiday backlog can create many workers until the queue drains. **Vertical Pod Autoscaler**, or **VPA**, focuses on recommendations or adjustments for resource requests based on observed usage. HPA adds or removes copies, KEDA reacts to events, and VPA helps with right-sizing.

Scaling has a timing story. Pod scale-out can be fast if images are already cached and nodes have capacity. Node scale-out takes longer because Azure has to provision or attach VM capacity, bootstrap the node, join it to the cluster, and let the scheduler place pods. A production API with sharp traffic spikes needs enough warm capacity, sensible HPA settings, good readiness probes, and a node autoscaler range that can actually meet demand.

Scaling also has a cost story. A cluster that keeps too many large nodes idle wastes money. A cluster that keeps too little headroom creates slow scale-outs during traffic spikes. AKS gives you the mechanisms, but your workload behavior decides the right balance.

## Workload Identity
<!-- section-summary: Workload identity lets pods access Azure resources through Microsoft Entra without storing long-lived cloud secrets inside Kubernetes. -->

Applications inside AKS often need to call other Azure services. `orders-api` may read secrets from Key Vault, write receipts to Blob Storage, or publish messages to Service Bus. The unsafe old habit is putting a client secret in a Kubernetes Secret and mounting it into the pod. The safer AKS pattern is **Microsoft Entra Workload ID**.

Workload identity lets a Kubernetes service account map to a Microsoft Entra application or managed identity. The AKS cluster acts as an OpenID Connect issuer. Microsoft Entra validates the projected service account token and exchanges it for a Microsoft Entra token that the workload can use with Azure SDKs. The pod receives temporary identity-based access, and long-lived Azure secrets stay out of YAML.

AWS readers can anchor this to the same goal as IRSA or EKS Pod Identity: a pod receives cloud access through a Kubernetes service account and short-lived credentials instead of a stored key. In AKS, the trust path goes through Microsoft Entra and Azure RBAC or service-specific data-plane permissions.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: prod-orders
  annotations:
    azure.workload.identity/client-id: "<managed-identity-client-id>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: prod-orders
spec:
  template:
    metadata:
      labels:
        app: orders-api
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: orders-api
      containers:
        - name: orders-api
          image: acrcommerce.azurecr.io/orders-api:1.8.3
```

This YAML is only the Kubernetes side of the relationship. Azure also needs a managed identity or app registration, a federated credential that trusts the AKS issuer and service account, and Azure RBAC permissions on the target resource. For example, the managed identity might receive Key Vault Secrets User on `kv-commerce-prod` and Storage Blob Data Contributor on `streceiptsprod`.

The production benefit is clean ownership. Kubernetes decides which pod is using which service account. Microsoft Entra decides which Azure identity that service account can exchange for. Azure RBAC decides what that identity can do. If `receipt-worker` needs Blob Storage but `orders-api` needs Key Vault, each workload gets its own identity boundary.

Identity connects naturally to networking because both decide which doors a pod can use. A pod may have permission to call Key Vault, but the request still has to resolve DNS, leave the cluster through the right route, and reach a public endpoint or private endpoint.

![AKS workload identity and private access showing identity path through service account, OIDC issuer, Microsoft Entra, managed identity, Azure RBAC, and network path through DNS, VNet route, private endpoint, and Key Vault](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/workload-identity-private-access.png)

*A pod needs both sides of the story: an identity that Azure trusts and a network path that can physically reach the target service.*

## Networking Choices
<!-- section-summary: AKS networking decides how pods get IP addresses, how traffic leaves the cluster, and how private Azure resources connect to workloads. -->

AKS networking answers a very practical question: what IP addresses do pods use, and how does traffic move between pods, nodes, Azure services, and outside clients? This matters early because network choices affect VNet address planning, private endpoint access, service exposure, cluster scale, and future migration work.

For most new AKS designs, Microsoft Learn recommends **Azure CNI Overlay** as the common starting point. Overlay networking gives nodes IPs from the VNet subnet while pods use a separate pod CIDR. That conserves VNet IP space and keeps address planning simpler for many clusters. Pods can talk to each other, and traffic leaving the cluster is source network address translated through the node.

Some workloads need a **flat network** shape where pods receive IPs from an Azure VNet subnet and can be reached more directly from connected networks. That can be useful for specific enterprise network requirements, but it asks for much more careful IP planning because every pod consumes VNet address space. Azure CNI Pod Subnet is the modern flat-network option to evaluate for those cases.

Older AKS material often talks about **kubenet**. Current Microsoft Learn AKS networking guidance marks kubenet as legacy, and Microsoft has announced kubenet retirement for AKS on March 31, 2028. Fresh designs should evaluate Azure CNI paths, while existing kubenet clusters need migration planning.

Network policy is the next layer after IP planning. A service name makes one workload reachable, but a network policy can restrict which pods may call it. For example, the platform team may allow `orders-api` to call `inventory-api` while blocking random test pods from reaching the same service. This is where Kubernetes networking joins security design alongside routing.

Private access to Azure resources adds another layer. If `orders-api` calls Azure SQL through a private endpoint, the cluster needs DNS and network routes that resolve the database hostname to the private address and allow traffic from the node or pod network. A workload identity token proves who the pod is, and the network path proves the request can physically reach the service.

By now the cluster can run pods, route requests, scale workers, use identities, and reach networks. The remaining question is how a team operates all of this without turning AKS into a mystery during an incident.

## Operating AKS In Production
<!-- section-summary: Production AKS work is mostly evidence work: health probes, events, logs, metrics, upgrades, policy, and repeatable rollout habits. -->

Production AKS work is less about memorizing every Kubernetes object and more about building a reliable evidence trail. When checkout fails, the team needs to answer a chain of questions. Did the ingress receive the request? Did it route to the right service? Does the service have endpoints? Are the pods ready? Did a pod crash? Did the node have memory pressure? Did a network policy, DNS record, identity permission, or private endpoint block the call?

The first evidence layer is Kubernetes itself. `kubectl get pods`, `kubectl describe pod`, `kubectl get events`, and `kubectl logs` show scheduling, restarts, probes, and container output. These commands are basic, but they stay useful in real incidents because they follow the same objects your manifests created.

```bash
kubectl get pods -n prod-orders
kubectl describe pod -n prod-orders -l app=orders-api
kubectl get endpoints -n prod-orders orders-api
kubectl logs -n prod-orders deploy/orders-api --tail=100
```

The second evidence layer is Azure Monitor and Container Insights. Those tools collect cluster, node, controller, and container signals so the team can see CPU, memory, restarts, node pressure, logs, and trends across time. Without this layer, every incident turns into a live shell session where the team can only see the current moment.

The third layer is rollout discipline. Readiness probes protect users from pods that started but cannot serve traffic. Liveness probes can restart a stuck process, but aggressive liveness probes can also create restart loops. Rolling update settings control how many pods can be unavailable during a release. Pod disruption budgets protect a service during node drains and upgrades by expressing how much disruption the workload can tolerate.

Upgrades deserve their own rhythm. AKS manages the control plane, but the team still has to plan Kubernetes version upgrades, node image upgrades, add-on upgrades, ingress controller changes, and manifest compatibility. Kubernetes removes old API versions over time, so production teams should test manifests and controllers before a cluster upgrade turns deprecated YAML into a deployment failure.

Policy and access controls close the loop. Azure RBAC and Microsoft Entra can control who can administer the cluster. Kubernetes RBAC controls what users and automation can do inside the cluster. Admission policies can reject unsafe workload shapes, such as privileged pods, missing resource requests, or images from unapproved registries. These controls turn production expectations into repeatable checks and reduce dependence on memory during review.

All of this sounds like a lot because AKS is a real platform. That is why the final design question matters so much: does the workload need Kubernetes enough to justify the operating surface?

## When AKS Fits
<!-- section-summary: AKS fits when the team needs Kubernetes as the shared operating contract, and smaller Azure services fit when the workload only needs a simple managed runtime. -->

AKS fits best when Kubernetes itself is part of the requirement. A team may need many services with shared deployment patterns, custom traffic routing, internal service discovery, network policies, controllers, operators, Helm charts, Kubernetes-native observability, service mesh features, multiple node pools, GPU jobs, Windows containers, or a platform team building one contract for many application teams.

The commerce platform is a good AKS candidate if it has several independently deployed services, a platform team responsible for shared ingress and policy, background workers that scale from queues, and workloads that need different worker pools. In that situation, Kubernetes is the operating layer the team wants everyone to share. AKS removes control plane operations while preserving the Kubernetes API and ecosystem.

For an application that only needs a managed runtime, a smaller Azure service often gives the team a cleaner path. A single web container often fits Azure Container Apps or App Service. Short event handlers often fit Azure Functions. A legacy workload that needs full operating system control may fit Azure Virtual Machines. Those choices still run production systems; they simply give the team a smaller operating surface for simpler workloads.

| Workload situation | Usually points toward |
| --- | --- |
| One HTTP container with simple scaling and managed ingress | Azure Container Apps or App Service |
| Event handler for queue messages, timers, or blob events | Azure Functions |
| Several services that need Kubernetes deployment, service discovery, and shared policy | AKS |
| Workloads needing special nodes such as GPU, Windows containers, or separated batch capacity | AKS |
| Legacy software that needs full VM control and custom host setup | Azure Virtual Machines |
| Platform team standardizing Kubernetes tools across many teams | AKS |

The cleanest AKS decision is a sentence the team can defend in a design review: "We need Kubernetes because these services share Kubernetes-native deployment, routing, scaling, policy, and capacity patterns." If the only reason is "the artifact is a container," a smaller container runtime can keep the team moving with less platform work.

## Putting It All Together
<!-- section-summary: A real AKS deployment connects every concept: manifests define the app, services stabilize traffic, ingress routes users, node pools provide capacity, and identity grants Azure access. -->

Let's replay the commerce deployment from start to finish. The build pipeline pushes `orders-api:1.8.3` to Azure Container Registry. The release pipeline applies a Deployment that asks for three replicas, a Service that gives those pods a stable name, and an Ingress that routes `shop.example.com/orders` to that service. Kubernetes stores that desired state in the AKS control plane.

The scheduler places the pods on nodes in the `api` user pool because the pods have resource requests that fit there. The service selects pods labeled `app: orders-api`. The ingress controller receives customer HTTP requests, matches the path, sends traffic to the service, and the service balances requests to ready pods.

During a sale, HPA increases the replica count. If nodes have room, more pods start on existing nodes. If nodes run out of room, the cluster autoscaler grows the `api` node pool within its configured minimum and maximum range. Azure provisions more VM capacity, the nodes join the cluster, and the scheduler places the waiting pods.

When the app needs a secret, it uses workload identity. The pod's service account maps to a Microsoft Entra identity, and Azure RBAC grants that identity access to Key Vault. If the request fails, the team checks both the identity path and the network path, because permission and reachability are separate pieces of the same production call.

That is AKS in one connected story. Azure manages the Kubernetes control plane. Your team designs the application objects, capacity pools, traffic path, scale behavior, identity boundaries, network shape, and operational evidence. The service is powerful because all those pieces connect, and it asks for care for the same reason.

![AKS production story summary showing run, route, scale, secure, and operate cards around an orders-api AKS cluster](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/aks-production-story.png)

*A production AKS service connects the same five jobs again and again: run the app, route traffic, scale capacity, secure access, and operate with evidence.*

## Official References

- [What is Azure Kubernetes Service (AKS)?](https://learn.microsoft.com/en-us/azure/aks/what-is-aks)
- [Core concepts for Azure Kubernetes Service](https://learn.microsoft.com/en-us/azure/aks/core-aks-concepts)
- [Create node pools for an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/create-node-pools)
- [Scaling options for applications in AKS](https://learn.microsoft.com/en-us/azure/aks/concepts-scale)
- [Kubernetes Services in AKS](https://learn.microsoft.com/en-us/azure/aks/concepts-network-services)
- [Ingress in AKS](https://learn.microsoft.com/en-us/azure/aks/concepts-network-ingress)
- [Azure Kubernetes Service CNI networking overview](https://learn.microsoft.com/en-us/azure/aks/concepts-network-cni-overview)
- [Microsoft Entra Workload ID on AKS](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview)
