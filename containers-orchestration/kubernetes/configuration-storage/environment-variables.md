---
title: "Environment Variables"
description: "Pass Kubernetes runtime configuration into containers through clear, validated environment variables."
overview: "Environment variables are the startup contract between a Pod spec and the process inside the container, so they need careful sources, validation, and rollout behavior."
tags: ["kubernetes", "environment", "configmaps", "secrets"]
order: 3
id: article-containers-orchestration-kubernetes-configuration-storage-environment-variables
---

## Table of Contents

1. [The Environment as a Startup Contract](#the-environment-as-a-startup-contract)
2. [Literal Values in the Pod Template](#literal-values-in-the-pod-template)
3. [ConfigMap and Secret Sources](#configmap-and-secret-sources)
4. [Explicit env and Bulk envFrom](#explicit-env-and-bulk-envfrom)
5. [Dependent Expansion](#dependent-expansion)
6. [Pod Metadata Through the Downward API](#pod-metadata-through-the-downward-api)
7. [CreateContainerConfigError](#createcontainerconfigerror)
8. [Validation in Application Code](#validation-in-application-code)
9. [Rollouts, Restarts, and Changed Values](#rollouts-restarts-and-changed-values)
10. [Drift Review Across Namespaces](#drift-review-across-namespaces)
11. [Where Environment Variables Fit](#where-environment-variables-fit)

## The Environment as a Startup Contract
<!-- section-summary: Kubernetes builds the container environment before the process starts, so environment variables work best as a small, validated startup contract. -->

An **environment variable** is a name-value pair attached to a process. In a container, the application reads those values through the normal language runtime, such as `process.env` in Node.js, `os.environ` in Python, or `System.getenv` in Java. Kubernetes lets the Pod spec describe those values, and the kubelet passes them to the container when it starts.

For this article, imagine a Deployment called `devpolaris-orders-api`. The container image stays the same across staging and production. The startup values change by environment: the port, the catalog service URL, the payment service URL, the log level, a feature flag, and the database connection string. Those values tell the same image how to behave in each namespace.

That is why environment variables are a **startup contract**. The Pod spec says, "this container starts with these names available." The application says, "I require these names, I will parse them, and I will refuse to boot if the contract is broken." A good contract gives both Kubernetes operators and application developers something concrete to review.

```mermaid
flowchart LR
    D["Deployment template"] --> K["Kubelet builds container config"]
    CM["ConfigMap"] --> K
    S["Secret"] --> K
    M["Pod metadata"] --> K
    K --> C["Container process starts"]
    C --> A["orders API validates process.env"]
```

The timing matters. Kubernetes prepares environment variables before the process starts. A running process keeps the environment it received at startup. If someone edits the ConfigMap later, the already-running process keeps the old environment values. New Pods can receive the new values, but existing processes need a restart or a rollout.

This article starts with small literal values, then moves to ConfigMaps, Secrets, bulk imports, dependent values, Pod metadata, diagnostics, validation, and review. The same `devpolaris-orders-api` example carries through the whole path so the pieces connect like they do in a real deployment.

## Literal Values in the Pod Template
<!-- section-summary: Literal environment values are useful for tiny workload-owned settings that reviewers should see directly in the Deployment. -->

A **literal environment value** is written directly inside the container spec. Kubernetes stores the value in the Pod template, and every Pod created from that template receives the same string.

For `devpolaris-orders-api`, `NODE_ENV` and `PORT` are good literal candidates. They are small, non-sensitive, and tightly tied to how this container starts. A reviewer looking at the Deployment should see them without opening another object.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: devpolaris-staging
spec:
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
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "8080"
```

Kubernetes stores environment values as strings. The quotes around `"8080"` make that clear to humans, even though YAML can represent numbers without quotes. The application still needs to parse the value as a number before binding the HTTP server.

Literal values need discipline. They work well for a handful of values that belong with the workload template. They create clutter when teams place every staging and production setting directly in the Deployment. After a few services, reviewers end up scanning long Pod specs to find one URL change. ConfigMaps and Secrets give those values a better home.

## ConfigMap and Secret Sources
<!-- section-summary: ConfigMaps hold non-sensitive configuration and Secrets hold sensitive values, while the Deployment keeps a visible list of the environment names the app expects. -->

A **ConfigMap** is a Kubernetes API object for non-sensitive configuration. It stores keys and values such as service URLs, log levels, feature flags, and names of external systems. For the orders API, the catalog and payment service URLs can live in a ConfigMap because they describe routing, not credentials.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config
  namespace: devpolaris-staging
data:
  CATALOG_API_URL: "http://catalog-api.devpolaris-staging.svc.cluster.local"
  PAYMENTS_API_URL: "http://payments-api.devpolaris-staging.svc.cluster.local"
  LOG_LEVEL: "info"
  FEATURE_FAST_REFUNDS: "false"
```

A **Secret** is a Kubernetes API object for sensitive values, such as passwords, tokens, private keys, and database URLs with credentials inside them. Secrets need strong RBAC, encryption at rest, and careful delivery from your secret management process. The Secret object changes how the value is handled by Kubernetes, but it still needs real security controls around the cluster.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-secrets
  namespace: devpolaris-staging
type: Opaque
stringData:
  DATABASE_URL: "postgres://orders_app:change-me@orders-db:5432/orders"
```

The Deployment references individual keys with `valueFrom`. This style keeps the application contract visible in one place. A reviewer can see every environment variable name the container expects, then follow each reference to the object that owns the value.

```yaml
env:
  - name: CATALOG_API_URL
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: CATALOG_API_URL
  - name: PAYMENTS_API_URL
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: PAYMENTS_API_URL
  - name: FEATURE_FAST_REFUNDS
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: FEATURE_FAST_REFUNDS
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: orders-api-secrets
        key: DATABASE_URL
```

There is one important namespace rule. A Pod can reference a ConfigMap or Secret in the same namespace as the Pod. The staging Deployment cannot reach into the production namespace for `orders-api-config`. That separation helps review because each namespace owns its own runtime configuration.

## Explicit env and Bulk envFrom
<!-- section-summary: Use explicit env entries for important application contracts, and reserve envFrom for controlled bundles where every key is safe to import. -->

Kubernetes gives you two ways to place ConfigMap or Secret data into the environment. The first is **explicit `env`**, where each environment variable gets its own entry. The second is **`envFrom`**, where Kubernetes imports every key from a ConfigMap or Secret.

Explicit `env` is usually the better default for application startup values. It gives each variable a clear name, allows the environment variable name to differ from the ConfigMap key, and makes missing keys easier to spot in review.

```yaml
env:
  - name: ORDER_LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: LOG_LEVEL
```

`envFrom` is useful when a team owns a small, purpose-built ConfigMap and every key in it is meant for the process environment. That bulk import can reduce repeated YAML for development tools, test fixtures, and application bundles that already use environment-style keys.

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config
  - secretRef:
      name: orders-api-secrets
```

There are two production review points with `envFrom`. First, every imported key enters the process environment, so a casual extra key in the ConfigMap can reach the app. Second, key collisions need a clear policy. Kubernetes gives values in later `envFrom` sources precedence over earlier ones, and explicit `env` entries take precedence over duplicate names imported through `envFrom`.

A prefix can reduce collision risk. In this example, all keys from the ConfigMap receive an `ORDERS_` prefix in the container environment.

```yaml
envFrom:
  - prefix: ORDERS_
    configMapRef:
      name: orders-api-config
```

The imported key `LOG_LEVEL` reaches the container as `ORDERS_LOG_LEVEL`. That can be a good fit for shared sidecars or libraries, but the application code needs to expect the prefixed name.

Invalid environment variable names deserve attention too. Environment variable names in Pods have naming rules. With `envFrom`, Kubernetes can skip keys that do not work as environment names and record an event. With explicit `env`, a bad name or a missing required key can stop the Pod from starting. This is one reason production teams prefer explicit `env` for the values that the application truly requires.

## Dependent Expansion
<!-- section-summary: Kubernetes can expand earlier environment variables into later literal values, but order matters and unresolved references remain plain strings. -->

**Dependent expansion** means one environment variable value can include another environment variable. Kubernetes supports the `$(VAR_NAME)` syntax inside the `value` field of an `env` entry.

For the orders API, the team may want a single display value for logs and health pages. The namespace and service name can be separate variables, and `SERVICE_ID` can combine them.

```yaml
env:
  - name: SERVICE_NAME
    value: "orders-api"
  - name: DEPLOYMENT_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: SERVICE_ID
    value: "$(DEPLOYMENT_NAMESPACE)/$(SERVICE_NAME)"
```

Kubernetes expands references from values that are already defined earlier in the same `env` list or already present in the environment. The order in the list matters. If `SERVICE_ID` appears before `SERVICE_NAME`, Kubernetes leaves `$(SERVICE_NAME)` as ordinary text. The container can still start because unresolved expansion does not automatically mean invalid configuration.

Escaping uses a double dollar sign. A value like `$$(SERVICE_NAME)` reaches the process as `$(SERVICE_NAME)` without expansion. That matters for command strings, templates, and application configs that use their own placeholder syntax.

Dependent expansion works best for small convenience values. It should not replace application parsing or configuration validation. If the value controls a real endpoint, database, or feature behavior, the application should still validate the final string after startup.

## Pod Metadata Through the Downward API
<!-- section-summary: The Downward API lets a container receive selected Pod fields, labels, annotations, and resource values without calling the Kubernetes API. -->

The **Downward API** exposes information about the Pod and container to the running container. It is called "downward" because Kubernetes sends selected metadata down into the workload. The app can learn its own Pod name or namespace without receiving a ServiceAccount token for direct API calls.

For `devpolaris-orders-api`, metadata can improve logs and metrics. The app can include the Pod name, namespace, and node name in structured logs, which helps an on-call engineer connect an error to a specific Kubernetes object.

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
  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Labels and annotations can be exposed too. A common pattern is to label Pods with an application version, release track, or team name, then pass that value into logs or telemetry.

```yaml
metadata:
  labels:
    app: orders-api
    app.kubernetes.io/version: "1.18.0"
spec:
  containers:
    - name: api
      env:
        - name: APP_VERSION
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['app.kubernetes.io/version']
```

The Downward API can also expose resource requests and limits through `resourceFieldRef`. That helps applications tune worker counts or cache sizes from the same CPU and memory limits operators already review.

```yaml
env:
  - name: CPU_LIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.cpu
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.memory
```

This is still startup input. If a label or resource limit changes through a new Pod template, new Pods receive the updated values. The process should treat them as boot-time facts, not live Kubernetes state.

## CreateContainerConfigError
<!-- section-summary: CreateContainerConfigError usually means Kubernetes could not build the container config, often because a required ConfigMap, Secret, or key is missing. -->

`CreateContainerConfigError` is a Pod waiting state. It means Kubernetes accepted the Pod object, scheduled it, and then the kubelet could not build the container configuration needed to start the container. The process inside the image has not run yet.

Environment variable references are a common cause. The Deployment says `DATABASE_URL` comes from `orders-api-secrets`, but the Secret is missing in the namespace. Or the Secret exists, but the key is named `DB_URL` while the Deployment asks for `DATABASE_URL`.

The first useful command is a Pod listing with the namespace included. In this scenario, the label selector keeps the output focused on the orders API replicas.

```bash
kubectl get pods -n devpolaris-staging -l app=orders-api
```

The output might show the waiting reason. That status tells you the container has not reached application startup yet.

```bash
NAME                          READY   STATUS                       RESTARTS   AGE
orders-api-685fd7f8f4-bcq2x   0/1     CreateContainerConfigError   0          42s
```

`kubectl describe pod` shows the event from the kubelet. That event usually names the missing object or key.

```bash
kubectl describe pod orders-api-685fd7f8f4-bcq2x -n devpolaris-staging
```

The event can look like this:

```bash
Error: couldn't find key DATABASE_URL in Secret devpolaris-staging/orders-api-secrets
```

The investigation then narrows to the referenced object. These commands check object existence and key names without decoding secret values.

```bash
kubectl get secret orders-api-secrets -n devpolaris-staging
kubectl get secret orders-api-secrets -n devpolaris-staging -o json | jq -r '.data | keys[]'
kubectl get configmap orders-api-config -n devpolaris-staging -o json | jq -r '.data | keys[]'
```

There is an `optional: true` field for ConfigMap and Secret references. It tells Kubernetes to let the container start even if the object or key is absent. That field belongs only to values the application can truly handle without surprises, such as an optional banner message or optional debug toggle. Required startup values should fail before traffic reaches the broken Pod.

## Validation in Application Code
<!-- section-summary: Kubernetes can inject values, but the application must parse, validate, and safely report configuration mistakes. -->

Kubernetes can prove that a referenced key exists. It cannot prove that `PORT` is a real port, that `CATALOG_API_URL` is a valid URL, or that `FEATURE_FAST_REFUNDS` contains a supported boolean value. The application owns that part of the contract.

For a Node.js version of `devpolaris-orders-api`, startup validation can be plain and strict. The code should print the name of the missing or invalid variable, never the value of a secret.

```javascript
function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseUrl(name) {
  const value = requireEnv(name);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function parseBoolean(name) {
  const value = requireEnv(name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

export function loadConfig() {
  return {
    nodeEnv: requireEnv("NODE_ENV"),
    port: parsePort(requireEnv("PORT")),
    catalogApiUrl: parseUrl("CATALOG_API_URL"),
    paymentsApiUrl: parseUrl("PAYMENTS_API_URL"),
    fastRefundsEnabled: parseBoolean("FEATURE_FAST_REFUNDS"),
    databaseUrl: requireEnv("DATABASE_URL"),
    podName: process.env.POD_NAME ?? "local",
    namespace: process.env.POD_NAMESPACE ?? "local"
  };
}
```

This validation belongs at the edge of application startup. The server should validate configuration before opening the listening socket or starting background workers. If the configuration is wrong, the container exits quickly, Kubernetes records a restart, and logs explain the missing contract.

The log message needs enough detail for on-call work. A message like `Missing required environment variable: CATALOG_API_URL` is useful. A message that prints `DATABASE_URL=postgres://...` leaks sensitive data into logs. For secrets, print the variable name and the validation rule, not the secret content.

Teams often mirror the same contract in deployment checks. A CI job can render the Helm chart or Kustomize output, then verify that every required environment variable appears in the Pod template. That catches missing references before the manifest reaches the cluster. The application validation still stays in place because production safety should not depend on one pipeline check.

## Rollouts, Restarts, and Changed Values
<!-- section-summary: Environment variable changes reach running applications through new Pods, so teams need an intentional rollout path after changing ConfigMaps or Secrets. -->

A Deployment rollout creates new Pods from a changed Pod template. If you edit an environment literal in the Deployment, Kubernetes sees a new template and rolls the Deployment. If you only edit the data inside a referenced ConfigMap or Secret, the Deployment template has the same object names, so existing Pods keep their current environment.

That behavior surprises teams during incidents. Someone fixes `PAYMENTS_API_URL` in `orders-api-config`, applies the ConfigMap, waits, and sees the same error. The running process still has the old value because environment variables were built at process start.

For a direct operational fix, restart the Deployment after applying the ConfigMap or Secret change. That gives every replica a fresh process environment built from the current objects.

```bash
kubectl apply -f orders-api-config.yaml
kubectl rollout restart deployment/orders-api -n devpolaris-staging
kubectl rollout status deployment/orders-api -n devpolaris-staging
```

After the new Pod is Ready, the value can be verified from inside the container. Secret values should stay out of terminal history and shared logs.

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- printenv CATALOG_API_URL
kubectl exec deploy/orders-api -n devpolaris-staging -- printenv FEATURE_FAST_REFUNDS
```

Many teams automate this through their release tooling. Kustomize can generate ConfigMap names with content hashes. Helm charts often add a checksum annotation to the Pod template, calculated from the rendered ConfigMap or Secret. When the data changes, the annotation changes, the Pod template changes, and the Deployment rolls.

```yaml
metadata:
  annotations:
    checksum/orders-api-config: "sha256-of-rendered-config"
```

That annotation is a release mechanism. Application validation still runs at startup, and readiness probes still protect traffic from a bad configuration. Rollback stays normal Kubernetes work:

```bash
kubectl rollout history deployment/orders-api -n devpolaris-staging
kubectl rollout undo deployment/orders-api -n devpolaris-staging
```

## Drift Review Across Namespaces
<!-- section-summary: Staging and production can use different values, but they should usually expose the same required keys so the application contract stays consistent. -->

Configuration **drift** means environments slowly stop matching in shape or intent. Staging may have `PAYMENTS_API_URL`, production may have `PAYMENT_API_URL`, and the application only works in one namespace because one key has the plural form and the other does not.

The values can differ. The keys usually should not. Staging and production should point at different databases and different upstream services, but the application contract should have the same required names in each namespace.

ConfigMap keys can be compared without printing the values. This catches shape drift while keeping sensitive values out of the terminal:

```bash
for ns in devpolaris-staging devpolaris-prod; do
  echo "== $ns config keys =="
  kubectl get configmap orders-api-config -n "$ns" -o json | jq -r '.data | keys[]' | sort
done
```

The same pattern works for Secret keys. This prints key names only, not decoded secret values.

```bash
for ns in devpolaris-staging devpolaris-prod; do
  echo "== $ns secret keys =="
  kubectl get secret orders-api-secrets -n "$ns" -o json | jq -r '.data | keys[]' | sort
done
```

For a deeper review, compare the environment contract in the Deployment template:

```bash
for ns in devpolaris-staging devpolaris-prod; do
  echo "== $ns deployment env names =="
  kubectl get deployment orders-api -n "$ns" -o json \
    | jq -r '.spec.template.spec.containers[] | select(.name == "api") | .env[]?.name' \
    | sort
done
```

This catches a different class of drift. A ConfigMap may contain the right keys, but the Deployment may still reference the old name. The contract that matters is the path from Pod template to object key to process.

In production teams, this review usually lives in pull requests and CI. Reviewers check the rendered manifests for staging and production. CI can run a small script that fails if required environment variable names differ across environments. Humans still review the actual values because the right key can still point to the wrong service.

## Where Environment Variables Fit
<!-- section-summary: Environment variables work well for small startup values, while structured config and certificates usually belong in mounted files. -->

Environment variables are a strong fit for short startup values: ports, log levels, feature flags, service URLs, and small identity strings from the Downward API. They are simple for applications to read, easy to inspect in a Pod template, and familiar to most language runtimes.

They start to strain when configuration is multi-line, structured, or file-oriented. A cancellation policy written as YAML, a CA certificate bundle, an OpenTelemetry collector config, or an Nginx server block reads much better as a file. Flattening those into many environment variables makes review harder and pushes parsing complexity into places that do not need it.

For `devpolaris-orders-api`, the first pass uses environment variables for startup scalars: `PORT`, `CATALOG_API_URL`, `PAYMENTS_API_URL`, `FEATURE_FAST_REFUNDS`, and `DATABASE_URL`. As the application grows, the cancellation rules and certificate bundle move into mounted files. That is the next shape of Kubernetes configuration: the Pod still receives startup values, but structured data arrives through the filesystem.

---

**References**

- [Define Environment Variables for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/) - Shows the basic `env` and `envFrom` fields for containers.
- [Define Dependent Environment Variables](https://kubernetes.io/docs/tasks/inject-data-application/define-interdependent-environment-variables/) - Documents `$(VAR_NAME)` expansion, ordering, unresolved references, and escaping.
- [Expose Pod Information to Containers Through Environment Variables](https://kubernetes.io/docs/tasks/inject-data-application/environment-variable-expose-pod-information/) - Explains Downward API environment variables from Pod and container fields.
- [Downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/) - Describes the Downward API and the fields Kubernetes can expose to containers.
- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Defines ConfigMaps and describes using them as environment variables and files.
- [Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/) - Covers ConfigMap references, namespace behavior, optional references, and invalid names with `envFrom`.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Explains Secret use cases, security considerations, and ways Pods can consume Secrets.
- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/) - Shows Secret values consumed as individual environment variables and through `envFrom`.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Documents rollout management commands for Kubernetes workloads.
