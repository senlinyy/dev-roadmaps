---
title: "Pod Security"
description: "Shape pod behavior so containers run with fewer privileges and fewer paths to the host."
overview: "Pod security controls what a workload is allowed to request when it starts. This article explains security contexts, namespace policy labels, non-root execution, and review evidence."
tags: ["pods", "security", "runtime"]
order: 2
id: article-devsecops-kubernetes-security-pod-security
---

## Table of Contents

1. [What Pod Security Controls](#what-pod-security-controls)
2. [Security Contexts](#security-contexts)
3. [Namespace Policy Labels](#namespace-policy-labels)
4. [Common Denials](#common-denials)
5. [Review Evidence](#review-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Pod Security Controls

A pod spec can ask for powerful behavior: run as root, mount host paths, add Linux capabilities, run privileged, or allow privilege escalation. Pod security controls reduce what a pod can request.

For `devpolaris-orders`, the application should run as a normal non-root process. It should not need host mounts, privileged mode, broad capabilities, or write access to the image filesystem.

```text
Compromised app process
  -> fewer Linux privileges
  -> fewer host paths
  -> fewer writable locations
  -> smaller blast radius
```

Pod security is the Kubernetes version of runtime container hardening.

## Security Contexts

A pod or container security context records runtime rules.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

`runAsNonRoot` prevents root execution. `allowPrivilegeEscalation: false` prevents the process from gaining more privilege through setuid-style paths. `readOnlyRootFilesystem` limits writes. Dropping capabilities removes extra Linux powers. `RuntimeDefault` uses the runtime's default seccomp profile.

These fields should match the image. If the image expects to write under `/app`, a read-only root filesystem may break it. The fix is usually to write to an explicit volume or change the app, not to remove the control silently.

## Namespace Policy Labels

Kubernetes Pod Security Admission can enforce policy levels with namespace labels.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orders-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

The `enforce` label blocks pods that violate the selected level. `audit` records violations. `warn` shows warnings to users. The `restricted` level is the strictest built-in profile and is a good target for many application namespaces.

Roll this out carefully. Start with audit and warn in existing namespaces, fix workloads, then enforce.

## Common Denials

When a pod is denied, read the message as evidence.

```text
Error: violates PodSecurity "restricted:latest"
Reason: container "orders-api" must set allowPrivilegeEscalation=false
```

The message tells you which control failed. The fix is to set the field or explain why the workload needs an exception.

Another common denial:

```text
Reason: unrestricted capabilities, container must drop ALL
```

This means the pod is asking for default or extra capabilities that the policy disallows. Add the explicit drop list and then add back only a capability with a specific reason.

## Review Evidence

Pod security review should be short and concrete.

```text
Namespace: orders-prod
Pod Security Admission: restricted enforce
Runs as non-root: yes
Privilege escalation: false
Capabilities: drop ALL
Root filesystem: read-only
Writable paths: /tmp emptyDir
Exception: none
```

This record tells a reviewer that both the namespace and workload are aligned.

## Putting It All Together

Pod security controls what a Kubernetes workload can ask for at startup. Security contexts define container behavior. Namespace labels enforce a baseline. Denial messages tell the team which field to fix.

For `devpolaris-orders`, the baseline is restricted namespace policy, non-root execution, no privilege escalation, dropped capabilities, runtime default seccomp, and explicit writable paths.

## What's Next

Pod security narrows what a workload can do locally. Network policies narrow which pods and services can talk to each other.

---

**References**

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Kubernetes documents privileged, baseline, and restricted policy levels.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Kubernetes documents namespace labels for enforcing, warning, and auditing pod security.
- [Kubernetes security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Kubernetes documents pod and container security context fields.
