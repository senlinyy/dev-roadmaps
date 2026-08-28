---
title: "Detection Signals and Alert Triage"
description: "Turn noisy alert queues into evidence-based triage using identity, cloud, runtime, pipeline, and provenance context."
overview: "Follow suspicious use of the Payments Portal deployment identity from observable events through signals, alerts, correlated entity timelines, MITRE ATT&CK hypotheses, confidence and impact, escalation, containment, closure evidence, and detector improvement."
tags: ["devsecops", "detection", "triage", "attck"]
order: 1
id: article-devsecops-incident-readiness-detection-signals-alert-triage
---

## Table of Contents

1. [How Does Observable Activity Become a Security Alert?](#how-does-observable-activity-become-a-security-alert)
2. [Why Is an Alert a Hypothesis Rather Than a Verdict?](#why-is-an-alert-a-hypothesis-rather-than-a-verdict)
3. [Which Identity, Cloud, Runtime, and Pipeline Signals Belong Together?](#which-identity-cloud-runtime-and-pipeline-signals-belong-together)
4. [How Do Baselines and Entity Context Make Triage Useful?](#how-do-baselines-and-entity-context-make-triage-useful)
5. [How Does Triage Update Probability and Test Alternatives?](#how-does-triage-update-probability-and-test-alternatives)
6. [How Should MITRE ATT&CK Support Investigation?](#how-should-mitre-attck-support-investigation)
7. [How Do Confidence, Impact, Severity, and Escalation Differ?](#how-do-confidence-impact-severity-and-escalation-differ)
8. [What Does a Complete Alert Triage Loop Look Like?](#what-does-a-complete-alert-triage-loop-look-like)
9. [Check Your Answers](#check-your-answers)

Detection begins with observable reality. A user logs in, an identity calls a cloud API, a process starts, a container opens a connection, a Secret is read, or a deployment changes. These occurrences exist before the team decides what they mean.

Several terms describe different stages of interpretation:

- **Telemetry** is raw or structured data produced by systems.
- An **event** is a recorded occurrence, such as one API request.
- A **signal** is evidence that may be relevant to a security question.
- An **alert** is an automated hypothesis that selected evidence deserves human or automated attention.
- An **incident** is a coordinated response state for credible harmful activity or significant risk.

```text
observable action
  -> telemetry and event
  -> security-relevant signal
  -> detector applies logic and context
  -> alert hypothesis
  -> triage updates confidence and impact
  -> close, monitor, contain, or escalate to incident
```

The progression is not guaranteed. Most telemetry is not a signal. A signal can be explained by normal behavior. An alert can be a false positive. An incident can begin before every fact is known when potential impact and time pressure justify coordination.

Keep these questions in view as you work through the lesson:

1. **How Does Observable Activity Become a Security Alert?**
2. **Why Is an Alert a Hypothesis Rather Than a Verdict?**
3. **Which Identity, Cloud, Runtime, and Pipeline Signals Belong Together?**
4. **How Do Baselines and Entity Context Make Triage Useful?**
5. **How Does Triage Update Probability and Test Alternatives?**
6. **How Should MITRE ATT&CK Support Investigation?**
7. **How Do Confidence, Impact, Severity, and Escalation Differ?**
8. **What Does a Complete Alert Triage Loop Look Like?**

## How Does Observable Activity Become a Security Alert?
<!-- section-summary: Telemetry records observable reality; events organize observations, signals add security relevance, alerts automate hypotheses, and incidents represent coordinated response to credible harmful activity. -->

Suppose the Payments Portal runs in Kubernetes on a cloud platform. Identity logs show `ci-payments-deployer` authenticating from an unfamiliar source. Cloud audit records show it enumerating resources. Runtime evidence shows an interactive shell in a deployment-related container. Pipeline records show no approved deployment at that time.

No single observation says “the portal is compromised” with certainty. Together they create a stronger investigative question: was the production deployment identity used outside its intended automation?

![Signal to case infographic showing a secret alert, CloudTrail probe, GuardDuty finding, and missing pipeline run grouped into one triage case](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/signal-to-case.png)

Detection quality depends on collection quality. The team needs reliable timestamps, stable identity and resource identifiers, environment, source, action, result, and artifact or deployment context. Missing or untrusted telemetry limits later conclusions.

Observability is not automatically detection. Storing logs without rules, ownership, retention, and investigation access only creates data. Detection engineering decides which behavior matters, how signals correlate, who receives the alert, and what evidence makes a decision possible.

Telemetry itself has a trust boundary. A compromised workload may alter local files, disable an agent, flood a sensor, or forge application messages. Send important identity, cloud, cluster, pipeline, and runtime records to protected external storage with known retention and clock behavior. An absence of local evidence from a compromised process is not proof that an action did not happen.

Events should preserve enough detail to join later. Human display names can change, IP addresses can be reused, and container names can be recreated. Stable account identifiers, session IDs, workload identities, artifact digests, resource IDs, request IDs, and normalized timestamps make correlation more reliable.

Collection should also expose gaps. If one cluster stops sending audit logs or one runner loses telemetry, detection confidence drops. Monitor source freshness, volume, parsing errors, and coverage so “no alert” is not confused with “no observation.”

Retention should follow investigation needs. Identity issuance may precede suspicious runtime behavior by hours, and a newly discovered compromise may require searching older deployments. Keep data long enough to reconstruct relevant sequences, while limiting sensitive content and access.

## Why Is an Alert a Hypothesis Rather Than a Verdict?
<!-- section-summary: A detector compresses observations into an automated hypothesis; triage must validate it because noise can delay real harm and train responders to close alerts mechanically. -->

A signal is evidence, not a conclusion. An unfamiliar login can be a traveling engineer, an approved proxy, a changed runner, or credential theft. A shell can be a maintenance step or attacker activity. A Secret read can be normal startup or unauthorized collection.

An alert says something like:

```text
Given these observations and this rule,
suspicious use may have occurred,
so investigate now.
```

The detector has already made choices about thresholds, time windows, expected identities, enrichment, and severity. Those choices can be wrong or incomplete. Triage checks the hypothesis against the real environment.

Alert queues become dangerous in two opposite ways. Too much low-value noise consumes scarce analyst time and trains people to close alerts without investigation. Too few alerts or overly broad suppression hides real activity. A long queue also changes risk because high-impact events wait while evidence disappears or damage continues.

The Payments Portal alert might begin with interactive use of `ci-payments-deployer`. The identity normally performs deployments from protected CI and should not have an interactive human session. That baseline makes the signal meaningful, but an analyst still checks whether a new approved runner or emergency procedure explains it.

Triage should not seek only confirmation. It should ask what evidence would make the benign explanation more likely and what evidence would make compromise more likely. This reduces confirmation bias and produces defensible closure.

One benign fact does not explain unrelated evidence automatically. A legitimate deployment window might explain cloud writes, but not a source IP outside the runner network and a shell launched with no matching job. The analyst must explain the whole correlated set.

Alert closure needs a reason: false positive caused by rule or data error, benign expected activity, duplicate of another case, authorized exception, insufficient evidence with monitoring, or escalated incident. “Closed” alone teaches neither operations nor detection engineering.

Queue design should preserve priority without hiding age. A new high-impact alert may move ahead, but older unresolved cases still need ownership and review. Track time to acknowledgement, evidence collection, decision, and escalation separately; a fast acknowledgement with no investigation is not effective triage.

Deduplicate alerts only when they share the same underlying activity and response state. Ten repeated events from one session may belong to one case, while similar alerts from separate identities or environments can indicate broader compromise. Keep count and time range even when consolidating notifications.

Automation can enrich an alert with identity owner, asset criticality, deployment record, expected source, known exception, and recent change. It can also take a bounded action such as disabling one session. Do not let enrichment overwrite raw evidence or let an automated label become an unquestioned conclusion.

Each detector needs an owner and response expectation. An alert routed to nobody is not a control. The owner should know required data sources, normal false-positive patterns, urgency, safe containment options, and when to involve incident response.

## Which Identity, Cloud, Runtime, and Pipeline Signals Belong Together?
<!-- section-summary: DevSecOps triage needs a provenance-rich view joining identity activity, cloud control-plane actions, runtime behavior, and delivery-system changes around the same actors, resources, artifacts, and time. -->

Identity is often the best starting point because it links actions across systems. Ask who acted as whom, through which authentication method, from where, with which session, and under which role or Service Account.

For `ci-payments-deployer`, identity logs can show token issuance, role assumption, source identity, source network, session attributes, failures, and authentication anomalies. Compare those facts with the identity's design: protected CI only, no human login, one repository, one production role, and short-lived sessions.

Cloud audit logs answer which control-plane actions occurred. They can show resource reads and changes, IAM updates, key creation, network modifications, logging changes, or new compute. They provide action, resource, caller, source, result, and time.

Runtime signals answer what executing processes did. Examples include shell launches, unexpected child processes, package downloads, sensitive file access, privilege attempts, Kubernetes API calls, unusual network connections, or changes to executable paths.

Pipeline signals matter because DevSecOps delivery systems are privileged infrastructure. Review workflow edits, untrusted pull-request execution, secret access, runner assignment, approval bypass, artifact changes, deployment starts, and failed or missing jobs.

Provenance connects pipeline action to production reality:

```text
source revision
  -> workflow run and runner identity
  -> build artifact digest
  -> approval and deployment
  -> running workload
```

Without provenance, a malicious image deployed by an authorized system can look legitimate in platform logs. The runtime sees a normal deployment identity. The missing question is whether that identity deployed the reviewed artifact through the expected path.

Correlate on stable entities: human or workload identity, cloud account, cluster, namespace, Pod, repository, workflow, source revision, artifact digest, destination, source IP, and session. A tag or display name that can move is weaker than an immutable identifier.

![Triage workspace infographic showing repo events, cloud logs, and cluster audit evidence joined by identity, time, source IP, and resource before close or escalate decisions](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/triage-workspace.png)

DevSecOps adds one important correlation question: did anything just change? A new deployment, policy update, role binding, runner registration, dependency change, or secret rotation can explain behavior or reveal the attack path.

Identity correlation should follow assumption chains. A cloud role session may originate from a CI workload identity, which originates from a repository and workflow claim. If the cloud log shows only the final role name, retrieve issuance evidence to determine which workflow, branch, actor, and runner received it. A shared role without session context weakens attribution.

Control-plane and data-plane evidence answer different questions. Cloud and Kubernetes audit logs show desired-state or administrative changes. Runtime signals show process and connection behavior. Application logs show business actions. A case involving a malicious deployment may look normal in each layer until provenance connects the approved identity to an unexpected artifact.

Pipeline evidence should include the path that did not occur. A production role used with no corresponding workflow, approval, source revision, or protected-environment event is meaningful negative context. Preserve expected workflow schedules and identities so absence can be tested rather than assumed.

Artifact identity prevents a tag from confusing triage. Record the digest that the deployment requested and the digest the runtime used. Compare it with build provenance, signature, scan evidence, and source revision. A familiar tag can point to different bytes after the event.

## How Do Baselines and Entity Context Make Triage Useful?
<!-- section-summary: A useful triage view is organized around identities, assets, artifacts, environments, time, and recent change, and compares observed behavior with a documented normal baseline. -->

Detection quality depends on knowing normal behavior. “New country” means little for a roaming workforce and much more for a non-human deployment identity expected only from a fixed CI trust path.

A baseline does not need to be a perfect statistical model. It can begin as an explicit contract:

```text
identity: ci-payments-deployer
normal source: protected CI federation
normal actions: deploy one Payments Portal workload
normal environment: production during approved run
not normal: interactive login, key creation, IAM changes, shell use
```

Build the triage view around entities rather than separate alert products. A small case summary can include:

| Context | Value |
|---|---|
| Identity | `ci-payments-deployer` |
| Asset | Payments Portal |
| Environment | Production |
| Source | unfamiliar IP or session |
| Cloud actions | enumerated resources |
| Runtime action | interactive shell |
| Pipeline | no matching approved run |
| Recent change | deployment 18 minutes earlier |

Time is one of the strongest correlation dimensions. Events close together may be causally related: credential use, reconnaissance, key creation, deployment change, process start, and outbound connection. Normalize clocks and preserve timestamps accurately.

Environment changes interpretation. A shell in an interactive development Pod can be ordinary. The same shell in an immutable production API with no exec activity is suspicious. A dependency scan failure in a feature branch differs from an unsigned artifact appearing in production.

Asset criticality supplies impact context. The Payments Portal handles sensitive business operations; a test documentation site may have a different urgency even with similar confidence. Data sensitivity, transaction authority, external exposure, recovery difficulty, and regulatory obligations affect triage.

Baselines should evolve from closed cases and legitimate changes. Do not suppress all future activity simply because one occurrence was benign. Encode the exact expected identity, source, action, environment, and time bounds.

Entity views should distinguish owner from current operator. The owning team knows intended behavior, while the person on call can confirm a specific change. Keep escalation contacts current; an accurate alert without a reachable owner loses valuable time.

Baselines can include frequency and sequence as well as allowed actions. A deployment identity may normally assume a role once, update one workload, verify status, and end. Fifty rapid list calls before key creation differs even if some individual verbs are technically permitted.

Seasonality and change windows require evidence, not blanket silence. A month-end reconciliation or scheduled release can change activity, but the detector should still verify expected identity, source, artifact, and action. An attacker may deliberately act during a noisy legitimate window.

High-value identities deserve tighter baselines because their permitted actions are powerful. A broad administrator may be hard to model; reducing its standing permission and replacing it with task-specific temporary roles improves both prevention and detection.

## How Does Triage Update Probability and Test Alternatives?
<!-- section-summary: Triage is probability updating: gather evidence that confirms and disproves competing explanations, correlate independent signals, and keep confidence separate from potential impact. -->

Triage begins with an initial hypothesis and incomplete evidence. Each observation updates the relative plausibility of explanations.

```text
H1: deployment identity was compromised
H2: approved emergency maintenance occurred
H3: runner architecture changed legitimately
H4: detector or identity attribution is wrong
```

Ask what each hypothesis predicts. An approved maintenance event should have an owner, record, time window, source identity, and expected actions. A runner change should appear in configuration and deployment history. Compromise may predict reconnaissance, unusual source, persistence creation, or actions outside normal workflow.

Actively seek disconfirming evidence. Check approved changes, on-call notes, runner registration, network egress, identity issuance, and whether the event maps to the expected automation. A strong case records both supporting and contradicting facts.

Correlation changes signal value. An unfamiliar login alone may be weak. The same identity then listing secrets, creating a credential, and launching a shell within ten minutes is stronger because independent sources support one sequence.

Be careful not to count duplicate telemetry as independent confirmation. A cloud finding and SIEM alert may both derive from the same audit event. Record source lineage so five alerts do not falsely appear to be five observations.

Recent change is another hypothesis source. A deployment five minutes earlier may explain a new process. It can also explain how malicious code entered. Verify the source revision, artifact digest, approval, and caller rather than classifying all post-deployment activity as benign.

Confidence answers how likely the security hypothesis is. Impact answers how harmful it could be if true. A low-confidence signal involving a production signing key may still deserve immediate cautious containment. A high-confidence policy violation in an isolated disposable environment may have lower incident impact.

Triage should preserve uncertainty explicitly. Mark facts, hypotheses, unknowns, and next evidence. This prevents a tentative idea from becoming repeated as established truth in the response channel.

Probability updating should account for evidence quality. A cryptographically linked workflow record can be stronger than a recollection. A host log from the suspected machine may be weaker than protected cloud audit. Record source and reliability rather than treating every line as equal.

Time correlation should allow for ingestion delay and clock skew. The SIEM receipt time may differ from event time. Normalize to a consistent clock and retain original timestamps. Otherwise an apparent cause can appear after its effect.

Seek scope as well as cause. Once one compromised identity is plausible, search for other sessions, regions, accounts, repositories, workloads, keys, and actions. The initial alert may show one event while the actual blast radius is broader.

Disconfirming evidence should address the hypothesis precisely. Finding one approved deployment does not explain an interactive shell outside that workflow. Finding that the source IP belongs to a runner does not prove the runner was uncompromised. Each claim needs a prediction and a matching fact.

## How Should MITRE ATT&CK Support Investigation?
<!-- section-summary: MITRE ATT&CK provides a shared vocabulary for adversary tactics and techniques and helps analysts ask what behavior may come next, but it is not a severity or certainty calculator. -->

MITRE ATT&CK organizes observed adversary behavior into tactics and techniques. It can help describe credential access, valid-account use, discovery, persistence, privilege escalation, defense evasion, lateral movement, collection, and impact.

Mapping the Payments Portal evidence to valid-account use and cloud or container discovery gives teams common language. It also prompts useful questions: if the identity was abused, did the actor create another credential, change policy, disable logging, deploy persistence, or move to another service?

ATT&CK is not a severity calculator. A technique label does not tell you asset criticality, confidence, scope, or current damage. A benign administrator and an attacker can perform behavior with the same technique name.

Use ATT&CK after grounding the case in entities and evidence. “T1078 Valid Accounts” is less useful than “the production CI identity authenticated from an unapproved source outside a workflow and listed sensitive resources.” The mapping summarizes behavior; it should not replace the facts.

ATT&CK is particularly useful for moving from event to hypothesis. One technique suggests possible adjacent behaviors and additional data sources. It can guide a search for persistence, credential creation, workload changes, or defense impairment that the original alert did not include.

Do not force every signal into a technique. Operational mistakes, policy drift, vulnerability findings, and availability events can matter without mapping cleanly to adversary behavior. Use the vocabulary where it improves communication and investigation.

Technique mapping can improve detector coverage review. If the organization relies on deployment identities, ask whether it can observe valid-account use, cloud discovery, credential creation, workload modification, and logging impairment. The goal is not to collect every ATT&CK label but to identify missing evidence along plausible attack paths.

Map behavior at the right specificity and confidence. A generic authentication anomaly may suggest valid-account use, while a verified creation of a second credential supports a persistence hypothesis. Avoid overstating intent merely because a technique description resembles the event.

ATT&CK can also structure handoff. An analyst can state the observed technique-like behavior, evidence, affected entities, and unanswered adjacent questions. Responders receive an investigative map rather than a list of product alert names.

## How Do Confidence, Impact, Severity, and Escalation Differ?
<!-- section-summary: Confidence measures belief, impact measures consequence, severity combines urgency-relevant factors, escalation crosses an operational boundary, and containment can begin before certainty is complete. -->

Confidence and impact are separate axes:

```text
confidence: how strongly does evidence support compromise?
impact: what could or did the behavior affect?
```

Detector severity is an initial rule output. Incident severity is an operational decision informed by current evidence, asset importance, blast radius, active attacker capability, data exposure, safety, legal obligations, and recovery needs.

Severity should answer how urgently someone should care and what response resources are justified. Avoid treating a scanner's “critical” or SIEM's “high” as the final incident classification without context.

Escalation means the problem has crossed an operational boundary. Open an incident from triage if containment requires coordination, scope spans teams, production or sensitive data may be affected, privileged identity abuse is credible, or time-sensitive damage continues.

Containment can begin before certainty is complete. If a production deployment credential may be compromised, the team might freeze deployments for ten minutes, restrict the session, preserve logs, or prepare revocation while investigation continues. The action should be reversible and proportional to potential impact.

Immediate destructive action can also cause harm. Revoking a credential without knowing dependencies may break recovery or production. Balance time, confidence, impact, reversibility, and evidence preservation. Record why the action was chosen.

Severity can change as evidence arrives. A suspicious login may begin medium, escalate when key creation appears, and decrease if a verified approved exercise explains the full sequence. The case record should show these updates rather than only the final label.

Impact assessment should consider both realized and potential harm. No data may yet be known stolen, but a session with authority to change production and disable logging creates serious potential. Conversely, a confirmed violation in a disposable isolated environment can have limited blast radius.

Urgency also depends on attacker capability and persistence. An active valid session or newly created key can continue causing harm, while an expired failed login cannot. Ask whether the actor still has access and whether every persistence path has been identified.

Containment decisions should name the boundary they break: disable one session, revoke a key, remove network reachability, pause one pipeline, quarantine one artifact, or isolate one workload. “Monitor closely” is not containment unless it actually reduces capability.

Escalation should specify the new coordination need: incident commander, platform owner, cloud identity team, legal or privacy review, customer communication, or executive decision. Severity labels are useful only when they trigger understood actions.

## What Does a Complete Alert Triage Loop Look Like?
<!-- section-summary: A complete loop groups evidence, builds a timeline, evaluates alternatives, scores urgency, takes bounded action, records closure, and feeds false positives, false negatives, and incidents back into prevention and detection. -->

A small triage workflow is:

1. Acknowledge and preserve the alert and source evidence.
2. Identify primary identity, asset, environment, and artifact.
3. Build a short normalized timeline across systems.
4. State the leading hypothesis and credible alternatives.
5. Seek confirming and disconfirming evidence.
6. Estimate confidence, impact, blast radius, and urgency.
7. Take proportional reversible containment if time matters.
8. Close with reason, monitor, or escalate to incident response.

A useful note contains alert source, entity, environment, first and last time, evidence, baseline, recent changes, hypotheses, ATT&CK mapping where useful, confidence, impact, decisions, actions, owner, and next review.

For the Payments Portal, the note can connect `ci-payments-deployer`, the unfamiliar session, cloud discovery, shell creation, missing workflow run, current deployed digest, and the decision to pause deployment while identity evidence is preserved.

![Detection triage loop infographic showing collect signals, group case, build timeline, score severity, and escalate or close around a leaked deploy key](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/detection-triage-loop.png)

False positives should feed detection engineering. Identify which assumption failed: baseline too broad, source identity changed, duplicate data, poor threshold, missing enrichment, or legitimate process undocumented. Make the rule more specific without suppressing the suspicious behavior class entirely.

False negatives matter more because harmful activity occurred without a useful alert. Post-incident review should identify missing telemetry, bad correlation, absent asset context, ignored pipeline change, or alert delivery failure. Add verified detection tied to the causal path.

Detection and prevention reinforce each other. A rule that repeatedly catches broad human use of a CI key points toward removing the static key and using workload identity. Admission or least privilege that blocks an action should also produce evidence when attempts occur.

Conversely, prevention requires detection. A policy can be disabled, bypassed, or misconfigured. Monitor changes to the control and attempts against it.

The deeper loop is:

```text
observe
  -> detect
  -> triage
  -> contain or close
  -> learn
  -> improve preventive control, telemetry, baseline, and detector
  -> observe again
```

The sentence to remember is: an alert is an automated hypothesis about observed behavior; triage turns it into an evidence-based operational decision.

Case closure should preserve enough evidence to reproduce the decision. Retain source references or immutable exports, normalized timeline, owner confirmation, change records, analysis, containment, and detector disposition. Avoid copying sensitive values unnecessarily into the ticket.

Review groups of closures, not only individual cases. Repeated benign alerts from the same deployment change indicate a missing baseline or enrichment. Repeated “insufficient evidence” indicates a telemetry gap. Repeated true positives from one static credential indicate a preventive design problem.

Exercise the workflow with known scenarios. Simulate deployment-identity use outside CI, a legitimate emergency deployment, a new runner, and missing audit data. Confirm analysts distinguish them, evidence arrives on time, containment authority exists, and the case record is useful to incident response.

Measure decision quality alongside speed. Fast closure is harmful when evidence is weak; slow escalation is harmful during active compromise. Sample cases for completeness, correct correlation, justified severity, and whether follow-up improvements were delivered.

The first-principles model stays simple: observe reality, form a bounded hypothesis, update it with independent context, act according to confidence and consequence, and use the result to make both the system and the detector less ambiguous next time.

## Check Your Answers

:::expand[How Does Observable Activity Become a Security Alert?]{kind="recap"}
Systems produce telemetry and events; security logic identifies signals and alerts, while triage decides whether the evidence warrants closure, containment, or an incident.
:::

:::expand[Why Is an Alert a Hypothesis Rather Than a Verdict?]{kind="recap"}
A detector makes assumptions about behavior and context, so analysts must explain the full evidence set and close alerts with reasons rather than treating rule output as truth.
:::

:::expand[Which Identity, Cloud, Runtime, and Pipeline Signals Belong Together?]{kind="recap"}
Join identity sessions, cloud actions, runtime behavior, workflow changes, source revisions, artifact digests, approvals, and deployments around stable entities and time.
:::

:::expand[How Do Baselines and Entity Context Make Triage Useful?]{kind="recap"}
Organize a case around identities, assets, environments, artifacts, recent changes, and documented normal behavior so the same event receives its real context.
:::

:::expand[How Does Triage Update Probability and Test Alternatives?]{kind="recap"}
State competing explanations, seek confirming and disconfirming evidence, correlate independent signals, and keep belief in compromise separate from its possible consequence.
:::

:::expand[How Should MITRE ATT&CK Support Investigation?]{kind="recap"}
ATT&CK provides shared language and suggests adjacent adversary behavior to investigate, but it does not calculate certainty, asset impact, or incident severity.
:::

:::expand[How Do Confidence, Impact, Severity, and Escalation Differ?]{kind="recap"}
Confidence measures belief, impact measures consequence, severity guides urgency and resources, escalation starts coordinated response, and bounded containment may precede certainty.
:::

:::expand[What Does a Complete Alert Triage Loop Look Like?]{kind="recap"}
Preserve and correlate evidence, test alternatives, decide urgency, act proportionally, record closure, and feed every outcome back into controls, telemetry, and detectors.
:::
