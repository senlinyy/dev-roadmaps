---
title: "Secrets in Kubernetes"
description: "Store, mount, rotate, and audit Kubernetes Secrets without treating base64 as encryption."
overview: "Kubernetes Secrets are API objects for sensitive values. This article explains base64 encoding, etcd encryption, RBAC, mounts, environment variables, and rotation evidence."
tags: ["secrets", "kubernetes", "encryption"]
order: 4
id: article-devsecops-kubernetes-security-secrets-in-kubernetes
---

## Table of Contents

1. [What a Kubernetes Secret Is](#what-a-kubernetes-secret-is)
2. [Base64 Is Encoding](#base64-is-encoding)
3. [Access to Secrets](#access-to-secrets)
4. [Mounts and Environment Variables](#mounts-and-environment-variables)
5. [Rotation](#rotation)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What a Kubernetes Secret Is

A Kubernetes Secret is an API object for storing sensitive values such as tokens, passwords, keys, and certificates. Pods can consume Secrets as mounted files or environment variables.

For `devpolaris-orders`, the database URL may live in a Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orders-db
  namespace: orders-prod
type: Opaque
data:
  database-url: cG9zdGdyZXM6Ly9leGFtcGxl
```

The value under `data` is base64-encoded. That makes it safe for YAML formatting. It does not make it secret from anyone who can read the object.

## Base64 Is Encoding

Base64 is reversible encoding.

```bash
$ echo cG9zdGdyZXM6Ly9leGFtcGxl | base64 --decode
postgres://example
```

Anyone with permission to read the Secret can decode the value. Secret security comes from API access control, encryption at rest, runtime delivery boundaries, and audit logs.

The first review question is who can read Secrets in the namespace.

```bash
$ kubectl auth can-i get secrets \
  --as=system:serviceaccount:orders-prod:orders-deployer \
  -n orders-prod
no
```

A deployer may need to update deployments without reading secret values. The runtime service account may need the mounted secret, but broad human access should be limited.

## Access to Secrets

RBAC controls who can read Secret objects. Reading a Secret is usually more sensitive than reading a ConfigMap because it reveals credential values.

```text
Subject: orders-oncall
Allowed: get pods, get logs
Denied: get secrets
Reason: on-call can debug behavior without reading raw credentials
```

Sometimes an operator does need secret access. Make that path explicit and audited. Avoid giving `get secrets` to broad groups because it is convenient during debugging.

Clusters can also encrypt Secrets at rest in etcd. That protects stored data if etcd storage is exposed. It does not prevent an authorized API user from reading the Secret.

## Mounts and Environment Variables

A pod can receive a Secret as a file:

```yaml
volumeMounts:
  - name: db-secret
    mountPath: /var/run/secrets/orders
    readOnly: true
volumes:
  - name: db-secret
    secret:
      secretName: orders-db
```

It can also receive a Secret as an environment variable. Files are often easier to rotate because mounted Secret volumes can update when the Secret changes, while environment variables are fixed when the process starts. The application may still need a restart or reload to use the new value.

Know which method your service uses. Rotation depends on it.

## Rotation

A rotation record should connect the Secret version, workload restart, and validation.

```text
Secret: orders-db
Namespace: orders-prod
Changed: database-url
New version applied: 2026-05-19T12:00Z
Workload restarted: orders-api rollout restart
Validation: app opened new database connections
Old credential disabled: 2026-05-19T12:30Z
Owner: orders-team
```

The `Old credential disabled` line matters. Updating the Kubernetes Secret does not automatically disable the old credential in the database or external system. Rotation finishes when the old value stops working.

## Putting It All Together

Kubernetes Secrets store sensitive values as API objects. Base64 encoding is formatting, not protection. Real protection comes from RBAC, encryption at rest, narrow runtime delivery, audit logs, and complete rotation.

For `devpolaris-orders`, secret review asks who can read Secret objects, how the pod receives the value, whether etcd encryption is enabled, how rotation restarts or reloads the app, and how the old credential is disabled.

## What's Next

Secrets, pod settings, and network policies all depend on valid Kubernetes objects entering the cluster. Admission control checks those objects before they are stored.

---

**References**

- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Kubernetes documents Secret objects, use cases, and risks.
- [Kubernetes encrypting secret data at rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/) - Kubernetes documents encryption configuration for Secret data in etcd.
- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Kubernetes documents controlling Secret access with RBAC.
