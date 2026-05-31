---
title: "Secrets"
description: "Use Kubernetes Secrets to deliver sensitive application values without baking credentials into images or plain manifests."
overview: "Secrets separate sensitive runtime values from ordinary configuration, but they still need RBAC, careful diagnostics, and a rotation plan."
tags: ["kubernetes", "secrets", "rbac", "credentials"]
order: 2
id: article-containers-orchestration-kubernetes-configuration-storage-secrets
---

## Table of Contents

1. [Sensitive Configuration Needs a Different Boundary](#sensitive-configuration-needs-a-different-boundary)
2. [Creating an Opaque Secret Manifest](#creating-an-opaque-secret-manifest)
3. [Passing Secret Values to the Container](#passing-secret-values-to-the-container)
4. [Mounting Secrets as Files](#mounting-secrets-as-files)
5. [Failure Mode: Secret Not Found or Key Missing](#failure-mode-secret-not-found-or-key-missing)
6. [RBAC and Namespace Risk](#rbac-and-namespace-risk)
7. [Rotation Without Guesswork](#rotation-without-guesswork)
8. [When to Use an External Secret Store](#when-to-use-an-external-secret-store)
9. [Preventing Secret Values from Escaping](#preventing-secret-values-from-escaping)
10. [Separating Secrets by Purpose](#separating-secrets-by-purpose)

## Sensitive Configuration Needs a Different Boundary

Some configuration values are just preferences. A log level, a public service URL, or a feature flag can be reviewed in normal YAML. Other values are credentials. A database password, API token, private key, or webhook signing secret can let someone act as your service. Those values need a stricter boundary.

A Kubernetes Secret is a namespaced API object for small pieces of sensitive data. It exists so credentials do not have to be baked into images, committed into Deployment manifests, or passed around in chat messages. The Pod can still receive the value, but the source object is labeled as sensitive and can be protected with separate RBAC rules.

The running example is `devpolaris-orders-api`, which connects to PostgreSQL and signs internal webhook callbacks. The app needs `DATABASE_URL` and `WEBHOOK_SIGNING_KEY`. Both values would be dangerous in a ConfigMap because they grant access to systems outside the Pod.

```mermaid
flowchart TD
    A["Secret<br/>database and signing credentials"] --> B["Pod spec<br/>references by name"]
    B --> C["Kubelet<br/>starts container"]
    C --> D["orders-api process<br/>receives env or files"]
    E["RBAC rules"] -.-> A
    F["etcd encryption<br/>cluster setting"] -.-> A
```

A Secret is not a complete secret-management system by itself. It is an API object with special intent and special handling paths. You still need least-privilege RBAC, encryption at rest for cluster data, careful logging, and often an external secret manager for production rotation.

## Creating an Opaque Secret Manifest

An Opaque Secret is the generic Secret type for application-defined sensitive strings. Kubernetes stores the keys and values, but it does not interpret what those keys mean. Your application and your team decide that `DATABASE_URL` is a database connection string and `WEBHOOK_SIGNING_KEY` is the value used to verify webhook callbacks.

For GitOps-style review, teams often avoid committing real Secret values. The manifest below shows the shape only. In a real production repository, your sealed secret tool, external secrets operator, or CI secret injection process would provide the actual data.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-secrets
  namespace: devpolaris-staging
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
type: Opaque
stringData:
  DATABASE_URL: "postgresql://orders_app:replace-me@postgres.devpolaris-staging.svc.cluster.local:5432/orders"
  WEBHOOK_SIGNING_KEY: "replace-me-with-a-generated-key"
```

`stringData` lets humans provide ordinary strings in a manifest. The Kubernetes API stores the resulting Secret data in the Secret object. You will also see `data`, where values are base64-encoded strings. Base64 is an encoding, not encryption. Anyone who can read the Secret can decode it.

```bash
$ echo 'cG9zdGdyZXNxbDovL29yZGVyc19hcHA6...' | base64 --decode
postgresql://orders_app:example@postgres.devpolaris-staging.svc.cluster.local:5432/orders
```

That output is why you should not treat base64 as protection. The protection comes from who can read the object, how the API server stores it, and how carefully the value is delivered to the process.

## Passing Secret Values to the Container

A Secret can reach a container as environment variables or as mounted files. Environment variables are simple for many application frameworks because the code already reads `process.env.DATABASE_URL`.

Example: the orders API can read `DATABASE_URL` from `process.env`, while Kubernetes fills that variable from `orders-api-secrets`. The cost is that the value becomes part of the process environment, so you need to be careful with debug dumps and crash reports.

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
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-api-secrets
                  key: DATABASE_URL
            - name: WEBHOOK_SIGNING_KEY
              valueFrom:
                secretKeyRef:
                  name: orders-api-secrets
                  key: WEBHOOK_SIGNING_KEY
```

The reference is explicit. Kubernetes does not copy all keys unless you ask for that with `envFrom`. For secrets, explicit keys are usually better because they document exactly which credentials the container expects.

You can verify the wiring without printing the secret value. Prefer checking that the environment variable exists or that the application logs a redacted configuration summary.

```bash
$ kubectl logs deploy/orders-api -n devpolaris-staging | grep 'secrets loaded' | tail -1
2026-05-07T11:02:18.447Z INFO secrets loaded databaseUrl=present webhookSigningKey=present
```

If your verification command prints the real password into your terminal history or CI logs, the diagnostic step has created a new incident. For secret diagnostics, prove presence and identity without exposing value.

## Mounting Secrets as Files

File mounts are useful when a library expects a certificate, token, or key at a path. TLS clients, cloud SDKs, and legacy tools often prefer files over environment variables. Kubernetes can project Secret keys into a read-only directory in the container.

```yaml
volumes:
  - name: webhook-keys
    secret:
      secretName: orders-api-secrets
      items:
        - key: WEBHOOK_SIGNING_KEY
          path: webhook-signing-key
containers:
  - name: api
    image: ghcr.io/devpolaris/orders-api:1.18.0
    volumeMounts:
      - name: webhook-keys
        mountPath: /var/run/secrets/devpolaris
        readOnly: true
```

Inside the container, the application reads `/var/run/secrets/devpolaris/webhook-signing-key`. The path choice matters. Put mounted credentials under a directory that clearly signals sensitive runtime material, not beside ordinary application files where someone might accidentally package or serve them.

```bash
$ kubectl exec deploy/orders-api -n devpolaris-staging -- ls -l /var/run/secrets/devpolaris
total 0
-rw-r--r-- 1 root root 42 May  7 11:08 webhook-signing-key
```

Do not rely only on file permissions for secrecy inside a container. Any process running as the same user and able to read the path can read the value. The stronger boundary is to mount only the Secret keys that container needs and avoid sharing the same Secret across unrelated containers.

## Failure Mode: Secret Not Found or Key Missing

Missing Secret references fail before the application starts, just like missing ConfigMaps. This is good. Kubernetes is telling you it cannot assemble the container configuration.

```bash
$ kubectl get pods -n devpolaris-staging
NAME                         READY   STATUS                       RESTARTS   AGE
orders-api-5f78575d6-7b2mx   0/1     CreateContainerConfigError   0          31s

$ kubectl describe pod orders-api-5f78575d6-7b2mx -n devpolaris-staging
Events:
  Type     Reason  Age   From     Message
  Warning  Failed  30s   kubelet  Error: secret "orders-api-secrets" not found
```

If the object exists but the key is missing, the event changes slightly.

```text
Error: couldn't find key WEBHOOK_SIGNING_KEY in Secret devpolaris-staging/orders-api-secrets
```

The diagnostic path is to inspect object existence first, then keys, then the rollout.

```bash
$ kubectl get secret orders-api-secrets -n devpolaris-staging
NAME                 TYPE     DATA   AGE
orders-api-secrets   Opaque   1      12m

$ kubectl get secret orders-api-secrets -n devpolaris-staging -o jsonpath='{.data}'
{"DATABASE_URL":"cG9zdGdyZXNxbDovLy4uLg=="}
```

The `DATA` column says there is one key, but the Deployment expects two. Add the missing key through your approved secret process, then restart or let the Deployment recover as new Pods are created.

## RBAC and Namespace Risk

RBAC is the Kubernetes permission system that controls who can read or change API objects. For Secrets, the most important security detail is easy to miss: anyone who can create a Pod in a namespace may be able to mount Secrets in that namespace, depending on admission controls and policies.

Example: a user who cannot run `kubectl get secret orders-api-secrets` might still create a Pod that references that Secret and prints the value, unless policy blocks that path. Secret access includes direct reads such as `kubectl get secret` and workload scheduling that asks Kubernetes to inject the Secret.

For `devpolaris-orders-api`, the service account that deploys staging should not automatically control production. The namespace split helps, but RBAC must match it.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-api-secret-reader
  namespace: devpolaris-staging
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["orders-api-secrets"]
    verbs: ["get"]
```

This Role limits reads to one Secret name in one namespace. In many clusters, application Pods do not need direct API read access to their own Secret object because the kubelet injects the value at startup. Human operators and controllers may need read or update access, and those permissions should stay narrow.

Review RBAC with a concrete question: who can cause this Secret to be delivered to a process? That includes direct readers, deployers who can edit the Deployment, and controllers that can create Pods.

## Rotation Without Guesswork

Secret rotation means replacing a credential before it is abused, expires, or blocks an incident response. The backing database, API provider, or signing system must accept the new value, the Kubernetes object must change, and the application Pods must use it.

A safe rotation for `DATABASE_URL` usually has two phases. First, create a new database user or password while the old one still works. Update the Secret and roll the Deployment. Verify new Pods connect successfully. Then revoke the old credential after traffic has moved.

```text
Rotation record
1. Created database user orders_app_2026_05.
2. Updated orders-api-secrets DATABASE_URL in devpolaris-staging.
3. Restarted deployment/orders-api.
4. Verified new connections use orders_app_2026_05.
5. Revoked old user orders_app_2026_02.
```

The failure shape is usually an authentication loop after rollout.

```text
2026-05-07T11:33:51.904Z ERROR database connection failed
code=28P01 message="password authentication failed for user orders_app"
```

Diagnose both sides. Check that the Secret contains the new credential, that the Pod restarted after the update, and that the database actually accepts the new user. If only one side changed, the application will keep failing even though Kubernetes looks healthy.

## When to Use an External Secret Store

An external secret store is a dedicated system for storing, rotating, auditing, and delivering credentials outside the Kubernetes API. Kubernetes Secrets are useful, but many production teams connect them to a cloud secret manager, Vault, or a managed platform feature.

Example: the production database password can live in a cloud secret manager, while Kubernetes receives only the synchronized or short-lived material needed by Pods.

The tradeoff is operational complexity. External secret systems add controllers, identity wiring, network paths, and failure modes. They also give you stronger audit trails, centralized rotation, and less pressure to store long-lived credentials directly in cluster state.

| Approach | Good For | Main Risk |
|----------|----------|-----------|
| Plain Kubernetes Secret | Small clusters and simple apps | Weak process around rotation and access |
| Sealed or encrypted manifests | GitOps workflows | Key management becomes critical |
| External secret operator | Centralized secret lifecycle | Controller or identity failure can block updates |
| Runtime identity | Cloud APIs without static keys | Requires platform-specific setup |

For `devpolaris-orders-api`, a Kubernetes Secret is enough to learn the mechanics. For production, the stronger target is usually an external store plus workload identity, so Pods receive only what they need and humans do not handle raw credentials during normal deploys.

## Preventing Secret Values from Escaping

A Secret leak happens when a sensitive value leaves the narrow path where it is needed. Kubernetes can deliver the value to the container, but after that the application can still expose it through logs, errors, metrics labels, crash dumps, or support bundles.

The Secret object is one part of the secret's life. A safe Secret pattern includes Kubernetes YAML and application behavior.

For `devpolaris-orders-api`, a startup summary should say whether a secret is present, never what the secret is. That is enough for diagnostics and safe for logs.

```text
2026-05-07T11:45:19.118Z INFO sensitive configuration checked
databaseUrl=present webhookSigningKey=present clientCertificate=missing optionalPaymentProviderToken=missing
```

A bad log line includes the value or a long prefix of the value.

```text
2026-05-07T11:45:19.118Z ERROR database failed url=postgresql://orders_app:ProdPassword2026@postgres:5432/orders
```

If that appears in logs, rotate the credential and fix the logging code. Deleting the log line is incomplete because logs may have been forwarded to other systems, stored in search indexes, or copied into incident notes.

The same caution applies to `kubectl` commands. Use `kubectl describe secret` to inspect metadata and key count. Avoid `kubectl get secret -o yaml` in shared terminals unless you have a clear reason and a safe output path.

## Separating Secrets by Purpose

Separating Secrets by purpose means grouping credentials by the job they perform and the people or systems that rotate them. A single large Secret named `app-secrets` is easy at first and painful later. Every container that needs one key may receive many unrelated keys. Every rotation looks risky because the object holds several credentials with different owners and lifecycles.

Split Secrets by purpose when the values have different blast radius or rotation schedules. `devpolaris-orders-api` might use one Secret for database access and another for webhook signing.

```text
orders-api-database
  DATABASE_URL

orders-api-webhooks
  WEBHOOK_SIGNING_KEY
```

The Deployment then references each Secret explicitly.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: orders-api-database
        key: DATABASE_URL
  - name: WEBHOOK_SIGNING_KEY
    valueFrom:
      secretKeyRef:
        name: orders-api-webhooks
        key: WEBHOOK_SIGNING_KEY
```

The tradeoff is more objects to manage. The benefit is cleaner ownership. Rotating the webhook signing key does not require touching the database credential object, and RBAC can be narrower when different controllers own different secrets.

A final safe verification pattern is to check length or presence inside application code and emit only redacted status.

```text
2026-05-07T11:58:33.412Z INFO secret validation passed databaseUrl=present webhookSigningKeyLength=44
```

Even length can be sensitive for some systems, so use it only when it helps catch malformed values and your team accepts the exposure.

---

**References**

- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official concept page for Secret types, storage cautions, and Pod usage patterns.
- [Good Practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) - Official security guidance for reducing Secret exposure and RBAC risk.
- [Troubleshooting Applications](https://kubernetes.io/docs/tasks/debug/debug-application/) - Official debugging entry point for inspecting Pods, events, logs, and application failures.
