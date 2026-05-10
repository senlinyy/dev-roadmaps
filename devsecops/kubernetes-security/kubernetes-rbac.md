---
id: article-devsecops-kubernetes-security-kubernetes-rbac
title: Kubernetes RBAC
description: Grant Kubernetes users, groups, and service accounts the smallest API permissions they need for safe operations.
overview: Kubernetes RBAC decides which authenticated identities can perform API actions. You will follow devpolaris-orders as the team separates human access, release automation, and workload identity.
tags: ["rbac", "kubernetes", "access"]
order: 1
---

## Table of Contents

1. [API Access Starts With an Identity](#api-access-starts-with-an-identity)
2. [The Running Namespace](#the-running-namespace)
3. [Roles Describe Allowed API Sentences](#roles-describe-allowed-api-sentences)
4. [Bindings Attach Roles to Real Callers](#bindings-attach-roles-to-real-callers)
5. [Cluster Scope Changes the Risk](#cluster-scope-changes-the-risk)
6. [Testing With auth can-i](#testing-with-auth-cani)
7. [Reading Forbidden Errors](#reading-forbidden-errors)
8. [Failure Modes and Fix Directions](#failure-modes-and-fix-directions)
9. [Reviewing RBAC Pull Requests](#reviewing-rbac-pull-requests)

## API Access Starts With an Identity

Every Kubernetes request has to answer two questions before work happens. First, authentication proves who sent the request. Second, authorization decides whether that identity may perform the requested API action. RBAC, short for role-based access control, is the built-in Kubernetes authorization model most teams use for this decision.

In the devpolaris-orders namespace, the same cluster supports a release job, application pods, platform operators, and developers who need read-only visibility. Those groups should not share one wide credential. RBAC lets you describe each job as a small set of verbs on specific resources.

Think of RBAC like package permissions in a private npm organization. A token that publishes one package should not manage every package, billing setting, and team membership. Kubernetes uses the same basic idea, but the actions are API verbs such as get, list, watch, patch, update, create, and delete.

## The Running Namespace

The examples use a namespace named devpolaris-orders. The deployment is small on purpose: one API deployment, one service account for the running app, one service account for release automation, and one read-only developer group. This is enough surface area to show the permission decisions that matter in real clusters.

A namespace is a Kubernetes grouping boundary for namespaced objects. It is not a hard security wall by itself, but it is where most application RBAC starts. A Role lives inside one namespace, and a RoleBinding grants that Role to a subject inside that namespace.

The first artifact is the namespace and the runtime service account. Notice that the application service account is not automatically given permission to read Kubernetes objects. Naming the identity is separate from granting it authority.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: devpolaris-orders
  labels:
    app.kubernetes.io/part-of: devpolaris
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: devpolaris-orders
automountServiceAccountToken: false
```

## Roles Describe Allowed API Sentences

An RBAC rule is easiest to review as a sentence: this subject can perform this verb on this resource in this scope. The Role below supports a release job that patches deployments and reads rollout evidence. It does not read Secrets, delete namespaces, or create new RBAC objects.

The apiGroups field matters because Kubernetes resources are grouped by API family. Pods and services live in the core API group, written as an empty string. Deployments live in the apps API group. If the API group is wrong, the rule may look reasonable but still fail.

Patch and update are both write verbs, but they are not identical. Many release tools patch a Deployment template to trigger a rollout or update the image field. If the release job only has get and list, the failure will appear when the tool reaches the deployment step.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-release
  namespace: devpolaris-orders
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: orders-release-deployer
  namespace: devpolaris-orders
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
  - apiGroups: [""]
    resources: ["pods", "events"]
    verbs: ["get", "list", "watch"]
```

## Bindings Attach Roles to Real Callers

A Role by itself grants nothing. A RoleBinding connects the Role to a subject, such as a service account, user, or group. This split is useful because you can review the permission set separately from the people or automation that receive it.

The binding below gives the release service account only the deployment permissions from the previous Role. It is scoped to devpolaris-orders because the RoleBinding has a namespace. A service account from another namespace would need to be named with its own namespace, which helps reviewers notice cross-namespace grants.

For human access, the team can bind the built-in view ClusterRole into the namespace. That pattern reuses a cluster-defined read-only role without turning it into cluster-wide access.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-release-deployer
  namespace: devpolaris-orders
subjects:
  - kind: ServiceAccount
    name: orders-release
    namespace: devpolaris-orders
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: orders-release-deployer
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orders-readonly
  namespace: devpolaris-orders
subjects:
  - kind: Group
    name: devpolaris-orders-developers
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
```

## Cluster Scope Changes the Risk

A ClusterRole is not automatically dangerous. The risk depends on how it is bound. A RoleBinding can bind a ClusterRole into one namespace, while a ClusterRoleBinding grants across the cluster. The second option deserves careful review because a small looking change can affect every namespace.

ClusterRoleBindings are normal for cluster operators, controllers, monitoring agents, and admission systems that inspect many namespaces. They are usually the wrong shape for one application release job. If devpolaris-orders automation only deploys one service, namespace-scoped RBAC should be the starting point.

A helpful review question is whether the task needs cluster inventory or namespace work. Reading all nodes is cluster inventory. Patching one deployment is namespace work. That distinction keeps everyday app automation away from cluster administrator powers.

## Testing With auth can-i

RBAC errors are often easier to diagnose than they first appear because Kubernetes tells you the subject, verb, resource, API group, and namespace. The command kubectl auth can-i asks the API server to make the same authorization decision without changing any workload.

Run the positive and negative checks together. A positive check proves the release can do its job. A negative check proves the role did not grow past the job. Both matter during review.

The following output gives a compact test plan for the release identity.

```bash
$ kubectl auth can-i patch deployments.apps   --as=system:serviceaccount:devpolaris-orders:orders-release   -n devpolaris-orders
yes

$ kubectl auth can-i get secrets   --as=system:serviceaccount:devpolaris-orders:orders-release   -n devpolaris-orders
no

$ kubectl auth can-i create clusterrolebindings.rbac.authorization.k8s.io   --as=system:serviceaccount:devpolaris-orders:orders-release
no
```

## Reading Forbidden Errors

When RBAC blocks a release, the error is a structured clue rather than a vague denial. The example below says the service account tried to patch deployments in the apps API group inside devpolaris-orders. If the intended job is deployment, the missing permission is probably patch on deployments.apps in that namespace.

Avoid fixing this by adding cluster-admin. First compare the error to the Role. Check the API group, resource name, verb, and namespace. A typo in apps versus the core group creates the same Forbidden shape as a missing rule.

A realistic failure looks like this in a release log.

```text
2026-05-08T18:42:11Z release=orders-api target=prod
kubectl rollout restart deployment/devpolaris-orders-api -n devpolaris-orders
Error from server (Forbidden): deployments.apps "devpolaris-orders-api" is forbidden:
User "system:serviceaccount:devpolaris-orders:orders-release" cannot patch resource "deployments"
in API group "apps" in the namespace "devpolaris-orders"
```

## Failure Modes and Fix Directions

The most common RBAC failure is an identity that can read but cannot write. The fix is not a larger role name. Add the exact missing verb and resource if the operation is valid for that identity. For rollout restart, that usually means patch on deployments.apps.

The second failure is a binding in the wrong namespace. A RoleBinding in devpolaris-orders does not grant permissions in devpolaris-payments. Inspect metadata.namespace on both the Role and RoleBinding before changing rules.

The third failure is a broad emergency grant that stays forever. If someone temporarily grants cluster-admin during an incident, create a removal task with an owner and a short deadline. Then replace it with a narrower Role after you know the exact API action that was missing.

## Reviewing RBAC Pull Requests

A good RBAC review translates YAML into work. Instead of asking whether orders-release-deployer sounds safe, ask which API calls the release job will make. The name helps humans, but the rules decide reality.

Use a small permission matrix in the pull request description. It gives reviewers the same information they would get from several can-i checks, but in task language. It also becomes a future debugging record when a release tool changes behavior.

For devpolaris-orders, the healthy shape has separate identities for app runtime, release automation, developer read-only access, and platform operations. Sharing one identity across these jobs makes audit logs harder to read and incident response slower.

### Diagnostic Worksheet

Use this worksheet when a pull request or incident touches RBAC for devpolaris-orders. It keeps the review tied to evidence from the cluster instead of opinions about whether a setting looks strict enough.

| Check | Command or evidence | Expected result |
|-------|---------------------|-----------------|
| Release can patch Deployment | `kubectl auth can-i patch deployments.apps --as=system:serviceaccount:devpolaris-orders:orders-release -n devpolaris-orders` | yes |
| Release cannot read Secrets | `kubectl auth can-i get secrets --as=system:serviceaccount:devpolaris-orders:orders-release -n devpolaris-orders` | no |
| Runtime pod has no token | `kubectl get deploy devpolaris-orders-api -n devpolaris-orders -o jsonpath={.spec.template.spec.automountServiceAccountToken}` | false |
| Developers can inspect Pods | `kubectl auth can-i list pods --as-group=devpolaris-orders-developers -n devpolaris-orders` | yes |
| Developers cannot edit Deployments | `kubectl auth can-i patch deployments.apps --as-group=devpolaris-orders-developers -n devpolaris-orders` | no |

The point of the worksheet is not to make every review long. It gives the reviewer a repeatable path when the change is risky, when the service has recently failed, or when a broad exception is being requested. A small amount of evidence prevents a lot of guessing.

### Failure Matrix

| Symptom | Likely place to inspect | Fix direction |
|---------|-------------------------|---------------|
| The release fails before a pod changes | API server response, server dry run, or authorization check | Read the exact denied verb, field, or policy message before widening access. |
| The pod starts but the app fails | Container logs, pod events, mounted files, selected labels | Fix the workload assumption or the narrow selector that does not match reality. |
| The control appears inactive | Namespace, selector, controller support, live object | Prove the object selects the pod and that the cluster component enforces it. |
| An emergency exception was added | Git history, admission or RBAC object, incident ticket | Add an owner, a removal date, and the narrow replacement rule. |

A ClusterRoleBinding to cluster-admin fixes every Forbidden error, but it also removes the evidence that tells you which permission was actually missing. Replace broad emergency grants with a Role that names the exact verb and resource from the Forbidden message.

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

Use this drill to turn RBAC from a file review into an operating habit. The scenario starts with Forbidden deployment patch in the devpolaris-orders namespace. The goal is to collect enough evidence to decide whether to fix the workload, fix the policy, or open a short exception.

1. Name the affected object: orders-release service account.
2. Name the protecting artifact: Role and RoleBinding.
3. Capture the namespace and labels before changing anything.
4. Run one command that proves the allowed path.
5. Run one command that proves the denied or detected path.
6. Write the smallest fix direction in the incident note.

A short incident note might look like this.

```text
Service: devpolaris-orders-api
Namespace: devpolaris-orders
Symptom: Forbidden deployment patch
Primary object: orders-release service account
Security artifact: Role and RoleBinding
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
| Policy object | Names the Kubernetes object that made or should make the decision | Role and RoleBinding |
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

- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Authorization Overview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Security Checklist](https://kubernetes.io/docs/concepts/security/security-checklist/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
