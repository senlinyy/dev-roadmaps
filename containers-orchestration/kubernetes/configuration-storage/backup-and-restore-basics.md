---
title: "Backup and Restore Basics"
description: "Understand the Kubernetes backup and restore surfaces that matter for configuration, secrets, volumes, and cluster state."
overview: "Backup and restore in Kubernetes means knowing which state lives in the API server, which state lives in volumes or external systems, and how to prove recovery before an incident."
tags: ["kubernetes", "backup", "restore", "etcd"]
order: 7
id: article-containers-orchestration-kubernetes-configuration-storage-backup-and-restore-basics
---

## Table of Contents

1. [Start with the State Inventory](#start-with-the-state-inventory)
2. [Kubernetes API Objects and etcd](#kubernetes-api-objects-and-etcd)
3. [Manifests and GitOps Recovery](#manifests-and-gitops-recovery)
4. [Secrets and Encryption Concerns](#secrets-and-encryption-concerns)
5. [PVC Snapshots and Restore](#pvc-snapshots-and-restore)
6. [External Databases and Object Stores](#external-databases-and-object-stores)
7. [Velero in Real Kubernetes Backups](#velero-in-real-kubernetes-backups)
8. [Restore Drill Runbook](#restore-drill-runbook)
9. [RPO and RTO for devpolaris-orders-api](#rpo-and-rto-for-devpolaris-orders-api)
10. [Verification Checklist](#verification-checklist)
11. [Failure Patterns to Catch Early](#failure-patterns-to-catch-early)

## Start with the State Inventory
<!-- section-summary: A useful backup plan begins by naming every place the service stores state and every system needed to restore it. -->

Backups get confusing in Kubernetes because the application is spread across several kinds of state. Some state lives in the Kubernetes API, some state lives on persistent volumes, and some state lives completely outside the cluster. A restore that protects only one layer may create objects that look right while the service still fails real user workflows.

The same `devpolaris-orders-api` from the previous articles gives us a concrete recovery target. The service runs in Kubernetes, writes invoice work files to the `orders-api-workdir` PVC, stores final invoice PDFs in object storage, and keeps order records in a PostgreSQL database. The Kubernetes objects matter, but they are only one part of the recovery picture.

A first inventory can be very plain. The table should fit in a runbook and stay specific enough for a teammate to use during a drill, because vague backup notes rarely help when the service is already down:

| State | Example for `devpolaris-orders-api` | Where it lives | Recovery owner |
|---|---|---|---|
| Workload objects | Deployment, Service, ServiceAccount, RBAC | Kubernetes API | Platform and app team |
| Configuration | `orders-api-config` ConfigMap | Kubernetes API and Git | App team |
| Secrets | Database credentials, API tokens | Kubernetes API and secret manager | Platform and security team |
| Work files | `/var/lib/devpolaris/orders-work` | PVC backing storage | Platform and app team |
| Business records | Orders, payment state, invoice metadata | PostgreSQL | Database team |
| Final documents | Uploaded invoice PDFs | Object storage | App team and platform |
| Images | `ghcr.io/devpolaris/orders-api:1.18.0` | Container registry | CI/CD owner |

This table changes the conversation from "we have Kubernetes backups" to "we know which system restores each kind of state." That is the conversation a team needs before an outage, because each row has different tooling, permissions, retention, and verification.

## Kubernetes API Objects and etcd
<!-- section-summary: Kubernetes stores API objects through etcd, so control plane recovery protects the desired cluster objects but not every piece of application data. -->

**etcd** is the strongly consistent key-value store used by the Kubernetes control plane. When you create a Deployment, ConfigMap, Secret, Service, PVC, RoleBinding, or CustomResource, the Kubernetes API stores that object through etcd. The API server, scheduler, controller manager, and kubelets all work from that API state.

For managed Kubernetes, the cloud provider usually operates the control plane and its etcd backups. The application team still needs to know the provider's restore boundary, restore timing, and support process. A managed control plane restore may bring back API objects, while the database, object store, and deleted backing disks follow their own recovery processes.

For self-managed clusters, etcd snapshots are a platform administrator responsibility. A simplified snapshot command looks like this, and the real runbook should use the paths and endpoints from your cluster:

```bash
ETCDCTL_API=3 etcdctl snapshot save /var/backups/etcd/snapshot-2026-06-16.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

The exact endpoints and certificate paths depend on the cluster installation. The important idea is that API state has its own backup path. That path should be tested by platform engineers, and application teams should understand whether they restore objects from Git, from a cluster backup tool, or from a managed control plane recovery process.

Snapshot evidence should be checked before the team trusts it. The status command gives the platform team a quick sanity check before the snapshot is stored as recovery evidence:

```bash
ETCDCTL_API=3 etcdctl snapshot status /var/backups/etcd/snapshot-2026-06-16.db --write-out=table
```

etcd snapshots can contain sensitive API data, including Secrets as stored by the API server. Snapshot files should receive the same protection as production secrets: encrypted storage locations, restricted access, and incident response coverage.

## Manifests and GitOps Recovery
<!-- section-summary: GitOps gives the team a clean record of intended Kubernetes objects, while runtime backups handle state outside Git. -->

A strong Kubernetes recovery plan usually starts with version-controlled manifests. If the Deployment, Service, ConfigMap, RBAC, NetworkPolicy, and PVC manifest live in Git, the team can recreate the intended API objects in a clean namespace or cluster. Helm, Kustomize, and GitOps controllers all fit this pattern when the repository is treated as the recovery record.

For the orders API, the Git repository should answer basic questions quickly. Which image tag should run? Which Service exposes it? Which ServiceAccount does it use? Which PVC name does the Deployment mount? Which ConfigMap keys does the app expect?

You can export live objects during an incident investigation. This gives you a point-in-time file for comparison, review, or emergency handoff:

```bash
kubectl get deploy,svc,configmap,secret,pvc,serviceaccount,rolebinding \
  -n devpolaris-prod \
  -o yaml > devpolaris-prod-api-export.yaml
```

That export is useful evidence, but it contains generated fields, timestamps, resource versions, and possibly sensitive data. The normal recovery record should be a reviewed Git manifest or chart. The emergency export helps compare live state against the intended state.

Git recovery and cluster backup tools complement each other. Git recreates the intended shape of the service. Cluster backup tools can capture runtime Kubernetes objects and selected volume data. Database backups, object storage versioning, and registry retention still need their own coverage.

## Secrets and Encryption Concerns
<!-- section-summary: Secrets need their own recovery and protection plan because API backups and etcd snapshots can carry sensitive values. -->

A Kubernetes **Secret** is an API object used to hold sensitive values such as tokens, passwords, and TLS keys. The `data` field uses base64 encoding for the API shape, and real confidentiality comes from RBAC, encryption at rest, secret-management workflows, and careful access to backups.

For `devpolaris-orders-api`, the Secret might contain a database connection password and a token used to sign invoice download links. Restoring the Deployment and ConfigMap only works when the Secret is recoverable and the external database credential still matches. The Secret row in the inventory needs an owner and a recovery source.

Many teams use an external secret manager as the source of truth, then sync values into Kubernetes. Other teams use encrypted manifests with tools such as SOPS or Sealed Secrets. The exact tool can vary, but the restore question stays the same: can the team recreate the Secret values in the target cluster without copying plaintext through chat, shell history, or unencrypted files?

Kubernetes also supports encrypting API data at rest, including Secrets, through an encryption configuration and optional KMS integration. This protects stored API data and makes etcd snapshots safer to handle, as long as the encryption keys and KMS access are also recoverable. Losing the keys can turn a backup into unreadable data.

During a restore drill, test Secret recovery directly. The check should prove both object existence and application authentication:

```bash
kubectl get secret orders-api-secrets -n devpolaris-restore-drill

kubectl rollout status deploy/orders-api -n devpolaris-restore-drill

kubectl logs deploy/orders-api -n devpolaris-restore-drill | grep -i 'database connection'
```

The goal is to prove the application can authenticate to its dependencies after restore. A Secret object that exists but contains stale credentials still leaves the service broken.

## PVC Snapshots and Restore
<!-- section-summary: VolumeSnapshots can capture PVC data, and a safe restore usually creates a new PVC first so the team can inspect it. -->

A **VolumeSnapshot** is a Kubernetes API object that asks a CSI snapshot driver to capture a point-in-time copy of a PVC's backing volume. It is useful for recovering the invoice work directory, cloning data into a test environment, or inspecting files from an earlier point without changing the live claim.

The snapshot object points at the production workdir claim whose backing data the team wants to capture:

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: orders-api-workdir-2026-06-16-0900
  namespace: devpolaris-prod
spec:
  volumeSnapshotClassName: standard-snapshot
  source:
    persistentVolumeClaimName: orders-api-workdir
```

After applying the snapshot, check readiness. A snapshot should be ready before you write a restore step around it:

```bash
kubectl get volumesnapshot orders-api-workdir-2026-06-16-0900 -n devpolaris-prod

kubectl describe volumesnapshot orders-api-workdir-2026-06-16-0900 -n devpolaris-prod
```

The output should show `READYTOUSE` as true. That field tells the team the snapshot is ready for restore input:

```bash
NAME                                  READYTOUSE   SOURCEPVC            RESTORESIZE   AGE
orders-api-workdir-2026-06-16-0900    true         orders-api-workdir    20Gi          3m
```

A careful restore creates a new PVC from the snapshot first. This gives the team a safe copy to inspect before changing the live workload:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-api-workdir-restore
  namespace: devpolaris-prod
spec:
  storageClassName: standard-retain
  dataSource:
    name: orders-api-workdir-2026-06-16-0900
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

The restored claim should be mounted into a recovery Pod or a temporary copy of the application before production traffic points at it. That inspection avoids overwriting the live path while the team is still learning what the snapshot contains.

Snapshots have consistency limits. A filesystem snapshot can catch the application in the middle of writing several files. For databases, use database-aware backup and restore procedures instead of treating a disk snapshot as the whole recovery plan.

## External Databases and Object Stores
<!-- section-summary: Kubernetes restores the cluster side of the service, while databases and object stores need their own backup policies and drills. -->

Most production applications keep the most valuable state outside Kubernetes. The orders API keeps order records and payment state in PostgreSQL, while final invoice PDFs live in object storage. Those systems need their own backup schedules, retention rules, restore permissions, and verification steps.

For PostgreSQL, the database team may use managed backups, write-ahead log archiving, point-in-time restore, or a database-specific backup tool. The application runbook should link to that process and name the restored database endpoint the Kubernetes Secret should use during a drill. A restored Deployment that points at the wrong database can pass `Running` checks while serving the wrong data.

For object storage, the recovery plan may use versioning, lifecycle policies, replication, retention locks, or provider-native restore features. The invoice PDFs should have their own retention and integrity checks because the PVC work directory only holds files temporarily. The workdir snapshot helps with in-flight files, while object storage protects the completed archive.

Container images also need retention. If `ghcr.io/devpolaris/orders-api:1.18.0` disappears from the registry, Kubernetes can have perfect manifests and still fail to pull the application. Release images should be immutable, retained, and documented in the same recovery inventory.

## Velero in Real Kubernetes Backups
<!-- section-summary: Velero is a common Kubernetes backup tool, but teams still need to understand which resources and volumes it captures. -->

Velero is a widely used open-source tool for Kubernetes backup, restore, and migration. It runs a controller in the cluster and gives operators a CLI and custom resources for creating backups and restores. It can back up Kubernetes API resources and, depending on configuration, persistent volume data through snapshots or file-system backup.

Velero is helpful because it wraps a lot of Kubernetes backup work into one operational workflow. A platform team can schedule namespace backups, store backup metadata in object storage, include or exclude resources, and restore into another namespace or cluster. The team still needs to choose storage plugins, permissions, backup locations, and volume backup strategy carefully.

A simple backup for the orders namespace might look like this. In a real platform setup, this command would follow the team's approved storage location and retention settings:

```bash
velero backup create orders-api-prod-2026-06-16 \
  --include-namespaces devpolaris-prod \
  --wait
```

A restore into a drill namespace might look like this. Namespace mapping lets the team practice without overwriting the production namespace:

```bash
velero restore create orders-api-drill-2026-06-16 \
  --from-backup orders-api-prod-2026-06-16 \
  --namespace-mappings devpolaris-prod:devpolaris-restore-drill \
  --wait
```

Those commands are only the first layer of the policy. The platform team needs to decide whether cluster-scoped resources are included, how Secrets are handled, how PV data is captured, where backups are stored, which credentials Velero uses, and how restore logs are reviewed. Kubernetes concepts still matter because Velero restores Kubernetes objects and volumes through Kubernetes APIs and storage integrations.

## Restore Drill Runbook
<!-- section-summary: A restore drill proves the backup by rebuilding the service in a controlled target and checking real application behavior. -->

A restore drill is a planned practice recovery. It should use a safe target, such as a temporary namespace or non-production cluster, and it should produce evidence that the service works. The drill should also record what failed, which permissions were missing, and how long the recovery took.

The `devpolaris-orders-api` drill can stay beginner-friendly and still produce useful evidence. Each step should leave a record that the team can inspect after the practice run:

1. Drill namespace creation.

```bash
kubectl create namespace devpolaris-restore-drill
```

2. Kubernetes manifest restore or apply.

```bash
kubectl apply -n devpolaris-restore-drill -f k8s/base/orders-api/
```

3. Secret restore from the approved secret workflow.

```bash
kubectl get secret orders-api-secrets -n devpolaris-restore-drill
```

4. PVC copy restore from a snapshot or backup tool.

```bash
kubectl get pvc -n devpolaris-restore-drill
```

5. Drill service connection to a restored database clone or approved read-only test database.

```bash
kubectl rollout restart deploy/orders-api -n devpolaris-restore-drill
```

6. Application startup and readiness evidence.

```bash
kubectl rollout status deploy/orders-api -n devpolaris-restore-drill

kubectl get pods -n devpolaris-restore-drill
```

7. Business behavior verification.

```bash
kubectl exec deploy/orders-api -n devpolaris-restore-drill -- \
  wget -qO- http://127.0.0.1:8080/readyz

kubectl exec deploy/orders-api -n devpolaris-restore-drill -- \
  ls -lah /var/lib/devpolaris/orders-work
```

The drill ends with notes, not just a green command output. The record should include the backup name, snapshot name, database restore point, image tag, commands used, duration, errors, and the person who approved cleanup. That evidence makes backup work a repeatable operating process.

## RPO and RTO for devpolaris-orders-api
<!-- section-summary: RPO describes acceptable data loss, while RTO describes acceptable recovery time for each state surface. -->

**Recovery Point Objective**, or **RPO**, answers this question: how much recent data can the business afford to lose? If the invoice workdir has a 15-minute RPO, the backup strategy should capture recoverable work files at least that often or the application should safely recreate them.

**Recovery Time Objective**, or **RTO**, answers a different question: how quickly does the service need to return? If the orders API has a 30-minute RTO for invoice generation, the restore process, permissions, people, and tooling must fit inside that time during a real incident.

RPO and RTO belong to each state surface. Different state has different business value and different restore mechanics:

| State | Example RPO | Example RTO | Recovery path |
|---|---:|---:|---|
| Kubernetes manifests | Last merged Git commit | 15 minutes | Reapply manifests or sync GitOps controller. |
| Secrets | Last approved rotation | 30 minutes | Recreate from secret manager or encrypted manifest workflow. |
| PVC workdir | 15 minutes | 30 minutes | Restore from VolumeSnapshot or Velero volume backup. |
| PostgreSQL orders database | 5 minutes | 60 minutes | Database point-in-time restore. |
| Object storage invoices | Near-zero for completed files | 45 minutes | Object versioning, replication, or provider restore. |
| Container image | Released image retained | 15 minutes | Pull immutable release tag from registry. |

The numbers above are examples, not universal targets. A startup, a bank, and an internal reporting app can choose different objectives. The key is writing the targets down and testing the restore path against them.

## Verification Checklist
<!-- section-summary: A restore is complete when the service behavior, data, credentials, and observability all work in the restored target. -->

Verification should prove that the application works, not just that Kubernetes objects exist. A Pod in `Running` state can still have stale config, wrong credentials, missing PVC data, or no connection to the restored database. Service checks should cover both inside-the-cluster behavior and the business workflow.

A drill checklist like this verifies the service behavior, the data, and the operating signals together:

| Area | Check | Command or evidence |
|---|---|---|
| Workload | Deployment rolled out | `kubectl rollout status deploy/orders-api -n devpolaris-restore-drill` |
| Pods | Pods are ready with expected image | `kubectl get pods -o wide -n devpolaris-restore-drill` |
| Config | ConfigMap keys match expected release | `kubectl describe configmap orders-api-config -n devpolaris-restore-drill` |
| Secrets | Secret exists and app can authenticate | App logs show database connection success. |
| PVC | Restored claim is bound and mounted | `kubectl get pvc -n devpolaris-restore-drill` |
| Files | Invoice work files are present and writable | `ls -lah /var/lib/devpolaris/orders-work` from inside the Pod. |
| Database | Restored database contains expected order records | Application read test or database team evidence. |
| Object storage | Completed invoice PDF can be read | Signed test URL or storage inventory evidence. |
| Networking | Service endpoints exist | `kubectl get endpointslice -n devpolaris-restore-drill` |
| Observability | Logs and metrics arrive | Dashboard screenshot or query result in the drill record. |

After verification, cleanup should be deliberate. Drill namespaces and temporary PVCs should be removed according to the reclaim policy and data handling rules. Retained volumes and restored databases can contain customer data, so cleanup needs the same care as creation.

## Failure Patterns to Catch Early
<!-- section-summary: Many backup plans fail because one layer restores while another required layer is missing, stale, or inaccessible. -->

The easiest failure to catch is missing inventory. A team restores Kubernetes objects and then discovers the database restore requires a different team, a different region, or a ticket that takes hours. The inventory should name owners and links before the incident.

Another common failure is stale Secret material. The Secret object restores, but the database password rotated last week and the restored value no longer works. A drill catches this quickly because the app starts, tries to connect, and logs the authentication failure.

PVC restores can fail through class mismatch and topology mismatch. The restored claim may ask for a StorageClass missing from the target cluster, or it may create a volume in a zone outside the restored Pod's scheduling options. StorageClass names, CSI drivers, and topology expectations belong in the restore runbook.

Velero and snapshot backups can also miss external systems. A namespace backup can include the Deployment and PVC metadata while the PostgreSQL database and object storage archive follow separate processes. The restore checklist should force those external checks instead of stopping at `kubectl get pods`.

The final failure pattern is skipped practice. A backup should have restore evidence, a named owner, and a recent drill result. Every application change that moves state to a new database, bucket, volume, or Secret should update the runbook and the next drill checklist.

---

**References**

- [Kubernetes Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) - Defines VolumeSnapshot resources and the Kubernetes snapshot model for PVC data.
- [Kubernetes Volume Snapshot Classes](https://kubernetes.io/docs/concepts/storage/volume-snapshot-classes/) - Explains VolumeSnapshotClass configuration and snapshot driver selection.
- [Kubernetes Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) - Provides the foundation for PVC binding, reclaim policy, and restored volume behavior.
- [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) - Covers etcd operation and snapshot commands for Kubernetes administrators.
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Documents Kubernetes API data encryption at rest and KMS provider options.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Explains Secret objects, usage patterns, and security considerations.
- [Declarative Management of Kubernetes Objects Using Configuration Files](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/) - Describes managing Kubernetes objects from declarative files.
- [Velero documentation overview](https://velero.io/docs/v1.16/) - Describes Velero backup, restore, migration, and persistent volume support.
- [Velero Backup Reference](https://velero.io/docs/v1.16/backup-reference/) - Documents backup commands, schedules, resource filtering, and backup behavior.
- [Velero Restore Reference](https://velero.io/docs/v1.16/restore-reference/) - Documents restore commands, restore workflow, and resource ordering.
