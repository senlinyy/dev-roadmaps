---
title: "Pod Security and Runtime Hardening"
description: "Harden Kubernetes pods with Pod Security Standards, securityContext settings, resource limits, and runtime detection."
overview: "A Kubernetes pod can ask for powerful access to the node it runs on. This article follows a checkout service as it moves from a permissive pod spec to a safer runtime shape using Pod Security Admission, securityContext settings, resource limits, and Falco alerts."
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

1. [Why Pod Runtime Settings Matter](#why-pod-runtime-settings-matter)
2. [The Starting Pod: Fast to Ship, Too Powerful](#the-starting-pod-fast-to-ship-too-powerful)
3. [Pod Security Standards](#pod-security-standards)
4. [Pod Security Admission](#pod-security-admission)
5. [Hardening the Pod Spec](#hardening-the-pod-spec)
6. [Resource Limits and Blast Radius](#resource-limits-and-blast-radius)
7. [Verification Commands](#verification-commands)
8. [Runtime Detection with Falco](#runtime-detection-with-falco)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Why Pod Runtime Settings Matter
<!-- section-summary: A pod spec controls more than scheduling and ports; it also controls how much power the container receives inside the node. -->

In the previous article, Kubernetes security started with access: who can read secrets, who can create workloads, and which service accounts can talk to the API. That work matters because the API server is the front door. Now the checkout team has a different problem. Their payments service already made it through deployment, and the question has moved from "who can create this pod?" to "what can this pod do after it starts?"

That second question lives inside the pod spec. A pod spec can decide whether a container runs as root, whether it can add Linux capabilities, whether it can mount files from the node, whether it can share the node network, and whether the container filesystem is writable. Those settings shape the **blast radius** of a bug or compromise. Blast radius means the amount of damage one failure can cause before another control stops it.

Let's make this concrete. Your company runs an online store. The `checkout-api` pod accepts carts, calls a payment provider, writes order records, and emits a receipt event. A normal request path needs a network port, a service account token, a few environment variables, CPU and memory, and maybe a temporary directory. Node filesystem mounts, host process inspection, kernel-level features, and writable image filesystems sit outside that normal checkout job.

Kubernetes gives you two layers for this work. **Pod Security Admission** applies a namespace-level policy before pods are accepted. **securityContext** fields define the runtime settings inside the pod and container spec. Admission stops unsafe shapes from entering the cluster. The pod spec still needs the exact settings that make the workload safe and runnable.

## The Starting Pod: Fast to Ship, Too Powerful
<!-- section-summary: The first version of a production pod often grows from debugging shortcuts, so hardening starts by making those shortcuts visible. -->

Imagine the checkout team is under pressure before a launch. A previous incident happened because a log directory was hard to inspect. Someone added a host mount. A port conflict appeared in a staging cluster. Someone enabled host networking while debugging. A third-party library wanted to bind to a low port, so the team ran the container as root. The pod works, and it now carries permissions outside normal checkout traffic.

Here is a deliberately unsafe pod. It is useful because it shows the kinds of fields you should learn to spot during review:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api
  namespace: payments
  labels:
    app: checkout-api
spec:
  hostNetwork: true
  hostPID: true
  serviceAccountName: checkout-api
  containers:
    - name: checkout-api
      image: registry.example.com/payments/checkout-api:1.7.3
      ports:
        - containerPort: 8080
          hostPort: 8080
      securityContext:
        privileged: true
        runAsUser: 0
        allowPrivilegeEscalation: true
        capabilities:
          add:
            - SYS_ADMIN
            - NET_ADMIN
      volumeMounts:
        - name: host-var-log
          mountPath: /host/var/log
        - name: app-cache
          mountPath: /var/cache/checkout
  volumes:
    - name: host-var-log
      hostPath:
        path: /var/log
        type: Directory
    - name: app-cache
      emptyDir: {}
```

A **privileged container** receives broad access to host-level features. Kubernetes documents privileged containers as a known escalation path, and the Pod Security Standards disallow them in Baseline and Restricted workloads. For a normal web API, `privileged: true` should immediately raise a review question.

`hostNetwork: true` puts the pod into the node's network namespace. The pod can see the host network stack in a way ordinary pods cannot. `hostPID: true` lets the pod share the host process namespace, which can expose host process information. `hostPort` binds a port on the node itself. These features help a small set of infrastructure agents, but they give an application pod extra reach into the node.

`hostPath` mounts a path from the node into the pod. That can expose logs, sockets, configuration, container runtime paths, or other sensitive files depending on the path. A checkout service that needs temporary cache space should use `emptyDir`, an application volume, or a persistent volume claim. Mounting `/var/log` from the node gives the workload a much wider view than it needs.

Linux **capabilities** split root power into smaller privileges. `SYS_ADMIN` is especially broad and often appears in escape and abuse paths. `NET_ADMIN` lets a process change network settings. A checkout API that listens on port `8080` and calls other services should usually drop capabilities instead of adding them.

Now the team knows the shape of the problem. The next step is choosing a cluster-wide language for "safe enough" so reviewers and platform engineers do not argue from memory every time.

## Pod Security Standards
<!-- section-summary: Pod Security Standards give teams a shared Kubernetes vocabulary for privileged, baseline, and restricted pod shapes. -->

**Pod Security Standards**, usually shortened to PSS, are Kubernetes-defined policy profiles for pod security. They describe which pod settings fit three levels: **Privileged**, **Baseline**, and **Restricted**.

**Privileged** is the open profile. It exists for trusted infrastructure workloads that need host-level access, such as some node agents, storage components, or low-level networking tools. A business application should have a very clear reason before it lands here.

**Baseline** blocks common privilege escalation paths while still allowing many default container settings. It rejects things like privileged containers, host namespaces, and `hostPath` volumes. Baseline is a practical first gate for mixed clusters where many existing applications still use default image behavior.

**Restricted** applies stronger hardening. It requires non-root execution, restricts privilege escalation, requires seccomp on Linux, limits volume types, and requires containers to drop all Linux capabilities, with `NET_BIND_SERVICE` as the narrow capability exception. This is the profile you want for ordinary stateless applications after the team has cleaned up images and manifests.

For the checkout service, the target is Restricted. It handles payment flow data, accepts public-facing traffic through an ingress path, and runs application code that should never need host access. The team may use Baseline as a migration step in older namespaces, but the finished pod should fit Restricted.

![Pod Security Standards levels comparing Privileged host access, Baseline common defaults, and Restricted non-root controls for a checkout pod](/content-assets/articles/article-devsecops-kubernetes-security-pod-security-and-runtime-hardening/pod-security-standards-levels.png)

*The three profiles give reviewers a shared language: privileged workloads need a platform-level reason, baseline blocks common escalation paths, and restricted is the target shape for ordinary application pods.*

There is one important detail. PSS describes the profiles, and a cluster needs an admission mechanism to apply those profiles. Kubernetes includes that mechanism through Pod Security Admission.

## Pod Security Admission
<!-- section-summary: Pod Security Admission turns the standards into namespace labels that can warn, audit, or reject unsafe pods. -->

**Pod Security Admission**, usually shortened to PSA, is the built-in Kubernetes admission controller that enforces the Pod Security Standards. An admission controller checks API requests before Kubernetes stores the object. PSA looks at pod specs and workload pod templates, compares them to the selected PSS level, and then takes action based on namespace labels.

PSA has three modes:

| Mode | What happens |
|---|---|
| **warn** | Kubernetes allows the request but shows a warning to the user. |
| **audit** | Kubernetes allows the request and adds an audit annotation for the violation. |
| **enforce** | Kubernetes rejects pods that violate the selected profile. |

This mode split is useful for real migrations. A platform team can warn and audit at Restricted while enforcing Baseline. Developers see warnings during `kubectl apply`, security teams get audit records, and the cluster still blocks the most dangerous pod shapes.

For the `payments` namespace, a migration-friendly setup can look like this:

```bash
kubectl label namespace payments \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=v1.36 \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version=v1.36 \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=v1.36 \
  --overwrite
```

After the checkout deployment has been fixed, the namespace can enforce Restricted:

```bash
kubectl label namespace payments \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=v1.36 \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version=v1.36 \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version=v1.36 \
  --overwrite
```

The version labels pin policy behavior to a Kubernetes minor version. That helps during upgrades because the policy does not silently shift under running delivery pipelines. Many teams update these versions deliberately as part of cluster upgrade testing.

You can test the unsafe pod against admission without creating it:

```bash
kubectl apply --dry-run=server -f checkout-api-insecure.yaml
```

With `warn=restricted`, Kubernetes prints warnings for Restricted violations. With `enforce=baseline`, it rejects fields such as `privileged`, `hostNetwork`, `hostPID`, and `hostPath`. The exact message depends on your Kubernetes version and the fields in the manifest, but the review signal is immediate: this pod has more power than its job requires.

Admission gives the team a gate. The next work happens inside the manifest.

## Hardening the Pod Spec
<!-- section-summary: securityContext fields reduce what the checkout process can do after it starts, which keeps a bug from turning into node-level control. -->

A **securityContext** defines privilege and access control settings for a pod or container. Pod-level settings apply to all containers unless a container overrides them. Container-level settings control one container. In production manifests, teams usually set the common identity and profile fields at the pod level, then set container-specific fields like `allowPrivilegeEscalation`, capabilities, and read-only root filesystems on each container.

Here is a hardened version of the checkout pod. It removes host access, runs as a non-root user, drops Linux capabilities, uses a read-only root filesystem, and sets runtime profiles:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api
  namespace: payments
  labels:
    app: checkout-api
spec:
  serviceAccountName: checkout-api
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
    - name: checkout-api
      image: registry.example.com/payments/checkout-api:1.7.4
      ports:
        - containerPort: 8080
      securityContext:
        allowPrivilegeEscalation: false
        privileged: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
      env:
        - name: TMPDIR
          value: /tmp
      volumeMounts:
        - name: tmp
          mountPath: /tmp
        - name: cache
          mountPath: /var/cache/checkout
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
  volumes:
    - name: tmp
      emptyDir:
        sizeLimit: 64Mi
    - name: cache
      emptyDir:
        sizeLimit: 256Mi
```

![Hardened pod controls showing non-root execution, read-only root filesystem, dropped capabilities, no privilege escalation, and runtime default seccomp around one pod](/content-assets/articles/article-devsecops-kubernetes-security-pod-security-and-runtime-hardening/hardened-pod-controls.png)

*The hardened pod is not one magic field. It is a set of small runtime limits that work together so one process bug has fewer paths into the node.*

**Run as non-root** means the process inside the container runs with a numeric user ID other than `0`. In Linux, UID `0` is root. Even inside a container, root can create more risk because many filesystem permissions, package defaults, and runtime behaviors assume root is powerful. `runAsNonRoot: true` tells the runtime to reject the container if it would run as root. `runAsUser: 10001` makes the intended user explicit.

The image must support that user. In a Dockerfile, the application should create or use a non-root UID and make writable paths owned by that UID. A simple pattern looks like this:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN addgroup -S checkout -g 10001 && adduser -S checkout -u 10001 -G checkout \
  && mkdir -p /var/cache/checkout \
  && chown -R 10001:10001 /app /var/cache/checkout
USER 10001:10001
CMD ["node", "server.js"]
```

**Dropping capabilities** removes extra Linux privileges from the process. The Restricted PSS profile expects Linux containers to drop `ALL` capabilities and allows adding only `NET_BIND_SERVICE` when needed. The checkout API listens on `8080`, so `NET_BIND_SERVICE` can stay out of the manifest. If another service must bind to port `443` inside the container, the safer choice is often to change the container port to a higher port and let the Kubernetes Service or ingress expose `443`.

**allowPrivilegeEscalation: false** blocks a process from gaining more privileges than its parent process. Kubernetes documents that this setting is always true for privileged containers or containers with `CAP_SYS_ADMIN`, which is another reason to remove those fields. For the checkout API, the process should keep the same privilege level for its whole lifetime.

**readOnlyRootFilesystem: true** mounts the image filesystem as read-only. This helps when an attacker tries to write a tool into `/usr/bin`, replace application files, or persist changes in the container layer. Many apps still need writable scratch space, so the manifest gives the checkout pod explicit `emptyDir` mounts for `/tmp` and `/var/cache/checkout`. That is the trade the team wants: known writable paths, bounded by size, instead of a writable whole image filesystem.

**seccomp** filters Linux system calls. A system call is a request from a process to the kernel, such as opening a file, creating a process, or changing network state. `seccompProfile.type: RuntimeDefault` asks the container runtime to use its default syscall filter. Restricted PSS requires a seccomp profile on Linux pods and rejects `Unconfined`.

**AppArmor** applies a Linux security profile that limits what a process can access. In current Kubernetes, `appArmorProfile.type: RuntimeDefault` is the direct pod spec field for using the runtime default profile where AppArmor is supported. Older clusters used annotations for AppArmor profiles, so check your cluster version before copying manifests between environments.

`automountServiceAccountToken: false` removes the automatic API token mount. This field belongs in the runtime hardening conversation because many application pods never call the Kubernetes API. If checkout only talks to payment, inventory, and order services, the safer default is no Kubernetes API credential in the pod. If it later needs API access, the team can add it deliberately and pair it with a narrow Role from the previous article.

Now the pod shape is much safer. It still needs resource boundaries so a bug inside the checkout process cannot consume the whole node.

## Resource Limits and Blast Radius
<!-- section-summary: CPU, memory, and emptyDir limits keep one pod failure from consuming shared node capacity. -->

Resource settings address a different part of blast radius than privilege hardening. A container with a memory leak can push other pods off the node. A runaway CPU loop can starve neighbors. A cache bug can fill local ephemeral storage. Security teams care about these limits because denial of service is still a security incident when checkout traffic stops.

The hardened manifest used this resource block:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

A **request** tells Kubernetes how much CPU or memory the pod expects for scheduling. A **limit** tells the runtime the maximum the container can use. If checkout normally uses `80Mi` to `180Mi` of memory and spikes near `300Mi` during sale events, `512Mi` gives room without letting one pod eat the node. Real teams tune these numbers from metrics, load tests, and production history.

The `emptyDir` volumes also have `sizeLimit` values:

```yaml
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 64Mi
  - name: cache
    emptyDir:
      sizeLimit: 256Mi
```

This keeps scratch paths bounded instead of letting one pod fill local disk. If the app writes too much temporary data, the failure stays close to that pod instead of spreading across the node.

Namespaces can add defaults and minimums with `LimitRange`, and they can cap total namespace usage with `ResourceQuota`. Those controls help platform teams make safer defaults for every workload in `payments`, while the pod manifest still documents what the checkout team expects this specific service to use.

## Verification Commands
<!-- section-summary: Hardening finishes with repeatable checks that prove the manifest and running pod match the expected shape. -->

The team now has a hardened manifest and namespace labels. Verification starts with the labels on the namespace:

```bash
kubectl get namespace payments --show-labels
```

For a cleaner view, ask for the specific PSA labels:

```bash
kubectl get namespace payments \
  -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}{"\n"}{.metadata.labels.pod-security\.kubernetes\.io/warn}{"\n"}{.metadata.labels.pod-security\.kubernetes\.io/audit}{"\n"}'
```

Server-side dry runs show how the API server handles each manifest before either one gets created:

```bash
kubectl apply --dry-run=server -f checkout-api-insecure.yaml
kubectl apply --dry-run=server -f checkout-api-hardened.yaml
```

The insecure file should warn or fail depending on your namespace labels. The hardened file should pass PSA checks for the target profile. If the hardened file fails Restricted, the warning usually names the field and the profile rule that rejected it.

After the hardened pod or deployment has been applied, the stored spec should still show the same hardening fields:

```bash
kubectl get pod checkout-api -n payments -o yaml
```

The runtime identity check happens from inside the container:

```bash
kubectl exec -n payments checkout-api -- id
kubectl exec -n payments checkout-api -- sh -c 'touch /should-not-write'
kubectl exec -n payments checkout-api -- sh -c 'touch /tmp/runtime-check && ls -l /tmp/runtime-check'
```

The `id` output should show UID `10001` instead of UID `0`. The write to `/should-not-write` should fail because the root filesystem is read-only. The write to `/tmp/runtime-check` should succeed because `/tmp` is an explicit writable volume.

You can also check resource settings:

```bash
kubectl describe pod checkout-api -n payments
kubectl top pod checkout-api -n payments
```

`kubectl describe` shows requests, limits, mounts, and security context fields. `kubectl top` depends on metrics-server and shows current CPU and memory use, which helps tune future requests and limits.

These checks catch configuration problems before and after admission. Runtime behavior needs another signal, because the process can still do surprising things after it starts. That is where runtime detection comes in.

## Runtime Detection with Falco
<!-- section-summary: Admission controls the pod shape before creation, while runtime detection watches for suspicious behavior after the process starts. -->

**Runtime detection** watches behavior while workloads run. It looks for signals such as a shell starting inside a container, a process writing below a sensitive path, a pod touching host files, or unexpected network and process activity. Admission rejects unsafe manifests before creation, while runtime detection covers later process behavior.

Falco is a common open source tool for Kubernetes runtime threat detection. It observes system activity and evaluates that activity against rules. For the checkout service, useful signals might include an interactive shell spawning in the container, package manager execution in a running container, writes below system directories, access to sensitive host paths, or outbound connections that do not match expected service behavior.

A typical Kubernetes install uses the official Falco Helm chart:

```bash
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm repo update
helm install falco falcosecurity/falco \
  --namespace falco \
  --create-namespace
```

After installation, the Falco pods and recent logs show whether the sensor is running:

```bash
kubectl get pods -n falco
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=50
```

In production, Falco alerts usually go to a central destination through Falcosidekick, a logging pipeline, a SIEM, or an incident channel. The important practice is to tune rules with the application team. If checkout legitimately runs a migration helper during startup, a narrow exception for that command and container image keeps the signal useful. Broad exceptions can silence a whole class of behavior for every workload.

PSA and `securityContext` reduce the actions a pod can take before runtime alerts enter the picture. Falco then gives you visibility when something unusual still happens. That order matters in production because alerts are easier to handle when the allowed runtime surface is already small.

## Putting It All Together
<!-- section-summary: A hardened pod combines namespace policy, explicit pod settings, resource boundaries, verification, and runtime alerts. -->

The checkout service started with a pod that worked, but it worked with dangerous shortcuts: privileged mode, host namespaces, a hostPath mount, root execution, added capabilities, and a writable image filesystem. Each shortcut made local debugging easier at one point, and each one increased the damage a compromised checkout process could cause.

The hardened version changes the operating shape of the service. Pod Security Admission gives the `payments` namespace a shared policy gate. Restricted warnings help developers catch unsafe fields during dry runs. Enforce mode keeps known-dangerous pod shapes out of the namespace. The pod's `securityContext` then makes the runtime behavior explicit: non-root user, no privilege escalation, no privileged mode, all capabilities dropped, read-only root filesystem, runtime default seccomp, and runtime default AppArmor where supported.

The resource settings add practical guardrails. CPU and memory limits stop one broken process from taking all node capacity. `emptyDir.sizeLimit` keeps temporary writes bounded. Verification commands give the team repeatable proof that the manifest and the running pod match the expected behavior. Falco adds a runtime signal for suspicious actions that still happen after deployment.

This is how pod hardening usually lands in real teams. One manifest rarely solves every cluster policy problem. The first useful pass removes host access from ordinary application pods. The image contract includes non-root execution. Capabilities get dropped by default. The app receives only the writable paths it needs. PSA makes those expectations visible and enforceable across namespaces. Runtime detection gives production surprises a place to surface.

![Pod security operations loop showing restricted namespace labels, a hardened manifest, server dry-run, live pod verification, and runtime alerts](/content-assets/articles/article-devsecops-kubernetes-security-pod-security-and-runtime-hardening/pod-security-operations-loop.png)

*The end-to-end loop shows how teams keep pod security practical: policy labels stop risky shapes, manifests make runtime limits explicit, dry-runs and live checks prove the result, and alerts watch what still happens at runtime.*

## What's Next
<!-- section-summary: The next article moves from pod internals to the traffic paths between pods and namespaces. -->

The checkout pod now has a smaller runtime surface. That helps if the process gets compromised, but it still runs inside a networked system. It can call other services, receive traffic from ingress paths, and talk to dependencies inside the cluster.

The next article moves to **network isolation**. We will use NetworkPolicy-style thinking to decide which pods should talk to checkout, which services checkout should reach, and how namespace boundaries reduce lateral movement after one workload has a bad day.

---

## References

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Defines the Privileged, Baseline, and Restricted profiles and the controls each profile covers.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Explains the built-in admission controller, namespace labels, enforce/audit/warn modes, and policy version labels.
- [Enforce Pod Security Standards with namespace labels](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/) - Shows namespace label examples for Pod Security Admission.
- [Configure a security context for a pod or container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Documents pod and container `securityContext` fields including non-root users, privilege escalation, capabilities, seccomp, AppArmor, and read-only root filesystems.
- [Seccomp and Kubernetes](https://kubernetes.io/docs/reference/node/seccomp/) - Describes seccomp support and runtime default profiles in Kubernetes.
- [Restrict a container's access to resources with AppArmor](https://kubernetes.io/docs/tutorials/security/apparmor/) - Documents AppArmor usage and profile behavior for containers.
- [Resource management for pods and containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Explains CPU, memory, and ephemeral storage requests and limits.
- [Kubernetes cluster security good practices](https://kubernetes.io/docs/concepts/security/security-checklist/) - Provides Kubernetes project guidance for cluster, workload, and runtime security practices.
- [NSA and CISA Kubernetes Hardening Guidance](https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CSI_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF) - Primary agency guidance on Kubernetes hardening, including pod security, least privilege, and runtime monitoring.
- [Falco Kubernetes quickstart](https://falco.org/docs/getting-started/falco-kubernetes-quickstart/) - Official Falco guide for trying Falco on Kubernetes.
- [Falco rules concepts](https://falco.org/docs/concepts/rules/) - Official Falco documentation for how runtime detection rules are structured.
