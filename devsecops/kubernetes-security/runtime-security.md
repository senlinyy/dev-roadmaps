---
id: article-devsecops-kubernetes-security-runtime-security
title: Runtime Security
description: Detect suspicious pod behavior after deployment and connect runtime signals back to Kubernetes context.
overview: Runtime security watches what containers actually do after they start. You will investigate devpolaris-orders signals such as unexpected shells, file writes, network calls, and privilege changes.
tags: ["runtime", "detection", "pods"]
order: 6
---

## Table of Contents

1. [The Control Works After You Name the Risk](#the-control-works-after-you-name-the-risk)
2. [The Orders Workload as the Anchor](#the-orders-workload-as-the-anchor)
3. [The First Useful Policy](#the-first-useful-policy)
4. [How to Prove the Rule Is Active](#how-to-prove-the-rule-is-active)
5. [A Realistic Failure Shape](#a-realistic-failure-shape)
6. [Common Misreadings](#common-misreadings)
7. [Failure Modes and Fix Directions](#failure-modes-and-fix-directions)
8. [Engineering Tradeoffs](#engineering-tradeoffs)
9. [Operational Review Checklist](#operational-review-checklist)

## The Control Works After You Name the Risk

Runtime security watches what containers do after they are admitted and scheduled. Build scanning and admission checks are important, but they cannot prove what a process will do tomorrow. The devpolaris-orders API needs runtime signals for unexpected shells, sensitive file reads, outbound connections, and privilege changes.

The running example stays inside the devpolaris-orders namespace. That matters because security controls become easier to review when they are attached to a real service, a real namespace, and a real operational question. You are not trying to make Kubernetes abstractly secure. You are trying to keep one orders API from receiving or sending traffic, data, or behavior it does not need.

The first decision is scope. A control that is too wide blocks normal platform work. A control that is too narrow only looks good in a diagram. The useful middle is a rule that protects the service and still gives operators enough evidence to debug.

## The Orders Workload as the Anchor

The deployment below is the shared anchor for this article. It gives the API a stable label, a service account, and a normal HTTP port. Later checks refer back to these labels because Kubernetes policy objects usually select pods by labels rather than by deployment names.

Labels are important because they are the join keys of Kubernetes operations. A policy that selects app=orders will not protect a pod labeled app=devpolaris-orders-api. When a control seems ignored, selectors are one of the first things to inspect.

Here is the small workload the team is protecting.

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
        tier: api
    spec:
      serviceAccountName: orders-api
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-08.1
          ports:
            - containerPort: 8080
```

## The First Useful Policy

A first useful policy should be small enough to explain in a review. It should name the selected pods, the direction it controls, and the allowed peer or condition. If the rule cannot be explained as one or two sentences, split it or add a table to the pull request.

For this topic, the policy is deliberately practical rather than complete. It shows the shape you would put in Git for devpolaris-orders and the fields you would inspect when it fails.

The exact API object depends on the control, but the habit is the same: select the workload, state the allowed behavior, then test both allowed and denied paths.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: runtime-security-notes
  namespace: devpolaris-orders
data:
  watched-behaviors: |
    unexpected shell process
    write below /etc
    outbound connection to unknown host
    Kubernetes service account token read
  response-owner: platform-runtime-security
```

## How to Prove the Rule Is Active

Do not trust that a YAML file in a repository is active in the cluster. The diagnostic path starts by asking the API server what object exists, then checking events, selected pods, or logs depending on the control. Kubernetes is declarative, so the live object is the evidence that matters.

The following commands are intentionally small. They show the kind of proof a reviewer or on-call engineer can collect without opening a dashboard. Save the longer investigation for runbooks and challenges.

Use the command output to check selectors, status, and the namespace.

```bash
$ kubectl logs -n runtime-security deploy/runtime-sensor --since=10m | grep devpolaris-orders
2026-05-08T20:11:04Z rule=Unexpected shell in container namespace=devpolaris-orders pod=devpolaris-orders-api-6dbb7 user=10001 proc=sh

$ kubectl get pod -n devpolaris-orders devpolaris-orders-api-6dbb7 -o jsonpath='{.spec.serviceAccountName}{"\n"}'
orders-api
```

## A Realistic Failure Shape

Failure output teaches faster than a perfect manifest because it shows what a learner will actually see. The important move is to connect the symptom to the Kubernetes object that made the decision. A timeout, Forbidden error, admission denial, or suspicious runtime event each points to a different layer.

For devpolaris-orders, the first failure is usually not mysterious if you preserve the namespace, pod labels, and timestamp in the evidence. Those fields let you compare the failure to the control that should have allowed or denied the behavior.

The snapshot below is the kind of artifact you would paste into an incident note.

```text
2026-05-08T20:11:04Z priority=warning rule="Unexpected shell in container"
namespace=devpolaris-orders pod=devpolaris-orders-api-6dbb7 container=api
process=sh parent=node user=10001 image=ghcr.io/devpolaris/orders-api@sha256:ab12...
fix direction: preserve the pod, collect process and network evidence, compare the image digest to the release record
```

## Common Misreadings

One common misreading is to treat the control as a replacement for every other layer. Kubernetes controls are layered. RBAC does not replace admission. Admission does not replace runtime detection. NetworkPolicy does not replace authentication between services. Secrets do not replace an external secret manager or careful rotation.

Another misreading is to assume a quiet cluster means a safe cluster. A control may be missing, unsupported by the cluster plugin, scoped to the wrong namespace, or bypassed by a privileged workload. The diagnostic path has to prove the control is both configured and effective.

The useful question is always concrete: which pod, which namespace, which API object, which caller, which traffic direction, or which event? Vague security reviews miss mistakes that a small selector check would catch.

## Failure Modes and Fix Directions

If the control blocks normal work, first confirm the selector and namespace. A rule in the wrong namespace is invisible to the workload. A selector that matches zero pods creates a false sense of safety. A selector that matches too many pods can break unrelated services.

If the control allows too much, reduce the scope before adding a new tool. Tighten the service account, peer selector, mounted secret, admission expression, or runtime rule. Smaller controls are easier to test and easier to explain during an incident.

If a release is urgent, document the temporary exception next to the resource that owns it. Name the owner, the reason, and the removal condition. Temporary exceptions without owners become permanent configuration.

## Engineering Tradeoffs

The tradeoff is between safety, operability, and maintenance. A strict rule catches mistakes early, but it can block releases when the service changes. A loose rule reduces interruptions, but it leaves more behavior unexplained during an incident. The right answer usually changes as the service matures.

For devpolaris-orders, start with the smallest rule that protects the clear risk. Add tests that prove the expected allow and deny paths. When the team needs an exception, make it visible rather than hiding it inside a broad policy.

This is also where platform and application teams need a shared language. The platform team owns cluster-wide mechanisms. The app team owns service intent. The best policy review joins those two views instead of making one team guess what the other meant.

## Operational Review Checklist

Review begins with the live object, not the file name. Check metadata.namespace, selectors, referenced service accounts or labels, and the fields that define the allowed behavior. Then check one positive path and one negative path so the policy is not only syntactically valid but operationally meaningful.

For devpolaris-orders, a useful review record includes the deployment label, the policy object name, the command used to prove it, and the failure that should happen when the rule denies behavior. That record makes later troubleshooting faster.

End the review by asking what signal will appear if the rule stops working. If nobody knows where the denial, timeout, warning, or alert appears, the team does not yet operate the control.

### Diagnostic Worksheet

Use this worksheet when a pull request or incident touches runtime security for devpolaris-orders. It keeps the review tied to evidence from the cluster instead of opinions about whether a setting looks strict enough.

| Check | Command or evidence | Expected result |
|-------|---------------------|-----------------|
| Signal includes namespace and pod | `kubectl logs -n runtime-security deploy/runtime-sensor --since=10m` | namespace=devpolaris-orders pod=... |
| Image digest matches release record | `kubectl get pod -n devpolaris-orders POD -o jsonpath={.status.containerStatuses[0].imageID}` | sha256 digest |
| Service account is low privilege | `kubectl auth can-i list pods --as=system:serviceaccount:devpolaris-orders:orders-api -n devpolaris-orders` | no |
| Container logs have request context | `kubectl logs -n devpolaris-orders deploy/devpolaris-orders-api --since=10m` | request id or trace id |
| Response action preserves evidence | `kubectl cordon NODE or isolate pod according to runbook` | evidence captured first |

The point of the worksheet is not to make every review long. It gives the reviewer a repeatable path when the change is risky, when the service has recently failed, or when a broad exception is being requested. A small amount of evidence prevents a lot of guessing.

### Failure Matrix

| Symptom | Likely place to inspect | Fix direction |
|---------|-------------------------|---------------|
| The release fails before a pod changes | API server response, server dry run, or authorization check | Read the exact denied verb, field, or policy message before widening access. |
| The pod starts but the app fails | Container logs, pod events, mounted files, selected labels | Fix the workload assumption or the narrow selector that does not match reality. |
| The control appears inactive | Namespace, selector, controller support, live object | Prove the object selects the pod and that the cluster component enforces it. |
| An emergency exception was added | Git history, admission or RBAC object, incident ticket | Add an owner, a removal date, and the narrow replacement rule. |

Do not delete the pod as the first response to a runtime alert unless the risk requires immediate containment. Capture the image digest, process evidence, network evidence, and recent Kubernetes events first when the environment allows it.

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

Use this drill to turn runtime security from a file review into an operating habit. The scenario starts with unexpected shell alert in the devpolaris-orders namespace. The goal is to collect enough evidence to decide whether to fix the workload, fix the policy, or open a short exception.

1. Name the affected object: devpolaris-orders-api container.
2. Name the protecting artifact: runtime event, pod spec, and image digest.
3. Capture the namespace and labels before changing anything.
4. Run one command that proves the allowed path.
5. Run one command that proves the denied or detected path.
6. Write the smallest fix direction in the incident note.

A short incident note might look like this.

```text
Service: devpolaris-orders-api
Namespace: devpolaris-orders
Symptom: unexpected shell alert
Primary object: devpolaris-orders-api container
Security artifact: runtime event, pod spec, and image digest
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
| Policy object | Names the Kubernetes object that made or should make the decision | runtime event, pod spec, and image digest |
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

### Release Gate Record

A release gate record is a small piece of evidence attached to the release, not a separate policy document. It should be short enough that a developer will actually write it during a normal pull request. The record explains what changed, what was tested, and what failure would prove the control is working.

```text
Release: devpolaris-orders-api
Namespace: devpolaris-orders
Changed control: security manifest in this article
Allowed test: normal rollout or request still succeeds
Denied test: unsafe change fails, warns, or alerts
Rollback: restore previous manifest or remove the narrow exception
Owner: devpolaris platform and orders service team
```

This record is useful because it connects security work to the same release habits the team already uses. If a later incident asks why a rule exists, the answer is in the release history. If a later deployment fails, the team can compare the new failure to the denied test that was expected.

Keep the record factual. Avoid claims such as secure by default or production ready unless the evidence says exactly what was checked. The better sentence is specific: the orders-release identity cannot read orders-db-credentials, or the devpolaris-orders-api pod is rejected when it tries to run privileged.

### Runtime Triage Fields

- Pod name and namespace.
- Container name and image digest.
- Process name, parent process, and user ID.
- Destination host or file path if the alert includes one.
- Release record that introduced the running image.

---

**References**

- [Kubernetes Security Checklist](https://kubernetes.io/docs/concepts/security/security-checklist/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Kubernetes Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [CNCF Cloud Native Security Whitepaper](https://tag-security.cncf.io/community/resources/security-whitepaper/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
- [Falco Documentation](https://falco.org/docs/) - Use this as the canonical reference for the Kubernetes behavior described in this article.
