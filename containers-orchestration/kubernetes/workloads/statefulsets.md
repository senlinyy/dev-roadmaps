---
title: "StatefulSets"
description: "Run Kubernetes workloads that need stable identity, ordered rollout, and persistent storage."
overview: "StatefulSets are for Pods that carry durable identity. `notification-api` can stay replaceable, while supporting services may need stable names and volumes."
tags: ["statefulsets", "storage", "pods", "identity"]
order: 4
id: article-containers-orchestration-kubernetes-workloads-statefulsets
---
## Table of Contents

1. [Data Needs Stable Identity](#data-needs-stable-identity)
2. [Stable Pod Identity](#stable-pod-identity)
3. [Headless Services and Pod DNS](#headless-services-and-pod-dns)
4. [Persistent Storage with PVC Templates](#persistent-storage-with-pvc-templates)
5. [A StatefulSet Skeleton](#a-statefulset-skeleton)
6. [Add the Database Container and Storage Mount](#add-the-database-container-and-storage-mount)
7. [Startup, Scaling, and Updates](#startup-scaling-and-updates)
8. [Debugging StatefulSets in the Terminal](#debugging-statefulsets-in-the-terminal)
9. [Production Guidance for Stateful Services](#production-guidance-for-stateful-services)
10. [When a Deployment Fits Better](#when-a-deployment-fits-better)
11. [Operational Runbook](#operational-runbook)
12. [References](#references)

## Data Needs Stable Identity
<!-- section-summary: StatefulSets exist for Pods where data, membership, or peer identity must stay tied to a predictable Pod name and storage claim. -->

Most Kubernetes service Pods can be replaced freely because the important data lives somewhere else. Stateful workloads are different. They need a stable name, a stable storage claim, or a stable member identity that survives restarts and rescheduling.

A **StatefulSet** is the Kubernetes controller for workloads where identity and storage must stay tied to a predictable replica. It still uses a Pod template and a desired replica count, but each replica receives an ordinal name such as `notification-postgres-0`, `notification-postgres-1`, and `notification-postgres-2`. Storage claims can line up with those same ordinals.

For the Customer Notification Platform, `notification-api` should usually stay on a Deployment because any ready API Pod can serve the next request. A supporting PostgreSQL member in a learning or staging cluster has a stronger connection to its disk and identity. After a restart or reschedule, operators need to know which Pod owns which data directory, which DNS name clients should use for that member, and which storage claim must mount back to it.

A **stateful workload** keeps important data, membership, or identity inside a specific replica. A database member may own a local data directory. A Redis cluster member may own a hash slot range. A search node may own a shard copy. A message broker may keep a log segment on disk. Those systems need stronger identity than a random Deployment Pod name.

Stable identity shows up through ordinal Pod names, headless Services, DNS, volume claim templates, startup order, updates, debugging, production guidance, and the cases where a Deployment remains the better controller.

For `notification-api`, the API layer should stay replaceable. If one API Pod disappears, another API Pod can read and write the same notification records in PostgreSQL. For `notification-postgres`, the Pod itself has a stronger connection to local data. The Pod name, DNS name, and disk all need to stay aligned through restarts.

| Workload | Usual controller | Reason |
|---|---|---|
| `notification-api` | Deployment | Every API replica can serve the same kind of request through the same Service. |
| `notification-worker` that reads from a queue | Deployment | A worker can disappear and a new worker can pick up the next message. |
| `notification-postgres` with local database files | StatefulSet | The database member needs a stable name and a stable volume. |
| `notification-redis` in a clustered setup | StatefulSet | Each member may need stable peer identity and persistent data. |

StatefulSets deserve caution. They give the cluster stronger promises around identity and storage, and those promises add operational responsibility. Once a Pod owns a disk, rollout, backup, restore, and cleanup decisions carry more weight than they carry for stateless API replicas.

## Stable Pod Identity
<!-- section-summary: StatefulSet Pods receive ordinal names that survive restarts, rescheduling, and normal controller reconciliation. -->

An **ordinal** is the number Kubernetes adds to each StatefulSet Pod name. For a StatefulSet named `notification-postgres`, the first Pod is `notification-postgres-0`, the second Pod is `notification-postgres-1`, and the third Pod is `notification-postgres-2`. Kubernetes uses this pattern every time it recreates the Pod, so the identity stays predictable.

That stable identity shows up in several places. The Pod name includes the ordinal. Kubernetes adds labels that identify the owning StatefulSet and Pod identity. A volume claim created from a StatefulSet template also includes the ordinal, so the storage object and the Pod identity line up.

![StatefulSet identity map infographic showing the notification-postgres StatefulSet connecting notification-postgres-0 and notification-postgres-1 to matching DNS identities and PVC data volumes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-identity-map.png)

*StatefulSets give each replica a stable ordinal identity that can connect to matching DNS and storage.*

_This infographic shows the StatefulSet contract: each ordinal Pod keeps a matching DNS identity and PVC identity._

Think about a database support page during business hours. A runbook that says "check `notification-postgres-0` first" works because that name keeps meaning the same member identity. A graph that shows disk pressure on `data-notification-postgres-0` also points back to the matching Pod. The name gives operators a stable handle during a careful repair.

The identity also helps applications that keep peer lists. A clustered service can say "member 0 is reachable at this DNS name, member 1 is reachable at that DNS name." Kubernetes still may move the Pod to another node and give it a different IP address. The Pod identity remains the same.

## Headless Services and Pod DNS
<!-- section-summary: A headless Service lets clients discover individual StatefulSet Pods instead of sending every request through one load-balanced virtual IP. -->

A **Service** gives a stable network entry point for a group of Pods. A normal ClusterIP Service gives clients one virtual IP and load-balances traffic to matching Pods. That works well for `notification-api` because a caller usually wants any healthy API replica.

A **headless Service** is a Service with `clusterIP: None`. Kubernetes still creates DNS records for it, and those records point clients toward the individual Pods behind the Service. StatefulSets use this pattern because some clients need to reach a specific member, such as `notification-postgres-0.notification-postgres.notifications.svc.cluster.local`.

The headless Service provides the DNS side of the StatefulSet contract:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-postgres
  namespace: notifications
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: notification-postgres
  ports:
    - name: postgres
      port: 5432
```

The important parts are:

- `clusterIP: None` tells Kubernetes to create a headless Service.
- `selector` connects the Service to Pods with the same label.
- `ports.name: postgres` gives the database port a stable name.
- The StatefulSet will later set `serviceName: notification-postgres`, which ties Pod DNS names to this Service.

A DNS check from the API namespace should resolve the member name, such as `notification-postgres-0.notification-postgres.notifications.svc.cluster.local`, to the current Pod IP. If the Service selector is wrong, the database may run perfectly while clients fail because discovery has no matching endpoint. EndpointSlices are the first Kubernetes object to inspect when DNS or Service routing looks suspicious.

| Object to inspect | Healthy signal |
|---|---|
| Headless Service | `clusterIP: None` and a selector that matches the StatefulSet labels |
| Pod labels | The member Pod carries the labels the Service selector expects |
| EndpointSlices | Endpoints exist for the selected Pods and expose the expected port |
| DNS lookup from caller namespace | The ordinal Pod name resolves to the current Pod IP |

## Persistent Storage with PVC Templates
<!-- section-summary: A volumeClaimTemplate creates one PersistentVolumeClaim per StatefulSet Pod identity, keeping storage tied to ordinals. -->

A **PersistentVolumeClaim**, or **PVC**, is a request for storage. A Pod mounts the claim, and Kubernetes binds it to a PersistentVolume from the cluster's storage system. A normal single PVC can work for one Pod, but a StatefulSet needs a repeatable pattern for each ordinal.

StatefulSets add **volumeClaimTemplates**. A volume claim template says, "create a PVC like this for each Pod ordinal." With a template named `data`, Kubernetes creates claims named `data-notification-postgres-0`, `data-notification-postgres-1`, and so on. When `notification-postgres-0` restarts, Kubernetes mounts the same claim for that same ordinal.

Here is the storage request by itself:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOncePod"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 20Gi
```

The storage request has three key parts:

- `ReadWriteOncePod` means the volume should be mounted read-write by a single Pod.
- `storageClassName: fast-ssd` asks for a class defined by the cluster.
- `20Gi` is the requested capacity.

Inspecting PVCs should show a claim named from the template, StatefulSet, and ordinal, such as `data-notification-postgres-0`. A healthy claim is `Bound`, uses the expected StorageClass, and has the requested capacity. Now we have the three core pieces: Pod identity, DNS identity, and storage identity. The next section puts them together without dropping a full production manifest all at once.

![Stable DNS and storage contract infographic showing a headless Service with clusterIP None, Pod DNS, volumeClaimTemplate, PVC, StorageClass, and PV binding](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/stable-dns-storage-contract.png)

*The headless Service and volume claim template work together to give each StatefulSet Pod stable network and storage contracts.*

_This infographic connects the network and storage halves of the StatefulSet design, so the headless Service answers where a member lives and the PVC path answers where its data lives._

## A StatefulSet Skeleton
<!-- section-summary: The StatefulSet skeleton connects selector labels, the headless Service name, and the Pod template before container details are added. -->

The skeleton combines the three promises introduced earlier: a stable controller identity, a headless Service name for DNS, and matching labels for Pod ownership. The database container comes later because the first StatefulSet question is whether Kubernetes can connect the ordinal Pod identity to the Service and the Pod template before storage and process details are added. That contract anchors the later volume claim and mount for the database Pod and its data directory.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: notification-postgres
  namespace: notifications
spec:
  serviceName: notification-postgres
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-postgres
```

`serviceName: notification-postgres` connects the StatefulSet to the headless Service. `replicas: 1` keeps the learning example small. The selector must match the Pod template labels, just like other controllers.

Add the PVC template from the previous section:

```yaml
spec:
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOncePod"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
```

At this point the controller knows the identity, DNS contract, and storage request. The Pod still needs a container that mounts the claim.

## Add the Database Container and Storage Mount
<!-- section-summary: The container uses normal Pod fields, while the volume mount must match the volumeClaimTemplate name. -->

The database container needs an image, port, environment values, probes, and a mount. In a real platform, a database operator or managed database service is often the production choice. This example keeps PostgreSQL small so the StatefulSet mechanics are visible.

The storage mount is the key detail in this container section. The `data` mount in the container must match the `volumeClaimTemplates` name, because that shared name is how Kubernetes connects `notification-postgres-0` to `data-notification-postgres-0`. If the mount and claim template drift, the Pod may start without the storage contract the database needs.

Credentials belong in a Secret before the container reads them. The container can then read `POSTGRES_USER` and `POSTGRES_PASSWORD` from that Secret and mount the `data` claim:

```yaml
containers:
  - name: postgres
    image: postgres:16.4
    ports:
      - name: postgres
        containerPort: 5432
    env:
      - name: POSTGRES_USER
        valueFrom:
          secretKeyRef:
            name: notification-postgres-auth
            key: username
      - name: POSTGRES_PASSWORD
        valueFrom:
          secretKeyRef:
            name: notification-postgres-auth
            key: password
    volumeMounts:
      - name: data
        mountPath: /var/lib/postgresql/data
```

The `volumeMounts` entry named `data` must match the `volumeClaimTemplates` entry named `data`. Kubernetes creates the PVC and mounts it into the container from that shared name.

Add a readiness probe with `pg_isready` so clients only connect after PostgreSQL is ready. After applying the Service, Secret, and StatefulSet through the team's delivery path, inspect one named controller, one named Pod, one headless Service, and one matching claim. If the Pod moves to another node tomorrow, the Pod name remains `notification-postgres-0`, the DNS name remains tied to that identity, and the data claim remains `data-notification-postgres-0`.

## Startup, Scaling, and Updates
<!-- section-summary: StatefulSet startup, scale-down, and rolling updates preserve ordinal order by default, which protects identity-sensitive systems. -->

The default StatefulSet Pod management policy is **OrderedReady**. For a StatefulSet with three replicas, Kubernetes creates `notification-postgres-0`, waits until it is Running and Ready, then creates `notification-postgres-1`, and then creates `notification-postgres-2`. During scale-down, Kubernetes removes the highest ordinal first.

That ordering protects systems that need a predictable startup sequence. It can also surprise teams that expect all replicas to appear at once. Under the default policy, Kubernetes waits for `notification-postgres-0` to report ready before creating `notification-postgres-1`.

Updates also use ordered behavior by default. The rolling update works from the highest ordinal down toward zero. If `notification-postgres-2` fails readiness after an image change, Kubernetes pauses there and leaves lower ordinals alone. That pause gives operators time to inspect the newest member before the rollout reaches earlier identities.

During an update, watch rollout status, revision history, and the Pods sorted by ordinal. The healthy signal needs more than "new image running." The expected ordinal should update, report ready, and keep its storage identity.

StatefulSets also support partitioned rolling updates. A partition lets you update only Pods with ordinals greater than or equal to a chosen number. Teams use this to test a new database image on a higher ordinal before touching lower ordinals.

For example, a partition of `2` on a three-member StatefulSet updates only ordinal `2`. Ordinals `0` and `1` stay on the old template until the team lowers or removes the partition.

The risky part of StatefulSet updates is data compatibility. An image can change on-disk format, migrate files, or start writing metadata that an older version cannot read. For `notification-postgres`, an image change should sit next to a database upgrade plan, backup checkpoint, restore test, and rollback decision.

## Debugging StatefulSets in the Terminal
<!-- section-summary: StatefulSet debugging separates controller state, Pod readiness, DNS discovery, PVC binding, volume attachment, and application logs. -->

The controller, Pods, and PVCs show whether identity and storage lined up. A Pending Pod with a Pending PVC points toward storage events before PostgreSQL logs. A running Pod with failing readiness points toward the database process, configuration, or probe command. DNS problems usually trace back to the headless Service selector, Pod labels, and EndpointSlices.

StatefulSet debugging needs a slower first pass because the data path is part of the workload. The notification database may have a healthy controller with a Pending claim, a running Pod with broken DNS, or a ready Pod with a storage volume close to full. The table below maps each symptom to the first evidence source before the command sequence.

| Symptom | First evidence | Likely direction |
|---|---|---|
| Pod is `Pending` and PVC is `Pending` | PVC events and StorageClass | Provisioning, quota, missing StorageClass, or volume binding |
| Pod is running but not ready | Pod events and database logs | PostgreSQL startup, credentials, probe command, or data directory |
| Disk is almost full | Container filesystem check and PVC metrics | Capacity expansion, cleanup, backup retention, or storage class limits |
| DNS name has no answer | Service selector, Pod labels, EndpointSlices | Discovery wiring rather than database process health |

The right evidence source depends on the symptom. Storage binding problems show up in PVC events. Process failures show up in Pod events and logs. Discovery problems show up in Service selectors and EndpointSlices.

The controller is the first evidence source. The StatefulSet row tells you how many replicas Kubernetes wants, how many are ready, and which update revision is current.

```bash
$ kubectl get statefulset notification-postgres -n notifications
NAME                    READY   AGE
notification-postgres   1/1     14d
```

For a wider view, include labels and revisions:

```bash
$ kubectl describe statefulset notification-postgres -n notifications
Name:               notification-postgres
Namespace:          notifications
Replicas:           1 desired | 1 total
Pods Status:        1 Running / 0 Waiting / 0 Succeeded / 0 Failed
Update Strategy:    RollingUpdate
Pod Template:
  Labels:           app.kubernetes.io/name=notification-postgres
Volume Claims:
  Name:             data
```

The useful fields are:

- `Replicas` shows whether the controller has the requested count.
- `Pods Status` separates running Pods from waiting or failed Pods.
- `Update Strategy` tells you whether updates should roll through ordinals.
- `Volume Claims` confirms the template name that should appear inside PVC names.

Next, check the Pods with their node placement and readiness. StatefulSet Pod names should include the ordinal.

```bash
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-postgres -o wide
NAME                      READY   STATUS    RESTARTS   AGE   IP            NODE
notification-postgres-0   1/1     Running   0          14d   10.244.2.41   worker-b
```

`notification-postgres-0` is the identity to follow through DNS, logs, events, and storage. If the Pod moves to another node, the `NODE` and `IP` values may change, while the Pod identity and matching claim name stay stable.

PVCs prove whether storage binding worked. The claim name should combine the volume claim template name, StatefulSet name, and ordinal.

```bash
$ kubectl get pvc -n notifications
NAME                           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   AGE
data-notification-postgres-0   Bound    pvc-9c4f7a2c-2d61-4a7b-84f5-9e2a9c0a1111   20Gi       RWO            fast-ssd       14d
```

`STATUS Bound` means Kubernetes matched the claim to backing storage. `STORAGECLASS fast-ssd` should match the design. `CAPACITY 20Gi` should match the request unless the storage system expanded it later through a reviewed change.

DNS checks prove whether the headless Service exposes the ordinal identity. Run the lookup from a temporary Pod in the same namespace or from the application namespace that will call the database.

```bash
$ kubectl run dns-check -n notifications --rm -it --restart=Never \
  --image=registry.k8s.io/e2e-test-images/agnhost:2.45 -- \
  nslookup notification-postgres-0.notification-postgres.notifications.svc.cluster.local
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      notification-postgres-0.notification-postgres.notifications.svc.cluster.local
Address 1: 10.244.2.41 notification-postgres-0.notification-postgres.notifications.svc.cluster.local
```

The DNS answer should point to the current Pod IP. If the lookup has no answer, inspect the headless Service selector, Pod labels, and EndpointSlices before changing the database container.

Rollout checks should follow ordinal order. For a one-member learning database, the status command is short. For larger StatefulSets, watch which ordinal updates and which one pauses.

```bash
$ kubectl rollout status statefulset/notification-postgres -n notifications
partitioned roll out complete: 1 new pods have been updated...
```

The controller history adds the revision record:

```bash
$ kubectl rollout history statefulset/notification-postgres -n notifications
statefulset.apps/notification-postgres
REVISION  CHANGE-CAUSE
1         <none>
2         postgres image 16.4
```

The rollout status tells you whether Kubernetes finished updating the StatefulSet. The history tells you which controller revisions exist, but a database upgrade plan is still required. A database image change still needs backup, restore confidence, and data compatibility review.

PVC Pending events usually explain storage problems before application logs exist. A Pending claim can block the Pod before the database process starts.

```bash
$ kubectl describe pvc data-notification-postgres-0 -n notifications
Name:          data-notification-postgres-0
Namespace:     notifications
StorageClass:  fast-ssd
Status:        Pending
Events:
  Type     Reason                Age   From                         Message
  ----     ------                ----  ----                         -------
  Warning  ProvisioningFailed    2m    persistentvolume-controller  storageclass.storage.k8s.io "fast-ssd" not found
```

That event says the StorageClass name in the PVC request has no matching cluster StorageClass. The next action is to fix storage configuration before investigating PostgreSQL. Other Pending events might point to quota, unavailable zones, volume binding mode, or a storage provisioner problem.

## Production Guidance for Stateful Services
<!-- section-summary: Production StatefulSets need backup, restore, storage, disruption, security, and upgrade plans around the Kubernetes object. -->

Production stateful systems need more than a correct YAML file. The StatefulSet gives identity and storage wiring. The service still needs backup, restore, replication, monitoring, upgrade, and failure-handling plans.

For databases, many teams prefer managed services or Kubernetes operators. A managed database shifts storage operations, backups, failover, and upgrades to the provider. A database operator can automate cluster membership, failover, backups, and version upgrades inside Kubernetes. A hand-written StatefulSet may be fine for learning, local development, or small internal systems, but serious production databases need stronger operational machinery.

Backups should be proven with restore tests. A backup job that has never restored a database is only a hopeful file. The runbook should say where backups live, how encryption works, who can restore, how long restore takes, and how the application will be pointed at recovered data.

Pod disruption planning also belongs in the design. A **PodDisruptionBudget**, or **PDB**, tells Kubernetes how many matching Pods can be voluntarily disrupted during operations such as node drains. For a single database Pod, `maxUnavailable: 0` can prevent voluntary eviction and protect availability, while also blocking some maintenance until the team makes an explicit plan.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: notification-postgres
  namespace: notifications
spec:
  maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-postgres
```

StorageClass choice should show up in design review too. A production class may need encrypted disks, the right availability-zone behavior, volume expansion, a `Retain` reclaim policy, backup integration, and `WaitForFirstConsumer` volume binding. The cluster admin owns the StorageClass definition, and the application team owns the request that chooses it.

The StatefulSet's PVC retention policy adds another cleanup control. By default, PVCs created from `volumeClaimTemplates` remain after scale-down or StatefulSet deletion. Kubernetes also supports `.spec.persistentVolumeClaimRetentionPolicy`, where teams can choose `Retain` or `Delete` behavior for scale-down and deletion. For production data, `Retain` keeps destructive cleanup deliberate. For short-lived preview environments, `Delete` may fit if the data has no long-term value.

Monitoring should connect Kubernetes and application signals. Kubernetes metrics can show Pod restarts, PVC usage, scheduling problems, and volume attachment issues. Database metrics can show replication lag, connection saturation, slow queries, checkpoint behavior, and backup age. The support dashboard for `notification-postgres` should show both layers because a green Pod can still contain an unhealthy database.

## When a Deployment Fits Better
<!-- section-summary: Stateless APIs and workers should usually stay on Deployments while they depend on a database or cache. -->

A **stateless Pod** can disappear without losing unique local state. It may still read and write important data, and that data lives in another system such as PostgreSQL, Redis, object storage, or a message broker. The Pod itself keeps no disk identity that needs to follow it after rescheduling.

That is the normal shape for `notification-api`. The API connects to `notification-postgres`, handles HTTP requests, writes rows, and returns responses. If an API Pod restarts, Kubernetes can create a new Pod with a new name because the API has no need for a stable ordinal or a private disk. A Deployment gives faster rolling updates, simpler scaling, and load-balanced Services that match this shape.

`notification-worker` also fits a Deployment when it reads from a queue and acknowledges messages after processing. Queue semantics, deduplication keys, and retry handling give the worker its business safety. The worker can use replaceable Pod names.

Use this table during design review:

| Question | Deployment answer | StatefulSet answer |
|---|---|---|
| What happens if the Pod name changes? | Nothing important changes for the workload. | Peers, operators, or storage mapping rely on that identity. |
| Where does durable data live? | In an external database, cache, queue, or object store. | In a volume attached to a specific Pod identity. |
| How should clients connect? | Any healthy replica behind a Service can respond. | Some clients need a specific member DNS name. |
| How should scaling behave? | Replicas can come and go freely. | Replicas may need ordered startup, shutdown, or membership changes. |
| What does rollback involve? | Usually a Pod template or image rollback. | Often a Pod template rollback plus data compatibility review. |

This distinction keeps Kubernetes designs clean. The notification API and worker can stay replaceable and easy to roll out. The supporting database or clustered cache can receive stronger identity and storage behavior only where the system actually needs it.

## Operational Runbook
<!-- section-summary: StatefulSet operations should check backups, storage, DNS, Pod health, and rollout order before making destructive changes. -->

Before a StatefulSet change, the team should know the current controller revision, current Pods, current PVCs, recent backup status, and restore confidence. A small pre-change snapshot gives everyone the same starting point. It also gives production responders a quick comparison if the rollout pauses.

During a manifest change, the watch should focus on ordinals and readiness. The highest ordinal usually updates first during a rolling update. A lower ordinal may wait because the controller wants ordered progress.

For a pending Pod, storage comes first. The PVC status, claim events, StorageClass, namespace quota, and cluster provisioner logs usually explain the problem faster than container logs. Container logs help after Kubernetes mounts the volume and starts the process.

For a DNS problem, the Service selector and EndpointSlices come first. The Pod may run and the database may accept local connections, while clients still fail because the headless Service has no matching endpoints. A DNS test from the caller's namespace confirms the path the application really uses.

For a data-bearing Pod, forced deletion should sit at the end of the decision tree. A force delete can help after a node failure leaves a Pod stuck, and it can also create split-brain risk for stateful systems that still have a process running somewhere. Confirm node state, volume attachment state, database membership, and backup position before using force.

For cleanup, PVC deletion should require an explicit data decision. Deleting a StatefulSet normally leaves the PVCs behind by default. Deleting the PVCs may release or delete the backing storage depending on the PV reclaim policy and storage provider.

Treat the StatefulSet, the headless Service, the PVCs, the StorageClass, and the application data plan as one system. Kubernetes gives you stable building blocks. Production safety comes from the runbooks and recovery tests around those blocks.

![StatefulSet operations runbook infographic showing backups, PVCs, DNS, Pod health, rollout order, and force delete last as the safe operations sequence](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-operations-runbook.png)

*StatefulSet operations should protect backups, PVCs, DNS identity, Pod health, and rollout order before disruptive actions.*

_This infographic summarizes the StatefulSet operating order: verify recovery first, inspect identity and storage, then handle rollout or deletion only after the data path is clear._

## References

- [Kubernetes StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) - Official StatefulSet concepts, including stable identity, ordered deployment, update strategies, Pod management policy, and PVC retention policy.
- [StatefulSet Basics](https://kubernetes.io/docs/tutorials/stateful-application/basic-stateful-set/) - Official tutorial that demonstrates ordered Pod creation, stable DNS, stable storage, scaling, and StatefulSet deletion behavior.
- [Headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services) - Official Service documentation for `clusterIP: None`, direct Pod endpoint discovery, and headless Service DNS behavior.
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/) - Official DNS record shapes for normal Services, headless Services, Pods, and SRV records.
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) - Official PV and PVC documentation, including claim binding, access modes, reclaim policies, and storage object protection.
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) - Official StorageClass documentation for provisioners, reclaim policy, volume expansion, binding mode, and default classes.
- [Specifying a Disruption Budget for your Application](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) - Official guide for creating and checking PodDisruptionBudgets.
- [Debug a StatefulSet](https://kubernetes.io/docs/tasks/debug/debug-application/debug-statefulset/) - Official debugging task for listing and investigating StatefulSet Pods.
- [Force Delete StatefulSet Pods](https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/) - Official guidance for the rare cases where StatefulSet Pods need forced deletion.
- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/) - Official reference for the command-line tool used throughout the runbooks.
