---
title: "Third-Party AI and Model Supply-Chain Risk"
description: "AI supply-chain risk includes models, data, libraries, services, platforms, evaluators, tools, and upstream dependencies, which require a graph and separate component assurance from system assurance."
overview: "AI supply-chain risk includes models, data, libraries, services, platforms, evaluators, tools, and upstream dependencies, which require a graph and separate component assurance from system assurance. The central principle is that an organization may depend on external AI, but it cannot outsource understanding, system-level assurance, operational control, or accountability for local consequences."
tags: ["MLOps", "advanced", "governance", "third-party-risk", "supply-chain"]
order: 4
id: "article-mlops-governance-and-responsible-ai-third-party-ai-model-supply-chain-risk"
---

## Table of Contents

1. [What Does the Full AI Supply Chain Include beyond a Vendor List?](#what-does-the-full-ai-supply-chain-include-beyond-a-vendor-list)
2. [How Should Due Diligence, Contracts, Accountability, and Technical Boundaries Be Designed before Adoption?](#how-should-due-diligence-contracts-accountability-and-technical-boundaries-be-designed-before-adoption)
3. [How Do Versioned Manifests, Supplier Change Monitoring, and Boundary Tests Control Ongoing Dependence?](#how-do-versioned-manifests-supplier-change-monitoring-and-boundary-tests-control-ongoing-dependence)
4. [How Do Exit, Portability, Fallback, Redundancy, and Concentration Risk Differ?](#how-do-exit-portability-fallback-redundancy-and-concentration-risk-differ)
5. [How Should Incidents Propagate, Be Contained, and Preserve Local Accountability across Commercial and Open-Source Components?](#how-should-incidents-propagate-be-contained-and-preserve-local-accountability-across-commercial-and-open-source-components)
6. [How Do Inventory Reconciliation, Shadow AI Discovery, Selective Evidence Invalidation, and Multiple Risk Dimensions Work?](#how-do-inventory-reconciliation-shadow-ai-discovery-selective-evidence-invalidation-and-multiple-risk-dimensions-work)
7. [How Does the Full Supplier Lifecycle Connect to Responsible AI and Governance Standards?](#how-does-the-full-supplier-lifecycle-connect-to-responsible-ai-and-governance-standards)
8. [What Is the Central Principle of Third-Party AI Risk?](#what-is-the-central-principle-of-third-party-ai-risk)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A product calls one hosted model, retrieves from a vendor database, uses an open-source tokenizer, and relies on a cloud identity service. Recording only the model provider misses the dependencies that can change behaviour, expose data, interrupt service, or invalidate evidence.

**AI supply-chain risk** concerns every external component and service that can influence the system's data, execution, outputs, authority, or availability. A supplier claim is evidence to evaluate, while the organization remains responsible for the complete system it operates.

These questions follow the dependency graph from due diligence and contracts through versioning, boundary tests, incidents, concentration, exit, and lifecycle governance:

1. **What Does the Full AI Supply Chain Include beyond a Vendor List?**
2. **How Should Due Diligence, Contracts, Accountability, and Technical Boundaries Be Designed before Adoption?**
3. **How Do Versioned Manifests, Supplier Change Monitoring, and Boundary Tests Control Ongoing Dependence?**
4. **How Do Exit, Portability, Fallback, Redundancy, and Concentration Risk Differ?**
5. **How Should Incidents Propagate, Be Contained, and Preserve Local Accountability across Commercial and Open-Source Components?**
6. **How Do Inventory Reconciliation, Shadow AI Discovery, Selective Evidence Invalidation, and Multiple Risk Dimensions Work?**
7. **How Does the Full Supplier Lifecycle Connect to Responsible AI and Governance Standards?**
8. **What Is the Central Principle of Third-Party AI Risk?**

## What Does the Full AI Supply Chain Include beyond a Vendor List?
<!-- section-summary: AI supply-chain risk includes models, data, libraries, services, platforms, evaluators, tools, and upstream dependencies, which require a graph and separate component assurance from system assurance. -->

AI supply-chain risk includes models, data, libraries, services, platforms, evaluators, tools, and upstream dependencies, which require a graph and separate component assurance from system assurance.

The easiest way to understand third-party AI risk is to begin with one fact:

> **An AI system can be your responsibility even when much of its behaviour is produced by technology you did not build and cannot fully inspect.**

A modern AI application might depend on a commercial LLM, an open-source embedding model, external datasets, a vector database, cloud inference infrastructure, moderation APIs, software libraries, human-labelled data, and several subcontractors. Your organization may own only a thin application layer. Yet your customer experiences **the whole system**. So the fundamental governance problem is:

$$
\boxed{
\text{Your accountability}
\neq
\text{the portion of the code you wrote}
}
$$

Third-party AI governance is therefore about controlling **inherited uncertainty**. Consider a customer-service assistant:

```text
Customer
   ↓
Your application
   ↓
Prompt / policy layer
   ↓
Retrieval service ───→ Company documents
   ↓
Embedding model
   ↓
Vector database
   ↓
Third-party foundation model
   ↓
Third-party moderation service
   ↓
Response
```

Behind the foundation-model provider there may be another chain:

```text
Model provider
   ↓
Training datasets
   ↓
Data suppliers
   ↓
Cloud / accelerator provider
   ↓
Open-source libraries
   ↓
Evaluation vendors
   ↓
Content / annotation workers
```

Your system is therefore not a single artifact. It is a **dependency graph**. NIST's AI Risk Management Framework explicitly treats risks from third-party software, hardware, data, commercially available models, open-source components and other supply-chain dependencies as part of AI governance, and recommends managing third-party AI across the full lifecycle rather than only during procurement. ([NIST AI Resource Center][1]) A useful conceptual equation is:

$$
\boxed{
R_{\text{system}}
=
R_{\text{local}}
+
R_{\text{inherited}}
+
R_{\text{integration}}
+
R_{\text{dependency}}
}
$$

where:

- **Local risk** comes from what you built.
- **Inherited risk** comes from third-party components.
- **Integration risk** arises from combining otherwise acceptable components.
- **Dependency risk** comes from outages, hidden changes, supplier failure, concentration and inability to replace the component.

The terms are not mathematically additive in reality; the equation is a mental model. Suppose your application calls a commercial LLM. It is tempting to record:

```text
Supplier = Vendor A
```

That is usually insufficient. The governed dependency chain could contain:

| Dependency               | Example risk                                        |
| ------------------------ | --------------------------------------------------- |
| Foundation model         | behaviour changes, hallucination, bias              |
| Model API                | outage, latency, undocumented version change        |
| Training-data provenance | copyright/privacy/provenance uncertainty            |
| Open-source model        | malicious weights, licence restrictions             |
| Embedding model          | retrieval behaviour changes                         |
| Vector database          | data exposure or availability failure               |
| External dataset         | inaccurate, stale or unlawfully sourced information |
| Safety/moderation model  | false positives/negatives                           |
| Cloud service            | region, resilience or concentration risk            |
| Software library         | security vulnerability                              |
| Human data supplier      | poor labels, labour/provenance concerns             |
| Retrieval content        | poisoned or incorrect documents                     |
| Subprocessor             | privacy/security dependency                         |

NIST specifically notes that third-party AI risk can involve external data, software packages, hardware/software platforms and pre-trained models, with concerns including privacy, bias, reproducibility and uncertainty. ([NIST AI Resource Center][2]) So:

$$
\boxed{\text{Third-party AI risk}>\text{vendor risk}}
$$

Vendor-management systems tend to organize information around companies. AI governance also needs to organize information around **components and dependencies**. Suppose your governed application is:

```text
AI-SYS-0917
Customer Support Assistant
```

Its dependency graph might be:

```text
AI-SYS-0917
│
├── APP-17
│
├── PROMPT-42
│
├── RAG-08
│   ├── EMBED-12
│   ├── VECTORDB-3
│   └── KNOWLEDGE-44
│
├── MODEL-VENDOR-X
│   └── MODEL-X-2026-08
│
├── MODERATION-VENDOR-Y
│   └── MOD-Y-7
│
└── CLOUD-Z
```

Now governance can answer:

Which systems use Vendor X

or:

Which production systems use embedding model `EMBED-12`

or:

Which high-impact systems depend on Cloud Z

or:

What would break if Model X were withdrawn tomorrow

The same structure is useful during incidents. If component:

```text
MODEL-X-2026-08
```

has a newly discovered safety defect, you can traverse:

$$
\text{component}
\rightarrow
\text{dependent systems}
\rightarrow
\text{deployments}
\rightarrow
\text{affected users}
$$

This is why dependency mapping is foundational rather than administrative. Suppose a foundation-model provider tells you:

“Our model achieved 92% on benchmark X.”

That claim may be perfectly valid. But your application performs:

```text
Customer query
     ↓
Retrieval from your documents
     ↓
Your system prompt
     ↓
Vendor model
     ↓
Your post-processing
     ↓
Financial guidance
```

The supplier did not test:

* your documents,
* your prompt,
* your user population,
* your business rules,
* your human-review process,
* your regulatory context.

Therefore:

$$
\boxed{
\text{Supplier assurance}
\neq
\text{local fitness-for-purpose assurance}
}
$$

Supplier evidence answers:

“What do we know about this component?”

Local testing answers:

“What happens when **we** use it this way?”

NIST accordingly recommends both transparency into third-party system functions and thorough testing of third-party systems rather than treating supplier information as sufficient assurance. ([NIST AI Resource Center][3]) A supplier may provide useful evidence such as model documentation, evaluation reports, security assessments, certifications, privacy documentation, known limitations, data-provenance information, incident history, versioning policies and red-team results. Those are valuable. But your decision process should look like:

```text
Supplier claim
      ↓
Supporting evidence
      ↓
Applicability to our use
      ↓
Independent/local testing
      ↓
Residual uncertainty
      ↓
Risk decision
```

For example:

```text
Supplier:
"Model resists prompt injection."
```

Your local test might discover:

```text
Your RAG connector
      +
untrusted uploaded documents
      ↓
indirect prompt injection
      ↓
assistant reveals restricted content
```

The supplier's statement was not necessarily false. The integration created a new attack path. This illustrates:

$$
\boxed{
R(A+B)
\neq
R(A)+R(B)
}
$$

Systems create **emergent risks** that individual component tests may not reveal.

## How Should Due Diligence, Contracts, Accountability, and Technical Boundaries Be Designed before Adoption?
<!-- section-summary: Due-diligence depth follows impact, contracts assign evidence and incident duties, local accountability remains, and a controlled boundary limits data, authority, outputs, and failure propagation. -->

Due-diligence depth follows impact, contracts assign evidence and incident duties, local accountability remains, and a controlled boundary limits data, authority, outputs, and failure propagation.

A team should not first integrate an AI service and then discover that governance requires information the vendor cannot provide. Due diligence should therefore happen **before the dependency becomes difficult to remove**. The required depth can be thought of conceptually as:

$$
D =
f(
I,
C,
O,
S,
V,
K
)
$$

where:

$$I$$ = potential impact of failure, $$C$$ = criticality of the component, $$O$$ = opacity of the supplier/component, $$S$$ = sensitivity of information involved, $$V$$ = volatility/change frequency, $$K$$ = concentration or switching difficulty. So an externally hosted model generating internal brainstorming suggestions should receive different scrutiny from an externally hosted model materially influencing healthcare, employment or credit decisions. NIST's framework similarly recommends tailoring third-party governance to the organization's risk profile, resources and particular use case. ([NIST AI Resource Center][3]) A useful governance model is:

| Component risk | Example assurance                                                                            |
| -------------- | -------------------------------------------------------------------------------------------- |
| Low            | basic supplier review + local functional tests                                               |
| Moderate       | security/privacy review + model documentation + systematic local evaluation                  |
| High           | deep model/vendor review + independent testing + contractual controls + resilience plan      |
| Critical       | enhanced due diligence + senior acceptance + stringent change control + tested fallback/exit |

These are organizational examples, not NIST-prescribed tiers. The exact questionnaire matters less than the underlying questions. A strong diligence process should establish at least one coherent view across the following areas: what the component actually does and does not do; how it was evaluated; what data it may receive and retain; known limitations; security architecture; geographic processing; intellectual-property/licensing issues; model and API versioning; subcontractors; incident history and notification arrangements; availability/resilience; whether behaviour may change without notice; the evidence necessary for applicable law; and whether the organization can leave. The fundamental question is:

$$
\boxed{
\text{Can we govern this dependency with the information and control available to us?}
}
$$

Sometimes the correct answer is no. A technically impressive model can be unsuitable for a high-impact system simply because the organization cannot obtain sufficient assurance. Third-party AI creates an unusual accountability problem:

```text
Supplier controls some risk
Customer controls some risk
Both influence system behaviour
```

Without explicit allocation, each party may assume the other is handling something. The contract should convert vague expectations into enforceable responsibilities.

For example:

| Issue              | Contract should clarify                                   |
| ------------------ | --------------------------------------------------------- |
| Model changes      | notice, timing, version availability                      |
| Incidents          | reporting threshold and notification channel              |
| Security           | minimum controls and vulnerability handling               |
| Customer data      | permitted use, retention, deletion, training restrictions |
| Documentation      | what assurance information must be supplied               |
| Regulatory support | information/access necessary for compliance               |
| Subcontractors     | notification and flow-down requirements                   |
| Audit/assurance    | evidence or audit rights                                  |
| Performance        | availability/service expectations                         |
| IP                 | licences, rights, indemnities where appropriate           |
| Exit               | export, deletion, transition support                      |
| End-of-life        | model/API retirement notification                         |

This has become particularly concrete in the EU AI Act. Under the current consolidated Article 25(4), the provider of a high-risk AI system and a third party supplying an AI system, AI model, tool, service, component or process used in it must, subject to stated exceptions, specify by written agreement the information, capabilities, technical access and assistance needed to enable the high-risk-system provider to fulfil its obligations. ([EUR-Lex][4]) The regulatory logic matches the first-principles logic:

> **Responsibility without access to necessary information is not operationally workable.**

Suppose a contract says:

“Vendor guarantees the model is unbiased.”

That clause might allocate some commercial liability. It does not change what your system actually does. If you use the component to deny loans:

$$
\text{Vendor warranty}
\not\Rightarrow
\text{fair lending outcome}
$$

Likewise:

$$
\text{Supplier certification}
\not\Rightarrow
\text{fitness for your use case}
$$

The EU AI Act makes this especially visible: parties elsewhere in the value chain can acquire provider responsibilities when, for example, they make a substantial modification to a high-risk system or change its intended purpose so that it becomes high-risk. ([EUR-Lex][5]) Technology can be outsourced. Some operational controls can be outsourced. But:

$$
\boxed{\text{Accountability for your use cannot simply be outsourced}}
$$

Governance becomes much easier if all external AI access passes through a controlled boundary. Instead of:

```text
Application 1 ──→ Vendor API
Application 2 ──→ Vendor API
Notebook ───────→ Vendor API
Analyst script ─→ Vendor API
```

use something closer to:

```text
Applications
     ↓
AI Gateway / Controlled Integration Layer
     ↓
Authentication
Version rules
Data filtering
Logging
Rate limits
Policy enforcement
Fallback routing
     ↓
Approved supplier endpoint
```

This technical boundary can enforce governance facts rather than relying on documentation. For instance:

```text
allowed_model = vendor-x/model-2026-08
```

rather than:

```text
model = latest
```

where technically possible. For downloadable artifacts, provenance can also include hashes, signatures, repository source and exact dependency versions. The principle is:

$$
\boxed{
\text{Approved dependency}
=
\text{specific identifiable artifact/configuration}
}
$$

not merely:

“We approved Vendor X.”

![Studio Light comparison of a supplier list with the component graph for a support-prioritization workflow, including direct suppliers, fourth parties, data flows, control flows, and concentration risk](/content-assets/articles/article-mlops-governance-and-responsible-ai-third-party-ai-model-supply-chain-risk/component-graph-vs-supplier-list.png)

*A component graph shows which external dependency affects each workflow stage, which supplier and fourth parties sit upstream, and where one shared provider can create concentration risk.*

## How Do Versioned Manifests, Supplier Change Monitoring, and Boundary Tests Control Ongoing Dependence?
<!-- section-summary: Immutable component and release versions, a production dependency manifest, continuous supplier-change detection, and tests at the local boundary prevent silent drift. -->

Immutable component and release versions, a production dependency manifest, continuous supplier-change detection, and tests at the local boundary prevent silent drift.

Traditional software updates usually change software logic. AI supplier updates can change **behaviour** while keeping the API contract identical. Yesterday:

```text
POST /chat
```

Today:

```text
POST /chat
```

Nothing appears to change. But underneath:

```text
Model v3 → Model v4
Safety policy A → Safety policy B
Tokenizer A → B
Retrieval behaviour changes
```

Your application code shows:

```text
0 changed files
```

while system behaviour has changed materially. Therefore:

$$
\boxed{\text{No local code change} \neq \text{no system change}}
$$

Model/vendor version must become part of configuration management. For each governed AI deployment, you should be able to reconstruct something like:

```text
Deployment DEP-8173
System AI-SYS-0917

App code             commit a82c...
System prompt         PROMPT-42
Vendor model          MODEL-X-2026-08
Embedding model       EMBED-12
Moderation model      MOD-Y-7
Knowledge snapshot    KB-2026-08-29
Vector service        VS-3.9
Policy configuration  POLICY-18
```

This resembles a software bill of materials conceptually, but extends beyond ordinary libraries into **AI-specific behavioural dependencies**. Whether an organization calls it an AI BOM, model manifest, dependency manifest or something else matters less than the capability:

$$
\text{production behaviour}
\rightarrow
\text{reconstructable dependencies}
$$

That is essential for audits and incidents. Due diligence performed at procurement answers:

“Was this acceptable when we adopted it?”

Governance also needs:

“Is it still acceptable now?”

A supplier might change its model, terms of service, data-retention policy, subprocessors, geographic hosting, safety architecture, licence, API, pricing, availability commitment or end-of-life schedule. Therefore supplier monitoring should feed your change-management process:

```text
Supplier change
      ↓
Affected component
      ↓
Dependent systems
      ↓
Materiality assessment
      ↓
Re-test
Reassess
Reapprove
      ↓
Production decision
```

The risk is particularly acute with AI because externally managed models may evolve faster than traditional enterprise dependencies. Consider three cases.

### Controlled upgrade

```text
Model v3
   ↓
notice
   ↓
local evaluation
   ↓
approval
   ↓
Model v4
```

This is governable.

### Forced upgrade

```text
Model v3
   ↓
vendor announces retirement
   ↓
30 days
   ↓
Model v4
```

This creates migration risk.

### Silent behavioural change

```text
"Model v3"
   ↓
provider changes hidden implementation
   ↓
same identifier
   ↓
different behaviour
```

This is much harder. Your supplier assurance should therefore examine whether models are:

* immutable,
* version-pinned,
* dated snapshots,
* aliases such as `latest`,
* or continuously updated services.

The less control you have over version stability, the more compensating monitoring and regression testing you need. If you cannot see inside a model, you can still observe inputs and outputs. Maintain a controlled evaluation suite:

```text
Reference prompts / cases
         ↓
Vendor model
         ↓
Expected behaviours
         ↓
Compare
```

Possible checks include:

| Dimension     | Example                                 |
| ------------- | --------------------------------------- |
| Task quality  | expected task completion                |
| Safety        | harmful-output scenarios                |
| Grounding     | unsupported factual claims              |
| Privacy       | sensitive information leakage           |
| Security      | prompt-injection behaviour              |
| Fairness      | performance across relevant populations |
| Stability     | regression from approved baseline       |
| Format        | machine-readable output contract        |
| Human factors | whether operators can use output safely |

This gives you a local behavioural fingerprint. If a supplier changes something unexpectedly:

$$
\text{new behaviour}
-
\text{approved baseline}
\rightarrow
\text{alert}
$$

That can reveal supplier drift even when the supplier does not expose its internal implementation.

## How Do Exit, Portability, Fallback, Redundancy, and Concentration Risk Differ?
<!-- section-summary: Exit design preserves evidence and operations, portability reduces switching friction, fallback maintains bounded continuity, redundancy adds dependencies, and concentration risk measures shared exposure. -->

Exit design preserves evidence and operations, portability reduces switching friction, fallback maintains bounded continuity, redundancy adds dependencies, and concentration risk measures shared exposure.

Third-party risk is often visible only when the organization wants to leave. Suppose your system has accumulated:

* vendor-specific prompts,
* proprietary fine-tuning,
* proprietary vector formats,
* vendor-specific agent APIs,
* millions of cached embeddings,
* custom monitoring,
* deeply integrated authentication,
* exclusive contractual terms.

Switching cost becomes:

$$
C_{\text{exit}}
\uparrow
$$

and effective bargaining/governance power becomes:

$$
P_{\text{customer}}
\downarrow
$$

That creates **lock-in risk**. Therefore exit design is not an end-of-contract activity. It belongs in architecture review. A system can be designed behind an abstraction:

```text
Business workflow
        ↓
Internal model interface
        ↓
     Router
   ┌────┼────┐
   ▼    ▼    ▼
Model A B    C
```

Now switching is still difficult, because models behave differently, but it is less structurally impossible. Possible exit controls include reusable evaluation suites, provider-neutral data formats, export rights, owned copies of important prompts/configuration, portable logging schemas, backup models, documented migration procedures and avoidance of unnecessary proprietary coupling. The principle is:

$$
\boxed{\text{Optionality reduces dependency risk}}
$$

These are related but different. A **fallback** answers:

“What happens during an immediate failure?”

For example:

```text
Vendor model unavailable
        ↓
route to backup model
```

or:

```text
AI unavailable
        ↓
manual processing
```

- **Portability** answers:

“What happens if we must leave this supplier permanently?”

The second may require:

```text
export data
replace API
re-test replacement
update documentation
retrain staff
migrate monitoring
reassess impacts
```

NIST explicitly recommends contingency processes, including potential redundancy mechanisms, for failures of important third-party AI and data systems, and recommends ensuring incident-response plans cover third-party systems. ([NIST AI Resource Center][3]) Two models are not automatically safer than one. Suppose:

```text
Primary = Vendor A
Backup  = Vendor B
```

but both depend upon:

```text
Cloud Provider C
```

Then a cloud failure takes out both. Or both models were fine-tuned from the same upstream open-source model. So:

$$
\text{apparent redundancy}
\neq
\text{independent redundancy}
$$

Dependency mapping should therefore capture **common-mode dependencies**. This is the difference between:

“We have two vendors”

and:

“We have two genuinely independent failure paths.”

Imagine 80 unrelated business applications all adopt the same foundation model. Each team individually concludes:

```text
dependency risk = acceptable
```

At enterprise level:

```text
80 critical systems
       ↓
one supplier
```

creates concentration risk. Therefore:

$$
R_{\text{portfolio}}
\neq
\sum R_{\text{systems independently assessed}}
$$

Governance needs portfolio-level questions such as:

How many critical systems depend on one provider
What percentage of customer operations would fail simultaneously
Are supposedly independent fallback systems using the same upstream infrastructure

This is one reason the AI inventory and supplier inventory need to be connected.

## How Should Incidents Propagate, Be Contained, and Preserve Local Accountability across Commercial and Open-Source Components?
<!-- section-summary: Supplier incidents travel through the dependency graph, so predesigned containment and two-way information flow apply to commercial and open-source components while the local owner remains accountable. -->

Supplier incidents travel through the dependency graph, so predesigned containment and two-way information flow apply to commercial and open-source components while the local owner remains accountable.

Suppose Vendor X informs you:

“Model version 2026-08 may reveal sensitive prompt content under specific conditions.”

The investigation should not begin with:

“Who remembers using Vendor X?”

It should query the dependency graph:

```text
MODEL-X-2026-08
       ↓
AI-SYS-0917
AI-SYS-1104
AI-SYS-2241
       ↓
Production deployments
       ↓
Affected workflows
       ↓
Possible customers/data
```

Then incident response becomes:

$$
\boxed{
\text{component incident}
\rightarrow
\text{dependency blast radius}
\rightarrow
\text{containment}
\rightarrow
\text{assessment}
\rightarrow
\text{correction}
}
$$

NIST expressly calls for contingency processes for high-risk third-party data and AI failures and for incident-response plans to account for those dependencies. ([NIST AI Resource Center][3]) Useful technical controls might allow you to:

```text
disable supplier
```

or:

```text
block affected version
```

or:

```text
route requests to fallback
```

or:

```text
turn AI workflow into human-only mode
```

or:

```text
disable one capability while preserving others
```

For example:

```text
Vendor model incident
       ↓
Kill switch
       ↓
AI drafting disabled
       ↓
Agents continue manually
```

A system that cannot operate safely without one external AI service has inherently greater operational dependency risk. There should be two channels.

```text
Supplier
   ↓
Your organization
```

for issues such as security incidents, model defects, safety problems, outages or forced upgrades. And:

```text
Your organization
   ↓
Supplier
```

for observed vulnerabilities, harmful behaviours, unexpected failures or performance degradation. NIST recommends establishing mechanisms through which third parties and other actors can report vulnerabilities, risks or biases. ([NIST AI Resource Center][3]) A contract that says “notify us of a breach” is therefore only one part of a much broader AI incident relationship. Another common mistake is:

“There is no vendor, so there is no third-party risk.”

If you download an open-source model, you inherit dependencies from people and organizations outside your control. The risk profile changes, but it does not disappear. You may gain:

```text
more inspectability
more version control
ability to self-host
```

while taking on more responsibility for:

```text
security patching
model evaluation
licence compliance
infrastructure
monitoring
provenance verification
safe deployment
```

NIST explicitly says third-party governance approaches can also apply to open-source software, publicly available data and commercially available models. ([NIST AI Resource Center][3]) So:

$$
\boxed{\text{Open source} \neq \text{risk-free}}
$$

and:

$$
\boxed{\text{commercial vendor} \neq \text{automatically safer}}
$$

They create different control problems. Every external dependency needs a local accountable owner. Consider:

```text
Vendor:
owns foundation-model development

Procurement:
owns commercial relationship

Security:
owns cybersecurity review

Privacy:
owns privacy assessment
```

Who owns:

“Should our company continue using this model for credit decisions?”

There must still be a **local system/business owner**. Otherwise responsibility fragments across specialist functions. A useful division is:

| Actor                 | Accountability                       |
| --------------------- | ------------------------------------ |
| System owner          | suitability of overall use           |
| Technical owner       | integration and version control      |
| Supplier manager      | commercial/vendor relationship       |
| Security              | security assurance                   |
| Privacy               | data/privacy risk                    |
| Responsible AI / risk | independent challenge                |
| Legal                 | contractual/regulatory issues        |
| Supplier              | agreed component responsibilities    |
| Senior risk authority | acceptance of material residual risk |

The supplier participates in governance. It does not replace your governance.

![Studio Light evidence path from a supplier language-support claim through scope checking, local assurance, observed evidence, gaps, and an adoption decision](/content-assets/articles/article-mlops-governance-and-responsible-ai-third-party-ai-model-supply-chain-risk/supplier-evidence-local-assurance.png)

*Supplier evidence describes the external product boundary; local assurance tests the exact version, buyer data, configuration, workflow, and failure behavior before the adoption decision.*

## How Do Inventory Reconciliation, Shadow AI Discovery, Selective Evidence Invalidation, and Multiple Risk Dimensions Work?
<!-- section-summary: Production reality is reconciled with governance records, unregistered use is discovered, changed components invalidate only affected evidence, and security, privacy, quality, compliance, resilience, and strategic risk stay visible. -->

Production reality is reconciled with governance records, unregistered use is discovered, changed components invalidate only affected evidence, and security, privacy, quality, compliance, resilience, and strategic risk stay visible.

Suppose the AI inventory says:

```text
AI-SYS-0917
Model supplier: Vendor A
Approved model: v3
```

Production telemetry says:

```text
AI-SYS-0917
Actual endpoint: Vendor B
Actual model: v5
```

Your governance documentation is now fictional. So third-party assurance needs reconciliation:

```text
AI inventory
       ↕
Supplier register
       ↕
Model registry
       ↕
API gateway
       ↕
Cloud assets
       ↕
Production telemetry
```

Useful controls can ask:

Does every external AI endpoint correspond to an approved supplier
Does every production model version match the approved inventory record
Are there connections to unregistered AI APIs
Are retired suppliers still receiving traffic
Are production systems using vendor aliases such as `latest` when policy requires pinned versions

This turns governance into **continuous assurance**. Teams may create dependencies outside formal procurement by:

```text
pip install ...
```

downloading an open-source model, creating an API key, installing an AI SaaS plugin, using an external dataset, or connecting an agent to another service. Therefore:

$$
\text{approved dependencies}
\neq
\text{actual dependencies}
$$

unless you verify them. Potential discovery sources include the API gateway, egress/network telemetry, cloud AI services, model registries, source repositories, software dependency scanners, procurement records, expense systems and SaaS inventories. The control equation becomes:

$$
\text{observed third-party AI}
-
\text{registered third-party AI}
=
\text{potential shadow dependencies}
$$

Suppose local assurance was performed against:

```text
Vendor model v3
```

The supplier releases:

```text
Vendor model v4
```

Do you need to repeat every governance activity Not necessarily. Instead ask:

$$
\boxed{
\text{Which assumptions supporting the previous assurance changed?}
}
$$

Perhaps:

```text
security architecture unchanged
API unchanged
data policy unchanged
model behaviour changed
```

Then you may need to rerun behavioural evaluation and impact assessment, while preserving unrelated evidence. This is more mature than either extreme:

“Vendor said it's backward compatible, so nothing needs reviewing.”

or:

“Every supplier patch requires restarting governance from zero.”

It is easy to reduce supplier risk to cybersecurity. AI dependencies introduce a broader set of dimensions:

$$
R_{\text{supplier}}
=
f(
\text{security},
\text{privacy},
\text{safety},
\text{quality},
\text{fairness},
\text{IP},
\text{provenance},
\text{resilience},
\text{regulatory support},
\text{change},
\text{concentration},
\text{exit}
)
$$

For example, a supplier can be:

* highly secure but systematically inaccurate for your population;
* accurate but impossible to audit sufficiently;
* well documented but operationally unreliable;
* excellent technically but contractually able to change the model without notice;
* low risk individually but a dangerous concentration point across 150 enterprise systems.

Supply-chain governance must see all of these.

## How Does the Full Supplier Lifecycle Connect to Responsible AI and Governance Standards?
<!-- section-summary: The lifecycle runs from need and diligence through contract, integration, release, monitoring, change, incident, exit, and retirement, supporting Responsible AI and formal governance controls. -->

The lifecycle runs from need and diligence through contract, integration, release, monitoring, change, incident, exit, and retirement, supporting Responsible AI and formal governance controls.

A mature third-party AI process looks like this:

```text
             IDENTIFY NEED
                   │
                   ▼
           CLASSIFY USE RISK
                   │
                   ▼
          MAP REQUIRED ASSURANCE
                   │
                   ▼
            DUE DILIGENCE
                   │
                   ▼
          LOCAL ASSURANCE TESTS
                   │
                   ▼
         CONTRACT / RESPONSIBILITY
                   │
                   ▼
       REGISTER DEPENDENCY + VERSION
                   │
                   ▼
              RELEASE GATE
                   │
                   ▼
               PRODUCTION
                   │
          ┌────────┴────────┐
          ▼                 ▼
      MONITOR            SUPPLIER
     BEHAVIOUR            CHANGES
          │                 │
          └────────┬────────┘
                   ▼
               REASSESS
                   │
          ┌────────┴────────┐
          ▼                 ▼
       CONTINUE           EXIT
```

Procurement is merely one stage. Imagine a bank builds:

```text
AI-SYS-3801
Customer complaint assistant
```

It uses an external LLM. The vendor claims:

```text
enterprise-grade security
no customer training
strong safety performance
99.9% availability
```

Those claims enter due diligence as evidence. The bank then tests the actual application:

```text
Customer complaint
        ↓
RAG over complaint history
        ↓
Vendor LLM
        ↓
Suggested response
        ↓
Human agent
```

Local tests discover that the model sometimes invents compensation policies. The bank therefore creates controls:

```text
approved policy sources only
       +
citation requirement
       +
unsupported-claim detector
       +
human approval
```

The contract requires advance notification of major model changes and security/safety incidents. The API gateway records:

```text
system_id   = AI-SYS-3801
provider    = Vendor X
model       = model-2026-08
```

A regression suite runs periodically. Then Vendor X announces:

```text
model-2026-08 retires in 45 days
replacement = model-2026-10
```

Governance automatically identifies:

```text
AI-SYS-3801
AI-SYS-4017
AI-SYS-5882
```

as affected. `model-2026-10` goes through the existing local test suite. One system passes. Another develops materially higher hallucination rates. The upgrade is therefore:

```text
approved for 3801
blocked for 4017
```

even though the **same supplier model** was assessed. That captures the fundamental principle:

$$
\boxed{
\text{Component suitability is system-context dependent}
}
$$

Responsible AI often uses words such as:

fairness, safety, transparency, accountability, privacy, robustness.

Third-party dependencies complicate every one. You may want transparency, but the supplier may not reveal training data. You may want stability, but the supplier may update continuously. You may want explainability, but the component may be opaque. You may want strong incident response, but the supplier may notify you late. You may want fairness testing, but vendor benchmarks may not represent your population. You may want accountability, while several companies jointly influence the final behaviour. Therefore third-party governance turns Responsible AI principles into concrete questions about:

$$
\boxed{
\text{visibility}
+
\text{control}
+
\text{verification}
+
\text{contract}
+
\text{resilience}
}
$$

NIST AI RMF makes this relationship explicit. Its Govern function includes policies and procedures for risks and benefits arising from third-party software, data and supply-chain issues, while Govern 6.2 calls for contingency processes for failures or incidents involving high-risk third-party AI or data. ([NIST AI Resource Center][6]) ISO/IEC 42001 approaches the problem from the management-system level: organizations providing or using AI are expected to establish, operate, evaluate and continually improve a structured AI management system rather than handling AI risk ad hoc. ([ISO][7])

And under the EU AI Act, supply-chain accountability becomes directly relevant to legal roles and obligations: Article 25 addresses responsibilities along the AI value chain, including written cooperation requirements for relevant high-risk-system suppliers and circumstances where another actor can become the provider. ([EUR-Lex][5]) The frameworks differ, but the engineering logic is the same.

## What Is the Central Principle of Third-Party AI Risk?
<!-- section-summary: The central principle is that an organization may depend on external AI, but it cannot outsource understanding, system-level assurance, operational control, or accountability for local consequences. -->

The central principle is that an organization may depend on external AI, but it cannot outsource understanding, system-level assurance, operational control, or accountability for local consequences.

Third-party AI governance begins with this equation:

$$
\boxed{
\text{Your AI system}
=
\text{your components}
+
\text{external components}
+
\text{their interactions}
}
$$

Therefore:

$$
\boxed{
\text{Your system risk}
\neq
\text{only the risk of what you built}
}
$$

A strong supply-chain control loop is:

$$
\boxed{
\text{Discover}
\rightarrow
\text{Map}
\rightarrow
\text{Assess}
\rightarrow
\text{Test}
\rightarrow
\text{Contract}
\rightarrow
\text{Pin}
\rightarrow
\text{Monitor}
\rightarrow
\text{Contain}
\rightarrow
\text{Reassess}
\rightarrow
\text{Replace or Exit}
}
$$

The supplier tells you what it knows about the component.

- **You verify what matters for your use.**

The contract determines who must provide information and perform particular actions.

- **Your governance determines whether the resulting system is acceptable.**

Version and dependency controls determine what is actually running.

- **Monitoring determines whether reality has changed.**

Fallback and exit architecture determine whether a supplier failure becomes an inconvenience or an organizational crisis. And the stable AI-system/dependency graph gives you the ability to answer the most important question when anything changes:

**Which real production systems, decisions, people, controls, and previous approvals depend on this component?**

That is the core of **third-party AI and model supply-chain risk management**: making external dependencies visible enough to govern, constrained enough to control, observable enough to detect change, and replaceable enough that dependence does not become loss of accountability.

![Studio Light summary of seven third-party AI governance jobs, a controlled response table for supplier changes, and distinct fallback, portability, exit, and retirement checks](/content-assets/articles/article-mlops-governance-and-responsible-ai-third-party-ai-model-supply-chain-risk/third-party-governance-summary.png)

*The controls have separate jobs: identify the dependency, set review depth, test it locally, assign supplier responsibilities, bind the release, respond to change, and preserve a tested withdrawal path.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Does the Full AI Supply Chain Include beyond a Vendor List?]{kind="recap"}
AI supply-chain risk includes models, data, libraries, services, platforms, evaluators, tools, and upstream dependencies, which require a graph and separate component assurance from system assurance.
:::

:::expand[How Should Due Diligence, Contracts, Accountability, and Technical Boundaries Be Designed before Adoption?]{kind="recap"}
Due-diligence depth follows impact, contracts assign evidence and incident duties, local accountability remains, and a controlled boundary limits data, authority, outputs, and failure propagation.
:::

:::expand[How Do Versioned Manifests, Supplier Change Monitoring, and Boundary Tests Control Ongoing Dependence?]{kind="recap"}
Immutable component and release versions, a production dependency manifest, continuous supplier-change detection, and tests at the local boundary prevent silent drift.
:::

:::expand[How Do Exit, Portability, Fallback, Redundancy, and Concentration Risk Differ?]{kind="recap"}
Exit design preserves evidence and operations, portability reduces switching friction, fallback maintains bounded continuity, redundancy adds dependencies, and concentration risk measures shared exposure.
:::

:::expand[How Should Incidents Propagate, Be Contained, and Preserve Local Accountability across Commercial and Open-Source Components?]{kind="recap"}
Supplier incidents travel through the dependency graph, so predesigned containment and two-way information flow apply to commercial and open-source components while the local owner remains accountable.
:::

:::expand[How Do Inventory Reconciliation, Shadow AI Discovery, Selective Evidence Invalidation, and Multiple Risk Dimensions Work?]{kind="recap"}
Production reality is reconciled with governance records, unregistered use is discovered, changed components invalidate only affected evidence, and security, privacy, quality, compliance, resilience, and strategic risk stay visible.
:::

:::expand[How Does the Full Supplier Lifecycle Connect to Responsible AI and Governance Standards?]{kind="recap"}
The lifecycle runs from need and diligence through contract, integration, release, monitoring, change, incident, exit, and retirement, supporting Responsible AI and formal governance controls.
:::

:::expand[What Is the Central Principle of Third-Party AI Risk?]{kind="recap"}
The central principle is that an organization may depend on external AI, but it cannot outsource understanding, system-level assurance, operational control, or accountability for local consequences.
:::

## References

[1]: https://airc.nist.gov/airmf-resources/playbook/govern/ "Govern - AIRC"
[2]: https://airc.nist.gov/airmf-resources/playbook/map/ "Map - AIRC"
[3]: https://airc.nist.gov/airmf-resources/playbook/govern/ "Govern - AIRC"
[4]: https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng "EUR-Lex - 02024R1689-20260727 - PT - EUR-Lex"
[5]: https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32024R1689 "Regulation - EU - 2024/1689 - HR - EUR-Lex"
[6]: https://airc.nist.gov/airmf-resources/airmf/5-sec-core/ "AI RMF Core - AIRC"
[7]: https://www.iso.org/standard/42001 "ISO/IEC 42001:2023 - AI management systems"
