---
title: "StatefulSets"
description: "Run Kubernetes workloads that need stable identity, ordered rollout, and persistent storage."
overview: "StatefulSets manage persistent identity slots: a Pod may be replaced, while its ordinal, network name, and storage association remain stable."
tags: ["statefulsets", "storage", "pods", "identity"]
order: 4
id: article-containers-orchestration-kubernetes-workloads-statefulsets
---

## Table of Contents

1. [Why does a stateful workload need a stable replica identity?](#why-does-a-stateful-workload-need-a-stable-replica-identity)
2. [How does a StatefulSet keep a Pod name, DNS name, and storage claim aligned?](#how-does-a-statefulset-keep-a-pod-name-dns-name-and-storage-claim-aligned)
3. [What job does the headless Service perform?](#what-job-does-the-headless-service-perform)
4. [How does each replica receive its own PersistentVolumeClaim?](#how-does-each-replica-receive-its-own-persistentvolumeclaim)
5. [How do ordered creation, scaling, and rolling updates work?](#how-do-ordered-creation-scaling-and-rolling-updates-work)
6. [What happens to a member's storage during replacement, scale-down, and deletion?](#what-happens-to-a-members-storage-during-replacement-scale-down-and-deletion)
7. [How do you inspect one member from the StatefulSet controller to its DNS name and disk?](#how-do-you-inspect-one-member-from-the-statefulset-controller-to-its-dns-name-and-disk)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

A Pod is ultimately a place where one or more processes run. If that Pod is deleted or its node fails, Kubernetes can create a replacement process somewhere else. Restarting restores compute capacity. A stateful application also needs to answer a deeper question:

Here, **state** means information that must remain useful beyond the lifetime of one process. The bytes in a database file are state. A member's place in a replication group can also be state because the other members remember its identity. Kubernetes can replace compute automatically, but information that outlives that compute needs an explicit storage and identity model.

> **Which facts about this member must survive when its current process disappears?**

For a stateless web server, one healthy replica can usually replace another. Requests arrive through a shared Service, durable data lives elsewhere, and callers use the shared endpoint rather than a particular Pod name.

A database member, message-broker replica, or consensus-system peer can have a different contract. Member `1` may own a particular disk, appear in peer membership records under a particular name, and need to return as the same logical member after a crash. Its current process is replaceable, while its identity continues across replacements.

Suppose a three-member system uses these relationships:

| Logical member | Pod name | Stable peer name | Private claim |
|---:|---|---|---|
| `0` | `db-0` | `db-0.db` | `data-db-0` |
| `1` | `db-1` | `db-1.db` | `data-db-1` |
| `2` | `db-2` | `db-2.db` | `data-db-2` |

If the process for member `1` dies, the safe replacement is another `db-1` that can be found at `db-1.db` and mounts `data-db-1`. Creating an unrelated member with a random name and a blank disk would change the system's membership instead of repairing it.

The central idea is:

> **The process is disposable; the logical identity persists.**

A StatefulSet expresses that idea by managing an ordered set of identity slots. Each slot joins an ordinal, a Pod name, a network identity, and usually a storage claim.

Keep these questions in view as you work through the lesson:

1. **Why does a stateful workload need a stable replica identity?**
2. **How does a StatefulSet keep a Pod name, DNS name, and storage claim aligned?**
3. **What job does the headless Service perform?**
4. **How does each replica receive its own PersistentVolumeClaim?**
5. **How do ordered creation, scaling, and rolling updates work?**
6. **What happens to a member's storage during replacement, scale-down, and deletion?**
7. **How do you inspect one member from the StatefulSet controller to its DNS name and disk?**

## Why does a stateful workload need a stable replica identity?
<!-- section-summary: A StatefulSet preserves a numbered member identity when an application connects a particular replica to a peer name, startup position, or private disk. -->

### Member identity adds to the replica count

A Deployment with `replicas: 3` asks Kubernetes to maintain three interchangeable copies of one Pod template. The controller may create Pods with generated names, and any ready Pod can usually serve the same request. The important condition is the count: three healthy copies exist.

A StatefulSet with `replicas: 3` asks Kubernetes to maintain three distinct identity slots:

| Desired slot | Deterministic Pod name |
|---:|---|
| `0` | `db-0` |
| `1` | `db-1` |
| `2` | `db-2` |

The number at the end is the **ordinal**. It gives the application a stable way to distinguish one member from another. A database may use it to associate each member with a private data directory. A consensus system may store the corresponding peer names in its membership configuration. A broker may use the names so that clients and other brokers can address particular members.

The difference can be stated plainly:

| Deployment model | StatefulSet model |
|---|---|
| “Keep three equivalent replicas running.” | “Keep identity slots `0`, `1`, and `2` present.” |
| Any replacement replica can take the missing capacity. | The replacement must occupy the missing ordinal. |
| One shared Service is often the only name callers need. | Individual members may also need stable names. |
| Durable state normally lives outside the replica. | Each member can be associated with its own durable claim. |

### A new Pod object can represent the same logical member

Assume the current `db-1` Pod has UID `A`. Its node disappears, so Kubernetes eventually creates a new `db-1` Pod with UID `B` on another node.

The Pod UID changes because these are two different Kubernetes objects. The Pod IP may change because the replacement is attached to a new network endpoint. The following application-facing relationships can remain stable:

- ordinal `1`;
- Pod name and hostname `db-1`;
- peer DNS name such as `db-1.db`;
- claim `data-db-1`; and
- the storage volume already bound to that claim.

StatefulSet Pods therefore carry distinct member identities, unlike the interchangeable Pods behind a typical Deployment. Kubernetes restores the missing member slot as well as the replica count.

### Where StatefulSet's responsibility ends

Creating three PostgreSQL Pods in a StatefulSet creates three stable Kubernetes member slots. A highly available PostgreSQL cluster also needs database replication, leader election, backup, restore, data synchronization, and safe membership changes. Those database behaviors remain outside the StatefulSet controller.

It supplies the lower-level Kubernetes pieces that stateful software can use:

- stable numbered members;
- stable member names;
- stable per-member storage associations; and
- predictable creation, scaling, and update order.

The application, an application-specific operator, or an external managed service must still decide how the members form a cluster and protect the data.

That boundary tells us what to examine next. StatefulSet can remain independent of a database's replication algorithm while reliably reconstructing the Kubernetes identity that the database uses. The ordinal is the key that lets the controller join the Pod name, network name, and storage claim.

## How does a StatefulSet keep a Pod name, DNS name, and storage claim aligned?
<!-- section-summary: The StatefulSet controller reconciles ordinal identity slots and recreates a missing slot with the same Pod name, network identity, and claim association. -->

### The controller reconciles identity slots

Suppose a StatefulSet is named `db` and has `replicas: 3`. Its desired state is the exact set of ordinals `{0, 1, 2}`.

For every desired ordinal, the controller asks questions such as:

1. Does the Pod for this ordinal exist?
2. Does it use the StatefulSet's current Pod template?
3. Is its governing network identity available through the named Service?
4. Does the Pod reference the claim generated for this ordinal?

If slot `1` has no Pod, the controller creates `db-1`. The default Pod name follows this rule:

```text
<statefulset-name>-<ordinal>
```

Kubernetes also adds the label `apps.kubernetes.io/pod-index` with the ordinal as its value. For `db-1`, that label has value `1`. Monitoring, routing, and operational tools can use the label without having to parse the Pod name.

The durable relationship is:

> **ordinal → Pod identity → network identity → storage identity**

The current Pod process sits inside that relationship. When the process or Pod object changes, the controller reconstructs the slot around the same ordinal.

![Studio Light infographic showing the StatefulSet controller maintaining ordinal slots 0, 1, and 2, with each slot connected to a deterministic Pod name, member DNS name, and ordinal PVC; the middle Pod is replaced while its identity connections remain](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-identity-contract.png)

*The replacement for ordinal `1` receives a new Pod UID and possibly a new IP, while the `db-1` name, DNS identity, and `data-db-1` claim remain tied to the same logical member.*

### What stability means at each layer

A stable Pod name can belong to a sequence of replacement Pod objects. A stable network identity lets DNS resolve one member name to the current Pod IP. Stable storage reconnects the identity slot to the same claim and bound volume when the underlying storage system allows it. Data replication and backup remain separate application and storage responsibilities.

Keeping these layers separate makes failure behavior easier to reason about:

| Property | What happens during replacement |
|---|---|
| Ordinal | Remains `1` |
| Pod name and hostname | Returns as `db-1` |
| Pod UID | Changes |
| Pod IP and node | May change |
| Member DNS name | Remains predictable and resolves to the current endpoint |
| PVC name | Remains `data-db-1` |
| Backing data | Remains on the bound volume unless the storage system or lifecycle policy removes it |

The Pod name gives Kubernetes a stable identity inside the API. Other processes still need a way to find that member over the network. The governing headless Service turns the stable hostname into a DNS record that can follow the Pod's changing IP address.

## What job does the headless Service perform?
<!-- section-summary: A headless Service gives each selected StatefulSet Pod a discoverable DNS identity instead of hiding all members behind one load-balanced virtual IP. -->

### A shared Service name and a member name solve different problems

A normal ClusterIP Service gives clients one stable virtual IP and balances connections across selected Pods. That is useful when a caller wants any healthy replica. It deliberately hides which Pod receives the connection.

Stateful peers can need the opposite. During bootstrap, `db-2` may need to contact `db-0` specifically. A client diagnosing replication may need to address `db-1`. One load-balanced address cannot express those member choices.

A **headless Service** sets:

```yaml
spec:
  clusterIP: None
```

A headless Service omits the usual Service virtual IP and load-balancing path. Kubernetes DNS publishes records that expose the selected endpoints directly. The application can then use a stable member name while DNS points that name to the current Pod IP.

DNS is the name-to-address layer. A peer asks for `db-1.db`; cluster DNS returns the IP of the current `db-1` Pod. If Kubernetes later recreates that Pod with another IP, the peer keeps using the same name and DNS can return the replacement address.

The StatefulSet connects to this Service through `spec.serviceName`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  clusterIP: None
```

The StatefulSet names that governing Service with `serviceName: db`. Cluster DNS then turns the Service name plus each Pod hostname into a stable member address. The complete manifest later in the article shows how a selector connects the Service to the Pod-template labels.

For a StatefulSet named `db`, governing Service `db`, namespace `default`, and cluster domain `cluster.local`, the members receive names such as:

| Pod | Fully qualified member name |
|---|---|
| `db-0` | `db-0.db.default.svc.cluster.local` |
| `db-1` | `db-1.db.default.svc.cluster.local` |
| `db-2` | `db-2.db.default.svc.cluster.local` |

The shorter `db-1.db` form usually works from a Pod in the same namespace. The complete name makes every part visible: Pod hostname, governing Service, namespace, the `svc` zone, and the cluster's configured DNS domain.

### Discovery may be needed before readiness

By default, a Pod normally needs to be Ready before its individual DNS record is published. Some distributed systems cannot become Ready until they first discover and contact their peers. That creates a bootstrap dependency: peer discovery waits for readiness while readiness waits for peer discovery.

Setting `publishNotReadyAddresses: true` on the headless Service allows the addresses to be published before readiness succeeds:

```yaml
spec:
  clusterIP: None
  publishNotReadyAddresses: true
```

This setting makes early discovery possible. Readiness still reports whether the member is safe for normal traffic, so the choice must match the application's bootstrap protocol.

The network path now preserves *where peers find member `1`*. A stateful member also needs the bytes that belong to member `1`. StatefulSet uses the same ordinal to create that second path through a per-member PersistentVolumeClaim.

## How does each replica receive its own PersistentVolumeClaim?
<!-- section-summary: A volumeClaimTemplate creates one PVC for every ordinal so each logical member can reconnect to its own storage after Pod replacement. -->

### A shared volume and per-member storage express different data models

If all three database Pods mount one writable claim, they see the same filesystem. That arrangement is only correct when the application and storage system are explicitly designed for shared access. It does not automatically give each database member an independent data directory.

Three Kubernetes storage objects participate in the per-member path:

| Object | Beginner meaning | Role in this article |
|---|---|---|
| PersistentVolumeClaim (PVC) | A namespaced request for storage | `data-db-1` is the request associated with member `1` |
| PersistentVolume (PV) | The Kubernetes record for storage that satisfies a claim | It represents the volume bound to `data-db-1` |
| StorageClass | A provisioning profile offered by the cluster | It tells the provisioner what kind of volume to create when a matching PV is needed |

The claim gives the workload a stable Kubernetes handle. The PV and storage driver connect that handle to the actual disk, network volume, or other storage system. This separation lets the Pod refer to a claim without embedding provider-specific disk details in the Pod template.

A StatefulSet usually needs a repeatable rule instead:

| Identity slot | Generated PVC | Bound storage |
|---:|---|---|
| `0` | `data-db-0` | volume A |
| `1` | `data-db-1` | volume B |
| `2` | `data-db-2` | volume C |

`volumeClaimTemplates` is the rule that generates those claims. The template is written once inside the StatefulSet, and the controller creates one PVC per Pod ordinal:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes:
        - ReadWriteOncePod
      resources:
        requests:
          storage: 10Gi
```

The template name is `data`, so the generated claim names combine that name with the StatefulSet Pod name. The container mounts a volume with the same template name:

```yaml
volumeMounts:
  - name: data
    mountPath: /usr/share/nginx/html
```

For production use, Kubernetes recommends `ReadWriteOncePod` when the storage driver supports it and one Pod should have read-write access to the claim across the cluster. The claim must also name a StorageClass that can dynamically provision a suitable volume, or the cluster must already contain a compatible PV.

The recovery model for ordinal `1` is concrete:

| Before failure | After replacement |
|---|---|
| Pod `db-1`, UID `A` | Pod `db-1`, UID `B` |
| PVC `data-db-1` | PVC `data-db-1` |
| Bound volume B | Bound volume B |

The replacement process returns to the stored data and logical member association that survived the failure.

![Two coordinated tracks for ordinal 1: a headless Service provides the db-1.db DNS identity, while a volume claim template produces data-db-1 and binds it to a PersistentVolume mounted by db-1](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-service-storage-path.png)

*The ordinal is the common key: member `1` receives both the `db-1.db` network identity and the `data-db-1` storage identity.*

### How the Objects Fit Together in One Manifest
<!-- section-summary: Matching names and labels connect the headless Service, StatefulSet, generated Pods, and generated claims. -->

This small manifest uses NGINX to make the object relationships visible. In a real system, interchangeable NGINX replicas would usually run in a Deployment; here the simple container keeps the focus on StatefulSet names, labels, and claims.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - name: http
      port: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: web
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          volumeMounts:
            - name: data
              mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes:
          - ReadWriteOncePod
        resources:
          requests:
            storage: 10Gi
```

Read the joins in this order:

1. `replicas: 3` creates identity slots `web-0`, `web-1`, and `web-2`.
2. `serviceName: web` connects each Pod hostname to the headless Service's DNS domain.
3. The Service selector and Pod-template label both use `app: web`, so the Service discovers the generated Pods.
4. The StatefulSet selector also matches the Pod-template label, so the controller knows which Pods belong to it.
5. The `data` volume mount matches the `data` claim-template name.
6. The controller creates `data-web-0`, `data-web-1`, and `data-web-2`, and each Pod mounts its corresponding claim.

The resulting identity slot combines an ordinal, a Pod, a DNS name, and a private claim. No single YAML field creates the entire relationship; the fields and objects join through matching names and labels.

At this point the identity slot is complete. The next question is how Kubernetes changes a set of these slots while respecting startup dependencies. Ordinal order supplies that lifecycle rule.

## How do ordered creation, scaling, and rolling updates work?
<!-- section-summary: StatefulSet lifecycle policies use ordinal order for creation, scale-down, and rolling updates while preserving each member's identity. -->

Stable identity answers *which member* Kubernetes is managing. Lifecycle policy answers *in what order* the controller changes those members.

### Default creation waits from the lowest ordinal upward

The default `podManagementPolicy` is `OrderedReady`. For three replicas, the controller creates `web-0` and waits until it is Running and Ready. It then creates `web-1`, waits again, and finally creates `web-2`.

`Running` means the Pod has been assigned to a node and its containers have started. `Ready` is a separate application-facing signal: its readiness checks say the Pod can participate in the service or member group. `OrderedReady` waits for both because a started process may still be loading data, replaying a log, or joining its peers.

This order can help a distributed application whose later members need an earlier member to finish bootstrap. Kubernetes remains independent of the application's membership protocol and provides a readiness-gated order that the application can use.

Readiness is therefore part of the controller's decision. A probe that becomes successful as soon as a port opens may allow the next member to start before the earlier member has actually joined the cluster. A stateful application often needs a probe that reflects meaningful membership or serving readiness.

If member startup is independent, `podManagementPolicy: Parallel` removes the create and scale ordering constraints. The controller may launch or terminate several Pods at once while still preserving their unique ordinals, names, and claims.

### Scaling changes the set of identity slots

Scaling from three replicas to four adds the next ordinal. The controller creates `web-3`, the claim template produces `data-web-3`, and the headless Service can publish `web-3.web`.

Scaling down removes the highest ordinal first. Changing from four replicas to two removes `web-3`, waits for it to terminate, and then removes `web-2`. Slots `0` and `1` remain. The descending order avoids removing a lower-numbered member while higher members still depend on it.

| Operation | Default ordinal order |
|---|---|
| Create or scale up | `0 → 1 → 2` |
| Scale down | `2 → 1 → 0` |
| Rolling update | `2 → 1 → 0` |

### Rolling updates also move from the highest ordinal downward

Assume `db-0`, `db-1`, and `db-2` run version `1`, and the StatefulSet's Pod template changes to version `2`. With the default `RollingUpdate` strategy, the controller replaces `db-2` first and waits until the new Pod is Running and Ready. It then replaces `db-1`, waits again, and finally replaces `db-0`.

StatefulSets also support partitioned rolling updates when only part of the ordinal set should move to the changed template.

`OnDelete` uses a different contract:

```yaml
updateStrategy:
  type: OnDelete
```

Kubernetes stores the new Pod template while automatic replacement stays disabled. When a Pod is later deleted, the StatefulSet recreates that ordinal from the current template.

![Studio Light infographic showing three StatefulSet lifecycle lanes: OrderedReady creation from ordinal 0 to 2, default rolling replacement from ordinal 2 to 0, and scale-down removing the highest ordinals while their PVCs remain by default](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-ordered-lifecycle.png)

*Creation normally moves upward through the ordinals; scale-down and rolling replacement move downward.*

Ordering explains which Pod changes first. Storage has its own lifecycle, so replacing or removing a Pod raises a separate question: whether its PVC and backing volume remain for that identity slot.

## What happens to a member's storage during replacement, scale-down, and deletion?
<!-- section-summary: Replacement reuses an ordinal's claim, while retention and PV reclaim policies separately control whether the claim and backing storage survive scale-down or deletion. -->

### Pod replacement normally reuses the existing claim

Suppose `db-1` mounts `data-db-1`, which is bound to volume B. Deleting `db-1` removes the current Pod object. The StatefulSet controller sees that ordinal `1` is missing and creates a new `db-1`. The replacement mounts `data-db-1`, so it reaches volume B again.

The same model applies when a node fails. The replacement may run on another node, and the storage system may need time to detach and reattach the physical disk. From the StatefulSet's point of view, the logical association is still ordinal `1` to `data-db-1`. The storage driver and infrastructure determine how quickly and safely that volume can move.

### Scale-down retains generated claims by default

If `db-0`, `db-1`, and `db-2` exist and the StatefulSet scales from three replicas to two, the controller removes `db-2`. By default, `data-db-2` remains.

That default favors data safety by preserving a database member's disk after scale-down. If the StatefulSet later scales back to three, the new `db-2` can reconnect to the existing claim. The application must decide whether the old member data is still valid. Some distributed systems require the returning member to rejoin or rebuild before serving from those files.

StatefulSet offers an explicit PVC retention policy:

```yaml
spec:
  persistentVolumeClaimRetentionPolicy:
    whenScaled: Delete
    whenDeleted: Retain
```

Both fields accept `Retain` or `Delete`, and both default to `Retain`:

| Policy field | Event it controls | `Retain` | `Delete` |
|---|---|---|---|
| `whenScaled` | An ordinal is removed by scale-down | Keep that ordinal's generated PVC | Delete it after the Pod terminates |
| `whenDeleted` | The StatefulSet is deleted | Keep all generated PVCs | Delete them after their Pods terminate |

These policies apply to Pods removed because of scale-down or StatefulSet deletion. A normal replacement after Pod or node failure continues to use the existing PVC.

### Claim retention and backing-volume reclaim are separate decisions

The StatefulSet policy answers whether the PVC should disappear. If the PVC is deleted, the bound PV's reclaim policy answers what happens to the storage resource.

| Layer | Lifecycle question |
|---|---|
| StatefulSet `persistentVolumeClaimRetentionPolicy` | Should the generated PVC be deleted for this event? |
| PV reclaim policy | After the claim is deleted, should the PV and external storage be retained or deleted? |

With a `Retain` PV reclaim policy, deleting the PVC leaves the PV and external data for manual recovery. With a supported `Delete` policy, deleting the PVC normally removes the PV and the external storage asset as well. A Pod deletion, a PVC deletion, and destruction of the stored bytes are intentionally different operations.

Backup, restore, replication, and data synchronization still need their own design. A retained PVC preserves one Kubernetes claim association; StatefulSet does not provide those application-level data mechanisms.

### Duplicate member identities can corrupt a distributed system

Force deletion tells the API server to remove a Pod object without waiting for confirmation that its process has stopped. If a disconnected node still runs the old `db-1` process and Kubernetes starts another `db-1`, two processes may claim the same member identity.

For a distributed system, that can cause split brain, duplicate writers, volume corruption, or membership confusion. Stable identity is valuable because identity matters; that same fact makes duplicate identity dangerous.

These policies describe the intended behavior. During an incident, the practical task is to prove that one ordinal still connects to the expected Pod, DNS endpoint, claim, and volume. The inspection path follows those relationships in the same order in which the article built them.

## How do you inspect one member from the StatefulSet controller to its DNS name and disk?
<!-- section-summary: A reliable inspection follows one ordinal through the StatefulSet, Pod, governing Service, PVC, PV, and underlying storage. -->

Suppose the StatefulSet is called `db` and the member under investigation is `db-1`. Follow that one ordinal from the controller outward instead of reading every object at once.

Start with the controller's desired and observed state:

```bash
kubectl get statefulset db
kubectl describe statefulset db
```

These commands show the controller and its desired configuration. Next, inspect the current Pod:

```bash
kubectl get pod db-1 -o wide
kubectl describe pod db-1
```

Read the ordinal directly from its standard label:

```bash
kubectl get pod db-1 \
  -o jsonpath='{.metadata.labels.apps\.kubernetes\.io/pod-index}{"\n"}'
```

The expected value is `1`.

Inspect the governing headless Service:

```bash
kubectl get service db
kubectl describe service db
```

Its cluster IP should be `None`, and its selector should match the Pod labels. The stable member name is `db-1.db`.

Now follow the storage association. If the claim template is named `data`, the claim for ordinal `1` is `data-db-1`:

```bash
kubectl get pvc
kubectl describe pvc data-db-1
```

Read the bound PV name:

```bash
kubectl get pvc data-db-1 \
  -o jsonpath='{.spec.volumeName}{"\n"}'
```

If the command returns `pvc-abc123`, inspect that PV:

```bash
kubectl describe pv pvc-abc123
```

This produces a practical chain:

| Inspection layer | Identity to follow | What it proves |
|---|---|---|
| StatefulSet | desired ordinal `1` | The controller expects the member |
| Pod | `db-1` and pod-index `1` | The current compute object occupies the slot |
| Headless Service | `db-1.db` | Member discovery uses the stable network identity |
| PVC | `data-db-1` | The slot requests the expected storage |
| PV and storage driver | bound PV such as `pvc-abc123` | The claim reaches the actual storage resource |

The first broken link tells you whether the problem lies between the StatefulSet and Pod, the Pod and its stable network identity, or the claim and its bound storage.

### When a StatefulSet Fits the Application
<!-- section-summary: StatefulSet fits software whose members need stable names, private disks, or ordered lifecycle, while interchangeable replicas usually fit a Deployment. -->

A StatefulSet is a strong fit when the application can make statements such as:

- “Member `2` must return as member `2`.”
- “Each replica needs its own disk.”
- “Peers must have stable, individual names.”
- “Later members should wait for earlier members during bootstrap.”
- “Replacing a process must preserve that member's data association.”

Distributed databases, consensus systems, brokers, and coordination systems often have one or more of those needs.

A Deployment is usually simpler when every replica is interchangeable, durable state lives elsewhere, and callers only need a load-balanced Service. REST APIs, frontends, stateless workers, and HTTP proxies usually have that shape.

The compact definition is:

> **A StatefulSet manages an ordered set of persistent identity slots. A Pod may die and be replaced, but its ordinal gives the replacement the same logical member name, network identity, and associated persistent storage.**

Once that identity-slot model is clear, the rest follows from it: ordinal Pod names identify the slots, a headless Service publishes each member, volume claim templates attach one claim per slot, lifecycle operations follow ordinal order, and retention policy decides how long the storage association survives.

## Check Your Answers
<!-- section-summary: Revisit stable member identity, headless-Service discovery, per-ordinal claims, ordered lifecycle, storage retention, and controller-to-disk inspection. -->

:::expand[Why does a stateful workload need a stable replica identity?]{kind="recap"}
A stateful member may have a peer name, a membership role, and a private disk that must survive the current process. A StatefulSet restores the missing identity slot instead of merely adding any interchangeable replica. The process and Pod object can change while the logical member remains the same.
:::

:::expand[How does a StatefulSet keep a Pod name, DNS name, and storage claim aligned?]{kind="recap"}
The controller assigns each desired member an ordinal such as `1`. That ordinal produces the Pod name `db-1`, participates in the member's DNS name, and appears in the generated claim `data-db-1`. If the Pod disappears, reconciliation recreates the same ordinal slot with those associations.
:::

:::expand[What job does the headless Service perform?]{kind="recap"}
A headless Service has `clusterIP: None`, selects the StatefulSet Pods, and exposes their current endpoints through DNS instead of hiding them behind one load-balanced virtual IP. `spec.serviceName` gives the StatefulSet Pods the governing Service's DNS subdomain, so peers can address members such as `db-1.db`.
:::

:::expand[How does each replica receive its own PersistentVolumeClaim?]{kind="recap"}
`volumeClaimTemplates` repeats one storage request for every ordinal. A template named `data` creates claims such as `data-db-0`, `data-db-1`, and `data-db-2`. Each generated Pod mounts the claim for its own slot, and a replacement mounts the same claim again.
:::

:::expand[How do ordered creation, scaling, and rolling updates work?]{kind="recap"}
Default `OrderedReady` creation moves from the lowest ordinal upward and waits for each Pod to become Running and Ready. Scale-down and default rolling updates move from the highest ordinal downward. `Parallel`, `OnDelete`, and rolling-update partitions change how the sequence is controlled without removing stable member identities.
:::

:::expand[What happens to a member's storage during replacement, scale-down, and deletion?]{kind="recap"}
Normal replacement reuses the ordinal's existing claim. Scale-down and StatefulSet deletion retain generated PVCs by default. `persistentVolumeClaimRetentionPolicy` can delete claims for either event, and the PV reclaim policy then decides what happens to the backing storage after claim deletion. Force deletion needs special caution because an old process may still be using the same member identity.
:::

:::expand[How do you inspect one member from the StatefulSet controller to its DNS name and disk?]{kind="recap"}
Start with the StatefulSet and ordinal Pod, then confirm the pod-index label. Follow the governing Service to the stable member name, and follow the ordinal PVC to its bound PV and storage driver. The first missing or inconsistent relationship identifies the layer that needs deeper investigation.
:::

## References
<!-- section-summary: Kubernetes documentation defines StatefulSet identity, ordering, DNS, storage, retention, and failure behavior. -->

- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) — identity, ordinals, governing Services, volume claim templates, ordering, rolling updates, and PVC retention.
- [StatefulSet Basics](https://kubernetes.io/docs/tutorials/stateful-application/basic-stateful-set/) — official walkthrough of stable Pod names, DNS, storage, scaling, and updates.
- [Service: Headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services) — direct endpoint discovery for a Service with `clusterIP: None`.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) — Service, Pod hostname, subdomain, and readiness-related DNS behavior.
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) — PVC binding, access modes, PV reclaim policy, and storage lifecycle.
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) — dynamic provisioning and storage management behavior.
- [Debug a StatefulSet](https://kubernetes.io/docs/tasks/debug/debug-application/debug-statefulset/) — official inspection starting points.
- [Force Delete StatefulSet Pods](https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/) — identity and split-brain risks around forced deletion.
- [Operator Pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) — application-specific controllers that add operational knowledge StatefulSet itself does not provide.
