---
title: "Container Runtime Isolation"
description: "Constrain running containers with non-root users, dropped capabilities, seccomp, AppArmor or SELinux, resource limits, network policy, and sandbox runtimes."
overview: "Start with a signed payments-api image finally running as a Linux process on a Kubernetes node. Then learn why containers share the host kernel, how to set a runtime baseline, and how capabilities, seccomp, AppArmor or SELinux, non-root execution, read-only filesystems, resource limits, network policy, Kubernetes guardrails, sandbox runtimes, and verification reduce the blast radius of a compromised container."
tags: ["devsecops", "runtime-isolation", "seccomp", "apparmor"]
order: 4
id: article-devsecops-container-image-security-registry-security
---

## Table of Contents

1. [A Signed Image Starts as a Linux Process](#a-signed-image-starts-as-a-linux-process)
2. [Containers Share the Host Kernel](#containers-share-the-host-kernel)
3. [A Runtime Baseline for payments-api](#a-runtime-baseline-for-payments-api)
4. [Linux Capabilities](#linux-capabilities)
5. [Seccomp](#seccomp)
6. [AppArmor and SELinux](#apparmor-and-selinux)
7. [Non-Root, Read-Only Filesystems, and Privilege Escalation](#non-root-read-only-filesystems-and-privilege-escalation)
8. [CPU, Memory, Storage, and Process Limits](#cpu-memory-storage-and-process-limits)
9. [Network Exposure](#network-exposure)
10. [Kubernetes Guardrails](#kubernetes-guardrails)
11. [Sandbox Runtimes](#sandbox-runtimes)
12. [Verification and Debugging Workflow](#verification-and-debugging-workflow)
13. [Putting It All Together](#putting-it-all-together)
14. [References](#references)

## A Signed Image Starts as a Linux Process
<!-- section-summary: A signed image from a private registry still needs runtime guardrails once Kubernetes starts it as a process on a node. -->

Let's continue the same story from the previous articles. The small team has a `payments-api` image. CI built it, scanned it, signed it, pushed it to a private registry, and recorded the digest. The Kubernetes manifest uses that digest, so the cluster pulls the exact artifact the team approved.

Now the image finally runs. The kubelet asks the container runtime to unpack the image layers, prepare the container, and launch the application as a Linux process on a worker node. At that point, the security question changes from "do we trust this image?" to "what can this process do while it is running?"

**Container runtime isolation** means the limits around a running container: which Linux privileges it has, which system calls it can make, which files it can write, which network paths it can reach, how much CPU and memory it can consume, and which kernel-level policies apply to it. For `payments-api`, runtime isolation is the difference between "an attacker found one application bug" and "an attacker can now change the node, scan the cluster, read service account tokens, and affect nearby workloads."

This article walks through the controls in the order a real team usually applies them. First, we look at why containers share the host kernel. Then we build a Kubernetes baseline. After that, we tighten Linux capabilities, seccomp, AppArmor or SELinux, user identity, filesystem writes, resource usage, network exposure, namespace guardrails, and sandbox runtimes. The final section shows a short verification workflow a platform team can run before this deployment goes to production.

![Runtime isolation layers infographic showing a payments-api pod constrained by non-root UID, dropped capabilities, seccomp, AppArmor or SELinux, NetworkPolicy, resource limits, and the node kernel boundary](/content-assets/articles/article-devsecops-container-image-security-registry-security/runtime-isolation-layers.png)

*Runtime isolation works in layers around the running process, so one application bug has fewer paths to node or cluster access.*

## Containers Share the Host Kernel
<!-- section-summary: Containers isolate process views with Linux features, but every container on a node still asks the same host kernel to do privileged work. -->

A **container** is a normal Linux process with a packaged filesystem and a restricted view of the machine. Linux namespaces give the process its own view of things like process IDs, network interfaces, mounts, and hostnames. Cgroups give the process resource limits for CPU, memory, and other resources. The image supplies the files. The runtime connects those pieces and starts the process.

The important beginner-friendly detail is this: containers on the same worker node share the host kernel. The **kernel** is the part of the operating system that controls memory, filesystems, networking, processes, and hardware. An application cannot directly mount a disk or change network routes by itself. It asks the kernel through a **system call**, often called a syscall. `open`, `connect`, `clone`, `mount`, and `chmod` are examples of requests a process can make to the kernel.

For `payments-api`, the runtime limits protect a service that handles real payment requests. Maybe a deserialization bug lets someone run a command inside the container. Maybe a dependency vulnerability lets them write a file. Maybe an SSRF bug lets them make network calls from inside the pod. Image scanning and signing helped before the pod started, and runtime isolation controls what that compromised process can do after it starts.

A weak runtime setup gives too much power to the process. A container running as root with broad Linux capabilities, a writable root filesystem, no syscall filtering, no network policy, and a mounted service account token gives an attacker many paths to explore. A hardened runtime setup gives the same application only the privileges it actually needs: listen on port `8080`, read its config, write temporary files in `/tmp`, call the database and payment provider, and exit cleanly.

Now that the risk is clear, the team needs a concrete Kubernetes baseline. The baseline gives reviewers one place to see the user, filesystem, syscall, network, and resource decisions for the workload.

## A Runtime Baseline for payments-api
<!-- section-summary: A secure runtime baseline combines pod-level defaults, container-level restrictions, temporary writable volumes, and resource budgets. -->

A good starting point is a manifest skeleton that makes runtime security visible. Kubernetes has defaults, and many defaults are safe for ordinary cases, but production teams usually write the important settings into YAML so reviewers and admission policies can check them. The `payments-api` team wants the deployment to show which privileges the application receives without asking a beginner to digest the whole manifest at once.

Here is the small shape first:

```yaml
spec:
  template:
    spec:
      serviceAccountName: payments-api
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: payments-api
          image: registry.example.com/payments/payments-api@sha256:9b6d2f4e...
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

This skeleton has the first five runtime decisions. The service account is explicit. The Kubernetes API token is not mounted by default. The pod asks for a non-root process and the runtime's default seccomp profile. The container blocks privilege escalation, keeps the image filesystem read-only, drops Linux capabilities, and sets a CPU and memory budget.

`automountServiceAccountToken: false` deserves a quick note. Kubernetes can mount a token into a pod so the workload can call the Kubernetes API. Many application pods do not need that. If `payments-api` only serves HTTP requests and talks to a database, mounting the Kubernetes API token adds an unnecessary secret to the runtime. If a later feature needs Kubernetes API access, the team can turn it on deliberately and bind a narrow Role to that service account.

The full deployment will also need ports, secret wiring, writable scratch volumes, AppArmor or SELinux defaults, storage budgets, and network policy. The rest of this article adds those details one layer at a time. We will start with Linux capabilities because they are one of the easiest ways to accidentally give a container more power than it needs, especially when an image still starts as root.

![Security context baseline infographic showing runAsNonRoot, readOnlyRootFilesystem, allowPrivilegeEscalation false, drop ALL, RuntimeDefault seccomp, and tmp emptyDir settings applied to payments-api](/content-assets/articles/article-devsecops-container-image-security-registry-security/security-context-baseline.png)

*A security context makes the runtime contract visible: the manifest says which privileges the container receives and which write paths it can use.*

## Linux Capabilities
<!-- section-summary: Linux capabilities split root-like power into smaller privileges, so containers can drop broad powers and add only rare exceptions. -->

**Linux capabilities** split powerful root privileges into smaller named pieces. Older Unix-style systems treated user ID `0`, usually called root, as the identity that could do almost everything. Linux capabilities made that more granular. A process might have permission to bind to a low network port, change file ownership, load kernel modules, or change system time, depending on which capabilities it holds.

For a container, capabilities deserve attention because a root process inside the container may still receive a set of kernel privileges. A web API usually needs very few of them. `payments-api` needs to listen on a TCP port, read configuration, make outbound network calls, write to a small temporary directory, and log to standard output. It does not need to change kernel networking, mount filesystems, load kernel modules, trace other processes, or change the host clock.

Kubernetes lets the team drop capabilities at the container level. The setting belongs on the container because each container in a pod can need a different privilege set:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

This says the container starts with no extra Linux capabilities. That is a strong default for `payments-api`. The app listens on port `8080`, so it does not need the `NET_BIND_SERVICE` capability that processes traditionally needed for ports below `1024`.

Some older applications still listen on port `80` or `443` inside the container. In that case, the team can add only the one needed capability:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
    add:
      - NET_BIND_SERVICE
```

That exception should stay rare. Most teams avoid it by having the application listen on an unprivileged port such as `8080`, then letting a Kubernetes Service, Ingress, Gateway, or load balancer expose port `80` or `443` outside the pod. The container stays simple, and the platform owns the public entry point.

Here are common capabilities reviewers watch closely. These are the names that should trigger a real conversation during review:

| Capability | What it can allow | How it applies to `payments-api` |
|---|---|---|
| **SYS_ADMIN** | A very broad set of admin operations, including many mount and namespace operations | A normal API should not receive it because it gives too much kernel-level power. |
| **NET_ADMIN** | Network interface, route, firewall, and traffic-control changes | The API should not change node or pod networking. |
| **SYS_PTRACE** | Inspect or trace other processes | The API should not debug or inspect neighboring processes in production. |
| **SYS_TIME** | Change the system clock | The API should read time from the OS, not set it. |
| **NET_BIND_SERVICE** | Bind to ports below `1024` | Usually avoided by listening on `8080` inside the container. |

Dropping capabilities reduces what a compromised process can ask the kernel to do. The next layer narrows the syscall surface even further, because some risky kernel operations can still appear through system calls.

## Seccomp
<!-- section-summary: Seccomp filters system calls, which lets the runtime block whole classes of kernel requests before the kernel performs them. -->

**Seccomp** is a Linux feature that filters system calls. A system call is the way a process asks the kernel to do work. Seccomp lets the runtime say, "this container can use these syscalls, and these other syscalls should fail." Docker ships a default seccomp profile, and Kubernetes can ask the container runtime to apply its default profile through `RuntimeDefault`.

For `payments-api`, seccomp is useful because an HTTP service needs a predictable set of kernel operations. It opens files, creates threads, accepts connections, writes logs, and reads environment variables. It should not need dangerous syscalls related to kernel module loading, unusual namespace creation, or low-level host changes.

The baseline uses seccomp at the pod level. That gives every container in the pod the same default syscall filter unless a container overrides it:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

`RuntimeDefault` tells Kubernetes to use the default seccomp profile from the container runtime. That gives the team a maintained baseline without writing a custom syscall policy on day one. Production teams usually start here because custom seccomp profiles require testing across language runtimes, observability agents, TLS libraries, and startup hooks.

A custom profile can still make sense for high-risk workloads. Suppose the same platform also runs a partner-provided fraud scoring plugin beside `payments-api`. The platform team might create a local seccomp profile after observing normal behavior in staging, then mount it on nodes and reference it from the pod:

```yaml
securityContext:
  seccompProfile:
    type: Localhost
    localhostProfile: profiles/payments-api.json
```

This means the profile file already exists on the node under the kubelet's configured seccomp profile path. Kubernetes references the profile; it does not create the profile file for the team. That detail is important in real clusters because a missing local profile can keep the pod from starting.

Seccomp failures often appear as `Operation not permitted`, startup crashes, or application logs that point at a syscall-dependent feature. The normal rollout path is staging first, one workload at a time, with logs and node events open. If the app breaks after a custom profile change, the team compares the new profile to the syscall the app needed and decides whether the syscall is part of normal application behavior or a risky feature that should stay blocked.

Seccomp limits kernel requests. AppArmor and SELinux add another layer by controlling what the process can access.

## AppArmor and SELinux
<!-- section-summary: AppArmor and SELinux add operating-system access rules around containers, usually through platform-managed profiles or labels. -->

**AppArmor** and **SELinux** are Linux security modules. They give the operating system another policy layer for processes. A simple way to think about them is this: even if a process has a Linux user ID and a set of capabilities, the OS can still check an additional profile or label before allowing file, process, or network access.

AppArmor is profile-based and commonly seen on Ubuntu and Debian-style systems. A profile can say which paths and operations a process may use. SELinux is label-based and commonly seen on Red Hat-style systems. It attaches labels to processes and files, then uses policy rules to decide which labeled process can access which labeled object. Both approaches can protect the host and neighboring workloads from a process that tries to step outside its expected runtime shape.

Kubernetes now supports AppArmor through `securityContext` fields. The baseline uses the runtime default profile:

```yaml
securityContext:
  appArmorProfile:
    type: RuntimeDefault
```

A cluster that has a custom AppArmor profile loaded on the node can reference it like this. The pod will only start on nodes where the named profile exists and the runtime supports it:

```yaml
securityContext:
  appArmorProfile:
    type: Localhost
    localhostProfile: payments-api-deny-runtime-writes
```

The platform team owns the profile file and node rollout. The application team owns the workload expectation. For `payments-api`, a useful custom profile might prevent writes outside known temporary paths and restrict access to sensitive host paths. That kind of profile needs careful staging because some language runtimes write cache files, TLS libraries read certificate bundles, and observability agents may need predictable paths.

SELinux usually appears through node images and container runtime defaults. On SELinux-enabled clusters, the runtime labels the container process and filesystem content so the kernel can apply SELinux policy. Kubernetes also has `seLinuxOptions` for clusters that intentionally manage these labels:

```yaml
securityContext:
  seLinuxOptions:
    type: container_t
```

Most application teams do not invent SELinux labels for each deployment. They use the platform's supported container type, then escalate to the platform team when a workload needs a special label or volume access pattern. That keeps application YAML readable and keeps operating-system policy in the hands of the team that manages nodes.

So far, the container has fewer kernel privileges and stronger OS policy. The next step is the identity and filesystem shape inside the container, because a process running as root with a writable image filesystem still has too much room to move.

## Non-Root, Read-Only Filesystems, and Privilege Escalation
<!-- section-summary: Running as a non-root user, blocking privilege escalation, and making the image filesystem read-only reduce damage from application compromise. -->

**Running as non-root** means the main process inside the container starts with a normal numeric user ID instead of user ID `0`. In Kubernetes, `runAsNonRoot: true` asks the kubelet to reject the container if it would run as root. `runAsUser: 10001` makes the intended user explicit. Many files and behaviors inside Linux still treat root differently, and some container escape or misconfiguration paths grow more dangerous when the process starts as root.

The runtime setting should match the image. A typical Dockerfile for `payments-api` might create or choose a non-root user during the build, then make that user the default process identity:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --home-dir /app app
USER 10001:10001
CMD ["node", "server.js"]
```

The Kubernetes deployment then enforces the same identity. That way the cluster rejects a bad image or manifest change that would run the process as root:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
```

**Privilege escalation** means a process gains more privileges after it starts. The classic Linux examples are setuid binaries and file capabilities. Kubernetes exposes a control called `allowPrivilegeEscalation`. For `payments-api`, the team should set it to `false` so the process cannot gain more privileges through those paths:

```yaml
securityContext:
  allowPrivilegeEscalation: false
```

**A read-only root filesystem** means the files from the container image cannot be changed at runtime. The application can still write to mounted volumes, but it cannot rewrite `/app/server.js`, drop a new binary into `/usr/local/bin`, or leave a modified file in the image layer. That helps incident response because the running image stays closer to the artifact that CI approved.

The tradeoff is practical. Many apps write to `/tmp`, cache directories, PID files, or framework-specific paths. The `payments-api` team handles that by mounting small `emptyDir` volumes for the exact writable paths:

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: app-cache
    mountPath: /app/.cache
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 64Mi
  - name: app-cache
    emptyDir:
      sizeLimit: 64Mi
```

If the application crashes with messages like `read-only file system`, the team should find the write path and decide whether it is a legitimate runtime write. Logs should go to standard output. Temporary files should go to `/tmp` or another mounted scratch path. Application state should go to a database, queue, object storage, or a proper persistent volume, depending on the workload.

These controls reduce privilege and file-system movement. The next problem is resource movement: a compromised or buggy process can still consume CPU, memory, storage, or process IDs.

## CPU, Memory, Storage, and Process Limits
<!-- section-summary: Resource controls use cgroups and Kubernetes policy so one pod cannot consume an unlimited share of a node. -->

**Resource limits** define how much of a node a container can use. Kubernetes uses requests for scheduling and limits for enforcement. A CPU request tells the scheduler the amount of CPU the pod normally needs. A memory request does the same for memory. A CPU limit can throttle the container. A memory limit can cause the container to be killed if it exceeds the limit. Ephemeral storage limits control local writable storage such as logs, writable layers, and `emptyDir` volumes.

This is a security topic because denial of service often starts as resource exhaustion. Imagine a bug in `payments-api` that creates too many worker threads for one request, or an attacker sends requests that generate huge temporary files. Without resource controls, one pod can pressure the node and harm other workloads. With controls, the failure stays closer to the pod that caused it, and Kubernetes can restart or reschedule it according to the deployment policy.

The deployment-level setting looks like this. The exact values should come from load testing and observed production behavior, not from copying another service blindly:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
    ephemeral-storage: 64Mi
  limits:
    cpu: 500m
    memory: 512Mi
    ephemeral-storage: 256Mi
```

Teams usually choose these values from real measurements. A first version might come from load testing and production-like traffic in staging. After deployment, metrics can show whether the pod gets throttled, hits memory limits, or grows local storage. The goal is a budget that gives the service room to handle normal spikes while still limiting runaway behavior.

Namespace-level policy helps keep one deployment from skipping resource budgets. A platform team might set a `LimitRange` so containers in the `payments` namespace get defaults and bounds even when a developer forgets to add them:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: payments-container-limits
  namespace: payments
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        cpu: 500m
        memory: 512Mi
      max:
        cpu: "1"
        memory: 1Gi
```

A `ResourceQuota` can cap the whole namespace so the team cannot accidentally schedule unlimited pods. This is useful when CI deploys preview environments or horizontal autoscaling creates more replicas than expected:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: payments-quota
  namespace: payments
spec:
  hard:
    requests.cpu: "2"
    requests.memory: 4Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "30"
```

Process ID limits deserve a quick mention because fork bombs are still real. Kubernetes supports PID limiting at the node and pod level through kubelet configuration, commonly through `podPidsLimit` in cluster-managed settings. Application teams usually cannot set that field in an ordinary Deployment manifest. Platform teams configure it on nodes so one pod cannot create enough processes to starve the node.

Resource controls keep the workload from consuming the whole node. Network controls keep the workload from talking to everything it can route to.

## Network Exposure
<!-- section-summary: Network isolation narrows which pods and services can reach payments-api and which destinations payments-api can call. -->

**Network exposure** means the paths where traffic can enter or leave the pod. Kubernetes gives every pod an IP address, and many clusters allow broad pod-to-pod traffic unless a NetworkPolicy-capable CNI plugin enforces restrictions. A Service gives the pod a stable name and virtual IP. Ingress, Gateway API, or a load balancer can expose the service outside the cluster.

For `payments-api`, the expected network shape is narrow. Public traffic should arrive through the platform's gateway. The API should talk to the payment database, a payment processor egress path, metrics, and DNS. It should not accept direct traffic from every namespace, and it should not freely scan internal services after compromise.

A Service can stay internal. This keeps `payments-api` reachable inside the cluster while the public gateway remains the only outside entry point:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payments-api
  namespace: payments
spec:
  type: ClusterIP
  selector:
    app: payments-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

That Service maps cluster-internal port `80` to container port `8080`. The pod still avoids privileged low ports. The gateway, not the application container, owns the public edge.

A NetworkPolicy can then limit ingress and egress. The exact labels vary by cluster, but the shape usually looks like this:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: payments-api-expected-traffic
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payments-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress
          podSelector:
            matchLabels:
              app: public-gateway
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: data
          podSelector:
            matchLabels:
              app: payments-db
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

This policy says the gateway can reach `payments-api` on port `8080`, `payments-api` can reach the database on `5432`, and DNS still works. Real teams often start with ingress policy first, then add egress policy after mapping normal dependencies. Egress policy can break hidden dependencies, so staging and telemetry matter.

There are a few high-risk networking settings reviewers should challenge. `hostNetwork: true` puts the pod in the node's network namespace. `hostPort` opens a port directly on the node. `NodePort` exposes a service through every node. These settings have valid infrastructure uses, such as ingress controllers or network agents, but a normal `payments-api` deployment should reach users through the platform gateway instead.

Now the deployment has workload-level controls. The next step is making sure every workload in the namespace follows the same baseline.

## Kubernetes Guardrails
<!-- section-summary: Pod Security Standards and admission policy turn per-deployment runtime settings into namespace-wide expectations. -->

Kubernetes has **Pod Security Standards**, usually shortened to PSS. They define three policy levels for pod security: **Privileged**, **Baseline**, and **Restricted**. Privileged allows broad host access for trusted infrastructure workloads. Baseline blocks many known privilege-escalation paths while allowing common application patterns. Restricted applies the strongest built-in profile for ordinary application pods.

For the `payments` namespace, the team wants Restricted. That lines up with the controls already shown: no privileged containers, no privilege escalation, dropped capabilities, non-root execution, seccomp, and tight volume choices.

Kubernetes can enforce these standards with namespace labels through Pod Security Admission. The labels below tell the API server to reject pods that violate the Restricted profile and also record warnings and audit events:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.36
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.36
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.36
```

The version labels should match the Kubernetes minor version the platform team has chosen for policy evaluation. Pinning the version makes upgrades deliberate. During an upgrade, the platform team can compare the new PSS rules, update manifests if needed, then move the label version forward.

PSS gives a strong built-in floor for pod security fields. Organization-specific rules still need their own checks: private-registry allowlists, image digest requirements, resource request requirements, NetworkPolicy expectations, and service account token rules for app pods. Teams usually combine PSS with CI checks, admission policies, or policy-as-code tooling for those organization-specific rules. The important part is that the app team and platform team share one baseline instead of debating every deployment from scratch.

Even with strong pod security, some workloads deserve a stronger boundary because the threat model is different. That is where sandbox runtimes come in.

## Sandbox Runtimes
<!-- section-summary: Sandbox runtimes add a stronger boundary for high-risk workloads, usually through Kubernetes RuntimeClass. -->

A **sandbox runtime** adds another isolation layer around containers. The normal Linux container model still shares the host kernel. Sandbox runtimes reduce that sharing in different ways. They usually cost more in startup time, performance, compatibility, or operational complexity, so teams use them for workloads where the extra boundary is worth it.

**gVisor** runs containers with an application kernel implemented in user space. The container's syscalls go to gVisor's `runsc` runtime first, and gVisor handles or mediates them before the host kernel sees the request. This can reduce direct exposure to the host kernel for many application workloads.

**Kata Containers** runs containers inside lightweight virtual machines. That gives each sandbox its own guest kernel and a VM boundary. This can be useful for stronger tenant isolation, especially where teams want the container workflow with a boundary closer to a virtual machine.

For the normal `payments-api`, a hardened standard runtime may be enough. The service is built by the team, deployed from a trusted pipeline, and runs ordinary HTTP code. A sandbox runtime starts to matter if the platform also runs less trusted code: customer-defined transformations, third-party payment plugins, CI jobs for external pull requests, browser automation, code execution challenges, or multi-tenant workloads where different customers share nodes.

Kubernetes uses **RuntimeClass** to select an alternate runtime. The platform team installs and configures the runtime on a node pool, then creates a RuntimeClass:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

The workload can then request that runtime. This example uses a plugin runner because sandbox runtimes usually make the most sense for code that is less trusted than the core `payments-api` service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: partner-fraud-plugin-runner
  namespace: payments
spec:
  template:
    spec:
      runtimeClassName: gvisor
      containers:
        - name: plugin-runner
          image: registry.example.com/payments/plugin-runner@sha256:71d3c9...
```

A Kata-backed cluster might expose a RuntimeClass with a handler such as `kata`, depending on how the platform installed it. The exact handler name is a cluster contract. Application teams should treat `runtimeClassName` as a platform-provided option, not a field they can invent in app YAML.

Sandbox runtimes still need the earlier controls. A gVisor or Kata pod should still run as non-root, drop capabilities, use seccomp where supported, avoid broad network access, set resource budgets, and follow Pod Security Standards. The sandbox adds a stronger boundary while the earlier workload hygiene still carries the daily controls.

Before the article closes, the team needs a way to verify these settings without turning the checklist into guesswork. That verification work should happen in staging and CI, before the same manifest reaches production.

## Verification and Debugging Workflow
<!-- section-summary: A short staging workflow checks admission, runtime settings, filesystem writes, resource behavior, and network policy before production rollout. -->

Runtime isolation works best when the team checks it during normal delivery and during incident drills. For `payments-api`, the CI pipeline can lint the manifests, the cluster can reject unsafe pods through admission, and a staging rollout can confirm that the app still runs under the tighter settings.

A practical staging session might look like this. These commands check admission first, then inspect the running pod only after the manifest passes server-side validation:

```bash
kubectl apply --server-side --dry-run=server -f k8s/payments-api.yaml
kubectl get events -n payments --sort-by=.lastTimestamp
kubectl describe pod -n payments -l app=payments-api
kubectl exec -n payments deploy/payments-api -- id
kubectl exec -n payments deploy/payments-api -- sh -c 'grep -E "CapEff|NoNewPrivs|Seccomp" /proc/1/status'
kubectl exec -n payments deploy/payments-api -- sh -c 'cat /proc/1/attr/current || true'
kubectl exec -n payments deploy/payments-api -- sh -c 'touch /tmp/probe && (touch /app/probe || true)'
kubectl top pod -n payments
```

The server-side dry run checks the manifest against API validation and admission without creating the workload. Events and `describe pod` show Pod Security Admission failures, missing AppArmor profiles, image pull problems, scheduling failures, OOM kills, and other runtime clues. The `id` command confirms the process user. `/proc/1/status` shows capability and seccomp details for PID 1. `/proc/1/attr/current` can show the active AppArmor or SELinux context on many Linux nodes. The write test confirms that `/tmp` is writable and `/app` stays read-only. `kubectl top` gives a quick view of CPU and memory behavior after traffic starts.

Some production images use distroless or minimal bases and have no shell. That is a good supply-chain choice. In that case, the team can run these checks in a staging variant, a temporary debug pod with the same security context, or through application health checks and node-level observability. The team should avoid adding a shell to the production image only for convenience because that increases the runtime tools available to an attacker.

Debugging usually follows the symptom. `CreateContainerError` with AppArmor text often points to a missing or unsupported profile. `CrashLoopBackOff` after enabling `readOnlyRootFilesystem` often points to a write path that needs an `emptyDir`, a config change, or an application fix. `OOMKilled` points to memory limits or a leak. Repeated `Operation not permitted` after a seccomp change can point to a blocked syscall. Connection timeouts after applying NetworkPolicy usually mean an expected ingress, egress, or DNS path was missing.

This workflow gives the team a way to test runtime isolation as part of delivery. The final piece is connecting all the controls back to the story.

## Putting It All Together
<!-- section-summary: Runtime isolation turns a trusted image into a constrained workload that can run in Kubernetes with a smaller blast radius. -->

The `payments-api` image now has two kinds of protection around it. The earlier articles handled what happens before the pod starts: build hygiene, scanning, signing, private registry release, and digest-based deployment. This article handled what happens after the pod starts: the process receives a narrow Linux identity, a read-only image filesystem, a small writable scratch area, dropped capabilities, default seccomp, AppArmor or SELinux policy, resource budgets, narrow network paths, namespace guardrails, and optional sandbox runtime support for higher-risk workloads.

The key idea is **blast radius**. A runtime bug may still happen. A vulnerable library may still reach production. A bad request may still trigger an unexpected code path. Runtime isolation makes the compromised process less powerful. It can serve traffic, write to `/tmp`, use the dependencies it was designed to use, and exit. It has fewer paths to change the node, inspect neighbors, exhaust shared resources, or move through the cluster.

For a small team, the most useful starting point is straightforward. Use a private-registry image by digest. Run as a non-root UID. Drop all capabilities. Set `allowPrivilegeEscalation: false`. Use `RuntimeDefault` seccomp. Use AppArmor or SELinux defaults from the platform. Make the root filesystem read-only and mount only the writable paths the app actually needs. Add CPU, memory, and storage budgets. Keep the service internal behind the gateway. Add NetworkPolicy for expected paths. Enforce the Restricted Pod Security Standard in the namespace. Reach for gVisor or Kata when the workload runs less trusted code or needs a stronger tenant boundary.

After learning the parts, the full baseline is much easier to read:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payments-api
  template:
    metadata:
      labels:
        app: payments-api
    spec:
      serviceAccountName: payments-api
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
        appArmorProfile:
          type: RuntimeDefault
      containers:
        - name: payments-api
          image: registry.example.com/payments/payments-api@sha256:9b6d2f4e...
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - secretRef:
                name: payments-api-runtime
          securityContext:
            privileged: false
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: app-cache
              mountPath: /app/.cache
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
              ephemeral-storage: 64Mi
            limits:
              cpu: 500m
              memory: 512Mi
              ephemeral-storage: 256Mi
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 64Mi
        - name: app-cache
          emptyDir:
            sizeLimit: 64Mi
```

This final manifest is the assembled version of the skeleton from the start of the article. The pod-level `securityContext` sets the Linux user, group, seccomp profile, and AppArmor profile. The container-level `securityContext` drops Linux capabilities, blocks privilege escalation, and keeps the image filesystem read-only. The `emptyDir` volumes give the application small writable paths without making the whole image filesystem writable. The resource section gives the scheduler and kubelet a clear budget.

That is the complete container and image security path for `payments-api`: build a trustworthy artifact, store and release it through a trusted registry path, then run it with limits that match what the service actually needs. Production risk continues after the image starts, so runtime isolation closes the container security loop.

![Runtime isolation summary infographic showing trusted image, constrained process, small write area, narrow network, resource budget, and optional sandbox around payments-api](/content-assets/articles/article-devsecops-container-image-security-registry-security/runtime-isolation-summary.png)

*The runtime summary is the final handoff: a trusted image still runs as a constrained process with limited files, network paths, resources, and sandbox options.*

## References

- [Kubernetes Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Documents pod and container `securityContext` fields such as users, groups, capabilities, seccomp, AppArmor, privilege escalation, and read-only root filesystems.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Defines the Privileged, Baseline, and Restricted policy levels for pods.
- [Enforce Pod Security Standards with namespace labels](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/) - Shows how Pod Security Admission uses `pod-security.kubernetes.io/*` labels.
- [Linux kernel security constraints for Pods and containers](https://kubernetes.io/docs/concepts/security/linux-kernel-security-constraints/) - Explains seccomp, AppArmor, SELinux, privilege escalation, privileged containers, and kernel-level isolation.
- [Docker seccomp security profiles](https://docs.docker.com/engine/security/seccomp/) - Explains Docker's default seccomp profile and how seccomp limits Linux syscalls.
- [Linux seccomp manual page](https://man7.org/linux/man-pages/man2/seccomp.2.html) - Documents the Linux `seccomp` system call and `/proc` seccomp status fields.
- [AppArmor documentation](https://apparmor.net/) - Official AppArmor documentation for profile-based Linux application confinement.
- [SELinux Project](https://selinuxproject.github.io/) - Upstream SELinux project resources, including the SELinux Notebook technical reference.
- [Linux capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html) - Defines Linux capability names and the privileged operations they control.
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Documents pod ingress and egress isolation with NetworkPolicy.
- [Kubernetes Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Documents CPU, memory, and ephemeral storage requests and limits.
- [Kubernetes PID limiting](https://kubernetes.io/docs/concepts/policy/pid-limiting/) - Explains pod and node process ID limits.
- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/) - Documents selecting different container runtime configurations for pods.
- [gVisor documentation](https://gvisor.dev/docs/) - Describes gVisor's container sandboxing model and runtime.
- [Kata Containers documentation](https://katacontainers.io/docs/) - Documents Kata Containers and its lightweight virtual machine isolation model.
