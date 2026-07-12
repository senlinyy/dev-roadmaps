---
title: "GKE"
description: "Understand the Google Kubernetes Engine fit for containers that need Kubernetes as their operating layer."
overview: "GKE is Kubernetes-shaped compute on GCP through core vocabulary, Autopilot and Standard modes, rollout flow, identity, networking, policy, and tradeoffs against simpler runtimes."
tags: ["gcp", "gke", "kubernetes", "containers", "pods"]
order: 5
id: article-cloud-providers-gcp-compute-application-hosting-gke
aliases:
  - google-kubernetes-engine
  - kubernetes-on-gcp
  - gke-autopilot
---

## Table of Contents

1. [Why a Team Reaches for GKE](#why-a-team-reaches-for-gke)
2. [Kubernetes and GKE](#kubernetes-and-gke)
3. [Cluster, Control Plane, and Node](#cluster-control-plane-and-node)
4. [Pod, Deployment, Service, and Ingress](#pod-deployment-service-and-ingress)
5. [Autopilot and Standard](#autopilot-and-standard)
6. [A Multi-Service Platform Example](#a-multi-service-platform-example)
7. [Rollout and Verification](#rollout-and-verification)
8. [Workload Identity and Secrets](#workload-identity-and-secrets)
9. [Policy, Sidecars, and Custom Controllers](#policy-sidecars-and-custom-controllers)
10. [The Cloud Run Tradeoff](#the-cloud-run-tradeoff)
11. [Putting It All Together](#putting-it-all-together)
12. [References](#references)

## Why a Team Reaches for GKE
<!-- section-summary: A managed Kubernetes platform fits many services that need shared platform rules; one simple app usually needs only a smaller runtime. -->

One service can be simple. A small contact-form API may run happily on Cloud Run with a container, endpoint, scaling rules, identity, and logs. Many services with shared platform rules may need a different operating layer.

The difference is not about Kubernetes being "more advanced." The difference is about the work the organization wants the platform to do. One app needs a place to run. A platform of many apps may need shared rules for rollout, network policy, service identity, sidecars, namespaces, admission checks, and internal traffic.

Imagine an internal commerce platform with a catalog API, pricing API, checkout API, fraud scoring service, async workers, shared traffic policy, strict namespace boundaries, and a platform team that already reviews every workload through standard deployment files. The application teams need more than a container host. They need a common API for rollout, service discovery, policy, identity, and platform extensions.

That is where **GKE**, Google Cloud's managed Kubernetes service, can make sense. GKE is valuable for production contracts that require Kubernetes itself; a simple app usually fits a smaller runtime such as Cloud Run first.

The decision should feel practical. If the team mainly wants "run this container behind HTTPS," Cloud Run is usually the cleaner path. If the team wants "every service follows the same Kubernetes deployment, network, identity, and policy rules," GKE gives the shared operating layer for that contract.

## Kubernetes and GKE
<!-- section-summary: Kubernetes is the orchestration API, and GKE is Google's managed Kubernetes service. -->

**Kubernetes** is an orchestration system for running containerized applications through a declarative API. Declarative means you send desired state to the platform, such as "run three copies of this app image," and controllers work to keep reality aligned with that desired state.

**GKE** is Google Cloud's managed Kubernetes service. Google runs and integrates major parts of the Kubernetes platform for you, including the managed control plane. GKE also connects Kubernetes to Google Cloud networking, IAM, logging, monitoring, load balancing, node options, and security features.

The commerce platform uses GKE because the organization wants one Kubernetes-based way to deploy many internal services. The platform team can create namespaces, require labels, enforce policy, attach identity, inject helpers, and expose HTTP routes with a consistent review process.

This is a platform decision. If your team only needs one public API and no Kubernetes policy or extension layer, Cloud Run is usually easier to operate.

For AWS readers, GKE maps most directly to EKS. ECS and Fargate are useful comparison points for managed containers without the Kubernetes API surface. EKS and GKE both give Kubernetes, while Cloud Run and App Runner usually ask for less platform operations work.

![GKE as a shared platform API](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/gke-platform-api.png)
*GKE makes sense for teams that use Kubernetes as the shared platform language for many services, policies, and release controls.*

## Cluster, Control Plane, and Node
<!-- section-summary: A GKE cluster has a managed control plane and worker capacity where application workloads run. -->

A **cluster** is the boundary where Kubernetes resources live. The commerce platform might create a production cluster named `commerce-prod` in `us-central1`. Teams deploy their application objects into that cluster under approved namespaces.

The **control plane** is the management layer of the cluster. It exposes the Kubernetes API, stores cluster state, runs controllers, and schedules work. In GKE, Google manages the control plane for both Autopilot and Standard clusters.

A **node** is worker capacity that runs application containers. In GKE Standard, nodes are Compute Engine VMs in your project, grouped into node pools that the platform team manages. In GKE Autopilot, Google manages the nodes and provisions capacity around the workloads you submit.

Use the checkout API to see the pieces working together. The developer sends a Deployment manifest to the cluster. The Kubernetes API receives that manifest and the control plane stores the desired state: three Pods should run image `checkout-api:2026.07.04` in the `checkout` namespace. The scheduler then chooses suitable worker capacity for each Pod based on resource requests, policy, and available capacity. Finally, nodes pull the image and run the containers.

```bash
kubectl apply -f k8s/checkout-api.yaml

kubectl get deployment checkout-api \
  --namespace checkout

kubectl get pods \
  --namespace checkout \
  --selector app=checkout-api \
  --output wide
```

Healthy output should show the desired replica count and the nodes running the Pods:

```console
deployment.apps/checkout-api configured
NAME           READY   UP-TO-DATE   AVAILABLE
checkout-api   3/3     3            3

NAME                            READY   STATUS    NODE
checkout-api-6f8f7d7d7b-2m9zx   1/1     Running   gke-commerce-prod-pool-a-1
checkout-api-6f8f7d7d7b-q7t4p   1/1     Running   gke-commerce-prod-pool-b-3
checkout-api-6f8f7d7d7b-z81rk   1/1     Running   gke-commerce-prod-pool-c-2
```

The interpretation is the whole beginner story. The Deployment is the desired state. The control plane stores and watches that desired state. The scheduler found places for the Pods. The nodes are the worker machines that actually run the containers. If the Deployment says `3/3` and each Pod is `Running` and `Ready`, the platform reached the first layer of the request.

Those three terms explain the platform shape. The cluster is the boundary. The control plane accepts desired state. Nodes provide the worker capacity. Next comes the workload vocabulary inside that cluster.

## Pod, Deployment, Service, and Ingress
<!-- section-summary: These Kubernetes objects describe how app containers run, update, receive internal traffic, and receive HTTP traffic. -->

A **Pod** is the smallest deployable unit Kubernetes manages. It usually contains one application container, and it can also include tightly coupled helper containers that share networking and storage with the main app.

A **Deployment** is a Kubernetes object that keeps the requested number of Pods running and handles updates. The checkout API Deployment might ask for three replicas of image `checkout-api:2026.07.04`.

A **Service** gives a stable internal network name to a changing set of Pods. Pods can be replaced during rollouts or failures, so other applications should call the Service name instead of individual Pod IPs.

An **Ingress** is a Kubernetes object for HTTP routing into Services. In GKE, Ingress can provision Google Cloud Application Load Balancers. Many newer platform designs also evaluate Gateway API, which gives a more expressive shared gateway model for HTTP routing.

Walk one request and one rollout through those objects. A user calls `https://commerce.example.com/checkout`. The Ingress or Gateway receives the HTTP route and points it at the `checkout-api` Service. The Service uses its selector, `app=checkout-api`, to find the current ready Pods. The caller uses the stable Service name while Kubernetes updates the Pod list behind it.

Now picture a release. The Deployment changes from image `2026.07.04` to `2026.07.05`. Kubernetes creates a new ReplicaSet for the new Pod template, starts new Pods, waits for their readiness probes, and reduces the old Pods after the new ones can receive traffic. If a node fails, the Deployment still owns the desired count, so replacement Pods are scheduled somewhere else. The Service keeps selecting Pods with `app=checkout-api`, so the route can keep pointing at the same Service while Pod membership changes underneath it.

The ownership chain is the key practical detail:

| Object | What it owns | Evidence a beginner can check |
|---|---|---|
| **Deployment** | Desired Pod template, replica count, rollout history | `kubectl rollout status deployment/checkout-api --namespace checkout` |
| **Pod** | One running copy of the app container and any helper containers | `kubectl get pods --namespace checkout --selector app=checkout-api` |
| **Service** | Stable internal name and selector for ready Pods | `kubectl describe service checkout-api --namespace checkout` |
| **Ingress or Gateway** | External HTTP route into a Service | `kubectl describe ingress checkout-api --namespace checkout` |

The basic request path now has clear layers:

| Layer | Commerce platform example | Job |
|---|---|---|
| **Ingress or Gateway** | `commerce.example.com/checkout` | Routes external HTTP traffic into the platform. |
| **Service** | `checkout-api.checkout.svc.cluster.local` | Gives the checkout app a stable internal name. |
| **Deployment** | `checkout-api` with three replicas | Manages rollout and desired replica count. |
| **Pod** | One app container plus a local proxy helper | Runs the actual application process. |

![Kubernetes request and rollout path through Deployment, Pods, Service, and Ingress](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/kubernetes-request-rollout-path.png)
*Ingress or Gateway routes to a Service, the Service selects Pods, and the Deployment manages the Pods through rollout.*

## Autopilot and Standard
<!-- section-summary: Autopilot shifts node management to Google, while Standard gives the platform team more direct node control. -->

GKE has two main operating modes: **Autopilot** and **Standard**. The mode decides how much node responsibility your team keeps.

**GKE Autopilot** lets the team submit Kubernetes workloads while Google manages nodes, scaling of worker capacity, and many infrastructure settings. Application and platform teams still own manifests, namespaces, policy, identity, resource requests, rollout health, and app behavior.

**GKE Standard** gives the platform team direct control over node pools. That can matter for special machine types, GPUs, local SSDs, privileged agents, custom node configuration, or migration patterns that already depend on node-level control.

| Decision area | Autopilot | Standard |
|---|---|---|
| **Node work** | Google manages nodes and many infrastructure defaults. | The platform team manages node pools and more infrastructure choices. |
| **Hardware control** | Good default for many services. | Broader control over machine families, accelerators, node labels, and taints. |
| **Security defaults** | Several hardening choices are managed by the platform. | More direct responsibility for cluster and node configuration. |
| **Cost review** | Focus on requested workload resources and Autopilot pricing. | Focus on node capacity, utilization, and unused headroom. |

For the commerce platform, Autopilot is a strong first choice if the team needs Kubernetes APIs and policy without a large node-operations burden. Standard is justified for real node-control requirements.

## A Multi-Service Platform Example
<!-- section-summary: GKE earns its complexity through shared platform policy, network rules, identity, and extensions across several services. -->

The commerce platform has enough shared rules to justify Kubernetes. The checkout API needs to call pricing and catalog. The fraud service needs restricted access to sensitive data. The platform team wants every service to carry labels, resource requests, health probes, network policy, logging sidecars or agents, and workload identity. A custom controller may register approved services with an internal portal.

Those requirements explain why GKE enters the design. The goal is not "run one container." The goal is a shared platform where many teams deploy through the same API and inherit the same guardrails.

The first useful manifest for the checkout API might combine namespace, service account, Deployment, Service, and Ingress:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: checkout
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout-api
  namespace: checkout
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: checkout
  labels:
    app: checkout-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      serviceAccountName: checkout-api
      containers:
        - name: app
          image: us-central1-docker.pkg.dev/commerce-prod/apps/checkout-api:2026.07.04
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: checkout-api
  namespace: checkout
spec:
  selector:
    app: checkout-api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout-api
  namespace: checkout
spec:
  rules:
    - host: commerce.example.com
      http:
        paths:
          - path: /checkout
            pathType: Prefix
            backend:
              service:
                name: checkout-api
                port:
                  number: 80
```

Important parts:

- The Namespace gives the checkout team a bounded area for resources and policy.
- The Kubernetes ServiceAccount identifies the workload inside the cluster.
- The Deployment asks for three replicas and defines the app container.
- The readiness probe tells Kubernetes whether a Pod can receive traffic.
- Resource requests give the scheduler capacity information.
- The Service gives other workloads a stable target.
- The Ingress defines the external HTTP route into the Service.

In production, the platform team would also add image digests, policy checks, secret handling, network policy, observability configuration, and a clearer Gateway API design if the organization has moved beyond Ingress.

## Rollout and Verification
<!-- section-summary: GKE rollout work checks the Deployment, Pods, Service, route, logs, and rollback path. -->

A normal release updates Kubernetes desired state and then watches whether the platform reaches it. The useful habit is to verify each layer instead of assuming that applying YAML means the app is healthy.

In GKE, a release has more layers than a single Cloud Run deploy. The manifest may apply successfully, yet the new Pods can still fail readiness checks, the Service selector can point at the wrong labels, the Ingress can route to the wrong backend, or the app can start and then fail on a dependency. A beginner should treat rollout verification as a walk down the request path, not as one green command.

For checkout, the release question is practical: did Kubernetes accept the desired state, did the Deployment create healthy Pods, does the Service still find those Pods, does the route still point at the Service, and do logs show the new version answering requests? Each command below answers one part of that chain.

```bash
gcloud container clusters get-credentials commerce-prod \
  --location=us-central1

kubectl apply -f k8s/checkout-api.yaml

kubectl rollout status deployment/checkout-api \
  --namespace checkout

kubectl get deployment,pods \
  --namespace checkout \
  --selector app=checkout-api

kubectl get service checkout-api \
  --namespace checkout

kubectl get ingress checkout-api \
  --namespace checkout

kubectl logs deployment/checkout-api \
  --namespace checkout \
  --container app \
  --tail=100
```

Important parts:

- `get-credentials` configures local `kubectl` access for the cluster.
- `kubectl apply` sends the desired state from the manifest.
- `rollout status` waits for the Deployment update to complete.
- The selector-based `get` checks the Deployment and Pods that share the app label.
- The explicit Service and Ingress checks prove the stable internal route and external route exist even if those objects use different labels.
- `logs` checks the app container output from the Deployment.

Healthy output should show the rollout completed and Pods ready:

```console
Fetching cluster endpoint and auth data.
kubeconfig entry generated for commerce-prod.
deployment.apps/checkout-api configured
deployment "checkout-api" successfully rolled out
deployment.apps/checkout-api   3/3     3            3           4m
pod/checkout-api-6f8f7d7d7b-2m9zx   1/1   Running   0   2m
service/checkout-api   ClusterIP   10.44.8.21   <none>   80/TCP   4m
NAME           CLASS    HOSTS                  ADDRESS        PORTS   AGE
checkout-api   <none>   checkout.example.com   203.0.113.42   80      4m
2026-07-04T10:14:07Z INFO checkout-api listening port=8080 version=2026.07.04
```

Rollback uses the Deployment history:

```bash
kubectl rollout undo deployment/checkout-api \
  --namespace checkout
```

Important parts:

- Kubernetes rolls the Deployment back to the previous Pod template revision.
- Operators should still watch readiness, logs, and downstream error rates after rollback.
- A good release record includes the image tag or digest, Deployment revision, and incident notes if rollback was needed.

![GKE rollout evidence board](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/gke-rollout-evidence.png)
*A GKE release review checks desired state, running Pods, stable Service routing, external route behavior, and application logs.*

## Workload Identity and Secrets
<!-- section-summary: Workload Identity Federation lets Kubernetes workloads call Google Cloud APIs without static service account keys. -->

GKE workloads often need Google Cloud APIs. The checkout API may read Secret Manager, publish to Pub/Sub, connect to Cloud SQL, or pull images from Artifact Registry. Static JSON service account keys inside Kubernetes Secrets are risky because they can leak and live too long.

**Workload Identity Federation for GKE** lets a Kubernetes ServiceAccount map to a Google Cloud IAM principal. The workload receives short-lived credentials through the GKE metadata server, so Google client libraries can call APIs without a downloaded key file.

A direct IAM principal binding can look like this:

```bash
kubectl create serviceaccount checkout-api \
  --namespace checkout

gcloud secrets add-iam-policy-binding payment-provider-token \
  --project=PROJECT_ID \
  --role=roles/secretmanager.secretAccessor \
  --member="principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/checkout/sa/checkout-api" \
  --condition=None
```

Important parts:

- The Kubernetes ServiceAccount name matches the workload identity used by the Deployment.
- The IAM member string names one project, namespace, and Kubernetes ServiceAccount.
- The role is granted on one secret, not the whole project, because the checkout API only needs the payment provider token.
- A wrong project number, namespace, or service account name can let the Pod run while Google API calls fail.

Verify the secret-level policy before trusting the rollout:

```bash
gcloud secrets get-iam-policy payment-provider-token \
  --project=PROJECT_ID \
  --format=yaml
```

Example output:

```yaml
bindings:
- members:
  - principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/checkout/sa/checkout-api
  role: roles/secretmanager.secretAccessor
```

That output proves the access sits on the specific secret. If the app later needs a second secret, grant the second secret explicitly and record why the workload needs it.

The path has four steps. The Pod runs with the Kubernetes ServiceAccount `checkout/checkout-api`. GKE represents that service account as an IAM principal string that includes the project number, namespace, and service account name. The GKE metadata server gives the Pod short-lived Google credentials for that principal. The application uses Google client libraries or ADC to call Secret Manager, and IAM decides whether that principal can access the requested secret version.

For the checkout API, the first useful secret check is a log line from the app after it reads the payment provider secret:

```bash
kubectl logs deployment/checkout-api \
  --namespace checkout \
  --container app \
  --tail=50
```

Good output should show the secret path and the Kubernetes service account while keeping the secret value out of logs:

```console
2026-07-04T10:42:10Z INFO secret access ok secret=projects/PROJECT_ID/secrets/payment-provider-token version=5 ksa=checkout/checkout-api
2026-07-04T10:42:11Z INFO checkout-api listening port=8080 revision=2026.07.04
```

The interpretation is practical. The Pod used its Kubernetes ServiceAccount, received credentials through the GKE metadata path, and passed the Secret Manager IAM check for the payment secret. If the log shows `PERMISSION_DENIED` for `secretmanager.versions.access`, the next review target is the IAM principal binding above, especially the project number, namespace, and service account name.

Secrets should stay in Secret Manager or a platform-approved secret path. The Kubernetes manifest should reference secret access through workload identity and application configuration rather than embedding raw secret values.

## Policy, Sidecars, and Custom Controllers
<!-- section-summary: GKE platform value often comes from shared policy, helper containers, and Kubernetes extensions. -->

GKE earns its complexity for platforms that use Kubernetes features across many services. **Kubernetes RBAC** controls who can read or change objects in the Kubernetes API. **NetworkPolicy** controls which workloads can talk to each other. Admission policy tools can reject unsafe manifests before they run.

For the commerce platform, RBAC can give the checkout on-call group read access to Pods and logs in the `checkout` namespace while keeping deployment changes in the release pipeline. The evidence is a permission check against the Kubernetes API:

```bash
kubectl auth can-i get pods \
  --namespace checkout \
  --subresource=log \
  --as=user:maya@example.com \
  --as-group=checkout-oncall

kubectl auth can-i update deployments \
  --namespace checkout \
  --as=user:maya@example.com \
  --as-group=checkout-oncall
```

Expected output:

```console
yes
no
```

The interpretation is direct. On-call can inspect logs during an incident, and normal Deployment changes still go through the reviewed release path.

Admission policy checks manifests before Pods run. A platform might require `owner` labels, resource requests, non-root containers, and approved image registries. A server-side dry run gives early evidence:

```bash
kubectl apply --dry-run=server -f k8s/checkout-api.yaml
```

Useful output should either accept the manifest or explain the policy failure:

```console
deployment.apps/checkout-api configured (server dry run)
```

If the output says an `owner` label is missing, the fix belongs in the manifest before the workload reaches the cluster. That review point is one reason teams choose GKE: the platform can enforce shared rules at the Kubernetes API instead of relying on every team to remember them.

A **sidecar** is a helper container inside the same Pod as the main app container. It shares the Pod's network context with the app. A platform might inject a service mesh proxy sidecar so traffic uses mutual TLS, shared retries, telemetry, or policy. Sidecars make sense for helper processes that belong tightly with the app runtime.

For checkout, a mesh sidecar such as `istio-proxy` can sit beside the `app` container. The app still listens on `8080`, while the sidecar handles mesh traffic policy and telemetry for calls to pricing and catalog. The evidence is visible on the Pod:

```bash
kubectl get pod checkout-api-6f8f7d7d7b-2m9zx \
  --namespace checkout \
  --output=jsonpath='{.spec.containers[*].name}'
```

Expected output:

```console
app istio-proxy
```

The sidecar justifies GKE for organizations that want the same helper behavior across many services. Cloud Run can run sidecars for some service designs. Kubernetes adds a broad API for injection, policy, rollout, and inspection across namespaces.

A **custom controller** extends Kubernetes behavior. It watches Kubernetes objects and takes action as desired state changes. The commerce platform might have a controller that registers approved Services in an internal catalog or applies standard alert rules based on labels.

One practical controller can watch Services with `platform.devpolaris.com/catalog=true` and create an internal `ServiceRegistration` record. Application teams keep using normal Kubernetes objects, and the controller keeps the service catalog aligned with cluster state.

```bash
kubectl get serviceregistration checkout-api \
  --namespace checkout \
  --output=yaml
```

Useful output:

```yaml
apiVersion: platform.devpolaris.com/v1
kind: ServiceRegistration
metadata:
  name: checkout-api
  namespace: checkout
spec:
  service: checkout-api
  owner: commerce-checkout
  route: https://commerce.example.com/checkout
status:
  registered: true
```

The controller example shows the platform value. GKE gives the team a place to add organization-specific behavior around normal workload objects. A simpler runtime is usually better for one service, while GKE earns its operating cost for many services that need the same RBAC, admission, sidecar, network, and controller rules.

A small NetworkPolicy shows the selector pattern:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-to-checkout
  namespace: checkout
spec:
  podSelector:
    matchLabels:
      app: checkout-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              team: web
      ports:
        - protocol: TCP
          port: 8080
```

Important parts:

- `podSelector` chooses the checkout Pods receiving traffic.
- `policyTypes: Ingress` controls inbound Pod traffic.
- `namespaceSelector` allows callers from approved namespaces.
- The port rule limits the allowed destination port.

These controls are the real GKE reason. A single simple service may not need them. A platform with many teams and shared rules often does.

## The Cloud Run Tradeoff
<!-- section-summary: Cloud Run is simpler for one container service, while GKE is stronger for teams that require Kubernetes platform features. -->

Cloud Run and GKE can coexist in one company. Cloud Run is a strong fit for a stateless container service that needs managed request scaling, traffic control, identity, and logs with less platform surface. GKE is a strong fit for teams that need Kubernetes APIs, shared policy, sidecars, mesh behavior, custom controllers, or cluster-level platform rules.

The tradeoff is easiest to explain through team responsibility. Cloud Run asks the team to package a container and configure the service. GKE asks the team to understand Kubernetes objects and the platform rules around them. That extra vocabulary can pay off for a shared platform, but it also creates more things a new team has to inspect during an incident.

For one checkout API, Cloud Run may be enough: container, endpoint, revision, traffic split, identity, logs. For a commerce platform with many teams, Kubernetes policy, namespace boundaries, mesh sidecars, and custom controllers may justify GKE. The service choice follows the operating contract the team wants to own.

Use this comparison after the workload is clear:

| Need | Usually simpler | Why |
|---|---|---|
| One HTTP container service | Cloud Run | Fewer Kubernetes objects and less platform operations work. |
| Many services with shared Kubernetes policy | GKE | Kubernetes gives a common API for workloads, networking, policy, and extensions. |
| Host-level VM control | Compute Engine | The workload needs a server, not an orchestration API. |
| Small event handler | Cloud Run functions | The job fits one handler and one trigger. |

The important discipline is avoiding GKE by habit. Choose it only for a real Kubernetes platform problem.

## Putting It All Together
<!-- section-summary: GKE is a platform choice for teams that intentionally want Kubernetes as the operating layer. -->

GKE is managed Kubernetes on Google Cloud. Kubernetes gives the desired-state API. GKE integrates that API with Google-managed control plane operations, node modes, networking, identity, logging, monitoring, and security controls.

The required vocabulary has a clear order. Kubernetes is the orchestration system. GKE is Google's managed Kubernetes service. A cluster is the resource boundary. The control plane accepts desired state. Nodes provide worker capacity. Pods run containers. Deployments manage Pod rollout. Services give stable internal networking. Ingress or Gateway routes HTTP traffic toward Services.

That vocabulary is worth learning for platforms that need it. For one simple service, Cloud Run may carry the workload with far less operating surface. For many services with shared platform rules, GKE gives the common language that lets teams deploy, route, secure, observe, and extend workloads together.

## References

- [Google Kubernetes Engine documentation](https://docs.cloud.google.com/kubernetes-engine/docs) - Official GKE documentation hub.
- [Deploying workloads](https://docs.cloud.google.com/kubernetes-engine/docs/get-started/deploy-workloads) - Official overview for deploying workloads on GKE clusters.
- [About cluster configuration choices](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/configuration-overview) - Official guide for GKE cluster configuration choices.
- [GKE Ingress for Application Load Balancers](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/ingress) - Official overview of GKE Ingress and load balancer behavior.
- [Authenticate to Google Cloud APIs from GKE workloads](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) - Official guide for Workload Identity Federation for GKE.
- [Control communication between Pods and Services using network policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/network-policy) - Official guide for GKE network policy enforcement.
