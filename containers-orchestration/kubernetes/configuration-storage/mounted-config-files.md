---
title: "Mounted Config Files"
description: "Mount ConfigMaps and Secrets as files when Kubernetes applications need configuration on disk instead of environment variables."
overview: "Mounted config files let a Pod receive reviewable configuration as a filesystem view, which is useful for config formats, certificates, and tools that expect files."
tags: ["kubernetes", "configmaps", "volumes", "files"]
order: 4
id: article-containers-orchestration-kubernetes-configuration-storage-mounted-config-files
---

## Table of Contents

1. [Why Some Configuration Belongs on Disk](#why-some-configuration-belongs-on-disk)
2. [ConfigMap Volumes as Directories](#configmap-volumes-as-directories)
3. [Selecting and Renaming Files with items](#selecting-and-renaming-files-with-items)
4. [File Modes and Read-Only Expectations](#file-modes-and-read-only-expectations)
5. [Secret Files and Certificates](#secret-files-and-certificates)
6. [The subPath Caveat](#the-subpath-caveat)
7. [Update and Reload Behavior](#update-and-reload-behavior)
8. [Mount Paths That Hide Image Files](#mount-paths-that-hide-image-files)
9. [Diagnostics from Pod to Process](#diagnostics-from-pod-to-process)
10. [Choosing Files or Environment Variables](#choosing-files-or-environment-variables)
11. [Production Review Checklist](#production-review-checklist)

## Why Some Configuration Belongs on Disk
<!-- section-summary: Mounted config files fit structured configuration, certificates, and tools that already expect paths on the filesystem. -->

Environment variables work well for short startup values. The `devpolaris-orders-api` can read `PORT`, `CATALOG_API_URL`, and `FEATURE_FAST_REFUNDS` during startup without opening any files. That approach starts to get awkward when the value has shape.

Imagine the orders team adds cancellation rules. The rules include nested refund settings, allowed reasons, time windows, and a few country-specific overrides. A single YAML file is easier to review than twenty environment variables with names like `CANCELLATION_REFUNDS_ALLOWED_REASON_4`. The same thing happens with TLS certificates, CA bundles, Nginx config, OpenTelemetry collector config, and any library that already expects a file path.

A **mounted config file** is a normal file inside the container that Kubernetes builds from a ConfigMap or Secret. The application opens the file from a path such as `/etc/devpolaris/orders/cancellation-policy.yaml`. Kubernetes supplies the content through a volume. The process reads the file like any other file.

```mermaid
flowchart LR
    CM["ConfigMap key<br/>cancellation-policy.yaml"] --> V["ConfigMap volume"]
    S["Secret key<br/>ca.crt"] --> SV["Secret volume"]
    V --> P["/etc/devpolaris/orders"]
    SV --> C["/etc/devpolaris/certs"]
    P --> A["orders API reads YAML"]
    C --> A
```

This article follows the same app from the environment-variable article. The scalar startup contract stays in environment variables. Structured rules and certificate material move to files. That split gives the team clear review: short values in the Deployment contract, structured files in ConfigMaps and Secrets, and explicit mount paths in the Pod spec.

## ConfigMap Volumes as Directories
<!-- section-summary: A ConfigMap volume turns keys into files, so multi-line non-sensitive configuration can reach the container as ordinary filesystem content. -->

A **ConfigMap volume** turns ConfigMap keys into files. Kubernetes uses the key name as the file name, and it writes the value as the file content. For non-sensitive structured configuration, this is the most common file-mount pattern.

Here is the orders API cancellation policy as a ConfigMap. The key is `cancellation-policy.yaml`, and the value is a multi-line YAML document.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-files
  namespace: devpolaris-staging
data:
  cancellation-policy.yaml: |
    refunds:
      enabled: false
      allowedReasons:
        - duplicate_order
        - customer_request
    cancellationWindowMinutes: 30
    manualReview:
      amountThresholdUsd: 500
      queue: "orders-risk-review"
```

The Deployment defines a volume from that ConfigMap and mounts it into the container. The volume name connects the ConfigMap source to the `volumeMounts` entry on the `api` container.

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
      volumes:
        - name: orders-config-files
          configMap:
            name: orders-api-files
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:1.18.0
          volumeMounts:
            - name: orders-config-files
              mountPath: /etc/devpolaris/orders
              readOnly: true
```

Inside the container, Kubernetes presents the key as a file. These commands show the path and content for a non-sensitive policy file:

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- ls -l /etc/devpolaris/orders
kubectl exec deploy/orders-api -n devpolaris-staging -- cat /etc/devpolaris/orders/cancellation-policy.yaml
```

The application reads the file path from a small environment variable or from a default path. Many teams keep the path in an environment variable because it makes local development and tests simple.

```yaml
env:
  - name: CANCELLATION_POLICY_PATH
    value: "/etc/devpolaris/orders/cancellation-policy.yaml"
```

That gives the app a clean startup contract. Short scalar values arrive through environment variables, and the structured document arrives through the mounted filesystem.

## Selecting and Renaming Files with items
<!-- section-summary: The items field lets a Pod mount only selected keys and choose the file names that appear in the container. -->

Sometimes a ConfigMap contains several keys, but one container should receive only a subset. The `items` field gives that control. Each item maps a ConfigMap key to a path inside the mounted volume.

For the orders API, the same ConfigMap might hold a cancellation policy and a worker tuning file. The API container needs the policy. A worker container needs the tuning file. The API mount can select one key and rename it to a simple filename.

```yaml
volumes:
  - name: orders-policy
    configMap:
      name: orders-api-files
      items:
        - key: cancellation-policy.yaml
          path: policy.yaml
containers:
  - name: api
    image: ghcr.io/devpolaris/orders-api:1.18.0
    volumeMounts:
      - name: orders-policy
        mountPath: /etc/devpolaris/orders
        readOnly: true
```

The file appears as `/etc/devpolaris/orders/policy.yaml` inside the container. The original key name stays in the ConfigMap, and the container sees the path chosen by the Pod spec.

`items` also gives a useful safety property. If a listed key is missing and the reference is required, the Pod cannot start. That is good for required files. A missing policy file should stop the orders API before it serves requests with unknown rules.

There is an `optional: true` setting for ConfigMap volume sources and item references. It can be useful for development-only files, but required production config should usually stay required. A Pod that starts with a missing policy file pushes the failure into application behavior, which makes incidents harder to understand.

## File Modes and Read-Only Expectations
<!-- section-summary: defaultMode controls file permissions, while ConfigMap and Secret volume content should be treated as read-only input from Kubernetes. -->

Mounted configuration files have Unix-style file permissions. Kubernetes lets you set a `defaultMode` on the volume source, and individual `items` can set their own `mode`.

For a policy file, world-readable permissions may be acceptable because the content is non-sensitive and the container usually runs one application process. A common mode is `0444`, which means read permission for owner, group, and others.

```yaml
volumes:
  - name: orders-policy
    configMap:
      name: orders-api-files
      defaultMode: 0444
      items:
        - key: cancellation-policy.yaml
          path: policy.yaml
          mode: 0444
```

For Secret files, teams often choose a narrower mode such as `0400` or `0440`, depending on the user and group the container runs as. The mode should match the container security context so the app can read the file without giving every process broad access.

```yaml
volumes:
  - name: orders-certificates
    secret:
      secretName: orders-api-certificates
      defaultMode: 0440
```

YAML supports the octal-looking form shown above. JSON manifests require decimal numbers because JSON has no octal syntax. For example, octal `0440` is decimal `288`. This matters for teams that generate manifests through code or policy tooling.

ConfigMap and Secret volume content should be treated as read-only input. Kubernetes mounts ConfigMap and Secret volumes as read-only sources. The container can create runtime files somewhere else, such as `/tmp`, an `emptyDir`, or a persistent volume, but it should not try to edit the mounted config file as its source of truth.

That expectation shapes application design. The orders API can read `/etc/devpolaris/orders/policy.yaml`, parse it, and log the policy version. If the app needs to write a compiled cache, it should write that cache to a separate writable path, not back into the mounted ConfigMap directory.

## Secret Files and Certificates
<!-- section-summary: Secret volumes are a natural fit for certificates, keys, and tokens that libraries expect to load from file paths. -->

A **Secret volume** turns Secret keys into files. This is especially useful for certificate material because TLS libraries and database clients often expect file paths. A CA certificate, client certificate, and private key can each appear as a file inside the container.

For `devpolaris-orders-api`, imagine the production database requires TLS with a private CA bundle. The Secret stores the certificate files. The Deployment mounts them under `/etc/devpolaris/certs`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-certificates
  namespace: devpolaris-staging
type: Opaque
stringData:
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    example-ca-certificate-content
    -----END CERTIFICATE-----
  client.crt: |
    -----BEGIN CERTIFICATE-----
    example-client-certificate-content
    -----END CERTIFICATE-----
  client.key: |
    -----BEGIN PRIVATE KEY-----
    example-private-key-content
    -----END PRIVATE KEY-----
```

The Pod spec mounts the Secret and passes file paths to the application. The environment variables carry paths only, while the certificate content stays in the mounted Secret files.

```yaml
volumes:
  - name: orders-certificates
    secret:
      secretName: orders-api-certificates
      defaultMode: 0440
containers:
  - name: api
    image: ghcr.io/devpolaris/orders-api:1.18.0
    env:
      - name: DATABASE_CA_PATH
        value: "/etc/devpolaris/certs/ca.crt"
      - name: DATABASE_CLIENT_CERT_PATH
        value: "/etc/devpolaris/certs/client.crt"
      - name: DATABASE_CLIENT_KEY_PATH
        value: "/etc/devpolaris/certs/client.key"
    volumeMounts:
      - name: orders-certificates
        mountPath: /etc/devpolaris/certs
        readOnly: true
```

Secrets still need careful cluster security. Kubernetes Secret values are base64-encoded in the API representation, which means the API stores a transport-friendly representation rather than cryptographic protection. Production clusters should use encryption at rest for Secrets, least-privilege RBAC, restricted namespace access, and a managed source of truth such as an external secrets operator or cloud secret manager when the organization uses one.

Mounting a Secret as a file can reduce accidental exposure compared with placing the same value in environment variables. Environment variables are often easier to print accidentally in crash reports, debug endpoints, and process dumps. Files still need care, but file paths give many libraries a cleaner interface for certificates and private keys.

## The subPath Caveat
<!-- section-summary: subPath can mount one file into an existing directory, but ConfigMap and Secret updates do not flow through subPath mounts. -->

`subPath` mounts one file or directory from a volume into a specific path inside the container. It is tempting when an image already has a directory with useful files, and you want to add only one Kubernetes-supplied file.

Suppose the orders image already contains `/app/config/defaults.yaml`, and the team wants to place the cancellation policy at `/app/config/cancellation-policy.yaml` without replacing the whole `/app/config` directory. A `subPath` mount can do that.

```yaml
volumes:
  - name: orders-policy
    configMap:
      name: orders-api-files
      items:
        - key: cancellation-policy.yaml
          path: cancellation-policy.yaml
containers:
  - name: api
    image: ghcr.io/devpolaris/orders-api:1.18.0
    volumeMounts:
      - name: orders-policy
        mountPath: /app/config/cancellation-policy.yaml
        subPath: cancellation-policy.yaml
        readOnly: true
```

This solves the one-file placement problem, but it changes update behavior. ConfigMap and Secret volume updates do not flow into a container through a `subPath` mount. The file content stays tied to what the container received when the Pod started.

That caveat makes `subPath` a careful choice for config. It can be fine for files that only change during rollouts, because a new Pod receives the new content. It is a poor fit for teams expecting mounted file updates to appear in a running process.

The simpler production pattern is a dedicated config directory, such as `/etc/devpolaris/orders`, mounted as the volume root. The image should keep built-in defaults somewhere else. The application can merge defaults and Kubernetes config in code, or the Deployment can mount the complete runtime config directory.

## Update and Reload Behavior
<!-- section-summary: Mounted ConfigMap and Secret volumes can update eventually, but the application still needs an explicit reload or rollout strategy. -->

Mounted ConfigMap and Secret volumes have different update behavior from environment variables. Environment variables are fixed at process start. Mounted files can receive updated content after the ConfigMap or Secret changes, because the kubelet watches or checks the API object and updates the projected files on the node.

The application still needs its own reload behavior before it uses the new settings. The orders API has to reread the file, watch for file changes, handle a reload signal, or restart. Many applications read config once during startup. For those apps, a mounted file update sits on disk until a new process reads it.

There are three common production patterns. The right one depends on whether the application can safely reload configuration while it is serving requests.

**Restart on config change** keeps behavior simple. The release pipeline updates the ConfigMap or Secret, then restarts the Deployment. New Pods read the new files during startup, readiness probes protect traffic, and rollback uses normal Deployment rollback.

```bash
kubectl apply -f orders-api-files.yaml
kubectl rollout restart deployment/orders-api -n devpolaris-staging
kubectl rollout status deployment/orders-api -n devpolaris-staging
```

**Application reload** works when the app can safely reread config. The process watches `/etc/devpolaris/orders/policy.yaml` or handles a signal such as `SIGHUP`, validates the new file, and swaps the in-memory config only after validation succeeds. This pattern needs careful testing because a partial or invalid reload can break live traffic.

**Sidecar reloaders** watch mounted files and call an HTTP reload endpoint or send a signal to the main process. This can help with tools such as proxies and collectors, but the main application still needs a safe reload path.

The key operational habit is to verify both the file and the process. Seeing a new file on disk proves Kubernetes delivered the content. Application logs or health checks should also show that the process loaded the new value.

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- cat /etc/devpolaris/orders/policy.yaml
kubectl logs deploy/orders-api -n devpolaris-staging | grep "loaded cancellation policy"
```

For certificate rotation, plan the reload path before the first emergency. Some clients can reload CA bundles from disk. Some need a process restart. Some connection pools need reconnection. The Kubernetes mount is only one part of the rotation story.

## Mount Paths That Hide Image Files
<!-- section-summary: A volume mounted on a directory hides files that the image already had at that same path, so mount locations need deliberate boundaries. -->

Mounting a volume at a directory path overlays that directory for the container. Files from the image at the same path are hidden while the volume is mounted.

This is a common surprise. The orders image might include these files before Kubernetes mounts anything at runtime, and the developer may expect all three to stay visible. The mount changes what the process can list at that directory path:

```bash
/app/config/defaults.yaml
/app/config/schema.json
/app/config/local-dev.yaml
```

The Pod then mounts a ConfigMap at `/app/config`. That mount path is the important part of the example because it covers the image's existing files:

```yaml
volumeMounts:
  - name: orders-policy
    mountPath: /app/config
    readOnly: true
```

Inside the running container, `/app/config` now shows the files from the ConfigMap volume. The image files at `/app/config/defaults.yaml` and `/app/config/schema.json` are hidden behind the mount. They still exist in the image layer, but the process cannot see them at that path while the volume is mounted.

The clean fix is usually a dedicated mount path:

```yaml
volumeMounts:
  - name: orders-policy
    mountPath: /etc/devpolaris/orders
    readOnly: true
```

The app can then load image defaults from `/app/config/defaults.yaml` and Kubernetes runtime config from `/etc/devpolaris/orders/policy.yaml`. The path names tell a future reviewer which files came from the image and which files came from the cluster.

`subPath` can place one file into an existing directory, but it brings the update caveat from the previous section. A dedicated config directory avoids both the hidden-file surprise and the `subPath` update surprise.

## Diagnostics from Pod to Process
<!-- section-summary: File-mount debugging works best as a chain: object exists, Pod references it, mount appears, file content is present, and the process logs that it loaded the path. -->

When mounted config fails, debug the chain from Kubernetes object to application process. Each step proves one link.

The sequence starts with the source object in the same namespace as the Pod. That confirms the Pod has an object it is allowed to reference.

```bash
kubectl get configmap orders-api-files -n devpolaris-staging
kubectl get secret orders-api-certificates -n devpolaris-staging
```

Key names can be listed without dumping sensitive Secret values. This catches spelling problems while keeping private data out of terminal output.

```bash
kubectl get configmap orders-api-files -n devpolaris-staging -o json | jq -r '.data | keys[]'
kubectl get secret orders-api-certificates -n devpolaris-staging -o json | jq -r '.data | keys[]'
```

Pod events usually show missing ConfigMaps, Secrets, or keys before the application process starts.

```bash
kubectl describe pod -n devpolaris-staging -l app=orders-api
```

The rendered Pod spec confirms the running Pod received the expected volume and mount paths from the Deployment.

```bash
kubectl get pod -n devpolaris-staging -l app=orders-api -o json \
  | jq '.items[0].spec.volumes, .items[0].spec.containers[] | select(.name == "api") | .volumeMounts'
```

Once the Pod is running, inspect the mount from inside the container. This verifies the filesystem view the application process can actually see.

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- ls -la /etc/devpolaris/orders
kubectl exec deploy/orders-api -n devpolaris-staging -- stat -c '%a %n' /etc/devpolaris/orders/policy.yaml
kubectl exec deploy/orders-api -n devpolaris-staging -- head -n 20 /etc/devpolaris/orders/policy.yaml
```

For Secret files, private keys and passwords should stay out of terminal output. File names, modes, and certificate metadata usually give enough diagnostic evidence.

```bash
kubectl exec deploy/orders-api -n devpolaris-staging -- ls -la /etc/devpolaris/certs
kubectl exec deploy/orders-api -n devpolaris-staging -- sh -c 'test -s /etc/devpolaris/certs/ca.crt && echo ca-present'
```

The file evidence should then connect to the process. Application logs should say which config path loaded and which version or hash it accepted. They should not print secret content.

```bash
kubectl logs deploy/orders-api -n devpolaris-staging | grep "config path"
kubectl logs deploy/orders-api -n devpolaris-staging | grep "cancellation policy"
```

This order prevents guesswork. A missing file in the container points to the Kubernetes object, volume, mount, or namespace before application code. A file that exists while logs show a different loaded path points to startup configuration. A file that exists and has been loaded points the next investigation toward file content or application behavior.

## Choosing Files or Environment Variables
<!-- section-summary: Environment variables fit small startup values, and files fit structured documents, certificates, and tools that already read paths. -->

The choice is usually about shape and lifecycle. Small scalars fit environment variables. Structured documents and certificate material fit files.

| Use environment variables for | Use mounted files for |
|---|---|
| Ports and bind addresses | YAML, JSON, TOML, INI, and conf files |
| Small feature flags | TLS certificates and private keys |
| Service URLs | CA bundles and trust stores |
| Log level and release track | Nginx, Envoy, OpenTelemetry, or app config files |
| Pod name, namespace, and labels | Multi-line policy documents |

For the orders API, this split is practical:

```yaml
env:
  - name: PORT
    value: "8080"
  - name: CATALOG_API_URL
    valueFrom:
      configMapKeyRef:
        name: orders-api-config
        key: CATALOG_API_URL
  - name: CANCELLATION_POLICY_PATH
    value: "/etc/devpolaris/orders/policy.yaml"
  - name: DATABASE_CA_PATH
    value: "/etc/devpolaris/certs/ca.crt"
volumeMounts:
  - name: orders-policy
    mountPath: /etc/devpolaris/orders
    readOnly: true
  - name: orders-certificates
    mountPath: /etc/devpolaris/certs
    readOnly: true
```

The environment variables still form the startup contract. Some of those variables point to files. The files carry the content that belongs on disk.

This split also helps local development. A developer can run the app with `CANCELLATION_POLICY_PATH=./config/policy.yaml` on a laptop and use the same application code that production uses. Kubernetes supplies a different path, but the app still follows one rule: read the path from startup config, parse the file, and fail early if it is invalid.

## Production Review Checklist
<!-- section-summary: A production review should cover source objects, mount paths, file modes, reload behavior, hidden files, and application validation. -->

A mounted-file review for `devpolaris-orders-api` should answer a short list of concrete questions. These questions match the places where file-based configuration usually breaks in production.

Are the ConfigMaps and Secrets in the same namespace as the workload? Pod references do not cross namespace boundaries, so every environment needs its own source objects.

Do the mounted keys have clear filenames? Names such as `policy.yaml`, `ca.crt`, and `client.key` tell future maintainers what the process expects.

Does the mount path have its own directory? A path such as `/etc/devpolaris/orders` avoids hiding application files under `/app/config`.

Are Secret file modes strict enough for the container user and group? The mode should match the runtime security context instead of copying a permissive default.

Does the app validate the file at startup or reload time? A malformed YAML policy should stop startup or reject reload before serving traffic with unclear behavior.

Is the reload plan written into the operational flow? The team should know whether a ConfigMap change requires `kubectl rollout restart`, an app reload endpoint, a signal, or a sidecar-driven reload.

Do diagnostics avoid leaking sensitive content? Listing Secret key names and checking file existence is usually enough. Printing private keys, database passwords, or tokens during a debug session creates a second incident.

When those answers are clear, mounted files fit cleanly into the Pod contract. Kubernetes supplies files, the process reads known paths, and the release process controls how changes reach running Pods.

---

**References**

- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Defines ConfigMaps and describes consumption through environment variables and volumes.
- [Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/) - Shows ConfigMap volume mounts, selected keys, optional references, and update behavior.
- [Volumes](https://kubernetes.io/docs/concepts/storage/volumes/) - Documents `configMap`, `secret`, `subPath`, read-only behavior, and tmpfs-backed Secret volumes.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Explains Secret storage, security cautions, volume consumption, and update behavior.
- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/) - Shows Secret data exposed to containers through mounted files.
- [Updating Configuration via a ConfigMap](https://kubernetes.io/docs/tutorials/configuration/updating-configuration-via-a-configmap/) - Walks through ConfigMap update behavior for mounted files and environment variables.
- [Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/) - Describes combining several volume sources into one mounted directory and notes the `subPath` update caveat for projected sources.
- [Manage TLS Certificates in a Cluster](https://kubernetes.io/docs/tasks/tls/managing-tls-in-a-cluster/) - Covers Kubernetes certificate workflows that often feed certificate files into workloads.
