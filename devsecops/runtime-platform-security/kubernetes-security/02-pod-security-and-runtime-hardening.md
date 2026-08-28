---
title: "Pod Security and Runtime Hardening"
description: "Control what a Kubernetes Pod may do after it starts with Pod Security Standards, admission enforcement, security contexts, resource boundaries, and runtime detection."
overview: "Begin with a Pod as a request for runtime authority. Then derive a hardened ordinary API from Pod Security Standards, Pod Security Admission modes and labels, securityContext fields, resource limits, verification and negative tests, explainable exceptions, and Falco-style runtime detection."
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

1. [Why Is a Pod a Request for Runtime Authority?](#why-is-a-pod-a-request-for-runtime-authority)
2. [What Do the Pod Security Standards Define?](#what-do-the-pod-security-standards-define)
3. [How Does Pod Security Admission Enforce Those Standards?](#how-does-pod-security-admission-enforce-those-standards)
4. [How Do You Build a Restricted Security Context?](#how-do-you-build-a-restricted-security-context)
5. [Which Security Boundaries Sit Outside the Pod Security Standards?](#which-security-boundaries-sit-outside-the-pod-security-standards)
6. [Why Do Admission Prevention and Runtime Detection Need Each Other?](#why-do-admission-prevention-and-runtime-detection-need-each-other)
7. [How Should Teams Verify, Debug, and Except Hardened Pods?](#how-should-teams-verify-debug-and-except-hardened-pods)
8. [What Does a Complete Pod Security Operating Model Look Like?](#what-does-a-complete-pod-security-operating-model-look-like)
9. [Check Your Answers](#check-your-answers)

A Pod specification is more than an instruction to start an image. It requests runtime authority from the cluster. The request can include a user identity, Linux capabilities, host namespaces, filesystems, devices, Service Account credentials, writable storage, network exposure, and resource consumption.

```text
Pod manifest
  -> API admission
  -> scheduler and kubelet
  -> container runtime
  -> processes with requested authority
```

Container security becomes easiest to reason about after assuming remote code execution. Prevention still matters, but an application vulnerability can let an attacker execute inside the process. The next question is what that code can turn into.

The desired outcome is not “the container cannot be compromised.” It is:

```text
application compromise
  != root authority
  != privilege growth
  != host access
  != writable trusted software
  != unlimited node resources
  != invisible behavior
```

Begin with a deliberately unsafe Pod shape:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payments-api
spec:
  hostNetwork: true
  containers:
    - name: app
      image: registry.example/payments:latest
      securityContext:
        privileged: true
      volumeMounts:
        - name: host-root
          mountPath: /host
  volumes:
    - name: host-root
      hostPath:
        path: /
```

Keep these questions in view as you work through the lesson:

1. **Why Is a Pod a Request for Runtime Authority?**
2. **What Do the Pod Security Standards Define?**
3. **How Does Pod Security Admission Enforce Those Standards?**
4. **How Do You Build a Restricted Security Context?**
5. **Which Security Boundaries Sit Outside the Pod Security Standards?**
6. **Why Do Admission Prevention and Runtime Detection Need Each Other?**
7. **How Should Teams Verify, Debug, and Except Hardened Pods?**
8. **What Does a Complete Pod Security Operating Model Look Like?**

## Why Is a Pod a Request for Runtime Authority?
<!-- section-summary: A Pod manifest asks the cluster to create processes with specific identities, kernel access, mounts, namespaces, credentials, and resources, so runtime security is about constraining the result after code execution. -->

The example Pod is containerized, but it has abandoned important isolation. It uses host networking, privileged mode, and a host-root mount. Compromise can reach far beyond the application's intended function.

The authority to minimize includes:

- starting user and groups;
- ability to gain privilege later;
- Linux capabilities and system calls;
- access to host process, network, and IPC namespaces;
- host devices and filesystems;
- writable application and system files;
- mounted tokens and Secrets;
- network reachability;
- CPU, memory, storage, and process consumption.

Some controls live in the Pod security context. Others live in RBAC, NetworkPolicy, resource policy, image policy, node isolation, and external identity systems. Pod hardening is one axis in a larger runtime model.

“Containerized” does not mean “isolated.” Containers share the node kernel by default. Namespaces and cgroups create useful boundaries, but a privileged request, host namespace, unsafe mount, or kernel exploit can weaken them. The Pod specification determines how much of the boundary the workload receives.

The bad Pod demonstrates why fields must be interpreted as authority, not syntax. `privileged: true` gives the container broad device and kernel access. `hostNetwork: true` places it in the node's network namespace and changes what it can bind or observe. Mounting `/` exposes the node filesystem, and a writable mount can change host state. Any one of these can invalidate assumptions provided by other container controls.

An ordinary application can also become overpowered without an obvious privileged flag. Running as UID 0, keeping default capabilities, allowing privilege escalation, mounting a broad Service Account token, leaving the root filesystem writable, and omitting resource limits can create a useful attack environment even when no host path appears.

The security objective is minimum necessary authority at start and throughout execution. Starting identity matters because it is what exploited code receives immediately. Privilege-growth controls matter because an attacker can search for set-user-ID programs or kernel paths. Filesystem controls matter because persistence and code replacement can survive within the process lifetime. Resource controls matter because availability is shared.

Pod-level settings also interact between containers. Containers in one Pod share a network namespace and can share volumes. A privileged sidecar can weaken an otherwise restricted application. A debug container can observe process or filesystem state depending on configuration. Review the whole Pod rather than assuming the most hardened container defines the security level.

The kubelet and runtime create the process from accepted configuration. If a node is compromised or the runtime ignores a field, desired-state controls can be bypassed. Node hardening and verification remain necessary. Still, rejecting overpowered requests at the API boundary removes a large class of avoidable risk before the node must defend it.

Write the workload's authority contract in behavioral terms: which user, files, syscalls, capabilities, networks, tokens, devices, and resources it needs. Then translate that contract into Pod fields and independent policies. This makes a later exception explainable as a changed requirement rather than an unexplained YAML difference.

## What Do the Pod Security Standards Define?
<!-- section-summary: Pod Security Standards provide three profiles—Privileged, Baseline, and Restricted—that describe increasing limits on Pod authority but do not enforce themselves. -->

Kubernetes needs a common vocabulary for acceptable Pod security. Pod Security Standards, or PSS, define three policy profiles based on tolerated authority.

**Privileged** is an intentionally unrestricted profile. It permits known privilege escalations and host-level features. It is appropriate only for workloads whose function truly requires broad node authority, such as some low-level infrastructure components.

**Baseline** prevents well-known privilege escalations while remaining compatible with many common workloads. It rejects several dangerous host and privilege configurations but allows more than a strongly isolated application may need.

**Restricted** follows current Pod-hardening practices. It expects non-root execution, limited capabilities, no privilege escalation, an approved seccomp profile, and other narrow settings. It is a good floor for ordinary application workloads.

Think of the profiles as tolerated authority:

```text
Privileged -> broad host and process authority tolerated
Baseline   -> obvious escalations blocked
Restricted -> ordinary applications must declare a narrow shape
```

These profiles are policy definitions, not enforcement. A document that says a namespace should be Restricted does not stop an unsafe Pod. An admission mechanism must evaluate submitted objects against the chosen profile.

The standards cover a defined set of Pod fields. They do not promise complete workload security. Restricted does not automatically create NetworkPolicies, grant narrow RBAC, protect Secret contents, set resource limits, verify image signatures, or detect malicious runtime behavior.

Policy versions matter because the standard evolves with Kubernetes. A label can select a version such as the cluster release or a pinned standard version. Pinning makes enforcement behavior predictable; upgrading the version is then a reviewable policy change.

Using `latest` can adopt new restrictions as the cluster changes, which may be desirable but can surprise workloads. Decide whether platform policy should move automatically or through staged evaluation. Record the selected version so a denied Pod can be explained.

Restricted should be treated as a baseline class, not the maximum possible hardening. A stable service may use a tighter seccomp profile, mandatory access control, an arbitrary non-root UID, read-only root filesystem, no Service Account token, and a sandbox runtime. PSS provides shared vocabulary; workload threat models determine additional controls.

Privileged exists because some cluster components genuinely administer parts of the node. A networking agent may configure interfaces, a storage driver may mount devices, and a security sensor may observe host activity. Calling these workloads “Privileged” describes their tolerated authority; it does not mean their images, Service Accounts, or deployment path may be unprotected.

Baseline is useful for compatibility, but it should not become the automatic home for any application that fails Restricted. Identify the exact violation. A legacy root image needs an image and ownership repair. A required host port may be replaced by a Service. A broad capability may be removed through architecture. The profile difference is a migration backlog, not a permanent exemption rationale.

Restricted sets several requirements at Pod and container scope. An init container that runs with a disallowed capability can cause the Pod to violate the profile even if the main container is narrow. Ephemeral containers and updates to Pod-producing objects also need policy coverage. Review every container type that can execute.

Some controls are restricted to particular allowed values rather than simple presence. Seccomp must use an approved profile. Capabilities may permit a very small addition in some versions. Volume types and sysctls have controlled sets. Read the policy result and version rather than assuming that adding a field with a security-sounding value always satisfies the standard.

PSS represents a portable common floor. Organization-specific policy can add requirements that Kubernetes cannot standardize for everyone: approved registries, image digest use, required labels and owners, mandatory resource limits, particular runtime classes, prohibited Service Accounts, or data-sensitive node placement.

Profile choice should follow workload classes. Ordinary APIs and workers should normally target Restricted. Privileged infrastructure should run in dedicated namespaces with narrow deployment authority. Migration namespaces can temporarily enforce Baseline while warning on Restricted, but they need owners and deadlines so compatibility does not become an unmonitored permanent class.

Document what the profile does not cover beside what it does. Teams should know that a Restricted badge says nothing by itself about egress, database privilege, image vulnerabilities, or runtime anomalies. That prevents a single admission result from becoming a false all-purpose security claim.

## How Does Pod Security Admission Enforce Those Standards?
<!-- section-summary: Pod Security Admission evaluates Pod-producing requests at the API boundary using namespace-selected profiles, modes, and versions, enabling staged warning, audit, and enforcement before execution. -->

Admission occurs after authentication and authorization but before accepted state is stored and acted on. Pod Security Admission, or PSA, evaluates Pods and objects that create Pods against namespace policy.

Prevention before execution matters. A runtime scanner can detect a privileged container after it starts, but the process may already have mounted a host path or obtained a token. Admission can reject the unsafe desired state before the kubelet creates anything.

PSA has three important modes:

- `enforce` rejects requests that violate the selected profile.
- `warn` allows the request but returns a warning to the requester.
- `audit` allows the request but annotates the audit event with violations.

The modes can use different profiles and versions. A namespace can enforce Baseline while warning and auditing against Restricted during migration.

Namespace labels connect policy to enforcement:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.35
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.35
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.35
```

Use a version supported by the real cluster. The example shows the relationship, not a universal release choice.

Do not immediately enforce Restricted everywhere without inventory. Existing system components, storage drivers, networking agents, or legacy applications may require exceptions. A surprise namespace label can create an outage when controllers attempt to replace Pods and admission rejects the new templates.

A safer rollout is:

1. Inventory namespaces and workload owners.
2. Audit and warn against the intended profile.
3. Repair ordinary applications.
4. Separate privileged system workloads into explicit namespaces.
5. Test controller updates and Pod replacements.
6. Enforce in a pilot namespace.
7. Expand enforcement with monitored evidence.

Namespace-label permission becomes security-sensitive. Anyone who can remove or weaken the labels can bypass the standard for future Pods. Protect namespace mutation and audit profile or version changes.

PSA is a guardrail for both humans and automation. It evaluates Pods created by a person, Deployment, Job, operator, or compromised controller. Reviewers no longer need to notice every dangerous field manually because the API rejects classes of invalid state.

Pod-producing controllers create an important operational detail. A Deployment update stores a Pod template, and the controller later submits Pods from it. Admission behavior and warnings may be surfaced at different points depending on the request. Test the rendered controller object and observe actual Pod creation so a rollout does not stall unexpectedly.

Audit mode creates evidence without blocking. Use it to count violations by namespace, profile control, workload kind, and owner. Warn mode gives immediate feedback to interactive and CI clients, though automation may ignore warning text unless captured. Enforce changes cluster state, so promote only after teams can identify and repair the affected objects.

Existing Pods are not automatically rewritten when a namespace gains enforcement. The label governs future admission, including recreation after failure or rollout. A namespace can appear healthy until the next Pod replacement is rejected. Exercise restarts and controller rollouts during the migration instead of checking only currently running Pods.

Exceptions should use namespace and workload architecture carefully. Moving one ordinary application into a permanently privileged system namespace just to bypass Restricted expands who can create high-authority Pods there. Prefer fixing the application or, when a true exception exists, create a narrowly governed class with limited deployers and compensating controls.

Policy version rollout resembles an API compatibility change. Evaluate the next version in audit and warn, identify newly restricted fields, update manifests and images, test critical controllers, then change enforce. Keep the previous and new versions in evidence so a behavior change is not mistaken for a random admission failure.

Protect not only namespace labels but namespace creation. If developers can create an unlabeled namespace and deploy there, enforcement on existing namespaces can be bypassed. Apply creation defaults or validation that ensures every application namespace enters an approved security class.

Admission failures should be actionable. Return which field violated which profile version and how to correct it. If developers encounter only a generic rejection, they are more likely to request a broad exception or move work elsewhere. Good error messages are part of enforceable security operations.

Monitor rejected requests and policy-label changes. Repeated attempts to create privileged Pods can indicate a broken chart, unauthorized troubleshooting, or abuse. Link the requester, source, workload, namespace, and rule to the owning team.

## How Do You Build a Restricted Security Context?
<!-- section-summary: A hardened Pod combines non-root execution, no privilege escalation, dropped capabilities, seccomp, read-only software, no privileged or host shortcuts, and explicit writable storage. -->

Derive the Pod from the threat model rather than copying fields blindly. An ordinary API needs to receive traffic, call dependencies, read configuration, and use bounded temporary storage. It should not need host administration.

First, require non-root execution:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
```

`runAsNonRoot` and `runAsUser` are not identical. The first requires that the process not run as UID 0. The second chooses a specific identity. A non-root image user can satisfy the first without an explicit numeric override; a numeric setting makes the runtime identity clearer but must work with image and volume ownership.

Second, prevent gaining more privilege:

```yaml
allowPrivilegeEscalation: false
```

This blocks paths such as set-user-ID binaries from increasing process privilege. It does not make a root process non-root or remove capabilities already granted.

Third, drop Linux capabilities:

```yaml
capabilities:
  drop:
    - ALL
```

Add back only a capability that a measured requirement cannot eliminate. An API can normally listen on port 8080 while a Service or ingress exposes port 443, avoiding `NET_BIND_SERVICE`.

Fourth, apply a seccomp profile:

```yaml
seccompProfile:
  type: RuntimeDefault
```

`RuntimeDefault` is a useful broadly compatible baseline that filters dangerous or unusual syscalls. A stable high-risk workload can use a narrower local profile when testing and operations support it.

Fifth, make trusted software read-only:

```yaml
readOnlyRootFilesystem: true
```

Give the process only required writable paths:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

Filesystem writes are permissions. A broad writable application directory lets compromised code replace executables or libraries. Separate immutable program material from temporary or persistent data.

Explicitly forbid privileged mode and avoid host namespaces. Ordinary applications should not use `hostPID`, `hostIPC`, or `hostNetwork`. Avoid HostPath volumes because they expose node files or sockets outside the Pod boundary.

A better complete container shape is:

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
        privileged: false
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
        seccompProfile:
          type: RuntimeDefault
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

Disabling the Service Account token is not a PSS field; it removes unnecessary Kubernetes API credentials. This illustrates an important distinction: meeting Restricted and applying a complete workload threat model are not the same thing.

Place security context at the correct scope. Some fields belong at Pod level and become defaults for containers; others belong on each container. An explicit container setting can be clearer for multi-container Pods where sidecars have different users or filesystems. Inspect the stored result rather than relying on inheritance assumptions.

Image and runtime identity must agree. `runAsNonRoot` can reject an image whose user cannot be determined or is root. `runAsUser: 10001` can start the process but fail when application files or mounted volumes are owned differently. Fix image ownership and storage policy so the runtime does not require a root workaround.

Dropping capabilities should cover init and sidecar containers as well as the main process. If a setup action needs to change ownership or configure networking, consider moving it into the image build or a platform-owned component. A privileged init container can alter shared volumes before a restricted application starts.

Seccomp filters kernel entry mechanisms but does not replace capabilities or filesystem policy. A syscall can be allowed yet fail for lack of capability. A process can have permission to read a file yet be denied by AppArmor or SELinux. Each control narrows a different axis, and a denial should be traced to the actual mechanism.

Read-only root filesystems surface hidden assumptions: writing logs beside the executable, generating configuration in place, updating certificates, caching packages, or storing PID files under system paths. Map each write. Use standard output for logs, an `emptyDir` for temporary data, a purpose-built volume for persistent data, and an external process for image updates.

`emptyDir` is writable authority and resource use. Bound its expected size and lifecycle, choose memory-backed storage only when its memory accounting fits, and do not use it as unreviewed persistence. Sharing it between containers creates a data and influence channel.

Avoid broad file modes such as world-writable application directories. They can allow compromised sidecars or unexpected identities to replace trusted files. Use numeric ownership and only the groups required by shared storage. Recheck permissions inside the actual Pod because volume mounts can hide image paths and introduce different ownership.

The final manifest should make risky absences visible: no host namespace flags, no HostPath, no device request, no added capabilities, no privileged mode, and no automatic token. Admission tests can submit variants with each forbidden setting and confirm the boundary rejects them.

## Which Security Boundaries Sit Outside the Pod Security Standards?
<!-- section-summary: Resource budgets, RBAC, Secret authority, networking, image trust, node isolation, and application authorization are independent axes that Restricted Pods still require. -->

Resource limits solve availability isolation. Memory, CPU, process IDs, and ephemeral storage are finite node resources. A compromised or faulty process can exhaust them even when it runs non-root with a read-only root filesystem.

Requests describe capacity the scheduler should reserve. Limits bound consumption where supported:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
    ephemeral-storage: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi
    ephemeral-storage: 512Mi
```

Memory and CPU fail differently. Exceeding a memory limit can cause termination. CPU limits usually throttle. Storage exhaustion can cause eviction or node pressure. Process limits require runtime or node policy. Measure application behavior and test failure modes.

Resource limits are not part of PSS. A Pod can meet Restricted and still request no useful boundary against resource exhaustion.

PSA does not create network security. A Restricted Pod may still reach every service and the internet. NetworkPolicy and infrastructure controls must express the minimum communication graph.

PSA does not create least-privileged RBAC. A hardened non-root Pod can still receive a Service Account token bound to cluster-admin. Disable unnecessary tokens and review Roles and bindings.

PSA does not narrow Secret authority. A Pod can meet every security-context requirement while receiving an administrative database password. Limit which values are mounted and what downstream permissions they convey.

PSA does not verify the image. Use immutable digests, trusted registries, signatures, provenance, SBOMs, and vulnerability decisions so the runtime receives the intended artifact.

PSA does not supply stronger node or tenant isolation. Shared-kernel Pods can require sandbox runtimes or dedicated nodes when they process adversarial code or cross strong tenant boundaries.

Think of security as independent axes:

```text
Pod privilege shape
API identity and RBAC
Secret and external identity authority
network reachability
resource availability
artifact trust
node and tenant isolation
runtime behavior detection
application authorization
```

The floor should cover all axes. Passing one policy does not compensate automatically for a missing boundary elsewhere.

Resource design should include process count even when the workload API does not expose one convenient field. A fork bomb can exhaust node PIDs and affect other Pods. Runtime, node, or policy configuration can provide the boundary; monitoring should show process growth. Do not assume memory limits alone contain every process-exhaustion path.

Requests and limits also influence scheduling and aggregate risk. If requests are far below real use, the scheduler may place too many Pods on one node. If limits are omitted, one compromised replica can consume spare capacity. If every replica has a large limit, an attacker who can drive all replicas may still exhaust the cluster. Test aggregate behavior and quotas.

Network and RBAC combine. A Pod with an API token may be unable to use it if the API route is blocked, while a Pod with open API reachability still depends on authorization. A compromised service with broad egress and an administrative external credential can bypass Kubernetes entirely. Model identity and connectivity together.

Secret delivery is runtime authority even when no Kubernetes API token is mounted. A projected database password or cloud token gives the process power outside the cluster. Restrict which containers receive the volume, use short-lived credentials where possible, and narrow the downstream role.

Artifact trust and Pod hardening are complementary. A signed digest can prove that the approved build arrived, while the security context limits that build after start. A hardened Pod running an unknown mutable image has a supply-chain gap; a trusted image running privileged has a runtime gap.

Node boundaries matter when multiple trust levels share a kernel. Taints, node selectors, runtime classes, and admission can keep privileged infrastructure or adversarial workloads away from ordinary applications. PSS alone cannot express the full tenant-placement model.

Application authorization remains the last axis. A non-root Pod can still perform every business action its service credentials allow. Validate users, requests, object ownership, and transaction rules inside the application. Container isolation should constrain compromise consequences, not substitute for application security.

## Why Do Admission Prevention and Runtime Detection Need Each Other?
<!-- section-summary: Admission rejects dangerous desired state before execution, while runtime detection observes unexpected behavior after start; neither can replace the other's visibility. -->

Admission policy examines desired configuration. It can reject `privileged: true`, host namespace use, forbidden volumes, root execution, or missing seccomp. It cannot prove that a permitted application will never spawn a shell, modify an allowed writable path, connect to an unexpected destination, or exploit an allowed syscall.

Prevention and detection answer different questions:

```text
admission: is this requested Pod shape allowed?
runtime detection: is the running process behaving unexpectedly?
```

Falco-style runtime detection begins from system activity. It can observe events such as unexpected shell execution, writes below sensitive paths, new binaries, unusual process launches, access to container runtime sockets, or changes in privilege-related behavior.

Falco is detection, not the primary isolation boundary. An alert after a privileged process writes the host filesystem does not undo the write. Admission and runtime controls should prevent or constrain dangerous behavior; detection should reveal attempted or unexpected activity.

Useful alerts depend on an understanding of normal behavior. A build container may legitimately execute compilers and shells. An ordinary payments API may never launch a shell. A rule should include workload identity, image digest, namespace, node, process, parent process, and relevant syscall or file context so responders can decide quickly.

Runtime hardening and detection reinforce one another. A read-only root blocks modification and turns the attempt into a clearer denial. Dropped capabilities reduce ordinary privileged behavior, making capability use more suspicious. A narrow process baseline makes new child processes stand out.

There is a catch: runtime detection components themselves may require host visibility, privileged mounts, kernel interfaces, or broad permissions. Keep them in dedicated system namespaces, restrict their images and deployment authority, and protect their output. Exceptional privilege should remain limited to the security component that requires it rather than weakening application namespaces.

Prevention without detection misses abuse within allowed behavior and degraded enforcement. Detection without prevention permits known-dangerous configurations and relies on responders to win a race after execution. Use both as a feedback loop: incidents and alerts should improve images, manifests, admission, and workload-specific rules.

Runtime rules should be workload-aware. “Shell spawned in a container” can be normal in a build Job and highly unusual in an API. “Write under `/etc`” should be impossible in a read-only application but may occur in a privileged system agent. Attach rules to workload class, namespace, labels, image, and expected process tree so noise does not train teams to ignore alerts.

Detection data can come from kernel events, runtime telemetry, audit logs, file integrity, and network observations. No single source sees everything. Kernel-level sensors observe process and syscall behavior, while Kubernetes audit shows desired-state and API actions. Correlating them reveals whether an unexpected process followed a manifest change, an exec session, or an application request.

Runtime tools need a protected control path. Limit who can change rules or silence alerts. Send output to a store outside application namespaces. Record sensor health and coverage by node; absence of alerts from a node with a failed sensor is not proof of normal behavior.

An alert should lead to a prepared action. Responders may isolate network traffic, revoke the Service Account or external credential, prevent the image digest from new deployment, preserve Pod and node evidence, replace the workload, or rebuild the node. Runbooks should identify which action matches which signal and authority.

Detection also validates prevention. If a supposedly read-only workload produces successful writes to trusted paths, enforcement or observation is inconsistent. If a Restricted namespace runs privileged Pods, investigate label history, exemptions, node configuration, and admission coverage. Continuous signals can reveal drift that a one-time policy test misses.

Feedback should improve both general and local controls. An incident caused by an unexpected shell may justify removing the shell from the image, narrowing seccomp, adding a detection rule, and updating response. A recurring legitimate alert should refine the workload baseline rather than simply disabling the global rule.

## How Should Teams Verify, Debug, and Except Hardened Pods?
<!-- section-summary: Verify namespace policy, stored configuration, effective runtime state, and negative properties; debug each denied requirement narrowly and make every exception scoped, owned, and temporary. -->

Verification closes the gap between authored YAML and reality. Begin with the namespace's PSA labels and versions. Confirm the expected enforce, warn, and audit modes are present and protected.

Test admission before production. Server-side dry runs or a test namespace can show whether a rendered Deployment will pass the real cluster's admission path. Include controllers, because a Deployment may be accepted while its Pod template later fails to create Pods.

Inspect the security context Kubernetes actually stored. Templating, defaults, and mutation can change the object. Then inspect the running Pod and process: UID, groups, capability sets, seccomp status, mounts, namespace sharing, token presence, and resource boundaries.

Test filesystem behavior negatively. Confirm required temporary writes work and writes to the application, system paths, and undeclared locations fail. Test that a mounted Secret is visible only to the intended container and identity.

Verify resource declarations and behavior. Exercise memory, CPU, temporary storage, and child-process growth in a controlled environment. Confirm containment and useful alerts without destabilizing the node.

Security tests should include forbidden configurations:

- privileged Pod rejected;
- root or privilege-escalating container rejected;
- added disallowed capability rejected;
- host namespace and forbidden HostPath rejected;
- missing seccomp or required security fields rejected;
- expected runtime shell or file-write alert generated;
- ordinary workload cannot remove namespace enforcement labels.

When hardening breaks the application, identify the exact requirement. If read-only root fails, find the path and decide whether it is temporary, persistent, or an avoidable mutation of program files. Add one bounded mount rather than making the whole root writable.

If dropping capabilities fails, observe the denied operation. Remove the need through architecture when possible. If one capability remains essential, add only that capability to the one container and test related abuse cases.

Exceptions should be explainable. Record workload, namespace, exact field, business need, risk, owner, compensating controls, approval, expiry, and removal plan. Separate privileged system namespaces from ordinary application namespaces so one exception does not weaken every team.

Verify effective runtime behavior after granting the exception. A manifest field may be allowed but unused, or the application may require more than the reviewer expected. Evidence should show both the intended operation and nearby denied behavior.

Verification should occur at multiple layers. Inspect the namespace label and policy version. Inspect the workload template stored by the API. Inspect the created Pod. Inspect the process and kernel enforcement on the node. A value can be present at one layer and lost, defaulted, or unsupported at another.

For non-root, verify UID and groups inside the container and check the process cannot write root-owned trusted files. For capabilities, inspect effective and bounding sets and attempt a representative forbidden operation. For seccomp, confirm the runtime applied the profile and that one denied syscall produces the expected failure and evidence.

For read-only roots, test application startup, normal requests, certificate reload, log behavior, temporary files, and shutdown. Then attempt writes to executable and system paths. A successful normal test without a negative write test proves functionality but not the security boundary.

For host isolation, inspect namespace relationships and mounts from a controlled diagnostic perspective. The application should not see host processes, runtime sockets, device nodes, or sensitive host paths. Avoid adding a privileged debugging container to production merely to prove the ordinary Pod is unprivileged; use a safe test environment and node-side evidence.

Resource verification should include failure and recovery. Drive controlled memory pressure, CPU use, process creation, and storage growth. Confirm the Pod, not the node, absorbs the failure; alerts identify it; controllers back off safely; and no manual removal of limits is required.

Test admission with raw Pods and every controller type teams deploy. Include updates, ephemeral containers, Jobs, CronJobs, and custom resources that generate Pods where relevant. A guardrail that covers direct Pod creation but misses an indirect path is incomplete.

Exception expiry must be enforced, not remembered. Admission or governance systems should make an expired exception fail or alert clearly. Review whether the original application version still runs and whether a replacement can now meet the standard. Remove the privileged namespace, role, or policy branch after the last consumer leaves.

Keep verification evidence with the workload release: image digest, rendered manifest, policy versions and decisions, effective runtime checks, negative test results, exceptions, and detector health. This lets a later incident distinguish intended authority from drift.

## What Does a Complete Pod Security Operating Model Look Like?
<!-- section-summary: A complete model treats PSS as the shared floor, PSA as preventive enforcement, workload controls as a tighter ceiling, and runtime detection plus verification as continuing feedback. -->

For an ordinary API, the baseline is:

- Restricted PSS enforced at a pinned reviewed version;
- warn and audit used during the next version rollout;
- non-root process with no privilege escalation;
- all Linux capabilities dropped;
- runtime-default or narrower seccomp;
- read-only root and explicit writable mounts;
- no privileged mode, host namespaces, devices, or HostPath;
- no Service Account token unless required;
- measured CPU, memory, process, and storage boundaries;
- immutable trusted image digest;
- least-privileged RBAC, Secrets, and network paths;
- runtime alerts tied to a documented behavioral baseline.

PSS is the floor; workload policy can be a tighter ceiling. Admission policy may require digest references, no automatic tokens, mandatory resource limits, approved runtime classes, or application-specific restrictions beyond Restricted.

A complete architecture works in sequence:

```text
reviewed image and manifest
  -> server-side admission test
  -> authentication and authorization
  -> PSA plus workload policy
  -> accepted restricted Pod
  -> runtime enforces identity, capabilities, seccomp, mounts, and resources
  -> RBAC, Secrets, and network policies narrow external authority
  -> detection observes unexpected behavior
  -> evidence and incidents improve the baseline
```

The strongest mental model is “assume compromise.” Seven useful invariants follow:

1. Application compromise does not mean root.
2. Compromise does not mean privilege growth.
3. Container compromise does not mean host access.
4. Compromise does not mean trusted software modification.
5. Compromise does not mean unlimited resource consumption.
6. A developer or controller cannot accidentally bypass the baseline.
7. Unexpected runtime behavior becomes visible and actionable.

The most important distinction is between desired-state prevention and runtime evidence. Admission proves that one requested shape met policy at one transition. It does not prove the process stayed benign. Detection observes behavior but cannot retroactively prevent an unsafe Pod. Verification checks whether both control planes operate as designed.

The final model is:

```text
Pod security
  = PSS vocabulary
  + PSA enforcement
  + workload-specific securityContext
  + independent identity, secret, network, resource, and image controls
  + runtime detection
  + positive and negative verification
  + bounded exceptions and continuous improvement
```

Operational ownership completes the model. The platform team can own PSS versions, PSA defaults, node enforcement, and common runtime sensors. Application teams own images, security contexts, writable paths, resource behavior, and expected processes. Security teams can own policy requirements, high-risk detection, exception review, and incident coordination. Clear boundaries prevent every failure from becoming “the cluster team's problem.”

Measure the system with useful questions: Which namespaces do not enforce an approved profile? Which workloads violate the next version? Which ordinary applications use root, added capabilities, writable roots, host features, or automatic tokens? Which exceptions are expired? Which nodes lack runtime detection? Which deployed Pods differ from the reviewed template?

Use changes in those answers as improvement signals, not just a compliance score. A decreasing exception count and shrinking privileged workload set show authority being removed. Repeated bypass attempts, long-lived migration namespaces, and sensors without owners show the operating model needs repair.

Connect policy changes to release safety. Canary new admission versions and runtime rules, test representative workloads, monitor latency and false positives, and retain rollback paths that do not disable all security. Policy is part of the production platform and deserves the same controlled lifecycle as application code.

Finally, revisit the assumed-compromise test after architecture changes. A new sidecar, volume, Service Account, network dependency, or debugging feature can add authority without changing the main container's security context. The complete Pod remains the unit of runtime trust.

Run that review after cluster upgrades as well. Changes to Pod Security versions, admission behavior, container runtimes, kernel defaults, or detection sensors can alter effective enforcement without an application commit. Reuse positive and negative fixtures, compare stored and running state, and require owners to explain any newly accepted or newly denied authority. The goal is a stable security contract across both workload and platform evolution.

Retain those upgrade results with the active policy, runtime, node, and workload versions so future investigations can reproduce the enforced boundary precisely.

## Check Your Answers

:::expand[Why Is a Pod a Request for Runtime Authority?]{kind="recap"}
A Pod asks the cluster to create processes with identities, kernel access, mounts, credentials, networks, and resources, so the useful threat model begins after application compromise.
:::

:::expand[What Do the Pod Security Standards Define?]{kind="recap"}
PSS names Privileged, Baseline, and Restricted levels of tolerated authority, but those profiles are definitions and do not enforce themselves.
:::

:::expand[How Does Pod Security Admission Enforce Those Standards?]{kind="recap"}
PSA uses namespace-selected profiles, versions, and enforce, warn, or audit modes to evaluate Pod-producing requests before unsafe processes start.
:::

:::expand[How Do You Build a Restricted Security Context?]{kind="recap"}
Use non-root execution, no privilege escalation, dropped capabilities, seccomp, read-only software, explicit writes, and no privileged or host shortcuts.
:::

:::expand[Which Security Boundaries Sit Outside the Pod Security Standards?]{kind="recap"}
Resource budgets, RBAC, Secrets, networks, image trust, tenant isolation, runtime detection, and application authorization remain independent controls beyond Restricted.
:::

:::expand[Why Do Admission Prevention and Runtime Detection Need Each Other?]{kind="recap"}
Admission blocks known-dangerous desired state before execution, while runtime detection finds unexpected behavior within allowed configuration and reveals degraded controls.
:::

:::expand[How Should Teams Verify, Debug, and Except Hardened Pods?]{kind="recap"}
Test the real admission path and running process, include negative properties, repair requirements narrowly, and make exceptions scoped, owned, evidenced, and expiring.
:::

:::expand[What Does a Complete Pod Security Operating Model Look Like?]{kind="recap"}
Use PSS as the floor, PSA as preventive enforcement, workload policy as a tighter ceiling, and runtime verification and detection as continuing feedback.
:::
