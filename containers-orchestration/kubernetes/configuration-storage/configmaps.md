---
title: "ConfigMaps"
description: "Use ConfigMaps to move non-secret Kubernetes application configuration out of container images and into reviewable objects."
overview: "ConfigMaps keep plain environment-specific settings beside your workload manifests so the same image can run safely in different Kubernetes environments."
tags: ["kubernetes", "configmaps", "configuration", "deployments"]
order: 1
id: article-containers-orchestration-kubernetes-configuration-storage-configmaps
---

## Table of Contents

1. [Start with One Plain Setting](#start-with-one-plain-setting)
2. [What a ConfigMap Stores](#what-a-configmap-stores)
3. [The Notification Platform Scenario](#the-notification-platform-scenario)
4. [Create One, Then Inspect It](#create-one-then-inspect-it)
5. [Wire Specific Keys into a Container](#wire-specific-keys-into-a-container)
6. [Use envFrom Only for Dedicated ConfigMaps](#use-envfrom-only-for-dedicated-configmaps)
7. [Mount a ConfigMap as Files](#mount-a-configmap-as-files)
8. [How Updates Reach Running Pods](#how-updates-reach-running-pods)
9. [Immutable ConfigMaps](#immutable-configmaps)
10. [Kustomize, Helm, and GitOps Workflows](#kustomize-helm-and-gitops-workflows)
11. [Validate and Troubleshoot](#validate-and-troubleshoot)
12. [Assembled Example](#assembled-example)
13. [Review Checklist](#review-checklist)

## Start with One Plain Setting
<!-- section-summary: A ConfigMap begins with a plain application setting such as LOG_LEVEL that the Pod can receive at runtime. -->

A familiar application need is one safe setting. The `notification-api` container should run with `LOG_LEVEL=info` in production and `LOG_LEVEL=debug` in a troubleshooting namespace. That value is safe to review, safe to print, and small enough that it should not require a new container image.

A **ConfigMap** is a Kubernetes object for plain, non-secret configuration. Plain means the value can appear in a pull request, a support ticket, a `kubectl describe` output, and a teammate's screen share without exposing credentials or private keys.

Here is the smallest useful ConfigMap for that one setting:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-api-config
  namespace: customer-notifications
data:
  LOG_LEVEL: "info"
```

The Pod can then ask Kubernetes to put that key into the process environment:

```yaml
env:
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: notification-api-config
        key: LOG_LEVEL
```

Every value under `data` reaches the container as a string. `LOG_LEVEL` already looks like a string, and a value such as `RETRY_LIMIT: "5"` would still arrive as a string. The application should parse and validate those values when it starts so a bad ConfigMap stops a broken Pod early.

## What a ConfigMap Stores
<!-- section-summary: ConfigMaps store small pieces of non-confidential runtime configuration, not credentials or large application data. -->

A ConfigMap stores named values in a namespace. The common field is **data**, where each key maps to a UTF-8 string. Kubernetes also supports **binaryData** for bytes represented with base64, but most application configuration uses ordinary strings.

Good ConfigMap values include log levels, feature flags, queue names, public service URLs, timeout values, and small config files. The Customer Notification Platform might use `SENDGRID_REGION`, `MAX_BATCH_SIZE`, `RETRY_BACKOFF_MS`, and `TEMPLATE_BUCKET_NAME` in a ConfigMap.

Sensitive values belong somewhere else. `SMTP_PASSWORD`, `WEBHOOK_SIGNING_KEY`, private TLS keys, database passwords, and cloud credentials should use a Kubernetes Secret or an external secret manager. A ConfigMap gives you reviewable configuration, not a secrecy boundary.

ConfigMaps are also small. Kubernetes documents a 1 MiB limit for each ConfigMap, so treat it as application settings, not a place for a large policy bundle, user data, generated reports, or a feature flag database.

## The Notification Platform Scenario
<!-- section-summary: One tested container image can run in several environments while each namespace supplies its own ConfigMap. -->

Imagine two Deployments in the Customer Notification Platform. `notification-api` accepts customer requests, validates them, and writes work to a queue. `notification-worker` reads from the queue and sends email, SMS, or push notifications through provider integrations.

The same `notification-api` image can move from staging to production. Staging uses verbose logs and a sandbox email gateway. Production uses quieter logs and the real internal gateway. A ConfigMap lets those runtime choices live beside the workload manifests instead of inside the image.

![ConfigMap runtime boundary](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-configmaps/configmap-runtime-boundary.png)

*The image should carry application code, while the namespace supplies plain runtime settings through a ConfigMap.*

This separation gives the team two clean review paths. Image changes go through build and release review. Runtime configuration changes go through manifest, Helm, Kustomize, or GitOps review. The production consequence is simpler rollback: you can roll back a bad setting without rebuilding the image.

## Create One, Then Inspect It
<!-- section-summary: kubectl can generate ConfigMap YAML for quick learning, but shared environments should apply reviewed manifests. -->

`kubectl create configmap` is useful while learning or generating a starting manifest. The `--dry-run=client -o yaml` flags print YAML instead of creating the object in the cluster.

```bash
kubectl create configmap notification-api-config \
  --namespace customer-notifications \
  --from-literal=LOG_LEVEL=info \
  --from-literal=EMAIL_PROVIDER_URL=http://email-gateway.customer-notifications.svc.cluster.local:8080 \
  --dry-run=client \
  -o yaml
```

A short output looks like this:

```console
apiVersion: v1
data:
  EMAIL_PROVIDER_URL: http://email-gateway.customer-notifications.svc.cluster.local:8080
  LOG_LEVEL: info
kind: ConfigMap
metadata:
  name: notification-api-config
  namespace: customer-notifications
```

For a shared cluster, put that shape in source control and apply it from a reviewed file. The command below sends the manifest to the API server and then asks Kubernetes to show the stored object.

```bash
kubectl apply -f k8s/customer-notifications/notification-api-configmap.yaml
kubectl get configmap notification-api-config -n customer-notifications
```

The second command should show the object with the number of keys Kubernetes stored:

```console
NAME                      DATA   AGE
notification-api-config   2      14s
```

That `DATA` column counts top-level keys, not bytes or nested fields. If you expected five settings and the output says two, inspect the manifest before wiring the object into a Pod.

## Wire Specific Keys into a Container
<!-- section-summary: Explicit key references document the exact ConfigMap keys a container needs and fail clearly when required keys are missing. -->

A **configMapKeyRef** tells Kubernetes to put one ConfigMap key into one environment variable. This explicit style is longer than bulk import, and the extra lines are useful during review.

Start with one key. The fragment below says that the container environment variable `LOG_LEVEL` should come from the `LOG_LEVEL` key in `notification-api-config`.

```yaml
env:
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: notification-api-config
        key: LOG_LEVEL
```

Then add the second key. The container reads `EMAIL_PROVIDER_URL`, while the ConfigMap remains the source of the value.

```yaml
env:
  - name: EMAIL_PROVIDER_URL
    valueFrom:
      configMapKeyRef:
        name: notification-api-config
        key: EMAIL_PROVIDER_URL
```

If the ConfigMap or key is missing, Kubernetes will not start the container by default. That fail-fast behavior protects production from a Pod that silently uses a fallback URL or an unsafe default.

You can mark a key as optional:

```yaml
env:
  - name: EXPERIMENTAL_SMS_ROUTE
    valueFrom:
      configMapKeyRef:
        name: notification-api-config
        key: EXPERIMENTAL_SMS_ROUTE
        optional: true
```

Use optional references only when the application has a reviewed default. For `notification-api`, an optional experiment flag can default to disabled. `EMAIL_PROVIDER_URL` should stay required because the API cannot send work to the correct provider gateway without it.

## Use envFrom Only for Dedicated ConfigMaps
<!-- section-summary: envFrom copies many keys at once, which is convenient when one ConfigMap belongs to one container contract. -->

**envFrom** copies every valid key from a ConfigMap into the container environment. It works well when the ConfigMap exists only for one container and every key should enter the process.

```yaml
envFrom:
  - configMapRef:
      name: notification-api-config
```

The hidden cost is review clarity. If someone adds `DEBUG_PAYMENT_CALLBACKS` to the ConfigMap later, `envFrom` sends it into the container automatically. That can be fine for a dedicated ConfigMap and risky for a shared one.

Kubernetes also ignores invalid environment variable names from `envFrom` and reports an event. A key such as `email-provider-url` works as ConfigMap data, but it is not a valid shell-style environment variable name. Use uppercase names with underscores when the ConfigMap will feed environment variables.

## Mount a ConfigMap as Files
<!-- section-summary: ConfigMap volumes turn keys into files for applications and tools that expect configuration on disk. -->

Some programs want files instead of environment variables. A worker might read provider routing rules from `/etc/notification/routing.yaml`, or a sidecar might need a small config file at a known path.

A ConfigMap can expose each key as a file. First, store a file-like value under one key:

```yaml
data:
  routing.yaml: |
    defaultChannel: email
    providers:
      email: internal-email-gateway
      sms: internal-sms-gateway
```

Then mount the ConfigMap as a volume:

```yaml
volumes:
  - name: notification-routing
    configMap:
      name: notification-routing-config
containers:
  - name: worker
    volumeMounts:
      - name: notification-routing
        mountPath: /etc/notification
        readOnly: true
```

Inside the container, Kubernetes presents `/etc/notification/routing.yaml`. The application reads a normal file, while the platform team keeps the file content in a reviewable Kubernetes object.

![ConfigMap delivery options](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-configmaps/configmap-delivery-options.png)

*A ConfigMap can feed a Pod through explicit environment variables, bulk environment import, or mounted files.*

Mounted files have a practical advantage for structured config. Multi-line YAML, JSON, Nginx snippets, and provider routing tables are easier to review as files than as dozens of environment variables.

## How Updates Reach Running Pods
<!-- section-summary: Environment variables stay fixed until restart, while mounted ConfigMap files can update after kubelet refreshes the volume. -->

ConfigMap updates do not affect every delivery path the same way. Environment variables are read when the container starts. If you change `LOG_LEVEL` in a ConfigMap, a running `notification-api` process keeps the old environment until the Pod restarts.

Mounted ConfigMap files can refresh in a running Pod. Kubernetes updates the projected volume after the kubelet notices the changed object and refreshes the mounted content. The practical result is not instant delivery, and applications still need a reload mechanism if they should react without a restart.

The safe operational habit is to restart Deployments after important ConfigMap changes unless the application explicitly watches and reloads the mounted file.

```bash
kubectl rollout restart deployment/notification-api -n customer-notifications
kubectl rollout status deployment/notification-api -n customer-notifications
```

A healthy rollout status looks like this:

```console
deployment "notification-api" successfully rolled out
```

Do not mount a ConfigMap file with `subPath` when you expect live refresh. Kubernetes documentation calls out that `subPath` mounts do not receive ConfigMap updates. Use a full directory mount for reloadable config, or restart Pods after changing the object.

## Immutable ConfigMaps
<!-- section-summary: Immutable ConfigMaps protect reviewed configuration from in-place edits and encourage versioned rollouts. -->

An **immutable ConfigMap** cannot be changed after creation. You set `immutable: true`, and Kubernetes rejects updates to the data. That sounds strict, and the strictness is useful for production configuration that should move through versioned releases.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-api-config-v2026-06-28
  namespace: customer-notifications
immutable: true
data:
  LOG_LEVEL: "info"
  EMAIL_PROVIDER_URL: "http://email-gateway.customer-notifications.svc.cluster.local:8080"
```

With immutable ConfigMaps, a change creates a new object name. The Deployment references the new name, and the rollout tells you exactly which Pods use which configuration version.

The tradeoff is cleanup. Old ConfigMaps stay in the namespace until a release job, GitOps prune, or platform cleanup process removes unused versions. That cleanup should check that no live Pods still reference the old name.

## Kustomize, Helm, and GitOps Workflows
<!-- section-summary: Real teams usually generate or template ConfigMaps so each environment keeps the same contract with different values. -->

Most teams do not hand-edit every ConfigMap in every namespace. They use a workflow that keeps the application contract stable and changes only environment values.

Kustomize can generate ConfigMaps from files or literals and add a hash suffix when content changes. That suffix naturally triggers a Deployment rollout when the Pod template references the generated name. The useful detail is the hash: a changed value creates a changed object name, and Kubernetes sees a changed Pod template.

Helm usually templates ConfigMaps from `values.yaml`. That gives one chart a shared shape and lets staging and production provide different values. Helm users should keep Secrets separate from ConfigMaps, even when both values appear in the same `values.yaml` tree.

GitOps controllers such as Argo CD or Flux apply the reviewed state from Git. With ConfigMaps, GitOps works best when the cluster can recreate a namespace from committed files and known generators. One-off terminal changes create drift, and drift makes incident recovery slower.

## Validate and Troubleshoot
<!-- section-summary: ConfigMap problems usually show up as missing keys, invalid env names, stale Pods, or application startup validation errors. -->

A good ConfigMap workflow includes both Kubernetes checks and application checks. Kubernetes can tell you whether the object exists and whether a Pod references it correctly. The application should tell you whether the values make sense for its own startup contract.

Start with the object:

```bash
kubectl describe configmap notification-api-config -n customer-notifications
```

Useful output includes the keys and events related to the object:

```console
Name:         notification-api-config
Namespace:    customer-notifications
Data
====
EMAIL_PROVIDER_URL:
----
http://email-gateway.customer-notifications.svc.cluster.local:8080
LOG_LEVEL:
----
info
```

Then check the Pod events when a container refuses to start:

```bash
kubectl describe pod notification-api-7c9b7f6d9d-2ftlz -n customer-notifications
```

If a required key is missing, the event names the ConfigMap and key. Fix the object or the reference, then restart the Deployment so the new environment reaches the process.

For application validation, log a safe startup summary without printing secrets or huge config blobs. `notification-api` can log `LOG_LEVEL=info`, `EMAIL_PROVIDER_URL host=email-gateway...`, and `config source=notification-api-config`. That gives operators enough context without turning logs into a config dump.

## Assembled Example
<!-- section-summary: After the pieces are clear, the full example shows a ConfigMap wired into a Deployment with explicit keys. -->

Here is the full pattern assembled after the individual pieces. The ConfigMap holds plain settings, and the Deployment asks for each required key by name.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-api-config
  namespace: customer-notifications
data:
  LOG_LEVEL: "info"
  EMAIL_PROVIDER_URL: "http://email-gateway.customer-notifications.svc.cluster.local:8080"
  REQUEST_TIMEOUT_MS: "2500"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: customer-notifications
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/customer-notifications/notification-api:1.8.0
          env:
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: notification-api-config
                  key: LOG_LEVEL
            - name: EMAIL_PROVIDER_URL
              valueFrom:
                configMapKeyRef:
                  name: notification-api-config
                  key: EMAIL_PROVIDER_URL
            - name: REQUEST_TIMEOUT_MS
              valueFrom:
                configMapKeyRef:
                  name: notification-api-config
                  key: REQUEST_TIMEOUT_MS
```

This example keeps the full manifest small enough to review. A real Deployment would also include probes, resource requests, security context, and rollout settings, but those belong to the workload article rather than the ConfigMap contract.

## Review Checklist
<!-- section-summary: A production ConfigMap review checks sensitivity, naming, delivery path, rollout behavior, and recovery. -->

Use this checklist before merging a ConfigMap change:

| Check | What to confirm |
|---|---|
| Sensitivity | No password, token, private key, or secret endpoint credential appears in the ConfigMap |
| Contract | The keys match what `notification-api` or `notification-worker` validates at startup |
| Delivery path | Required keys use explicit `configMapKeyRef`, while `envFrom` is reserved for dedicated ConfigMaps |
| Rollout | The release plan restarts Pods or uses a reload mechanism for mounted files |
| Namespaces | Staging and production values live in their own namespaces |
| Recovery | The object can be recreated from Git, Helm, Kustomize, or a documented pipeline |

![ConfigMap production review flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-configmaps/configmap-production-review-flow.png)

*A strong ConfigMap review follows the value from source control into the Pod and then through rollout and recovery.*

**References**

- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Configure Pods to use ConfigMaps](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/)
- [Define environment variables for a container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/)
