---
title: "Architecture and Agents"
description: "Coordinate self-hosted builds securely across distributed environments using SSH, WebSocket, and dynamic container agents."
overview: "Jenkins is a self-hosted automation server that you operate on your own infrastructure. Learn how the controller, agents, executors, labels, connection modes, and controller JVM settings fit together in a production Jenkins installation."
tags: ["jenkins", "architecture", "agents", "ci-cd"]
order: 1
id: article-cicd-jenkins-architecture-and-agents
aliases:
  - /cicd/jenkins/architecture-and-agents
---

## Table of Contents

1. [Why Separate Orchestration from Execution?](#why-separate-orchestration-from-execution)
2. [How Do Controllers, Agents, Executors, and Workspaces Fit Together?](#how-do-controllers-agents-executors-and-workspaces-fit-together)
3. [How Do Connections, Labels, and the Queue Select an Executor?](#how-do-connections-labels-and-the-queue-select-an-executor)
4. [When Should Agents Be Static or Dynamic?](#when-should-agents-be-static-or-dynamic)
5. [How Do Failure and Security Boundaries Differ between Controller and Agents?](#how-do-failure-and-security-boundaries-differ-between-controller-and-agents)
6. [How Should the Controller JVM and Capacity Scale?](#how-should-the-controller-jvm-and-capacity-scale)
7. [How Do You Diagnose Architecture Failures?](#how-do-you-diagnose-architecture-failures)
8. [How Does One Complete Jenkins Build Move Through the System?](#how-does-one-complete-jenkins-build-move-through-the-system)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Jenkins is a self-hosted automation server. That means your team runs the service, owns the storage, chooses the plugins, controls the network path, and carries the operational responsibility when builds slow down or the controller goes offline. A managed CI system hides a lot of that machinery, while Jenkins asks the platform team to design it clearly.

Think about a platform team running CI for several services. At first, they install Jenkins on one virtual machine and let every job run there. The UI feels fine for a few days, then a large test run fills the disk, a Docker build consumes CPU, and a production hotfix waits behind a queue that nobody can open because the Jenkins web page also lives on that same overloaded machine.

That failure explains the first big idea in this module. Jenkins needs one place that **coordinates work** and separate places that **execute work**. The coordinator keeps job definitions, credentials, build history, plugin state, and scheduling decisions. The executors run shell commands, compile code, run tests, build images, and create disposable workspaces.

Keep these questions in view as you work through the lesson:

1. **Why Separate Orchestration from Execution?**
2. **How Do Controllers, Agents, Executors, and Workspaces Fit Together?**
3. **How Do Connections, Labels, and the Queue Select an Executor?**
4. **When Should Agents Be Static or Dynamic?**
5. **How Do Failure and Security Boundaries Differ between Controller and Agents?**
6. **How Should the Controller JVM and Capacity Scale?**
7. **How Do You Diagnose Architecture Failures?**
8. **How Does One Complete Jenkins Build Move Through the System?**

## Why Separate Orchestration from Execution?
<!-- section-summary: A production Jenkins setup separates the service that coordinates builds from the machines that execute build commands. -->

The official Jenkins docs use a few words that sound similar, so let us define them before we stack them together. A **controller** is the Jenkins service itself, including the web UI, queue, configuration, credentials, plugin runtime, and build records. An **agent** is a machine, container, or pod that connects to the controller and runs build steps. An **executor** is a single execution slot on an agent, so one agent with four executors can run four jobs at the same time.

Those three words create the whole architecture. The controller answers, "What should run next?" The agent answers, "Where can this work run?" The executor answers, "How many jobs can this machine handle right now?" Once those roles are clear, Jenkins stops feeling like one mysterious server and starts looking like a small scheduling system that your team can operate on purpose.

The split follows two fundamentally different jobs in any CI server. The **orchestration job** receives events, loads pipeline definitions, manages the queue, selects capacity, tracks state, serves the UI and API, stores results, and coordinates plugins. The **execution job** checks out repositories, starts shells, compiles, tests, builds containers, and calls deployment tools. Orchestration needs durable state and predictable availability. Execution needs scalable CPU, memory, disk, tools, and isolation.

Jenkins can technically execute builds on the controller's built-in node. That convenience is useful for a local experiment, but it couples arbitrary repository code and resource-heavy commands to the service holding Jenkins configuration, credentials, plugins, and history. A full disk, fork bomb, dependency compromise, or long compilation can then damage the scheduler itself. Production architecture removes that coupling.

## How Do Controllers, Agents, Executors, and Workspaces Fit Together?
<!-- section-summary: The controller owns durable Jenkins state, while agents provide isolated runtime capacity for builds and deployments. -->

The **controller and agent architecture** gives Jenkins a clean boundary between durable state and risky execution. Durable state means the information Jenkins must keep after a restart: global config, users, folders, job history, credentials metadata, plugins, node definitions, and pipeline records. Risky execution means arbitrary commands from application repositories, dependency install scripts, test suites, compilers, Docker builds, and deployment CLIs.

The controller stores its main state under `$JENKINS_HOME`, commonly `/var/lib/jenkins` on Linux or `/var/jenkins_home` in the official Docker image. That directory holds configuration XML, job folders, plugin files, secret material, node metadata, build records, and fingerprints. A backup or restore plan must treat `$JENKINS_HOME` as controller state, while the article on plugins and configuration later shows how teams also move as much configuration as possible into Git.

Agents protect the controller from everyday build pressure. The platform team puts Maven, Node.js, Docker, Trivy, Terraform, kubectl, and cloud CLIs on agents instead of the controller. A broken test can fill an agent workspace, and a compiler can use all CPU on an agent, while the Jenkins UI and queue still have enough memory and CPU to keep scheduling work.

Most production controllers run with **zero executors** on the built-in node. This setting tells Jenkins that the controller coordinates jobs and leaves build execution to agents. In Configuration as Code, the idea usually appears like this:

```yaml
jenkins:
  numExecutors: 0
  mode: EXCLUSIVE
```

`numExecutors: 0` removes build slots from the controller. `mode: EXCLUSIVE` makes Jenkins send jobs to agents that match labels instead of treating the controller as a general fallback. This small setting prevents the most common beginner mistake: letting a pipeline accidentally run `npm install`, `docker build`, or `terraform apply` on the machine that also stores Jenkins secrets and serves the UI.

![Jenkins controller and agents showing controller state, build queue, executor slots, Linux agent, Docker agent, Maven agent, and jobs assigned by label](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/controller-agent-architecture.png)

*A healthy Jenkins installation keeps durable state on the controller while agents provide the executor capacity and toolchains that run build commands.*

Agents also create **workspaces**. A workspace is the directory where Jenkins checks out the repository and runs commands for a job, usually under an agent root path like `/var/jenkins_agent/workspace/service-main`. Persistent workspaces can speed up builds because Maven caches, npm caches, and Gradle caches remain between runs. They also create dirty-state risk, because a file from yesterday's build can change today's result.

Real teams handle that tradeoff explicitly. For normal agents, they clean the workspace at the start or end of sensitive jobs and keep dependency caches in known cache directories rather than random project folders. For high-risk or highly variable builds, they use ephemeral container agents so the whole filesystem disappears after the build. The right choice depends on build speed, security boundaries, and how much the team trusts the code that enters the agent.

An executor is not another name for an agent. The agent is the machine or runtime connected to Jenkins; executors are concurrency slots inside it. An eight-core machine might advertise two executors for memory-heavy builds or eight for light checks. Increasing executors does not create more CPU or RAM—it permits more processes to compete for the same host resources.

The physical execution chain is:

```text
controller
  -> chooses an eligible agent
  -> reserves one executor slot
  -> prepares or selects a workspace on that agent
  -> starts shell, container, or tool process
  -> receives logs, status, and results
```

The workspace also lives on the agent, not inside the controller. If two stages run on different agents, their local files do not follow automatically. They must use `stash` and `unstash`, archived artifacts, a registry, object storage, or another deliberate transfer. Persistent agents may retain workspace and dependency-cache state between builds; ephemeral agents normally begin clean and disappear afterward.

## How Do Connections, Labels, and the Queue Select an Executor?
<!-- section-summary: Jenkins supports several connection topologies, and the right one depends on which side can initiate the network connection. -->

After the team separates controller and agent responsibilities, the next question is network shape. An agent must maintain a communication channel with the controller so it can receive work and stream logs. Jenkins supports several connection styles because real networks have firewalls, private subnets, NAT gateways, VPNs, and security teams with strong opinions.

**SSH agents** fit long-lived Linux or Unix machines that the controller can reach over the network. Jenkins uses SSH credentials, connects to the host, starts the agent process, and uses that connection for work. The platform team uses this for a small pool of build VMs in the same VPC as the controller because the controller can reach those instances on port 22 and the security team already manages SSH keys.

**Inbound agents** reverse the connection direction. The agent starts a Java process and connects outward to the controller, often using a secret that Jenkins generated for that node. This fits private build machines where the controller cannot open a direct connection into the subnet. The agent can reach `https://jenkins.example.com`, so it dials out and waits for work.

**WebSocket inbound agents** use the normal Jenkins web URL instead of a separate inbound TCP agent port. This matters when a reverse proxy, corporate firewall, or Kubernetes ingress already permits HTTPS traffic but the security team wants to avoid opening another TCP port. The Jenkins security docs call out that inbound agents can use WebSocket transport without enabling an extra TCP port.

**Kubernetes dynamic agents** create short-lived pods for each build. The Kubernetes plugin starts a pod, runs the Jenkins agent container inside it, lets the build use extra containers such as Maven or Kaniko, and stops the pod after the build. This fits teams that already operate Kubernetes and want clean workspaces, elastic capacity, and per-build tool images.

| Connection style | Who starts the connection | Good fit | Main operational check |
|---|---|---|---|
| SSH agent | Controller to agent | Stable VMs in reachable networks | SSH keys, host keys, Java, and firewall rules |
| Inbound TCP agent | Agent to controller | Private agents behind NAT | Agent secret handling and inbound agent port exposure |
| Inbound WebSocket agent | Agent to controller over HTTPS | Locked-down networks and reverse proxies | Correct Jenkins URL and proxy WebSocket support |
| Kubernetes pod agent | Plugin creates pod, pod connects back | Elastic containerized builds | Pod template, service account, image, and namespace policy |

Here is the practical way to choose. If the controller can reach a controlled VM fleet and SSH operations already work well, SSH agents keep things simple. If agents live in a private subnet where only outbound HTTPS works, WebSocket inbound agents usually fit. If every build should start with a clean filesystem and your team already trusts Kubernetes as the runtime, dynamic pod agents give Jenkins a fresh worker for each run.

Do not confuse connection direction with job direction. An inbound agent initiates the network connection, but it does not decide which Pipeline to execute. After the channel is established, the controller still schedules work and sends step instructions; the agent still returns logs and results. The two processes behave as one distributed application whose control state is centralized and execution is remote.

![Jenkins agent connection modes showing SSH agents, inbound WebSocket agents, restricted networks, labels, and jobs running on matching agents](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/agent-connection-modes.png)

*Agent connection style follows the network path: the controller can open SSH to reachable machines, while private agents can call back through an inbound WebSocket connection.*

<!-- section-summary: Labels let a Jenkinsfile ask for a capability instead of naming a specific machine. -->

Once agents exist, Jenkins needs a way to pick the right one. **Labels** solve that problem. A label is a capability name attached to one or more agents, such as `linux`, `docker`, `maven`, `windows`, `gpu`, or `terraform`. A pipeline asks for labels, and Jenkins schedules the stage on an available executor from an agent that matches.

The platform team starts with three pools. General Java builds use agents labeled `linux && maven`. Container image builds use agents labeled `linux && docker`. Windows installer builds use agents labeled `windows`. The Jenkinsfile talks about capabilities, so the platform team can replace the actual machines without asking every service team to edit pipeline code.

```groovy
pipeline {
    agent none
    stages {
        stage('Test') {
            agent { label 'linux && maven' }
            steps {
                sh 'mvn test'
            }
        }
        stage('Build Image') {
            agent { label 'linux && docker' }
            steps {
                sh 'docker build -t registry.example.com/team/service:${BUILD_NUMBER} .'
            }
        }
    }
}
```

The top-level `agent none` tells Jenkins that each stage chooses its own runtime. The `Test` stage lands on a Maven-capable Linux agent, while the image stage lands on an agent with Docker access. This shape keeps special privileges narrow, because the Maven-only pool never needs Docker socket access.

Labels also help with capacity planning. If the queue fills with jobs waiting for `linux && docker`, the team knows the Docker-capable pool is the bottleneck. If Windows jobs wait while Linux jobs keep moving, the Windows pool needs attention. Jenkins queue behavior gives useful evidence because labels describe real resource classes.

Good label design stays boring and capability-based. Labels such as `linux`, `jdk21`, `docker`, `arm64`, `terraform`, and `windows` age well because they describe what a build needs. Labels such as `big-box-01` or `alice-test-vm` tie pipeline code to a single machine, and the next hardware replacement turns into a repository-wide cleanup.

After adding a new label or agent pool, the platform team runs a tiny smoke pipeline before sending real builds there. The job proves that Jenkins can schedule the label and that the expected tools exist on the agent.

```groovy
pipeline {
    agent { label 'linux && docker' }
    stages {
        stage('Agent Smoke') {
            steps {
                sh 'hostname'
                sh 'java -version'
                sh 'docker version'
            }
        }
    }
}
```

If this job waits in the queue, the label expression or executor capacity needs attention. If it starts and fails on `docker version`, the agent image or VM setup is missing a capability the label promised.

Labels are scheduling predicates rather than decorative names. Jenkins evaluates the pipeline's label expression against online agents, then waits for a matching free executor. Expressions can use `&&`, `||`, `!`, implication, and equivalence operators to describe a capability set. A request such as `linux && docker` needs both labels; `windows || macos` accepts either pool.

Follow scheduling from beginning to end. Jenkins receives a trigger and evaluates the pipeline. A stage asks for `linux && docker`. The controller finds matching nodes. If none are online, the item waits with a reason. If they are online but every executor is busy, it also waits. When one slot opens, Jenkins assigns the work, establishes the workspace, transfers the step instructions, and streams process output back. Queue time therefore measures the gap between requested capability and available executor capacity.

## When Should Agents Be Static or Dynamic?
<!-- section-summary: Static agents keep stable machines online, while dynamic agents create execution capacity only when a queued build needs it. -->

A **static agent** is a long-lived VM or physical machine registered with Jenkins. It suits specialized hardware, licensed software, large local caches, or a stable small workload. Its tools and workspaces persist, which can improve speed but creates patching, drift, cleanup, and cross-build contamination responsibilities.

A **dynamic agent** is provisioned in response to demand. A cloud integration may start a VM, while the Kubernetes plugin creates a pod from a template. The new agent connects, accepts a build, and is deleted afterward. Capacity follows queue demand instead of remaining powered on, and each build can begin from a known image.

Ephemeral agents are attractive for three reasons. Clean filesystems reduce failures caused by files from earlier work. Disposable runtimes limit persistence after untrusted code runs. Elastic creation lets execution scale horizontally when the queue grows. They still require controlled base images, dependency-download strategy, startup latency management, quotas, and a reliable provisioning control plane.

Kubernetes makes the model concrete. The Jenkins controller is a scheduler and stateful control component. A pod template describes an agent capability. A queued stage with the matching label causes the plugin to create a pod. The pod's agent container connects to Jenkins, while side containers can supply tools such as Maven or a container builder. One executor runs the build, results return to the controller, and the pod is removed.

Static and dynamic are not moral categories. A hardware-in-the-loop job may need a persistent labeled machine, while ordinary compilation benefits from disposable pods. Choose the lifecycle that matches the workload, then make the label describe the capability rather than the host name.

## How Do Failure and Security Boundaries Differ between Controller and Agents?
<!-- section-summary: Agent loss usually interrupts local execution, while controller loss affects scheduling, state, configuration, and the whole Jenkins service. -->

An agent failure is usually localized. The running build may fail or pause, its workspace may disappear, and that agent's executor capacity leaves the pool. Other agents and the controller can remain healthy. Dynamic infrastructure may create a replacement and retry appropriate work.

A controller failure has a wider blast radius. New events cannot be scheduled, the queue and UI become unavailable, plugins and credentials cannot coordinate work, and pipeline state may depend on the durability of controller storage. That is why `$JENKINS_HOME` matters: it holds the durable configuration, secrets, jobs, build records, plugin state, and pipeline metadata needed to restore the service.

Back up `$JENKINS_HOME` consistently, protect its secret material, test restoration, and keep replaceable configuration in source control where possible. An agent workspace is execution scratch space; controller state is the automation system's memory. Treating them alike produces either fragile recovery or expensive unnecessary backups.

The controller commonly sits behind a reverse proxy for TLS termination, a stable hostname, authentication integration, access logging, and routing. The proxy must preserve the Jenkins context path and long-lived HTTP behavior. WebSocket agents additionally require upgrade support and suitable idle timeouts. A proxy misconfiguration can look like random agent instability even when both Java processes are healthy.

<!-- section-summary: Keeping builds on agents limits the exposure of controller secrets and makes trust-specific worker pools possible. -->

Pipeline code is arbitrary code. The controller contains the most valuable Jenkins state: credentials, user and authorization configuration, plugin code, signing secrets, and the ability to schedule other jobs. Running repository commands there places that state beside potentially untrusted processes.

Agents allow trust segmentation. Pull-request validation can run on disposable workers with no production network path. Release signing can use a dedicated label and tightly controlled agent group. Docker-capable agents can be separate from ordinary compilers because access to a host Docker socket is a powerful capability. Labels route work, but authorization and job design must also prevent untrusted pipelines from simply requesting privileged labels.

Connection security matters too. SSH agents need protected keys and verified hosts. Inbound agents need registration secrets, encrypted transport, and controller authorization. Kubernetes agents need constrained service accounts, namespaces, pod templates, and network policy. The controller-to-agent channel makes Jenkins one distributed application, so compromising either endpoint or its credentials affects the trust relationship.

The first operational security rule remains simple: keep controller executors at zero and give each workload the narrowest capable agent. This protects availability and credentials at the same time.

## How Should the Controller JVM and Capacity Scale?
<!-- section-summary: Controller tuning starts with evidence from heap usage, garbage collection, queue behavior, and disk activity. -->

Jenkins runs on the Java Virtual Machine, usually shortened to **JVM**. The JVM gives Jenkins a managed runtime, and the most important controller setting is the Java heap. The **heap** is the memory area where Jenkins keeps Java objects such as jobs, queue items, plugin objects, build records, and in-flight pipeline state.

When the heap runs too small, Jenkins spends too much time on **garbage collection**, often shortened to GC. GC is the JVM process that frees memory that the application no longer needs. A little GC is normal. Constant full GC creates a controller that looks alive but responds slowly, pauses often, and sometimes throws `OutOfMemoryError`.

The platform team notices that the UI freezes every afternoon. Before changing numbers, the platform team gathers evidence: current heap use in Manage Jenkins, JVM arguments from System Information, controller logs, GC logs, plugin count, number of running pipelines, queue depth, disk I/O, and whether builds accidentally run on the controller. This evidence matters because a memory problem, a slow disk, a plugin loop, and an overloaded built-in node can feel similar from the UI.

A Linux package install often controls heap settings through a service environment file. A containerized controller usually receives the setting through `JAVA_OPTS` or `JENKINS_JAVA_OPTS`. The exact file path depends on how Jenkins was installed, but the setting shape looks like this:

```bash
JENKINS_JAVA_OPTS="-Xms2g -Xmx4g -XX:+UseG1GC -Xlog:gc*:file=/var/log/jenkins/gc.log:time,uptime,level,tags"
```

`-Xms` sets the starting heap size, and `-Xmx` sets the maximum heap size. `UseG1GC` selects a garbage collector that works well for many server-side Java applications. The GC log file gives the team concrete pause data instead of guesses from a slow browser tab.

Heap size still has limits. A controller with 64 GB of RAM does not automatically deserve a 60 GB heap. Huge heaps can create longer pauses and hide plugin or job design problems for a while. The controller also needs memory for the operating system, JVM native memory, file cache, web server work, and plugin overhead.

A healthy tuning loop has a steady rhythm. First, keep builds off the controller with zero executors. Next, measure heap pressure and GC pauses during normal work. Then raise `-Xmx` gradually if live data shows memory pressure. After that, review plugins, job history retention, pipeline design, and disk performance because controller tuning can only help the controller, not fix every workload that lands on it.

There is no universal correct heap size. Controller demand changes with plugin behavior, job and branch count, concurrent Pipeline state, build history, user traffic, and event volume. Size from observed live-set and pause behavior, leave headroom for the operating system and JVM native memory, and validate the result under real load.

Jenkins has two scaling dimensions. **Execution scaling** adds or removes agent capacity and executor slots for requested labels. **Orchestration scaling** ensures the controller has enough CPU, heap, disk throughput, and sensible Pipeline and plugin load to coordinate that work. Adding one hundred agents does not fix a controller overwhelmed by Pipeline bookkeeping; doubling controller heap does not create a missing GPU executor.

Controller CPU pressure comes primarily from scheduling, web and API traffic, log processing, plugin callbacks, and Pipeline orchestration—not from compilation when the separation is working. Before buying a larger controller, remove accidental builds, inspect expensive plugins and Pipeline patterns, reduce excessive retained state, and verify storage latency.

## How Do You Diagnose Architecture Failures?
<!-- section-summary: Common Jenkins architecture failures usually come from blurred boundaries, wrong connection choices, weak labels, or unmeasured controller pressure. -->

Jenkins architecture problems usually announce themselves through repeated symptoms. The useful move is to map each symptom back to a boundary: controller state, agent runtime, network connection, label capacity, workspace hygiene, or JVM pressure. Once the boundary is clear, the fix is much more concrete.

| Symptom | Likely boundary | What the team checks |
|---|---|---|
| UI freezes during builds | Controller execution boundary | Built-in node executors, CPU, heap, and jobs running on the controller |
| Jobs wait forever for an agent | Label capacity | Queue reasons, matching labels, offline agents, and executor counts |
| Agents disconnect randomly | Network topology | Proxy timeouts, WebSocket support, inbound port rules, and agent logs |
| Builds pass once and fail later | Workspace state | Old files, shared caches, cleanup steps, and ephemeral agent use |
| Controller restarts or throws heap errors | JVM and plugin pressure | GC logs, heap use, plugin changes, job count, and build retention |
| PR builds can reach secrets | Trust boundary | Multibranch trust settings, credential scope, and branch conditions |

The first failure mode is **controller bleed**. This happens when build work leaks back onto the controller. A job may use `agent any`, the built-in node may still have executors, or a plugin task may run heavy work on the controller. The fix starts with `numExecutors: 0`, explicit stage agents, and a review of jobs that still point at the built-in node.

The second failure mode is **label starvation**. Jenkins may have many agents online, while one narrow label such as `docker && arm64` has no free executor. The queue message usually tells the truth here. Capacity planning should follow labels, because labels describe the real build capabilities that teams request.

The third failure mode is **connection mismatch**. A controller-initiated SSH setup struggles when agents sit behind NAT. An inbound TCP setup struggles when the firewall blocks the agent port. A WebSocket setup struggles when the reverse proxy drops upgraded connections. Connection style should follow the network path that can stay open during normal operations.

The fourth failure mode is **workspace contamination**. A persistent workspace can hold a stale generated file, old dependency, previous test database, or leftover package. Teams reduce this with `cleanWs()`, explicit checkout behavior, known cache directories, and ephemeral pod agents for builds that need strong isolation.

The fifth failure mode is **unmeasured controller tuning**. Raising heap after every freeze can delay the real fix. The team should first confirm that builds stay off the controller, then use heap graphs, GC logs, queue depth, plugin changes, and disk metrics to decide whether the controller needs memory, faster storage, fewer retained builds, or a plugin rollback.

## How Does One Complete Jenkins Build Move Through the System?
<!-- section-summary: A reliable Jenkins installation keeps state on the controller, execution on agents, and capacity decisions visible through labels and metrics. -->

The improved Jenkins setup now has one controller and several agent pools. The controller has zero executors, stores `$JENKINS_HOME` on reliable storage, exports most configuration through code, and records GC logs for tuning. The agent pools carry the tools: Maven agents for Java services, Docker agents for image builds, Windows agents for installer work, and Kubernetes pod agents for isolated one-off builds.

The Jenkinsfiles ask for capabilities by label instead of naming machines. The network design uses SSH agents for the reachable VM fleet and WebSocket inbound agents for private subnets. The Kubernetes plugin creates temporary pods for builds that need a fresh filesystem. Each choice follows a real boundary rather than a preference.

When a build queue grows, the team can see which label needs capacity. When an agent disconnects, they can inspect that connection style and its network path. When the UI slows down, they can separate controller JVM evidence from agent workload evidence. This is what operating Jenkins means in production: keep responsibilities separate, keep evidence close, and make each failure point small enough to reason about.

Trace one build through the complete system. A webhook reaches the controller. Jenkins loads the Pipeline and discovers that the next stage requires `linux && docker`. It creates a queue item because no matching executor is free. A Docker-capable agent finishes another build and releases one slot. The controller assigns the queued work to that executor.

The agent prepares its local workspace and checks out the requested revision. Jenkins sends step instructions over the agent channel. Shell processes run on the agent, using its CPU, memory, tools, filesystem, and network. Logs and status stream back to the controller. The stage archives or transfers any output that later stages need. Jenkins records the result, releases the executor, and, if the worker was dynamic, removes it.

This trace locates every important object. Pipeline and queue state belong to the controller. Capability and connection belong to the agent. Concurrency belongs to the executor. Source and generated files belong to the agent workspace. Actual commands belong to operating-system processes. Results flow back into durable controller records or external artifact storage.

![Healthy Jenkins architecture showing controller staying light, agents doing builds, labels routing work, executor capacity, queue monitoring, and failure recovery](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/healthy-jenkins-architecture.png)

*The architecture summary keeps the main operating loop visible: light controller, capable agents, label-aware capacity, queue evidence, and a clear recovery plan.*

## Check Your Answers

:::expand[Why Separate Orchestration from Execution?]{kind="recap"}
The controller coordinates events, configuration, scheduling, state, and results. Agents execute repository commands with the CPU, memory, disk, tools, and network those commands need. Separating them protects the durable service from volatile and potentially untrusted build work.
:::

:::expand[How Do Controllers, Agents, Executors, and Workspaces Fit Together?]{kind="recap"}
The controller chooses an agent, reserves one executor slot, and starts work in a workspace on that agent. An agent is a runtime; an executor is one concurrency slot. Workspaces and processes are local to agents, while orchestration records return to the controller.
:::

:::expand[How Do Connections, Labels, and the Queue Select an Executor?]{kind="recap"}
The controller can initiate SSH to a reachable machine, or an inbound agent can connect outward over a dedicated TCP channel or WebSocket. Connection direction follows network reachability; job instructions still flow from controller to agent after the channel exists.

Labels describe capabilities, and expressions form scheduling predicates. A queued item waits until an online matching agent has a free executor. Queue reasons reveal whether the problem is a missing label, offline capacity, or all matching slots being busy.
:::

:::expand[When Should Agents Be Static or Dynamic?]{kind="recap"}
Static agents suit persistent hardware, licensed tools, or valuable local caches. Dynamic agents create clean capacity for demand and disappear afterward. Kubernetes pod agents are one dynamic form. Choose by workload needs, isolation, startup time, and operational responsibility.
:::

:::expand[How Do Failure and Security Boundaries Differ between Controller and Agents?]{kind="recap"}
Agent loss normally affects its build, workspace, and capacity. Controller loss affects the queue, UI, plugins, credentials, and global orchestration. Protect and test restoration of `$JENKINS_HOME`; treat agent workspaces as replaceable execution state.

Repository code is arbitrary code, while the controller holds high-value Jenkins state. Zero controller executors and trust-specific agent pools reduce exposure. Protect each agent connection and prevent low-trust pipelines from requesting privileged capacity.
:::

:::expand[How Should the Controller JVM and Capacity Scale?]{kind="recap"}
Tune heap from observed live-set, GC, plugin, Pipeline, and storage evidence; there is no magic size. Scale execution with matching agents and executors. Scale orchestration with controller CPU, heap, storage performance, and lower coordination overhead.
:::

:::expand[How Do You Diagnose Architecture Failures?]{kind="recap"}
Map symptoms to boundaries: UI freezes to controller load, queue waits to labels and executors, disconnects to connection topology, nondeterministic builds to workspace state, and heap errors to measured JVM, plugin, history, or storage pressure.
:::

:::expand[How Does One Complete Jenkins Build Move Through the System?]{kind="recap"}
A trigger reaches the controller, Pipeline requirements create a queue item, and a matching executor accepts it. The agent prepares a workspace and runs processes. Logs and results return, outputs are transferred deliberately, the slot is released, and a dynamic worker may disappear.
:::

## References

- [Jenkins: Managing Nodes](https://www.jenkins.io/doc/book/managing/nodes/) - Defines the controller, agents, executors, and the controller role in Jenkins scheduling.
- [Jenkins: Exposed Services and Ports](https://www.jenkins.io/doc/book/security/services/) - Documents inbound agent transport, WebSocket transport, and agent-related ports.
- [Jenkins Kubernetes plugin](https://plugins.jenkins.io/kubernetes/) - Explains dynamic Kubernetes pod agents and the agent container inside each pod.
- [Jenkins: Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Explains why build execution should stay isolated from controller state.
- [Jenkins: Docker installation](https://www.jenkins.io/doc/book/installing/docker/) - Documents Jenkins Docker runtime paths, inbound agent port notes, and resource guidance.
