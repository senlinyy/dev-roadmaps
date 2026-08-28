---
title: "Incident Response and Runbooks"
description: "Coordinate uncertain security incidents with explicit roles, evidence preservation, capability-focused containment, trusted recovery, and practiced runbooks."
overview: "Continue the suspicious production deployment credential case through uncertainty, incident command, facts and hypotheses, severity and blast radius, volatile evidence, containment, revocation and rotation, trusted rebuild, recovery verification, communication, runbook design, and tabletop practice."
tags: ["devsecops", "incident-response", "runbooks", "containment"]
order: 2
id: article-devsecops-compliance-incident-readiness-incident-response-and-runbooks
---

## Table of Contents

1. [Why Is Incident Response a Problem of Controlled Uncertainty?](#why-is-incident-response-a-problem-of-controlled-uncertainty)
2. [How Do Roles, Communication, and Decision Records Coordinate the Response?](#how-do-roles-communication-and-decision-records-coordinate-the-response)
3. [How Should Evidence Be Preserved While It Is Still Volatile?](#how-should-evidence-be-preserved-while-it-is-still-volatile)
4. [How Does Containment Break Attacker Capability?](#how-does-containment-break-attacker-capability)
5. [Why Must Credential Response Include Revocation, Rotation, and Persistence Search?](#why-must-credential-response-include-revocation-rotation-and-persistence-search)
6. [How Do You Recover to a Trusted and Verified State?](#how-do-you-recover-to-a-trusted-and-verified-state)
7. [What Makes an Incident Runbook Executable?](#what-makes-an-incident-runbook-executable)
8. [What Does a Complete Incident Response Loop Look Like?](#what-does-a-complete-incident-response-loop-look-like)
9. [Check Your Answers](#check-your-answers)

Incident response begins when the organization believes harmful activity may require coordinated action. It rarely begins with complete truth. An alert provides evidence, not a fully proven story.

The leaked deployment-credential case can have several explanations:

- the key was exposed but never used;
- an authorized deployment produced unusual logs;
- an attacker used the key for discovery;
- the attacker changed production or created persistence;
- the telemetry is incomplete or misleading.

Responders must act while deciding among them. Time changes the problem: sessions remain active, data can be copied, attackers create new credentials, short-lived processes disappear, logs roll over, and ordinary automation changes systems.

The objective is not merely to “fix the alert.” It is to:

1. limit ongoing and future harm;
2. understand affected identities, systems, data, and time;
3. preserve enough evidence for reliable decisions;
4. restore required service to a trustworthy state;
5. communicate so independent actions do not conflict;
6. learn enough to reduce recurrence and improve the next response.

Keep these questions in view as you work through the lesson:

1. **Why Is Incident Response a Problem of Controlled Uncertainty?**
2. **How Do Roles, Communication, and Decision Records Coordinate the Response?**
3. **How Should Evidence Be Preserved While It Is Still Volatile?**
4. **How Does Containment Break Attacker Capability?**
5. **Why Must Credential Response Include Revocation, Rotation, and Persistence Search?**
6. **How Do You Recover to a Trusted and Verified State?**
7. **What Makes an Incident Runbook Executable?**
8. **What Does a Complete Incident Response Loop Look Like?**

## Why Is Incident Response a Problem of Controlled Uncertainty?
<!-- section-summary: Responders begin without complete truth while damage and evidence change over time, so the objective is to reduce harm and uncertainty without making recovery worse. -->

Actions can themselves cause damage. Revoking a production deployment key may stop an attacker and break recovery automation. Isolating a workload can preserve systems and interrupt customer payments. Restarting a compromised host can remove malicious processes and destroy volatile evidence.

Response therefore balances urgency, impact, reversibility, evidence, and service. It prefers actions that break dangerous capability while preserving options.

Detection remains a hypothesis input. Treat alert rule, source, confidence, and known gaps explicitly. Confirm the primary identity and asset, but do not wait for mathematical certainty while a high-authority session remains active.

Severity allocates scarce resources under uncertainty. Impact and urgency differ. A large potential impact with an inactive expired credential may be serious but less time-critical than an active session changing production. Blast radius asks which accounts, repositories, clusters, artifacts, data sets, and customers could be reached.

The initial declaration should be deliberately small and concrete: suspected production deployment credential misuse beginning at an approximate time, with current evidence and known potential scope. Avoid declaring a complete root cause before investigation. The name should help responders find the right systems without turning a hypothesis into fact.

Time creates competing curves. Attacker opportunity can grow while credential access remains active. Evidence value can decay as containers terminate and logs rotate. Service risk can grow as the team freezes delivery or isolates components. Response decisions should make those curves visible instead of arguing only about whether compromise is “confirmed.”

Uncertainty has categories. Scope uncertainty asks which systems and identities were touched. Cause uncertainty asks how access began. Impact uncertainty asks what was changed or disclosed. Control uncertainty asks whether containment and logging work. Different evidence and owners reduce each category.

The incident objective can change. During the first minutes it may be “stop new production changes while preserving identity evidence.” Later it may become “identify persistence and restore deployment through trusted OIDC.” A clear current objective prevents every responder from optimizing a different phase.

Do not make service restoration the only objective. Restoring the same compromised key and mutable artifact can return availability while preserving attacker capability. Likewise, investigating indefinitely without containing an active credential privileges certainty over harm reduction. The commander balances both.

Blast radius should include what the identity could do, what evidence shows it did, and what downstream access those actions created. Mark those sets separately. Potential access guides search and containment; observed access guides confirmed scope; absence of evidence remains conditional on telemetry coverage.

Set a review cadence. During active containment, decisions may be revisited every few minutes. During recovery, the cadence can slow. Time-boxed checkpoints keep assumptions and owners current and give communications a predictable rhythm.

## How Do Roles, Communication, and Decision Records Coordinate the Response?
<!-- section-summary: Explicit command, technical, communication, and recording roles let people act in parallel while a shared log separates facts, hypotheses, decisions, and actions. -->

Incidents need explicit roles because many people must act simultaneously. Without coordination, two responders can rotate the same secret differently, destroy evidence, make conflicting public statements, or assume someone else owns containment.

An Incident Commander owns coordination and decision flow. The commander does not need to perform every technical action. They maintain objectives, assign work, track risk, resolve conflicts, and decide when the response changes phase.

Other roles can include security investigation, platform or cloud response, application ownership, evidence collection, communications, and a scribe. One person may fill several roles in a small incident, but responsibilities should still be named.

![Response bridge infographic showing incident commander, security lead, platform responder, and scribe feeding a shared decision log](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/response-bridge.png)

Communication is part of the control system. A clear channel tells responders what is known, which systems are frozen, which actions require approval, and what customers or executives have been told. Silence and fragmented side conversations create operational risk.

Separate four record types:

- **Facts:** directly supported observations, such as “access key ending 4XYZ was disabled at 02:24 UTC.”
- **Hypotheses:** possible explanations, such as “the key may have been copied from a repository.”
- **Decisions:** chosen direction and reason, such as “freeze deployments because provenance cannot currently be trusted.”
- **Actions:** completed or assigned work with actor, time, target, and result.

This separation prevents a repeated hypothesis from turning into a false fact. It also lets later reviewers understand why a reasonable decision was made with the evidence available then.

Decision records should include alternatives and expected side effects. If the team delays revocation for five minutes to preserve service, record the dependency being protected, compensating restriction, owner, and stop condition. If it revokes immediately, record the recovery path.

Internal and external communication differ. Technical responders need detailed identity and evidence. Customers may need verified impact, protective action, and updates without unconfirmed speculation or exposed security detail. Legal, privacy, and regulatory stakeholders may have notification obligations.

Communications can contain the incident by stopping risky operator activity: freeze deployments, prevent credential reuse, instruct teams not to restart affected systems, and direct all public statements through one path.

The Incident Commander should maintain a concise situation view: current objective, severity, affected services, known active capabilities, containment status, top unknowns, workstreams, next decision time, and communication commitments. Technical detail remains linked in evidence records rather than overwhelming the coordination channel.

The scribe records time from a normalized source. Chat order is not an incident timeline because messages arrive late and contain recollection. Every key event should carry event time, observation time, and action time when those differ.

Technical leads own investigation quality in their domain, but the commander decides priorities across domains. A cloud investigator may want more session data while the service owner needs a credential decision. Assign explicit deadlines and bring tradeoffs to command rather than allowing silent delay.

Use separate channels for command, technical investigation, and broad updates when the incident size warrants it. Important decisions must return to the shared log. Side conversations are useful for focused work but dangerous as the only location of scope or containment decisions.

Facts should cite evidence. “Key used at 02:01” should link to the protected audit record and identity. Hypotheses should name confidence and what would test them. Actions should include result, not just intent: “disable requested” differs from “authentication attempt verified denied.”

Severity changes should be decisions with reasons. Escalation may bring more responders and leadership attention; de-escalation may release scarce staff. Neither should happen merely because a timer elapsed or alert volume decreased.

Communication must preserve confidentiality. Do not paste active secrets, customer records, or malicious payloads into the main channel. Share access-controlled references and redact only what is unnecessary for the responder's role.

External statements should distinguish confirmed facts, current protective action, customer impact, and next update. Avoid promising a root cause or complete scope before evidence supports it. Trust improves when uncertainty is stated plainly and updates arrive when promised.

## How Should Evidence Be Preserved While It Is Still Volatile?
<!-- section-summary: Collect the most perishable high-value evidence first, preserve it outside potentially compromised systems, and record provenance and handling so later conclusions remain trustworthy. -->

Evidence preservation supports scope, containment, recovery, and later learning. It should begin early because some evidence disappears quickly.

Volatility helps determine collection priority:

```text
running processes, memory, active sessions, network connections
  -> short-lived workload and node state
  -> centralized identity, cloud, cluster, and pipeline logs
  -> durable artifacts, source history, and configuration
```

The exact order depends on risk. An active attacker may justify immediate revocation even if it ends a session that responders wanted to inspect. The runbook should name these tradeoffs.

For the deployment-key incident, preserve:

- the original alert and raw events;
- identity issuance and use records;
- cloud and Kubernetes audit logs;
- pipeline run, approval, runner, and source-revision data;
- artifact digests, signatures, and provenance;
- current workload manifests and runtime inventory;
- process, network, and filesystem observations where safe;
- relevant repository and secret-scanning history;
- decision and action timestamps.

Do not trust a compromised system as the only evidence source. An attacker can modify local logs, timestamps, binaries, and configuration. Prefer protected external logs, control-plane records, immutable artifacts, snapshots, or collection through a trusted responder path.

Evidence collection must not spread the incident. Do not copy malware or credentials into ordinary tickets and chat. Use protected storage, restrict readers, and record hashes or immutable identifiers.

Chain of custody records what was collected, from where, by whom, when, how, where it was stored, and any transformation. This supports legal or regulatory use and everyday technical reliability. A later analyst can distinguish an original log export from a filtered summary.

Preserve negative context too. The absence of a matching deployment approval or expected workflow run can be significant, but record how and where the search was performed. “No record exists” is stronger when coverage and retention are known.

Collection needs stop conditions. Imaging every system can delay containment and overwhelm responders. Prioritize evidence that changes decisions about attacker access, scope, persistence, data impact, and trusted recovery.

For active cloud sessions, collect issuance, assumed role, session name, source, user agent, actions, resources, regions, and error responses. An attacker may probe multiple regions or services. Search using stable credential or session identifiers rather than one IP alone.

Pipeline evidence should include workflow definitions at the relevant revision, triggering event, actor, runner identity, inputs, secret access, logs, produced artifact digests, approvals, and deployment result. Preserve the definition before a repair commit changes what later viewers see.

Kubernetes evidence can include audit records, object histories where available, current manifests, Pod status, image digests, Service Account bindings, exec events, admission decisions, and runtime alerts. A recreated Pod may have the same name but a different UID; retain immutable identifiers.

Volatile runtime collection has risk. Executing commands inside a compromised container can change timestamps, processes, network behavior, and attacker awareness. Decide whether the expected evidence value exceeds that cost. Use node or platform telemetry when it provides a safer view.

Snapshots preserve state but can preserve secrets and personal data too. Label sensitivity, restrict access, define retention, and verify snapshot integrity. A snapshot that nobody can decrypt during recovery is not useful; a snapshot broadly shared creates a second incident.

Hash exported files and record collection tooling or queries. If a log export is later filtered or converted, keep the original and document the derived file. This supports repeatable analysis without requiring every reviewer to trust one analyst's summary.

Evidence gaps are findings. If the team cannot determine which artifact a pipeline deployed or which Service Account a Pod used, record the architecture gap for hardening. During response, state how the gap affects confidence and choose containment accordingly.

Protect the evidence store and access logs. An attacker using a production role should not be able to delete the only cloud audit copy or alter the decision record. Response identities should be independent from suspected application and delivery identities.

## How Does Containment Break Attacker Capability?
<!-- section-summary: Containment reduces the attacker's ability to authenticate, execute, communicate, persist, or affect data while balancing availability, evidence, and reversibility. -->

Containment is not a generic instruction to “lock things down.” It should break a specific attacker capability:

```text
credential -> authenticate
network path -> reach target
permission -> perform action
process -> execute
artifact or workload -> persist
```

Possible actions include disabling the exposed key, revoking sessions, restricting the deployment role, freezing related pipelines, quarantining an artifact digest, isolating a workload's network, blocking a source, or preventing changes to affected resources.

Choose the smallest action that reliably stops harm, then expand as scope becomes clearer. A narrow key revocation can be better than disabling an entire cloud account. If one pipeline is suspect, freeze it without stopping unrelated delivery unless shared infrastructure makes the scope broader.

Containment can be temporary. A network isolation rule buys investigation time. A deployment freeze prevents the attacker or responders from changing evidence. Temporary controls need owners, monitoring, and explicit exit conditions.

Containment should account for attacker adaptation. Disabling one key is insufficient if the actor created another key, assumed a role with a live session, installed a workflow token, changed an identity provider, or deployed a persistent workload.

The action may affect production. Before disabling a key, identify what uses it, how the service continues, and whether an alternative trusted path exists. When time is critical, accept some disruption but record the decision and recovery steps.

Avoid performing containment through the suspected compromised identity or host. Use an independent trusted administrative path. Otherwise an attacker may observe, block, or imitate responder actions.

Verification is part of containment. Confirm the key is rejected, active sessions are invalidated or bounded, the pipeline cannot deploy, the quarantined digest cannot start, and network restrictions apply. Configuration changes alone do not prove capability ended.

Containment strategies can target identity, execution, communication, data, or deployment. Identity containment revokes keys and sessions. Execution containment stops or isolates workloads. Communication containment blocks network edges. Data containment removes write access or freezes destructive operations. Deployment containment prevents new untrusted state. Combining layers is useful when one mechanism is uncertain.

Sequence matters. Preserve high-value volatile evidence, prepare a trusted responder identity, then revoke the suspected credential. If revocation automatically triggers destructive cleanup or prevents audit access, establish alternatives first. In active destructive behavior, skip lower-value collection and stop capability immediately.

Containment should be resistant to the attacker. If the same role can reverse a network block or create a new key, reduce that role's authorization or use an outer organization-level control. Monitor attempts to undo the containment.

Quarantining an image digest prevents redeployment of known suspect bytes, but already running copies may continue. Isolate or replace them according to evidence needs. Quarantining a mutable tag is weaker because the artifact identity can move.

Freezing deployments protects provenance during investigation but can block emergency fixes. Define who may authorize a trusted emergency deployment, which pipeline and artifact evidence it needs, and how the exception is recorded. Do not reopen the suspected workflow casually.

Containment has human edges. Inform operators not to rotate the same key independently, restart affected Pods, or clean up repository history before evidence capture. Central coordination prevents well-intentioned actions from destroying scope evidence.

Record residual capability after each action. A disabled key may leave sessions. Network isolation may leave local data access. A stopped Pod may leave attacker-created cloud resources. Containment is complete only when remaining paths are known and accepted for the next phase.

## Why Must Credential Response Include Revocation, Rotation, and Persistence Search?
<!-- section-summary: Replacing a secret does not invalidate old sessions or attacker-created access, so responders must revoke, rotate dependencies safely, and search the full authority graph for persistence. -->

Credential rotation is more complicated than changing a password. A credential can have active sessions, derived tokens, cached copies, replicas, dependent services, and authority to create replacements.

Revocation comes before or alongside replacement because issuing a new credential does not make the old one stop working. Disable the exposed access key, revoke or expire sessions where the platform permits, remove it from CI and Secret stores, and confirm authentication fails.

Then create or enable the replacement through a trusted path. Update legitimate consumers, verify service, and remove the transitional credential. Do not leave both active indefinitely because migration was successful.

Search for persistence:

- new access keys, tokens, certificates, or SSH keys;
- new users, roles, groups, bindings, or trust relationships;
- changed identity-provider or OIDC configuration;
- new workflows, runners, webhooks, or repository deploy keys;
- changed cloud functions, scheduled tasks, images, workloads, or startup configuration;
- disabled logging or monitoring;
- altered recovery or backup controls.

Assume the attacker may have used the original authority to create another path. Search the whole permission and activity graph, not only the credential record.

Prefer replacing long-lived deployment keys with workload identity and short-lived sessions during hardening, but do not redesign the entire platform during unstable containment unless required. First restore trustworthy operation; then complete durable architecture change through controlled work.

![Contain rotate recover infographic showing evidence preservation, key deactivation, secret removal, OIDC role migration, and deploy verification](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/contain-rotate-recover.png)

Credential response should include downstream secrets the compromised identity could read. If the deployment role accessed a database password or registry token, assume exposure until evidence and architecture support a narrower conclusion. Rotate in dependency order so services remain manageable.

Inventory credential forms before rotation: access key pairs, temporary role sessions, personal tokens, deploy keys, signing keys, registry credentials, Kubernetes tokens, database passwords, certificates, and secrets copied into applications. The exposed key may only be the first visible link.

Revocation semantics differ. Disabling a long-lived access key can be immediate for new requests, while previously issued temporary sessions may remain valid. Changing a password may not terminate existing connections. Rotating a signing key requires verifiers to distrust the old issuer where appropriate. The runbook should know each platform's behavior.

Dependency mapping prevents accidental lockout. Identify every legitimate consumer, but do not trust configuration inventory alone; compare recent usage and owner confirmation. Unknown use is evidence of architecture debt and may justify a staged restriction with close monitoring.

Use a replacement generated and delivered through a trusted system. If the original CI environment may be compromised, creating the new key there repeats the exposure. Prefer a different protected runner or workload-identity path with independently verified configuration.

Rotate high-risk downstream credentials the attacker could obtain, not every organizational secret indiscriminately. Broad emergency rotation can overwhelm teams, cause outages, and hide which values were actually secured. Prioritize by reachable authority and evidence.

Persistence search should include trust policies and policy attachments, not only credential objects. An attacker can grant an existing identity new permission, add itself to a group, alter an OIDC subject condition, or create a workload that continually obtains fresh tokens.

Continue watching the old identity after revocation. Authentication attempts can reveal attacker persistence or automation that still holds the value. Alert on use of replacement credentials from unexpected sources as well, because migration can expose them.

Document completed lineage: compromised credential, sessions issued, resources reached, new access created, replacements delivered, old access invalidated, and evidence of denial. This lets recovery and post-incident work verify that every branch closed.

## How Do You Recover to a Trusted and Verified State?
<!-- section-summary: Recovery restores service from known-good source, artifacts, identities, and configuration, then verifies absence of persistence and correct behavior before restrictions are removed. -->

Recovery is not “turn everything back on.” It establishes a trustworthy operating state after containment.

Prefer rebuilding over repairing compromised infrastructure. A host or container changed by an attacker can retain hidden persistence. Recreate from reviewed source, known-good images, controlled infrastructure definitions, and newly trusted credentials.

For the Payments Portal:

1. confirm the reviewed source revision;
2. verify or rebuild the artifact in a protected pipeline;
3. publish and approve a new immutable digest;
4. repair deployment identity and remove exposed static material;
5. redeploy through the trusted path;
6. verify workloads, configuration, network, and identities;
7. monitor for repeated suspicious behavior;
8. restore paused delivery only after exit criteria pass.

Verification should be adversarial. Do not ask only whether customer requests succeed. Ask whether old credentials fail, unauthorized sessions are gone, unexpected roles or workloads are absent, the deployed digest matches evidence, logging works, and negative security tests pass.

Recovery may expose architectural weakness: missing artifact retention, unknown key consumers, manual infrastructure, no identity inventory, unreliable backups, or inability to trace a deployment to source. Record these as hardening work rather than hiding them with heroic manual repair.

Exit criteria define when the incident can leave active response. They can include contained attacker capability, known scope with acceptable uncertainty, restored critical service, rotated or revoked credentials, trusted artifact and infrastructure, preserved evidence, active monitoring, assigned follow-up work, and communication completed.

An incident is not over merely because alerts stop. The attacker may be quiet, telemetry may be impaired, or containment may have suppressed the signal. Verify control health and run targeted searches through an observation window.

Known-good reconstruction depends on retained inputs. Source revision, dependency locks, base image digest, build environment, infrastructure configuration, policy, and deployment record should all be available. If the original artifact is trustworthy and retained, redeploying the same digest can be safer than an uncontrolled rebuild; if build integrity is in doubt, rebuild through a repaired trusted path and create new provenance.

Eradication removes attacker-created state and the exploited access path. Delete unauthorized identities, workloads, keys, webhooks, scheduled actions, and changed configuration after preserving evidence. Repair the source, workflow, runner, or trust policy that allowed the compromise. Removing only visible malware without closing the entry path invites recurrence.

Recovery order should protect dependencies. Restore identity and logging before enabling deployment. Restore core service with minimal traffic, validate data integrity, then expand. Keep temporary containment until the replacement path has proven normal behavior.

Data verification may require comparing protected records, transaction histories, backups, or external systems. A healthy API response does not prove the attacker did not alter data. Identify authoritative sources and reconciliation procedures before declaring integrity restored.

Backups are useful only if they predate malicious change, can be restored, and do not reintroduce compromised identities or configuration. Test restore in an isolated environment, scan recovered artifacts, and apply repaired access controls before reconnecting production.

Monitor the recovery for old indicators and new anomalies. Compare process, identity, network, deployment, and business behavior with the baseline. An attacker may wait for services to return or use a persistence path missed during initial scope.

Exit criteria should have evidence and owners. “Keys rotated” should identify each key and denial test. “Systems clean” should identify reconstruction source and verification. “Logging restored” should show fresh records arriving. This keeps closure from depending on optimistic language.

After active response, transfer unresolved uncertainty and hardening actions formally. Some questions may remain unanswerable because evidence never existed. Record the limitation, residual risk, and owner rather than keeping the incident open indefinitely or pretending certainty.

## What Makes an Incident Runbook Executable?
<!-- section-summary: A runbook precomputes roles, evidence, decision points, containment, investigation, recovery, exit criteria, stop conditions, and communication without pretending human judgment can be replaced by one script. -->

Runbooks exist because humans perform worse under stress and similar incidents recur. They preserve reasoning before the incident consumes attention.

A runbook is not a shell script. It can contain automation, but it must also describe decisions, dependencies, risk, and escalation. A command such as “delete the key” is unsafe without identifying the key, consumers, evidence needs, rollback, and verification.

A useful shape is:

1. **Trigger:** which alert or condition starts the runbook, and what may be false?
2. **First roles:** Incident Commander, investigator, platform responder, service owner, scribe, and communications.
3. **First evidence:** identity, audit, pipeline, artifact, workload, network, and repository records.
4. **Containment:** capability-focused options, authority, side effects, and verification.
5. **Investigation:** scope, timeline, persistence, data impact, and hypotheses.
6. **Recovery:** trusted rebuild, credential migration, service validation, and monitoring.
7. **Exit criteria:** conditions for containment, recovery, closure, and follow-up.

![Runbook shape infographic showing trigger, roles, evidence, containment, recovery, and exit criteria between alert and trusted state](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/runbook-shape.png)

Runbooks need stop conditions. Examples: stop evidence collection and revoke immediately if destructive activity continues; stop a rotation if the only trusted recovery path would be lost; stop automated isolation if it affects an unrelated safety-critical service; escalate when scope exceeds the incident team's authority.

Include decision records and communications. State who can freeze production, revoke identities, contact external providers, authorize customer messaging, or accept temporary service disruption.

Automation is best for repeatable bounded actions: collect identified logs, snapshot configuration, disable one key, isolate one workload, open a case, or verify a known condition. Human judgment remains necessary for scope, proportionality, legal impact, uncertain evidence, and competing service risk.

The runbook should be executable by someone who did not write it. Use clear prerequisites, safe commands or interfaces, expected outputs, failure paths, ownership, and verification. Avoid undocumented tribal knowledge.

Triggers should include both event and threshold. “Secret scanner finds a cloud key in a repository reachable by others” is clearer than “credential issue.” State when to begin triage, when to declare an incident, and when active use or production scope requires immediate containment.

The first evidence list should be bounded and ordered. Name exact log systems and queries, identity identifiers, pipeline records, artifact evidence, and current configuration. Include how to preserve them and whom to call when access fails.

Containment steps should offer branches. If the credential has no active legitimate use, revoke immediately. If it is the only production path, freeze its permission, prepare a trusted replacement, and use a time-bounded decision checkpoint. Branches encode real operational constraints without turning into vague judgment.

Investigation questions should follow capability: who could read the credential, where it was used, which actions succeeded, what those actions could create, what data was reachable, which persistence paths exist, and what evidence is missing. A generic instruction to “check logs” is not enough.

Recovery steps should name authoritative sources and verification. Rebuild from identified configuration, deploy a digest with known provenance, restore secrets through a trusted path, reconcile data, and test old credentials and unauthorized artifacts negatively.

Stop conditions protect against automation running past uncertainty. A collection script should stop if it changes the target or exposes secrets. An isolation workflow should stop if it affects safety-critical dependencies. A rotation workflow should stop if the replacement is unverified and revocation would eliminate all recovery access.

Runbooks need version, owner, last exercise, supported environments, required permissions, and linked systems. A correct procedure for an old cloud account or renamed pipeline can be worse than no procedure under pressure.

After every use, compare the documented path with what responders actually did. Missing steps can indicate improvisation, environment drift, or a better method. Update and retest rather than appending an unstructured incident narrative.

## What Does a Complete Incident Response Loop Look Like?
<!-- section-summary: The complete loop moves from evidence through coordination, containment, scope, trusted recovery, verification, communication, and learning, while practiced runbooks surround and improve every phase. -->

Tabletop exercises test the runbook without waiting for a real compromise. Present a production key found in a repository and used from an unusual source. Ask who declares the incident, what evidence is collected first, whether the key is revoked immediately, which systems it can reach, how deployment continues, and who communicates.

Exercises reveal missing contacts, permissions, logs, backups, artifact history, revocation APIs, and decision authority. Update the runbook and architecture after each exercise.

Incident response is an architectural quality. Compare two systems:

```text
System A
  manual deployment
  long-lived shared keys
  mutable artifacts
  local short-lived logs
  unknown ownership

System B
  protected automated deployment
  short-lived workload identity
  immutable traceable artifacts
  centralized audit and runtime evidence
  tested recovery and named owners
```

System B is not immune to incidents. It is easier to investigate, contain, rebuild, and verify. Observability and identity architecture become security infrastructure.

The response loop is:

```text
detect evidence
  -> declare and coordinate
  -> preserve volatile evidence
  -> contain attacker capability
  -> investigate scope and persistence
  -> eradicate compromised access and state
  -> recover from known-good sources
  -> verify adversarially
  -> communicate and close
  -> harden systems and runbooks
```

The runbook surrounds the loop with prepared roles, evidence paths, decisions, safe actions, stop conditions, and exit criteria.

Eight constraints explain why this structure exists:

1. Complete truth is not initially available.
2. Damage may increase with time.
3. Response actions can create damage.
4. Many people must act simultaneously.
5. Evidence disappears.
6. Compromised systems cannot be fully trusted.
7. Humans perform worse under stress.
8. Similar failures recur.

The deepest model is controlled learning under pressure: reduce harmful capability and uncertainty fast enough to protect the organization, while preserving enough trustworthy evidence and coordination to recover correctly.

The complete loop needs prepared authority. Responders must be able to read protected logs, revoke identities, freeze deployment, isolate workloads, quarantine artifacts, access backups, and communicate without using the suspected credential. Test this access regularly and keep it outside ordinary application roles.

Observability quality determines which decisions are possible. If the team can link identity session to workflow, artifact, deployment, process, network, and data action, scope can be precise. If those links are missing, containment must be broader and recovery less certain. Investing in evidence before an incident reduces both harm and downtime.

Identity architecture likewise determines containment cost. A dedicated short-lived deployment identity can be revoked without affecting unrelated services. A shared long-lived administrator key forces a choice between continued attacker access and widespread outage. Least privilege is incident-response design.

Artifact and infrastructure immutability determine recovery quality. A retained signed digest and declarative environment can be reconstructed and compared. A manually modified server with an unknown binary must be repaired through guesswork or replaced with more disruption.

Tabletops should vary assumptions: the key is exposed but unused; active destructive API calls continue; audit logging is missing; the pipeline is compromised; customer data may be affected; the identity is shared by several services. Different branches reveal whether the runbook contains reasoning rather than one happy path.

Measure response capabilities: time to declare, time to preserve key evidence, time to break attacker capability, time to establish scope, time to recover trusted service, completeness of decision records, and follow-up completion. Do not optimize one timer by skipping evidence or verification.

Finally, practice communication failures. The service owner may be unavailable, an external provider may respond slowly, or customer updates may be required before complete scope. Delegates, contact paths, preapproved language, and decision authority make the control system resilient to human absence.

## Check Your Answers

:::expand[Why Is Incident Response a Problem of Controlled Uncertainty?]{kind="recap"}
Responders begin with incomplete truth while damage and evidence change over time, so they must reduce harm and uncertainty without destroying recovery options.
:::

:::expand[How Do Roles, Communication, and Decision Records Coordinate the Response?]{kind="recap"}
Named command, technical, communication, and recording roles coordinate parallel work, while facts, hypotheses, decisions, and actions remain explicitly separate.
:::

:::expand[How Should Evidence Be Preserved While It Is Still Volatile?]{kind="recap"}
Collect perishable decision-changing evidence first, store it outside compromised systems, preserve source and handling, and avoid spreading credentials or malware.
:::

:::expand[How Does Containment Break Attacker Capability?]{kind="recap"}
Containment should remove a specific ability to authenticate, execute, communicate, persist, or affect data, then verify that the ability truly ended.
:::

:::expand[Why Must Credential Response Include Revocation, Rotation, and Persistence Search?]{kind="recap"}
Replacement alone does not invalidate old sessions or attacker-created access, so revoke, migrate legitimate consumers, and search the full identity and persistence graph.
:::

:::expand[How Do You Recover to a Trusted and Verified State?]{kind="recap"}
Rebuild from reviewed source and immutable artifacts with trusted identities, then verify service, negative security properties, control health, and observation before ending response.
:::

:::expand[What Makes an Incident Runbook Executable?]{kind="recap"}
A useful runbook precomputes triggers, roles, evidence, decision points, safe containment, investigation, recovery, stop conditions, communications, and exit criteria.
:::

:::expand[What Does a Complete Incident Response Loop Look Like?]{kind="recap"}
Coordinate from detection through volatile evidence, capability containment, scope, trusted recovery, adversarial verification, communication, and hardening, then exercise the runbook again.
:::
