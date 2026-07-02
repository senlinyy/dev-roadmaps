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

1. [The Shape of a Jenkins Installation](#the-shape-of-a-jenkins-installation)
2. [Controller and Agent Architecture](#controller-and-agent-architecture)
3. [How Agents Connect](#how-agents-connect)
4. [Labels and Agent Selection](#labels-and-agent-selection)
5. [JVM Tuning for the Controller](#jvm-tuning-for-the-controller)
6. [Failure Modes](#failure-modes)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Shape of a Jenkins Installation
<!-- section-summary: A production Jenkins setup separates the service that coordinates builds from the machines that execute build commands. -->

Jenkins is a self-hosted automation server. That means your team runs the service, owns the storage, chooses the plugins, controls the network path, and carries the operational responsibility when builds slow down or the controller goes offline. A managed CI system hides a lot of that machinery, while Jenkins asks the platform team to design it clearly.

Think about Summit Retail, a team with three services: `checkout-api`, `inventory-api`, and `payments-api`. At first, they install Jenkins on one virtual machine and let every job run there. The UI feels fine for a few days, then a large test run fills the disk, a Docker build consumes CPU, and a production hotfix waits behind a queue that nobody can open because the Jenkins web page also lives on that same overloaded machine.

That failure explains the first big idea in this module. Jenkins needs one place that **coordinates work** and separate places that **execute work**. The coordinator keeps job definitions, credentials, build history, plugin state, and scheduling decisions. The executors run shell commands, compile code, run tests, build images, and create disposable workspaces.

The official Jenkins docs use a few words that sound similar, so let us define them before we stack them together. A **controller** is the Jenkins service itself, including the web UI, queue, configuration, credentials, plugin runtime, and build records. An **agent** is a machine, container, or pod that connects to the controller and runs build steps. An **executor** is a single execution slot on an agent, so one agent with four executors can run four jobs at the same time.

Those three words create the whole architecture. The controller answers, "What should run next?" The agent answers, "Where can this work run?" The executor answers, "How many jobs can this machine handle right now?" Once those roles are clear, Jenkins stops feeling like one mysterious server and starts looking like a small scheduling system that your team can operate on purpose.

## Controller and Agent Architecture
<!-- section-summary: The controller owns durable Jenkins state, while agents provide isolated runtime capacity for builds and deployments. -->

The **controller and agent architecture** gives Jenkins a clean boundary between durable state and risky execution. Durable state means the information Jenkins must keep after a restart: global config, users, folders, job history, credentials metadata, plugins, node definitions, and pipeline records. Risky execution means arbitrary commands from application repositories, dependency install scripts, test suites, compilers, Docker builds, and deployment CLIs.

The controller stores its main state under `$JENKINS_HOME`, commonly `/var/lib/jenkins` on Linux or `/var/jenkins_home` in the official Docker image. That directory holds configuration XML, job folders, plugin files, secret material, node metadata, build records, and fingerprints. A backup or restore plan must treat `$JENKINS_HOME` as controller state, while the article on plugins and configuration later shows how teams also move as much configuration as possible into Git.

Agents protect the controller from everyday build pressure. Summit Retail puts Maven, Node.js, Docker, Trivy, Terraform, kubectl, and cloud CLIs on agents instead of the controller. A broken test can fill an agent workspace, and a compiler can use all CPU on an agent, while the Jenkins UI and queue still have enough memory and CPU to keep scheduling work.

Most production controllers run with **zero executors** on the built-in node. This setting tells Jenkins that the controller coordinates jobs and leaves build execution to agents. In Configuration as Code, the idea usually appears like this:

```yaml
jenkins:
  numExecutors: 0
  mode: EXCLUSIVE
```

`numExecutors: 0` removes build slots from the controller. `mode: EXCLUSIVE` makes Jenkins send jobs to agents that match labels instead of treating the controller as a general fallback. This small setting prevents the most common beginner mistake: letting a pipeline accidentally run `npm install`, `docker build`, or `terraform apply` on the machine that also stores Jenkins secrets and serves the UI.

![Jenkins controller and agents showing controller state, build queue, executor slots, Linux agent, Docker agent, Maven agent, and jobs assigned by label](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/controller-agent-architecture.png)

*A healthy Jenkins installation keeps durable state on the controller while agents provide the executor capacity and toolchains that run build commands.*

Agents also create **workspaces**. A workspace is the directory where Jenkins checks out the repository and runs commands for a job, usually under an agent root path like `/var/jenkins_agent/workspace/checkout-api-main`. Persistent workspaces can speed up builds because Maven caches, npm caches, and Gradle caches remain between runs. They also create dirty-state risk, because a file from yesterday's build can change today's result.

Real teams handle that tradeoff explicitly. For normal agents, they clean the workspace at the start or end of sensitive jobs and keep dependency caches in known cache directories rather than random project folders. For high-risk or highly variable builds, they use ephemeral container agents so the whole filesystem disappears after the build. The right choice depends on build speed, security boundaries, and how much the team trusts the code that enters the agent.

## How Agents Connect
<!-- section-summary: Jenkins supports several connection topologies, and the right one depends on which side can initiate the network connection. -->

After the team separates controller and agent responsibilities, the next question is network shape. An agent must maintain a communication channel with the controller so it can receive work and stream logs. Jenkins supports several connection styles because real networks have firewalls, private subnets, NAT gateways, VPNs, and security teams with strong opinions.

**SSH agents** fit long-lived Linux or Unix machines that the controller can reach over the network. Jenkins uses SSH credentials, connects to the host, starts the agent process, and uses that connection for work. Summit Retail uses this for a small pool of build VMs in the same VPC as the controller because the controller can reach those instances on port 22 and the security team already manages SSH keys.

**Inbound agents** reverse the connection direction. The agent starts a Java process and connects outward to the controller, often using a secret that Jenkins generated for that node. This fits private build machines where the controller cannot open a direct connection into the subnet. The agent can reach `https://jenkins.summit.example`, so it dials out and waits for work.

**WebSocket inbound agents** use the normal Jenkins web URL instead of a separate inbound TCP agent port. This matters when a reverse proxy, corporate firewall, or Kubernetes ingress already permits HTTPS traffic but the security team wants to avoid opening another TCP port. The Jenkins security docs call out that inbound agents can use WebSocket transport without enabling an extra TCP port.

**Kubernetes dynamic agents** create short-lived pods for each build. The Kubernetes plugin starts a pod, runs the Jenkins agent container inside it, lets the build use extra containers such as Maven or Kaniko, and stops the pod after the build. This fits teams that already operate Kubernetes and want clean workspaces, elastic capacity, and per-build tool images.

| Connection style | Who starts the connection | Good fit | Main operational check |
|---|---|---|---|
| SSH agent | Controller to agent | Stable VMs in reachable networks | SSH keys, host keys, Java, and firewall rules |
| Inbound TCP agent | Agent to controller | Private agents behind NAT | Agent secret handling and inbound agent port exposure |
| Inbound WebSocket agent | Agent to controller over HTTPS | Locked-down networks and reverse proxies | Correct Jenkins URL and proxy WebSocket support |
| Kubernetes pod agent | Plugin creates pod, pod connects back | Elastic containerized builds | Pod template, service account, image, and namespace policy |

Here is the practical way to choose. If the controller can reach a controlled VM fleet and SSH operations already work well, SSH agents keep things simple. If agents live in a private subnet where only outbound HTTPS works, WebSocket inbound agents usually fit. If every build should start with a clean filesystem and your team already trusts Kubernetes as the runtime, dynamic pod agents give Jenkins a fresh worker for each run.

![Jenkins agent connection modes showing SSH agents, inbound WebSocket agents, restricted networks, labels, and jobs running on matching agents](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/agent-connection-modes.png)

*Agent connection style follows the network path: the controller can open SSH to reachable machines, while private agents can call back through an inbound WebSocket connection.*

## Labels and Agent Selection
<!-- section-summary: Labels let a Jenkinsfile ask for a capability instead of naming a specific machine. -->

Once agents exist, Jenkins needs a way to pick the right one. **Labels** solve that problem. A label is a capability name attached to one or more agents, such as `linux`, `docker`, `maven`, `windows`, `gpu`, or `terraform`. A pipeline asks for labels, and Jenkins schedules the stage on an available executor from an agent that matches.

Summit Retail starts with three pools. General Java builds use agents labeled `linux && maven`. Container image builds use agents labeled `linux && docker`. Windows installer builds use agents labeled `windows`. The Jenkinsfile talks about capabilities, so the platform team can replace the actual machines without asking every service team to edit pipeline code.

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
                sh 'docker build -t registry.example.com/checkout-api:${BUILD_NUMBER} .'
            }
        }
    }
}
```

The top-level `agent none` tells Jenkins that each stage chooses its own runtime. The `Test` stage lands on a Maven-capable Linux agent, while the image stage lands on an agent with Docker access. This shape keeps special privileges narrow, because the Maven-only pool never needs Docker socket access.

Labels also help with capacity planning. If the queue fills with jobs waiting for `linux && docker`, the team knows the Docker-capable pool is the bottleneck. If Windows jobs wait while Linux jobs keep moving, the Windows pool needs attention. Jenkins queue behavior gives useful evidence because labels describe real resource classes.

Good label design stays boring and capability-based. Labels such as `linux`, `jdk21`, `docker`, `arm64`, `terraform`, and `windows` age well because they describe what a build needs. Labels such as `big-box-01` or `alice-test-vm` tie pipeline code to a single machine, and the next hardware replacement turns into a repository-wide cleanup.

After adding a new label or agent pool, Summit Retail runs a tiny smoke pipeline before sending real builds there. The job proves that Jenkins can schedule the label and that the expected tools exist on the agent.

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

## JVM Tuning for the Controller
<!-- section-summary: Controller tuning starts with evidence from heap usage, garbage collection, queue behavior, and disk activity. -->

Jenkins runs on the Java Virtual Machine, usually shortened to **JVM**. The JVM gives Jenkins a managed runtime, and the most important controller setting is the Java heap. The **heap** is the memory area where Jenkins keeps Java objects such as jobs, queue items, plugin objects, build records, and in-flight pipeline state.

When the heap runs too small, Jenkins spends too much time on **garbage collection**, often shortened to GC. GC is the JVM process that frees memory that the application no longer needs. A little GC is normal. Constant full GC creates a controller that looks alive but responds slowly, pauses often, and sometimes throws `OutOfMemoryError`.

Summit Retail notices that the UI freezes every afternoon. Before changing numbers, the platform team gathers evidence: current heap use in Manage Jenkins, JVM arguments from System Information, controller logs, GC logs, plugin count, number of running pipelines, queue depth, disk I/O, and whether builds accidentally run on the controller. This evidence matters because a memory problem, a slow disk, a plugin loop, and an overloaded built-in node can feel similar from the UI.

A Linux package install often controls heap settings through a service environment file. A containerized controller usually receives the setting through `JAVA_OPTS` or `JENKINS_JAVA_OPTS`. The exact file path depends on how Jenkins was installed, but the setting shape looks like this:

```bash
JENKINS_JAVA_OPTS="-Xms2g -Xmx4g -XX:+UseG1GC -Xlog:gc*:file=/var/log/jenkins/gc.log:time,uptime,level,tags"
```

`-Xms` sets the starting heap size, and `-Xmx` sets the maximum heap size. `UseG1GC` selects a garbage collector that works well for many server-side Java applications. The GC log file gives the team concrete pause data instead of guesses from a slow browser tab.

Heap size still has limits. A controller with 64 GB of RAM does not automatically deserve a 60 GB heap. Huge heaps can create longer pauses and hide plugin or job design problems for a while. The controller also needs memory for the operating system, JVM native memory, file cache, web server work, and plugin overhead.

A healthy tuning loop has a steady rhythm. First, keep builds off the controller with zero executors. Next, measure heap pressure and GC pauses during normal work. Then raise `-Xmx` gradually if live data shows memory pressure. After that, review plugins, job history retention, pipeline design, and disk performance because controller tuning can only help the controller, not fix every workload that lands on it.

## Failure Modes
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

## Putting It All Together
<!-- section-summary: A reliable Jenkins installation keeps state on the controller, execution on agents, and capacity decisions visible through labels and metrics. -->

Summit Retail's improved Jenkins setup now has one controller and several agent pools. The controller has zero executors, stores `$JENKINS_HOME` on reliable storage, exports most configuration through code, and records GC logs for tuning. The agent pools carry the tools: Maven agents for Java services, Docker agents for image builds, Windows agents for installer work, and Kubernetes pod agents for isolated one-off builds.

The Jenkinsfiles ask for capabilities by label instead of naming machines. The network design uses SSH agents for the reachable VM fleet and WebSocket inbound agents for private subnets. The Kubernetes plugin creates temporary pods for builds that need a fresh filesystem. Each choice follows a real boundary rather than a preference.

When a build queue grows, the team can see which label needs capacity. When an agent disconnects, they can inspect that connection style and its network path. When the UI slows down, they can separate controller JVM evidence from agent workload evidence. This is what operating Jenkins means in production: keep responsibilities separate, keep evidence close, and make each failure point small enough to reason about.

![Healthy Jenkins architecture showing controller staying light, agents doing builds, labels routing work, executor capacity, queue monitoring, and failure recovery](/content-assets/articles/article-cicd-jenkins-architecture-and-agents/healthy-jenkins-architecture.png)

*The architecture summary keeps the main operating loop visible: light controller, capable agents, label-aware capacity, queue evidence, and a clear recovery plan.*

## What's Next
<!-- section-summary: The next article turns this architecture into version-controlled pipelines that run on the right agents. -->

The controller and agent architecture gives Jenkins a stable place to run work. The next step is describing the work in a way the team can review, test, and version. That is where `Jenkinsfile` and Pipeline as Code enter the story.

The next article follows Summit Retail as they move fragile UI jobs into committed Jenkinsfiles with stages, options, parallel branches, conditions, post blocks, and multibranch behavior.

---

**References**

- [Jenkins: Managing Nodes](https://www.jenkins.io/doc/book/managing/nodes/) - Defines the controller, agents, executors, and the controller role in Jenkins scheduling.
- [Jenkins: Exposed Services and Ports](https://www.jenkins.io/doc/book/security/services/) - Documents inbound agent transport, WebSocket transport, and agent-related ports.
- [Jenkins Kubernetes plugin](https://plugins.jenkins.io/kubernetes/) - Explains dynamic Kubernetes pod agents and the agent container inside each pod.
- [Jenkins: Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) - Explains why build execution should stay isolated from controller state.
- [Jenkins: Docker installation](https://www.jenkins.io/doc/book/installing/docker/) - Documents Jenkins Docker runtime paths, inbound agent port notes, and resource guidance.
