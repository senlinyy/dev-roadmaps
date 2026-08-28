---
title: "Finding Triage and Dismissal Evidence"
description: "Learn how to validate scanner findings, assess contextual risk, choose precise dispositions, preserve dismissal evidence, and verify closure."
overview: "Follow a security finding from raw detector output to a defensible decision. Separate severity, risk, and priority; evaluate reachability, exposure, exploitability, impact, and compensating controls; assign remediation and risk owners; distinguish fixed, mitigated, false-positive, duplicate, test, revoked, and accepted-risk outcomes; and preserve evidence that can be checked and reopened when assumptions change."
tags: ["devsecops", "triage", "risk", "evidence"]
order: 3
id: article-devsecops-application-security-testing-finding-triage-dismissal-evidence
---

## Table of Contents

1. [Why Is a Security Finding Not Yet a Vulnerability Decision?](#why-is-a-security-finding-not-yet-a-vulnerability-decision)
2. [How Do You Validate What the Detector Actually Observed?](#how-do-you-validate-what-the-detector-actually-observed)
3. [How Does Context Turn Severity into Risk?](#how-does-context-turn-severity-into-risk)
4. [How Do Risk, Ownership, and Deadlines Create Priority?](#how-do-risk-ownership-and-deadlines-create-priority)
5. [What Do the Main Finding Dispositions Actually Mean?](#what-do-the-main-finding-dispositions-actually-mean)
6. [What Evidence Makes a Dismissal Defensible?](#what-evidence-makes-a-dismissal-defensible)
7. [How Do You Verify Closure and Reopen Changed Assumptions?](#how-do-you-verify-closure-and-reopen-changed-assumptions)
8. [How Does Triage Improve the Wider Security System?](#how-does-triage-improve-the-wider-security-system)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A scanner does not deliver an organizational verdict. Its output is closer to this statement:

```text
I observed evidence that may indicate a security problem.
```

Engineering must turn that observation into a decision:

```text
What happened?
    |
    v
Is the technical claim real?
    |
    v
Can an attacker reach it, and what could they gain?
    |
    v
How urgent is this instance?
    |
    v
Who must act or accept the residual risk?
    |
    v
Fix, mitigate, accept, or dismiss?
    |
    v
What evidence proves the result?
```

That transformation is **triage**. A finding is evidence that requires a decision; it is not the decision itself.

Triage has to exist because security tools observe different fragments of reality. Code scanning may report thirty-seven paths, a dependency scanner eighty-two vulnerable packages, secret scanning four possible credentials, an infrastructure scanner twenty-one configurations, and DAST eighteen behaviors. Treating all 162 outputs as equally urgent would ignore what they cover and whether they are real in this system.

Keep these questions in view as you work through the lesson:

1. **Why Is a Security Finding Not Yet a Vulnerability Decision?**
2. **How Do You Validate What the Detector Actually Observed?**
3. **How Does Context Turn Severity into Risk?**
4. **How Do Risk, Ownership, and Deadlines Create Priority?**
5. **What Do the Main Finding Dispositions Actually Mean?**
6. **What Evidence Makes a Dismissal Defensible?**
7. **How Do You Verify Closure and Reopen Changed Assumptions?**
8. **How Does Triage Improve the Wider Security System?**

## Why Is a Security Finding Not Yet a Vulnerability Decision?
<!-- section-summary: A detector reports evidence that may indicate a problem; triage establishes what is real, how it matters here, and what accountable action follows. -->

Compare two nominally high findings. The first is unauthenticated remote command execution on an Internet-facing production API with a working exploit and access to customer data. The second is potential cross-site scripting in an undeployed example fixture where the scanner misunderstood escaping. The labels may look similar; the actual risk and required action are not.

The difference exists because scanner knowledge is not organizational context. A tool may recognize a dangerous API, known vulnerable version, credential pattern, or suspicious HTTP response. It usually cannot fully answer whether the affected code is deployed, which users can reach it, what data or authority surrounds it, whether the function runs, what compensating controls exist, and what compromise means to the business.

A useful lifecycle makes each reasoning step visible:

```text
detector
   |
   v
raw finding
   |
   v
technical validation
   |
   v
environment and business context
   |
   v
risk and priority
   |
   v
disposition and ownership
   |
   v
evidence and verification
   |
   v
closed or monitored state
```

The dangerous shortcut is `finding -> close`. It removes the reasoning and allows a green dashboard to hide unresolved vulnerability, failed authentication, missing coverage, or an invalid credential still in use.

Triage should be proportional. A clear false match in a known fixture may take minutes. A possible authorization bypass in a payment service may require reproduction, multiple teams, and risk-owner approval. A structured first pass lets the team move simple findings quickly while spending deeper attention where uncertainty and impact justify it.

The output of triage is not always a fix. It may be a verified false positive, a root-cause duplicate, a mitigation, a revoked credential, or a time-bounded accepted risk. The important property is that the state name matches reality and that someone else can reconstruct why the decision was reasonable.

## How Do You Validate What the Detector Actually Observed?
<!-- section-summary: The first pass replaces a broad scanner label with a precise claim about the object, version, path, stimulus, identity, and evidence that can be reproduced. -->

Do not begin with “Is SQL injection critical?” Begin with what the detector actually saw. For a SAST result, identify the source, transformations, sink, file and line, source revision, rule or query, and reported path. A useful claim might be:

```text
HTTP parameter
      |
      v
parseRequest()
      |
      v
buildFilter()
      |
      v
executeSQL()
```

Now an engineer can inspect whether the parameter is attacker-controlled, whether validation changes its meaning, whether the path is reachable, and whether the final API interprets the value as SQL.

The evidence differs by detector:

- For DAST, preserve the target version, request, identity, role, state, response, and reproduction steps.
- For a dependency alert, identify the package and version, direct or transitive path, advisory, affected function or configuration, and released artifacts that contain it.
- For secret scanning, identify the credential type, location and history, whether it is genuine and active, and the authority it grants.
- For infrastructure scanning, identify the exact resource or plan, policy rule, configuration, environment, and whether deployed state matches the analyzed input.

The goal is to turn a label into a technical proposition that can be tested.

Suppose a detector reports potential command injection. Several realities can produce the same label:

```text
A: untrusted HTTP input -> shell command
B: fixed internal string -> shell command
C: untrusted input -> strong allowlist -> shell command
D: analyzer modeled the path incorrectly
```

Reality A is a vulnerability. B uses a dangerous API but lacks attacker influence in this path. C may be sufficiently protected, although the barrier must be verified. D is a false positive. Triage distinguishes them before prioritization.

A finding and a vulnerability are related but not identical. The finding is the detector's recorded claim. The vulnerability is an actual weakness in the system. A true finding can still have low contextual risk; a false finding means the technical claim itself does not hold.

Reproduction improves confidence. For SAST, inspect the reported flow and attempt a focused regression test. For DAST, replay the request under the same role and state. For a dependency, inspect the resolved graph and, where relevant, exercise the affected function. For a secret, validate carefully with the provider or owner without spreading the value, then assume exposure if the credential is real.

Preserve the analyzed object. A result against commit A does not automatically describe commit B. A container scan against digest X does not cover a rebuilt digest Y with the same tag. A DAST request against staging version 12 does not prove version 13 behaves the same. Precise identities prevent the triage record from attaching to the wrong thing.

Validation should not require exploitation when that would create unacceptable harm. Static evidence, safe reproduction, vendor information, and controlled test environments can be enough. The objective is the strongest responsible technical conclusion, not proving impact by damaging production.

At the end of this stage, state the claim in plain language. For example: “An anonymous HTTP value reaches a shell interpreter in production configuration without validation,” or “The library version is present, but the affected parser is never invoked and the feature is disabled.” Those statements support contextual risk analysis far better than a red severity badge.

## How Does Context Turn Severity into Risk?
<!-- section-summary: Severity describes potential technical seriousness, while risk combines the real instance's reachability, exposure, exploitability, impact, threat activity, and existing controls. -->

**Severity**, **risk**, and **priority** are different.

```text
severity -> how serious the weakness can be
risk     -> how dangerous this instance is to this organization
priority -> when the organization should act
```

A critical severity score commonly assumes that the weakness exists under particular conditions. It does not prove that the affected path is deployed, reachable, exposed, or valuable in this environment. CVSS provides a technical severity model and supports adding threat and environmental context; it should be an input rather than the entire decision.

A first-principles risk model is:

```text
risk ≈ likelihood × impact
```

For triage, expand likelihood into questions about exposure, reachability, exploitability, and attacker opportunity. The multiplication is conceptual, not a promise of exact arithmetic. It prevents one number from erasing the causal factors.

**Reachability** asks whether execution can arrive at the vulnerable behavior. A critical library may be installed in three applications. In one, Internet input reaches the affected parser. In another, the function is never called. In a third, only a restricted administrator network can invoke it. Package presence, reachable vulnerable behavior, and external exploitability are different facts.

“Unreachable” should not become permanent dismissal by habit. Code paths, feature flags, routes, and configuration change. If reachability reduces current risk, record the assumption and monitor or expire it.

**Exposure** asks who can attempt the path. An anonymous public API creates more opportunity than an internal tool requiring VPN and an administrator role. Internal does not mean safe—credentials can be compromised and insiders exist—but the boundary changes likelihood.

**Exploitability** asks how difficult the path is. Does public exploit code exist? Is exploitation automated or observed in the wild? Is authentication, user interaction, local access, a race condition, or an unusual configuration required? Can the attacker reliably reproduce the effect? For published vulnerabilities, EPSS can add an estimate of near-term exploitation in the wild, but it does not know this asset, impact, or controls and is not a complete risk score.

**Impact** asks what successful exploitation provides. Examine confidentiality, integrity, availability, gained privilege, lateral movement, and business consequences. Command injection in an ephemeral image worker with read-only network access has different consequences from the same weakness in a payment backend with customer data, production credentials, and database reachability.

Ask concrete impact questions:

- What information can be stolen?
- What records or software can be changed?
- Which service can be stopped or degraded?
- Which new identity or authority can be obtained?
- Can the attacker move to other systems?
- What financial, safety, privacy, compliance, or customer harm follows?

**Compensating controls** reduce risk without removing the underlying weakness. Network isolation may block public access to a vulnerable endpoint. Strong authorization may restrict it to a small administrative role. Container isolation or denied egress may limit consequences. These controls belong in the analysis, but their state must be described honestly:

```text
fixed     -> vulnerable condition removed
mitigated -> vulnerable condition remains; another control constrains it
```

A web application firewall that blocks known payloads does not automatically make an injection finding false. An administrator-only cross-site scripting path remains a vulnerability even if its exposure is lower. Confusing “low current risk” with “false positive” corrupts both the finding inventory and future review.

Risk analysis should finish with a residual-risk statement: what remains possible after current controls, under which assumptions, affecting which assets. That statement becomes the basis for priority and disposition.

Do not combine the factors mechanically without examining evidence quality. “Not reachable” based on code inspection is weaker than a resolved call graph plus a test showing the feature is disabled in the released artifact. “Internal” may describe a DNS name while a public gateway still routes to it. “Strong authorization” needs a named policy and a lower-role test. The confidence of each contextual fact affects how much weight it should receive.

Threat activity can change faster than code. Reliable exploitation or active campaigns may make a previously stable vulnerability urgent. Conversely, low observed exploitation does not erase high consequence in a uniquely valuable asset. Keep technical severity, current threat information, and organizational impact visible as separate inputs so one feed does not silently determine the whole risk decision.

Compensating controls can fail together. An endpoint may rely on both private networking and an administrator role. If the same broad cloud identity can change the network route and grant itself the role, the two controls are less independent than they appear. Triage should ask who can alter the mitigation, how changes are detected, and whether control failure would reopen the direct path.

## How Do Risk, Ownership, and Deadlines Create Priority?
<!-- section-summary: Priority combines contextual risk with time sensitivity and organizational constraints, then turns the decision into a named remediation owner, authorized risk owner, and reviewable deadline. -->

Risk alone does not schedule work. **Priority** adds time and operational context. An Internet-facing issue with observed exploitation may require immediate containment. A high production weakness may need a short deadline. A medium internal issue with strong controls may fit a normal sprint. A low unreachable condition may remain in a planned backlog.

Other events can change timing: an incident is underway, a major release is imminent, a regulator or customer requires action, a component will be decommissioned, or a high-value service is about to expand exposure. A high finding on a public login path may outrank a nominally critical library in an undeployed artifact.

This is why due dates should not come blindly from severity. A policy can provide default service levels, but triage should incorporate external exposure, known exploitation, asset criticality, data sensitivity, reachability, and compensating controls. Consistency is valuable; refusing to recognize relevant facts is not.

Every actionable finding needs an owner. “Security” should not automatically own all remediation. The team that controls the application, platform, cloud resource, dependency, or pipeline usually owns the corrective change. Security can validate, advise, challenge, and govern without becoming the implementation queue for every system.

There are two useful ownership roles:

- The **remediation owner** is responsible for fixing or mitigating the condition.
- The **risk owner** has authority to accept the residual business risk.

They may be different. A developer can propose that an authorization flaw is too costly to fix this month, but should not necessarily be able to convert the failing security signal into an approved accepted risk alone. Sensitive systems benefit from separation of duties: the engineer proposes a disposition and evidence; an authorized reviewer approves or rejects it.

The amount of friction should match the risk. A low-impact lint-like false positive may not need a committee. A production authentication bypass or long exception likely deserves an independent risk owner. Delegated dismissal workflows can encode this difference by allowing contributors to request closure while designated reviewers decide.

A minimal actionable record contains:

```text
technical claim and affected object
current risk and disposition
remediation owner
risk owner or approver where required
target date or explicit reason no date applies
verification needed for closure
```

Without a due date, “owned” often means “someday.” The date can follow policy defaults and then be adjusted with written contextual reasoning. Accepted risk should usually have an expiry even when no remediation date exists. Expiry creates a point to check whether the component was retired, exposure changed, controls still operate, and the same owner remains authorized.

Priority can also be staged. Immediate containment may disable a route or revoke a credential today, mitigation may narrow access this week, and the structural fix may arrive in a later release. Record each state so a temporary control is not mistaken for final closure.

## What Do the Main Finding Dispositions Actually Mean?
<!-- section-summary: Precise disposition vocabulary preserves whether the weakness was removed, constrained, disproved, consolidated, intentionally present, invalidated, or knowingly retained. -->

A mature system needs more than open and closed. Different outcomes carry different residual risk and verification.

**Fixed** means the vulnerable condition no longer exists. SQL composition was replaced by parameterized access, an affected dependency was removed from the resolved graph, or an authorization check now enforces ownership. Closure evidence includes the change, a detector rerun, and a regression test where practical.

**Mitigated** means the weakness may remain, but another control materially constrains exploitation or impact. A vulnerable administration endpoint may now be reachable only from a dedicated management network. Say explicitly that the root condition remains and name the control on which the decision depends.

**False positive** means the detector's technical claim is wrong. Perhaps it treats a value as attacker-controlled even though a proven enum and approved sanitizer constrain it before the sink. Explain the missing fact, relevant code or configuration, and reproduction evidence. “Low risk” and “false positive” are not synonyms.

**Duplicate** means the same root cause or risk is already tracked. CodeQL, another SAST tool, and a penetration test may all report one vulnerable helper. Choose a canonical issue and link the others to it. Deduplicate remediation work, not the fact that independent detectors observed the condition.

**Used in tests** or **intentional example** means the reported pattern is deliberately present in non-production material and cannot authenticate or execute in a production path. A fake private key fixture can qualify when it is known, non-production, and incapable of granting access. A real production key placed under `tests/` does not become safe because of its directory name.

**Revoked** is central for real secrets. Removing a committed API key from current source does not invalidate copies. Revoke or rotate it, prove the old value no longer authenticates, update legitimate consumers, investigate use, and search for other copies. Source cleanup and credential invalidation are separate states.

**Accepted risk** means the weakness is real and an authorized owner deliberately retains the residual risk. A legacy reporting component may be isolated, scheduled for retirement in six weeks, and too costly to rewrite before that date. Record exposure, impact, compensating controls, plan, approver, and expiry rather than pretending the finding is false.

**Won't fix** is not reasoning by itself. If a platform provides that label, the underlying record should still say whether it represents accepted risk, decommissioning, an alternate mitigation, or another defensible decision. A comment such as “low risk” gives a future investigator almost nothing.

Accepted risks need a half-life. “Internal only,” “no sensitive data,” “feature disabled,” and “decommission next month” can all stop being true. On expiry, either close through remediation, renew with current evidence and approval, or change the decision.

The categories can also form a sequence rather than one permanent label. A secret finding may be contained as revoked, then source and history are cleaned, consumers are migrated, and investigation closes. A code weakness may be mitigated immediately by disabling a route, then fixed in a later release. Preserve the transitions and their times so responders know which protection existed during each interval.

Do not use duplicate status merely because two findings share a weakness category. Two SQL-injection paths in different services may require different owners and fixes. Duplicate means the same underlying condition and remediation are tracked elsewhere. Link the exact canonical record and keep detector references so closure of that root issue can verify every observed instance.

Test/example status also needs a production-boundary check. Confirm the fixture is excluded from released artifacts, cannot be loaded by production configuration, and contains no valid authority. Where practical, use deliberately invalid token formats or generated keys whose private authority is never trusted anywhere. That reduces both scanner noise and the chance that “fixture” becomes a hiding place for a real secret.

Use a compact vocabulary consistently:

| Disposition | Meaning |
|---|---|
| Fixed | The vulnerable condition was removed |
| Mitigated | The condition remains but a verified control constrains it |
| False positive | The detector's technical claim does not hold |
| Duplicate | The same root risk is tracked under a canonical finding |
| Test/example | The condition is intentional, non-production, and evidenced |
| Revoked | The exposed credential was invalidated |
| Accepted risk | Real residual risk was knowingly approved for a bounded period |

Precise names prevent dashboard closure from rewriting technical reality.

## What Evidence Makes a Dismissal Defensible?
<!-- section-summary: Dismissal is a security-sensitive override, so the record must preserve the finding, established facts, reasoning, dependencies, authorization, and reconsideration point. -->

Dismissal changes an open security alert into a state that may unblock a merge, reduce remediation pressure, and remove the item from default views. Whenever an enforcement signal is overridden, preserve why the override was safe.

A good record answers seven questions:

1. Which exact finding and object were evaluated?
2. What did the detector claim?
3. Which facts did investigation establish?
4. Why do those facts change the risk conclusion?
5. Which controls or assumptions does the decision depend on?
6. Who proposed and authorized the decision?
7. When or under what change must it be reconsidered?

For example:

```text
Disposition: False positive

Finding: Code path-traversal alert 482 on commit abc123

Technical reason:
The filename is canonicalized by safePath() before Files.open().

Evidence:
- safePath implementation in commit abc123
- SecurityPathTest rejects ../ and encoded traversal
- manual reproduction returns HTTP 400

Scope: this call path only
Reviewer: application security owner
Review date: 2026-08-25
Reopen if: safePath or route input handling changes
```

Evidence should be independently checkable. “Looks safe” is weak. “Only admins can reach it” is better but still incomplete. Naming the route, authorization rule, non-admin test, deployment ingress, and evidence links lets another engineer reproduce the conclusion.

The record does not need to become a miniature novel. A concise template works:

```text
Disposition:
Technical assessment:
Evidence:
Residual risk and dependencies:
Owner and approver:
Expiry or reopen condition:
```

Preserve the original alert and history. Closed should mean “decision recorded,” not “evidence deleted.” A reopened alert should retain why it was previously closed so investigators can see how context changed.

Dismissal permission is itself a control. If any author can click “false positive” on a failed check and immediately merge, the scanner is advisory despite its red status. Higher-risk repositories can require delegated approval. The proposal, reviewer identity, time, reason, and outcome then become evidence of the override.

Assumptions need explicit names because they can be monitored. “Not exploitable” hides the dependency. “Not externally exploitable because `/admin/import` is available only through the administrator ingress” identifies the property whose change should trigger review.

For accepted risk, include the remaining weakness, affected capability, reachability, exploit prerequisites, impact, compensating controls, owner, approver, planned resolution, and expiry. For a duplicate, link the canonical issue. For test material, show that the value or vulnerable sample is non-production and inert. For a revoked secret, retain provider-side invalidation and log-review evidence without copying the secret into the comment.

Dismissals must not leak sensitive data. Refer to a secret by provider identifier or fingerprint, not the credential value. Restrict raw DAST responses or internal configuration when necessary while leaving enough sanitized evidence for authorized reviewers.

## How Do You Verify Closure and Reopen Changed Assumptions?
<!-- section-summary: Closure should verify the security property with the original detector and a focused test, then reopen when the control, exposure, state, or assumption supporting the decision changes. -->

Code that looks better is not yet verified closure. The general sequence is:

```text
finding -> corrective action -> rerun evidence -> regression check -> close
```

Verification depends on the finding type.

For SAST, rerun the original analysis on the corrected revision and confirm that the dangerous path no longer exists. Add a security regression test where possible. Test the invariant—attacker input cannot become command or query syntax—not merely that one line changed.

For DAST, replay the original request or equivalent exploit under the same role and state. Confirm that the unsafe behavior no longer occurs. Convert expensive discovery into a focused repeatable test so the defect does not return unnoticed.

For a dependency vulnerability, inspect the resolved graph and final artifact. Updating a manifest is insufficient when a lockfile or transitive path still installs the affected version. If closure relies on disabled configuration or unreachable code instead of an update, verify that assumption and classify the result as mitigation or accepted risk rather than fixed.

For a secret, revoke or rotate first, prove the old credential no longer works, update legitimate consumers, search for additional copies, inspect relevant access logs, and clean exposed source or history where appropriate. A deleted string and an invalid credential are different properties.

For a mitigation, test the control's outcome. If network policy is the mitigation, attempt connection from an unauthorized location and confirm denial. The existence of `network-policy.yaml` does not prove enforcement. If authorization is the control, exercise the lower role. If feature disablement is the control, verify runtime state.

Closure remains conditional when it depends on assumptions. An endpoint dismissed as internal deserves reevaluation if ingress makes it public. A “test only” sample must be reconsidered if test code starts shipping. A disabled feature must be reviewed when enabled. A temporary network boundary must not silently become a permanent substitute for repair.

State those dependencies in a machine-searchable or otherwise monitorable form when practical. Link accepted risk to the component and control. Use expiry dates. Trigger review when exposure, ownership, deployment, or configuration changes. Reopening is not evidence that the original reviewer failed; it is the correct response when the facts supporting the decision stop being true.

Verification evidence should bind to the same objects as the finding: revision, package graph, artifact digest, environment, credential identifier, route, role, and test run. That binding prevents a clean rerun on a different object from closing the original risk accidentally.

When remediation changes the detector result but not the underlying property, investigate the discrepancy. A developer might rename a function so a pattern rule stops matching while unsafe behavior remains. A vulnerable package may be hidden from one manifest while still present in the final image. A DAST response may suppress an error body while the unauthorized state change still occurs. Verification should challenge the security invariant rather than reward disappearance from one dashboard.

Keep negative and positive evidence together. The clean rerun shows the detector no longer observes the original condition. The focused regression test demonstrates the expected behavior. The deployment record shows the corrected artifact reached the affected environment. Together they support closure more strongly than any one record.

## How Does Triage Improve the Wider Security System?
<!-- section-summary: Triage data reveals shared root causes, weak platform defaults, poor scanner models, and process health, allowing teams to eliminate classes of findings rather than clean a dashboard. -->

Triage is not only a queue-closing function. Similar findings often share one root cause. Thirty-seven SQL-injection alerts may come from one unsafe database helper. Fixing the abstraction removes a class of paths and produces a safer default for future code.

Repeated patterns should drive platform improvements:

```text
repeated hardcoded secrets
  -> secret-manager integration, templates, documentation, push protection

repeated unsafe SQL
  -> parameterized data-access abstraction and regression tests

repeated public storage
  -> secure infrastructure module and policy gate
```

Fixing each instance is necessary; removing the systemic cause is stronger DevSecOps.

Disposition data can improve the scanner. If one CodeQL query produces one hundred alerts and ninety-two are verified false positives because a custom sanitizer is unknown, teach the model or tune that specific rule rather than asking every developer to repeat the same dismissal. The loop becomes:

```text
scanner -> findings -> triage classifications -> model or policy improvement
```

Do not optimize by hiding genuine risk. Ignoring every path can reduce the dashboard from one hundred findings to zero while security becomes worse. The target is minimum unacceptable residual risk, not minimum visible alerts. Better detection can temporarily increase the count.

Useful process-health metrics include time to triage, remediation time by contextual risk, percentage with owners, overdue high-risk work, false-positive rate by rule, evidence completeness, expired acceptances, reopened findings, and repeated vulnerability classes. Total alert count by itself says little; seven alerts may mean excellent security or a scanner that rarely runs.

A lightweight first-pass checklist is enough for a small team:

1. What is the precise technical claim and affected object?
2. Is it real and reproducible?
3. Which asset and owner are involved?
4. Is the behavior reachable, and from where?
5. Which attacker privilege or conditions are required?
6. What can successful exploitation achieve?
7. Is exploitation available or observed?
8. Which compensating controls operate now?
9. What is the residual risk and priority?
10. Who owns remediation, who may accept risk, and what is the date?
11. Which precise disposition applies?
12. What evidence and verification will close or reopen it?

The completed lifecycle ends with evidence, not a green checkbox:

```text
detector evidence
      |
      v
validated technical claim
      |
      v
reachability + exposure + exploitability + impact + controls
      |
      v
residual risk and operational priority
      |
      v
owner + deadline + disposition
      |
      v
reviewable decision evidence
      |
      v
verified closure or monitored exception
```

When a dashboard says “HIGH,” do not automatically translate it into either “fix immediately” or “scanner noise.” Ask what was observed, whether it is real, whether an attacker can reach it, how exploitation works, what they gain, which controls remain, and what accountable action the organization will take. That reasoning is the security control.

For a small team, schedule a short recurring review of untriaged findings, overdue high-risk work, expiring acceptances, and repeated root causes. The meeting should produce decisions and owners, not merely reread the dashboard. Escalate only the items whose uncertainty, impact, or acceptance authority exceeds the group. This keeps ordinary findings moving while reserving scarce specialist attention for the cases that genuinely need it.

Periodically sample closed items. Ask an engineer who did not make the decision to reproduce the evidence, confirm the disposition vocabulary, and check whether assumptions remain true. A small sample exposes vague comments, broken links, expired test runs, and overly broad dismissal permission before those weaknesses matter during an incident or audit.

## Check Your Answers

:::expand[Why Is a Security Finding Not Yet a Vulnerability Decision?]{kind="recap"}
A finding is detector evidence; triage establishes technical reality, contextual risk, ownership, action, and proof.
:::

:::expand[How Do You Validate What the Detector Actually Observed?]{kind="recap"}
Replace the scanner label with a reproducible claim tied to an exact revision, artifact, package, credential, request, identity, or resource.
:::

:::expand[How Does Context Turn Severity into Risk?]{kind="recap"}
Combine severity with reachability, exposure, exploitability, threat activity, impact, and verified compensating controls.
:::

:::expand[How Do Risk, Ownership, and Deadlines Create Priority?]{kind="recap"}
Turn residual risk and time sensitivity into a remediation owner, authorized risk owner, operational deadline, and review point.
:::

:::expand[What Do the Main Finding Dispositions Actually Mean?]{kind="recap"}
Use fixed, mitigated, false-positive, duplicate, test, revoked, and accepted-risk labels only when their distinct technical meanings match reality.
:::

:::expand[What Evidence Makes a Dismissal Defensible?]{kind="recap"}
Preserve the original claim, facts, reasoning, dependencies, scope, authorization, evidence, and expiry behind any override.
:::

:::expand[How Do You Verify Closure and Reopen Changed Assumptions?]{kind="recap"}
Test the property the correction or mitigation should create, bind proof to the affected object, and reconsider the decision when its assumptions change.
:::

:::expand[How Does Triage Improve the Wider Security System?]{kind="recap"}
Use recurring findings and disposition data to fix shared abstractions, platform defaults, scanner models, and process health without hiding risk.
:::

## References

- [FIRST CVSS v4.0](https://www.first.org/cvss/v4-0/) - Defines Base, Threat, and Environmental severity metrics.
- [OWASP Risk Rating Methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology) - Explains likelihood, impact, and organizational risk context.
- [FIRST EPSS](https://www.first.org/epss/) - Defines the probability signal for near-term exploitation of published CVEs and its limits.
- [GitHub delegated alert dismissal](https://docs.github.com/en/code-security/security-overview/delegated-alert-dismissal) - Documents separation of dismissal request and approval.
- [GitHub code-scanning alert states and reasons](https://docs.github.com/en/rest/code-scanning/code-scanning#update-a-code-scanning-alert) - Documents closure reasons including false positive, won't fix, used in tests, and mitigated.
- [Resolving CodeQL alerts](https://docs.github.com/en/enterprise-cloud%40latest/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts) - Describes investigation, dismissal comments, reopening, and model improvement.
- [GitHub removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) - Explains why exposed credentials must be revoked or rotated.
- [GitHub secret-scanning alert resolution](https://docs.github.com/en/rest/secret-scanning/secret-scanning#update-a-secret-scanning-alert) - Documents secret outcomes including revoked and used in tests.
