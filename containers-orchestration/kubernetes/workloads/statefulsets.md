---
title: "StatefulSets"
description: "Run Kubernetes workloads that need stable identity, ordered rollout, and persistent storage."
overview: "StatefulSets are for Pods that carry durable identity. This article shows when `devpolaris-orders-api` should stay on a Deployment and when supporting services need stable names and volumes."
tags: ["statefulsets", "storage", "pods", "identity"]
order: 4
id: article-containers-orchestration-kubernetes-workloads-statefulsets
---

## Table of Contents

1. [The Shape of a Stateful Workload](#the-shape-of-a-stateful-workload)
2. [Stable Pod Identity](#stable-pod-identity)
3. [Headless Services and Pod DNS](#headless-services-and-pod-dns)
4. [Persistent Storage with PVC Templates](#persistent-storage-with-pvc-templates)
5. [A Small Orders PostgreSQL StatefulSet](#a-small-orders-postgresql-statefulset)
6. [Startup, Scaling, and Updates](#startup-scaling-and-updates)
7. [Debugging StatefulSets in the Terminal](#debugging-statefulsets-in-the-terminal)
8. [Production Guidance for Stateful Services](#production-guidance-for-stateful-services)
9. [When a Deployment Fits Better](#when-a-deployment-fits-better)
10. [Operational Runbook](#operational-runbook)
11. [References](#references)

We are going to build this around one application: `devpolaris-orders-api`. The API receives order requests, validates them, writes order records, and returns responses to callers. The API Pods can run behind a normal Service because each replica can handle the next request as long as it can reach the same database.

The supporting database has a different shape. In a learning or staging cluster, we might run a small PostgreSQL service called `orders-postgres` so the orders team can test schema migrations and connection behavior inside Kubernetes. That database Pod needs the same name after a restart, the same disk after rescheduling, and careful update behavior because the data matters. Those needs lead us into **StatefulSets**, **ordinal Pod names**, **headless Services**, **PersistentVolumeClaims**, and the day-two runbooks that keep stateful workloads safe.

## The Shape of a Stateful Workload
<!-- section-summary: StatefulSets exist for Pods that need durable identity, predictable names, and storage that stays tied to a specific replica. -->

A **StatefulSet** is a Kubernetes controller for applications where each Pod has its own durable identity. It still uses a Pod template, so the Pods come from the same specification, and the StatefulSet controller still reconciles the desired number of replicas. The important difference is that Kubernetes gives each replica a stable ordinal name such as `orders-postgres-0`, `orders-postgres-1`, and `orders-postgres-2`.

A **stateful workload** keeps important data, membership, or identity inside a specific replica. A database member may own a local data directory. A Redis cluster member may own a hash slot range. A search node may own a shard copy. A message broker may keep a log segment on disk. In those systems, replacing `pod-a8x9q` with `pod-z4m1p` can confuse both the application and the humans trying to repair it.

For `devpolaris-orders-api`, the API layer should stay replaceable. If one API Pod disappears, another API Pod can read and write the same order records in PostgreSQL. For `orders-postgres`, the Pod itself has a stronger connection to local data. The Pod name, DNS name, and disk all need to travel together through restarts.

Here is the first split to keep in your head as we move through the article:

| Workload | Usual controller | Why |
|---|---|---|
| `devpolaris-orders-api` | Deployment | Every API replica can serve the same kind of request through the same Service. |
| `orders-worker` that only reads from a queue and writes to PostgreSQL | Deployment | A worker can disappear and a new worker can pick up the next message. |
| `orders-postgres` with local database files | StatefulSet | The database member needs a stable name and a stable volume. |
| `orders-redis` in a clustered setup | StatefulSet or operator-managed custom resource | Each member may need stable peer identity and persistent data. |

This table also shows why StatefulSets deserve a little caution. A StatefulSet gives the cluster stronger promises around identity and storage, and those promises add operational responsibility. Once a Pod owns a disk, rollout, backup, restore, and cleanup decisions carry far more weight than they carry for stateless API replicas.

The first promise is identity, so let us start with the Pod names.

## Stable Pod Identity
<!-- section-summary: StatefulSet Pods receive ordinal names that survive restarts, rescheduling, and normal controller reconciliation. -->

An **ordinal** is the number Kubernetes adds to each StatefulSet Pod name. For a StatefulSet named `orders-postgres`, the first Pod is `orders-postgres-0`, the second Pod is `orders-postgres-1`, and the third Pod is `orders-postgres-2`. Kubernetes uses this pattern every time it recreates the Pod, so the identity stays predictable.

That stable identity shows up in several places. The Pod name includes the ordinal. Kubernetes adds labels that identify the owning StatefulSet and, in current Kubernetes versions, the Pod index. A volume claim created from a StatefulSet template also includes the ordinal, so the storage object and the Pod identity line up.

![StatefulSet identity map infographic showing the orders-postgres StatefulSet connecting orders-postgres-0 and orders-postgres-1 to matching DNS identities and PVC data volumes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-identity-map.png)

_This infographic replaces the identity diagram with a generated map of the StatefulSet contract: each ordinal Pod keeps a matching DNS identity and PVC identity._

Think about a database failover page in the middle of the night. A runbook that says "check `orders-postgres-0` first" works because that name keeps meaning the same member identity. A graph that shows disk pressure on `data-orders-postgres-0` also points back to the matching Pod. The name gives operators a stable handle during a stressful incident.

The identity also helps applications that keep peer lists. A clustered service can say "member 0 is reachable at this DNS name, member 1 is reachable at that DNS name." Kubernetes still may move the Pod to another node and give it a different IP address, and the Pod identity remains the same.

Names help humans and controllers, and the next piece helps network clients. A StatefulSet normally uses a **headless Service** so each Pod receives a predictable DNS name.

## Headless Services and Pod DNS
<!-- section-summary: A headless Service lets clients discover individual StatefulSet Pods instead of sending every request through one load-balanced virtual IP. -->

A **Service** gives a stable network entry point for a group of Pods. A normal ClusterIP Service gives clients one virtual IP and load-balances traffic to matching Pods. That works beautifully for `devpolaris-orders-api`, because a caller usually wants any healthy API replica.

A **headless Service** is a Service with `clusterIP: None`. Kubernetes still creates DNS records for it, and those records point clients toward the individual Pods behind the Service. StatefulSets use this pattern because some clients need to reach a specific member, such as `orders-postgres-0.orders-postgres.default.svc.cluster.local`.

Here is the headless Service for the `orders-postgres` example:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-postgres
  labels:
    app.kubernetes.io/name: orders-postgres
spec:
  clusterIP: None
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
  selector:
    app.kubernetes.io/name: orders-postgres
```

The `selector` connects the Service to Pods with the same label. The `clusterIP: None` line tells Kubernetes to create a headless Service, so the cluster DNS can return records for the selected Pods instead of one virtual Service IP. The StatefulSet will later set `serviceName: orders-postgres`, and that field tells Kubernetes which headless Service owns the Pod DNS names.

Inside the cluster, the stable Pod DNS name follows this shape:

```bash
orders-postgres-0.orders-postgres.default.svc.cluster.local
```

That name breaks down into the Pod name, the headless Service name, the namespace, and the cluster DNS suffix. From a running Pod, DNS verification usually starts with `getent hosts` or `nslookup` because those tools exercise the same resolver path that application code uses.

```bash
kubectl exec deploy/devpolaris-orders-api -- getent hosts orders-postgres-0.orders-postgres.default.svc.cluster.local
10.42.2.18  orders-postgres-0.orders-postgres.default.svc.cluster.local

kubectl get endpointslices -l kubernetes.io/service-name=orders-postgres
NAME                    ADDRESSTYPE   PORTS   ENDPOINTS
orders-postgres-7xk2p   IPv4          5432    10.42.2.18
```

DNS checks matter because a broken selector can look like an application problem. If the Service selects `app: postgres` and the Pod uses `app.kubernetes.io/name: orders-postgres`, the Service will have no endpoints. The database may run perfectly, yet clients will fail because discovery has no Pod to return.

Stable DNS answers the "where is this member?" question. A stateful service still needs a safe answer to "where is this member's data?" That takes us to PersistentVolumeClaims.

## Persistent Storage with PVC Templates
<!-- section-summary: StatefulSets use volumeClaimTemplates to create one PersistentVolumeClaim per Pod identity, so storage follows the ordinal. -->

A **PersistentVolume**, usually shortened to **PV**, represents durable storage in the cluster. It might map to a cloud block disk, a local disk, a network file system, or another storage backend exposed through a CSI driver. Kubernetes treats the PV as the cluster object that points to the real storage asset.

A **PersistentVolumeClaim**, usually shortened to **PVC**, is a request for storage. A PVC asks for a size, access mode, and optional **StorageClass**. A StorageClass describes a class of storage that the cluster can provision, such as `fast-ssd`, `standard-retain`, or `encrypted-regional`. The exact meaning depends on the cluster administrators and the storage provider.

StatefulSets add one very useful mechanism: **volumeClaimTemplates**. A volume claim template says, "create a PVC like this for each Pod ordinal." With a template named `data`, Kubernetes creates claims named `data-orders-postgres-0`, `data-orders-postgres-1`, and so on. When `orders-postgres-0` restarts, Kubernetes mounts the same claim for that same ordinal.

The storage part of a StatefulSet often looks like this:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
      labels:
        app.kubernetes.io/name: orders-postgres
    spec:
      accessModes:
        - ReadWriteOncePod
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 20Gi
```

The `name: data` field contributes to the claim name. The `storageClassName: fast-ssd` field asks the cluster for that class of storage. The `ReadWriteOncePod` access mode asks Kubernetes to mount the claim for read-write use by a single Pod across the whole cluster. Many clusters also support `ReadWriteOnce`, which allows read-write mounting by a single node, and the exact choice should match the storage driver and workload.

The PVC view belongs in your normal inspection flow:

```bash
kubectl get pvc -l app.kubernetes.io/name=orders-postgres
NAME                     STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS
data-orders-postgres-0   Bound    pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20   20Gi       RWOP           fast-ssd

kubectl describe pvc data-orders-postgres-0
Name:          data-orders-postgres-0
StorageClass:  fast-ssd
Status:        Bound
Volume:        pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20
```

A `Bound` claim means Kubernetes found or provisioned a matching PV. A `Pending` claim means the storage request has no matching volume yet. For StatefulSets, a pending claim often stops the Pod before the database process even starts, so storage inspection should come before image debugging.

There is one more storage detail that changes production behavior: the reclaim policy. A dynamically created PV usually follows the reclaim policy on its StorageClass. With `Delete`, deleting the PVC can also delete the backing disk. With `Retain`, deleting the PVC leaves the underlying storage asset for manual cleanup or recovery. Stateful service runbooks should name the reclaim policy because it controls what a cleanup command can destroy.

Now we have the three core pieces: Pod identity, DNS identity, and storage identity. The next section puts them together into a small `orders-postgres` StatefulSet that supports the orders API in a Kubernetes environment.

![Stable DNS and storage contract infographic showing a headless Service with clusterIP None, Pod DNS, volumeClaimTemplate, PVC, StorageClass, and PV binding](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/stable-dns-storage-contract.png)

_This infographic connects the network and storage halves of the StatefulSet design, so the headless Service answers where a member lives and the PVC path answers where its data lives._

## A Small Orders PostgreSQL StatefulSet
<!-- section-summary: A working StatefulSet combines a headless Service, serviceName, a Pod template, probes, and volumeClaimTemplates. -->

This example uses PostgreSQL because it makes the StatefulSet mechanics easy to see. The `devpolaris-orders-api` Deployment connects to `orders-postgres` through the cluster network, and the database stores its data under a mounted volume. A real production PostgreSQL platform needs backup automation, replication, failover planning, monitoring, and upgrade discipline, which we will cover after the manifest.

The Secret below supplies the database username and password. In a real cluster, teams usually create this through a secret manager integration, sealed secret workflow, external secret controller, or platform pipeline. The important point for this article is that the password should live outside the StatefulSet manifest.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-postgres-auth
type: Opaque
stringData:
  username: orders_app
  password: replace-this-in-your-secret-system
```

Here is the headless Service and StatefulSet together:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-postgres
  labels:
    app.kubernetes.io/name: orders-postgres
    app.kubernetes.io/part-of: devpolaris-orders
spec:
  clusterIP: None
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
  selector:
    app.kubernetes.io/name: orders-postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: orders-postgres
  labels:
    app.kubernetes.io/name: orders-postgres
    app.kubernetes.io/part-of: devpolaris-orders
spec:
  serviceName: orders-postgres
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: orders-postgres
        app.kubernetes.io/part-of: devpolaris-orders
    spec:
      terminationGracePeriodSeconds: 60
      securityContext:
        fsGroup: 999
      containers:
        - name: postgres
          image: postgres:16.3
          ports:
            - name: postgres
              containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: orders
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: orders-postgres-auth
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: orders-postgres-auth
                  key: password
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command:
                - sh
                - -c
                - pg_isready -U "$POSTGRES_USER" -d orders
            initialDelaySeconds: 10
            periodSeconds: 10
          startupProbe:
            exec:
              command:
                - sh
                - -c
                - pg_isready -U "$POSTGRES_USER" -d orders
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 1Gi
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
        labels:
          app.kubernetes.io/name: orders-postgres
      spec:
        accessModes:
          - ReadWriteOncePod
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi
```

There are a few lines worth slowing down for. The `serviceName: orders-postgres` field connects the StatefulSet to the headless Service. The `selector.matchLabels` must match the Pod template labels and the Service selector. The `volumeMounts` entry named `data` must match the `volumeClaimTemplates` entry named `data`, because Kubernetes creates the PVC and mounts it into the container from that shared name.

The probes matter too. A readiness probe keeps the Pod out of Service endpoints until PostgreSQL can answer health checks. A startup probe gives the database time to initialize a new data directory or recover after a restart before Kubernetes judges the container as unhealthy. Stateful workloads often need that startup patience because data recovery can take longer than a stateless HTTP server boot.

After applying the manifest, the useful first view includes the controller, Pod, Service, and claim together:

```bash
kubectl apply -f orders-postgres.yaml
secret/orders-postgres-auth created
service/orders-postgres created
statefulset.apps/orders-postgres created

kubectl rollout status statefulset/orders-postgres
statefulset rolling update complete 1 pods at revision orders-postgres-6f4f957f7b...

kubectl get statefulset,pod,svc,pvc -l app.kubernetes.io/name=orders-postgres
NAME                               READY   AGE
statefulset.apps/orders-postgres   1/1     2m

NAME                    READY   STATUS    RESTARTS   AGE
pod/orders-postgres-0   1/1     Running   0          2m

NAME                      TYPE        CLUSTER-IP   PORT(S)    AGE
service/orders-postgres   ClusterIP   None         5432/TCP   2m

NAME                                           STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS
persistentvolumeclaim/data-orders-postgres-0   Bound    pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20   20Gi       RWOP           fast-ssd
```

That view shows the full StatefulSet contract: one named controller, one named Pod, one headless Service, and one matching claim. If the Pod moves to another node tomorrow, the Pod name remains `orders-postgres-0`, the DNS name remains tied to that identity, and the data claim remains `data-orders-postgres-0`.

The next operational question is what Kubernetes does during scale and update. StatefulSets deliberately use ordered behavior by default, and that order affects rollout speed, failure handling, and rollback planning.

## Startup, Scaling, and Updates
<!-- section-summary: StatefulSets default to ordered creation, ordered termination, and ordered rolling updates because many stateful systems need careful sequencing. -->

The default StatefulSet Pod management policy is **OrderedReady**. For a StatefulSet with three replicas, Kubernetes creates `orders-postgres-0`, waits until it is Running and Ready, then creates `orders-postgres-1`, and then creates `orders-postgres-2`. During scale-down, Kubernetes removes the highest ordinal first.

This ordering protects systems that need a seed member, primary member, or stable startup sequence. PostgreSQL itself still needs application-level replication configuration if you run more than one member. Kubernetes can create the Pods in a safe order, and PostgreSQL or a PostgreSQL operator must still configure replication, promotion, and failover.

The ordered behavior also affects updates. The default rolling update works from the highest ordinal down toward zero. If `orders-postgres-2` fails readiness after an image change, Kubernetes pauses there and leaves lower ordinals alone. That pause gives operators time to inspect the newest member before the rollout reaches the earlier identities.

For a small service, rollout status and history usually give the first signal:

```bash
kubectl rollout status statefulset/orders-postgres
Waiting for 1 pods to be ready...

kubectl rollout history statefulset/orders-postgres
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

StatefulSets support `podManagementPolicy: Parallel` for workloads that can start or stop all replicas at the same time. That setting only affects scale operations, and the workload must tolerate the behavior. A clustered cache that discovers peers dynamically may handle parallel starts. A database cluster with a strict bootstrap order usually needs more care.

StatefulSets also support `updateStrategy`. The common strategy is `RollingUpdate`, where Kubernetes updates Pods in ordinal order. `OnDelete` tells Kubernetes to wait until a human or automation deletes each Pod before it recreates that Pod from the new template. Some teams use `OnDelete` for databases because they want a human-controlled maintenance window for each member.

A partitioned rolling update gives you another useful tool. If a StatefulSet has three replicas and you set the partition to `2`, Kubernetes updates only ordinals `2` and above. That lets a team test a new database image or sidecar on one higher ordinal while keeping lower ordinals on the previous revision.

```bash
kubectl patch statefulset orders-postgres --type merge -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"partition":2}}}}'
statefulset.apps/orders-postgres patched

kubectl set image statefulset/orders-postgres postgres=postgres:16.4
statefulset.apps/orders-postgres image updated
```

The risky part of StatefulSet updates is data compatibility. An image can change on disk format, migrate files, or start writing metadata that an older version lacks support for. For `orders-postgres`, that means an image change should sit next to a database upgrade plan, backup checkpoint, restore test, and rollback decision. Kubernetes can roll a Pod template backward, and application data changes still need an application-specific recovery plan.

The update path gives us the controller behavior. The next section gives the terminal workflow for the moments where something sticks: a pending PVC, a Pod that never reaches Ready, broken DNS, or an update that waits on one ordinal.

## Debugging StatefulSets in the Terminal
<!-- section-summary: StatefulSet debugging starts by separating storage, DNS, Pod health, and rollout order instead of treating every failure as a container crash. -->

StatefulSet debugging works best as four small investigations. First, check the controller and current Pod order. Second, check storage because PVCs can block the Pod before the container starts. Third, check DNS because the headless Service controls how peers and clients find members. Fourth, check logs and events for the exact ordinal that currently blocks progress.

The broad view should include Pods, claims, and recent events:

```bash
kubectl get statefulset orders-postgres
kubectl get pods -l app.kubernetes.io/name=orders-postgres -o wide
kubectl get pvc -l app.kubernetes.io/name=orders-postgres
kubectl get events --sort-by=.lastTimestamp
```

### Pending PVCs

A pending PVC tells you Kubernetes has no matching storage for the request yet. The cause may be a missing StorageClass, a dynamic provisioner issue, a quota, an unsupported access mode, a topology constraint, or a storage system outage. The application container usually has no logs in this state because the data volume mount has not happened yet.

The claim description usually gives the clearest event:

```bash
kubectl get pvc data-orders-postgres-0
NAME                     STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS
data-orders-postgres-0   Pending                                      fast-ssd

kubectl describe pvc data-orders-postgres-0
Events:
  Type     Reason              Message
  Warning  ProvisioningFailed  storageclass.storage.k8s.io "fast-ssd" not found
```

That message points at the storage class name, so the next check stays in storage:

```bash
kubectl get storageclass
kubectl get storageclass fast-ssd -o yaml
kubectl describe quota
```

The fix should match the event. A typo in `storageClassName` calls for a manifest correction before data exists. A missing default StorageClass calls for platform work. A quota failure calls for a namespace quota change or a smaller requested size. A topology issue may require the StorageClass to use `WaitForFirstConsumer` so Kubernetes chooses storage after it picks a node.

### Stuck or Crashing Pods

Once the PVC is bound, Pod debugging starts with the specific ordinal. StatefulSet failures often concentrate on one member, and the controller waits around that member because the order matters. The Pod description shows scheduling, mount, probe, and container events in one place.

```bash
kubectl describe pod orders-postgres-0
kubectl logs orders-postgres-0 -c postgres --tail=100
kubectl logs orders-postgres-0 -c postgres --previous --tail=100
```

The `--previous` log matters after a crash loop because the current container may have just restarted. If the logs mention data directory permissions, check the mounted directory and the Pod security context. If the logs mention WAL recovery, disk corruption, or version incompatibility, treat the incident as a database incident rather than a Kubernetes-only incident.

Inside the Pod, a quick storage check can confirm that the expected PVC backs the expected path:

```bash
kubectl exec orders-postgres-0 -- df -h /var/lib/postgresql/data
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme1n1     20G  2.1G   18G  11% /var/lib/postgresql/data

kubectl exec orders-postgres-0 -- hostname
orders-postgres-0
```

Those two commands connect the data path and the stable identity. If the data directory is empty after a restart, the investigation should check whether the StatefulSet used the same `volumeClaimTemplates` name, whether someone deleted the PVC, and whether the reclaim policy removed the backing disk.

### DNS and Service Discovery

DNS debugging starts with the Service object because the headless Service controls the records. The Service selector must match the Pod labels, and EndpointSlices should show the Pod IPs behind the Service. A healthy Pod with mismatched labels will never appear as a Service endpoint.

```bash
kubectl get service orders-postgres -o yaml
kubectl get pod orders-postgres-0 --show-labels
kubectl get endpointslices -l kubernetes.io/service-name=orders-postgres -o wide
```

The application-side DNS test should run from a Pod in the same network path as the caller. For the orders API, that means testing from `devpolaris-orders-api` or from a temporary debug Pod in the same namespace.

```bash
kubectl exec deploy/devpolaris-orders-api -- getent hosts orders-postgres.default.svc.cluster.local
kubectl exec deploy/devpolaris-orders-api -- getent hosts orders-postgres-0.orders-postgres.default.svc.cluster.local
```

If the Service DNS name resolves and the specific Pod DNS name fails, focus on StatefulSet `serviceName`, the headless Service name, and Pod readiness. If both fail, check cluster DNS, namespace spelling, and NetworkPolicy. DNS failures often look like database connection failures in the application logs, so keeping these checks nearby saves time.

### Update Issues

An update that waits usually waits for one ordinal to reach Ready. The rollout status tells you the controller has paused, and the Pod list tells you which member blocks progress. From there, the same Pod and log checks apply, with extra attention on the image, probe, migration, and data compatibility.

```bash
kubectl rollout status statefulset/orders-postgres
kubectl get pods -l app.kubernetes.io/name=orders-postgres
kubectl describe pod orders-postgres-0
kubectl logs orders-postgres-0 -c postgres --tail=100
```

A template rollback can restore the previous Pod spec:

```bash
kubectl rollout undo statefulset/orders-postgres
statefulset.apps/orders-postgres rolled back
```

That command changes the StatefulSet template back to an earlier revision. It leaves application data untouched, including data that the newer version already changed. For a database, rollback work should start from the backup and restore plan, the database release notes, and the exact logs from the failing ordinal.

Now we have enough hands-on debugging to operate the object itself. The next layer is production guidance, because StatefulSets alone provide only part of a full database platform.

## Production Guidance for Stateful Services
<!-- section-summary: Production stateful workloads need operators, backups, disruption controls, storage choices, and restore practice around the StatefulSet object. -->

A StatefulSet gives Kubernetes-level identity and storage behavior. A database platform needs more than that. Real teams also need replication, failover, backup scheduling, restore testing, monitoring, connection management, and upgrade automation. For production PostgreSQL, many teams use a managed database service outside the cluster or a PostgreSQL operator inside the cluster because those tools understand PostgreSQL itself.

An **operator** is a Kubernetes controller that knows how to run a specific application. A PostgreSQL operator can create StatefulSets, Services, Secrets, backup jobs, replication settings, failover logic, and monitoring objects from a higher-level database custom resource. The StatefulSet still exists under the hood, while the operator owns the database-specific decisions that a raw StatefulSet lacks.

Backup planning deserves its own attention. A PVC keeps data attached to a Pod identity, and that is durability at the Kubernetes scheduling layer. A backup is a separate recoverable copy with a retention policy, a restore process, and a tested path back to service. For PostgreSQL, teams usually combine logical backups, physical base backups, write-ahead log archiving for point-in-time recovery, or CSI snapshots where the storage platform supports them.

For a small staging database, a logical backup might look like this:

```bash
kubectl exec orders-postgres-0 -- pg_dump -U orders_app -d orders -Fc > orders-staging.dump
```

A restore test should run in a separate environment or namespace so it proves the backup without risking the live database. The exact command depends on the backup format and database role setup, and the flow should create a new database target, load the backup, run application smoke tests, and record how long the restore took.

```bash
kubectl cp orders-staging.dump orders-postgres-0:/tmp/orders-staging.dump
kubectl exec orders-postgres-0 -- createdb -U orders_app orders_restore_check
kubectl exec orders-postgres-0 -- pg_restore -U orders_app -d orders_restore_check /tmp/orders-staging.dump
```

Pod disruption planning also matters. A **PodDisruptionBudget**, or **PDB**, tells Kubernetes how many matching Pods can be voluntarily disrupted during operations such as node drains. For a single database Pod, `maxUnavailable: 0` can prevent voluntary eviction and protect availability, while also blocking some maintenance until the team makes an explicit plan. For a replicated stateful service, the PDB should match the real failover and quorum rules.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: orders-postgres
spec:
  maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-postgres
```

StorageClass choice should show up in design review too. A production class may need encrypted disks, the right availability-zone behavior, volume expansion, `Retain` reclaim policy, backup integration, and `WaitForFirstConsumer` volume binding. The cluster admin owns the StorageClass definition, and the application team owns the request that chooses it.

```bash
kubectl get storageclass fast-ssd -o yaml
```

The StatefulSet's PVC retention policy adds another cleanup control. By default, PVCs created from `volumeClaimTemplates` remain after scale-down or StatefulSet deletion. Current Kubernetes also supports `.spec.persistentVolumeClaimRetentionPolicy`, where teams can choose `Retain` or `Delete` behavior for scale-down and deletion. For production data, `Retain` keeps destructive cleanup deliberate; for short-lived preview environments, `Delete` may fit if the data has no long-term value.

Monitoring should connect Kubernetes and application signals. Kubernetes metrics can show Pod restarts, PVC usage, scheduling problems, and volume attachment issues. Database metrics can show replication lag, connection saturation, slow queries, checkpoint behavior, and backup age. The best incident dashboard for `orders-postgres` should show both layers because a green Pod can still contain an unhealthy database.

This production layer brings us back to the original API. Many workloads talk to stateful systems, and that relationship differs from owning stateful identity inside the Pod.

## When a Deployment Fits Better
<!-- section-summary: Stateless APIs and workers should usually stay on Deployments while they depend on a database or cache. -->

A **stateless Pod** can disappear without losing unique local state. It may still read and write important data, and that data lives in another system such as PostgreSQL, Redis, S3-compatible object storage, or a message broker. The Pod itself keeps no disk identity that needs to follow it after rescheduling.

That is the normal shape for `devpolaris-orders-api`. The API connects to `orders-postgres`, handles HTTP requests, writes rows, and returns responses. If an API Pod restarts, Kubernetes can create a new Pod with a new name because the API has no need for a stable ordinal or a private disk. A Deployment gives faster rolling updates, simpler scaling, and load-balanced Services that match this shape.

A design review can use this table:

| Question | Deployment answer | StatefulSet answer |
|---|---|---|
| What happens if the Pod name changes? | Nothing important changes for the workload. | Peers, operators, or storage mapping rely on that identity. |
| Where does durable data live? | In an external database, cache, queue, or object store. | In a volume attached to a specific Pod identity. |
| How should clients connect? | Any healthy replica behind a Service can respond. | Some clients need a specific member DNS name. |
| How should scaling behave? | Replicas can come and go freely. | Replicas may need ordered startup, shutdown, or membership changes. |
| What does rollback involve? | Usually a Pod template or image rollback. | Often a Pod template rollback plus data compatibility review. |

This distinction keeps Kubernetes designs clean. The orders API can stay simple, highly replaceable, and easy to roll out. The supporting database or clustered cache can receive the stronger identity and storage behavior only where the system actually needs it.

The last section turns everything into a runbook. It is the checklist you want during a normal change, a storage problem, or a stuck StatefulSet rollout.

## Operational Runbook
<!-- section-summary: StatefulSet operations should check backups, storage, DNS, Pod health, and rollout order before making destructive changes. -->

Before a StatefulSet change, the team should know the current controller revision, current Pods, current PVCs, recent backup status, and restore confidence. A small pre-change snapshot gives everyone the same starting point. It also gives incident responders a quick comparison if the rollout pauses.

```bash
kubectl rollout history statefulset/orders-postgres
kubectl get pods -l app.kubernetes.io/name=orders-postgres -o wide
kubectl get pvc -l app.kubernetes.io/name=orders-postgres
kubectl get pdb orders-postgres
```

During a manifest change, the watch should focus on ordinals and readiness. The highest ordinal usually updates first during a rolling update. A lower ordinal may wait because the controller wants ordered progress, so the waiting Pod may simply be obeying the StatefulSet rules.

```bash
kubectl apply -f orders-postgres.yaml
kubectl rollout status statefulset/orders-postgres
kubectl get pods -l app.kubernetes.io/name=orders-postgres --watch
```

For a pending Pod, storage comes first. The PVC status, claim events, StorageClass, namespace quota, and cluster provisioner logs usually explain the problem faster than container logs. Container logs start helping after Kubernetes mounts the volume and starts the process.

```bash
kubectl get pvc -l app.kubernetes.io/name=orders-postgres
kubectl describe pvc data-orders-postgres-0
kubectl get storageclass
kubectl describe quota
```

For a DNS problem, the Service selector and EndpointSlices come first. The Pod may run and the database may accept local connections, while clients still fail because the headless Service has no matching endpoints. A DNS test from the caller's namespace confirms the path that the application really uses.

```bash
kubectl get service orders-postgres -o yaml
kubectl get endpointslices -l kubernetes.io/service-name=orders-postgres
kubectl exec deploy/devpolaris-orders-api -- getent hosts orders-postgres-0.orders-postgres.default.svc.cluster.local
```

For a data-bearing Pod, forced deletion should sit at the end of the decision tree. A force delete can help after a node failure leaves a Pod stuck, and it can also create split-brain risk for stateful systems that still have a process running somewhere. The safer path is to confirm node state, volume attachment state, database membership, and backup position before using force.

```bash
kubectl get pod orders-postgres-0 -o wide
kubectl describe pod orders-postgres-0
kubectl get volumeattachment
```

For cleanup, PVC deletion should require an explicit data decision. Deleting a StatefulSet normally leaves the PVCs behind by default. Deleting the PVCs may release or delete the backing storage depending on the PV reclaim policy and storage provider.

```bash
kubectl delete statefulset orders-postgres
kubectl get pvc -l app.kubernetes.io/name=orders-postgres
kubectl get pv pvc-28cc0f84-1d33-4e12-8f58-4f1e66d10a20 -o jsonpath='{.spec.persistentVolumeReclaimPolicy}{"\n"}'
```

The core habit is simple and very practical: treat the StatefulSet, the headless Service, the PVCs, the StorageClass, and the application data plan as one system. Kubernetes gives you stable building blocks. Production safety comes from the runbooks and recovery tests around those blocks.

![StatefulSet operations runbook infographic showing backups, PVCs, DNS, Pod health, rollout order, and force delete last as the safe operations sequence](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-statefulsets/statefulset-operations-runbook.png)

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
