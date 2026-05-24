---
title: "Runtime Hardening and Registries"
description: "Secure container storage pipelines and isolate running containers using kernel-level privileges and sandbox environments."
overview: "Artifact security does not stop at compilation. This article explains OCI registry access controls, tag immutability, Linux capabilities, seccomp filters, and hypervisor-level runtime isolation."
tags: ["runtime", "registry", "namespaces", "capabilities", "sandbox"]
order: 3
id: article-devsecops-container-image-security-registry-security
aliases:
  - registry-security
  - article-devsecops-container-image-security-registry-security
  - devsecops/container-image-security/registry-security.md
  - runtime-container-hardening
  - article-devsecops-container-image-security-runtime-container-hardening
  - devsecops/container-image-security/runtime-container-hardening.md
---

## Table of Contents

1. [The Storage and Runtime Blast Radius](#the-storage-and-runtime-blast-radius)
2. [Securing the Gatekeeper: Registry Access Controls](#securing-the-gatekeeper-registry-access-controls)
3. [Tag Mutability vs. Content-Addressed Descriptors](#tag-mutability-vs-content-addressed-descriptors)
4. [Linux Namespaces: Partitioning the Operating System](#linux-namespaces-partitioning-the-operating-system)
5. [Narrowing Authority: Dropping Linux Capabilities](#narrowing-authority-dropping-linux-capabilities)
6. [Filtering the Kernel: Seccomp and Privilege Escalation](#filtering-the-kernel-seccomp-and-privilege-escalation)
7. [Hypervisor-Level Workload Isolation](#hypervisor-level-workload-isolation)
8. [Putting It All Together](#putting-it-all-together)

## The Storage and Runtime Blast Radius

A secure software delivery pipeline is a continuous chain of trust. Thus far, we have focused on building hardened, minimal filesystems, auditing their dependencies, and cryptographically signing their digests. However, this chain of trust remains vulnerable if we do not secure the registry that stores these images, or if we fail to isolate the container process when it executes in our production clusters.

Consider two severe exploits that target these boundaries. First, suppose an attacker compromises a private container registry or acquires weak administrative credentials. If the registry allows tag overwriting, the attacker can push a compromised image manifest using an existing release tag (such as `:2026.05.20.1`). When production servers restart or auto-scale, they pull the malicious image silently, deploying backdoor code directly into your cluster.

Second, suppose an application runs with default container engine privileges. If an attacker exploits a code vulnerability, they gain control of the running container process. By default, the container process runs with a significant set of administrative capabilities, allowing the process to communicate directly with the host operating system's kernel. Using kernel-level vulnerabilities (such as a dirty COW exploit or a runc namespace escape), the attacker can break out of the container's isolation boundary, gaining full root administrative access to the underlying physical server host.

To defend our systems against these exploits, we must implement strict security controls across two distinct boundaries: **Registry Security** to control push/pull privileges and tag immutability, and **Runtime Container Hardening** to restrict kernel access and isolate running processes.

## Securing the Gatekeeper: Registry Access Controls

A container registry is the central holding area for your compiled software. It is the gatekeeper between your build pipeline and your live production environments. Whoever has the authority to push images, pull layers, or delete package versions can control what code executes in production. To secure this boundary, we must implement a highly restricted, role-based access model following the principle of least privilege.

The first rule of registry security is that push access must be strictly restricted to automated CI/CD release pipelines. No human developer, engineer, or system administrator should have permanent write access to production package repositories. We utilize federated OpenID Connect (OIDC) identities or single-use, repository-scoped tokens to authenticate our build runners, ensuring that images can only be published after passing automated review stages and cryptographic sign-off.

The second rule is that pull access should be highly restricted and read-only. Production clusters, staging environments, and vulnerability scanners must utilize unique, read-only pull secrets that are locked to specific namespaces and repositories. This prevents a compromise in one environment (such as a development cluster) from being used to inspect or pull images from sensitive production repositories.

Finally, we must implement detailed package-level metadata bindings in our registry configuration. We ensure our packages are strictly private, bind them directly to their parent source repositories, and restrict image deletion rights to platform administrators. This guarantees that release history cannot be quietly deleted or modified, maintaining a reliable audit trail for compliance and rollback operations.

## Tag Mutability vs. Content-Addressed Descriptors

To identify container images, humans rely on readable tags, such as `ghcr.io/devpolaris/orders-api:2026.05.20.1` or `:latest`. However, in the Open Container Initiative (OCI) image specification, a tag is merely a mutable pointer. It is a text file pointing to a specific cryptographic manifest, and it can be moved to point to a completely different manifest at any time.

To guarantee artifact integrity, we must adopt content-addressed references, deploying our workloads exclusively by their immutable **cryptographic digests**:

```yaml
# Secure deployment reference using immutable digest
spec:
  containers:
  - name: orders-api
    image: ghcr.io/devpolaris/orders-api@sha256:91c8b6bb0e6ad134dd19a7e1cf402a23c7c9876543210fedcba9876543210fed
```

The long hexadecimal string after the `@` symbol is the SHA-256 hash of the OCI image manifest. The manifest is a structured JSON document that records the exact hashes of every filesystem layer and configuration blob that makes up the container image:

```json
{
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "digest": "sha256:91c8b6bb0e6ad134dd19a7e1cf402a23c7c9876543210fedcba9876543210fed",
  "size": 2417
}
```

Because the OCI manifest is content-addressed, if an attacker alters a single file in a filesystem layer or tries to replace a binary in the OCI bundle, the layer's hash changes. This breaks the manifest's integrity checksum, causing the container engine to reject the download. By configuring our deployment files and admission controllers to reference images strictly by digest, we make our releases completely immune to tag-hijacking and tag-drift exploits.

## Linux Namespaces: Partitioning the Operating System

Once a secure, signed image is pulled by digest, the container engine initializes the process on a physical host. It is critical to remember that containers are not virtual machines. They do not run a separate guest operating system, nor do they run on top of a hypervisor. Instead, a container is simply an ordinary Linux process running directly on the host's shared operating system kernel.

To isolate these processes, the Linux kernel relies on a core partitioning feature called **Namespaces**. Namespaces act as virtual blinders, limiting what a process can see:
* **PID Namespace**: Isolates process IDs. A process inside a container might see itself as PID 1 (the init process), but on the physical host, it runs as an ordinary PID (like PID 14820). The container process cannot see or contact processes running on the host or in other containers.
* **Network (Net) Namespace**: Isolates network resources. The container process receives its own virtual network interfaces, routing tables, and port allocations. It cannot bind to host ports or sniff raw host network traffic.
* **Mount (Mnt) Namespace**: Isolates filesystem mount points. The container process can only see the directory tree mounted from its own container image layers, preventing it from inspecting or modifying host files.

If an application process is compromised, the attacker is trapped inside these virtual namespaces. However, namespaces are not physical walls; they are logical boundaries managed by the host kernel. If the container process is granted administrative privileges, it can interact with host interfaces and attempt to break out of these namespaces. Therefore, we must actively strip away the process's authority to communicate with the kernel.

## Narrowing Authority: Dropping Linux Capabilities

Historically, the Linux operating system split process privileges into two simple states: root (UID 0) with absolute power, and normal users with restricted power. To make security controls more granular, the Linux kernel introduced **Capabilities**. Capabilities split absolute root power into several dozen individual, highly specific privileges.

Examples of capabilities include `CAP_NET_BIND_SERVICE` (allowing a process to bind to network ports below 1024), `CAP_CHOWN` (allowing a process to modify file owners), and `CAP_SYS_ADMIN` (allowing broad system administration tasks). By default, when a container engine launches a container, it grants the process a generous subset of these capabilities, including the power to change process priorities, modify network namespaces, or bind privileged ports.

However, a standard web API needs none of these administrative privileges. The orders API simply reads database configurations, processes requests, and writes logs. To secure the runtime, we must explicitly drop all capabilities inside our deployment configuration, adding back only the bare minimum if required:

```yaml
# Drop all default capabilities from the container
securityContext:
  allowPrivilegeEscalation: false
  privileged: false
  capabilities:
    drop:
      - ALL
```

Setting `capabilities.drop: ["ALL"]` tells the container runtime to strip away all administrative powers from the process. Even if the process runs as the root user inside its namespace, it possesses no effective capabilities. If an attacker exploits the application code, they cannot load kernel modules, manipulate raw network packets, or change file system permissions. By enforcing this strict restriction, we ensure the process operates as a zero-capability workload, minimizing its blast radius.

## Filtering the Kernel: Seccomp and Privilege Escalation

Every Linux process interacts with the host kernel by executing system calls (syscalls), which are low-level requests to perform hardware or filesystem tasks (such as `sys_write` to output data or `ptrace` to debug processes). The standard Linux kernel supports several hundred system calls. While a typical web application only utilizes a small subset of these calls, a standard container process is permitted to execute almost any system call by default.

To restrict this system-call exposure, we implement **Seccomp** (Secure Computing Mode) filtering. Seccomp acts as a firewall between your application process and the host kernel, intercepting system calls and rejecting any call that is not explicitly permitted by the active profile.

In production Kubernetes environments, we configure our pods to use the container runtime's default seccomp profile:

```yaml
# Enforce seccomp filters at the pod level
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

Applying the `RuntimeDefault` seccomp profile activates a highly vetted, industry-standard filter. This filter automatically blocks unusual, dangerous system calls (such as those used to bypass file access controls or modify kernel modules) while allowing standard application operations to run without disruption.

Alongside seccomp, we block privilege escalation:
* **AllowPrivilegeEscalation**: Set to `false` to prevent the process or its children from gaining more privileges than their parent process, neutralizing setuid binaries.
* **Privileged Container**: Always set to `false`. A privileged container completely disables all namespace and capability sandboxing, giving the container process raw, administrative root access to the physical host node.

## Hypervisor-Level Workload Isolation

Applying namespaces, dropping capabilities, and filtering system calls with seccomp creates a highly secure runtime sandbox. However, because all containers on a host continue to share the exact same physical Linux kernel, they are still exposed to kernel exploits. If an attacker exploits a zero-day vulnerability in the host kernel, they can bypass seccomp and escape the container.

To eliminate this shared-kernel risk for high-security or multi-tenant workloads, we implement hypervisor-level workload isolation. Instead of running directly on the host's shared kernel, we isolate the container using specialized runtimes:
* **gVisor**: A user-space kernel wrapper developed by Google. gVisor implements a kernel runtime (called Sentry) that intercepts and emulates all container system calls in userspace. The application's system calls never reach the host kernel directly, neutralizing kernel exploits.
* **Kata Containers**: A micro-VM runtime. Kata Packages each container pod inside its own isolated, highly optimized virtual machine running on top of a hypervisor. Each pod receives its own private guest Linux kernel, creating a physical hardware isolation boundary.

```yaml
# Example Kubernetes Pod runtime class selection
spec:
  runtimeClassName: gvisor
  containers:
  - name: orders-api
    image: ghcr.io/devpolaris/orders-api@sha256:91c8...
```

By declaring `runtimeClassName: gvisor` or `runtimeClassName: kata` in our deployment manifest, we instruct the container orchestrator to isolate the container process inside a hypervisor sandbox. If an attacker compromises the container and exploits the kernel, their access is completely isolated to the virtual sandbox kernel, preventing them from accessing host resources or other containers in the cluster.

## Putting It All Together

Securing our container registries and hardening our runtime environments completes the pipeline protection chain, ensuring that our workloads remain isolated and highly restricted throughout their execution lifecycle. By combining automated registry access roles, immutable digest references, Linux namespaces, capability dropping, seccomp filters, privilege escalation blocks, and hypervisor workload sandboxes, we establish a robust defense-in-depth architecture.

When securing your registries and container deployments, ensure you maintain these six core practices:

First, restrict registry push access exclusively to verified, automated CI/CD release pipelines. Deny human developer accounts permanent push privileges to production package repositories.

Second, pull all container images strictly by their immutable cryptographic digests rather than mutable tags. Deploying by digest ensures absolute content integrity and protects your clusters against tag-hijacking and tag-drift exploits.

Third, execute container processes under low-privilege, non-root user accounts. Declare an explicit, high-number UID and drop all default capabilities using `capabilities.drop: ["ALL"]`, ensuring the container process operates with zero administrative capabilities.

Fourth, enforce read-only root filesystems and seccomp filters across all deployments. Mount your container layers as read-only at runtime, utilizing ephemeral tmpfs volumes exclusively for specific write paths, and apply the default seccomp profile to block dangerous system calls.

Fifth, completely disable privileged containers and block privilege escalation. Set `allowPrivilegeEscalation: false` and `privileged: false` across all pods to guarantee that processes cannot acquire elevated administrative powers.

Sixth, adopt hypervisor-level workload isolation for sensitive or multi-tenant applications. Utilize runtimes like gVisor or Kata Containers to wrap processes in isolated guest kernels, completely removing the shared-kernel attack surface.

---

**References**

- [Kubernetes Security Context Configuration](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Official guide on configuring UIDs, capabilities, seccomp, and privilege escalation blocks.
- [OCI Image Index and Descriptor Specification](https://specs.opencontainers.org/image-spec/) - OCI documentation on content-addressed digests, media types, and manifest trees.
- [Google Container Tools - gVisor Architecture](https://gvisor.dev/docs/architecture/) - gVisor documentation explaining userspace system-call interception and kernel sandboxing.
- [Kata Containers Architecture Overview](https://katacontainers.io/) - Official reference on micro-VM container runtime isolation.
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) - Technical guidance on runtime hardening, seccomp filters, and capability dropping.
