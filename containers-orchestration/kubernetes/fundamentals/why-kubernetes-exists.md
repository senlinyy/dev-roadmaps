---
title: "What Is Kubernetes?"
description: "Build a first-principles understanding of why Kubernetes exists, how it keeps applications running across many machines, and where its responsibility ends."
overview: "Kubernetes is a distributed control system for running containerized applications across a pool of machines. This article starts with the limits of one process on one server, then explains scheduling, traffic, replacement, releases, and the responsibilities Kubernetes leaves with engineering teams."
tags: ["kubernetes", "containers", "orchestration", "operations"]
order: 1
id: article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists
---

## Table of Contents

1. [Why Does One Running Container Stop Being Enough in Production?](#why-does-one-running-container-stop-being-enough-in-production)
2. [Which Problem Do Containers Solve, and Which Problem Remains?](#which-problem-do-containers-solve-and-which-problem-remains)
3. [What Does Kubernetes Do in Plain Terms?](#what-does-kubernetes-do-in-plain-terms)
4. [How Does Desired State Turn Failures Into Routine Work?](#how-does-desired-state-turn-failures-into-routine-work)
5. [How Does a Kubernetes Cluster Turn a Manifest Into a Running Application?](#how-does-a-kubernetes-cluster-turn-a-manifest-into-a-running-application)
6. [How Do Callers Keep One Address While Pods Change?](#how-do-callers-keep-one-address-while-pods-change)
7. [How Do Scaling and Releases Work?](#how-do-scaling-and-releases-work)
8. [When Does Kubernetes Earn Its Complexity, and What Do Teams Still Own?](#when-does-kubernetes-earn-its-complexity-and-what-do-teams-still-own)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Every server-side application begins as an operating-system process. A web server opens a port, receives a request from a browser, runs some code, and returns a response. During development, that entire system may fit on one laptop.

An operating system already provides useful local supervision. A service manager such as `systemd` can start a process when the machine boots and restart it after an exit. This is enough for many small applications. The machine supplies CPU and memory, the process serves traffic, and the service manager keeps the process alive.

Production expands the problem along two axes: capacity and failure. One process can use only the resources of its machine, and losing that machine removes the process with it. If one application copy can safely handle 2,000 requests per second while demand reaches 12,000, six copies provide the required capacity before any failure margin is added. Spreading those copies across machines prevents one machine from carrying the entire service.

Keep these questions in view as you work through the lesson:

1. **Why Does One Running Container Stop Being Enough in Production?**
2. **Which Problem Do Containers Solve, and Which Problem Remains?**
3. **What Does Kubernetes Do in Plain Terms?**
4. **How Does Desired State Turn Failures Into Routine Work?**
5. **How Does a Kubernetes Cluster Turn a Manifest Into a Running Application?**
6. **How Do Callers Keep One Address While Pods Change?**
7. **How Do Scaling and Releases Work?**
8. **When Does Kubernetes Earn Its Complexity, and What Do Teams Still Own?**

## Why Does One Running Container Stop Being Enough in Production?
<!-- section-summary: One process on one machine can serve requests, while a production service also needs capacity, replacement, stable traffic, and controlled change. -->

The moment the service spans several machines, someone or something must answer a new set of questions:

These are coordination questions. Starting a process is one action. Keeping many changing processes organized across many changing machines is an ongoing control problem.

A fleet of scripts can perform the individual actions. One script chooses a machine, another starts a process, another edits a load balancer, and another restarts failed work. The scripts also need shared memory. After a script finishes, the system still needs to remember that six copies should exist. When a machine fails ten minutes later, another component must notice that the live count fell to five and decide what to do next. Releases, scaling, placement, traffic, and recovery all need to agree on the same picture of the application.

## Which Problem Do Containers Solve, and Which Problem Remains?
<!-- section-summary: A container image packages an application consistently; an orchestrator coordinates many running copies across machines. -->

A process depends on more than its source code. It may need a particular language runtime, operating-system libraries, certificates, command-line tools, and configuration files. Installing those pieces separately on every server creates drift: two servers can carry different library versions even though the team intended them to run the same application.

A **container image** packages the application code, runtime, and libraries into a versioned artifact. A container runtime uses that image to start an isolated process.

For a worked example, use a high-volume playback API that will need several runtime copies, stable traffic, and gradual releases. The same `playback-api:4.7.3` image can move through development, testing, and production, which gives the team a much more repeatable unit to operate.

The image answers **what should run**. The container runtime answers **how to start this packaged process on one machine**. Production still needs answers for the fleet:

| Question | Container image or runtime | Cluster coordinator |
| --- | --- | --- |
| Which executable and libraries belong together? | Packages them in the image | Uses the chosen image |
| How does one isolated process start? | Creates the container | Requests the start on a selected machine |
| How many application copies should exist? | Runs one requested container | Stores and maintains the replica count |
| Which machine should run each copy? | Uses the local machine | Chooses from the cluster's available machines |
| What happens after a machine disappears? | Loses the local process with the machine | Creates replacement work on healthy capacity |
| How do callers find changing copies? | Gives each container local networking | Maintains a stable service identity |
| How does a release replace a fleet gradually? | Starts whichever image it receives | Coordinates old and new application copies |

This boundary explains the term **container orchestration**. The container remains the packaged runtime unit. Kubernetes coordinates a large number of those units so placement, replacement, networking, and change follow one shared model.

![A Studio Light infographic progresses from one packaged playback API container to several replaceable application copies spread across worker nodes behind one stable Service](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/one-container-to-service.png)

*Containers make each application copy repeatable. Kubernetes turns those copies into a managed service across a pool of machines.*

## What Does Kubernetes Do in Plain Terms?
<!-- section-summary: Kubernetes stores an application request and continuously coordinates a cluster of machines toward that request. -->

**Kubernetes is a distributed control system for running containerized applications across a group of machines.** A team describes the application state it wants. Kubernetes stores that request, chooses machines for the work, starts application containers, publishes status, and keeps responding when the live system drifts away from the request.

Three ideas inside that sentence deserve careful attention.

### Distributed means the work spans several machines

The machines form a **cluster**. Worker machines contribute CPU, memory, and access to networking and storage. Kubernetes treats that capacity as a pool, then places application work where its requirements can be met.

Suppose three workers have this free capacity:

| Worker | Free CPU | Free memory |
| --- | ---: | ---: |
| `worker-a` | 500m | 1 GiB |
| `worker-b` | 4 cores | 8 GiB |
| `worker-c` | 2 cores | 2 GiB |

A new playback Pod requests `1` CPU and `1Gi` of memory. `worker-a` fails the CPU requirement, while `worker-b` and `worker-c` have enough requested capacity. The scheduler can evaluate both suitable workers along with placement rules and choose one. The team describes the requirement; the cluster performs the placement decision.

### Control system means the request stays active

Kubernetes keeps a durable record such as “six playback replicas should exist.” Controllers repeatedly compare that requested state with the state they observe. If the live count falls to five, the request still says six, so the system creates work to restore the missing copy.

This is different from a one-time start command. A start command finishes after it launches a process. A stored request continues to influence the system after processes and machines change.

### Platform means several concerns use the same API

Kubernetes represents workloads, networking, configuration, access policy, and storage connections as API resources. Teams can submit changes and inspect results through the same control surface. A deployment system and an engineer using `kubectl` both talk to the Kubernetes API, giving them one shared inventory of the system.

Kubernetes adds a vocabulary for the separate responsibilities:

| Kubernetes term | Beginner meaning | Playback API example |
| --- | --- | --- |
| **Cluster** | The whole managed system | Control plane plus the video platform's worker machines |
| **Node** | One worker machine that supplies resources | A virtual machine with CPU and memory |
| **Pod** | The smallest scheduled unit, usually one application copy | One running `playback-api` container |
| **Deployment** | A request for replaceable copies and controlled updates | Keep six playback Pods on image `4.7.3` |
| **Service** | One stable network identity for a changing group of Pods | `playback-api.streaming.svc.cluster.local` |
| **Control plane** | Components that accept requests and coordinate the cluster | Stores the Deployment, tracks Pods, and makes placement decisions |

Each object has a narrow job. A Pod describes one runtime copy. A Deployment manages a set of replaceable Pods. A Service represents the network destination. This separation lets Kubernetes change one part, such as replacing a Pod, while preserving another part, such as the address callers use.

## How Does Desired State Turn Failures Into Routine Work?
<!-- section-summary: Kubernetes treats a declaration as a continuing record of intent and uses reconciliation loops to close gaps between requested and observed state. -->

Infrastructure can be operated through commands that describe actions. An automation script might choose `worker-b`, start `playback-api:4.7.3`, and register the new address in a load balancer.

This **imperative** approach can work. Its weakness appears after the sequence finishes. The action history says what happened earlier, while the current requirement—six healthy copies—must live somewhere else. Recovery code then needs to reconstruct intent from scripts, machine inventories, process tables, and load-balancer entries.

Kubernetes uses a **declarative** approach for most workload management. The team creates an API object whose specification says what should be true:

```yaml
spec:
  replicas: 6
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/example/playback-api:4.7.3
```

This object is a **record of intent**. `replicas: 6` continues to mean six desired Pods after the command that created the object has ended.

Kubernetes components run **reconciliation loops**. A reconciliation loop repeats four steps:

1. Read the requested state from the API.
2. Observe the current state of the resources it manages.
3. Identify a meaningful difference.
4. Make one or more changes that move the current state toward the request.

For the playback service, the comparison can be written plainly:

```text
Requested Pods: 6
Observed Pods:  5
Difference:     1 missing Pod
Next action:    create one replacement Pod object
```

The loop then runs again. The replacement may still be waiting for a node, pulling an image, starting, or passing readiness checks. Kubernetes reports each intermediate state as the change progresses.

This model turns common failures into repeated control work:

- A container process exits. The node agent starts it again according to the Pod's restart policy.
- A managed Pod disappears. The workload controller creates a replacement Pod.
- A worker becomes unavailable. Controllers eventually replace affected Pods on healthy workers when capacity permits.
- A Pod fails readiness. Service traffic uses the remaining ready endpoints while that Pod recovers or is replaced.

The repair follows the declaration. A replica count tells the controller how many copies to restore. Resource requests tell the scheduler what capacity each replacement needs. Readiness tells the networking layer when a copy can serve traffic. Kubernetes can coordinate useful recovery because the team supplied useful intent and signals.

The deeper lesson is that Kubernetes manages **application state over time**. A command starts something once. A declaration remains present, and controllers continue working from it as the environment changes.

## How Does a Kubernetes Cluster Turn a Manifest Into a Running Application?
<!-- section-summary: A control plane accepts a manifest and coordinates the request, while worker nodes supply the resources that run the resulting Pods. -->

A Kubernetes cluster has two broad parts: a **control plane** and **worker nodes**.

The control plane manages the overall state of the cluster. It exposes the Kubernetes API, stores accepted objects, runs controllers, and makes scheduling decisions. Worker nodes provide the CPU, memory, and operating-system environment where application Pods run. The control plane assigns and observes work across that shared pool of workers.

This division lets the control plane reason about pooled capacity across the workers. A Pod can request `1` CPU and `1Gi` of memory. The scheduler compares that request with the cluster's workers and records a suitable node assignment. The kubelet on the chosen worker then starts the Pod's containers through the local container runtime.

The word **Pod** appears here because Kubernetes uses Pods as its smallest scheduled unit. A Pod holds one or more tightly coupled containers that share a network identity and can share volumes. Most ordinary application Pods contain one main container, so `Pod/playback-api-7f8d6` contains the `api` container that runs the playback application process.

Several containers belong in one Pod when they genuinely form one execution unit. For example, an application container and a sidecar that must share the same network namespace and lifecycle can be co-located. Independent services receive separate Pods so they can scale, release, and recover independently.

Pods are replaceable units. A replacement Pod receives a new identity and usually a new IP address. The higher-level Deployment preserves the application request while individual Pods come and go. Engineers therefore use Deployments for long-running stateless applications and let the controller manage the individual Pods.

The next fundamentals articles examine the object relationships and cluster components in more detail. For this opening mental model, remember the ownership boundary:

- The control plane keeps the shared request and coordinates decisions.
- Worker nodes execute assigned Pods and report what happens.
- Pods carry application containers as replaceable runtime units.

### How the manifest moves through the cluster

A Kubernetes **manifest** is a YAML or JSON representation of an API object. The manifest below describes a Deployment for the playback API. The example asks for six Pods, gives the Pods a label, specifies the image, reserves scheduler-visible resources, and defines a readiness check.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: playback-api
  namespace: streaming
spec:
  replicas: 6
  selector:
    matchLabels:
      app.kubernetes.io/name: playback-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: playback-api
    spec:
      containers:
        - name: api
          image: ghcr.io/example/playback-api:4.7.3
          ports:
            - name: http
              containerPort: 8080
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /ready
              port: http
```

The fields form a hierarchy:

- `apiVersion` and `kind` identify the API type: an `apps/v1` Deployment.
- `metadata` gives this Deployment its name and namespace.
- `spec.replicas` requests six Pod copies.
- `selector` identifies the Pods that belong to the Deployment.
- `template` describes how each new Pod should be created.
- `containers` selects the image and container port.
- `resources.requests` gives the scheduler capacity requirements.
- `readinessProbe` gives Kubernetes an application-level signal for traffic readiness.

An engineer or delivery pipeline submits the file:

```bash
kubectl apply -f playback-api.yaml
```

`kubectl` converts the manifest into an API request. Several components then complete separate parts of the journey.

### 1. The API server accepts and stores the object

The API server authenticates the caller, checks authorization, runs admission rules, validates the object, and stores the accepted Deployment in the cluster's state. A response such as `deployment.apps/playback-api created` means the Deployment object now exists. The six application copies proceed through later stages.

The object has a requested `spec` and an observed `status`. During startup, the specification can request six replicas while status reports zero, two, or five available replicas. That difference makes unfinished work visible.

### 2. Controllers create the resources needed to satisfy it

The Deployment controller notices the new Deployment and creates a ReplicaSet for this Pod template. The ReplicaSet controller sees a desired count of six and creates six Pod objects. At this point, Kubernetes has records for the intended Pods, while some may still be waiting for placement.

This layered design supports releases later. A changed Pod template can receive a new ReplicaSet, allowing Kubernetes to count the old and new revisions separately.

### 3. The scheduler chooses a node for each pending Pod

A new Pod begins in a pending state and awaits a node assignment. The scheduler filters workers against the Pod's requirements, scores the suitable workers, and records a chosen node. Resource requests, placement constraints, storage topology, taints, and other policies can affect the choice.

If every worker lacks `512Mi` of requested memory, the Pod remains `Pending`. The Deployment request remains stored, and scheduler events explain the capacity gap. Kubernetes has preserved the requirement and exposed the blocked stage.

### 4. The kubelet starts the containers on that node

Each worker runs a **kubelet**, the local node agent. The kubelet sees Pods assigned to its node and asks the container runtime to pull the image and create the containers. Networking and storage integrations prepare the Pod's environment. The kubelet reports container state and Pod conditions back through the API.

### 5. Readiness connects the running process to traffic

A process can be running while it loads policy data, warms caches, or opens its HTTP listener. The readiness probe calls `/ready`. When the application reports success, the Pod becomes eligible for regular Service traffic. This creates a useful distinction between “the process exists” and “the application copy can serve a viewer.”

![A Studio Light control-flow infographic traces a Deployment manifest through the API server, stored desired state, controllers, scheduler, worker kubelets, running Pods, readiness, and status returning through the API](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/manifest-to-running-pods.png)

*The request moves through several observable stages. A Pod that waits in `Pending` points toward placement; a running but unready Pod points toward application startup or readiness.*

These commands inspect the hand-offs:

```bash
kubectl get deployment playback-api -n streaming
kubectl get pods -n streaming \
  -l app.kubernetes.io/name=playback-api -o wide
kubectl describe pod -n streaming <pod-name>
```

Read them from the highest level downward. The Deployment shows requested, updated, and available counts. The Pod list shows each copy, its state, and its node. `describe` shows conditions and recent events for one Pod. This mirrors the path Kubernetes used to create the workload.

## How Do Callers Keep One Address While Pods Change?
<!-- section-summary: A Service gives callers a stable name and continuously maps that identity to the ready Pods selected by labels. -->

Each playback Pod gets its own network identity. A replacement changes both the Pod name and address:

| Runtime copy | Pod name | Pod IP |
| --- | --- | --- |
| Previous | `playback-api-7f8d6-2kl9x` | `10.42.3.18` |
| Replacement | `playback-api-7f8d6-q7m4p` | `10.42.6.27` |

Callers need an application address whose lifetime is longer than either Pod. Kubernetes provides a **Service** for that purpose.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: playback-api
  namespace: streaming
spec:
  selector:
    app.kubernetes.io/name: playback-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

The selector matches the label on the Deployment's Pod template. Kubernetes maintains endpoint records for matching Pods and their readiness. Another application in the `streaming` namespace can call `http://playback-api`.

The caller uses the Service name while Kubernetes updates the backend addresses. If one Pod disappears and a replacement becomes ready, the endpoint set changes while the Service identity stays in place.

Follow one request:

1. A session coordinator connects to the `playback-api` Service on port `80`.
2. Cluster DNS resolves the stable Service name.
3. The cluster networking path chooses one ready backend address.
4. Traffic reaches that Pod's named `http` port, which maps to container port `8080`.
5. The application handles the request and returns the playback session.

Readiness is essential to this path. A newly started Pod can spend several seconds loading regional policy data. Its process is alive during that time, while `/ready` still reports that the Pod needs more startup work. The Service uses other ready Pods until the new one becomes eligible.

This gives Kubernetes a stable layer over changing runtime copies:

| Moment | Service name | Ready backend addresses |
| --- | --- | --- |
| Before replacement | `playback-api` | Pod A `10.42.1.8`, Pod B `10.42.2.6`, Pod C `10.42.4.9` |
| After Pod B is replaced | `playback-api` | Pod A `10.42.1.8`, Pod C `10.42.4.9`, Pod D `10.42.5.3` |

The Service handles discovery inside the cluster. External traffic usually reaches the cluster through an external load balancer, Ingress, or Gateway implementation, then continues to a Service. Those routing layers appear later in the networking module.

## How Do Scaling and Releases Work?
<!-- section-summary: Kubernetes changes the declared replica count or Pod template, then controllers move the fleet toward the new state at a controlled rate. -->

Scaling and releasing are both changes to desired state.

### Scaling changes the requested population

Suppose playback demand rises before a major live event. The team changes the Deployment from six replicas to ten:

```bash
kubectl scale deployment/playback-api \
  --replicas=10 \
  -n streaming
```

The Deployment now records ten desired copies. Its controller updates the managed ReplicaSet, and the ReplicaSet controller creates four more Pod objects. The scheduler places each new Pod where its `500m` CPU and `512Mi` memory requests fit.

The result depends on cluster capacity. Ten Pods need a total of 5 requested CPU cores and 5 GiB of requested memory in this simplified example. If the workers have room, the Pods can be scheduled. If capacity runs out, some Pods stay pending and report the shortage. A node autoscaler or a platform team can add worker capacity, depending on how the cluster is operated.

Horizontal Pod Autoscaling can later adjust a replica target from metrics. The same control model remains: a component updates the desired replica count, then workload controllers and the scheduler make that count real.

### A release changes the Pod template

Now the team changes the image from `4.7.3` to `4.8.0`:

```bash
kubectl set image deployment/playback-api \
  api=ghcr.io/example/playback-api:4.8.0 \
  -n streaming

kubectl rollout status deployment/playback-api -n streaming
```

The image belongs to the Deployment's Pod template. Changing the template creates a new revision. For a rolling update, Kubernetes gradually increases the new ReplicaSet and decreases the old one within the Deployment strategy.

With four replicas, a simplified progression could look like this:

| Step | Version `4.7.3` | Version `4.8.0` |
| --- | ---: | ---: |
| 1 | 4 ready | 0 |
| 2 | 4 ready | 1 starting |
| 3 | 3 ready | 1 ready |
| 4 | 2 ready | 2 ready |
| 5 | 1 ready | 3 ready |
| 6 | 0 | 4 ready |

The exact numbers depend on `maxSurge` and `maxUnavailable`. Readiness controls when a new Pod counts as available. If version `4.8.0` stays unready, rollout progress can stop before all old ready copies disappear.

`kubectl rollout status` answers whether Kubernetes completed the Deployment transition. The team should also check application behavior: request success rate, latency, playback-start failures, and a small end-to-end request. Kubernetes can confirm that the declared rollout state converged. Product-level signals confirm that the new application version behaves correctly.

These examples show why declaration matters. Scaling changes a number in the requested state. Releasing changes a template in the requested state. The same controllers coordinate the detailed steps and expose progress through the API.

## When Does Kubernetes Earn Its Complexity, and What Do Teams Still Own?
<!-- section-summary: Kubernetes earns its operational cost through reused coordination, while teams remain responsible for application correctness, data safety, capacity, security, and operational signals. -->

Kubernetes is powerful because it takes responsibility for a specific layer: coordinating declared resources and workloads across a cluster. Clear boundaries prevent the word “self-healing” from promising more than the system can deliver.

Consider several problems in the playback platform:

| Situation | Kubernetes contribution | Team responsibility |
| --- | --- | --- |
| The application process exits | Restart the container and report its state | Find and fix the code or configuration defect |
| A worker disappears | Create replacement Pods on available workers | Provide enough spare capacity and operate the node pool |
| A Pod is still loading policy data | Keep it outside the ready endpoint set | Implement a readiness check that represents serving ability |
| Version `4.8.0` returns incorrect playback policies | Coordinate rollout state and expose metrics/events hooks | Detect the behavior with tests and service metrics, then correct or roll back |
| The session database is unavailable | Keep application Pods aligned with their declared state | Design database availability, backups, recovery, and connection behavior |
| A secret needs rotation | Deliver referenced Secret data to authorized Pods | Choose storage, encryption, access, and rotation controls |
| Traffic grows beyond cluster capacity | Leave unschedulable Pods pending with events | Add capacity manually or operate suitable autoscaling |

Kubernetes often restores the **shape** of an application. If a Deployment requests six Pods, it works to restore six Pods. It runs the same declared image and configuration during replacement. An application defect inside that image appears again in the replacement, which is why observability and release verification remain essential.

Data introduces another boundary. A stateless playback API can be replaced freely because durable account and session data live elsewhere. Stateful workloads need storage systems, replication, backup, restore testing, and consistency decisions. Kubernetes can attach storage and manage StatefulSet identities, while the data system's correctness still comes from its own design and operations.

Security also spans layers. Kubernetes offers identities, authorization, admission controls, Secrets, and network policy APIs. Teams configure these controls, secure container images, rotate credentials, protect the control plane, and decide which workloads may communicate.

A useful way to divide responsibility is:

- **Kubernetes coordinates:** API objects, placement, Pod lifecycle, replica maintenance, rollout mechanics, and Service membership.
- **Platform teams operate:** clusters, worker capacity, upgrades, networking, storage integrations, policy, and observability foundations.
- **Application teams own:** code behavior, data handling, dependency resilience, health semantics, and release acceptance.

That boundary makes Kubernetes easier to reason about. It is an operating layer with strong control mechanisms, and those mechanisms rely on accurate requests and signals from teams.

![A Studio Light summary infographic shows teams declaring application intent, the Kubernetes API preserving it, controllers and the scheduler coordinating worker Pods, Services routing only to ready copies, and status flowing back for inspection](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/kubernetes-coordination-summary.png)

*Kubernetes keeps intent and runtime state in a continuous loop. Teams provide the application behavior, data design, capacity, and health signals that make the loop useful.*

### When Kubernetes is a good choice

Kubernetes introduces a real platform to learn and operate. Its API, networking, storage, security, upgrades, capacity, and observability all require engineering work. The investment provides its strongest value when many applications and teams can reuse it.

Kubernetes is often a good fit when several of these needs appear together:

- Workloads need placement across a pool of machines.
- Services run several replicas for capacity or availability.
- Teams release often and need consistent rollout mechanics.
- Applications include long-running services, background workers, scheduled jobs, or specialized hardware needs.
- A shared platform team can provide networking, policy, observability, and upgrade practices.
- The organization needs Kubernetes APIs or controllers supplied by its ecosystem.
- Workloads should use a consistent operating model across cloud, data-center, or edge environments.

The video platform is a plausible fit. It runs many services and background workers, handles large regional demand changes, performs frequent releases, and has a platform team that can operate the shared cluster layer. The same scheduling, health, policy, and inspection model can serve playback APIs, recommendation workers, thumbnail processing, and internal control services.

A smaller system may gain more from a managed application platform, serverless containers, or a cloud service that owns more of the operating layer. One low-traffic API with a small team may value a simpler deployment model more than Kubernetes extensibility.

Ask concrete questions before adopting it:

| Decision area | Evidence to gather |
| --- | --- |
| Workload scale | Number and type of services, jobs, replicas, and hardware requirements |
| Release needs | Frequency, rollout controls, rollback needs, and team ownership |
| Reliability | Failure domains, spare capacity, data dependencies, and recovery targets |
| Platform reuse | Number of teams that will share APIs, policy, tooling, and support |
| Existing alternatives | Capabilities already available from a managed platform or cloud service |
| Operating capability | Ownership for upgrades, security, networking, storage, observability, and cost |

The decision should connect Kubernetes features to recurring operational problems. When many teams repeatedly need placement, replacement, discovery, controlled release, and shared policy, Kubernetes can turn separate automation into one coherent platform. When those needs stay small, a higher-level managed service can leave the team with fewer moving parts.

## Check Your Answers
<!-- section-summary: Eight questions revisit the production problem, the Kubernetes control model, the application path, and the platform boundary. -->

:::expand[Why Does One Running Container Stop Being Enough in Production?]{kind="recap"}
One container serves one application copy on one machine. A production service may need more capacity, survival across process and machine loss, a stable network destination, gradual releases, and a shared record of current and requested state. Coordinating those needs across a changing fleet becomes a continuous control problem.
:::

:::expand[Which Problem Do Containers Solve, and Which Problem Remains?]{kind="recap"}
A container image packages an application with the runtime files it needs, and a container runtime starts that packaged process on one machine. The remaining problem is fleet coordination: replica count, placement, replacement, stable discovery, release order, and shared status across many machines.
:::

:::expand[What Does Kubernetes Do in Plain Terms?]{kind="recap"}
Kubernetes stores a team's application request and continuously coordinates a cluster toward it. The control plane accepts and manages the request, worker nodes supply runtime resources, Pods carry application containers, Deployments manage replaceable copies, and Services give those copies a stable network identity.
:::

:::expand[How Does Desired State Turn Failures Into Routine Work?]{kind="recap"}
Desired state remains stored after the original command ends. Controllers repeatedly compare that request with observed state and take actions that close useful gaps. When a six-replica Deployment has five Pods, the missing copy becomes ordinary reconciliation work driven by the existing request.
:::

:::expand[How Does a Kubernetes Cluster Turn a Manifest Into a Running Application?]{kind="recap"}
A cluster combines a control plane with worker nodes. `kubectl` sends the manifest to the API server in the control plane. After validation and storage, controllers create the needed objects and Pods, and the scheduler assigns each pending Pod to a suitable worker. The worker's kubelet asks its container runtime to start the containers, while readiness and status flow back through the API.
:::

:::expand[How Do Callers Keep One Address While Pods Change?]{kind="recap"}
A Service provides a stable name and port. Its selector identifies the application's Pods, and Kubernetes maintains backend endpoint records for matching ready Pods. Replacement changes Pod names and addresses while callers continue using the same Service identity.
:::

:::expand[How Do Scaling and Releases Work?]{kind="recap"}
Scaling changes the desired replica count, so controllers create or remove Pods and the scheduler places new work. A release changes the Deployment's Pod template, so the Deployment coordinates old and new ReplicaSets at a controlled rate. Readiness determines when new Pods count as available for traffic.
:::

:::expand[When Does Kubernetes Earn Its Complexity, and What Do Teams Still Own?]{kind="recap"}
Kubernetes is valuable for several workloads and teams that repeatedly need scheduling, replicas, recovery, discovery, controlled releases, and shared policy. It coordinates declared resources, placement, Pod lifecycle, rollout mechanics, and Service membership. Platform and application teams still own cluster capacity, upgrades, security configuration, application correctness, durable data, dependency resilience, useful health signals, and release acceptance. A smaller system may gain more from a managed application platform that owns more of the operational layer.
:::

## References

- [Kubernetes Overview](https://kubernetes.io/docs/concepts/overview/) - Official overview of the platform's role in running distributed systems, service discovery, deployment, scaling, and self-healing.
- [Objects In Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Official explanation of records of intent, desired state, object specifications, status, and manifests.
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Official explanation of control loops and reconciliation.
- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/) - Official description of control-plane and worker-node components.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official definition of Pods as the smallest deployable units and their role as replaceable application instances.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official guide to declarative replica management and controlled rollouts.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official explanation of stable network access to a changing group of Pods.
