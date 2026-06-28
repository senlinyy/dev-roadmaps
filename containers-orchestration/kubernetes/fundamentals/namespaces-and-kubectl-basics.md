---
title: "Namespaces and kubectl Basics"
description: "Use namespaces, kubeconfig contexts, and kubectl commands to inspect Kubernetes workloads without guessing where your command is pointed."
overview: "Namespaces give Kubernetes resources a clear scope, and kubectl gives operators a practical way to inspect Deployments, Pods, Services, logs, events, rollout status, and structured output."
tags: ["kubernetes", "namespaces", "kubectl", "kubeconfig", "operations"]
order: 5
id: article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics
---

## Table of Contents

1. [One Command Needs a Target](#one-command-needs-a-target)
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

## One Command Needs a Target
<!-- section-summary: kubectl is useful only when the command clearly names the cluster, namespace, and resource it should read or change. -->

**kubectl** is the command-line client for the Kubernetes API. For example, `kubectl get pods` asks Kubernetes for Pod objects and prints a table. The short command hides a safety question: where is this request pointed?

A Kubernetes command usually needs three target pieces. The **context** chooses the cluster and identity from your kubeconfig. The **namespace** chooses the named scope inside that cluster. The **resource name** chooses the object, such as the `notification-api` Deployment.

Here is the same read command with the target made visible:

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod
```

That command says: use the `notifications-prod` context, read inside the `notifications-prod` namespace, and ask for the `notification-api` Deployment. A staging command would use a staging context and staging namespace, even if the Deployment name stays the same.

We are going to follow a **Customer Notification Platform** through the whole article. The platform has a `notification-api` that accepts customer requests, a `notification-worker` that sends email and SMS jobs, a database dependency that stores notification preferences and delivery status, live traffic from customer-facing systems, and a rollout process that moves new versions through staging and production.

This article connects the pieces in the order an operator usually needs them. First we give resources a place with **namespaces**. Then we talk to the cluster through **kubectl**. After that, **kubeconfig contexts** keep kubectl pointed at the right cluster and namespace. Then we read objects, logs, events, rollout status, and structured output in a way that works for both humans and scripts.

## Namespaces
<!-- section-summary: A namespace gives many Kubernetes resources a named scope inside one cluster, which lets teams reuse names across environments. -->

A **namespace** is a named scope inside one Kubernetes cluster. Many Kubernetes resources, including Pods, Deployments, Services, ConfigMaps, and Secrets, live inside a namespace. The resource name must stay unique inside that namespace, while another namespace can use the same name for a separate resource.

For our Customer Notification Platform, staging and production can both have a Deployment named `notification-api`. Kubernetes can keep them separate because the full location includes the namespace. The production Deployment lives at `notifications-prod/notification-api`, and the staging Deployment lives at `notifications-staging/notification-api`.

![Namespace scope map showing staging and production namespaces with separate notification-api Deployments, Services, ConfigMaps, and Secrets](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/namespace-scope-map.png)

*The namespace map shows the same application names safely repeated in staging and production because each object has a namespace boundary.*

A small namespace manifest looks like this. The labels give platform tooling a simple way to group the namespace by application and environment.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: notifications-prod
  labels:
    app.kubernetes.io/part-of: customer-notification-platform
    environment: prod
```

The same idea works for staging. The name and label change, while the object kind and structure stay familiar.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: notifications-staging
  labels:
    app.kubernetes.io/part-of: customer-notification-platform
    environment: staging
```

A team can create those namespaces through the same declarative workflow they use for other Kubernetes objects. The command sends the YAML to the API server and lets Kubernetes store the namespace objects.

```bash
kubectl apply -f namespaces/notifications-prod.yaml
kubectl apply -f namespaces/notifications-staging.yaml
```

Now the team can deploy the same resource names into each namespace. The namespace flag tells kubectl which copy of the resource to read.

```bash
kubectl get deployment notification-api -n notifications-staging
kubectl get deployment notification-api -n notifications-prod
```

A production cluster often has many teams and many environments. Namespaces help those teams organize resources, apply quotas, attach access rules, label environments, and keep repeated names from colliding. A platform team may give the notification team access to `notifications-staging` for normal development and restrict `notifications-prod` to deployment automation and on-call operators.

The namespace alone gives organization and a policy attachment point. Production isolation also needs the surrounding controls: **RBAC** for who can read or change resources, **NetworkPolicy** for which Pods can talk to each other, **ResourceQuota** for capacity limits, and **Pod Security Admission** labels for baseline runtime rules. Namespaces create the place where those controls can apply cleanly.

So namespaces give our platform a clear place to live. Before we start using kubectl heavily, we should also recognize the namespaces Kubernetes already creates for itself.

## Application Namespaces and System Namespaces
<!-- section-summary: Application teams usually work in dedicated namespaces, while Kubernetes keeps core cluster components in system namespaces. -->

Kubernetes clusters start with a few built-in namespaces. `default` exists so a new cluster can accept objects right away. `kube-system` holds many cluster components and add-ons. `kube-public` exists for publicly readable cluster information. `kube-node-lease` holds node heartbeat lease objects that help the control plane track node health.

A quick namespace list usually looks like this. The application namespaces sit beside the built-in namespaces, which makes the split visible at a glance.

```bash
kubectl get namespaces
```

```
NAME                      STATUS   AGE
default                   Active   41d
kube-node-lease           Active   41d
kube-public               Active   41d
kube-system               Active   41d
notifications-staging     Active   22d
notifications-prod        Active   22d
```

For production application work, teams usually create dedicated namespaces for application workloads. That habit gives every environment an obvious name, makes access review easier, and helps scripts keep test resources separate from real traffic. In our platform, `notifications-prod` tells an operator that the resources serve customers, while `notifications-staging` tells the same operator that the resources support testing and rollout validation.

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

Here are the verbs a junior operator usually reaches for first. Each verb maps to a common operational question in the notification platform.

| Verb | What it asks | Customer Notification Platform example |
|---|---|---|
| `get` | Show a compact list or one object summary | Check whether `notification-api` has available replicas |
| `describe` | Show a human-readable detail view and related events | Inspect why a `worker` Pod keeps restarting |
| `logs` | Read container stdout and stderr | See application errors from `notification-api` |
| `apply` | Create or update objects from YAML | Deploy the latest staging manifests |
| `diff` | Compare manifests with live cluster state | Preview the change before production apply |
| `rollout` | Inspect or manage Deployment rollout state | Watch the `notification-api` rollout finish |
| `delete` | Remove resources | Clear a temporary debug Pod after an incident |

A clear read command for our production API looks like this. The command names the cluster context and the namespace in the same line.

```bash
kubectl get deployment notification-api --context notifications-prod -n notifications-prod
```

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   6/6     6            6           22d
```

The command says exactly where it is looking. It targets the `notifications-prod` context, looks inside the `notifications-prod` namespace, asks for a Deployment, and names `notification-api`. That explicit shape gives better incident notes, safer copy-paste, and fewer surprises during a late-night rollout.

That context flag leads to the next important topic. kubectl can talk to many clusters from one laptop, so the local configuration deserves the same care as the command itself.

## Kubeconfig and Contexts
<!-- section-summary: A kubeconfig file tells kubectl which clusters, users, namespaces, and current context it can use. -->

A **kubeconfig** file is a local configuration file that kubectl uses to find clusters, users, namespaces, and authentication details. The default file usually lives at `~/.kube/config`. Teams can also point kubectl at other files through the `KUBECONFIG` environment variable or the `--kubeconfig` flag.

A **context** is a named entry inside kubeconfig. It groups three things: a cluster, a user, and an optional namespace. For example, a `notifications-prod` context can point at the production cluster, use the production operator identity, and default to the `notifications-prod` namespace.

![Kubeconfig context target map showing kubectl selecting a context, cluster, user identity, namespace, and API server request](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubeconfig-context-target.png)

*The context map shows why a kubectl command needs a visible target: context chooses the cluster and identity, while the namespace chooses the resource scope.*

A context list might look like this. The table shows the current profile, the cluster behind each profile, the user identity, and the default namespace.

```bash
kubectl config get-contexts
```

```
CURRENT   NAME                    CLUSTER              AUTHINFO                  NAMESPACE
*         notifications-prod      prod-eu-west-2       prod-operator             notifications-prod
          notifications-staging   staging-eu-west-2    staging-developer         notifications-staging
          kind-notifications      kind-notifications   kind-notifications-user   default
```

The star marks the current context. When a command leaves out `--context`, kubectl uses the current context from the kubeconfig merge result. When a command leaves out `-n` or `--namespace` for a namespaced resource, kubectl uses the namespace from that context, and many setups fall back to `default` when the context has no namespace.

These commands show the active target before a change window. They give the operator one quick check for both cluster context and default namespace.

```bash
kubectl config current-context
kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'
```

```
notifications-prod
notifications-prod
```

During focused staging work, an engineer may switch their current context. That local switch makes short read-only debugging commands less repetitive during the session.

```bash
kubectl config use-context notifications-staging
```

```
Switched to context "notifications-staging".
```

The team may also save a default namespace on the current context. This setting changes the default namespace for later namespaced commands in that context.

```bash
kubectl config set-context --current --namespace=notifications-staging
```

That setting helps during a long debugging session in one namespace. Production scripts and incident commands should still carry explicit `--context` and `-n` values because reusable automation should avoid hidden local state. Kubernetes usage conventions also recommend machine-oriented output and explicit targeting in reusable scripts.

Kubeconfig files can contain credentials and command hooks. A kubeconfig from a trusted cluster admin or managed Kubernetes provider belongs in the normal workflow. A random kubeconfig from a ticket, chat message, or third-party system deserves inspection before anyone loads it into their shell.

Now we can talk to the right cluster and namespace. The next step is turning that habit into a command shape the whole team can recognize.

## The Safe Command Shape
<!-- section-summary: Explicit context, namespace, resource type, name, and output make kubectl commands safer for humans and scripts. -->

A safe kubectl command names its target clearly. The target has four practical parts: **context**, **namespace**, **resource type**, and **resource name**. Output format adds the fifth part when another tool or script will consume the result.

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

For a rollout check, the command can target the Deployment directly. Kubernetes then reports whether the Deployment has completed the rollout.

```bash
kubectl rollout status deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod
```

```
deployment "notification-api" successfully rolled out
```

For a risky operation, the explicit shape matters even more. A production delete, scale, restart, or image update should make the destination visible in the command and in the change record. A team can paste the command into an incident timeline and see which cluster and namespace it touched without reconstructing a laptop's local context.

The same shape also makes pair debugging calmer. One engineer can say, "We are reading `deployment/notification-api` in `notifications-prod` through the `notifications-prod` context." Another engineer can compare their own command and spot the mismatch before the team follows the wrong evidence.

With a safe command shape in hand, we can start reading the actual objects that explain traffic, rollout, and dependency problems. The investigation will move from high-level workload state into the smaller objects that carry the evidence.

## Reading Resources
<!-- section-summary: Daily Kubernetes inspection usually starts with the workload, then narrows to Pods, Services, and dependency configuration. -->

**Reading a resource** means asking the API server for the current stored object and its status fields. For a Deployment, that includes desired replicas, available replicas, selector labels, rollout conditions, and the Pod template used for new Pods. For a Service, that includes ports, selectors, and the stable virtual IP or load balancer details.

In the Customer Notification Platform, the first read during a production incident should usually start at the Deployment level. The Deployment tells us whether Kubernetes has enough available replicas before we spend time on individual Pods.

![kubectl evidence path showing an operator moving from Deployment status to Pods, logs, events, Service selectors, and structured JSON output](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics/kubectl-evidence-path.png)

*The evidence path keeps kubectl investigation ordered: start with the workload, then narrow into Pods, logs, events, Services, and structured output.*

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod
```

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   4/6     6            4           22d
```

This output says the Deployment wants six replicas, has updated six replicas, and currently has four available. That points the investigation toward Pod health and rollout conditions. The next command can read the Pods selected by the Deployment:

```bash
kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app=notification-api \
  -o wide
```

```
NAME                                READY   STATUS             RESTARTS   AGE   IP            NODE
notification-api-746dd8dbf8-4x9qm   1/1     Running            0          18m   10.24.2.41    worker-a
notification-api-746dd8dbf8-8pt6p   1/1     Running            0          18m   10.24.1.37    worker-b
notification-api-746dd8dbf8-ds6tw   0/1     CrashLoopBackOff   5          16m   10.24.3.52    worker-c
notification-api-746dd8dbf8-jk9qg   0/1     CrashLoopBackOff   5          16m   10.24.2.59    worker-a
```

The Deployment summary told us capacity dropped. The Pod list tells us the reason sits with two crashing Pods. Now the operator can inspect one Pod in detail:

```bash
kubectl describe pod notification-api-746dd8dbf8-ds6tw \
  --context notifications-prod \
  -n notifications-prod
```

`describe` gathers a human-readable view of fields and related events. It is useful when the question involves scheduling, image pulls, probe failures, container restarts, or volume mounts. For a beginner, this command often gives the first plain clue after a compact `get` output.

The API may be healthy while traffic still fails because the Service points at the wrong Pods. The Service selector deserves a quick read because it defines which Pods receive traffic.

```bash
kubectl get service notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o yaml
```

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: notification-api
```

The selector says the Service sends traffic to Pods with `app=notification-api`. If the new rollout accidentally changed Pod labels to `app=customer-notification-api`, the Service would have no matching backend Pods. The operator can confirm the current labels like this:

```bash
kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app=notification-api \
  --show-labels
```

The worker side follows the same pattern. The high-level workload shows replica health, the Pod list shows runtime state, and the detailed Pod view shows scheduling and restart evidence.

```bash
kubectl get deployment worker --context notifications-prod -n notifications-prod
kubectl get pods --context notifications-prod -n notifications-prod -l app=worker
kubectl describe pod worker-68d7f56b8f-cw2mt --context notifications-prod -n notifications-prod
```

The database dependency often shows up through configuration. A ConfigMap or Secret may hold host names, ports, queue names, and feature flags. A safe inspection for a non-secret ConfigMap looks like this:

```bash
kubectl get configmap notification-api-config \
  --context notifications-prod \
  -n notifications-prod \
  -o yaml
```

That inspection path moves from workload to Pods to Service to configuration. The next question is scope: which resources live inside a namespace, and which resources sit outside all application namespaces?

## Namespaced and Cluster-Scoped Resources
<!-- section-summary: Some Kubernetes resources live inside namespaces, while cluster-wide resources describe the cluster itself. -->

A **namespaced resource** belongs to one namespace. Pods, Deployments, Services, ConfigMaps, Secrets, Jobs, and CronJobs usually fall into this category. The `-n notifications-prod` flag matters for those resources because kubectl needs to know which namespace to search.

A **cluster-scoped resource** belongs to the whole cluster. Nodes, PersistentVolumes, StorageClasses, ClusterRoles, and Namespaces sit at this level. A Node can run Pods from many namespaces, so it has no single application namespace.

kubectl can show which API resources use namespaces. This is useful when a command fails because a namespace flag was provided for a cluster-scoped resource.

```bash
kubectl api-resources --namespaced=true
kubectl api-resources --namespaced=false
```

That distinction helps during production work. If `notification-api` has crashing Pods on `worker-c`, the Pod read uses the application namespace because the Pod belongs to `notifications-prod`.

```bash
kubectl get pod notification-api-746dd8dbf8-ds6tw \
  --context notifications-prod \
  -n notifications-prod \
  -o wide
```

The Node read uses the cluster scope. The node represents a worker machine that can host Pods from many namespaces.

```bash
kubectl get node worker-c --context notifications-prod
```

A storage issue may cross both scopes. The `worker` Deployment runs in `notifications-prod`, while a PersistentVolume can describe cluster-level storage backing a claim. A PersistentVolumeClaim has a namespace, and the PersistentVolume it binds to sits cluster-wide. That is why operators often read both objects during database-adjacent incidents.

```bash
kubectl get pvc database-backup-cache \
  --context notifications-prod \
  -n notifications-prod

kubectl get pv pvc-4bd7428e-30f7-46d4-81e8-a617e3d74b4f \
  --context notifications-prod
```

Once you know scope, the next layer of evidence usually comes from logs and events. They answer different questions, so it helps to keep their jobs separate.

## Logs and Events
<!-- section-summary: Logs explain what the container process said, while events explain what Kubernetes observed around the object. -->

**Logs** are the stdout and stderr streams from a container process. They answer application questions: connection errors, validation failures, startup messages, panic traces, retry loops, and business workflow failures. For `notification-api`, logs may show that the app cannot connect to the database or rejects requests because a feature flag changed.

A snapshot of the current container logs looks like this. The `--tail` flag keeps the output focused on the most recent application messages.

```bash
kubectl logs deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod \
  --tail=100
```

A live stream during a rollout looks like this. The `--follow` flag keeps the terminal attached while new log lines arrive.

```bash
kubectl logs deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod \
  --follow
```

For a Pod with multiple containers, the container name keeps the evidence specific. That matters for Pods with sidecars, init containers, or helper containers.

```bash
kubectl logs notification-api-746dd8dbf8-ds6tw \
  --context notifications-prod \
  -n notifications-prod \
  -c notification-api \
  --tail=100
```

**Events** are Kubernetes records about things the control plane and node agents observed. They answer platform questions: image pull failures, failed scheduling, probe failures, volume attach problems, node pressure, and container restart reasons. Events often explain why a Pod never reached the point where application logs would help.

A focused event list for the production namespace looks like this. Sorting by creation timestamp puts the newest platform clues at the bottom of the list.

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

The logs might say the API cannot reach the database. The events might say the readiness probe returns 503 and Kubernetes keeps the Pod out of Service endpoints. Together, they explain both the application symptom and the traffic impact.

During a worker incident, the same split helps. Worker logs may show "queue authentication failed." Events may show no scheduling issue, healthy image pulls, and repeated restarts after the process exits. That combination points the team toward credentials or queue configuration, while node capacity sits lower on the likely list.

Humans can read tables and descriptions during an incident. Scripts and dashboards need structured output, so kubectl also supports output formats that carry the raw object fields.

## Structured Output
<!-- section-summary: kubectl output formats let humans scan resources and let scripts read exact object fields. -->

kubectl prints human-readable tables by default. That default is great during a conversation, because the table shows the fields Kubernetes thinks matter for that resource. For scripts, dashboards, and repeatable checks, the command should ask for stable output such as `-o name`, `-o yaml`, `-o json`, `-o custom-columns`, or `-o jsonpath`.

`-o wide` adds useful table columns for humans. For Pods, the extra node and IP fields often help connect an application symptom to a worker node.

```bash
kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app=notification-api \
  -o wide
```

`-o yaml` shows the object shape. This is the view operators use when they need selectors, status conditions, annotations, and other fields that the default table hides.

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o yaml
```

`-o custom-columns` prints a table with fields the team chooses. It is a good fit for runbooks that need the same small set of fields every time.

```bash
kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app=notification-api \
  -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,NODE:.spec.nodeName,STARTED:.status.startTime'
```

```
NAME                                PHASE     NODE       STARTED
notification-api-746dd8dbf8-4x9qm   Running   worker-a   2026-06-14T08:12:17Z
notification-api-746dd8dbf8-ds6tw   Running   worker-c   2026-06-14T08:14:02Z
```

**JSONPath** lets kubectl extract specific fields from the JSON object. It is useful when a script needs a value, such as the image currently running in production, and the script should receive only that value.

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="notification-api")].image}{"\n"}'
```

```
registry.example.com/notification-api:2026.06.14.3
```

A rollout script can record the image, rollout status, and available replicas without parsing a human table. That makes the check less sensitive to column spacing or terminal formatting.

```bash
kubectl get deployment notification-api \
  --context notifications-prod \
  -n notifications-prod \
  -o jsonpath='{.status.availableReplicas}/{.spec.replicas}{" available\n"}'
```

```
6/6 available
```

For complex transformations, many teams pipe JSON into `jq`. JSONPath handles simple field extraction inside kubectl. `jq` handles larger filtering, grouping, and reshaping. The practical rule is simple: teams choose the smallest structured output that makes the check reliable.

Now we have the pieces. We can combine them into a routine an on-call engineer can use during normal operations and incidents.

## A Daily Operations Routine
<!-- section-summary: A steady kubectl routine checks target, workload, rollout, traffic path, logs, events, and dependency configuration. -->

A daily Kubernetes routine should start with target confirmation. The engineer checks context and namespace, then reads the highest-level workload before digging into Pods. That order avoids chasing one failing Pod while the bigger issue sits in a Deployment, Service, or rollout condition.

The target check looks like this. It gives the operator a quick view of the cluster context and namespace before any read or write command.

```bash
kubectl config current-context
kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'
```

The workload read starts with the API and worker Deployments. These two Deployments carry the request path and the asynchronous delivery path for the platform.

```bash
kubectl get deployment notification-api worker \
  --context notifications-prod \
  -n notifications-prod
```

```
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   6/6     6            6           22d
worker             4/4     4            4           22d
```

The rollout read tells the team whether a new version finished. Rollout history also gives the revision numbers needed for an approved rollback.

```bash
kubectl rollout status deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod

kubectl rollout history deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod
```

During a traffic incident, the Service and selected Pods matter. The Service controls the traffic path, and the selected Pods show which backends can receive that traffic.

```bash
kubectl get service notification-api \
  --context notifications-prod \
  -n notifications-prod

kubectl get pods \
  --context notifications-prod \
  -n notifications-prod \
  -l app=notification-api \
  -o wide
```

During a database dependency incident, configuration and application logs matter. The ConfigMap shows the intended host and settings, while logs show what the application experienced at runtime.

```bash
kubectl get configmap notification-api-config \
  --context notifications-prod \
  -n notifications-prod \
  -o yaml

kubectl logs deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod \
  --tail=100
```

During a restart incident, events and previous container logs matter. Previous logs help when the current container restarted and the important error happened in the old process, while events show the Kubernetes-side restart evidence.

```bash
kubectl logs notification-api-746dd8dbf8-ds6tw \
  --context notifications-prod \
  -n notifications-prod \
  --previous \
  --tail=100

kubectl get events \
  --context notifications-prod \
  -n notifications-prod \
  --sort-by=.metadata.creationTimestamp
```

For a production rollback, the team should first inspect rollout history and the current image. Then the approved rollback command can target the Deployment explicitly so the command record shows the exact revision.

```bash
kubectl rollout history deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod

kubectl rollout undo deployment/notification-api \
  --context notifications-prod \
  -n notifications-prod \
  --to-revision=12
```

Rollback is still a production change. The same command-shape rule applies: context, namespace, resource type, resource name, and a recorded reason in the change or incident system. After the rollback, the operator reads rollout status, Pods, logs, and events again so the team verifies the customer-facing effect.

This routine gives beginners a stable path through a cluster. It also matches how senior operators write incident notes: target, workload, rollout, traffic path, dependencies, logs, events, action, verification.

## Putting It All Together
<!-- section-summary: Namespaces and kubectl give operators a safe path from cluster target to production evidence. -->

The Customer Notification Platform now has a clean Kubernetes operating shape. `notifications-staging` and `notifications-prod` give the API, worker, Service, and dependency configuration separate scopes. The same resource names can appear in both environments because the namespace forms part of the object's practical address.

kubectl gives the team one client for reading and changing those objects through the Kubernetes API server. The useful command shape names the context, namespace, resource type, resource name, and output format. That shape helps a human understand the command and helps a script avoid hidden local state.

kubeconfig and contexts decide where kubectl sends requests. A context groups a cluster, user, and optional namespace, and kubectl uses the current context unless a command provides `--context`. Production commands and reusable scripts should make the target visible because local defaults can differ from laptop to laptop.

Reading Kubernetes resources follows a steady path. The path starts with the Deployment, then moves into selected Pods, Services, rollout status, configuration, logs, and events. Logs explain what the container process said. Events explain what Kubernetes observed around scheduling, probes, image pulls, restarts, and volumes.

Structured output finishes the basics. Human tables help during live debugging. YAML and JSON show full object fields. Custom columns and JSONPath let scripts extract the exact values they need, such as the production image tag or available replica count.

That is enough kubectl and namespace knowledge for a real first week on a Kubernetes-backed team. You can find the right environment, ask the API server clear questions, inspect the notification platform from traffic to rollout to dependency configuration, and leave behind commands that another operator can understand later.

---

**References**

- [Kubernetes Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) - Defines namespace scope, initial namespaces, namespace DNS behavior, and namespaced versus cluster-scoped resources.
- [Command line tool (kubectl)](https://kubernetes.io/docs/reference/kubectl/) - Explains kubectl syntax, operations, resource targeting, output options, common examples, logs, exec, describe, apply, delete, and diff.
- [kubectl Quick Reference](https://kubernetes.io/docs/reference/kubectl/quick-reference/) - Provides practical examples for contexts, namespace defaults, get/describe/logs/events, JSONPath, rollout status, rollout history, and rollout undo.
- [Organizing Cluster Access Using kubeconfig Files](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/) - Documents kubeconfig files, trusted-source warnings, clusters, users, namespaces, contexts, `KUBECONFIG`, and merge rules.
- [Configure Access to Multiple Clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/) - Shows how kubeconfig contexts let kubectl switch among clusters, users, and namespaces.
- [kubectl Usage Conventions](https://kubernetes.io/docs/reference/kubectl/conventions/) - Recommends explicit targeting and machine-oriented output for reusable scripts.
- [JSONPath Support](https://kubernetes.io/docs/reference/kubectl/jsonpath/) - Describes kubectl JSONPath templates and field extraction syntax.
