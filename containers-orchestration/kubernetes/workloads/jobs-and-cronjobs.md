---
title: "Jobs and CronJobs"
description: "Run finite Kubernetes work with Jobs and scheduled recurring work with CronJobs."
overview: "Jobs and CronJobs handle finite Kubernetes tasks that should finish. This article uses `devpolaris-orders-api` maintenance tasks to show completions, retries, schedules, and failure diagnosis."
tags: ["jobs", "cronjobs", "batch", "kubectl"]
order: 3
id: article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs
---

## Table of Contents

1. [What This Article Covers](#what-this-article-covers)
2. [Finite Work and Long-Running Services](#finite-work-and-long-running-services)
3. [A One-Time Migration Job](#a-one-time-migration-job)
4. [Completions and Parallelism](#completions-and-parallelism)
5. [Retries, Deadlines, and Idempotency](#retries-deadlines-and-idempotency)
6. [Cleaning Up Finished Jobs](#cleaning-up-finished-jobs)
7. [A Nightly CronJob](#a-nightly-cronjob)
8. [CronJob Scheduling Rules](#cronjob-scheduling-rules)
9. [Debugging Failed, Missed, and Duplicate Runs](#debugging-failed-missed-and-duplicate-runs)
10. [Production Runbooks](#production-runbooks)
11. [Choosing the Right Workload](#choosing-the-right-workload)

## What This Article Covers
<!-- section-summary: Jobs and CronJobs handle Kubernetes work that has an end point, and the article builds from one run to scheduled operations. -->

In the workloads section, you have already seen Kubernetes objects that keep applications running. A **Deployment** is a good fit for `devpolaris-orders-api` because the API should keep accepting HTTP requests from customers, health checks, and internal services. Kubernetes keeps the desired number of API Pods available, replaces broken Pods, and rolls out new versions over time.

Some work around the same application has a different shape. The orders team sometimes needs to run a database migration during a release, backfill old rows after a data fix, expire abandoned checkout sessions every night, or send a daily settlement report to finance. Each of those tasks should start, do the work, and finish with a clear success or failure.

That is where **Jobs** and **CronJobs** enter the story. A **Job** creates one or more Pods and tracks whether enough of them finished successfully. A **CronJob** creates Jobs from a schedule, like a Kubernetes-native version of a cron entry, with Kubernetes status, events, logs, and retry behavior around it.

We will stay with one production scenario: `devpolaris-orders-api` runs as a normal service, and the platform team uses Jobs and CronJobs for supporting cluster operations. That gives us a clean path through the main concepts: one-time work, completions, parallelism, retries, deadlines, cleanup, schedules, missed runs, duplicate protection, and practical debugging.

## Finite Work and Long-Running Services
<!-- section-summary: A Job fits work with a clear finish line, while a Deployment fits processes that should keep serving traffic. -->

**Finite work** means the task has a natural end. A migration script exits after it changes the schema. A backfill script exits after it processes a range of order IDs. A report generator exits after it writes the report. The exit code matters because Kubernetes uses it to decide whether the Pod attempt succeeded.

A **long-running service** keeps running until the platform replaces it, scales it, or shuts it down. `devpolaris-orders-api` is that kind of process. It listens on a port, receives traffic through a Service, answers requests, and should keep running for days or weeks at a time.

This distinction changes the Kubernetes object you choose. A Deployment treats a stopped container as something that needs replacement, even when the process exited with code `0`. A Job treats a successful exit as the goal. That one difference saves teams from accidentally turning a database migration into a loop that keeps creating new migration Pods.

For the orders team, this is the first rule during release planning. The API server stays in a Deployment. The release migration runs as a Job. The nightly checkout cleanup runs as a CronJob because it repeats on a schedule. The same container image can support all three paths, but each path needs the workload controller that matches how the process should behave.

![Job runs to completion infographic showing a Job creating Pod attempts, retrying failed attempts, and reaching Complete after an exit zero result with status, events, and logs as evidence](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/job-runs-to-completion.png)

_This infographic shows why a Job fits finite work: Kubernetes treats a successful exit as the goal and keeps status, events, and logs around for evidence._

## A One-Time Migration Job
<!-- section-summary: A Job wraps a Pod template and records success after the required Pod completions finish. -->

A **Job** is a Kubernetes controller for one-time or finite work. It owns a Pod template, creates Pods from that template, and watches those Pods until the required number of successful completions happens. In simple release work, the required number is usually one successful Pod.

Imagine the orders team ships a release that adds `payment_status` to the orders database. The migration already lives in the application image as `node scripts/migrate.js`. The release engineer wants Kubernetes to run that command once, keep the logs available, and show a clear status in `kubectl`.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-add-payment-status-20260614
  namespace: orders
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/component: migration
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
        app.kubernetes.io/component: migration
    spec:
      restartPolicy: Never
      serviceAccountName: orders-maintenance
      containers:
        - name: migrate
          image: ghcr.io/devpolaris/orders-api:2026.06.14
          imagePullPolicy: IfNotPresent
          command: ["node", "scripts/migrate.js"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-db
                  key: url
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 512Mi
```

The manifest says several important things out loud. The **Pod template** under `spec.template` describes the actual container that will run. The `command` replaces the normal API startup command with the migration script. The `serviceAccountName` gives the Pod the Kubernetes identity it needs, and the Secret reference gives it the database connection string without placing the password inside the manifest.

The Job controls live in the outer `spec`. `backoffLimit: 2` allows a small number of failed Pod attempts before Kubernetes marks the Job failed. `activeDeadlineSeconds: 900` gives the whole Job 15 minutes, which protects the release from a migration that hangs forever. `ttlSecondsAfterFinished: 86400` asks Kubernetes to remove the finished Job and its dependent Pods after one day, so the team gets a useful debugging window without keeping old release objects forever.

The normal workflow starts with a server-side dry run, then an apply, then a watch on Job status. This mirrors how real teams handle release-time Jobs because the same manifest can go through pull request review, CI validation, and GitOps reconciliation before it touches production.

```bash
kubectl apply --dry-run=server -f orders-add-payment-status-job.yaml
kubectl apply -f orders-add-payment-status-job.yaml
kubectl get job -n orders orders-add-payment-status-20260614 --watch
```

After the Job finishes, the first verification step reads the Job status. The second step reads the Pod logs because the script should print the migration version, the database it connected to, and the final row or schema check it performed.

```bash
kubectl get job -n orders orders-add-payment-status-20260614
kubectl get pods -n orders -l job-name=orders-add-payment-status-20260614
kubectl logs -n orders job/orders-add-payment-status-20260614
kubectl describe job -n orders orders-add-payment-status-20260614
```

In production, the application team should also verify outside Kubernetes. For this migration, that means checking the schema migration table in the database, checking the API release health dashboard, and confirming that new orders can move through the expected payment states. Kubernetes can tell you whether the script exited successfully, and the application checks prove the business workflow still works.

## Completions and Parallelism
<!-- section-summary: completions defines how many successful Pods are needed, and parallelism defines how many may run at the same time. -->

The migration Job needed one successful Pod, so the default completion behavior worked. A backfill has a different shape. Suppose `devpolaris-orders-api` introduced a new `risk_score` field and the team needs to calculate it for 8 million historical orders. One Pod can do the work, but it might take many hours and it puts all progress into one process.

Kubernetes Jobs can split finite work across multiple Pods. **completions** tells the Job how many successful Pod completions are required. **parallelism** tells the Job how many Pods may run at the same time. Together, they let the team decide how much work to run and how much concurrency the database can safely handle.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-risk-score-backfill
  namespace: orders
spec:
  completions: 20
  parallelism: 4
  completionMode: Indexed
  backoffLimitPerIndex: 1
  maxFailedIndexes: 2
  template:
    spec:
      restartPolicy: Never
      serviceAccountName: orders-maintenance
      containers:
        - name: backfill
          image: ghcr.io/devpolaris/orders-api:2026.06.14
          command: ["node", "scripts/backfill-risk-score.js"]
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
            - name: SHARD_COUNT
              value: "20"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-db
                  key: url
          resources:
            requests:
              cpu: 200m
              memory: 512Mi
            limits:
              memory: 1Gi
```

This example uses **indexed completions**, where each successful Pod gets an index. The script can use that index to process one shard, such as orders where `order_id % 20` equals the index. That pattern gives every Pod a clear slice of work and makes retries safer because a retried Pod repeats the same shard.

The concurrency decision belongs to production capacity planning. `parallelism: 4` means at most four backfill Pods run at once. If each Pod reads heavily from the orders database, four may already be plenty. A team usually tests the script in staging, watches database CPU, locks, query latency, and connection counts, then chooses a production parallelism value that leaves room for live customer traffic.

The basic status checks show both progress and placement. The `-o wide` output helps you see which nodes ran the work, and the label selector keeps the command focused on this Job's Pods.

```bash
kubectl get job -n orders orders-risk-score-backfill
kubectl get pods -n orders -l job-name=orders-risk-score-backfill -o wide
kubectl logs -n orders -l job-name=orders-risk-score-backfill --all-containers=true --tail=100
```

The important design habit is to make batch work **idempotent**. An idempotent script can run again for the same input and still leave correct data. For the risk-score backfill, that could mean updating rows by primary key, writing a `backfilled_at` timestamp only after a successful calculation, and skipping rows that already have a valid score from the same algorithm version.

![Indexed Job shards infographic showing eight million orders split into shards zero through nineteen, parallelism four, completion index, idempotent processing, and safe writes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/indexed-job-shards.png)

_This infographic shows the backfill pattern visually: each indexed Pod owns a predictable shard, while parallelism limits how much database pressure the Job creates at once._

## Retries, Deadlines, and Idempotency
<!-- section-summary: retry settings protect transient failures, while deadlines and idempotent scripts protect production from endless or unsafe work. -->

Retries are useful because batch work often hits temporary failures. The database may restart during maintenance, a node may disappear during an autoscaler event, or the registry may briefly fail an image pull. Kubernetes can create another Pod attempt and give the work a chance to finish without a human restarting it manually.

The main retry field for normal Jobs is **backoffLimit**. It sets how many failed Pod attempts Kubernetes will tolerate before it marks the Job failed. For indexed Jobs, newer Kubernetes versions also support index-aware controls such as `backoffLimitPerIndex` and `maxFailedIndexes`, which help large shard-based Jobs finish the successful shards while tracking the failed ones separately.

The time-limit field is **activeDeadlineSeconds**. It sets the maximum duration for the whole Job. This matters for scripts that can hang while waiting on a database lock, a slow external API, or a bug in pagination. The deadline gives the release or operations team a clear stop point instead of a Job that keeps consuming resources overnight.

`restartPolicy` controls what happens inside the Pod after a container exits. Job Pods commonly use `Never` because a failed container produces a failed Pod, and the Job controller creates a new Pod attempt. `OnFailure` restarts the failed container inside the same Pod, which can be useful for some simple scripts, but it gives you fewer separate Pods to inspect during failure analysis.

Here is a safer migration shape for the orders team. The manifest allows two retries, stops after 15 minutes, and keeps logs for one day. The script should also use database-level safety: transactions where appropriate, advisory locks for one-at-a-time migrations, and checks that skip already-applied schema changes.

```yaml
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
```

The operational caution is simple and very practical. Kubernetes can retry the container; Kubernetes cannot know whether your script is safe to retry. A payment capture script, a customer email sender, or a settlement exporter needs application-level duplicate protection before you let Kubernetes retry it.

For `devpolaris-orders-api`, the team records a unique operation key for any script that changes money-related state. A settlement Job might write `settlement_id=2026-06-14` and use a database unique constraint so a retried Pod cannot create a duplicate payout. The Kubernetes Job gives the retry structure, and the application data model gives the duplicate guard.

## Cleaning Up Finished Jobs
<!-- section-summary: Job history is useful for debugging, and TTL cleanup keeps finished Jobs and Pods from filling the namespace forever. -->

Finished Jobs are useful because they keep status and logs available while a release is still fresh. A release engineer can inspect the exact Pod that ran a migration, read events, and confirm how long the task took. That history loses value after the team has verified the release and the logs have moved into the central logging system.

Kubernetes supports automatic cleanup for finished Jobs with **ttlSecondsAfterFinished**. After a Job reaches a terminal state such as `Complete` or `Failed`, the TTL controller can delete the Job after the configured number of seconds. Kubernetes deletes dependent Pods with the Job, so this setting affects how long Pod logs remain available through `kubectl logs`.

```yaml
spec:
  ttlSecondsAfterFinished: 86400
```

The orders team uses a simple convention. Release migrations keep one day of Kubernetes history because the team usually verifies the release on the same day. Large backfills keep several days because operators may need to compare shard logs after business-hours review. CronJobs use their own history limits, which we will cover in the schedule section.

Before relying on TTL cleanup, make sure logs and metrics leave the node. Production clusters usually ship container logs to a logging platform and scrape metrics into a monitoring system. TTL cleanup should remove old Kubernetes objects while the long-term evidence stays in the logging system.

## A Nightly CronJob
<!-- section-summary: A CronJob creates Jobs from a schedule and adds time, missed starts, overlap, and history to the finite-work story. -->

A **CronJob** is a Kubernetes controller that creates Jobs on a schedule. It uses the same Job template ideas we just covered, then adds schedule fields around them. This is a good fit for the orders cleanup task because abandoned checkout sessions should expire every night without a person opening a terminal.

The schedule below runs at 02:15 UTC every day. The time zone is explicit, the overlap policy is conservative, and the history limits keep a small number of recent successes and failures visible.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: orders-expire-checkouts
  namespace: orders
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/component: maintenance
spec:
  schedule: "15 2 * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 1200
      template:
        metadata:
          labels:
            app.kubernetes.io/name: devpolaris-orders-api
            app.kubernetes.io/component: checkout-cleanup
        spec:
          restartPolicy: Never
          serviceAccountName: orders-maintenance
          containers:
            - name: expire-checkouts
              image: ghcr.io/devpolaris/orders-api:2026.06.14
              command: ["node", "scripts/expire-checkouts.js"]
              env:
                - name: DRY_RUN
                  value: "false"
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: orders-db
                      key: url
              resources:
                requests:
                  cpu: 100m
                  memory: 256Mi
                limits:
                  memory: 512Mi
```

The five schedule fields deserve careful review. `schedule` is the cron expression. `timeZone` tells Kubernetes which time zone to use for the schedule. `concurrencyPolicy: Forbid` skips a new run if the previous run is still active, which protects the database from two cleanup scripts racing through the same rows. `startingDeadlineSeconds` gives the controller a catch-up window after a missed start. The two history limit fields keep recent Job objects around for inspection.

Apply and inspect the CronJob like any other Kubernetes object. The `kubectl create job --from=cronjob/...` command is especially useful because it lets you test the exact Job template on demand without waiting for the next scheduled time.

```bash
kubectl apply --dry-run=server -f orders-expire-checkouts-cronjob.yaml
kubectl apply -f orders-expire-checkouts-cronjob.yaml
kubectl get cronjob -n orders orders-expire-checkouts
kubectl describe cronjob -n orders orders-expire-checkouts
kubectl create job -n orders orders-expire-checkouts-manual-20260614 --from=cronjob/orders-expire-checkouts
kubectl logs -n orders job/orders-expire-checkouts-manual-20260614
```

The application-level verification should match the business purpose. For checkout expiry, the script should log how many rows it scanned, how many sessions it expired, and the oldest remaining eligible session. The team should also check the orders dashboard for a normal drop in stale checkout count after the nightly run.

## CronJob Scheduling Rules
<!-- section-summary: CronJobs need explicit choices for time zone, overlap, late starts, and retained history because schedules create operational edge cases. -->

The cron expression is only the first part of scheduled work. Time zone, overlap behavior, late starts, and history all affect what happens during real operations. These settings deserve code review because they decide how the cluster behaves at 02:15 when nobody is watching.

The **schedule** field uses standard cron-style syntax with five fields: minute, hour, day of month, month, and day of week. `"15 2 * * *"` means minute 15 of hour 2 on every day of the month, every month, every day of week. With `timeZone: "Etc/UTC"`, that means 02:15 UTC.

The **timeZone** field matters because clusters, engineers, and business processes may live in different places. UTC is usually the least surprising choice for platform operations because logs, metrics, and incident timelines often use UTC. A business report that must match a local finance day may choose a regional time zone, but that choice should appear in the manifest and in the runbook.

The **concurrencyPolicy** field controls overlap. `Allow` permits overlapping Jobs. `Forbid` skips a new run when the previous run is still active. `Replace` stops the active run and starts the new one. For `orders-expire-checkouts`, `Forbid` is the safest default because it avoids two cleanup runs competing over the same checkout sessions.

The **startingDeadlineSeconds** field controls late starts. If the controller misses the scheduled time because the control plane was unavailable, overloaded, or recovering, this value sets how late the start can be. For the orders cleanup, `1800` gives the controller a 30-minute window. A run missed by two hours gets skipped, which may be better than running a cleanup during peak traffic.

The **history limits** control how many finished Job objects remain after scheduled runs. The orders team keeps more failures than successes because failures need investigation. A common starting point is `successfulJobsHistoryLimit: 3` and `failedJobsHistoryLimit: 5`, with centralized logs as the long-term record.

| Field | What it controls | Orders cleanup choice |
|---|---|---|
| `schedule` | The cron expression for when Jobs should be created | `"15 2 * * *"` |
| `timeZone` | The time zone used to interpret the schedule | `"Etc/UTC"` |
| `concurrencyPolicy` | What happens when a previous run is still active | `Forbid` |
| `startingDeadlineSeconds` | How late a missed run can start | `1800` |
| `successfulJobsHistoryLimit` | Successful Job objects to keep | `3` |
| `failedJobsHistoryLimit` | Failed Job objects to keep | `5` |

One caution sits behind every scheduled task. CronJobs can create duplicate-looking work during retries, controller restarts, manual test runs, or human recovery actions. The script should use business keys, locks, or database constraints so each scheduled window has a safe identity, such as `checkout-expiry-2026-06-14`.

## Debugging Failed, Missed, and Duplicate Runs
<!-- section-summary: A good debugging flow moves from CronJob status to Job status, then Pod events, logs, and application-level evidence. -->

When a scheduled task fails, start at the highest object and walk down. The CronJob tells you when Kubernetes last scheduled the work. The Job tells you whether the finite work reached completion. The Pod tells you why the container failed, stayed pending, or failed to start.

The first command checks the CronJob schedule and active Jobs. This quickly answers whether Kubernetes thinks the schedule exists, whether it has a recent last schedule time, and whether a previous run is still active.

```bash
kubectl get cronjob -n orders orders-expire-checkouts
kubectl describe cronjob -n orders orders-expire-checkouts
```

Then list the Jobs the CronJob created. The labels may vary by cluster version and controller behavior, so the safe fallback is to sort by creation timestamp and inspect the Job names that start with the CronJob name.

```bash
kubectl get jobs -n orders --sort-by=.metadata.creationTimestamp
kubectl get jobs -n orders | grep orders-expire-checkouts
kubectl describe job -n orders orders-expire-checkouts-28697175
```

After that, move to Pods and logs. A Job can fail because the container exited with a nonzero status, the image pull failed, the Pod lacked Secret access, the node had no capacity, or the script hit an application error. Pod status, events, and logs separate those cases.

```bash
kubectl get pods -n orders -l job-name=orders-expire-checkouts-28697175 -o wide
kubectl describe pod -n orders -l job-name=orders-expire-checkouts-28697175
kubectl logs -n orders job/orders-expire-checkouts-28697175 --all-containers=true
kubectl logs -n orders job/orders-expire-checkouts-28697175 --previous --all-containers=true
```

For a failed Job, check the Job conditions and the Pod exit codes. `kubectl describe job` shows events such as `BackoffLimitExceeded`, deadline failures, and Pod creation problems. `kubectl describe pod` shows scheduling events, image pull failures, mount failures, and container termination details.

For a missed CronJob run, check three things. First, `suspend` may be set to `true`, which pauses new Job creation. Second, `startingDeadlineSeconds` may have caused Kubernetes to skip a late run. Third, `concurrencyPolicy: Forbid` may have skipped a run because the previous Job was still active.

```bash
kubectl get cronjob -n orders orders-expire-checkouts -o yaml
kubectl get jobs -n orders --sort-by=.metadata.creationTimestamp
kubectl get events -n orders --sort-by=.lastTimestamp
```

For duplicate-looking runs, compare the scheduled timestamp, Job creation times, and application operation keys. Kubernetes can show which Job objects ran. The script and database should show whether the same business operation ran twice or whether two different scheduled windows ran close together after a recovery.

## Production Runbooks
<!-- section-summary: Runbooks turn the object fields into repeatable operating steps for failed Jobs, missed schedules, and unsafe retries. -->

Production batch work needs simple runbooks because incidents usually happen during a release, a maintenance window, or an early morning scheduled task. The runbook should tell the operator what to inspect, what can be retried safely, and what evidence to collect before deleting anything.

For a **failed migration Job**, keep the failed Job until the team reads the logs. Check `kubectl describe job`, the failed Pod logs, and the database migration table. If the script failed before it changed data, fix the image or configuration and apply a new Job with a new name. If the script changed some data, ask the application owner to confirm the retry path because Kubernetes retry controls cannot prove business safety.

```bash
kubectl describe job -n orders orders-add-payment-status-20260614
kubectl logs -n orders job/orders-add-payment-status-20260614 --all-containers=true
kubectl get pods -n orders -l job-name=orders-add-payment-status-20260614 -o yaml
```

For a **Job that keeps retrying**, identify whether the failures are transient or deterministic. Image pull errors, missing Secrets, and bad command names need a manifest or cluster fix. Database timeouts may need a lower `parallelism`, a larger deadline, or an application-side query fix. After the cause is known, stop the broken run if it is creating load.

```bash
kubectl delete job -n orders orders-risk-score-backfill
kubectl apply -f orders-risk-score-backfill-fixed.yaml
```

For a **missed CronJob run**, decide whether the business process still needs that window. Checkout expiry can often run late through a manual Job created from the CronJob template. A customer invoice sender may need stronger duplicate controls and finance approval before a manual run.

```bash
kubectl create job -n orders orders-expire-checkouts-manual-20260614 --from=cronjob/orders-expire-checkouts
kubectl logs -n orders job/orders-expire-checkouts-manual-20260614 --follow
```

For a **duplicate run concern**, look for the operation key in application logs and in the database. The runbook should name the table or dashboard that proves whether the business action happened once. For the orders cleanup, the script can record `operation_key`, `started_at`, `finished_at`, `expired_count`, and `status` in an `ops_batch_runs` table.

For a **scheduled task rollout**, change the CronJob manifest through the same delivery process as application deployments. Use a pull request, server-side dry run, staging test, and manual `kubectl create job --from=cronjob/...` test for risky scripts. Watch the first production run and keep a rollback plan, which may mean applying the previous manifest or suspending the CronJob while the team fixes the script.

```bash
kubectl patch cronjob -n orders orders-expire-checkouts -p '{"spec":{"suspend":true}}'
kubectl patch cronjob -n orders orders-expire-checkouts -p '{"spec":{"suspend":false}}'
```

`suspend: true` stops new Jobs from being created by the CronJob. It leaves existing Jobs alone, so check active Jobs separately if the current run is the problem. This is a useful emergency brake for a broken schedule, and it should appear in the operational notes for every important CronJob.

## Choosing the Right Workload
<!-- section-summary: Deployments, Jobs, and CronJobs each fit a different shape of application work around the same service. -->

The orders platform now has three different workload shapes around the same application. The API server uses a Deployment because it serves traffic continuously. The release migration uses a Job because it should finish once and leave a clear result. The checkout cleanup uses a CronJob because it creates finite Jobs on a schedule.

The choice starts with the process lifecycle. If the process should keep running and receive traffic, use a Deployment. If the process should finish after one unit of work, use a Job. If the process should create finished units of work on a calendar, use a CronJob.

| Workload | Best fit | Orders example |
|---|---|---|
| Deployment | Long-running replicated service | `devpolaris-orders-api` HTTP server |
| Job | One-time or finite work | Schema migration or risk-score backfill |
| CronJob | Scheduled finite work | Nightly abandoned checkout cleanup |

The production habits carry across all of them. Put manifests in version control, use stable labels, set resource requests, read events before guessing, ship logs to a central system, and make scripts safe to retry. Kubernetes gives you the controller behavior, and your application code gives the business safety.

![Workload choice for orders work infographic comparing Deployment keeps serving, Job finishes once, CronJob runs on schedule, and the shared operation key, retry safety, and central logs practices](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/workload-choice-orders-work.png)

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
