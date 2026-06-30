---
title: "Namespaces and kubectl Basics"
description: "Use namespaces, kubeconfig contexts, and kubectl commands to inspect Kubernetes workloads without guessing where your command is pointed."
overview: "Namespaces give Kubernetes resources a clear scope, and kubectl gives operators a practical way to inspect Deployments, Pods, Services, logs, events, rollout status, and structured output."
tags: ["kubernetes", "namespaces", "kubectl", "kubeconfig", "operations"]
order: 5
id: article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics
---
## Table of Contents

1. [Namespaces and kubectl Targets](#namespaces-and-kubectl-targets)
2. [Namespaces](#namespaces)
3. [Application Namespaces and System Namespaces](#application-namespaces-and-system-namespaces)
4. [kubectl](#kubectl)
5. [Kubeconfig and Contexts](#kubeconfig-and-contexts)
6. [The Safe Command Shape](#the-safe-command-shape)
7. [Reading Resources](#reading-resources)
8. [Namespaced and Cluster-Scoped Resources](#namespaced-and-cluster-scoped-resources)
9. [Logs and Events](#logs-and-events)
10. [Structured Output](#structured-output)
11. [A Daily Operations Routine](#a-daily-operations-routine)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## Namespaces and kubectl Targets
<!-- section-summary: Namespaces scope Kubernetes objects, and kubectl commands should clearly name the cluster, namespace, and resource they read or change. -->

A **namespace** is a named scope inside one Kubernetes cluster. It gives many resources, such as Deployments, Pods, Services, ConfigMaps, and Secrets, a clear place to live. **kubectl** is the command-line client for the Kubernetes API. It reads your local configuration, sends requests to the API server, and prints the response.

Those two ideas belong together because Kubernetes clusters often reuse names. A short command can inspect the right production Deployment, or it can accidentally inspect a staging object with the same name. The difference is usually the context, namespace, and resource target. kubectl basics are about pointing the command at the right place before trusting the answer.

The Customer Notification Platform makes those targets visible. Staging and production may both run `notification-api`, `notification-worker`, ConfigMaps, Secrets, and Services. Namespaces keep those objects scoped, and kubectl gives operators one practical way to inspect them.

The command examples stay small and explain what each important flag means. The aim is to build a daily command shape you can trust before you move into logs, events, rollout status, and structured output.

A developer wants to check `notification-api` during a rollout and runs a short command:

```bash
kubectl get deployment notification-api
```

That command looks harmless, but staging and production can both have a Deployment named `notification-api`. If the terminal is pointed at the wrong cluster or namespace, the command can show the wrong object. A read command gives misleading evidence, and a write command can change the wrong environment.

A safe Kubernetes command usually needs three target pieces. The **context** chooses the cluster and identity from your kubeconfig. The **namespace** chooses the named scope inside that cluster. The **resource name** chooses the object, such as the `notification-api` Deployment.

Here is the same read command with the target made visible:

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod
```

`--context notifications-prod` chooses the kubeconfig context, which points kubectl at the production cluster and identity. `-n notifications-prod` chooses the namespace inside that cluster. The resource type and name, `deployment notification-api`, tell Kubernetes which object to read.

The same platform has a `notification-api` that accepts customer requests, a `notification-worker` that sends email and SMS jobs, a database dependency that stores notification preferences and delivery status, live traffic from customer-facing systems, and a rollout process that moves new versions through staging and production.

The operating order is straightforward: give resources a place with **namespaces**, talk to the cluster through **kubectl**, use **kubeconfig contexts** to keep kubectl pointed at the right cluster and namespace, then read objects, logs, events, rollout status, and structured output in a way that works for both humans and scripts.

## Namespaces
<!-- section-summary: A namespace gives many Kubernetes resources a named scope inside one cluster, which lets teams reuse names across environments. -->

A **namespace** is a named scope inside one Kubernetes cluster. Many Kubernetes resources, including Pods, Deployments, Services, ConfigMaps, and Secrets, live inside a namespace. The resource name must stay unique inside that namespace, while another namespace can use the same name for a separate resource.

For our Customer Notification Platform, staging and production can both have a Deployment named `notification-api`. Kubernetes can keep them separate because the full location includes the namespace. The production Deployment lives at `notifications-prod/notification-api`, and the staging Deployment lives at `notifications-staging/notification-api`.

![Namespace scope map showing staging and production namespaces with separate notification-api Deployments, Services, ConfigMaps, and Secrets](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/namespace-scope-map.png)

*The namespace map shows the same application names safely repeated in staging and production because each object has a namespace boundary.*

Before a complete namespace manifest, the useful skeleton is very small.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: notifications-prod
```

`kind: Namespace` tells Kubernetes the object type. `metadata.name` gives the scope its name. A production manifest usually adds labels so policy, cost, ownership, and automation tools can group the namespace.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: notifications-prod
  labels:
    app.kubernetes.io/part-of: customer-notification-platform
    environment: prod
```

The staging namespace uses the same object shape with a different name and environment label. The important idea is that the application can reuse names inside each scope. `notification-api` in staging and `notification-api` in production are two separate Deployment objects because they live in two different namespaces.

A production cluster often has many teams and many environments. Namespaces help those teams organize resources, apply quotas, attach access rules, label environments, and keep repeated names from colliding. A platform team may give the notification team access to `notifications-staging` for normal development and restrict `notifications-prod` to deployment automation and production operators.

The namespace gives organization and a policy attachment point. Production isolation also needs the surrounding controls: **RBAC** for who can read or change resources, **NetworkPolicy** for which Pods can talk to each other, **ResourceQuota** for capacity limits, and **Pod Security Admission** labels for baseline runtime rules. Namespaces create the place where those controls can apply cleanly.

## Application Namespaces and System Namespaces
<!-- section-summary: Application teams usually work in dedicated namespaces, while Kubernetes keeps core cluster components in system namespaces. -->

Kubernetes clusters include a few built-in namespaces. `default` exists so a new cluster can accept objects right away. `kube-system` holds many cluster components and add-ons. `kube-public` exists for publicly readable cluster information. `kube-node-lease` holds node heartbeat lease objects that help the control plane track node health.

Application teams need to recognize those names because they show up in every real cluster. The notification team should spend most of its time in `notifications-staging` and `notifications-prod`, while platform engineers may inspect `kube-system` when DNS, networking, metrics, or cluster add-ons fail. Mixing those scopes during support work can waste time or lead to risky commands against system components.

The command below lists namespace objects. It has no `-n` flag because Namespace itself is cluster-scoped.

```bash
kubectl get namespaces
```

A typical list contains both system scopes and application scopes.

| Namespace | Usual purpose |
| --- | --- |
| `default` | Initial namespace in many clusters |
| `kube-system` | Cluster components and add-ons |
| `kube-public` | Publicly readable cluster information |
| `kube-node-lease` | Node heartbeat lease objects |
| `notifications-staging` | Staging notification workloads |
| `notifications-prod` | Production notification workloads |

For production application work, teams usually create dedicated namespaces for application workloads. That habit gives every environment an obvious name, makes access review direct, and helps scripts keep test resources separate from real traffic. In our platform, `notifications-prod` tells an operator that the resources serve customers, while `notifications-staging` tells the same operator that the resources support testing and rollout validation.

Namespaces also affect service discovery. A Service named `database` inside `notifications-prod` receives a DNS name like `database.notifications-prod.svc.cluster.local`. A Pod in the same namespace can often call it as `database`, while a Pod in another namespace should use the longer name so the request reaches the intended Service.

Here is a common production example. The `notification-api` Pod reads its database host from a ConfigMap. In staging, the value points to `database.notifications-staging.svc.cluster.local`; in production, the value points to `database.notifications-prod.svc.cluster.local`. The application code can stay the same because the namespace-specific configuration tells it which database dependency to use.

Now we have named places for the platform. The next piece is the tool that asks Kubernetes what lives in those places.

## kubectl
<!-- section-summary: kubectl is the command-line client that sends authenticated requests to the Kubernetes API server. -->

**kubectl** is the main command-line client for Kubernetes. It reads your local configuration, chooses a cluster, authenticates as a user or service identity, sends a request to the Kubernetes API server, and prints the response. When you type `kubectl get pods`, kubectl asks the control plane for Pod objects and formats the answer for your terminal.

That detail matters during real operations. kubectl sends API requests; controllers, schedulers, kubelets, and container runtimes carry out the work after the API server accepts the desired state. A `kubectl apply` command stores a desired Deployment update, and then the Deployment controller works through ReplicaSets and Pods to roll the new version out.

Most day-to-day kubectl commands follow this shape. The exact resource and flags change, while the grammar stays steady.

```bash
kubectl <verb> <resource-type> <resource-name> --context <context-name> -n <namespace> -o <output-format>
```

The **verb** says what kind of API action you want. The **resource type** says which Kubernetes object kind you care about. The **resource name** narrows the request to one object. The **context** chooses the cluster and identity. The **namespace** chooses the resource scope. The **output format** chooses how kubectl prints the response.

Here are the verbs a junior operator usually reaches for first.

| Verb | What it asks | Customer Notification Platform example |
|---|---|---|
| `get` | Show a compact list or one object summary | Check whether `notification-api` has available replicas |
| `describe` | Show a human-readable detail view and related events | Inspect why an API Pod keeps restarting |
| `logs` | Read container stdout and stderr | See application errors from `notification-api` |
| `apply` | Create or update objects from YAML | Deploy the latest staging manifests |
| `diff` | Compare manifests with live cluster state | Preview the change before production apply |
| `rollout` | Inspect or manage Deployment rollout state | Watch the `notification-api` rollout finish |

A clear read command for our production API looks like this.

```bash
kubectl get deployment notification-api --context notifications-prod -n notifications-prod
```

The command says exactly where it is looking:

- `--context notifications-prod` chooses the kubeconfig context, which means the cluster and user identity kubectl will use.
- `-n notifications-prod` chooses the namespace inside that cluster, which is where this Deployment object lives.
- `get deployment notification-api` asks for one Deployment object instead of a broad list.

That explicit shape gives clear change notes, safer copy-paste, and fewer surprises during a production rollout.

That context flag leads to the next important topic. kubectl can talk to many clusters from one laptop, so the local configuration deserves the same care as the command itself.

## Kubeconfig and Contexts
<!-- section-summary: A kubeconfig file tells kubectl which clusters, users, namespaces, and current context it can use. -->

A **kubeconfig** file is a local configuration file that kubectl uses to find clusters, users, namespaces, and authentication details. The default file usually lives at `~/.kube/config`. Teams can also point kubectl at other files through the `KUBECONFIG` environment variable or the `--kubeconfig` flag.

A **context** is a named entry inside kubeconfig. It groups three things: a cluster, a user, and an optional namespace. For example, a `notifications-prod` context can point at the production cluster, use the production operator identity, and default to the `notifications-prod` namespace.

![Kubeconfig context target map showing kubectl selecting a context, cluster, user identity, namespace, and API server request](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubeconfig-context-target.png)

*The context map shows why a kubectl command needs a visible target: context chooses the cluster and identity, while the namespace chooses the resource scope.*

The context list command prints the current profile, the cluster behind each profile, the user identity, and the default namespace.

```bash
kubectl config get-contexts
```

| Current | Name | Cluster | User | Namespace |
| --- | --- | --- | --- | --- |
| `*` | `notifications-prod` | `prod-eu-west-2` | `prod-operator` | `notifications-prod` |
|  | `notifications-staging` | `staging-eu-west-2` | `staging-developer` | `notifications-staging` |
|  | `kind-notifications` | `kind-notifications` | `kind-notifications-user` | `default` |

The star marks the current context. When a command leaves out `--context`, kubectl uses the current context from the kubeconfig merge result. When a command leaves out `-n` or `--namespace` for a namespaced resource, kubectl uses the namespace from that context, and many setups fall back to `default` when the context has no namespace.

During a long staging debugging session, an engineer may set `notifications-staging` as the current context and default namespace. Production scripts and support commands should still carry explicit `--context` and `-n` values because reusable automation should avoid hidden local state.

Kubeconfig files can contain credentials and command hooks. A kubeconfig from a trusted cluster admin or managed Kubernetes provider belongs in the normal workflow. A random kubeconfig from a ticket, chat message, or third-party system deserves inspection before anyone loads it into their shell.

Now we can talk to the right cluster and namespace. The next step is turning that habit into a command shape the whole team can recognize.

## The Safe Command Shape
<!-- section-summary: Explicit context, namespace, resource type, name, and output make kubectl commands safer for humans and scripts. -->

A safe kubectl command names its target clearly. The target has four practical parts: **context**, **namespace**, **resource type**, and **resource name**. Output format adds the fifth part when another tool or script will consume the result.

This section turns the earlier namespace and context ideas into a command pattern. For the notification platform, the same Deployment name can exist in staging and production, so the command should show the destination instead of depending on hidden shell state. That habit also makes incident notes and deployment logs readable to the next operator.

For our production API, this command gives a clear, human-readable status. It keeps the destination visible for anyone reading the terminal history later.

```bash
kubectl get deployment notification-api --context notifications-prod -n notifications-prod
```

For a script that only needs the Kubernetes object address, `-o name` gives stable machine-oriented output. The script can compare that value without parsing a table.

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o name
```

```
deployment.apps/notification-api
```

The `-o name` output says the object exists and prints its API resource address. It says nothing about health, so a rollout or availability check still needs Deployment status. That is the main beginner habit: one command answers one question.

Output flags should match the question:

- `-o name` prints only the resource address, which is useful for scripts that need to confirm existence.
- `-o wide` keeps the normal table and adds extra operational columns, such as node placement for Pods.
- `-o yaml` or `-o json` prints the full object shape for review, troubleshooting, and automation.
- `-o jsonpath=...` extracts one exact field when a script needs a single value.

For a risky operation, the explicit shape matters even more. A production delete, scale, restart, or image update should make the destination visible in the command and in the change record. A team can paste the command into a change timeline and see which cluster and namespace it touched without reconstructing a laptop's local context.

With a safe command shape in hand, we can start reading the actual objects that explain traffic, rollout, and dependency problems. The investigation will move from high-level workload state into the smaller objects that carry the evidence.

## Reading Resources
<!-- section-summary: Daily Kubernetes inspection usually starts with the workload, then narrows to Pods, Services, and dependency configuration. -->

**Reading a resource** means asking the API server for the current stored object and its status fields. For a Deployment, that includes desired replicas, available replicas, selector labels, rollout conditions, and the Pod template used for new Pods. For a Service, that includes ports, selectors, and the stable virtual IP or load balancer details.

In the Customer Notification Platform, the first inspection during a production issue should usually begin at the Deployment level. The Deployment tells us whether Kubernetes has enough available replicas before we spend time on individual Pods.

![kubectl evidence path showing an operator moving from Deployment status to Pods, logs, events, Service selectors, and structured JSON output](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubectl-evidence-path.png)

*The evidence path keeps kubectl investigation ordered: inspect the workload first, then narrow into Pods, logs, events, Services, and structured output.*

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod
```

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   4/6     6            4           22d
```

The output says the Deployment wants six replicas, has updated six replicas, and currently has four available. That points the investigation toward Pod health and rollout conditions. `--context` and `-n` keep the production target explicit.

The next read lists the Pods selected by the application label.

```bash
kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app.kubernetes.io/name=notification-api \
  -o wide
```

```
NAME                                READY   STATUS             RESTARTS   AGE   NODE
notification-api-746dd8dbf8-4x9qm   1/1     Running            0          18m   worker-a
notification-api-746dd8dbf8-ds6tw   0/1     CrashLoopBackOff   5          16m   worker-c
```

The `-l` flag applies a **label selector**. A label selector is a filter over key-value labels on Kubernetes objects. In this command, `app.kubernetes.io/name=notification-api` keeps the list focused on Pods that belong to the API instead of every Pod in the namespace. `-o wide` adds operational columns such as the node. The Deployment summary told us capacity dropped; the Pod list tells us one copy is crashing and where it is running.

The Service and configuration reads come after the workload and Pod check.

| Question | Resource to read | What the answer tells the operator |
| --- | --- | --- |
| Is traffic selecting the right Pods? | `kubectl get service notification-api --context notifications-prod -n notifications-prod -o yaml` | Service selector, port, and target port |
| Did the rollout change labels? | `kubectl get pods --context notifications-prod -n notifications-prod -l app.kubernetes.io/name=notification-api --show-labels` | Current Pod labels and selector match |
| Which non-secret settings feed the API? | `kubectl get configmap notification-api-config --context notifications-prod -n notifications-prod -o yaml` | Database host, queue name, feature flags, and other plain settings |

The worker side follows the same pattern. The high-level workload shows replica health, the Pod list shows runtime state, and the detailed Pod view shows scheduling and restart evidence. This is the progressive path: workload, Pods, traffic path, configuration, then logs and events.

## Namespaced and Cluster-Scoped Resources
<!-- section-summary: Some Kubernetes resources live inside namespaces, while cluster-wide resources describe the cluster itself. -->

A **namespaced resource** belongs to one namespace. Pods, Deployments, Services, ConfigMaps, Secrets, Jobs, and CronJobs usually fall into this category. The `-n notifications-prod` flag matters for those resources because kubectl needs to know which namespace to search.

A **cluster-scoped resource** belongs to the whole cluster. Nodes, PersistentVolumes, StorageClasses, ClusterRoles, and Namespaces sit at this level. A Node can run Pods from many namespaces, so it has no single application namespace.

The command `kubectl api-resources --namespaced=true` lists resource types that can live inside a namespace. The command `kubectl api-resources --namespaced=false` lists resource types that belong to the whole cluster. The output is long, so operators usually use those commands as lookups instead of memorizing every resource type.

That distinction helps during production work.

| Situation | Resource scope | Command shape |
| --- | --- | --- |
| Inspect a crashing API Pod | Namespaced | `kubectl get pod <pod-name> --context notifications-prod -n notifications-prod -o wide` |
| Inspect the worker node that hosts it | Cluster-scoped | `kubectl get node worker-c --context notifications-prod` |
| Inspect a database backup claim | Namespaced | `kubectl get pvc database-backup-cache --context notifications-prod -n notifications-prod` |
| Inspect the bound volume | Cluster-scoped | `kubectl get pv <pv-name> --context notifications-prod` |

Once you know scope, the next layer of evidence usually comes from logs and events. They answer different questions, so it helps to keep their jobs separate.

## Logs and Events
<!-- section-summary: Logs explain what the container process said, while events explain what Kubernetes observed around the object. -->

**Logs** are the stdout and stderr streams from a container process. They answer application questions: connection errors, validation failures, startup messages, panic traces, retry loops, and business workflow failures. For `notification-api`, logs may show that the app cannot connect to the database or rejects requests because a feature flag changed.

Logs fit after the team has identified the workload and container. They explain what the process said from inside the Pod, which is why they are valuable after a Pod starts. If the Pod never scheduled or never pulled its image, events usually carry the first useful clue, because the application process never reached the point where it could print a log line.

A snapshot of the current container logs looks like this.

```bash
kubectl logs deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod \
  --tail=100
```

`deployment/notification-api` asks kubectl to read logs from Pods managed by that Deployment. `--tail=100` keeps the output focused on recent application messages. If the Pod has multiple containers, add `-c <container-name>` so the evidence points at the right container.

**Events** are Kubernetes records about things the control plane and node agents observed. They answer platform questions: image pull failures, failed scheduling, probe failures, volume attach problems, node pressure, and container restart reasons. Events often explain why a Pod never reached the point where application logs would help.

A focused event list for the production namespace looks like this.

```bash
kubectl get events \
  --context notifications-prod \
  -n notifications-prod \
  --sort-by=.metadata.creationTimestamp
```

```
LAST SEEN   TYPE      REASON      OBJECT                                   MESSAGE
2m          Warning   Unhealthy   pod/notification-api-746dd8dbf8-ds6tw     Readiness probe failed: HTTP probe failed with statuscode: 503
90s         Warning   BackOff     pod/notification-api-746dd8dbf8-ds6tw     Back-off restarting failed container notification-api
```

`--sort-by=.metadata.creationTimestamp` puts the newest clues at the bottom of the list. The events say Kubernetes saw a readiness failure and a restart backoff. The logs may explain the application reason, such as a database timeout or missing environment value.

During a worker failure, the same split helps. Worker logs may show "queue authentication failed." Events may show healthy scheduling, healthy image pulls, and repeated restarts after the process exits. That combination points the team toward credentials or queue configuration, while node capacity sits lower on the likely list.

Humans can read tables and descriptions during production support. Scripts and dashboards need structured output, so kubectl also supports output formats that carry the raw object fields.

## Structured Output
<!-- section-summary: kubectl output formats let humans scan resources and let scripts read exact object fields. -->

kubectl prints human-readable tables by default. That default is great during a conversation, because the table shows the fields Kubernetes thinks matter for that resource. For scripts, dashboards, and repeatable checks, the command should ask for stable output such as `-o name`, `-o yaml`, `-o json`, `-o custom-columns`, or `-o jsonpath`.

`-o yaml` shows the object shape, including selectors, status conditions, annotations, and fields that the default table hides. `-o custom-columns` prints a table with fields the team chooses. `-o jsonpath` extracts a specific value from the object JSON. JSONPath is useful when a script needs one field, such as the current image, a ready replica count, or a Service cluster IP.

This command extracts the image currently recorded in the production Deployment template.

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="notification-api")].image}{"\n"}'
```

```
ghcr.io/devpolaris/notification-api:1.4.2
```

The JSONPath expression walks into the Deployment's Pod template, finds the container named `notification-api`, and prints its image field. The output is only the image string, which makes it useful for scripts, release notes, and rollback checks. The final `{"\n"}` adds a newline so the terminal prompt appears on the next line instead of touching the image string.

For complex transformations, many teams pipe JSON into `jq`. JSONPath handles simple field extraction inside kubectl. `jq` handles larger filtering, grouping, and reshaping. The practical rule is simple: teams choose the smallest structured output that makes the check reliable.

Now we have the pieces. We can combine them into a routine an operator can use during normal operations and production support.

## A Daily Operations Routine
<!-- section-summary: A steady kubectl routine checks target, workload, rollout, traffic path, logs, events, and dependency configuration. -->

A daily Kubernetes routine should open with target confirmation. The engineer checks context and namespace, then reads the highest-level workload before digging into Pods. That order avoids chasing one failing Pod while the bigger issue sits in a Deployment, Service, or rollout condition.

For the notification platform, this routine works for quiet mornings and urgent support calls. It proves the command target first, checks the API and worker at the controller level, then narrows into the traffic path and evidence sources. The routine is short enough to repeat, but it still covers the places where most beginner mistakes hide.

For the Customer Notification Platform, a useful routine can stay compact.

| Step | Question | Command shape | How to interpret it |
| --- | --- | --- | --- |
| Target | Which cluster and namespace am I reading? | `kubectl config get-contexts` | The starred context and namespace should match the environment |
| Workload | Are API and worker replicas available? | `kubectl get deployment notification-api notification-worker --context notifications-prod -n notifications-prod` | Ready and available counts should match the requested count |
| Rollout | Did the latest API release finish? | `kubectl rollout status deployment/notification-api --context notifications-prod -n notifications-prod` | Success means the Deployment reached its rollout condition |
| Traffic path | Which Pods sit behind the API label? | `kubectl get pods --context notifications-prod -n notifications-prod -l app.kubernetes.io/name=notification-api -o wide` | The selected Pods should be ready and spread across healthy nodes |
| Application evidence | What did the API process report recently? | `kubectl logs deployment/notification-api --context notifications-prod -n notifications-prod --tail=100` | Recent logs should match the symptom under investigation |
| Platform evidence | What did Kubernetes observe around the objects? | `kubectl get events --context notifications-prod -n notifications-prod --sort-by=.metadata.creationTimestamp` | Probe, scheduling, image, and restart messages guide the next read |

For a production rollback, the team should first inspect rollout history and the current image. Then the approved rollback command can target the Deployment explicitly so the command record shows the exact revision. After the rollback, the operator reads rollout status, Pods, logs, and events again so the team verifies the customer-facing effect.

This routine gives beginners a stable path through a cluster. It also matches how senior operators write support notes: target, workload, rollout, traffic path, dependencies, logs, events, action, verification.

## Putting It All Together
<!-- section-summary: Namespaces and kubectl give operators a safe path from cluster target to production evidence. -->

The Customer Notification Platform now has a clean Kubernetes operating shape. `notifications-staging` and `notifications-prod` give the API, worker, Service, and dependency configuration separate scopes. The same resource names can appear in both environments because the namespace forms part of the object's practical address.

kubectl gives the team one client for reading and changing those objects through the Kubernetes API server. The useful command shape names the context, namespace, resource type, resource name, and output format. That shape helps a human understand the command and helps a script avoid hidden local state.

kubeconfig and contexts decide where kubectl sends requests. A context groups a cluster, user, and optional namespace, and kubectl uses the current context unless a command provides `--context`. Production commands and reusable scripts should make the target visible because local defaults can differ from laptop to laptop.

Reading Kubernetes resources follows a steady path. The path starts with the Deployment, then moves into selected Pods, Services, rollout status, configuration, logs, and events. Logs explain what the container process said. Events explain what Kubernetes observed around scheduling, probes, image pulls, restarts, and volumes.

Structured output finishes the basics. Human tables help during live debugging. YAML and JSON show full object fields. Custom columns and JSONPath let scripts extract the exact values they need, such as the production image tag or available replica count.

That is enough kubectl and namespace knowledge for a real first week on a Kubernetes-backed team. You can find the right environment, ask the API server clear questions, inspect the notification platform from traffic to rollout to dependency configuration, and leave behind commands that another operator can understand later.

## References

- [Kubernetes Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) - Defines namespace scope, initial namespaces, namespace DNS behavior, and namespaced versus cluster-scoped resources.
- [Command line tool (kubectl)](https://kubernetes.io/docs/reference/kubectl/) - Explains kubectl syntax, operations, resource targeting, output options, common examples, logs, exec, describe, apply, delete, and diff.
- [kubectl Quick Reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/) - Provides practical examples for contexts, namespace defaults, get/describe/logs/events, JSONPath, rollout status, rollout history, and rollout undo.
- [Organizing Cluster Access Using kubeconfig Files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/) - Documents kubeconfig files, trusted-source warnings, clusters, users, namespaces, contexts, `KUBECONFIG`, and merge rules.
- [Configure Access to Multiple Clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/) - Shows how kubeconfig contexts let kubectl switch among clusters, users, and namespaces.
- [kubectl Usage Conventions](https://kubernetes.io/docs/reference/kubectl/conventions/) - Recommends explicit targeting and machine-oriented output for reusable scripts.
- [JSONPath Support](https://kubernetes.io/docs/reference/kubectl/jsonpath/) - Describes kubectl JSONPath templates and field extraction syntax.
