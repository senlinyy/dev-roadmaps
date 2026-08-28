---
title: "Drift and Perimeter Security"
description: "Learn how to compare desired, recorded, and live cloud state; reason about reachability and identity perimeters; investigate drift with plans and audit logs; and choose whether to revert, codify, or import changes."
overview: "Treat drift as a configuration-integrity problem and the perimeter as the set of paths by which actors, networks, and identities can reach assets. Learn why plans and audit logs answer different questions, how emergency and accidental changes diverge from IaC, how to review inbound, outbound, and identity paths, and how a controlled loop chooses the source of truth without unsafe automatic remediation."
tags: ["devsecops", "drift", "perimeter-security", "cloud-security"]
order: 3
id: article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
aliases:
  - drift-and-misconfiguration-detection
  - article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
  - devsecops/cloud-infrastructure-security/drift-and-misconfiguration-detection.md
  - network-exposure-review
  - article-devsecops-cloud-infrastructure-security-network-exposure-review
  - devsecops/cloud-infrastructure-security/network-exposure-review.md
  - devsecops/cloud-infrastructure-security/03-drift-and-perimeter.md
  - devsecops/cloud-infrastructure-security/03-drift-and-perimeter
  - cloud-infrastructure-security/03-drift-and-perimeter
---

## Table of Contents

1. [What Is the Difference Between Desired, Recorded, and Live State?](#what-is-the-difference-between-desired-recorded-and-live-state)
2. [Why Is Drift a Configuration-Integrity Problem?](#why-is-drift-a-configuration-integrity-problem)
3. [How Do Plans and Audit Logs Explain Different Parts of Drift?](#how-do-plans-and-audit-logs-explain-different-parts-of-drift)
4. [How Should You Model the Cloud Security Perimeter?](#how-should-you-model-the-cloud-security-perimeter)
5. [How Do You Decide Whether to Revert, Codify, or Import Drift?](#how-do-you-decide-whether-to-revert-codify-or-import-drift)
6. [Why Can Automatic Remediation Be Dangerous?](#why-can-automatic-remediation-be-dangerous)
7. [How Do You Review Reachability and Perimeter Change?](#how-do-you-review-reachability-and-perimeter-change)
8. [What Does a Complete Drift Control Loop Look Like?](#what-does-a-complete-drift-control-loop-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Infrastructure as Code introduces a desired-state model, but production has three relevant views:

```text
desired state  -> what reviewed code declares
recorded state -> what the IaC tool believes it manages
live state     -> what the cloud currently runs
```

**Drift** is a meaningful difference among those views. A security group may allow only application traffic in Git while the live cloud allows the entire Internet. State may still record the earlier private rule. The code review history looks safe, but runtime exposure is not.

Desired state answers what the organization intends. Recorded state connects configuration addresses to provider resource identities and attributes. Live state is operational reality. No single view can replace the others.

Drift can be simple value change, missing resource, extra unmanaged resource, replaced object, policy change, identity grant, route, encryption setting, or disabled logging. Some differences are operationally harmless; others create direct attack paths.

The comparison should identify exact resource, attribute, expected value, observed value, environment, owner, detection time, and confidence. “Production drift detected” is not enough for response.

Keep these questions in view as you work through the lesson:

1. **What Is the Difference Between Desired, Recorded, and Live State?**
2. **Why Is Drift a Configuration-Integrity Problem?**
3. **How Do Plans and Audit Logs Explain Different Parts of Drift?**
4. **How Should You Model the Cloud Security Perimeter?**
5. **How Do You Decide Whether to Revert, Codify, or Import Drift?**
6. **Why Can Automatic Remediation Be Dangerous?**
7. **How Do You Review Reachability and Perimeter Change?**
8. **What Does a Complete Drift Control Loop Look Like?**

## What Is the Difference Between Desired, Recorded, and Live State?
<!-- section-summary: Infrastructure integrity depends on comparing code's desired state, the IaC system's recorded state, and the cloud provider's live resources. -->

![Drift triangle compares Git configuration, IaC state, and live cloud while audit logs explain out-of-band events](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-triangle.png)

_Code expresses intention, state records management history, live cloud shows reality, and audit events help reconstruct the transition._

Drift is not always unauthorized. An incident responder may deliberately open access through a break-glass procedure. A cloud service may add a computed property. An operator may make an emergency repair. The difference still needs reconciliation because the next plan may remove it or the temporary exposure may become permanent.

The core question is not “Which view is automatically right?” It is “Which state should become authoritative now, and what evidence supports that decision?”

Recorded state can itself drift from reality because refresh has not run, access failed, or a backend was restored from an older version. Treat state as a security-sensitive operational database, not unquestionable truth. Protect its backend, locking, version history, encryption, and access logs.

Some live attributes are intentionally computed or maintained by the provider. Configuration can ignore selected changes, but every ignore rule removes a comparison signal. Document why the provider owns the field and review whether a security-relevant value is being hidden.

## Why Is Drift a Configuration-Integrity Problem?
<!-- section-summary: Drift means infrastructure reality changed outside or after the reviewed desired-state transition, weakening the guarantee that production matches approved code. -->

Configuration integrity is the property that important runtime settings match authorized intent. Drift breaks the chain from reviewed code to real cloud state.

Common causes include:

- Manual console or CLI changes.
- Emergency break-glass response.
- Another automation system modifying the same resource.
- Provider or managed-service behavior.
- Incomplete import or IaC ownership.
- A failed or partial apply.
- State loss or corruption.
- Compromised credentials.
- Deliberate unauthorized change.

Security drift includes public exposure, broader IAM, disabled encryption, weakened logging, new trust relationships, unapproved regions, deleted backups, or changed protection settings. Availability and cost drift can also carry security consequences if they remove redundancy or monitoring.

The problem is not merely that Git is untidy. Reviewers, scanners, and policy engines evaluated one state while production uses another. Incident responders may trust the wrong network map. The next apply may produce surprising destructive change because it tries to restore an outdated declaration.

Drift is also evidence of an alternate authority path. If an administrator can change production directly, IaC is not the only enforcement boundary. Determine whether that path is intended, who can use it, how access is approved, and whether changes are logged and reconciled.

Prevention is stronger than detection where practical. Restrict direct mutation, use workload identities for controlled apply, separate environments, require protected workflows, and use cloud policies that reject forbidden state. Detection remains necessary because emergency and provider-driven changes can still occur.

Not all drift is security drift. A harmless description field and a public database rule should not page responders equally. Classify affected property, exposure, authority, data, availability, and compliance consequence.

Prioritize drift that expands who can act or what can be reached. New public routes, wildcard trust, disabled logging, changed key policy, and removed deletion protection alter security boundaries. Shrinking a resource count may be operational drift without the same urgency, though lost redundancy can still affect resilience.

Drift detection needs ownership. The platform may detect the difference, but the service or resource owner determines intended behavior and impact. Route findings automatically and escalate unowned production resources as a governance gap.

## How Do Plans and Audit Logs Explain Different Parts of Drift?
<!-- section-summary: A refresh or plan shows how declared and live state differ, while audit logs identify the actor, API call, time, source, and outcome that changed reality. -->

A Terraform or OpenTofu refresh and plan can compare configuration, state, and provider observations. If live ingress changed, the plan may propose restoring the declared rule.

```text
live public ingress
  -> refresh reads provider
  -> plan compares desired private ingress
  -> proposed update removes public path
```

The plan is a useful drift detector because it expresses the semantic change the IaC system would make. It can show creates, updates, replacements, and deletes.

A plan is not a complete security monitor. It covers resources the configuration and state know about, under the identity and refresh behavior used. An unmanaged resource, hidden control-plane setting, another account, a deleted logging trail, or drift outside provider coverage may not appear. Plans are periodic unless continuously run.

Audit logs answer a different question: who called which cloud API, when, from which identity or source, with what parameters and result? They help distinguish an authorized emergency change, accidental console edit, automation conflict, or credential compromise.

```text
plan -> what differs and what reconciliation would do
audit log -> how the live change occurred
```

Case A may show a named responder using approved temporary access during an incident. Case B may show an administrator accidentally changing the wrong security group. Case C may show a service account calling an unexpected API from an unusual source. The same drift value requires different response.

Audit quality depends on identity quality. A shared administrator account makes attribution weak. Logs need durable actor identity, timestamps, resource identifiers, request and outcome, and integrity protection. Restrict who can disable, alter, or delete them and retain them beyond the likely discovery window.

Plan output can itself be sensitive, containing resource names, addresses, identity details, or values. Protect CI artifacts and logs while preserving the fields investigators need.

Cloud audit logs must cover every account, project, subscription, and region in scope. Centralize or replicate them into a security-controlled destination so compromise of one workload account cannot erase the only evidence. Monitor gaps, disabled trails, changed sinks, and retention reductions.

Data-plane logs may be optional or high volume, while control-plane logs usually record configuration changes. Decide which sensitive data reads or writes also require audit and control cost and privacy carefully. Drift investigation begins with control-plane events but an incident may need data-access evidence too.

Correlate IaC apply identity and run ID with audit events. Expected automation changes should appear under the controlled workload role. A matching resource update by a human administrator or another service account is evidence of an alternate path even if the final value matches code.

## How Should You Model the Cloud Security Perimeter?
<!-- section-summary: The perimeter is the set of network and identity paths by which an actor can reach a resource, including inbound, outbound, control-plane, and trusted-service relationships. -->

A cloud perimeter is not one firewall at the edge. It is a reachability boundary around assets.

```text
actor or workload
  -> network route and policy
  -> identity and authorization
  -> service endpoint
  -> protected resource or capability
```

Inbound paths include public IPs, load balancers, firewall rules, security groups, ingress gateways, private links, VPNs, peering, and service endpoints. Minimize the attack surface: expose only required protocols to required sources and terminate public traffic at intended controls.

Outbound access matters too. A compromised workload can exfiltrate data, download payloads, or call control services through egress. Define required destinations, use proxies or private endpoints where appropriate, and monitor unexpected outbound behavior.

Identity is part of the perimeter. A private API with a wildcard IAM policy may be widely reachable through credentials. A public endpoint with strong authentication still has a network attack surface. Evaluate both path and capability.

Control-plane and data-plane paths differ. An application may read data through the service endpoint. An administrator or CI role can change the database, firewall, keys, or logging through provider APIs. Protect both.

Trusted services and third parties create paths: CI runners, monitoring, backups, support access, webhooks, managed services, cross-account roles, and federated identities. Record why each relationship exists and who owns it.

The perimeter should be derived from actual routes, policies, DNS, service exposure, and identity grants, not only architectural diagrams. Drift can create a path that documentation never shows.

Think in terms of effective reachability rather than individual rules. A private subnet may reach the Internet through NAT. A public load balancer can forward to a private service. Peering and transit networks connect address spaces. A resource policy can grant cross-account access without changing a firewall. Graph the combined path.

Minimize attack surface by reducing listeners, protocols, source ranges, identities, and administrative endpoints. Prefer application-specific access through authenticated services over direct database or host access. Remove old test paths and vendor access when their use ends.

Egress and identity can combine. A workload with permission to read secrets and unrestricted outbound network can exfiltrate them. A workload with no direct secret permission may call an overly trusted metadata or internal service. Review capability paths, not isolated control checklists.

## How Do You Decide Whether to Revert, Codify, or Import Drift?
<!-- section-summary: Drift response chooses which representation becomes truth: restore reality to reviewed code, update code to an authorized live change, or bring an unmanaged existing resource under IaC ownership. -->

A drift alert begins an investigation. After identifying the change and actor, choose among three broad actions.

**Revert reality to code** when the live change is unauthorized, accidental, malicious, expired, or no longer required. Apply the reviewed private state or make an emergency correction, verify the path closes, and investigate access.

**Codify the live change** when the runtime change was authorized and should remain. Update IaC through review, scanning, policy, plan, and controlled apply so desired state catches up with reality. Preserve the original emergency event and reconciliation.

**Import existing infrastructure** when the resource legitimately exists but is not managed in recorded state. Write the intended configuration, import the provider resource into state, review the resulting plan, and verify that future changes are controlled.

```text
revert -> code was right; reality should change
codify -> live change is desired; code should change
import -> legitimate reality lacks IaC ownership
```

This is a truth decision. Automatically preferring Git can destroy an authorized emergency fix. Automatically accepting live state can normalize compromise. Evidence from incident context, audit logs, ownership, business need, and security policy determines the result.

After any choice, verify code, state, and live cloud converge and that the perimeter matches intended reachability. Close temporary access and exceptions.

Codifying a live change does not mean copying raw console state into code without review. Translate the operational need into the safest durable design, run scanners and policy, and evaluate whether a narrower route or identity can replace the emergency change.

Import requires careful planning. Writing incomplete configuration and importing a production resource can cause the next plan to remove properties that were previously unmanaged. Inventory the resource, protect state, review the proposed reconciliation, and avoid automatic apply until the diff is understood.

Rollback requires IaC reasoning. Infrastructure change may be destructive or irreversible: data deletion, address replacement, key rotation, or migration. “Apply the previous commit” may not reconstruct destroyed state. Backups, restore tests, state versions, and service-specific recovery are part of the decision.

## Why Can Automatic Remediation Be Dangerous?
<!-- section-summary: Automatic reconciliation can restore safe state quickly, but without context it can remove incident containment, destroy data, fight another controller, or repeatedly reapply a compromised declaration. -->

Auto-remediation seems simple:

```text
drift detected -> immediately apply desired state
```

That can close an accidental public firewall rule quickly. It can also remove an emergency isolation rule responders added, revert a legitimate service recovery, replace a stateful resource, or enter a loop with another controller.

The desired declaration itself may be compromised. Blind reconciliation then restores the attacker's state whenever an operator repairs production manually. Protect source and policy before treating them as automatic truth.

Use risk tiers. Low-impact, well-understood, reversible properties may be safe for automatic correction. Identity expansion, network exposure, encryption removal, deletion, and stateful replacement often need approval or a tightly designed emergency control.

Guardrails for automated repair include exact scope, plan preview, policy evaluation, current-state preconditions, change limits, rate control, conflict detection, owner notification, rollback method, and evidence. Stop after repeated failure rather than thrashing production.

Prevention can reject dangerous API calls before drift occurs. Cloud organization policy, service control policy, resource policy, IAM boundaries, or admission rules can forbid public storage or wildcard production administration. Prevention and detection complement each other because not every undesirable change can be encoded without false positives.

The control loop should improve the system. Repeated manual drift may reveal missing IaC functionality, an unusable emergency path, excessive privileges, poor module design, or automation conflict. Fix the cause instead of closing the same alert repeatedly.

Prevention should not create a second unreviewed policy truth. Version and test organization constraints, IAM boundaries, and cloud policy. Record denials so developers know which rule stopped the request. Emergency override of prevention deserves the same narrow identity, time, and evidence as IaC break-glass.

When auto-remediation is appropriate, verify outcome from live state rather than assuming the apply succeeded. Re-run reachability or policy checks and ensure the actor that caused drift no longer has an unmanaged path to restore it.

## How Do You Review Reachability and Perimeter Change?
<!-- section-summary: Perimeter review traces exact actors through network and identity paths to sensitive capabilities, then evaluates exposure, necessity, ownership, monitoring, and recovery. -->

For every protected asset, ask:

1. Which users, workloads, accounts, networks, and services can initiate a path?
2. Which routes, gateways, firewall rules, endpoints, and peers carry it?
3. Which authentication and authorization are required?
4. Which data or control capability becomes reachable?
5. Is the path necessary in this environment?
6. Who owns it, and how is use logged?
7. Which change can broaden it, and who can make that change?
8. How is the path removed during containment or decommissioning?

Review changes semantically. Adding `0.0.0.0/0` to database ingress is not just a string diff; it creates an Internet path to a stateful data service. Adding a cross-account role can create a control-plane path even when no network rule changes.

![Incident exposure path shows an emergency console change opening database ingress and the safer intended application-only path](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/incident-exposure-path.png)

_Perimeter risk is the complete reachability path, including identity and control-plane authority._

Consider a responder who temporarily opens database access during an incident. Audit logs show the named break-glass identity and ticket. The path may be justified for thirty minutes but unsafe as permanent state. The response can preserve the incident evidence, close the public rule, codify a safer diagnostic path, and reduce future need for console access.

Monitor both exposure and attempted use. Connection logs, flow logs, identity events, denied requests, and control-plane changes help distinguish dormant misconfiguration from active probing or compromise.

Review perimeter exceptions on expiry. A temporary vendor IP, migration peer, or public test endpoint often survives the project that created it. Ownership and time bounds convert cleanup from memory into policy.

Review the perimeter from both asset and actor directions. Starting from a database, enumerate every path that reaches it. Starting from a CI role, compromised workload, vendor network, or administrator group, enumerate every protected capability it can reach. The two searches expose overlooked shared routes and privilege chains.

Test important denials. From an unauthorized network and identity, attempt the connection or API call and confirm it fails. Configuration review says what should be blocked; a controlled test shows the effective perimeter enforces it.

## What Does a Complete Drift Control Loop Look Like?
<!-- section-summary: The complete loop detects divergence, validates security impact, reconstructs the actor and reason, chooses the source of truth, reconciles safely, verifies reality, and removes the alternate path that caused drift. -->

A complete loop is:

```text
desired code + recorded state + live cloud
                 |
                 v
          detect meaningful difference
                 |
                 v
      classify asset, reachability, identity, data, and impact
                 |
                 v
       query audit events and incident context
                 |
                 v
            revert / codify / import
                 |
                 v
       review plan and execute controlled change
                 |
                 v
       verify live state and perimeter
                 |
                 v
       improve permissions, policy, and process
```

![Drift review loop moves from detection through audit investigation, truth decision, verification, and process improvement](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-review-loop.png)

_Reconciliation is not complete until intended code, managed state, live cloud, and access evidence agree._

The strongest invariant is that ordinary production changes come through one controlled, identity-bound IaC path. Direct authority is narrow and temporary. Cloud audit events connect every apply or exception to the caller and change record.

Test the loop. Make a safe controlled change outside IaC in a test environment, confirm detection, retrieve the actor event, exercise revert or import, and verify convergence. Simulate missing audit data and auto-remediation conflict so failure modes are known.

Measure time to detect, identify actor, classify impact, choose truth, reconcile, and verify. Long detection suggests polling or coverage gaps. Long attribution suggests weak identity or logs. Repeated reconciliation suggests prevention, permissions, or workflow design needs improvement.

Preserve the full event chain: drift finding, compared states, audit event, owner decision, plan, approval, apply identity, verification, and process change. That chain proves more than a final green plan because it explains why reality diverged and how authority was corrected.

The core mental model is:

```text
drift asks: does reality match authorized intent?
perimeter asks: who or what can reach this asset and capability?
audit asks: who changed reality and how?
response asks: which state should become truth now?
```

## Check Your Answers

:::expand[What Is the Difference Between Desired, Recorded, and Live State?]{kind="recap"}
Compare reviewed configuration, IaC state, and actual cloud resources because each view answers a different part of infrastructure truth.
:::

:::expand[Why Is Drift a Configuration-Integrity Problem?]{kind="recap"}
Drift breaks the evidence that production matches reviewed intent and reveals an alternate path capable of changing cloud state.
:::

:::expand[How Do Plans and Audit Logs Explain Different Parts of Drift?]{kind="recap"}
Plans show the semantic difference and proposed reconciliation; audit logs show the identity, API event, time, and outcome behind the change.
:::

:::expand[How Should You Model the Cloud Security Perimeter?]{kind="recap"}
Model every network, identity, inbound, outbound, control-plane, and trusted-service path by which an actor can reach a capability.
:::

:::expand[How Do You Decide Whether to Revert, Codify, or Import Drift?]{kind="recap"}
Use evidence to decide whether live reality returns to code, code adopts an authorized live change, or a legitimate resource enters IaC state.
:::

:::expand[Why Can Automatic Remediation Be Dangerous?]{kind="recap"}
Automate only bounded reversible corrections because blind reconciliation can remove containment, destroy state, fight controllers, or restore compromised intent.
:::

:::expand[How Do You Review Reachability and Perimeter Change?]{kind="recap"}
Trace actors through routes and authorization to protected assets, then evaluate necessity, exposure, ownership, monitoring, expiry, and removal.
:::

:::expand[What Does a Complete Drift Control Loop Look Like?]{kind="recap"}
Detect, classify, investigate, choose truth, reconcile, verify, and improve the authority and process that allowed divergence.
:::

## References

- [Terraform resource drift](https://developer.hashicorp.com/terraform/tutorials/state/resource-drift) - Demonstrates refresh, plan, and reconciliation of live changes.
- [OpenTofu planning](https://opentofu.org/docs/cli/run/) - Describes plan and apply behavior for desired and current state.
- [AWS CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html) - Describes control-plane audit events and identity context.
- [Google Cloud audit logs](https://cloud.google.com/logging/docs/audit) - Describes administrative, data-access, and system-event audit records.
- [Azure activity log](https://learn.microsoft.com/en-us/azure/azure-monitor/platform/activity-log) - Describes subscription-level control-plane events.
