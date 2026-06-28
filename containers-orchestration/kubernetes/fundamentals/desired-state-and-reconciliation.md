---
title: "Desired State and Reconciliation"
description: "Understand how Kubernetes uses specs, status, controllers, events, and rollouts to keep applications close to the state you declared."
overview: "Kubernetes runs applications by storing the state you want, checking the state it sees, and letting controllers close the gap. This article follows a Customer Notification Platform through Deployments, Services, readiness checks, events, rollouts, rollback, and daily operations."
tags: ["kubernetes", "desired-state", "controllers", "reconciliation", "deployments"]
order: 4
id: article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation
---

## Table of Contents

1. [From One Pod to a Requested Count](#from-one-pod-to-a-requested-count)
2. [Desired State and Current State](#desired-state-and-current-state)
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

## From One Pod to a Requested Count
<!-- section-summary: Desired state starts with a simple request, such as keeping three API Pods running instead of one. -->

A **container** is a packaged application process, and a **Pod** is the smallest runtime unit Kubernetes schedules. For example, one `notification-api` Pod can wrap one API container that listens on port `3000`. If you run one Pod for a demo, the question is simple: did that one copy start?

A real application usually needs a requested count. The Customer Notification Platform may need three `notification-api` Pods for live HTTP traffic and two `notification-worker` Pods for background delivery. A human should not have to count Pods all day, notice one missing copy, and manually create a replacement.

That requested count is the first plain-English version of **desired state**. The team says, "keep three API Pods running from this image." Kubernetes stores that request, watches what is currently running, and uses controllers to close the gap when the live cluster no longer matches the request.

The same idea reaches the rest of the platform. The API Pods need nodes, the cluster needs a control plane to store the request, the Service needs ready endpoints, and `kubectl` gives operators a way to read what Kubernetes stored and observed. In this article, the useful words are **desired state**, **current state**, **spec**, **status**, **controller**, **reconciliation**, **event**, and **rollout**.

We will follow one application all the way through: a **Customer Notification Platform**. The platform has a `notification-api` that receives HTTP requests from the product, a `notification-worker` that sends queued messages, and a PostgreSQL database dependency that stores notification jobs. During a normal day, traffic comes into the API, the API writes jobs to the database, the worker drains the queue, and the operations team rolls out new versions without dropping customer requests.

Those parts give us a useful path through the article. First, we define the state Kubernetes stores. Then we look at how controllers act on that state. After that, we write concrete manifests for the API, worker, Service, and readiness checks. Finally, we operate the platform with `kubectl apply`, status checks, events, rollouts, rollback, and drift handling.

## Desired State and Current State
<!-- section-summary: Desired state is the request you store in Kubernetes, and current state is the condition Kubernetes observes while the cluster runs. -->

**Desired state** means the condition you want Kubernetes to maintain. In plain English, it is your request to the cluster. For the Customer Notification Platform, desired state might say: keep three `notification-api` Pods running, keep two `notification-worker` Pods running, expose the API through a Service, and send traffic to API Pods that pass a readiness check.

**Current state** means the condition Kubernetes observes right now. One node might be healthy, another node might be under memory pressure, one API Pod might be ready, and another API Pod might be waiting for the image registry. Kubernetes keeps collecting that live information from the control plane, kubelets, schedulers, and controllers.

**Reconciliation** is the repeated work of comparing desired state with current state and taking action. If desired state says three API Pods and current state says two ready API Pods, a controller has work to do. If desired state says image `ghcr.io/devpolaris/notification-api:1.4.2` and a node still runs the old image, the Deployment controller has rollout work to do.

Kubernetes keeps working after the first command finishes. A shell script can start a process and exit. Kubernetes stores the request in the API, then controllers keep checking that request while nodes fail, Pods restart, images change, traffic shifts, and operators investigate incidents.

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

A compact command shows this split in daily use. It is often the first check before anyone opens the full Deployment YAML. A typical command is below.

```bash
kubectl get deployment notification-api -n notifications-prod
```

The output might look like this during a partial outage. The numbers show the mismatch before the team digs into individual Pods. A sample output is below.

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

A **Deployment** is a Kubernetes workload object for running replicated application Pods, commonly for stateless services. In this article, `notification-api` is a good Deployment because any healthy API replica can receive an HTTP request and write a notification job to the database. The API Pods are interchangeable, so Kubernetes can replace them during failures and rollouts.

Start with the desired target and the labels. This first slice says the API should have three replicas, gives the rollout a deadline, and tells the Deployment which Pods it owns.

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
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
```

The rollout strategy tells the controller how much room it has while replacing old Pods with new Pods. `maxSurge: 1` allows one extra API Pod during the update, and `maxUnavailable: 0` keeps the old available count while the new version proves itself.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

The Pod template is the blueprint for every API Pod the controller creates. The labels match the selector above, and the container image names the version the team wants running.

```yaml
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
```

Configuration and readiness connect the desired state to production reality. The `DATABASE_URL` value comes from a Secret, and the readiness probe keeps a Pod out of traffic until the app says it can serve requests.

```yaml
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

The `replicas: 3` field gives the ReplicaSet controller a target count. The `selector.matchLabels` field tells the Deployment which Pods belong to it. The `template` field gives Kubernetes the blueprint for each Pod it creates.

The `DATABASE_URL` environment variable pulls a connection string from a Secret named `notification-database`. The Secret is another desired-state object, and the application still needs the real database to accept connections. Kubernetes can wire the value into the Pod, while the database itself might live as a managed PostgreSQL service outside the cluster.

The worker follows the same pattern with a different job. It consumes queued notifications from the database and sends email, SMS, or push messages through provider APIs.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-worker
  namespace: notifications-prod
  labels:
    app.kubernetes.io/name: notification-worker
    app.kubernetes.io/part-of: customer-notification-platform
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-worker
        app.kubernetes.io/part-of: customer-notification-platform
    spec:
      containers:
        - name: notification-worker
          image: ghcr.io/devpolaris/notification-worker:1.4.2
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-database
                  key: url
```

Now the platform has two desired-state records for compute: one for HTTP traffic and one for background processing. The next question is traffic. API Pods can come and go during reconciliation, so clients need one stable way to reach the changing set of healthy API Pods.

## Traffic, Readiness, and the Database Dependency
<!-- section-summary: Services route traffic to matching Pods, and readiness tells Kubernetes which Pods should receive requests. -->

A **Service** is a Kubernetes object that exposes a stable network endpoint for a changing set of Pods. Pods receive their own IP addresses, but Pods are temporary. A Service gives other clients one stable name and port while Kubernetes updates the backing endpoints behind it.

For `notification-api`, the Service selects Pods with the same label used by the Deployment's Pod template. That label connection tells Kubernetes which Pods belong behind the Service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app.kubernetes.io/name: notification-api
spec:
  selector:
    app.kubernetes.io/name: notification-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Inside the cluster, another workload can call `http://notification-api.notifications-prod.svc.cluster.local`. An Ingress or Gateway can sit in front of this Service for customer-facing HTTP traffic. The key idea for this article is that clients keep using the Service while controllers replace Pods underneath it.

A **readiness probe** tells Kubernetes whether a container is ready to receive traffic. This is different from simply asking whether the process exists. An API process might be running, but it may still be loading config, warming caches, or waiting for a database connection.

For the Customer Notification Platform, the `/readyz` endpoint should check the pieces required for serving a request. A practical implementation often checks that the HTTP server can accept requests and that the database connection pool can reach PostgreSQL. If the database dependency is unavailable, the Pod should report unready so the Service stops sending it fresh traffic while it recovers.

This is where desired state connects to real customer traffic. The Deployment asks for three API Pods, the Service points traffic at matching Pods, and the readiness probe controls whether each Pod enters the ready endpoint set. Kubernetes can only make good traffic decisions when the app exposes a truthful readiness signal.

![Rollout readiness and traffic infographic showing old and new notification-api Pods, readiness checks, Service endpoints, database dependency checks, and traffic moving only to ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/rollout-readiness-traffic.png)
*Rollout safety comes from the loop between desired replicas, ready Pods, Service endpoints, and dependency-aware readiness checks.*

## Applying Changes Safely
<!-- section-summary: kubectl apply sends manifest files to the API server so Kubernetes can create or update desired state. -->

`kubectl apply` is the common command for creating or updating objects from YAML or JSON files. The command sends the configuration to the Kubernetes API server. If the object already exists, Kubernetes updates it according to the applied configuration.

Teams usually keep manifests in source control so every change gets review. A small production repository might hold these files. The layout can stay simple while the team learns the platform:

```
k8s/
  notifications/
    namespace.yaml
    database-secret.yaml
    notification-api-deployment.yaml
    notification-api-service.yaml
    notification-worker-deployment.yaml
```

A typical apply command targets the directory. It sends each manifest in that folder to the API server. The command is below.

```bash
kubectl apply -f k8s/notifications/
```

The output names each object that Kubernetes created or configured. That feedback confirms the API server accepted the requested objects. A sample response is below.

```
namespace/notifications-prod configured
secret/notification-database configured
deployment.apps/notification-api configured
service/notification-api configured
deployment.apps/notification-worker configured
```

This workflow gives the team a source of record outside the cluster. Pull requests show who changed the API image, who raised the worker replica count, and who edited the readiness probe. The live cluster still has current state, but the reviewed files hold the desired state the team expects to keep.

There is one important operational habit here. One management style per object keeps the workflow predictable. If a team mixes repeated manual edits, `kubectl replace`, GitOps, and `kubectl apply` against the same object, the live state can surprise people during incidents. In most production teams, manifests flow through Git and a deployment pipeline, while emergency manual commands get written back to Git quickly.

## Reading Status and Events
<!-- section-summary: Status gives the current summary, while events show recent actions and failures around an object. -->

After applying desired state, the next job is reading what Kubernetes reports. **Status** gives the compact answer: how many replicas are ready, whether a rollout progressed, and which conditions the controller currently reports. **Events** give the recent story of what Kubernetes tried, such as scheduling a Pod, pulling an image, failing a readiness probe, or scaling a ReplicaSet.

The first command usually checks the Deployment summary. It gives the quickest view of desired replicas compared with available replicas. The command is below.

```bash
kubectl get deployment notification-api -n notifications-prod
```

During a database outage, the output might show this. The Deployment still exists, but readiness has reduced the available API Pods. A sample response is below.

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   1/3     3            1           18d
```

That row says the Deployment still wants three API Pods and all three use the latest template. Only one Pod is ready and available, so the operations team should inspect Pods, readiness, logs, and events. The row gives a starting point, and the rest of the incident needs more evidence.

`kubectl describe` adds controller details and related events. It is useful after the summary points at a mismatch. The command is below.

```bash
kubectl describe deployment notification-api -n notifications-prod
```

The bottom of the description might show Deployment events like this. The `From` column tells you which controller reported the action. A sample event section is below.

```
Events:
  Type    Reason              Age   From                   Message
  Normal  ScalingReplicaSet   8m    deployment-controller  Scaled up replica set notification-api-7db9c9f5c6 to 3
```

For Pod-level startup and readiness problems, the Pod events usually give sharper clues. The kubelet reports many of the node-side container and probe problems there. The command is below.

```bash
kubectl describe pod notification-api-7db9c9f5c6-j2k8p -n notifications-prod
```

A readiness failure can appear like this. The message gives the team a concrete place to investigate in the application and database path. A sample event is below.

```
Events:
  Type     Reason     Age   From     Message
  Warning  Unhealthy  2m    kubelet  Readiness probe failed: database connection check timed out
```

`kubectl events` can filter the event stream for one object. That helps during an active rollout or incident because new events appear while you watch. The command is below.

```bash
kubectl events -n notifications-prod --for deployment/notification-api --watch
```

Events are best-effort, short-lived operational records. They help you understand recent controller and node actions, while metrics and logs fill in the long-term picture. In a real on-call flow, a team usually checks Deployment status, Pod status, events, application logs, and database metrics together.

## Rollouts and Rollbacks
<!-- section-summary: Deployment rollouts replace old Pods with new Pods at a controlled rate, and rollback restores an earlier Pod template. -->

A **rollout** is the process of moving a Deployment from one Pod template to another. Changing the image from `notification-api:1.4.2` to `notification-api:1.4.3` changes desired state. The Deployment controller responds by creating a new ReplicaSet and gradually shifting replicas from the old template to the new template.

The strategy in our manifest controls the pace. The two fields below decide how much extra capacity Kubernetes can use and how much availability it must preserve. The relevant YAML is below.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

`maxSurge: 1` allows Kubernetes to run one extra API Pod during the update. `maxUnavailable: 0` tells the controller to keep the existing available count during the rollout. For customer traffic, that gives the platform extra room to start a new Pod and wait for readiness before removing an old ready Pod.

A release can update the image through a manifest change and `kubectl apply`, or through a direct image command during a controlled operation. The direct command is common during practice labs and emergency testing. The command is below.

```bash
kubectl set image deployment/notification-api \
  notification-api=ghcr.io/devpolaris/notification-api:1.4.3 \
  -n notifications-prod
```

The rollout status command watches progress. It waits for the latest revision and exits with a failure when the rollout exceeds the configured deadline. The command is below.

```bash
kubectl rollout status deployment/notification-api -n notifications-prod --timeout=5m
```

Successful output looks like this. The first line shows progress, and the second line confirms the rollout completed. A sample response is below.

```
Waiting for deployment "notification-api" rollout to finish: 1 of 3 updated replicas are available...
deployment "notification-api" successfully rolled out
```

A broken release usually shows up as a rollout that cannot make progress. Maybe image `1.4.3` starts but fails `/readyz` because a database migration was missed. Kubernetes reports the stalled condition when the progress deadline passes, and higher-level tooling or an operator can act on that status.

Rollback is the practical recovery command for a bad Deployment revision. It works by restoring an earlier Deployment Pod template. The command is below.

```bash
kubectl rollout undo deployment/notification-api -n notifications-prod
```

That command tells Kubernetes to restore the previous Deployment Pod template. After rollback starts, the same status command tracks the recovery. The team can watch the old healthy template return:

```bash
kubectl rollout status deployment/notification-api -n notifications-prod --timeout=5m
```

Production teams usually pair this with a small runbook. The runbook includes `kubectl rollout history`, a decision about the last known good revision, a rollback step for active customer impact, and a follow-up fix so the broken desired state stays out of future apply cycles.

## Manual Changes and Drift
<!-- section-summary: Some manual commands change only current state, while other commands change the desired state controllers follow. -->

**Drift** means the live cluster and the expected configuration no longer match. Drift can happen because a human made a manual change, a GitOps controller applied an older file, a pipeline failed halfway, or a controller changed a dependent object as part of reconciliation. The important question is whether the manual action changed current state only, or changed desired state as well.

Deleting one API Pod changes current state. The Deployment still asks for three replicas, so the ReplicaSet controller creates a replacement. The command below removes one live Pod:

```bash
kubectl delete pod notification-api-7db9c9f5c6-j2k8p -n notifications-prod
```

The next Pod listing might show a new replacement. The new Pod starts with a fresh name because the old Pod was disposable. A sample response is below.

```
NAME                                READY   STATUS              AGE
notification-api-7db9c9f5c6-d4m9q   1/1     Running             42m
notification-api-7db9c9f5c6-r8v2l   1/1     Running             41m
notification-api-7db9c9f5c6-x6b1p   0/1     ContainerCreating   8s
```

Scaling the Deployment changes desired state because it updates the Deployment spec. The next command raises the requested API replica count. The command is below.

```bash
kubectl scale deployment notification-api --replicas=5 -n notifications-prod
```

The controller now works toward five API replicas. If the team manages the Deployment from Git, the matching manifest should change too. A GitOps controller such as Argo CD or Flux may later restore the Git version if the manual scale never reaches the repository.

This is why operations teams talk about **source of truth**. Kubernetes has the live API state. Git often has the reviewed desired state. During an incident, a temporary manual scale can help absorb traffic, but the follow-up change belongs in the manifest so the next apply cycle keeps the same target.

## Production Operating Habits
<!-- section-summary: Real teams combine manifests, status checks, events, rollout commands, and alerts into a repeatable operating flow. -->

Desired state sounds simple until you operate it under traffic. The practical habit is to treat every change as two questions: what desired state did we write, and what current state did Kubernetes report after controllers worked on it? That question pair works for deploys, scaling, readiness issues, and emergency recovery.

A normal deployment flow for `notification-api` might look like this. The sequence applies the manifests, watches the rollout, and then checks the live objects. The commands are below.

```bash
kubectl apply -f k8s/notifications/
kubectl rollout status deployment/notification-api -n notifications-prod --timeout=5m
kubectl get deployment notification-api notification-worker -n notifications-prod
kubectl get pods -n notifications-prod -l app.kubernetes.io/part-of=customer-notification-platform
```

During an incident, the flow gets more investigative. The sequence moves from high-level status into Pod details and logs. The commands are below.

```bash
kubectl get deployment notification-api -n notifications-prod
kubectl describe deployment notification-api -n notifications-prod
kubectl get pods -n notifications-prod -l app.kubernetes.io/name=notification-api
kubectl describe pod notification-api-7db9c9f5c6-j2k8p -n notifications-prod
kubectl logs deployment/notification-api -n notifications-prod --tail=100
```

The commands line up with the concepts from earlier. `get deployment` reads status. `describe deployment` shows controller activity and related events. `get pods` shows the current Pods under the Deployment. `describe pod` gives node-side events. `logs` shows what the application reported.

Alerts should follow the same structure. A useful alert can watch available replicas dropping below desired replicas, rollout progress exceeding the deadline, readiness failures rising, worker queue depth growing, or database connection errors increasing. Kubernetes reconciliation can replace Pods, but it cannot fix a broken image tag, missing migration, exhausted database, or wrong readiness endpoint without a corrected desired state.

This is also where adjacent production tools fit naturally. CI can validate YAML and apply a server-side dry run before merge. GitOps can keep the cluster aligned with reviewed manifests. Metrics and logs can show whether customer traffic, queue processing, and database health agree with the Kubernetes status.

## Putting It All Together
<!-- section-summary: Desired state gives Kubernetes a target, and reconciliation turns that target into ongoing operations. -->

The Customer Notification Platform gives us the full loop. The team writes Deployment and Service manifests for `notification-api`, a Deployment for `notification-worker`, and a Secret reference for the database connection. Those manifests become desired state in the Kubernetes API after `kubectl apply` or a GitOps sync.

Kubernetes then keeps reporting current state. Pods schedule onto nodes, kubelets start containers, readiness probes decide whether the API can receive traffic, Services point at ready endpoints, and controllers update status as they make progress. When something fails, events and status tell the team which part of the loop needs attention.

Rollouts use the same idea for releases. Updating the image changes desired state, the Deployment controller creates a new ReplicaSet, readiness gates traffic, rollout status reports progress, and rollback restores an earlier Pod template when a release hurts production. Manual changes fit into the same model once you ask whether they changed current state or desired state.

Here is the full API Deployment after all of those pieces have names. The spec is the target, status is what Kubernetes reports later, and reconciliation is the loop that keeps working on this target.

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

The key idea is simple enough to carry into every Kubernetes topic after this. You write the target, Kubernetes reports what happened, controllers keep working, and operators use status, events, logs, metrics, and reviewed manifests to guide the next change.

## What's Next

Now that desired state and reconciliation are clear, the next article can move into daily cluster navigation. We will look at namespaces and `kubectl` configuration, because operating safely depends on knowing which cluster, namespace, and context each command will touch.

---

**References**

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
