---
title: "Namespaces and kubectl Basics"
description: "Understand namespaces as API address scopes and follow kubectl from kubeconfig selection to authenticated HTTP requests, returned objects, and safe verification."
overview: "kubectl is a client for the Kubernetes API. Namespaces, kubeconfig contexts, selectors, and output flags determine which API objects a command reaches and how their data appears in the terminal."
tags: ["kubernetes", "namespaces", "kubectl", "kubeconfig", "api", "operations"]
order: 5
id: article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics
---

## Table of Contents

1. [What Are kubectl and a Namespace Doing?](#what-are-kubectl-and-a-namespace-doing)
2. [Why Is a Namespace Part of an Object's Address?](#why-is-a-namespace-part-of-an-objects-address)
3. [Which Controls Turn Namespace Scope into Isolation?](#which-controls-turn-namespace-scope-into-isolation)
4. [How Does Kubeconfig Choose the Destination and Identity?](#how-does-kubeconfig-choose-the-destination-and-identity)
5. [How Does a kubectl Command Become an API Request?](#how-does-a-kubectl-command-become-an-api-request)
6. [What Evidence Do get, describe, logs, and events Provide?](#what-evidence-do-get-describe-logs-and-events-provide)
7. [How Do Scope, Selectors, and Output Shape a Query?](#how-do-scope-selectors-and-output-shape-a-query)
8. [How Do You Confirm the Target and Permission Before a Change?](#how-do-you-confirm-the-target-and-permission-before-a-change)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

When you enter this command:

```bash
kubectl get pod checkout-api-7c8d9f4b6d-m2qwk -n commerce-prod
```

your shell starts a local program named `kubectl`. That program reads connection settings, authenticates to a Kubernetes API server, and asks the server for one Pod object. The important request is approximately:

```http
GET /api/v1/namespaces/commerce-prod/pods/checkout-api-7c8d9f4b6d-m2qwk
```

The API server returns a structured object. JSON is the clearest way to see its shape:

```json
{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {
    "name": "checkout-api-7c8d9f4b6d-m2qwk",
    "namespace": "commerce-prod",
    "uid": "1c91d4a8-2f8a-4d12-99f5-51bcb5cb0cc7"
  },
  "spec": {
    "nodeName": "worker-12",
    "containers": [
      {
        "name": "api",
        "image": "registry.example.com/checkout-api:4.8.2"
      }
    ]
  },
  "status": {
    "phase": "Running",
    "podIP": "10.42.7.19"
  }
}
```

The familiar terminal row is a selected presentation of that data:

```text
NAME                                  READY   STATUS    RESTARTS   AGE
checkout-api-7c8d9f4b6d-m2qwk        1/1     Running   0          18m
```

This gives the two ideas in the article a precise meaning:

- **`kubectl` is a Kubernetes API client.** It turns command-line arguments into authenticated API requests and formats the responses.
- **A namespace is an API scope.** For a namespaced resource, its namespace forms part of the resource's address and identity.

Keep these questions in view as you work through the lesson:

1. **What Are kubectl and a Namespace Doing?**
2. **Why Is a Namespace Part of an Object's Address?**
3. **Which Controls Turn Namespace Scope into Isolation?**
4. **How Does Kubeconfig Choose the Destination and Identity?**
5. **How Does a kubectl Command Become an API Request?**
6. **What Evidence Do get, describe, logs, and events Provide?**
7. **How Do Scope, Selectors, and Output Shape a Query?**
8. **How Do You Confirm the Target and Permission Before a Change?**

## What Are kubectl and a Namespace Doing?
<!-- section-summary: kubectl is an HTTP client for the Kubernetes API, while a namespace supplies part of the address for namespaced objects. -->

The API server sees a request with several coordinates: a destination cluster, an authenticated identity, an HTTP operation, an API group and version, a resource type, an optional namespace, an optional object name, and optional query parameters. `kubectl` gathers those coordinates from your command and local kubeconfig.

That is why a short command can do useful work. Some coordinates are typed directly, while the remaining coordinates come from saved client configuration and API discovery.

## Why Is a Namespace Part of an Object's Address?
<!-- section-summary: Namespace scope allows namespaced objects to reuse names safely because namespace contributes to their API identity. -->

A shared cluster may host hundreds of applications. Names such as `api`, `worker`, `config`, and `database` appear repeatedly because many teams use the same role names.

Kubernetes resolves that repetition by giving a namespaced object an identity with these coordinates:

```text
API group + resource type + namespace + name
```

Consider two high-traffic systems in one cluster:

- the payment platform has a Deployment named `api` in `payments-prod`;
- the product-search platform has a Deployment named `api` in `search-prod`.

Their names match, while their API addresses remain distinct:

```http
GET /apis/apps/v1/namespaces/payments-prod/deployments/api
GET /apis/apps/v1/namespaces/search-prod/deployments/api
```

Each address points to a separate object with its own UID, replica count, image, status, owner references, and update history. A request that leaves out the namespace has changed the address it is asking for.

### Core APIs and named API groups

Kubernetes exposes core resources under `/api`. Pods, Services, ConfigMaps, Secrets, and Namespaces use the core `v1` API:

```http
GET /api/v1/namespaces/payments-prod/pods
GET /api/v1/namespaces/payments-prod/services/checkout
GET /api/v1/namespaces
```

Resources in named API groups use `/apis/<group>/<version>`. Deployments belong to `apps/v1`, and RoleBindings belong to `rbac.authorization.k8s.io/v1`:

```http
GET /apis/apps/v1/namespaces/payments-prod/deployments/api
GET /apis/rbac.authorization.k8s.io/v1/namespaces/payments-prod/rolebindings
```

The plural path words matter. A YAML manifest says `kind: Deployment`; the REST resource is `deployments`. API discovery tells `kubectl` which names, short names, groups, versions, verbs, and scope the server currently supports.

### Namespaced and cluster-scoped resources

Namespace contributes to identity for resource types whose API scope is namespaced. Common examples include:

- Pods, Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs;
- Services, EndpointSlices, Ingresses, and NetworkPolicies;
- ConfigMaps, Secrets, ServiceAccounts, Roles, and RoleBindings;
- ResourceQuotas, LimitRanges, and PersistentVolumeClaims.

Cluster-scoped resources have one cluster-wide name scope. Their URLs place the resource directly after the API group and version. Nodes, PersistentVolumes, StorageClasses, ClusterRoles, ClusterRoleBindings, CustomResourceDefinitions, and Namespace objects are common examples:

```http
GET /api/v1/nodes/worker-12
GET /api/v1/persistentvolumes/media-archive-pv
GET /apis/storage.k8s.io/v1/storageclasses/fast-ssd
GET /api/v1/namespaces/payments-prod
```

The last path is especially useful: the Namespace object called `payments-prod` is cluster-scoped, while the objects assigned to `payments-prod` use that name in their namespaced paths.

You can ask the live API server how every discovered resource is scoped:

```bash
kubectl api-resources --namespaced=true
kubectl api-resources --namespaced=false
```

This is more reliable than memorising a fixed list because installed APIs and custom resources vary between clusters.

### One flat coordinate

Each namespaced object belongs to one namespace, and namespaces form a flat list. A team can create names such as `payments-dev` and `payments-prod`; the API stores both as sibling namespaces, and the hyphen remains part of each name.

Deleting a Namespace object starts deletion of the namespaced resources inside that scope. That makes namespace lifecycle a powerful administrative boundary and gives namespace deletion a wide effect.

Kubernetes creates four namespaces in a new cluster:

- `default` supplies the fallback scope for a namespaced request that leaves the namespace unspecified;
- `kube-system` holds objects created by Kubernetes system components;
- `kube-public` is reserved for data intended to have broad readability by convention;
- `kube-node-lease` holds Lease objects used for efficient node heartbeats.

Production workloads usually receive explicit namespaces with clear ownership. This keeps addresses, permissions, quotas, policies, and operational queries visible.

### Namespace scope also appears in Service discovery

A Service named `checkout` in `commerce-prod` receives a DNS name shaped like:

```text
checkout.commerce-prod.svc.cluster.local
```

A Pod in the same namespace can usually resolve the short name `checkout`. A Pod in another namespace can use `checkout.commerce-prod` or the full service name. The namespace therefore contributes to both the API address of the Service object and the DNS identity used by workloads.

![Studio Light infographic showing one production Kubernetes cluster, separate payments-prod and search-prod namespace panels that each contain Deployment api and Service api, their distinct REST API paths, namespace-scoped policy controls, and cluster-scoped Nodes, PersistentVolumes, and StorageClasses outside the panels](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/namespace-scope-map.png)

*The repeated object names are safe because namespace changes the API address. Cluster-scoped resources use one name scope for the whole cluster.*

## Which Controls Turn Namespace Scope into Isolation?
<!-- section-summary: Namespaces provide a shared coordinate that authorization, quota, networking, resource limits, and admission policies use to enforce separate concerns. -->

Namespace scope answers **which group of objects a request addresses**. Several Kubernetes control systems use that coordinate to enforce access, capacity, traffic, and workload rules.

This distinction matters because each control protects a different part of the cluster. A useful design names the responsibility of each control and checks that the cluster has an implementation capable of enforcing it.

### RBAC controls API actions

The API server authorizes a resource request using attributes such as:

```text
identity:  developer-alice
verb:      patch
group:     apps
resource:  deployments
namespace: payments-prod
name:      api
```

A Role describes allowed API verbs on resources. A RoleBinding connects those permissions to users, groups, or service accounts inside one namespace.

For example, the payments developers may inspect Deployments and Pods in `payments-prod` while the release service account may also patch the Deployment:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: workload-reader
  namespace: payments-prod
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-developers-read
  namespace: payments-prod
subjects:
  - kind: Group
    name: payments-developers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: workload-reader
  apiGroup: rbac.authorization.k8s.io
```

The namespace on the RoleBinding defines where that grant has effect. A ClusterRole can supply a reusable permission template, and a RoleBinding can grant that template inside one namespace.

### ResourceQuota controls the namespace total

A ResourceQuota measures aggregate use by objects in one namespace. A streaming platform could give its transcoding namespace a larger compute budget than its internal administration tools while both share the same nodes:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: transcode-budget
  namespace: video-transcoding
spec:
  hard:
    requests.cpu: "120"
    requests.memory: 256Gi
    limits.cpu: "240"
    limits.memory: 512Gi
    pods: "300"
```

The API server checks the namespace's recorded usage when a new request would consume quota. Adding a node to the cluster changes cluster capacity; the quota values remain the explicit budget until an administrator updates them.

### LimitRange controls one object at a time

ResourceQuota asks, “How much may this whole namespace consume?” LimitRange asks, “What resource shape may one Pod, container, or claim request?”

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: container-bounds
  namespace: video-transcoding
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 500m
        memory: 512Mi
      default:
        cpu: "2"
        memory: 2Gi
      max:
        cpu: "8"
        memory: 16Gi
```

This policy can supply defaults and reject a container request that exceeds the accepted per-container range. The quota and the LimitRange work together: one protects the namespace total, while the other keeps each object within a usable shape.

### NetworkPolicy controls selected Pod traffic

A NetworkPolicy selects Pods in its own namespace and describes allowed ingress or egress traffic. For a banking payment-authorisation service, a policy could accept requests from the API gateway and allow database traffic to a specific database endpoint while reducing unrelated east-west connections.

NetworkPolicy enforcement comes from the cluster's network implementation. Platform verification therefore includes checking that the installed CNI or network provider implements the policies exposed through the API.

### Pod Security Admission checks Pod specifications

Pod Security Admission can read labels on a Namespace object and evaluate new Pods against the `privileged`, `baseline`, or `restricted` Pod Security Standard:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.36
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.36
```

With `enforce`, a Pod request that violates the selected standard is rejected during admission. `warn` returns a warning to the client. Pinning the policy version makes the rule set explicit during cluster upgrades.

These controls fit around the same namespace coordinate:

| Concern | Kubernetes mechanism | Concrete question |
|---|---|---|
| API access | Role and RoleBinding | May this identity read `pods/log` in `payments-prod`? |
| Aggregate capacity | ResourceQuota | May objects in `video-transcoding` request more CPU? |
| Per-object resource shape | LimitRange | Is this container's memory request inside the accepted range? |
| Pod traffic | NetworkPolicy | May these selected Pods receive traffic from the gateway Pods? |
| Pod configuration | Pod Security Admission | Does this new Pod satisfy the namespace's security profile? |

The namespace gives all five questions a shared scope. The mechanisms supply the actual decisions.

## How Does Kubeconfig Choose the Destination and Identity?
<!-- section-summary: kubeconfig stores cluster endpoints, authentication entries, and contexts that combine a cluster, user, and default namespace for kubectl. -->

Before `kubectl` can build a resource URL, it must know which API server should receive the request and which credentials should authenticate it.

A kubeconfig file stores three separate kinds of information:

1. a **cluster entry** explains where the API server is and how to verify its TLS certificate;
2. a **user entry** explains how the client obtains or presents credentials;
3. a **context** chooses one cluster entry, one user entry, and an optional namespace preference.

Here is a compact kubeconfig with staging and production contexts:

```yaml
apiVersion: v1
kind: Config

clusters:
  - name: platform-staging-eu
    cluster:
      server: https://api.staging-eu.example.com:6443
      certificate-authority: /Users/alice/.kube/staging-eu-ca.crt
  - name: platform-prod-eu
    cluster:
      server: https://api.prod-eu.example.com:6443
      certificate-authority: /Users/alice/.kube/prod-eu-ca.crt

users:
  - name: alice-staging
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: corp-k8s-login
        args: ["token", "--environment", "staging"]
  - name: alice-prod
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: corp-k8s-login
        args: ["token", "--environment", "production"]

contexts:
  - name: catalog-staging
    context:
      cluster: platform-staging-eu
      user: alice-staging
      namespace: catalog-staging
  - name: catalog-prod
    context:
      cluster: platform-prod-eu
      user: alice-prod
      namespace: catalog-prod

current-context: catalog-staging
```

The context name is a local convenience. The API server bases its decision on the authenticated identity produced by the user entry, while `catalog-prod` remains a client-side label.

### Resolving one command

Suppose the current context is `catalog-staging`:

```bash
kubectl get deployment search-indexer
```

`kubectl` resolves the command in this order:

1. read the chosen kubeconfig data;
2. find `current-context: catalog-staging`;
3. follow that context to cluster `platform-staging-eu`;
4. follow it to user entry `alice-staging`;
5. use `catalog-staging` as the namespace preference;
6. construct the Deployment request and send it to the staging API server.

The resulting resource path is approximately:

```http
GET /apis/apps/v1/namespaces/catalog-staging/deployments/search-indexer
```

The cluster entry contributes the network destination and TLS trust. The user entry contributes authentication. The context contributes the selected references and a namespace default.

### One-command overrides

Flags can replace context-derived choices for one invocation:

```bash
kubectl get deployment search-indexer \
  --context catalog-prod \
  -n catalog-prod
```

`--context catalog-prod` selects the production cluster and user references. `-n catalog-prod` selects the namespace for this resource request. The saved `current-context` stays `catalog-staging`.

This command changes the namespace preference stored in the current context:

```bash
kubectl config set-context --current --namespace=catalog-staging
```

That operation edits local kubeconfig data. Cluster state and Namespace objects remain unchanged.

### Finding and inspecting kubeconfig

By default, `kubectl` reads `$HOME/.kube/config`. The `KUBECONFIG` environment variable can name one or more files, and `--kubeconfig` can select a specific file for a command.

Treat kubeconfig as executable-capable configuration. An `exec` credential plugin can run a local command, and file references can read local data. A kubeconfig from another person or downloaded source deserves the same review as a script before use.

These commands expose the resolved target:

```bash
kubectl config current-context
kubectl config get-contexts
kubectl config view --minify
```

`config view --minify` is especially useful because it shows the cluster, user entry, and namespace selected by the current context.

![Studio Light infographic showing a trusted kubeconfig with cluster, user, and context entries; current-context catalog-staging; optional --context catalog-prod and -n catalog-prod overrides; and the resolved API server, authenticated user, namespace, and Deployment request](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubeconfig-context-target.png)

*The context resolves three independent request choices. Command flags can replace the context or namespace for one request while the saved current context stays unchanged.*

## How Does a kubectl Command Become an API Request?
<!-- section-summary: kubectl parses command arguments, discovers the server's resources, resolves request coordinates, and translates the operation into an authenticated Kubernetes API call. -->

The common command shape is:

```text
kubectl <operation> <resource type> <optional name> <flags>
```

For example:

```bash
kubectl get deployment catalog-api -n commerce-prod -o yaml
```

The pieces have separate jobs:

- `get` selects a read operation;
- `deployment` identifies the API resource type;
- `catalog-api` identifies one object in that resource collection;
- `-n commerce-prod` supplies the namespaced scope;
- `-o yaml` chooses how the response will be presented.

### Discovery connects a friendly type to a REST resource

`kubectl` uses API discovery from the server to learn that `deployment`, `deploy`, and `deployments.apps` refer to the `deployments` resource in the `apps` API group. Discovery also reports the preferred version, whether the resource is namespaced, and which verbs the endpoint supports.

You can inspect the same information:

```bash
kubectl api-resources
kubectl api-resources --api-group=apps
kubectl explain deployment
kubectl explain deployment.spec.strategy
```

`kubectl explain` reads the schema published for the resource. It connects manifest fields to the API contract accepted by the current cluster.

### Reads use GET

This command asks for one Deployment:

```bash
kubectl get deployment catalog-api -n commerce-prod
```

Its important HTTP request is:

```http
GET /apis/apps/v1/namespaces/commerce-prod/deployments/catalog-api
```

Listing the collection stops at the plural resource path:

```bash
kubectl get deployments -n commerce-prod
```

```http
GET /apis/apps/v1/namespaces/commerce-prod/deployments
```

The first response is a Deployment object. The second is a DeploymentList containing zero or more objects.

### Creation uses POST to a collection

Given this manifest:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: catalog-runtime
  namespace: commerce-prod
data:
  SEARCH_TIMEOUT_MS: "450"
  MAX_RESULTS: "80"
```

this command:

```bash
kubectl create -f catalog-runtime.yaml
```

corresponds to a request shaped like:

```http
POST /api/v1/namespaces/commerce-prod/configmaps
Content-Type: application/json

{
  "apiVersion": "v1",
  "kind": "ConfigMap",
  "metadata": {
    "name": "catalog-runtime",
    "namespace": "commerce-prod"
  },
  "data": {
    "SEARCH_TIMEOUT_MS": "450",
    "MAX_RESULTS": "80"
  }
}
```

The collection URL says where new ConfigMaps live. The JSON body supplies the new object's desired fields. YAML is the human-authored form; `kubectl` serializes the request for the API.

### Updates and subresources use focused endpoints

Kubernetes supports PUT and PATCH for updates. Commands often use specialised subresources when the API provides them.

Scaling a Deployment targets its `scale` subresource:

```bash
kubectl scale deployment/catalog-api \
  --replicas=12 \
  -n commerce-prod
```

The request is shaped around this endpoint:

```http
PATCH /apis/apps/v1/namespaces/commerce-prod/deployments/catalog-api/scale
```

The stored desired replica count changes first. The Deployment and ReplicaSet controllers observe that new desired state and create Pods through later API operations. `kubectl` completes its request while reconciliation continues inside the cluster.

Container logs also use a subresource:

```bash
kubectl logs pod/catalog-api-6f5887bc8f-pzv4k \
  -c api \
  -n commerce-prod
```

```http
GET /api/v1/namespaces/commerce-prod/pods/catalog-api-6f5887bc8f-pzv4k/log?container=api
```

This endpoint returns a log stream, while a normal Pod GET returns the Pod object.

### The API server applies the cluster contract

For a resource request, the API server performs several distinct jobs:

1. authenticate the presented credentials;
2. authorize the verb, resource, namespace, name, and subresource;
3. decode and validate the submitted data;
4. run applicable admission controls for write requests;
5. read or persist the API object through the storage layer;
6. return a structured success or error response.

The command-line client prepares the request. The API server owns the authoritative cluster API behavior.

For learning or troubleshooting, higher verbosity exposes request details:

```bash
kubectl get deployment catalog-api \
  -n commerce-prod \
  --v=8
```

Verbose output may include server URLs, response status, and timing. Review shared logs before publishing them because authentication and environment details can be sensitive.

![Studio Light infographic tracing kubectl get, create, scale, and logs commands through kubeconfig resolution, API discovery, HTTPS method and resource path construction, authentication, authorization and admission, then API object or log responses](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubectl-inspection-path.png)

*Different commands still follow the same client-to-API path. The HTTP method, resource URL, body, and response type change with the requested operation.*

## What Evidence Do get, describe, logs, and events Provide?
<!-- section-summary: get, describe, logs, and events expose different evidence sources, so each command should answer a specific question about an object or process. -->

Kubernetes spreads operational evidence across API objects, status fields, events, and container output. Four common commands open different views of that evidence.

Consider a checkout Deployment whose desired replica count is six. Five replicas are available:

```bash
kubectl get deployment checkout-api -n commerce-prod
```

```text
NAME           READY   UP-TO-DATE   AVAILABLE   AGE
checkout-api   5/6     6            5           41d
```

This row establishes the gap:

```text
Desired replicas:   6
Ready replicas:     5
Available replicas: 5
Question:           Which Pod is missing readiness, and why?
```

### `get` reads objects and collections

First, list the Pods selected by the application label:

```bash
kubectl get pods \
  -n commerce-prod \
  -l app.kubernetes.io/name=checkout-api \
  -o wide
```

```text
NAME                            READY   STATUS             RESTARTS   AGE   IP          NODE
checkout-api-7c8d9f4b6d-4j7kx  1/1     Running            0          18m   10.42.7.21  worker-12
checkout-api-7c8d9f4b6d-8wdzt  1/1     Running            0          18m   10.42.5.10  worker-09
checkout-api-7c8d9f4b6d-c6m9p  0/1     ImagePullBackOff   0          18m   10.42.6.14  worker-11
checkout-api-7c8d9f4b6d-h4lq2  1/1     Running            0          18m   10.42.4.29  worker-08
checkout-api-7c8d9f4b6d-m2qwk  1/1     Running            0          18m   10.42.7.19  worker-12
checkout-api-7c8d9f4b6d-z9nfb  1/1     Running            0          18m   10.42.5.12  worker-09
```

The collection narrows the replica gap to one Pod. `get` works well for inventory, status summaries, and machine-readable objects.

### `describe` assembles a human-oriented explanation

Now inspect the Pod with the pull failure:

```bash
kubectl describe pod checkout-api-7c8d9f4b6d-c6m9p \
  -n commerce-prod
```

Relevant output might include:

```text
Containers:
  api:
    Image: registry.example.com/checkout-api:4.8.3
    State: Waiting
      Reason: ImagePullBackOff

Events:
  Type     Reason   Message
  ----     ------   -------
  Warning  Failed   Failed to pull image "registry.example.com/checkout-api:4.8.3": manifest unknown
```

`describe` presents selected fields, conditions, ownership, volume information, and related events in a form designed for a person. It is a diagnostic view assembled by `kubectl`; `get -o yaml` or `get -o json` exposes the serialized API object.

### `logs` reads process output from a container

For a running Pod whose application returns errors, inspect the application process output:

```bash
kubectl logs pod/checkout-api-7c8d9f4b6d-m2qwk \
  -n commerce-prod \
  -c api \
  --tail=100
```

Important variants include:

```bash
kubectl logs pod/checkout-api-7c8d9f4b6d-m2qwk -n commerce-prod -c api -f
kubectl logs pod/checkout-api-7c8d9f4b6d-m2qwk -n commerce-prod -c api --previous
```

`-f` follows new output. `--previous` reads the previous container instance after a restart, which often preserves the process's exit message.

A Pod with multiple containers requires `-c <container>` or an all-container option so the source of each line stays clear.

### `events` reads observations reported by Kubernetes components

Events record recent observations from components such as the scheduler, kubelet, controllers, and admission integrations:

```bash
kubectl events \
  -n commerce-prod \
  --for pod/checkout-api-7c8d9f4b6d-c6m9p
```

```text
LAST SEEN   TYPE      REASON    OBJECT                                      MESSAGE
34s         Warning   Failed    Pod/checkout-api-7c8d9f4b6d-c6m9p          Failed to pull image ... manifest unknown
19s         Normal    BackOff   Pod/checkout-api-7c8d9f4b6d-c6m9p          Back-off pulling image ...
```

Events are namespaced objects with limited retention. They are useful evidence for recent scheduling, image pull, volume, probe, and controller actions. Long-term operational history belongs in a dedicated observability system.

The four views answer different questions:

| Command | Primary evidence | Example question |
|---|---|---|
| `get` | API objects, collections, status summaries | Which replica is unready? |
| `describe` | Human-oriented object details and related events | Which condition or recent event explains this Pod's state? |
| `logs` | Container stdout and stderr | What did the application process report? |
| `events` | Recent component observations | What did the scheduler, kubelet, or controller observe? |

Start with the narrowest missing fact, then choose the evidence source that owns it.

## How Do Scope, Selectors, and Output Shape a Query?
<!-- section-summary: Namespace flags choose API scope, selectors filter a collection on the server, and output flags choose how returned objects are represented. -->

A `kubectl get` command can answer three independent questions:

1. **Where should the API look?** The context and namespace choose the cluster and scope.
2. **Which objects in that scope should match?** A name, label selector, or field selector narrows the resource collection.
3. **How should the response appear?** The output option selects a table, complete object, or chosen fields.

Keeping those questions separate makes long commands much easier to read.

### Namespace chooses the collection

This command lists Pods in one namespace:

```bash
kubectl get pods -n video-prod
```

Its collection path is:

```http
GET /api/v1/namespaces/video-prod/pods
```

This command asks for Pods across namespace scopes:

```bash
kubectl get pods --all-namespaces
```

The API uses the cluster-level collection URL for a namespaced resource:

```http
GET /api/v1/pods
```

The returned Pod objects still carry their individual `metadata.namespace` values.

### Labels select operational groups

Labels are key-value metadata designed for grouping and selection. A video platform might label transcoding Pods like this:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: transcoder
    app.kubernetes.io/component: worker
    release-track: stable
    region: eu-west
```

Select the stable workers in one region:

```bash
kubectl get pods \
  -n video-prod \
  -l 'app.kubernetes.io/name=transcoder,release-track=stable,region=eu-west'
```

Comma-separated requirements use logical AND. Set-based selectors can express multiple acceptable values:

```bash
kubectl get pods \
  -n video-prod \
  -l 'app.kubernetes.io/name=transcoder,release-track in (stable,canary)'
```

At the HTTP layer, `kubectl` adds an encoded `labelSelector` query parameter to the Pod collection request.

Labels describe identities and operational groupings chosen by your platform. Kubernetes also uses label selectors inside resources: a Service selects its backend Pods, and a Deployment selects the Pods managed through its ReplicaSets.

### Field selectors query supported object fields

Field selectors filter on a supported field from the resource schema:

```bash
kubectl get pods \
  -n video-prod \
  --field-selector=status.phase=Pending
```

All resources support `metadata.name` and `metadata.namespace`; additional supported fields vary by resource type. Pods support useful fields such as `spec.nodeName`, `spec.serviceAccountName`, and `status.phase`.

Labels and fields answer different questions:

- `-l release-track=canary` selects an operational category your team assigned;
- `--field-selector=status.phase=Pending` selects a current field value defined by the Pod API.

The API server rejects an unsupported field selector, which makes `kubectl` output more trustworthy than a client-side text filter over formatted rows.

### Output chooses a representation

The default `get` output is a compact table for a person. Kubernetes can also return a Table representation from the server, which lets built-in resources and custom resources define meaningful columns.

Use `-o wide` when the built-in table has useful extra columns:

```bash
kubectl get pods -n video-prod -o wide
```

Use YAML or JSON when you need the complete API object:

```bash
kubectl get deployment transcoder -n video-prod -o yaml
kubectl get deployment transcoder -n video-prod -o json
```

The output contains `metadata`, `spec`, and `status`. Managed metadata can be large, so inspect the specific fields that answer your question.

Use custom columns for a stable, readable team view:

```bash
kubectl get pods \
  -n video-prod \
  -l app.kubernetes.io/name=transcoder \
  -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase,IMAGE:.spec.containers[0].image'
```

```text
NAME                            NODE        PHASE     IMAGE
transcoder-6c7d88f9b5-4xj9v     worker-21   Running   registry.example.com/transcoder:8.4.1
transcoder-6c7d88f9b5-bt28p     worker-18   Running   registry.example.com/transcoder:8.4.1
```

Use JSONPath when a script needs exact fields:

```bash
kubectl get deployment transcoder \
  -n video-prod \
  -o jsonpath='{.spec.replicas}{"\t"}{.status.availableReplicas}{"\n"}'
```

```text
24    24
```

The shell quotes are part of the command-line layer. The JSONPath expression selects fields from the structured API response.

A long query can now be read one layer at a time:

```bash
kubectl get pods \
  --context video-prod-eu \
  -n video-prod \
  -l 'app.kubernetes.io/name=transcoder,release-track=canary' \
  --field-selector=status.phase=Running \
  -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,IMAGE:.spec.containers[0].image'
```

- `--context` chooses the cluster and user references;
- `-n` chooses the namespaced Pod collection;
- `-l` selects the canary transcoder population;
- `--field-selector` keeps Running Pods;
- `-o custom-columns` selects the terminal representation.

## How Do You Confirm the Target and Permission Before a Change?
<!-- section-summary: Safe kubectl work exposes the resolved context and namespace, checks authorization, previews writes, and verifies the resulting object state. -->

A valid command can still target an unexpected cluster or namespace. The safest workflow makes the destination, identity permissions, intended change, and resulting object visible.

### Confirm the resolved target

Start with the context name:

```bash
kubectl config current-context
```

Then inspect the selected cluster, user entry, and namespace preference:

```bash
kubectl config view --minify
```

For a compact namespace value:

```bash
kubectl config view --minify \
  -o jsonpath='{..namespace}{"\n"}'
```

An empty namespace preference means namespaced commands fall back to `default` unless a flag or object manifest supplies another namespace. Operational scripts are clearer when they pass `--context` and `--namespace` explicitly.

### Ask the authorizer about the exact operation

Check access before the main request:

```bash
kubectl auth can-i patch deployments \
  --context payments-prod-eu \
  -n payments-prod
```

Subresources have their own authorization coordinates. Reading logs can be checked as:

```bash
kubectl auth can-i get pods/log \
  --context payments-prod-eu \
  -n payments-prod
```

The answer comes from the cluster's authorization configuration for the selected identity and scope. It is stronger evidence than assuming permissions from a job title or kubeconfig filename.

### Read the current object before writing

Suppose the payment-authorisation API needs to move from 18 to 24 replicas. Read the relevant fields first:

```bash
kubectl get deployment authorization-api \
  --context payments-prod-eu \
  -n payments-prod \
  -o custom-columns='NAME:.metadata.name,DESIRED:.spec.replicas,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[0].image'
```

```text
NAME                DESIRED   READY   IMAGE
authorization-api   18        18      registry.example.com/authorization-api:7.2.0
```

Now the intended change has a known starting point.

For manifest-based work, ask the API server to validate a dry-run request:

```bash
kubectl apply \
  --server-side \
  --dry-run=server \
  --context payments-prod-eu \
  -n payments-prod \
  -f authorization-api.yaml
```

`--dry-run=server` runs the request through server-side validation and admission while avoiding persistence. `kubectl diff` can also compare a manifest with the live object before an apply.

### Make the change and verify reconciliation

For the replica update:

```bash
kubectl scale deployment/authorization-api \
  --replicas=24 \
  --context payments-prod-eu \
  -n payments-prod
```

The API response confirms that the desired replica field was accepted. Controllers and worker nodes still need time to produce the additional ready Pods.

Verify both the desired-state object and the rollout result:

```bash
kubectl get deployment authorization-api \
  --context payments-prod-eu \
  -n payments-prod

kubectl rollout status deployment/authorization-api \
  --context payments-prod-eu \
  -n payments-prod \
  --timeout=5m
```

This closes the loop:

```text
Resolved target:  payments-prod-eu / payments-prod
Permission check: patch deployments = yes
Starting state:   desired 18, ready 18
Requested state:  desired 24
Observed result:  desired 24, ready 24
```

### Read errors as API evidence

Different failures identify different layers:

- **connection or TLS errors** mean the trusted connection to the selected API server failed;
- **401 Unauthorized** means the request arrived without an accepted identity;
- **403 Forbidden** means the API server recognized the request and the authorizer denied the operation;
- **404 NotFound** means the requested resource address resolved to zero accessible objects, commonly because the namespace, resource type, or name differs;
- **admission rejection** means authorization succeeded and a write policy rejected the proposed object;
- **successful write with slow readiness** means the API accepted desired state and reconciliation still needs investigation.

These categories keep troubleshooting attached to the layer that produced the response.

## Check Your Answers
<!-- section-summary: Revisit namespace addressing, policy enforcement, kubeconfig resolution, HTTP translation, evidence sources, query shaping, and safe verification. -->

:::expand[What Are kubectl and a Namespace Doing?]{kind="recap"}
`kubectl` reads local connection settings and command arguments, sends authenticated requests to the Kubernetes API, and formats the responses. A namespace contributes to the identity and URL of a namespaced object. `kubectl get pod checkout-api-... -n commerce-prod` therefore maps to a GET request under `/api/v1/namespaces/commerce-prod/pods/...` and receives a structured Pod object.
:::

:::expand[Why Is a Namespace Part of an Object's Address?]{kind="recap"}
Large clusters reuse names such as `api`, `worker`, and `config`. Namespace gives each namespaced object a separate address: the Deployments `payments-prod/api` and `search-prod/api` have different REST URLs, UIDs, specifications, and status. Cluster-scoped resources such as Nodes and StorageClasses omit the namespace segment and use one cluster-wide name scope.
:::

:::expand[Which Controls Turn Namespace Scope into Isolation?]{kind="recap"}
RBAC authorizes API actions, ResourceQuota limits aggregate namespace use, LimitRange sets per-object resource bounds or defaults, NetworkPolicy describes allowed Pod traffic, and Pod Security Admission evaluates Pod specifications against a selected security profile. Namespace supplies the shared coordinate; each mechanism enforces its own concern.
:::

:::expand[How Does Kubeconfig Choose the Destination and Identity?]{kind="recap"}
A kubeconfig cluster entry supplies the API server and TLS trust, a user entry supplies authentication behavior, and a context chooses one cluster, one user, and an optional namespace preference. `current-context` selects the default context. `--context` and `-n` can replace context-derived choices for one command, while `config set-context` edits local client configuration.
:::

:::expand[How Does a kubectl Command Become an API Request?]{kind="recap"}
`kubectl` parses the operation, resource type, name, and flags; uses API discovery to resolve the resource and scope; resolves kubeconfig connection settings; then builds the HTTP request. Reads use GET, creation posts an object body to a collection, scaling uses a Deployment scale subresource, and logs use a Pod log subresource. The API server authenticates, authorizes, validates, runs admission for writes, and returns a structured response.
:::

:::expand[What Evidence Do get, describe, logs, and events Provide?]{kind="recap"}
`get` reads objects, collections, and status summaries. `describe` assembles a human-oriented view of fields, conditions, ownership, and related events. `logs` reads stdout and stderr from a selected container. `events` reads recent observations from Kubernetes components. Choose the command whose evidence source owns the missing fact.
:::

:::expand[How Do Scope, Selectors, and Output Shape a Query?]{kind="recap"}
Context and namespace choose the destination and resource collection. A name, label selector, or field selector narrows the matching objects. Output flags choose the representation: default or wide tables for a quick scan, YAML or JSON for the complete object, custom columns for a selected table, and JSONPath for exact fields used by scripts.
:::

:::expand[How Do You Confirm the Target and Permission Before a Change?]{kind="recap"}
Expose the current context with `kubectl config current-context` and the resolved cluster, user entry, and namespace with `kubectl config view --minify`. Check the exact authorization tuple with `kubectl auth can-i`, read the current object, use server dry-run or diff where appropriate, make the scoped change, and verify both the stored desired state and the reconciled result.
:::

## References
<!-- section-summary: Current Kubernetes documentation defines namespace scope, API resource paths, kubeconfig contexts, authorization, policies, selectors, output formats, and kubectl operations. -->

- [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
- [Object Names and IDs](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/)
- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/)
- [Organizing Cluster Access Using kubeconfig Files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [kubeconfig (v1) API](https://kubernetes.io/docs/reference/config-api/kubeconfig.v1/)
- [Command line tool (kubectl)](https://kubernetes.io/docs/reference/kubectl/)
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/)
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/)
- [kubectl events](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/)
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/)
- [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
- [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/)
- [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
- [Field Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/field-selectors/)
- [JSONPath Support](https://kubernetes.io/docs/reference/kubectl/jsonpath/)
