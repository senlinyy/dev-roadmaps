---
title: "Namespaces and kubectl Basics"
description: "Use namespaces and kubectl to inspect Kubernetes resources, avoid context mistakes, and diagnose common beginner failures."
overview: "Namespaces give Kubernetes objects a scope, and kubectl is the main command-line client for asking the cluster what exists, what changed, and why something is stuck."
tags: ["kubernetes", "namespaces", "kubectl", "contexts"]
order: 5
id: article-containers-orchestration-kubernetes-fundamentals-namespaces-and-kubectl-basics
---

## Table of Contents

1. [The First Safety Boundary](#the-first-safety-boundary)
2. [What a Namespace Does](#what-a-namespace-does)
3. [kubectl Talks to the API Server](#kubectl-talks-to-the-api-server)
4. [Contexts Decide Which Cluster You Touch](#contexts-decide-which-cluster-you-touch)
5. [Listing and Describing Objects](#listing-and-describing-objects)
6. [Working in the Right Namespace](#working-in-the-right-namespace)
7. [Logs, Events, and JSON Output](#logs-events-and-json-output)
8. [Failure Mode: The Object Exists, but Not Where You Looked](#failure-mode-the-object-exists-but-not-where-you-looked)
9. [A Small Daily kubectl Routine](#a-small-daily-kubectl-routine)

## The First Safety Boundary

Kubernetes gives a team one API for many environments, services, and system components. That is useful, but it also means a beginner needs a strong habit for checking where a command is going. The same `kubectl get pods` command can inspect a local learning cluster, staging, or production depending on your current context and namespace.

For `devpolaris-orders-api`, the team might use namespaces named `orders-dev`, `orders-staging`, and `orders-prod`. A namespace is a scope for many Kubernetes object names. The API can have a Deployment named `devpolaris-orders-api` in each namespace without those names colliding.

The first safety rule is simple: before changing anything, know the cluster and namespace your command will use. This is similar to checking `AWS_PROFILE` and region before running a cloud command, or checking the Git branch before pushing.

```bash
$ kubectl config current-context
devpolaris-prod

$ kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'
orders-prod
```

The first command prints the current context. The second prints the default namespace for that context, if one is set. If the namespace output is blank, `kubectl` uses `default` unless you pass `-n`.

## What a Namespace Does

A namespace divides namespaced resources inside one cluster. Deployments, Pods, Services, ConfigMaps, and Secrets are usually namespaced. Nodes and StorageClasses are cluster-scoped, which means they are not inside one namespace.

Namespaces are not the same as separate clusters. Workloads in different namespaces can still share the same physical nodes, cluster DNS system, and control plane. Whether they can talk to each other depends on networking policy and service names, not the namespace alone. Whether people can access them depends on RBAC, which is role-based access control.

```bash
$ kubectl get namespaces
NAME              STATUS   AGE
default           Active   31d
kube-node-lease   Active   31d
kube-public       Active   31d
kube-system       Active   31d
orders-dev        Active   18d
orders-staging    Active   18d
orders-prod       Active   18d
```

Kubernetes starts with system namespaces such as `kube-system` and `kube-node-lease`. Application teams usually create their own namespaces. For production workloads, using the `default` namespace makes it harder to see ownership and harder to apply clean permissions later.

The name scope is easy to demonstrate:

```bash
$ kubectl get deployment devpolaris-orders-api -n orders-staging
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   2/2     2            2           12d

$ kubectl get deployment devpolaris-orders-api -n orders-prod
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   3/3     3            3           18d
```

The same Deployment name can exist in both namespaces. That is useful for consistent environment naming, but it also makes namespace mistakes easy.

## kubectl Talks to the API Server

`kubectl` is the main command-line tool for Kubernetes. It does not talk directly to worker nodes for normal operations. It reads your kubeconfig, chooses a context, authenticates to the API server, sends HTTP requests, and prints the API response in a human-friendly form.

The kubeconfig file usually lives at `$HOME/.kube/config`. It can contain several clusters, users, and contexts. A context combines a cluster, a user, and often a namespace. That combination decides where commands go.

```bash
$ kubectl config get-contexts
CURRENT   NAME                 CLUSTER              AUTHINFO              NAMESPACE
*         devpolaris-prod      prod-eu-west-2       senlin-prod          orders-prod
          devpolaris-staging   staging-eu-west-2    senlin-staging       orders-staging
          kind-devpolaris      kind-devpolaris      kind-devpolaris      default
```

The star marks the current context. If the star points at production, every command without an explicit `--context` goes to production. This is why many teams make context names loud and specific.

You can switch context deliberately:

```bash
$ kubectl config use-context devpolaris-staging
Switched to context "devpolaris-staging".
```

For read-only inspection, switching context is normal. For changes, many operators prefer passing `--context` and `-n` explicitly in scripts so the command records its target in the line itself.

## Contexts Decide Which Cluster You Touch

A context mistake can be more dangerous than a YAML mistake. If you apply the correct staging manifest to production, Kubernetes may accept it and begin reconciling production toward staging settings. Namespaces reduce naming collisions, but they do not protect you from using the wrong context.

Before applying a change to `devpolaris-orders-api`, check both context and namespace:

```bash
$ kubectl config current-context
devpolaris-staging

$ kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'
orders-staging
```

If your context has no namespace, pass it:

```bash
$ kubectl get deployment devpolaris-orders-api --context devpolaris-staging -n orders-staging
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   2/2     2            2           12d
```

That command is longer, but it is clear. In production runbooks, clear targeting is worth the extra characters. The person reviewing an incident note can see exactly which cluster and namespace were inspected.

## Listing and Describing Objects

Two `kubectl` verbs carry a lot of early Kubernetes work: `get` and `describe`. `get` lists objects and compact status. `describe` shows a more detailed human-readable view, including events.

For `devpolaris-orders-api`, start with the Deployment:

```bash
$ kubectl get deployment devpolaris-orders-api -n orders-prod
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   3/3     3            3           18d
```

Then list related Pods:

```bash
$ kubectl get pods -n orders-prod -l app=devpolaris-orders-api
NAME                                     READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-6d8f7d9f8c-2k9sl   1/1     Running   0          2h
devpolaris-orders-api-6d8f7d9f8c-h6p8d   1/1     Running   0          2h
devpolaris-orders-api-6d8f7d9f8c-xr4mf   1/1     Running   0          2h
```

Use `describe` when status is not enough:

```bash
$ kubectl describe deployment devpolaris-orders-api -n orders-prod
Name:                   devpolaris-orders-api
Namespace:              orders-prod
Replicas:               3 desired | 3 updated | 3 total | 3 available
StrategyType:           RollingUpdate
Events:
  Type    Reason             From                   Message
  ----    ------             ----                   -------
  Normal  ScalingReplicaSet  deployment-controller  Scaled up replica set devpolaris-orders-api-6d8f7d9f8c to 3
```

`describe` output is not stable enough for automation, but it is friendly for human diagnosis. Scripts should prefer structured output such as JSON.

## Working in the Right Namespace

You can pass `-n` or `--namespace` to target a namespace for one command. This is usually the safest habit while learning because the command carries its scope with it.

```bash
$ kubectl get svc -n orders-prod
NAME                    TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
devpolaris-orders-api   ClusterIP   10.96.184.37    <none>        80/TCP    18d
```

You can also set the default namespace on the current context:

```bash
$ kubectl config set-context --current --namespace=orders-prod
Context "devpolaris-prod" modified.
```

That is convenient for a focused work session. The tradeoff is hidden state. A command copied from your terminal may behave differently on a teammate's machine if their context uses a different namespace. In shared documentation and incident notes, include `-n`.

Some resources are not namespaced. Nodes are the clearest beginner example:

```bash
$ kubectl get nodes -n orders-prod
error: a resource cannot be retrieved by name across all namespaces

$ kubectl get nodes
NAME        STATUS   ROLES    AGE   VERSION
worker-01   Ready    <none>   31d   v1.34.2
worker-02   Ready    <none>   31d   v1.34.2
worker-03   Ready    <none>   31d   v1.34.2
```

If a namespace flag seems to make no sense for a resource, check whether that resource is cluster-scoped.

`kubectl api-resources` can answer that directly:

```bash
$ kubectl api-resources --namespaced=true | head
NAME          SHORTNAMES   APIVERSION   NAMESPACED   KIND
pods          po           v1           true         Pod
services      svc          v1           true         Service
configmaps    cm           v1           true         ConfigMap

$ kubectl api-resources --namespaced=false | head
NAME          SHORTNAMES   APIVERSION   NAMESPACED   KIND
nodes         no           v1           false        Node
namespaces    ns           v1           false        Namespace
```

This is a useful command when a new object kind appears in a tutorial or runbook. It tells you whether `-n` should matter before you spend time chasing the wrong scope.

## Logs, Events, and JSON Output

`kubectl logs` reads container logs through the Kubernetes API. For a single-container Pod, you can give the Pod name. For a Deployment, `kubectl` can choose matching Pods and stream logs from them.

```bash
$ kubectl logs deployment/devpolaris-orders-api -n orders-prod --tail=20
2026-05-07T08:16:11.204Z info server listening on :3000
2026-05-07T08:16:14.821Z info health check passed
2026-05-07T08:17:02.441Z info created order id=ord_7J9mW region=eu-west-2
```

If a container is crashing, `--previous` asks for logs from the previous crashed instance of the container:

```bash
$ kubectl logs pod/devpolaris-orders-api-55b7f957c8-k8v4p -n orders-prod --previous
2026-05-07T09:02:33.118Z error failed to connect to database: password authentication failed
```

Events give cluster-side facts. Logs give application-side facts. Use both. If a Pod is `ImagePullBackOff`, logs may not exist because the container never started. If the Pod is running but returns 500s, events may be quiet while application logs show the real error.

Structured output helps when you need exact fields:

```bash
$ kubectl get deployment devpolaris-orders-api -n orders-prod -o jsonpath='{.status.readyReplicas}{" ready\n"}'
3 ready
```

JSONPath is not required on day one, but knowing that `kubectl` can print exact fields helps you move from manual inspection to scripts and checks later.

## Failure Mode: The Object Exists, but Not Where You Looked

A very common beginner failure is looking in the wrong namespace. Someone applies a Deployment to `orders-staging`, then checks `orders-prod` and thinks the object disappeared. Or they forget `-n`, check `default`, and see nothing.

```bash
$ kubectl get deployment devpolaris-orders-api
Error from server (NotFound): deployments.apps "devpolaris-orders-api" not found
```

Before editing YAML, ask the cluster across namespaces:

```bash
$ kubectl get deployment --all-namespaces | grep devpolaris-orders-api
orders-staging   devpolaris-orders-api   2/2   2   2   12d
orders-prod      devpolaris-orders-api   3/3   3   3   18d
```

Now the problem is clear. The Deployment exists, but the first command searched the current namespace only. The fix is to pass the right `-n` value or set the namespace on your context.

A similar mistake happens with logs:

```bash
$ kubectl logs deployment/devpolaris-orders-api
Error from server (NotFound): deployments.apps "devpolaris-orders-api" not found in namespace "default"
```

The error message gives the clue: `namespace "default"`. The diagnostic path is to check current context, check current namespace, then rerun with the intended namespace.

The same mistake can hide successful changes. If a staging apply accidentally omits `-n`, Kubernetes may create objects in `default` instead of `orders-staging`. Always inspect the namespace column when something appears duplicated or missing.

```bash
$ kubectl get pods --all-namespaces -l app=devpolaris-orders-api
NAMESPACE        NAME                                     READY   STATUS
default          devpolaris-orders-api-7844c5d5f6-l8pqh   1/1     Running
orders-staging   devpolaris-orders-api-75c9444bd7-m9nbt   1/1     Running
orders-prod      devpolaris-orders-api-6d8f7d9f8c-2k9sl   1/1     Running
```

The unexpected `default` Pod is not a mystery anymore. Delete or correct it according to the team's process, then update the runbook or script so future commands pass the namespace explicitly.

## A Small Daily kubectl Routine

A good daily routine keeps inspection boring and explicit. Start with context, then namespace, then high-level objects, then Pods, then details. This sequence is enough for many first Kubernetes conversations.

```bash
$ kubectl config current-context
$ kubectl config view --minify --output 'jsonpath={..namespace}{"\n"}'
$ kubectl get deployment devpolaris-orders-api -n orders-prod
$ kubectl get pods -n orders-prod -l app=devpolaris-orders-api -o wide
$ kubectl describe pod <pod-name> -n orders-prod
$ kubectl logs <pod-name> -n orders-prod --tail=50
```

When you make changes, prefer a small loop: inspect current state, apply the reviewed manifest, watch rollout status, then verify Pods and logs.

```bash
$ kubectl apply -f deployment.yaml -n orders-staging
deployment.apps/devpolaris-orders-api configured

$ kubectl rollout status deployment/devpolaris-orders-api -n orders-staging
deployment "devpolaris-orders-api" successfully rolled out

$ kubectl get pods -n orders-staging -l app=devpolaris-orders-api
NAME                                     READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-75c9444bd7-m9nbt   1/1     Running   0          2m
devpolaris-orders-api-75c9444bd7-r5ksp   1/1     Running   0          2m
```

The commands are not a full deployment strategy. They are the basic language you need before more advanced Kubernetes topics make sense. Namespaces tell you where to look. Contexts tell you which cluster you are touching. `kubectl` gives you a direct way to ask the API server what exists, what changed, and what failed.

---

**References**

- [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/) - Official namespace documentation covering scope, initial namespaces, and namespace usage.
- [The kubectl Command-Line Tool](https://kubernetes.io/docs/concepts/overview/kubectl/) - Official overview of kubectl, kubeconfig, and communication with the Kubernetes API.
- [kubectl Reference](https://kubernetes.io/docs/reference/kubectl/generated/) - Official generated reference for kubectl commands and flags.
- [Object Names and IDs](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/) - Official explanation of Kubernetes names, UIDs, and name uniqueness.
