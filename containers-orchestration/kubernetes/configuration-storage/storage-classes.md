---
title: "Storage Classes"
description: "Choose and operate Kubernetes StorageClasses so PersistentVolumeClaims get the right kind of backing storage."
overview: "StorageClasses describe the storage profiles a cluster offers, letting application claims ask for storage without hardcoding provider details."
tags: ["kubernetes", "storageclass", "pvc", "csi"]
order: 6
id: article-containers-orchestration-kubernetes-configuration-storage-storage-classes
---
## Table of Contents

1. [Storage Profiles for Claims](#storage-profiles-for-claims)
2. [What a StorageClass Does](#what-a-storageclass-does)
3. [The CSI Provisioner Does the Real Work](#the-csi-provisioner-does-the-real-work)
4. [Parameters Are Platform-Owned Details](#parameters-are-platform-owned-details)
5. [Default StorageClass Behavior](#default-storageclass-behavior)
6. [volumeBindingMode and Scheduling](#volumebindingmode-and-scheduling)
7. [Reclaim Policy and Expansion](#reclaim-policy-and-expansion)
8. [Allowed Topologies and Zones](#allowed-topologies-and-zones)
9. [Naming and Review with Platform Teams](#naming-and-review-with-platform-teams)
10. [Troubleshoot the Wrong Class](#troubleshoot-the-wrong-class)
11. [Assembled Example](#assembled-example)
12. [Review Checklist](#review-checklist)
13. [References](#references)

## Storage Profiles for Claims
<!-- section-summary: A StorageClass is the named storage profile that a PVC can request. -->

The PVC article showed the application side of durable storage: a workload asks for capacity and access. The next question is what kind of storage the claim should receive. Application teams should not memorize cloud disk SKUs, storage array pools, topology flags, or CSI driver parameters for every workload. They need a small set of reviewed storage profiles with names they can choose.

A **StorageClass** is the named provisioning profile for a PVC. The PVC names the profile, Kubernetes asks the provisioner behind that profile for real storage, and the resulting PV satisfies the claim. The application team owns the PVC request. The platform team owns what each StorageClass means.

For the Customer Notification Platform, `notification-postgres` might need low-latency durable storage, while an archive export job can use a cheaper profile. The important pieces are the profile name, the CSI provisioner behind it, binding behavior, reclaim policy, topology, and the review conversation between app and platform teams.

The first useful idea is a profile catalog. `fast-ssd` says "use the low-latency class for database writes." `standard` says "use normal durable storage." `shared-rwx` says "use storage that supports shared read-write access where the platform offers it." Those names let reviewers discuss the workload need without copying provider internals into each PVC.

A beginner-friendly profile catalog might look like this:

| Profile name | Typical workload | What the name promises |
|---|---|---|
| `standard` | Small services, test databases, low-volume tools | General durable storage with normal cost and performance |
| `fast-ssd` | PostgreSQL, search indexes, latency-sensitive writes | Lower latency and stronger performance expectations |
| `shared-rwx` | Shared reports, uploads, tools that need many readers | A filesystem that can be mounted by more than one Pod or node |
| `archive-retain` | Compliance exports, recovery copies, slow-changing data | Cheaper storage with a retention-focused deletion policy |

Those names are examples. The important part is that each class has a clear promise that a PVC can request by name.

Here is the small profile shape:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: csi.example.com
volumeBindingMode: WaitForFirstConsumer
```

The fields describe the provisioning profile:

- `metadata.name: fast-ssd` is the profile name a PVC requests.
- `provisioner` points to the storage driver that creates the real volume.
- `volumeBindingMode` controls whether provisioning waits for Pod scheduling information.

A PVC can then ask for that profile:

```yaml
spec:
  storageClassName: fast-ssd
```

That one field connects the application request to the platform profile:

- The PVC still owns size and access mode.
- The StorageClass owns the provisioner, binding mode, topology, and deletion behavior.

That PVC field is the connection between the durable-data request and the provisioning profile. The PVC still owns size and access-mode needs; the StorageClass owns the platform details for creating the backing PV.

The application team can ask for the published profile without knowing the exact cloud disk SKU, storage array pool, or CSI driver parameters.

## What a StorageClass Does
<!-- section-summary: StorageClasses separate application storage requests from the provider details needed to create real volumes. -->

In the Customer Notification Platform, `notification-postgres` needs low-latency durable storage. A batch archive job might need cheaper storage. A shared report export path might need a network filesystem that supports many readers.

A StorageClass gives those choices names such as `fast-ssd`, `standard`, or `shared-rwx`. The name serves as the contract between application teams and platform teams. The PVC asks for a class, and the class describes how the cluster should create the backing PersistentVolume.

This section builds on the PVC article. The claim says how much storage the workload needs and which access mode it expects. The StorageClass says what kind of storage profile can satisfy that request. For the notification platform, that means the PostgreSQL claim can ask for low-latency storage by name while an archive job can choose a different profile with different cost and lifecycle behavior.

![StorageClass provisioning flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-provisioning-flow.png)

*A PVC asks for a class name, Kubernetes calls the CSI provisioner, and the provisioner creates the real backing volume.*

This abstraction keeps manifests portable. A development cluster might use a local CSI driver, while production uses a managed cloud disk driver. Both clusters can expose a class named `fast-ssd` if they want the same application manifest to work.

## The CSI Provisioner Does the Real Work
<!-- section-summary: The provisioner field points to the CSI driver or in-tree provisioner that creates and manages storage. -->

The **provisioner** field names the storage driver that creates volumes. Modern Kubernetes storage usually uses **CSI**, the Container Storage Interface. CSI drivers let storage vendors and cloud providers integrate with Kubernetes through a standard interface.

The StorageClass passes a provisioning request to the named driver. The driver talks to the cloud API, storage array, local volume manager, or network filesystem system behind the cluster.

For beginners, this explains why a StorageClass can look small while still creating a real disk or filesystem. Kubernetes records the profile, but the CSI driver performs the platform-specific work. When a PVC for `notification-postgres` requests `fast-ssd`, the driver behind that class is the component that knows how to allocate, attach, resize, snapshot, or delete the real volume.

You can see available classes with:

```bash
kubectl get storageclass
```

Example output:

```console
NAME                 PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE
fast-ssd             csi.example.com         Delete          WaitForFirstConsumer
standard (default)   csi.example.com         Delete          Immediate
shared-rwx           nfs.csi.example.com     Retain          Immediate
```

The provisioner name tells platform engineers which driver owns the class. Application reviewers usually care more about the class name, access modes, performance expectations, topology behavior, and reclaim policy.

## Parameters Are Platform-Owned Details
<!-- section-summary: StorageClass parameters tune provider behavior, so platform teams should document what each class promises. -->

**Parameters** are key-value settings passed to the provisioner. They can describe disk type, filesystem type, replication setting, encryption setting, performance tier, network share mode, or another provider-specific option.

These fields are powerful because they shape the actual storage created for every claim using the class. They are also provider-specific, so application teams should usually consume a documented class name rather than copying parameter snippets into new profiles. The platform team can tune encryption, disk type, replication, and filesystem behavior once, then publish the class with a clear promise.

```yaml
parameters:
  type: ssd
  encrypted: "true"
```

Those parameters are only examples:

- `type: ssd` might choose a disk tier for one CSI driver.
- `encrypted: "true"` might request provider-side encryption for that driver.
- Another CSI driver may use completely different keys for the same broad idea.

The exact keys depend on the CSI driver. A cloud disk driver and an NFS driver use different parameters. That is why StorageClasses should be owned and documented by the platform team rather than copied from random examples.

For application teams, the practical question is not "which hidden parameter should we choose?" The practical question is "which class should `notification-postgres` use for durable low-latency database storage, and what are the limits?" The answer should appear in platform docs or class descriptions.

## Default StorageClass Behavior
<!-- section-summary: A default StorageClass can satisfy PVCs without storageClassName, but production workloads should choose intentionally. -->

A cluster can mark one StorageClass as the default. PVCs without `storageClassName` can use that class automatically.

This behavior is helpful in small clusters because a basic PVC can bind without extra fields. In production, the default can hide an important decision. A database claim that omits `storageClassName` might receive the general-purpose class even though the workload needs a lower-latency or retained-storage profile. Important data paths should name the class explicitly during review.

That explicit name gives reviewers a visible link from the workload to the published storage profile.

```bash
kubectl get storageclass
```

The default class appears with `(default)` in the output:

```console
NAME                 PROVISIONER       RECLAIMPOLICY
standard (default)   csi.example.com   Delete
fast-ssd             csi.example.com   Delete
```

Default classes are convenient for tutorials and simple workloads. Production stateful workloads should usually set `storageClassName` explicitly so the review shows the intended performance, topology, reclaim, and expansion behavior.

If a PVC should bind only to a manually created PV, set `storageClassName: ""`. That empty string is different from omitting the field. It tells Kubernetes not to use the default class for that claim.

## volumeBindingMode and Scheduling
<!-- section-summary: volumeBindingMode controls whether Kubernetes provisions storage immediately or waits until it knows where the Pod will run. -->

**volumeBindingMode** controls when Kubernetes binds or provisions the volume. `Immediate` creates or binds the volume as soon as the PVC appears. `WaitForFirstConsumer` waits until a Pod that uses the claim is being scheduled.

This setting connects storage provisioning to Pod placement. Some volumes live in one zone or attach only to certain nodes, so creating the volume before the scheduler knows the Pod location can create a mismatch. For `notification-postgres`, waiting for the first consumer lets Kubernetes use scheduling information before the driver creates the disk.

For zonal storage, `WaitForFirstConsumer` is often the safer default. Kubernetes can choose a volume zone that matches the node where the Pod will run. This avoids creating a disk in one zone and then discovering that the Pod can only schedule in another zone.

```yaml
volumeBindingMode: WaitForFirstConsumer
```

This setting delays provisioning until scheduling has useful context:

- The scheduler can consider node and zone placement before the storage driver creates the volume.
- A PVC can look pending for a while and still be healthy if no consuming Pod exists yet.

The visible behavior can surprise beginners. A PVC may stay `Pending` until a Pod references it. That pending state can be healthy when the class waits for the first consumer.

The PVC events show whether this state is expected:

```bash
kubectl describe pvc notification-postgres-data -n customer-notifications
```

Expected event for this mode:

```console
Normal  WaitForFirstConsumer  persistentvolume-controller  waiting for first consumer to be created before binding
```

## Reclaim Policy and Expansion
<!-- section-summary: reclaimPolicy controls data cleanup after claim deletion, and allowVolumeExpansion controls whether claims can grow. -->

**reclaimPolicy** tells Kubernetes what to do with dynamically provisioned PVs after the PVC is deleted. `Delete` removes the backing storage through the provisioner. `Retain` keeps the backing volume for manual recovery or inspection.

This is a data-loss review point. A PVC deletion might be part of a cleanup, a namespace removal, or a failed migration. The reclaim policy decides whether the backing volume goes away with the claim or stays for an operator to inspect. Before a class is used for production data, the team should know which behavior it carries.

```yaml
reclaimPolicy: Delete
```

This policy is a deletion decision:

- `Delete` lets the provisioner remove the backing storage after the PVC is deleted.
- `Retain` keeps the backing storage for manual recovery or inspection.

For ephemeral test databases, `Delete` may fit. For production state, the team should understand deletion consequences before relying on it. Some organizations use `Retain` for critical classes and require manual cleanup after recovery checks.

**allowVolumeExpansion** lets users increase the requested size of a bound PVC when the CSI driver supports expansion.

```yaml
allowVolumeExpansion: true
```

Expansion support needs a tested operational path:

- The CSI driver must support growing the volume.
- The team should know whether the filesystem grows online or needs a Pod restart.

Expansion is a growth path, not a substitute for capacity planning. Monitor disk usage, alert before the volume is full, and test how the filesystem expands for the chosen driver.

![StorageClass decision matrix](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-decision-matrix.png)

*StorageClass review should connect workload needs to provisioner, binding mode, reclaim policy, expansion, and topology.*

## Allowed Topologies and Zones
<!-- section-summary: Allowed topologies restrict where storage can be provisioned so volumes match node and failure-domain rules. -->

**allowedTopologies** limits where the provisioner can create volumes. It is commonly used with zonal storage so a class provisions disks only in approved zones or regions.

Topology turns the storage profile into a placement rule. If a volume can attach only in a specific zone, the Pod, node, and volume need to line up. The class can restrict provisioning to approved zones, while the scheduler and binding mode use that information to keep the PVC and Pod compatible.

This matters most for zonal disks and local storage, where a valid volume in the wrong place still cannot serve the Pod.

```yaml
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.kubernetes.io/zone
        values:
          - zone-a
          - zone-b
```

The topology rule constrains where new volumes can land:

- The key usually matches a node or zone label used by the scheduler.
- The values list the approved failure domains for that storage profile.

Topology rules protect scheduling and failure-domain plans. If `notification-postgres` can run only in zones where the database disk can attach, the StorageClass and scheduler need to agree on those zones.

For multi-zone production workloads, topology belongs in a larger design. The StorageClass can place a volume in a zone, but the database or application still needs replication, backup, and recovery planning across failures.

## Naming and Review with Platform Teams
<!-- section-summary: StorageClass names should describe user-facing storage intent rather than exposing every provider implementation detail. -->

Good StorageClass names describe the promise made to application teams. Names such as `fast-ssd`, `standard`, `shared-rwx`, and `archive-retain` are clearer than provider SKU names copied into every workload manifest.

The naming conversation is part of platform design. A class name should help an application reviewer choose storage without reading CSI-driver internals. If the platform team publishes `fast-ssd`, the docs should explain which workloads it fits, which access modes it supports, what happens on PVC deletion, and how teams request growth or exceptions.

Each published class should document:

| Topic | Example question |
|---|---|
| Use case | Which workloads should request this class? |
| Access modes | Does it support `ReadWriteOnce`, `ReadWriteMany`, or `ReadWriteOncePod`? |
| Performance | What latency or throughput should teams expect? |
| Topology | Is it zonal, regional, local, or network-based? |
| Reclaim | Does PVC deletion delete or retain data? |
| Expansion | Can claims grow after binding? |

The platform team owns the class. Application teams own the claim. A healthy review names both sides, so storage requests do not turn into guesswork.

## Troubleshoot the Wrong Class
<!-- section-summary: StorageClass mistakes appear as Pending PVCs, unexpected reclaim behavior, scheduling conflicts, or storage performance surprises. -->

The claim gives the first clue:

Troubleshooting starts from the PVC because the claim records what the workload asked for and which class it selected. A wrong class name, unsupported topology, unexpected reclaim policy, or poor performance all leave evidence across the PVC, StorageClass, and bound PV. Follow those objects in order before blaming the application container.

For `notification-postgres`, this path shows whether the issue is profile selection, provisioner behavior, scheduling, or data lifecycle.

That matters during incidents because the same symptom, such as a pending database Pod, can come from a typo in the class name or a valid class waiting for topology information.

```bash
kubectl describe pvc notification-postgres-data -n customer-notifications
```

If the class name is wrong, events can show:

```console
Warning  ProvisioningFailed  persistentvolume-controller  storageclass.storage.k8s.io "fast-ssd" not found
```

Then inspect the class:

```bash
kubectl describe storageclass fast-ssd
```

The description should answer the platform questions:

- Which provisioner owns the class?
- Which reclaim policy, binding mode, expansion setting, parameters, and topology rules apply?

Useful fields include provisioner, reclaim policy, volume binding mode, expansion, parameters, and allowed topologies. If a claim is bound but performance is poor, compare the workload need against the class promise. The problem may be a wrong class selection rather than a Kubernetes failure.

For unexpected data deletion, check the reclaim policy on the bound PV:

```bash
kubectl get pv pvc-0d2df0c0-97d6-4d0d-a0a0-4a9d6e91a111 -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy
```

Example output:

```console
NAME                                       RECLAIM
pvc-0d2df0c0-97d6-4d0d-a0a0-4a9d6e91a111   Delete
```

The `RECLAIM` column tells you whether the PV was set to `Delete` or `Retain` at creation time.

## Assembled Example
<!-- section-summary: The full example shows a documented StorageClass and a PVC that requests it explicitly. -->

Here is an assembled `fast-ssd` class for a cluster with a fictional CSI driver. Real clusters should use the exact parameters documented by their storage provider.

The full example shows the platform profile beside the application request. The StorageClass records provisioner, parameters, reclaim behavior, expansion, and binding mode. The PVC then asks for the profile by name. Keeping those objects together in the article makes the handoff clear: platform teams publish profiles, and application teams request them intentionally.

In a real repository, the StorageClass may live in platform infrastructure code while the PVC lives beside the workload manifest.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
  annotations:
    storageclass.kubernetes.io/is-default-class: "false"
provisioner: csi.example.com
parameters:
  type: ssd
  encrypted: "true"
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notification-postgres-data
  namespace: customer-notifications
spec:
  storageClassName: fast-ssd
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

The assembled example shows the handoff:

- The StorageClass publishes the platform profile named `fast-ssd`.
- The PVC requests that profile explicitly with `storageClassName`.
- The fictional provisioner and parameters must be replaced with the real values from the cluster platform team.

The PVC shows the application team's request. The StorageClass shows the platform team's profile. Keep those responsibilities separate during review.

![StorageClass topology and scheduling](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-topology-and-scheduling.png)

*Binding mode and topology decide whether the volume is created before scheduling or after Kubernetes knows the Pod placement.*

## Review Checklist
<!-- section-summary: A StorageClass review checks provisioner ownership, workload fit, binding behavior, reclaim policy, expansion, and topology. -->

Use this checklist before asking workloads to use a class:

The checklist is for platform readiness. A StorageClass can affect many PVCs, so the review should confirm that the CSI driver is supported, the class promise matches real workloads, deletion behavior is understood, expansion is tested, and topology choices will not strand Pods away from their volumes. Once apps depend on a class, changing its meaning can affect production data.

That is why published class names should carry clear documentation and change control.

| Check | What to confirm |
|---|---|
| Provisioner | The CSI driver is installed, supported, and monitored |
| Workload fit | The class matches the app's latency, throughput, and access-mode needs |
| Binding | `Immediate` or `WaitForFirstConsumer` matches the scheduling and topology plan |
| Reclaim | PVC deletion behavior is understood before production data lands there |
| Expansion | Growth behavior is supported and tested |
| Documentation | Platform docs tell application teams when to use the class |

## References

- [StorageClasses](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [CSI volumes](https://kubernetes.io/docs/concepts/storage/volumes/#csi)
