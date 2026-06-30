---
title: "Desired State and Reconciliation"
description: "Understand how Kubernetes uses specs, status, controllers, events, and rollouts to keep applications close to the state you declared."
overview: "Kubernetes runs applications by storing the state you want, checking the state it sees, and letting controllers close the gap. A Customer Notification Platform connects desired state to Deployments, Services, readiness checks, events, rollouts, rollback, and daily operations."
tags: ["kubernetes", "desired-state", "controllers", "reconciliation", "deployments"]
order: 4
id: article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation
---
## Table of Contents

1. [Desired State](#desired-state)
2. [Current State](#current-state)
3. [Objects, Spec, and Status](#objects-spec-and-status)
4. [Controllers and Reconciliation](#controllers-and-reconciliation)
5. [Declaring the Customer Notification Platform](#declaring-the-customer-notification-platform)
6. [Traffic, Readiness, and the Database Dependency](#traffic-readiness-and-the-database-dependency)
7. [Applying Changes Safely](#applying-changes-safely)
8. [Reading Status and Events](#reading-status-and-events)
9. [Rollouts and Rollbacks](#rollouts-and-rollbacks)
10. [Manual Changes and Drift](#manual-changes-and-drift)
11. [Production Operating Habits](#production-operating-habits)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)
14. [References](#references)

## Desired State
<!-- section-summary: Desired state is the condition Kubernetes stores and keeps checking after the original command exits. -->

**Desired state** means the condition you want Kubernetes to maintain. It is the saved target for the cluster, such as the number of application copies, the image version, the Service name, the readiness check, and the configuration each Pod should receive. Kubernetes stores that target in the API and keeps checking it after the original command exits.

For the Customer Notification Platform, desired state can say: keep three `notification-api` Pods ready, keep two `notification-worker` Pods processing jobs, expose the API through a Service, and send traffic only to API Pods that pass readiness checks.

That request stays in the Kubernetes API after the first command finishes. If an API Pod crashes, Kubernetes still has the stored request that says three ready API Pods should exist. If a worker Pod lands on a node that later fails, Kubernetes still has the worker Deployment request. The cluster can repair from the saved target instead of waiting for a person to notice the missing copy and manually recreate it.

You can picture the same idea with a thermostat. Setting the target temperature gives the device something to keep checking against the room. Kubernetes uses that style of ongoing loop for applications: store the target, observe the live state, and keep taking actions that move the cluster toward the target.

The Customer Notification Platform gives the loop a concrete job. During a normal day, traffic enters `notification-api`, the API writes notification jobs, `notification-worker` sends messages, and the database stores delivery status. During a failure, the platform needs Kubernetes to keep checking the requested state while operators read status, events, logs, and rollout history.

## Current State
<!-- section-summary: Current state is what Kubernetes observes right now, and reconciliation compares it with the stored request. -->

**Current state** means the condition Kubernetes observes right now. One node may be healthy, another node may have memory pressure, one API Pod may be ready, and another API Pod may be waiting for the image registry. Desired state gives Kubernetes the target; current state gives Kubernetes the live evidence.

For the Customer Notification Platform, current state is the live evidence around the request. The Deployment may ask for three API Pods, but Kubernetes may currently see only two ready Pods. The Service may point to the API label, but the ready endpoint list may contain only one Pod because the others failed readiness. The rollout may ask for image `1.4.3`, but one old Pod may still be draining.

**Reconciliation** is the repeated work of comparing desired state with current state and taking action. If desired state says three API Pods and current state says two ready API Pods, a controller has work to do. If desired state says image `ghcr.io/devpolaris/notification-api:1.4.2` and one node still runs the old image, the Deployment controller has rollout work to do.

Kubernetes keeps working after the first command finishes. A shell script can start a process and exit. Kubernetes stores the request in the API, then controllers keep checking that request while nodes fail, Pods restart, images change, traffic shifts, and operators investigate production issues.

![Desired and current state loop showing a Deployment spec asking for notification-api replicas, observed Pods and readiness, a controller noticing the gap, and reconciliation actions creating or updating Pods](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/desired-current-loop.png)
*Desired state is the request, current state is what Kubernetes observes, and reconciliation is the loop that keeps closing the gap.*

## Objects, Spec, and Status
<!-- section-summary: Kubernetes stores intent and observation on API objects, mainly through the spec and status fields. -->

A **Kubernetes object** is a record in the Kubernetes API. A Pod, Deployment, Service, ConfigMap, Secret, and Namespace are all objects. For example, the `notification-api` Deployment object records the requested API replica count, image, labels, and Pod template.

Most important workload objects have two fields that beginners should learn early. The **spec** field holds the desired state that you write. The **status** field holds the current state that Kubernetes components report as they try to satisfy the spec.

Here is a small, simplified view of the split. A real Deployment manifest usually contains more fields, but this example shows the main idea clearly.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  replicas: 3
status:
  readyReplicas: 2
  availableReplicas: 2
  updatedReplicas: 3
```

The `spec.replicas: 3` line says the team wants three API Pods. The `status.readyReplicas: 2` line says Kubernetes currently sees only two ready Pods. That gap gives the controller a clear job: keep working until the observed state matches the requested state, or report why it cannot make progress.

In production, operators read both fields. The fact that a Deployment exists only tells you the API server accepted the object. The status tells you whether the cluster actually reached the useful condition, such as three available API Pods serving traffic.

A compact command shows this split in daily use. It is often the first check before anyone opens the full Deployment YAML.

```bash
kubectl get deployment notification-api -n notifications-prod
```

The `-n notifications-prod` flag tells `kubectl` which namespace to read. The output below shows a mismatch between the requested count and the ready count.

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   2/3     3            2           18d
```

`READY 2/3` means two Pods are ready out of the three requested by the Deployment. `UP-TO-DATE 3` means all three Pods use the latest Pod template, so the rollout version probably finished creating Pods. `AVAILABLE 2` tells the operations team that only two Pods currently count as available for service.

## Controllers and Reconciliation
<!-- section-summary: Controllers watch objects and make API changes that move current state toward desired state. -->

A **controller** is a background process that watches Kubernetes objects and makes follow-up changes. The controller usually talks to the API server, and node agents handle local machine work. It sees a gap, writes another API object or updates an existing one, and lets the next part of the system continue the work.

The Deployment path shows this clearly. You create one Deployment for `notification-api`, and then several controllers and agents cooperate. Each part owns one small step in the chain:

- The **Deployment controller** watches the Deployment and creates or updates ReplicaSets.
- The **ReplicaSet controller** watches the ReplicaSet and keeps the requested number of Pods present.
- The **scheduler** assigns unscheduled Pods to nodes that can run them.
- The **kubelet** on each node starts containers and reports Pod status back to the API server.
- The **Service and EndpointSlice controllers** keep the network endpoints aligned with matching ready Pods.

That chain gives Kubernetes its usual operating style. Each component owns a small part of the loop, and the API server acts as the shared coordination point. The Deployment controller can stay focused on ReplicaSets, and the kubelet can stay focused on starting containers.

For the Customer Notification Platform, the controller chain matters during ordinary failures. If a node disappears and takes an API Pod with it, the ReplicaSet controller notices that the Pod count dropped. It creates a replacement Pod object, the scheduler places it on another node, and the kubelet starts the container from the Deployment's Pod template.

## Declaring the Customer Notification Platform
<!-- section-summary: A Deployment turns application requirements into desired state that controllers can maintain. -->

A **Deployment** is a Kubernetes workload object for running replicated application Pods, commonly for stateless services. In this example, `notification-api` is a good Deployment because any healthy API replica can receive an HTTP request and write a notification job to the database. The API Pods are interchangeable, so Kubernetes can replace them during failures and rollouts.

The beginner shape should stay tiny at this point. This skeleton shows the target Kubernetes needs first: object kind, replica count, and Pod template.

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  template:
    spec:
      containers:
        - image: ghcr.io/devpolaris/notification-api:1.4.2
```

The skeleton leaves out labels, selectors, probes, and configuration so the core request stays visible. `kind: Deployment` chooses the controller family, `spec.replicas: 3` gives the requested count, and `template` describes the Pods the controller should create.

The complete platform has a few desired-state records, each with a different job.

| Desired-state record | What the team asks Kubernetes to maintain | What the controller loop watches |
| --- | --- | --- |
| `notification-api` Deployment | Three API Pods from image `1.4.2` | Replica count, rollout progress, Pod readiness |
| `notification-worker` Deployment | Two worker Pods from image `1.4.2` | Replica count, restarts, worker Pod status |
| `notification-api` Service | One stable name and port for API callers | Matching ready Pods behind the selector |
| `notification-database` Secret | A database connection value mounted into Pods | Whether Pods can receive the value at startup |

The worker uses the same Deployment idea as the API, but it has a different purpose. The API protects live request capacity. The worker protects background delivery throughput. Keeping those as separate Deployments lets the team scale and roll them independently while still using the same reconciliation pattern.

## Traffic, Readiness, and the Database Dependency
<!-- section-summary: Services route traffic to matching Pods, and readiness tells Kubernetes which Pods should receive requests. -->

A **Service** is a Kubernetes object that exposes a stable network endpoint for a changing set of Pods. Pods receive their own IP addresses, but Pods are temporary. A Service gives other clients one stable name and port while Kubernetes updates the backing endpoints behind it.

Keeping the requested Pod count is only part of running a user-facing API. The notification platform also needs callers to keep using one address while Pods are replaced, and it needs Kubernetes to withhold traffic from Pods that started before they were ready for real requests. Service selection and readiness turn the replica loop into a traffic loop.

The smallest Service shape has a selector and a port. The selector chooses Pods by label, and the port gives callers a stable entry point.

```yaml
kind: Service
spec:
  selector:
    app.kubernetes.io/name: notification-api
  ports:
    - port: 80
      targetPort: http
```

Inside the cluster, another workload can call `http://notification-api.notifications-prod.svc.cluster.local`. An Ingress or Gateway can sit in front of this Service for customer-facing HTTP traffic. The key idea here is that clients keep using the Service while controllers replace Pods underneath it.

A **readiness probe** tells Kubernetes whether a container is ready to receive traffic. This is different from simply asking whether the process exists. An API process might be running, but it may still be loading config, warming caches, or waiting for a database connection.

For the Customer Notification Platform, the `/readyz` endpoint should check the pieces required for serving a request. A practical implementation often checks that the HTTP server can accept requests and that the database connection pool can reach PostgreSQL. If the database dependency is unavailable, the Pod should report unready so the Service stops sending it fresh traffic while it recovers.

![Rollout readiness and traffic infographic showing old and new notification-api Pods, readiness checks, Service endpoints, database dependency checks, and traffic moving only to ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/rollout-readiness-traffic.png)
*Rollout safety comes from the loop between desired replicas, ready Pods, Service endpoints, and dependency-aware readiness checks.*

This is where desired state connects to real customer traffic. The Deployment asks for three API Pods, the Service points traffic at matching Pods, and the readiness probe controls whether each Pod enters the ready endpoint set. Kubernetes can only make good traffic decisions when the app exposes a truthful readiness signal.

## Applying Changes Safely
<!-- section-summary: kubectl apply sends manifest files to the API server so Kubernetes can create or update desired state. -->

`kubectl apply` is the common command for creating or updating objects from YAML or JSON files. The command sends the configuration to the Kubernetes API server. If the object already exists, Kubernetes updates it according to the applied configuration.

Teams usually keep manifests in source control so every change gets review. A small production repository might hold the namespace, database Secret, API Deployment, API Service, and worker Deployment under one application folder.

For the Customer Notification Platform, that folder is the reviewed request the team wants the cluster to maintain. A pull request can show the new image tag, the replica count, and the readiness endpoint before the API server ever receives the change. Applying the folder is the moment the reviewed desired state enters Kubernetes; health verification still comes afterward.

```bash
kubectl apply -f k8s/notifications/
```

The `-f` flag points to a file or directory of manifests. When the output says `configured`, the API server accepted the requested object update. That output confirms storage, not health. The next checks still need rollout status, available replicas, events, logs, and customer-facing signals.

This workflow gives the team a source of record outside the cluster. Pull requests show who changed the API image, who raised the worker replica count, and who edited the readiness probe. The live cluster still has current state, but the reviewed files hold the desired state the team expects to keep.

One management style per object keeps the workflow predictable. If a team mixes repeated manual edits, `kubectl replace`, GitOps, and `kubectl apply` against the same object, the live state can surprise people during production work. In most production teams, manifests flow through Git and a deployment pipeline, while emergency manual commands get written back to Git quickly.

## Reading Status and Events
<!-- section-summary: Status gives the current summary, while events show recent actions and failures around an object. -->

After applying desired state, the next job is reading what Kubernetes reports. **Status** gives the compact answer: how many replicas are ready, whether a rollout progressed, and which conditions the controller currently reports. **Events** give the recent story of what Kubernetes tried, such as scheduling a Pod, pulling an image, failing a readiness probe, or scaling a ReplicaSet.

This section follows the same notification API after an apply. The team needs to know whether Kubernetes accepted the request and whether the cluster reached a useful condition. A status row can show the gap in seconds, while events help explain which part of the controller, scheduler, kubelet, or probe path is blocking progress.

The first command usually checks the Deployment summary. It gives the quickest view of desired replicas compared with available replicas.

```bash
kubectl get deployment notification-api -n notifications-prod
```

The `-n notifications-prod` flag keeps the read inside the production namespace. During a database outage, the output might show this:

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   1/3     3            1           18d
```

That row says the Deployment still wants three API Pods and all three use the latest template. Only one Pod is ready and available, so the operations team should inspect Pods, readiness, logs, and events. The row gives a starting point, and the rest of the investigation needs more evidence.

The follow-up evidence has a natural order.

| Evidence | Command shape | What the team reads |
| --- | --- | --- |
| Deployment details | `kubectl describe deployment notification-api -n notifications-prod` | Conditions, ReplicaSet activity, and related events |
| Pod state | `kubectl get pods -n notifications-prod -l app.kubernetes.io/name=notification-api` | Which Pods are ready, pending, restarting, or missing |
| Pod details | `kubectl describe pod <pod-name> -n notifications-prod` | Scheduling, image pull, probe, and restart events |
| Application logs | `kubectl logs deployment/notification-api -n notifications-prod --tail=100` | Recent stdout and stderr from the API container |
| Event stream | `kubectl events -n notifications-prod --for deployment/notification-api --watch` | Fresh controller events for the selected Deployment |

The flags carry meaning. `-l` filters Pods by label, so the team reads the Pods selected by the workload. `--tail=100` keeps logs focused on recent lines. `--for` narrows events to one object, and `--watch` keeps printing new events during an active rollout or investigation.

Events are best-effort, short-lived operational records. They help you understand recent controller and node actions, while metrics and logs fill in the long-term picture. In a real production support flow, a team usually checks Deployment status, Pod status, events, application logs, and database metrics together.

## Rollouts and Rollbacks
<!-- section-summary: Deployment rollouts replace old Pods with new Pods at a controlled rate, and rollback restores an earlier Pod template. -->

A **rollout** is the process of moving a Deployment from one Pod template to another. Changing the image from `notification-api:1.4.2` to `notification-api:1.4.3` changes desired state. The Deployment controller responds by creating a new ReplicaSet and gradually shifting replicas from the old template to the new template.

Rollouts are where reconciliation shows up in customer traffic. The notification API still needs to answer requests while Kubernetes introduces new Pods, waits for readiness, and removes old Pods. A rollout strategy gives that replacement a pace instead of making the release an all-at-once switch.

The strategy in our manifest controls the pace. These two fields decide how much extra capacity Kubernetes can use and how much availability it must preserve.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

`maxSurge: 1` allows Kubernetes to run one extra API Pod during the update. `maxUnavailable: 0` tells the controller to keep the existing available count during the rollout. For customer traffic, that gives the platform extra room to start a new Pod and wait for readiness before removing an old ready Pod.

The rollout status command watches progress through the Kubernetes API.

```bash
kubectl rollout status deployment/notification-api -n notifications-prod --timeout=5m
```

`deployment/notification-api` names the exact Deployment to watch. `-n notifications-prod` selects the production namespace. `--timeout=5m` gives the command five minutes to see the latest rollout complete before it exits with a failure.

Successful output looks like this:

```
Waiting for deployment "notification-api" rollout to finish: 1 of 3 updated replicas are available...
deployment "notification-api" successfully rolled out
```

The first line says Kubernetes is still waiting for available updated Pods. The second line says the Deployment reached its rollout condition. A stalled rollout usually means a new Pod cannot schedule, pull its image, start cleanly, or pass readiness.

Rollback restores an earlier Deployment Pod template. The command `kubectl rollout undo deployment/notification-api -n notifications-prod` changes desired state back to the previous revision. After rollback starts, the same rollout status command tracks whether the older template returns to service.

Production teams usually pair this with a small runbook. The runbook includes `kubectl rollout history`, a decision about the last known good revision, a rollback step for active customer impact, and a follow-up fix so the broken desired state stays out of future apply cycles.

## Manual Changes and Drift
<!-- section-summary: Some manual commands change only current state, while other commands change the desired state controllers follow. -->

**Drift** means the live cluster and the expected configuration no longer match. Drift can happen because a human made a manual change, a GitOps controller applied an older file, a pipeline failed halfway, or a controller changed a dependent object as part of reconciliation. The important question is whether the manual action changed current state only, or changed desired state as well.

Deleting one API Pod changes current state. The Deployment still asks for three replicas, so the ReplicaSet controller creates a replacement with a fresh Pod name. Scaling the Deployment changes desired state because it updates the Deployment spec. If the team manages the Deployment from Git, the matching manifest should change too.

| Manual action | Which state changes | What the controller loop does next |
| --- | --- | --- |
| Delete one `notification-api` Pod | Current state | ReplicaSet creates a replacement Pod |
| Scale `notification-api` from 3 to 5 | Desired state | ReplicaSet works toward five Pods |
| Edit the image on the Deployment | Desired state | Deployment starts a rollout |
| Restart a Pod after a transient issue | Current state | Controller restores the requested Pod count |

This is why operations teams talk about **source of truth**. Kubernetes has the live API state. Git often has the reviewed desired state. During a traffic spike, a temporary manual scale can help absorb demand, but the follow-up change belongs in the manifest so the next apply cycle keeps the same target.

## Production Operating Habits
<!-- section-summary: Real teams combine manifests, status checks, events, rollout commands, and alerts into a repeatable operating flow. -->

Desired state sounds simple until you operate it under traffic. The practical habit is to treat every change as two questions: what desired state did we write, and what current state did Kubernetes report after controllers worked on it? That question pair works for deploys, scaling, readiness issues, and emergency recovery.

The notification platform gives this habit a daily shape. During a normal deploy, the team records the reviewed manifest, watches rollout status, confirms available replicas, and checks the selected Pods. During an incident, the same path keeps the first response grounded in evidence before the team scales, rolls back, or changes configuration.

A normal deployment flow for `notification-api` can stay short.

| Step | What the team checks | Command shape |
| --- | --- | --- |
| Store the reviewed request | The API accepted the manifests | `kubectl apply -f k8s/notifications/` |
| Watch the release | Updated Pods reported available | `kubectl rollout status deployment/notification-api -n notifications-prod --timeout=5m` |
| Read current capacity | Ready and available replicas match the request | `kubectl get deployment notification-api notification-worker -n notifications-prod` |
| Check selected Pods | Pods under the app label are healthy | `kubectl get pods -n notifications-prod -l app.kubernetes.io/part-of=customer-notification-platform` |

During a production issue, the flow moves from high-level status into Pod details, logs, events, and dependency metrics. `describe` helps when Kubernetes needs to explain scheduling, probe, or restart behavior. `logs` helps when the application has reached the point where it can print its own failure. Metrics help when the dependency, such as PostgreSQL, is the bottleneck.

Alerts should follow the same structure. A useful alert can watch available replicas dropping below desired replicas, rollout progress exceeding the deadline, readiness failures rising, worker queue depth growing, or database connection errors increasing. Kubernetes reconciliation can replace Pods, but it cannot fix a broken image tag, missing migration, exhausted database, or wrong readiness endpoint without a corrected desired state.

This is also where adjacent production tools fit naturally. CI can validate YAML and apply a server-side dry run before merge. GitOps can keep the cluster aligned with reviewed manifests. Metrics and logs can show whether customer traffic, queue processing, and database health agree with the Kubernetes status.

## Putting It All Together
<!-- section-summary: Desired state gives Kubernetes a target, and reconciliation turns that target into ongoing operations. -->

The Customer Notification Platform gives us the full loop. The team writes Deployment and Service manifests for `notification-api`, a Deployment for `notification-worker`, and a Secret reference for the database connection. Those manifests enter the Kubernetes API after `kubectl apply` or a GitOps sync.

Kubernetes then keeps reporting current state. Pods schedule onto nodes, kubelets start containers, readiness probes decide whether the API can receive traffic, Services point at ready endpoints, and controllers update status as they make progress. When something fails, events and status tell the team which part of the loop needs attention.

Here is the complete API Deployment after the earlier skeleton. The spec is the target, status is what Kubernetes reports later, and reconciliation is the loop that keeps working on this target.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app.kubernetes.io/name: notification-api
    app.kubernetes.io/part-of: customer-notification-platform
spec:
  replicas: 3
  progressDeadlineSeconds: 600
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
        app.kubernetes.io/part-of: customer-notification-platform
    spec:
      containers:
        - name: notification-api
          image: ghcr.io/devpolaris/notification-api:1.4.2
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-database
                  key: url
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
```

![Reconciliation operations summary showing desired state, current state, controllers, rollout status, events, drift, Git source of truth, and rollback for notification-api](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/reconciliation-ops-summary.png)
*The same loop explains normal deploys, failed readiness, rollout rollback, manual scale changes, and drift from the reviewed source of truth.*

Rollouts use the same idea for releases. Updating the image changes desired state, the Deployment controller creates a new ReplicaSet, readiness gates traffic, rollout status reports progress, and rollback restores an earlier Pod template when a release hurts production. Manual changes fit into the same model once you ask whether they changed current state or desired state.

The key idea is simple enough to carry into every Kubernetes topic after this. You write the target, Kubernetes reports what happened, controllers keep working, and operators use status, events, logs, metrics, and reviewed manifests to guide the next change.

## What's Next

Desired state and reconciliation now have a practical shape. The next article moves into daily cluster navigation with namespaces and `kubectl`, because operating safely depends on knowing which cluster, namespace, and context each command will touch.

## References

- [Kubernetes Objects](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Official explanation of objects, desired state, `spec`, and `status`.
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Official description of Kubernetes controllers as control loops that move current state closer to desired state.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official guide to Deployment behavior, ReplicaSets, rollout progress, failed Deployments, and rollback.
- [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/) - Official command reference for applying YAML or JSON configuration by file, directory, or stdin.
- [Kubernetes Object Management](https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/) - Official overview of imperative and declarative object management approaches.
- [Events API](https://kubernetes.io/docs/reference/kubernetes-api/core/event-v1/) - Official Event API reference and guidance that events are short-lived, best-effort supplemental records.
- [kubectl events](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/) - Official command reference for listing and filtering Kubernetes events.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Official command reference for showing resource details and related events.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Official command group for managing rollouts across Deployments, DaemonSets, and StatefulSets.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Official command reference for watching rollout progress.
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/) - Official command reference for rolling back to a previous rollout revision.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official explanation of Services, selectors, endpoints, and stable traffic routing to changing Pods.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official guide to labels as key/value pairs used for organizing and selecting objects.
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official task guide for readiness behavior and traffic routing through Services.
