---
title: "Storage Classes"
description: "Choose and operate Kubernetes StorageClasses so PersistentVolumeClaims get the right kind of backing storage."
overview: "StorageClasses describe the storage profiles a cluster offers, letting application claims ask for storage without hardcoding provider details."
tags: ["kubernetes", "storageclass", "pvc", "csi"]
order: 6
id: article-containers-orchestration-kubernetes-configuration-storage-storage-classes
---

## Table of Contents

1. [StorageClass Is the Cluster Storage Profile](#storageclass-is-the-cluster-storage-profile)
2. [The CSI Provisioner Does the Real Work](#the-csi-provisioner-does-the-real-work)
3. [Parameters Are Platform-Owned Details](#parameters-are-platform-owned-details)
4. [Default StorageClass Behavior](#default-storageclass-behavior)
5. [volumeBindingMode and Scheduling](#volumebindingmode-and-scheduling)
6. [Reclaim Policy and Expansion](#reclaim-policy-and-expansion)
7. [Allowed Topologies and Zones](#allowed-topologies-and-zones)
8. [Naming and Review with Platform Teams](#naming-and-review-with-platform-teams)
9. [Troubleshoot the Wrong Class](#troubleshoot-the-wrong-class)
10. [Choosing Classes for devpolaris-orders-api](#choosing-classes-for-devpolaris-orders-api)
11. [What's Next](#whats-next)

## StorageClass Is the Cluster Storage Profile
<!-- section-summary: A StorageClass names a storage profile so PVCs can request the right kind of volume without provider-specific YAML. -->

A **StorageClass** is a Kubernetes object that describes a kind of storage the cluster can create for claims. You can think of it as the storage menu the platform team offers to application teams. One class might mean standard encrypted block storage, another might mean fast SSD storage, and another might mean a shared filesystem that supports many writers.

The previous article introduced `orders-api-workdir`, the PVC used by `devpolaris-orders-api` for invoice work files. The claim asked for `storageClassName: standard-retain`. That single field is how the application chooses the cluster's storage profile without hardcoding a disk type, zone, encryption parameter, or provider API.

The same production claim shows the application-facing contract. The workload asks for `standard-retain`, and that one field selects the storage profile the platform team has already reviewed:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-api-workdir
  namespace: devpolaris-prod
spec:
  storageClassName: standard-retain
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  resources:
    requests:
      storage: 20Gi
```

The PVC says what the workload needs. The StorageClass says how the cluster should satisfy that need. That split lets the application manifest stay readable while the platform team changes implementation details behind a reviewed class name.

The full storage path now has a clear handoff. The **PVC** asks for storage, the **StorageClass** chooses the profile, the **CSI provisioner** creates the backend volume, Kubernetes records that backend as a **PV**, and the **Pod** mounts the claim into the container.

| Step | Object or actor | What happens for `orders-api-workdir` |
|---|---|---|
| 1 | PVC | The app requests `20Gi` of `ReadWriteOnce` filesystem storage. |
| 2 | StorageClass | `standard-retain` selects the retained production storage profile. |
| 3 | CSI provisioner | The driver creates the real disk or file share for the claim. |
| 4 | PV | Kubernetes represents the created volume as a bound PersistentVolume. |
| 5 | Pod mount | The Deployment mounts the PVC at `/var/lib/devpolaris/orders-work`. |

That handoff gives each team a natural review point. Application engineers review the claim size, access mode, and mount path. Platform engineers review the class, driver, retention, expansion, topology, backup coverage, and cost.

## The CSI Provisioner Does the Real Work
<!-- section-summary: The provisioner field points Kubernetes to the storage driver that can create, attach, resize, and snapshot volumes. -->

The most important field in a StorageClass is `provisioner`. It names the driver that creates volumes for PVCs using this class. In modern Kubernetes clusters, that driver usually follows the **Container Storage Interface**, or **CSI**, which is the standard way storage systems integrate with Kubernetes.

A CSI driver can create the backing disk or file share, attach it to a node, mount it for a Pod, expand it, and sometimes create snapshots. The exact abilities depend on the driver and the storage system behind it. This is why two classes with similar names can behave very differently.

A simplified class for the production invoice work directory makes the hidden behavior visible. The PVC stays short, while the class carries the provisioner, lifecycle, expansion, and binding rules:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard-retain
provisioner: disk.csi.platform.devpolaris.io
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: standard
  encrypted: "true"
```

The provisioner name is intentionally driver-specific. In a cloud cluster, you might see names such as `ebs.csi.aws.com`, `disk.csi.azure.com`, or `pd.csi.storage.gke.io`. In an on-premises cluster, the provisioner name might come from a storage vendor or an internal platform driver.

Application teams should know which provisioner family a class uses at a high level. A block-disk provisioner usually fits one writer per volume, while a file-share provisioner may support `ReadWriteMany`. The platform team should document those differences so developers choose a class by workload need instead of guessing from the name.

## Parameters Are Platform-Owned Details
<!-- section-summary: StorageClass parameters configure provider-specific behavior, so platform teams should own and review them. -->

The `parameters` map is passed to the provisioner. Kubernetes leaves those keys to each driver rather than giving them one universal meaning across all storage systems. A cloud disk driver, a network filesystem driver, and a storage appliance driver each define their own parameter names and supported values.

That is why application teams should avoid copying StorageClass examples from a blog post into a shared cluster. A parameter such as `type: gp3`, `skuName: Premium_LRS`, or `replication-type: regional-pd` only makes sense for a specific driver and platform. The same-looking field can affect cost, performance, encryption, zone placement, backup eligibility, or failure domain.

For a production cluster, platform teams usually publish a small catalog of reviewed classes. The catalog should explain the operational promise behind each name:

| Class name | Intended use | Typical behavior |
|---|---|---|
| `standard-delete` | Development and short-lived environments | Encrypted standard block storage, deleted with the claim. |
| `standard-retain` | Production single-writer application data | Encrypted standard block storage, retained after claim deletion, expansion enabled. |
| `fast-delete` | Performance testing or cache-like data | Higher IOPS block storage, deleted with the claim. |
| `shared-rwx` | Shared filesystem workloads | Multi-writer file storage, retained and snapshot-covered. |

The class name should be boring and explicit. Names such as `standard-retain` and `shared-rwx` carry operational meaning. Names such as `gold` or `premium` can hide the important questions developers need answered during a production review.

## Default StorageClass Behavior
<!-- section-summary: A default StorageClass can fill in missing PVC class names, which makes explicit class selection safer for important workloads. -->

A cluster can mark one StorageClass as the **default**. When a PVC leaves out `storageClassName`, Kubernetes may assign the default class to that claim. This is convenient for demos and simple environments, and it can surprise a team that expected an unnamed claim to wait for a hand-created PV.

The class list gives the team the default marker before anyone creates a claim. The normal `kubectl get storageclass` view also shows lifecycle fields that matter during cleanup and recovery:

```bash
kubectl get storageclass
```

The output makes the default class obvious. It also shows reclaim policy, binding mode, and expansion support:

```bash
NAME                        PROVISIONER                         RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION
standard-delete (default)   disk.csi.platform.devpolaris.io      Delete          WaitForFirstConsumer   true
standard-retain             disk.csi.platform.devpolaris.io      Retain          WaitForFirstConsumer   true
shared-rwx                  files.csi.platform.devpolaris.io     Retain          Immediate              true
```

The default marker comes from an annotation. Platform teams usually manage this annotation through cluster configuration:

```yaml
metadata:
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
```

For `devpolaris-orders-api`, the production claim should name `standard-retain` directly. That line tells reviewers the team chose retained production storage on purpose. Leaving the field out could silently select `standard-delete`, which would be a poor fit for an invoice work directory that might matter during an incident.

There is one special value worth knowing. `storageClassName: ""` means the claim should use only a PV with no class, so dynamic provisioning through the default class is skipped. That shape appears during static provisioning and migrations, and it should be used deliberately because the claim now depends on a matching PV prepared ahead of time.

## volumeBindingMode and Scheduling
<!-- section-summary: volumeBindingMode controls whether storage is created immediately or waits until Kubernetes knows where the Pod will run. -->

The `volumeBindingMode` field controls the timing of binding and provisioning. `Immediate` creates or binds storage as soon as the PVC appears. `WaitForFirstConsumer` waits until a Pod uses the PVC, so the scheduler can pick a node and zone that fit the workload and the storage.

This timing matters for zone-bound storage. A block disk created in one zone usually attaches only to nodes in that same zone. If Kubernetes creates the disk before it knows where the Pod can run, the disk and Pod can end up in different places.

For most zone-aware block storage classes, `WaitForFirstConsumer` is the safer default. It lets scheduling and volume placement agree before the volume is created:

```yaml
volumeBindingMode: WaitForFirstConsumer
```

With this setting, the orders API rollout can look a little odd at first. The PVC may remain `Pending` until the Deployment creates a Pod. At that point, the scheduler considers the Pod's node options, the provisioner creates storage in a compatible zone, and the Pod starts.

The PVC and Pod events show the timing. Together, they tell you whether the wait is part of normal first-consumer binding or a stuck provisioning path:

```bash
kubectl describe pvc orders-api-workdir -n devpolaris-prod

kubectl describe pod -l app=orders-api -n devpolaris-prod
```

An event that mentions waiting for the first consumer is often part of the expected flow. A claim that waits for many minutes needs more investigation, especially around node selectors, topology rules, quotas, and CSI provisioner health.

## Reclaim Policy and Expansion
<!-- section-summary: A StorageClass sets important volume lifecycle behavior, especially what happens after PVC deletion and whether storage can grow. -->

`reclaimPolicy` decides what happens to dynamically provisioned storage after the PVC is deleted. `Delete` removes the backing storage through the provisioner. `Retain` leaves the backing storage in place for recovery or manual cleanup.

The right value depends on the environment and the data. Development namespaces often use `Delete` to avoid old disks collecting cost. Production classes often use `Retain` for workloads where accidental PVC deletion should leave a recovery path.

`allowVolumeExpansion` tells Kubernetes whether a PVC using the class can request more capacity later. That setting matters when the invoice work directory grows faster than expected:

```yaml
allowVolumeExpansion: true
```

Expansion starts by editing the PVC request. The requested size can grow from `20Gi` to `40Gi`, and Kubernetes coordinates the storage resize with the provisioner and kubelet.

```bash
kubectl patch pvc orders-api-workdir -n devpolaris-prod \
  --type merge \
  -p '{"spec":{"resources":{"requests":{"storage":"40Gi"}}}}'

kubectl describe pvc orders-api-workdir -n devpolaris-prod
```

Useful events include filesystem resize success, controller expansion success, and driver-specific errors. Expansion usually grows volumes in place, and shrinking a PVC requires a special migration or storage-specific procedure on most platforms.

## Allowed Topologies and Zones
<!-- section-summary: allowedTopologies limits where a provisioner may create storage, which keeps volumes aligned with cluster zones and node groups. -->

`allowedTopologies` restricts where the provisioner may create volumes for a StorageClass. Platform teams use it when storage must stay in certain zones, regions, racks, or node pools. The topology keys usually come from node labels and driver-supported topology domains.

A simplified example can allow volumes in two zones. The exact topology keys and values should match your nodes and storage driver:

```yaml
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.kubernetes.io/zone
        values:
          - eu-west-2a
          - eu-west-2b
```

Topology rules should line up with scheduling rules. If the orders API Deployment requires nodes in `eu-west-2c`, while the StorageClass only creates volumes in `eu-west-2a` and `eu-west-2b`, Kubernetes has no place where both requirements fit. The symptom may appear as a Pod scheduling failure or a PVC that never binds.

When you debug this kind of issue, compare the Pod's scheduling constraints, the node labels, and the StorageClass topology:

```bash
kubectl get nodes -L topology.kubernetes.io/zone

kubectl get storageclass standard-retain -o yaml

kubectl describe pod -l app=orders-api -n devpolaris-prod
```

Application teams can skip memorizing every topology setting. They should recognize that class choice and Pod placement are connected. Platform teams should document which classes work in which node pools and zones.

## Naming and Review with Platform Teams
<!-- section-summary: A production StorageClass choice should be reviewed for access modes, backups, retention, expansion, topology, and cost. -->

StorageClass names live inside application manifests, so they deserve the same care as database tier names or network policy names. A name should communicate the important operational behavior. The best names make production review faster because the reviewer can see the intent immediately.

For the invoice work directory, a review with the platform team should answer these questions. Each answer affects either day-two operations or incident recovery:

| Question | Why it matters for `orders-api-workdir` |
|---|---|
| Which access modes does this class support? | The workdir has one writer today, and future replica changes need a storage plan. |
| What happens when the PVC is deleted? | The team needs to know whether data is retained for recovery or deleted during cleanup. |
| Does the class support expansion? | Invoice bursts can fill the workdir, and online growth may prevent an incident. |
| Are snapshots or backups configured? | The backup article uses this exact workdir in a restore drill. |
| Which zones and node pools can use it? | The Deployment and storage must land in compatible places. |
| What encryption and compliance controls apply? | Invoice files can contain customer data and should follow data handling policy. |
| What does it cost at 20Gi, 100Gi, and 500Gi? | Temporary work directories can quietly grow if cleanup jobs fail. |

That conversation prevents a common production mistake: using a class because it worked in staging, then discovering during an outage that it deletes volumes on claim removal, lacks snapshots, or only exists in one zone.

The chosen class belongs in version-controlled manifests. The PVC should have an owner label, and the storage choice should be visible in the service runbook. Future maintainers should understand why `standard-retain` was chosen without opening a long chat thread from six months ago.

## Troubleshoot the Wrong Class
<!-- section-summary: Wrong StorageClass failures usually show up in PVC events before they show up in application logs. -->

A typo in `storageClassName` is one of the simplest storage failures. The PVC stays `Pending`, and the `describe pvc` output names the missing class. That evidence belongs ahead of application restarts.

```bash
kubectl get pvc orders-api-workdir -n devpolaris-prod

kubectl describe pvc orders-api-workdir -n devpolaris-prod
```

The event normally names the missing class directly. Here is the kind of message you are looking for:

```bash
Events:
  Type     Reason                Message
  Warning  ProvisioningFailed    storageclass.storage.k8s.io "standard-retian" not found
```

The manifest may need a corrected class name and a recreated PVC if the class name is immutable in the current object state. Before any production PVC deletion, the team should check whether a PV exists, whether the PV has data, and which reclaim policy applies. A tiny spelling fix can cause data loss if someone deletes a bound production claim too quickly.

The wrong class can also be a valid class with the wrong behavior. A `ReadWriteMany` claim using a block-disk class can stay `Pending` because the provisioner has no support for the requested access mode. A production claim using a `Delete` class can work perfectly until cleanup removes storage the team wanted retained.

This quick sequence gathers the class list, claim YAML, claim events, and Pod events in one pass during triage:

```bash
kubectl get storageclass

kubectl get pvc orders-api-workdir -n devpolaris-prod -o yaml

kubectl describe pvc orders-api-workdir -n devpolaris-prod

kubectl describe pod -l app=orders-api -n devpolaris-prod
```

The exact class name, access mode, namespace, and events give the platform team the useful evidence. Those four facts usually shorten the conversation from "storage is broken" to the actual mismatch.

## Choosing Classes for devpolaris-orders-api
<!-- section-summary: The orders API uses different classes by environment because staging cleanup and production recovery have different goals. -->

The same application can use different StorageClasses in different environments. The important part is that each choice is deliberate. `devpolaris-orders-api` needs a work directory for invoice files, and the operational goal changes as the service moves from staging to production.

In staging, the team can use a cleanup-friendly class. The smaller size and `standard-delete` class match a disposable environment:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-api-workdir
  namespace: devpolaris-staging
spec:
  storageClassName: standard-delete
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

In production, the team can use a retained and expandable class. The manifest is almost the same, but the class choice changes the recovery story:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-api-workdir
  namespace: devpolaris-prod
spec:
  storageClassName: standard-retain
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  resources:
    requests:
      storage: 20Gi
```

The PVC still stays a temporary work area rather than the long-term invoice archive. The finished invoice should still move to object storage, and the order record should still live in the database. The production class gives the temporary work directory a safer recovery story while the application finishes its handoff.

By the end of the review, the team should know the class name, the provisioner family, the reclaim policy, expansion support, snapshot coverage, topology constraints, and the expected cost. That is enough information to deploy confidently and enough context to debug storage problems later.

## What's Next
<!-- section-summary: The next article proves that Kubernetes storage choices can be restored after real failures. -->

Now the claim and the class fit together. The PVC states the application's need, and the StorageClass maps that need to a reviewed storage profile owned by the platform.

The final article in this module covers backup and restore basics. It follows the same orders API and asks a practical question: if the cluster, manifests, Secrets, PVC data, or external database state disappears, what exactly brings the service back?

---

**References**

- [Kubernetes Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) - Documents StorageClass fields including provisioner, parameters, reclaim policy, volume binding mode, expansion, allowed topologies, and default class behavior.
- [Kubernetes Dynamic Volume Provisioning](https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/) - Explains how PVCs use StorageClasses to request dynamically provisioned storage.
- [Change the default StorageClass](https://kubernetes.io/docs/tasks/administer-cluster/change-default-storage-class/) - Shows how Kubernetes marks and changes a default StorageClass.
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) - Defines PVC binding behavior, reclaim policies, access modes, and volume expansion.
- [Container Storage Interface documentation](https://kubernetes-csi.github.io/docs/) - Explains the CSI storage driver model used by modern Kubernetes provisioners.
- [Kubernetes Volumes](https://kubernetes.io/docs/concepts/storage/volumes/) - Gives broader context for Kubernetes volume types and Pod storage behavior.
