---
title: "Jobs and CronJobs"
description: "Run finite Kubernetes work with Jobs and scheduled recurring work with CronJobs."
overview: "Jobs and CronJobs handle finite Kubernetes tasks that should finish. This article uses Customer Notification Platform maintenance tasks to show completions, retries, schedules, and failure diagnosis."
tags: ["jobs", "cronjobs", "batch", "kubectl"]
order: 3
id: article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs
---

## Table of Contents

1. [Work That Should Finish](#work-that-should-finish)
2. [Jobs Versus Long-Running Services](#jobs-versus-long-running-services)
3. [Start with a One-Time Job Skeleton](#start-with-a-one-time-job-skeleton)
4. [Add Command, Configuration, and Runtime Limits](#add-command-configuration-and-runtime-limits)
5. [Completions and Parallelism](#completions-and-parallelism)
6. [Retries, Deadlines, and Idempotency](#retries-deadlines-and-idempotency)
7. [Cleaning Up Finished Jobs](#cleaning-up-finished-jobs)
8. [A Nightly CronJob](#a-nightly-cronjob)
9. [CronJob Scheduling Rules](#cronjob-scheduling-rules)
10. [Debugging Failed, Missed, and Duplicate Runs](#debugging-failed-missed-and-duplicate-runs)
11. [Production Runbooks](#production-runbooks)
12. [Choosing the Right Workload](#choosing-the-right-workload)

## Work That Should Finish
<!-- section-summary: Jobs and CronJobs start from work with a clear end, then add Kubernetes status, retries, cleanup, and scheduling around that work. -->

Start with one simple task: run a script, wait for it to finish, and keep proof of whether it succeeded. The Customer Notification Platform may need a release migration that adds `provider_status` to notification records. The same platform may also need a nightly cleanup that expires stale delivery attempts.

Those tasks should end. The migration should exit after the schema and data change finish. The cleanup should exit after it reviews the expected records. A Deployment would keep trying to maintain a running Pod, which fits `notification-api` and `notification-worker`, but batch work needs Kubernetes to treat a successful exit as the goal.

That is where **Jobs** and **CronJobs** fit. A **Job** runs finite work to completion. A **CronJob** creates Jobs from a schedule. Both still use Pods under the hood, but the controller watches for completion instead of long-running availability.

![Job runs to completion infographic showing a Job creating Pod attempts, retrying failed attempts, and reaching Complete after an exit zero result with status, events, and logs as evidence](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/job-runs-to-completion.png)

_This infographic shows why a Job fits finite work: Kubernetes treats a successful exit as the goal and keeps status, events, and logs around for evidence._

## Jobs Versus Long-Running Services
<!-- section-summary: Finite work has a clear end, while long-running services should keep serving until intentionally replaced or scaled down. -->

**Finite work** means the task has a natural end. A migration script exits after it changes the schema. A backfill script exits after it processes a range of notification IDs. A report generator exits after it writes the report. Kubernetes uses the exit code to decide whether a Pod attempt succeeded.

**Long-running service work** means the process should keep running. `notification-api` should keep receiving requests. `notification-worker` should keep reading queue messages and sending email, SMS, or push notifications. If either process exits unexpectedly, the team usually wants Kubernetes to replace it through a Deployment.

The same image can support both shapes. The API image may include a script called `node scripts/migrate-notifications.js`. Running the HTTP server fits a Deployment. Running that migration once fits a Job. Running a cleanup every night fits a CronJob.

| Work shape | Kubernetes object | Notification example |
|---|---|---|
| Always-on HTTP service | Deployment | `notification-api` |
| Always-on queue consumer | Deployment | `notification-worker` |
| One-time release task | Job | Add `provider_status` to the notification table |
| Scheduled finite task | CronJob | Expire stale delivery attempts every night |

Choosing the object by process lifecycle prevents a common beginner mistake. A Deployment that runs a script which exits will keep restarting the script. A Job that runs a web server will never complete. The controller has to match the way the process should behave.

## Start with a One-Time Job Skeleton
<!-- section-summary: A Job wraps a Pod template and records success after the required Pod completions finish. -->

A **Job** is a Kubernetes controller for one-time or finite work. It owns a Pod template, creates Pods from that template, and watches those Pods until the required number of successful completions happens. In a simple release task, the required number is usually one successful Pod.

Start with the smallest useful Job shape:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: notification-add-provider-status-20260614
  namespace: notifications
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/customer-notification/notification-api:2026.06.14-2
```

This skeleton says, "create a Pod from this template and treat a successful exit as the goal." `restartPolicy: Never` means a failed container attempt ends the Pod, and the Job controller may create a new Pod attempt depending on retry settings. For Jobs, `Never` and `OnFailure` are the valid restart policy choices.

The skeleton is still missing the script command and safety controls. Add those next so the Job does real work in a controlled way.

## Add Command, Configuration, and Runtime Limits
<!-- section-summary: A practical Job manifest names the exact command, passes configuration safely, and limits retry and runtime behavior. -->

The migration already lives in the application image as `node scripts/migrate-notifications.js`. The release engineer wants Kubernetes to run that command once, keep logs available, and show a clear status in `kubectl`.

Add the command and arguments:

```yaml
containers:
  - name: migrate
    image: ghcr.io/customer-notification/notification-api:2026.06.14-2
    command: ["node"]
    args: ["scripts/migrate-notifications.js", "--operation=provider-status-20260614"]
```

`command` replaces the image entrypoint, and `args` passes arguments to it. The operation name gives logs and database records a stable key. That key matters in batch work because a human may need to prove which migration attempt ran.

Add configuration through ConfigMaps and Secrets:

```yaml
envFrom:
  - configMapRef:
      name: notification-api-config
  - secretRef:
      name: notification-api-secrets
```

Add Job-level controls:

```yaml
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
```

`backoffLimit: 2` means the Job can tolerate a small number of failed attempts before it reports failure. `activeDeadlineSeconds: 900` gives the whole Job 15 minutes before Kubernetes stops trying. `ttlSecondsAfterFinished: 86400` asks Kubernetes to clean up the finished Job after one day, while leaving enough time for normal review.

Now the Job has a real operating shape without giving the reader a giant manifest on the first page.

Apply it and inspect the status:

```bash
$ kubectl apply -f notification-migration-job.yaml
job.batch/notification-add-provider-status-20260614 created

$ kubectl get job -n notifications notification-add-provider-status-20260614
NAME                                      COMPLETIONS   DURATION   AGE
notification-add-provider-status-20260614 1/1           42s        1m
```

Read the logs through the Job object:

```bash
$ kubectl logs -n notifications job/notification-add-provider-status-20260614
operation=provider-status-20260614 status=started
operation=provider-status-20260614 migrated_rows=128346 status=complete
```

The output gives two layers of evidence. Kubernetes says one required completion succeeded. The application log says the migration touched the expected data and finished cleanly.

## Completions and Parallelism
<!-- section-summary: Completions define how many successful Pods are needed, while parallelism controls how many Pods may work at once. -->

**Completions** is the number of successful Pods the Job needs before it is complete. **Parallelism** is the number of Pods the Job may run at the same time. These fields are separate because a Job might need many total units of work but only a few active at once.

For a simple migration, the Job usually needs one completion:

```yaml
spec:
  completions: 1
  parallelism: 1
```

A backfill has a different shape. Imagine the team needs to rebuild delivery-status summaries for 8 million old notification records. The script can process records in shards. Kubernetes can run several shards at once without opening too many database connections.

An **Indexed Job** gives each Pod a stable completion index. The script reads that index and processes only its shard:

```yaml
spec:
  completionMode: Indexed
  completions: 20
  parallelism: 4
  template:
    spec:
      containers:
        - name: backfill
          image: ghcr.io/customer-notification/notification-worker:2026.06.14-2
          command: ["node"]
          args: ["scripts/backfill-delivery-status.js"]
```

With `completions: 20`, the Job needs 20 successful indexes. With `parallelism: 4`, only four Pods should run at the same time. Kubernetes exposes the index to the Pod, and the script can process shard 0, shard 1, and so on.

![Indexed Job shards infographic showing eight million notifications split into shards zero through nineteen, parallelism four, completion index, idempotent processing, and safe writes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/indexed-job-shards.png)

_This infographic shows the backfill pattern visually: each indexed Pod owns a predictable shard, while parallelism limits how much database pressure the Job creates at once._

The database still needs protection. Parallelism should come from measured capacity, not hope. If each shard opens 20 connections, `parallelism: 4` may open 80 connections before the normal API and worker traffic are counted.

## Retries, Deadlines, and Idempotency
<!-- section-summary: Kubernetes retry settings control Pod attempts, while idempotent application logic controls business safety. -->

**Retry controls** tell Kubernetes how many failed Pod attempts are acceptable. They help with transient failures such as a temporary node problem, short database outage, or image pull interruption.

`backoffLimit` controls failed attempts:

```yaml
spec:
  backoffLimit: 2
```

`activeDeadlineSeconds` controls total runtime:

```yaml
spec:
  activeDeadlineSeconds: 1800
```

These fields do not prove the business operation is safe to repeat. That safety comes from **idempotency**. An idempotent operation can run more than once and still produce the same intended result. For example, setting `provider_status` for notification rows based on current delivery events can be idempotent if the script updates each row to a deterministic value. Sending an SMS is usually not idempotent unless the provider and application use a deduplication key.

For notification batch work, include an operation key in the script and database:

```sql
insert into ops_batch_runs (operation_key, status, started_at)
values ('delivery-status-backfill-20260614', 'running', now())
on conflict (operation_key) do nothing;
```

That pattern lets a retry check whether the operation already started or completed. The exact SQL may change by database and application design, but the idea is practical: Kubernetes can retry Pods, and the application must decide whether repeating the business action is safe.

## Cleaning Up Finished Jobs
<!-- section-summary: Finished Jobs keep useful evidence, and TTL cleanup removes old objects after the review window. -->

A finished Job leaves behind status, Pods, and logs for a while. That is useful during release review. It can also clutter a namespace if every nightly run stays forever.

The **TTL controller for finished Jobs** can remove completed or failed Jobs after a delay:

```yaml
spec:
  ttlSecondsAfterFinished: 86400
```

One day is a reasonable training example because it gives the team time to inspect logs after a release. Production values vary. A compliance-sensitive report may keep longer evidence in a logging system while allowing Kubernetes objects to clean up quickly. A risky migration may keep the Job object until a human deletes it after review.

Check completed Jobs with:

```bash
$ kubectl get jobs -n notifications --sort-by=.metadata.creationTimestamp
NAME                                      COMPLETIONS   DURATION   AGE
notification-add-provider-status-20260614 1/1           42s        23h
notification-delivery-summary-28662240    1/1           2m18s      8h
```

The Job object is not your long-term audit system. Send application logs and operation records to durable systems, then let Kubernetes cleanup handle the workload objects.

## A Nightly CronJob
<!-- section-summary: A CronJob creates Jobs from a schedule, so the schedule, concurrency policy, deadline, and Job template all shape production behavior. -->

A **CronJob** is a Kubernetes controller that creates Jobs on a schedule. It fits repeated finite work. For the Customer Notification Platform, a nightly cleanup can expire stale delivery attempts that have been waiting too long after a provider outage.

Start with the outer CronJob shape:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: notification-expire-stale-deliveries
  namespace: notifications
spec:
  schedule: "15 2 * * *"
  timeZone: "Etc/UTC"
```

The schedule uses cron syntax. `"15 2 * * *"` means 02:15 every day. `timeZone: "Etc/UTC"` keeps the schedule aligned with most logs, metrics, and incident timelines.

Add behavior controls:

```yaml
spec:
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 900
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
```

`concurrencyPolicy: Forbid` skips a new run if the previous run is still active. `startingDeadlineSeconds: 900` gives Kubernetes 15 minutes to start a missed run before skipping it. The history limits keep a small number of old Job objects for quick inspection.

Then add the Job template:

```yaml
spec:
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: cleanup
              image: ghcr.io/customer-notification/notification-worker:2026.06.14-2
              command: ["node"]
              args: ["scripts/expire-stale-deliveries.js"]
```

The CronJob creates a Job from this template each time the schedule fires. The Job then creates Pods and tracks completion, just like the one-time Job earlier.

## CronJob Scheduling Rules
<!-- section-summary: CronJob fields decide when Jobs are created, how overlapping runs behave, and how missed schedules are handled. -->

The **schedule** decides the intended run times. Kubernetes checks the schedule and creates Jobs when they are due. A CronJob does not mean the script runs inside one long-lived Pod. It creates separate Job objects over time.

The **timeZone** field makes the schedule explicit. UTC is usually the least surprising choice for platform operations because logs, metrics, and incident timelines often use UTC. A business report that must match a regional day may use a regional time zone, and the runbook should say why.

The **concurrency policy** handles overlap:

| Policy | Meaning | Notification example |
|---|---|---|
| `Allow` | New Jobs can run while old ones are still active | A harmless report generator with independent outputs |
| `Forbid` | Skip a new Job if the previous one is still active | Stale delivery cleanup that should avoid two active cleanups |
| `Replace` | Stop the active Job and create a new one | A cache refresh where only the newest run is useful |

The **starting deadline** handles missed schedules. If the control plane was unavailable at 02:15 and recovers at 02:28, `startingDeadlineSeconds: 900` still allows the run. If it recovers at 03:00, Kubernetes skips that missed run.

You can suspend a CronJob as an emergency brake:

```bash
$ kubectl patch cronjob -n notifications notification-expire-stale-deliveries \
  -p '{"spec":{"suspend":true}}'
cronjob.batch/notification-expire-stale-deliveries patched
```

`suspend: true` stops new Jobs from being created. It does not stop Jobs that already exist, so check active Jobs separately during an incident.

## Debugging Failed, Missed, and Duplicate Runs
<!-- section-summary: CronJob debugging follows the parent CronJob, child Jobs, Pod attempts, events, and application operation keys. -->

For a failed Job, check conditions and Pod exit codes. `kubectl describe job` shows events such as `BackoffLimitExceeded`, deadline failures, and Pod creation problems. `kubectl describe pod` shows scheduling events, image pull failures, mount failures, and container termination details.

```bash
$ kubectl describe job -n notifications notification-add-provider-status-20260614
Conditions:
  Type    Status  Reason
  Failed  True    BackoffLimitExceeded
Events:
  Warning  BackoffLimitExceeded  Job has reached the specified backoff limit
```

For a missed CronJob run, check three things. First, `suspend` may be `true`. Second, `startingDeadlineSeconds` may have caused Kubernetes to skip a late run. Third, `concurrencyPolicy: Forbid` may have skipped a run because the previous Job was still active.

```bash
$ kubectl get cronjob -n notifications notification-expire-stale-deliveries
NAME                                  SCHEDULE     SUSPEND   ACTIVE   LAST SCHEDULE
notification-expire-stale-deliveries  15 2 * * *   False     1        2026-06-14T02:15:00Z

$ kubectl get jobs -n notifications --sort-by=.metadata.creationTimestamp
```

For duplicate-looking runs, compare the scheduled timestamp, Job creation times, and application operation keys. Kubernetes can show which Job objects ran. The script and database should show whether the same business operation ran twice or whether two different scheduled windows ran close together after recovery.

## Production Runbooks
<!-- section-summary: Runbooks turn the object fields into repeatable operating steps for failed Jobs, missed schedules, and unsafe retries. -->

Production batch work needs simple runbooks because incidents usually happen during a release, a maintenance window, or an early morning scheduled task. The runbook should tell the operator what to inspect, what can be retried safely, and what evidence to collect before deleting anything.

For a **failed migration Job**, keep the failed Job until the team reads the logs. Check `kubectl describe job`, failed Pod logs, and the database migration table. If the script failed before it changed data, fix the image or configuration and apply a new Job with a new name. If the script changed some data, ask the application owner to confirm the retry path because Kubernetes retry controls cannot prove business safety.

```bash
$ kubectl describe job -n notifications notification-add-provider-status-20260614
$ kubectl logs -n notifications job/notification-add-provider-status-20260614 --all-containers=true
$ kubectl get pods -n notifications -l job-name=notification-add-provider-status-20260614 -o yaml
```

For a **Job that keeps retrying**, identify whether failures are transient or deterministic. Image pull errors, missing Secrets, and bad command names need a manifest or cluster fix. Database timeouts may need lower `parallelism`, a larger deadline, or an application-side query fix. After the cause is known, stop the broken run if it is creating load.

```bash
$ kubectl delete job -n notifications notification-delivery-status-backfill
$ kubectl apply -f notification-delivery-status-backfill-fixed.yaml
```

For a **missed CronJob run**, decide whether the business process still needs that window. Stale delivery cleanup can often run late through a manual Job created from the CronJob template. A customer billing or compliance notification may need stronger duplicate controls and approval before a manual run.

```bash
$ kubectl create job -n notifications \
  notification-expire-stale-deliveries-manual-20260614 \
  --from=cronjob/notification-expire-stale-deliveries
$ kubectl logs -n notifications job/notification-expire-stale-deliveries-manual-20260614 --follow
```

For a **duplicate run concern**, look for the operation key in application logs and in the database. The runbook should name the table or dashboard that proves whether the business action happened once. For notification cleanup, the script can record `operation_key`, `started_at`, `finished_at`, `expired_count`, and `status` in an `ops_batch_runs` table.

For a **scheduled task rollout**, change the CronJob manifest through the same delivery process as application deployments. Use a pull request, server-side dry run, staging test, and manual `kubectl create job --from=cronjob/...` test for risky scripts. Watch the first production run and keep a rollback plan, which may mean applying the previous manifest or suspending the CronJob while the team fixes the script.

## Choosing the Right Workload
<!-- section-summary: Deployments, Jobs, and CronJobs each fit a different shape of application work around the same service. -->

The Customer Notification Platform now has three workload shapes around the same application. The API server uses a Deployment because it serves traffic continuously. The worker uses a Deployment because it should keep consuming queue messages. The release migration uses a Job because it should finish once and leave a clear result. The stale delivery cleanup uses a CronJob because it creates finite Jobs on a schedule.

The choice starts with the process lifecycle. If the process should keep running and receive traffic or queue messages, use a Deployment. If the process should finish after one unit of work, use a Job. If the process should create finished units of work on a calendar, use a CronJob.

| Workload | Best fit | Notification example |
|---|---|---|
| Deployment | Long-running replicated service | `notification-api` HTTP server |
| Deployment | Long-running replicated worker | `notification-worker` queue consumer |
| Job | One-time or finite work | Schema migration or delivery-status backfill |
| CronJob | Scheduled finite work | Nightly stale delivery cleanup |

The production habits carry across all of them. Put manifests in version control, use stable labels, set resource requests, read events before guessing, ship logs to a central system, and make scripts safe to retry. Kubernetes gives you the controller behavior, and your application code gives the business safety.

![Workload choice for notification work infographic comparing Deployment keeps serving, Job finishes once, CronJob runs on schedule, and the shared operation key, retry safety, and central logs practices](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/workload-choice-orders-work.png)

_This infographic summarizes the controller choice around the same application: keep services running with Deployments, finish one unit with Jobs, and schedule repeated finite work with CronJobs._

---

**References**

- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/) - Overview of Kubernetes workload resources and the controllers that manage Pods.
- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) - Official Job behavior, completions, parallelism, retry controls, deadlines, indexed Jobs, and Job patterns.
- [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) - Official CronJob schedule, time zone, concurrency policy, missed schedule, and history behavior.
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/) - Official TTL controller behavior for finished Jobs.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) - Generated reference for listing Kubernetes resources.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Generated reference for inspecting resource details and events.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Generated reference for reading container and Job logs.
