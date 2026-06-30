---
title: "Backup and Restore Basics"
description: "Understand the Kubernetes backup and restore surfaces that matter for configuration, secrets, volumes, and cluster state."
overview: "Backup and restore in Kubernetes means knowing which state lives in the API server, which state lives in volumes or external systems, and how to prove recovery before an incident."
tags: ["kubernetes", "backup", "restore", "etcd"]
order: 7
id: article-containers-orchestration-kubernetes-configuration-storage-backup-and-restore-basics
---
## Table of Contents

1. [Recovery Starts with a State Inventory](#recovery-starts-with-a-state-inventory)
2. [Kubernetes API Objects and etcd](#kubernetes-api-objects-and-etcd)
3. [Manifests and GitOps Recovery](#manifests-and-gitops-recovery)
4. [Secrets and Encryption Concerns](#secrets-and-encryption-concerns)
5. [PVC Snapshots and Restore](#pvc-snapshots-and-restore)
6. [External Databases and Object Stores](#external-databases-and-object-stores)
7. [Velero and Cluster Backup Tools](#velero-and-cluster-backup-tools)
8. [Restore Drill Runbook](#restore-drill-runbook)
9. [RPO and RTO for the Notification Platform](#rpo-and-rto-for-the-notification-platform)
10. [Failure Patterns to Catch Early](#failure-patterns-to-catch-early)
11. [Assembled Recovery Plan](#assembled-recovery-plan)
12. [Review Checklist](#review-checklist)
13. [References](#references)

## Recovery Starts with a State Inventory
<!-- section-summary: A Kubernetes recovery plan starts by naming every part of the app that must come back after a failure. -->

ConfigMaps, Secrets, environment variables, mounted files, PVCs, and StorageClasses all describe pieces of application state or storage. Backup and restore pulls those pieces into one practical question: after a bad deploy, a deleted namespace, a failed disk, or a lost cluster, what exactly has to come back?

A **backup** is a recoverable copy of data or configuration. A **restore** is the tested path that turns that copy into a working system again. The backup command is only one part of the work. Production recovery also needs ownership, access to sensitive values, proof that restored data is usable, and a safe way to reconnect traffic.

For the Customer Notification Platform, recovery has to cover more than Kubernetes YAML. The platform has Deployments, Services, ConfigMaps, Secrets, PVC-backed data, database records, uploaded files, queued messages, provider configuration, and DNS or ingress routing. A useful recovery plan separates those pieces before choosing etcd snapshots, GitOps recovery, PVC snapshots, Velero, and restore drills.

The first recovery artifact is a state inventory. It tells the team which pieces need a copy and where that copy would come from during an incident.

A namespace backup can help with Kubernetes API objects, but it may leave out managed databases, object storage, or broker data. That is why the first design step is a state inventory. The inventory names each stateful part before the article introduces tools such as etcd snapshots, GitOps recovery, volume snapshots, and Velero.

For the Customer Notification Platform, the inventory might look like this:

| State | Where it lives | Recovery source |
|---|---|---|
| Deployments, Services, ConfigMaps | Kubernetes API server | GitOps repository or cluster backup |
| Secrets | Kubernetes API server or external secret manager | External secret store, encrypted manifest, or cluster backup |
| `notification-postgres` data | PVC or managed database | Volume snapshot or database backup |
| Notification attachments | Object storage | Bucket versioning and object backup policy |
| Queued messages | Managed broker | Broker retention, export, or provider backup |

This table keeps the conversation grounded. A cluster backup can restore Kubernetes objects, but it may not restore a managed database, an object storage bucket, or messages held by an external broker. Each state location needs its own recovery path.

Another way to review the plan is by recovery lane:

| Recovery lane | What it restores | Common tool or source | Beginner check |
|---|---|---|---|
| API object lane | Deployments, Services, ConfigMaps, RBAC, PVC objects | GitOps, manifests, Velero, etcd snapshot | Can a fresh namespace recreate the objects? |
| Sensitive-value lane | Secret keys and certificate material | External secret manager, encrypted Secret workflow, protected backup | Can the app receive keys without printing values? |
| Durable-data lane | PVC-backed files, databases, indexes | VolumeSnapshot, database backup, storage-provider snapshot | Can a restored Pod read expected data? |
| External-state lane | Managed databases, buckets, queues, provider resources | Cloud/provider backup and restore features | Can the restored app reach the restored dependency? |
| Traffic lane | Ingress, DNS, load balancer routing, feature flags | GitOps, provider console/API, runbook steps | Can test traffic reach the recovered service safely? |

![Backup state inventory](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-backup-and-restore-basics/backup-state-inventory.png)

*A backup plan should map each piece of platform state to its real storage location and recovery source.*

## Kubernetes API Objects and etcd
<!-- section-summary: Kubernetes API objects live in the control plane backing store, and self-managed clusters usually protect that store with etcd snapshots. -->

Kubernetes stores API objects such as Deployments, Services, ConfigMaps, Secrets, PVCs, and RBAC objects through the API server. In self-managed clusters, that storage is usually **etcd**, a distributed key-value database used by the control plane.

An **etcd snapshot** captures the control plane state at a point in time. It can help restore a self-managed cluster after control plane data loss. Managed Kubernetes providers usually own the control plane backup process, so users rely on provider documentation, managed backup features, and exported Kubernetes manifests.

A self-managed control plane snapshot command can look like this:

```bash
ETCDCTL_API=3 etcdctl snapshot save /backups/k8s-etcd-2026-06-28.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

Successful output should show a saved snapshot:

```console
Snapshot saved at /backups/k8s-etcd-2026-06-28.db
```

Validate the snapshot after creating it:

```bash
ETCDCTL_API=3 etcdctl snapshot status /backups/k8s-etcd-2026-06-28.db --write-out=table
```

Useful output includes the snapshot hash, revision, key count, and size:

```console
+----------+----------+------------+------------+
|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |
+----------+----------+------------+------------+
| 7ef846e5 |  884213  |      12543 |      42 MB |
+----------+----------+------------+------------+
```

Store snapshots away from the failed cluster and protect them like sensitive data. They can contain Secrets and every other API object.

## Manifests and GitOps Recovery
<!-- section-summary: GitOps and reviewed manifests give teams a clean way to recreate desired Kubernetes objects after a cluster loss. -->

A Kubernetes object backup is useful, but the desired state should also live outside the cluster. Manifests, Helm charts, Kustomize overlays, and GitOps repositories let a team recreate workloads in a fresh cluster without depending only on the failed API server.

For the notification platform, Git should contain the shape of Deployments, Services, ConfigMaps, PVC requests, RBAC, ingress objects, and policy resources. Live Secret values may come from an external secret manager or encrypted secret workflow instead of plain Git.

A recovery step can be as simple as applying a known environment overlay:

```bash
kubectl apply -k environments/production/customer-notifications
```

Expected output names the recreated objects:

```console
namespace/customer-notifications configured
deployment.apps/notification-api configured
deployment.apps/notification-worker configured
service/notification-api configured
```

GitOps controllers such as Argo CD or Flux automate this apply loop. The restore drill should still prove that a new cluster can sync the repository and reach a healthy state without manual edits.

## Secrets and Encryption Concerns
<!-- section-summary: Secret backups need strong access control because restoring a Secret backup can expose live credentials. -->

Secret backup has two sides. You need the ability to recover credentials or recreate them, and you need to prevent backups from becoming an easy credential leak.

If Secrets are sourced from an external manager, the Kubernetes restore path may recreate Secret objects by resyncing from that manager. If Secrets are encrypted in Git, the restore path needs the decryption controller or keys. If Secrets exist only in the cluster, a cluster backup may be the only copy, and that backup must be protected with the same care as production credentials.

Never treat a decoded Secret backup as harmless. Anyone who can restore or read it may be able to connect to databases, send notifications, or sign internal callbacks.

For restore drills, prefer proving presence without printing values. This command prints the Secret name and key names only:

```bash
kubectl get secret notification-api-secrets \
  -n customer-notifications \
  -o go-template='{{.metadata.name}}{{"\n"}}{{range $key, $_ := .data}}{{printf "- %s\n" $key}}{{end}}'
```

Example output:

```console
notification-api-secrets
- DATABASE_URL
- WEBHOOK_SIGNING_KEY
```

Use controlled environments and sanitized outputs during documentation. In runbooks, show key names or validation checks rather than full Secret content.

## PVC Snapshots and Restore
<!-- section-summary: VolumeSnapshots capture PVC-backed storage when the CSI driver supports snapshotting. -->

A **VolumeSnapshot** is a Kubernetes object that asks a CSI snapshot driver to capture a PersistentVolumeClaim. It is useful for PVC-backed workloads such as `notification-postgres` in a training or self-managed cluster.

This is the durable-data lane for storage that lives behind a PVC. The Kubernetes object records the snapshot request, but the CSI snapshot driver and storage platform create the actual copy. For the notification platform, this fits a self-managed PostgreSQL training database or a search index volume. A managed database still needs database-native backup and restore features.

The small shape names the source claim:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: notification-postgres-2026-06-28
  namespace: customer-notifications
spec:
  source:
    persistentVolumeClaimName: notification-postgres-data
```

The snapshot request has a small field contract:

- `kind: VolumeSnapshot` asks the snapshot controller for a point-in-time copy.
- `metadata.namespace` should match the PVC namespace.
- `spec.source.persistentVolumeClaimName` names the PVC that backs the data.
- The CSI driver and snapshot class decide whether this request can actually run in the cluster.

The snapshot status shows whether the copy is ready:

```bash
kubectl get volumesnapshot -n customer-notifications
```

A ready snapshot looks like this:

```console
NAME                             READYTOUSE   SOURCEPVC                    AGE
notification-postgres-2026-06-28 true         notification-postgres-data   2m
```

Restoring usually creates a new PVC from the snapshot through a data source:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notification-postgres-data-restore
  namespace: customer-notifications
spec:
  dataSource:
    name: notification-postgres-2026-06-28
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

The restore PVC fields matter during a drill:

- `metadata.name` creates a new claim instead of overwriting the existing claim.
- `dataSource.name` points to the snapshot to restore from.
- `dataSource.kind` and `apiGroup` tell Kubernetes that the source is a `VolumeSnapshot`.
- `accessModes` and requested `storage` should match the restored workload and the snapshot requirements.
- The restored Pod should mount this new claim first in a safe namespace or test environment.

Snapshot consistency depends on the application. A database may need a filesystem freeze, database-native backup, or operator-managed snapshot hook so the restored data is usable.

## External Databases and Object Stores
<!-- section-summary: Kubernetes backups do not automatically protect data that lives in managed databases, object storage, or brokers outside the cluster. -->

Many production systems keep important state outside Kubernetes. The notification platform may use managed PostgreSQL for delivery history, object storage for attachments, and a managed queue for outbound jobs. Those systems need their own backup and restore plans.

For a managed database, use database-native backups, point-in-time recovery, and restore drills in a separate environment. For object storage, use versioning, lifecycle policies, replication, and periodic restore checks. For brokers, understand retention windows and whether messages can be replayed from the source of truth.

Kubernetes manifests can restore the application shell. They cannot recreate customer notification history if the database backup fails. Put the external systems in the same recovery plan as the cluster.

## Velero and Cluster Backup Tools
<!-- section-summary: Tools such as Velero can back up Kubernetes resources and, with provider support, coordinate volume snapshots. -->

Velero is a common open-source tool for backing up and restoring Kubernetes resources. With the right plugins and storage provider support, it can also coordinate volume snapshots. Other enterprise and cloud-native backup tools follow similar ideas.

A cluster backup tool sits across several recovery lanes. It can capture API objects such as Deployments, Services, ConfigMaps, RBAC, and PVC objects, and it may coordinate volume snapshots when the storage platform supports them. It still needs a clear scope because external databases, object stores, managed queues, and provider-side resources may require separate backups.

A Velero backup command can target the notification namespace:

```bash
velero backup create notification-prod-2026-06-28 \
  --include-namespaces customer-notifications
```

The backup description should show a completed phase:

```bash
velero backup describe notification-prod-2026-06-28
```

Useful output should show the phase:

```console
Phase:  Completed
Namespaces:
  Included:  customer-notifications
```

Backup tools still need design decisions. Decide which namespaces are included, which resources are excluded, where backup objects are stored, how long they are retained, and who can restore them. Restoring into the wrong cluster or namespace can overwrite good state with stale state.

## Restore Drill Runbook
<!-- section-summary: A restore drill proves the recovery path in a safe environment before an incident forces the team to improvise. -->

A **restore drill** is a planned practice recovery. The goal is to prove the runbook and catch missing access, stale backups, broken manifests, or undocumented manual steps.

The drill turns the recovery plan from a document into evidence. A safe namespace or test cluster lets the team restore API objects, reconnect non-production Secrets, attach restored data, and send a controlled test notification. This is where missing permissions, stale manifests, unavailable snapshots, and unsafe traffic steps show up before a real incident.

For the notification platform, a safe drill can use a separate namespace or test cluster:

1. Create a fresh namespace such as `customer-notifications-restore-drill`.
2. Restore Kubernetes objects from GitOps or the backup tool.
3. Restore a database snapshot or create a temporary database from backup.
4. Sync non-production Secret values from the approved secret source.
5. Start `notification-api` and `notification-worker` against test endpoints.
6. Send a test notification and verify the delivery record.
7. Record elapsed time, missing steps, and cleanup tasks.

Commands that show progress help the drill stay concrete:

```bash
kubectl get deploy,pod,pvc -n customer-notifications-restore-drill
```

Sample healthy output:

```console
NAME                                  READY   UP-TO-DATE   AVAILABLE
deployment.apps/notification-api      2/2     2            2
deployment.apps/notification-worker   2/2     2            2

NAME                                      STATUS   VOLUME
persistentvolumeclaim/postgres-restore    Bound    pvc-restore-123
```

![Restore drill timeline](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-backup-and-restore-basics/restore-drill-timeline.png)

*A restore drill should show each recovery step, the owner, the verification command, and the cleanup step.*

## RPO and RTO for the Notification Platform
<!-- section-summary: RPO describes acceptable data loss, while RTO describes acceptable recovery time. -->

**RPO**, or recovery point objective, is the amount of data loss the business can accept. If the notification database has a 15-minute RPO, the backup design should allow recovery to a point no more than 15 minutes before the failure.

**RTO**, or recovery time objective, is the time the business can accept before service returns. If the worker has a one-hour RTO, the restore process should bring the worker and its dependencies back within that hour.

For the Customer Notification Platform, choose objectives by state type:

| State | Example RPO | Example RTO |
|---|---:|---:|
| Deployment manifests | Near zero through Git | 30 minutes |
| ConfigMaps and Secrets | Near zero through Git or secret manager | 30 minutes |
| Delivery history database | 15 minutes | 1 hour |
| Attachment bucket | 1 hour | 2 hours |
| Queued jobs | Depends on broker retention | 30 minutes |

These numbers are examples. The real values should come from product and business owners, then engineering should design backups to meet them and drills to prove them.

## Failure Patterns to Catch Early
<!-- section-summary: Most restore failures come from missing external state, untested permissions, stale manifests, and unsafe Secret handling. -->

Backup plans fail in predictable ways. A cluster backup restores Deployments but not the managed database. A Secret restore requires a decryption key that only existed in the failed cluster. A PVC snapshot restores corrupted database files due to an inconsistent snapshot. A GitOps repo recreates a workload that points at a deleted object storage bucket.

These patterns are included because backup confidence can be misleading. A dashboard may show a completed backup while the application still lacks customer data, credentials, or a valid dependency. Reviewing failure patterns forces the team to test each recovery lane: API objects, sensitive values, durable volumes, external state, and traffic restoration.

Catch these issues before an incident:

| Pattern | Prevention |
|---|---|
| Backup without restore test | Run scheduled restore drills |
| Cluster-only backup | Inventory external databases, buckets, and brokers |
| Secret restore blocked | Store decryption and secret-source access outside the failed cluster |
| Inconsistent volume snapshot | Use database-native backup or snapshot hooks |
| Wrong namespace restore | Restore into a drill namespace first and verify object targets |

The review should focus on proof. A backup listed in a dashboard helps only after a restore drill shows the application can run from it.

## Assembled Recovery Plan
<!-- section-summary: A complete recovery plan connects each state source to a command, owner, verification check, and cleanup step. -->

Here is a compact recovery plan for the notification platform. Keep the real version in your incident runbook with owners, links, and environment-specific commands.

The assembled plan pulls the earlier lanes into one sequence. It names who restores the Kubernetes shell, who restores sensitive values, who handles databases or PVC data, and who resumes traffic. A useful plan also includes a verification command at every step so the team can prove progress instead of simply checking off tasks.

The table is intentionally compact, but the real runbook should link to exact backups, owners, credentials process, and cleanup steps.

| Step | Owner | Command or action | Verification |
|---|---|---|---|
| Recreate namespace and workloads | Platform | Apply GitOps production overlay | Deployments exist and Pods schedule |
| Restore config | Platform | Sync ConfigMaps from Git | App startup logs show config source |
| Restore secrets | Security/platform | Sync from external secret manager | Required Secret keys exist |
| Restore database | Database owner | Restore latest approved backup | Migration and health checks pass |
| Restore PVC data if used | Platform/database | Create PVC from snapshot | Recovery Pod reads expected data |
| Resume traffic | App owner | Enable ingress or routing | Test notification succeeds |

Run a small customer-safe verification after restore:

```bash
curl -sS -X POST https://notification-api.example.internal/test-send \
  -H 'Content-Type: application/json' \
  -d '{"channel":"email","template":"restore-drill","recipient":"test@example.invalid"}'
```

Expected response:

```console
{"status":"accepted","traceId":"restore-drill-2026-06-28"}
```

The test endpoint should use non-production destinations or a provider sandbox. A restore drill should never send real customer notifications by accident.

## Review Checklist
<!-- section-summary: Backup review checks state inventory, storage location, restore proof, objectives, Secret safety, and ownership. -->

Use this checklist before calling a Kubernetes workload recoverable:

The checklist is a final guardrail for the recovery lane. It asks whether the team knows every state location, whether each location has a restore path, whether objectives are defined, and whether a recent drill proved the path in a safe environment. For Secrets, it also checks that backup access and restore logs will not expose live credentials.

For the notification platform, the checklist should be reviewed after every major storage, Secret, or dependency change.

| Check | What to confirm |
|---|---|
| Inventory | Every stateful component has a named storage location |
| Coverage | Kubernetes objects, volumes, external databases, buckets, and brokers have recovery paths |
| Objectives | RPO and RTO are defined by state type |
| Secrets | Backups and restores protect sensitive values and decryption paths |
| Proof | A restore drill has run recently in a safe environment |
| Ownership | Each restore step has an owner and verification command |

![Backup restore checklist](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-backup-and-restore-basics/backup-restore-checklist.png)

*A useful backup checklist connects coverage, objectives, ownership, restore proof, and sensitive-data handling.*

## References

- [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
- [VolumeSnapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
- [Velero documentation](https://velero.io/docs/)
