---
title: "Jobs and CronJobs"
description: "Run finite Kubernetes work with Jobs and scheduled recurring work with CronJobs."
overview: "Jobs and CronJobs are for work that should finish, not servers that should run forever. This article uses `devpolaris-orders-api` maintenance tasks to show completions, retries, schedules, and failure diagnosis."
tags: ["jobs", "cronjobs", "batch", "kubectl"]
order: 3
id: article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs
---

## Table of Contents

1. [Work That Should Finish](#work-that-should-finish)
2. [A One-Time Order Migration Job](#a-one-time-order-migration-job)
3. [Completion, Backoff, and Restart Policy](#completion-backoff-and-restart-policy)
4. [CronJobs for Scheduled Work](#cronjobs-for-scheduled-work)
5. [Concurrency and Missed Schedules](#concurrency-and-missed-schedules)
6. [Failure Mode: A Job Keeps Retrying](#failure-mode-a-job-keeps-retrying)
7. [Cleanup and History](#cleanup-and-history)
8. [Choosing Job, CronJob, or Deployment](#choosing-job-cronjob-or-deployment)

## Work That Should Finish

Not every container should run forever. Some work has a clear end: migrate a database, rebuild a search index, send daily invoices, delete expired carts, or backfill analytics. In Kubernetes, a Job is the workload object for finite work. A CronJob creates Jobs on a repeating schedule.

This matters because a Deployment assumes the process should keep running. If a Deployment Pod exits successfully, Kubernetes starts it again. That is wrong for a migration that should run once and stop. A Job treats successful completion as the goal.

For `devpolaris-orders-api`, the team needs two kinds of finite work. Before a release, they run a one-time migration that adds a `payment_status` column. Every night, they run a cleanup task that expires abandoned checkout sessions. The first belongs in a Job. The second belongs in a CronJob.

## A One-Time Order Migration Job

A Job contains a Pod template, just like a Deployment, but its success condition is completion. Here is a small migration Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-add-payment-status-20260507
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
          command: ["node", "scripts/migrate.js"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-db
                  key: url
```

The `command` overrides the image's normal API startup and runs the migration script. `restartPolicy: Never` means a failed container produces a failed Pod, and the Job controller can create a new Pod attempt. `backoffLimit: 2` prevents endless retries when the script is broken.

Apply the Job and watch it:

```bash
$ kubectl apply -f migration-job.yaml
job.batch/orders-add-payment-status-20260507 created

$ kubectl get job orders-add-payment-status-20260507
NAME                                COMPLETIONS   DURATION   AGE
orders-add-payment-status-20260507  1/1           18s        31s
```

`COMPLETIONS` is the field to read first. `1/1` means one successful Pod completion was required and one happened. The Job has done its work.

## Completion, Backoff, and Restart Policy

Jobs give you several knobs because batch work has different failure shapes. A migration might need exactly one success. A thumbnail generator might process thousands of files in parallel. A report builder might tolerate a retry after a transient database timeout.

For beginner operations, understand these fields first:

| Field | Meaning | Common beginner choice |
|-------|---------|------------------------|
| `completions` | Number of successful Pods needed | Omit for one success |
| `parallelism` | Number of Pods allowed at once | `1` for migrations |
| `backoffLimit` | Failed Pod attempts before Job fails | Small number such as `2` |
| `activeDeadlineSeconds` | Maximum runtime for the Job | Useful for stuck tasks |
| `restartPolicy` | Container restart behavior inside the Pod | `Never` or `OnFailure` |

The tradeoff is retry safety. Retrying a read-only report is usually fine. Retrying a migration that is not idempotent can corrupt data. Idempotent means the operation can run more than once and leave the system in the same correct state, like setting a column default rather than blindly inserting duplicate rows.

## CronJobs for Scheduled Work

A CronJob creates Jobs from a schedule. It is like a line in a Unix crontab, but the work runs as Kubernetes Pods and is visible through the Kubernetes API.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: orders-expire-checkouts
spec:
  schedule: "15 2 * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: expire
              image: ghcr.io/devpolaris/orders-api:2026-05-07.1
              command: ["node", "scripts/expire-checkouts.js"]
```

This runs at 02:15 UTC every day. `concurrencyPolicy: Forbid` says Kubernetes should not start a new cleanup Job if the previous one is still running. That protects the database from two cleanup tasks racing each other.

Inspect a CronJob in two layers: the schedule object and the Jobs it created.

```bash
$ kubectl get cronjob orders-expire-checkouts
NAME                      SCHEDULE     TIMEZONE   SUSPEND   ACTIVE   LAST SCHEDULE   AGE
orders-expire-checkouts   15 2 * * *   Etc/UTC    False     0        8h              4d

$ kubectl get jobs -l job-name
NAME                                 COMPLETIONS   DURATION   AGE
orders-expire-checkouts-29165535     1/1           22s        8h
```

The CronJob owns the schedule. The Job owns a particular run. When a run fails, inspect the Job and its Pod, not only the CronJob.

## Concurrency and Missed Schedules

CronJobs have scheduling edges that ordinary crontab users often miss. A controller creates Jobs approximately on schedule. If the controller is down, the cluster is overloaded, or the previous run is still active, a scheduled run can be late or skipped depending on your settings.

`concurrencyPolicy` is the first safety choice:

| Policy | Behavior | Good for |
|--------|----------|----------|
| `Allow` | New Jobs can overlap old Jobs | Independent work |
| `Forbid` | Skip new run if old run is active | Database cleanup |
| `Replace` | Stop old run and start new run | Freshness beats completion |

For `orders-expire-checkouts`, `Forbid` is safer because two cleanup workers could select the same rows and produce confusing logs. The cost is that a long run can cause a later schedule to be skipped.

`startingDeadlineSeconds` controls how late a missed run may start. If a daily cleanup is not useful after business hours begin, give it a deadline. If every run must happen eventually, design the task to process a date range or checkpoint instead of relying only on CronJob timing.

## Failure Mode: A Job Keeps Retrying

When a Job fails, start at the Job status, then inspect the Pods it created.

```bash
$ kubectl get job orders-add-payment-status-20260507
NAME                                COMPLETIONS   DURATION   AGE
orders-add-payment-status-20260507  0/1           2m44s      2m44s

$ kubectl describe job orders-add-payment-status-20260507
Pods Statuses:  0 Active / 0 Succeeded / 3 Failed
Events:
  Type     Reason                Message
  ----     ------                -------
  Normal   SuccessfulCreate      Created pod: orders-add-payment-status-20260507-bmh9t
  Warning  BackoffLimitExceeded  Job has reached the specified backoff limit
```

Now find the failed Pods and read logs from the latest one:

```bash
$ kubectl get pods --selector=job-name=orders-add-payment-status-20260507
NAME                                      READY   STATUS   RESTARTS   AGE
orders-add-payment-status-20260507-bmh9t  0/1     Error    0          2m

$ kubectl logs orders-add-payment-status-20260507-bmh9t
2026-05-07T10:18:10Z migration failed: relation "orders" does not exist
```

The fix direction is now clear. The cluster did run the Job. The image did start. The script failed because it connected to a database that does not have the expected schema or used the wrong database URL. Check the Secret, namespace, and migration order before re-running.

## Cleanup and History

Finished Jobs and their Pods remain for inspection unless you clean them up. That is useful after a failure, but a busy CronJob can leave many old objects.

CronJobs have `successfulJobsHistoryLimit` and `failedJobsHistoryLimit`. Jobs can also set `ttlSecondsAfterFinished` so Kubernetes removes them after a period.

```yaml
spec:
  ttlSecondsAfterFinished: 86400
```

For migration Jobs, keeping the object for a day gives the team time to inspect logs after a release. For recurring Jobs, keeping a few successes and failures is usually enough because logs should also flow into your central logging system.

## Choosing Job, CronJob, or Deployment

Choose the object from the shape of the process. If it should serve traffic continuously, use a Deployment. If it should run to completion once, use a Job. If it should create finite work on a schedule, use a CronJob.

The risky mistake is running a one-time script inside a Deployment. Kubernetes will keep restarting it because the controller thinks exit means failure. The opposite mistake is running an API inside a Job. The Job may mark itself complete or failed based on process exit instead of keeping service replicas alive.

There is also a release-order decision. A migration Job often belongs before the Deployment rollout that depends on the schema change. A cleanup CronJob usually belongs beside the API because it is part of ongoing operations. A backfill Job might belong after a release because it fills data for a new feature once the code can read both old and new shapes.

For `devpolaris-orders-api`, a safe migration review asks whether the script can run twice. If the first attempt applies half the change and the second attempt fails on duplicate work, the Job is not safe to retry. Make the script check existing state first.

```text
Good migration behavior:
1. Check whether column payment_status exists.
2. Add it only if it is missing.
3. Backfill rows in small batches.
4. Record completion in the migration table.
5. Exit 0 when the desired schema is already present.
```

That list is not Kubernetes syntax. It is the application safety contract that makes Kubernetes retries useful instead of dangerous.

You can inspect a successful Job's Pod even after completion:

```bash
$ kubectl get pods --selector=job-name=orders-add-payment-status-20260507
NAME                                      READY   STATUS      RESTARTS   AGE
orders-add-payment-status-20260507-l7n9x  0/1     Completed   0          12m

$ kubectl logs orders-add-payment-status-20260507-l7n9x
2026-05-07T10:02:11Z connecting to orders database
2026-05-07T10:02:12Z migration 20260507_add_payment_status already applied: false
2026-05-07T10:02:27Z migration complete rows_backfilled=18420
```

These logs are release evidence. They tell a reviewer or incident responder which script ran, which database it reached, and how much work it performed. If the logs only say `done`, the Job may have completed but the team learned very little.

CronJobs need a different review because time is part of the behavior. Check schedule, timezone, concurrency, and history before the task ever runs.

```bash
$ kubectl describe cronjob orders-expire-checkouts
Schedule:                   15 2 * * *
Time Zone:                  Etc/UTC
Concurrency Policy:         Forbid
Suspend:                    False
Successful Job History Limit: 3
Failed Job History Limit:     3
```

If a CronJob should pause during an incident, set `suspend: true` or patch it deliberately:

```bash
$ kubectl patch cronjob orders-expire-checkouts -p '{"spec":{"suspend":true}}'
cronjob.batch/orders-expire-checkouts patched
```

Suspending the CronJob stops future Jobs. It does not stop a Job that is already running. To stop an active run, inspect active Jobs and delete the specific Job if that is the correct operational decision.

```bash
$ kubectl get jobs --field-selector status.successful!=1
NAME                              COMPLETIONS   DURATION   AGE
orders-expire-checkouts-29165536  0/1           34m        34m
```

Be careful with deletion. Deleting a Job also deletes Pods owned by that Job. That can be right for a runaway cleanup, but it can leave partial work. The application task should be written so partial work is visible and resumable.

For day-to-day operations, this compact map helps:

| Symptom | First check | Likely next step |
|---------|-------------|------------------|
| Job never starts | `kubectl describe job` | Look for Pod creation or quota errors |
| Pod exits non-zero | `kubectl logs` | Fix script, config, or dependency |
| CronJob did not run | `kubectl describe cronjob` | Check schedule, timezone, suspend, missed deadline |
| Runs overlap | CronJob concurrency policy | Use `Forbid` or make task idempotent |
| Too many old objects | History limits or TTL | Set cleanup policy |

Jobs and CronJobs are simple when the task is simple. The hard part is making the task safe to retry, safe to observe, and safe to stop.

The last detail is namespace context. Batch work often runs in the same namespace as the application because it needs the same Secrets and network policies. That is convenient, but it can also hide mistakes. A migration Job pointed at the staging database should not run in the production namespace.

```bash
$ kubectl config set-context --current --namespace=orders-prod
Context "platform-admin" modified.

$ kubectl get secret orders-db
NAME        TYPE     DATA   AGE
orders-db   Opaque   1      41d
```

Checking the namespace and Secret before a migration is a small habit that prevents expensive mistakes. The Job can be perfectly written and still do the wrong thing if it runs in the wrong namespace.

For recurring Jobs, include the run identity in logs. CronJob-created Jobs have generated names, and logs are easier to search when the process prints its own run metadata.

```text
2026-05-07T02:15:02Z job=orders-expire-checkouts schedule=15_2_daily timezone=Etc/UTC run_id=29165535
2026-05-07T02:15:04Z expired_checkout_sessions=418
2026-05-07T02:15:04Z completed status=success duration_ms=2198
```

Those lines give operations and application teams the same language. They can search for the run ID, compare it with the Kubernetes Job, and decide whether a missing report is a scheduling problem or an application problem.

If a Job writes external effects, make the effect traceable too. For an invoice sender, log the invoice batch ID. For a migration, log the migration ID. For cleanup, log counts and age thresholds. Good batch logs are short, structured, and tied to the work the business cares about.

That traceability also helps cleanup. When the team decides whether to delete an old Job object, the important evidence should already live in durable logs or release records. Kubernetes objects are useful for recent inspection, but they should not be the only place the team can prove a migration ran.

That record is part of the work.

---

**References**

- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) - The official concept page for finite work and Job completion behavior.
- [Kubernetes CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) - The official reference for schedules, concurrency policy, deadlines, and history limits.
- [TTL After Finished Controller](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/) - Kubernetes guidance for cleaning up completed Jobs automatically.
