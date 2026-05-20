---
title: "Runtime Container Hardening"
description: "Run containers with fewer Linux privileges, safer filesystems, and clearer runtime limits."
overview: "Runtime hardening controls what a container can do after it starts. This article explains users, capabilities, read-only filesystems, seccomp, resource limits, and the evidence reviewers should expect."
tags: ["runtime", "linux", "containers"]
order: 6
id: article-devsecops-container-image-security-runtime-container-hardening
---

## Table of Contents

1. [What Runtime Hardening Changes](#what-runtime-hardening-changes)
2. [Users](#users)
3. [Capabilities](#capabilities)
4. [Filesystems](#filesystems)
5. [Seccomp and Privilege Flags](#seccomp-and-privilege-flags)
6. [Resource Limits](#resource-limits)
7. [Review Evidence](#review-evidence)
8. [Putting It All Together](#putting-it-all-together)

## What Runtime Hardening Changes

Image security asks what ships. Runtime hardening asks what the running container can do. If the application is compromised, runtime settings decide whether the process can write to the filesystem, run as root, add Linux capabilities, access host paths, or consume unlimited resources.

For `devpolaris-orders-api`, the hardening question is:

```text
If the Node process is exploited, what can that process do next?
```

The goal is to reduce the next move. A compromised web process should not automatically become root on the host, write arbitrary files into the image filesystem, load kernel features, or starve neighboring workloads.

## Users

Containers often start as root unless the image or runtime configuration changes the user. Root inside a container is constrained by namespaces, but it is still a poor default when the app does not need it.

In a Dockerfile:

```Dockerfile
FROM node:22-slim
WORKDIR /app
COPY --chown=node:node . .
USER node
CMD ["node", "dist/server.js"]
```

The `USER node` line starts the process as a non-root user. The `--chown=node:node` part makes copied files readable by that user. Without matching file ownership, the container may fail at startup.

In Kubernetes, the same intent can be enforced in a pod security context.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
```

## Capabilities

Linux capabilities split some root powers into smaller pieces. Many application containers do not need extra capabilities.

```yaml
securityContext:
  capabilities:
    drop: ["ALL"]
```

Dropping capabilities reduces what the process can do even if it is exploited. Some workloads need specific capabilities, but each one should have a reason. Adding `NET_ADMIN` because networking is confusing is a risk. It grants powerful network administration behavior inside the container.

## Filesystems

A read-only root filesystem prevents the process from writing into the image filesystem after startup.

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

The application may still need writable locations for temporary files or caches. Give those locations explicit volumes.

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

This pattern makes writes visible. If the app needs `/tmp`, it gets `/tmp`. It does not get the whole root filesystem.

## Seccomp and Privilege Flags

Seccomp filters which Linux system calls a process can make. The common safe baseline is the runtime default profile.

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

Privilege flags should stay narrow.

```yaml
securityContext:
  allowPrivilegeEscalation: false
  privileged: false
```

`allowPrivilegeEscalation: false` prevents a process from gaining more privileges through setuid binaries or similar paths. `privileged: false` keeps the container from receiving broad host-level access. If a workload requests privileged mode, it needs a very clear operational reason and separate review.

## Resource Limits

Resource limits keep one container from consuming unlimited CPU or memory.

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1000m"
    memory: "512Mi"
```

Requests help scheduling. Limits cap usage. Security and reliability meet here: a compromised or broken process that loops or allocates memory should have a smaller blast radius.

Limits require tuning. Too low and the app crashes during normal traffic. Too high and a runaway process can harm the node. Start from observed usage and adjust with evidence.

## Review Evidence

A runtime hardening review should record the settings and the reason.

```text
Service: devpolaris-orders-api
Runs as root: no, UID 1000
Capabilities: drop ALL
Root filesystem: read-only
Writable paths: /tmp emptyDir
Seccomp: RuntimeDefault
Privilege escalation: false
CPU limit: 1000m
Memory limit: 512Mi
Exception: none
```

This evidence is short enough for pull request review. If the service needs an exception, the exception should name the reason and owner.

## Putting It All Together

Runtime hardening narrows what a running container can do. Users, capabilities, filesystem writes, seccomp, privilege flags, and resource limits each reduce one part of the post-compromise path.

For `devpolaris-orders-api`, the practical baseline is non-root execution, dropped capabilities, read-only root filesystem, explicit writable paths, runtime default seccomp, no privilege escalation, and resource limits based on observed behavior.

---

**References**

- [Docker security overview](https://docs.docker.com/engine/security/) - Docker documents container isolation, Linux namespaces, capabilities, and runtime security concepts.
- [Kubernetes security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Kubernetes documents container and pod security context fields.
- [Kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Kubernetes documents CPU and memory requests and limits.
