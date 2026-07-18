---
title: "EU AI Act Operational Readiness"
description: "Prepare an MLOps evidence chain for EU AI Act scoping, risk classification, provider and deployer roles, transparency, high-risk controls, and changing application dates."
overview: "The EU AI Act uses a risk-based regulatory structure. This tutorial shows how a credit team turns scoping questions into an inventory record, control matrix, release evidence, and ongoing review while legal specialists own the final interpretation."
tags: ["MLOps", "advanced", "governance", "eu-ai-act"]
order: 3
id: "article-mlops-governance-and-responsible-ai-eu-ai-act-operational-readiness"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/standards-and-compliance/02-eu-ai-act-operational-readiness.md
---


## What Operational Readiness Means
<!-- section-summary: EU AI Act readiness connects legal scoping with inventories, technical controls, human procedures, evidence, and ongoing change management. -->

The **EU AI Act**, Regulation (EU) 2024/1689, creates a risk-based legal framework for artificial intelligence in the European Union. Operational readiness means that an organization can identify AI systems in scope, determine its role for each system, classify uses, implement the controls that apply, and produce reliable evidence. The work spans product, legal, risk, security, data, ML engineering, procurement, support, and internal assurance.

This tutorial gives technical and operational guidance and cannot serve as legal advice. The regulation, delegated or implementing acts, Commission guidelines, harmonized standards, national enforcement practice, and facts of a particular use can change the conclusion. A qualified legal or compliance professional should own the formal applicability assessment.

A supporting example follows **BrightHarbor Bank**, which uses a machine-learning score during online consumer credit applications. A credit officer reviews the score with income, affordability, identity, and fraud information. BrightHarbor buys a commercial decisioning platform, trains part of the scoring model internally, and offers applications to people in several EU member states.

The article follows the work in the order a production team needs it: record the intended purpose and actors, classify the use, track effective dates, translate applicable duties into controls, retain release evidence, and monitor operation and change.

## Start with Scope, Role, and Intended Purpose
<!-- section-summary: An applicability record should describe where the system is offered or used, each organization's role, the intended purpose, users, affected people, and supplied components. -->

The first readiness artifact is an applicability record. BrightHarbor avoids starting from a model name because the regulation concerns an AI system and its use. The record covers the model, preprocessing, decision rules, user interface, human review, vendor platform, monitoring, and integration with the lending process.

**Intended purpose** describes the use for which a provider designs an AI system, including the context and conditions of use. It influences classification, instructions, evaluation, monitoring, and change control. BrightHarbor writes a narrow purpose: support trained credit officers who assess consumer credit applications in named EU markets. The record excludes autonomous final decisions, employment decisions, and use by unrelated affiliates.

The Act assigns duties according to roles such as **provider**, **deployer**, **importer**, and **distributor**. A provider develops an AI system or has it developed and places it on the market or puts it into service under its name or trademark. A deployer uses an AI system under its authority, with personal non-professional use treated differently. An organization can hold different roles for different components or uses. Contract language alone cannot settle the role when actual activities point elsewhere.

BrightHarbor records the facts for counsel to assess:

```yaml
system_id: ai-system-credit-assist-004
intended_purpose: Support trained officers assessing EU consumer credit applications.
markets: [IE, FR, DE]
affected_people: consumer_credit_applicants
human_decision: credit_officer
components:
  - name: brightscore-v7
    developed_by: BrightHarbor Bank
    branded_by: BrightHarbor Bank
  - name: decision-workbench
    supplied_by: NorthQuay Software
    contract_role_claim: provider
potential_roles_for_review:
  brightscore-v7: provider_and_deployer
  decision-workbench: deployer
legal_owner: eu-ai-counsel
technical_owner: lending-ml-platform
last_reviewed: 2026-07-10
```

The legal owner records the conclusion, rationale, sources, assumptions, and next review date. The technical owner receives concrete control requirements. If BrightHarbor changes the purpose, branding, model, or integration, the workflow reopens the role and classification review.

## Classify the Use Case Carefully
<!-- section-summary: Classification should test prohibited practices, high-risk categories, transparency duties, general-purpose AI duties, and any sector-specific rules. -->

The Act uses several regulatory categories. Some practices are prohibited. Certain systems can qualify as high-risk through regulated-product routes or listed use cases. Some systems and outputs carry transparency duties. General-purpose AI models have a separate set of provider duties. Many uses fall outside those categories while other EU and national laws still apply.

BrightHarbor's legal team reviews the credit use against Annex III and the detailed conditions in the regulation. Creditworthiness evaluation of natural persons can fall within a listed high-risk area, subject to the regulation's exact wording and exceptions. The team also considers consumer-credit, data-protection, equality, financial-services, and automated-decision rules. An AI Act classification never replaces those parallel reviews.

The classification memo should preserve evidence instead of returning a single label:

```json
{
  "system_id": "ai-system-credit-assist-004",
  "assessment_date": "2026-07-10",
  "prohibited_practice_review": {
    "status": "reviewed",
    "conclusion": "none_identified",
    "owner": "eu-ai-counsel"
  },
  "high_risk_review": {
    "candidate_route": "Annex III creditworthiness use",
    "working_classification": "high_risk",
    "assumptions": [
      "system materially influences consumer credit assessment",
      "no documented exception applies"
    ]
  },
  "parallel_reviews": ["GDPR", "consumer_credit", "equality", "financial_services"],
  "next_review_trigger": "purpose, model, vendor, market, or law changes"
}
```

A working classification lets engineering prepare conservatively while legal review continues. The memo should cite the exact consolidated legal text and current official guidance used on the assessment date.

## Track the Application Timeline
<!-- section-summary: The Act applies in stages, and July 2026 implementation work requires teams to track final adoption, Official Journal publication, and entry into force. -->

The AI Act entered into force on 1 August 2024. Official Commission guidance describes staged application. Prohibited practices and AI literacy provisions have applied since 2 February 2025. Governance rules and obligations for providers of general-purpose AI models started applying on 2 August 2025. Article 50 transparency obligations have an application date of 2 August 2026. Commission enforcement of the full obligations for providers of general-purpose AI models also changes from that date, while special transition rules can apply to models placed on the market earlier.

High-risk dates need extra care in July 2026. The European Parliament gave final approval to the Digital Omnibus on AI on 16 June 2026, and the Council gave its final approval on 29 June 2026. The adopted text sets 2 December 2027 for stand-alone high-risk systems and 2 August 2028 for high-risk systems embedded in products. The Council stated that Official Journal publication would follow and that the amending regulation would enter into force on the third day after publication. BrightHarbor therefore tracks the adopted dates while counsel still verifies Official Journal publication, entry into force, the consolidated EUR-Lex text, and any transition rule that applies to the credit system.

```yaml
obligation_id: EUAI-HIGH-RISK-CREDIT
legal_text_source: EUR-Lex consolidated Regulation 2024/1689
commission_status_source: AI Act implementation timeline
source_checked_at: 2026-07-12
co_legislator_adoption_verified: true
official_journal_publication_verified: false
internal_readiness_date: 2026-08-02
legal_owner: eu-ai-counsel
review_frequency: monthly_until_stable
```

BrightHarbor keeps the earlier internal readiness date because the controls also support safe lending and other legal duties. This choice gives the engineering team a stable plan while counsel updates the binding-date field when formal legal text changes.

## Turn High-Risk Requirements into Engineering Work
<!-- section-summary: High-risk readiness connects risk management, data governance, documentation, records, human oversight, accuracy, robustness, cybersecurity, and quality management to named controls. -->

For a system treated as high-risk, the team maps applicable requirements into its delivery and operating processes. Key areas include risk management, data and data governance, technical documentation, record-keeping, information for deployers, human oversight, accuracy, robustness, cybersecurity, and provider quality-management activities. Exact duties depend on role and facts, so the legal control matrix remains the source of truth.

BrightHarbor turns those areas into controls:

| Control | Practical implementation | Evidence |
| --- | --- | --- |
| Risk management | Maintain risk scenarios, measures, treatments, residual decisions | Versioned risk register and approvals |
| Data governance | Document sources, relevance, collection, labels, gaps, segments, quality | Dataset manifest and validation report |
| Technical documentation | Describe purpose, design, components, metrics, limits, change history | Versioned system dossier |
| Automatic logs | Record version, request, output, timing, user action, override, errors | Protected event records with retention policy |
| Human oversight | Train officers, display confidence and reasons, define override and escalation | User procedure, training record, usability test |
| Accuracy and robustness | Set metrics by segment, stress test, define acceptable limits | Signed evaluation report |
| Cybersecurity | Threat model data/model pipeline, control access, verify artifacts | Threat assessment, scan and provenance reports |
| Quality management | Define change, supplier, incident, complaint, audit, corrective-action processes | Process records and management review |

The MLOps pipeline enforces release-critical items:

```yaml
release_gates:
  - id: data-governance
    command: python -m assurance.check_dataset_manifest evidence/dataset.json
  - id: segmented-evaluation
    command: python -m assurance.check_metrics evidence/evaluation.json
  - id: human-oversight
    command: python -m assurance.check_training_status users/credit-officers.csv
  - id: artifact-integrity
    command: cosign verify-blob --key env://MODEL_VERIFY_KEY --bundle evidence/model.sigstore.json model/model.bin
  - id: legal-approval
    required_record: approvals/eu-ai-applicability.json
```

Automation verifies format and status. Accountable reviewers evaluate substance, exceptions, and residual risk. A failing gate blocks production and opens a corrective-action ticket with an owner and due date.

## Prepare Transparency and Human Procedures
<!-- section-summary: Transparency work should provide understandable information to users and affected people, while human oversight gives trained staff authority and practical tools. -->

**Transparency** means providing the information required for people to understand that AI is involved, use the system correctly, or identify certain AI-generated content. Article 50 covers specific situations, including some direct human interaction and generated or manipulated content. The exact duty and exceptions depend on the system. BrightHarbor's credit-assist tool also needs information that supports deployer use and human oversight if treated as high-risk.

The officer interface identifies the model version, score meaning, input freshness, important reason codes, known limits, and escalation route. It avoids presenting the score as a probability of default unless calibration supports that interpretation. Officers can pause, override, or request manual assessment, and each action records a reason.

BrightHarbor trains users before granting access:

```json
{
  "course": "credit-assist-v7-oversight",
  "learner": "officer-1842",
  "completed_at": "2026-07-08T14:11:00Z",
  "topics": [
    "intended purpose",
    "score limits",
    "automation bias",
    "override procedure",
    "applicant escalation",
    "incident reporting"
  ],
  "assessment_score": 92,
  "access_granted": true
}
```

AI literacy obligations have applied since February 2025. A practical literacy program varies by role. Executives need accountability and risk information. Engineers need data, evaluation, security, and change controls. Front-line users need limits, oversight, and escalation. Procurement teams need supplier questions and contract controls.

## Maintain Technical Documentation Evidence
<!-- section-summary: A technical documentation packet should let a reviewer connect purpose, design, data, versions, evaluation, controls, instructions, and release decisions. -->

BrightHarbor keeps a versioned dossier for each released system version. The packet includes the intended purpose, role and classification memo, architecture, component inventory, development methods, data sources, evaluation design, segmented results, accuracy and robustness limits, cybersecurity controls, logs, human-oversight design, instructions, monitoring plan, incident process, change history, and approvals.

The release manifest connects exact artifacts:

```json
{
  "system_id": "ai-system-credit-assist-004",
  "release_id": "credit-assist-2026-07-12.1",
  "git_commit": "7f19c26",
  "container_digest": "sha256:9b4d...",
  "model_digest": "sha256:42ac...",
  "dataset_id": "credit-features-2026-06-30",
  "evaluation_report": "s3://assurance/credit-assist/2026-07-12/evaluation.json",
  "risk_register_version": "18",
  "instructions_version": "7.2",
  "rollback_release": "credit-assist-2026-05-20.3",
  "approvals": ["model-validation", "security", "business-owner", "eu-ai-counsel"]
}
```

Every referenced object should have access controls, retention, integrity checks, and an owner. The team should be able to rebuild the packet from source systems. Manual uploads with unclear origin create weak evidence.

## Operate Changes, Incidents, and Monitoring
<!-- section-summary: Readiness continues after release through monitoring, serious-incident assessment, complaint handling, supplier review, corrective action, and controlled changes. -->

Production monitoring covers service health, data quality, score distribution, outcome metrics, segments, overrides, complaints, access, and security events. Delayed lending outcomes require a defined label join and review schedule. Human overrides can show useful disagreement, though override rates need context because staff behavior can also drift.

Every significant change triggers impact analysis. BrightHarbor reviews changes to intended purpose, countries, applicant populations, features, label definitions, model family, thresholds, vendor components, user interface, and human decision process. The release ticket records whether legal role, classification, conformity work, instructions, or monitoring must change.

Incident triage includes regulatory assessment. The on-call engineer preserves logs and stops harmful processing when the runbook calls for it. Risk and legal owners evaluate reporting duties and timelines. The incident record links the affected versions, people, harm indicators, containment, root cause, communications, and corrective actions.

Supplier changes receive the same attention. BrightHarbor requires NorthQuay Software to notify it about material model, platform, security, subprocessors, and documentation changes. A version upgrade enters staging, receives compatibility and risk testing, and moves to production only after the evidence packet updates.

## Run a Readiness Review
<!-- section-summary: A readiness review tests traceability from legal conclusion to implemented control, current evidence, owner, and response procedure. -->

The review board chooses several requirements and follows them end to end. For human oversight, it checks the legal mapping, interface design, training records, access rule, override logs, and escalation exercise. For data governance, it checks the source inventory, quality thresholds, segment coverage, exceptions, and approval. For cybersecurity, it checks the threat model, artifact verification, access records, vulnerabilities, and incident exercise.

A simple status report keeps gaps explicit:

```yaml
readiness_review: EUAI-2026-Q3
system_id: ai-system-credit-assist-004
status: conditional
open_actions:
  - id: ACTION-91
    gap: French-language officer instructions lack the v7 override example.
    owner: lending-operations-training
    due: 2026-07-22
    release_impact: block_FR_rollout
  - id: ACTION-94
    gap: Supplier notification clause excludes model-card changes.
    owner: technology-procurement
    due: 2026-08-15
    release_impact: existing_release_risk_accepted_until_due_date
```

Conditional decisions need limits, owners, due dates, and escalation. “Accepted risk” without a named authority and expiry creates a permanent gap.

## Common Mistakes
<!-- section-summary: Readiness programs lose reliability when they use a single compliance label, ignore organizational roles, freeze old timelines, or separate documents from production systems. -->

One mistake is marking a model “EU AI Act compliant” without recording role, purpose, classification, legal basis, version, and scope. Another is assigning the entire program to ML engineers. Engineers operate many controls, while product, legal, risk, security, procurement, operations, and leadership retain essential decisions.

Teams also copy an old timeline into a slide deck and stop monitoring official sources. July 2026 has active implementation changes, guidance, codes, and legislative work. BrightHarbor dates every source check and separates enacted text from policy proposals.

A further mistake is treating documentation as a final writing exercise. The strongest dossier draws from the model registry, data catalog, CI system, identity platform, monitoring stack, incident system, and approval workflow. Source-linked evidence stays easier to update and test.

Finally, avoid assuming a human click solves oversight. Users need competence, authority, time, understandable information, and a practical escalation route. Test the workflow with realistic cases and record the findings.

## Putting It Together
<!-- section-summary: Operational readiness links a legally owned applicability decision to inventory, controls, release evidence, user procedures, monitoring, and change review. -->

BrightHarbor starts with the whole credit-assist system and records its intended purpose, actors, markets, and affected people. Legal specialists own the role and classification conclusion. The team tracks staged application dates from current primary sources and keeps internal readiness work moving through legal uncertainty.

Engineering then implements the approved control matrix: governed data, segmented evaluation, traceable artifacts, automatic logs, human oversight, security, monitoring, and rollback. The release packet ties those controls to exact versions and approvals. Operational reviews watch outcomes, incidents, complaints, supplier changes, and new guidance. This workflow gives the organization a defensible evidence chain and a practical way to improve it.

## References

- [EUR-Lex: Regulation (EU) 2024/1689, the Artificial Intelligence Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- [European Commission AI Act overview and current application timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [European Commission: Navigating the AI Act](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act)
- [European Commission: Article 50 transparency guidance process](https://digital-strategy.ec.europa.eu/en/news/commission-opens-consultation-draft-guidelines-ai-transparency-obligations)
- [European Commission: Transparency Code of Practice FAQ, July 2026](https://digital-strategy.ec.europa.eu/en/faqs/signing-code-practice-transparency-ai-generated-content)
- [European Commission: Obligations for general-purpose AI providers](https://digital-strategy.ec.europa.eu/en/faqs/guidelines-obligations-general-purpose-ai-providers)
- [European Parliament final approval of the Digital Omnibus on AI, 16 June 2026](https://oeil.europarl.europa.eu/oeil/en/document-summary?id=1905596)
- [Council final approval and publication next steps, 29 June 2026](https://www.consilium.europa.eu/en/policies/artificial-intelligence-act/timeline-artificial-intelligence/)
