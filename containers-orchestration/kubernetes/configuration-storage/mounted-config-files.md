---
title: "Mounted Config Files"
description: "Mount ConfigMaps and Secrets as files when Kubernetes applications need configuration on disk instead of environment variables."
overview: "Mounted config files let a Pod receive reviewable configuration as a filesystem view, which is useful for config formats, certificates, and tools that expect files."
tags: ["kubernetes", "configmaps", "volumes", "files"]
order: 4
id: article-containers-orchestration-kubernetes-configuration-storage-mounted-config-files
---
## Table of Contents

1. [Files for Apps That Read Files](#files-for-apps-that-read-files)
2. [Why Some Configuration Belongs on Disk](#why-some-configuration-belongs-on-disk)
3. [ConfigMap Volumes as Directories](#configmap-volumes-as-directories)
4. [Select and Rename Files with items](#select-and-rename-files-with-items)
5. [File Modes and Read-Only Expectations](#file-modes-and-read-only-expectations)
6. [Secret Files and Certificates](#secret-files-and-certificates)
7. [The subPath Caveat](#the-subpath-caveat)
8. [Update and Reload Behavior](#update-and-reload-behavior)
9. [Mount Paths Can Hide Image Files](#mount-paths-can-hide-image-files)
10. [Diagnostics from Pod to Process](#diagnostics-from-pod-to-process)
11. [Choose Files or Environment Variables](#choose-files-or-environment-variables)
12. [Assembled Example](#assembled-example)
13. [Review Checklist](#review-checklist)
14. [References](#references)

## Files for Apps That Read Files
<!-- section-summary: Mounted config files let Kubernetes present ConfigMap or Secret data as normal files inside a container. -->

Environment variables work well for small startup strings. Some applications and tools already expect a file path instead: a YAML routing file, a JSON policy, an Nginx snippet, a CA bundle, a TLS certificate, or a provider config file. Kubernetes can project ConfigMap and Secret data into the container filesystem so the application keeps that file-based contract.

A **mounted config file** is a delivery path from a ConfigMap or Secret into the container filesystem. Plain files usually come from ConfigMaps. Sensitive files, such as TLS private keys or provider credentials, usually come from Secrets. Durable application data belongs on PersistentVolumeClaims, which is the next step in this module.

For the Customer Notification Platform, the worker can read routing rules from `/etc/notification/routing.yaml`, while the API can read TLS files from a Secret mount. The path runs from source key to final file path, then adds file selection, permissions, update behavior, and diagnostics.

The worker routing rules are a good first example because the structure matters. The file has indentation, channel names, and provider settings. Keeping that as one YAML file is easier to review than spreading the same shape across many environment variables.

The basic path has four links:

1. A ConfigMap or Secret key stores the file content.
2. `volumes[]` points the Pod at that source object.
3. `volumeMounts[]` attaches that volume to a container directory.
4. The application reads the final file path inside the container.

Here is the skeleton before the details:

```yaml
data:
  routing.yaml: |
    defaultChannel: email
---
volumes:
  - name: worker-config
    configMap:
      name: notification-worker-files
containers:
  - name: worker
    volumeMounts:
      - name: worker-config
        mountPath: /etc/notification
        readOnly: true
```

The skeleton shows the whole delivery path:

- `data.routing.yaml` stores the file content in the source object.
- `volumes[].configMap.name` points the Pod at that source object.
- `volumeMounts[].mountPath` chooses the directory the container sees.

That skeleton produces the application path `/etc/notification/routing.yaml`. The key name supplies the filename, and `mountPath` supplies the directory.

One ConfigMap key can turn into one file:

```yaml
data:
  routing.yaml: |
    defaultChannel: email
    retryLimit: 3
```

The Pod mount chooses the directory where that file appears:

```yaml
volumeMounts:
  - name: notification-routing
    mountPath: /etc/notification
    readOnly: true
```

The mount tells the container where the file appears:

- `name: notification-routing` matches the Pod volume name.
- `mountPath: /etc/notification` supplies the directory part of the final file path.
- `readOnly: true` records that the app consumes this config instead of writing to it.

Inside the container, the file path is `/etc/notification/routing.yaml`. The application sees a normal file, while the configuration still lives in a reviewable Kubernetes object.

## Why Some Configuration Belongs on Disk
<!-- section-summary: Files fit structured configuration, certificates, and tools that already expect paths on disk. -->

Environment variables are useful for small strings. Files fit configuration with structure, line breaks, permissions, or a standard path. YAML routing rules, JSON provider maps, Nginx snippets, CA bundles, TLS certificates, and application policy files all fit naturally on disk.

This choice is about how the application already consumes configuration. If the worker library expects a YAML file, the clean Kubernetes path is to preserve that file shape and mount it into the container. The source object still lives in the API server for review and rollout, while the process receives a normal filesystem path that it can parse during startup or reload.

The Customer Notification Platform has a `notification-worker` that sends messages through multiple channels. A few environment variables can hold `QUEUE_NAME` and `MAX_BATCH_SIZE`, but routing rules belong in YAML:

```yaml
defaultChannel: email
providers:
  email:
    timeoutMs: 2500
  sms:
    timeoutMs: 4000
```

A file keeps the structure readable:

- The `providers` block groups channel-specific settings together.
- Indentation makes relationships visible in a way that separate environment variables cannot.

A mounted file keeps that shape intact. Reviewers can read indentation, keys, and grouped settings without mentally assembling many separate environment variables.

![Mounted config directory view](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-mounted-config-files/mounted-config-directory-view.png)

*A mounted ConfigMap or Secret turns named keys into files at predictable paths inside the container.*

## ConfigMap Volumes as Directories
<!-- section-summary: Mounting a ConfigMap as a directory exposes each key as one file. -->

A **ConfigMap volume** projects ConfigMap keys into the container filesystem. Kubernetes writes each key as one file by default. If the ConfigMap has `routing.yaml` and `limits.yaml`, the mounted directory contains two files.

This is the main delivery path for plain files. The ConfigMap is the source object, the Pod volume names that source, and the container mount chooses where the files appear. For `notification-worker`, this keeps routing and limit files close together in `/etc/notification`, while the image can stay focused on application code.

First define the ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-worker-files
  namespace: customer-notifications
data:
  routing.yaml: |
    defaultChannel: email
  limits.yaml: |
    maxBatchSize: 100
```

Then mount it into the worker:

```yaml
volumes:
  - name: worker-config
    configMap:
      name: notification-worker-files
containers:
  - name: worker
    volumeMounts:
      - name: worker-config
        mountPath: /etc/notification
        readOnly: true
```

Follow the object chain in this manifest:

- `data.routing.yaml` is the ConfigMap key that contains the file body.
- `volumes[].configMap.name` connects the Pod to the ConfigMap source object.
- `volumeMounts[].name` chooses the volume to mount into the `worker` container.
- `mountPath: /etc/notification` makes the final files appear under that directory.

The worker can read `/etc/notification/routing.yaml` and `/etc/notification/limits.yaml`. That path should be part of the application startup contract, just like an environment variable name would be.

## Select and Rename Files with items
<!-- section-summary: items lets you expose only selected keys and choose the filename each key receives. -->

The **items** field selects specific keys from a ConfigMap or Secret and maps them to file paths. Use it when the object has more keys than the container needs, or when the application expects a specific filename.

Selection makes the mount contract smaller. A shared source object might contain several file-like keys, but one container should receive only the files it reads. Renaming also helps when the Kubernetes key name is descriptive for reviewers while the application expects a legacy filename. The `items` list records that mapping directly in the Pod spec.

```yaml
configMap:
  name: notification-worker-files
  items:
    - key: routing.yaml
      path: provider-routing.yaml
```

This mapping changes the filename only inside the mounted directory:

- `key: routing.yaml` selects the ConfigMap entry.
- `path: provider-routing.yaml` gives the application the filename it expects.

This maps the ConfigMap key `routing.yaml` to `/etc/notification/provider-routing.yaml` when the mount path is `/etc/notification`. The application can keep its existing filename while the ConfigMap key remains clear in Kubernetes.

If you list a key under `items` and that key is missing, the volume setup fails unless the reference is optional. Production config files usually need required keys. A missing routing file should stop the Pod before it sends messages through the wrong provider path.

## File Modes and Read-Only Expectations
<!-- section-summary: defaultMode controls projected file permissions, and mounted config should usually be read-only from the container view. -->

Projected ConfigMap and Secret files have permissions. **defaultMode** sets the mode for files in the volume. Kubernetes YAML uses decimal numbers for file modes unless the parser supports octal notation, so examples often use `420` for `0644` and `256` for `0400`.

Permissions are part of the delivery path because the file must be readable by the process user inside the container. A file can mount successfully and still fail at startup if the user, group, and mode do not line up. Treat `defaultMode`, `readOnly`, and the workload security context as one review topic, especially for Secret files.

```yaml
volumes:
  - name: worker-config
    configMap:
      name: notification-worker-files
      defaultMode: 420
```

The mode value controls the projected file permissions:

- `420` is the decimal form commonly used for `0644`.
- The process user must still have permission to access the mounted files.

The volume mount should include `readOnly: true`. A projected config volume is managed by Kubernetes, and application writes should go to a separate writable path such as `/tmp`, an `emptyDir`, or a PersistentVolumeClaim.

For Secrets, use tighter modes when the application supports them:

```yaml
secret:
  secretName: notification-webhook-tls
  defaultMode: 256
```

This Secret mode is tighter:

- `256` is the decimal form commonly used for `0400`.
- The owner-read setting only works if the container user and file ownership line up.

That mode gives owner-read permission. The container user and security context must line up with the file ownership and permissions, or the process may see a permission error at startup.

## Secret Files and Certificates
<!-- section-summary: Secret volumes are the usual file-based path for certificates, private keys, and credential files. -->

A **Secret volume** projects Secret keys as files. This is common for TLS certificates, provider credential files, and tools that expect a path rather than an environment variable.

This pattern keeps sensitive file formats out of the image and out of plain ConfigMaps. The Secret stores the certificate or key material, the Pod selects the file names, and the application opens the mounted path at runtime. That gives security teams a separate source of truth and gives operators a clear rotation point.

The `notification-api` might serve an internal webhook endpoint with a certificate and private key:

```yaml
volumes:
  - name: webhook-tls
    secret:
      secretName: notification-webhook-tls
      items:
        - key: tls.crt
          path: server.crt
        - key: tls.key
          path: server.key
```

Mount the files read-only:

```yaml
volumeMounts:
  - name: webhook-tls
    mountPath: /etc/notification/tls
    readOnly: true
```

The mounted directory now holds the selected Secret files:

- `server.crt` and `server.key` appear under `/etc/notification/tls`.
- The Secret stays the source of sensitive bytes, and the image stays free of private key material.

The application reads `/etc/notification/tls/server.crt` and `/etc/notification/tls/server.key`. Avoid copying these files into image layers or writable paths. The Pod should receive them at runtime and drop them when the Pod is deleted.

## The subPath Caveat
<!-- section-summary: subPath can mount one file into a specific path, while ConfigMap and Secret updates require a Pod restart for that mount. -->

**subPath** mounts one file or directory from a volume into a specific path inside the container. It can be handy when an application expects one exact file path and the image already has other files in the same directory.

Use this path for compatibility with an existing image layout. For example, an older worker might read exactly `/app/config/routing.yaml`, while the image also ships `defaults.yaml` in `/app/config`. A `subPath` mount can place only the projected routing file at that path, preserving the rest of the directory view from the image.

```yaml
volumeMounts:
  - name: worker-config
    mountPath: /app/config/routing.yaml
    subPath: routing.yaml
    readOnly: true
```

The `subPath` mount is a compatibility choice:

- `mountPath` names the exact file path the existing application expects.
- `subPath` selects one file from the projected volume instead of replacing the whole directory.

The caveat is important: `subPath` mounts keep the old file view after a ConfigMap or Secret update. If the routing file changes, the running container keeps the old file view until the Pod restarts.

A full directory mount fits projected files that should refresh through kubelet. A `subPath` mount fits cases where restart-based updates are acceptable and the app image already has other files in the same directory.

## Update and Reload Behavior
<!-- section-summary: Projected files can update in place, while applications still need a reload or restart strategy to consume changed content. -->

ConfigMap and Secret volumes can update after kubelet refreshes the projected volume. The file content in the container changes, but the application may not notice. Many programs read config once at startup and never reopen the file.

The recovery plan for changed files has two halves. Kubernetes can refresh the projected content, and the application still needs a way to consume the new bytes. For notification routing rules, the team should decide whether a normal rollout is enough or whether the worker has a safe reload endpoint. That decision should appear in the release runbook.

For `notification-worker`, there are three practical reload strategies:

| Strategy | How it works | When it fits |
|---|---|---|
| Restart Pods | Roll the Deployment after changing the ConfigMap or Secret | Simple and reliable for most apps |
| Application reload endpoint | A controller or operator tells the process to reload files | Apps with a safe reload feature |
| File watcher | The process watches the mounted path and reloads on change | Apps designed for dynamic config |

For normal releases, restart-based updates are the simplest:

```bash
kubectl rollout restart deployment/notification-worker -n customer-notifications
kubectl rollout status deployment/notification-worker -n customer-notifications
```

The output should show a completed rollout:

```console
deployment "notification-worker" successfully rolled out
```

![Config file update flow](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-mounted-config-files/config-file-update-flow.png)

*A mounted file can change on disk, but the process needs a reload or rollout path to use the new content.*

## Mount Paths Can Hide Image Files
<!-- section-summary: Mounting a volume over a directory replaces the container's view of that directory with the projected files. -->

When you mount a volume at a directory, the mounted volume covers the files that the image had at that path. The files still exist in the image layer, but the process sees the mounted directory.

This surprises beginners with paths such as `/app/config`. If the image already contains `defaults.yaml` there and the ConfigMap mount contains only `routing.yaml`, the running container sees only the projected content at `/app/config`.

A safe pattern is to mount projected config under a dedicated path:

```yaml
mountPath: /etc/notification
```

That path is dedicated to Kubernetes-projected config:

- It avoids covering files that the image already placed under `/app/config`.
- The application can receive the path through a flag, env var, or documented startup default.

Then tell the application to read that explicit path. If you must mount one file into an existing directory, `subPath` can preserve the other files, with the update caveat explained earlier.

## Diagnostics from Pod to Process
<!-- section-summary: Troubleshooting mounted config checks the Kubernetes object, then the Pod volume, then the file as the process sees it. -->

The source object gives the first clue:

Mounted-file debugging follows the same chain as the manifest. First check that the ConfigMap or Secret exists and has the expected number of keys. Then check that the Pod volume and mount path are present. Finally, inspect the file as the process sees it. This order separates source-object mistakes from mount-path mistakes and application parsing errors.

For Secret-backed files, use the same chain but stop short of printing the contents. File names, modes, and safe application logs are usually enough.

```bash
kubectl get configmap notification-worker-files -n customer-notifications
```

Expected output:

```console
NAME                        DATA   AGE
notification-worker-files   2      3m12s
```

Then inspect the mounted directory in a running Pod:

```bash
kubectl exec deploy/notification-worker -n customer-notifications -- ls -l /etc/notification
```

A healthy directory might look like this:

```console
-rw-r--r-- 1 root root 22 Jun 28 11:04 limits.yaml
-rw-r--r-- 1 root root 26 Jun 28 11:04 routing.yaml
```

Finally, read a safe non-secret file:

```bash
kubectl exec deploy/notification-worker -n customer-notifications -- cat /etc/notification/routing.yaml
```

Example output:

```console
defaultChannel: email
providers:
  email: internal-email-gateway
```

Do not `cat` private keys, provider tokens, or database credential files during normal troubleshooting. For Secret files, check file names, permissions, and application logs that confirm presence without printing values.

## Choose Files or Environment Variables
<!-- section-summary: Choose environment variables for small startup strings and mounted files for structured content, certificates, and reloadable config. -->

Environment variables and mounted files are both normal Kubernetes delivery paths. The right choice depends on how the application consumes the value and how operators need to change it.

The notification platform can use both patterns in one workload. Small startup strings such as queue names and timeout values fit environment variables. Structured routing files and certificate material fit mounted files. Choosing per value keeps the manifest readable and prevents a large YAML policy from turning into scattered environment variables.

| Need | Better fit | Example |
|---|---|---|
| Small string read at startup | Environment variable | `LOG_LEVEL=info` |
| Secret credential for a framework | Environment variable or file | `DATABASE_URL` or provider JSON |
| Structured config | Mounted file | `routing.yaml` |
| TLS certificate and key | Mounted Secret files | `server.crt`, `server.key` |
| Reload without restart | Mounted file plus app reload support | Provider routing rules |

Do not force every setting into one style. The Customer Notification Platform can use environment variables for queue names and timeouts, ConfigMap files for routing rules, and Secret files for certificates.

## Assembled Example
<!-- section-summary: The full manifest mounts routing configuration and TLS files after the key concepts are introduced. -->

Here is the assembled pattern for `notification-worker`. The routing file comes from a ConfigMap, and TLS files come from a Secret.

This full example shows two source objects entering the same container through separate mounted directories. Plain routing configuration lands under a config path, while sensitive certificate material lands under a TLS path. The separation helps reviewers check file ownership, permissions, reload behavior, and diagnostics for each source.

The worker can read both paths during startup, while operators can rotate or troubleshoot each source through its own Kubernetes object.

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
          volumeMounts:
            - name: worker-config
              mountPath: /etc/notification/config
              readOnly: true
            - name: provider-tls
              mountPath: /etc/notification/tls
              readOnly: true
      volumes:
        - name: worker-config
          configMap:
            name: notification-worker-files
            items:
              - key: routing.yaml
                path: routing.yaml
        - name: provider-tls
          secret:
            secretName: notification-provider-tls
            items:
              - key: tls.crt
                path: provider.crt
              - key: tls.key
                path: provider.key
```

The full manifest keeps the file lanes separate:

- `worker-config` mounts plain routing configuration under `/etc/notification/config`.
- `provider-tls` mounts sensitive certificate files under `/etc/notification/tls`.
- Each `items` list exposes only the file keys the worker actually needs.

The application startup should check that the expected files exist, parse `routing.yaml`, and log a safe summary. For Secret files, the logs should confirm that a certificate loaded without printing private key material.

## Review Checklist
<!-- section-summary: Mounted file reviews check path ownership, update behavior, permissions, and diagnostic safety. -->

Use this checklist before merging mounted config changes:

The checklist exists because file mounts can fail in several places that look similar from the application side. A missing key, an unexpected filename, a covered image directory, a permission mismatch, or a missing reload plan can all show up as "config file not found" or "permission denied." Review the source, path, mode, update behavior, and diagnostic plan together.

That review should happen before the app depends on the mounted path for routing decisions or certificate loading.

| Check | What to confirm |
|---|---|
| Path | The mount path is dedicated or the `subPath` restart behavior is accepted |
| Source | Plain files come from ConfigMaps, sensitive files come from Secrets |
| Selection | `items` exposes only the keys the container needs |
| Permissions | `defaultMode`, `readOnly`, and container user settings allow safe reads |
| Reload | The release plan uses restart, reload endpoint, or file watcher intentionally |
| Diagnostics | Troubleshooting commands avoid printing Secret contents |

![Mounted config decision map](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-mounted-config-files/mounted-config-decision-map.png)

*The file delivery choice should connect the source object, mount path, permissions, reload behavior, and troubleshooting plan.*

## References

- [Configure Pods to use ConfigMaps](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/)
- [Distribute credentials securely using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/)
- [Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
