---
title: "AKS"
description: "Use Azure Kubernetes Service when Kubernetes is the platform your team means to operate, with clear control plane, node pool, pod, deployment, service, ingress, and identity boundaries."
overview: "AKS is Azure's managed Kubernetes service. This article explains what Azure manages, what Kubernetes still asks the team to own, and how to tell when a workload is actually Kubernetes-shaped."
tags: ["azure", "aks", "kubernetes", "containers", "node-pools"]
order: 6
id: article-cloud-providers-azure-compute-application-hosting-aks
aliases:
  - azure-kubernetes-service
  - kubernetes-on-azure
---

## Table of Contents

1. [What Is Azure Kubernetes Service](#what-is-azure-kubernetes-service)
2. [Managed Control Plane and SLA Tiers](#managed-control-plane-and-sla-tiers)
3. [AKS Node Pools: Sizing and Allocatables](#aks-node-pools-sizing-and-allocatables)
4. [Horizontal Pod Autoscaling versus Cluster Autoscaling](#horizontal-pod-autoscaling-versus-cluster-autoscaling)
5. [AKS Networking: Kubenet versus Azure CNI](#aks-networking-kubenet-versus-azure-cni)
6. [Kubernetes Primitives: Pods, Deployments, and Services](#kubernetes-primitives-pods-deployments-and-services)
7. [Ingress Controllers: Routing HTTP Traffic](#ingress-controllers-routing-http-traffic)
8. [Entra Workload Identity: OIDC Token Federation](#entra-workload-identity-oidc-token-federation)
9. [When AKS Fits](#when-aks-fits)
10. [Sample Cluster Shape](#sample-cluster-shape)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Is Azure Kubernetes Service

Azure Kubernetes Service (AKS) is Azure's managed way to run a Kubernetes cluster when your platform needs the Kubernetes API, pod scheduling, services, ingress, and node pools. While Kubernetes provides a declarative API that describes how containers connect, scale, and update, operating a cluster introduces significant infrastructure overhead. AKS addresses this by separating the cluster management into a hosted control plane and dedicated worker node virtual machine pools.

To deploy an Azure Kubernetes Service cluster, you declare its size, network plugin, and identity integration. The following CLI command provisions a standard three-node user cluster with CNI overlay enabled:

```plain
az aks create \
  --resource-group rg-commerce-prod \
  --name aks-commerce-prod \
  --node-count 3 \
  --node-vm-size Standard_D4s_v5 \
  --network-plugin azure \
  --network-plugin-mode overlay \
  --pod-cidrs 192.168.0.0/16 \
  --service-cidrs 10.240.0.0/16 \
  --dns-service-ip 10.240.0.10 \
  --enable-oidc-issuer \
  --enable-workload-identity \
  --generate-ssh-keys
```

Executing this command initiates the provisioning of an Azure-managed cluster boundary, creating a secure OpenID Connect (OIDC) metadata endpoint.

:::expand[Under the Hood: Control Plane Management and Workload Identity Token Exchanges]{kind="design"}
Azure hosts and manages the control plane components (`kube-apiserver`, scheduler, `kube-controller-manager`, and the backing state store) in Azure-managed infrastructure. AKS pricing and support behavior depends on the cluster tier you choose, such as Free, Standard, or Premium. Production clusters should be designed with the tier, SLA requirement, region, and availability zone support in mind rather than assuming every control plane has the same availability promise.

Worker nodes run inside your own subscription, grouped in Virtual Machine Scale Sets (VMSS) managed by the AKS resource provider. They boot with customized Azure-Linux or Ubuntu VM images pre-configured with `containerd` (container runtime), `kubelet` (node agent), and `kube-proxy` (network router).

Workload Identity utilizes OpenID Connect (OIDC) federation between your cluster and Microsoft Entra ID. The OIDC token exchange sequence is described in detail in the Identity section below.
:::

If you run Kubernetes on AWS, AKS maps directly to Amazon EKS. Both provide a managed control plane and delegate worker VM node pools to your subscription. However, their networking and identity configurations reflect their respective clouds. While AWS EKS relies on the AWS VPC CNI (allocating native AWS private IPs to all pods) and IAM Roles for Service Accounts (IRSA), AKS supports Azure CNI (Overlay or native modes) and leverages Microsoft Entra Workload Identity federated OIDC trusts.

The platform executes your declarative YAML manifests. If a deployment fails because of resource constraints, a service selector mismatches, or an ingress controller cannot route packets, your primary troubleshooting path is querying the Kubernetes API using `kubectl` commands and inspecting cluster events.

| Primitive Name | Functional Role inside AKS |
| --- | --- |
| Control Plane | Hosted Kubernetes management APIs (`kube-apiserver`, scheduler, `etcd` database) |
| Node Pool | A VMSS VM group hosting application pods, sharing the same VM size and network subnet |
| Namespace | A logical virtual cluster boundary within the physical cluster, enabling team isolation |
| Pod | The smallest deployable runtime unit, wrapping one or more co-located application containers |
| Deployment | The declarative state engine defining pod replica counts and rolling update patterns |
| Service | A stable network endpoint selector providing load-balanced internal DNS to dynamic pods |
| Ingress Resource | The HTTP/HTTPS path routing rules handled by a designated ingress controller proxy |
| Workload Identity | Cryptographic pod-level Entra ID token exchanges utilizing OIDC federation |

## Managed Control Plane and SLA Tiers

The managed control plane is the Azure-operated Kubernetes management layer for your cluster. When you interact with AKS using administrative tools, you call the API server endpoint exposed by Azure. The control plane processes your request, validates authorization rules, writes the updated state to the `etcd` database, and triggers control loops to schedule workloads.

Because the control plane is hosted by Azure, your team is completely relieved of manual `etcd` administration, API server backup configurations, and control plane certificate rotation. However, you must still configure control plane security boundaries. Production clusters must restrict API server access by enabling private cluster modes (which hide the API endpoint from the public internet) or establishing authorized IP address ranges.

You must also manage cluster upgrades. Kubernetes regularly deprecates old API versions and rolls out security updates. While AKS simplifies updates by providing single-command node pool upgrades, your team must verify manifest compatibility and plan progressive node recycles to ensure zero downtime during cluster upgrades.

## AKS Node Pools: Sizing and Allocatables

Node Pools represent the worker VM capacity where your pods run. Every node pool maps directly to an Azure Virtual Machine Scale Set (VMSS) running in a specialized infrastructure resource group.

![An infographic showing AKS node pools placing pods on worker nodes with different capacity shapes](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/node-pool-placement.png)

*Node pools are the capacity lanes where Kubernetes places pods, so pool sizing affects cost, scale, and scheduling.*

AKS divides pools into two functional roles:
* **System Node Pools**: Dedicated to hosting critical cluster system pods, such as CoreDNS and other required cluster add-ons. System node pools must run Linux and must maintain enough healthy capacity to keep the cluster operational. Ingress controllers can run on system or user pools depending on how your platform team designs scheduling, taints, and isolation.
* **User Node Pools**: Dedicated to hosting your application workloads. You can provision multiple user node pools with specialized VM SKUs (such as GPU-enabled VMs for machine learning, memory-optimized VMs for caches, or Windows Server VMs for legacy legacy code).

Workload scheduling is governed by CPU and memory requests defined in your pod manifests. When a pod is deployed, the control plane scheduler checks the node pools to locate a VM with sufficient unreserved RAM and CPU. If no node has enough capacity, the pod remains in a `Pending` state. To prevent this, enable the AKS Cluster Autoscaler, which automatically monitors pending pods and asks Azure to add new VM nodes to the backing scale set when capacity is needed.

:::expand[Pending Pods from Undersized Node Pool SKU]{kind="pitfall"}
A common Kubernetes scheduling failure occurs when a pod specifies a CPU or memory request that exceeds the physically allocatable capacity of every available VM SKU in your node pool. The pod will sit in a `Pending` state indefinitely. The Cluster Autoscaler detects the pending status and attempts to help, but it can only provision more nodes of the same VM SKU. Since the new nodes are identical in size to the existing ones, they also cannot satisfy the pod's resource request, leaving the autoscaler stuck in a loop of spinning up useless VMs.

This matches the behavior of **Amazon EKS**, where setting resource requests larger than the EC2 instance's allocatable size leaves Pods `Pending` and triggers the AWS Auto Scaling Group (ASG) or Cluster Autoscaler to repeatedly provision identical, useless instances. This waste of compute continues until you upgrade the node group SKU or leverage Karpenter to dynamically provision a larger instance size.

To diagnose this in AKS, run `kubectl get pods` to identify the `Pending` state, then run:
```bash
kubectl describe pod <pod-name>
```
Look for `FailedScheduling` with an event message like: `0/3 nodes are available: 3 Insufficient memory.`

Consider this resource manifest correction:

*   **Before (The Undersized Request):** Requesting 14 GiB memory on a pool using `Standard_D4s_v3` VMs (which have 16 GB total RAM, but only ~12.8 GB allocatable after OS, kubelet, and system reservations):
    ```yaml
    resources:
      requests:
        memory: "14Gi" # Exceeds the 12.8 GiB allocatable ceiling
    ```
*   **After (Right-Sized Request):** Lower the pod request to fit within the node's allocatable boundary, or provision a new user node pool using `Standard_D8s_v3` VMs (32 GB RAM):
    ```yaml
    resources:
      requests:
        memory: "10Gi" # Fits comfortably within the allocatable limit
    ```

**Rule of thumb:** Never set a pod's resource requests based on a VM SKU's total advertised RAM. Run `kubectl describe node` to inspect the actual `Allocatable` CPU and memory values - which are typically 1–2 GB less than physical RAM due to system reservations - before committing pod limits.
:::

## Horizontal Pod Autoscaling versus Cluster Autoscaling

AKS scaling has two separate jobs: add more application replicas, and add more worker-node capacity when existing nodes cannot host those replicas. To handle volatile traffic spikes, AKS operates scaling engines at two distinct layers: application pod scaling and physical VM node scaling.

*   **Horizontal Pod Autoscaler (HPA)**: An in-cluster Kubernetes controller that monitors pod-level resource metrics (typically CPU and memory utilization or custom Prometheus events). When CPU usage exceeds your target threshold, HPA increases the number of pod replicas defined in your Deployment manifest. This is an application-level scaling event, executing in milliseconds as `containerd` boots new container instances within your existing worker nodes.
*   **Cluster Autoscaler (CA)**: An external Azure controller that monitors the scheduler's pod queue. If HPA scales out your pods but the existing VM worker nodes have completely exhausted their CPU and memory pools, the scheduler cannot place the new pods, leaving them in a `Pending` state. The Cluster Autoscaler detects these pending pods, calls the Azure VMSS API, provisions new VM nodes, boots the custom OS image, and joins them to the cluster. This is an infrastructure-level scaling event, taking several minutes as physical VM compute capacity is added.

```plain
Traffic Spike ──> HPA detects CPU ──> HPA scales Pod replicas (Instant)
                                            │
                                  Scheduler runs out of VM RAM
                                            │
                                            ▼
                                  Pod enters Pending state
                                            │
                                            ▼
                                  CA triggers VMSS VM launch (Minutes)
```

By pairing HPA and CA, your cluster can dynamically adjust both container density and underlying virtual machine host capacity to match transactional volume.

## AKS Networking: Kubenet versus Azure CNI

An AKS network plugin is the part of the cluster that decides how pods receive IP addresses and how their packets leave the node. This matters because a pod is temporary, but the network still needs a clear route for traffic to databases, APIs, and other services.

Example: an `orders-api` pod may need to call Azure SQL through a private endpoint at `10.30.40.7`. The network plugin decides whether that pod uses its own VNet-routable IP, an overlay IP translated by the node, or an overlay IP routed through Azure's managed datapath.

In an enterprise Kubernetes deployment, this choice is a foundational decision that cannot be changed after cluster creation. Azure Kubernetes Service supports three primary networking models: Kubenet, Azure CNI, and Azure CNI Overlay.

### 1. Kubenet (Basic NAT Routing)

Kubenet is the IP-saving option. Pods receive addresses from a separate cluster CIDR, and the node translates pod traffic when it leaves the host.

Example: a node with VNet IP `10.30.2.4` can run pods with overlay addresses such as `10.244.1.12` and `10.244.1.13`, while the VNet only sees traffic from `10.30.2.4`.

Kubenet optimizes Virtual Network IP address utilization:

*   **Overlay Subnet**: Pods do not receive IP addresses from your VNet subnets. Instead, the cluster fabric assigns them IPs from a separate, virtual private CIDR block (such as `10.244.0.0/16`).
*   **NAT Translation**: When a pod sends a packet out of the host node, the local Linux kernel executes Network Address Translation (NAT), mapping the pod's IP to the node's physical VNet IP address.
*   **VNet IP Protection**: Because pods share the node's VNet IP, a system pool of three nodes consumes only three VNet IP addresses, regardless of how many hundreds of pods are scheduled on those nodes.

However, Kubenet introduces a small network latency penalty due to NAT packet routing and requires managing custom route tables on your VNet subnets.

### 2. Azure CNI (Routable IP Model)

Azure CNI (Container Network Interface) is the direct VNet-address option. Each pod receives an IP from the Azure subnet, so other VNet resources can route to it without node-level address translation.

Example: if `snet-aks-prod` is `10.30.2.0/24`, an `orders-api` pod might receive `10.30.2.41` and talk to a private SQL endpoint as a normal VNet peer.

Azure CNI is designed for low-latency enterprise traffic:

*   **Routable Subnet IPs**: Every pod receives a real, routable IP address allocated directly from your Virtual Network subnet's private IP pool.
*   **No NAT Overhead**: Packets travel directly from the pod's network interface to other VNet resources or peered networks without any network address translation, matching the latency of VM-to-VM connections.
*   **IP Address Exhaustion Risk**: Because pods consume real subnet IPs, a node hosting thirty pods will exhaust thirty-one subnet IP addresses (thirty pods plus the host node). If you have three system nodes, they consume ninety-three subnet IPs immediately, which can rapidly exhaust your subnet pools during scale-out events.

### 3. Azure CNI Overlay (Hybrid Performance)

Azure CNI Overlay is the balanced option. Pods receive overlay addresses that do not consume VNet subnet IPs, while Azure manages the routing layer instead of relying on Kubenet route tables.

Example: a cluster can give pods addresses from `192.168.0.0/16` while the node pool subnet stays small, such as `10.30.2.0/24`, which protects VNet capacity during scale-out.

Azure CNI Overlay combines the IP address safety of Kubenet with the routing performance of Azure CNI:

*   **Pod Overlay CIDR**: Pods receive private IP addresses from a separate, virtual overlay network, saving your physical VNet subnets from IP address exhaustion.
*   **Overlay Routing**: Azure manages the routing overlays across nodes at the software-defined network layer without requiring custom route tables or executing host-level NAT translation.

This overlay model is highly recommended as the standard default networking plugin for large-scale microservice deployments.

## Kubernetes Primitives: Pods, Deployments, and Services

Kubernetes primitives are the API objects that turn container images into schedulable workloads and stable network addresses. Operating AKS requires understanding how dynamic containers map to these standard resource primitives:

*   **Pods**: A pod is the atomic scheduling unit in Kubernetes. A pod hosts one or more containers that share the exact same network namespace, loopback interface, IP address, port range, and local storage volumes. Any container running inside that pod can communicate with other containers in the same pod over `localhost`. Never store durable files inside a pod and never rely on a pod's temporary IP as a stable connection address.
*   **Deployments**: A Deployment is the controller resource that manages the lifecycle of your pods. It describes your desired state (such as running 5 replicas of the checkout API using image version `v2`) and instructs the control plane's deployment controller to execute rolling updates. To ensure this rollout is safe, you must configure robust Liveness and Readiness probes.
*   **Services**: A Service is the network abstraction that provides a stable, long-lived network interface for a dynamic, changing set of pods. Because pods are constantly replaced during rolling updates, a Service maps a stable virtual IP and internal DNS name to your pods.

```mermaid
flowchart LR
    API["kube-apiserver"] <-- "reads/writes" --> DB["etcd Key-Value Store"]
    API --> Sched["kube-scheduler"]
    Sched -- "schedules pods" --> Node1["Worker Node VM 1"]
    Sched -- "schedules pods" --> Node2["Worker Node VM 2"]
```

```mermaid
flowchart LR
    Svc["Kubernetes Service<br/>(app=orders-api)"] --> PodA["orders-api Pod A<br/>(10.240.0.15)"]
    Svc --> PodB["orders-api Pod B<br/>(10.240.0.32)"]
```

Under the hood, a Service uses selectors to target pods with specific labels (such as `app: orders-api`). The actual packet routing is executed at the node level by `kube-proxy` updating local `iptables` rules in the node's Linux kernel.

## Ingress Controllers: Routing HTTP Traffic

Ingress is the API layer that manages external HTTP/HTTPS routing into your cluster. While a Service load-balances traffic internally, an Ingress resource defines the public routing rules (such as mapping `api.devpolaris.com/orders` to the `orders-service` on port `80`).

To execute these rules, you must run an Ingress Controller (such as the NGINX Ingress Controller or Azure Application Gateway Ingress Controller) in your cluster. The Ingress Controller runs as a reverse-proxy deployment in your User Node Pool.

![An infographic showing traffic moving from ingress to service to pods in AKS](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-aks/service-to-ingress-path.png)

*AKS traffic reaches pods through stable service routing instead of relying on changing pod IPs directly.*

The public path depends on the ingress controller you choose. With an in-cluster controller such as NGINX Ingress, an Azure Load Balancer can forward traffic to ingress controller pods, and those pods route requests to Kubernetes Services. With Application Gateway Ingress Controller, Application Gateway becomes the regional Layer 7 entry point and is configured from Kubernetes resources.

### Kubernetes Ingress Manifest Example

You define external ingress routing rules using standard Kubernetes declarative manifests. The following sample YAML file describes an Ingress resource that maps public traffic arriving at `api.devpolaris.com/orders` to the internal `orders-api-service` on port 80:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: orders-ingress
  namespace: orders-prod
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
spec:
  ingressClassName: nginx
  rules:
  - host: api.devpolaris.com
    http:
      paths:
      - path: /orders
        pathType: Prefix
        backend:
          service:
            name: orders-api-service
            port:
              number: 80
```

When you apply this manifest using `kubectl apply`, the Nginx Ingress Controller intercepts the new configuration API event, compiles the host routing table in memory, and immediately starts forwarding public HTTP requests to the orders service pod endpoints.

## Entra Workload Identity: OIDC Token Federation

Entra Workload Identity is the AKS-to-Entra token bridge that lets a pod authenticate as an Azure identity without storing a client secret. AKS handles security authorization at multiple layers. Workloads running inside pods frequently need to access Azure PaaS resources (such as Key Vault, Storage Accounts, or Cosmos DB). To secure this access without using static passwords, configure Microsoft Entra Workload Identity.

Workload Identity utilizes OpenID Connect (OIDC) federation between your AKS cluster and Microsoft Entra ID. The step-by-step cryptographic exchange operates as follows:

1. When a pod is scheduled, the AKS control plane mounts a local Kubernetes Service Account token (which is a cryptographically signed JSON Web Token) into the pod's file system and injects specialized environment variables.
2. When the application code utilizes the Azure SDK (e.g., `DefaultAzureCredential`), the SDK reads the local token from the mount path and sends it to the Entra ID security token service (STS).
3. Entra ID receives the token and calls the OIDC issuer endpoint of your AKS cluster to fetch the cluster's public cryptographic keys.
4. Entra ID validates the cluster's signature on the token. It then checks the configured federated credential trust to verify that the target namespace and service account name are authorized.
5. Entra ID returns a valid Entra access token to the pod, which the application code uses to query protected Azure PaaS services, ensuring passwordless security.

This OIDC exchange is the current standard pattern for multi-tenant container authorization without static workload secrets.

## When AKS Fits

Azure Kubernetes Service is a highly powerful hosting platform, but it is not a default solution for all workloads. It is a complex ecosystem that requires dedicated engineering time to secure, patch, and monitor.

AKS is the correct choice when your organization fits these criteria:
* You manage dozens of microservices that must scale independently and require complex, inter-service network communication rules.
* Your engineering pipelines are standardized on Kubernetes tooling (such as Helm, ArgoCD, or Prometheus) to maintain multi-cloud compatibility.
* You have a dedicated platform engineering team capable of managing cluster upgrades, network policies, node configurations, and workspace security boundaries.

If your primary goal is to deploy a few containerized web APIs, Azure Container Apps (ACA) or App Service provides the benefits of managed container hosting, scaling, and private networking without the significant administrative overhead of managing Kubernetes nodes, namespaces, and ingress controllers.

## Sample Cluster Shape

To organize your cluster configurations during architectural reviews, document a stable profile of your cluster topography. This profile maps logical Kubernetes resources to physical Azure infrastructure resources.

| Cluster Layer | Current Configuration | Physical Resource |
| --- | --- | --- |
| AKS Cluster | `aks-orders-prod-eus` | Managed Control Plane |
| System Node Pool | `system-d4s` (2 Nodes) | VMSS running `Standard_D4s_v5` VMs |
| User Node Pool | `apps-d8s` (3 Nodes, autoscale to 10) | VMSS running `Standard_D8s_v5` VMs |
| Namespace | `orders-prod` | Logical virtual boundary |
| Deployment | `orders-api` (5 replicas) | containerd pods scheduled on User VMs |
| Service | `orders-api-service` (Internal ClusterIP) | iptables kernel updates managed by kube-proxy |
| Ingress Edge | `api.devpolaris.com` | Azure Load Balancer routing to Ingress VMSS |
| Workload Identity | `orders-api-sa` (OIDC federated) | Entra ID Trust Principal |

This profile helps systems engineers trace the path of a request from the public edge load balancer down to the container runtime socket executing on a physical VMSS worker node in your virtual network subnet.

## Putting It All Together

Azure Kubernetes Service provides enterprise-scale container orchestration by dividing administrative layers systematically.

* **Managed Control Plane**: Azure hosts the core API server and control plane components, with availability and support characteristics tied to the selected AKS tier and regional design.
* **Worker Node VMSS**: Application containers run on physical VM worker nodes grouped in scale sets. Runtimes are orchestrated by the local `kubelet` communicating with `containerd`.
* **Stable Service Routing**: Kubernetes Services provide stable IP endpoints for volatile, changing pods, utilizing `kube-proxy` to configure high-speed kernel routing tables at the socket level.
* **OIDC Workload Identity**: Secure Entra ID access is managed via OIDC token federation. Pod service account tokens are cryptographically verified by Entra ID, ensuring passwordless connections.
* **Dual-Layer Autoscaling**: Pairs Horizontal Pod Autoscaler (HPA) and Cluster Autoscaler (CA) to adjust container replica density and node VMSS hardware capacity dynamically.
* **Routable CNI Networks**: Leverages Azure CNI or CNI Overlay to expose pods directly on the private VNet backbone, cutting NAT latencies.

By deploying your workloads inside organized namespaces and managing deployments, services, and workload identities systematically, you can build resilient, highly available container platforms.

---

* [Azure Kubernetes Service (AKS) Introduction](https://learn.microsoft.com/en-us/aks/intro-kubernetes) - Official overview of AKS cluster structures.
* [AKS Core Concepts](https://learn.microsoft.com/en-us/aks/concepts-clusters-workloads) - Technical guide to Kubernetes nodes, pods, and deployments.
* [Microsoft Entra Workload Identity](https://learn.microsoft.com/en-us/aks/workload-identity-overview) - Documentation covering OIDC token federation and passwordless Entra ID setups.
* [AKS Network Routing Options](https://learn.microsoft.com/en-us/aks/concepts-network) - Technical comparison of Kubenet, Azure CNI, and Azure CNI Overlay networks.
