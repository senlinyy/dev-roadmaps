---
title: "GKE"
description: "Understand when Google Kubernetes Engine is the right compute shape for containers that need Kubernetes as their operating layer."
overview: "GKE is Kubernetes-shaped compute on GCP. This article explains clusters, Autopilot and Standard modes, Pods, Deployments, Services, Ingress, Workload Identity, node responsibility, and the tradeoff against Cloud Run."
tags: ["gcp", "gke", "kubernetes", "containers", "pods"]
order: 5
id: article-cloud-providers-gcp-compute-application-hosting-gke
aliases:
  - google-kubernetes-engine
  - kubernetes-on-gcp
  - gke-autopilot
---

## Table of Contents

1. [Why the Team Reaches for GKE](#why-the-team-reaches-for-gke)
2. [What GKE Is](#what-gke-is)
3. [Autopilot and Standard](#autopilot-and-standard)
4. [Clusters, Control Plane, and Nodes](#clusters-control-plane-and-nodes)
5. [Pods and Deployments](#pods-and-deployments)
6. [Services, Ingress, and Gateway](#services-ingress-and-gateway)
7. [Workload Identity Federation for GKE](#workload-identity-federation-for-gke)
8. [Sidecars and Co-Location](#sidecars-and-co-location)
9. [Policy, Security, and Node Responsibility](#policy-security-and-node-responsibility)
10. [A Sample Orders Platform Manifest](#a-sample-orders-platform-manifest)
11. [Rollout and Verification](#rollout-and-verification)
12. [The Cloud Run Tradeoff](#the-cloud-run-tradeoff)
13. [Putting It All Together](#putting-it-all-together)

## Why the Team Reaches for GKE
<!-- section-summary: GKE earns its place when the team needs Kubernetes as the shared platform API for many containers, policies, and controllers. -->

Imagine the checkout team started with one **Cloud Run** service called `checkout-api`. It accepted HTTPS requests, talked to a database, emitted logs, and scaled without anyone thinking about servers. That was a good first shape because the team had one stateless web service and the main goal was shipping quickly.

Six months later, the same product has a different operating problem. Checkout now has an `orders-api`, a `pricing-api`, an `inventory-sync` worker, a fraud scoring adapter, and a payment webhook handler. The platform team also wants a service mesh proxy, consistent network policy, internal path routing, Kubernetes-native deployment checks, and a custom controller that creates per-team database resources from a YAML file.

This is the moment where **Kubernetes itself** is the reason to choose the runtime. Kubernetes is an open source platform API for running containers, connecting them, updating them, and attaching policy to them. Teams describe the desired state of their workloads as Kubernetes objects, and controllers keep working until the live system matches those objects.

**Google Kubernetes Engine**, usually shortened to **GKE**, is Google Cloud's managed Kubernetes service. Google manages the Kubernetes control plane, integrates the cluster with Google Cloud networking, identity, logging, monitoring, and release channels, and gives your team a standard Kubernetes API surface. The team still designs the application platform, but it does that through Kubernetes objects instead of one-off scripts around individual containers.

The beginner-friendly rule is simple enough for the first decision: **start with Cloud Run when one stateless container service is enough, and consider GKE when the platform needs Kubernetes features as part of the product architecture**. Those features include multiple cooperating services, shared namespace policy, Kubernetes Services and Ingress or Gateway routing, sidecar containers, custom controllers and operators, and common governance across teams.

## What GKE Is
<!-- section-summary: GKE is managed Kubernetes on Google Cloud, so the team works with Kubernetes objects while Google operates major cluster components. -->

A **container** packages an application process with its runtime dependencies. Kubernetes gives those containers a control system: it places them on machines, restarts them when they fail, scales them, connects them with stable network names, and lets teams manage that behavior through the Kubernetes API. Google Cloud's GKE documentation describes GKE as a managed implementation of Kubernetes, which itself came from Google's long experience operating large production workloads.

In our checkout story, GKE is the shared place where the platform team can say, "Here is how backend services run in production." The orders team brings a container image. The platform gives them namespaces, service accounts, ingress rules, network policy, rollout checks, and guardrails that every team uses in the same way.

The main object types show up quickly. These names will keep appearing as the checkout platform grows from one container into several coordinated services:

| Concept | Beginner definition | Checkout example |
|---|---|---|
| **Cluster** | A Kubernetes environment with a control plane and worker capacity. | `gke-checkout-prod` hosts the checkout backend services. |
| **Namespace** | A named space inside the cluster for grouping resources and applying policy. | `checkout` holds the orders API, pricing API, and their policies. |
| **Pod** | The smallest deployable unit in Kubernetes, usually one application container plus any tightly coupled helper containers. | One `orders-api` Pod runs the app container and a database proxy sidecar. |
| **Deployment** | A controller-backed object that keeps the requested number of Pods running and handles updates. | `orders-api` asks for three replicas during normal traffic. |
| **Service** | A stable network name and virtual IP that points to matching Pods. | `orders-api.checkout.svc.cluster.local` routes to healthy orders Pods. |
| **Ingress or Gateway** | A Kubernetes way to route external HTTP traffic into Services. | `checkout.example.com/orders` routes to the orders Service. |
| **ServiceAccount** | A Kubernetes identity that a Pod can run as. | `orders-api-ksa` identifies the orders workload inside the cluster. |

Notice how the runtime has grown beyond "run this image." The platform now has a vocabulary for identity, rollout, networking, and policy. That vocabulary matters because the checkout team wants every service to follow the same production rules instead of inventing those rules again for each container.

## Autopilot and Standard
<!-- section-summary: Autopilot shifts node operations to Google, while Standard keeps more infrastructure control with your platform team. -->

GKE has two main modes: **Autopilot** and **Standard**. The mode decides how much node and infrastructure responsibility your team keeps. This choice should happen before the first production cluster exists, because it affects security defaults, scaling, node access, operating system choices, upgrade work, and cost planning.

**GKE Autopilot** is the managed mode where Google manages the nodes, node scaling, many security settings, and infrastructure configuration. You still submit normal Kubernetes manifests, but Google provisions and manages worker capacity based on the workload requirements in those manifests. For an application team that wants Kubernetes APIs without a large cluster operations team, Autopilot is usually the clean starting point.

**GKE Standard** gives the team more direct control over node pools. A node pool is a group of worker nodes with a shared configuration, such as machine type, operating system image, labels, taints, accelerators, or upgrade behavior. Standard makes sense when the team needs specific Compute Engine machine families, GPUs or TPUs with particular scheduling rules, privileged platform agents, custom node-level configuration, or a migration path that already depends on hand-tuned Kubernetes nodes.

| Decision area | Autopilot | Standard |
|---|---|---|
| **Node management** | Google manages node configuration, scaling, and many security constraints. | The platform team creates and manages node pools, or selectively uses Autopilot workloads inside Standard where supported. |
| **Scaling** | GKE scales node quantity and size around Pods in the cluster. | The team configures node pools, Cluster Autoscaler, node auto-provisioning, and workload autoscaling. |
| **Security defaults** | Workload Identity Federation for GKE and several hardening settings are preconfigured. | Shielded GKE Nodes are default, while Workload Identity Federation and other controls need deliberate configuration. |
| **Hardware control** | Autopilot supports many production workloads and offers ComputeClasses for some needs. | Standard gives the broadest control over machine types, node operating systems, GPUs, TPUs, Local SSDs, and specialized node pools. |
| **Cost conversation** | Planning focuses on requested running Pod resources and the current Autopilot pricing rules. | Planning focuses on node capacity, utilization, and the cost of resources on nodes. |

For the checkout platform, Autopilot is a strong first production choice. The team wants Kubernetes policy, Services, Ingress or Gateway routing, sidecars, and Workload Identity Federation, while custom kernel modules and hand-managed node images sit outside the current requirement. If a later fraud model needs a specialized GPU node pool, that specific requirement can justify Standard or a separate cluster.

## Clusters, Control Plane, and Nodes
<!-- section-summary: A GKE cluster has a Google-managed control plane and worker capacity that runs Pods, with node responsibility depending on the mode. -->

A **cluster** is the boundary where Kubernetes resources live. It has a **control plane**, which is the management layer that exposes the API server, schedules Pods, runs controllers, and stores cluster state. It also has **nodes**, which are the worker machines that actually run application Pods.

In GKE, Google manages the control plane in both Autopilot and Standard. That means Google operates the API server and core control plane components for the cluster. In Autopilot, Google also manages the worker nodes. In Standard, the nodes are Compute Engine virtual machines in your Google Cloud project, and the platform team manages node pools, upgrades, sizing, and special configuration.

For a beginner, the easiest way to picture a rollout is to follow one `orders-api` Deployment. A developer changes the image tag in YAML and applies it. The Kubernetes API server accepts the desired state. The Deployment controller creates a new ReplicaSet. The scheduler chooses nodes for the new Pods. On each node, the kubelet asks the container runtime to start the containers.

That chain explains why GKE is useful and why it adds responsibility. The team gets a powerful control loop for many services, but the team also needs clear ownership for cluster access, namespaces, image policy, upgrades, resource requests, alerts, and emergency rollback. Autopilot reduces the node work, while Standard gives more control and asks for more operational maturity.

## Pods and Deployments
<!-- section-summary: Pods group tightly connected containers, and Deployments keep the desired number of Pods running through rollouts and rollback. -->

A **Pod** is the smallest deployable unit Kubernetes manages. A Pod contains one or more containers that share network and storage context. In normal web-service work, one Pod usually has one main application container. Multiple containers in one Pod make sense when they form one tightly coupled unit, such as an app plus a local proxy or log shipper.

A **Deployment** manages a set of Pods for an application workload. The Deployment says which image to run, how many replicas should exist, which labels identify the Pods, and how updates should roll out. Kubernetes creates ReplicaSets behind the scenes and replaces Pods gradually when the Pod template changes.

For the checkout team, the Deployment is the daily unit of change. The team updates through Kubernetes rather than through SSH sessions on nodes. A normal release changes the `orders-api` image from `2026-06-01` to `2026-06-14`, applies the manifest, watches the rollout, checks logs, and rolls back if the new version fails readiness checks.

The common verification flow looks like this in a real terminal session. The useful part is seeing which Kubernetes object each command checks during a release:

```bash
gcloud container clusters get-credentials gke-checkout-prod --location=us-central1
kubectl apply -f k8s/orders-api.yaml
kubectl rollout status deployment/orders-api --namespace checkout
kubectl get deployment,pods --namespace checkout --selector app=orders-api
kubectl logs deployment/orders-api --namespace checkout --container app --tail=100
```

The important habit is reading the Deployment status before celebrating a release. `READY 3/3` means three requested replicas are ready. `AVAILABLE 3` means three replicas are available to serve traffic. A Pod stuck in `CrashLoopBackOff`, `ImagePullBackOff`, or `Pending` points the team toward app crashes, image permissions, or scheduling and resource problems.

## Services, Ingress, and Gateway
<!-- section-summary: Services give changing Pods a stable internal address, and Ingress or Gateway connects HTTP traffic from load balancers to those Services. -->

Pods are replaceable. A Pod can disappear because a node drains, a rollout replaces it, autoscaling changes capacity, or the container crashes. Because each Pod has its own IP address, other workloads should avoid calling Pod IPs directly.

A **Service** solves that problem by giving a stable network identity to a changing group of Pods. The Service uses labels to find matching Pods and publishes a stable DNS name and virtual IP. In our checkout platform, the pricing API can call `http://orders-api.checkout.svc.cluster.local` and let Kubernetes route the request to one healthy orders Pod.

An **Ingress** is a Kubernetes object for HTTP routing into Services. In GKE, an Ingress controller can provision a Google Cloud Application Load Balancer and route paths or hostnames to Kubernetes Services. **Gateway API** is a newer Kubernetes networking API that separates shared gateway infrastructure from the route rules application teams own. Google Cloud documentation now says GKE Ingress is in maintenance mode and recommends evaluating Gateway API for new functionality, so many production teams keep supporting existing Ingress resources while designing new traffic entry points with Gateway.

Here is the practical routing path for the checkout team. Each layer gives the next layer a stable target, even while Pods come and go during scaling and rollouts:

| Layer | What it does | Checkout example |
|---|---|---|
| **Application Load Balancer** | Receives external HTTP(S) traffic. | `checkout.example.com` receives user traffic. |
| **Ingress or Gateway** | Defines host and path routing. | `/orders` routes to the orders Service. |
| **Service** | Gives a stable internal target. | `orders-api` selects Pods with `app=orders-api`. |
| **Pod** | Runs the application containers. | Three replicas handle requests on port `8080`. |

This is a big reason GKE fits multi-service platforms. The team can manage traffic routing, internal discovery, health, and policy with Kubernetes objects. Cloud Run can still host simple public services, but GKE gives the platform team a shared cluster-level routing language when many Services need to cooperate.

## Workload Identity Federation for GKE
<!-- section-summary: Workload Identity Federation lets Pods call Google Cloud APIs through Kubernetes-linked IAM principals instead of static service account keys. -->

Most real applications need Google Cloud APIs. The orders API might read a Secret Manager secret, write to Pub/Sub, pull images from Artifact Registry, or connect to Cloud SQL through a proxy. The old risky pattern was a JSON service account key copied into a Kubernetes Secret or baked into a container image.

**Workload Identity Federation for GKE** gives a better path. A Pod runs as a Kubernetes ServiceAccount, and Google Cloud IAM can recognize that Kubernetes identity as an IAM principal. The workload receives short-lived credentials through the GKE metadata server, so the container can use Google client libraries without a static key file.

Autopilot clusters always have Workload Identity Federation for GKE enabled. Standard clusters need the feature enabled on the cluster and on the relevant node pools. The setup usually has three parts: choose the Kubernetes ServiceAccount, grant that workload principal the narrow IAM role it needs, and reference the ServiceAccount from the Pod spec.

The command shape for direct IAM principal access looks like this. The project and cluster names are placeholders, but the important idea is the IAM member string that points at one namespace and one Kubernetes ServiceAccount:

```bash
gcloud container clusters update gke-checkout-prod \
  --location=us-central1 \
  --workload-pool=PROJECT_ID.svc.id.goog

kubectl create namespace checkout

kubectl create serviceaccount orders-api-ksa \
  --namespace checkout

gcloud projects add-iam-policy-binding PROJECT_ID \
  --role=roles/secretmanager.secretAccessor \
  --member="principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/checkout/sa/orders-api-ksa" \
  --condition=None
```

In production, the IAM binding should target the narrowest resource that supports the needed role. If the orders API only needs one Secret Manager secret, the team should avoid granting broad project-wide access. Some organizations also use the alternative service account impersonation pattern, where the Kubernetes ServiceAccount can impersonate a Google service account that already fits the company's IAM review process.

This matters because the cluster now has many services. The pricing API needs its own Google Cloud access path rather than the orders API's permissions. Workload Identity Federation lets the platform team give each Kubernetes workload its own cloud access path, audit it through IAM, and remove static keys from the deployment story.

## Sidecars and Co-Location
<!-- section-summary: Sidecars let tightly coupled helper containers share a Pod with the main app when local networking, shared storage, or lifecycle ordering matters. -->

A **sidecar container** is a helper container that runs beside the main application container in the same Pod. Kubernetes Pods share networking and can share volumes, so the main app can talk to the sidecar over `localhost` or exchange files through an `emptyDir` volume. This is useful when the helper process belongs to the app's runtime shape rather than to the whole node.

In the checkout platform, the `orders-api` Pod might run two containers. The main `app` container handles HTTP requests. A `cloud-sql-proxy` sidecar opens a local port and handles secure database connectivity. The application code connects to `127.0.0.1:5432`, while the proxy owns the database connection behavior.

Service mesh is another common sidecar example. A mesh proxy such as Envoy can sit beside the app container, observe traffic, apply mutual TLS, and participate in retries or routing policy. The platform team usually injects that sidecar through mesh tooling instead of asking every application developer to hand-write proxy configuration.

One helper container alone might still fit Cloud Run, depending on the current Cloud Run feature set and the app shape. GKE has a stronger case when sidecars come with Kubernetes lifecycle control, shared volumes, network policy, Service discovery, mesh injection, and custom controllers. The real production reason is the whole platform contract around the Pod, with the second process as one piece of that contract.

## Policy, Security, and Node Responsibility
<!-- section-summary: GKE production work combines IAM, Kubernetes RBAC, network policy, Pod security, and clear node ownership. -->

A GKE platform has two access systems that work together. **IAM** controls Google Cloud resources and access to Google Cloud APIs. **Kubernetes RBAC** controls what users and service accounts can do inside the Kubernetes API, such as reading Pods, creating Deployments, or changing NetworkPolicies in a namespace.

For our checkout team, IAM might allow the CI/CD system to deploy to the cluster and allow the `orders-api-ksa` workload principal to read a specific secret. Kubernetes RBAC might allow the orders team to update Deployments in the `checkout` namespace, while only the platform team can edit cluster-wide admission policies. This separation keeps cloud permissions and in-cluster permissions understandable.

A **NetworkPolicy** is a Kubernetes object that controls Pod-to-Pod traffic. By default, Pods in a cluster can usually communicate freely. Network policies let the platform team add Pod-level firewall rules, such as allowing `checkout-web` to call `orders-api` while blocking unrelated workloads from reaching the orders port.

Here is a small NetworkPolicy shape for the checkout namespace. It allows Pods labeled `app=checkout-web` to reach the orders API port, which is enough to show the selector-based pattern:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-web-to-orders
  namespace: checkout
spec:
  podSelector:
    matchLabels:
      app: orders-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: checkout-web
      ports:
        - protocol: TCP
          port: 8080
```

Security also reaches the Pod and node layers. A **security context** controls process-level settings such as user IDs, privilege escalation, and Linux capabilities. **Pod Security Admission**, **Gatekeeper**, **Binary Authorization**, and image scanning can help a platform team reject unsafe manifests or unapproved images before they reach production.

Node responsibility depends on the GKE mode. In Autopilot, Google manages worker nodes and applies many hardening choices for you. In Standard, the platform team owns node pools, maintenance planning, machine choices, node autoscaling, DaemonSets, and special hardware. That control is useful, but it also means someone must watch node health, upgrades, capacity, and privileged workloads with the same seriousness as application health.

## A Sample Orders Platform Manifest
<!-- section-summary: A realistic GKE app manifest combines namespace, workload identity, Deployment, Service, and HTTP routing resources. -->

The first useful manifest for the checkout team should show the shape of the platform contract. A small first version can still include the core pieces: namespace, Kubernetes ServiceAccount, Deployment, sidecar, Service, and an HTTP entry object.

The sidecar image in this example assumes the platform team mirrors and pins approved images in Artifact Registry. In a real production pipeline, image tags should usually resolve to immutable digests, and security policy should verify that the image passed the company's build and scan process.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: checkout
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api-ksa
  namespace: checkout
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: checkout
  labels:
    app: orders-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orders-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    metadata:
      labels:
        app: orders-api
        tier: backend
    spec:
      serviceAccountName: orders-api-ksa
      containers:
        - name: app
          image: us-central1-docker.pkg.dev/PROJECT_ID/apps/orders-api:2026-06-14
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: DATABASE_HOST
              value: "127.0.0.1"
            - name: DATABASE_PORT
              value: "5432"
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
        - name: cloud-sql-proxy
          image: us-central1-docker.pkg.dev/PROJECT_ID/platform/cloud-sql-proxy:2.15.0
          args:
            - "--structured-logs"
            - "--port=5432"
            - "PROJECT_ID:us-central1:orders-db"
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              memory: "128Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: checkout
spec:
  type: ClusterIP
  selector:
    app: orders-api
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout-ingress
  namespace: checkout
spec:
  rules:
    - host: checkout.example.com
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

A few details are doing real work here. `serviceAccountName` links the Pods to the Kubernetes identity that IAM can recognize through Workload Identity Federation. The readiness probe keeps a new Pod out of Service traffic until the app says it is ready. The Service maps stable port `80` to the Pod's named `http` port. The Ingress gives HTTP routing a Kubernetes resource that the GKE ingress controller can translate into Google Cloud load balancing behavior.

This manifest is also a good place to see the Autopilot habit. Resource requests are part of the workload contract. In Autopilot, those requests help GKE provision capacity. In Standard, those same requests help the scheduler place Pods and help the platform team size node pools.

## Rollout and Verification
<!-- section-summary: A production GKE rollout checks API access, Deployment progress, Pod health, Service selection, routing, logs, events, and rollback. -->

The daily production workflow should leave evidence. The platform team wants a CI/CD log that shows which cluster received the release, which namespace changed, whether the Deployment finished, whether Pods reached ready state, and how the team can roll back. The commands below are the kind of sequence a beginner should recognize when reading a real release job.

```bash
gcloud container clusters get-credentials gke-checkout-prod --location=us-central1
kubectl config set-context --current --namespace=checkout
kubectl apply -f k8s/orders-api.yaml
kubectl rollout status deployment/orders-api --timeout=180s
kubectl wait --for=condition=available deployment/orders-api --timeout=180s
kubectl get pods --selector app=orders-api --output=wide
kubectl get service orders-api --output=wide
kubectl get ingress checkout-ingress
kubectl describe deployment orders-api
kubectl describe pod --selector app=orders-api
kubectl logs deployment/orders-api --container app --tail=100
kubectl get events --sort-by=.lastTimestamp
```

The output tells a story. If `kubectl rollout status` finishes successfully, Kubernetes accepted the new ReplicaSet and the Deployment reached its rollout condition. If `kubectl wait` times out, the team should inspect readiness probes, application logs, image pulls, scheduling events, and IAM access. Empty Service endpoints usually point to labels on the Pods and selectors on the Service that do not line up.

Rollback should also be boring and practiced. A Deployment keeps rollout history, so the team can move back to the previous revision when a release fails after deployment. The rollback command shape is:

```bash
kubectl rollout history deployment/orders-api
kubectl rollout undo deployment/orders-api
kubectl rollout status deployment/orders-api --timeout=180s
```

This is one of the practical benefits of using a Kubernetes Deployment. The team updates through a controller that understands replicas, progress, and rollback. The same release pattern can apply to `orders-api`, `pricing-api`, and `inventory-sync`, which gives the platform a shared operational rhythm.

## The Cloud Run Tradeoff
<!-- section-summary: Cloud Run stays the simpler home for stateless container services, while GKE fits workloads that need Kubernetes control and governance. -->

Cloud Run still deserves a serious first look for many container workloads. It runs containers directly on managed infrastructure, gives fast deployment, scales automatically, and avoids cluster creation and node operations. A stateless public API, webhook receiver, background job, or event-driven handler may have a cleaner home there.

GKE is the better fit when the runtime requirement includes Kubernetes control. The checkout team wants namespace policy, Services, Ingress or Gateway routing, Workload Identity Federation per Kubernetes ServiceAccount, sidecar lifecycle, custom controllers, and shared cluster governance. Those requirements are about a platform with many moving parts, so GKE gives the team a common API and operating surface.

The two services can also work together. A lightweight marketing frontend might stay on Cloud Run while the checkout backend moves to GKE. Google Cloud supports hybrid patterns with shared container images, Cloud Logging, Cloud Monitoring, Cloud Deploy, and load balancing designs that can route traffic across runtimes.

The tradeoff is operational weight. Cloud Run asks for less platform machinery when the service fits its model. GKE gives more control and more Kubernetes-native building blocks, but the team must own cluster design, access, resource governance, rollout practices, and incident response. The right answer comes from the workload's needs and the team's ability to operate the platform.

## Putting It All Together
<!-- section-summary: The GKE decision is strongest when Kubernetes gives the team a shared way to run, connect, secure, and update many services. -->

Let's return to the checkout team one last time. The first Cloud Run service solved the original problem well because the team had one stateless container with straightforward HTTP traffic. Growth changed the problem into platform coordination across several services, shared policy, service-to-service networking, sidecars, identity, and custom automation.

GKE gives that team managed Kubernetes on Google Cloud. Google manages the control plane, and Autopilot can also manage the worker nodes for most application workloads. Kubernetes gives the team Pods, Deployments, Services, Ingress or Gateway resources, NetworkPolicies, ServiceAccounts, and the controller pattern.

The practical production shape is concrete. The orders API runs as a Deployment with three Pods. Each Pod uses a Kubernetes ServiceAccount tied to Google Cloud IAM through Workload Identity Federation. A Service gives the Pods a stable internal name. An Ingress or Gateway routes external HTTP traffic to that Service. NetworkPolicy and RBAC keep access scoped. Rollout commands verify progress and provide a known rollback path.

That is the reason GKE belongs at the end of this compute module. It is the container runtime for teams that need Kubernetes as the operating layer. When the application needs only a simple managed container endpoint, Cloud Run keeps the path shorter. When the application platform needs Kubernetes objects, controllers, policy, and shared governance, GKE gives the team the right set of tools.

---

**References**

- [Google Cloud: GKE overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview) - Defines GKE as managed Kubernetes, explains clusters, nodes, Pods, control plane management, modes, benefits, and cost differences between Autopilot and Standard.
- [Google Cloud: GKE Autopilot overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview) - Explains Autopilot as the GKE mode where Google manages infrastructure configuration, nodes, scaling, security, and preconfigured settings.
- [Google Cloud: Compare Autopilot and Standard clusters](https://docs.cloud.google.com/kubernetes-engine/docs/resources/autopilot-standard-feature-comparison) - Compares node management, scaling, security defaults, networking, releases, and compute configuration across the two GKE modes.
- [Google Cloud: Authenticate to Google Cloud APIs from GKE workloads](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) - Shows how Workload Identity Federation for GKE maps Kubernetes workloads to IAM principals and how to configure clusters, node pools, namespaces, and Kubernetes ServiceAccounts.
- [Google Cloud: GKE security overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/security-overview) - Covers IAM and RBAC, control plane security, node security, Workload Identity Federation, network policy, Pod security, and layered workload protection.
- [Google Cloud: GKE Ingress for Application Load Balancers](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/ingress) - Explains how GKE Ingress provisions Application Load Balancers and notes that GKE Ingress is in maintenance mode with Gateway API recommended for new functionality.
- [Google Cloud: Control communication using network policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/network-policy) - Explains GKE network policy enforcement and how NetworkPolicies create Pod-level firewall rules for Pod and Service communication.
- [Google Cloud: GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run) - Compares the two runtimes, describes hybrid deployment patterns, and explains where Cloud Run or GKE fits different workload shapes.
- [Kubernetes: Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Defines Pods as the smallest deployable Kubernetes unit, explains shared networking and storage, and describes multi-container Pod patterns.
- [Kubernetes: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Defines Deployments, ReplicaSets, desired state, rolling updates, rollout status, rollback, and common Deployment commands.
- [Kubernetes: Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Defines Services as stable network abstractions for dynamic Pods and explains selectors, ports, ClusterIP, Ingress, and Gateway context.
- [Kubernetes: Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/) - Defines sidecar containers, lifecycle behavior, shared network and storage, and supporting-service use cases.
- [Kubernetes: Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) - Explains how operators use custom resources and controllers to automate application-specific operations in Kubernetes.
