---
title: "Storage Classes"
description: "Choose and operate Kubernetes StorageClasses so PersistentVolumeClaims get the right kind of backing storage."
overview: "StorageClasses describe the storage profiles a cluster offers, letting application claims ask for storage without hardcoding provider details."
tags: ["kubernetes", "storageclass", "pvc", "csi"]
order: 6
id: article-containers-orchestration-kubernetes-configuration-storage-storage-classes
---

## Table of Contents

1. [Start with the Storage Profile](#start-with-the-storage-profile)
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

## Start with the Storage Profile
<!-- section-summary: A StorageClass is the named storage profile that a PVC can request. -->

A real app team often needs a storage choice it can name. `notification-postgres` needs a fast disk for database writes, while an archive export job can use cheaper storage. The team should ask for `fast-ssd` or `standard` by name instead of copying cloud disk internals into every workload.

A **StorageClass** is a named storage profile in a Kubernetes cluster. It tells Kubernetes which storage provisioner to use and which platform-specific settings to pass when a PersistentVolumeClaim asks for storage.

Here is the small profile shape:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: csi.example.com
volumeBindingMode: WaitForFirstConsumer
```

A PVC can then ask for that profile:

```yaml
spec:
  storageClassName: fast-ssd
```

The application team does not need to know the exact cloud disk SKU, storage array pool, or CSI driver parameters. It asks for the profile the platform team has published.

## What a StorageClass Does
<!-- section-summary: StorageClasses separate application storage requests from the provider details needed to create real volumes. -->

In the Customer Notification Platform, `notification-postgres` needs low-latency durable storage. A batch archive job might need cheaper storage. A shared report export path might need a network filesystem that supports many readers.

A StorageClass gives those choices names such as `fast-ssd`, `standard`, or `shared-rwx`. The name serves as the contract between application teams and platform teams. The PVC asks for a class, and the class describes how the cluster should create the backing PersistentVolume.

![StorageClass provisioning flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-provisioning-flow.png)

*A PVC asks for a class name, Kubernetes calls the CSI provisioner, and the provisioner creates the real backing volume.*

This abstraction keeps manifests portable. A development cluster might use a local CSI driver, while production uses a managed cloud disk driver. Both clusters can expose a class named `fast-ssd` if they want the same application manifest to work.

## The CSI Provisioner Does the Real Work
<!-- section-summary: The provisioner field points to the CSI driver or in-tree provisioner that creates and manages storage. -->

The **provisioner** field names the storage driver that creates volumes. Modern Kubernetes storage usually uses **CSI**, the Container Storage Interface. CSI drivers let storage vendors and cloud providers integrate with Kubernetes through a standard interface.

The StorageClass does not create disks by itself. It passes a provisioning request to the named driver. The driver talks to the cloud API, storage array, local volume manager, or network filesystem system behind the cluster.

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

```yaml
parameters:
  type: ssd
  encrypted: "true"
```

The exact keys depend on the CSI driver. A cloud disk driver and an NFS driver use different parameters. That is why StorageClasses should be owned and documented by the platform team rather than copied from random examples.

For application teams, the useful question is not "which hidden parameter is best?" The useful question is "which class should `notification-postgres` use for durable low-latency database storage, and what are the limits?" The answer should appear in platform docs or class descriptions.

## Default StorageClass Behavior
<!-- section-summary: A default StorageClass can satisfy PVCs without storageClassName, but production workloads should choose intentionally. -->

A cluster can mark one StorageClass as the default. PVCs without `storageClassName` can use that class automatically.

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

For zonal storage, `WaitForFirstConsumer` is often the safer default. Kubernetes can choose a volume zone that matches the node where the Pod will run. This avoids creating a disk in one zone and then discovering that the Pod can only schedule in another zone.

```yaml
volumeBindingMode: WaitForFirstConsumer
```

The visible behavior can surprise beginners. A PVC may stay `Pending` until a Pod references it. That pending state can be healthy when the class waits for the first consumer.

Check the PVC events before assuming failure:

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

```yaml
reclaimPolicy: Delete
```

For ephemeral test databases, `Delete` may fit. For production state, the team should understand deletion consequences before relying on it. Some organizations use `Retain` for critical classes and require manual cleanup after recovery checks.

**allowVolumeExpansion** lets users increase the requested size of a bound PVC when the CSI driver supports expansion.

```yaml
allowVolumeExpansion: true
```

Expansion is a growth path, not a substitute for capacity planning. Monitor disk usage, alert before the volume is full, and test how the filesystem expands for the chosen driver.

![StorageClass decision matrix](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-decision-matrix.png)

*StorageClass review should connect workload needs to provisioner, binding mode, reclaim policy, expansion, and topology.*

## Allowed Topologies and Zones
<!-- section-summary: Allowed topologies restrict where storage can be provisioned so volumes match node and failure-domain rules. -->

**allowedTopologies** limits where the provisioner can create volumes. It is commonly used with zonal storage so a class provisions disks only in approved zones or regions.

```yaml
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.kubernetes.io/zone
        values:
          - zone-a
          - zone-b
```

Topology rules protect scheduling and failure-domain plans. If `notification-postgres` can run only in zones where the database disk can attach, the StorageClass and scheduler need to agree on those zones.

For multi-zone production workloads, topology belongs in a larger design. The StorageClass can place a volume in a zone, but the database or application still needs replication, backup, and recovery planning across failures.

## Naming and Review with Platform Teams
<!-- section-summary: StorageClass names should describe user-facing storage intent rather than exposing every provider implementation detail. -->

Good StorageClass names describe the promise made to application teams. `fast-ssd`, `standard`, `shared-rwx`, and `archive-retain` are easier to discuss than provider SKU names copied into every workload manifest.

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

Start with the claim:

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

Useful fields include provisioner, reclaim policy, volume binding mode, expansion, parameters, and allowed topologies. If a claim is bound but performance is poor, compare the workload need against the class promise. The problem may be a wrong class selection rather than a Kubernetes failure.

For unexpected data deletion, check the reclaim policy on the bound PV:

```bash
kubectl get pv pvc-0d2df0c0-97d6-4d0d-a0a0-4a9d6e91a111 -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy
```

That output tells you whether the PV was set to `Delete` or `Retain` at creation time.

## Assembled Example
<!-- section-summary: The full example shows a documented StorageClass and a PVC that requests it explicitly. -->

Here is an assembled `fast-ssd` class for a cluster with a fictional CSI driver. Real clusters should use the exact parameters documented by their storage provider.

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

The PVC shows the application team's request. The StorageClass shows the platform team's profile. Keep those responsibilities separate during review.

![StorageClass topology and scheduling](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-storage-classes/storageclass-topology-and-scheduling.png)

*Binding mode and topology decide whether the volume is created before scheduling or after Kubernetes knows the Pod placement.*

## Review Checklist
<!-- section-summary: A StorageClass review checks provisioner ownership, workload fit, binding behavior, reclaim policy, expansion, and topology. -->

Use this checklist before asking workloads to use a class:

| Check | What to confirm |
|---|---|
| Provisioner | The CSI driver is installed, supported, and monitored |
| Workload fit | The class matches the app's latency, throughput, and access-mode needs |
| Binding | `Immediate` or `WaitForFirstConsumer` matches the scheduling and topology plan |
| Reclaim | PVC deletion behavior is understood before production data lands there |
| Expansion | Growth behavior is supported and tested |
| Documentation | Platform docs tell application teams when to use the class |

**References**

- [StorageClasses](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [CSI drivers](https://kubernetes-csi.github.io/docs/)
