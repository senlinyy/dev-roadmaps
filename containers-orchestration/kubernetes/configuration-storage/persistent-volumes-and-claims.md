---
title: "Persistent Volumes and Claims"
description: "Use PersistentVolumes and PersistentVolumeClaims to give Kubernetes workloads durable storage beyond a single Pod lifetime."
overview: "PersistentVolumes and PersistentVolumeClaims separate an application's request for storage from the cluster's backing disk or filesystem implementation."
tags: ["kubernetes", "persistent-volumes", "pvc", "storage"]
order: 5
id: article-containers-orchestration-kubernetes-configuration-storage-persistent-volumes-and-claims
---

## Table of Contents

1. [Why Pod Files Disappear](#why-pod-files-disappear)
2. [PVs and PVCs Have Different Jobs](#pvs-and-pvcs-have-different-jobs)
3. [Dynamic Provisioning Through a StorageClass](#dynamic-provisioning-through-a-storageclass)
4. [Create the Claim for devpolaris-orders-api](#create-the-claim-for-devpolaris-orders-api)
5. [Mount the Claim into the Pod](#mount-the-claim-into-the-pod)
6. [Access Modes and Volume Modes](#access-modes-and-volume-modes)
7. [Binding, Reclaim Policy, and Lifecycle](#binding-reclaim-policy-and-lifecycle)
8. [Troubleshoot Pending Claims](#troubleshoot-pending-claims)
9. [Troubleshoot Write and Permission Problems](#troubleshoot-write-and-permission-problems)
10. [Production Tradeoffs](#production-tradeoffs)
11. [What's Next](#whats-next)

## Why Pod Files Disappear
<!-- section-summary: A Pod can write files while it runs, but important application data needs a volume with its own lifecycle. -->

A Kubernetes container starts from an image, and that image gives the container its starting filesystem. When the application writes a file inside the container, Kubernetes stores that write in the container's writable layer. That layer belongs to that running container, so a replacement Pod starts from the image again and receives a fresh writable layer.

This matters as soon as the file has business value. Our running example is `devpolaris-orders-api`, a service that creates invoice PDF work files before a background job uploads the finished invoices to object storage. If the Pod restarts while a PDF is still waiting in the work directory, the replacement Pod needs to see that file.

Kubernetes has several volume types, and some of them are short-lived on purpose. An `emptyDir` volume survives container restarts inside the same Pod, then disappears when the Pod goes away. That makes `emptyDir` useful for scratch space, build temp files, and cache data that can be rebuilt.

The invoice work directory needs a different shape. The data should stay available after a Pod replacement, and the application should ask Kubernetes for that storage through a normal API object. That is where **PersistentVolumes** and **PersistentVolumeClaims** enter the story.

## PVs and PVCs Have Different Jobs
<!-- section-summary: A PersistentVolume is the cluster's storage supply, while a PersistentVolumeClaim is the workload's storage request. -->

A **PersistentVolume**, usually shortened to **PV**, is a Kubernetes object that represents real storage available to the cluster. The real storage might be a cloud disk, a network file share, a local volume, or another backend exposed through a storage driver. The PV contains cluster-side details such as capacity, access modes, reclaim policy, and the driver information needed to attach or mount the volume.

A **PersistentVolumeClaim**, usually shortened to **PVC**, is the application's request for storage. The claim says how much storage the workload needs, which access pattern it expects, and which storage profile it wants. A Pod then mounts the PVC by name, and Kubernetes handles the connection between that claim and a real PV.

For `devpolaris-orders-api`, the application team should be able to say, "I need 20Gi for `/var/lib/devpolaris/orders-work` in production." The exact disk ID, provider API, zone, encryption flag, and storage account name can stay behind the platform boundary. The claim is the contract the workload writes down.

This separation keeps ownership clean. Application teams usually own the PVC because they understand the workload's file path, capacity need, and access pattern. Platform teams usually own the PV creation process and the StorageClasses because they understand the cluster storage systems, cost, encryption, backup coverage, and zone rules.

## Dynamic Provisioning Through a StorageClass
<!-- section-summary: Dynamic provisioning lets a PVC trigger storage creation through a StorageClass instead of waiting for a hand-built PV. -->

Kubernetes can bind a PVC to a PV that already exists, which is called **static provisioning**. That model still appears in migrations, special hardware setups, and carefully controlled storage handoffs. Someone prepares the PV first, then the claim asks for storage that matches it.

Most day-to-day clusters use **dynamic provisioning**. The PVC names a **StorageClass**, and the StorageClass points at a provisioner that can create the real storage on demand. The provisioner is usually a CSI driver, which means it follows the Container Storage Interface used by Kubernetes storage integrations.

Here is the useful flow for the orders service. The team creates a PVC named `orders-api-workdir`, the PVC asks for the `standard-retain` StorageClass, the CSI provisioner creates a real volume, Kubernetes creates a PV object for that volume, and the PVC moves to `Bound`.

The beginner bridge has five links. Each link answers a different question, and naming the failed link sends the team to the right evidence.

| Link | Question it answers | Orders example |
|---|---|---|
| **PVC** | What storage does the workload request? | `orders-api-workdir` asks for `20Gi`, `ReadWriteOnce`, and `standard-retain`. |
| **StorageClass** | Which reviewed storage profile should satisfy the request? | `standard-retain` points at retained encrypted block storage. |
| **CSI driver** | Which storage integration creates and mounts the real backend? | `disk.csi.platform.devpolaris.io` creates the volume through the platform storage system. |
| **PV** | Which cluster object represents the created volume? | Kubernetes creates a PV such as `pvc-2b4bd1b0-51f6-44f2-8a0e-6d47c0f3e28a`. |
| **Pod mount** | Where does the container see the storage? | The Deployment mounts the claim at `/var/lib/devpolaris/orders-work`. |

This chain keeps the application manifest focused on the request and the mount path. Provider disk IDs, encryption parameters, topology rules, and attach behavior stay behind the StorageClass and CSI driver, where the platform team can review them once for many workloads.

The StorageClass article goes deeper into the class itself. For this article, read `storageClassName: standard-retain` as the line that chooses the cluster's storage profile for the work directory.

## Create the Claim for devpolaris-orders-api
<!-- section-summary: A PVC manifest names the capacity, storage profile, access mode, and volume mode the workload needs. -->

The first manifest the application team writes is the claim. This claim asks for 20Gi of filesystem storage in the `devpolaris-prod` namespace. It uses `ReadWriteOnce` because the orders API has one active writer for the invoice work directory.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-api-workdir
  namespace: devpolaris-prod
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
spec:
  storageClassName: standard-retain
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  resources:
    requests:
      storage: 20Gi
```

The `resources.requests.storage` value is the capacity request. Kubernetes matches that request to a volume that can satisfy at least that much storage. The storage backend may allocate the exact size or round it according to provider rules.

After the claim is applied, the status should be inspected before the dependent workload rolls out. A `Bound` claim means Kubernetes connected the request to a PV. A `Pending` claim means the storage path still needs attention.

```bash
kubectl apply -f k8s/orders-api-workdir-pvc.yaml

kubectl get pvc orders-api-workdir -n devpolaris-prod
```

The output should move to `Bound` after the provisioner creates storage. A healthy claim looks like this:

```bash
NAME                 STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS      AGE
orders-api-workdir   Bound    pvc-2b4bd1b0-51f6-44f2-8a0e-6d47c0f3e28a   20Gi       RWO            standard-retain   34s
```

That generated PV name belongs to the cluster. The application uses the friendly PVC name. This is one of the nicest parts of PVCs: the workload manifest can stay stable while the platform changes the backing implementation.

## Mount the Claim into the Pod
<!-- section-summary: A Pod uses a PVC by declaring a volume from the claim and mounting that volume into the container. -->

The Deployment uses the claim as a Pod volume. The `volumes` section points at the PVC, and the `volumeMounts` section chooses the path inside the container. The application only needs to write invoice work files under that path.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: devpolaris-prod
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders-api
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      securityContext:
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
      volumes:
        - name: workdir
          persistentVolumeClaim:
            claimName: orders-api-workdir
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:1.18.0
          volumeMounts:
            - name: workdir
              mountPath: /var/lib/devpolaris/orders-work
```

The `Recreate` strategy is deliberate in this beginner example. A single `ReadWriteOnce` work directory usually wants one active writer, and a rolling update can temporarily create an old Pod and a new Pod at the same time. Production teams sometimes use StatefulSets, leader election, queues, or object storage to handle larger write patterns, but this first version keeps the storage behavior easy to reason about.

The `fsGroup` setting gives Kubernetes a way to make the mounted filesystem writable for the application group on many storage backends. Some CSI drivers handle ownership changes differently, so test this with the real class your cluster provides. If the app runs as a non-root user, treat write permission as part of the storage acceptance test.

You can prove the mount path in a safe development namespace with a tiny probe. In production, use application health checks and controlled smoke tests instead of writing random files into live business paths.

```bash
kubectl exec deploy/orders-api -n devpolaris-prod -- sh -c 'mount | grep orders-work || true'

kubectl exec deploy/orders-api -n devpolaris-prod -- sh -c 'echo invoice-probe > /var/lib/devpolaris/orders-work/probe.txt'

kubectl delete pod -n devpolaris-prod -l app=orders-api

kubectl exec deploy/orders-api -n devpolaris-prod -- cat /var/lib/devpolaris/orders-work/probe.txt
```

If the final command prints `invoice-probe`, the data survived a Pod replacement. That proves the claim and mount path are doing the durability job that the container filesystem could never own safely.

## Access Modes and Volume Modes
<!-- section-summary: Access modes describe who may mount a volume, while volume modes describe whether the container sees a filesystem or raw block device. -->

An **access mode** describes how Kubernetes may mount the volume. It is a scheduling and matching promise between the claim, the PV, and the storage driver. The storage backend still decides which modes it can really support.

| Access mode | Short name | What it means in practice | Good fit |
|---|---:|---|---|
| `ReadWriteOnce` | `RWO` | The volume can be mounted read-write by one node at a time. | One writer Pod, or tightly controlled same-node use. |
| `ReadOnlyMany` | `ROX` | The volume can be mounted read-only by many nodes. | Shared reference data, models, or read-only assets. |
| `ReadWriteMany` | `RWX` | The volume can be mounted read-write by many nodes. | Shared filesystem workloads that need multiple writers. |
| `ReadWriteOncePod` | `RWOP` | The volume can be mounted read-write by a single Pod in the cluster. | Strong single-Pod ownership when the CSI driver supports it. |

`ReadWriteOncePod` is useful when the application really needs a single writer. It gives Kubernetes a stricter rule than `ReadWriteOnce`, because `ReadWriteOnce` speaks in terms of node attachment. For the orders work directory, `ReadWriteOncePod` can be a good future upgrade if the cluster's CSI driver and sidecars support it.

A **volume mode** describes what the container sees. `Filesystem` means the container gets a mounted directory such as `/var/lib/devpolaris/orders-work`. `Block` means the container receives a raw block device and the application or database software manages the device directly.

Most web services and background workers use `Filesystem`. Raw `Block` volumes show up with databases, storage appliances, and specialist systems that want direct control. For a beginner application directory like invoice work files, choose `Filesystem`.

## Binding, Reclaim Policy, and Lifecycle
<!-- section-summary: Binding connects a PVC to a PV, and the reclaim policy controls what happens to the backing storage after claim deletion. -->

The binding lifecycle starts when the claim appears. Kubernetes looks for a PV that matches the claim's storage class, access modes, volume mode, and capacity. With dynamic provisioning, the StorageClass provisioner creates a new backing volume and a new PV for the claim.

Once the claim is `Bound`, a Pod can mount it. The claim and the volume now have an important relationship: deleting the Pod leaves the PVC in place, and deleting the Deployment leaves the PVC in place as well. The storage stays because the claim still exists.

The dangerous moment is PVC deletion. A dynamically provisioned PV has a **reclaim policy**, usually inherited from the StorageClass. `Delete` tells Kubernetes and the provisioner to remove the backing storage after the claim is deleted. `Retain` keeps the backing storage so an administrator can recover or clean it up deliberately.

The reclaim policy deserves a cleanup pause. This small command tells you whether deleting the claim will remove or retain the backing storage, which is the difference between routine cleanup and possible data loss:

```bash
kubectl get pv pvc-2b4bd1b0-51f6-44f2-8a0e-6d47c0f3e28a \
  -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy,STATUS:.status.phase,CLAIM:.spec.claimRef.namespace/.spec.claimRef.name
```

The output should show the policy clearly. In this example, production storage is retained, so claim deletion leaves a recovery handle:

```bash
NAME                                       RECLAIM   STATUS   CLAIM
pvc-2b4bd1b0-51f6-44f2-8a0e-6d47c0f3e28a   Retain    Bound    devpolaris-prod/orders-api-workdir
```

For `devpolaris-orders-api`, a staging work directory might use a `Delete` class because the environment is disposable. Production can use a `Retain` class when the team wants a safer cleanup story during incidents. Retained volumes still need an owner, a ticket, and a cleanup process so old disks stop collecting cost and sensitive data.

## Troubleshoot Pending Claims
<!-- section-summary: A Pending PVC points to storage provisioning or matching trouble, so claim events are the first useful evidence. -->

A `Pending` PVC means the claim exists but Kubernetes has not bound it to real storage. The application may show a Pod stuck in `Pending`, but the claim events usually tell the more useful story. The PVC deserves attention before application logs because the container may not have started yet.

```bash
kubectl get pvc orders-api-workdir -n devpolaris-prod

kubectl describe pvc orders-api-workdir -n devpolaris-prod
```

A missing StorageClass is the easy case. The claim event usually names the class Kubernetes tried to find:

```bash
Events:
  Type     Reason                Message
  Warning  ProvisioningFailed    storageclass.storage.k8s.io "standard-retian" not found
```

The manifest spelling may need correction, or the claim may need an existing class. The cluster's offered classes show which names are valid in this cluster:

```bash
kubectl get storageclass
```

Another common case is a class with `volumeBindingMode: WaitForFirstConsumer`. The claim may stay `Pending` until a Pod that uses it exists, because Kubernetes wants scheduling information before creating zone-bound storage. That waiting state can be healthy during the first few seconds of a rollout.

If the claim stays `Pending`, gather the storage facts in this order:

| Check | Command | What you are looking for |
|---|---|---|
| Claim events | `kubectl describe pvc orders-api-workdir -n devpolaris-prod` | Missing class, unsupported mode, quota, or provisioner errors. |
| Storage classes | `kubectl get storageclass` | Correct class name, default class, binding mode, and reclaim behavior. |
| CSI drivers | `kubectl get csidriver` | The storage driver advertised by the class exists in the cluster. |
| Pod events | `kubectl describe pod -l app=orders-api -n devpolaris-prod` | Scheduling and attach messages related to the volume. |
| Namespace quota | `kubectl describe resourcequota -n devpolaris-prod` | Storage requests blocked by quota. |

For driver-level errors, platform engineers usually inspect the CSI controller logs in the system namespace. Application engineers should bring the PVC YAML, the `describe pvc` events, the namespace, and the StorageClass name to that conversation.

## Troubleshoot Write and Permission Problems
<!-- section-summary: A Bound and mounted PVC can still fail because of filesystem permissions, read-only mounts, or backend attach issues. -->

Sometimes the PVC is `Bound` and the Pod is `Running`, but the application logs still say `permission denied` or `read-only file system`. That means storage provisioning succeeded and the failure moved to the mount path, Linux permissions, or the backend's current state.

The first runtime evidence comes from inside the container at the exact path the app writes to. The command below shows the runtime user, directory ownership, free space, and a real write attempt together:

```bash
kubectl exec deploy/orders-api -n devpolaris-prod -- sh -c '
  id
  ls -ld /var/lib/devpolaris/orders-work
  df -h /var/lib/devpolaris/orders-work
  touch /var/lib/devpolaris/orders-work/.write-test
'
```

If `touch` fails with `Permission denied`, compare the file ownership with the Pod security context. A non-root process with UID `10001` needs write permission through the owner, group, or mode bits on the mounted filesystem. `fsGroup` is often the clean Kubernetes fix because it lets the kubelet prepare the volume for the process group instead of asking the application to run as root.

```yaml
spec:
  securityContext:
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
```

If the path is read-only, check both the container mount and the PVC/PV access path. A `volumeMount` can explicitly set `readOnly: true`, and some storage problems can force a backend into a read-only state. Pod events and node storage logs help separate a YAML mistake from a storage incident.

```bash
kubectl get pod -l app=orders-api -n devpolaris-prod -o yaml | grep -A6 volumeMounts

kubectl describe pod -l app=orders-api -n devpolaris-prod
```

Capacity is a separate failure shape. If `df -h` shows the work directory at 100%, the app may fail writes even though permissions are correct. Resize the PVC only if the StorageClass allows expansion, and still clean up the application workflow that let temporary invoice files pile up.

## Production Tradeoffs
<!-- section-summary: PVCs are useful for durable files, but production teams still choose carefully around ownership, replicas, backups, and data value. -->

PVCs are a strong fit for durable files that a Pod must see across restarts. They are also a real operational commitment. The moment the application depends on a PVC, the team needs capacity alerts, backup or snapshot expectations, restore drills, access-mode choices, and a cleanup rule for retained volumes.

For `devpolaris-orders-api`, the long-term invoice archive belongs in object storage and the order records belong in the database. The PVC is only the narrow invoice work directory that bridges Pod restarts and background processing. That split keeps the Kubernetes volume from becoming the hidden system of record for the business.

Think through replicas early. A `ReadWriteOnce` claim and a Deployment with three replicas can create awkward scheduling and write behavior. If the service needs horizontal scale, move shared state to a database, object storage, a queue, or a real `ReadWriteMany` filesystem class that the platform team supports and backs up.

The reclaim policy should match the environment. `Delete` keeps development and staging tidy. `Retain` gives production teams a recovery handle, then asks them to handle old volume cleanup and sensitive data disposal.

Finally, treat the PVC as part of the release checklist. The claim should have an owner label, a documented StorageClass choice, a capacity alert, a restore path, and a short test that proves the application can write as its normal user. Those details give the on-call team concrete evidence when a Pod restarts, a volume fills, or a restore drill starts.

## What's Next
<!-- section-summary: The next article explains how StorageClasses turn a PVC request into a specific storage profile. -->

You now have the workload side of Kubernetes persistent storage. A PVC says what the application needs, a PV represents the cluster volume, and the Pod mounts the claim at the path the application uses.

The next article moves one layer down. We will look at StorageClasses, the CSI provisioners behind them, and the review questions application teams should ask before choosing a class for production.

---

**References**

- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) - Defines PersistentVolumes, PersistentVolumeClaims, access modes, volume modes, binding, and reclaim policies.
- [Kubernetes Dynamic Volume Provisioning](https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/) - Explains how StorageClasses allow PVCs to trigger automatic volume provisioning.
- [Kubernetes Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) - Documents StorageClass fields such as provisioner, reclaim policy, binding mode, and expansion support.
- [Kubernetes Volumes](https://kubernetes.io/docs/concepts/storage/volumes/) - Describes Kubernetes volume types and how volume lifetimes differ from container filesystems.
- [Configure a Pod to Use a PersistentVolume for Storage](https://kubernetes.io/docs/tasks/configure-pod-container/configure-persistent-volume-storage/) - Walks through a practical PVC and Pod mount workflow.
- [Container Storage Interface documentation](https://kubernetes-csi.github.io/docs/) - Provides background on CSI drivers and Kubernetes storage integration behavior.
