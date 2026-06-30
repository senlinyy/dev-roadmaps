---
title: "Production Debugging Workflow"
description: "Follow a repeatable Kubernetes production debugging workflow from symptom capture to rollback, mitigation, and evidence."
overview: "Production debugging uses a sequence of small proofs under time pressure. The workflow for devpolaris-orders-api separates user symptoms, Kubernetes state, application logs, dependencies, and safe mitigation."
tags: ["debugging", "incidents", "kubectl", "runbooks"]
order: 9
id: article-containers-orchestration-kubernetes-operations-production-debugging-workflow
---
## Table of Contents

1. [From Alert To Concrete Symptom](#from-alert-to-concrete-symptom)
2. [Build the Timeline](#build-the-timeline)
3. [Inspect the Deployment Before Changing It](#inspect-the-deployment-before-changing-it)
4. [Follow the Request Path Outside In](#follow-the-request-path-outside-in)
5. [Use Events and Logs to Name the Failure Family](#use-events-and-logs-to-name-the-failure-family)
6. [Check Dependencies From Inside the Cluster](#check-dependencies-from-inside-the-cluster)
7. [Choose Mitigation With Evidence](#choose-mitigation-with-evidence)
8. [Roll Back Safely](#roll-back-safely)
9. [Keep Debugging From Damaging Evidence](#keep-debugging-from-damaging-evidence)
10. [Incident Review and Operational Checklist](#incident-review-and-operational-checklist)
11. [References](#references)

## From Alert To Concrete Symptom
<!-- section-summary: Production debugging starts by turning a noisy alert into a concrete user or system symptom with scope and time. -->

A Kubernetes **production debugging workflow** is an evidence order for incidents: define the symptom, build a timeline, inspect workload state, follow the request path, read logs and events, test dependencies, then choose mitigation.

For `devpolaris-orders-api`, an alert such as "5xx rate high" is only the starting point. Translate it into a symptom: checkout write requests in `orders` started returning `503` at `10:08 UTC`, while read requests stayed mostly healthy.

That sentence gives the team scope, user impact, time, and a path to verify. It also prevents the first responder from editing manifests before understanding the failure.

## Build the Timeline
<!-- section-summary: A timeline aligns alerts, recent changes, Kubernetes events, logs, metrics, and dependency signals before any fix is chosen. -->

Build a short timeline early. Include the first known bad time, recent releases, scaling changes, node events, policy changes, and dependency alerts.

| Time | Evidence | What it says |
|---|---|---|
| `10:03` | Deployment rollout | New orders API image shipped |
| `10:08` | Alert | 5xx rate rose for checkout writes |
| `10:09` | Deployment status | New ReplicaSet has unready Pods |
| `10:10` | Pod events | Readiness probe failed with `503` |
| `10:12` | App logs | Database migration lock timeout |

![Alert to timeline infographic showing alert, symptom, recent change, events, logs, metrics, and first known bad time](/content-assets/articles/article-containers-orchestration-kubernetes-operations-production-debugging-workflow/alert-to-timeline.png)

*The timeline keeps the incident tied to observed facts and recent changes.*

## Inspect the Deployment Before Changing It
<!-- section-summary: Deployment, ReplicaSet, and Pod state show whether the failure is rollout, scheduling, readiness, crash, or capacity related. -->

Controller state is safer evidence than an immediate workload change. Deployment, ReplicaSet, and Pod output show whether the failure is rollout progress, scheduling, readiness, crash looping, or capacity.

```bash
$ kubectl -n orders get deploy,rs,pod -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   UP-TO-DATE   AVAILABLE
deployment.apps/devpolaris-orders-api     2/3     1            2

NAME                                                 DESIRED   CURRENT   READY
replicaset.apps/devpolaris-orders-api-78b6f596dc      1         1         0

NAME                                           READY   STATUS    RESTARTS
pod/devpolaris-orders-api-78b6f596dc-mk9z4     0/1     Running   0
```

What this output tells you:

- The rollout is in progress but the new Pod is unready.
- The Pod is running, so inspect readiness and app logs.
- The old Pods still provide two available replicas.

If the status were `ImagePullBackOff` or `Pending`, the next check would move toward image registry or scheduling evidence.

## Follow the Request Path Outside In
<!-- section-summary: Outside-in debugging checks the user path through DNS, ingress, Service, endpoints, Pods, and dependencies. -->

For request failures, follow the path a user request takes. The exact ingress technology can vary, but the order is stable: DNS and TLS, ingress or gateway, Service, EndpointSlice, Pod, and dependency.

![Outside-in request path showing user, DNS and TLS, Ingress or Gateway, Service, EndpointSlice, Pod, and dependency checks](/content-assets/articles/article-containers-orchestration-kubernetes-operations-production-debugging-workflow/outside-in-request-path.png)

*The request path keeps network checks ordered instead of jumping between unrelated objects.*

Check Service endpoints:

```bash
$ kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
NAME                         ADDRESSTYPE   PORTS   ENDPOINTS
devpolaris-orders-api-h7v8m  IPv4          8080    10.42.3.18,10.42.4.21
```

What this output says:

- The Service has two ready backend Pod IPs.
- The unready new Pod is absent from endpoints, which matches readiness behavior.
- If the endpoint list were empty, the incident would be a Service routing emergency.

## Use Events and Logs to Name the Failure Family
<!-- section-summary: Events identify Kubernetes decisions, while logs identify application behavior, and together they name the failure family. -->

Use events and logs to put the incident into a failure family: rollout, image, scheduling, readiness, crash, dependency, capacity, or policy.

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
Events:
  Type     Reason     Message
  Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 503

$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --tail=60
2026-06-30T10:12:18Z ERROR readiness database migration lock timeout
```

What this evidence says:

- Kubernetes removed the Pod from endpoints because readiness failed.
- The application named a database migration lock timeout.
- The next check should focus on migration state and database connectivity before image pulls or scheduler placement.

## Check Dependencies From Inside the Cluster
<!-- section-summary: Dependency checks from inside the cluster prove DNS, network policy, credentials, and upstream behavior from the workload's point of view. -->

When the application names a dependency, test from the same namespace or a controlled debug Pod. Keep the test narrow and safe.

```bash
$ kubectl -n orders run db-check --rm -it --image=postgres:16 -- \
  psql "$POSTGRES_URL" -c "select 1;"
 ?column?
----------
        1
(1 row)
```

What this output proves:

- The debug client can reach PostgreSQL.
- Credentials in the test environment worked.
- A basic query succeeded, so the migration lock may be workload-specific rather than total database outage.

If the command times out, check NetworkPolicy, DNS, database firewall rules, and credentials in that order.

## Choose Mitigation With Evidence
<!-- section-summary: Mitigation should reduce user impact using the smallest action supported by the evidence. -->

Choose a mitigation based on the named failure family. The safest fix may be rollback, scaling, pausing rollout, disabling a feature flag, restoring a Secret, or moving traffic away from a bad revision.

Examples:

| Evidence | Safer mitigation |
|---|---|
| New ReplicaSet unready, old Pods healthy | Pause or roll back rollout |
| HPA at max and CPU saturated | Add temporary capacity or raise max with dependency review |
| Missing Secret event | Restore the Secret or revert the manifest reference |
| One node has many failing Pods | Cordon node and reschedule workloads |
| Upstream rate limits | Reduce caller concurrency or disable optional feature |

The mitigation note should say why the action matches the evidence. That helps reviewers distinguish a real fix from a lucky restart.

## Roll Back Safely
<!-- section-summary: A rollback should name the target revision, watch controller progress, and verify user symptoms after the change. -->

For a Deployment rollback, first inspect rollout history:

```bash
$ kubectl -n orders rollout history deployment/devpolaris-orders-api
REVISION  CHANGE-CAUSE
41        image=registry.devpolaris.example/orders-api:2026.06.29
42        image=registry.devpolaris.example/orders-api:2026.06.30
```

What this output gives you:

- Revision `42` is the current bad candidate.
- Revision `41` is the previous image.
- The rollback target is explicit.

Roll back and watch:

```bash
$ kubectl -n orders rollout undo deployment/devpolaris-orders-api --to-revision=41
deployment.apps/devpolaris-orders-api rolled back

$ kubectl -n orders rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out
```

The status line proves the Deployment controller completed the rollback. Follow it with app metrics, error rate, and one user-path check.

## Keep Debugging From Damaging Evidence
<!-- section-summary: Debugging should preserve logs, events, manifests, and timeline data while avoiding broad live changes. -->

Incident debugging can destroy the evidence that explains the incident. Before deleting Pods or forcing drains, capture the important state.

```bash
$ kubectl -n orders get deploy devpolaris-orders-api -o yaml > orders-api-deploy-incident.yaml
$ kubectl -n orders get events --sort-by=.lastTimestamp > orders-events-incident.txt
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --previous > orders-api-previous.log
```

What these captures preserve:

- The Deployment spec at incident time.
- The event sequence while events still exist.
- Logs from the prior crashed container instance.

Use debug Pods and ephemeral containers carefully. They are useful, but they should be named in the incident record because they change the cluster while the team is investigating.

## Incident Review and Operational Checklist
<!-- section-summary: The review turns the incident path into a reusable debugging routine and concrete prevention work. -->

Use this checklist during and after a production debugging session:

| Step | Evidence |
|---|---|
| Symptom | User impact, scope, and first known bad time |
| Timeline | Recent deploys, events, metrics, logs, and dependency alerts |
| Workload state | Deployment, ReplicaSet, Pod, HPA, PDB |
| Request path | Ingress or gateway, Service, EndpointSlice, Pod |
| Failure family | Named from events and logs |
| Dependency proof | Checked from inside the cluster when relevant |
| Mitigation | Smallest action tied to evidence |
| Rollback | Target revision and rollout status captured |
| Preservation | Important YAML, events, logs, and notes saved |
| Prevention | Probe, policy, test, dashboard, or runbook change recorded |

![Incident fix loop showing evidence first, mitigation, proving the fix, safe rollback, preserved evidence, and prevention work](/content-assets/articles/article-containers-orchestration-kubernetes-operations-production-debugging-workflow/incident-fix-loop.png)

*The incident loop keeps debugging evidence-first: define, inspect, mitigate, verify, preserve, and improve.*

## References

- [Kubernetes: Debug Applications](https://kubernetes.io/docs/tasks/debug/debug-application/) - Official task hub for debugging Pods, Services, and workloads.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Practical Pod inspection, logs, exec, and events guide.
- [Kubernetes: Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/) - Official guide for Service and endpoint debugging.
- [Kubernetes: kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Command reference for rollout status, history, pause, resume, restart, and undo.
- [Kubernetes Events API](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/) - API reference for event objects.
- [Kubernetes: Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/) - Explains temporary debug containers for Pod troubleshooting.
