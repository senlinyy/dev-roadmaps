---
title: "Ownership and Evidence"
description: "Learn how teams assign decision authority to sensitive delivery paths and preserve evidence that proves what happened to a production change."
overview: "Trace one ParcelPulse pricing change from proposal to runtime. Connect named ownership, CODEOWNERS routing, enforced review, CI and security evidence, immutable artifact identity, provenance, deployment records, access reviews, retention, and a small audit packet that an independent investigator can verify."
tags: ["devsecops", "ownership", "evidence", "audit"]
order: 3
id: article-devsecops-security-foundations-security-ownership-in-devops
aliases:
  - security-ownership-in-devops
  - article-devsecops-security-foundations-security-ownership-in-devops
  - devsecops/security-foundations/security-ownership-in-devops.md
  - audit-logs-and-evidence
  - article-devsecops-security-foundations-audit-logs-and-evidence
  - devsecops/security-foundations/audit-logs-and-evidence.md
  - devsecops/security-foundations/03-ownership-and-evidence.md
  - devsecops/security-foundations/03-ownership-and-evidence
  - security-foundations/03-ownership-and-evidence
---

## Table of Contents

1. [How Do Ownership and Evidence Support a Trustworthy Change?](#how-do-ownership-and-evidence-support-a-trustworthy-change)
2. [How Do Named Owners Route and Authorize Sensitive Decisions?](#how-do-named-owners-route-and-authorize-sensitive-decisions)
3. [What Evidence Proves CI and Security Claims?](#what-evidence-proves-ci-and-security-claims)
4. [How Do Digests and Provenance Bind Evidence to an Artifact?](#how-do-digests-and-provenance-bind-evidence-to-an-artifact)
5. [How Do Deployment Records Create End-to-End Traceability?](#how-do-deployment-records-create-end-to-end-traceability)
6. [How Do Reviews and Retention Keep Ownership and Evidence Reliable?](#how-do-reviews-and-retention-keep-ownership-and-evidence-reliable)
7. [Which Gaps Break an Apparently Secure Evidence Chain?](#which-gaps-break-an-apparently-secure-evidence-chain)
8. [How Do You Build and Verify the Smallest Useful Audit Packet?](#how-do-you-build-and-verify-the-smallest-useful-audit-packet)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Every production change creates two distinct questions. **Ownership** asks who is responsible for deciding whether the change is acceptable. **Evidence** asks what an investigator can inspect later to prove what happened.

A trustworthy change combines four properties:

```text
accountability + enforced process + verifiable evidence + traceability
```

Without ownership, the delivery path lacks a reliable decision-maker. Without evidence, the team can describe its normal procedure but cannot demonstrate that the procedure governed this release.

Imagine a developer changes the shipping-price function in ParcelPulse:

```python
def calculate_shipping_price(parcel):
    ...
```

The change moves through source control, pull request, review, CI, security checks, build, registry, deployment, and production. At 03:00, customers begin receiving incorrect prices. Responders immediately need to know what changed, who proposed and reviewed it, which tests and security checks ran, which artifact was built, whether that exact object reached production, who authorized deployment, and what is running now.

Ownership does not mean one person performs every task. It means a person or team is accountable for ensuring that appropriate decisions are made, rules are maintained, and incidents reach someone able to act. Evidence does not mean storing unlimited employee activity. It means preserving purposeful records that answer security and operational claims.

Keep these questions in view as you work through the lesson:

1. **How Do Ownership and Evidence Support a Trustworthy Change?**
2. **How Do Named Owners Route and Authorize Sensitive Decisions?**
3. **What Evidence Proves CI and Security Claims?**
4. **How Do Digests and Provenance Bind Evidence to an Artifact?**
5. **How Do Deployment Records Create End-to-End Traceability?**
6. **How Do Reviews and Retention Keep Ownership and Evidence Reliable?**
7. **Which Gaps Break an Apparently Secure Evidence Chain?**
8. **How Do You Build and Verify the Smallest Useful Audit Packet?**

## How Do Ownership and Evidence Support a Trustworthy Change?
<!-- section-summary: Ownership identifies who is accountable for accepting a change, while evidence proves what decisions and events actually occurred. -->

It helps to separate a decision from a fact. “Identity Engineering accepts the residual risk in this authentication change” is a decision and must name an authorized owner. “CI run 18429 tested commit `3f92c8a` and produced digest `sha256:a8219f...`” is a fact that a system can record. A trustworthy delivery path preserves both. Facts without an authorized decision may show that software was built but not that it was accepted. A decision without facts may show intent but not what the automated path actually did.

This distinction prevents ownership from becoming ceremonial. A team name in a directory is useful only when it maps to real authority: the ability to maintain policy, require correction, accept bounded risk, respond to incidents, and escalate when a change falls outside the normal path. Evidence then allows that owner and later investigators to evaluate the same event from the same records rather than from memory.

## How Do Named Owners Route and Authorize Sensitive Decisions?
<!-- section-summary: Ownership assigns accountable decision authority, and repository controls route and enforce review by the right people. -->

Systems do not own themselves. ParcelPulse can contain tracking UI, pricing, authentication, infrastructure, deployment workflows, identity policy, encryption, and customer-data controls. When an authentication file changes, the Identity team, Platform team, and application team may each assume another group will decide whether the change is safe. The absence of a named decision-maker is an ownership failure even when everyone is acting reasonably.

Ownership should follow decision authority. A contributor proposes a change. A reviewer assesses it. An approver authorizes it. An owner remains accountable for the system and the rules that govern those decisions. One person can sometimes hold several roles, but allowing an author to write, review, approve, merge, and deploy a sensitive change collapses independent controls.

Risk determines how explicit the model should be. A README edit and an identity-policy edit need different governance. An ownership map might assign the pricing engine to Shipping Platform, authentication to Identity Engineering, production identity policy to Cloud Security, deployment workflows to Platform Engineering, and customer-data policy to Data Governance.

An ownership directory alone does not influence a change. A `CODEOWNERS`-style file turns the organizational fact into routing:

```text
/src/pricing/        -> Shipping Platform
/src/auth/           -> Identity Engineering
/infra/              -> Platform Engineering
/.github/workflows/  -> Platform Engineering and Security
```

When a pull request changes token validation, the repository knows that an authentication owner should review it. This embeds governance in the delivery path rather than leaving it in a spreadsheet nobody consults.

Routing is still not enforcement. A requested review that can be ignored is a suggestion. Branch rules express what must happen before merge: a pull request, required owner approval, a minimum number of reviewers, passing tests and security checks, resolved comments, and no direct push to the protected branch.

The distinction is useful:

```text
CODEOWNERS -> who should review?
branch rules -> what must be true before merge?
```

Important properties should be enforced where practical rather than depending only on memory or convention. Bypass capability, where necessary, should be narrow, authenticated, justified, logged, and reviewed afterward.

Ownership must cover more than application source. Delivery workflows, build definitions, infrastructure, production authorization, exception policy, encryption settings, and evidence stores can each change the meaning of a release. A pull request that leaves application code untouched but broadens the deployment role may be more sensitive than a feature change. The ownership map should therefore follow control boundaries as well as directories.

The repository can route several owners when responsibilities overlap. An infrastructure change may require the service owner to confirm operational intent and the platform owner to confirm the delivery mechanism. A customer-data rule may require both the implementing team and the governance owner. Multiple reviews are useful when each reviewer answers a distinct question; collecting approvals from people with no defined decision responsibility merely adds ceremony.

Ownership also includes maintaining the rules after the merge. If a control creates constant false positives, an accountable owner should improve the rule instead of teaching everyone to bypass it. If a temporary risk exception is accepted, an owner should track its scope, expiration, compensating control, and closure. The point is not to attach blame to every change. It is to ensure that important decisions always have a reachable, authorized steward.

Ownership is not blame. Its useful purpose is to make decision rights, escalation, maintenance responsibility, residual-risk acceptance, and incident coordination clear. When authentication fails, responders should know which durable team to involve without organizational archaeology.

## What Evidence Proves CI and Security Claims?
<!-- section-summary: Controls describe required behavior, while event evidence records what ran, against which input, under which policy, and with which result. -->

A branch setting that requires tests is policy evidence. It shows how the repository was configured. To prove that commit `abc123` was tested before release, an investigator needs event evidence such as a CI run identifier, the exact source revision, test set, result, workflow identity, runner, build configuration, and timestamps.

```text
control: required tests must pass
event evidence: run 98471 tested commit abc123;
                2,418 tests passed and none failed
```

Controls say what should happen. Evidence says what did happen for this change.

Begin evidence design with a claim. For “the production version passed unit tests,” the proof must connect a test result to a source commit, build identity, artifact identity, and deployment. If commit A passed but artifact B was deployed, the presence of both records does not prove the claim.

CI evidence commonly records repository, commit SHA, workflow identity, runner or builder, build configuration, start and finish, tests executed, outcomes, and produced artifacts. This supports the bounded statement that a specific revision passed a recorded suite in a specific run. It does not yet prove that production ran the run's output.

Security evidence answers different claims:

- Did static analysis run on the intended source?
- Did secret detection find a verified credential?
- Did dependency policy find a prohibited vulnerability?
- Did the final container pass the release threshold?
- Did infrastructure policy find a forbidden configuration?
- Did licensing or compliance checks pass?

A label such as `security-check=PASS` is too weak when nobody knows which tool, rule version, input, time, or threshold it represents. Useful evidence records the policy or scanner identity, the object examined, the configuration or policy version, the result, important findings, and any exception decision.

Evidence should be produced automatically where possible. Requiring people to assemble screenshots of source control, CI, scanner, registry, and deployment consoles after every release is costly and error-prone. A well-engineered pipeline records commit, approvals, tests, scan results, artifact identity, provenance, and deployment as part of ordinary execution. An audit packet then becomes a query over operational evidence instead of paperwork reconstructed later.

Automation increases the need for these records. A modern change may pass through bots, workflows, build services, scanners, registries, deployment controllers, and cloud services with no person watching each action. Each machine should record what triggered it, which identity it used, which input it consumed, which decision it made, and which output it produced.

Evidence should be specific enough to support a bounded conclusion. A successful unit-test record does not prove that dynamic security testing ran. A source scan does not prove that the final container contains no prohibited package. A passing infrastructure-policy check does not prove that production currently matches the reviewed plan. Each record must say what object and claim it covers, and the audit packet must not silently stretch that claim beyond its boundary.

Failures and dismissals are evidence too. If a scanner reports a finding and an authorized owner accepts it under a time-bounded exception, retaining only the final green status hides an important decision. Preserve the original result, the decision identity, the justification, the affected object, the compensating control, and the expiration. That history explains why the path continued without pretending the finding never existed.

## How Do Digests and Provenance Bind Evidence to an Artifact?
<!-- section-summary: Immutable source and artifact identifiers connect test, scan, build, and provenance evidence to the exact object they describe. -->

Evidence quality depends on binding. A vulnerability report saying `PASS` is not useful when it could describe Monday's source, Tuesday's container, a staging artifact, or an image that never reached production.

Stable identifiers create joins: commit SHA, workflow run ID, build ID, artifact hash, container digest, deployment ID, and environment. Names and tags remain useful for humans, but they can move. `parcelpulse-api:latest` may name artifact A at 10:00 and artifact B at 11:00. An investigator at noon cannot infer what the tag meant at 10:17 from the name alone.

A digest identifies content. If CI produces `sha256:a8219f...`, the scanner examines `sha256:a8219f...`, and the deployment record names `sha256:a8219f...`, the records support a strong claim: the scanned artifact is the deployed artifact.

```text
build ----------- sha256:a8219f...
scan ------------ sha256:a8219f...
deployment ------ sha256:a8219f...
```

A digest does not explain origin. Provenance links the artifact to repository, revision, build workflow, builder, resolved inputs, run, and time:

```text
artifact: sha256:a8219f...
repository: parcelpulse/api
commit: 3f92c8a
build run: 18429
builder: approved ParcelPulse workflow
```

This closes a dangerous gap. Source review and tests can succeed while an attacker builds different bytes and inserts them into the release path. Provenance connects reviewed source, approved builder, and identified output.

The latest revision matters. If commit A passes and commit B is added before merge, an artifact from B is not covered by A's result. Required checks should apply to the exact revision permitted to merge and build.

The final-build boundary matters too. Scanning artifact A and later rebuilding artifact B under the same tag breaks the security claim. Build one final object, record its digest, scan that digest, associate provenance and other evidence with it, and deploy that same digest.

Binding should continue when evidence is copied between systems. A registry may store an attestation beside an artifact, a CI system may retain a test report, and a deployment platform may record a release. Their display names can differ, but every record should carry enough immutable identifiers to reconstruct the join. Time proximity is not a strong join: two builds can occur within seconds, and an attacker can deliberately exploit an ambiguous name.

Provenance itself is a claim that needs a trustworthy producer. A file supplied by the same untrusted build step it describes is weaker than evidence generated and protected by the controlled build service. The investigator therefore asks not only what the provenance says, but which identity created it, which builder rules applied, whether it was altered, and how its artifact subject matches the digest under review.

The same reasoning applies to source. A branch name such as `main` moves over time, while a commit SHA identifies a particular revision. Preserve both human context and immutable identity: repository and branch explain intent; the revision proves which content entered the build. If policy required checks on the final merge revision, the evidence should point to that exact revision rather than an earlier pull-request snapshot.

## How Do Deployment Records Create End-to-End Traceability?
<!-- section-summary: Deployment evidence joins one artifact digest to an environment, initiating identity, approval, time, result, and current runtime state. -->

Perfect source and build evidence does not establish what reached production. A deployment record adds another event:

```text
deployment: deploy-7814
environment: production
artifact: sha256:a8219f...
initiated by: parcelpulse-production-workflow
approved by: release manager
started: 14:44 UTC
completed: 14:47 UTC
result: successful
```

Now the system can join source commit to CI run, CI run to artifact digest, artifact digest to deployment ID, and deployment ID to the production environment. Runtime state provides the final comparison: is production currently running the digest that the deployment record says was admitted?

A mature evidence graph contains links rather than a pile of independent logs:

```text
developer identity
  -> commit SHA
  -> pull request and reviewers
  -> CI run, tests, and security checks
  -> artifact digest and provenance
  -> deployment record
  -> production runtime state
```

Investigators need both directions. Starting from a suspicious production digest, they should move backward to deployment, build, source, review, and owner, and sideways to SBOM, scan evidence, provenance, and logs. Starting from a vulnerable source revision, they should move forward to builds, artifacts, and every staging or production environment that received them.

Alternative production paths can destroy traceability. A polished automated pipeline is not authoritative when an administrator can make an unrecorded manual replacement. Direct mutation should be blocked where possible. Emergency access, when unavoidable, should use a named identity, expire, record commands or changes, state a reason, and trigger review so the evidence graph reflects reality.

Ownership and evidence reinforce each other. Evidence locates the affected component and event. Ownership names the team responsible for interpreting it and deciding the response. Owners without evidence investigate blindly; evidence without owners can identify a problem that nobody is accountable for resolving.

Runtime comparison is what connects expected state to real state. A successful deployment event proves that a controller reported success, not necessarily that every instance still runs the intended object. A later manual replacement, failed rollout, rollback, or partial update can change reality. Inventory or runtime observations should therefore report the active artifact identity and environment so investigators can compare current state with the last authorized deployment.

Forward traceability supports exposure analysis. If library version X is found vulnerable, teams can begin with the affected source or SBOM component, identify the builds that included it, follow their artifact digests, and locate every environment that received them. Backward traceability supports incident investigation. If one production instance behaves suspiciously, responders can begin with its digest and walk back through deployment, provenance, build, revision, reviews, and owner.

Both directions depend on deliberately propagated identifiers. A timestamp can help narrow a search, but clock differences and concurrent releases make it unreliable as the primary relationship. Recording the digest in deployment evidence, the source revision in provenance, and the run and artifact identities in CI makes the graph explicit.

## How Do Reviews and Retention Keep Ownership and Evidence Reliable?
<!-- section-summary: Ownership and evidence need lifecycle maintenance so organizational change, deletion, and tampering do not make the path unusable. -->

Ownership records become stale. A repository can still route authentication reviews to a team that was reorganized eighteen months ago. People eventually create bypasses around controls that no active owner can satisfy. Stale ownership can be worse than an obvious blank because users assume it still works.

Periodic reviews should ask whether repositories and components name the right durable team; reviewers still work on the system; merge and bypass permission remains justified; old service accounts have been removed; emergency administrators remain necessary; and production approver groups match current responsibility.

Prefer team ownership such as Identity Engineering over “ask Alice.” The team provides continuity through staffing changes. Event records still name the actual reviewer, giving individual accountability at the decision moment.

Evidence has a lifecycle too: creation, integrity protection, storage, retention, retrievability, and deletion. Seven-day CI retention cannot support an incident discovered thirty days after release. Keeping everything forever is not the answer either. Preserve the records required for the period in which the organization may investigate, prove a control, or reconstruct a release.

Evidence should be difficult to rewrite. A shared `production-log.txt` editable by many administrators provides weak proof. Stronger properties include authenticated sources, timestamps, immutable or append-oriented storage, restricted modification, cryptographic object identities, and centralized retention.

Retention should follow the questions the organization may need to answer. Release and approval evidence may need to outlive short-lived CI workspaces. Security findings may need to remain available until remediation and exception periods have closed. Deployment and runtime records should cover the interval in which an incident could be discovered and investigated. The policy should also define eventual deletion instead of turning evidence collection into indefinite surveillance.

Retrievability deserves an explicit test. Evidence that technically exists in expired accounts, isolated consoles, or undocumented storage is not operationally useful. Teams should rehearse reconstruction: choose a production digest, ask someone outside the original release to find its source, approvals, checks, provenance, and deployment, and record how long the task takes. Missing permissions, undocumented identifiers, and retention gaps become visible before an emergency.

Access to evidence must also be reviewed. Too many writers weaken integrity; too few readers can delay response. Separate the identities that produce records, administer storage, and investigate events where practical. Log changes to retention or audit configuration because disabling evidence collection can itself be a meaningful security event.

Evidence collection should be purposeful. Commit identity answers what source changed. Reviewer identity answers who approved it. Artifact digest names exact software. Deployment ID says when and where it was released. Audit events identify actors. Recording ten terabytes each day without stable identifiers, retention policy, query methods, or known questions creates volume rather than evidence quality.

## Which Gaps Break an Apparently Secure Evidence Chain?
<!-- section-summary: Bypass paths, imprecise binding, shared identities, disconnected records, and excessive noise can invalidate otherwise convincing controls. -->

Several gaps recur because an individual control looks healthy in isolation.

**An owner exists but can be bypassed.** `CODEOWNERS` names Identity Engineering, yet administrators can merge without its approval. Review who can bypass, under which conditions, whether the action is logged and justified, and how emergency use is reviewed.

**Tests ran against the wrong revision.** Commit A passes, commit B is added, and B becomes the build input without required checks rerunning. Bind merge eligibility to the exact revision that passed.

**Scanning precedes the final artifact.** Artifact A passes, artifact B is rebuilt under the same version tag, and production receives B. Bind the scanner result and deployment to one digest.

**Production can change outside the pipeline.** Evidence says artifact A should run while an administrator has manually installed Z. Restrict alternate paths and record exceptional changes.

**Humans or automation share identities.** Every action appears as `prod-admin`, so the log cannot separate Alice, Bob, CI, or an attacker holding their credential. Unique identities improve authorization and accountability.

**Evidence exists but cannot be joined.** Source says `abc123`, CI says `run-9188`, registry says `parcelpulse:v44`, scanner says `scan-818`, and deployment says `release-purple`. Propagate source and artifact identifiers so each record names the relationships explicitly rather than relying on timestamps.

**Evidence is abundant but unusable.** Huge uncurated logs lack known questions, identifiers, retention, and query paths. Design the small high-value path from identity to change, review, build, artifact, deployment, and runtime.

**Ownership depends on memory.** One expert can explain the release, then leaves. Critical knowledge must live in reproducible records and durable team responsibility.

These gaps can be found by asking an independent person to prove a claim. “Only reviewed source reaches production” should be demonstrable as production state, deployment record, artifact digest, provenance, source commit, pull request, and required owner approval. Any link answered with “that is how we normally work” is a concrete evidence gap.

Common gaps often combine. A shared production identity makes a manual bypass hard to attribute. A mutable tag makes the bypass hard to connect to exact content. Short log retention removes the remaining event before discovery. Reviews should therefore test complete claims instead of checking isolated controls. A list of individually enabled features can still produce an unprovable delivery path when their identifiers, identities, and retention do not connect.

The opposite failure is collecting every possible log without deciding which claims matter. More events create storage cost and search noise, while the decisive relationship remains absent. Start with a small set of high-value questions—who authorized the change, which exact source and artifact were involved, which controls ran, where it was deployed, and what is running now—then make those answers dependable before expanding the collection.

## How Do You Build and Verify the Smallest Useful Audit Packet?
<!-- section-summary: A useful packet compresses linked operational evidence so an independent investigator can move from ownership and intent to current production reality. -->

An audit packet is not valuable because it is a report. It is valuable because each claim points to a trustworthy source record. For one ParcelPulse production change, keep:

```text
change: pull request 812
proposer: Alice
source: commit 3f92c8a
component owner: Identity Engineering
approvers: Bob and Carol
CI: run 18429
tests: required suite passed
security: required checks passed or recorded decisions
artifact: sha256:a8219f...
provenance: digest built from 3f92c8a by approved CI
deployment: deploy-7814
environment: production
completed: 2026-08-25 14:47 UTC
deployment identity: production workflow
runtime: production reports sha256:a8219f...
```

Policy and event evidence are both needed. A branch rule stating that two reviews are required shows configuration. The two recorded approvals show what happened for this change. A vulnerability policy that blocks critical findings states the rule. A digest-bound scan result records the release decision.

Use the packet during an incident, not only an audit. If ParcelPulse reports unexpected outbound connections from `sha256:a8219f...`, responders can locate the deployment, build, source, author, reviewers, changed files, SBOM, scans, provenance, and build logs. If they begin with a compromised commit, they can identify every artifact and environment reached by that revision.

The deeper model is:

```text
intent -> owner decision -> automated execution -> artifact
       -> deployment -> production reality
```

Ownership governs who may propose, review, approve, merge, deploy, respond, and accept risk. Evidence records who actually acted, which checks actually ran, which artifact resulted, which environment received it, and what is running now.

To verify the packet, choose one claim at a time and follow its references. For “the deployed artifact passed required checks,” begin with runtime state, obtain the digest, locate the deployment event, follow the digest to the build and provenance, locate the exact source revision, and then inspect the required results for that revision and artifact. For “the sensitive change received authorized approval,” begin with the changed path, resolve its owner at the time, inspect the enforced rule, and connect the recorded reviewer identities to the merge event.

An effective packet includes links or identifiers, not pasted screenshots with lost context. It should be compact enough for a responder to navigate and rich enough that each statement can be challenged. If a result was accepted through an exception, include the original finding and decision rather than presenting an unconditional pass. If emergency authority altered production, include that named, time-bounded event and its review rather than omitting the alternate path.

The packet is a view over operational systems, not a parallel manual truth. Source control remains authoritative for revisions and reviews, CI for executions, the registry for artifact identity, the provenance store for origin claims, the deployment system for release events, and runtime inventory for current state. The packet joins those records around durable identifiers so the investigator can verify them at their sources.

The same exercise supports personnel continuity. Ask a responder who did not participate in the release to reconstruct it without private messages or help from the original author. They should be able to discover the responsible durable team, the exact change, required and actual reviewers, completed checks, artifact identity, deployment, and runtime state. If the answer depends on “Alice remembers” or “Bob has the screenshot,” the organization has knowledge but not dependable evidence.

An independent reconstruction should also distinguish automated facts from human decisions. The build system can state which input it consumed and which digest it produced. It cannot decide whether a business exception was acceptable unless policy already encoded that decision. The owner can accept a bounded exception but should not rewrite the scanner's original output. Keeping both layers lets a later investigator see the fact, the governing rule, the decision, and the decision-maker.

Finally, test whether the packet can answer an unexpected question. Starting from a reviewer should reveal the changes they approved. Starting from a build identity should reveal its artifacts. Starting from an exception should reveal affected releases and whether it expired. Starting from production should reveal the exact authorized path. These reverse and sideways joins make evidence useful during incidents, not merely for a predictable audit checklist.

If one join fails, record it as a concrete engineering gap with an owner instead of filling the packet from memory.

That gap should name the missing identifier, record, retention rule, or ownership link so the delivery system can produce better evidence on the next release.

Verify the correction on a later release by asking the same independent investigator to traverse the repaired link without help from the original team.

Preserve that successful reconstruction as evidence.

The objective is a shift from “trust our process” to “verify this event.” Months later, or during an incident, a reviewer should be able to start with exact production software, trace it through deployment, artifact, build, tests, security checks, source, approvals, and responsible owners, and explain how it arrived and what proves the expected path occurred.

## Check Your Answers

:::expand[How Do Ownership and Evidence Support a Trustworthy Change?]{kind="recap"}
Ownership assigns accountable decision authority, while evidence records verifiable facts about the path and result.
:::

:::expand[How Do Named Owners Route and Authorize Sensitive Decisions?]{kind="recap"}
Map sensitive areas to durable teams, route changes automatically, and enforce the required independent review before merge.
:::

:::expand[What Evidence Proves CI and Security Claims?]{kind="recap"}
Record exact input, identity, policy or tool, time, action, result, and output for the claim being made.
:::

:::expand[How Do Digests and Provenance Bind Evidence to an Artifact?]{kind="recap"}
Immutable identifiers join tests and scans to exact content, while provenance connects that content to source and build history.
:::

:::expand[How Do Deployment Records Create End-to-End Traceability?]{kind="recap"}
Join one digest to the deployment identity, approval, environment, time, result, and current runtime state in both directions.
:::

:::expand[How Do Reviews and Retention Keep Ownership and Evidence Reliable?]{kind="recap"}
Refresh owners and access, preserve records for the investigation period, restrict modification, and keep evidence retrievable.
:::

:::expand[Which Gaps Break an Apparently Secure Evidence Chain?]{kind="recap"}
Bypass, wrong revisions, rebuilt artifacts, manual production changes, shared identities, disconnected identifiers, and noise break proof.
:::

:::expand[How Do You Build and Verify the Smallest Useful Audit Packet?]{kind="recap"}
Compress the linked ownership, source, review, CI, security, artifact, provenance, deployment, and runtime records needed to prove the event.
:::

## References

- [GitHub CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - Documents repository ownership routing and code-owner review requests.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges/managing-protected-branches/about-protected-branches) - Documents required review, status checks, and protected merge paths.
- [SLSA build provenance](https://slsa.dev/spec/v1.2/provenance) - Defines structured build evidence connecting source, builder, and artifact subject.
- [Kubernetes container images](https://kubernetes.io/docs/concepts/containers/images/) - Explains image tags and immutable digest references used in runtime state.
