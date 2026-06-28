---
title: "Persistent Volumes and Claims"
description: "Use PersistentVolumes and PersistentVolumeClaims to give Kubernetes workloads durable storage beyond a single Pod lifetime."
overview: "PersistentVolumes and PersistentVolumeClaims separate an application's request for storage from the cluster's backing disk or filesystem implementation."
tags: ["kubernetes", "persistent-volumes", "pvc", "storage"]
order: 5
id: article-containers-orchestration-kubernetes-configuration-storage-persistent-volumes-and-claims
---

## Table of Contents

1. [Start with One Lost File](#start-with-one-lost-file)
2. [Why Pod Files Disappear](#why-pod-files-disappear)
3. [PV and PVC Have Different Jobs](#pv-and-pvc-have-different-jobs)
4. [Dynamic Provisioning Through a StorageClass](#dynamic-provisioning-through-a-storageclass)
5. [Create and Inspect a Claim](#create-and-inspect-a-claim)
6. [Mount the Claim into a Pod](#mount-the-claim-into-a-pod)
7. [Access Modes and Volume Modes](#access-modes-and-volume-modes)
8. [Binding, Reclaim Policy, and Lifecycle](#binding-reclaim-policy-and-lifecycle)
9. [Troubleshoot Pending Claims](#troubleshoot-pending-claims)
10. [Troubleshoot Write and Permission Problems](#troubleshoot-write-and-permission-problems)
11. [Assembled Example](#assembled-example)
12. [Production Tradeoffs](#production-tradeoffs)
13. [Review Checklist](#review-checklist)

## Start with One Lost File
<!-- section-summary: PVCs and PVs give important files a storage path outside the short-lived container filesystem. -->

A common first storage bug is a file disappearing after a container restart. A training version of `notification-postgres` writes database files under `/var/lib/postgresql/data`. The container crashes, Kubernetes starts a replacement, and anything written only to the old container filesystem is gone.

A **PersistentVolumeClaim**, usually shortened to **PVC**, is the application team's request for durable storage. A **PersistentVolume**, usually shortened to **PV**, is the cluster storage resource that satisfies that request. The claim says how much storage the workload needs, and the PV represents the real backing volume.

Here is the smallest useful claim for that PostgreSQL data directory:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notification-postgres-data
  namespace: customer-notifications
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

This claim asks Kubernetes for `20Gi` of storage that can be mounted read-write by one node. The Pod later mounts the claim at the path the database already uses:

```yaml
volumeMounts:
  - name: postgres-data
    mountPath: /var/lib/postgresql/data
```

The claim does not name a disk, cloud volume, or storage appliance. The cluster storage layer decides what actual backing PV can satisfy the request.

## Why Pod Files Disappear
<!-- section-summary: A container filesystem is tied to the container lifecycle, so important data needs a volume outside the container image. -->

Containers have writable filesystems, but those files belong to the container instance. When Kubernetes replaces a Pod, the new container starts from the image again. Files written only inside the old container filesystem disappear with the old Pod.

For `notification-api` and `notification-worker`, most production state should live outside the Pod in systems such as managed PostgreSQL, a message broker, or object storage. That is the normal production path for customer notifications, delivery history, and provider payloads.

PersistentVolumes still matter. Stateful workloads such as a self-managed PostgreSQL training database, a search index, a message broker, or a single-writer file store need durable storage that survives Pod replacement. In this article, `notification-postgres` gives us a concrete storage example for the same platform.

![PV and PVC binding flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-persistent-volumes-and-claims/pv-pvc-binding-flow.png)

*A PVC describes what the workload needs, and Kubernetes binds it to a PersistentVolume backed by the cluster storage system.*

## PV and PVC Have Different Jobs
<!-- section-summary: A PersistentVolume is the cluster storage resource, while a PersistentVolumeClaim is the workload request for that resource. -->

A **PersistentVolume**, or **PV**, is a storage resource known to the cluster. It can represent a cloud disk, a network filesystem share, a local disk, or another CSI-backed storage resource.

A **PersistentVolumeClaim** is the request made by a namespace. The claim says, "I need this much storage with these access requirements." Kubernetes matches the claim to a suitable PV or asks a StorageClass provisioner to create one.

Think about the ownership boundary. Platform engineers own StorageClasses, CSI drivers, quotas, and storage policies. Application teams own PVCs and mount paths. That separation keeps application manifests portable across clusters with different storage implementations.

The PVC also gives Kubernetes a stable object for scheduling and lifecycle. A StatefulSet Pod can be replaced, and the replacement can mount the same claim again. The data follows the claim instead of the short-lived Pod name.

## Dynamic Provisioning Through a StorageClass
<!-- section-summary: Dynamic provisioning creates the backing PV automatically when a claim asks for a StorageClass. -->

**Dynamic provisioning** means Kubernetes creates the backing PV after a PVC asks for storage. The PVC references a **StorageClass**, and the StorageClass points to a CSI provisioner that knows how to create storage on the real platform.

Add a StorageClass name to the claim:

```yaml
spec:
  storageClassName: fast-ssd
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

In a cloud cluster, `fast-ssd` might create an SSD-backed disk. In an on-prem cluster, it might create a volume from a storage array. The application manifest keeps the request stable while the platform changes the implementation behind the class.

If `storageClassName` is omitted, Kubernetes may use the default StorageClass for the cluster. That can be convenient, but production teams usually make important storage choices explicit so reviewers know which performance, topology, and reclaim behavior the workload expects.

## Create and Inspect a Claim
<!-- section-summary: kubectl shows whether a claim is Pending, Bound, and which PV satisfies it. -->

Apply the claim:

```bash
kubectl apply -f k8s/customer-notifications/notification-postgres-pvc.yaml
```

Then inspect it:

```bash
kubectl get pvc notification-postgres-data -n customer-notifications
```

A healthy dynamically provisioned claim looks like this:

```console
NAME                         STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS
notification-postgres-data   Bound    pvc-0d2df0c0-97d6-4d0d-a0a0-4a9d6e91a111   20Gi       RWO            fast-ssd
```

`STATUS=Bound` means Kubernetes found or created a PV for the claim. The generated PV name often starts with `pvc-`, which tells you the volume came from a claim-driven workflow.

For more detail, describe the claim:

```bash
kubectl describe pvc notification-postgres-data -n customer-notifications
```

Useful details include the StorageClass, events, selected node, requested size, access mode, and bound volume. The events section usually explains why a claim is still pending.

## Mount the Claim into a Pod
<!-- section-summary: A Pod uses a PVC by declaring a volume that references the claim and mounting that volume into a container path. -->

A **persistentVolumeClaim volume** makes a PVC available to a Pod. The Pod does not talk to the PV directly. It references the claim by name.

First, define the volume:

```yaml
volumes:
  - name: postgres-data
    persistentVolumeClaim:
      claimName: notification-postgres-data
```

Then mount that volume into the container:

```yaml
containers:
  - name: postgres
    volumeMounts:
      - name: postgres-data
        mountPath: /var/lib/postgresql/data
```

The container sees a normal directory at `/var/lib/postgresql/data`. Kubernetes and the storage driver attach and mount the underlying volume on the node where the Pod runs.

In production, StatefulSets usually create one claim per Pod through `volumeClaimTemplates`. A standalone PVC is still useful for learning, simple single-instance workloads, and understanding the underlying mechanics.

## Access Modes and Volume Modes
<!-- section-summary: Access modes describe how a volume can be mounted, while volume mode describes whether the container sees a filesystem or a raw block device. -->

An **access mode** describes how many nodes or Pods can mount a volume and whether the mount is read-write. It is a scheduling and storage capability, not an application-level locking system.

| Access mode | Plain-English meaning | Common use |
|---|---|---|
| `ReadWriteOnce` | One node can mount the volume read-write | Most cloud disks and single-instance databases |
| `ReadOnlyMany` | Many nodes can mount the volume read-only | Shared reference data |
| `ReadWriteMany` | Many nodes can mount the volume read-write | Network filesystems such as NFS or managed file shares |
| `ReadWriteOncePod` | One Pod can mount the volume read-write | Strong single-writer workloads on supported CSI drivers |

For a PostgreSQL data directory, `ReadWriteOnce` or `ReadWriteOncePod` is the usual shape. Multiple Pods writing to the same database files through a shared filesystem would corrupt data unless the database explicitly supports that architecture.

**volumeMode** describes what the container receives. `Filesystem` gives a mounted filesystem at a path. `Block` gives a raw block device. Most application teams use `Filesystem`, while specialized databases or storage tools may use `Block`.

## Binding, Reclaim Policy, and Lifecycle
<!-- section-summary: PVC lifecycle controls the request, while PV reclaim policy controls what happens to the backing storage after the claim is deleted. -->

The PVC lifecycle starts at `Pending`, moves to `Bound`, and stays bound while the claim exists. The Pod can be replaced many times, but the claim remains the stable storage request.

The PV has a **reclaim policy**. `Delete` tells the storage system to delete the backing volume after the claim is deleted. `Retain` keeps the backing volume so an operator can inspect, recover, or manually reuse it.

The storage class often sets the reclaim policy for dynamically provisioned volumes. Application teams should know what it is before deploying stateful workloads. Deleting a PVC with a `Delete` policy can remove the underlying data volume.

![PVC lifecycle and reclaim policy](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-persistent-volumes-and-claims/pvc-lifecycle-and-reclaim-policy.png)

*A PVC can survive Pod replacement, while the PV reclaim policy controls what happens after the claim itself is deleted.*

PVC expansion is another lifecycle operation. If the StorageClass allows expansion, you can increase the requested size. Shrinking a PVC is generally not supported as a normal Kubernetes operation, so choose initial sizes and growth alarms carefully.

## Troubleshoot Pending Claims
<!-- section-summary: Pending claims usually point to a missing StorageClass, unavailable topology, quota, or unsupported access mode. -->

A PVC stuck in `Pending` needs event inspection. Start with:

```bash
kubectl describe pvc notification-postgres-data -n customer-notifications
```

A missing StorageClass can look like this:

```console
Warning  ProvisioningFailed  persistentvolume-controller  storageclass.storage.k8s.io "fast-ssd" not found
```

Other common causes include namespace quota, no default StorageClass, unsupported access mode, or topology constraints. With `WaitForFirstConsumer` binding, a claim can stay pending until a Pod that uses it is scheduled. That is expected for zonal storage classes.

Next, list storage classes:

```bash
kubectl get storageclass
```

Sample output:

```console
NAME                 PROVISIONER                 RECLAIMPOLICY   VOLUMEBINDINGMODE
fast-ssd             csi.example.com             Delete          WaitForFirstConsumer
standard (default)   csi.example.com             Delete          Immediate
```

If the class exists, ask the platform team whether the requested size, access mode, and zone are supported. PVC events usually provide the best first clue.

## Troubleshoot Write and Permission Problems
<!-- section-summary: Bound storage can still fail at runtime when filesystem ownership, security context, or application paths are wrong. -->

`STATUS=Bound` only confirms the volume exists and can attach. The process can still fail to write if the directory ownership, security context, or mount path does not match the container.

Check the mount from inside the Pod:

```bash
kubectl exec statefulset/notification-postgres -n customer-notifications -- df -h /var/lib/postgresql/data
```

Expected output:

```console
Filesystem      Size  Used Avail Use% Mounted on
/dev/example     20G  1.2G   19G   6% /var/lib/postgresql/data
```

Then check ownership:

```bash
kubectl exec statefulset/notification-postgres -n customer-notifications -- ls -ld /var/lib/postgresql/data
```

If the database runs as a non-root user, the volume may need `fsGroup`, an init container that prepares ownership, or a storage driver that honors filesystem group settings. Handle this in the workload manifest rather than asking the application to run as root.

## Assembled Example
<!-- section-summary: The full example shows a PVC mounted into a single-instance PostgreSQL workload for the notification platform. -->

Here is the assembled example. It keeps the storage request separate from the Pod that mounts it.

```yaml
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
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: notification-postgres
  namespace: customer-notifications
spec:
  serviceName: notification-postgres
  replicas: 1
  selector:
    matchLabels:
      app: notification-postgres
  template:
    metadata:
      labels:
        app: notification-postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: postgres-data
          persistentVolumeClaim:
            claimName: notification-postgres-data
```

This example teaches the binding and mount path. A production PostgreSQL deployment also needs Secret-managed credentials, backups, probes, resource requests, security context, upgrade planning, and a clear decision between self-managed and managed database operations.

## Production Tradeoffs
<!-- section-summary: Durable Kubernetes volumes are powerful, but production data systems also need backup, restore, scaling, and failure-domain planning. -->

PVCs solve durable filesystem attachment inside Kubernetes. They do not automatically solve database replication, backup retention, cross-zone failover, application-level consistency, or performance tuning.

For the Customer Notification Platform, production teams often use managed PostgreSQL, managed queues, and object storage for core business state. Kubernetes PVCs still appear in self-managed databases, brokers, search clusters, caches with persistence, and tools that need a durable filesystem.

The decision should name the operator. If the platform team runs the database in Kubernetes, it owns storage classes, backups, restore drills, upgrades, monitoring, and failure scenarios. If a managed service owns the database, Kubernetes workloads should keep connection details in ConfigMaps and Secrets while the data lives outside the cluster.

![Storage troubleshooting map](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-persistent-volumes-and-claims/storage-troubleshooting-map.png)

*Storage troubleshooting moves from claim status, to binding events, to node attachment, to filesystem permissions, and finally to application behavior.*

## Review Checklist
<!-- section-summary: A PVC review checks requested size, access mode, storage class, lifecycle, permissions, and backup ownership. -->

Use this checklist before merging PVC-backed workloads:

| Check | What to confirm |
|---|---|
| StorageClass | The class exists and matches the performance and topology need |
| Size | The initial request and growth plan are documented |
| Access mode | The mode matches the workload's writer pattern |
| Reclaim policy | Everyone understands what happens after PVC deletion |
| Permissions | The security context lets the process read and write safely |
| Backup | The backup and restore owner is named before production data lands on the volume |

**References**

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [StorageClasses](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
