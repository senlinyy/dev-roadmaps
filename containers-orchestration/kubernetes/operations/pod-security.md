---
title: "Pod Security"
description: "Limit the Linux identity, kernel access, host access, and writable filesystem available to Kubernetes workloads."
overview: "Pod security gives each workload only the Linux permissions it needs, then uses namespace policy to prevent weaker Pods from entering the cluster."
tags: ["security", "pods", "securitycontext", "psa"]
order: 6
id: article-containers-orchestration-kubernetes-operations-pod-security
---

## Table of Contents

1. [Which Linux identity and permissions does a container receive when it starts?](#which-linux-identity-and-permissions-does-a-container-receive-when-it-starts)
2. [How do runAsNonRoot and runAsUser keep the process away from UID 0?](#how-do-runasnonroot-and-runasuser-keep-the-process-away-from-uid-0)
3. [Why should a workload drop capabilities and block privilege escalation?](#why-should-a-workload-drop-capabilities-and-block-privilege-escalation)
4. [How do seccomp and a read-only root filesystem limit what a process can reach?](#how-do-seccomp-and-a-read-only-root-filesystem-limit-what-a-process-can-reach)
5. [Why are privileged containers, host namespaces, and hostPath volumes high-risk?](#why-are-privileged-containers-host-namespaces-and-hostpath-volumes-high-risk)
6. [How do Pod Security Standards and Admission apply a shared policy to namespaces?](#how-do-pod-security-standards-and-admission-apply-a-shared-policy-to-namespaces)
7. [How can a team roll out, exempt, and verify policy safely?](#how-can-a-team-roll-out-exempt-and-verify-policy-safely)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

A container is not a small independent machine. It is a Linux process isolated with namespaces, cgroups, filesystem mounts, capabilities, seccomp, and related controls, and it normally shares the Node's kernel. Pod security asks one practical question: if application code is compromised, what can that process do next?

Seven questions turn that threat model into configuration and policy:

1. **Which Linux identity and permissions does a container receive when it starts?**
2. **How do `runAsNonRoot` and `runAsUser` keep the process away from UID 0?**
3. **Why should a workload drop capabilities and block privilege escalation?**
4. **How do seccomp and a read-only root filesystem limit what a process can reach?**
5. **Why are privileged containers, host namespaces, and `hostPath` volumes high-risk?**
6. **How do Pod Security Standards and Admission apply a shared policy to namespaces?**
7. **How can a team roll out, exempt, and verify policy safely?**

## Which Linux identity and permissions does a container receive when it starts?
<!-- section-summary: Pod and container security contexts describe the identity, kernel powers, syscall profile, and filesystem access that the runtime applies to Linux processes. -->

### Begin with the process, not the container image

Kubernetes has not created a tiny independent machine. It has asked the container runtime to start Linux processes with particular namespaces, resource controls, mounts, identities, capabilities, and syscall restrictions. Unless another sandboxing layer is involved, those processes ultimately share the Node's Linux kernel.

The useful threat path is therefore:

```text
compromised application code
-> Linux process
-> shared kernel
-> Node
-> other workloads or cluster resources
```

Every control below reduces what the compromised process can do along that path. The practical question is not “does this YAML look secure?” but “after code execution inside the container, which identity, kernel powers, files, and host interfaces remain reachable?”

The shared kernel is the reason these controls compose. A container process still asks the Node's Linux kernel to open files, create sockets, clone processes, change ownership, and mount filesystems. Namespaces change what the process can see, cgroups constrain resources, and security controls constrain what the process can ask the shared kernel to do. A container image packages a filesystem and program; it does not replace the kernel with a private one.

Use a compromise-oriented review:

```text
attacker controls application code
        ↓
which UID and groups does the process have?
        ↓
which Linux capabilities and escalation paths remain?
        ↓
which syscalls and files can it reach?
        ↓
which host namespaces, mounts, or sockets are exposed?
```

Each reduction limits the next action available after the original application defect. Pod security does not prevent every code vulnerability; it reduces the authority the resulting Linux process receives.

That smaller authority limits how far one compromised application can move through the system.

### Pod defaults and container overrides shape one process

Kubernetes describes restrictions in a `securityContext`; the container runtime translates many of them into runtime settings; the Linux kernel enforces them. Security contexts exist at two levels:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: api
      image: example/api:v1
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: [ALL]
        readOnlyRootFilesystem: true
```

The Pod-level context provides shared or default process properties. A container-level context controls one container and can override overlapping Pod-level settings. That matters when an application container, sidecar, and init container do not need identical privileges.

A Pod can contain several processes with different responsibilities. The application might need no capabilities, while an infrastructure sidecar could have a narrowly justified exception. Put shared identity or seccomp defaults at Pod level, then tighten or override a specific container only where that setting is supported. Inspect every regular, init, and ephemeral container rather than assuming the main application container represents the whole Pod.

For example, `runAsNonRoot` and `seccompProfile` can express common Pod defaults, while the application container independently drops all capabilities and uses a read-only root. A migration init container and a proxy sidecar each have their own container-level context. One weak sidecar still belongs to the same Pod security boundary, so the review must include every process Kubernetes can start there.

| Question | Control |
|---|---|
| Which user and primary group run the process? | `runAsUser`, `runAsGroup` |
| Must the process be non-root? | `runAsNonRoot` |
| Which group helps access supported volumes? | `fsGroup` |
| Which special kernel powers remain? | `capabilities` |
| May the process gain privilege later? | `allowPrivilegeEscalation` |
| Which syscalls may it use? | `seccompProfile` |
| May it change the image filesystem? | `readOnlyRootFilesystem` |
| Does it largely bypass container isolation? | `privileged` |

## How do `runAsNonRoot` and `runAsUser` keep the process away from UID 0?
<!-- section-summary: A deterministic nonzero UID and GID reduce the process's starting privilege, while runAsNonRoot turns that expectation into a startup invariant. -->

### Identity and enforcement are separate settings

UID 0 is root. Namespaces and other controls mean root inside a container is not automatically root on the Node, but it is a stronger starting position for an attacker. An ordinary application can instead request:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
```

`runAsUser` and `runAsGroup` make process identity deterministic. `runAsNonRoot` says more: refuse to start the container as UID 0. Security-context identity can override user information from the image.

`fsGroup` can give the process an appropriate supplementary group on supported mounted volumes. Fix ownership and permissions instead of giving the whole process UID 0 to solve a writable-volume problem.

That distinction is easy to miss. `runAsUser: 10001` chooses an identity. `runAsNonRoot: true` expresses the invariant that the process must not start as root. Using both makes the intended identity deterministic and prevents an image change from silently returning the workload to UID 0.

Root inside a normal container is not automatically identical to root on the Node because namespaces, capabilities, seccomp, and mounts still mediate access. It is nevertheless a stronger foothold. Many file permissions, executables, and kernel-facing operations assume special behavior for UID 0, so an attacker begins closer to dangerous boundaries.

`fsGroup` solves a different problem. A mounted data volume may be group-accessible while the process runs as UID and GID `10001`. Supplying a suitable supplementary filesystem group can let the application write that volume without making the whole container root. The right repair for `Permission denied` is to align process identity and file ownership, not to remove the non-root boundary.

After startup, a simple runtime check should match the declaration:

```bash
kubectl exec api -- id
```

An expected result such as `uid=10001 gid=10001` proves the running process identity. It does not yet prove capabilities, syscall filtering, writable mounts, or admission enforcement, which remain separate boundaries.

## Why should a workload drop capabilities and block privilege escalation?
<!-- section-summary: Dropping capabilities removes special kernel powers, and no-new-privileges prevents an unprivileged process from gaining more authority after startup. -->

### Non-root is only the first reduction in power

Linux capabilities split traditional root power into units such as `CAP_CHOWN`, `CAP_NET_ADMIN`, and `CAP_SYS_ADMIN`:

```yaml
securityContext:
  capabilities:
    drop:
      - ALL
  allowPrivilegeEscalation: false
```

Dropping `ALL` starts from no special capabilities; add back only what the application proves it needs. The Restricted standard follows this model and permits only `NET_BIND_SERVICE` to be added under the standard.

`allowPrivilegeEscalation: false` applies Linux `no_new_privs` behavior. A process cannot use a later step such as a setuid binary to gain privileges it did not begin with. Non-root identity, capability removal, and blocked escalation defend different paths.

Think of the layers in order. A nonzero UID limits the starting identity. Dropping capabilities removes special kernel-facing powers that are no longer represented by UID alone. Blocking privilege escalation prevents a later executable from expanding that authority. None makes the others redundant.

Capabilities explain why “non-root” is not the whole answer. Linux split traditional root authority into powers such as changing ownership, administering networking, binding privileged ports, and broad system administration. Starting from `drop: [ALL]` means the workload must justify any power it adds back instead of inheriting a broad default.

The Restricted standard permits `NET_BIND_SERVICE` as the add-back under its capability rule. Even that exception should follow need: an application listening on an unprivileged container port and exposed through a Service may not need it. “Allowed by the standard” and “required by this workload” are different tests.

`allowPrivilegeEscalation: false` closes a later route. The process may start with a nonzero UID and few capabilities but encounter a setuid executable or another mechanism that would normally raise authority. Linux `no_new_privs` prevents that execution from granting more privilege. Identity constrains the start; no-new-privileges constrains later transitions.

## How do seccomp and a read-only root filesystem limit what a process can reach?
<!-- section-summary: Seccomp narrows the kernel syscall surface, while a read-only root filesystem makes writable paths explicit. -->

### Filter the process-to-kernel interface

Applications reach the kernel through system calls such as `open`, `read`, `write`, `socket`, `clone`, and `mount`. Seccomp filters that interface:

```yaml
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
```

`RuntimeDefault` uses the runtime's default profile; a `Localhost` profile is another accepted Restricted configuration. AppArmor and SELinux can further restrict access even when ordinary Unix permissions would allow it.

An application needs useful system calls, so seccomp does not remove the kernel interface entirely. It narrows that interface to a profile appropriate for ordinary container processes. AppArmor and SELinux add different access restrictions. Together with identity, capabilities, and `no_new_privs`, these controls form defense in depth rather than one all-or-nothing barrier.

`RuntimeDefault` asks the installed container runtime for its default syscall profile. It is a practical baseline because the process still receives the system calls ordinary containers need while a broader set is filtered. A `Localhost` profile can express a deliberately maintained node-local profile when the platform has that operational capability.

Seccomp decides which syscall entry points the process may use. AppArmor and SELinux can constrain access to resources even when ordinary Unix mode bits appear to permit it. These mechanisms overlap in purpose without being identical. A bypass of one check should still meet another restriction before the process reaches a sensitive kernel or filesystem action.

### Turn implicit writes into explicit writable paths

Filesystem hardening addresses another boundary:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: api
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: api
      image: example/api:v1
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: [ALL]
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

The image filesystem stays read-only, while `/tmp` is deliberately writable through an `emptyDir`. This limits persistence locations and exposes hidden assumptions about writing elsewhere. `readOnlyRootFilesystem` is valuable hardening, although the Restricted profile does not currently require it.

If the application unexpectedly tries to modify `/etc/foo`, the failure reveals a previously hidden runtime assumption. The repair is to decide whether that path should truly be mutable and, if so, mount a deliberately scoped writable volume there—not to make the entire image filesystem writable again.

The resulting filesystem has an explainable shape:

```text
/bin, /usr, /etc, /app -> image content, read-only
/tmp                   -> writable emptyDir
/var/lib/myapp         -> writable data volume, if required
```

An attacker can still write to the declared volumes, so their contents and lifecycle matter. The gain is that arbitrary image paths are no longer available for dropped tools, modified configuration, or persistence. The application also has to state every legitimate mutable location instead of relying on an undocumented writable root.

`readOnlyRootFilesystem` is not currently a Restricted requirement, which exposes an important boundary: Pod Security Standards are shared baselines, not the maximum hardening possible for every workload. A team can meet Restricted and still choose additional controls such as a read-only root where its application permits them.

## Why are privileged containers, host namespaces, and `hostPath` volumes high-risk?
<!-- section-summary: These options intentionally cross normal container boundaries and give a compromised process a shorter path to the Node. -->

### Recognize explicit holes through container isolation

Several settings deliberately reduce isolation:

- `hostPID: true` exposes the host process namespace;
- `hostNetwork: true` approaches the Node's network namespace;
- `hostIPC: true` shares the host IPC namespace;
- `hostPath` exposes selected Node files;
- `privileged: true` grants all Linux capabilities and bypasses important seccomp, AppArmor, and SELinux restrictions.

Mounting `/` or `/run/containerd/containerd.sock` through `hostPath` creates a powerful route toward the Node. `privileged: true` should mean that the workload receives extraordinary trust, not that isolation was disabled because an application failed.

Baseline blocks obvious paths such as privileged containers, host namespaces, and `hostPath`. Infrastructure agents may genuinely require some of them, but that makes those agents a separate trust domain.

These settings are qualitatively different from giving an application a writable `/tmp`. `hostPID`, `hostNetwork`, and `hostIPC` expose host namespaces. `hostPath` exposes selected Node files, and a runtime socket can become a route to controlling other workloads. A privileged container receives all Linux capabilities and bypasses important seccomp, AppArmor, and SELinux restrictions. Read `privileged: true` as “this workload requires extraordinary trust,” not as a troubleshooting switch.

Follow the escape distance. A normal container sees its own process and mount namespaces and a Pod network namespace. `hostPID` lets it observe Node processes. `hostNetwork` places it on the Node's network context. `hostIPC` exposes host inter-process communication. A `hostPath` for `/` exposes the host filesystem; a mount of the container-runtime socket can expose a control interface capable of creating or manipulating containers.

`privileged: true` is the broadest shortcut. It supplies all capabilities and changes how seccomp, AppArmor, and SELinux restrictions apply. When an application fails and privileged mode makes it work, the result has not identified the missing requirement; it has removed many boundaries at once. Find the narrow resource or capability actually needed, or keep a genuinely privileged agent in a separately governed trust domain.

## How do Pod Security Standards and Admission apply a shared policy to namespaces?
<!-- section-summary: Standards define acceptable Pod shapes, and Pod Security Admission evaluates Pods against a selected profile and action at the namespace boundary. -->

### Configuration, standard, admission, and runtime are four boundaries

| Layer | Responsibility |
|---|---|
| `securityContext` | Restrictions requested for one Pod or container |
| Pod Security Standards | Shared definitions of acceptable Pod configurations |
| Pod Security Admission | API-server enforcement of those definitions |
| Runtime and kernel | Restrictions actually applied to the process |

The standards define three profiles:

- **Privileged:** essentially unrestricted;
- **Baseline:** prevents obvious privilege-escalation paths;
- **Restricted:** hardens normal applications with non-root execution, no privilege escalation, acceptable seccomp, restricted volume types, and dropped capabilities.

A namespace selects a profile and action:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

`warn` allows the request but reports a violation. `audit` allows it but records the violation. `enforce` rejects the violating Pod. This converts a team convention into an admission boundary.

Read the four layers as a causal chain. A developer requests controls in `securityContext`. The Pod Security Standard defines whether that Pod shape meets Baseline or Restricted. Pod Security Admission evaluates the request according to namespace labels. Only an admitted Pod reaches the runtime, where the kernel enforces the translated identity, capabilities, syscall, and mount restrictions.

Without admission, the hardened example remains a convention that another manifest can omit. Without runtime enforcement, an accepted declaration would not constrain the process. Policy and mechanism solve different halves: admission prevents weaker desired state from entering the namespace, while runtime controls constrain the process that actually starts.

The profiles are deliberately progressive. Privileged is essentially unrestricted. Baseline removes obvious privilege-escalation paths. Restricted adds the controls expected for ordinary hardened applications, including non-root execution, blocked privilege escalation, acceptable seccomp, restricted volume types, and dropped capabilities. A workload's `securityContext` requests those properties; the standard defines what is acceptable; admission rejects weaker configurations; the runtime and kernel finally apply the restrictions.

## How can a team roll out, exempt, and verify policy safely?
<!-- section-summary: Stage stricter profiles with warnings and audit evidence, isolate exceptional workloads, and compare declared, admitted, and runtime state. -->

### Move from convention to enforcement in observable stages

An established cluster may contain agents, applications, and charts that do not yet meet Restricted. Begin with evidence:

```text
initial:
  enforce: baseline
  warn: restricted
  audit: restricted

after remediation:
  enforce: restricted
  warn: restricted
  audit: restricted
```

Test an enforcement label without applying it:

```bash
kubectl label --dry-run=server --overwrite ns payments \
  pod-security.kubernetes.io/enforce=restricted
```

Pin a version such as `pod-security.kubernetes.io/enforce-version: v1.36` when standard changes should be deliberate rather than implicit in a cluster upgrade.

Warning and audit modes reveal incompatibilities without immediately blocking work. Server-side dry run tests the actual admission path. Version pinning separates a Kubernetes upgrade from a change in the enforced standard. Together, those controls let a team discover and remediate legacy applications, agents, and third-party charts before turning the same Restricted findings into rejections.

Use the modes as a migration sequence rather than three synonyms. `warn: restricted` gives the person submitting a violating object immediate repair feedback. `audit: restricted` records the decision for later analysis. `enforce: baseline` can continue blocking the most obvious dangerous shapes while teams repair toward Restricted. After the violation inventory reaches an accepted state, changing enforcement to Restricted turns the observed rule into a hard gate.

Policy versions deserve the same deliberate rollout. `latest` lets the selected standard evolve with Kubernetes, which can combine a cluster upgrade with new admission requirements. Pinning a version such as `v1.36` keeps the standard stable until the platform explicitly tests and advances it. Each mode can carry its own version during migration.

### Put exceptional workloads in a narrow trust domain

Exceptional workloads belong in narrowly controlled namespaces. RBAC must restrict who can deploy there, because anyone who can create arbitrary workloads inherits the dangerous options. PSA also supports exemptions by username, RuntimeClass, or namespace, but broad exemptions—including controller service accounts—can indirectly exempt more users than intended.

An infrastructure namespace is not safe merely because of its name. If its policy permits host access, every identity allowed to create arbitrary Pods there can exercise that access. Keeping ordinary application namespaces Restricted and limiting deployment authority in the exceptional namespace preserves a small, reviewable boundary instead of weakening policy everywhere.

Connect this directly to RBAC. Pod Security Admission answers, “What Pod shape may exist in this namespace?” RBAC answers, “Who may create that Pod or its owning workload?” A privileged namespace with broad workload-creation permission grants a practical route to privileged code execution. The exception is safe only when both the allowed Pod shapes and the identities allowed to submit them are narrow.

Exemptions require the same caution. Exempting a controller ServiceAccount can indirectly exempt every developer who can create a Deployment that the controller turns into Pods. Prefer a small namespace or RuntimeClass trust boundary whose ownership is easy to audit rather than a broad identity exemption with hidden delegation.

### Compare declared, admitted, and running state

Verify three boundaries:

1. **Declared:** inspect the Pod, including init and ephemeral containers, for identity, capabilities, escalation, seccomp, writable paths, host settings, and volumes.
2. **Admitted:** inspect namespace labels and use a violating server-side dry run to confirm rejection.
3. **Runtime:** where tools exist, use `id` and `/proc/1/status` to inspect UID, GID, effective capabilities, `NoNewPrivs`, and seccomp state.

The manifest should request a hardened process, admission should reject anything weaker, and the runtime should show the restrictions applied. Pod security complements RBAC, NetworkPolicy, service-account least privilege, Secrets management, image controls, Node security, and runtime sandboxing.

A complete check should tell one consistent story:

```text
declared Pod: requests a non-root, restricted process
admission: rejects Pods weaker than the namespace policy
running process: shows the expected UID, capabilities, NoNewPrivs, and seccomp state
```

Checking only the manifest proves intent. Checking admission proves the organizational guardrail. Checking the process proves that the runtime boundary reflects the requested restrictions.

Inspect the running process beyond `id` where the image permits it:

```bash
kubectl exec api -- grep -E \
  'Uid|Gid|CapEff|NoNewPrivs|Seccomp' /proc/1/status
```

The effective capability mask, `NoNewPrivs`, and seccomp state provide runtime evidence that differs from the YAML request. Also test the filesystem contract: writing the image root should fail, while writing the explicitly mounted `/tmp` should succeed. A violating server-side dry run should be rejected in the Restricted namespace. Together these checks prove declaration, guardrail, and enforcement rather than one attractive manifest.

## Check Your Answers
<!-- section-summary: Rebuild the security model from Linux process identity, kernel power, reachable resources, and organizational enforcement. -->

:::expand[Which Linux identity and permissions does a container receive when it starts?]{kind="recap"}
Pod and container security contexts describe identity, capabilities, privilege escalation, seccomp, and filesystem access. The runtime translates them and the kernel enforces them.
:::

:::expand[How do `runAsNonRoot` and `runAsUser` keep the process away from UID 0?]{kind="recap"}
`runAsUser` selects a nonzero UID, while `runAsNonRoot` refuses to start a process as root. `runAsGroup` and `fsGroup` support group-based access.
:::

:::expand[Why should a workload drop capabilities and block privilege escalation?]{kind="recap"}
Dropped capabilities remove special kernel powers; `allowPrivilegeEscalation: false` prevents the process from gaining more privilege later.
:::

:::expand[How do seccomp and a read-only root filesystem limit what a process can reach?]{kind="recap"}
Seccomp filters system calls. A read-only root prevents image changes, while explicit volumes such as an `emptyDir` at `/tmp` supply needed writable paths.
:::

:::expand[Why are privileged containers, host namespaces, and `hostPath` volumes high-risk?]{kind="recap"}
They weaken isolation and create direct routes to host processes, networking, IPC, files, or kernel authority. Keep them in a narrow trust domain.
:::

:::expand[How do Pod Security Standards and Admission apply a shared policy to namespaces?]{kind="recap"}
The standards define Privileged, Baseline, and Restricted. Pod Security Admission uses namespace labels to warn, audit, or reject Pods.
:::

:::expand[How can a team roll out, exempt, and verify policy safely?]{kind="recap"}
Measure Restricted violations under Baseline enforcement, remediate, then enforce. Keep exceptions narrow and compare declared, admitted, and runtime state.
:::

## References

- [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Apply Pod Security Standards at the namespace level](https://kubernetes.io/docs/tutorials/security/ns-level-pss/)
