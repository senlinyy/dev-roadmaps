---
title: "Deployments and ReplicaSets"
description: "Use Deployments and ReplicaSets to keep stateless Kubernetes applications running and update them safely."
overview: "Deployments are the usual way to run a stateless API on Kubernetes. They manage ReplicaSets for you, and ReplicaSets keep the requested number of matching Pods alive."
tags: ["deployments", "replicasets", "pods", "kubectl"]
order: 2
id: article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets
aliases:
  - containers-orchestration/orchestration-k8s/k8s-resources.md
  - article-containers-orchestration-orchestration-k8s-k8s-resources
---
## Table of Contents

1. [From One Pod to a Managed Service](#from-one-pod-to-a-managed-service)
2. [What a Deployment Adds](#what-a-deployment-adds)
3. [ReplicaSets and Desired Replicas](#replicasets-and-desired-replicas)
4. [Labels and Selectors](#labels-and-selectors)
5. [A Deployment Skeleton](#a-deployment-skeleton)
6. [Add Replicas and a Pod Template](#add-replicas-and-a-pod-template)
7. [Add Production Runtime Details](#add-production-runtime-details)
8. [Applying and Inspecting the Deployment](#applying-and-inspecting-the-deployment)
9. [Template Changes and Rollouts](#template-changes-and-rollouts)
10. [Scaling and Self-Healing](#scaling-and-self-healing)
11. [Debugging a Deployment](#debugging-a-deployment)
12. [Common Selector Mistakes](#common-selector-mistakes)
13. [Production Review Checklist](#production-review-checklist)
14. [References](#references)

## From One Pod to a Managed Service
<!-- section-summary: One Pod can run a container, and a Deployment adds the controller layer that keeps stateless service Pods replicated, replaced, and updated. -->

A direct Pod proves that Kubernetes can run the `notification-api` container. A service needs stronger promises than that: keep several replicas ready, replace a failed Pod, scale during traffic, and introduce a new image without deleting every old Pod at once.

A **Deployment** is the Kubernetes controller for that stateless service shape. It owns the desired replica count and Pod template, and it manages **ReplicaSets** underneath it. Each ReplicaSet maintains Pods for one template revision, while the Deployment decides how to move from an old template to a new one.

For the Customer Notification Platform, the Deployment describes a simple operating goal: keep three healthy `notification-api` Pods available, replace failed Pods, and roll out image `2026.06.14-2` through a controlled update. The worker service can use the same pattern in a separate Deployment because API replicas and worker replicas scale for different reasons.

A practical review sequence is: define the controller, make labels and selectors line up, add a Pod template, apply it, verify the controller chain, then debug rollout and ownership problems.

| Concept | Plain meaning | Notification example |
|---|---|---|
| **Deployment** | The object that describes the desired running application | Keep three `notification-api` Pods available and roll out new templates |
| **ReplicaSet** | The lower-level controller that keeps a matching number of Pods alive | Maintain the Pods for one template revision |
| **Replica count** | The number of matching Pods Kubernetes should keep | `replicas: 3` for normal traffic |
| **Selector** | The label query that decides which Pods belong to the controller | `app.kubernetes.io/name: notification-api` |
| **Pod template** | The blueprint used to create new Pods | Image, probes, ports, resources, and labels for each replica |
| **Rollout** | The process of moving from one Pod template revision to another | Ship image `2026.06.14-2` without dropping all traffic at once |

Pods run containers. ReplicaSets maintain a count of Pods. Deployments manage ReplicaSets so teams can update a stateless service with history and controlled replacement.

![Deployment ownership chain infographic showing a Deployment with replicas, a ReplicaSet with desired count, ready and unready Pods, and a Service routing only to ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/deployment-ownership-chain.png)

*A Deployment owns ReplicaSets, ReplicaSets own Pods, and the Service sends traffic only to ready matching Pods.*

_This infographic shows the ownership chain from Deployment to ReplicaSet to Pod, while the Service only sends traffic to Pods that are ready._

## What a Deployment Adds
<!-- section-summary: A Deployment declares the desired state for a stateless workload and lets the Deployment controller keep the cluster aligned with that state. -->

A **Deployment** is a Kubernetes workload object for running a set of replaceable Pods. It says how many replicas should exist, which Pods count as part of the application, and what new Pods should look like.

For `notification-api`, stateless means any healthy replica can receive a request to create a notification because durable state lives outside the Pod. The API writes notification records to a database and publishes work to a queue. The Pod can keep short-lived memory caches and open connections, but the business record cannot depend on one Pod name staying alive forever.

The Deployment controller watches desired state and actual state. If the desired state says three replicas and the actual state has two ready Pods, the controller path creates another Pod through a ReplicaSet. If the Pod template changes because the image tag changed, the Deployment creates a new ReplicaSet for that new template and scales it in while scaling the old one out.

The team gets an operating interface that a direct Pod cannot provide. They can review a manifest, apply it, watch rollout progress, inspect old ReplicaSets, and roll back to an earlier revision when a new version fails.

`notification-worker` is also a good Deployment candidate. It reads from a queue, processes messages, and sends emails or SMS messages. If one worker Pod disappears, another worker can pick up the next message. The API and worker should usually be separate Deployments because they scale and fail in different ways.

## ReplicaSets and Desired Replicas
<!-- section-summary: A ReplicaSet keeps a stable number of matching Pods running for one Pod template revision, and a Deployment normally manages ReplicaSets for you. -->

A **ReplicaSet** is the controller that keeps a specified number of matching Pods running. It has three core pieces: a selector that identifies Pods, a replica count that says how many should exist, and a Pod template used when it needs to create new Pods.

In normal production work, teams usually create a Deployment and let the Deployment create ReplicaSets. ReplicaSets still deserve attention during rollout debugging. When image `2026.06.14-1` runs, there is a ReplicaSet for that template. When image `2026.06.14-2` ships, the Deployment creates a new ReplicaSet for the new template.

The relationship looks like this in the API:

```bash
$ kubectl get deployment,replicaset,pod -n notifications \
  -l app.kubernetes.io/name=notification-api
NAME                              READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/notification-api  3/3     3            3           4m

NAME                                         DESIRED   CURRENT   READY   AGE
replicaset.apps/notification-api-6b8c9b6c7f  3         3         3       4m

NAME                               READY   STATUS    RESTARTS   AGE
pod/notification-api-6b8c9b6c7f-a  1/1     Running   0          3m
```

The Deployment is the object you edit. The ReplicaSet is the object maintaining the current template's Pods. The Pods are the runnable units.

## Labels and Selectors
<!-- section-summary: Labels and selectors define ownership, so the Deployment, ReplicaSet, Pod template, and Service must agree on the same stable identity. -->

A **label** is a key-value tag on a Kubernetes object. A **selector** is a query that matches labels. Deployments use selectors to decide which Pods belong to them. Services use selectors to decide which Pods receive traffic.

The selector deserves attention first because it is the ownership contract. For the notification API, the Deployment, ReplicaSet, Pod template, and Service all need to agree on the stable identity of the API Pods. If those labels drift, Kubernetes may run Pods successfully while the controller or Service points at the wrong set.

For `notification-api`, the stable app identity can be:

```yaml
app.kubernetes.io/name: notification-api
app.kubernetes.io/component: api
app.kubernetes.io/part-of: customer-notification-platform
```

The Deployment selector must match the Pod template labels:

```yaml
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
        app.kubernetes.io/component: api
```

Those two blocks form the ownership contract. If the selector and template labels mismatch, Kubernetes rejects the Deployment. If a Service selector drifts away from those labels, the Deployment can be healthy while traffic goes nowhere.

Selectors also create a long-term constraint. In an existing Deployment, `.spec.selector` is effectively something you plan carefully up front. Changing it later is limited, and the safer migration often creates a new Deployment with a new name and selector.

## A Deployment Skeleton
<!-- section-summary: The Deployment skeleton shows the controller shape before adding every runtime detail. -->

The first Deployment shape has identity, a selector, and the label half of a Pod template. It is intentionally small so the controller relationship stays visible before the manifest fills with ports, probes, resources, and configuration.

For the notification API, the Deployment needs a stable name, a namespace, and a selector that matches the labels copied onto new Pods. Once that relationship is correct, the Pod template can grow safely without hiding the ownership contract reviewers need to check first.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
      app.kubernetes.io/component: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
        app.kubernetes.io/component: api
```

This snippet is only the controller shell because the Pod template has no `spec.containers` yet. It gives you the main shape while keeping the important relationship visible: the selector and template labels must agree.

The field groups have different jobs:

- `apiVersion` and `kind` tell Kubernetes this object uses the Deployment controller.
- `metadata.name` and `metadata.namespace` give the Deployment its address inside the cluster.
- `spec.selector.matchLabels` defines which Pods this Deployment owns.
- `spec.template.metadata.labels` defines the labels copied onto new Pods, and those labels must satisfy the selector.

Add the desired replica count next:

```yaml
spec:
  replicas: 3
```

`replicas: 3` means Kubernetes should keep three matching Pods alive. Those three replicas may land on one node unless other rules, topology settings, or capacity limits distribute them across nodes.

## Add Replicas and a Pod Template
<!-- section-summary: The Pod template is the blueprint each ReplicaSet uses when it needs to create another matching Pod. -->

A **Pod template** is the `spec.template` section inside a Deployment. It describes the Pods the Deployment should create. Any meaningful change inside the template, such as a new image, environment variable, label, resource setting, or probe, creates a new template revision.

The template is the piece the ReplicaSet uses whenever it needs another API Pod. For the notification platform, that means every replacement Pod should receive the same image, port name, labels, configuration pattern, probes, and resource shape. A template change is a release event because new Pods come from the changed blueprint.

Here is the first runnable container part of the template:

```yaml
template:
  metadata:
    labels:
      app.kubernetes.io/name: notification-api
      app.kubernetes.io/component: api
  spec:
    containers:
      - name: api
        image: ghcr.io/customer-notification/notification-api:2026.06.14-1
        ports:
          - name: http
            containerPort: 8080
```

This looks like the direct Pod article because the Deployment eventually creates Pods. The difference is ownership. If a Pod created from this template disappears, the ReplicaSet notices the count dropped and creates a replacement.

The worker service would use the same Deployment pattern with a different component label and container command:

```yaml
metadata:
  name: notification-worker
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-worker
```

That small split helps operations. Scaling the API leaves the worker scale alone. Rolling back the worker leaves the public API on its current version.

## Add Production Runtime Details
<!-- section-summary: Production templates add resource settings, probes, configuration references, and rollout limits so the Deployment can update safely. -->

After the skeleton and container shape are clear, add runtime fields that affect production behavior.

These fields are the difference between "Kubernetes can start the process" and "Kubernetes can operate the service under traffic." The notification API needs capacity planning so the scheduler can place it, readiness so the Service only routes to useful Pods, and rollout limits so a release can replace replicas without dropping the whole API at once.

**Resource requests and limits** describe the capacity shape. The scheduler uses requests for placement, and the kubelet/runtime enforce limits after the container starts.

```yaml
resources:
  requests:
    cpu: 300m
    memory: 384Mi
  limits:
    cpu: "1"
    memory: 768Mi
```

**Readiness probes** protect traffic. The Pod can be running while the app is still connecting to the database or queue. The Service should only route to the Pod after readiness passes.

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  periodSeconds: 5
  failureThreshold: 3
```

**Rollout settings** control replacement speed. For a small critical API, `maxUnavailable: 0` and `maxSurge: 1` keep all old replicas serving while Kubernetes adds one extra new Pod at a time.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
progressDeadlineSeconds: 300
revisionHistoryLimit: 5
```

`progressDeadlineSeconds` makes a stuck rollout visible as a Deployment condition. `revisionHistoryLimit` keeps old ReplicaSets around so rollback has previous templates available.

## Applying and Inspecting the Deployment
<!-- section-summary: Applying a Deployment should be followed by checks on the Deployment, ReplicaSet, Pods, rollout status, and traffic readiness. -->

Applying a Deployment is only the first half of the operation. The API server can accept the object while Pods are still scheduling, pulling images, starting, or waiting for readiness. For the notification API, the useful workflow is to apply the desired state, watch the rollout, inspect the controller chain, and then run an application-level smoke test that proves the user-facing path works.

In a local learning cluster, the first step may be a direct command:

```bash
$ kubectl apply -f notification-api-deployment.yaml
deployment.apps/notification-api created

$ kubectl rollout status deployment/notification-api -n notifications --timeout=5m
deployment "notification-api" successfully rolled out
```

`kubectl apply` sends the desired state to the API server. `kubectl rollout status` watches the Deployment until the rollout reaches the requested state or the timeout is reached.

Then inspect the controller chain:

```bash
$ kubectl get deployment,rs,pod -n notifications \
  -l app.kubernetes.io/name=notification-api
NAME                              READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/notification-api  3/3     3            3           5m

NAME                                         DESIRED   CURRENT   READY   AGE
replicaset.apps/notification-api-85d6ccf8d8  3         3         3       5m

NAME                               READY   STATUS    RESTARTS   AGE
pod/notification-api-85d6ccf8d8-a  1/1     Running   0          4m
pod/notification-api-85d6ccf8d8-b  1/1     Running   0          4m
pod/notification-api-85d6ccf8d8-c  1/1     Running   0          4m
```

That output proves that the Deployment has three available replicas, the ReplicaSet has the desired count, and each Pod is ready. A smoke test should follow Kubernetes success:

```bash
$ curl -fsS https://notify.devpolaris.example/internal/smoke/template-preview
{"status":"ok","channel":"email","template":"password-reset"}
```

Kubernetes can tell you the Pods are ready. The smoke test tells you the application path works.

## Template Changes and Rollouts
<!-- section-summary: Changing the Pod template creates a new ReplicaSet, and the Deployment shifts traffic capacity from old Pods to new Pods. -->

A **rollout** starts after a Deployment Pod template change. Updating only `metadata.annotations` on the Deployment object leaves existing Pods alone. Updating the image, environment variables, template labels, probes, or resources creates a new ReplicaSet.

For the notification API, a rollout is the moment the new release meets live capacity. Kubernetes keeps the old ReplicaSet around while the new template proves it can start and pass readiness. Watching both ReplicaSets helps the team see whether the release is progressing, waiting for readiness, or stuck on the new Pods.

The notification team ships version `2026.06.14-2` with improved provider retry handling:

```bash
$ kubectl set image deployment/notification-api -n notifications \
  api=ghcr.io/customer-notification/notification-api:2026.06.14-2
deployment.apps/notification-api image updated
```

Now the Deployment owns two ReplicaSets for a while:

```bash
$ kubectl get rs -n notifications -l app.kubernetes.io/name=notification-api
NAME                         DESIRED   CURRENT   READY   AGE
notification-api-85d6ccf8d8  2         2         2       20m
notification-api-6f8f7b9d88  2         2         1       45s
```

The new ReplicaSet grows as new Pods report ready. The old ReplicaSet shrinks only when the strategy permits removal. With `maxUnavailable: 0`, Kubernetes avoids reducing available capacity below the desired replica count during the update.

![Rolling update with two ReplicaSets infographic showing an old ReplicaSet serving v1 Pods while a new ReplicaSet brings up v2 Pods through readiness and maxSurge one](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/rolling-update-two-replicasets.png)

*During a rolling update, old and new ReplicaSets can exist together while readiness controls traffic safety.*

_This infographic makes the rollout handoff visible: the new ReplicaSet grows only as new Pods report ready, while the old ReplicaSet shrinks after capacity is safe._

## Scaling and Self-Healing
<!-- section-summary: Deployments keep the requested replica count by creating replacement Pods and by scaling the active ReplicaSet. -->

**Scaling** changes the desired replica count. If notification traffic increases during a marketing campaign, the team may scale the API from three replicas to five:

Scaling changes desired state through the Deployment. The team asks for a new count, and the active ReplicaSet creates or removes Pods to match. For the notification platform, this matters because API replicas, worker replicas, database capacity, and provider limits all need to stay in balance during a campaign.

```bash
$ kubectl scale deployment/notification-api -n notifications --replicas=5
deployment.apps/notification-api scaled

$ kubectl get deployment notification-api -n notifications
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   5/5     5            5           30m
```

Kubernetes creates or removes Pods through the active ReplicaSet to match the new desired count. A Horizontal Pod Autoscaler can change this number automatically, but the Deployment still owns the Pod template and rollout history.

**Self-healing** means the controller repairs drift from the desired state. If one Pod is deleted, the ReplicaSet creates another:

```bash
$ kubectl delete pod -n notifications notification-api-85d6ccf8d8-a
pod "notification-api-85d6ccf8d8-a" deleted

$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-api
NAME                               READY   STATUS              AGE
notification-api-85d6ccf8d8-b      1/1     Running             31m
notification-api-85d6ccf8d8-c      1/1     Running             31m
notification-api-85d6ccf8d8-r9k2m  0/1     ContainerCreating   3s
```

The replacement Pod gets a new name. That is normal for stateless services. Clients should use a Service for stable routing instead of individual Pod names.

## Debugging a Deployment
<!-- section-summary: Deployment debugging starts at rollout status, then moves through Deployment conditions, ReplicaSets, Pod events, and application logs. -->

Deployment debugging should follow the controller chain. The Deployment condition says whether progress stopped, ReplicaSets show which template revision is active, Pods show the runtime symptom, and logs or events explain the local cause. For `notification-api`, this path separates a template bug from a capacity problem before the team chooses a forward patch or rollback during a live release.

When a Deployment looks stuck, rollout status gives the first high-level signal:

```bash
$ kubectl rollout status deployment/notification-api -n notifications --timeout=60s
Waiting for deployment "notification-api" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

Then check the Deployment conditions and recent events:

```bash
$ kubectl describe deployment notification-api -n notifications
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    False   ProgressDeadlineExceeded
Events:
  Normal   ScalingReplicaSet  Scaled up replica set notification-api-7c9d4c685b to 1
```

The Deployment tells you progress stalled. The Pods usually tell you why:

```bash
$ kubectl get pods -n notifications \
  -l app.kubernetes.io/name=notification-api -L pod-template-hash
NAME                               READY   STATUS             HASH
notification-api-85d6ccf8d8-a      1/1     Running            85d6ccf8d8
notification-api-85d6ccf8d8-b      1/1     Running            85d6ccf8d8
notification-api-7c9d4c685b-m8vnn  0/1     CrashLoopBackOff   7c9d4c685b
```

Now inspect the failing Pod:

```bash
$ kubectl logs -n notifications notification-api-7c9d4c685b-m8vnn --previous --tail=40
Error: NOTIFICATION_EVENT_TOPIC is required
```

The evidence points to a template bug rather than a cluster capacity problem. The repair may be a forward patch that adds the missing environment variable or a rollback to the previous revision.

## Common Selector Mistakes
<!-- section-summary: Selector mistakes cause ownership and routing bugs, so teams should keep app identity labels stable and avoid broad Service selectors. -->

The first mistake is a mismatch between `spec.selector.matchLabels` and `spec.template.metadata.labels`. Kubernetes rejects that Deployment because the selector would fail to claim the Pods in the template.

The second mistake is trying to change the selector on an existing Deployment as part of a rename. If `notification-api` needs a new name such as `message-api`, create a planned migration. A new Deployment with a new name and selector lets the team adjust the Service selector deliberately, verify traffic, and then remove the old Deployment.

The third mistake is a Service selector that is too broad. A Service selector such as `app.kubernetes.io/component: api` may match several APIs in the same namespace. The notification API Service should include the stable app identity as well as the component.

```yaml
spec:
  selector:
    app.kubernetes.io/name: notification-api
    app.kubernetes.io/component: api
```

Labels are powerful because many objects can use them. That same power means teams need a consistent label vocabulary and careful selector review.

## Production Review Checklist
<!-- section-summary: Deployment review checks the fields that affect ownership, availability, rollout behavior, capacity, and recovery. -->

A Deployment review asks whether Kubernetes will create the right Pods, route traffic only to ready Pods, and recover cleanly when something fails. The review should focus on fields that change runtime behavior rather than formatting alone.

For `notification-api`, the team should check the selector and template labels first. They define controller ownership. Then the team should check the Service selector because it defines traffic ownership. The Deployment can be correct while the Service sends traffic nowhere if selector labels drift apart.

After walking through each field, the complete manifest can fit together like this:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-api
      app.kubernetes.io/component: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-api
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notification/notification-api:2026.06.14-2
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: notification-api-config
          resources:
            requests:
              cpu: 300m
              memory: 384Mi
            limits:
              cpu: "1"
              memory: 768Mi
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
```

The image should be an immutable release artifact, usually a specific tag or digest produced by CI. Readiness should protect users from a Pod that has started but cannot serve real traffic. Resource requests should reflect measured needs so the scheduler has useful information. Rollout settings should fit the service and cluster capacity.

The final verification commands keep the review grounded:

```bash
$ kubectl rollout status deployment/notification-api -n notifications
deployment "notification-api" successfully rolled out

$ kubectl get deployment,rs,pod -n notifications \
  -l app.kubernetes.io/name=notification-api,app.kubernetes.io/component=api
NAME                              READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/notification-api  3/3     3            3           5m
```

Those commands prove that the Deployment finished and the available count matches the desired count. Application-level checks such as smoke tests, synthetic requests, dashboards, and alert silence confirm that the notification API is serving the real user path.

![Deployment production review infographic showing selectors, image, probes, resources, rollout, verify, rollout status, ReplicaSets, and ready Pods around a Deployment manifest](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/deployment-production-review.png)

*A production Deployment review should connect selectors, images, probes, resources, rollout status, and ready Pods.*

_This infographic summarizes the Deployment review habit: check ownership, artifact identity, readiness, capacity, rollout behavior, and verification evidence together._

## References

- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/) - Official overview of workload resources and workload management.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Deployment concept guide, including use cases, rollouts, rollbacks, scaling, and Deployment spec details.
- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) - Official ReplicaSet guide explaining replica maintenance, selectors, owner references, and when to use Deployments.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official Pod guide for the lower-level objects created by ReplicaSets.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official guide for labels, selectors, and label query behavior.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) - Official reference for listing Deployments, ReplicaSets, and Pods.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Official reference for detailed resource state and events.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Official reference for retrieving logs from Pods and workload resources.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Official reference for rollout status, history, restart, pause, resume, and undo.
