---
title: "Environment Variables"
description: "Pass Kubernetes runtime configuration into containers through clear, validated environment variables."
overview: "Environment variables are the startup contract between a Pod spec and the process inside the container, so they need careful sources, validation, and rollout behavior."
tags: ["kubernetes", "environment", "configmaps", "secrets"]
order: 3
id: article-containers-orchestration-kubernetes-configuration-storage-environment-variables
---
## Table of Contents

1. [Startup Values Delivered Key by Key](#startup-values-delivered-key-by-key)
2. [The Environment as a Startup Contract](#the-environment-as-a-startup-contract)
3. [Literal Values in a Pod Template](#literal-values-in-a-pod-template)
4. [ConfigMap and Secret Sources](#configmap-and-secret-sources)
5. [Explicit env and Bulk envFrom](#explicit-env-and-bulk-envfrom)
6. [Variable Expansion](#variable-expansion)
7. [Pod Metadata Through the Downward API](#pod-metadata-through-the-downward-api)
8. [Validation in Application Code](#validation-in-application-code)
9. [Rollouts and Changed Values](#rollouts-and-changed-values)
10. [Troubleshooting Startup Errors](#troubleshooting-startup-errors)
11. [Assembled Example](#assembled-example)
12. [Review Checklist](#review-checklist)
13. [References](#references)

## Startup Values Delivered Key by Key
<!-- section-summary: Environment variables are the named startup values Kubernetes places into a container process. -->

ConfigMaps and Secrets give runtime values a source object. Environment variables are one common way to deliver selected keys from those objects into the process. The container starts, the application reads named strings such as `LOG_LEVEL`, `DATABASE_URL`, or `REQUEST_TIMEOUT_MS`, and startup validation decides whether the process is safe to run.

An **environment variable** is a named string placed into the container process when it starts. It can come from a literal value in the Pod template, a selected ConfigMap key, a selected Secret key, or selected Pod metadata. The source matters because ordinary settings, sensitive values, and platform metadata have different review and security expectations.

In the Customer Notification Platform, environment variables form the startup contract between the manifests and the `notification-api` or `notification-worker` code. The manifest promises to provide names. The code promises to parse and validate those names before serving traffic or consuming queued work.

A direct value makes the startup behavior visible. At process launch, the `notification-api` binary reads `LOG_LEVEL`, configures logging, and then opens its HTTP listener. The value must exist before startup finishes.

Here is the smallest useful fragment. It gives the `notification-api` container one safe literal value.

```yaml
env:
  - name: LOG_LEVEL
    value: "info"
```

This fragment keeps the contract small:

- `name: LOG_LEVEL` is the key the application reads during startup.
- `value: "info"` is the literal string Kubernetes places into the process environment.

The container receives `LOG_LEVEL=info` when it starts. If the Pod keeps running for three days, that process keeps the same value for three days unless the application changes it internally. Kubernetes leaves the running process environment alone after startup.

## The Environment as a Startup Contract
<!-- section-summary: Environment variables form a contract between the Kubernetes manifest and the application startup code. -->

The Customer Notification Platform has two main workloads. `notification-api` accepts customer requests and writes work to a queue. `notification-worker` consumes queued jobs and sends email, SMS, or push notifications through provider integrations.

Each container needs a small startup contract. `notification-api` needs `PORT`, `LOG_LEVEL`, `DATABASE_URL`, and `REQUEST_TIMEOUT_MS`. `notification-worker` needs `QUEUE_NAME`, `MAX_BATCH_SIZE`, provider credentials, and retry settings.

The contract has two sides. The Kubernetes manifest supplies names and values. The application startup code reads those names, parses strings into the right types, and fails with a clear message when a required value is missing or invalid.

![Environment startup contract](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-environment-variables/environment-startup-contract.png)

*The Pod spec supplies named strings, and the application startup code validates them before serving traffic.*

This startup contract keeps accidental defaults out of production. A notification system should not quietly switch to a sandbox provider, retry forever, or listen on the wrong port after a missing environment variable.

## Literal Values in a Pod Template
<!-- section-summary: Literal env values fit small, non-secret settings that belong directly to one workload. -->

A **literal env value** is written directly in the Pod template. Use it for simple non-secret settings that are tightly tied to the workload and unlikely to vary through a shared configuration object.

Literal values are the shortest delivery path because the Pod template itself is the source. That works for small constants that belong to the workload shape, such as a metrics path or fixed container port. For the notification API, reviewers can see the value right next to the container definition, and no separate ConfigMap has to be created for a setting that rarely changes.

```yaml
env:
  - name: PORT
    value: "8080"
  - name: METRICS_PATH
    value: "/metrics"
```

These literals belong to the workload shape:

- `PORT` matches the port the process should bind inside the container.
- `METRICS_PATH` gives monitoring tools a stable endpoint path without creating a separate ConfigMap.

Literal values are easy to read during review. The limitation is reuse. If staging and production need different values, a ConfigMap or Helm/Kustomize value usually gives a cleaner environment-specific path.

Never put credentials in literal environment values. A literal `DATABASE_URL` with a password would appear in Deployment YAML, review tools, cluster API output, and possibly debug snapshots. Use a Secret reference for sensitive values.

## ConfigMap and Secret Sources
<!-- section-summary: valueFrom pulls one environment variable from a ConfigMap, Secret, or Pod metadata source. -->

**valueFrom** tells Kubernetes to fill an environment variable from another source. For plain configuration, use `configMapKeyRef`. For credentials, use `secretKeyRef`.

This path separates the source object from the delivery into the process. The ConfigMap or Secret stores the value under a named key, and the Pod template chooses which key should fill which environment variable. That gives ordinary settings and sensitive values different review boundaries while the application still reads simple startup names.

For the worker, this means `QUEUE_NAME` can be reviewed openly while `EMAIL_PROVIDER_TOKEN` follows the tighter Secret path.

Pull `QUEUE_NAME` from a ConfigMap:

```yaml
env:
  - name: QUEUE_NAME
    valueFrom:
      configMapKeyRef:
        name: notification-worker-config
        key: QUEUE_NAME
```

The ConfigMap reference has a narrow job:

- `name: QUEUE_NAME` names the environment variable inside the process.
- `configMapKeyRef.name` points to the ConfigMap source object.
- `configMapKeyRef.key` selects one key from that object.
- Missing required keys stop container startup, which is safer than silently using a wrong queue.

Pull `EMAIL_PROVIDER_TOKEN` from a Secret:

```yaml
env:
  - name: EMAIL_PROVIDER_TOKEN
    valueFrom:
      secretKeyRef:
        name: notification-worker-secrets
        key: EMAIL_PROVIDER_TOKEN
```

The Secret reference has a tighter review boundary:

- The Deployment shows that the worker needs `EMAIL_PROVIDER_TOKEN`.
- The token value stays in the Secret source path and should not appear in normal manifest review.

The separation is important in review. ConfigMap references should point to values that can be read openly. Secret references should point to values where read access is limited and rotation is planned.

![Environment source map](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-environment-variables/environment-source-map.png)

*Environment variables can come from literals, ConfigMaps, Secrets, and Pod metadata, and each source has a different review boundary.*

When a referenced ConfigMap or Secret key is missing, the container fails before startup unless the reference is marked optional. Required references are the safer default for production. Optional references fit feature flags where the application has an intentional fallback.

## Explicit env and Bulk envFrom
<!-- section-summary: Explicit env references are clearer, while envFrom is compact for one-purpose ConfigMaps or Secrets. -->

The **env** list maps each variable one at a time. It gives reviewers a precise view of the container contract and makes accidental extra values less likely.

Use explicit entries for the values that define whether the process can start safely. A worker that needs `MAX_BATCH_SIZE`, `QUEUE_NAME`, and one provider token should show those names directly in the manifest. That makes the contract clear to the application team, the platform reviewer, and the person debugging a failed rollout at the Pod event level.

```yaml
env:
  - name: MAX_BATCH_SIZE
    valueFrom:
      configMapKeyRef:
        name: notification-worker-config
        key: MAX_BATCH_SIZE
```

This explicit entry records one required setting:

- The worker receives `MAX_BATCH_SIZE` at startup.
- A missing ConfigMap key stops the container before it processes work with an unsafe default.

The **envFrom** field imports all valid keys from a ConfigMap or Secret. It is compact when one object exists only to feed one container.

```yaml
envFrom:
  - configMapRef:
      name: notification-worker-config
```

This bulk delivery path needs a clear contract:

- Every valid key in `notification-worker-config` can enter the process environment.
- The source object should belong to this one workload, not a shared grab bag of settings.
- Secret bulk imports need extra review because future Secret keys would enter the process automatically.

With Secrets, `envFrom` deserves extra review. If a teammate adds a new credential key to the Secret, the container receives it automatically. For sensitive values, explicit `secretKeyRef` usually creates a cleaner review trail.

Kubernetes skips keys that are invalid environment variable names and records an event. A ConfigMap key named `retry-limit` can exist as data, but `envFrom` will skip it during environment delivery. Prefer names such as `RETRY_LIMIT` when environment delivery is the plan.

## Variable Expansion
<!-- section-summary: Kubernetes can expand previously defined environment variables inside later values using the $(NAME) syntax. -->

Kubernetes supports simple expansion in environment variable values. A later variable can reference an earlier variable with `$(NAME)`.

Expansion is a small convenience for derived startup strings. It keeps related values in one place when a URL or path is assembled from a base name. The important constraint is that Kubernetes expands values before the process starts, using variables that already appeared earlier in the list. It is not a runtime templating system inside the application.

Use it for small derived strings that reviewers can understand in the Pod template, not for large or sensitive configuration.

```yaml
env:
  - name: SERVICE_HOST
    value: "notification-api.customer-notifications.svc.cluster.local"
  - name: HEALTH_URL
    value: "http://$(SERVICE_HOST):8080/healthz"
```

The derived value depends on order:

- `SERVICE_HOST` appears before `HEALTH_URL`, so Kubernetes can substitute it.
- The expanded `HEALTH_URL` is still a startup string, not a live template inside the application.

The order matters. `SERVICE_HOST` appears first, so Kubernetes can expand it in `HEALTH_URL`. If a name is unknown, Kubernetes leaves the reference unresolved in the value.

Expansion fits small derived values. Large structured configuration belongs in mounted files, especially when the app needs routing rules that reviewers should read and test as YAML or JSON.

## Pod Metadata Through the Downward API
<!-- section-summary: The Downward API exposes selected Pod and container metadata as environment variables without hardcoding it in the manifest. -->

The **Downward API** exposes selected Kubernetes metadata to the container. It can provide the Pod name, namespace, labels, annotations, node name, and some resource information.

This delivery path is useful when the application needs to describe where it is running. The Pod name and namespace are assigned by Kubernetes, so hardcoding them in an image or ConfigMap would age badly. By pulling metadata through `fieldRef`, each replica can log its own identity and support teams can connect application logs back to Kubernetes objects.

`notification-api` can use the Pod name and namespace in logs:

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
```

The Downward API example has two important parts:

- `fieldRef.fieldPath: metadata.name` reads the live Pod name assigned by Kubernetes.
- `fieldRef.fieldPath: metadata.namespace` reads the namespace where the Pod is running.
- The application can log those values without baking a namespace or Pod name into the image.

The application can include those values in structured logs:

```console
level=info service=notification-api pod=notification-api-7d875d8cc5-s4vfx namespace=customer-notifications
```

This helps support teams connect an application log line to a Kubernetes Pod. It also avoids hardcoding the namespace in the image or application config.

Resource requests can also be exposed, which is useful when a worker chooses concurrency from its CPU or memory limit:

```yaml
env:
  - name: CPU_LIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.cpu
```

This resource reference comes from the Pod's own container limits:

- `resourceFieldRef.resource` selects the resource value Kubernetes should expose.
- The application should still clamp any concurrency choice with its own maximum setting.

Keep resource-based behavior conservative. A worker that auto-scales concurrency from CPU limits should still have a maximum value in normal configuration so a manifest mistake cannot create too much provider traffic.

## Validation in Application Code
<!-- section-summary: Kubernetes can inject strings, while the application must validate required names, types, ranges, and safe defaults. -->

Kubernetes injects strings without understanding the business meaning. The application must know that `MAX_BATCH_SIZE` is an integer and that `REQUEST_TIMEOUT_MS` should stay under five seconds, then handle type parsing and business validation.

Validation is the application side of the startup contract. Kubernetes can prove that a key exists, but it cannot know whether `MAX_BATCH_SIZE=ten` is wrong for the worker or whether a timeout is too large for provider calls. The process should check required names, parse types, enforce ranges, and exit with a safe message before accepting traffic.

Good startup validation checks four things:

| Check | Example |
|---|---|
| Required names | `DATABASE_URL` and `QUEUE_NAME` must exist |
| Type parsing | `MAX_BATCH_SIZE` parses as an integer |
| Range | `MAX_BATCH_SIZE` stays between `1` and `500` |
| Allowed values | `LOG_LEVEL` is one of `debug`, `info`, `warn`, `error` |

The error message should name the variable and the expected shape without printing secrets. A safe startup error might say:

```console
configuration error: MAX_BATCH_SIZE must be an integer from 1 to 500
```

For `DATABASE_URL`, avoid printing the full value. A safe error can say `DATABASE_URL is required` or `DATABASE_URL host is invalid`, while leaving the password out of logs.

## Rollouts and Changed Values
<!-- section-summary: Environment variable changes require new Pods because running processes keep the values they started with. -->

A running process keeps the environment it received at startup. If you update a ConfigMap or Secret referenced by environment variables, existing Pods keep the old values.

This behavior shapes the release plan. Changing the source object alone updates Kubernetes data, but the process environment inside existing containers stays the same. The team needs a rollout so new Pods receive the new startup contract. For the notification worker, that means queue names, batch sizes, and tokens all move together through a visible Deployment rollout.

Restart the Deployment after changing environment-backed configuration:

```bash
kubectl rollout restart deployment/notification-worker -n customer-notifications
kubectl rollout status deployment/notification-worker -n customer-notifications
```

The output should confirm the new Pods reached a healthy state:

```console
deployment "notification-worker" successfully rolled out
```

Helm, Kustomize, and GitOps workflows often add a checksum annotation to the Pod template. When a ConfigMap or Secret changes, the annotation changes, the Pod template changes, and Kubernetes performs a normal rollout. That gives configuration changes the same visibility as image changes.

![Environment rollout flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-environment-variables/environment-rollout-flow.png)

*Environment-backed configuration changes should move through a rollout so every Pod receives the new startup contract.*

## Troubleshooting Startup Errors
<!-- section-summary: Environment variable problems show up as Pod events, CreateContainerConfigError, skipped envFrom keys, or application startup failures. -->

When Kubernetes cannot resolve a required environment reference, the Pod may show `CreateContainerConfigError`. Pod events usually explain that wiring failure before application logs have anything useful to say.

The event path is usually faster than guessing from application logs. If kubelet cannot build the container configuration, the process never starts, so the error sits in Pod status and events. After Kubernetes references are resolved, application startup validation handles the next layer: wrong type, invalid range, unsafe default, or a missing business-specific value.

That order keeps the debug path clean: Kubernetes wiring first, then application parsing and business validation. A `kubectl describe pod` command shows the events for the failing Pod:

```bash
kubectl describe pod notification-worker-845b9c47b5-nx7t9 -n customer-notifications
```

A missing ConfigMap key can look like this:

```console
Warning  Failed  kubelet  Error: couldn't find key MAX_BATCH_SIZE in ConfigMap customer-notifications/notification-worker-config
```

After the Pod starts, inspect safe environment values from a non-production Pod or a temporary debugging environment:

```bash
kubectl exec deploy/notification-worker -n customer-notifications -- printenv LOG_LEVEL QUEUE_NAME
```

Sample output:

```console
info
notifications.outbound
```

Avoid printing all environment variables in production. A full `printenv` can expose tokens, database URLs, and provider credentials.

## Assembled Example
<!-- section-summary: The complete example combines ConfigMap values, Secret values, Downward API metadata, and application validation expectations. -->

Here is the full environment variable pattern after the pieces are clear. Plain settings come from a ConfigMap, credentials come from a Secret, and Pod metadata comes from the Downward API.

The assembled manifest shows the three source lanes feeding one process. The ConfigMap supplies reviewable worker settings, the Secret supplies sensitive provider access, and the Downward API supplies live Pod identity. Keeping those lanes separate helps the team change a timeout, rotate a token, or trace one replica without mixing all values into one source.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-worker
  namespace: customer-notifications
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-worker
  template:
    metadata:
      labels:
        app: notification-worker
    spec:
      containers:
        - name: worker
          image: ghcr.io/customer-notifications/notification-worker:1.8.0
          env:
            - name: QUEUE_NAME
              valueFrom:
                configMapKeyRef:
                  name: notification-worker-config
                  key: QUEUE_NAME
            - name: MAX_BATCH_SIZE
              valueFrom:
                configMapKeyRef:
                  name: notification-worker-config
                  key: MAX_BATCH_SIZE
            - name: EMAIL_PROVIDER_TOKEN
              valueFrom:
                secretKeyRef:
                  name: notification-worker-secrets
                  key: EMAIL_PROVIDER_TOKEN
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
```

The complete manifest keeps each source lane separate:

- ConfigMap keys supply plain worker settings such as queue name and batch size.
- Secret keys supply sensitive provider access.
- Downward API fields supply live Pod metadata for logging and support.

This manifest is only the Kubernetes side of the contract. The worker still needs startup validation so `MAX_BATCH_SIZE` is parsed safely and credentials never print in logs.

## Review Checklist
<!-- section-summary: Environment variable reviews should check sensitivity, source, validation, restart behavior, and diagnostic safety. -->

Use this checklist before merging an environment variable change:

The checklist is a compact review of the whole startup contract. It asks whether each value has the right source, whether sensitive values stay out of plain YAML, whether the application validates what Kubernetes injects, and whether the rollout plan refreshes running Pods. The diagnostic line matters because `printenv` can reveal much more than the one value a support person meant to inspect.

For the notification worker, that review should cover queue names, batch limits, provider tokens, and metadata values together.

| Check | What to confirm |
|---|---|
| Sensitivity | Secrets use `secretKeyRef`, not literals or ConfigMaps |
| Source | Plain settings come from literals or ConfigMaps with clear ownership |
| Names | Environment variable names are valid and consistent |
| Validation | The application validates required values, types, ranges, and allowed values |
| Rollout | The release process restarts Pods after environment-backed changes |
| Diagnostics | Support commands avoid printing every environment variable in production |

## References

- [Define environment variables for a container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/)
- [Define dependent environment variables](https://kubernetes.io/docs/tasks/inject-data-application/define-interdependent-environment-variables/)
- [Expose Pod information through environment variables](https://kubernetes.io/docs/tasks/inject-data-application/environment-variable-expose-pod-information/)
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
