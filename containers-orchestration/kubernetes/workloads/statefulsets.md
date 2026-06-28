---
title: "StatefulSets"
description: "Run Kubernetes workloads that need stable identity, ordered rollout, and persistent storage."
overview: "StatefulSets are for Pods that carry durable identity. This article shows when `notification-api` should stay on a Deployment and when supporting services need stable names and volumes."
tags: ["statefulsets", "storage", "pods", "identity"]
order: 4
id: article-containers-orchestration-kubernetes-workloads-statefulsets
---

## Table of Contents

1. [Data Needs Stable Identity](#data-needs-stable-identity)
2. [Stable Pod Identity](#stable-pod-identity)
3. [Headless Services and Pod DNS](#headless-services-and-pod-dns)
4. [Persistent Storage with PVC Templates](#persistent-storage-with-pvc-templates)
5. [Start with a StatefulSet Skeleton](#start-with-a-statefulset-skeleton)
6. [Add the Database Container and Storage Mount](#add-the-database-container-and-storage-mount)
7. [Startup, Scaling, and Updates](#startup-scaling-and-updates)
8. [Debugging StatefulSets in the Terminal](#debugging-statefulsets-in-the-terminal)
9. [Production Guidance for Stateful Services](#production-guidance-for-stateful-services)
10. [When a Deployment Fits Better](#when-a-deployment-fits-better)
11. [Operational Runbook](#operational-runbook)

## Data Needs Stable Identity
<!-- section-summary: StatefulSets exist for Pods where data, membership, or peer identity must stay tied to a predictable Pod name and storage claim. -->

Start with one Pod that holds data. In a learning or staging cluster for the Customer Notification Platform, the team might run a small PostgreSQL service called `notification-postgres` so they can test schema migrations and application connection behavior inside Kubernetes.

The data changes the operating rule. `notification-api` Pods can come and go because durable records live in PostgreSQL. A database Pod has a closer relationship with its disk and member identity. After a restart or reschedule, operators need to know which Pod owns which data directory, which DNS name clients should use for that member, and which storage claim must mount back to it.

A **StatefulSet** is the Kubernetes controller for that shape. It still uses a Pod template, and it still reconciles the desired number of replicas. It also gives each replica a stable ordinal name such as `notification-postgres-0`, `notification-postgres-1`, and `notification-postgres-2`, plus storage patterns that line up with those names.

A **stateful workload** keeps important data, membership, or identity inside a specific replica. A database member may own a local data directory. A Redis cluster member may own a hash slot range. A search node may own a shard copy. A message broker may keep a log segment on disk. Those systems need stronger identity than a random Deployment Pod name.

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

_This infographic shows the StatefulSet contract: each ordinal Pod keeps a matching DNS identity and PVC identity._

Think about a database incident page in the middle of the night. A runbook that says "check `notification-postgres-0` first" works because that name keeps meaning the same member identity. A graph that shows disk pressure on `data-notification-postgres-0` also points back to the matching Pod. The name gives operators a stable handle during a stressful repair.

The identity also helps applications that keep peer lists. A clustered service can say "member 0 is reachable at this DNS name, member 1 is reachable at that DNS name." Kubernetes still may move the Pod to another node and give it a different IP address. The Pod identity remains the same.

## Headless Services and Pod DNS
<!-- section-summary: A headless Service lets clients discover individual StatefulSet Pods instead of sending every request through one load-balanced virtual IP. -->

A **Service** gives a stable network entry point for a group of Pods. A normal ClusterIP Service gives clients one virtual IP and load-balances traffic to matching Pods. That works well for `notification-api` because a caller usually wants any healthy API replica.

A **headless Service** is a Service with `clusterIP: None`. Kubernetes still creates DNS records for it, and those records point clients toward the individual Pods behind the Service. StatefulSets use this pattern because some clients need to reach a specific member, such as `notification-postgres-0.notification-postgres.notifications.svc.cluster.local`.

Start with the headless Service:

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

The selector connects the Service to Pods with the same label. `clusterIP: None` tells Kubernetes to create a headless Service, so cluster DNS can return records for the selected Pods instead of one virtual Service IP. The StatefulSet will later set `serviceName: notification-postgres`, and that field ties Pod DNS names to this Service.

A DNS check from the API namespace might look like this:

```bash
$ kubectl exec -n notifications deploy/notification-api -- \
  getent hosts notification-postgres-0.notification-postgres.notifications.svc.cluster.local
10.42.2.18  notification-postgres-0.notification-postgres.notifications.svc.cluster.local
```

If the Service selector is wrong, the database may run perfectly while clients fail because discovery has no matching endpoint. Check EndpointSlices when DNS or Service routing looks suspicious:

```bash
$ kubectl get endpointslices -n notifications \
  -l kubernetes.io/service-name=notification-postgres
NAME                         ADDRESSTYPE   PORTS   ENDPOINTS
notification-postgres-7xk2p   IPv4          5432    10.42.2.18
```

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

`ReadWriteOncePod` means the volume should be mounted read-write by a single Pod. `storageClassName: fast-ssd` asks for a class defined by the cluster. `20Gi` is the requested capacity.

Inspect the created claim:

```bash
$ kubectl get pvc -n notifications -l app.kubernetes.io/name=notification-postgres
NAME                           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS
data-notification-postgres-0   Bound    pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20   20Gi       RWOP           fast-ssd
```

Now we have the three core pieces: Pod identity, DNS identity, and storage identity. The next section puts them together without dropping a full production manifest all at once.

![Stable DNS and storage contract infographic showing a headless Service with clusterIP None, Pod DNS, volumeClaimTemplate, PVC, StorageClass, and PV binding](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/stable-dns-storage-contract.png)

_This infographic connects the network and storage halves of the StatefulSet design, so the headless Service answers where a member lives and the PVC path answers where its data lives._

## Start with a StatefulSet Skeleton
<!-- section-summary: The StatefulSet skeleton connects selector labels, the headless Service name, and the Pod template before container details are added. -->

The StatefulSet controller shape starts like this:

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

The database container needs an image, port, environment values, probes, and a mount. In a real platform, a database operator or managed database service is often a better production choice. This example keeps PostgreSQL small so the StatefulSet mechanics are visible.

Start with a Secret for credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-postgres-auth
  namespace: notifications
stringData:
  username: notification_app
  password: replace-in-real-secret-store
```

The container reads the Secret and mounts the `data` claim:

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

Add a readiness probe so clients only connect after PostgreSQL is ready:

```yaml
readinessProbe:
  exec:
    command: ["pg_isready", "-U", "notification_app"]
  periodSeconds: 10
  failureThreshold: 6
```

Apply the pieces through your delivery path and inspect the result:

```bash
$ kubectl apply -f notification-postgres.yaml
secret/notification-postgres-auth created
service/notification-postgres created
statefulset.apps/notification-postgres created

$ kubectl rollout status statefulset/notification-postgres -n notifications
statefulset rolling update complete 1 pods at revision notification-postgres-6f4f957f7b...
```

Then check the contract:

```bash
$ kubectl get statefulset,pod,svc,pvc -n notifications \
  -l app.kubernetes.io/name=notification-postgres
NAME                                      READY   AGE
statefulset.apps/notification-postgres   1/1     2m

NAME                          READY   STATUS    AGE
pod/notification-postgres-0   1/1     Running   2m

NAME                           STATUS   CAPACITY   STORAGECLASS
persistentvolumeclaim/data-notification-postgres-0   Bound    20Gi       fast-ssd
```

That view shows one named controller, one named Pod, one headless Service, and one matching claim. If the Pod moves to another node tomorrow, the Pod name remains `notification-postgres-0`, the DNS name remains tied to that identity, and the data claim remains `data-notification-postgres-0`.

## Startup, Scaling, and Updates
<!-- section-summary: StatefulSet startup, scale-down, and rolling updates preserve ordinal order by default, which protects identity-sensitive systems. -->

The default StatefulSet Pod management policy is **OrderedReady**. For a StatefulSet with three replicas, Kubernetes creates `notification-postgres-0`, waits until it is Running and Ready, then creates `notification-postgres-1`, and then creates `notification-postgres-2`. During scale-down, Kubernetes removes the highest ordinal first.

That ordering protects systems that need a predictable startup sequence. It can also surprise teams that expect all replicas to appear at once. If `notification-postgres-0` cannot become ready, Kubernetes does not move on to `notification-postgres-1` under the default policy.

Updates also use ordered behavior by default. The rolling update works from the highest ordinal down toward zero. If `notification-postgres-2` fails readiness after an image change, Kubernetes pauses there and leaves lower ordinals alone. That pause gives operators time to inspect the newest member before the rollout reaches earlier identities.

Watch a StatefulSet update:

```bash
$ kubectl rollout status statefulset/notification-postgres -n notifications
$ kubectl rollout history statefulset/notification-postgres -n notifications
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-postgres --watch
```

StatefulSets also support partitioned rolling updates. A partition lets you update only Pods with ordinals greater than or equal to a chosen number. Teams use this to test a new database image on a higher ordinal before touching lower ordinals.

```bash
$ kubectl patch statefulset notification-postgres -n notifications --type merge \
  -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"partition":2}}}}'
statefulset.apps/notification-postgres patched
```

The risky part of StatefulSet updates is data compatibility. An image can change on-disk format, migrate files, or start writing metadata that an older version cannot read. For `notification-postgres`, an image change should sit next to a database upgrade plan, backup checkpoint, restore test, and rollback decision.

## Debugging StatefulSets in the Terminal
<!-- section-summary: StatefulSet debugging separates controller state, Pod readiness, DNS discovery, PVC binding, volume attachment, and application logs. -->

Start with the controller, Pods, and PVCs:

```bash
$ kubectl get statefulset notification-postgres -n notifications
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-postgres -o wide
$ kubectl get pvc -n notifications -l app.kubernetes.io/name=notification-postgres
```

A Pending Pod with a Pending PVC points toward storage:

```bash
$ kubectl get pvc -n notifications data-notification-postgres-0
NAME                           STATUS    STORAGECLASS
data-notification-postgres-0   Pending   fast-ssd

$ kubectl describe pvc -n notifications data-notification-postgres-0
Events:
  Warning  ProvisioningFailed  storageclass.storage.k8s.io "fast-ssd" not found
```

That failure is not a PostgreSQL log problem. Kubernetes cannot provision or bind the volume yet.

A running Pod with failing readiness points toward the database process:

```bash
$ kubectl describe pod -n notifications notification-postgres-0
$ kubectl logs -n notifications notification-postgres-0 -c postgres --tail=100
$ kubectl logs -n notifications notification-postgres-0 -c postgres --previous --tail=100
```

Disk pressure should be checked from inside the container and from Kubernetes storage objects:

```bash
$ kubectl exec -n notifications notification-postgres-0 -- df -h /var/lib/postgresql/data
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme1n1     20G   18G  2.0G  90% /var/lib/postgresql/data
```

DNS problems start with the headless Service and EndpointSlices:

```bash
$ kubectl get service -n notifications notification-postgres -o yaml
$ kubectl get pod -n notifications notification-postgres-0 --show-labels
$ kubectl get endpointslices -n notifications \
  -l kubernetes.io/service-name=notification-postgres
```

The right evidence source depends on the symptom. Storage binding problems show up in PVC events. Process failures show up in Pod events and logs. Discovery problems show up in Service selectors and EndpointSlices.

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

Monitoring should connect Kubernetes and application signals. Kubernetes metrics can show Pod restarts, PVC usage, scheduling problems, and volume attachment issues. Database metrics can show replication lag, connection saturation, slow queries, checkpoint behavior, and backup age. The best incident dashboard for `notification-postgres` should show both layers because a green Pod can still contain an unhealthy database.

## When a Deployment Fits Better
<!-- section-summary: Stateless APIs and workers should usually stay on Deployments while they depend on a database or cache. -->

A **stateless Pod** can disappear without losing unique local state. It may still read and write important data, and that data lives in another system such as PostgreSQL, Redis, object storage, or a message broker. The Pod itself keeps no disk identity that needs to follow it after rescheduling.

That is the normal shape for `notification-api`. The API connects to `notification-postgres`, handles HTTP requests, writes rows, and returns responses. If an API Pod restarts, Kubernetes can create a new Pod with a new name because the API has no need for a stable ordinal or a private disk. A Deployment gives faster rolling updates, simpler scaling, and load-balanced Services that match this shape.

`notification-worker` also fits a Deployment when it reads from a queue and acknowledges messages after processing. Queue semantics, deduplication keys, and retry handling give the worker its business safety. The Pod name does not need to stay stable.

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

Before a StatefulSet change, the team should know the current controller revision, current Pods, current PVCs, recent backup status, and restore confidence. A small pre-change snapshot gives everyone the same starting point. It also gives incident responders a quick comparison if the rollout pauses.

```bash
$ kubectl rollout history statefulset/notification-postgres -n notifications
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-postgres -o wide
$ kubectl get pvc -n notifications -l app.kubernetes.io/name=notification-postgres
$ kubectl get pdb -n notifications notification-postgres
```

During a manifest change, the watch should focus on ordinals and readiness. The highest ordinal usually updates first during a rolling update. A lower ordinal may wait because the controller wants ordered progress.

```bash
$ kubectl apply -f notification-postgres.yaml
$ kubectl rollout status statefulset/notification-postgres -n notifications
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-postgres --watch
```

For a pending Pod, storage comes first. The PVC status, claim events, StorageClass, namespace quota, and cluster provisioner logs usually explain the problem faster than container logs. Container logs help after Kubernetes mounts the volume and starts the process.

```bash
$ kubectl get pvc -n notifications -l app.kubernetes.io/name=notification-postgres
$ kubectl describe pvc -n notifications data-notification-postgres-0
$ kubectl get storageclass
$ kubectl describe quota -n notifications
```

For a DNS problem, the Service selector and EndpointSlices come first. The Pod may run and the database may accept local connections, while clients still fail because the headless Service has no matching endpoints. A DNS test from the caller's namespace confirms the path the application really uses.

```bash
$ kubectl get service -n notifications notification-postgres -o yaml
$ kubectl get endpointslices -n notifications \
  -l kubernetes.io/service-name=notification-postgres
$ kubectl exec -n notifications deploy/notification-api -- \
  getent hosts notification-postgres-0.notification-postgres.notifications.svc.cluster.local
```

For a data-bearing Pod, forced deletion should sit at the end of the decision tree. A force delete can help after a node failure leaves a Pod stuck, and it can also create split-brain risk for stateful systems that still have a process running somewhere. Confirm node state, volume attachment state, database membership, and backup position before using force.

```bash
$ kubectl get pod -n notifications notification-postgres-0 -o wide
$ kubectl describe pod -n notifications notification-postgres-0
$ kubectl get volumeattachment
```

For cleanup, PVC deletion should require an explicit data decision. Deleting a StatefulSet normally leaves the PVCs behind by default. Deleting the PVCs may release or delete the backing storage depending on the PV reclaim policy and storage provider.

```bash
$ kubectl delete statefulset -n notifications notification-postgres
$ kubectl get pvc -n notifications -l app.kubernetes.io/name=notification-postgres
$ kubectl get pv pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20 \
  -o jsonpath='{.spec.persistentVolumeReclaimPolicy}{"\n"}'
```

Treat the StatefulSet, the headless Service, the PVCs, the StorageClass, and the application data plan as one system. Kubernetes gives you stable building blocks. Production safety comes from the runbooks and recovery tests around those blocks.

![StatefulSet operations runbook infographic showing backups, PVCs, DNS, Pod health, rollout order, and force delete last as the safe operations sequence](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-operations-runbook.png)

_This infographic summarizes the StatefulSet operating order: verify recovery first, inspect identity and storage, then handle rollout or deletion only after the data path is clear._

**References**

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
