---
title: "Pod Security"
description: "Harden Kubernetes Pods with safe security contexts, restricted defaults, and practical runtime boundaries."
overview: "Pod security is about reducing what a compromised container can do. You will harden devpolaris-orders-api with security contexts, namespace labels, and review habits that keep normal deploys practical."
tags: ["security", "pods", "securitycontext", "psa"]
order: 6
id: article-containers-orchestration-kubernetes-operations-pod-security
---

## Table of Contents

1. [Why Pod Security Matters](#why-pod-security-matters)
2. [Start With the Restricted Shape](#start-with-the-restricted-shape)
3. [Security Contexts on Pods and Containers](#security-contexts-on-pods-and-containers)
4. [Run as a Non-Root User](#run-as-a-non-root-user)
5. [Make Writes Explicit](#make-writes-explicit)
6. [Drop Capabilities, Block Escalation, and Use Seccomp](#drop-capabilities-block-escalation-and-use-seccomp)
7. [Use Pod Security Admission](#use-pod-security-admission)
8. [Fix Images That Depend on Root](#fix-images-that-depend-on-root)
9. [Prove the Running Pod Matches the Review](#prove-the-running-pod-matches-the-review)
10. [Operational Checklist](#operational-checklist)

## Why Pod Security Matters
<!-- section-summary: Pod security reduces what an attacker or broken process can do after reaching the container. -->

**Pod security** is the practice of limiting what a Pod can do at runtime. It covers the Linux user the process runs as, whether the process can gain extra privileges, which kernel capabilities it has, whether it can write to the image filesystem, whether it can use host namespaces, and whether it receives a Kubernetes API token.

For `devpolaris-orders-api`, imagine a bug in the order creation endpoint allows an attacker to run a shell command inside the container. Pod security cannot fix the application bug. It can reduce the next step. The process should not start as root, should not have powerful Linux capabilities, should not write anywhere it wants, should not see host namespaces, and should not have a Kubernetes token unless the app truly needs one.

Containers use Linux isolation features such as namespaces, cgroups, capabilities, seccomp, and filesystem mounts. Those features are real and useful, but they still run on the node's kernel. A Pod spec that grants privileged mode, host networking, host process access, or broad filesystem writes can give a compromised workload a much larger path through the node.

The normal orders API is a good candidate for strict settings. It listens for HTTP requests, calls application dependencies, writes temporary files only when needed, and does not administer the cluster. That gives us a clear target: the Pod should look like a boring application workload with explicit runtime boundaries.

We start with the Kubernetes Pod Security Standards because they give the cluster a shared language for that target.

## Start With the Restricted Shape
<!-- section-summary: The restricted Pod Security Standard is the right starting target for ordinary application Pods such as the orders API. -->

Kubernetes defines **Pod Security Standards** as three policy profiles: `privileged`, `baseline`, and `restricted`. The `privileged` profile allows highly trusted workloads that need host-level power. The `baseline` profile blocks common privilege escalations while staying compatible with many workloads. The `restricted` profile sets stronger expectations for ordinary application Pods.

For `devpolaris-orders-api`, aim for the restricted shape. The service does not need host networking, host PID access, privileged mode, extra Linux capabilities, or root access. It should run as a non-root user, use the runtime default seccomp profile, block privilege escalation, and drop Linux capabilities.

Here is a compact Deployment shape for the orders API:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  template:
    spec:
      serviceAccountName: orders-api
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 256Mi
```

![Restricted Pod shape infographic showing runAsNonRoot, readOnlyRootFilesystem, dropped capabilities, seccomp, no privilege escalation, and a non-root image](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/restricted-pod-shape.png)

*The restricted shape visual groups the settings that make an ordinary API Pod boring in production: non-root execution, explicit writes, fewer Linux powers, and no easy privilege jump.*

This manifest says the Pod should run as UID `10001`, use the runtime's default seccomp profile, avoid a mounted Kubernetes API token, block privilege escalation, drop all Linux capabilities, and keep the root filesystem read-only. It still gives the application `/tmp` as explicit scratch space.

That YAML is easier to understand once we separate Pod-level and container-level security settings.

## Security Contexts on Pods and Containers
<!-- section-summary: Security contexts make runtime safety settings explicit instead of depending on image defaults. -->

A **security context** is a group of runtime security settings on a Pod or container. Pod-level settings usually apply to every container in the Pod, while container-level settings control one container more directly. Some fields only exist at one level, so you usually use both.

Pod-level settings are a good place for user and group IDs that should apply to the whole Pod:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
```

Container-level settings are a good place for privilege escalation, capabilities, and root filesystem behavior:

```yaml
containers:
  - name: api
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
          - ALL
```

Here is what each important field is doing:

| Field | What it controls | Orders API target |
|---|---|---|
| `runAsNonRoot` | Rejects containers that try to run as UID `0` | `true` |
| `runAsUser` | Sets the Linux user ID for the process | `10001` |
| `runAsGroup` | Sets the primary Linux group ID | `10001` |
| `fsGroup` | Sets group ownership behavior for supported volumes | `10001` |
| `seccompProfile` | Filters available system calls | `RuntimeDefault` |
| `allowPrivilegeEscalation` | Blocks gaining more privileges than the parent process | `false` |
| `readOnlyRootFilesystem` | Mounts the image filesystem read-only | `true` |
| `capabilities.drop` | Removes Linux capabilities from the container | `["ALL"]` |

Use numeric IDs in manifests. Names such as `appuser` depend on `/etc/passwd` inside the image, while numeric IDs are clear to Kubernetes and the container runtime. The image should still create the user for file ownership and developer clarity, but the manifest should not rely on a name lookup.

The first field most teams feel in practice is non-root execution.

## Run as a Non-Root User
<!-- section-summary: Running as a numeric non-root UID reduces the damage from file permission mistakes and container breakouts. -->

**Root** is Linux user ID `0`. A process running as root inside a container has the broadest permissions inside that container's namespace. Isolation still limits it, but many security problems get worse when the process has root privileges from launch time.

For the orders API, run the process as UID `10001` and make the image compatible with that UID. The Kubernetes manifest can require the UID, while the image build should create the user and set ownership on application files.

```dockerfile
FROM node:22-alpine

RUN addgroup -S app -g 10001 \
  && adduser -S app -u 10001 -G app

WORKDIR /app
COPY --chown=10001:10001 package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=10001:10001 . .

USER 10001:10001
CMD ["node", "server.js"]
```

The matching Pod security context keeps the runtime honest:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
```

If the image accidentally switches back to root, `runAsNonRoot: true` helps catch it before the workload runs. If files under `/app` are owned by root and the process needs to write there, the app will fail. That failure is useful because it reveals a hidden runtime assumption. The better fix is to move runtime writes to an explicit writable location, not to run the whole container as root.

That brings us to filesystem writes.

## Make Writes Explicit
<!-- section-summary: A read-only root filesystem works best when temporary and persistent writes have intentional mounts. -->

`readOnlyRootFilesystem: true` mounts the container image filesystem as read-only. The application can still write to mounted volumes. This setting is valuable because it stops accidental writes into application directories and makes runtime state visible in the Pod spec.

For `devpolaris-orders-api`, the common writable path is temporary scratch space. Give it `/tmp` through `emptyDir` and keep the rest of the image read-only.

```yaml
containers:
  - name: api
    securityContext:
      readOnlyRootFilesystem: true
    env:
      - name: TMPDIR
        value: /tmp
    volumeMounts:
      - name: tmp
        mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 256Mi
```

An `emptyDir` volume starts empty when the Pod starts and disappears when the Pod is removed. The size limit keeps temporary writes from growing without a boundary. If the service needs durable state, use a proper storage design. An API container should not quietly turn its image filesystem into a database.

Here are runtime checks that prove the expected behavior:

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- id
kubectl -n orders exec deploy/devpolaris-orders-api -- sh -c 'touch /app/check'
kubectl -n orders exec deploy/devpolaris-orders-api -- sh -c 'touch /tmp/check && ls -l /tmp/check'
```

The expected result is a non-root UID, a read-only error for `/app/check`, and a successful file in `/tmp`.

```console
uid=10001 gid=10001 groups=10001
touch: /app/check: Read-only file system
-rw-r--r--    1 10001    10001           0 May  7 11:24 /tmp/check
```

Filesystem boundaries are one layer. Kernel privilege boundaries are another.

## Drop Capabilities, Block Escalation, and Use Seccomp
<!-- section-summary: Capabilities, privilege escalation, and seccomp control how much power the process has against the Linux kernel. -->

Linux **capabilities** split root-like power into smaller pieces. Examples include changing network settings, bypassing file permissions, and performing broad system administration operations. Most HTTP APIs run without these powers. Dropping all capabilities is a strong default for `devpolaris-orders-api`.

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

If a workload needs a capability, add it explicitly and review the reason. A packet capture troubleshooting Pod may need a network capability for a short-lived task. The orders API should not need `NET_ADMIN`, `SYS_ADMIN`, or similar powers to process orders.

**Privilege escalation** controls whether a process can gain more privileges than its parent process, including paths involving setuid binaries. Set it to false for application containers.

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

**Seccomp** filters system calls into the kernel. `RuntimeDefault` tells Kubernetes to use the default seccomp profile from the container runtime. That default is a practical baseline for ordinary workloads because it blocks some risky system calls while keeping common application behavior working.

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

![Runtime hardening boundary showing writable volume, read-only image, dropped capabilities, seccomp profile, app user, and evidence checks](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/runtime-hardening-boundary.png)

*The boundary image separates what the app may do from what the runtime blocks. That distinction helps reviewers avoid weakening the whole Pod just to fix one writable path.*

You can inspect the running Pod spec:

```bash
kubectl -n orders get pod -l app=devpolaris-orders-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.securityContext.seccompProfile.type}{"\n"}{end}'

kubectl -n orders get pod -l app=devpolaris-orders-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.containers[0].securityContext}{"\n"}{end}'
```

Those commands confirm the spec Kubernetes stored. Runtime checks, such as `id` and write tests, confirm what the process experiences.

Now make those expectations automatic at the namespace level.

## Use Pod Security Admission
<!-- section-summary: Pod Security Admission applies Kubernetes Pod Security Standards through namespace labels. -->

**Pod Security Admission** is a built-in Kubernetes admission controller that applies Pod Security Standards through namespace labels. An admission controller checks API requests as they enter the API server. For Pod security, it can warn, audit, or reject Pods that violate the selected profile.

The three modes are **warn**, **audit**, and **enforce**. Warn returns a user-facing warning while allowing the request. Audit adds audit information for policy violations. Enforce rejects violating Pods. A namespace can use more than one mode at the same time.

For the `orders` namespace, start by warning and auditing the restricted profile:

```bash
kubectl label namespace orders \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted \
  --overwrite
```

Then test the Deployment with server-side dry run:

```bash
kubectl -n orders apply --dry-run=server -f k8s/orders/deployment.yaml
```

If the manifest violates restricted policy, Kubernetes prints warnings that name the missing fields.

```console
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false,
unrestricted capabilities, runAsNonRoot != true, seccompProfile
deployment.apps/devpolaris-orders-api configured (server dry run)
```

After the team fixes warnings for normal workloads, add enforcement:

```bash
kubectl label namespace orders \
  pod-security.kubernetes.io/enforce=restricted \
  --overwrite
```

Some teams also pin the policy version, such as `pod-security.kubernetes.io/enforce-version=v1.36`, so a Kubernetes minor upgrade does not change enforcement rules without a planned review. Other teams use `latest` so namespaces follow the current cluster behavior. Choose one deliberately and document it in the platform runbook.

Pod Security Admission works at the namespace boundary. It gives the namespace a guardrail that catches unsafe Pod specs before they run, while individual workload manifests still need review.

The most common friction appears when an image was built with root-only assumptions.

## Fix Images That Depend on Root
<!-- section-summary: Root-dependent images usually need ownership fixes, explicit writable paths, or environment changes rather than weaker Pod security. -->

A **root-dependent image** is an image that only starts when the process runs as UID `0` or can write into root-owned directories. Hardening exposes this quickly. You add `runAsNonRoot` and `readOnlyRootFilesystem`, then the Pod starts failing with permission errors.

```bash
kubectl -n orders logs deploy/devpolaris-orders-api --tail=40
```

```console
2026-05-07T11:06:12Z error failed to open cache path=/app/.cache/orders
2026-05-07T11:06:12Z error EACCES: permission denied, mkdir '/app/.cache'
```

Handle this as an application packaging issue. First, decide whether the path should be writable at runtime. For a cache, move it to `/tmp` or another explicit `emptyDir` mount. For persistent data, use real storage. For build artifacts, fix the Dockerfile so the runtime image already contains what it needs.

Node.js services often need cache or temporary directories set through environment variables. Python services may need bytecode cache behavior reviewed. Java services may need temporary directory settings. The exact knob depends on the runtime, but the principle is the same: writes should land in an intentional writable path.

```yaml
env:
  - name: TMPDIR
    value: /tmp
  - name: ORDERS_CACHE_DIR
    value: /tmp/orders-cache
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 256Mi
```

If the image has root-owned application files that the process only needs to read, that is usually fine. If it needs to write to application files, change the image design. Runtime containers should be predictable: code and dependencies are read-only, runtime state goes to explicit writable storage, and long-lived business data goes to an external data store.

After fixing the image or manifest, prove the running Pod matches the security review.

## Prove the Running Pod Matches the Review
<!-- section-summary: Runtime proof checks the actual Pod after rollout, not only the YAML reviewed in a pull request. -->

A hardening pull request should include both the manifest and runtime proof. The manifest shows what you asked Kubernetes to run. Runtime proof shows what actually started after defaults, admission, image behavior, and rollout.

Start with rollout and Pod status:

```bash
kubectl -n orders rollout status deploy/devpolaris-orders-api
kubectl -n orders get pods -l app=devpolaris-orders-api
```

Check the user and filesystem behavior:

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- id
kubectl -n orders exec deploy/devpolaris-orders-api -- sh -c 'touch /app/check'
kubectl -n orders exec deploy/devpolaris-orders-api -- sh -c 'touch /tmp/check && rm /tmp/check'
```

Check the security context fields Kubernetes stored:

```bash
kubectl -n orders get pod -l app=devpolaris-orders-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" runAsNonRoot="}{.spec.securityContext.runAsNonRoot}{" seccomp="}{.spec.securityContext.seccompProfile.type}{"\n"}{end}'

kubectl -n orders get pod -l app=devpolaris-orders-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" allowPrivilegeEscalation="}{.spec.containers[0].securityContext.allowPrivilegeEscalation}{" readOnlyRootFilesystem="}{.spec.containers[0].securityContext.readOnlyRootFilesystem}{"\n"}{end}'
```

Check that no service account token is mounted when the app does not need the Kubernetes API:

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- \
  ls /var/run/secrets/kubernetes.io/serviceaccount
```

The expected result is a "No such file or directory" error. If the directory exists, inspect the Pod spec for `automountServiceAccountToken` at the Pod and ServiceAccount levels.

Finally, keep exceptions written and time-bound. Some workloads legitimately need host access or extra capabilities, such as CNI plugins, node agents, storage drivers, and short-lived debug tools. An exception should name the workload, namespace, field, reason, owner, and review date.

```console
Exception request:
  workload: packet-capture-debug
  namespace: platform-debug
  field: hostNetwork true
  reason: short-lived network diagnosis on worker nodes
  owner: platform
  expires: 2026-05-14
```

That exception shape keeps the ordinary orders API strict while allowing real platform work to happen with review.

## Operational Checklist
<!-- section-summary: A practical Pod security review checks identity, users, filesystem writes, kernel powers, admission policy, and runtime proof. -->

Use this checklist for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Kubernetes API token | `automountServiceAccountToken: false` unless the app needs the API |
| Linux user | Pod runs as non-root UID `10001` |
| Root filesystem | `readOnlyRootFilesystem: true` |
| Writable paths | `/tmp` or another explicit mount handles temporary writes |
| Capabilities | Container drops `ALL` capabilities |
| Privilege escalation | `allowPrivilegeEscalation: false` |
| Seccomp | Pod uses `RuntimeDefault` |
| Host access | No host network, host PID, host IPC, privileged mode, or hostPath volumes for the API |
| Namespace policy | `orders` uses restricted warn/audit and planned enforcement |
| Runtime proof | `kubectl exec` and `jsonpath` checks are included in the review |
| Exceptions | Any deviation has an owner, reason, and expiration |

![Pod Security operations checklist with restricted start, non-root user, explicit writes, dropped Linux powers, PSA enforcement, and live Pod verification](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/pod-security-operations-checklist.png)

*The checklist connects manifest review with runtime proof, so the team verifies the Pod that actually started rather than trusting YAML alone.*

Pod security works best as a normal review habit, not a once-a-year hardening project. The orders API should carry clear runtime boundaries every time it ships. When those boundaries are visible in the manifest, enforced at the namespace, and proven after rollout, a compromised container has fewer useful places to go.

---

**References**

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Official `privileged`, `baseline`, and `restricted` profiles.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Explains namespace labels for `warn`, `audit`, and `enforce` modes.
- [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Official guide to `runAsUser`, `runAsGroup`, `fsGroup`, `allowPrivilegeEscalation`, capabilities, seccomp, and read-only root filesystems.
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Background for workload identities and service account tokens.
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Useful adjacent control for limiting Pod-to-Pod traffic after runtime hardening.
- [Kubernetes RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/) - Related guidance for reducing what a mounted service account token can do.
