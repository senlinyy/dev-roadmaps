---
title: "Secrets"
description: "Use Kubernetes Secrets to deliver sensitive application values without baking credentials into images or plain manifests."
overview: "Secrets separate sensitive runtime values from ordinary configuration, but they still need RBAC, careful diagnostics, and a rotation plan."
tags: ["kubernetes", "secrets", "rbac", "credentials"]
order: 2
id: article-containers-orchestration-kubernetes-configuration-storage-secrets
---

## Table of Contents

1. [Why Credentials Need a Separate Boundary](#why-credentials-need-a-separate-boundary)
2. [What a Secret Stores](#what-a-secret-stores)
3. [Base64, stringData, and Encryption](#base64-stringdata-and-encryption)
4. [Secret Types](#secret-types)
5. [Creating the Orders API Secret](#creating-the-orders-api-secret)
6. [Delivering Secrets as Environment Variables](#delivering-secrets-as-environment-variables)
7. [Mounting Secrets as Files](#mounting-secrets-as-files)
8. [RBAC, ServiceAccounts, and Namespaces](#rbac-serviceaccounts-and-namespaces)
9. [Encryption at Rest and KMS](#encryption-at-rest-and-kms)
10. [External Secrets and CSI Driver Patterns](#external-secrets-and-csi-driver-patterns)
11. [Rotation Runbook](#rotation-runbook)
12. [Leak Prevention](#leak-prevention)
13. [Troubleshooting Missing Keys](#troubleshooting-missing-keys)
14. [Review Checklist](#review-checklist)

## Why Credentials Need a Separate Boundary
<!-- section-summary: Secrets hold values that can grant access, so they need stronger review, storage, delivery, and rotation controls than ConfigMaps. -->

The previous article used ConfigMaps for plain settings in `devpolaris-orders-api`: log level, feature flags, public service URLs, and timeout values. Those settings shape how the service behaves while carrying no ability to impersonate the service or connect to private systems by themselves.

Now the same application needs sensitive values. It connects to PostgreSQL with `DATABASE_URL`. It signs internal callbacks with `WEBHOOK_SIGNING_KEY`. It may use a private certificate to talk to another service. Those values can grant access, unlock data, or let an attacker pretend to be the orders API.

A **Kubernetes Secret** is a namespaced API object for small pieces of sensitive data such as passwords, tokens, keys, certificates, and registry credentials. A Secret lets the Pod receive the value without baking it into the container image and without placing it directly in the Deployment manifest.

That separate object changes the operational boundary. You can let many engineers review ConfigMap changes while giving only a smaller group access to Secret values. You can rotate a Secret without rebuilding the image. You can attach stricter RBAC to Secret reads. You can enable encryption at rest for API data stored by the control plane.

A Secret still needs care. Kubernetes can deliver sensitive values to containers, but the value can still leak through logs, debug commands, shell history, crash dumps, overly broad RBAC, and copied manifests. A Secret should be one layer in the credential workflow, with least privilege, encryption, external secret stores, and rotation around it.

## What a Secret Stores
<!-- section-summary: A Secret stores named sensitive values in a namespace and can be consumed by Pods as environment variables or files. -->

A Secret stores keys and values. The keys are names such as `DATABASE_URL`, `WEBHOOK_SIGNING_KEY`, `tls.crt`, or `.dockerconfigjson`. The values are the sensitive strings or bytes associated with those keys. Kubernetes stores the object through the API server and makes it available to Pods that reference it.

For `devpolaris-orders-api`, one Secret might contain the database connection string and the webhook signing key:

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

This example shows shape, names, and wiring. A real production repository should avoid committing live credentials in plain YAML. Teams usually create Secrets through a deployment pipeline, encrypt them before committing, or synchronize them from an external secret manager.

Secrets are namespaced, like ConfigMaps. A Pod in `devpolaris-staging` references a Secret in `devpolaris-staging`. A production Pod should reference a production Secret in `devpolaris-prod`. This matters because credentials usually have environment-specific blast radius. A staging database password should never work against production data.

Secrets are also small. Kubernetes limits individual Secret objects to 1 MiB. That limit is generous for passwords, tokens, keys, and certificates. Large private datasets, license bundles, or application content should live somewhere else and be fetched through a controlled runtime path.

## Base64, stringData, and Encryption
<!-- section-summary: Base64 is only a representation for Secret data, while encryption at rest is a cluster control that protects stored API data. -->

Secret manifests have two common fields for values: `data` and `stringData`. `data` stores base64-encoded strings. `stringData` lets you provide ordinary strings, and the Kubernetes API server merges them into `data` when it stores the Secret.

The same database URL can be represented through `data`. The value below is base64-encoded so it can fit safely in the API object:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-secrets
  namespace: devpolaris-staging
type: Opaque
data:
  DATABASE_URL: cG9zdGdyZXNxbDovL29yZGVyc19hcHA6cmVwbGFjZS1tZUBwb3N0Z3Jlcy5kZXZwb2xhcmlzLXN0YWdpbmcuc3ZjLmNsdXN0ZXIubG9jYWw6NTQzMi9vcmRlcnM=
```

That encoded value can be decoded by anyone who can read it. The command below proves the point without treating base64 as protection:

```bash
echo 'cG9zdGdyZXNxbDovL29yZGVyc19hcHA6cmVwbGFjZS1tZUBwb3N0Z3Jlcy5kZXZwb2xhcmlzLXN0YWdpbmcuc3ZjLmNsdXN0ZXIubG9jYWw6NTQzMi9vcmRlcnM=' | base64 --decode
```

Base64 changes how bytes are represented so they fit safely into YAML and JSON. **Encryption** uses a key and an encryption provider so stored data requires decryption before plain reading. These two ideas solve different problems. Base64 helps serialization. Encryption at rest helps protect stored API data, usually in etcd or the managed control plane storage behind the API server.

`stringData` is friendlier for hand-written examples and pipeline-generated manifests:

```yaml
stringData:
  DATABASE_URL: "postgresql://orders_app:replace-me@postgres.devpolaris-staging.svc.cluster.local:5432/orders"
```

The tradeoff is workflow compatibility. Kubernetes documentation notes that `stringData` has issues with server-side apply. If your GitOps or deployment tool relies on server-side apply, test the behavior before standardizing on `stringData`. Many teams avoid the issue by using external secret tools or generators rather than committing raw Secret manifests.

The safe production habit is simple: assume anyone who can read the Secret object can recover the secret value. Production teams protect access to the object, protect API storage, and keep the value out of places that outlive the reason someone viewed it.

## Secret Types
<!-- section-summary: Secret types tell Kubernetes and tools what kind of sensitive data a Secret is meant to hold. -->

Every Secret has a `type`. The generic type is **Opaque**, which means Kubernetes stores application-defined keys and values without interpreting them. `orders-api-secrets` is an Opaque Secret because `DATABASE_URL` and `WEBHOOK_SIGNING_KEY` are keys defined by the application team.

Kubernetes also has built-in Secret types for common situations:

| Type | Common use | Practical note |
|---|---|---|
| `Opaque` | Application-defined credentials | Good for `DATABASE_URL`, API tokens, signing keys, and custom config files |
| `kubernetes.io/dockerconfigjson` | Private registry pull credentials | Usually referenced through `imagePullSecrets` |
| `kubernetes.io/tls` | TLS certificate and private key | Expects keys such as `tls.crt` and `tls.key` |
| `kubernetes.io/basic-auth` | Basic auth username and password | Useful when a tool expects this convention |
| `kubernetes.io/ssh-auth` | SSH private key | Often used by automation that pulls from private Git or SSH targets |
| `kubernetes.io/service-account-token` | Long-lived service account token Secret | Legacy pattern; projected, short-lived service account tokens are preferred for Pods |
| `bootstrap.kubernetes.io/token` | Cluster bootstrap token | Used by Kubernetes node bootstrap workflows |

Types help validation and tooling. For example, a TLS Secret communicates that the data is a certificate and key pair. An image pull Secret tells Kubernetes how to authenticate to a private registry. An Opaque Secret keeps things flexible for application-specific values.

The type only adds structure. A TLS private key in a `kubernetes.io/tls` Secret still needs the same protection as any other private key. RBAC, encryption at rest, careful delivery, and rotation provide the operating discipline.

## Creating the Orders API Secret
<!-- section-summary: Secret creation should preserve repeatability while keeping live values out of plain source control and shared logs. -->

For local practice or a throwaway namespace, `kubectl create secret generic` can create an Opaque Secret from literals:

```bash
kubectl create secret generic orders-api-secrets \
  --namespace devpolaris-staging \
  --from-literal=DATABASE_URL='postgresql://orders_app:replace-me@postgres.devpolaris-staging.svc.cluster.local:5432/orders' \
  --from-literal=WEBHOOK_SIGNING_KEY='replace-me-with-a-generated-key'
```

For a repeatable workflow, generated YAML gives reviewers the object shape before anything is applied:

```bash
kubectl create secret generic orders-api-secrets \
  --namespace devpolaris-staging \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=WEBHOOK_SIGNING_KEY="$WEBHOOK_SIGNING_KEY" \
  --dry-run=client \
  -o yaml
```

Be careful with terminal history and CI logs. Passing a live value through `--from-literal` can leave it in shell history, process lists, audit logs, or build logs depending on the environment. For real credentials, a safer pattern is to read from protected files, a CI secret store, a cloud secret manager, or an operator that talks to the external provider.

The manifest below is useful as a schema example for reviewers:

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
  DATABASE_URL: "provided-by-deployment-pipeline"
  WEBHOOK_SIGNING_KEY: "provided-by-deployment-pipeline"
```

In a GitOps repository, live credentials usually need one of these production patterns:

| Pattern | How it works | When it fits |
|---|---|---|
| Encrypted Secret manifest | Values are encrypted before commit and decrypted by an approved controller or pipeline | Teams that want Git review for every secret object shape |
| External Secrets Operator | A controller syncs values from a secret manager into Kubernetes Secrets | Teams using AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Vault, or similar systems |
| Secrets Store CSI Driver | A CSI volume mounts external secrets into Pods as files | Workloads that can read credentials from files and want provider-backed delivery |
| CI/CD injection | Pipeline creates or updates the Secret during deployment | Smaller teams with strong CI permissions and limited GitOps requirements |

One consistent pattern matters more than tool variety. Most Secret incidents happen when every service invents its own secret path and nobody knows where the live value came from.

## Delivering Secrets as Environment Variables
<!-- section-summary: Environment-variable delivery is simple, but values stay fixed until restart and can leak through process diagnostics. -->

Many frameworks expect credentials in environment variables. The orders API can read `process.env.DATABASE_URL` and `process.env.WEBHOOK_SIGNING_KEY` during startup. Kubernetes fills those values from `secretKeyRef`.

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

This explicit style is usually better than `envFrom` for Secrets. Reviewers can see exactly which credentials the container receives. It also avoids accidentally injecting a future key into the process environment just because someone added it to the Secret.

Environment variables are read when the container starts. Updating the Secret object leaves the environment of an already running process unchanged. If `DATABASE_URL` changes, restart the Pods:

```bash
kubectl rollout restart deployment/orders-api -n devpolaris-staging
kubectl rollout status deployment/orders-api -n devpolaris-staging
```

The main risk with environment variables is accidental exposure. Debug code that prints all environment variables will print credentials. Some crash-reporting tools capture process environments. A human might run `printenv` during an incident and paste the output into a ticket. For Secret diagnostics, prove presence without displaying value.

An application startup log can say this:

```bash
2026-06-16T10:14:03.551Z INFO secret configuration loaded databaseUrl=present webhookSigningKey=present
```

That log tells operators the Secret was wired without revealing the database password or signing key.

## Mounting Secrets as Files
<!-- section-summary: File delivery is useful for certificates, keys, and tools that expect credentials at paths. -->

Some libraries expect credentials in files. TLS clients often expect certificate files. Cloud SDKs may read a token file. Legacy tools may read a config file from a fixed path. Kubernetes can project Secret keys into a read-only volume where each key appears as a file.

Here is a Secret with a CA certificate and client key shape:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-client-tls
  namespace: devpolaris-staging
type: kubernetes.io/tls
data:
  tls.crt: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==
  tls.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCg==
```

The Deployment mounts those keys as files:

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
          volumeMounts:
            - name: client-tls
              mountPath: /var/run/orders-api/tls
              readOnly: true
      volumes:
        - name: client-tls
          secret:
            secretName: orders-api-client-tls
            defaultMode: 0400
            items:
              - key: tls.crt
                path: tls.crt
              - key: tls.key
                path: tls.key
```

The file mode `0400` gives the owner read permission and keeps the file tighter than the default. Your container user and security context must still match the permissions you choose. If the app runs as a non-root UID, test that the process can read the mounted files.

Mounted Secret volumes can receive updated content after the Secret changes, but there can be kubelet cache delay. The application also needs reload behavior. If the library reads the certificate once at startup, restart the Pods after rotation. If the library watches the files, validate that reload works before relying on it in production.

`subPath` is a poor fit for mounted Secret files that need rotation. A Secret mounted through `subPath` stays fixed for the life of the container. A normal projected Secret volume plus a controlled restart or reload path gives rotation a cleaner route.

## RBAC, ServiceAccounts, and Namespaces
<!-- section-summary: Secret safety depends heavily on who can read Secrets, who can create Pods that mount them, and which namespace contains them. -->

RBAC stands for **Role-Based Access Control**. In Kubernetes, RBAC rules decide which users, groups, and service accounts can perform actions such as `get`, `list`, `watch`, `create`, and `update` on resources. Secrets need tighter RBAC than most ordinary configuration objects because reading a Secret usually means recovering its sensitive value.

Namespaces set the first boundary. Staging and production should live in separate namespaces, and applications with different ownership or sensitivity should have separate namespaces when they need different access rules. A Secret in `devpolaris-prod` should be reachable only by workloads and operators that need production orders credentials.

The next question is who can read Secrets directly:

```bash
kubectl auth can-i get secret/orders-api-secrets -n devpolaris-prod
kubectl auth can-i list secrets -n devpolaris-prod
```

Direct Secret reads should be rare. `list secrets` is especially sensitive because listing can reveal every Secret value in the namespace to the caller. `watch secrets` carries the same broad risk over time. Give humans direct Secret read access only for break-glass or tightly audited operations.

Workload service accounts need a separate discussion. A Pod that references a Secret through `env` or a volume usually needs no RBAC permission to call the Kubernetes API and read that Secret. The kubelet handles delivery for the Pod. If you grant the application's service account `get secrets`, the application code can call the API server and fetch the Secret directly. Only grant that permission when the application truly needs it.

Here is a Role for a controller that must read one specific Secret:

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

The RoleBinding ties that Role to a specific service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-api-secret-reader
  namespace: devpolaris-staging
subjects:
  - kind: ServiceAccount
    name: orders-secret-sync
    namespace: devpolaris-staging
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: orders-api-secret-reader
```

There is one more important path: a user who can create Pods in a namespace can often create a Pod that mounts a Secret from that namespace and then prints it. This is indirect Secret access. Secret RBAC reviews must include Pod creation permissions, Deployment creation permissions, and any controller that can create Pods on a user's behalf.

In production, RBAC works best with admission policies and namespace boundaries. Sensitive namespaces should have a small set of users and controllers allowed to create Pods. Each workload should have a dedicated service account. Wildcard permissions such as `resources: ["*"]` and `verbs: ["*"]` deserve extra review, and `ClusterRoleBinding` objects deserve careful attention because they can grant broad access across namespaces.

## Encryption at Rest and KMS
<!-- section-summary: Encryption at rest protects Secret data stored by the Kubernetes API, and KMS integration lets a central key system protect the encryption key. -->

Kubernetes stores persistent API data through the API server's storage layer, commonly etcd for self-managed clusters. Secret data can be encrypted at rest by configuring the API server with an encryption provider. Managed Kubernetes platforms often expose this through platform settings, and self-managed clusters configure it directly on the API server.

Encryption at rest protects stored Secret data if someone gains access to the storage backend or a backup. The Pod still receives the same value, and a caller with API permission to read the Secret can still recover it. Encryption at rest is a storage protection layer that sits beside RBAC.

In a self-managed control plane, cluster administrators check the API server configuration for an encryption provider config:

```bash
kubectl -n kube-system get pods -l component=kube-apiserver -o yaml | grep encryption-provider-config
```

The exact command depends on how the control plane runs. Managed clusters may hide control plane Pods, so the check moves to the cloud provider's cluster settings or API. The practical question is the same: are Secret resources encrypted at rest, and which key system protects them?

KMS stands for **Key Management Service**. In Kubernetes encryption-at-rest discussions, KMS usually means the API server uses an external key provider plugin or cloud key service to protect the data encryption keys. This lets the platform team rotate, audit, and control encryption keys through a central key-management system instead of storing every key directly in the API server configuration.

After enabling encryption at rest, existing Secrets may need to be rewritten so the API server stores them using the new encryption configuration. Cluster administrators usually plan that as a maintenance task, verify backups, update the API server configuration, and then rewrite Secret objects. For a self-managed cluster, that procedure belongs in platform runbooks because a broken encryption config can affect API server startup and Secret reads.

For application teams, the review question is direct: does the cluster handling production orders credentials have Secret encryption at rest enabled, and who owns the key rotation runbook? If the answer is unclear, treat that as a platform readiness gap before placing high-value credentials in native Kubernetes Secrets.

## External Secrets and CSI Driver Patterns
<!-- section-summary: Production clusters often source credentials from external secret managers and then sync or mount them into Pods. -->

Native Kubernetes Secrets are useful, but many production teams keep the source of truth in a dedicated secret manager such as AWS Secrets Manager, Azure Key Vault, Google Secret Manager, HashiCorp Vault, or another enterprise system. These systems usually provide stronger rotation workflows, audit logs, access policies, and integration with cloud identity.

Two common Kubernetes patterns appear again and again: **External Secrets Operator** and **Secrets Store CSI Driver**.

External Secrets Operator runs a controller in the cluster. The platform team defines a `SecretStore` or `ClusterSecretStore` that knows how to reach the external provider. The application team defines an `ExternalSecret` that says which remote values should sync into a Kubernetes Secret.

Example shape:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: orders-api
  namespace: devpolaris-staging
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: platform-secrets
    kind: ClusterSecretStore
  target:
    name: orders-api-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: devpolaris/staging/orders-api
        property: database_url
    - secretKey: WEBHOOK_SIGNING_KEY
      remoteRef:
        key: devpolaris/staging/orders-api
        property: webhook_signing_key
```

The orders API still uses `secretKeyRef` against `orders-api-secrets`. The external provider remains the source of truth, and the operator keeps the Kubernetes Secret synchronized. This pattern fits applications that already use env vars or Secret volumes and teams that want Kubernetes-native references in Deployments.

Secrets Store CSI Driver takes a different path. It mounts secrets, keys, and certificates from external stores into Pods as files through a CSI volume. The application reads files from the mounted path. The driver can also sync mounted values into Kubernetes Secrets, but that optional sync brings native Secret storage back into the picture.

Example shape:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: orders-api-provider
  namespace: devpolaris-staging
spec:
  provider: vault
  parameters:
    objects: |
      - objectName: devpolaris/staging/orders-api
        secretPath: secret/data/devpolaris/staging/orders-api
        secretKey: database_url
---
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
          volumeMounts:
            - name: external-secrets
              mountPath: /mnt/secrets-store
              readOnly: true
      volumes:
        - name: external-secrets
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: orders-api-provider
```

The exact provider parameters differ by provider, so treat this as a structural example. CSI mounting fits certificates, keys, and applications that can read from files. External Secrets Operator fits applications that want a normal Kubernetes Secret object and a familiar `env` or `volume` reference.

The production decision is less about tool branding and more about ownership. Decide who can create external provider keys, who can bind namespaces to providers, who can read synced Kubernetes Secrets, how refresh failures alert, and how rotation reaches Pods.

## Rotation Runbook
<!-- section-summary: Secret rotation needs inventory, overlap, update, rollout or reload, validation, old credential revocation, and cleanup. -->

Secret rotation means replacing a sensitive value with a new one and removing trust in the old one. For `devpolaris-orders-api`, that might mean changing the PostgreSQL password or rotating `WEBHOOK_SIGNING_KEY` after a routine schedule or a suspected leak.

The first rotation step is inventory. The team needs to find the workload and confirm how it consumes the Secret before changing the value:

```bash
kubectl get deployment orders-api -n devpolaris-staging -o yaml | grep -C 4 orders-api-secrets
kubectl get secret orders-api-secrets -n devpolaris-staging
```

The next step prepares the new credential in the source system. For databases, the new password or user should have an overlap window so old Pods keep working while new Pods start. For signing keys, both old and new verification keys should work during the transition when possible. Rotation hurts less when the old and new values can coexist briefly.

The Kubernetes Secret update should come from the approved source. For a direct Kubernetes Secret update, a pipeline might do this:

```bash
kubectl create secret generic orders-api-secrets \
  --namespace devpolaris-staging \
  --from-literal=DATABASE_URL="$NEW_DATABASE_URL" \
  --from-literal=WEBHOOK_SIGNING_KEY="$NEW_WEBHOOK_SIGNING_KEY" \
  --dry-run=client \
  -o yaml | kubectl apply -f -
```

For External Secrets Operator, update the external provider value and watch the `ExternalSecret` status. For Secrets Store CSI Driver, update the provider value and verify the mounted files or rotation settings according to the driver and provider documentation.

Now refresh the Pods. Environment variables require a restart. Mounted files may update, but the application still needs reload behavior. The reliable application-team action is:

```bash
kubectl rollout restart deployment/orders-api -n devpolaris-staging
kubectl rollout status deployment/orders-api -n devpolaris-staging
```

Validation should avoid printing values:

```bash
kubectl logs deployment/orders-api -n devpolaris-staging --tail=100 | grep 'secret configuration loaded'
kubectl logs deployment/orders-api -n devpolaris-staging --tail=100 | grep -E 'database connected|webhook verifier ready'
```

After new Pods are healthy, the old credential should be revoked at the source. For a database, that means removing the old password or user. For a signing key, that means removing the old verification key after the overlap window. For a cloud token, that means disabling or deleting the old version. The rotation record should include time, reason, owner, and validation evidence.

A good rotation runbook has these steps:

1. Inventory of every workload that consumes the Secret.
2. New credential in the source system with a safe overlap window.
3. Updated Kubernetes Secret, external secret source, or CSI provider source.
4. Workload restart or reload according to the delivery path.
5. Application health validation without revealing values.
6. Old credential revocation after new workloads are healthy.
7. Cleanup of old Secret versions, tickets, temporary files, and CI variables.
8. Alert, dashboard, and runbook review after the rotation.

Staging rotation gives the team a rehearsal before production. Production rotation should follow a rehearsed path while customers are waiting.

## Leak Prevention
<!-- section-summary: Secret safety comes from reducing places where values can appear, especially source control, logs, history, tickets, and broad API access. -->

A Secret can leak long before it reaches a Pod. The common leak paths are source control, terminal history, CI logs, support tickets, debug endpoints, application logs, core dumps, screenshots, and overly broad `kubectl` access. Preventing leaks means shrinking the number of places where the plaintext value appears.

Source control is the first leak path to close. Live Secret values should stay out of plain YAML. If your workflow needs Git as the review surface, an approved encryption tool or external secret controller should handle the sensitive values. Secret scanning should run on repositories so accidental commits are caught quickly. A committed credential should be treated as exposed, even if the repository is private.

Logs are the next leak path. Application code should redact known sensitive keys. Startup logs can say `DATABASE_URL=present` while hiding the URL. Error logs should redact full connection strings because database URLs often include usernames and passwords. Debug endpoints should hide `process.env` and full configuration objects.

Incident diagnostics need narrow commands. A tired operator may run a broad command, paste output into a ticket, and turn a small outage into a credential incident. Commands that list key names without values are safer:

```bash
kubectl get secret orders-api-secrets \
  -n devpolaris-staging \
  -o go-template='{{range $k, $_ := .data}}{{printf "%s\n" $k}}{{end}}'
```

Access paths need the same protection as the Secret object. Direct Secret reads through `get`, `list`, and `watch` should stay narrow. Pod creation in sensitive namespaces should stay narrow too, because a Pod can mount a Secret and print it. Separate service accounts per workload reduce shared-token risk, and audit alerts should cover unusual bulk Secret reads.

Finally, prefer short-lived credentials when the backing system supports them. A static password that works for a year creates a long exposure window. A dynamic database credential from Vault or a cloud-issued token with a short lifetime reduces the time a leaked value remains useful. Kubernetes can deliver either kind of value, but the source system decides how long it stays valid.

## Troubleshooting Missing Keys
<!-- section-summary: Secret failures usually come from missing objects, missing keys, namespace mistakes, type mistakes, delivery assumptions, or external sync failures. -->

The most common Secret startup failure is a Pod stuck in `CreateContainerConfigError`. The Pod spec references a Secret or key with no matching object in the namespace. Pod events usually name the missing object or key:

```bash
kubectl get pods -n devpolaris-staging -l app=orders-api
kubectl describe pod -n devpolaris-staging -l app=orders-api
kubectl get events -n devpolaris-staging --sort-by=.lastTimestamp
```

The next check confirms the Secret exists in the same namespace:

```bash
kubectl get secret orders-api-secrets -n devpolaris-staging
kubectl get secret orders-api-secrets -n devpolaris-staging -o jsonpath='{.type}{"\n"}'
```

Key names can be listed without values:

```bash
kubectl get secret orders-api-secrets \
  -n devpolaris-staging \
  -o go-template='{{range $k, $_ := .data}}{{printf "%s\n" $k}}{{end}}'
```

Common causes look like this:

| Symptom | Likely cause | Check |
|---|---|---|
| Pod says Secret is missing | Secret was created in a different namespace or with a different name | `kubectl get secret -n devpolaris-staging` |
| Pod says key is missing | `secretKeyRef.key` differs from the keys in `.data` | List key names with the go-template command |
| App says database auth failed | Secret exists but the credential value is wrong or stale | Rotate again from source and validate database user state |
| App still uses old credential | Env vars were updated in the Secret while old Pods kept running | `kubectl rollout restart deployment/orders-api` |
| File mount stayed old | Secret was mounted with `subPath` or the app read once at startup | Inspect `volumeMounts` and restart Pods |
| ExternalSecret has no target Secret | Provider auth, remote key, or controller status is failing | `kubectl describe externalsecret orders-api -n devpolaris-staging` |
| CSI mount fails | Provider class, provider auth, or object mapping is wrong | `kubectl describe pod` and check CSI provider logs |
| Secret metadata inspection blocked | RBAC blocks Secret metadata inspection | `kubectl auth can-i get secret/orders-api-secrets -n devpolaris-staging` |

During troubleshooting, the value should stay hidden. A command that decodes a Secret proves the value, but it also places the value on a screen, in scrollback, and sometimes in logs. Decoding belongs only to clear operational reasons, approved secure terminal paths, and a rotation follow-up when the value escaped into an untrusted place.

For application-level failures, redacted readiness logs give the safest signal:

```bash
kubectl logs deployment/orders-api -n devpolaris-staging --tail=100
```

The best logs say which required secret inputs were present and which subsystem failed, while still hiding actual values. For example, `databaseUrl=present connection=failed role=orders_app` is useful. A full PostgreSQL URL with password is an incident.

## Review Checklist
<!-- section-summary: A Secret review should cover source of truth, access, delivery path, encryption, rotation, diagnostics, and leak prevention. -->

This checklist fits pull requests, releases, or platform changes that touch Secrets:

| Check | What to look for |
|---|---|
| Source of truth | Live value comes from an approved secret manager, encrypted manifest, or protected pipeline |
| Namespace boundary | Secret and workload are in the intended namespace, with staging and production separated |
| Secret type | `Opaque`, `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, or another type matches the use case |
| Key names | Deployment references exact keys, with no accidental casing or naming mismatch |
| Delivery path | Env vars, file mounts, External Secrets, or CSI driver behavior is documented |
| Restart behavior | Rotation plan explains whether Pods need restart, reload, or provider-side refresh |
| RBAC | Direct `get`, `list`, and `watch` permissions on Secrets are minimal and audited |
| Pod creation access | Users who can create Pods in the namespace are reviewed as potential indirect Secret readers |
| Encryption at rest | Production cluster has Secret encryption at rest enabled and key ownership documented |
| Leak prevention | Logs, debug commands, CI output, and support workflows avoid printing plaintext values |
| Rotation | Runbook includes overlap, validation, old credential revocation, and cleanup |
| External tooling | External Secrets or CSI provider status, alerts, and ownership are clear |

For the orders API, the final review question is practical: can the service receive database and signing credentials without putting them in images, plain manifests, broad RBAC, or shared logs, and can the team rotate those credentials on a normal workday? If yes, the Secret workflow is ready for real operations.

---

**References**

- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Defines Secret objects, built-in Secret types, usage as environment variables and files, immutability, and security guidance.
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) - Covers encryption at rest, least-privilege RBAC, namespace separation, short-lived Secrets, audit guidance, and leak reduction.
- [Distribute Credentials Securely Using Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/) - Shows practical Pod examples for consuming Secret data as environment variables and files.
- [Managing Secrets using kubectl](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kubectl/) - Documents creating, editing, verifying, and decoding Secrets with `kubectl`.
- [Managing Secrets using Configuration File](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-config-file/) - Explains `data`, `stringData`, manifests, and how Kubernetes stores Secret data.
- [Managing Secrets using Kustomize](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kustomize/) - Documents `secretGenerator`, generated Secret names, and Kustomize behavior.
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Documents Kubernetes API data encryption at rest, encryption provider configuration, verification, and key rotation topics.
- [Using RBAC Authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Defines Kubernetes RBAC Roles, RoleBindings, ClusterRoles, and authorization concepts.
- [Role Based Access Control Good Practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) - Provides least-privilege RBAC guidance and warnings about privilege escalation paths.
- [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Explains service account identities, RBAC bindings, and projected short-lived service account tokens.
- [Secrets Store CSI Driver](https://secrets-store-csi-driver.sigs.k8s.io/) - Documents the Kubernetes SIG driver for mounting external secret store values into Pods through CSI volumes.
- [External Secrets Operator overview](https://external-secrets.io/latest/introduction/overview/) - Explains the ExternalSecret, SecretStore, ClusterSecretStore, and controller pattern for syncing external provider values into Kubernetes Secrets.
