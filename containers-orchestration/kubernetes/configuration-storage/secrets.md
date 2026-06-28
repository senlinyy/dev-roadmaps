---
title: "Secrets"
description: "Use Kubernetes Secrets to deliver sensitive application values without baking credentials into images or plain manifests."
overview: "Secrets separate sensitive runtime values from ordinary configuration, but they still need RBAC, careful diagnostics, and a rotation plan."
tags: ["kubernetes", "secrets", "rbac", "credentials"]
order: 2
id: article-containers-orchestration-kubernetes-configuration-storage-secrets
---

## Table of Contents

1. [Start with One Password](#start-with-one-password)
2. [What a Secret Stores](#what-a-secret-stores)
3. [Base64, stringData, and Encryption](#base64-stringdata-and-encryption)
4. [Secret Types](#secret-types)
5. [Create a Secret Without Leaking Values](#create-a-secret-without-leaking-values)
6. [Deliver Secrets as Environment Variables](#deliver-secrets-as-environment-variables)
7. [Mount Secrets as Files](#mount-secrets-as-files)
8. [RBAC, ServiceAccounts, and Namespaces](#rbac-serviceaccounts-and-namespaces)
9. [Encryption at Rest and External Stores](#encryption-at-rest-and-external-stores)
10. [Rotation Runbook](#rotation-runbook)
11. [Leak Prevention](#leak-prevention)
12. [Troubleshoot Missing or Stale Secrets](#troubleshoot-missing-or-stale-secrets)
13. [Assembled Example](#assembled-example)
14. [Review Checklist](#review-checklist)

## Start with One Password
<!-- section-summary: A Secret starts with one sensitive value, such as a database password, that a Pod needs at runtime. -->

The ordinary app problem is a database password. The `notification-api` process needs that password before it can connect to PostgreSQL. That password should not sit in the container image, and it should not appear as a plain value in the Deployment manifest.

A **Kubernetes Secret** stores sensitive runtime values such as passwords, tokens, signing keys, private certificates, and registry credentials. A Secret lets a Pod receive those values at runtime while the value itself stays in a separate object with tighter access rules.

Here is the smallest safe article shape, using a placeholder instead of a real password:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-api-secrets
  namespace: customer-notifications
type: Opaque
stringData:
  DATABASE_PASSWORD: "provided-by-secret-store"
```

The container can read that password through one explicit Secret reference:

```yaml
env:
  - name: DATABASE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: DATABASE_PASSWORD
```

The Secret object gives the team a separate review and access boundary from ConfigMaps. Engineers can discuss `LOG_LEVEL` and provider URLs in ordinary pull requests, while production database credentials and signing keys need tighter permissions, audit trails, and rotation.

## What a Secret Stores
<!-- section-summary: Secrets store named sensitive values in a namespace and usually feed Pods through environment variables or files. -->

A Secret stores keys and values. The key names are application contracts such as `DATABASE_URL`, `WEBHOOK_SIGNING_KEY`, `tls.crt`, `tls.key`, or `.dockerconfigjson`. The values are the sensitive strings or bytes associated with those names.

For the Customer Notification Platform, `notification-api` needs a database URL to write notification requests. `notification-worker` needs an API token for an internal email gateway. Both values can grant access, so they should never live in a ConfigMap or ordinary committed YAML with live content.

Secrets are namespaced. A Pod in `customer-notifications-staging` references a staging Secret in that namespace. A production Pod references a production Secret in the production namespace. This namespace boundary helps keep staging credentials from accidentally reaching production workloads.

Secrets are small objects. Kubernetes documents a 1 MiB limit per Secret, which is enough for credentials and certificates. Large customer exports, email templates, or provider datasets belong in object storage, a database, or another storage system designed for large content.

![Secret access boundary](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-secrets/secret-access-boundary.png)

*A Secret gives sensitive values their own Kubernetes object, RBAC surface, and rotation path.*

## Base64, stringData, and Encryption
<!-- section-summary: Base64 changes how Secret bytes are represented, while encryption at rest protects stored API data with an encryption provider. -->

Secret manifests can provide values through **data** or **stringData**. `data` stores base64-encoded values. `stringData` accepts ordinary strings, and the API server converts them into `data` when it stores the Secret.

Here is the same key through `data`:

```yaml
data:
  WEBHOOK_SIGNING_KEY: cHJvdmlkZWQtYnktZGVwbG95bWVudC1waXBlbGluZQ==
```

Anyone with read access to the Secret can decode that representation:

```bash
echo 'cHJvdmlkZWQtYnktZGVwbG95bWVudC1waXBlbGluZQ==' | base64 --decode
```

The output is the original value:

```console
provided-by-deployment-pipeline
```

Base64 helps bytes travel through YAML and JSON. **Encryption at rest** protects stored API data by using an encryption provider before the data is written to the backing store behind the Kubernetes API server. Managed Kubernetes platforms often expose this through a cloud KMS integration, and self-managed clusters configure it through the API server encryption configuration.

`stringData` is friendlier for generated manifests and examples:

```yaml
stringData:
  WEBHOOK_SIGNING_KEY: "provided-by-deployment-pipeline"
```

Kubernetes documentation notes that `stringData` does not work well with server-side apply. If your GitOps process uses server-side apply, test the workflow before choosing `stringData` as the main representation. Many teams avoid committing live Secret values at all and let a pipeline or controller create the Secret from a protected source.

## Secret Types
<!-- section-summary: Secret types describe the expected shape of sensitive data so Kubernetes and tools can handle common credential patterns. -->

Every Secret has a **type**. `Opaque` is the general type for application-defined keys such as `DATABASE_URL` and `WEBHOOK_SIGNING_KEY`. Kubernetes stores those values without special interpretation.

Built-in types help with common credential shapes:

| Type | Common use | Example in a notification platform |
|---|---|---|
| `Opaque` | Application-defined credentials | Database URL, webhook key, provider token |
| `kubernetes.io/tls` | TLS certificate and private key | Certificate for an internal webhook receiver |
| `kubernetes.io/dockerconfigjson` | Private image registry credentials | Pulling `notification-api` from a private registry |
| `kubernetes.io/basic-auth` | Username and password | Legacy provider integration that expects basic auth |
| `kubernetes.io/ssh-auth` | SSH private key | Automation that pulls private templates from Git |

The type communicates intent and can add validation for known shapes. A TLS Secret expects certificate and key fields. A Docker config Secret can be referenced through `imagePullSecrets` so kubelet can pull a private image.

The type alone does not provide operating discipline. A TLS private key still needs least-privilege RBAC, encryption at rest, controlled delivery, and rotation.

## Create a Secret Without Leaking Values
<!-- section-summary: Secret creation should be repeatable while keeping live values out of shell history, logs, and plain source control. -->

For a local practice namespace, you can create a Secret from literals:

```bash
kubectl create secret generic notification-api-secrets \
  --namespace customer-notifications \
  --from-literal=DATABASE_URL='postgresql://notification_app:example@postgres:5432/notifications' \
  --from-literal=WEBHOOK_SIGNING_KEY='example-signing-key'
```

The command creates the object immediately:

```console
secret/notification-api-secrets created
```

For real credentials, literal flags can leave values in shell history, terminal scrollback, process inspection, or CI logs. A safer pipeline reads from a protected CI secret store, a cloud secret manager, a sealed/encrypted manifest, or a controller such as External Secrets Operator.

When you only need a reviewed object shape, generate YAML with placeholders:

```bash
kubectl create secret generic notification-api-secrets \
  --namespace customer-notifications \
  --from-literal=DATABASE_URL='provided-by-deployment-pipeline' \
  --from-literal=WEBHOOK_SIGNING_KEY='provided-by-deployment-pipeline' \
  --dry-run=client \
  -o yaml
```

Reviewers can discuss key names, namespace, labels, and delivery wiring without seeing live values. The release path then supplies the real content through an approved secret workflow.

## Deliver Secrets as Environment Variables
<!-- section-summary: secretKeyRef puts one Secret key into one environment variable, which is simple but fixed for the lifetime of the container. -->

Many application frameworks read credentials from environment variables. `notification-api` might read `process.env.DATABASE_URL` during startup and initialize its database pool before serving requests.

Wire one Secret key explicitly:

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: DATABASE_URL
```

Then add the signing key:

```yaml
env:
  - name: WEBHOOK_SIGNING_KEY
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: WEBHOOK_SIGNING_KEY
```

Explicit `secretKeyRef` is usually better than `envFrom` for sensitive values. Reviewers can see exactly which credentials enter the process, and a future key added to the Secret does not automatically enter the container environment.

Environment variables are captured when the container starts. If `DATABASE_URL` changes, the running process keeps the old value until the Pod restarts. A Secret rotation plan should include a rollout command or an application reload path.

## Mount Secrets as Files
<!-- section-summary: Secret volumes fit certificates, keys, and tools that expect credentials at file paths instead of environment variables. -->

Some credentials work better as files. TLS certificates, private keys, service account JSON files, and provider config bundles often have file formats that libraries already understand.

A Secret volume turns keys into files:

```yaml
volumes:
  - name: notification-webhook-tls
    secret:
      secretName: notification-webhook-tls
containers:
  - name: api
    volumeMounts:
      - name: notification-webhook-tls
        mountPath: /etc/notification/tls
        readOnly: true
```

Inside the container, Kubernetes exposes files such as `/etc/notification/tls/tls.crt` and `/etc/notification/tls/tls.key`. The application can read a certificate and key from disk without receiving them as environment variables.

You can select specific keys and file names with `items`:

```yaml
secret:
  secretName: notification-webhook-tls
  items:
    - key: tls.crt
      path: server.crt
    - key: tls.key
      path: server.key
```

Secret volumes can update after the kubelet refreshes the projected content, except when mounted through `subPath`. Applications still need a reload mechanism to reopen changed files. Certificate rotation often pairs file delivery with a controller or sidecar that signals the application.

![Secret delivery patterns](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-secrets/secret-delivery-patterns.png)

*Environment variables fit startup credentials, while mounted files fit certificates and tools that already read credential files.*

## RBAC, ServiceAccounts, and Namespaces
<!-- section-summary: Secret safety depends on who can read the object, which ServiceAccount runs the Pod, and where the Secret lives. -->

**RBAC** controls which users, groups, and ServiceAccounts can read or modify Secrets. A person or workload with `get` access to a Secret can recover its values, so read permissions should be narrow and intentional.

A common production pattern gives deploy tooling permission to create or update Secrets, while application Pods only reference the Secret. The application container does not need Kubernetes API permission to read the Secret object after kubelet has mounted or injected the value.

Use a dedicated ServiceAccount for each workload:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: notification-api
  namespace: customer-notifications
```

Then attach it to the Deployment:

```yaml
spec:
  template:
    spec:
      serviceAccountName: notification-api
```

This keeps API permissions separate from the Secret delivery path. If `notification-worker` needs to list jobs but `notification-api` does not, their ServiceAccounts can carry different RBAC roles.

Namespaces also limit accidental reference. A Pod can reference a Secret only in its own namespace. That simple rule prevents a staging Deployment from directly mounting a production Secret by name.

## Encryption at Rest and External Stores
<!-- section-summary: Kubernetes can store Secrets more safely with encryption at rest, while external stores centralize credential ownership and rotation. -->

Kubernetes stores Secret objects through the API server. In a self-managed cluster, that usually means etcd. In managed Kubernetes, the provider runs the control plane storage. Encryption at rest protects stored API data so plain Secret values are not sitting unprotected in the backing store.

Encryption at rest does not remove the need for RBAC. A user with Kubernetes read permission still receives the decrypted Secret value through the API. Treat encryption at rest as storage protection, then use RBAC, audit logging, and namespace boundaries for access control.

Many production teams keep the source of truth outside Kubernetes. External Secrets Operator can sync from AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, and similar systems into Kubernetes Secrets. Secrets Store CSI Driver can mount external secrets into Pods as files.

The practical choice depends on how the application reads credentials. If the app expects environment variables, syncing into Kubernetes Secrets can be simpler. If the app can read files and the security team wants provider-backed delivery, a CSI-mounted file pattern can fit better.

## Rotation Runbook
<!-- section-summary: Secret rotation needs a planned sequence so old and new credentials overlap safely and Pods refresh predictably. -->

**Rotation** means replacing a credential before an incident or after exposure. A reliable rotation plan names the owner, the source of truth, the Kubernetes object, the restart behavior, and the verification command.

For `WEBHOOK_SIGNING_KEY`, a safe runbook often uses overlap:

1. Add a new signing key to the provider or receiving service.
2. Update the source secret store with the new key.
3. Sync or apply the Kubernetes Secret.
4. Restart `notification-api` so the process reads the new value.
5. Verify new callbacks succeed.
6. Remove the old key after the overlap window.

The rollout command is simple, and it should be part of the runbook:

```bash
kubectl rollout restart deployment/notification-api -n customer-notifications
kubectl rollout status deployment/notification-api -n customer-notifications
```

A completed rollout should report success:

```console
deployment "notification-api" successfully rolled out
```

Rotating a database password can require two valid passwords at once, a user rename, or a connection pool drain. The exact sequence belongs to the database and application design, but Kubernetes still needs the same final step: update the Secret and restart or reload the Pods that use it.

![Secret rotation runbook](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-secrets/secret-rotation-runbook.png)

*A Secret rotation path should show the external source, Kubernetes object, Pod refresh, and post-rotation verification.*

## Leak Prevention
<!-- section-summary: Secrets often leak through diagnostics, logs, copied manifests, and broad permissions rather than through the Secret object alone. -->

Secret handling should assume that the value can leak anywhere it is printed. Avoid logging full environment dumps. Avoid `kubectl describe pod` screenshots that include sensitive environment variable names paired with accidental values from other tooling. Avoid copying decoded Secret values into chat.

Build small safe diagnostics instead. `notification-api` can log whether required credentials are present, the credential source name, and a fingerprint that cannot recover the secret. For example, a SHA-256 prefix of a public certificate can help identify which certificate loaded without exposing the private key.

Keep terminal commands out of shell history when live values are involved. Prefer reading from protected files or provider CLIs that avoid printing the value. In CI, mark secret variables as masked and check that command traces do not echo them.

## Troubleshoot Missing or Stale Secrets
<!-- section-summary: Secret failures usually appear as Pod events, CreateContainerConfigError, stale environment variables, or application startup errors. -->

When a Pod cannot start due to a missing Secret or key, Kubernetes records the reason in Pod events. Start with `kubectl describe pod`:

```bash
kubectl describe pod notification-api-7f9c5dfb7d-h6x42 -n customer-notifications
```

A missing key event looks similar to this:

```console
Warning  Failed  kubelet  Error: couldn't find key DATABASE_URL in Secret customer-notifications/notification-api-secrets
```

Next, check whether the Secret exists and which keys it has. The command below shows keys without printing decoded values:

```bash
kubectl get secret notification-api-secrets \
  -n customer-notifications \
  -o jsonpath='{.data}'
```

For stale values, check the delivery path. Environment variables require a Pod restart. Mounted Secret files can update after kubelet refreshes the volume, but applications often need a reload or restart to reopen the file.

## Assembled Example
<!-- section-summary: The full pattern combines a Secret, a dedicated ServiceAccount, and explicit environment wiring after the pieces are understood. -->

Here is the assembled pattern with placeholder values. In production, the live Secret values should come from the approved secret workflow, not from this manifest with real credentials.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-api-secrets
  namespace: customer-notifications
type: Opaque
stringData:
  DATABASE_URL: "provided-by-deployment-pipeline"
  WEBHOOK_SIGNING_KEY: "provided-by-deployment-pipeline"
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: notification-api
  namespace: customer-notifications
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
      serviceAccountName: notification-api
      containers:
        - name: api
          image: ghcr.io/customer-notifications/notification-api:1.8.0
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-api-secrets
                  key: DATABASE_URL
            - name: WEBHOOK_SIGNING_KEY
              valueFrom:
                secretKeyRef:
                  name: notification-api-secrets
                  key: WEBHOOK_SIGNING_KEY
```

This example keeps the credential contract visible. A complete production Deployment would also include probes, resource requests, security context, and rollout controls.

## Review Checklist
<!-- section-summary: A Secret review checks source of truth, access, delivery, refresh behavior, rotation, and leak prevention. -->

Use this checklist before merging or applying a Secret change:

| Check | What to confirm |
|---|---|
| Source of truth | The real value comes from a protected store, encrypted manifest, or controlled pipeline |
| RBAC | Only approved users, controllers, and deployment tools can read or modify the Secret |
| Delivery | The Pod receives only the keys it needs through explicit references or selected files |
| Refresh | The runbook restarts or reloads Pods after rotation |
| Encryption | Cluster Secret encryption at rest is enabled where the platform supports it |
| Diagnostics | Logs and commands prove presence without printing values |
| Rotation | The owner, overlap window, verification command, and rollback step are documented |

**References**

- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Encrypt Secret data at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Configure Pods to use Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/)
