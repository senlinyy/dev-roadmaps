---
title: "Pod Security"
description: "Harden Kubernetes Pods with safe security contexts, restricted defaults, and practical runtime boundaries."
overview: "Pod security reduces what a compromised container can do. Security contexts, namespace labels, and review habits harden devpolaris-orders-api while normal deploys stay practical."
tags: ["security", "pods", "securitycontext", "psa"]
order: 6
id: article-containers-orchestration-kubernetes-operations-pod-security
---
## Table of Contents

1. [Why Pod Security Matters](#why-pod-security-matters)
2. [The Restricted Pod Shape](#the-restricted-pod-shape)
3. [Security Contexts on Pods and Containers](#security-contexts-on-pods-and-containers)
4. [Run as a Non-Root User](#run-as-a-non-root-user)
5. [Make Writes Explicit](#make-writes-explicit)
6. [Drop Capabilities, Block Escalation, and Use Seccomp](#drop-capabilities-block-escalation-and-use-seccomp)
7. [Pod Security Admission](#pod-security-admission)
8. [Fix Images That Depend on Root](#fix-images-that-depend-on-root)
9. [Prove the Running Pod Matches the Review](#prove-the-running-pod-matches-the-review)
10. [Operational Checklist](#operational-checklist)
11. [References](#references)

## Why Pod Security Matters
<!-- section-summary: Pod security reduces what a compromised or faulty container can do on the node and inside the cluster. -->

Kubernetes **Pod security** is the practice of shaping Pods so containers run with limited Linux privileges, explicit write paths, and safer defaults. It reduces the damage from a vulnerable app, a bad image, or an accidental shell command inside a container.

For `devpolaris-orders-api`, the goal is practical: the API should serve traffic as a non-root user, write only to declared temporary storage, drop extra Linux capabilities, block privilege escalation, and use the runtime default seccomp profile.

Think of this as a production review of the Pod shape. The app still runs normally, but risky defaults are removed before the workload reaches the node.

## The Restricted Pod Shape
<!-- section-summary: The restricted Pod shape gives most application workloads a strong default posture without requiring custom kernel knowledge. -->

Kubernetes Pod Security Standards define levels named privileged, baseline, and restricted. Most application Deployments should aim for the **restricted** shape unless a documented platform need requires an exception.

The baseline restricted shape looks like this:

```yaml
securityContext:
  runAsNonRoot: true
containers:
  - name: api
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
      seccompProfile:
        type: RuntimeDefault
```

What this shape does:

- Requires the process to run as a non-root user.
- Blocks privilege escalation through setuid-style paths.
- Makes the image filesystem read-only.
- Removes default Linux capabilities.
- Uses the container runtime default seccomp profile.

![Restricted Pod shape infographic showing runAsNonRoot, readOnlyRootFilesystem, dropped capabilities, seccomp, no privilege escalation, and a non-root image](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/restricted-pod-shape.png)

*The restricted shape gives reviewers a concrete target for normal application Pods.*

## Security Contexts on Pods and Containers
<!-- section-summary: Pod-level and container-level security contexts work together, with container fields taking the closest control over the running process. -->

Kubernetes exposes security settings in `securityContext` at the Pod and container levels. Pod-level fields set defaults for the whole Pod. Container-level fields control the actual container process and can be more specific.

Example for the orders API:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
  containers:
    - name: api
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
```

What this means:

- The process runs as UID and GID `10001`.
- Mounted volumes can be group-owned for application writes.
- The container root filesystem stays read-only.

## Run as a Non-Root User
<!-- section-summary: Non-root execution limits what an attacker or faulty process can do inside the container and mounted filesystem. -->

Running as root inside a container still gives the process powerful file and process privileges inside the container namespace. A non-root user gives the workload a smaller local blast radius.

The image should support the same UID used in the Pod:

```dockerfile
RUN addgroup --system --gid 10001 app && adduser --system --uid 10001 --ingroup app app
USER 10001:10001
```

What this image setup provides:

- The image has a named app user.
- The runtime UID matches the Kubernetes security context.
- File ownership can be prepared during image build.

Verify the running Pod:

```bash
$ kubectl -n orders exec deploy/devpolaris-orders-api -c api -- id
uid=10001(app) gid=10001(app) groups=10001(app)
```

The output proves the running process uses the intended user and group.

## Make Writes Explicit
<!-- section-summary: Read-only images force the workload to declare where runtime files can be written. -->

Many apps write temporary files, caches, or sockets. A read-only root filesystem is still practical when those paths are explicit volumes.

```yaml
containers:
  - name: api
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: cache
        mountPath: /app/cache
volumes:
  - name: tmp
    emptyDir: {}
  - name: cache
    emptyDir: {}
```

What this does:

- The image filesystem remains read-only.
- Runtime write paths are visible in the manifest.
- The storage is temporary and tied to the Pod lifecycle.

If the app crashes after this change, move writes into declared paths or update the app config before reopening the whole root filesystem.

## Drop Capabilities, Block Escalation, and Use Seccomp
<!-- section-summary: Linux capabilities, privilege escalation, and seccomp control the kernel-facing powers available to the container. -->

Linux capabilities split root-like powers into smaller pieces. Most application containers need none of the default extra capabilities. Dropping all capabilities is a strong default.

```yaml
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

What these fields protect:

- `allowPrivilegeEscalation: false` blocks gaining more privilege during execution.
- `drop: ["ALL"]` removes default Linux capabilities.
- `RuntimeDefault` applies the runtime's standard syscall filter.

![Runtime hardening boundary showing writable volume, read-only image, dropped capabilities, seccomp profile, app user, and evidence checks](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/runtime-hardening-boundary.png)

*The boundary view shows the application inside a smaller runtime box: non-root user, explicit writes, fewer kernel powers, and a seccomp profile.*

## Pod Security Admission
<!-- section-summary: Pod Security Admission enforces Pod Security Standards at namespace admission time. -->

**Pod Security Admission** checks Pod specs when they reach the API server. Namespace labels tell Kubernetes whether to enforce, warn, or audit a Pod Security Standard level.

Start in warn and audit mode before enforcement:

```bash
$ kubectl label namespace orders \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
namespace/orders labeled
```

What this output means:

- The namespace now warns and audits restricted policy violations.
- Existing Pods keep running.
- New or updated Pods produce review evidence before deny mode.

Move to enforce after the workload passes:

```bash
$ kubectl label namespace orders pod-security.kubernetes.io/enforce=restricted --overwrite
namespace/orders labeled
```

This result means future violating Pods in `orders` will be rejected at admission.

## Fix Images That Depend on Root
<!-- section-summary: Root-dependent images need application fixes, file ownership fixes, or explicit exceptions rather than silent security rollback. -->

Some images expect root because files are owned by root, the app writes under `/var`, or the process binds privileged ports. Treat those as work items.

Common fixes:

| Symptom | Better fix |
|---|---|
| Cannot write `/tmp` | Mount `emptyDir` at `/tmp` |
| Cannot write app cache | Create a writable cache volume |
| Permission denied on app files | Set ownership during image build |
| Needs port `80` | Listen on `8080` and map Service port `80` |
| Needs package install at runtime | Move install work into the image build |

If a workload truly needs an exception, name the reason and scope it to that namespace or workload. Silent rollback to privileged settings creates a future incident.

## Prove the Running Pod Matches the Review
<!-- section-summary: Pod security review should end with live evidence from the running Pod and namespace admission state. -->

After deployment, prove the running Pod matches the manifest review:

```bash
$ kubectl -n orders get pod -l app.kubernetes.io/name=devpolaris-orders-api -o jsonpath='{.items[0].spec.securityContext.runAsNonRoot}'
true

$ kubectl -n orders exec deploy/devpolaris-orders-api -c api -- sh -c 'touch /root/probe'
touch: /root/probe: Read-only file system
```

What this proves:

- The Pod spec requires non-root execution.
- The root filesystem blocks writes in the image layer.
- The failure is expected and useful evidence.

Check namespace labels too:

```bash
$ kubectl get namespace orders --show-labels
NAME     STATUS   AGE   LABELS
orders   Active   30d   pod-security.kubernetes.io/enforce=restricted,pod-security.kubernetes.io/warn=restricted
```

This output shows admission policy is active on the namespace.

## Operational Checklist
<!-- section-summary: A strong Pod security review checks the manifest, the image, namespace admission, and live runtime evidence. -->

Use this checklist for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Non-root user | Pod and image use an app UID such as `10001` |
| Root filesystem | `readOnlyRootFilesystem: true` |
| Writable paths | `/tmp` and app cache paths use explicit volumes |
| Capabilities | Container drops `ALL` capabilities |
| Escalation | `allowPrivilegeEscalation: false` |
| Seccomp | `RuntimeDefault` profile is set |
| Namespace policy | Pod Security Admission warns, audits, then enforces restricted |
| Live proof | `id` and write tests match the intended shape |

![Pod Security operations checklist with restricted start, non-root user, explicit writes, dropped Linux powers, PSA enforcement, and live Pod verification](/content-assets/articles/article-containers-orchestration-kubernetes-operations-pod-security/pod-security-operations-checklist.png)

*The checklist keeps Pod security practical: define the restricted shape, fix the image, enforce at admission, and prove the live Pod matches the review.*

## References

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Official restricted, baseline, and privileged policy definitions.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Explains namespace labels for enforce, audit, and warn modes.
- [Kubernetes Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Official guide to Pod and container security context fields.
- [Kubernetes Configure a Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Practical examples for users, groups, capabilities, and seccomp.
- [Kubernetes Good Practices: Security](https://kubernetes.io/docs/concepts/security/security-checklist/) - Security checklist for Kubernetes workloads and clusters.
