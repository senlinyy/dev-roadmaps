---
title: "AI System Inventory and Impact Assessments"
description: "An AI inventory gives every complete system a stable identity and lifecycle record, linking purpose, owners, components, versions, environments, dependencies, evidence, and status without copying every artifact."
overview: "An AI inventory gives every complete system a stable identity and lifecycle record, linking purpose, owners, components, versions, environments, dependencies, evidence, and status without copying every artifact. A mature inventory can answer scope, ownership, risk, dependency, approval, monitoring, and reassessment questions programmatically and connect them to standards such as ISO/IEC 42001 and 42005."
tags: ["MLOps", "advanced", "governance", "inventory", "impact-assessment"]
order: 2
id: "article-mlops-governance-and-responsible-ai-ai-inventory-impact-assessments-third-party-risk"
aliases: ["ai-inventory-impact-assessments-third-party-risk", "roadmaps/mlops/modules/governance-and-responsible-ai/standards-and-compliance/03-ai-inventory-impact-assessments-third-party-risk.md"]
---

## Table of Contents

1. [What Must an AI Inventory Record about the Whole System and Its Lifecycle?](#what-must-an-ai-inventory-record-about-the-whole-system-and-its-lifecycle)
2. [How Does an Impact Assessment Connect Purpose, Stakeholders, Benefits, Harms, and Causal Paths?](#how-does-an-impact-assessment-connect-purpose-stakeholders-benefits-harms-and-causal-paths)
3. [How Do Scale, Reversibility, Misuse, Risk Assessment, and Model Validation Differ?](#how-do-scale-reversibility-misuse-risk-assessment-and-model-validation-differ)
4. [How Should Risk Tiers and Third-Party Dependencies Change Governance Depth?](#how-should-risk-tiers-and-third-party-dependencies-change-governance-depth)
5. [How Do Change Triggers, Ownership, Discovery, and Evidence Keep the Inventory Current?](#how-do-change-triggers-ownership-discovery-and-evidence-keep-the-inventory-current)
6. [How Does Production Evidence Connect Impacts to Controls, Residual Risk, and No-Deploy Decisions?](#how-does-production-evidence-connect-impacts-to-controls-residual-risk-and-no-deploy-decisions)
7. [How Should Retirement, History, and Shared Identity Close the Governance Loop?](#how-should-retirement-history-and-shared-identity-close-the-governance-loop)
8. [What Can a Mature Inventory and Impact-Assessment System Answer Automatically?](#what-can-a-mature-inventory-and-impact-assessment-system-answer-automatically)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An organization cannot review the impact of an AI system it cannot locate. A model registry may list one artifact, while the real product also includes data sources, thresholds, interfaces, suppliers, human decisions, monitored outcomes, and several releases owned by different teams.

An **AI system inventory** is the control-plane map of that complete system. An **impact assessment** uses the map to examine who is affected, how benefits and harms can arise, which controls address them, and what residual impact remains. Both records must change as the system changes.

The questions below follow one stable system identity from discovery through impact analysis, production evidence, reassessment, and retirement:

1. **What Must an AI Inventory Record about the Whole System and Its Lifecycle?**
2. **How Does an Impact Assessment Connect Purpose, Stakeholders, Benefits, Harms, and Causal Paths?**
3. **How Do Scale, Reversibility, Misuse, Risk Assessment, and Model Validation Differ?**
4. **How Should Risk Tiers and Third-Party Dependencies Change Governance Depth?**
5. **How Do Change Triggers, Ownership, Discovery, and Evidence Keep the Inventory Current?**
6. **How Does Production Evidence Connect Impacts to Controls, Residual Risk, and No-Deploy Decisions?**
7. **How Should Retirement, History, and Shared Identity Close the Governance Loop?**
8. **What Can a Mature Inventory and Impact-Assessment System Answer Automatically?**

## What Must an AI Inventory Record about the Whole System and Its Lifecycle?
<!-- section-summary: An AI inventory gives every complete system a stable identity and lifecycle record, linking purpose, owners, components, versions, environments, dependencies, evidence, and status without copying every artifact. -->

An AI inventory gives every complete system a stable identity and lifecycle record, linking purpose, owners, components, versions, environments, dependencies, evidence, and status without copying every artifact.

The cleanest way to understand these two mechanisms is to begin with two unavoidable governance questions:

**1. What AI systems do we actually have?**
**2. What can each of those systems do to people, organizations, or society?**

The **AI system inventory** answers the first question. The **AI impact assessment** answers the second. Everything else—risk tiering, approval authority, testing depth, monitoring, audits, incident response, regulatory mapping, retirement—depends on having reliable answers to those two questions. NIST's AI RMF explicitly calls for mechanisms to inventory AI systems according to organizational risk priorities, while ISO/IEC 42005:2025 provides a lifecycle-oriented framework for identifying, evaluating, and documenting how AI systems and foreseeable applications can affect individuals, groups, and society. ([NIST AI Resource Center][1]) Imagine an organization has:

* 40 internally developed ML models,
* 15 vendor AI products,
* several LLM applications,
* hundreds of employees using general-purpose AI tools,
* models embedded inside conventional applications,
* experiments running in notebooks,
* old systems nobody remembers,
* and business teams procuring new AI SaaS products.

Management announces:

"All high-risk AI must undergo Responsible AI review."

There is an immediate problem.

- **Which systems are "all AI"?**

Unless the organization knows what exists, the policy cannot actually operate. In mathematical terms, suppose the true set of AI systems currently used by the organization is:

$$
A_{\text{real}}
$$

but governance knows only:

$$
A_{\text{known}}
$$

Then:

$$
A_{\text{shadow}}
=
A_{\text{real}}-A_{\text{known}}
$$

Anything in $$A_{\text{shadow}}$$ is effectively outside the governance system. So before sophisticated fairness testing, explainability, model monitoring, or risk committees, Responsible AI needs a more primitive capability:

$$
\boxed{\text{Know what you are governing}}
$$

That is why the inventory exists. An AI inventory is sometimes misunderstood as:

"a spreadsheet containing models."

That is too narrow. NIST describes an AI system inventory as an organized database of artifacts relating to AI systems or models and notes that it can connect system documentation, responsible actors, data dictionaries, incident-response information, implementation artifacts, and other evidence useful for maintenance and risk management. ([NIST AI Resource Center][1]) A better definition is:

> **The AI inventory is the authoritative index of governable AI systems and their accountability relationships.**

It should let management answer questions such as:

* How many AI systems are operating
* Which are customer-facing
* Which can affect employment, credit, health, safety, rights, or access to services
* Which use third-party foundation models
* Who owns each system
* Which systems are currently in production
* Which have not been reviewed recently
* Which systems have unresolved exceptions
* Which impact assessments are outdated
* Which systems would be affected if Vendor X changes its model
* Which system generated a particular production decision

That makes the inventory much closer to a **control-plane database** than a documentation archive. This is probably the most important design decision. Suppose a lender uses:

```text
Applicant
    ↓
Application form
    ↓
Data verification
    ↓
Credit-risk model
    ↓
Probability of default
    ↓
Business threshold
    ↓
Human/manual review
    ↓
Approve / reject
    ↓
Explanation + appeal
```

If the inventory contains only:

`xgboost_credit_model_v27.pkl`

you have inventoried the wrong thing. The real object creating consequences is:

$$
\text{AI system}
=
\text{model}
+
\text{data}
+
\text{decision logic}
+
\text{people}
+
\text{interfaces}
+
\text{operating environment}
$$

The same model can produce radically different risks depending on how it is used. A model that predicts probability of repayment could be used:

* as one advisory signal for a trained analyst,
* as an automatic rejection mechanism,
* for marketing prioritization,
* for credit pricing,
* or for debt collection.

The underlying model might remain unchanged. The impact does not. Therefore the inventory's central unit should usually represent a **system/use case in context**. Individual models, datasets, endpoints, prompts, vendors, and components can then sit beneath that system. Suppose the lending system is assigned:

```text
AI-SYS-004217
```

That identifier should survive:

* model retraining,
* infrastructure migration,
* changes in model version,
* changes in cloud provider,
* replacement of one component,
* changes in team personnel.

Why?

Because governance is interested in the continuing **identity of the system**, while engineering frequently creates new versions of its components.

For example:

```text
AI-SYS-004217                    ← governed system

├── model:v14
├── model:v15
├── model:v16
├── decision-policy:v8
├── feature-pipeline:v31
├── impact-assessment:IA-004217-06
├── risk-assessment:RA-004217-11
└── production-deployment:DEP-88210
```

You do not want a new inventory record every time the model retrains. But you *do* want to know exactly which component versions constitute the currently approved system. The stable system identifier is far more valuable when propagated into engineering systems.

For example:

```text
AI Inventory
AI-SYS-004217
       │
       ├────────► Git repository
       │          system_id = AI-SYS-004217
       │
       ├────────► CI/CD pipeline
       │          system_id = AI-SYS-004217
       │
       ├────────► Model registry
       │          system_id = AI-SYS-004217
       │
       ├────────► Cloud endpoint
       │          tag: AI-SYS-004217
       │
       ├────────► Monitoring
       │          system_id = AI-SYS-004217
       │
       ├────────► Incident management
       │          affected_system = AI-SYS-004217
       │
       └────────► GRC / approvals
                  system_id = AI-SYS-004217
```

Now governance records and engineering reality can be joined. This enables questions such as:

Show every production endpoint belonging to Tier-1 AI systems.

or:

Show every production AI endpoint for which no current impact assessment exists.

or:

Which systems are using model version `vendor-X-2026-08-17`

Without common identifiers, answering these questions becomes manual reconciliation. The inventory does not need to contain every piece of evidence. It needs enough information to identify the system, govern it, and locate the evidence. A useful conceptual record contains several groups.

| Area                 | Example information                                               |
| -------------------- | ----------------------------------------------------------------- |
| **Identity**         | System ID, name, description                                      |
| **Purpose**          | Intended use, business objective, prohibited uses                 |
| **Lifecycle**        | Proposed, development, validation, production, suspended, retired |
| **Ownership**        | Business owner, technical owner, risk owner                       |
| **Context**          | Users, geography, business process, deployment environment        |
| **Decision role**    | Advisory, ranking, recommendation, automated decision             |
| **Affected parties** | Customers, employees, applicants, general public                  |
| **AI components**    | Models, foundation models, external AI services                   |
| **Data**             | Major data domains/categories and linked datasets                 |
| **Impact/risk**      | Risk tier, impact-assessment status                               |
| **Controls**         | Required governance/control profile                               |
| **Approval**         | Current approval status and authority                             |
| **Operations**       | Production endpoints, monitoring links                            |
| **Third parties**    | Vendors and externally supplied components                        |
| **Changes**          | Last material change/reassessment                                 |
| **Retirement**       | Decommissioning state and evidence                                |

The central question is:

**Can another responsible person understand what this AI system is, why it exists, where it operates, who owns it, what level of governance applies, and where its evidence can be found?**

If yes, the record is doing its job. An inventory becomes unusable if organizations try to turn it into the storage system for everything. Don't put ten thousand model metrics into the inventory. Link to the model-validation report. Don't copy the entire data lineage graph. Link to the data catalog. Don't duplicate deployment logs. Link to the deployment system.

Conceptually:

$$
\text{Inventory}
=
\text{authoritative metadata}
+
\text{relationships}
+
\text{evidence pointers}
$$

rather than:

$$
\text{Inventory}
=
\text{everything about the AI system}
$$

For example:

```text
AI-SYS-004217

Owner                Jane/Business Unit A
Purpose              Consumer credit decision support
Risk tier            High
Lifecycle             Production

Impact assessment     → IA-004217-06
Risk assessment       → RA-004217-11
Model registry        → registry/system/4217
Data lineage          → catalog/product/credit-features
Validation            → VAL-4217-16
Production dashboard  → monitor/system/4217
Approval               → APR-9982
```

This gives you **one index and many authoritative systems of record**. An inventory that is updated once during onboarding quickly becomes fiction. AI systems change continuously. A useful lifecycle might be:

$$
\boxed{
\text{Proposed}
\rightarrow
\text{Assessment}
\rightarrow
\text{Development}
\rightarrow
\text{Validation}
\rightarrow
\text{Approved}
\rightarrow
\text{Production}
\rightarrow
\text{Changed}
\rightarrow
\text{Retired}
}
$$

NIST's AI RMF explicitly connects governance to lifecycle monitoring and safe decommissioning, while ISO/IEC 42001 uses a management-system approach built around establishment, operation, evaluation and continual improvement. ([NIST AI Resource Center][2]) Each transition should change something in the inventory.

### Proposed

Record:

* purpose,
* proposed owner,
* intended users,
* initial system boundary.

### Assessment

Add:

* impact assessment,
* preliminary risk classification,
* specialist requirements.

### Development

Connect:

* repositories,
* datasets,
* vendors,
* model registry.

### Approval

Record:

* approved configuration,
* conditions,
* risk acceptance,
* responsible authority.

### Production

Connect:

* live endpoints,
* operational owner,
* monitoring.

### Change

Record:

* material-change assessment,
* affected evidence,
* reassessment results.

### Retirement

Record:

* production removal,
* dependencies addressed,
* records retained,
* final status.

The inventory should therefore represent the **current governance state**, not merely the system's birth certificate.

## How Does an Impact Assessment Connect Purpose, Stakeholders, Benefits, Harms, and Causal Paths?
<!-- section-summary: Impact assessment starts from intended purpose and affected stakeholders, then follows the causal chain from system behaviour to benefits, harms, and consequences. -->

Impact assessment starts from intended purpose and affected stakeholders, then follows the causal chain from system behaviour to benefits, harms, and consequences.

Knowing an AI system exists is not sufficient. The next question is:

**What happens if this system behaves as designed—or fails to behave as designed?**

That is the domain of the AI impact assessment. ISO/IEC 42005:2025 specifically focuses on understanding how AI systems and their foreseeable applications can affect individuals, groups, and society, and recommends assessment throughout the AI system lifecycle rather than as a one-time exercise. ([ISO][3]) The first-principles chain is:

$$
\text{System behaviour}
\rightarrow
\text{human/institutional response}
\rightarrow
\text{real-world consequence}
$$

The assessment studies that chain. Suppose the lending model has:

$$
AUC=0.91
$$

That tells us something useful about predictive discrimination. It tells us remarkably little about social impact. Imagine two deployments of exactly the same model.

### Deployment A

The score helps an analyst prioritize applications for additional document verification.

### Deployment B

Everyone above a particular predicted-default threshold is automatically denied credit. Same:

* training data,
* algorithm,
* AUC,
* model version.

Different consequences. Therefore:

$$
\boxed{
\text{Impact}
\neq
\text{model performance}
}
$$

Instead:

$$
\text{Impact}
=
f(
\text{model behaviour},
\text{decision policy},
\text{context},
\text{population},
\text{human behaviour},
\text{scale}
)
$$

This is why Responsible AI is fundamentally **socio-technical** rather than merely mathematical. NIST similarly treats AI impacts as potentially extending across individuals, groups, communities, organizations and society, and recommends considering both likelihood and magnitude. ([NIST AI Resource Center][4]) Before asking:

"Can this AI be biased?"

ask:

**"What exactly is this system supposed to accomplish?"**

For example:

Reduce manual review time for consumer credit applications by estimating probability of default.

Then establish:

- **Intended use**

Inform underwriting decisions for UK consumer loans.

- **Intended users**

Trained underwriting staff.

- **Affected people**

Applicants and potentially household members.

- **Decision authority**

Human analysts make final decisions.

- **Foreseeable misuse**

Treating the score as an automatic rejection criterion.

- **Out-of-scope use**

Employment screening.

This creates the reference point against which impacts can be evaluated. If intended use is vague, almost everything downstream becomes vague. Ask:

**Who can experience a consequence even if they never directly interact with the model?**

For lending:

```text
                       AI lending system
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
   Applicants              Employees               Bank
       │                      │                      │
       ▼                      ▼                      ▼
 credit access          workload/automation    losses/revenue
 explanation             decision authority      compliance
 privacy                  accountability         reputation
       │
       ▼
 Families / communities
```

Potentially affected groups can include:

* direct users,
* people receiving decisions,
* people represented in training data,
* people affected indirectly,
* employees operating the system,
* vulnerable populations,
* organizations,
* communities,
* and, depending on the system, society or the environment.

Impact assessment forces the system owner to look **outside the development team**. Impact assessments should not assume AI is harmful. An AI system exists because someone expects benefits.

For example:

### Potential benefits

* faster credit decisions,
* more consistent underwriting,
* reduced manual workload,
* earlier fraud detection,
* lower costs,
* potentially broader credit access.

### Potential adverse impacts

* qualified applicants incorrectly rejected,
* systematic disparities,
* opaque decisions,
* privacy intrusion,
* automation bias among staff,
* exclusion of unusual applicants,
* inability to obtain meaningful recourse.

Good governance evaluates both. ISO describes 42005 as addressing both intended and unintended effects and supporting decisions concerning impacts throughout the lifecycle. ([ISO][5]) A very effective impact-assessment technique is to avoid starting with abstract words such as "bias." Instead write the causal path.

For example:

```text
Older employment data
        ↓
Income underestimated
        ↓
Default probability overestimated
        ↓
Application routed toward rejection
        ↓
Qualified applicant denied credit
        ↓
Financial opportunity lost
```

Now potential controls become easier to identify:

```text
Employment-data freshness check
        ↓
Income verification fallback
        ↓
Calibration testing
        ↓
Human review near threshold
        ↓
Reason-code generation
        ↓
Appeal mechanism
```

Governance is much stronger when:

$$
\text{impact}
\rightarrow
\text{cause}
\rightarrow
\text{control}
$$

is explicit.

![A support-priority use case links incoming requests and recent account events to an internal urgency model, a vendor summary API, a routing rule, a queue, a trained support agent, and the customer response, while the model registry identifies only one component.](/content-assets/articles/article-mlops-governance-and-responsible-ai-ai-inventory-impact-assessments-third-party-risk/complete-use-case-inventory.png)

*The inventory governs the full decision workflow and its accountable scope; a model registry supplies technical identity for one component inside that record.*

## How Do Scale, Reversibility, Misuse, Risk Assessment, and Model Validation Differ?
<!-- section-summary: Impact includes reach, severity, reversibility, dependency, and foreseeable misuse, while risk assessment and model validation answer narrower but complementary questions. -->

Impact includes reach, severity, reversibility, dependency, and foreseeable misuse, while risk assessment and model validation answer narrower but complementary questions.

A simple risk model might use:

$$
R=L\times S
$$

where:

* $$L$$ = likelihood,
* $$S$$ = severity.

NIST notes that organizations commonly combine impact and likelihood into risk scales and may assign AI systems to organizational risk levels. ([NIST AI Resource Center][1]) But Responsible AI often needs richer reasoning.

For example:

$$
R =
f(
S,L,E,V,R_v,D
)
$$

where:

* $$S$$ = severity,
* $$L$$ = likelihood,
* $$E$$ = number of people exposed,
* $$V$$ = vulnerability of affected population,
* $$R_v$$ = reversibility,
* $$D$$ = detectability.

Consider two errors.

### Error A

AI incorrectly recommends a movie.

### Error B

AI incorrectly identifies someone as committing financial fraud. Both might occur with probability $$0.5\%$$. Their governance significance is obviously not equivalent. So **impact is contextual**. A tiny per-decision risk can become material at population scale. Suppose:

$$
P(\text{harmful error})=0.001
$$

With 100 decisions:

$$
100\times0.001=0.1
$$

expected harmful errors. With 10 million decisions:

$$
10,000,000\times0.001=10,000
$$

expected harmful errors. Automation changes the governance problem because AI can operate:

* rapidly,
* repeatedly,
* consistently,
* and at enormous scale.

Impact assessment should therefore consider not merely:

"How bad can one mistake be?"

but also:

"How many people could experience this?"

Not all consequences can be corrected equally easily. Compare:

- **Recommending the wrong television programme**

versus

- **Refusing emergency treatment**

versus

- **Wrongly terminating employment**

versus

- **Wrongly placing someone on a fraud blacklist that propagates elsewhere.**

A useful concept is:

$$
\text{Impact severity}
\uparrow
\quad \text{as reversibility} \downarrow
$$

This is why effective appeal, human intervention, fallback and correction mechanisms can materially change the risk profile. They do not necessarily stop the initial error. They change the **consequence architecture** surrounding the error. Imagine an HR tool is designed only to summarize interview transcripts. Later, managers begin asking:

"Which candidate sounds most trustworthy?"

The vendor may never have intended that use. But once it is foreseeable, governance cannot simply say:

"That wasn't the original design."

An impact assessment should consider:

$$
\text{intended use}
+
\text{reasonably foreseeable misuse}
+
\text{reasonably foreseeable secondary use}
$$

ISO/IEC 42005 explicitly refers to AI systems and their foreseeable applications. ([ISO][3]) This becomes especially important with general-purpose models because one technical component can support many downstream uses. They overlap but are conceptually different.

### Impact assessment

Starts outward:

**What effects can this AI system have on people, groups, organizations, society or other affected interests?**

### Risk assessment

Starts with uncertainty:

**Which uncertain events or conditions threaten objectives or create unacceptable consequences, and how should they be managed?**

An impact might be:

Applicants with certain characteristics experience substantially more false-negative decisions.

The corresponding risk analysis may then consider:

* likelihood,
* magnitude,
* legal consequences,
* affected population,
* existing controls,
* residual exposure.

You can think of:

$$
\text{Impact Assessment}
\rightarrow
\text{understanding consequences}
$$

and:

$$
\text{Risk Management}
\rightarrow
\text{deciding what to do about uncertainty around those consequences}
$$

ISO itself positions 42005 as complementary to broader governance and AI risk-management standards. ([ISO][3]) Another common mistake is:

"The validation team tested the model, therefore we completed our Responsible AI assessment."

Model validation might establish:

* predictive accuracy,
* calibration,
* robustness,
* stability,
* statistical bias characteristics,
* reproducibility.

Impact assessment asks additional questions:

* Who receives the decision
* How consequential is it
* Can they challenge it
* Does automation alter human behaviour
* Could the system shift power between stakeholders
* What happens to unusual cases
* Could certain populations experience disproportionate consequences
* Could the tool become used for another purpose
* What happens when the model is wrong but nobody detects it

Technical evaluation becomes **evidence inside** impact assessment. It does not replace it.

## How Should Risk Tiers and Third-Party Dependencies Change Governance Depth?
<!-- section-summary: A risk tier changes review, testing, authority, monitoring, and reassessment depth, and third-party components remain local dependencies with named ownership. -->

A risk tier changes review, testing, authority, monitoring, and reassessment depth, and third-party components remain local dependencies with named ownership.

Once the organization understands the system and its potential impacts, it can route systems into different control regimes. For illustration:

| Tier                     | Example consequence                      | Governance                               |
| ------------------------ | ---------------------------------------- | ---------------------------------------- |
| **Tier 1 — Minimal**     | Internal productivity assistance         | Basic inventory + owner                  |
| **Tier 2 — Moderate**    | Business recommendations                 | Standard assessment + testing            |
| **Tier 3 — Significant** | Material customer decisions              | Independent review + stronger monitoring |
| **Tier 4 — Critical**    | Safety/rights/high-consequence decisions | Senior approval + extensive assurance    |

Those categories are illustrative organizational design, not universal ISO categories. The critical principle is:

$$
\boxed{
\text{Governance depth}
\propto
\text{potential impact}
}
$$

This is **risk-proportionate governance**. NIST similarly describes allocating inventory and risk-management resources according to organizational risk priorities. ([NIST AI Resource Center][1]) A common mistake is using tier merely to determine how many model tests to run. A meaningful tier can determine:

### Who may approve deployment

```text
Low        → product owner
Medium     → product + risk
High       → independent validation / AI committee
Critical   → senior executive authority
```

### Required evidence

```text
Low        → basic documentation
Medium     → impact + technical testing
High       → deeper impact assessment + independent validation
Critical   → enhanced assurance + executive risk acceptance
```

### Monitoring

```text
Low        → periodic
Medium     → regular
High       → continuous / high-frequency
Critical   → enhanced monitoring + escalation
```

### Change authority

A high-risk system might require reassessment after changes that would be routine for a low-impact system. The tier is therefore a **routing mechanism for governance authority**. Suppose your inventory says:

```text
Risk Tier = 2
```

That doesn't make the system low risk. It means:

Based on the current information and organizational methodology, this system has been classified as Tier 2.

If its purpose changes tomorrow, the classification might become wrong. Therefore:

$$
\text{Risk Tier}
=
f(
\text{current use},
\text{current context},
\text{current impact information}
)
$$

Risk classification must be revisitable. NIST explicitly notes that risk tolerance and risk levels can change over an AI system's lifecycle. ([NIST AI Resource Center][1]) Suppose your company calls an external LLM API. A dangerous thought is:

"The vendor owns the model, therefore the vendor owns the AI risk."

The vendor owns some components and some controls. But **your organization owns its use of that component**.

For example:

```text
Third-party foundation model
             │
             ▼
Your prompts + retrieval + business data
             │
             ▼
Your application
             │
             ▼
Your employee/customer
             │
             ▼
Your business decision
```

The provider cannot know every downstream context. Your organization determines things such as:

* why it is being used,
* what data is sent,
* which users see results,
* whether humans review outputs,
* whether decisions are consequential,
* whether results are retained,
* what fallback exists,
* what happens after vendor changes.

NIST's AI RMF explicitly includes third-party software, hardware and data within lifecycle governance and recognizes vendors, providers and contractors as actors in the AI ecosystem. ([NIST AI Resource Center][2]) So:

$$
\boxed{\text{Outsourcing technology} \neq \text{outsourcing accountability}}
$$

For external AI, an inventory might represent:

```text
AI-SYS-004217
Consumer lending assistant
        │
        ├── Vendor LLM
        │       └── vendor model version
        │
        ├── Internal RAG service
        │       ├── policy database
        │       └── embedding model
        │
        ├── moderation component
        │
        └── human underwriting workflow
```

Now imagine the LLM vendor changes its underlying model. The organization can query:

Which systems depend upon Vendor Model X

That gives you **AI supply-chain traceability**. Without dependency mapping, third-party model changes become difficult to govern systematically.

## How Do Change Triggers, Ownership, Discovery, and Evidence Keep the Inventory Current?
<!-- section-summary: Event-driven change triggers, evidence-based updates, ownership rules, technical discovery, and stale-record checks keep the governance map aligned with production reality. -->

Event-driven change triggers, evidence-based updates, ownership rules, technical discovery, and stale-record checks keep the governance map aligned with production reality.

An annual review is useful. It is not sufficient. Some events should trigger immediate reconsideration of inventory information, impact assessment, or risk tier. Typical triggers include:

* intended purpose changes,
* user population changes,
* deployment in a new country,
* move from advisory to automated decision-making,
* addition of sensitive data,
* significant model retraining,
* new model architecture,
* foundation-model/vendor change,
* major prompt/system-instruction change,
* new retrieval source,
* decision-threshold change,
* substantial performance drift,
* material incident,
* unexpected stakeholder complaints,
* new legal requirement,
* new integration,
* change in human oversight.

The general rule is:

$$
\boxed{
\text{Reassess when an assumption underlying the previous assessment changes}
}
$$

ISO/IEC 42005 recommends impact assessment across the lifecycle and updating assessments as appropriate. ([ISO][3]) Suppose:

```text
AI-SYS-004217
```

uses model:

```text
credit_model:v18
```

A new release introduces:

```text
credit_model:v19
```

The release pipeline should be able to ask:

```text
Does this constitute a material change
             │
       ┌─────┴─────┐
       │           │
      No          Yes
       │           │
       ▼           ▼
normal gate    reassessment
                   │
                   ├── impact
                   ├── risk
                   ├── validation
                   └── approval
```

This makes governance **event-driven**. That is much safer than relying on someone to remember:

"I think we should tell Responsible AI that we changed something."

There should not be one person manually discovering everything. Responsibility should be distributed.

### System/business owner

Accountable for:

* purpose,
* intended use,
* continuing business need,
* current risk context.

### Technical/model owner

Maintains:

* technical components,
* models,
* endpoints,
* implementation changes.

### Data owner

Maintains relevant:

* data dependencies,
* lineage,
* quality responsibilities.

### Risk / Responsible AI

Challenges:

* impact assessment,
* tier,
* treatments,
* exceptions.

### Procurement/vendor management

Signals:

* acquired AI,
* vendor changes,
* renewals,
* termination.

### Inventory/governance team

Maintains:

* taxonomy,
* required fields,
* reconciliation,
* completeness controls.

### Automation

Updates facts available from:

* CI/CD,
* cloud infrastructure,
* model registries,
* APIs,
* monitoring.

A useful principle is:

**Humans should own judgments; systems should populate observable facts wherever possible.**

For example:

```text
Business purpose     → human
Affected stakeholders → human
Risk acceptance       → human

Model version          → automated
Deployment endpoint    → automated
Last production call   → automated
Last deployment        → automated
```

Self-registration is necessary but insufficient. Someone will forget. Someone will not realize that a SaaS feature uses AI. Someone will run an experiment directly in production. Someone will create a new cloud model endpoint without informing governance. Therefore mature inventories need **reconciliation controls**.

For example:

```text
Cloud AI endpoints ─────────┐
Model registry ─────────────┤
API gateway ────────────────┤
Code repositories ──────────┤
Vendor/procurement records ─┼──► Reconciliation ──► AI Inventory
SaaS catalog ───────────────┤
Data-science platforms ─────┤
Expense/vendor records ─────┤
Monitoring systems ─────────┘
```

Now compute:

$$
\text{Observed AI assets}
-
\text{registered AI assets}
=
\text{potential shadow AI}
$$

A production endpoint with no inventory system ID becomes an exception requiring investigation. The opposite failure also exists. Inventory says:

```text
Status: Production
Owner: Alice
Model: v12
```

Reality says:

```text
Alice left 8 months ago
v16 is deployed
endpoint has moved
impact assessment references v10
```

The system is technically inventoried but governance information is stale. So reconciliation must test both directions:

$$
\text{Production} \rightarrow \text{Inventory}
$$

and:

$$
\text{Inventory} \rightarrow \text{Production}
$$

Questions include:

* Does every live AI deployment have an inventory record
* Does every production inventory record map to a live deployment
* Does the owner still exist
* Does the recorded model match production
* Is the current risk tier still approved
* Is the referenced assessment still valid
* Are third-party dependencies current

This is how you measure **inventory integrity**. A useful control could automatically produce:

```text
Inventory Reconciliation Report
2026-08-30

Production AI endpoints detected:       184
Mapped to system ID:                    181
Unmapped endpoints:                       3

Inventory records marked Production:    179
Verified active:                         177
Potential stale records:                  2

High-impact systems:                     24
Current impact assessment:               23
Expired/reassessment required:            1
```

Now management has evidence rather than reassurance. Remember the governance principle:

$$
\boxed{
\text{Claim}
\rightarrow
\text{Control}
\rightarrow
\text{Evidence}
}
$$

The claim:

"We maintain a complete AI inventory."

requires evidence demonstrating completeness.

![Six-stage impact path from the intended use of support prioritization through lower confidence for a non-English message, the routing rule, a slower queue, delayed support, and language-specific outcome evidence, with review and control points.](/content-assets/articles/article-mlops-governance-and-responsible-ai-ai-inventory-impact-assessments-third-party-risk/support-impact-path.png)

*Impact assessment traces the full causal path to the affected group, then uses workflow-specific evidence and accountable decisions instead of relying on an aggregate model metric.*

## How Does Production Evidence Connect Impacts to Controls, Residual Risk, and No-Deploy Decisions?
<!-- section-summary: Production signals test impact assumptions, controls map to identified harms, residual impact remains visible, and some evidence should lead to a decision not to deploy. -->

Production signals test impact assumptions, controls map to identified harms, residual impact remains visible, and some evidence should lead to a decision not to deploy.

Pre-deployment impact assessment answers:

"What do we reasonably expect?"

Production tells us:

"What actually happened?"

Suppose the assessment predicted:

Low likelihood of customers being unable to appeal automated recommendations.

Six months later:

* complaint volume increases,
* human override rate changes,
* one customer group experiences significantly higher rejection rates.

These observations are new impact evidence. NIST emphasizes gathering actual feedback, errors, incidents, affected-community information, human overrides, and contextual performance after deployment rather than treating pre-deployment measurement as sufficient. ([NIST AI Resource Center][6]) So:

$$
\text{Impact assessment}_{t+1}
=
\text{previous assessment}
+
\text{observed reality}
$$

Responsible AI becomes a learning loop. Suppose the assessment contains:

| Potential impact                     | Cause                            | Control                        |
| ------------------------------------ | -------------------------------- | ------------------------------ |
| Qualified applicant rejected         | model false negative             | accuracy/calibration testing   |
| Disproportionate rejection           | subgroup performance differences | disaggregated evaluation       |
| Applicant cannot understand decision | opaque output                    | explanation mechanism          |
| Staff blindly trust recommendation   | automation bias                  | human-review design + training |
| Incorrect data causes denial         | stale input data                 | data-quality checks            |
| Harm goes unnoticed                  | weak feedback                    | appeal/complaint monitoring    |

Then attach ownership:

| Control             | Owner                            |
| ------------------- | -------------------------------- |
| Model evaluation    | Model owner                      |
| Data-quality checks | Data owner                       |
| Human oversight     | Business owner                   |
| Complaints          | Customer operations              |
| Fairness monitoring | Responsible AI                   |
| Risk acceptance     | Designated accountable executive |

Now the impact assessment is not a philosophical essay. It becomes a **control-design document**. Suppose the initial assessment finds:

$$
R_{\text{inherent}}=\text{High}
$$

Controls are implemented. Then ask:

$$
R_{\text{residual}}
=
R_{\text{inherent}}
-
\text{effect of controls}
$$

Conceptually, rather than necessarily numerically. Perhaps:

```text
Inherent impact/risk: HIGH

Controls:
✓ human review
✓ subgroup testing
✓ appeal process
✓ production monitoring

Residual impact/risk: MEDIUM
```

The key governance question then becomes:

**Who has authority to accept that remaining exposure?**

Not:

"Did the team fill in the assessment template?"

Good governance does not guarantee approval. Suppose the system's expected benefit is:

$$
B
$$

and the combination of unresolved harm, uncertainty and control limitations remains unacceptable. The correct governance decision may be:

$$
\boxed{\text{No-go}}
$$

Possible outcomes of an impact assessment should therefore include:

```text
Approve

Approve with controls

Approve with temporary exception

Require redesign

Restrict use

Pilot only

Suspend

Do not deploy
```

If every impact assessment eventually produces "approved," it may not be functioning as meaningful challenge. NIST explicitly describes impact information as potentially informing go/no-go decisions and resource allocation for testing and evaluation. ([NIST AI Resource Center][4])

## How Should Retirement, History, and Shared Identity Close the Governance Loop?
<!-- section-summary: Retirement ends operation without erasing history, while one system ID joins inventory, assessment, releases, incidents, reviews, and evidence across the full lifecycle. -->

Retirement ends operation without erasing history, while one system ID joins inventory, assessment, releases, incidents, reviews, and evidence across the full lifecycle.

Suppose the lender replaces:

```text
AI-SYS-004217
```

with:

```text
AI-SYS-006512
```

Retirement does not mean deleting the old inventory row. You may need to establish:

* production endpoint disabled,
* batch jobs stopped,
* API consumers migrated,
* dependent services updated,
* monitoring closed,
* vendor subscriptions terminated,
* relevant data handled according to retention requirements,
* outstanding complaints/incidents resolved,
* historical decisions remain traceable,
* required evidence retained.

Then:

```text
Lifecycle state: RETIRED
Retirement date: 2026-08-15
Replacement: AI-SYS-006512
Last production use: ...
Evidence package: ...
```

NIST's Govern function explicitly includes safe decommissioning and phasing out of AI systems. ([NIST AI Resource Center][2]) The record remains because historical accountability remains. Suppose three years later a regulator, auditor, customer, or internal investigator asks:

"Which AI system contributed to decisions made in March 2026?"

You need to reconstruct:

$$
\text{Decision}
\rightarrow
\text{deployment}
\rightarrow
\text{AI system}
\rightarrow
\text{model version}
\rightarrow
\text{data/configuration}
\rightarrow
\text{assessment}
\rightarrow
\text{approval}
$$

Therefore:

$$
\text{retirement}
\neq
\text{erasure}
$$

Retirement means:

No longer operational, but retained as historical governance evidence according to applicable retention requirements.

The two concepts now fit together.

```text
                 DISCOVER
                    │
                    ▼
             REGISTER SYSTEM
                    │
                    ▼
              ASSIGN OWNER
                    │
                    ▼
            DEFINE SYSTEM BOUNDARY
                    │
                    ▼
             IDENTIFY CONTEXT
                    │
                    ▼
             IMPACT ASSESSMENT
                    │
                    ▼
               RISK TIER
                    │
                    ▼
           REQUIRED CONTROLS
                    │
                    ▼
            TEST / VALIDATE
                    │
                    ▼
            APPROVAL AUTHORITY
                    │
                    ▼
                 DEPLOY
                    │
                    ▼
        ┌────── MONITOR ──────┐
        │                     │
        ▼                     ▼
   SYSTEM CHANGE        REAL-WORLD IMPACT
        │                     │
        └──────────┬──────────┘
                   ▼
               REASSESS
                   │
           ┌───────┴───────┐
           ▼               ▼
       CONTINUE          RETIRE
```

This is why inventory and impact assessment should not be separate governance programs. They form one feedback system. A useful separation is:

### Inventory directly stores

```text
System ID
Name
Owner
Purpose summary
Lifecycle state
Risk tier
Current approval status
Current component identifiers
Key dependencies
Date of last assessment
```

### Inventory links to

```text
Full impact assessment
Risk register
Model card
Validation report
Data-quality report
Data catalog
Privacy assessment
Security assessment
Vendor review
Monitoring dashboards
Incident records
Approval evidence
Change records
```

This gives you:

$$
\boxed{\text{Inventory = index}}
$$

rather than:

$$
\text{Inventory = document warehouse}
$$

This idea is particularly powerful. Organizations usually already possess pieces of AI evidence. The problem is that they live in different places.

```text
Git             CI/CD
 │                │
 └──────┐   ┌─────┘
        ▼   ▼
     AI-SYS-004217
        ▲   ▲
 ┌──────┘   └─────────┐
 │                    │
GRC               Monitoring
 │                    │
Risk              Production
```

The stable system ID becomes the **join key**.

Conceptually:

```sql
SELECT *
FROM ai_inventory i
JOIN deployments d USING(system_id)
JOIN risk_assessments r USING(system_id)
JOIN impact_assessments a USING(system_id)
JOIN incidents n USING(system_id)
WHERE i.risk_tier = 'HIGH';
```

That is what makes governance scalable.

## What Can a Mature Inventory and Impact-Assessment System Answer Automatically?
<!-- section-summary: A mature inventory can answer scope, ownership, risk, dependency, approval, monitoring, and reassessment questions programmatically and connect them to standards such as ISO/IEC 42001 and 42005. -->

A mature inventory can answer scope, ownership, risk, dependency, approval, monitoring, and reassessment questions programmatically and connect them to standards such as ISO/IEC 42001 and 42005.

Once the relationships exist, you can generate controls such as:

```text
Show production AI systems with:

• no accountable owner
• expired impact assessment
• unapproved model versions
• unregistered third-party AI
• overdue validation
• unresolved critical incidents
• risk-tier mismatch
• missing monitoring
• stale inventory records
```

That changes AI governance from:

"Please complete this spreadsheet."

into:

**Continuous assurance over the actual technology estate.**

That is a major maturity jump. Suppose a company introduces an LLM customer-service assistant.

### Inventory

```text
System ID:
AI-SYS-00981

Purpose:
Assist support agents in drafting replies.

Decision authority:
Advisory only.

Users:
Customer-support employees.

Affected parties:
Customers.

Components:
Internal UI
+ retrieval service
+ Vendor LLM
+ customer knowledge base

Owner:
Director of Customer Operations

Lifecycle:
Pre-production
```

### Impact assessment

Potential beneficial impacts:

* faster response times,
* more consistent answers.

Potential adverse impacts:

```text
Hallucination
    ↓
incorrect customer advice
    ↓
financial/customer harm

Sensitive data in prompt
    ↓
inappropriate third-party exposure

Automation bias
    ↓
agent accepts incorrect answer

Knowledge-base error
    ↓
wrong information repeatedly propagated
```

### Risk classification

Suppose the assessment concludes:

```text
Tier 2 — Moderate
```

### Required controls

```text
Human approval before sending
Sensitive-data filtering
Grounding/retrieval controls
Hallucination evaluation
Vendor due diligence
Logging
Customer complaint monitoring
Fallback process
```

Now management proposes:

"Let the AI answer customers automatically."

Nothing about the foundation model necessarily changed. But:

```text
Decision authority:
Advisory
        ↓
Autonomous
```

has changed. That is a **material system change**. The inventory should trigger reassessment. The impact assessment may now produce:

```text
Tier 3 — Significant
```

which may require:

* stronger evaluation,
* different approval authority,
* enhanced monitoring,
* customer recourse,
* tighter operational limits.

This illustrates the deepest idea:

$$
\boxed{\text{AI risk belongs to the system-in-context, not merely to the model}}
$$

At a high level:

### ISO/IEC 42001

asks whether the organization has a systematic way to govern AI—establishing, implementing, maintaining and continually improving an AI management system. ([ISO][7]) The inventory provides essential operational infrastructure for knowing what that management system governs.

### ISO/IEC 42005

focuses specifically on AI system impact assessment across the lifecycle and on impacts to individuals, groups and society. ([ISO][3]) So conceptually:

$$
42001:
\quad
\text{"Have a governance system."}
$$

$$
\text{Inventory:}
\quad
\text{"Know which AI systems belong inside it."}
$$

$$
42005:
\quad
\text{"Understand how each relevant system can affect people and society."}
$$

$$
\text{Risk tiering:}
\quad
\text{"Use that understanding to decide how much control is necessary."}
$$

An AI inventory is not primarily a list of algorithms. It is:

$$
\boxed{
\text{AI Inventory}
=
\text{identity}
+
\text{purpose}
+
\text{context}
+
\text{ownership}
+
\text{lifecycle state}
+
\text{risk status}
+
\text{evidence links}
}
$$

An impact assessment is not primarily a questionnaire. It is:

$$
\boxed{
\text{Impact Assessment}
=
\text{system behaviour}
\rightarrow
\text{affected people}
\rightarrow
\text{possible consequences}
\rightarrow
\text{controls}
\rightarrow
\text{residual exposure}
}
$$

And their relationship is:

$$
\boxed{
\text{Discover}
\rightarrow
\text{Identify}
\rightarrow
\text{Understand}
\rightarrow
\text{Assess Impact}
\rightarrow
\text{Tier}
\rightarrow
\text{Control}
\rightarrow
\text{Approve}
\rightarrow
\text{Deploy}
\rightarrow
\text{Observe}
\rightarrow
\text{Reassess}
\rightarrow
\text{Retire}
}
$$

The inventory provides **visibility and accountability**. The impact assessment provides **reasoning about consequences**. The risk tier converts that reasoning into **control depth and decision authority**. Stable identifiers connect governance to **actual production technology**. Continuous reconciliation tells you whether the organization's governance map still corresponds to reality. And lifecycle reassessment recognizes the fundamental property of AI systems:

> **A system that was acceptable yesterday is not automatically acceptable after its model, data, users, purpose, environment, vendor, decision authority, or real-world behaviour changes.**

That is why the inventory and impact assessment together form one of the foundational control loops of practical Responsible AI.

![A stable AI use-case ID links the governance record to service, model, data, supplier, workflow, and operational systems, while discovery, reconciliation, release checks, review, reassessment, and a verified three-step retirement process maintain the record.](/content-assets/articles/article-mlops-governance-and-responsible-ai-ai-inventory-impact-assessments-third-party-risk/system-id-lifecycle-summary.png)

*The stable system ID connects specialized records through the active lifecycle and remains as retired history only after the organization removes every live path and verifies the withdrawal.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Must an AI Inventory Record about the Whole System and Its Lifecycle?]{kind="recap"}
An AI inventory gives every complete system a stable identity and lifecycle record, linking purpose, owners, components, versions, environments, dependencies, evidence, and status without copying every artifact.
:::

:::expand[How Does an Impact Assessment Connect Purpose, Stakeholders, Benefits, Harms, and Causal Paths?]{kind="recap"}
Impact assessment starts from intended purpose and affected stakeholders, then follows the causal chain from system behaviour to benefits, harms, and consequences.
:::

:::expand[How Do Scale, Reversibility, Misuse, Risk Assessment, and Model Validation Differ?]{kind="recap"}
Impact includes reach, severity, reversibility, dependency, and foreseeable misuse, while risk assessment and model validation answer narrower but complementary questions.
:::

:::expand[How Should Risk Tiers and Third-Party Dependencies Change Governance Depth?]{kind="recap"}
A risk tier changes review, testing, authority, monitoring, and reassessment depth, and third-party components remain local dependencies with named ownership.
:::

:::expand[How Do Change Triggers, Ownership, Discovery, and Evidence Keep the Inventory Current?]{kind="recap"}
Event-driven change triggers, evidence-based updates, ownership rules, technical discovery, and stale-record checks keep the governance map aligned with production reality.
:::

:::expand[How Does Production Evidence Connect Impacts to Controls, Residual Risk, and No-Deploy Decisions?]{kind="recap"}
Production signals test impact assumptions, controls map to identified harms, residual impact remains visible, and some evidence should lead to a decision not to deploy.
:::

:::expand[How Should Retirement, History, and Shared Identity Close the Governance Loop?]{kind="recap"}
Retirement ends operation without erasing history, while one system ID joins inventory, assessment, releases, incidents, reviews, and evidence across the full lifecycle.
:::

:::expand[What Can a Mature Inventory and Impact-Assessment System Answer Automatically?]{kind="recap"}
A mature inventory can answer scope, ownership, risk, dependency, approval, monitoring, and reassessment questions programmatically and connect them to standards such as ISO/IEC 42001 and 42005.
:::

## References

[1]: https://airc.nist.gov/airmf-resources/playbook/govern/ "Govern - AIRC"
[2]: https://airc.nist.gov/airmf-resources/airmf/5-sec-core/ "AI RMF Core - AIRC"
[3]: https://www.iso.org/standard/42005 "ISO/IEC 42005:2025 - Information technology — Artificial intelligence (AI) — AI system impact assessment"
[4]: https://airc.nist.gov/airmf-resources/playbook/map/ "Map - AIRC"
[5]: https://www.iso.org/publication/PUB200420.html "ISO - Responsible AI governance and impact standards package"
[6]: https://airc.nist.gov/airmf-resources/playbook/measure/ "Measure - AIRC"
[7]: https://www.iso.org/standard/42001 "ISO/IEC 42001:2023 - AI management systems"
