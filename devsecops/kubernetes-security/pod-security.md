---
id: article-devsecops-kubernetes-security-pod-security
title: Pod Security
description: Shape pod behavior so containers run with fewer privileges and fewer paths to the host.
overview: Pod security controls reduce what a compromised container can do. You will harden the devpolaris-orders deployment with security contexts, namespace policy labels, and practical checks.
tags: ["pods", "security", "runtime"]
order: 2
---

## Table of Contents

1. [Container Settings Become Security Boundaries](#container-settings-become-security-boundaries)
2. [The Baseline Deployment](#the-baseline-deployment)
3. [Security Contexts Explain How the Process Runs](#security-contexts-explain-how-the-process-runs)
4. [Namespace Policy Labels Set the Floor](#namespace-policy-labels-set-the-floor)
5. [Checking What Actually Reached the Cluster](#checking-what-actually-reached-the-cluster)
6. [When Restricted Pods Fail to Start](#when-restricted-pods-fail-to-start)
7. [Privilege Is a Tradeoff](#privilege-is-a-tradeoff)
8. [Diagnostic Path for Pod Security Reviews](#diagnostic-path-for-pod-security-reviews)
9. [Failure Modes and Fix Directions](#failure-modes-and-fix-directions)

## Container Settings Become Security Boundaries

A pod is the smallest Kubernetes workload unit you schedule. It can contain one or more containers that share networking and some storage. Pod security is the practice of limiting what those containers can do on the node and inside their own filesystem.

This exists because Kubernetes can run very different kinds of workloads. A trusted node agent may need host access, while devpolaris-orders-api should behave like a normal web service. If both get the same privileges, a bug in the API can become a path to the node.

The running example hardens devpolaris-orders without changing application code. The goal is a pod that runs as a non-root user, drops Linux capabilities, avoids privilege escalation, and does not mount an unnecessary Kubernetes API token.

## The Baseline Deployment

Start by looking at the workload as it might appear before a security review. It has a namespace, a deployment, and a service account. The image is specific enough to audit, but the pod security settings are still missing.

Missing settings are not always visible during a happy deployment. The pod starts, the service responds, and the release looks green. The risk appears later if an attacker gets code execution, if a package tries to write into system paths, or if the container runs with more Linux privileges than the app needs.

This trimmed manifest shows the starting point.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: devpolaris-orders
spec:
  replicas: 2
  selector:
    matchLabels:
      app: devpolaris-orders-api
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
    spec:
      serviceAccountName: orders-api
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-08.1
          ports:
            - containerPort: 8080
```

## Security Contexts Explain How the Process Runs

A security context is Kubernetes configuration that becomes container runtime settings. It answers questions such as which user ID runs the process, whether the root filesystem is read-only, which Linux capabilities are available, and whether a process can gain more privilege.

Linux capabilities are small privilege bits split out from the highly privileged root user. A web API usually does not need capabilities such as changing network settings or mounting filesystems. Dropping all capabilities and adding back only what is needed is safer than accepting image defaults.

The hardened version below keeps the API inside a narrower runtime box.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: devpolaris-orders
spec:
  template:
    spec:
      serviceAccountName: orders-api
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-08.1
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsUser: 10001
            runAsGroup: 10001
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

## Namespace Policy Labels Set the Floor

Pod Security Admission is a built-in admission mechanism that checks pods against the Kubernetes Pod Security Standards. The standards describe three policy levels: privileged, baseline, and restricted. Restricted is the tightest general-purpose level for ordinary application workloads.

The policy is applied through namespace labels. That design lets platform teams set a floor for a namespace without writing a custom webhook. For devpolaris-orders, the team can warn first, fix manifests, then enforce once the deployment is compatible.

The labels below enforce restricted rules for new pods in the namespace.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: devpolaris-orders
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

## Checking What Actually Reached the Cluster

A manifest in Git is only the intent. You still need to inspect the pod that the API server accepted and the kubelet started. kubectl get with jsonpath is useful when you want one field without scrolling through a full object.

The checks below confirm the service account token is not mounted, the pod must run as non-root, and the container cannot escalate privilege. These are small checks, but they catch many accidental regressions during review.

Use these checks after a deployment or in a platform validation job.

```bash
$ kubectl get pod -n devpolaris-orders -l app=devpolaris-orders-api   -o jsonpath='{.items[0].spec.automountServiceAccountToken}{"\n"}'
false

$ kubectl get pod -n devpolaris-orders -l app=devpolaris-orders-api   -o jsonpath='{.items[0].spec.securityContext.runAsNonRoot}{"\n"}'
true

$ kubectl get pod -n devpolaris-orders -l app=devpolaris-orders-api   -o jsonpath='{.items[0].spec.containers[0].securityContext.allowPrivilegeEscalation}{"\n"}'
false
```

## When Restricted Pods Fail to Start

Security settings can reveal assumptions inside the container image. If the image expects to write under /app, bind to a privileged port, or run as root, the pod may fail after you add stricter settings. That is useful feedback because the image and the deployment disagree about how the service should run.

A read-only root filesystem failure often appears as a crash loop with an application log that names a path. The fix direction is to move writable state to an explicit volume such as emptyDir for temporary files, or change the application to write to a configured writable path.

A typical failure looks like this.

```text
2026-05-08T19:03:44Z level=error service=orders-api
open /app/cache/startup.json: read-only file system

Pod status:
NAME                                      READY   STATUS             RESTARTS
devpolaris-orders-api-7f9cc8c6b9-hq6ns   0/1     CrashLoopBackOff   4
```

## Privilege Is a Tradeoff

Some workloads genuinely need more access. A node log collector may need host paths. A service mesh component may need network capabilities. A database may need writable storage. The security decision is not to ban every privilege forever, but to make extra privilege visible and tied to a workload reason.

For devpolaris-orders-api, the tradeoff is straightforward. The API is a normal HTTP service. It should not need host networking, host paths, privileged mode, or a writable root filesystem. If a future change asks for one of those, the pull request should explain what changed in the application design.

Document exceptions close to the workload. An unexplained privileged container becomes impossible to review six months later.

## Diagnostic Path for Pod Security Reviews

Start with the namespace labels because they tell you which policy level the cluster will enforce. Then inspect the deployment template because new pods are created from that template. Finally inspect a live pod to confirm the accepted object matches the expected settings.

If admission rejects a pod, read the warning or error text before changing multiple fields. The message usually names the specific restricted rule that failed. Fix one class of issue at a time so you can tell whether the image, the deployment, or the namespace policy caused the problem.

The review path is short enough to keep in a runbook: namespace labels, deployment securityContext, container securityContext, service account token setting, live pod fields, and recent events.

## Failure Modes and Fix Directions

If the pod is rejected by admission, compare the error to the Pod Security Standards and add the missing securityContext field. If the pod starts but the app crashes, read container logs for filesystem or permission errors. If the pod runs as root despite your intent, inspect both pod-level and container-level settings because the container value can be more specific.

If a team disables enforcement to unblock a release, switch the namespace to warn and audit only for the shortest practical window, then create a tracked task to restore enforce. Leaving enforcement off turns a one-time compatibility issue into a permanent policy gap.

A useful pull request includes both the manifest change and one kubectl output proving the live pod received the expected settings. That evidence helps reviewers trust the change without rereading the whole deployment.

### Diagnostic Worksheet

Use this worksheet when a pull request or incident touches pod security for devpolaris-orders. It keeps the review tied to evidence from the cluster instead of opinions about whether a setting looks strict enough.

| Check | Command or evidence | Expected result |
|-------|---------------------|-----------------|
| Namespace enforces restricted policy | `kubectl get ns devpolaris-orders -o jsonpath={.metadata.labels.pod-security\.kubernetes\.io/enforce}` | restricted |
| Pod must run as non-root | `kubectl get pod -l app=devpolaris-orders-api -n devpolaris-orders -o jsonpath={.items[0].spec.securityContext.runAsNonRoot}` | true |
| Privilege escalation is off | `kubectl get pod -l app=devpolaris-orders-api -n devpolaris-orders -o jsonpath={.items[0].spec.containers[0].securityContext.allowPrivilegeEscalation}` | false |
| Capabilities are dropped | `kubectl get pod -l app=devpolaris-orders-api -n devpolaris-orders -o jsonpath={.items[0].spec.containers[0].securityContext.capabilities.drop}` | [ALL] |
| Root filesystem is read-only | `kubectl get pod -l app=devpolaris-orders-api -n devpolaris-orders -o jsonpath={.items[0].spec.containers[0].securityContext.readOnlyRootFilesystem}` | true |

The point of the worksheet is not to make every review long. It gives the reviewer a repeatable path when the change is risky, when the service has recently failed, or when a broad exception is being requested. A small amount of evidence prevents a lot of guessing.

### Failure Matrix

| Symptom | Likely place to inspect | Fix direction |
|---------|-------------------------|---------------|
| The release fails before a pod changes | API server response, server dry run, or authorization check | Read the exact denied verb, field, or policy message before widening access. |
| The pod starts but the app fails | Container logs, pod events, mounted files, selected labels | Fix the workload assumption or the narrow selector that does not match reality. |
| The control appears inactive | Namespace, selector, controller support, live object | Prove the object selects the pod and that the cluster component enforces it. |
| An emergency exception was added | Git history, admission or RBAC object, incident ticket | Add an owner, a removal date, and the narrow replacement rule. |

If the pod fails after readOnlyRootFilesystem is enabled, do not turn the setting off first. Find the path the application tried to write, then move only that writable need to an explicit volume such as emptyDir or a real persistent volume.

### Pull Request Evidence

A useful pull request for this topic should include the intent, the live check, and the expected failure. For example, an orders API change might say that the service can still receive traffic from devpolaris-web, cannot receive traffic from devpolaris-tools, and still rolls out with the pinned image digest. Those statements are easy to test after merge.

Keep the evidence close to the changed object. If the pull request changes a Role, include a can-i check. If it changes a pod security setting, include one live pod field or a server dry run. If it changes a network rule, include the selected pod labels and one allowed or denied connection.

### Runbook Handoff

The last review question is who will notice when this control breaks. A developer may see a failed rollout. A platform engineer may see an admission denial. A security engineer may see a runtime alert. Write the handoff in plain service language so the next person knows whether to inspect Kubernetes events, controller logs, application logs, or the policy object itself.

For devpolaris-orders, the handoff should name the namespace, deployment, service account, and policy object. It should also name the safe rollback. Sometimes the rollback is to restore a previous manifest. Sometimes it is to add one missing label. Sometimes it is to create a short exception while the image or application is fixed.

### Operator Notes

- Keep the namespace name in every command so evidence is not accidentally collected from another environment.
- Prefer server-side dry runs before applying policy changes that can block releases.
- Keep one allowed test and one denied test for every protective rule.
- Record temporary exceptions with an owner and a removal condition.
- Recheck selectors after label changes because many Kubernetes controls depend on labels.
- Treat missing evidence as a reason to inspect, not as proof that the system is safe.

### Scenario Drill

Use this drill to turn pod security from a file review into an operating habit. The scenario starts with pod rejected by restricted policy in the devpolaris-orders namespace. The goal is to collect enough evidence to decide whether to fix the workload, fix the policy, or open a short exception.

1. Name the affected object: devpolaris-orders-api pod.
2. Name the protecting artifact: securityContext and namespace labels.
3. Capture the namespace and labels before changing anything.
4. Run one command that proves the allowed path.
5. Run one command that proves the denied or detected path.
6. Write the smallest fix direction in the incident note.

A short incident note might look like this.

```text
Service: devpolaris-orders-api
Namespace: devpolaris-orders
Symptom: pod rejected by restricted policy
Primary object: devpolaris-orders-api pod
Security artifact: securityContext and namespace labels
Allowed path checked: expected service operation still works
Denied path checked: risky behavior is blocked or detected
Next action: narrow fix, not a broad exception
```

The note is intentionally plain. During a release problem, people need the object names and the next check more than they need a long theory of Kubernetes. The theory belongs in the article and the runbook. The incident note should help the next engineer continue the investigation.

### Evidence Record

| Evidence field | Why it matters | Example value |
|----------------|----------------|---------------|
| Namespace | Confirms the control and workload live in the same place | devpolaris-orders |
| Workload label | Proves selectors can match the pod | app=devpolaris-orders-api |
| Service account | Connects runtime behavior to Kubernetes identity | orders-api |
| Release identity | Separates deploy permissions from app permissions | orders-release |
| Image reference | Connects the running container to a build record | ghcr.io/devpolaris/orders-api@sha256:... |
| Policy object | Names the Kubernetes object that made or should make the decision | securityContext and namespace labels |
| Expected denial | Shows the rule has a protective edge | risky action fails |
| Expected allow | Shows the rule does not break normal service work | normal request succeeds |

When one of these fields is missing, pause before widening the rule. Missing labels, wrong namespaces, and stale image references cause many false conclusions. They are cheaper to fix than a broad policy change.

### Narrow Fix Examples

| Problem shape | Broad fix to avoid | Narrower fix direction |
|---------------|--------------------|------------------------|
| Selector matches zero pods | Disable the control | Correct the label on the workload or policy. |
| Release is blocked | Grant administrator access | Add the exact missing verb, field, peer, key, or exception. |
| Application crashes | Remove all hardening | Identify the file, port, key, or call that changed. |
| Alert has little context | Ignore future alerts | Add namespace, pod, image, and service account fields to the signal. |
| Exception has no owner | Leave it until later | Add owner, reason, and removal condition in the same pull request. |

A narrow fix is not always a small diff. Sometimes the correct fix is an image rebuild, a label migration, or a new secret rotation path. The important part is that the fix follows the evidence instead of making the security boundary disappear.

### What to Teach a New Teammate

When someone joins the team, do not start by listing every Kubernetes field. Start with the path of one request or one release. Show how the request enters the cluster, which pod receives it, which identity the pod uses, and which control would stop an unsafe change. Then show the command that proves the control exists.

For devpolaris-orders, the teaching path is short enough to repeat during onboarding. The namespace is devpolaris-orders. The deployment is devpolaris-orders-api. The runtime service account is orders-api. The release service account is orders-release. The protective artifacts live beside that service instead of in a hidden spreadsheet.

### Review Questions

- Which object makes the decision?
- Which workload does it select?
- Which identity receives permission or restriction?
- What normal path must still work after the change?
- What unsafe path must fail, warn, or alert after the change?
- Where will the next engineer see the failure signal?
- Is there a short exception, and who owns removing it?

These questions keep the review concrete. If the team cannot answer them, the pull request is not ready for production even if the YAML parses successfully.

### Practice Prompt

Take the current manifest for devpolaris-orders-api and mark the lines that control identity, selection, and allowed behavior. Then write two test statements: one that should succeed and one that should fail. If either statement cannot be tested with kubectl output, logs, or a server-side dry run, add the missing evidence step before merging.

This practice is small, but it builds the habit that matters most in Kubernetes security. Every control should have an object, a reason, a positive test, a negative test, and a place where failures become visible.

---

**References**

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Security Context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Security Checklist](https://kubernetes.io/docs/concepts/security/security-checklist/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
