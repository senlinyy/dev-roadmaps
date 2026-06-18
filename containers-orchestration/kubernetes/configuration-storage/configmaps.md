---
title: "ConfigMaps"
description: "Use ConfigMaps to move non-secret Kubernetes application configuration out of container images and into reviewable objects."
overview: "ConfigMaps keep plain environment-specific settings beside your workload manifests so the same image can run safely in different Kubernetes environments."
tags: ["kubernetes", "configmaps", "configuration", "deployments"]
order: 1
id: article-containers-orchestration-kubernetes-configuration-storage-configmaps
---

## Table of Contents

1. [What a ConfigMap Stores](#what-a-configmap-stores)
2. [Configuration Outside the Image](#configuration-outside-the-image)
3. [Creating ConfigMaps from Literals and Manifests](#creating-configmaps-from-literals-and-manifests)
4. [Wiring Specific Keys into Environment Variables](#wiring-specific-keys-into-environment-variables)
5. [Using envFrom Carefully](#using-envfrom-carefully)
6. [Mounting ConfigMaps as Files](#mounting-configmaps-as-files)
7. [How Updates Reach Running Pods](#how-updates-reach-running-pods)
8. [Immutable ConfigMaps](#immutable-configmaps)
9. [Kustomize and Helm Workflows](#kustomize-and-helm-workflows)
10. [Validation and Troubleshooting](#validation-and-troubleshooting)
11. [Review Checklist](#review-checklist)

## What a ConfigMap Stores
<!-- section-summary: A ConfigMap stores plain, non-confidential settings that a Pod can read as environment variables, command arguments, or files. -->

A **ConfigMap** is a namespaced Kubernetes API object for plain application configuration. It stores key-value data that other objects, usually Pods, can consume at runtime. Plain configuration means values your team can review in normal pull requests: log levels, feature flags, public service URLs, timeout values, queue names, and small config files.

For this article, imagine a Kubernetes application called `devpolaris-orders-api`. The same container image runs in staging and production. Staging uses `LOG_LEVEL=debug`, points at a staging catalog service, and keeps the refunds feature disabled. Production uses `LOG_LEVEL=info`, points at the production catalog service, and enables refunds after the feature has passed testing. The application code stays the same, while the runtime settings change by environment.

The important boundary is **confidentiality**. A ConfigMap is for values that can appear in YAML, review comments, `kubectl describe` output, and support tickets. A database password, API token, signing key, private certificate key, or cloud credential belongs in a Secret or an external secret manager. The next article covers that sensitive side of the same `devpolaris-orders-api` deployment.

Kubernetes ConfigMaps usually store UTF-8 strings under `data`. They can also store binary data under `binaryData`, where values are base64-encoded. For normal application configuration, `data` is the common path. Kubernetes also sets a size limit of 1 MiB per ConfigMap, so use it as a small configuration object rather than a database, object storage bucket, or large policy bundle.

ConfigMaps are namespaced. A Pod in `devpolaris-staging` references a ConfigMap in `devpolaris-staging`. A Pod in `devpolaris-prod` references a different ConfigMap in `devpolaris-prod`, even when both objects share the same name. That namespace boundary helps each environment carry its own settings.

## Configuration Outside the Image
<!-- section-summary: Moving configuration outside the image lets one tested container image run across environments with different runtime settings. -->

A container image should carry the application code and its dependencies. The image for `devpolaris-orders-api` might contain the compiled Node.js service, package dependencies, startup script, and health endpoint. It should avoid a rebuild every time a timeout changes from `2000` to `3000`, or every time a feature flag changes in staging.

This matters in production because teams usually promote one image through environments. The image `ghcr.io/devpolaris/orders-api:1.18.0` can go from a development namespace to staging and then to production. Each environment supplies its own ConfigMap. That gives you two review paths: image changes go through the build pipeline, and runtime configuration changes go through the Kubernetes manifest or release pipeline.

The staging ConfigMap for the orders API keeps the first set of plain runtime values together. The keys are intentionally small and safe for normal review:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config
  namespace: devpolaris-staging
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/component: api
data:
  PORT: "8080"
  LOG_LEVEL: "debug"
  FEATURE_REFUNDS: "false"
  CATALOG_API_URL: "http://catalog-api.devpolaris-staging.svc.cluster.local:8080"
  CHECKOUT_TIMEOUT_MS: "3000"
```

Every value under `data` reaches the application as a string. `PORT`, `FEATURE_REFUNDS`, and `CHECKOUT_TIMEOUT_MS` look like a number, boolean, and number, but the container receives strings. The application should parse those values at startup and fail with a clear error when the value is missing or invalid. That startup check catches a bad ConfigMap before the Pod starts serving traffic.

The production ConfigMap can keep the same keys and change the values. That keeps the application contract stable while each namespace supplies environment-specific settings:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config
  namespace: devpolaris-prod
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/component: api
data:
  PORT: "8080"
  LOG_LEVEL: "info"
  FEATURE_REFUNDS: "true"
  CATALOG_API_URL: "http://catalog-api.devpolaris-prod.svc.cluster.local:8080"
  CHECKOUT_TIMEOUT_MS: "2500"
```

The container image stayed the same. The Deployment and the ConfigMap decide how that image behaves in each namespace. This is the everyday value of ConfigMaps: the software artifact stays portable, and environment-specific choices stay visible in Kubernetes configuration.

## Creating ConfigMaps from Literals and Manifests
<!-- section-summary: Literals help with quick experiments, while manifests make configuration reviewable and repeatable. -->

Kubernetes gives you two common ways to create a ConfigMap. You can create one directly with `kubectl` from literal values or files, and you can write a YAML manifest that lives in your deployment source. Both create the same kind of API object, but they fit different moments in the workflow.

Literals are useful when you are learning, debugging, or preparing a manifest from known values. The command below creates YAML without writing to the cluster because `--dry-run=client -o yaml` prints the object, which gives the team a reviewable starting point:

```bash
kubectl create configmap orders-api-config \
  --namespace devpolaris-staging \
  --from-literal=PORT=8080 \
  --from-literal=LOG_LEVEL=debug \
  --from-literal=FEATURE_REFUNDS=false \
  --from-literal=CATALOG_API_URL=http://catalog-api.devpolaris-staging.svc.cluster.local:8080 \
  --from-literal=CHECKOUT_TIMEOUT_MS=3000 \
  --dry-run=client \
  -o yaml
```

That generated output can help you build the committed manifest. In production, the manifest usually lives next to the Deployment so reviewers can see the application and its plain configuration together, then apply the same reviewed shape in each environment:

```bash
kubectl apply -f k8s/staging/orders-api-configmap.yaml
kubectl get configmap orders-api-config -n devpolaris-staging -o yaml
```

Files are another common input. If the orders API reads a small YAML file at startup, you can create a ConfigMap from that file:

```bash
kubectl create configmap orders-api-file-config \
  --namespace devpolaris-staging \
  --from-file=orders.yaml=./config/staging/orders.yaml \
  --dry-run=client \
  -o yaml
```

Kubernetes uses `orders.yaml` as the key and the file content as the value. This is helpful when the application already expects a config file. It also keeps multi-line configuration readable, because the manifest can show the file as a block under one key.

Most teams settle on a simple rule. Literals fit fast local experiments and generated YAML. Committed manifests, Kustomize overlays, Helm templates, or a GitOps tool fit shared environments. The cluster should be able to lose and recreate a namespace from the stored configuration without someone remembering a one-off terminal command.

## Wiring Specific Keys into Environment Variables
<!-- section-summary: Explicit env wiring documents exactly which ConfigMap keys a container expects and gives each key a stable environment variable name. -->

Many applications read configuration from environment variables. The orders API might read `process.env.LOG_LEVEL` during startup and configure its logger before it accepts requests. Kubernetes can fill that environment variable from one specific ConfigMap key.

Here is a Deployment fragment that maps individual keys:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: devpolaris-staging
spec:
  replicas: 2
  selector:
    matchLabels:
      app: orders-api
  template:
    metadata:
      labels:
        app: orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:1.18.0
          ports:
            - containerPort: 8080
          env:
            - name: PORT
              valueFrom:
                configMapKeyRef:
                  name: orders-api-config
                  key: PORT
            - name: LOG_LEVEL
              valueFrom:
                configMapKeyRef:
                  name: orders-api-config
                  key: LOG_LEVEL
            - name: FEATURE_REFUNDS
              valueFrom:
                configMapKeyRef:
                  name: orders-api-config
                  key: FEATURE_REFUNDS
            - name: CATALOG_API_URL
              valueFrom:
                configMapKeyRef:
                  name: orders-api-config
                  key: CATALOG_API_URL
            - name: CHECKOUT_TIMEOUT_MS
              valueFrom:
                configMapKeyRef:
                  name: orders-api-config
                  key: CHECKOUT_TIMEOUT_MS
```

This explicit form is a little longer, and that is part of the benefit. Reviewers can see exactly which settings the container expects. The environment variable name can also differ from the ConfigMap key when the application expects a different naming style.

If `orders-api-config` or one of the referenced keys is missing, the Pod stays pending by default. That failure is useful for required settings. The Deployment should pause with a clear event instead of starting an application that silently falls back to the wrong catalog URL or a default timeout that nobody reviewed.

Kubernetes lets you mark a reference as optional:

```yaml
env:
  - name: FEATURE_REFUNDS
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: FEATURE_REFUNDS
        optional: true
```

Optional references belong only to values that the application truly treats as optional. For `devpolaris-orders-api`, `FEATURE_REFUNDS` might be optional because the app defaults to `false`. `CATALOG_API_URL` should be required because the service needs catalog data to price orders correctly.

## Using envFrom Carefully
<!-- section-summary: envFrom is convenient for dedicated ConfigMaps, but it can hide collisions, skipped keys, and accidental extra settings. -->

`envFrom` copies every valid key from a ConfigMap into the container environment. If `orders-api-config` contains exactly the environment variables that the orders API should receive, `envFrom` keeps the Deployment compact:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: devpolaris-staging
spec:
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:1.18.0
          envFrom:
            - configMapRef:
                name: orders-api-config
```

This works best when the ConfigMap belongs to one container and the keys already match the application environment variable names. A dedicated `orders-api-config` object with `PORT`, `LOG_LEVEL`, and `FEATURE_REFUNDS` is a reasonable fit.

The risks show up when a ConfigMap is shared or loosely managed. A teammate might add a key for a sidecar container, and the main API receives it as an environment variable too. A key might collide with an environment variable set elsewhere in the Deployment. A key such as `catalog.url` can exist in a ConfigMap, but it is invalid as a normal environment variable name. Kubernetes skips invalid environment variable names from `envFrom` and records an event.

When a Pod starts but a setting seems absent, events usually show whether Kubernetes skipped or rejected an environment key:

```bash
kubectl get events -n devpolaris-staging --sort-by=.lastTimestamp
kubectl describe pod -n devpolaris-staging -l app=orders-api
```

For production services, prefer explicit `env` entries for required application settings and use `envFrom` only when the ConfigMap is dedicated, small, and named around one application. That keeps the review simple: every key in `orders-api-config` belongs to the orders API container.

## Mounting ConfigMaps as Files
<!-- section-summary: File mounts work well for applications that read structured configuration from disk instead of individual environment variables. -->

Some applications read config files instead of environment variables. The orders API might read `/etc/orders-api/orders.yaml` during startup because a shared library already expects a YAML file. A ConfigMap can project keys into a read-only volume, where each key appears as a file.

The ConfigMap can store the file content under one key:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-file-config
  namespace: devpolaris-staging
data:
  orders.yaml: |
    server:
      port: 8080
      logLevel: debug
    features:
      refunds: false
    dependencies:
      catalogApiUrl: http://catalog-api.devpolaris-staging.svc.cluster.local:8080
      checkoutTimeoutMs: 3000
```

The Deployment mounts that key at a path:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: devpolaris-staging
spec:
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:1.18.0
          args:
            - "--config=/etc/orders-api/orders.yaml"
          volumeMounts:
            - name: orders-config
              mountPath: /etc/orders-api
              readOnly: true
      volumes:
        - name: orders-config
          configMap:
            name: orders-api-file-config
            items:
              - key: orders.yaml
                path: orders.yaml
```

Inside the container, Kubernetes creates `/etc/orders-api/orders.yaml` with the value from the ConfigMap. This approach keeps related settings together and gives the application one file to parse. It also avoids a long environment variable list when the application has nested configuration.

The `items` list fits mounts that need only certain keys or custom file names. If the ConfigMap key is missing and the item is required, the Pod fails to start. That is usually the right behavior for required config files.

One detail matters for updates. A normal ConfigMap volume can receive updated file content after the ConfigMap changes. A `subPath` mount stays fixed for the life of the container. If you mount one ConfigMap key with `subPath`, plan a Pod restart for every config change.

## How Updates Reach Running Pods
<!-- section-summary: Environment variables stay fixed until restart, while mounted files update eventually and still need application reload behavior. -->

ConfigMap update behavior depends on how the Pod consumes the data. For environment variables, Kubernetes reads the ConfigMap when the container starts. A later ConfigMap change leaves the running process environment unchanged. The existing orders API Pods keep their old values until you restart or replace them.

For a Deployment, the normal operational command is:

```bash
kubectl apply -f k8s/staging/orders-api-configmap.yaml
kubectl rollout restart deployment/orders-api -n devpolaris-staging
kubectl rollout status deployment/orders-api -n devpolaris-staging
```

That restart creates new Pods, and the new Pods read the updated ConfigMap during startup. This is the safest path when the application reads settings once at boot, which is common for ports, loggers, client timeouts, and feature flags.

Mounted ConfigMap files behave differently. Kubernetes eventually updates projected files in normal ConfigMap volumes. The kubelet checks and refreshes those values through its configured change detection strategy, so there can be a delay. The application also has to notice the file changed. Some applications watch the file and reload. Others read once at startup and need the same rollout restart as environment variables.

For `devpolaris-orders-api`, one documented pattern should own each configuration path:

| Configuration path | Runtime behavior | Operational action |
|---|---|---|
| Required env vars | Values fixed at container start | Restart or roll Pods after ConfigMap changes |
| Mounted file read once | File may update, app keeps old parsed config | Restart or roll Pods after ConfigMap changes |
| Mounted file with reload support | File may update, app reloads after change | Validate reload, keep restart as fallback |
| `subPath` mounted file | Mounted file stays fixed | Restart or roll Pods after ConfigMap changes |

When a configuration change matters for production behavior, prefer a rollout you can observe. `kubectl rollout status` shows whether the new ReplicaSet became healthy. Application logs and metrics should confirm that the new value was loaded, such as a startup log that prints `configVersion=2026-06-16` or `featureRefunds=true`.

## Immutable ConfigMaps
<!-- section-summary: Immutable ConfigMaps prevent accidental in-place edits and encourage versioned configuration objects. -->

An **immutable ConfigMap** is a ConfigMap with `immutable: true`. After Kubernetes accepts it, the `data` and `binaryData` fields are locked. You can delete and recreate the object, or create a new object with a different name, but the existing data stays fixed in place.

Here is a versioned immutable ConfigMap for production:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config-2026-06-16
  namespace: devpolaris-prod
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
data:
  PORT: "8080"
  LOG_LEVEL: "info"
  FEATURE_REFUNDS: "true"
  CATALOG_API_URL: "http://catalog-api.devpolaris-prod.svc.cluster.local:8080"
  CHECKOUT_TIMEOUT_MS: "2500"
immutable: true
```

The Deployment references the versioned name:

```yaml
env:
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: orders-api-config-2026-06-16
        key: LOG_LEVEL
```

This pattern is useful for configuration you want to treat like a release artifact. A pull request creates `orders-api-config-2026-06-16`, updates the Deployment reference, and rolls the Deployment. Rollback means pointing the Deployment back to the previous ConfigMap name. The change history stays visible because each config version has its own object.

Immutable ConfigMaps also reduce kubelet watch load in clusters with many ConfigMap mounts, because Kubernetes can stop watching locked objects. The operational tradeoff is stricter change management. If your team needs quick in-place edits during early development, immutable ConfigMaps can slow that loop. For production, that friction often helps because it pushes changes through versioned review and rollout.

## Kustomize and Helm Workflows
<!-- section-summary: Kustomize and Helm give teams repeatable ways to generate environment-specific ConfigMaps and trigger rollouts when values change. -->

Raw manifests work well for small services. As the number of environments grows, teams usually reach for Kustomize, Helm, or a GitOps tool that uses one of them. The goal stays the same: keep the image stable, keep the configuration reviewable, and make rollouts predictable.

With **Kustomize**, you can generate ConfigMaps from literals, `.env` files, or config files. Kustomize appends a content hash to generated ConfigMap names by default and updates references in workloads it manages. That hash is useful because a changed ConfigMap name changes the Pod template, which triggers a new rollout for Deployments.

Example `kustomization.yaml` for staging:

```yaml
resources:
  - deployment.yaml

configMapGenerator:
  - name: orders-api-config
    literals:
      - PORT=8080
      - LOG_LEVEL=debug
      - FEATURE_REFUNDS=false
      - CATALOG_API_URL=http://catalog-api.devpolaris-staging.svc.cluster.local:8080
      - CHECKOUT_TIMEOUT_MS=3000
```

The usual preview and apply flow looks like this:

```bash
kubectl kustomize k8s/overlays/staging
kubectl apply -k k8s/overlays/staging
```

The Deployment can reference `orders-api-config`, and Kustomize rewrites it to the generated name with the hash. The name suffix hash should stay enabled unless your team has a different rollout trigger, because a stable ConfigMap name alone may leave existing Pods running with old environment values.

With **Helm**, the ConfigMap usually comes from chart templates and `values.yaml`. Helm can calculate a checksum of the rendered ConfigMap and place it on the Pod template annotations. When the ConfigMap template changes, the checksum changes, the Pod template changes, and the Deployment rolls.

Deployment template fragment:

```yaml
spec:
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
```

Typical commands:

```bash
helm template orders-api ./charts/orders-api -f values-staging.yaml
helm upgrade --install orders-api ./charts/orders-api \
  --namespace devpolaris-staging \
  -f values-staging.yaml
```

Kustomize and Helm both help with repeatability, and the team still decides what belongs in a ConfigMap. Plain settings belong in ConfigMaps. Credentials and tokens belong in Secrets or an external secret manager. That separation keeps the next review simple: configuration reviewers can read ConfigMap diffs freely, while sensitive changes follow a tighter path.

## Validation and Troubleshooting
<!-- section-summary: Most ConfigMap failures come from missing objects, missing keys, namespace mismatches, invalid env names, stale Pods, or application parsing errors. -->

Validation should happen before the rollout. The first check is whether the ConfigMap exists in the same namespace as the workload:

```bash
kubectl get configmap orders-api-config -n devpolaris-staging
kubectl describe configmap orders-api-config -n devpolaris-staging
```

The Deployment wiring is the next check:

```bash
kubectl get deployment orders-api -n devpolaris-staging -o yaml
kubectl describe deployment orders-api -n devpolaris-staging
```

If Pods are stuck in `CreateContainerConfigError`, inspect the Pod events. Kubernetes usually tells you when a ConfigMap or key is missing:

```bash
kubectl get pods -n devpolaris-staging -l app=orders-api
kubectl describe pod -n devpolaris-staging -l app=orders-api
kubectl get events -n devpolaris-staging --sort-by=.lastTimestamp
```

Common causes are straightforward:

| Symptom | Likely cause | Check |
|---|---|---|
| Pod says ConfigMap is missing | ConfigMap was applied to another namespace or named differently | `kubectl get configmap -n devpolaris-staging` |
| Pod says key is missing | Deployment references a key that the ConfigMap lacks | `kubectl get configmap orders-api-config -n devpolaris-staging -o yaml` |
| App starts with default values | App defaulted because a reference was optional or the wrong env name was used | Review `env` names and startup logs |
| `envFrom` key absent | Key name is invalid as an environment variable | Check events for invalid environment variable warnings |
| Config changed but behavior stayed old | Running Pods still have old env vars or the app read a file once | Restart rollout and verify new Pods |
| File mount stayed old | The file was mounted with `subPath` or kubelet refresh is still pending | Inspect volumeMounts and restart when needed |
| App crashes on startup | Value is a string that failed application parsing | Check app logs for config validation errors |

For safe runtime checks, prefer application logs that print a redacted or non-sensitive config summary. ConfigMaps carry plain values, so reading them is usually fine, but production diagnostics still need discipline. A startup log such as `config loaded logLevel=info featureRefunds=true checkoutTimeoutMs=2500` helps operators verify behavior without opening a shell in the container.

When you need to prove the environment inside a Pod, use a short-lived debug path in a non-production namespace first. Production containers often have no shell, and interactive exec access should already be restricted. If you do use `kubectl exec`, keep the command narrow:

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- printenv LOG_LEVEL
```

The final check is rollout health:

```bash
kubectl rollout status deployment/orders-api -n devpolaris-staging
kubectl logs deployment/orders-api -n devpolaris-staging --tail=50
```

That gives you three layers of confidence: Kubernetes accepted the object, the Pod consumed the expected keys, and the application started with the intended settings.

## Review Checklist
<!-- section-summary: A ConfigMap review should confirm ownership, safety, wiring, rollout behavior, validation, and rollback. -->

This checklist fits pull requests that change a ConfigMap or its workload wiring:

| Check | What to look for |
|---|---|
| Ownership | ConfigMap name, labels, and namespace match one application or one clearly shared purpose |
| Confidentiality | Values are safe for plain review and contain no passwords, tokens, signing keys, or private certificates |
| Key shape | Required keys exist, key names are consistent, and `envFrom` keys are valid environment variable names |
| Type parsing | Numbers and booleans are quoted as strings in YAML and validated by the application |
| Wiring | Deployment references the right ConfigMap name, namespace, and key names |
| Optional values | `optional: true` appears only for values with safe application defaults |
| Update behavior | The change includes a rollout plan, Kustomize hash, Helm checksum, or documented file reload behavior |
| Immutable policy | Immutable ConfigMaps use versioned names and a clear rollback path |
| Validation | Reviewer can see `kubectl apply`, `kubectl rollout status`, logs, or GitOps health checks for the change |
| Cleanup | Old versioned ConfigMaps have a retention rule so rollback stays possible without clutter forever |

For the orders API, the final review question is simple: can someone deploy the same image to staging and production, understand every plain runtime setting from the manifest, and predict how a change reaches running Pods? If the answer is yes, the ConfigMap is doing its job.

---

**References**

- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Defines ConfigMaps, supported data fields, Pod consumption methods, namespace rules, immutability, and size guidance.
- [Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/) - Shows `kubectl create configmap`, explicit environment variables, `envFrom`, optional ConfigMaps, restrictions, and common events.
- [Updating Configuration via a ConfigMap](https://kubernetes.io/docs/tutorials/configuration/updating-configuration-via-a-configmap/) - Demonstrates update behavior for mounted ConfigMaps, environment variables, and immutable ConfigMaps.
- [kubectl create configmap](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_configmap/) - Documents literal, file, directory, env-file, dry-run, and hash options for creating ConfigMaps.
- [Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) - Documents `configMapGenerator`, generated names, `kubectl kustomize`, and `kubectl apply -k`.
- [Helm Chart Development Tips and Tricks](https://helm.sh/docs/howto/charts_tips_and_tricks/) - Includes Helm template functions and the checksum annotation pattern for rolling workloads after rendered config changes.
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Defines the sensitive-data companion to ConfigMaps and explains when confidential values need Secret handling instead.
