---
title: "Secrets"
description: "Use Kubernetes Secrets to deliver sensitive application values without baking credentials into images or plain manifests."
overview: "Secrets separate sensitive runtime values from ordinary configuration, but they still need RBAC, careful diagnostics, and a rotation plan."
tags: ["kubernetes", "secrets", "rbac", "credentials"]
order: 2
id: article-containers-orchestration-kubernetes-configuration-storage-secrets
---
## Table of Contents

1. [Sensitive Values Need Their Own Path](#sensitive-values-need-their-own-path)
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
15. [References](#references)

## Sensitive Values Need Their Own Path
<!-- section-summary: A Secret gives sensitive runtime values a separate Kubernetes object and delivery path from ordinary ConfigMap settings. -->

Ordinary runtime settings can live outside the container image in ConfigMaps. Sensitive runtime values need another boundary because a database URL, provider token, webhook signing key, private registry credential, or TLS private key can grant access to real systems.

A **Secret** is the Kubernetes object for sensitive runtime values. The credential is stored as its own object first, then the Pod receives selected keys through delivery paths such as environment variables or mounted files. A Secret gives the value a separate RBAC surface and a clearer rotation path. It still needs encryption at rest where the platform supports it, careful diagnostics, and a plan for replacing the value.

For the Customer Notification Platform, `LOG_LEVEL` belongs in a ConfigMap, while `DATABASE_URL` or `WEBHOOK_SIGNING_KEY` belongs in a Secret. The boundary is practical: what a Secret protects, what it still exposes to people with read access, how Pods receive selected keys, and how teams rotate and troubleshoot values without printing them.

A database password is a clear first credential. The `notification-api` process needs it before it can connect to PostgreSQL. The password should stay out of the image and out of the Deployment manifest. The Secret gives the release path a named place for the value and gives the Pod a controlled reference to it.

Here is the smallest safe Secret shape, using a placeholder instead of a real password. In a real production workflow, a protected secret process or external secret manager supplies this value; a live password should not be committed to Git.

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

This Secret shape has four important details:

- `kind: Secret` gives sensitive values their own Kubernetes object and access-control surface.
- `type: Opaque` fits ordinary app credentials that do not use a specialized Secret type.
- `stringData` accepts plain strings at apply time, then the API server stores them under `data`.
- The placeholder shows the key contract without committing a live password.

The container can read that password through one explicit Secret reference:

```yaml
env:
  - name: DATABASE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: DATABASE_PASSWORD
```

This reference keeps the sensitive value out of the Deployment body:

- `name: DATABASE_PASSWORD` is the environment variable the application reads.
- `secretKeyRef.name` and `secretKeyRef.key` identify the Secret object and the exact key Kubernetes should inject.

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

This part matters because beginners often see base64 in a Secret and assume it is protection. Base64 is only a representation that lets bytes move through YAML and JSON cleanly. The protection comes from who can view the Secret, whether the API server encrypts stored Secret data, and how the real value enters the cluster through the release process.

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

The important detail is where the real value comes from:

- `stringData` is convenient input syntax for the API server.
- The production value should still come from a protected pipeline, encrypted workflow, or external secret manager.

Kubernetes documentation notes that `stringData` can be a poor fit for server-side apply. If your GitOps process uses server-side apply, test the workflow before choosing `stringData` as the main representation. Many teams avoid committing live Secret values at all and let a pipeline or controller create the Secret from a protected source.

## Secret Types
<!-- section-summary: Secret types describe the expected shape of sensitive data so Kubernetes and tools can handle common credential patterns. -->

Every Secret has a **type**. `Opaque` is the general type for application-defined keys such as `DATABASE_URL` and `WEBHOOK_SIGNING_KEY`. Kubernetes stores those values without special interpretation.

Types help Kubernetes and humans understand the expected key shape. The notification platform uses ordinary application credentials for database and provider access, so `Opaque` is enough for many values. TLS material and registry credentials have common formats, so Kubernetes gives those shapes named types that tools can recognize during validation, image pulls, or certificate delivery.

Built-in types help with common credential shapes:

| Type | Common use | Example in a notification platform |
|---|---|---|
| `Opaque` | Application-defined credentials | Database URL, webhook key, provider token |
| `kubernetes.io/tls` | TLS certificate and private key | Certificate for an internal webhook receiver |
| `kubernetes.io/dockerconfigjson` | Private image registry credentials | Pulling `notification-api` from a private registry |
| `kubernetes.io/basic-auth` | Username and password | Legacy provider integration that expects basic auth |
| `kubernetes.io/ssh-auth` | SSH private key | Automation that pulls private templates from Git |

The type communicates intent and can add validation for known shapes. A TLS Secret expects certificate and key fields. A Docker config Secret can be referenced through `imagePullSecrets` so kubelet can pull a private image.

The type only communicates shape and intent. A TLS private key still needs least-privilege RBAC, encryption at rest, controlled delivery, and rotation.

## Create a Secret Without Leaking Values
<!-- section-summary: Secret creation should be repeatable while keeping live values out of shell history, logs, and plain source control. -->

For a local practice namespace, you can create a Secret from literals:

This command is fine for a disposable lesson because the values are examples. In shared environments, the creation path should avoid terminal history, CI logs, and committed plain text. The Kubernetes source object still needs stable key names, a namespace, and a repeatable creation flow, but the live values should come from a protected source that the team already audits.

Treat the command below as a way to learn the object shape. The production version should replace these literal examples with a controlled secret workflow.

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

This dry-run command is for reviewing shape:

- It prints the Secret manifest without creating the object in the cluster.
- The placeholders keep live credentials out of the generated YAML shown to reviewers.

Reviewers can discuss key names, namespace, labels, and delivery wiring without seeing live values. The release path then supplies the real content through an approved secret workflow.

## Deliver Secrets as Environment Variables
<!-- section-summary: secretKeyRef puts one Secret key into one environment variable, which is simple but fixed for the lifetime of the container. -->

Many application frameworks read credentials from environment variables. `notification-api` might read `process.env.DATABASE_URL` during startup and initialize its database pool before serving requests.

This delivery path is simple because the application already expects named strings at startup. The Secret remains the source object, and the Deployment selects only the keys the process needs. For credentials, that explicit selection helps review: `DATABASE_URL` and `WEBHOOK_SIGNING_KEY` enter the API container, while unrelated future keys stay out of the environment.

Wire one Secret key explicitly:

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: DATABASE_URL
```

This first key shows the database credential path:

- The application reads `DATABASE_URL` from the process environment.
- Kubernetes copies the value from the Secret at container startup, so rotation still needs a restart or reload plan.

Then add the signing key:

```yaml
env:
  - name: WEBHOOK_SIGNING_KEY
    valueFrom:
      secretKeyRef:
        name: notification-api-secrets
        key: WEBHOOK_SIGNING_KEY
```

The signing key follows the same delivery shape:

- The key name stays visible for review without exposing the value.
- The Secret can hold other keys later, but this container receives only the selected key.

Explicit `secretKeyRef` gives sensitive values a clearer review path than `envFrom`. Reviewers can see exactly which credentials enter the process, and a future key added to the Secret stays out of the container environment until the manifest references it.

Environment variables are captured when the container starts. If `DATABASE_URL` changes, the running process keeps the old value until the Pod restarts. A Secret rotation plan should include a rollout command or an application reload path.

## Mount Secrets as Files
<!-- section-summary: Secret volumes fit certificates, keys, and tools that expect credentials at file paths instead of environment variables. -->

Some credentials belong on disk. TLS certificates, private keys, service account JSON files, and provider config bundles often have file formats that libraries already understand.

A file mount keeps those formats intact and gives the application a normal path to read. The Secret still owns the sensitive bytes, the Pod volume projects selected keys, and the container mount chooses the directory. For the webhook example, the API can load a certificate pair from `/etc/notification/tls` while the image stays free of private key material.

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

The file delivery path has two pieces:

- `volumes[].secret.secretName` points to the Secret source object.
- `volumeMounts[].mountPath` chooses the directory the application reads inside the container.
- `readOnly: true` documents that the application should consume the credential, not write back to the projected volume.

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

The `items` list keeps the file contract narrow:

- `key` names the entry stored in the Secret.
- `path` names the file the application will see under the mounted directory.

Secret volumes can update after the kubelet refreshes the projected content, except when mounted through `subPath`. Applications still need a reload mechanism to reopen changed files. Certificate rotation often pairs file delivery with a controller or sidecar that signals the application.

![Secret delivery patterns](/content-assets/articles/article-containers-orchestration-kubernetes-configuration-storage-secrets/secret-delivery-patterns.png)

*Environment variables fit startup credentials, while mounted files fit certificates and tools that already read credential files.*

## RBAC, ServiceAccounts, and Namespaces
<!-- section-summary: Secret safety depends on who can access the object, which ServiceAccount runs the Pod, and where the Secret lives. -->

**RBAC** controls which users, groups, and ServiceAccounts can read or modify Secrets. A person or workload with `get` access to a Secret can recover its values, so read permissions should be narrow and intentional.

A common production pattern gives deploy tooling permission to create or update Secrets, while application Pods only reference the Secret. The application container can receive the mounted or injected value without Kubernetes API permission to fetch the Secret object.

Use a dedicated ServiceAccount for each workload:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: notification-api
  namespace: customer-notifications
```

The ServiceAccount gives the workload its own Kubernetes identity:

- `metadata.name` is the identity the Deployment will select.
- The namespace keeps that identity scoped beside the workload and its Secrets.

Then attach it to the Deployment:

```yaml
spec:
  template:
    spec:
      serviceAccountName: notification-api
```

The Deployment attachment makes the identity explicit:

- `serviceAccountName` applies to Pods created from this template.
- RBAC can grant this identity only the API permissions the workload actually needs.

This keeps API permissions separate from the Secret delivery path. If `notification-worker` needs to list jobs and `notification-api` only handles HTTP requests, their ServiceAccounts can carry different RBAC roles.

Namespaces also limit accidental reference. A Pod can reference a Secret only in its own namespace. That simple rule prevents a staging Deployment from directly mounting a production Secret by name.

## Encryption at Rest and External Stores
<!-- section-summary: Kubernetes can store Secrets more safely with encryption at rest, while external stores centralize credential ownership and rotation. -->

Kubernetes stores Secret objects through the API server. In a self-managed cluster, that usually means etcd. In managed Kubernetes, the provider runs the control plane storage. Encryption at rest protects stored API data so plain Secret values are not sitting unprotected in the backing store.

Encryption at rest protects stored API data, while RBAC still controls who can read decrypted values through the API. Treat encryption at rest as storage protection, then use RBAC, audit logging, and namespace boundaries for access control.

Many production teams keep the source of truth outside Kubernetes. External Secrets Operator can sync from AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, and similar systems into Kubernetes Secrets. Secrets Store CSI Driver can mount external secrets into Pods as files.

The practical choice depends on how the application reads credentials. If the app expects environment variables, syncing into Kubernetes Secrets can be simpler. If the app can read files and the security team wants provider-backed delivery, a CSI-mounted file pattern can fit the requirement.

## Rotation Runbook
<!-- section-summary: Secret rotation needs a planned sequence so old and new credentials overlap safely and Pods refresh predictably. -->

**Rotation** means replacing a credential before an incident or after exposure. A reliable rotation plan names the owner, the source of truth, the Kubernetes object, the restart behavior, and the verification command.

Rotation is a recovery lane, not just a YAML edit. The old credential often needs to stay valid long enough for all Pods, provider settings, and connection pools to move to the new value. The runbook below uses a webhook signing key because the overlap is easy to see: receivers can accept old and new keys for a short window while Kubernetes rolls new Pods.

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

When a Pod cannot start due to a missing Secret or key, Kubernetes records the reason in Pod events. The event usually names the missing Secret or key before the application process ever runs.

Troubleshooting Secrets should prove shape and delivery without exposing values. Inspect the Pod event first, then inspect key names on the source object, not decoded content. If the object exists and the key name matches, move to rollout behavior and application logs that confirm presence safely. A `kubectl describe pod` command gives that event evidence:

```bash
kubectl describe pod notification-api-7f9c5dfb7d-h6x42 -n customer-notifications
```

A missing key event looks similar to this:

```console
Warning  Failed  kubelet  Error: couldn't find key DATABASE_URL in Secret customer-notifications/notification-api-secrets
```

Next, check whether the Secret exists and which keys it has. The command below uses a Go template to print key names only, without decoded values and without base64 strings:

```bash
kubectl get secret notification-api-secrets \
  -n customer-notifications \
  -o go-template='{{range $key, $_ := .data}}{{printf "%s\n" $key}}{{end}}'
```

Example output:

```console
DATABASE_URL
WEBHOOK_SIGNING_KEY
```

For stale values, check the delivery path. Environment variables require a Pod restart. Mounted Secret files can update after kubelet refreshes the volume, but applications often need a reload or restart to reopen the file.

## Assembled Example
<!-- section-summary: The full pattern combines a Secret, a dedicated ServiceAccount, and explicit environment wiring after the pieces are understood. -->

Here is the assembled pattern with placeholder values. In production, the live Secret values should come from the approved secret workflow, not from this manifest with real credentials.

The full example ties together three separate responsibilities. The Secret defines the sensitive source object, the ServiceAccount gives the workload its own Kubernetes identity, and the Deployment selects the exact keys that enter the process. Reviewers can inspect the contract without seeing live values, while the release system supplies real credentials through the approved path.

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

The assembled manifest keeps three responsibilities visible:

- The Secret defines the sensitive keys without showing live values.
- The ServiceAccount gives the workload its own identity for RBAC review.
- The Deployment selects only the Secret keys the `notification-api` process needs.

This example keeps the credential contract visible. A complete production Deployment would also include probes, resource requests, security context, and rollout controls.

## Review Checklist
<!-- section-summary: A Secret review checks source of truth, access, delivery, refresh behavior, rotation, and leak prevention. -->

Use this checklist before merging or applying a Secret change:

The checklist exists because Secret mistakes often happen outside the Secret manifest itself. A secure review follows the value from its source of truth, through Kubernetes access control, into the Pod, through refresh behavior, and into diagnostics. That path catches broad RBAC, missing rotation steps, and unsafe log or terminal habits before a credential is exposed.

For `notification-api`, the review should prove that credentials can be delivered, rotated, and debugged without turning the review or incident channel into another place where secrets leak.

| Check | What to confirm |
|---|---|
| Source of truth | The real value comes from a protected store, encrypted manifest, or controlled pipeline |
| RBAC | Only approved users, controllers, and deployment tools can read or modify the Secret |
| Delivery | The Pod receives only the keys it needs through explicit references or selected files |
| Refresh | The runbook restarts or reloads Pods after rotation |
| Encryption | Cluster Secret encryption at rest is enabled where the platform supports it |
| Diagnostics | Logs and commands prove presence without printing values |
| Rotation | The owner, overlap window, verification command, and rollback step are documented |

## References

- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/)
- [Encrypt Secret data at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Configure Pods to use Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/)
