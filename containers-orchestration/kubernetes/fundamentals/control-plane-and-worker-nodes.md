---
title: "Control Plane and Worker Nodes"
description: "Understand how the API server, etcd, controllers, scheduler, kubelet, container runtime, and node agents cooperate to run applications."
overview: "Kubernetes separates cluster-wide coordination from machine-local execution. This article explains why that boundary exists, how independent components cooperate through API records, and what continues when one component becomes unavailable."
tags: ["kubernetes", "control-plane", "nodes", "kubelet"]
order: 3
id: article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes
aliases:
  - containers-orchestration/orchestration-k8s/k8s-architecture.md
  - article-containers-orchestration-orchestration-k8s-k8s-architecture
---

## Table of Contents

1. [What Are the Control Plane and Worker Nodes in Plain Terms?](#what-are-the-control-plane-and-worker-nodes-in-plain-terms)
2. [Why Does Kubernetes Separate Coordination from Execution?](#why-does-kubernetes-separate-coordination-from-execution)
3. [How Does an API Request Become Shared Cluster State?](#how-does-an-api-request-become-shared-cluster-state)
4. [Why Does Kubernetes Need etcd?](#why-does-kubernetes-need-etcd)
5. [How Do Controllers and the Scheduler Divide the Work?](#how-do-controllers-and-the-scheduler-divide-the-work)
6. [How Does a Worker Node Turn a Pod Record into a Running Process?](#how-does-a-worker-node-turn-a-pod-record-into-a-running-process)
7. [How Does the Cluster Learn What Happened on the Worker?](#how-does-the-cluster-learn-what-happened-on-the-worker)
8. [What Continues When a Component Fails, and How Do You Find the Boundary?](#what-continues-when-a-component-fails-and-how-do-you-find-the-boundary)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The previous article followed one application through its Deployment, ReplicaSet, Pods, Service, EndpointSlices, and Nodes. Those objects describe the application and its relationships. This article looks at the software components that read those objects and make the requested system real.

**The control plane is the cluster's coordination system. Worker nodes are the machines that execute application work.**

The distinction begins with two kinds of work:

- **Coordination work** accepts an application request, stores it, creates the required Kubernetes objects, chooses a suitable machine, and keeps an up-to-date view of the cluster.
- **Execution work** pulls images, prepares storage and networking, starts containers, checks their health, and reports what happened on one machine.

Kubernetes needs both areas even for the simplest multi-node cluster. A request such as “keep six copies of this Pod template running” must remain available after `kubectl` exits and after individual control-plane processes restart. Meeting that request requires a view across the whole cluster: current Pods, free resources, placement rules, and Node health. Starting one of those Pods requires a different kind of access: direct contact with one machine's container runtime, storage mounts, network setup, and operating system.

Keep these questions in view as you work through the lesson:

1. **What Are the Control Plane and Worker Nodes in Plain Terms?**
2. **Why Does Kubernetes Separate Coordination from Execution?**
3. **How Does an API Request Become Shared Cluster State?**
4. **Why Does Kubernetes Need etcd?**
5. **How Do Controllers and the Scheduler Divide the Work?**
6. **How Does a Worker Node Turn a Pod Record into a Running Process?**
7. **How Does the Cluster Learn What Happened on the Worker?**
8. **What Continues When a Component Fails, and How Do You Find the Boundary?**

## What Are the Control Plane and Worker Nodes in Plain Terms?
<!-- section-summary: The control plane stores intent and coordinates cluster-wide decisions; worker nodes supply the machines and local agents that run application processes. -->

The control-plane-to-node path produces a natural chain of responsibility. The API server accepts and stores the requested object. Controllers create the dependent objects needed to represent the requested population. The scheduler gives each unscheduled Pod one Node assignment. The kubelet on that Node coordinates local execution and returns observations through the API. Each component completes one part of the work and leaves a durable result for the next component to observe.

The main components fit into these two areas:

| Area | Component | Plain-English responsibility |
| --- | --- | --- |
| Control plane | **API server** | Provides the authenticated HTTP API and coordinates access to Kubernetes objects |
| Control plane | **etcd** | Preserves the authoritative API data with consistent ordering |
| Control plane | **Controller manager** | Runs reconciliation loops that create and update objects |
| Control plane | **Scheduler** | Chooses a feasible worker for each unscheduled Pod |
| Control plane | **Cloud controller manager** | Optionally connects Kubernetes objects to cloud load balancers, routes, Nodes, and volumes |
| Worker node | **kubelet** | Coordinates Pods assigned to one machine and reports their state |
| Worker node | **Container runtime** | Creates Pod sandboxes and runs containers through the Container Runtime Interface |
| Worker node | **Network and storage integrations** | Give Pods network connectivity and attach declared storage |
| Worker node | **Service data-plane agent** | Optionally programs local Service forwarding; some clusters use eBPF-based replacements |

The components are separate processes with narrow responsibilities. They cooperate through durable API records instead of relying on one long-running command to complete the whole sequence.

## Why Does Kubernetes Separate Coordination from Execution?
<!-- section-summary: Separating cluster-wide decisions from machine-local execution lets each component recover independently and keeps application traffic outside the control plane. -->

A cluster may contain hundreds or thousands of machines. A decision such as “which worker should receive this Pod?” needs a cluster-wide view of resource requests, placement constraints, storage topology, and Node health. An action such as “start this container on `worker-17`” needs local access to that machine's runtime, filesystems, network namespaces, and kernel.

Combining both jobs inside one central process would create several problems. The central process would need privileged runtime access to every machine. A slow image pull on one worker could consume the same execution path used for cluster-wide decisions. Losing that process could interrupt both coordination and every local application process at once.

Kubernetes separates the responsibilities instead:

- the control plane decides **what the cluster should do** and records those decisions;
- each worker decides **how to realize its assigned work on this machine**;
- application requests use a programmed data plane to reach running Pods.

This separation gives failures a smaller scope. A scheduler restart pauses new placement decisions while already assigned Pods continue on their workers. A kubelet problem affects the management of one worker while the API and other workers continue. An API outage can pause changes while running application processes and existing forwarding state keep serving traffic.

The architecture also explains why components publish decisions through API objects. The scheduler records a Pod-to-Node binding, and that durable record replaces a private command channel into each kubelet. The kubelet watches for Pods assigned to its Node and sees the binding through the API. If either process restarts, the recorded assignment remains available.

![Studio Light Kubernetes architecture showing the API server as the control-plane hub, etcd, controller manager, scheduler, two worker nodes, status returning through the API, and application traffic using the worker data plane](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes/control-plane-worker-nodes.png)

*Control-plane components and kubelets coordinate through the API server. Application traffic follows the data plane to running Pods and stays outside the object-management path.*

The diagram contains two flows:

1. The **control path** accepts intent, stores objects, creates dependent objects, binds Pods to Nodes, starts runtime work, and records status.
2. The **application data path** carries client requests to ready Pods through already programmed networking state.

Both flows matter, but they have different availability boundaries. A healthy data path can continue during a brief control-plane interruption. A healthy control plane can also coexist with an application process that returns errors. Keeping the flows separate helps an operator investigate the correct layer.

## How Does an API Request Become Shared Cluster State?
<!-- section-summary: The API server authenticates, authorizes, admits, validates, and persists a request, then exposes the accepted object to every authorized component. -->

The API server is an authenticated HTTPS service. Kubernetes tools hide much of that HTTP conversation, which makes the cluster feel more mysterious than it is. `kubectl` is an API client: it discovers which resources the cluster supports, turns a command into an HTTP method and resource URL, sends an object or query, and prints the response in a convenient form.

Consider a pricing API that needs twelve replicas. The delivery system describes the requested state in a Deployment file:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pricing-api
  namespace: commerce
spec:
  replicas: 12
  selector:
    matchLabels:
      app.kubernetes.io/name: pricing-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: pricing-api
    spec:
      containers:
        - name: pricing
          image: ghcr.io/example/pricing-api:5.2.0
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
```

The command looks like a file operation:

```bash
kubectl create -f pricing-api.yaml
```

Underneath, `kubectl` performs a network request. It reads the cluster address and credentials from kubeconfig. It reads `apiVersion: apps/v1` and `kind: Deployment`, then uses the cluster's discovery API to find the plural resource name, namespace scope, supported version, and allowed operations. It serializes the Deployment and sends it to the collection URL for Deployments in the `commerce` namespace.

### A Kubernetes resource has an HTTP address

The resulting URL is `/apis/apps/v1/namespaces/commerce/deployments`. Each segment narrows the request from the whole cluster API to one resource collection:

| URL segment | Information it carries |
| --- | --- |
| `/apis` | Select the family of named API groups |
| `/apps/v1` | Select version `v1` of the `apps` group |
| `/namespaces/commerce` | Scope the request to the `commerce` namespace |
| `/deployments` | Select the Deployment collection |

The URL ends at the collection because the client is creating a new member of that collection. Reading one existing object adds its name:

```text
/apis/apps/v1/namespaces/commerce/deployments/pricing-api
```

Pods, Services, ConfigMaps, and several other foundational resources live in the core API group, whose paths begin with `/api/v1`. Named groups such as `apps` use `/apis/<group>/<version>`. A Pod named `pricing-api-7b9f6c8d4d-2kq8p` therefore has this address:

```text
/api/v1/namespaces/commerce/pods/pricing-api-7b9f6c8d4d-2kq8p
```

The discovery response tells clients how to build these paths. For the `apps/v1` group, one entry is conceptually equivalent to this shortened record:

```json
{
  "name": "deployments",
  "namespaced": true,
  "kind": "Deployment",
  "verbs": ["create", "delete", "get", "list", "patch", "update", "watch"]
}
```

`kubectl api-resources` presents discovery data as a table for people. `kubectl get --raw='/apis/apps/v1'` exposes the group-version discovery document itself. This is how the same client can learn about built-in resources and custom resources served by a particular cluster.

Collection URLs and named-object URLs explain many familiar commands. The table shows the main HTTP request; `kubectl` may also make discovery or formatting requests around it.

| `kubectl` command | Main HTTP request | Meaning |
| --- | --- | --- |
| `kubectl get pods -n commerce` | `GET /api/v1/namespaces/commerce/pods` | Read the Pod collection in one namespace |
| `kubectl get deployment pricing-api -n commerce` | `GET /apis/apps/v1/namespaces/commerce/deployments/pricing-api` | Read one named Deployment |
| `kubectl create -f pricing-api.yaml` | `POST /apis/apps/v1/namespaces/commerce/deployments` | Add a Deployment to the collection using the request body |
| `kubectl apply --server-side -f pricing-api.yaml --field-manager=delivery` | `PATCH /apis/apps/v1/namespaces/commerce/deployments/pricing-api?fieldManager=delivery` | Declare the fields managed by `delivery`; the body uses `application/apply-patch+yaml` |
| `kubectl delete deployment pricing-api -n commerce` | `DELETE /apis/apps/v1/namespaces/commerce/deployments/pricing-api` | Request deletion of the named object |
| `kubectl logs -n commerce <pod-name> -c pricing` | `GET /api/v1/namespaces/commerce/pods/<pod-name>/log?container=pricing` | Read the Pod's `log` subresource |

This mapping also explains the verbs used in RBAC rules. Permission to `get` one object, `list` a collection, `create` a new object, `patch` an existing object, or `delete` an object corresponds to a different API operation. A Role can permit the read requests while denying the write requests.

### `kubectl create` becomes an HTTP `POST`

For a token-authenticated client, with optional headers and fields shortened to the parts that matter here, the request resembles this:

```http
POST /apis/apps/v1/namespaces/commerce/deployments HTTP/1.1
Authorization: Bearer <credential from kubeconfig>
Accept: application/json
Content-Type: application/json

{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "pricing-api",
    "namespace": "commerce"
  },
  "spec": {
    "replicas": 12,
    "selector": {
      "matchLabels": {
        "app.kubernetes.io/name": "pricing-api"
      }
    },
    "template": {
      "metadata": {
        "labels": {
          "app.kubernetes.io/name": "pricing-api"
        }
      },
      "spec": {
        "containers": [
          {
            "name": "pricing",
            "image": "ghcr.io/example/pricing-api:5.2.0",
            "resources": {
              "requests": {
                "cpu": "500m",
                "memory": "512Mi"
              }
            }
          }
        ]
      }
    }
  }
}
```

The request body represents the desired Deployment. The client supplies fields such as the name, Pod template, image, and replica count. The server supplies identity and concurrency fields after accepting the object. A shortened success response looks like this:

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "pricing-api",
    "namespace": "commerce",
    "uid": "4f33b0d8-7c90-4b8f-a52a-0b1d2c24c121",
    "resourceVersion": "84127",
    "generation": 1
  },
  "spec": {
    "replicas": 12
  },
  "status": {}
}
```

`201 Created` says that the Deployment object was accepted and stored. `uid` distinguishes this particular lifetime of `commerce/pricing-api` from a future object that reuses the same name. `resourceVersion` identifies the stored revision used for change tracking and concurrency. `generation` tracks changes to the desired specification. The empty status shows that controllers still need to observe the Deployment and report runtime progress.

The HTTP response therefore marks a precise boundary: the cluster now shares a durable request for twelve replicas. ReplicaSets, Pods, Node assignments, image pulls, and running processes come later.

### The API server checks the request before storing it

The API server processes the `POST` through a sequence of gates. In this simplified request path, each gate answers a different question about the same HTTP request:

| Gate | Question | Example for `pricing-api` |
| --- | --- | --- |
| TLS and authentication | Which client identity made the connection? | A workload-delivery identity presents trusted credentials |
| Authorization | May this identity perform this action on this resource? | The identity may create Deployments in `commerce` |
| Mutating admission | Which approved defaults or additions should be applied? | A policy adds ownership and cost-allocation labels |
| Validation | Does the resulting object follow the API schema and object rules? | The selector matches labels in the Pod template |
| Validating admission | Does the object satisfy cluster policy? | A policy requires CPU and memory requests |
| Persistence | Which accepted object version should become current? | The Deployment now requests twelve replicas on image `5.2.0` |

Authentication identifies the caller. Authorization evaluates the caller's API verb, resource, and namespace; in this example the decision is equivalent to “may this identity create `apps/deployments` in `commerce`?” Mutating admission can add approved defaults or required metadata. Schema validation and validating admission then reject malformed objects or policy violations. The API server converts an accepted object into its storage representation and persists it through its etcd storage layer.

Every failure returns through the same HTTP boundary. Missing credentials commonly produce `401 Unauthorized`. An authenticated identity with insufficient permission receives `403 Forbidden`. A duplicate `POST` for an existing name commonly returns `409 Conflict`. An invalid object receives a `4xx` status and a Kubernetes `Status` body that identifies the cause.

For example, the API can answer a delivery service account that lacks Deployment creation permission with this shortened response:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "kind": "Status",
  "status": "Failure",
  "message": "deployments.apps is forbidden: User system:serviceaccount:delivery:release cannot create deployments.apps in namespace commerce",
  "reason": "Forbidden",
  "code": 403
}
```

`kubectl` prints the message from this response. The HTTP status and `Status` object still carry the underlying decision, which lets other clients handle the same failure programmatically.

### The API server gives every component one contract

Without the API server, each component would need custom connections to every other component. Controllers would need to know how the scheduler stores decisions. Kubelets would need to trust commands from several control-plane processes. Audit, authorization, schema conversion, and admission policy would have to be repeated across those paths.

The API server centralizes that contract:

- objects have versioned schemas;
- every client uses the same authentication and authorization boundary;
- writes pass through admission and validation;
- reads expose a coherent object representation;
- watches provide a stream of later changes;
- audit records can describe who requested each API action.

This shared contract allows independently developed components to cooperate. A custom operator can create Pods through the same API used by built-in controllers. A GitOps system can update a Deployment through the same API used by `kubectl`.

You can inspect the API representation directly through `kubectl`:

```bash
kubectl get --raw='/apis/apps/v1/namespaces/commerce/deployments/pricing-api'
```

For a more literal HTTP view, `kubectl proxy` opens a local proxy that uses the current kubeconfig connection. A second terminal can call the same resource URL with `curl`:

```bash
kubectl proxy --port=8001
curl -i \
  http://127.0.0.1:8001/apis/apps/v1/namespaces/commerce/deployments/pricing-api
```

The local proxy handles the authenticated, TLS-protected connection to the cluster. The path, method, response headers, status code, and JSON object remain visible, which makes it useful for learning and API exploration.

### List and watch turn stored objects into ongoing work

Controllers need an initial picture and a stream of changes. They commonly begin with a **list** request that returns current objects plus an opaque `resourceVersion`. They then open a **watch** beginning from an appropriate version. The watch reports later additions, modifications, and deletions.

The built-in Deployment controller needs a cluster-wide view, so its collection URL omits a particular namespace. At the HTTP level, its first request can look like this:

```http
GET /apis/apps/v1/deployments HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{
  "kind": "DeploymentList",
  "metadata": {
    "resourceVersion": "84127"
  },
  "items": [
    {
      "metadata": {
        "namespace": "commerce",
        "name": "pricing-api"
      },
      "spec": {
        "replicas": 12
      }
    }
  ]
}
```

The Deployment controller now has a snapshot and the collection's `resourceVersion`. It can ask for changes after that point:

```http
GET /apis/apps/v1/deployments?watch=1&resourceVersion=84127 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json
Transfer-Encoding: chunked

{"type":"MODIFIED","object":{"kind":"Deployment","metadata":{"name":"pricing-api","namespace":"commerce","resourceVersion":"84203"},"spec":{"replicas":18}}}
```

The response stays open and streams event documents. `ADDED`, `MODIFIED`, and `DELETED` describe changes to API objects. Each event carries an object representation, so the controller can update its local cache and reconcile the affected key. If an old `resourceVersion` has already fallen outside the server's retained history, the server can return `410 Gone`; the client performs a fresh list and starts a new watch from the returned version.

Suppose the Deployment controller starts after a restart:

1. It lists Deployments and ReplicaSets, rebuilding its local cache from API data.
2. It notices that `commerce/pricing-api` requests twelve replicas.
3. It watches for later changes, such as an image update to `5.2.1`.
4. If the watch connection closes, the client reconnects and resumes from a valid point or lists again.

The API object remains the source of coordination across reconnects. A transient watch connection can close while the requested replica count remains stored. This pattern explains how many independent Kubernetes processes cooperate without calling one another directly: they read and write shared API objects, then observe later versions through watches.

### Several API servers can share the same cluster state

Production clusters commonly run several API server instances behind one endpoint. Any healthy instance can handle a compatible request because all instances use the same persistent etcd state, while each maintains caches populated from that state. This horizontal design provides more API capacity and preserves access when one API server instance stops.

Enabling admission webhooks and authentication dependencies adds them to the request path. A slow required webhook can delay API writes even while the core API server processes remain healthy. API latency therefore needs component-level and dependency-level observability.

## Why Does Kubernetes Need etcd?
<!-- section-summary: etcd preserves authoritative API state, orders concurrent changes, and lets control-plane processes restart without losing the cluster's declared intent. -->

API server processes are designed to restart and scale horizontally. Their in-memory state lasts only for the life of each process. Kubernetes therefore needs a separate storage system that preserves accepted objects and gives concurrent writers one agreed order. **etcd provides that backing store.**

Calling etcd a key-value store describes its interface, while the important property for Kubernetes is consistency. Every accepted update joins an ordered history. API clients can read a current object version, attempt a conditional update, and discover when another writer changed the object first.

### What one etcd record actually looks like

At the etcd boundary, every entry has a **key made of bytes** and a **value made of bytes**. The key identifies the record. The value contains the serialized Kubernetes object. etcd understands operations such as “read this key,” “write this value if the current revision still matches,” and “watch this key prefix.” The API server understands that the bytes represent a Deployment, validates its fields, and converts it between API versions and storage formats.

With the API server's default `/registry` storage prefix, the key for this namespaced Deployment typically has this shape:

```text
/registry/deployments/commerce/pricing-api
```

The path carries three pieces of identity: the resource collection, namespace, and object name. A cluster-scoped Node uses a path without a namespace segment, while a Secret in `commerce` uses a path such as `/registry/secrets/commerce/<secret-name>`.

The value is usually less readable. The API server's default storage media type for supported built-in resources is Kubernetes Protobuf. A raw Protobuf value begins with the four-byte marker `k8s\x00`, followed by a binary envelope and the encoded object:

```text
bytes 0-3: 6b 38 73 00  ("k8s\x00")
bytes 4...: Protobuf envelope and Kubernetes object payload
```

That is the literal storage-facing representation: bytes rather than the YAML file submitted by the user. Storage configuration and resource type can select another supported encoding. Resources without Protobuf support use a compatible encoding, and custom resources follow the storage version declared by their CustomResourceDefinition. API clients rely on the API server to decode, convert, and present the object through JSON, YAML, or another negotiated API format.

After decoding the stored bytes, the important fields resemble this abbreviated JSON object:

```json
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "pricing-api",
    "namespace": "commerce",
    "uid": "4f33b0d8-7c90-4b8f-a52a-0b1d2c24c121",
    "resourceVersion": "84203"
  },
  "spec": {
    "replicas": 18,
    "template": {
      "spec": {
        "containers": [
          {
            "name": "pricing",
            "image": "ghcr.io/example/pricing-api:5.2.1"
          }
        ]
      }
    }
  },
  "status": {
    "availableReplicas": 18
  }
}
```

This decoded view explains why a restart can recover more than the original manifest. The stored object includes server-assigned identity, the current desired specification, controller-written status, ownership metadata, and other fields omitted from the example. Reading through the API server reconstructs the complete Kubernetes object from the stored representation.

An etcd key also carries revision metadata. The following is an illustrative summary of the fields returned for a key after one update:

```text
key:             /registry/deployments/commerce/pricing-api
create_revision: 84127
mod_revision:    84203
version:         2
value:           k8s\x00<binary Kubernetes object>
```

`create_revision` identifies the etcd key-space revision that first created the key. `mod_revision` identifies the revision of its latest change. `version` counts modifications to this key within its current lifetime. Kubernetes derives storage-version information used by `metadata.resourceVersion` from this revisioned state, while API clients continue treating `resourceVersion` as an opaque token.

Cluster administrators on a self-managed control plane can inspect a protected etcd key with `etcdctl`. The connection requires the etcd endpoint and trusted client credentials; routine users and Kubernetes components continue through the API server:

```bash
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  --write-out=json \
  get /registry/deployments/commerce/pricing-api
```

The JSON output from `etcdctl` describes the etcd response and base64-encodes its byte-string key and value. It remains different from the decoded Deployment JSON returned by the Kubernetes API. Direct etcd access carries cluster-admin-level power and belongs to tightly controlled inspection, backup, and recovery work.

### How the key-value idea compares with familiar tools

A Python dictionary offers the closest shape for a first glance: one key maps to one value. Its lifetime and coordination guarantees are much smaller. A dictionary normally belongs to one process and disappears with that process unless application code persists it.

Redis also exposes network-accessible keys and values, and many Redis deployments add persistence or replication. Redis commonly serves caches, queues, counters, and application data structures. etcd is designed around relatively small, infrequently updated coordination data, linearizable reads and writes, atomic transactions, revisions, and reliable watches. Those guarantees let several API servers agree on the order of cluster changes.

| Familiar structure | Shared idea | Important boundary |
| --- | --- | --- |
| Python dictionary | A key selects a value | Process-local memory; persistence and distributed consensus require additional systems |
| Redis record | A network service stores values under keys | Redis targets broader application data structures and performance patterns; its deployment and consistency choices differ |
| Database row | Durable fields describe one entity | etcd focuses on ordered key ranges, revisions, transactions, watches, and leases; relational databases provide richer query and join models |
| etcd record used by Kubernetes | A durable key selects serialized object bytes | The API server owns Kubernetes validation, conversion, authorization, admission, and the human-readable object view |

For this pricing workload, the stored API data includes much more than the Deployment YAML:

| Record | Why the cluster needs it after a restart |
| --- | --- |
| Deployment specification and status | Preserve the requested revision, replica count, and rollout progress |
| ReplicaSet objects | Preserve the population attached to each Pod-template revision |
| Pod specifications and status | Preserve assigned work and the latest observations from workers |
| Node objects and Lease objects | Preserve machine identity, capacity information, conditions, and heartbeat timestamps |
| Services and EndpointSlices | Preserve stable service intent and current backend records |
| ConfigMaps, Secrets, RBAC, policy objects, and custom resources | Preserve configuration and the broader cluster API model |

The API server serializes accepted Kubernetes objects into the storage representation and writes them to etcd. Ordinary controllers, schedulers, kubelets, and users continue to use the API server. That boundary keeps authorization, validation, version conversion, and watch semantics around the stored data.

### Consistent ordering prevents two current realities

Assume an autoscaler raises the Deployment from twelve replicas to eighteen while a release system changes the image from `5.2.0` to `5.2.1`. Both clients begin from an object version they previously read.

The API server and etcd place accepted writes into one order. If one client submits an update based on an old version, the API can return a conflict. The client reads the new object, reapplies its intended change, and tries again. This optimistic-concurrency pattern protects fields written by the other client.

The resulting object can contain both accepted changes:

| Field | Current value |
| --- | --- |
| `spec.replicas` | `18` |
| `spec.template.spec.containers[0].image` | `ghcr.io/example/pricing-api:5.2.1` |

The object version acts as an opaque concurrency token for API clients. Clients compare and pass it back through the Kubernetes API; they avoid deriving business meaning from its numeric shape.

### Stored cluster state and application data have different owners

etcd preserves the Kubernetes API model. The commerce platform's product and pricing records belong in an application database. Container images belong in an image registry. Application metrics belong in a monitoring system. Container logs belong in the node log path and, for durable retention, a cluster logging platform. Persistent application files belong on storage represented by PersistentVolumes or an external service.

Keeping those responsibilities separate protects etcd from application traffic volume and gives each data type the storage guarantees it needs. An application database requires business-level transactions and retention rules; etcd requires fast, consistent coordination for Kubernetes objects.

Secrets make the storage boundary security-sensitive. A Secret's `data` fields use base64 in the API representation. Base64 changes the textual representation and anyone with the bytes can decode it. Kubernetes stores Secret objects unencrypted in etcd by default. Encryption-at-rest configuration makes the API server encrypt selected resources before writing their serialized values and decrypt them after reading. Strong etcd access control, encrypted backups, and API-server-managed at-rest encryption protect different parts of this path.

### Quorum and snapshots make etcd an operational responsibility

An etcd cluster uses consensus between members. Production deployments typically use an odd number of members so a majority can form a quorum. A three-member cluster can continue after losing one member because two members still form a majority. Once a majority becomes unavailable, new consistent writes stop until quorum returns.

That boundary has a visible Kubernetes effect. When the API loses the ability to persist changes, new Pods wait before completing normal scheduling and cluster updates pause. Existing containers and already programmed networking may continue serving application traffic for a time because their local runtime state already exists.

Self-managed clusters need protected etcd credentials, dependable disk and network performance, regular snapshots, and a rehearsed restore process. A snapshot is valuable only after the team has verified that it can restore the expected cluster state. Managed Kubernetes services usually operate etcd and the control-plane backup process as part of the service; teams still need to understand the provider's recovery guarantees.

## How Do Controllers and the Scheduler Divide the Work?
<!-- section-summary: Controllers create and repair API objects; the scheduler makes the separate placement decision for each Pod and records the chosen Node. -->

After the API stores a Deployment, the cluster still needs twelve Pod records and twelve placement decisions. Kubernetes splits those jobs because they answer different questions.

- A **controller** asks, “Which API objects should exist or change to move the cluster toward the requested state?”
- The **scheduler** asks, “Which feasible Node should run this unscheduled Pod?”

### Controllers work as repeatable reconciliation loops

The controller manager hosts many built-in controllers. Each controller watches a limited set of object kinds, places relevant changes into a work queue, and reconciles one key at a time. A reconciliation reads the latest objects, calculates the current gap, and writes the next API change.

A Deployment that requests twelve replicas creates a familiar ownership chain:

1. The Deployment controller observes the desired Pod template and twelve replicas.
2. It creates or adjusts a ReplicaSet for that template revision.
3. The ReplicaSet controller compares twelve desired Pods with the Pods the ReplicaSet already owns.
4. It creates the missing Pod objects.
5. Later reconciliations repeat the comparison as Pods, Nodes, and rollout settings change.

Reconciliation is deliberately repeatable. A controller can lose its network connection after creating a Pod but before recording local success. On the next reconciliation, it reads current API state, sees the existing Pod, and avoids creating an unnecessary extra copy. Durable objects carry the progress; temporary process memory improves efficiency around those records.

Different controllers cooperate without calling one another as a procedure chain. The Deployment controller writes a ReplicaSet. The ReplicaSet controller sees that object through the API. This loose coupling lets each controller restart and catch up independently.

The optional cloud controller manager follows the same pattern for cloud-specific responsibilities. A Service of type `LoadBalancer`, for example, can lead a cloud controller to provision or update a provider load balancer and publish the result in object status.

### The scheduler starts from an unscheduled Pod

A newly created Pod contains its container images, resource requests, volumes, labels, and placement rules. Its Node assignment is still empty. The default scheduler watches for that state.

The placement process has three important parts:

1. **Filtering** removes Nodes that fail a hard requirement. CPU and memory requests, taints and tolerations, node affinity, volume topology, ports, and device requirements can all affect feasibility.
2. **Scoring** ranks the feasible Nodes using active scheduling plugins. The scores can reflect resource balance, topology spread, affinity preferences, and other policy.
3. **Binding** records the selected Node through the API. The Pod now carries a Node assignment that the kubelet can observe.

Use a video platform's encoding workload as a concrete placement example. One batch Pod requests a GPU, `4` CPUs, and `16Gi` of memory:

| Candidate Node | Relevant state | Filter result |
| --- | --- | --- |
| `worker-a` | General-purpose machine, no GPU resource | Removed: GPU requirement is unsatisfied |
| `worker-b` | GPU available, `6` CPUs and `24Gi` unreserved | Feasible |
| `worker-c` | GPU available, `2` CPUs and `32Gi` unreserved | Removed: CPU request is unsatisfied |

`worker-b` remains feasible. The scheduler records that choice and finishes its placement responsibility. The kubelet and runtime on `worker-b` then own the node-local image and process work.

When every candidate fails filtering, the Pod remains unscheduled. The scheduler writes events that summarize the failed constraints, such as insufficient memory or an untolerated taint. Increasing replicas creates more Pod records; it never creates additional Node capacity by itself. A node autoscaler can react through a separate control loop when the cluster is configured with one.

### High availability uses multiple processes with controlled leadership

Production control planes commonly run multiple controller-manager and scheduler instances. Lease-based leader election allows one active leader for a given responsibility while standby instances remain ready to take over. API servers can serve concurrently, while scheduler and controller replicas coordinate leadership because duplicate active decisions would create conflicting work.

Leader election protects availability at the process level. The stored objects protect continuity at the state level. A new leader lists current objects and resumes reconciliation from shared API state.

## How Does a Worker Node Turn a Pod Record into a Running Process?
<!-- section-summary: The kubelet coordinates local storage, runtime, networking, probes, and status for Pods assigned to its Node. -->

The scheduler's binding changes the Pod from cluster-wide pending work into a machine-specific assignment. The worker Node now has enough information to act.

Every worker supplies operating-system resources and a set of node components. The most important is the **kubelet**, an agent responsible for Pods assigned to that Node. The kubelet watches the API, compares assigned Pod specifications with local runtime state, coordinates the required local systems, and reports observations back.

A video recommendation API gives the worker path a useful local example. Each Pod must load its recommendation model and warm its in-memory indexes before it can answer a large stream of playback-page requests. For one assigned `recommendation-api` Pod, the path looks like this:

1. The kubelet reads the Pod specification and resolves referenced configuration, Secrets, service-account data, and volumes.
2. The kubelet's volume manager works with Container Storage Interface drivers when the Pod uses CSI-backed storage.
3. The kubelet sends requests through the Container Runtime Interface, or **CRI**.
4. A CRI-compatible runtime such as containerd or CRI-O creates the Pod sandbox, obtains the image, and starts the application container.
5. The runtime's network integration uses Container Network Interface, or **CNI**, configuration to create the Pod network namespace and assign connectivity.
6. The kubelet executes configured startup, readiness, and liveness probes and collects container state.
7. The kubelet publishes Pod status and continues supervising the assigned Pod.

![Studio Light worker-node infographic showing kubelet coordination with CSI volumes, CRI container runtime, CNI Pod networking, probes, Pod status, and the return path to the API server](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes/worker-node-runtime.png)

*The kubelet coordinates several local systems. CRI, CSI, and CNI are integration boundaries that let Kubernetes work with different runtimes, storage systems, and network implementations.*

### The kubelet coordinates; the runtime executes

The kubelet maintains the Pod-level contract. It knows which containers, volumes, environment values, probes, and resource settings belong to the Pod. It asks the runtime to perform container operations through CRI and compares the returned runtime state with the Pod specification.

The container runtime performs lower-level work. It downloads image layers, creates the sandbox and container processes, configures isolation with operating-system primitives, and returns container identifiers and states. On Linux, cgroups account for and constrain resources, while namespaces isolate views of processes, networking, mounts, and other kernel resources.

This division allows Kubernetes to support more than one runtime implementation. The kubelet speaks the CRI contract; the runtime translates that contract into its own container operations.

### Storage and networking need their own integration points

A Pod can depend on storage that exists outside the Node. The kubelet's volume manager coordinates attach and mount operations through CSI components when a CSI volume is involved. The resulting filesystem becomes available at the mount path declared in the Pod.

Pod networking has a separate lifecycle. The runtime creates a Pod sandbox and invokes the configured CNI integration to establish network interfaces, routes, and a Pod IP according to the cluster's network implementation. The exact implementation varies: an overlay network, cloud-native routing, or an eBPF data plane can all satisfy the Kubernetes network model through different mechanisms.

Service forwarding is another concern. Some clusters run `kube-proxy` on each Node to maintain rules that implement Services. Other clusters use a network implementation that replaces kube-proxy with eBPF-based service handling. This component belongs to the data plane and stays separate from the kubelet's container-start responsibility.

### Running, ready, and healthy describe different observations

A started process gives the runtime a running container. The kubelet may still report the Pod as unready while the application loads its recommendation model, warms indexes, or waits for a required dependency.

For this recommendation service:

- a **startup probe** can allow extra initialization time before liveness checks begin;
- a **readiness probe** can keep the Pod out of Service backends until the model and listener are ready;
- a **liveness probe** can ask the kubelet to restart a container whose process remains alive but has stopped making progress.

Each probe answers a specific question. Combining them into one endpoint often produces poor behavior. A slow startup can be mistaken for a dead process, or a temporary dependency problem can trigger unnecessary restarts. Probe design belongs to the application contract and deserves the same care as resource requests.

## How Does the Cluster Learn What Happened on the Worker?
<!-- section-summary: Kubelets publish Pod status, Node conditions, and Lease heartbeats through the API so controllers can reason from current worker observations. -->

The control plane stores desired state, while many important observations originate on workers. The kubelet closes that information loop by writing status through the API server.

For a Pod, the kubelet can report:

- whether the runtime has created each container;
- waiting, running, or terminated container state;
- restart counts and termination reasons;
- Pod conditions such as `Initialized`, `PodScheduled`, `ContainersReady`, and `Ready`;
- the Pod IP and start time;
- probe results reflected in conditions and events.

Higher-level controllers derive workload status from those Pod records. The ReplicaSet controller counts owned Pods. The Deployment controller calculates updated, ready, available, and unavailable replicas. A user reading Deployment status therefore sees a summary built from several layers of observed state.

Suppose the recommendation API Deployment requests twelve replicas during a rollout:

| Layer | Requested or observed value | Meaning |
| --- | --- | --- |
| Deployment spec | `replicas: 12` | The target population remains twelve |
| Deployment status | `updatedReplicas: 4` | Four Pods use the new template |
| Deployment status | `availableReplicas: 11` | Eleven Pods satisfy availability rules |
| One Pod condition | `Ready: False` | One process is still outside normal Service traffic |
| One container state | `Waiting: ImagePullBackOff` | The worker reached image retrieval and is retrying |

The table provides a progress story. The API accepted the rollout, controllers created the new revision, the scheduler assigned the Pod, and the kubelet reached image retrieval. Image retrieval is the first unfinished handoff.

### Node status and Lease heartbeats serve different update patterns

A Node object carries relatively rich information: capacity, allocatable resources, addresses, software versions, and conditions such as `Ready`, `MemoryPressure`, `DiskPressure`, and `PIDPressure`.

Frequent full Node updates would create unnecessary write load. Kubernetes therefore uses a small Lease object for the regular heartbeat. Each kubelet renews a Lease with the same name as its Node in the `kube-node-lease` namespace. The control plane reads the renewal time to judge whether the kubelet is still communicating.

The two records complement each other:

| Signal | Purpose | Typical interpretation |
| --- | --- | --- |
| Node Lease renewal | Lightweight liveness heartbeat | The kubelet recently contacted the API |
| Node `Ready` condition | Richer health assessment | The Node can currently accept and manage Pods |
| Pressure conditions | Local resource pressure | Memory, disk, or process-ID capacity needs attention |
| Pod conditions | Workload progress on the Node | Containers and application readiness reached specific stages |

When Lease renewal stops, the node controller eventually changes its view of the Node and begins the configured response for unreachable workers. Replacement Pods receive new UIDs and new placements through the same object-and-scheduler flow described earlier.

### Communication uses the API server as the hub

Kubelets connect to the API server using node credentials and TLS trust. They watch assigned Pods and submit status or Lease updates. Control-plane components also use the API server. This hub-and-spoke design concentrates remote API exposure at one hardened endpoint.

The API server can also connect to kubelets for specific operations such as fetching container logs, attaching to running containers, port forwarding, and executing commands. These control-plane-to-node paths need their own authentication and network protection.

Events add short explanations around recent actions: failed scheduling, image retrieval errors, volume mount problems, probe failures, and other transitions. Event retention is limited. Durable operational history belongs in monitoring, logging, and audit systems that collect signals outside the recent-event window.

## What Continues When a Component Fails, and How Do You Find the Boundary?
<!-- section-summary: Component failures pause the decisions owned by that component; existing runtime and data-plane state often continue while evidence reveals the first incomplete handoff. -->

Component boundaries help when the cluster is partly healthy. An application can keep serving while the control plane pauses. The API can remain healthy while one worker fails to start a container. To locate the problem, ask: **which component completed its responsibility, and which component has yet to publish its expected result?**

### Each component failure has a characteristic effect

| Component or dependency | Work that commonly continues | Work that commonly pauses or degrades |
| --- | --- | --- |
| One API server instance | Other API instances serve requests; workers run assigned Pods | Capacity and resilience shrink until the instance returns |
| All reachable API server instances | Existing containers and programmed traffic paths may continue | `kubectl`, controllers, scheduling, status updates, and new object changes pause |
| etcd loses quorum | Existing worker runtime state may continue | Consistent API writes and cluster changes stop until quorum returns |
| Controller manager leader | Existing assigned Pods continue | Rollouts, replacement objects, and many status derivations pause until a leader resumes |
| Scheduler leader | Running and assigned Pods continue | Newly created unscheduled Pods remain `Pending` |
| One kubelet | Runtime-managed containers may continue for a time | Pod supervision, probes, status reports, and Node heartbeats from that worker stop |
| Container runtime on one worker | Other workers continue normally | Container creation and lifecycle on that worker fail |
| Node networking agent | Previously programmed connectivity may remain | New Pod or Service network updates on that worker may fail |
| Entire worker Node | Other workers and the control plane continue | Pods on the lost worker disappear with its compute capacity; replacements need healthy capacity elsewhere |

The wording “may continue” matters for node-local behavior because implementations and failure modes vary. A frozen process, a stopped kubelet, a failed runtime, and a powered-off machine produce different local outcomes even though the control plane eventually sees missing heartbeats.

### High availability repeats components according to their role

A resilient production design commonly includes:

- several API server instances behind a load-balanced endpoint;
- several controller-manager and scheduler instances using leader election;
- an odd-sized etcd cluster with quorum across failure domains;
- enough worker capacity to place replacement Pods after one Node is lost;
- application replicas spread across Nodes or zones where the workload requires that resilience.

Replicating a component solves only its own boundary. Three API servers still depend on a healthy etcd quorum. A healthy control plane still needs spare worker capacity. Twelve application replicas on one Node still share one machine failure. Availability comes from following dependencies across the whole path.

### Follow the records in the order Kubernetes created them

Assume a rollout of `catalog-api:8.1.0` shows eleven available replicas while one new Pod waits. Begin with the workload chain:

```bash
kubectl get deployment,replicaset,pod -n commerce \
  -l app.kubernetes.io/name=catalog-api -o wide
```

Then locate the first missing result:

| Observation | Completed responsibility | Next evidence to inspect |
| --- | --- | --- |
| API rejects the Deployment | TLS, identity, permission, admission, or schema gate identified the issue | API response, RBAC check, admission result, audit record |
| Deployment exists and expected ReplicaSet is absent | API persistence completed | Deployment conditions and controller-manager health |
| ReplicaSet exists and Pod count is low | Deployment controller completed its revision work | ReplicaSet conditions, selector, controller events |
| Pod exists with an empty Node assignment | Controllers created the Pod | Scheduling events, requests, taints, affinity, and volume constraints |
| Pod has a Node and waits in `ContainerCreating` | Scheduler recorded a binding | Pod events, volume state, image retrieval, runtime, and CNI health on that Node |
| Container runs and `Ready` is false | Runtime started the process | Readiness probe result, application logs, listener, and dependencies |
| Several Pods on one Node stop updating | Workload objects and earlier assignments exist | Node conditions, Lease renewal, kubelet, runtime, and machine health |

Inspect the selected Pod:

```bash
kubectl describe pod -n commerce <pod-name>
kubectl get pod -n commerce <pod-name> \
  -o jsonpath='{.spec.nodeName}{"\n"}{range .status.containerStatuses[*]}{.name}{": "}{.state}{"\n"}{end}'
```

`describe` combines the Pod specification, status, conditions, and recent events. The Node name tells you whether scheduling completed. Container state tells you whether the kubelet and runtime reached image retrieval, container creation, or process execution.

Application logs become useful after a container starts:

```bash
kubectl logs -n commerce <pod-name> -c catalog
```

A scheduling failure has no application process and therefore no application log to inspect. Its evidence lives in Pod events and scheduling constraints. An image-pull failure has reached the worker but has yet to start the process. Its evidence lives in kubelet/runtime events and registry access.

For a Node-level question, compare the Node condition with its lightweight heartbeat:

```bash
kubectl get node <node-name>
kubectl get lease -n kube-node-lease <node-name> \
  -o jsonpath='{.spec.renewTime}{"\n"}'
```

Cluster administrators with sufficient access can inspect API readiness:

```bash
kubectl get --raw='/readyz?verbose'
```

Self-managed clusters then correlate the failing check with API server, scheduler, controller-manager, etcd, kubelet, runtime, or network-agent logs. Managed Kubernetes services expose a different operational boundary: the provider operates much of the control plane, so provider health, service events, and support channels join the investigation.

The core method stays the same. Read the durable records, find the last completed handoff, and inspect the component responsible for the next expected state.

## Check Your Answers
<!-- section-summary: Revisit coordination and execution, API persistence, etcd, controllers, scheduling, worker realization, status reporting, and failure boundaries. -->

:::expand[What Are the Control Plane and Worker Nodes in Plain Terms?]{kind="recap"}
The control plane accepts and stores cluster intent, creates and updates Kubernetes objects, chooses placements, and maintains a cluster-wide view. Worker nodes supply the machines and local agents that prepare storage and networking, run containers, supervise assigned Pods, and report observations.
:::

:::expand[Why Does Kubernetes Separate Coordination from Execution?]{kind="recap"}
Cluster-wide placement and reconciliation need a global view, while starting a container needs local machine access. Separating them narrows failure scope, lets components recover independently from durable API records, and keeps application traffic outside the control-plane path.
:::

:::expand[How Does an API Request Become Shared Cluster State?]{kind="recap"}
`kubectl` discovers the resource endpoint and translates a command into an HTTP request: `get` uses `GET`, `create` uses `POST`, server-side apply uses `PATCH`, and delete uses `DELETE`. The API server authenticates and authorizes the client, runs admission and validation, persists the accepted object, and returns its stored representation with fields such as `uid` and `resourceVersion`. Controllers list the current objects and watch later versions, so the stored request can drive work long after the original command exits.
:::

:::expand[Why Does Kubernetes Need etcd?]{kind="recap"}
etcd stores byte-string keys and values. A Deployment key typically resembles `/registry/deployments/commerce/pricing-api`, while its value contains the serialized Kubernetes object, commonly in a binary Protobuf envelope for supported built-in resources. etcd adds durable revisions, atomic operations, ordered change history, and consensus, allowing several API servers to share one authoritative state. The API server keeps validation, version conversion, authorization, admission, encryption, and human-readable JSON or YAML around those raw records.
:::

:::expand[How Do Controllers and the Scheduler Divide the Work?]{kind="recap"}
Controllers reconcile object relationships and populations, such as Deployment to ReplicaSet to Pods. The scheduler begins with each unscheduled Pod, filters and scores Nodes, then records one binding. The kubelet handles execution after that placement exists.
:::

:::expand[How Does a Worker Node Turn a Pod Record into a Running Process?]{kind="recap"}
The kubelet watches Pods assigned to its Node, coordinates volumes, sends container lifecycle requests through CRI, works with the runtime and CNI integration to establish the Pod sandbox and network, runs configured probes, and reports Pod state. CSI, CRI, and CNI keep storage, runtime, and networking implementations replaceable behind stable contracts.
:::

:::expand[How Does the Cluster Learn What Happened on the Worker?]{kind="recap"}
The kubelet publishes container state, Pod conditions, Node status, and a lightweight Node Lease heartbeat through the API. Controllers derive ReplicaSet and Deployment status from those observations, while events explain recent transitions and failures.
:::

:::expand[What Continues When a Component Fails, and How Do You Find the Boundary?]{kind="recap"}
Work already realized on workers and in the data plane often continues while the failed component's new decisions pause. Follow Deployment, ReplicaSet, Pod, Node assignment, container state, readiness, Node condition, and Lease renewal in order. The first missing result identifies the component and evidence source to inspect next.
:::

## References
<!-- section-summary: Kubernetes and etcd documentation define the control-plane, worker-node, API, storage, scheduling, runtime, and availability mechanisms explained here. -->

- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/) - Official overview of current control-plane and node components, including optional cloud-controller-manager and kube-proxy roles.
- [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/) - Official architecture index for Nodes, controllers, Leases, communication, and self-healing.
- [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) - Official description of the shared API and object-version behavior.
- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) - Official HTTP verbs, resource URLs, list/watch semantics, status codes, and resource-version behavior.
- [Storage Versions](https://kubernetes.io/docs/concepts/overview/working-with-objects/storage-version/) - Official explanation of serialized storage versions and API-server conversion.
- [kube-apiserver Reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/) - Official defaults for the `/registry` etcd prefix, `etcd3` backend, and Kubernetes Protobuf storage media type.
- [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/) - Official `PATCH` protocol, apply media type, field management, and access requirements.
- [Use an HTTP Proxy to Access the Kubernetes API](https://kubernetes.io/docs/tasks/extend-kubernetes/http-proxy-access-api/) - Official `kubectl proxy` and direct HTTP exploration workflow.
- [Controlling Access to the Kubernetes API](https://kubernetes.io/docs/concepts/security/controlling-access/) - Official request path through TLS, authentication, authorization, and admission.
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Official explanation of reconciliation and controller behavior.
- [Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/) - Official filtering, scoring, and binding model.
- [Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/) - Official Node management, status, capacity, and condition reference.
- [Communication between Nodes and the Control Plane](https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/) - Official node-to-control-plane and control-plane-to-node communication paths.
- [Leases](https://kubernetes.io/docs/concepts/architecture/leases/) - Official Node heartbeat and leader-election behavior.
- [Container Runtime Interface](https://kubernetes.io/docs/concepts/containers/cri/) - Official contract between kubelet and container runtimes.
- [Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/) - Official runtime requirements and current CRI-compatible options.
- [Operating etcd Clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) - Official Kubernetes guidance for quorum, resources, backups, and restore operations.
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Official storage-encryption model and protected `etcdctl` inspection example.
- [etcd Data Model](https://etcd.io/docs/v3.7/learning/data_model/) - Official multiversion key-value model, revisions, history, and compaction behavior.
- [etcd API Guarantees](https://etcd.io/docs/v3.7/learning/api_guarantees/) - Official atomicity, durability, consistency, transaction, watch, and lease guarantees.
- [Options for Highly Available Topology](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/ha-topology/) - Official control-plane and etcd topology examples.
