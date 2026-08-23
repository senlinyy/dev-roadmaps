---
title: "Jobs and CronJobs"
description: "Run finite Kubernetes work with Jobs and create scheduled Jobs with CronJobs."
overview: "Jobs turn successful process exits into a completion goal. CronJobs create those Jobs from a schedule. Both need deliberate retry, duplicate-work, concurrency, and cleanup rules."
tags: ["jobs", "cronjobs", "batch", "kubectl"]
order: 3
id: article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs
---

## Table of Contents

1. [How does a Job turn Pod attempts into a completion result?](#how-does-a-job-turn-pod-attempts-into-a-completion-result)
2. [How do completions, parallelism, and completion mode divide work?](#how-do-completions-parallelism-and-completion-mode-divide-work)
3. [How do retries, deadlines, and Pod failure rules interact?](#how-do-retries-deadlines-and-pod-failure-rules-interact)
4. [Why must batch work be safe to repeat?](#why-must-batch-work-be-safe-to-repeat)
5. [How does a CronJob turn a schedule into separate Jobs?](#how-does-a-cronjob-turn-a-schedule-into-separate-jobs)
6. [How do overlap, missed schedules, history, and cleanup policies work together?](#how-do-overlap-missed-schedules-history-and-cleanup-policies-work-together)
7. [How do you inspect, rerun, suspend, and diagnose batch work?](#how-do-you-inspect-rerun-suspend-and-diagnose-batch-work)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Kubernetes is a reconciliation system. You describe a condition that should be true, a controller observes the current state, and the controller creates or changes objects until the observed state matches that condition.

Different workload controllers exist because the desired condition changes with the kind of work. A Deployment may say, “Three copies of this program should be running.” If only two copies are running, its controller creates another Pod. A Job may say, “This computation must successfully finish once.” Once one successful completion has been recorded, creating another Pod would move away from the intended result.

Consider a command named `generate-monthly-report`. It starts, generates one report, and exits with code `0`. A Deployment interprets that exit as a missing running replica and starts the program again. A Job interprets the same exit as evidence that the requested work has finished.

The most important distinction is:

> **Deployment controllers preserve existence. Job controllers preserve progress toward completion.**

Long-running API servers, web servers, frontends, and continuous queue consumers usually need a controller that preserves running capacity. Database migrations, data imports, ML training, video transcoding, report generation, backups, and one-time maintenance have a finite result, so successful termination belongs in their desired state.

A CronJob adds scheduling above that completion model. The CronJob decides when a new execution should exist. It creates a Job for that scheduled execution. The Job then creates Pod attempts until the work completes or reaches a terminal failure.

The explanation follows seven questions:

1. **How does a Job turn Pod attempts into a completion result?**
2. **How do completions, parallelism, and completion mode divide work?**
3. **How do retries, deadlines, and Pod failure rules interact?**
4. **Why must batch work be safe to repeat?**
5. **How does a CronJob turn a schedule into separate Jobs?**
6. **How do overlap, missed schedules, history, and cleanup policies work together?**
7. **How do you inspect, rerun, suspend, and diagnose batch work?**

## How does a Job turn Pod attempts into a completion result?
<!-- section-summary: A Job creates Pods from one template and reaches completion after the configured number of successful Pod exits. -->

A Job is the durable record for one finite piece of work. The Job remains in the API while individual Pods attempt that work, so Kubernetes can replace a failed attempt without losing the completion goal.

### A Job owns the work; Pods are attempts

A Job does not execute a program by itself. It stores a Pod template and a completion goal. The Job controller uses that template to create Pods, and each Pod provides an environment in which a container process makes one attempt at the work.

The smallest useful Job can look like this:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: report
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: report
          image: example/report-generator:1.0
```

When `completions` and `parallelism` are omitted, they effectively default to `1`. The controller initially sees that the Job requires one successful completion and has recorded none, so it creates one Pod.

If the process exits with code `0`, the Pod reaches the `Succeeded` phase. The Job controller observes one required completion and one successful completion, adds the `Complete` condition to the Job, and stops creating Pods.

If the process exits unsuccessfully, the Pod attempt fails. The Job still has zero successful completions, so its controller may create another Pod while the retry and deadline policies allow it. The Job object can therefore remain active across several short-lived Pod objects.

| Level | What it represents | What success means |
|---|---|---|
| Job | One logical piece of finite work | The required successful completions have been recorded |
| Pod | One execution attempt | Its containers finish successfully |
| Container | The process performing that attempt | The process exits with code `0` |

![Studio Light infographic showing a Job creating a failed Pod attempt, retrying, and recording completion after a successful Pod exit](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/job-completion-and-attempts.png)

*The Job owns the completion goal, while each Pod records one attempt to reach it.*

### `restartPolicy` chooses where a failed process retries

Job Pod templates allow `restartPolicy: OnFailure` or `restartPolicy: Never`. These values place the retry at different controller layers.

With `OnFailure`, the Pod remains on the same node and the kubelet can rerun the failed container inside that Pod. One Pod may therefore contain several container runs.

With `Never`, a failed container leaves behind a failed Pod. The Job controller can create a new Pod for the next attempt. This makes the history easier to see:

```text
NAME           READY   STATUS      RESTARTS
report-x8abc   0/1     Error       0
report-k29ds   0/1     Error       0
report-p91kd   0/1     Completed   0
```

`Never` is often easier while learning or diagnosing a batch program because each failed attempt remains a separate Pod with its own status, events, and logs. It is also required when the Job uses `podFailurePolicy`.

## How do completions, parallelism, and completion mode divide work?
<!-- section-summary: Completions describe total successful work units, parallelism limits simultaneous Pods, and completion mode defines how work is assigned. -->

One successful exit is enough for the smallest Job. Larger batch work needs two more decisions: how many successful work units make the whole Job complete, and how many Pods may attempt those units at the same time.

### Total work and simultaneous work are separate decisions

Suppose a batch program must process 100 files. The Job needs to express both the amount of successful work required and how much of that work may run at the same time.

`completions` describes the number of successful executions the Job needs. `parallelism` is the desired ceiling for active Pods. This example needs ten successful completions and allows about three Pods to work concurrently:

```yaml
spec:
  completions: 10
  parallelism: 3
```

As one Pod succeeds, the controller can create another until ten successes have been recorded. The Pods do not need to finish in creation order.

| `completions` | `parallelism` | Result |
|---:|---:|---|
| omitted or `1` | omitted or `1` | Run one task successfully |
| `10` | `1` | Record ten successful executions sequentially |
| `10` | `3` | Record ten successes with up to roughly three active Pods |
| `100` | `20` | Record one hundred successes with up to roughly twenty active Pods |

`parallelism` is a desired concurrency ceiling rather than a promise that exactly that many Pods will always run. The scheduler may find less capacity. Quotas may restrict the Job. Failures and terminating Pods may temporarily change the number of useful workers. Near the end, fewer work units may remain than the configured parallelism.

### NonIndexed completions count successes without assigning item numbers

The default `completionMode: NonIndexed` treats successful completions as interchangeable. Setting `completions: 10` does not assign item numbers `0` through `9` to the Pods. Kubernetes only counts ten successful Pod completions.

The application must decide what each Pod should process. A common design uses a shared work queue from which each Pod claims its next item.

This mode fits work where any worker can take the next available item. Kubernetes controls how many Pod attempts run and how many successes are required; the application controls which input belongs to each attempt.

### Indexed Jobs give stable numbers to pre-partitioned work

Some workloads are already divided into stable partitions such as `0` through `99`. An Indexed Job lets Kubernetes attach one completion index to each work slot:

```yaml
spec:
  completions: 10
  parallelism: 3
  completionMode: Indexed
```

The program can read the assigned slot and process that partition:

```bash
process-partition "$JOB_COMPLETION_INDEX"
```

Kubernetes exposes the assigned number through `JOB_COMPLETION_INDEX`, Pod metadata, and deterministic naming mechanisms. The first active Pods might receive indexes `0`, `1`, and `2`. When capacity becomes free, later Pods may receive `3`, `4`, and `5`. The exact execution order can vary.

Every index must eventually have a successful Pod before the Job completes. If the attempt for index `7` fails, a replacement for that work slot still receives index `7`. The program can therefore map each index to the same partition on every retry.

The three fields now have distinct meanings:

| Field | Meaning |
|---|---|
| `completions` | Number of work slots that must succeed |
| `parallelism` | Number of workers allowed at once |
| `JOB_COMPLETION_INDEX` | The work slot owned by one Pod |

![Studio Light infographic showing an Indexed Job with ten completion indexes and three concurrent Pods, including a retry that keeps the same index](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/indexed-job-shards.png)

*Indexed completion keeps the work-slot identity stable even when the Pod performing that work changes.*

## How do retries, deadlines, and Pod failure rules interact?
<!-- section-summary: Retry budgets count failed attempts, deadlines bound elapsed runtime, and Pod failure policy can classify known exit conditions. -->

Dividing work into slots explains what must succeed. Failure policy answers what Kubernetes should do when one of the Pods assigned to that work does not succeed. A failed attempt raises several separate questions: where the process may retry, how many failures are acceptable, how long the overall Job may remain active, and whether a particular error is worth retrying at all.

| Control | Question it answers |
|---|---|
| `restartPolicy` | Does a failed process rerun inside the same Pod or through a replacement Pod? |
| `backoffLimit` | How many failures may a regular Job tolerate? |
| `activeDeadlineSeconds` | How long may the overall Job remain active? |
| `podFailurePolicy` | Should a particular exit code or Pod condition count, be ignored, or end work immediately? |
| `backoffLimitPerIndex` | How many failures may one Indexed Job slot tolerate? |
| `maxFailedIndexes` | How many failed indexes may the overall Indexed Job accept before stopping? |

### `backoffLimit` bounds failures and slows repeated attempts

An ordinary Job defaults to `backoffLimit: 6`. A smaller explicit limit might look like this:

```yaml
spec:
  backoffLimit: 3
```

After a failed Pod, the controller delays the replacement instead of immediately producing a tight failure loop. The delay grows roughly from 10 seconds to 20 seconds, then 40 seconds, and is capped at six minutes between attempts.

Once the failure count reaches the limit, Kubernetes marks the Job failed and stops trying to satisfy that Job object. The failure is terminal. The controller does not reset the same Job and run it again forever.

### `activeDeadlineSeconds` bounds elapsed Job time

A retry count cannot protect against a process that hangs without exiting. The overall deadline answers a different question:

```yaml
spec:
  activeDeadlineSeconds: 1800
```

This gives the Job at most 30 minutes of active execution. When that time expires, Kubernetes terminates the Job's running Pods and marks the Job failed with reason `DeadlineExceeded`.

The deadline takes precedence over `backoffLimit`. A Job with retry budget remaining still stops when its active deadline is reached.

### `podFailurePolicy` separates temporary failures from permanent ones

An application can use meaningful exit codes. For example:

| Exit code | Application meaning | Useful response |
|---:|---|---|
| `1` | Temporary network problem | Let normal retry handling apply |
| `2` | Malformed input | Treat according to the application's input policy |
| `42` | Invalid application configuration | Fail immediately instead of repeating the same error |

A Job can encode the permanent configuration error like this:

```yaml
spec:
  backoffLimit: 5
  podFailurePolicy:
    rules:
      - action: FailJob
        onExitCodes:
          containerName: worker
          operator: In
          values: [42]
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: example/worker:1.0
```

Exit code `42` now ends the Job without wasting the normal retry budget. Policies can also ignore selected failures or count them normally; Indexed Jobs can additionally fail one index.

`podFailurePolicy` requires `restartPolicy: Never` so the Job controller can classify a terminal Pod result. Pod failure policy is stable from Kubernetes 1.31.

### Indexed Jobs can isolate failure budgets per work slot

With a single global backoff limit, one permanently broken partition can consume retries that were intended for the whole Job. An Indexed Job can instead use:

```yaml
spec:
  completionMode: Indexed
  completions: 10
  parallelism: 3
  backoffLimitPerIndex: 2
  maxFailedIndexes: 1
```

Each index receives its own retry allowance. `maxFailedIndexes` can stop the remaining work after too many slots have failed. Per-index backoff is stable from Kubernetes 1.33.

### A failed Job stays failed

When `backoffLimit`, `activeDeadlineSeconds`, or a failure policy ends a Job, its status is terminal. `restartPolicy` only controls container behavior inside the Job's Pods. Recovering from a terminal Job failure requires a person or a higher-level controller to create another Job.

A CronJob supplies one such higher level for scheduled work. Monday's Job can remain failed as evidence of Monday's execution. When Tuesday's schedule arrives, the CronJob creates a new Job with a new identity rather than resurrecting Monday's object.

## Why must batch work be safe to repeat?
<!-- section-summary: Kubernetes can create another Pod for the same logical work, so the application must make repeated execution safe. -->

This is the most important production lesson about Jobs: one logical piece of work can run more than once.

Suppose a Pod charges a customer's card and the payment provider accepts the charge. Before Kubernetes observes a successful Pod result, the node disappears. The Job controller still sees zero recorded completions, so it may start another Pod for the same work.

Even a Job with one completion, parallelism of one, and `restartPolicy: Never` can sometimes start the same program twice. CronJobs add another duplication boundary because the schedule controller can occasionally create two Jobs for one scheduled time.

Kubernetes therefore provides execution closer to an at-least-once model. Exactly-once business behavior has to come from the application and its durable data systems.

Useful protections include:

- choosing a stable idempotency or business key for one logical operation;
- enforcing uniqueness in the database;
- using transactions or upserts so a retry converges to the same result;
- recording durable checkpoints before moving to the next work unit;
- making repeated processing of one input produce the same final output.

For example, an invoice writer should identify one invoice with a durable `invoice_id`. A blind insert can create a second row when the task repeats:

```sql
INSERT INTO invoices (...) VALUES (...);
```

An upsert can make both attempts converge on the same database record:

```sql
INSERT INTO invoices (invoice_id, ...)
VALUES ('2026-08-12345', ...)
ON CONFLICT (invoice_id)
DO UPDATE ...;
```

The first attempt creates the invoice. A later attempt presents the same key and updates or confirms the same logical result. The Kubernetes controller still retries at the infrastructure layer, while the application prevents that retry from becoming a duplicate business transaction.

Indexed Jobs make this easier when each index maps deterministically to one input partition. Queue-based Jobs still need equivalent repeat-safe application behavior.

## How does a CronJob turn a schedule into separate Jobs?
<!-- section-summary: A CronJob evaluates a schedule and creates a new Job whose template handles execution and completion. -->

### The CronJob controls when; the Job controls completion

A CronJob does not run Pods directly. Its controller evaluates a repeating schedule and creates a one-time Job for each due execution. The Job controller then creates Pod attempts from the Job's template.

| Layer | Question it answers |
|---|---|
| CronJob | When should another execution exist? |
| Job | Has this execution completed successfully? |
| Pod | Where and how does this attempt run? |
| Container | Which program performs the work? |

This separation gives every scheduled execution its own Job status, Pod attempts, logs, and terminal result. A failed run remains visible as one failed Job, while the next scheduled time creates a different Job.

### A cron expression describes the scheduled times

This schedule requests a Job every day at 03:00:

```yaml
spec:
  schedule: "0 3 * * *"
```

The five positions have fixed meanings:

| Position | Value above | Meaning |
|---:|---|---|
| 1 | `0` | Minute 0 |
| 2 | `3` | Hour 3 |
| 3 | `*` | Every day of the month |
| 4 | `*` | Every month |
| 5 | `*` | Every day of the week |

Kubernetes also accepts macros including `@hourly`, `@daily`, `@weekly`, `@monthly`, and `@yearly`.

### The time zone completes the human meaning of a schedule

The expression `0 2 * * *` says “02:00,” but a human still needs to know which 02:00. A CronJob can state that explicitly:

```yaml
spec:
  schedule: "0 2 * * *"
  timeZone: "Etc/UTC"
```

A regional value such as `Europe/London` follows that zone's clock changes. Without `.spec.timeZone`, the controller interprets the schedule using the local time zone of `kube-controller-manager`. Explicitly setting the zone makes infrastructure schedules easier to reason about. The field is stable from Kubernetes 1.27.

### Scheduled creation is approximate

The CronJob controller aims to create one Job for each scheduled time, but distributed coordination can occasionally produce two Jobs or no Job. Scheduled work therefore needs the same repeat-safe application semantics as ordinary Jobs.

![Studio Light infographic showing a CronJob schedule creating separate Jobs, with each Job owning its own Pod attempts and completion state](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-jobs-and-cronjobs/cronjob-schedule-to-job.png)

*The CronJob owns scheduled creation; every child Job owns completion for one scheduled execution.*

## How do overlap, missed schedules, history, and cleanup policies work together?
<!-- section-summary: A useful CronJob combines schedule, overlap, missed-run, history, retry, deadline, and cleanup policies. -->

### `concurrencyPolicy` decides what happens when one run overlaps the next

Suppose a CronJob runs every five minutes, but each Job takes eight minutes. The 12:00 Job is still active when the 12:05 schedule arrives. The CronJob needs an explicit overlap policy.

| Policy | Result at 12:05 while the 12:00 Job is active |
|---|---|
| `Allow` | Create another Job and let both run |
| `Forbid` | Skip overlapping creation |
| `Replace` | Replace the old Job with the new scheduled run |

`Allow` is the default. The policy coordinates only Jobs created by this same CronJob. A manually created Job or another CronJob can still run the same program, so application-level duplicate protection remains necessary.

Backups, billing, and database maintenance often use `Forbid` because overlapping runs may compete for the same data or resources.

### `startingDeadlineSeconds` decides how late a run may begin

Suppose a Job was scheduled for 03:00, but the controller was temporarily unavailable. With this configuration, the run may start up to 15 minutes late:

```yaml
spec:
  startingDeadlineSeconds: 900
```

Returning at 03:07 is within that window, so the controller may still create the Job. Returning at 03:27 is beyond it, so that occurrence is skipped.

`startingDeadlineSeconds` measures lateness before a Job exists. `activeDeadlineSeconds` measures how long the resulting Job may run after it exists. They protect different stages:

| Control | Clock starts from | Question |
|---|---|---|
| `startingDeadlineSeconds` | Scheduled creation time | How late may this CronJob occurrence start? |
| `activeDeadlineSeconds` | Job start | How long may this Job remain active? |

### A complete scheduled task combines policy at three levels

This nightly reconciliation manifest brings the source's scheduling, retry, deadline, history, cleanup, and Pod-execution settings together:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-reconciliation
spec:
  schedule: "15 2 * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 900
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 2
  jobTemplate:
    spec:
      backoffLimit: 3
      activeDeadlineSeconds: 1800
      ttlSecondsAfterFinished: 86400
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: reconciler
              image: ghcr.io/example/reconciler:1.4.2
              command:
                - /app/reconcile
              resources:
                requests:
                  cpu: "250m"
                  memory: "256Mi"
                limits:
                  cpu: "1"
                  memory: "512Mi"
```

Read it from the outside inward. The CronJob creates work every day at 02:15 UTC, prevents overlap, and accepts a start up to 15 minutes late. Each created Job can tolerate limited failures, may run for at most 30 minutes, and becomes eligible for TTL cleanup after one day. Each Pod attempt runs `/app/reconcile` with `restartPolicy: Never`.

The CronJob's history limits keep three successful child Jobs and two failed child Jobs. These values override the CronJob defaults of three successful Jobs and one failed Job. Separately, `ttlSecondsAfterFinished` asks the TTL controller to remove each finished Job and its dependent Pods after 86,400 seconds.

## How do you inspect, rerun, suspend, and diagnose batch work?
<!-- section-summary: Diagnosis follows CronJob schedule state, child Job conditions, Pod events, process logs, and application records. -->

### Follow the controller chain from schedule to process

Start with the highest layer that owns the decision you are investigating:

```bash
# See schedules and current CronJob status
kubectl get cronjobs

# See Jobs created from schedules or by users
kubectl get jobs

# Inspect one Job's completion and failure conditions
kubectl describe job nightly-reconciliation-123456

# Find the individual Pod attempts
kubectl get pods -l job-name=nightly-reconciliation-123456

# Read logs through the Job resource
kubectl logs job/nightly-reconciliation-123456

# Wait for the Job's completion condition
kubectl wait \
  --for=condition=complete \
  job/nightly-reconciliation-123456 \
  --timeout=30m
```

The CronJob explains schedule, suspension, overlap, and missed-run decisions. The child Job explains required completions, active Pods, successes, failures, and terminal conditions. Pod events explain scheduling, image, volume, and node problems. Container logs explain what the program did with its input.

### Create one deliberate run from a CronJob template

You can copy the current Job template into a standalone Job without waiting for the next schedule:

```bash
kubectl create job reconciliation-manual-001 \
  --from=cronjob/nightly-reconciliation
```

This creates a separate Job from the CronJob template.

### Suspension affects future Jobs

Suspend future scheduled creation with:

```bash
kubectl patch cronjob nightly-reconciliation \
  -p '{"spec":{"suspend":true}}'
```

The CronJob stops creating future Jobs, while Jobs that already exist continue under their own controllers. Resume with:

```bash
kubectl patch cronjob nightly-reconciliation \
  -p '{"spec":{"suspend":false}}'
```

Missed occurrences may become eligible when the CronJob resumes, depending on `startingDeadlineSeconds`. Inspect the schedule state before removing suspension.

Delete one particular Job and its dependent Pods with:

```bash
kubectl delete job reconciliation-manual-001
```

### Choose a controller from the condition Kubernetes must preserve

The quickest controller choice comes from one question: **what condition should Kubernetes continuously try to make true?**

| Desired condition | Controller |
|---|---|
| One disposable Pod object should exist | Pod |
| A chosen number of interchangeable replicas should continuously run | Deployment |
| Replicas with stable identity and storage should continuously exist | StatefulSet |
| One copy should run on every relevant node | DaemonSet |
| A finite piece of work should successfully finish | Job |
| A new finite piece of work should start on a repeating schedule | CronJob |

The final model follows directly from these invariants:

- a Deployment asks how many processes are alive;
- a Job asks how many attempts have successfully finished;
- a CronJob asks which scheduled execution should have a Job.

The resulting ownership chain is **CronJob → Job → Pod attempts → container processes**. Pods are attempts, and attempts can repeat. Reliable batch programs make repeated execution safe.

## Check Your Answers
<!-- section-summary: Revisit completion, parallelism, failure rules, repeat safety, schedules, overlap, cleanup, and diagnosis. -->

:::expand[How does a Job turn Pod attempts into a completion result?]{kind="recap"}
A Job stores a completion goal and a Pod template. Its controller creates Pod attempts and records successful Pod exits until the requested completions are reached. `OnFailure` can rerun a container inside one Pod; `Never` leaves a failed Pod and lets the Job controller create another attempt.
:::

:::expand[How do completions, parallelism, and completion mode divide work?]{kind="recap"}
`completions` sets the successful work units and `parallelism` limits active Pods. NonIndexed Jobs count interchangeable successes while the application or queue assigns inputs. Indexed Jobs give every slot a stable number through `JOB_COMPLETION_INDEX`, so a retry returns to the same partition.
:::

:::expand[How do retries, deadlines, and Pod failure rules interact?]{kind="recap"}
The backoff limit bounds failures, the active deadline bounds elapsed Job time, and `podFailurePolicy` classifies known exit codes or Pod conditions. Indexed Jobs can isolate retry budgets per index. When one of these controls makes a Job fail, that Job stays terminal until another actor creates a new Job.
:::

:::expand[Why must batch work be safe to repeat?]{kind="recap"}
Kubernetes can start the same program more than once because status observation, Pod replacement, and scheduled creation are distributed operations. Stable business keys, uniqueness constraints, transactions, upserts, checkpoints, and deterministic outputs let repeated attempts converge on one intended result.
:::

:::expand[How does a CronJob turn a schedule into separate Jobs?]{kind="recap"}
The CronJob controller evaluates a five-field schedule in the configured time zone and creates a separate Job for each due execution. Every child Job owns its completion and Pod attempts. Creation is approximate, so the task itself must remain safe to repeat.
:::

:::expand[How do overlap, missed schedules, history, and cleanup policies work together?]{kind="recap"}
`concurrencyPolicy` handles overlap among Jobs from one CronJob. `startingDeadlineSeconds` limits how late a run may begin, while `activeDeadlineSeconds` limits how long its Job may run. History limits and Job TTL remove finished objects according to count and time.
:::

:::expand[How do you inspect, rerun, suspend, and diagnose batch work?]{kind="recap"}
Start with the CronJob for schedule decisions, continue to the child Job for completion and failure state, and inspect its Pods for events and logs. A manual run creates a separate Job from the CronJob template. Suspension pauses future creation while existing Jobs continue.
:::

## References
<!-- section-summary: Current Kubernetes documentation defines Job completion, retry policy, CronJob scheduling, cleanup, and kubectl operations. -->

- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) — completion modes, parallelism, duplicate execution, indexed Jobs, retry rules, failure policy, and deadlines.
- [CronJobs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) — schedules, time zones, concurrency, missed starts, suspension, duplicate creation, and history limits.
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/) — TTL cleanup behavior for completed and failed Jobs.
- [Job API reference](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/) — Job fields, conditions, completion modes, and status.
- [CronJob API reference](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/) — schedule, time-zone, concurrency, history, and Job-template fields.
- [kubectl create job](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_job/) — one-time Job creation and copying a CronJob template.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) — logs from Pods and workload resources such as Jobs.
