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

1. [The Pieces Around a Deployment](#the-pieces-around-a-deployment)
2. [What a Deployment Is](#what-a-deployment-is)
3. [ReplicaSets and Desired Replicas](#replicasets-and-desired-replicas)
4. [Labels and Selectors](#labels-and-selectors)
5. [A Production-Ready Deployment Manifest](#a-production-ready-deployment-manifest)
6. [Applying and Inspecting the Deployment](#applying-and-inspecting-the-deployment)
7. [Template Changes and Rollouts](#template-changes-and-rollouts)
8. [Scaling and Self-Healing](#scaling-and-self-healing)
9. [Debugging a Deployment](#debugging-a-deployment)
10. [Common Selector Mistakes](#common-selector-mistakes)
11. [Production Review Checklist](#production-review-checklist)
12. [References](#references)

## The Pieces Around a Deployment
<!-- section-summary: A Deployment sits above ReplicaSets and Pods, so it can keep a stateless service replicated, replaced, and updated. -->

The Pods article followed `devpolaris-orders-api` as one runnable unit. That was the right place to learn how Kubernetes starts containers, reports Pod status, runs probes, and exposes failure reasons such as `ImagePullBackOff` or `CrashLoopBackOff`.

A production API needs one more layer. The team wants three healthy copies of the orders API, a replacement when one Pod dies, and a careful path for shipping a new image. That is the job of a **Deployment**.

Here is the article map before we write any YAML:

| Concept | Plain meaning | How it shows up for `devpolaris-orders-api` |
|---|---|---|
| **Deployment** | The object that describes the desired running application | Keep three orders API Pods available and roll out new templates |
| **ReplicaSet** | The lower-level controller that keeps a matching number of Pods alive | Maintain the Pods for one template revision |
| **Replica count** | The number of matching Pods Kubernetes should keep | `replicas: 3` for normal traffic |
| **Selector** | The label query that decides which Pods belong to the controller | `app: devpolaris-orders-api` |
| **Pod template** | The blueprint used to create new Pods | Image, probes, ports, resources, and labels for each replica |
| **Rollout** | The process of moving from one Pod template revision to another | Ship image `2026-06-14.2` without dropping all traffic at once |

This chain explains why Kubernetes has more than one workload object. Pods run containers. ReplicaSets maintain a count of Pods. Deployments manage ReplicaSets so teams can update a stateless service with history and controlled replacement.

## What a Deployment Is
<!-- section-summary: A Deployment declares the desired state for a stateless workload and lets the Deployment controller move the cluster toward that state. -->

A **Deployment** is a Kubernetes workload object for running a set of replaceable Pods, usually for an application whose durable state lives outside any single Pod. The Deployment says how many replicas should exist, which Pods count as part of the application, and what new Pods should look like.

For `devpolaris-orders-api`, stateless means any healthy replica can handle an order request because durable data lives in PostgreSQL, object storage, a message queue, or another external system. The Pod can keep short-lived memory caches and open connections, but the business record of an order cannot depend on one Pod name staying alive forever.

The Deployment controller watches the desired state and the actual state. If the desired state says three replicas and the actual state has two ready Pods, the controller path creates another Pod through a ReplicaSet. If the Pod template changes because the image tag changed, the Deployment creates a new ReplicaSet for that new template and scales it in while scaling the old one out.

This gives the team an operating promise that a direct Pod cannot express by itself. The team can review a manifest, apply it, watch the rollout, inspect old ReplicaSets, and roll back to an earlier revision when a new version fails. The Deployment owns the daily interface, while the ReplicaSet handles the lower-level count.

## ReplicaSets and Desired Replicas
<!-- section-summary: A ReplicaSet keeps a stable number of matching Pods running for one Pod template revision, and a Deployment normally manages ReplicaSets for you. -->

A **ReplicaSet** is the controller that keeps a specified number of matching Pods running. It has three core pieces: a selector that identifies Pods, a replica count that says how many should exist, and a Pod template used when it needs to create new Pods.

In normal production work, teams usually create a Deployment and let the Deployment create ReplicaSets. The ReplicaSet still matters because it shows what Kubernetes is doing during a rollout. When image `2026-06-14.1` runs, there is a ReplicaSet for that template. When image `2026-06-14.2` ships, the Deployment creates a new ReplicaSet for the new template.

The relationship looks like this in the API:

```bash
$ kubectl get deployment,replicaset,pod -l app=devpolaris-orders-api
NAME                                     READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/devpolaris-orders-api    3/3     3            3           4m

NAME                                                DESIRED   CURRENT   READY   AGE
replicaset.apps/devpolaris-orders-api-6b8c9b6c7f    3         3         3       4m

NAME                                      READY   STATUS    RESTARTS   AGE
pod/devpolaris-orders-api-6b8c9b6c7f-2m9hx 1/1     Running   0          3m55s
pod/devpolaris-orders-api-6b8c9b6c7f-h7t4q 1/1     Running   0          3m55s
pod/devpolaris-orders-api-6b8c9b6c7f-vm5pb 1/1     Running   0          3m55s
```

The Deployment row gives the service-level view. The ReplicaSet row gives the count for the current template revision. The Pod rows show the actual runnable units. That outside-to-inside reading is the habit you want during incidents.

The generated suffix matters. Kubernetes adds a `pod-template-hash` label so the ReplicaSet for one template revision can identify its Pods. Kubernetes chooses that hash for the team. It lets old and new ReplicaSets exist at the same time during an update without both controllers claiming the same Pods.

## Labels and Selectors
<!-- section-summary: Labels describe Kubernetes objects, and selectors decide which Pods a controller or Service will act on. -->

**Labels** are key-value pairs attached to Kubernetes objects. They describe identity and grouping in a way humans, controllers, and commands can use. A Pod can have labels such as `app=devpolaris-orders-api`, `component=api`, and `environment=production`.

A **selector** is a query over labels. In a Deployment, the selector tells the ReplicaSet which Pods belong to it. In a Service, the selector tells Kubernetes which Pods should receive traffic. That makes labels and selectors a real contract between workload ownership and network routing.

Here is the key part of the orders API Deployment:

```yaml
spec:
  selector:
    matchLabels:
      app: devpolaris-orders-api
      component: api
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
        component: api
```

The selector and template labels match. That means Pods created from the template will be counted by the ReplicaSet. A Service can use the same stable identity labels to route traffic:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: devpolaris-orders-api
spec:
  selector:
    app: devpolaris-orders-api
    component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

The labels should describe stable application identity rather than temporary implementation details. An image tag is a poor Service selector because the tag changes during a rollout. A stable label such as `app=devpolaris-orders-api` lets old and new Pods both receive traffic when they are ready, which is exactly what a rolling update needs.

## A Production-Ready Deployment Manifest
<!-- section-summary: A practical Deployment manifest combines replicas, selectors, a Pod template, probes, resources, and rollout settings. -->

A production Deployment manifest is the versioned description of how the service should run. Teams often keep this YAML in a Git repository, sometimes rendered by Helm, Kustomize, or another delivery tool. The important part is that the desired state is reviewable and repeatable.

Here is a realistic starting manifest for `devpolaris-orders-api`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
    component: api
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
  minReadySeconds: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: devpolaris-orders-api
      component: api
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
        component: api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-06-14.1
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: orders-api-config
            - secretRef:
                name: orders-api-secrets
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          startupProbe:
            httpGet:
              path: /health/startup
              port: http
            periodSeconds: 5
            failureThreshold: 24
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            periodSeconds: 20
            timeoutSeconds: 2
            failureThreshold: 3
```

Several fields deserve attention. `replicas: 3` asks for three matching Pods. `revisionHistoryLimit: 5` keeps a small number of old ReplicaSets so rollback has history without keeping old objects forever. `progressDeadlineSeconds` gives Kubernetes a time window for rollout progress before it marks the rollout as failed.

The rolling update settings control replacement pace. `maxSurge: 1` allows one extra Pod above the desired count during the rollout. `maxUnavailable: 0` asks Kubernetes to keep the existing ready capacity available while new Pods come up. These values cost extra temporary capacity, but they suit a small API where dropping ready replicas during deployment would hurt users.

The Pod template contains the same Pod concerns from the previous article. Probes protect traffic and restart behavior. Resource requests help scheduling. Configuration comes from ConfigMaps and Secrets rather than raw values pasted through the manifest. The Deployment is only as healthy as the Pod template it keeps creating.

## Applying and Inspecting the Deployment
<!-- section-summary: Deployment inspection starts from desired and available counts, then moves through ReplicaSets and Pods until the failing layer is clear. -->

The team can apply the manifest through the normal Kubernetes API path. In a production workflow, CI or GitOps automation may run the apply step, but the commands are the same shape.

```bash
$ kubectl apply -f deployment.yaml
deployment.apps/devpolaris-orders-api created

$ kubectl rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out
```

The first inspection compares the desired state with current availability:

```bash
$ kubectl get deployment devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   3/3     3            3           2m
```

`READY` shows ready replicas over desired replicas. `UP-TO-DATE` shows how many Pods match the latest template. `AVAILABLE` shows how many Pods have been ready long enough to count as available. Those numbers tell you whether the rollout reached the intended steady state.

The next inspection includes the ownership chain:

```bash
$ kubectl get rs,pod -l app=devpolaris-orders-api,component=api
NAME                                                DESIRED   CURRENT   READY   AGE
replicaset.apps/devpolaris-orders-api-6b8c9b6c7f    3         3         3       2m

NAME                                      READY   STATUS    RESTARTS   AGE
pod/devpolaris-orders-api-6b8c9b6c7f-2m9hx 1/1     Running   0          2m
pod/devpolaris-orders-api-6b8c9b6c7f-h7t4q 1/1     Running   0          2m
pod/devpolaris-orders-api-6b8c9b6c7f-vm5pb 1/1     Running   0          2m
```

If the Deployment says `1/3`, this chain shows whether the ReplicaSet created three Pods and whether those Pods are failing individually. That saves the team from treating every Deployment problem as a Deployment-controller problem.

## Template Changes and Rollouts
<!-- section-summary: A Deployment creates a new ReplicaSet when the Pod template changes, and rollout commands show whether the new revision is progressing. -->

A **rollout** is the transition from one Deployment revision to another. Kubernetes creates a new revision when the Deployment’s Pod template changes. Updating the image, probes, environment sources, resource requests, labels inside the template, or container command can all create a new ReplicaSet.

The orders API team ships image `2026-06-14.2` after fixing a checkout bug. The template change can come from editing YAML in Git, from CI updating a rendered manifest, or from a direct command during a training exercise.

```bash
$ kubectl set image deployment/devpolaris-orders-api api=ghcr.io/devpolaris/orders-api:2026-06-14.2
deployment.apps/devpolaris-orders-api image updated

$ kubectl rollout status deployment/devpolaris-orders-api
Waiting for deployment "devpolaris-orders-api" rollout to finish: 1 out of 3 new replicas have been updated...
deployment "devpolaris-orders-api" successfully rolled out
```

During the rollout, the Deployment scales the new ReplicaSet up and the old ReplicaSet down according to the strategy. Readiness probes decide when each new Pod can count as ready. With `maxUnavailable: 0`, Kubernetes waits for new ready capacity before reducing old ready capacity.

Rollout history gives the team a quick view of revisions:

```bash
$ kubectl rollout history deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api
REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

When a new version fails, the team can return to the previous Deployment revision:

```bash
$ kubectl rollout undo deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api rolled back

$ kubectl rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out
```

Rollback is strongest when every release has a clear image tag, the Deployment keeps enough revision history, and database changes stay backward-compatible with the previous application version. A rollback command can move Pods back to an older template, but it cannot automatically undo a destructive database migration.

## Scaling and Self-Healing
<!-- section-summary: Scaling changes the desired replica count, and self-healing is the controller loop replacing Pods that no longer match that desired count. -->

**Scaling** changes how many replicas the Deployment should maintain. If traffic rises for the orders API during a launch, the team may need five Pods instead of three. A direct command can change the live replica count quickly.

```bash
$ kubectl scale deployment devpolaris-orders-api --replicas=5
deployment.apps/devpolaris-orders-api scaled

$ kubectl get deployment devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   5/5     5            5           18m
```

In a Git-managed production workflow, the team usually follows up by changing the replica count in the manifest or values file. That keeps the intended steady state visible in review. A manual scale can help during an incident, and a recorded configuration change keeps the cluster from drifting away from the declared desired state.

Some clusters use a HorizontalPodAutoscaler to manage replicas from metrics such as CPU or custom request traffic. When an autoscaler owns the replica count, teams usually let it manage `.spec.replicas` instead of repeatedly overwriting it through Deployment YAML. The Deployment still owns the Pod template and rollout behavior.

Self-healing uses the same desired-count loop. If one orders API Pod is deleted, the ReplicaSet notices that only four of five matching Pods remain and creates a replacement.

```bash
$ kubectl delete pod devpolaris-orders-api-6b8c9b6c7f-h7t4q
pod "devpolaris-orders-api-6b8c9b6c7f-h7t4q" deleted

$ kubectl get pods -l app=devpolaris-orders-api,component=api
NAME                                      READY   STATUS              RESTARTS   AGE
devpolaris-orders-api-6b8c9b6c7f-2m9hx   1/1     Running             0          22m
devpolaris-orders-api-6b8c9b6c7f-vm5pb   1/1     Running             0          22m
devpolaris-orders-api-6b8c9b6c7f-xd8fc   0/1     ContainerCreating   0          4s
```

The replacement Pod has a different name because the Deployment treats these Pods as replaceable replicas. That is a good fit for stateless APIs. Workloads that need stable Pod names and stable volume identity usually use StatefulSets instead.

## Debugging a Deployment
<!-- section-summary: Deployment debugging reads from the controller outward, then follows the ownership chain to ReplicaSets, Pods, events, and logs. -->

Deployment debugging starts with one question: did the Deployment create the desired Pods, and did those Pods become available? The answer lives in status fields, events, ReplicaSet counts, Pod status, and logs.

The first command gives the high-level rollout state:

```bash
$ kubectl describe deployment devpolaris-orders-api
Name:                   devpolaris-orders-api
Replicas:               3 desired | 2 updated | 4 total | 2 available | 2 unavailable
StrategyType:           RollingUpdate
MinReadySeconds:        10
Conditions:
  Type           Status  Reason
  Available      False   MinimumReplicasUnavailable
  Progressing    True    ReplicaSetUpdated
Events:
  Type    Reason             Age   From                   Message
  Normal  ScalingReplicaSet  45s   deployment-controller  Scaled up replica set devpolaris-orders-api-85d6ccf8d8 to 2
```

This says the rollout is still in progress and the available replica count is below the target. The next command shows which ReplicaSets exist:

```bash
$ kubectl get rs -l app=devpolaris-orders-api,component=api
NAME                                  DESIRED   CURRENT   READY   AGE
devpolaris-orders-api-6b8c9b6c7f      2         2         2       1h
devpolaris-orders-api-85d6ccf8d8      2         2         0       2m
```

The new ReplicaSet has zero ready Pods, so the investigation moves to Pods for that hash:

```bash
$ kubectl get pod -l pod-template-hash=85d6ccf8d8
NAME                                      READY   STATUS             RESTARTS   AGE
devpolaris-orders-api-85d6ccf8d8-9p2sr   0/1     CrashLoopBackOff   4          2m
devpolaris-orders-api-85d6ccf8d8-cb76n   0/1     CrashLoopBackOff   4          2m

$ kubectl logs devpolaris-orders-api-85d6ccf8d8-9p2sr -c api --previous --tail=40
2026-06-14T11:18:03Z fatal: missing ORDERS_DB_HOST
```

Now the failure has a specific cause. The new template points to an app version or configuration path that starts without the required environment variable. The team can fix the manifest and roll forward, or undo the rollout if the current live state needs fast recovery.

For image pull failures, the Deployment view may only show stuck progress. The Pod events reveal the real reason:

```bash
$ kubectl describe pod devpolaris-orders-api-85d6ccf8d8-9p2sr
Events:
  Type     Reason   Age   From     Message
  Warning  Failed   51s   kubelet  Failed to pull image: unauthorized
```

For readiness failures, the Pods may be running while the Deployment remains unavailable:

```bash
$ kubectl describe pod devpolaris-orders-api-85d6ccf8d8-9p2sr
Events:
  Type     Reason     Age   From     Message
  Warning  Unhealthy  24s   kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503
```

The Deployment controller is doing its job in all of these examples. It is waiting because the Pods created by the new ReplicaSet cannot become ready. That distinction matters during incidents because the fix belongs in the template, image, config, dependency, or registry path rather than in the controller itself.

## Common Selector Mistakes
<!-- section-summary: Selector mistakes either block the Deployment update, leave Pods outside controller ownership, or send Service traffic to the wrong Pods. -->

Selector mistakes cause some of the most confusing Kubernetes workload problems because the YAML can look almost correct. The fields are small, but they decide ownership and traffic.

The first mistake is a selector that differs from the Pod template labels. Kubernetes validates new Deployments and rejects this shape because the Deployment would create Pods it cannot select.

```yaml
spec:
  selector:
    matchLabels:
      app: devpolaris-orders-api
  template:
    metadata:
      labels:
        app: orders-api
```

The error points directly at the mismatch:

```bash
$ kubectl apply -f deployment.yaml
The Deployment "devpolaris-orders-api" is invalid:
spec.template.metadata.labels: Invalid value: map[string]string{"app":"orders-api"}:
`selector` does not match template `labels`
```

The second mistake is trying to change the selector on an existing Deployment. In `apps/v1`, the selector is immutable after creation. Kubernetes rejects the update because changing ownership rules underneath live ReplicaSets could orphan Pods or make controllers fight over them.

```bash
$ kubectl apply -f deployment.yaml
The Deployment "devpolaris-orders-api" is invalid:
spec.selector: Invalid value: v1.LabelSelector{MatchLabels:map[string]string{"app":"orders-api"}}:
field is immutable
```

When this happens, the team should inspect the live selector and align the file with it if the live selector is correct:

```bash
$ kubectl get deployment devpolaris-orders-api -o yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
spec:
  selector:
    matchLabels:
      app: devpolaris-orders-api
      component: api
```

If the label contract truly needs to change, the safer path is a planned migration. The migration creates a new Deployment with a new name and selector, adjusts the Service selector deliberately, verifies traffic, and then removes the old Deployment. That keeps ownership and routing changes visible instead of hiding them inside one failed update.

The third mistake is a Service selector that is too broad. A Service selector such as `component: api` may match several APIs in the same namespace. For the orders API, the Service should include the stable app identity as well as the component.

```yaml
spec:
  selector:
    app: devpolaris-orders-api
    component: api
```

This avoids accidental traffic to a different API that happens to share `component=api`. Labels are powerful because many objects can use them, and that same power means teams need a consistent label vocabulary.

## Production Review Checklist
<!-- section-summary: Deployment review checks the fields that affect ownership, availability, rollout behavior, capacity, and recovery. -->

A Deployment review asks whether Kubernetes will create the right Pods, route traffic only to ready Pods, and recover cleanly when something fails. The review should focus on fields that change runtime behavior rather than formatting alone.

For `devpolaris-orders-api`, the team should check the selector and template labels first. They define controller ownership. Then the team should check the Service selector because it defines traffic ownership. The Deployment can be perfect and the Service can still send traffic nowhere if the selector labels drift apart.

The image should be an immutable release artifact, usually a specific tag or digest produced by CI. A broad tag such as `latest` makes rollback and incident review harder because the tag can point to different content over time. A precise tag such as `2026-06-14.2` or an image digest gives the team a real release identity.

Readiness should protect users from a Pod that has started but cannot serve real traffic. Liveness should restart a stuck process without turning dependency outages into restart storms. Startup probes should give slow-starting applications enough time before liveness begins.

Resource requests should reflect measured needs so the scheduler has useful information. Limits should protect the node without making normal traffic hit avoidable throttling or memory kills. Teams often start with conservative values, observe real metrics, and adjust through normal review.

Rollout settings should fit the service and cluster capacity. `maxUnavailable: 0` and `maxSurge: 1` suit a small critical API when the cluster has room for one extra Pod. A larger service may use percentages. A workload with expensive startup may need careful `minReadySeconds` and `progressDeadlineSeconds` values so the rollout status matches real operational expectations.

The final verification commands keep the review grounded:

```bash
$ kubectl rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out

$ kubectl get deployment,rs,pod -l app=devpolaris-orders-api,component=api
NAME                                     READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/devpolaris-orders-api    3/3     3            3           5m

NAME                                                DESIRED   CURRENT   READY   AGE
replicaset.apps/devpolaris-orders-api-85d6ccf8d8    3         3         3       5m

NAME                                      READY   STATUS    RESTARTS   AGE
pod/devpolaris-orders-api-85d6ccf8d8-4t9qp 1/1     Running   0          4m
pod/devpolaris-orders-api-85d6ccf8d8-kb2nd 1/1     Running   0          4m
pod/devpolaris-orders-api-85d6ccf8d8-xq6nm 1/1     Running   0          4m
```

Those commands prove that the Deployment finished, the ReplicaSet has the requested count, and the Pods are ready. After that, application-level checks such as smoke tests, synthetic requests, dashboards, and alert silence confirm that the orders API is serving the real user path.

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
