---
title: "Deployments and ReplicaSets"
description: "Use Deployments and ReplicaSets to keep stateless Kubernetes applications running and move them safely between Pod-template revisions."
overview: "A ReplicaSet keeps the requested number of Pods for one exact template. A Deployment manages those ReplicaSets over time, giving Kubernetes scaling, rolling updates, release history, and rollback."
tags: ["deployments", "replicasets", "pods", "kubectl"]
order: 2
id: article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets
aliases:
  - containers-orchestration/orchestration-k8s/k8s-resources.md
  - article-containers-orchestration-orchestration-k8s-k8s-resources
---

## Table of Contents

1. [How does a ReplicaSet keep one Pod population at the desired size?](#how-does-a-replicaset-keep-one-pod-population-at-the-desired-size)
2. [Why does a Deployment sit above ReplicaSets?](#why-does-a-deployment-sit-above-replicasets)
3. [How do selectors and owner references divide membership from ownership?](#how-do-selectors-and-owner-references-divide-membership-from-ownership)
4. [Which controller responds when a container or Pod disappears?](#which-controller-responds-when-a-container-or-pod-disappears)
5. [How does a Deployment move an application between template revisions?](#how-does-a-deployment-move-an-application-between-template-revisions)
6. [Why are overlapping selectors dangerous?](#why-are-overlapping-selectors-dangerous)
7. [How do you read Deployment status and debug the controller chain?](#how-do-you-read-deployment-status-and-debug-the-controller-chain)
8. [How does the complete Deployment lifecycle fit together?](#how-does-the-complete-deployment-lifecycle-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A **Deployment is Kubernetes' release manager**. It answers a wider question: which Pod-template revision should run, and how should the cluster move from the previous revision to the next one?

A **ReplicaSet is Kubernetes' replica-count manager**. It answers a narrower question: for this exact Pod template, how can the cluster keep a requested number of copies alive?

The most important mental model is therefore:

**Deployment → ReplicaSet → Pods**

Not:

**Deployment → Pods**

That extra ReplicaSet layer is what makes rolling updates, rollback history, and multiple application versions possible. A Deployment manages one or more ReplicaSets over time. Each ReplicaSet directly manages the Pods created from one Pod-template revision. The Pod article explained how one Pod turns into running containers on a node; this article adds the two controller layers that preserve a population and change it over time.

Keep these questions in view as you work through the lesson:

1. **How does a ReplicaSet keep one Pod population at the desired size?**
2. **Why does a Deployment sit above ReplicaSets?**
3. **How do selectors and owner references divide membership from ownership?**
4. **Which controller responds when a container or Pod disappears?**
5. **How does a Deployment move an application between template revisions?**
6. **Why are overlapping selectors dangerous?**
7. **How do you read Deployment status and debug the controller chain?**
8. **How does the complete Deployment lifecycle fit together?**

## How does a ReplicaSet keep one Pod population at the desired size?
<!-- section-summary: A ReplicaSet repeatedly compares a desired replica count with the Pods it currently manages, then creates or removes Pods to close the difference. -->

A Pod describes one runnable instance. A ReplicaSet adds the longer-lived population rule around those instances: it records how many Pods of one template should exist, then keeps checking whether the current count still matches that request.

### Kubernetes constantly corrects reality

Start with a simple request: keep three copies of a web server running.

The Kubernetes API stores the requested value as **desired state**. Controllers observe the objects that currently exist as **actual state**. A controller compares the two and writes the smallest correction that moves actual state toward desired state.

For replica count, that loop can be written as a small state table:

| Desired replicas | Actual replicas | Difference | Controller action |
|---:|---:|---:|---|
| 3 | 2 | One missing | Create one Pod |
| 3 | 4 | One extra | Remove one Pod |
| 3 | 3 | Equal | Wait and observe again |

Three manually created Pods contain no shared instruction that says three copies must continue to exist. If one Pod disappears, the other two remain valid objects and carry no responsibility for creating a replacement.

A ReplicaSet adds that durable population constraint. Its controller continuously observes the selected Pods, compares their count with `.spec.replicas`, and creates or removes Pod objects through the API. The loop cares about the population size rather than the lifetime of a particular Pod name.

### A ReplicaSet combines a selector, a count, and a creation template

This ReplicaSet asks Kubernetes to maintain three Pods running `nginx:1.27`:

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
```

The three important fields answer three different questions.

`replicas: 3` answers **how many Pods should exist**.

The selector answers **which existing Pods belong to the population being counted**:

```yaml
selector:
  matchLabels:
    app: web
```

The template answers **what the controller should create when the population is too small**:

```yaml
template:
  metadata:
    labels:
      app: web
  spec:
    containers:
      - name: web
        image: nginx:1.27
```

The selector is for finding. The template is for creating. Keeping those jobs separate will matter when we examine adoption, rolling updates, and template hashes.

## Why does a Deployment sit above ReplicaSets?
<!-- section-summary: A ReplicaSet maintains one template revision, while a Deployment coordinates the transition between old and new ReplicaSets. -->

### Keeping Pods alive and changing their version are different problems

A ReplicaSet can keep three `nginx:1.27` Pods alive for as long as that template remains desired. Releasing `nginx:1.28` introduces another problem. The cluster must move the application from configuration A to configuration B while useful old capacity remains available.

For part of that transition, both populations are valid:

| Rollout stage | Old ReplicaSet: `nginx:1.27` | New ReplicaSet: `nginx:1.28` |
|---|---:|---:|
| Before the change | 3 | 0 |
| First new Pod | 3 | 1 |
| Middle of rollout | 2 | 2 |
| Near completion | 1 | 3 |
| Completed | 0 | 3 |

One controller must decide when to create the new population, when new Pods are healthy enough to count, how quickly old capacity can leave, and which earlier template can be restored after a failed release. That transition-management responsibility belongs to the Deployment controller.

A ReplicaSet manages **one population**. A Deployment manages **populations over time**. This separation gives Kubernetes rolling updates, release history, and rollback without weakening the ReplicaSet's simpler count-maintenance loop.

### A Deployment controls the Pod template and the movement between revisions

The following Deployment asks for three Pods and defines how a rolling update may use temporary capacity:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

When `kubectl apply -f deployment.yaml` succeeds, the API server stores a Deployment object. The later work happens through several observers and API writes:

1. The Deployment controller sees a Deployment with a Pod template and no matching ReplicaSet.
2. It creates a ReplicaSet that represents that exact template.
3. The ReplicaSet controller sees a desired count of three and an actual count of zero.
4. It creates three Pod objects from the stored template.
5. The scheduler assigns those Pods to nodes.
6. Kubelets and container runtimes start the containers and report status.

This is why `kubectl get rs` reveals an object that the application team never authored directly:

```text
NAME             DESIRED   CURRENT   READY
web-6d9c87f5bf   3         3         3
```

The Deployment created the ReplicaSet. The ReplicaSet created the Pods. Kubernetes recommends operating the Deployment while using its ReplicaSets as visible, debuggable implementation objects.

### Kubernetes records the ownership chain in object metadata

The controller hierarchy also exists as data. Kubernetes records it in `metadata.ownerReferences`.

An abbreviated ReplicaSet owned by `Deployment/web` contains:

```yaml
metadata:
  name: web-6d9c87f5bf
  ownerReferences:
    - apiVersion: apps/v1
      kind: Deployment
      name: web
      controller: true
```

One of its Pods contains another reference:

```yaml
metadata:
  name: web-6d9c87f5bf-2j6xt
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: web-6d9c87f5bf
      controller: true
```

The Pod's direct controller owner is the ReplicaSet. The ReplicaSet's controller owner is the Deployment. Kubernetes also uses owner references during garbage collection and when deciding whether another controller may adopt an object.

![Studio Light infographic showing Deployment web managing ReplicaSet web-AAA, the ReplicaSet maintaining three Pods, and ownership metadata connecting each level](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/deployment-controller-chain.png)

*The Deployment owns the release-level object, while the ReplicaSet directly owns and maintains the Pod population for one template revision.*

## How do selectors and owner references divide membership from ownership?
<!-- section-summary: Labels and selectors discover candidate Pods, while owner references record which exact controller manages each dependent object. -->

The controller chain explains who created each object, but a ReplicaSet also needs a way to find the Pods that count toward its population. Kubernetes keeps those two relationships separate because finding a matching object and having authority over it are different decisions.

### Selectors discover members; owner references record authority

Suppose a Pod carries this label:

```yaml
metadata:
  labels:
    app: web
```

The ReplicaSet selects the same label:

```yaml
selector:
  matchLabels:
    app: web
```

The selector says that Pods labelled `app=web` are candidates for the population the ReplicaSet counts. The label alone contains no history of who created the Pod.

For example, someone could create a bare Pod manually:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: random-pod
  labels:
    app: web
spec:
  containers:
    - name: web
      image: nginx:1.27
```

This Pod matches the selector. If it has no controlling owner reference, the ReplicaSet can **adopt** it by adding itself as the controlling owner. The adopted Pod then counts toward the desired replica total.

This example reveals the division clearly:

- labels and selectors provide **discovery and membership matching**;
- an owner reference provides **controller ownership** for one exact object.

The distinction matters because a matching Pod can exist before adoption, while an already controlled Pod remains attached to its current controller. Labels connect many independent Kubernetes mechanisms; owner references establish a direct dependent relationship.

### The selector and Pod-template labels must describe the same population

The ReplicaSet selector and template repeat `app: web` for a practical reason. Every Pod created from the template must also enter the population the ReplicaSet counts.

Consider a selector that looks for `app=web` paired with a template that creates `app=banana` Pods. The controller would observe zero matching Pods, create a Pod that still fails the selector, observe zero again, and continue producing unrelated objects.

The Kubernetes API rejects this contradictory shape. In an `apps/v1` Deployment, the selector is also immutable after creation. Stable selector labels therefore need deliberate values that can survive releases. Version labels, commit hashes, and other changing information belong elsewhere in the Pod template.

For the `web` workload, these blocks agree:

```yaml
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
```

The selector continues to describe the application family while Deployment-generated labels separate individual revisions later.

## Which controller responds when a container or Pod disappears?
<!-- section-summary: A ReplicaSet replaces a missing Pod object, while the kubelet restarts a failed container inside an existing Pod. -->

### A ReplicaSet restores population size rather than a particular Pod identity

Assume `ReplicaSet/web-AAA` wants three replicas and currently owns Pods A, B, and C. Desired and actual state are equal.

Now delete Pod B:

```bash
kubectl delete pod Pod-B
```

The ReplicaSet controller sees two managed Pods against a desired count of three. The requirement stored in the ReplicaSet says three matching Pods should exist. It says nothing about preserving Pod B's name, UID, IP address, or node assignment.

The controller creates Pod D from the template. The resulting population contains A, C, and D. Desired and actual counts are equal again, while one member has a completely new identity.

The replacement has a new Pod identity because Kubernetes created a new object. Controllers preserve desired populations; individual Pods remain replaceable members of those populations.

### A crashed container and a missing Pod cross different control boundaries

If the nginx process exits inside an existing Pod, the Pod object still exists and remains assigned to its node. The kubelet on that node restarts the container according to `restartPolicy: Always`. The restart count changes inside the same Pod identity.

If the whole Pod object disappears, the ReplicaSet restores the population with another Pod. If the Pod template changes, the Deployment creates and coordinates another ReplicaSet.

| Observed change | Controller that responds first | Correction |
|---|---|---|
| Container process exits | Kubelet | Restart the container inside the existing Pod |
| Pod object disappears | ReplicaSet controller | Create a replacement Pod from the same template |
| Pod-template revision changes | Deployment controller | Create or reuse a ReplicaSet for that template and coordinate the rollout |

The control loops are layered. Kubelet preserves the containers described by one Pod. ReplicaSet preserves the number of Pods for one revision. Deployment preserves the intended release and transition between revisions.

## How does a Deployment move an application between template revisions?
<!-- section-summary: Each Pod-template revision gets its own ReplicaSet, and the Deployment changes the sizes of old and new ReplicaSets to carry out a rollout. -->

Replacing a missing Pod restores the current revision. A release asks for something different: preserve enough useful capacity while moving the application from the old Pod template to a new one. That is the transition the Deployment coordinates through multiple ReplicaSets.

### A Deployment usually has multiple ReplicaSets over its lifetime

Start with a Deployment whose template runs `myapp:v1`. The Deployment controller creates a ReplicaSet for that template, and the ReplicaSet maintains three v1 Pods.

Changing the template image to `myapp:v2` describes a new kind of Pod. Kubernetes preserves the earlier ReplicaSet and creates another one for v2. For part of the rollout, the Deployment owns both:

| Managed ReplicaSet | Stored template | Desired replicas during transition |
|---|---|---:|
| `web-AAA` | `myapp:v1` | Decreases from 3 toward 0 |
| `web-BBB` | `myapp:v2` | Increases from 0 toward 3 |

Each ReplicaSet represents one particular Pod-template revision. The Deployment acts as the higher-level state machine that changes their desired sizes. This architecture lets old and new Pods coexist while keeping each population independently countable.

### Scaling and rolling updates change different parts of desired state

Suppose `web-AAA` currently maintains three v1 Pods. Changing the Deployment from `replicas: 3` to `replicas: 5` changes quantity while preserving the Pod template.

```bash
kubectl scale deployment/web --replicas=5
```

The Deployment scales `web-AAA` from three to five. The same ReplicaSet creates the additional Pods, the template hash stays the same, and Kubernetes creates no new rollout revision.

Changing the image from `myapp:v1` to `myapp:v2` changes `.spec.template`:

```bash
kubectl set image deployment/web \
  web=myapp:v2
```

The Deployment creates a new ReplicaSet because the desired Pod shape changed. The concise rule from the raw material is worth keeping:

> **Changing quantity scales. Changing the Pod template rolls out.**

Kubernetes defines a Deployment rollout around changes to `.spec.template`. A replica-count change alone remains a scaling operation.

### The Pod template contains more than an image

An image update is the most visible template change, yet `.spec.template` contains the complete Pod blueprint. A rollout also starts when the template changes in areas such as:

- environment variables;
- resource requests and limits;
- Pod labels;
- Pod-template annotations.

For example, adding a required environment variable changes the process created inside every future Pod. Existing Pods keep the environment they received at process start, so the Deployment creates replacement Pods from the changed template.

`kubectl rollout restart deployment/web` uses the same mechanism. The command changes an annotation inside the Pod template. A different template produces another ReplicaSet and new Pods even when the image stays the same.

### A rolling update is coordinated scaling of two ReplicaSets

Consider this rollout policy:

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

The Deployment starts with three available v1 Pods. `maxSurge: 1` allows the desired population to rise temporarily to four. `maxUnavailable: 0` requires three replicas to remain available while the transition proceeds.

One valid progression is:

| Step | Old ReplicaSet v1 | New ReplicaSet v2 | Total desired | What allows the next step? |
|---:|---:|---:|---:|---|
| 1 | 3 | 0 | 3 | Deployment creates the new ReplicaSet |
| 2 | 3 | 1 | 4 | The surge Pod starts and passes readiness |
| 3 | 2 | 1 | 3 | One old Pod can leave while three stay available |
| 4 | 2 | 2 | 4 | Another new Pod becomes available |
| 5 | 1 | 2 | 3 | Another old Pod can leave |
| 6 | 1 | 3 | 4 | The final new Pod becomes available |
| 7 | 0 | 3 | 3 | The rollout reaches the target revision |

The old ReplicaSet normally remains as an API object with zero replicas. Its template and revision metadata support rollout history and rollback. `revisionHistoryLimit` controls how many eligible old ReplicaSets the Deployment retains; the current default is ten.

![Studio Light infographic showing a rolling update as coordinated scaling from three v1 Pods in ReplicaSet web-AAA to three v2 Pods in ReplicaSet web-BBB, constrained by maxSurge one and maxUnavailable zero](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/rolling-update-replicaset-transfer.png)

*A rolling update grows the new ReplicaSet and shrinks the old one only after new Pods contribute enough available capacity.*

Readiness belongs directly in this algorithm. A new container can be running while its readiness probe still fails. With `maxUnavailable: 0`, the Deployment retains old available Pods until the new Pod proves it can serve. If new capacity never becomes available, `progressDeadlineSeconds` lets the Deployment report a stalled rollout through its conditions.

### Preserving the old ReplicaSet keeps revisions distinguishable

Editing the old ReplicaSet's template in place would blur the boundary between v1 and v2. Existing v1 Pods would still carry the old image while their controller object described v2. The controller would lose two independent desired counts, and rollback would have no preserved object describing the earlier template.

Separate ReplicaSets answer those questions cleanly:

- the old ReplicaSet continues to describe v1 Pods;
- the new ReplicaSet describes v2 Pods;
- each population can have its own desired count during the transition;
- status can tell which version a Pod belongs to;
- rollback can recover a template kept in release history.

One Pod-template generation maps to one ReplicaSet. The Deployment coordinates multiple generations instead of rewriting the meaning of an existing population controller.

### `pod-template-hash` separates sibling revision populations

Deployment-created Pods usually carry a label like this:

```bash
kubectl get pods --show-labels
```

```text
web-7cc96f8d5d-abcde   app=web,pod-template-hash=7cc96f8d5d
web-7cc96f8d5d-fghij   app=web,pod-template-hash=7cc96f8d5d
web-7cc96f8d5d-klmno   app=web,pod-template-hash=7cc96f8d5d
```

The Deployment controller computes this hash from the Pod template. A changed template usually produces another hash. The controller places the value in the generated ReplicaSet's selector and in the Pod template labels.

During a v1-to-v2 rollout, the stable application label can remain `app=web` while the revision-specific values differ:

| Population | Stable label | Generated revision label |
|---|---|---|
| v1 ReplicaSet and Pods | `app=web` | `pod-template-hash=AAA` |
| v2 ReplicaSet and Pods | `app=web` | `pod-template-hash=BBB` |

The extra label prevents sibling ReplicaSets from selecting each other's Pods. Application teams should treat the hash as controller-owned data and avoid editing it.

### The broad Deployment family is partitioned into revision-specific ReplicaSets

The Deployment selector may use the stable label `app=web`. That label describes the application family across releases.

The generated ReplicaSets use the stable label plus their template hashes. The v1 ReplicaSet selects `app=web` together with hash `AAA`; the v2 ReplicaSet selects `app=web` together with hash `BBB`.

This produces a useful hierarchy of sets:

| Level | Membership rule | Meaning |
|---|---|---|
| Deployment workload family | `app=web` | All Pods associated with the application across its revisions |
| v1 ReplicaSet population | `app=web` and hash `AAA` | Pods created from the v1 template |
| v2 ReplicaSet population | `app=web` and hash `BBB` | Pods created from the v2 template |

The stable selector connects the revisions to one application. The generated hash keeps those revisions disjoint while both are active.

![Studio Light infographic showing one Deployment workload family selected by app equals web, partitioned into ReplicaSet web-AAA Pods with hash AAA and ReplicaSet web-BBB Pods with hash BBB](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/template-hash-populations.png)

*The stable application label groups the workload, while `pod-template-hash` keeps each ReplicaSet's revision population separate.*

### The template hash and Deployment revision answer different questions

A ReplicaSet name such as `web-7cc96f8d5d` and a rollout entry such as `REVISION 3` refer to related release data with different jobs.

The template hash identifies the ReplicaSet derived from a particular Pod template. The Deployment revision places a Pod-template change in ordered rollout history.

| Identifier | Example | Question it answers |
|---|---|---|
| Pod-template hash | `7cc96f8d5d` | Which exact template population does this ReplicaSet or Pod belong to? |
| Deployment revision | `3` | At which point did this template appear in rollout history? |

The Deployment records revision information on managed ReplicaSets with an annotation such as:

```yaml
metadata:
  annotations:
    deployment.kubernetes.io/revision: "3"
```

Inspect the ordered history with:

```bash
kubectl rollout history deployment/web
```

Scaling changes replica quantity while preserving the current Pod template, so it creates no rollout revision. A change under `.spec.template` advances the release history.

### Rollback reuses an earlier Pod template

Suppose rollout history contains three versions:

| Revision | Managed ReplicaSet | Image | Current replicas |
|---:|---|---|---:|
| 1 | `RS-AAA` | `myapp:v1` | 0 |
| 2 | `RS-BBB` | `myapp:v2` | 0 |
| 3 | `RS-CCC` | `myapp:v3` | 3 |

If v3 fails, this command selects the previous revision:

```bash
kubectl rollout undo deployment/web
```

The Deployment makes the earlier Pod template current and performs another transition. Conceptually, capacity moves away from the v3 ReplicaSet and back toward the ReplicaSet or template represented by revision 2.

The existence of revision-specific ReplicaSets makes this possible. The Deployment still expresses rollback through the same underlying operation: choose the desired template, then coordinate ReplicaSet sizes until the selected population wins.

## Why are overlapping selectors dangerous?
<!-- section-summary: Two controllers with overlapping selectors can express competing desired populations, while generated template hashes keep a Deployment's sibling ReplicaSets distinct. -->

The multiple-ReplicaSet rollout model depends on every revision counting its own Pods. If two controllers search the same label set without a revision boundary, each controller can describe a valid desired population over the same candidates.

### Labels provide queries rather than exclusive namespaces

Consider two unrelated ReplicaSets in the same namespace:

```yaml
# ReplicaSet A
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
```

```yaml
# ReplicaSet B
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
```

Both controllers query the same candidate population. An ownerless Pod labelled `app=web` is eligible for adoption by either ReplicaSet. Only one controller can hold the controlling owner reference, so concurrent adoption creates a race over that orphan.

The deeper issue remains even after ownership settles. Each ReplicaSet declares its own desired count of three. ReplicaSet A can own three Pods and ReplicaSet B can own another three, leaving six Pods that all share `app=web`. A human may have intended one three-Pod application, while the API contains two independent population constraints.

Selectors define the set each controller reasons about. A broad or overlapping selector therefore changes controller behavior rather than serving as cosmetic metadata. Each independently managed workload needs labels that separate its candidate population.

### The generated hash prevents overlap inside one Deployment

A rollout intentionally creates two active ReplicaSets under the same Deployment. Without an additional revision label, both would select `app=web` and compete over the same Pods.

The Deployment controller solves this by adding a distinct `pod-template-hash` to each generated ReplicaSet selector and Pod template. The old ReplicaSet selects `app=web` plus `hash=AAA`; the new one selects `app=web` plus `hash=BBB`. The two revision populations remain disjoint even though they belong to the same application family.

![Studio Light comparison showing a ReplicaSet adopting one matching ownerless Pod on the left and two ReplicaSets with overlapping app equals web selectors competing over one ownerless Pod on the right](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-deployments-and-replicasets/selector-overlap-and-adoption.png)

*A selector can discover an ownerless Pod, while a controlling owner reference decides which ReplicaSet manages it. Distinct template hashes prevent sibling revision selectors from overlapping.*

## How do you read Deployment status and debug the controller chain?
<!-- section-summary: Deployment counters describe rollout progress, and a disciplined investigation follows the ownership chain from Deployment to ReplicaSet to Pod and container evidence. -->

### Deployment status describes desired capacity, current capacity, and current revision

Run:

```bash
kubectl get deployment web
```

A healthy result might be:

```text
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    3/3     3            3           10m
```

Each column answers a different question:

- `READY 3/3` shows that three of three desired Pods currently satisfy readiness;
- `UP-TO-DATE 3` shows that three replicas belong to the latest desired Pod template;
- `AVAILABLE 3` shows that three replicas satisfy availability, including `minReadySeconds` when configured.

During a rollout, the same Deployment could report:

```text
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    3/3     1            3           12m
```

This state can represent two available Pods from the old ReplicaSet and one available Pod from the new ReplicaSet. Total serving capacity has reached three, while only one Pod comes from the current template. The counters tell separate parts of the rollout story.

The Deployment API also exposes fields such as `replicas`, `readyReplicas`, `availableReplicas`, `updatedReplicas`, and `unavailableReplicas` because readiness, availability, and revision progress are different states.

### Running, Ready, Available, and Updated describe separate states

A new Pod can enter the `Running` phase after its containers start while its readiness probe continues to fail. It can later become Ready while still waiting to satisfy `minReadySeconds`. It can also be available while belonging to the old ReplicaSet during a rollout.

| State or counter | Concrete question |
|---|---|
| Pod exists | Did the ReplicaSet create an API object? |
| `Running` | Has the Pod reached a phase where containers are running or starting? |
| Ready | Does the Pod currently satisfy its readiness conditions? |
| Available | Has a ready Pod remained ready for the required minimum time? |
| Updated | Was the Pod created from the latest desired template? |

Separating these states prevents a common debugging mistake. Three visible Pod names prove population creation. Three available updated replicas provide much stronger evidence that the current release is ready to carry the requested capacity.

### `kubectl describe deployment` presents the rollout as old and new ReplicaSets

`kubectl describe` joins specification, status, related ReplicaSets, conditions, and recent events into one operational view:

```bash
kubectl describe deployment web
```

Relevant output often includes:

```text
Replicas:               3 desired | 3 updated | 3 total | 3 available | 0 unavailable
StrategyType:           RollingUpdate
RollingUpdateStrategy:  0 max unavailable, 1 max surge
OldReplicaSets:         web-AAA (0/0 replicas created)
NewReplicaSet:          web-BBB (3/3 replicas created)
```

Conditions provide the controller's interpretation. A successful rollout can show `Progressing=True` with reason `NewReplicaSetAvailable`. A rollout that exceeds its deadline can show `Progressing=False` with reason `ProgressDeadlineExceeded`.

The Deployment tells you whether the release-level transition is advancing. The child resources explain what is blocking it.

### Follow the controller chain downward

When a rollout stalls, start at the level that owns the release intent:

```bash
kubectl get deployment web
kubectl describe deployment web
```

These commands answer whether the desired release has sufficient updated and available capacity, which ReplicaSets the Deployment considers old and new, and whether its conditions report progress.

Then inspect the revision populations:

```bash
kubectl get replicasets
```

Suppose the result is:

```text
NAME             DESIRED   CURRENT   READY
web-64f9dc5f56   0         0         0
web-78947c5b9d   3         3         2
```

The old revision has reached zero. The new revision has created all three Pods, while only two report ready. This narrows the problem from a general Deployment failure to one unready Pod in the current ReplicaSet.

Inspect those concrete instances next:

```bash
kubectl get pods
```

```text
NAME                      READY   STATUS
web-78947c5b9d-a1         1/1     Running
web-78947c5b9d-b2         1/1     Running
web-78947c5b9d-c3         0/1     Running
```

The failing Pod's description provides the next evidence:

```bash
kubectl describe pod web-78947c5b9d-c3
```

A readiness failure identifies the concrete Pod preventing the new ReplicaSet from reaching its ready count. The controller chain keeps the investigation tied to the layer that owns the observed state.

### Owner references prove the hierarchy through the API

The ownership path can be inspected directly rather than inferred from generated names.

For a Pod:

```bash
kubectl get pod web-78947c5b9d-c3 -o yaml
```

For that ReplicaSet:

```bash
kubectl get replicaset web-78947c5b9d -o yaml
```

This follows the same relationship Kubernetes controllers and garbage collection use: Pod to ReplicaSet, then ReplicaSet to Deployment.

### Scaling a child ReplicaSet changes an implementation object

Suppose the Deployment wants three replicas and its current ReplicaSet also has a desired count of three. This command directly changes the child:

```bash
kubectl scale replicaset web-78947c5b9d \
  --replicas=10
```

The Deployment controller still owns the release-level desired state and can reconcile the child ReplicaSet back toward the count required by the Deployment. Directly changing a Deployment-owned ReplicaSet therefore creates competing instructions at two layers.

Scale the Deployment instead:

```bash
kubectl scale deployment web --replicas=10
```

ReplicaSets remain useful for observation and diagnosis. The Deployment remains the normal interface for scaling, template changes, rollout control, and rollback.

### Scaling during an active rollout is distributed proportionally

Scaling can arrive while old and new ReplicaSets both have nonzero desired counts. A HorizontalPodAutoscaler may raise total capacity because traffic increased while a release is still progressing.

Consider the example from the Kubernetes Deployment documentation. The workload targets ten replicas and temporarily has thirteen desired Pods because surge capacity is active: eight in the old ReplicaSet and five in the new one. The new Pods are still proving readiness. The target then rises from ten to fifteen.

The five additional replicas are distributed across the active ReplicaSets approximately in proportion to their current desired sizes. Three can go to the old ReplicaSet and two to the new one. This preserves a similar version balance while total capacity increases, then the rollout continues moving capacity toward the new revision as it becomes available.

This advanced behavior reinforces the underlying architecture. The Deployment expresses application-level scale and release intent by manipulating the desired sizes of its ReplicaSets.

### Deployment and Service selectors use labels for different decisions

A Deployment and Service may both select `app=web`, yet the selectors answer different questions.

The Deployment selector identifies the workload family whose revisions it manages. The generated ReplicaSets add template hashes and directly control their Pod populations.

The Service selector identifies the Pods that should receive network traffic. A Service remains an independent API object with no ownership link to the Deployment.

| Relationship | Example selector or reference | Decision |
|---|---|---|
| Deployment workload family | `app=web` | Which application population belongs to this Deployment |
| ReplicaSet revision | `app=web` plus hash `BBB` | Which Pods belong to one template revision |
| Pod owner reference | `ReplicaSet/web-BBB` | Which controller directly manages this Pod |
| Service traffic membership | `app=web` | Which Pods should receive connections |

Shared labels create loose coupling between management and traffic routing. Careful selectors let those independent subsystems agree on the intended Pods without turning the Service into a child of the Deployment.

## How does the complete Deployment lifecycle fit together?
<!-- section-summary: One end-to-end example connects initial creation, replacement, scaling, rollout, readiness, and rollback to the three controller levels. -->

The individual mechanisms now fit into one lifecycle. Creation establishes the controller hierarchy, ordinary replacement preserves one revision, scaling changes its population, and a rollout moves capacity to a different template revision.

### Follow one workload from creation through replacement, scaling, and rollout

Consider the source's checkout workload. The initial Deployment uses three replicas of v1:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
spec:
  replicas: 3
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
        - name: checkout
          image: company/checkout:v1
```

Applying this manifest stores the Deployment. The Deployment controller creates a ReplicaSet such as `checkout-AAA`, with a selector containing `app=checkout` and `pod-template-hash=AAA`. The ReplicaSet controller creates three Pods from the v1 template.

Now one Pod disappears. `checkout-AAA` observes two actual replicas against three desired replicas and creates a replacement. The new Pod receives a new identity while the revision population returns to three.

Next, traffic requires five replicas:

```bash
kubectl scale deployment checkout --replicas=5
```

The Pod template remains v1, so `checkout-AAA` scales from three to five and creates two more Pods. The operation creates no new ReplicaSet.

Then the release changes `image: company/checkout:v1` to `image: company/checkout:v2` in the Pod template.

The changed template produces hash `BBB` and a new ReplicaSet named `checkout-BBB`. The Deployment coordinates their desired sizes subject to readiness, `maxSurge`, `maxUnavailable`, and `minReadySeconds`.

| Rollout moment | `checkout-AAA` v1 | `checkout-BBB` v2 | Meaning |
|---|---:|---:|---|
| Before image change | 5 | 0 | All desired capacity uses v1 |
| First surge | 5 | 1 | One v2 Pod is proving readiness |
| Progressing | 4 | 2 | Available v2 capacity permits one old Pod to leave |
| Near completion | 1 | 5 | Most capacity uses v2, with one old Pod retained temporarily |
| Complete | 0 | 5 | The new template owns all desired capacity |

If v2 repeatedly fails readiness, old v1 capacity remains according to the rollout limits. The Deployment conditions eventually report stalled progress. The team can correct the v2 template or use `kubectl rollout undo` to select the earlier template.

The end-to-end example reduces every action to one of two controller operations:

- the ReplicaSet creates or removes Pods to satisfy one revision's count;
- the Deployment changes ReplicaSet sizes to satisfy release and scaling intent.

### Each level maintains a different invariant

The three levels exist because each one preserves a different property:

| Level | Invariant it maintains | Concrete question |
|---|---|---|
| Pod | Run a defined group of containers as one schedulable instance | What runs together? |
| ReplicaSet | Keep N copies of one exact Pod-template revision alive | How many of this revision? |
| Deployment | Move the application safely between Pod-template revisions | Which revision should win, and how should capacity move? |

Once those invariants are clear, a rolling update is visible as a controller operation: scale the old ReplicaSet down while scaling the new ReplicaSet up, using readiness and rollout limits to decide when each change is safe.

## Check Your Answers
<!-- section-summary: Revisit replica maintenance, controller hierarchy, membership and ownership, failure boundaries, template revisions, selector safety, status, and the complete lifecycle. -->

:::expand[How does a ReplicaSet keep one Pod population at the desired size?]{kind="recap"}
A ReplicaSet stores a desired replica count, uses a selector to find candidate Pods, and uses a Pod template when it needs another member. Its controller repeatedly compares desired and actual counts. Too few Pods cause a create operation; too many cause a delete operation; equal counts require no population change.
:::

:::expand[Why does a Deployment sit above ReplicaSets?]{kind="recap"}
A ReplicaSet manages one Pod-template revision. A release can require old and new revisions at the same time, each with a separate desired count. The Deployment creates and manages those ReplicaSets, moves capacity between them, records revision history, and provides rollout and rollback behavior.
:::

:::expand[How do selectors and owner references divide membership from ownership?]{kind="recap"}
Labels and selectors discover Pods that match a population query. An owner reference records which exact controller manages an object. A ReplicaSet can adopt a matching ownerless Pod, while a Pod with a controlling owner remains attached to that controller. The template labels must satisfy the selector so newly created Pods enter the population being counted.
:::

:::expand[Which controller responds when a container or Pod disappears?]{kind="recap"}
The kubelet restarts a failed container inside the same Pod. The ReplicaSet creates a replacement when the Pod object disappears and its population falls below the desired count. The Deployment acts when the desired Pod template changes and another revision must replace the current one.
:::

:::expand[How does a Deployment move an application between template revisions?]{kind="recap"}
Each Pod-template revision receives its own ReplicaSet. During a rolling update, the Deployment scales the new ReplicaSet up and the old one down. `maxSurge`, `maxUnavailable`, readiness, and `minReadySeconds` constrain that transfer. Generated template hashes separate the populations, revisions order history, and rollback makes an earlier template current again.
:::

:::expand[Why are overlapping selectors dangerous?]{kind="recap"}
Two independent controllers with the same selector express separate desired counts over the same candidate set. They can race to adopt an ownerless matching Pod and can each create their own full population. Deployment-generated `pod-template-hash` labels give sibling ReplicaSets disjoint selectors during a rollout.
:::

:::expand[How do you read Deployment status and debug the controller chain?]{kind="recap"}
Deployment counters separate desired, updated, ready, available, unavailable, and observed state. Start with Deployment status and conditions, inspect old and new ReplicaSets, then inspect the Pods belonging to the current hash. Follow events, readiness, scheduling state, logs, and owner references until the failing layer and controlling object are clear.
:::

:::expand[How does the complete Deployment lifecycle fit together?]{kind="recap"}
The Pod defines one runnable instance, the ReplicaSet preserves the number of instances for one template revision, and the Deployment manages scale and release transitions across ReplicaSets. Replacement changes Pod identity, scaling changes quantity within the current template, and rollout changes the template and moves capacity to another ReplicaSet.
:::

## References
<!-- section-summary: Kubernetes documentation defines ReplicaSet reconciliation, Deployment revisions, ownership, selectors, rollout status, scaling, and rollback. -->

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official guide to Deployment creation, rolling updates, status, scaling, proportional scaling, history, and rollback.
- [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) - Official guide to ReplicaSet selectors, adoption, owner references, and replica maintenance.
- [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) - Official explanation of owner references and garbage collection.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official guide to label queries and controller selector overlap.
- [Deployment v1 API](https://kubernetes.io/docs/reference/kubernetes-api/apps/deployment-v1/) - Deployment specification and status fields.
- [Well-Known Labels, Annotations and Taints](https://kubernetes.io/docs/reference/labels-annotations-taints/) - Includes the Deployment revision annotation and generated template-hash label.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Rollout status, history, restart, pause, resume, and undo commands.
