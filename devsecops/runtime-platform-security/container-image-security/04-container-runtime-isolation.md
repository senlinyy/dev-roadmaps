---
title: "Container Runtime Isolation"
description: "Constrain running containers with non-root users, dropped capabilities, seccomp, AppArmor or SELinux, resource limits, network policy, and sandbox runtimes."
overview: "Start with a signed payments-api image finally running as a Linux process on a Kubernetes node. Then learn why containers share the host kernel, how to set a runtime baseline, and how capabilities, seccomp, AppArmor or SELinux, non-root execution, read-only filesystems, resource limits, network policy, Kubernetes guardrails, sandbox runtimes, and verification reduce the blast radius of a compromised container."
tags: ["devsecops", "runtime-isolation", "seccomp", "apparmor"]
order: 4
id: article-devsecops-container-image-security-registry-security
---

## Table of Contents

1. [Why Is a Trusted Image Still an Untrusted Running Process?](#why-is-a-trusted-image-still-an-untrusted-running-process)
2. [How Do Identity and Capabilities Limit Process Authority?](#how-do-identity-and-capabilities-limit-process-authority)
3. [How Do Seccomp and Mandatory Access Control Narrow Kernel Access?](#how-do-seccomp-and-mandatory-access-control-narrow-kernel-access)
4. [How Do Filesystems, Secrets, and Credentials Define Runtime Power?](#how-do-filesystems-secrets-and-credentials-define-runtime-power)
5. [How Do Resource Limits Protect Availability?](#how-do-resource-limits-protect-availability)
6. [How Do Network and Kubernetes Boundaries Reduce Lateral Movement?](#how-do-network-and-kubernetes-boundaries-reduce-lateral-movement)
7. [When Are Admission Guardrails and Sandbox Runtimes Needed?](#when-are-admission-guardrails-and-sandbox-runtimes-needed)
8. [What Does a Verified Runtime Isolation Baseline Look Like?](#what-does-a-verified-runtime-isolation-baseline-look-like)
9. [Check Your Answers](#check-your-answers)

Supply-chain controls answer whether the expected artifact reached the runtime. They do not guarantee that the application will behave safely after it starts. A correctly signed image can contain an exploitable application flaw, process attacker-controlled data, or receive dangerous runtime configuration.

The lifecycle crosses an important boundary:

```text
reviewed source
  -> trusted image digest
  -> runtime creates a Linux process
  -> process handles untrusted input
```

Container runtime isolation begins with that last transition. The artifact may be trusted as the approved build while the executing process is treated as potentially compromisable.

A container process is not a miniature virtual machine by default. It is a Linux process whose view and authority are shaped by the runtime. Namespaces can give it a separate view of process IDs, mounts, networking, host names, users, and interprocess communication. Cgroups can account for and limit resources. Capabilities split parts of root authority. Seccomp can filter system calls. Mandatory access control can restrict access to kernel objects.

Keep these questions in view as you work through the lesson:

1. **Why Is a Trusted Image Still an Untrusted Running Process?**
2. **How Do Identity and Capabilities Limit Process Authority?**
3. **How Do Seccomp and Mandatory Access Control Narrow Kernel Access?**
4. **How Do Filesystems, Secrets, and Credentials Define Runtime Power?**
5. **How Do Resource Limits Protect Availability?**
6. **How Do Network and Kubernetes Boundaries Reduce Lateral Movement?**
7. **When Are Admission Guardrails and Sandbox Runtimes Needed?**
8. **What Does a Verified Runtime Isolation Baseline Look Like?**

## Why Is a Trusted Image Still an Untrusted Running Process?
<!-- section-summary: A signed and reviewed image becomes an ordinary Linux process on a shared-kernel host, so artifact trust must be complemented by controls that limit what the process can see, call, change, and consume. -->

Namespaces change what the process sees, not the fact that it uses the host kernel. A process can see a container-local PID 1 while the host sees another PID. It can see a container mount tree while the host owns the underlying filesystems. It can have its own network interfaces while packets still pass through host networking.

```text
container view A ----\
container view B -----+--> one host kernel
host processes -------/
```

This shared-kernel model is efficient, but it makes kernel attack surface and runtime configuration central. A dangerous system call, excessive capability, host namespace, writable host mount, or kernel vulnerability can weaken the boundary.

Each namespace answers a visibility question. A PID namespace controls which processes and identifiers appear. A mount namespace supplies a separate filesystem view. A network namespace owns interfaces, routes, and ports. UTS isolation changes host-name and domain-name views. IPC isolation separates certain communication objects. A user namespace can map container identities to different host identities. These mechanisms compose; “has namespaces” is not a useful yes-or-no conclusion unless the reviewer knows which views are separate and which are shared.

Namespaces also do not automatically authorize every object inside their view. Filesystem permissions, capabilities, seccomp, mandatory access control, and cgroups still govern actions. Conversely, a process placed into a host namespace may gain dangerous visibility even if other settings remain restrictive. Isolation is a layered property, so weakening one layer can expose assumptions in another.

The container runtime participates in creating those layers. It receives the image and runtime specification, creates namespaces and cgroups, prepares mounts, selects security profiles, and starts the process. Access to its control socket can therefore be equivalent to broad node authority. An application container should not mount that socket merely to inspect itself or launch helper containers.

The host kernel remains responsible for syscall handling, memory management, networking, devices, and much of filesystem mediation. Keep nodes patched, reduce host services, and isolate sensitive workload classes. Workload hardening limits reachable kernel surface and consequences, but it cannot make a vulnerable shared kernel cease to exist.

Isolation is therefore about reducing authority. For a payments API, ask what the process actually needs:

- accept requests on its application port;
- initiate connections to the payment database or approved services;
- read its program and static configuration;
- read a small set of runtime secrets;
- write logs to standard output;
- write bounded temporary data;
- use a defined CPU, memory, process, and storage budget.

It probably does not need host root, arbitrary kernel capabilities, raw network packets, host process visibility, host filesystem access, package installation, unlimited process creation, or unrestricted east-west connectivity.

![Runtime isolation layers infographic showing a payments-api pod constrained by non-root UID, dropped capabilities, seccomp, AppArmor or SELinux, NetworkPolicy, resource limits, and the node kernel boundary](/content-assets/articles/article-devsecops-container-image-security-registry-security/runtime-isolation-layers.png)

No single control creates “a secure container.” Each answers a narrower question. Namespace isolation limits visibility. Identity and capabilities limit privilege. Seccomp limits kernel mechanisms. AppArmor or SELinux limits object access. Read-only filesystems limit mutation. Cgroups limit resource consumption. Network policy limits communication. A sandbox can add a stronger kernel boundary.

The objective is blast-radius reduction. Assume application compromise is possible, then make compromise of this process insufficient for host control, durable filesystem persistence, arbitrary lateral movement, or node-wide denial of service.

## How Do Identity and Capabilities Limit Process Authority?
<!-- section-summary: Run as a fixed non-root identity, remove unneeded Linux capabilities, and prevent privilege escalation so exploited code begins with and remains inside a narrow permission set. -->

Root inside a container is constrained by namespaces and runtime configuration, but it is still a high-authority starting point. Root can often change ownership and permissions inside its namespace, interact with privileged interfaces, and take advantage of any capabilities the runtime retains. Dangerous mounts or host namespaces can turn container root into much broader control.

Run the application as a non-root user when it does not require root. Set the image default and enforce the runtime property. In Kubernetes, `runAsNonRoot: true` rejects a container that would run as root, while `runAsUser` and `runAsGroup` can select a numeric identity.

Linux capabilities explain why root is not all-or-nothing. The kernel divides many privileged operations into named units. Examples include changing ownership, bypassing file permissions, administering the network, sending signals to other identities, tracing processes, loading kernel modules, or using raw sockets.

A process can be UID 0 with only a subset of capabilities. It can also be non-root and receive an added capability. Review both identity and capability sets.

Start by dropping every capability, then add back only a capability tied to a tested requirement:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
```

Dropping capabilities changes post-exploitation options. Compromised code may still execute as the application user, but it has a harder time manipulating networking, observing other processes, changing protected files, mounting filesystems, or crossing namespace boundaries through privileged operations.

Do not add `CAP_NET_BIND_SERVICE` merely because an application historically listens below port 1024. Listen on an unprivileged port such as 8080 and let the service or ingress layer expose port 443. Removing the requirement is stronger than preserving a capability and trying to use it safely.

The same reasoning applies to permission problems. If the application needs to modify its installed code as root on startup, separate immutable code from writable data and fix ownership during the build. If it needs to change kernel networking, move that responsibility to platform infrastructure. Many security problems disappear when the application stops requiring the underlying power.

`allowPrivilegeEscalation: false` closes another route. It prevents the process from gaining more privilege through mechanisms such as set-user-ID executables. It does not remove current capabilities or make a root process non-root, so use it with identity and capability controls.

A useful baseline combines:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
```

Rootless container engines can reduce daemon and host authority, but “rootless” is not “invulnerable.” The process still uses a kernel, can consume resources, may receive credentials, and can reach networks. User namespaces and rootless operation add layers; they do not replace workload controls.

Verify the effective state rather than reading only YAML. Check the process UID and groups. Inspect effective, permitted, bounding, and ambient capability sets. Confirm a forbidden privileged operation fails. Image defaults, admission mutation, runtime defaults, and workload configuration can interact, so desired configuration is not enough.

Capability debugging should begin with the failed operation, not with a guessed capability. Observe the kernel denial or trace the exact action in a controlled environment. Determine whether the application should perform it at all. If the need is valid, ask whether architecture can remove it—for example, by moving port binding, time changes, network administration, or file ownership into the platform or image build.

Only after those checks should a specific capability be considered. Add it to one container, not the whole pod or node. Retest normal behavior and an abuse case associated with that capability. Document the owner and reason so a later refactor can remove it. Capability names are broad enough that solving one error can enable several unrelated actions.

Identity must be consistent with mounted storage. A numeric UID that works against the image can fail on a volume created with different ownership. Solve that through appropriate storage ownership and group policy rather than running the application as root. Review any recursive ownership changes because a large volume can delay startup and a shared volume can expose another workload's data.

Separate containers in one pod can also have different authority. A sidecar used for proxying or telemetry should not inherit the application's secrets, added capabilities, or writable volumes automatically. Sharing a network namespace is already a meaningful trust relationship. Scope mounts and identities per container, and treat an overpowered sidecar as part of the application's attack surface.

## How Do Seccomp and Mandatory Access Control Narrow Kernel Access?
<!-- section-summary: Capabilities limit privileged operations, seccomp filters system-call mechanisms, and AppArmor or SELinux restricts access to objects; together they reduce different parts of the kernel attack surface. -->

Capabilities answer whether a process has permission for classes of privileged action. System calls are the mechanisms through which any process asks the kernel to perform work. An application needs many ordinary calls for files, memory, networking, time, and process management, but it rarely needs every syscall exposed by the architecture.

Seccomp filters system calls. A profile can allow normal application behavior while denying unusual mechanisms such as loading kernel modules, changing namespaces, tracing unrelated processes, or invoking rarely needed kernel features.

The purpose is attack-surface reduction:

```text
all kernel entry mechanisms
  -> runtime default seccomp profile
  -> smaller application-usable set
```

If exploited code attempts a blocked syscall, the kernel enforces the profile. This can interrupt an attack path or make a kernel vulnerability unreachable from the process.

Seccomp is not a vulnerability scanner. It does not inspect application source, prove that allowed syscalls are safe, or discover malicious input. It restricts which kernel mechanisms the process can invoke. A vulnerability that uses ordinary allowed file or network calls can still work.

Use a maintained runtime-default profile as the general baseline. A custom profile can reduce the set further for stable high-risk workloads, but it creates a maintenance and compatibility obligation. Language runtimes, libraries, and architecture changes can legitimately introduce new syscall needs.

Capabilities and seccomp solve related but different problems. A process may be denied a privileged action because it lacks the capability even though the syscall is allowed. A seccomp profile may block a syscall regardless of the process's ordinary permissions. Use both when both boundaries matter.

AppArmor and SELinux add an object-level policy axis. They can restrict which files, paths, sockets, devices, or other objects a process may access, even when discretionary Unix permissions would otherwise allow it.

Conceptually:

```text
capability: may this process perform this privileged class of action?
seccomp:    may this process invoke this kernel mechanism?
MAC:        may this labeled process access this labeled object in this way?
```

Mandatory access control matters because a compromised process runs under the same Unix identity as the legitimate application. Ordinary ownership often cannot distinguish a valid code path from malicious code executing inside it. A mandatory policy can still deny access outside the declared object set.

An AppArmor profile can describe path-oriented access and execution constraints. SELinux uses labels and type enforcement to mediate relationships between subjects and objects. Their operational models differ, but the first-principles goal is the same: possession of the process identity should not imply access to every object that identity might otherwise reach.

Profiles need enforcement, distribution, and verification. A profile name in workload configuration is useless if the node did not load it or the runtime does not enforce it. Admission can require an approved profile, node management can ensure it exists, and runtime tests can attempt denied access.

Default profiles are intentionally compatible with broad classes of software. They remove clearly dangerous or unusual mechanisms while preserving ordinary language runtimes and utilities. That makes them a valuable baseline, not a proof of minimum syscall access. A custom profile can be derived from observed behavior, but observation during one test may miss error handling, startup migration, certificate reload, shutdown, or rare library paths.

Profile rollout should therefore use representative fixtures and gradual enforcement. Exercise startup, load, failure, recovery, and maintenance operations. Observe denials in a non-production environment, classify each, and make the profile version part of deployment evidence. A runtime or base-image upgrade may change required calls even when application code does not.

Mandatory access-control policy needs similar lifecycle ownership. The profile should travel through review, testing, node distribution, enforcement, and deprecation. An application release that references a missing profile should fail safe rather than quietly run unconfined. If an emergency exception disables a profile, bound it to a workload and time, and retain the event.

These controls can also improve detection. A syscall or file access that should never occur creates a high-quality signal when denied. Repeated denials can indicate a compatibility mistake, active exploitation, or an application's undocumented behavior. Route them with workload identity, node, profile version, and container digest so responders can distinguish one bad instance from a fleet-wide configuration issue.

Debug seccomp or MAC failures with evidence. Identify the denied operation from audit records, determine whether it is a real application requirement, and make the narrowest justified change. Do not switch to unconfined as a permanent response to one unexplained error. A failure can reveal an unnecessary behavior or compromised path as easily as a legitimate dependency.

## How Do Filesystems, Secrets, and Credentials Define Runtime Power?
<!-- section-summary: Treat the image filesystem as immutable software, expose only explicit writable paths, and recognize secrets and service-account tokens as capabilities that expand what compromise can reach. -->

The root filesystem should usually be treated as software, not storage. It came from an immutable image whose contents were reviewed, scanned, signed, and identified by digest. Allowing the running process to rewrite that filesystem weakens the relationship between deployed artifact and observed behavior.

Set `readOnlyRootFilesystem: true` and provide explicit writable mounts for genuine runtime needs:

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

Read-only roots limit several post-compromise actions: replacing the application binary, modifying libraries, editing startup configuration, installing a package into the image, or leaving durable tools in ordinary image paths. They do not make every mount read-only; an attached volume or host path can still be writable and dangerous.

Design application layout so executable code and configuration defaults are not owned as writable data by the runtime user. Give temporary work a dedicated ephemeral directory. Give genuine persistent state a purpose-built volume and access policy. Send logs to standard output or an external sink rather than modifying application directories.

A restart replaces changes in the container's writable layer, but relying on restart as cleanup is weak. The process can still use modified files during its lifetime, and writable volumes can preserve them. Make mutation boundaries explicit from the start.

Secrets are part of runtime isolation because they convey external authority. A database password, signing token, cloud identity, message-queue credential, or certificate can let a compromised process act beyond its namespace. Mount or inject only the secrets required by this workload, keep them out of the image, and rotate them independently.

Service-account credentials are capabilities too. In Kubernetes, a pod may receive an API token automatically. If the application never calls the Kubernetes API, disable automatic mounting. If it does, bind the service account to the smallest set of verbs and resources. A read-only root filesystem cannot stop an attacker from using a valid API token already available in memory or a mounted path.

Avoid ambient authority: credentials, sockets, mounts, metadata endpoints, devices, and broad network routes available merely because the process exists. Require explicit workload configuration for each. An ideal design lets a reviewer derive the application's possible actions from its declared interfaces.

HostPath mounts are especially dangerous because they expose pieces of the node filesystem. A mount of the container runtime socket can effectively grant control over other containers. A writable host directory can allow persistence or tampering outside the pod. Prefer platform-managed volumes and reject broad or sensitive host paths by policy.

Host process, network, and IPC namespaces similarly weaken isolation. `hostPID`, `hostNetwork`, and `hostIPC` merge a pod's view with the node in important ways. Some infrastructure workloads need them, but ordinary applications should not inherit the exception.

Filesystem verification should be negative as well as positive. Confirm the service can read its executable and required configuration. Then attempt writes to application code, system paths, and undeclared directories and verify they fail. Confirm writable mounts have the expected ownership, size behavior, and lifecycle.

Mount options contribute to the boundary. A volume that stores only data may not need executable files or device nodes. A configuration or secret mount should normally be read-only. A shared volume between containers creates an intentional communication channel and a path for one compromised process to influence another. Document the writer and reader rather than treating the shared directory as harmless plumbing.

Secret delivery should minimize both number and duration. Do not mount every namespace secret into a pod because selecting them individually is inconvenient. Prefer a workload identity or narrowly scoped secret that can be rotated without rebuilding the image. If a credential is written to a filesystem, restrict its path and mode; if it is placed in an environment variable, remember that process inspection, crash output, and diagnostics may expose it.

The application's downstream permission defines the consequence of secret theft. A database credential limited to one schema and expected operations is safer than an administrative password. A cloud identity limited to one queue is safer than an account-wide role. Runtime isolation and service-side authorization must work together because a stolen credential can be used from the compromised process through an allowed network edge.

Avoid using a single secret to authorize both normal runtime work and emergency administration. The process should not possess destructive maintenance power all the time. Run migrations, key rotation, or repair through separate short-lived jobs and identities. Removing dormant credentials lowers ambient authority without depending on the container boundary to protect them perfectly.

## How Do Resource Limits Protect Availability?
<!-- section-summary: Cgroup-backed limits on memory, CPU, process count, and ephemeral storage prevent one compromised or faulty container from consuming the node's finite shared resources without bound. -->

Isolation is not only about confidentiality and privilege. Availability is a security property. A process that consumes all memory, CPU, process IDs, or local storage can disrupt neighboring workloads and the node itself.

Cgroups let the runtime account for and constrain resource use. Kubernetes requests help scheduling by describing expected capacity; limits establish ceilings for supported resources. They are related but not interchangeable.

Memory is finite. An application leak, decompression bomb, malicious request, or attacker can allocate until the node experiences pressure. A memory limit bounds the container, although exceeding it may cause the process to be terminated. The limit must be paired with realistic requests, restart behavior, monitoring, and protection of node-critical services.

Do not set memory from guesswork alone. Measure normal and peak behavior, account for language runtime overhead and caches, exercise high-risk inputs, then leave a deliberate margin. A limit so high that every pod can exhaust the node is ineffective; a limit below normal peaks creates self-inflicted outages.

CPU is shareable over time but still exhaustible. A compromised endpoint can trigger expensive computation or infinite loops. CPU requests influence allocation, while limits can throttle sustained use. Throttling may increase latency and request backlog, so observe application behavior under the chosen budget.

Process count is another finite namespace. A fork bomb or uncontrolled worker creation can consume PIDs even when memory use appears moderate. Apply a process limit where the runtime supports it and ensure the application's worker model fits inside it.

Ephemeral storage includes writable container layers, logs, and local ephemeral volumes. A service that writes unbounded temporary files can fill node storage and interfere with image pulls or other pods. Declare and monitor ephemeral storage needs, bound temporary data, and clean it by lifecycle rather than trusting every request path.

A conceptual budget is:

```text
payments-api instance
  memory: bounded working set
  CPU: bounded compute share
  processes: bounded worker and child count
  ephemeral storage: bounded temporary data and logs
```

Resource limits change an attack chain. They do not prevent exploitation, but they stop one compromised process from automatically gaining unlimited node-wide denial-of-service power. Multiple replicas and autoscaling require aggregate reasoning: one request that forces every replica to its limit can still exhaust the cluster.

Observe throttling, out-of-memory termination, restart loops, PID pressure, disk pressure, and unexpected growth. These signals are both operational and security evidence. A workload that suddenly spawns processes or fills temporary storage may be faulty or compromised.

Admission policy can require requests and limits so developers cannot accidentally omit the model. Platform defaults can help, but workloads still need measured values. A universal tiny limit or universal huge limit only hides the design decision.

Memory failure behavior deserves explicit testing. When the kernel terminates the process for exceeding its cgroup memory limit, the application cannot perform a graceful shutdown. Requests may be interrupted, temporary work may remain, and repeated restarts can amplify load. Protect correctness with idempotent processing, bounded queues, health checks, and backoff rather than raising the limit until the symptom disappears.

CPU and memory also interact. A throttled process can retain requests and memory longer, while garbage collection may require CPU to release memory. Load testing should observe latency, queue depth, throttling time, resident memory, and restart behavior together. Security limits should bound abuse without creating a predictable low-cost denial of service against normal traffic.

Resource policy operates at several scopes. A container limit bounds one process group, pod-level behavior combines its containers, namespace quotas bound a team's aggregate requests, and node reservations protect system components. An attacker who can create many allowed pods may bypass a strong per-container limit unless admission, quotas, and identity permissions also restrict replica and workload creation.

Ephemeral storage deserves the same failure planning. Decide what happens when temporary space is exhausted: reject a request, evict old cache entries, pause intake, or fail the pod. Logs should be collected and rotated outside an unbounded writable layer. A read-only root plus one unlimited `emptyDir` has only moved the storage risk.

Negative resource tests can allocate memory, consume CPU, spawn children, and fill temporary storage in a controlled environment. Confirm that the workload is contained, the node stays healthy, alerts identify the responsible pod, and recovery does not require weakening the baseline. These exercises turn declared numbers into verified isolation behavior.

## How Do Network and Kubernetes Boundaries Reduce Lateral Movement?
<!-- section-summary: Network access is authority, so model the intended service graph, deny other ingress and egress, and reject Kubernetes settings that connect ordinary pods to host namespaces, devices, or filesystems. -->

Network access lets a process influence other systems and receive input. Treat each allowed path as a capability. A payments API may need inbound traffic from an ingress layer, outbound access to a payments database, and perhaps a telemetry endpoint. It does not automatically need every pod, node service, metadata endpoint, and internet destination.

Build the application graph explicitly:

```text
ingress
  -> payments-api
      -> payments database
      -> approved payment provider
      -> telemetry collector
```

Then express default-deny ingress and egress, adding only those edges. East-west traffic matters because an attacker often moves from one internal service to another. A private cluster network is not a trusted flat zone.

Network policy relies on the platform's networking implementation. A YAML object is not enforcement if the network plugin ignores it. Test both allowed and denied connections from representative pods. Account for DNS, identity endpoints, time, telemetry, and other infrastructure dependencies deliberately rather than opening all egress when one name lookup fails.

Network exposure begins before policy. A host-networked pod shares the node network namespace. A host port or broad service type can expose a process beyond its intended path. A workload that binds every interface may be reachable from sidecars or local peers. Review listening addresses, services, ingress, load balancers, routes, and firewall layers together.

Kubernetes does not automatically make a container secure. It schedules and manages workloads; its APIs can also request extremely powerful runtime settings.

`privileged: true` removes many ordinary container restrictions and can expose devices and kernel interfaces. From first principles, it is not a small compatibility flag. It changes the pod from an application process toward a host administration process.

Host namespaces weaken separation by letting the pod observe or participate in node process, network, or IPC state. HostPath volumes can reveal node credentials, runtime sockets, system configuration, or writable executable paths. Added devices and capabilities create further host authority.

The pod `securityContext` makes several intentions explicit:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
spec:
  automountServiceAccountToken: false
  containers:
    - name: app
      image: registry.example/payments@sha256:ABC
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
        seccompProfile:
          type: RuntimeDefault
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 256Mi
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

![Security context baseline infographic showing runAsNonRoot, readOnlyRootFilesystem, allowPrivilegeEscalation false, drop ALL, RuntimeDefault seccomp, and tmp emptyDir settings applied to payments-api](/content-assets/articles/article-devsecops-container-image-security-registry-security/security-context-baseline.png)

This baseline does not show network policy, service account RBAC, mandatory access control, storage size, or every platform requirement. It makes several important defaults visible and gives admission policy something concrete to enforce.

The network boundary must consider credentials. If the process can reach a cloud metadata service and obtain an overpowered identity, network and identity failures combine. If it can reach the Kubernetes API with a mounted token, it may discover or mutate cluster objects. Limit route and credential together.

Default-deny policy needs both ingress and egress. Ingress-only rules can stop unexpected callers while allowing a compromised service to scan peers or exfiltrate data. Egress-only rules can limit movement while leaving the service exposed from every namespace. Start with no allowed edges in each relevant direction and add the graph intentionally.

Select peers by stable workload or namespace identity rather than fragile pod IP addresses. Review who can assign the labels used by policy, because a user who can self-apply a trusted label may enter an allowed path. Namespace boundaries and RBAC over labels therefore contribute to network policy integrity.

DNS is a dependency and a control boundary. Allowing DNS plus unrestricted destination resolution can make egress policy broader than it appears, while blocking DNS may cause teams to open all traffic during debugging. Identify the resolver path, permitted external destinations, and how name-to-address changes are handled. Network policy alone may not express every domain-level restriction.

Encryption and application authentication still matter on allowed paths. Network policy says which endpoints may communicate; it does not prove the remote application identity or protect data from every compromised network component. Use service authentication and transport protection according to the threat model.

Test policy from both sides. An authorized ingress caller should reach the service, while a pod without the expected identity should fail. The service should reach each required dependency and fail against representative peer, node, metadata, and internet destinations. Repeat tests after changing labels, namespaces, the network plugin, or cluster topology.

Kubernetes control-plane authority is another lateral path. A token allowed to list secrets, create pods, or update workloads can turn one compromised container into broader cluster execution. Bind service accounts per workload, avoid wildcard verbs and resources, and monitor API use that differs from the application's normal pattern.

## When Are Admission Guardrails and Sandbox Runtimes Needed?
<!-- section-summary: Admission policy prevents unsafe pod classes before execution, while sandbox runtimes add a stronger kernel boundary for high-risk or multi-tenant workloads where shared-kernel isolation is not enough. -->

Good DevSecOps moves runtime expectations from documentation into enforcement. A checklist that says “do not use privileged containers” is weak if any deployment can set `privileged: true`. Admission control examines the requested pod before it runs and accepts, rejects, or mutates it according to policy.

Guardrails can require:

- non-root execution;
- no privilege escalation;
- dropped capabilities;
- an approved seccomp and mandatory access-control profile;
- no privileged mode or host namespaces;
- no forbidden HostPath mounts or devices;
- resource requests and limits;
- approved image registries and digest references;
- controlled service accounts;
- required runtime class for high-risk workloads.

Enforce classes of acceptable workload rather than one enormous hard-coded manifest. Platform agents, storage drivers, and node networking may have justified privileges that ordinary application pods do not. Put exceptions in named, narrow workload classes with accountable ownership instead of allowing every namespace to copy them.

Admission is valuable because it acts before execution. It prevents an unsafe pod from briefly starting, obtaining a token, mounting a socket, or exposing a host port while a later scanner catches the problem. Protect policy configuration and bypass identities as carefully as the workloads it governs.

Pod-level isolation is not node-level isolation. Two well-configured pods still share a host kernel unless a stronger runtime boundary is used. Multi-tenancy changes the threat model because a kernel escape or node compromise can cross team, customer, or sensitivity boundaries.

Sandbox runtimes exist because the host kernel is the critical shared boundary. They can interpose a user-space kernel or lightweight virtual machine so many workload syscalls do not reach the host kernel directly. The runtime still executes containers, but the isolation architecture is stronger than ordinary namespaces alone.

Why not sandbox everything maximally? Stronger isolation can add startup time, memory overhead, operational complexity, observability differences, device limitations, syscall incompatibility, and performance cost. Select the boundary according to workload risk.

Attacker-controlled input is an important signal. A service that only processes trusted internal jobs has a different exposure from a public code executor, document converter, plug-in host, browser automation service, or multi-tenant build runner. The latter class may justify a dedicated node pool, sandbox runtime, or full virtual-machine boundary.

```text
ordinary internal API
  -> hardened shared-kernel container may fit

untrusted code execution or strong tenant boundary
  -> sandboxed runtime or stronger isolation may fit
```

Stronger isolation does not remove least privilege. A sandboxed process can still leak its own secrets, attack permitted network peers, exhaust its assigned resources, or exploit the application. Apply non-root, capability, filesystem, credential, network, and resource controls inside the stronger boundary.

Admission can select the required runtime class based on namespace, data sensitivity, exposure, or workload type. It should also prevent a workload owner from silently switching back to a weaker class. Verify at runtime which handler actually created the sandbox.

Policy design must address direct and indirect bypass. A user blocked from creating a privileged pod might still update a controller template, create a job, use an allowed custom resource that generates pods, or impersonate an exempt service account. Apply enforcement to every pod-creation path and tightly govern exemption identities.

Validation, mutation, and defaults have different roles. Mutation can add safe defaults, such as a runtime seccomp profile, but it can hide important changes from authors and conflict with explicit settings. Validation makes the contract visible by rejecting unsafe requests. Use mutation for unambiguous platform-owned defaults and validation for properties that should be consciously satisfied.

Policy changes can break a fleet just as workload changes can. Test rules against representative manifests, including system workloads and known exceptions. Begin with audit or warning where appropriate, measure violations, repair owners' configurations, and promote to enforce with an identified policy version. Production bypass should be rare, time-bounded, and observable.

Node placement can strengthen workload classes. Keep privileged infrastructure pods, ordinary applications, and adversarial multi-tenant workloads on node pools with different trust and runtime configurations. Taints, tolerations, selectors, and admission policy must align so a workload cannot request a weaker pool casually.

Sandbox selection should follow the failure boundary needed. A user-space kernel can intercept system calls but may have compatibility limits. A lightweight virtual machine supplies a separate guest kernel but adds another image and patch lifecycle. A dedicated full virtual machine can provide stronger tenant separation at greater density and startup cost. The meaningful question is which host resources remain shared after compromise.

Test the stronger runtime rather than trusting its name. Confirm the requested runtime class was honored, the workload cannot reach host process or filesystem interfaces, resource accounting behaves as expected, networking follows policy, and observability still reaches responders. A sandbox with missing logs or unbounded outer resources can introduce new blind spots.

## What Does a Verified Runtime Isolation Baseline Look Like?
<!-- section-summary: A useful baseline is deny-by-default, tested against normal behavior and forbidden actions, observable at runtime, and expressed as invariants that assume application compromise. -->

Runtime configuration is desired state; the running process is reality. Verification should confirm both that the application works and that containment properties hold.

Start with positive behavior:

- the service starts and passes health checks;
- normal requests complete;
- required database and telemetry connections work;
- logs and temporary files use intended paths;
- shutdown and restart behave correctly;
- resource limits support measured load.

Then test negative security properties:

- the process is not root and cannot gain more privilege;
- no unexpected capabilities remain;
- writes outside declared mounts fail;
- forbidden syscalls or objects are denied;
- forbidden network destinations cannot be reached;
- the Kubernetes API is unavailable without an explicit need;
- host processes, files, sockets, devices, and namespaces are not visible;
- process, memory, CPU, and storage abuse is bounded;
- ordinary developers cannot deploy a manifest that disables the baseline.

“Works” and “contained” are different properties. A functional test can pass while the container runs privileged with an unrestricted token. A negative isolation test can pass while the application cannot process real traffic. Release validation needs both.

Debug hardening failures through least privilege. Reproduce the exact failure, observe the denied file, syscall, capability, connection, or resource, and decide whether the operation is truly required. Then make the smallest change and add a test. Do not respond with root, `privileged`, unconfined seccomp, a writable root, or open egress without proving the narrower alternatives insufficient.

Runtime observability is part of isolation. Collect process starts, capability use where available, seccomp and MAC denials, unexpected file changes, outbound connections, Kubernetes API calls, resource pressure, and identity use. A clear expected baseline makes deviations easier to detect.

Baselines should describe behavior, not just static settings. A payments API may normally start one runtime process, listen on one port, connect to two destinations, read three secret paths, write only temporary request fragments, and make no Kubernetes API calls. New shells, package downloads, child-process bursts, unexpected DNS names, or writes to executable locations are then meaningful deviations.

Signals need identity context: pod and namespace, container image digest, node, service account, runtime class, security profile, deployment revision, and owner. Without those links, a responder sees a denied syscall but cannot tell which artifact or team is involved. Preserve the evidence outside the compromised pod and protect its deletion path.

Not every denial is an incident. An application upgrade can make a new legitimate syscall, and a storage change can alter file access. Triage should compare the change, profile version, frequency, source process, and surrounding signals. A sudden denial from a shell spawned after an unusual request is different from a predictable call during every clean startup.

Verification should include the node perspective. Confirm the cgroup exists with expected limits, the kernel loaded the security profile, the network plugin installed policy, and the actual process belongs to the intended namespaces. The orchestration API can say the pod is running while one enforcement component is degraded.

Repeat tests after platform upgrades. A new kernel, runtime, network plugin, policy engine, base image, or language runtime can change enforcement and behavior. Preserve representative positive and negative fixtures so upgrades demonstrate both compatibility and containment before reaching every node.

Finally, connect alerts to response actions. A suspicious runtime event may require isolating the pod's network, revoking its service-account credentials, blocking its image digest from new deployment, preserving node evidence, replacing the workload, or escalating to node rebuild. The runbook should respect workload availability while assuming the process can no longer be trusted.

Consider an attack chain:

```text
1. attacker sends malicious request
2. application flaw yields code execution
3. process attempts privilege expansion
4. attacker modifies executable files for persistence
5. attacker reaches internal services
6. attacker reads mounted credentials
7. attacker probes the host kernel
8. attacker consumes node resources
9. attacker attempts escape or node control
```

Different controls change different steps. Non-root changes the starting authority in step 3. Dropped capabilities and no-new-privileges restrict escalation. Read-only filesystems change step 4. Narrow secrets and service accounts change step 6. Network policy changes step 5. Seccomp and mandatory access control reduce steps 3 and 7. Resource limits constrain step 8. Admission prevents developers or attackers from removing these boundaries. A sandbox makes the host-kernel transition in step 9 harder.

The strongest runtime model is “assume compromise.” That does not predict that every application will be hacked. It asks the architecture to remain useful when prevention fails:

```text
compromised application
  != host root
  != writable trusted software
  != every internal service
  != unlimited node resources
  != automatic cluster API authority
```

This resembles zero-trust reasoning. The process does not receive broad power merely because it came from an approved image or runs inside the cluster. Every identity, object, network path, credential, and resource is granted according to a stated need.

The baseline can be expressed as six invariants:

1. **Compromise does not imply root.** The process begins non-root and cannot gain privilege through ordinary execution.
2. **Compromise does not imply host control.** Host namespaces, sensitive mounts, devices, broad capabilities, and unnecessary kernel mechanisms remain unavailable.
3. **Compromise does not imply arbitrary persistence.** Trusted software is read-only, and writable locations are explicit and bounded.
4. **Compromise does not imply unlimited lateral movement.** Network edges, service credentials, and cluster API permissions follow the application graph.
5. **Compromise does not imply node-wide denial of service.** Memory, CPU, process count, and storage have enforceable budgets.
6. **Developers cannot accidentally disable the model.** Admission and protected platform policy reject unsafe workload classes before they run.

![Runtime isolation summary infographic showing trusted image, constrained process, small write area, narrow network, resource budget, and optional sandbox around payments-api](/content-assets/articles/article-devsecops-container-image-security-registry-security/runtime-isolation-summary.png)

Connect this back to image security. A hardened image removes tools, declares a non-root user, separates writable data, and has an exact digest. Runtime policy verifies and strengthens those choices. Supply-chain trust says the expected artifact arrived. Runtime distrust says even that expected artifact receives only the authority needed for this execution.

The full model is:

```text
runtime isolation
  = namespace separation
  + least-privileged identity and capabilities
  + filtered kernel mechanisms and object access
  + immutable software and narrow secrets
  + bounded resources
  + explicit network graph
  + admission-enforced workload class
  + stronger sandbox where threat requires it
  + runtime verification and signals
```

Do not confuse “containerized” with “isolated.” A privileged root container with host networking, host process visibility, a runtime socket, broad service-account token, writable root, and no limits is packaged, but it has abandoned most useful boundaries. Isolation is the sum of enforced constraints around the actual process.

Review the boundaries as one dependency chain. A non-root process can still damage a broadly writable volume. A read-only filesystem can still expose an administrative token. Network policy can still permit abuse through an allowed high-authority service. A sandbox can still let the application exfiltrate its own secrets. The controls are most useful when each removes the assumptions left by the others.

For every exception, state the capability it restores and the boundary that compensates. A workload requiring one host device may need a dedicated node and no unrelated tenants. A service requiring one writable persistent path may need tighter ownership and monitoring. A process requiring one added capability may need a narrower seccomp and network profile. Exceptions should make risk more explicit, not turn the workload into an unreviewed privileged class.

Then rerun the negative tests with the exception present. Confirm the intended operation succeeds and nearby unauthorized operations still fail. Record the workload digest, manifest, policy version, runtime class, and evidence so a later release does not inherit an old exception without proving the requirement remains.

## Check Your Answers

:::expand[Why Is a Trusted Image Still an Untrusted Running Process?]{kind="recap"}
A verified image becomes a Linux process on a shared-kernel host, so runtime controls must assume the application can be compromised and limit the resulting blast radius.
:::

:::expand[How Do Identity and Capabilities Limit Process Authority?]{kind="recap"}
Run with a fixed non-root identity, drop all capabilities unless a tested requirement justifies one, and block privilege escalation so exploited code starts and stays narrow.
:::

:::expand[How Do Seccomp and Mandatory Access Control Narrow Kernel Access?]{kind="recap"}
Capabilities restrict privileged action, seccomp filters syscall mechanisms, and AppArmor or SELinux limits object access, covering different parts of kernel-mediated authority.
:::

:::expand[How Do Filesystems, Secrets, and Credentials Define Runtime Power?]{kind="recap"}
Keep trusted software read-only, provide only explicit writable paths, and treat every secret, token, mount, socket, and metadata route as an external capability.
:::

:::expand[How Do Resource Limits Protect Availability?]{kind="recap"}
Cgroup-backed memory, CPU, process, and storage budgets constrain faults or attacks that would otherwise consume finite shared node resources.
:::

:::expand[How Do Network and Kubernetes Boundaries Reduce Lateral Movement?]{kind="recap"}
Express an explicit service graph with default-deny traffic and reject host namespaces, privileged mode, sensitive HostPath mounts, and other shortcuts around pod isolation.
:::

:::expand[When Are Admission Guardrails and Sandbox Runtimes Needed?]{kind="recap"}
Admission blocks unsafe pod classes before execution, while higher-risk and multi-tenant workloads may require a sandbox or dedicated stronger kernel boundary.
:::

:::expand[What Does a Verified Runtime Isolation Baseline Look Like?]{kind="recap"}
Verify ordinary application behavior and forbidden actions, observe the running controls, and enforce invariants that keep one process compromise from becoming host or cluster compromise.
:::
