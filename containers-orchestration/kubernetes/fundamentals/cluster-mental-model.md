---
title: "How a Kubernetes Cluster Runs an App"
description: "Understand how stored intent, owned Pods, ready Service backends, and node placement cooperate to run an application."
overview: "A Kubernetes application becomes a connected set of records with different responsibilities and lifetimes. This article explains why those records are separate, how ownership differs from selection, how ready Pods become Service backends, how a Pod reaches a node, and how to trace the first broken relationship."
tags: ["kubernetes", "cluster", "pods", "services"]
order: 2
id: article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model
---

## Table of Contents

1. [Why Does One Application Use Several Kubernetes Objects?](#why-does-one-application-use-several-kubernetes-objects)
2. [What Job Does Each Object Own?](#what-job-does-each-object-own)
3. [Why Does a Deployment Create ReplicaSets?](#why-does-a-deployment-create-replicasets)
4. [How Do Ownership and Selection Connect Different Objects?](#how-do-ownership-and-selection-connect-different-objects)
5. [How Do Ready Pods Become Service Backends?](#how-do-ready-pods-become-service-backends)
6. [How Does a Pending Pod Become a Running Process?](#how-does-a-pending-pod-become-a-running-process)
7. [Which Path Changes the Cluster, and Which Path Carries Requests?](#which-path-changes-the-cluster-and-which-path-carries-requests)
8. [How Do You Find the First Broken Relationship?](#how-do-you-find-the-first-broken-relationship)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

## Why Does One Application Use Several Kubernetes Objects?
<!-- section-summary: Kubernetes separates one application into objects with distinct responsibilities and lifecycles, then controllers keep their relationships current. -->

The previous article explained the central Kubernetes idea: a team stores a desired state, and controllers keep comparing that request with the cluster's observed state. We can now look inside that process. The important question changes from “why use Kubernetes?” to “what exactly does Kubernetes create and connect?”

Kubernetes uses several objects because the promises that make up one application have different lifetimes. A traffic address may remain stable for months. Individual application copies may last minutes or hours. A release introduces a new version while the previous version still serves requests. Node capacity changes as machines join, drain, or fail. Readiness can change within seconds while a process initializes.

Combining all of those facts in one giant application record would tie unrelated changes together. Replacing one runtime copy would modify the same record that callers use as a stable destination. A release controller, scheduler, and networking controller would also compete to update different parts of that record. Separate objects let each component own a smaller decision while preserving the relationships between them.

Kubernetes represents these independent concerns as separate API objects:

- a **Deployment** stores the requested application population and Pod template;
- a **ReplicaSet** maintains the population for one template revision;
- a **Pod** represents one scheduled application copy;
- a **Service** gives callers a stable name and port;
- an **EndpointSlice** records the current backend addresses for that Service;
- a **Node** represents a machine that can run Pods.

This separation gives each controller a small, precise job. The Deployment controller can coordinate revisions while preserving the Service. The scheduler can place a new Pod while preserving the Deployment. The EndpointSlice controller can remove an unready backend while preserving the Pod for inspection and recovery. Each object changes at the pace of the concern it represents.

The result is one logical application expressed as a graph of records and relationships. Some relationships describe **responsibility**: a ReplicaSet owns the Pods it creates. Other relationships describe **membership**: a Service selects Pods whose labels match. A third relationship records **placement**: a Pod is bound to one Node. Understanding those different meanings is the foundation for reading a cluster.

These questions guide the article:

1. **Why does one application use several Kubernetes objects?**
2. **What job does each object own?**
3. **Why does a Deployment create ReplicaSets?**
4. **How do ownership and selection connect different objects?**
5. **How do ready Pods become Service backends?**
6. **How does a pending Pod become a running process?**
7. **Which path changes the cluster, and which path carries requests?**
8. **How do you find the first broken relationship?**

The sections below use a high-volume product-search API as a worked example. Search traffic needs several ready copies, predictable placement, gradual releases, and one stable address, which makes every core relationship visible without determining the article structure.

![Kubernetes object relationship map for a product-search service, showing a Deployment, ReplicaSet, three Pods on nodes, a Service, and an EndpointSlice](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/cluster-object-map.png)
*The blue relationships show controller ownership. The green relationships show the backend membership maintained for Service traffic.*

## What Job Does Each Object Own?
<!-- section-summary: Each Kubernetes object stores one durable part of the application request or one observed part of its runtime state. -->

Kubernetes needs stored records because running processes are temporary. A process disappears when its container exits or its machine fails. The instruction “keep three search replicas available” has a longer lifetime, so Kubernetes stores that instruction through its API.

Most Kubernetes objects have a **spec** and a **status**. The spec contains the state a user or controller requests. The status contains observations written by Kubernetes components. A Deployment can request three replicas through `spec.replicas` while its status reports two available replicas during startup. The gap means that the request is accepted and the system still has work in progress.

The object type determines which part of the application that record describes.

### Deployment: the release and population request

The Deployment is the object an application team usually edits for a long-running stateless service. Its Pod template says how each new search Pod should be built: image, labels, ports, resource requests, probes, and configuration references. Its replica count says how many copies the controller should maintain.

The Deployment also coordinates changes to that template. Changing image `2.4.0` to `2.5.0` creates a new revision that can grow gradually while the previous revision shrinks. The Deployment therefore belongs at the release-management layer and completes its work outside the request path.

### ReplicaSet: the count for one revision

A ReplicaSet maintains a specific number of Pods that match one Pod template. The Deployment creates and owns ReplicaSets, then adjusts their desired counts during scaling and rollouts.

One ReplicaSet might maintain three Pods on image `2.4.0`. A rollout can create another ReplicaSet for image `2.5.0`. Keeping the populations separate lets the Deployment answer exact questions: how many old Pods remain, how many new Pods are ready, and whether the release can continue.

### Pod: one scheduled runtime unit

A Pod is the smallest unit the scheduler places on a Node. Most application Pods contain one main container, so one `product-search` Pod usually means one search process with one Pod IP address. Closely coupled helper containers can share the Pod's network identity and volumes.

A Pod has its own name and UID. A replacement is a new object with a new UID and usually a new IP address. The Deployment preserves the application-level request while Pods appear and disappear beneath it.

### Service: the stable network identity

A Service represents the destination callers use. The search Service can keep the DNS name `product-search.catalog.svc.cluster.local` while its backend Pod addresses change through failures, scaling, and releases.

The Service stores a selector and one or more port mappings. Its selector defines which Pods are candidates. Its `port` is the port callers use. Its `targetPort` identifies the backend port where the application listens.

### EndpointSlice: the current backend records

An EndpointSlice contains backend addresses and conditions associated with a Service. For a selector-backed Service, the control plane updates EndpointSlices as matching Pods appear, change readiness, terminate, or disappear.

EndpointSlices make a dynamic decision visible. A Service selector may match three Pods while only two addresses are currently ready for ordinary traffic. Cluster networking components consume these endpoint records to program the data plane.

### Node: the machine that supplies runtime capacity

A Node contributes CPU, memory, local networking, and a container runtime. The scheduler compares an unscheduled Pod's requirements with candidate Nodes. After a placement decision is stored, the kubelet on the chosen Node works with the container runtime to create the containers and reports their state.

The same application can also use ConfigMaps, Secrets, persistent storage, an Ingress, or a Gateway. Those resources extend the graph with configuration, credentials, durable data, and external routing. The six objects above are enough to explain the core path from application intent to a reachable process.

| Object | Durable question it answers | Value that may change independently |
| --- | --- | --- |
| Deployment | Which application revision and population should exist? | Replica count or Pod template |
| ReplicaSet | How many Pods should this template revision maintain? | Desired and observed Pod counts |
| Pod | What should run together on one Node? | Phase, conditions, Pod IP, container state |
| Service | Which stable name and port should callers use? | Selector or port mapping |
| EndpointSlice | Which backend addresses currently serve this Service? | Addresses and endpoint conditions |
| Node | Which machine can host scheduled work? | Capacity, allocatable resources, conditions |

## Why Does a Deployment Create ReplicaSets?
<!-- section-summary: ReplicaSets give each Pod-template revision its own population, allowing a Deployment to scale and replace versions in measured steps. -->

The extra ReplicaSet layer often surprises beginners. A Deployment already asks for three Pods, so a direct Deployment-to-Pod relationship may seem sufficient. Rolling releases reveal why Kubernetes keeps a separate population object for each template revision.

For a concrete rolling-release example, assume three `product-search` Pods run image `2.4.0`. The current ReplicaSet stores the Pod template for that revision and a desired count of three. Its controller repeatedly compares the desired count with the Pods it owns. If a Node failure removes one Pod, the observed count falls to two and the ReplicaSet creates one replacement from the same template.

Now the team changes the Deployment's Pod template to image `2.5.0`. Kubernetes needs to hold two facts at once:

- the old revision still has ready processes serving search requests;
- the new revision needs a separate population whose readiness can be measured.

The Deployment therefore creates a new ReplicaSet. During one stage of a rollout, the state could be:

| Revision | Image | Desired Pods | Ready Pods | Purpose |
| --- | --- | ---: | ---: | --- |
| Previous ReplicaSet | `2.4.0` | 2 | 2 | Preserve serving capacity |
| New ReplicaSet | `2.5.0` | 2 | 1 | Grow the new revision and wait for readiness |

Suppose image `2.5.0` starts successfully but fails its readiness check because it expects an index schema that production has yet to receive. The new ReplicaSet still owns its Pods and reports their state. The Deployment sees that the new population has limited availability, so rollout progress can pause while the two ready `2.4.0` Pods continue serving traffic. Separate ReplicaSets make this measured transition possible.

The Deployment derives a `pod-template-hash` label for each revision. A change inside `spec.template`, such as the image, environment variables, labels, or resource settings, creates a new revision. Changing only the desired replica count uses the existing template and keeps the current ReplicaSet revision.

Ownership records preserve the management chain. A ReplicaSet created by a Deployment contains an owner reference to that Deployment. A Pod created by the ReplicaSet contains an owner reference to the ReplicaSet. Each reference includes the owner's UID, which distinguishes the current owner object from an older deleted object that happened to use the same name.

The relationship is visible through normal commands:

```bash
kubectl get deployment,replicaset,pod -n catalog \
  -l app.kubernetes.io/name=product-search

kubectl get pod -n catalog <pod-name> \
  -o jsonpath='{.metadata.ownerReferences[0].kind}{"/"}{.metadata.ownerReferences[0].name}{"\n"}'
```

Engineers normally edit the Deployment and let its controller manage the ReplicaSets. Directly changing an owned ReplicaSet creates competing intentions: the Deployment continues calculating revision populations from its own desired state. Reading the ReplicaSet remains valuable because it shows which revision owns a Pod and how that revision is progressing.

## How Do Ownership and Selection Connect Different Objects?
<!-- section-summary: Owner references record controller responsibility, while labels and selectors form dynamic sets for counting and traffic. -->

Kubernetes uses more than one kind of relationship because “who manages this object?” and “which objects belong in this set?” are different questions.

An **owner reference** connects a dependent object to the object responsible for its lifecycle. The ReplicaSet owns the Pods it creates. The Deployment owns its ReplicaSets. This relationship helps controllers coordinate their dependents and helps garbage collection clean up dependent objects when an owner is deleted according to the chosen deletion policy.

A **label** is a key-value attribute attached to an object. A **selector** is a query that matches objects carrying particular labels. Many objects can share the same label, which makes selectors useful for dynamic membership. Replacement Pods can receive new names and UIDs while keeping `app.kubernetes.io/name: product-search`.

The product-search Pods might carry these labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: product-search
    app.kubernetes.io/component: api
    app.kubernetes.io/version: "2.5.0"
```

Each label describes a different dimension. The application name groups all search API Pods. The component distinguishes the request-serving API from an indexing worker. The version makes revision populations visible. A selector uses only the dimensions relevant to its decision.

The Deployment selector and Pod-template labels must agree, and the `apps/v1` API keeps a Deployment's selector stable after creation. The ReplicaSet created from that Deployment uses the selector to count its Pods. Overlapping selectors from independent ReplicaSets in one namespace create ambiguous control, because two controllers could count the same Pod toward separate desired populations. API validation protects the selector-to-template agreement; careful label design prevents overlap across independent controllers.

The Service uses a selector for a separate purpose. It may select every request-serving `product-search` Pod across both old and new revisions:

```yaml
selector:
  app.kubernetes.io/name: product-search
  app.kubernetes.io/component: api
```

The version label stays outside this Service selector, so ready Pods from both rollout revisions can serve traffic. A canary design could intentionally add a version-specific Service, but the ordinary stable Service follows the application and component instead of one revision.

This produces two simultaneous relationships for the same Pod:

| Question | Kubernetes mechanism | Product-search answer |
| --- | --- | --- |
| Which controller manages this Pod's lifecycle? | `metadata.ownerReferences` | The current product-search ReplicaSet |
| Which workload population counts this Pod? | ReplicaSet label selector | The matching template revision |
| Which Service may consider this Pod? | Service label selector | The stable product-search Service |
| Which release does this Pod run? | Version label | `2.4.0` or `2.5.0` |

EndpointSlices use both kinds of relationship as well. An EndpointSlice managed for a Service usually has an owner reference to the Service and a `kubernetes.io/service-name` label for lookup. Ownership says which Service lifecycle governs the slice. The label lets clients find every slice that contributes endpoints for that Service.

## How Do Ready Pods Become Service Backends?
<!-- section-summary: A Service selector identifies candidate Pods, readiness narrows the serving set, and EndpointSlices publish the resulting addresses and ports. -->

A Service solves a lifetime mismatch. Callers need one stable destination, while Pod identities change whenever the workload scales, rolls out, or recovers. Kubernetes keeps the Service identity stable and updates the backend set around it.

For a selector-backed Service, the control plane continuously evaluates the selector against Pods. Matching a selector makes a Pod a candidate. The Pod's conditions then describe whether that candidate can serve ordinary traffic. For Pods, EndpointSlice readiness reflects the Pod's `Ready` condition in the usual case.

Consider four Pods in the `catalog` namespace:

| Pod | Application label | Runtime state | Endpoint result |
| --- | --- | --- | --- |
| `search-a` | `product-search` | Ready | Published as ready |
| `search-b` | `product-search` | Ready | Published as ready |
| `search-c` | `product-search` | Running, readiness false | Published with an unready condition |
| `image-worker-a` | `image-worker` | Ready | Excluded by the Service selector |

`search-c` may be alive and still loading a local ranking model. Its application process can run while readiness remains false. The Service keeps regular requests on `search-a` and `search-b` until `search-c` reports that it can handle searches. This is why `Running` and `Ready` answer separate questions: one describes container execution, while the other describes serving eligibility.

![Service selection and readiness for product-search, showing matching ready Pods becoming backends, one matching starting Pod waiting, and an image worker excluded by its label](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/labels-service-routing.png)
*The selector forms the product-search candidate set. Readiness determines which matching addresses receive ordinary Service traffic at this moment.*

The Service also defines a port boundary:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: product-search
  namespace: catalog
spec:
  selector:
    app.kubernetes.io/name: product-search
    app.kubernetes.io/component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Callers connect to Service port `80`. The named `targetPort: http` resolves against the named container port in each selected Pod:

```yaml
containers:
  - name: search
    image: ghcr.io/example/product-search:2.5.0
    ports:
      - name: http
        containerPort: 8080
```

This mapping lets a stable Service port forward to application port `8080`. Named ports also allow a new Pod revision to change its numeric container port while preserving the Service contract, provided the Pod continues exposing the same port name.

The current relationship can be inspected from all three sides:

```bash
kubectl get service product-search -n catalog -o yaml

kubectl get pods -n catalog \
  -l app.kubernetes.io/name=product-search,app.kubernetes.io/component=api \
  -o wide

kubectl get endpointslice -n catalog \
  -l kubernetes.io/service-name=product-search \
  -o yaml
```

The Service output shows the selector and port mapping. The Pod list shows which objects match and whether they are ready. The EndpointSlice output shows the addresses and endpoint conditions the control plane has published for networking components.

EndpointSlice is a control-plane record. Cluster networking components watch these records and program the forwarding rules or load-balancing state used by real connections. Requests then use that programmed data plane. This distinction becomes important when we separate the control path from the data path.

## How Does a Pending Pod Become a Running Process?
<!-- section-summary: The scheduler binds an unscheduled Pod to a suitable Node, then the kubelet and container runtime turn that stored Pod specification into running containers. -->

A ReplicaSet creates a Pod object through the Kubernetes API. At that moment the cluster has a durable request for one runtime copy, while a machine assignment is still pending. The scheduler closes that gap.

The scheduler first **filters** Nodes. A Node remains feasible when it satisfies the Pod's requirements: enough unreserved CPU and memory, compatible node labels, accepted taints, required volume topology, and other scheduling constraints. The scheduler then **scores** feasible Nodes and chooses a high-scoring placement according to the configured plugins. It records that decision through the API in a binding.

Resource requests are central to this decision. Suppose one search Pod requests `500m` CPU and `1Gi` of memory. `500m` means half of one CPU core for scheduler accounting. A Node with only `700Mi` of unreserved requested memory fails the memory filter even when its current monitoring graph looks quiet. The scheduler plans from requested resources because live usage can rise after placement.

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    memory: "2Gi"
```

After the binding names a Node, the kubelet on that Node observes the assigned Pod. It asks the container runtime to obtain the image and create the container. Node networking gives the Pod its network identity. The kubelet starts the process, runs configured probes, and writes container states and Pod conditions back through the API.

These stages produce different evidence:

| Stage | What exists | Useful evidence |
| --- | --- | --- |
| Pod created | API record with a Pod template | Pod spec and owner reference |
| Waiting for placement | Pod with no selected Node | `Pending` phase and scheduling events |
| Bound to a Node | `spec.nodeName` identifies a worker | Pod output with `-o wide` |
| Container setup | Image pull and container creation in progress | Container state and kubelet events |
| Process running | Container process has started | `Running` phase and container status |
| Eligible for Service traffic | Readiness condition is true | Pod conditions and EndpointSlice conditions |

A `Pending` Pod with an event saying `Insufficient memory` points to scheduler-visible capacity. A Pod bound to `worker-2` with `ImagePullBackOff` has passed scheduling and reached image retrieval. A running Pod with readiness false has reached process execution and still needs to satisfy its serving check. Reading the latest completed stage narrows the investigation quickly.

```bash
kubectl get pod -n catalog <pod-name> -o wide
kubectl describe pod -n catalog <pod-name>
kubectl get events -n catalog --sort-by=.lastTimestamp
```

The article on control-plane and worker components goes deeper into the API server, scheduler, controller manager, kubelet, and container runtime. Here, their shared outcome matters most: a stored Pod request receives a Node assignment, becomes a running process, and eventually becomes a ready backend.

## Which Path Changes the Cluster, and Which Path Carries Requests?
<!-- section-summary: Controllers and node agents build and maintain the runtime through the API, while application requests use the Service data plane to reach a ready Pod process. -->

Kubernetes operates two related flows. The **control path** creates and updates runtime state. The **data path** carries application requests. Mixing them together makes a healthy request appear to pass through every Kubernetes object, even though several objects finish their work before the request arrives.

The control path starts when a team applies a Deployment. The API stores it. The Deployment controller creates or adjusts ReplicaSets. The ReplicaSet controller creates Pods. The scheduler binds each Pod to a Node. The kubelet turns the assigned Pod spec into running containers. The EndpointSlice controller observes Services and Pods, then publishes backend records that networking components consume.

The data path starts when another application calls the Service name. Cluster DNS resolves that name to the Service identity. The cluster's Service data plane chooses one ready backend and forwards the connection to the Pod IP and target port. The application process handles the request.

![Two-lane Kubernetes infographic showing the control path turning a Deployment into stored objects, placement, a running search Pod, and EndpointSlice backend records, while the data path carries a catalog request through DNS and the Service data plane to that ready Pod](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/control-data-path.png)

*The control path prepares the running Pod and publishes its ready address. The data path uses that prepared state for each application request.*

This separation explains several observations:

- A Deployment controller outage can leave existing application traffic flowing while rollout and replacement work pauses.
- A healthy Deployment status can coexist with a broken Service selector, because workload ownership and traffic selection are separate.
- EndpointSlice objects influence forwarding state while packets travel through the programmed data plane.
- The scheduler participates when Pods need placement; it stays outside the path of each HTTP request.

Follow one product search request. The catalog frontend calls `product-search.catalog.svc.cluster.local:80`. DNS supplies the Service address. The data plane chooses the ready endpoint `10.42.6.27:8080`. That address belongs to a Pod on `worker-2`, and the search process returns its response. Meanwhile, controllers continue comparing desired and observed state in the background.

## How Do You Find the First Broken Relationship?
<!-- section-summary: A useful investigation follows the same object relationships Kubernetes used and stops where expected state first diverges from observed state. -->

An error such as “the product-search Service refuses connections” identifies the visible boundary. The underlying cause can sit earlier in selection, readiness, placement, or process startup. The fastest route to the cause is to follow the chain and ask one specific question at each link.

### Start from the caller's contract

Confirm the exact Service name, namespace, and port used by the caller. A frontend in namespace `catalog` can use `product-search:80`. A frontend in another namespace may use `product-search.catalog:80` or the full cluster DNS name. Record the request and its result so later checks stay tied to the same path.

Inspect the Service:

```bash
kubectl get service product-search -n catalog -o yaml
```

Read `spec.selector`, `spec.ports[].port`, and `spec.ports[].targetPort`. This establishes the candidate membership rule and the expected port translation.

### Resolve the selector into real Pods

Use the Service selector directly:

```bash
kubectl get pods -n catalog \
  -l app.kubernetes.io/name=product-search,app.kubernetes.io/component=api \
  -o wide
```

Zero rows mean the Service currently selects zero Pods. Compare the Service selector with the labels on the Deployment's Pod template. A typo such as `component: search-api` on the Service and `component: api` on the Pods leaves the workload healthy while the Service has no matching backends.

### Compare matching Pods with endpoint records

If Pods match, inspect readiness and EndpointSlices:

```bash
kubectl get pods -n catalog \
  -l app.kubernetes.io/name=product-search \
  -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,READY:.status.conditions[?(@.type=="Ready")].status,IP:.status.podIP,NODE:.spec.nodeName'

kubectl get endpointslice -n catalog \
  -l kubernetes.io/service-name=product-search \
  -o yaml
```

Three matching Pods with three false readiness conditions point toward application startup or the readiness probe. Three ready Pods with missing endpoint addresses point toward the Service-to-EndpointSlice relationship or stale control-plane state. The comparison matters more than any single status word.

### Verify the port and process listener

Ready endpoint addresses show that selection and readiness have progressed. Connection refusal at this stage points toward the target port or application listener. Compare the Service `targetPort`, the named container port, and the port where the process actually listens.

For example, a Service may resolve `targetPort: http` to container port `8080` while a new image starts the server on `9090`. The Pods can pass a poorly targeted readiness check and appear in EndpointSlices, yet connections to `8080` fail. The relationship has progressed through selection and readiness and breaks at the listener boundary.

### Follow missing Pods back through ownership and placement

If the Deployment requests three replicas and only two Pods exist, inspect the Deployment and ReplicaSet counts:

```bash
kubectl get deployment,replicaset,pod -n catalog \
  -l app.kubernetes.io/name=product-search

kubectl describe deployment product-search -n catalog
kubectl describe pod -n catalog <pending-pod>
```

A ReplicaSet that desires three Pods while one Pod remains Pending has fulfilled object creation and is waiting on placement. Scheduling events may show insufficient requested memory, an unmatched node selector, an untolerated taint, or a volume topology constraint. A Pod assigned to a Node and waiting on an image has already passed the scheduler boundary.

The evidence can be summarized as a relationship map:

| Observation | Proven working relationship | Next boundary to inspect |
| --- | --- | --- |
| Service selector returns zero Pods | Service object exists | Service selector ↔ Pod labels |
| Pods match and readiness is false | Workload ownership and selection | Process startup and readiness probe |
| Pods are ready and EndpointSlices contain addresses | Selection and readiness publication | Service port ↔ target port ↔ listener |
| ReplicaSet desires three and only two Pods exist | Deployment ↔ ReplicaSet | ReplicaSet events and Pod creation |
| Pod exists with no Node assignment | Controller ownership and Pod creation | Scheduler filters and Node capacity |
| Pod is bound and image pull fails | Scheduling and binding | Kubelet credentials, image name, and registry access |

![Kubernetes relationship tracing summary for the product-search service, showing Service selection, matching Pods, EndpointSlices, target port, and node placement](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/cluster-operations-summary.png)
*Each check proves one part of the chain and identifies the next boundary that still needs evidence.*

This method scales beyond Services. Start with the user's failed action, identify the Kubernetes object that represents that contract, and walk through ownership, selection, readiness, placement, and runtime evidence. The first expected relationship that diverges from observed state gives the investigation a precise scope.

## Check Your Answers
<!-- section-summary: Revisit object responsibilities, revision ownership, selection, Service backends, Pod placement, control and data paths, and relationship-first debugging. -->

:::expand[Why does one application use several Kubernetes objects?]{kind="recap"}
An application needs promises with different lifetimes: a stable traffic identity, a requested population, revision history, replaceable runtime copies, current backend addresses, and machine placement. Kubernetes gives each concern its own API object and controller so one part can change while the other contracts remain stable.
:::

:::expand[What job does each object own?]{kind="recap"}
The Deployment stores the release and population request. A ReplicaSet maintains Pods for one template revision. A Pod represents one scheduled runtime unit. A Service gives callers a stable name and port. EndpointSlices publish current backend addresses and conditions. Nodes supply the resources and runtime environment where Pods execute.
:::

:::expand[Why does a Deployment create ReplicaSets?]{kind="recap"}
Each ReplicaSet holds the Pod template and population for one revision. During a rollout, the Deployment can preserve ready Pods from the previous ReplicaSet while measuring and growing the new ReplicaSet. Separate revision populations support controlled replacement, progress tracking, and rollback.
:::

:::expand[How do ownership and selection connect different objects?]{kind="recap"}
Owner references record lifecycle responsibility, such as a ReplicaSet owning the Pods it creates. Labels and selectors form dynamic sets, such as a Service finding every product-search API Pod. One Pod can have an owner relationship for management and a selector relationship for traffic at the same time.
:::

:::expand[How do ready Pods become Service backends?]{kind="recap"}
The Service selector identifies candidate Pods. Pod readiness describes which candidates can serve ordinary traffic. The control plane publishes their addresses, ports, and conditions in EndpointSlices, and networking components use those records to program the Service data plane.
:::

:::expand[How does a pending Pod become a running process?]{kind="recap"}
The scheduler filters and scores Nodes, then records a binding for a suitable Node. The kubelet on that Node observes the assigned Pod and asks the container runtime to create its containers. The Pod then progresses through image retrieval, process startup, and readiness before it becomes an ordinary Service backend.
:::

:::expand[Which path changes the cluster, and which path carries requests?]{kind="recap"}
The control path uses the API, controllers, scheduler, kubelet, and EndpointSlice controller to build and maintain runtime state. The data path resolves a Service, chooses a ready backend through the programmed Service data plane, and reaches the application process at the Pod IP and target port.
:::

:::expand[How do you find the first broken relationship?]{kind="recap"}
Start from the failed caller contract, inspect the Service selector and ports, resolve the selector into Pods, compare Pod readiness with EndpointSlices, verify the target port and listener, then follow missing Pods through ReplicaSet ownership and scheduler events. Stop where the expected relationship first differs from observed state.
:::

## References
<!-- section-summary: Kubernetes documentation defines the application objects, ownership records, selectors, endpoints, scheduling, and runtime relationships used in this model. -->

- [Objects In Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Official explanation of Kubernetes objects, desired state, `spec`, and `status`.
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Official controller and reconciliation pattern.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official definition of the Pod as the smallest deployable compute object.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Deployment, ReplicaSet, revision, scaling, and rollout behavior.
- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) - Official replica maintenance and selector behavior.
- [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) - Official owner-reference and dependent-lifecycle semantics.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official dynamic grouping semantics and selector constraints.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service selectors, virtual IPs, and port mappings.
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Official endpoint records, conditions, ownership, and distribution behavior.
- [Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/) - Official filtering, scoring, and binding overview.
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Official scheduling and runtime behavior for CPU and memory requests and limits.
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Official Pod phases, conditions, container states, and readiness behavior.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Official Service DNS naming and namespace resolution rules.
