---
title: "Threat Modeling ML Systems"
description: "Threat modeling identifies assets, actors, changing trust boundaries, realistic capabilities, attack paths, controls, and residual risk across the complete system before selecting defenses."
overview: "Threat modeling identifies assets, actors, changing trust boundaries, realistic capabilities, attack paths, controls, and residual risk across the complete system before selecting defenses. The enterprise-agent example maps the full system, tests realistic paths, assigns residual-risk ownership, updates the model after change and incidents, and connects security to Responsible AI."
tags: ["MLOps", "production", "security"]
order: 1
id: "article-mlops-governance-and-responsible-ai-ml-threat-modeling"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/security/00-ml-threat-modeling.md
---

## Table of Contents

1. [How Do Assets, Actors, Trust Boundaries, Capabilities, Attack Paths, and Residual Risk Define an ML Threat Model?](#how-do-assets-actors-trust-boundaries-capabilities-attack-paths-and-residual-risk-define-an-ml-threat-model)
2. [How Do Conventional Threats, STRIDE, and MITRE ATLAS Extend into ML?](#how-do-conventional-threats-stride-and-mitre-atlas-extend-into-ml)
3. [How Can Data, Labels, Feedback, Training Infrastructure, Supply Chains, Registries, and Release Authority Be Attacked?](#how-can-data-labels-feedback-training-infrastructure-supply-chains-registries-and-release-authority-be-attacked)
4. [How Do Evasion, Extraction, and Privacy Attacks Use Legitimate Model Interfaces?](#how-do-evasion-extraction-and-privacy-attacks-use-legitimate-model-interfaces)
5. [How Do Generative AI, Retrieval, Memory, Tools, Agents, Insiders, Tenants, and Third Parties Create New Trust Paths?](#how-do-generative-ai-retrieval-memory-tools-agents-insiders-tenants-and-third-parties-create-new-trust-paths)
6. [How Should Attack Paths Drive Prevention, Detection, Response, Release Gates, and Red-Team Evidence?](#how-should-attack-paths-drive-prevention-detection-response-release-gates-and-red-team-evidence)
7. [How Do Prepared Response, Threat-Aligned Monitoring, and Platform Controls Reduce Residual Risk?](#how-do-prepared-response-threat-aligned-monitoring-and-platform-controls-reduce-residual-risk)
8. [How Does a Complete Agent Example Keep Threat Modeling Alive and Accountable?](#how-does-a-complete-agent-example-keep-threat-modeling-alive-and-accountable)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A fraudster can probe a model through valid transactions, a data contributor can poison future training, and an AI agent can be manipulated by instructions hidden in retrieved content. None of those attacks requires a conventional server break-in.

An **ML threat model** maps what must be protected, who can influence the system, where trust changes, what each actor can observe or control, which sequence could produce harm, and where controls can break that sequence. It covers the complete lifecycle and decision path.

These questions move from the basic threat model through data and model attacks, generative and agent boundaries, red-team evidence, response, monitoring, platforms, and accountable residual risk:

1. **How Do Assets, Actors, Trust Boundaries, Capabilities, Attack Paths, and Residual Risk Define an ML Threat Model?**
2. **How Do Conventional Threats, STRIDE, and MITRE ATLAS Extend into ML?**
3. **How Can Data, Labels, Feedback, Training Infrastructure, Supply Chains, Registries, and Release Authority Be Attacked?**
4. **How Do Evasion, Extraction, and Privacy Attacks Use Legitimate Model Interfaces?**
5. **How Do Generative AI, Retrieval, Memory, Tools, Agents, Insiders, Tenants, and Third Parties Create New Trust Paths?**
6. **How Should Attack Paths Drive Prevention, Detection, Response, Release Gates, and Red-Team Evidence?**
7. **How Do Prepared Response, Threat-Aligned Monitoring, and Platform Controls Reduce Residual Risk?**
8. **How Does a Complete Agent Example Keep Threat Modeling Alive and Accountable?**

## How Do Assets, Actors, Trust Boundaries, Capabilities, Attack Paths, and Residual Risk Define an ML Threat Model?
<!-- section-summary: Threat modeling identifies assets, actors, changing trust boundaries, realistic capabilities, attack paths, controls, and residual risk across the complete system before selecting defenses. -->

Threat modeling identifies assets, actors, changing trust boundaries, realistic capabilities, attack paths, controls, and residual risk across the complete system before selecting defenses.

A conventional security review often asks:

**“Can someone break into this system?”**

Threat modeling an ML or AI system asks something broader:

**“Who could deliberately make this system learn the wrong thing, produce the wrong thing, reveal something valuable, or take an action it should not take—and how?”**

That difference matters because an AI attack does not always require compromising a server. An attacker might interact with the system through its completely legitimate interface and still cause harm:

$$
\text{Valid API request}
\rightarrow
\text{Manipulated model behavior}
\rightarrow
\text{Harm}
$$

Or they might corrupt training data:

$$
\text{Poisoned data}
\rightarrow
\text{Training}
\rightarrow
\text{Apparently normal model}
\rightarrow
\text{Attacker-controlled failure later}
$$

NIST's current adversarial-ML taxonomy explicitly treats attacker **goals, capabilities, knowledge and lifecycle stage** as important dimensions of the problem. It covers attacks including evasion, poisoning, privacy attacks and misuse. ([NIST][1]) That gives us the starting principle:

$$
\boxed{
\text{AI security}
\neq
\text{just securing the model API}
}
$$

We must secure the entire system that creates, operates and acts on the model.

### Start with what threat modeling actually does

Imagine an ML system:

$$
\text{Data}
\rightarrow
\text{Training}
\rightarrow
\text{Model}
\rightarrow
\text{API}
\rightarrow
\text{Prediction}
\rightarrow
\text{Action}
$$

The security team could try to make every component “secure.” But secure against **what** Threat modeling provides the missing structure. It asks:

$$
\boxed{
\text{Who}
\rightarrow
\text{can influence what}
\rightarrow
\text{through which path}
\rightarrow
\text{to cause which consequence?}
}
$$

Only after answering that question can we sensibly choose controls. So threat modeling is not primarily a vulnerability scanner. It is a **reasoning process about adversarial behaviour**. Most of threat modeling can be reduced to six concepts.

| Concept                             | First-principles question                                  |
| ----------------------------------- | ---------------------------------------------------------- |
| **Asset**                           | What do we care about protecting                          |
| **Actor**                           | Who interacts with the system                             |
| **Trust boundary / attack surface** | Where does less-trusted information or authority enter    |
| **Capability**                      | What can an adversary actually observe, modify or control |
| **Attack path**                     | What sequence of events could produce harm                |
| **Control + residual risk**         | Where can we break that path, and what risk remains       |

Suppose we run a fraud-detection model. An asset could be:

$$
\text{Integrity of fraud decisions}
$$

An actor could be:

$$
\text{Fraudster}
$$

An attack surface could be:

$$
\text{Transaction input API}
$$

The attacker's capability might be:

$$
\text{Submit many transactions and observe outcomes}
$$

An attack path might be:

$$
\text{Probe model}
\rightarrow
\text{infer decision boundary}
\rightarrow
\text{modify transactions}
\rightarrow
\text{avoid detection}
$$

Controls might include rate limits, anomaly detection, reduced information in responses, model monitoring and secondary fraud checks. The remaining exposure is the **residual risk**.

Conceptually:

$$
\text{Risk}
\approx
\text{Attack feasibility}
\times
\text{Impact}
$$

and:

$$
\text{Residual Risk}
=
f(
\text{original risk},
\text{control effectiveness}
)
$$

These are reasoning equations rather than precise mathematical formulas. These terms are easy to blur. A **threat** is something undesirable an adversary might cause.

Training data could be deliberately corrupted.

A **vulnerability** is the weakness making it possible.

Anyone can submit data that automatically enters training.

An **attack** is an attempt to exploit that weakness.

An adversary submits carefully manipulated examples.

The **impact** is what happens if the attack succeeds.

The retrained fraud model stops recognizing a particular fraud pattern.

And the **risk** combines how plausible that scenario is with how damaging it would be. So:

$$
\text{Threat}
+
\text{Vulnerability}
+
\text{Adversary capability}
\rightarrow
\text{Attack possibility}
$$

and:

$$
\text{Attack possibility}
+
\text{Consequence}
\rightarrow
\text{Risk}
$$

This distinction prevents threat models from degenerating into enormous lists of scary attack names. You cannot threat-model something you have not defined. For ordinary predictive ML, the real architecture might look like:

$$
\text{External Data}
\rightarrow
\text{Ingestion}
\rightarrow
\text{Validation}
\rightarrow
\text{Feature/Label Store}
$$

$$
\downarrow
$$

$$
\text{Training Code}
\rightarrow
\text{Training Infrastructure}
\rightarrow
\text{Model Artifact}
\rightarrow
\text{Registry}
$$

$$
\downarrow
$$

$$
\text{Deployment}
\rightarrow
\text{Inference API}
\rightarrow
\text{Business Decision}
$$

and often:

$$
\text{Production Feedback}
\rightarrow
\text{Future Training Data}
$$

Every arrow matters. The attacker does not necessarily attack:

$$
\boxed{\text{Model}}
$$

They might attack:

$$
\text{dataset}
$$

or:

$$
\text{labels}
$$

or:

$$
\text{training script}
$$

or:

$$
\text{dependency}
$$

or:

$$
\text{registry}
$$

or:

$$
\text{deployment credentials}
$$

or:

$$
\text{feedback mechanism}
$$

Microsoft's AI/ML threat-modeling guidance similarly emphasizes extending the normal threat boundary to training data, ML dependencies, data/model supply chains and the presentation layers around the model. ([Microsoft Learn][2]) A **trust boundary** exists whenever data, code or authority moves from one trust level to another.

For example:

$$
\text{Public Internet}
\;|\;
\text{Company API}
$$

The vertical line is a trust boundary. Likewise:

$$
\text{Third-party dataset}
\;|\;
\text{Internal training environment}
$$

or:

$$
\text{Developer}
\;|\;
\text{Production registry}
$$

or:

$$
\text{Model}
\;|\;
\text{Bank payment system}
$$

At every boundary ask:

Why are we trusting what crossed this boundary

That question is enormously powerful. If the answer is:

“Because the model produced it,”

that is usually insufficient. Saying:

“The attacker is a sophisticated hacker”

does not help much. A better description is:

“The attacker can create unlimited user accounts, issue API queries, observe predicted labels, but cannot see model weights or training data.”

Now we can reason. Useful dimensions include **knowledge**, **access**, **influence**, **privilege**, **resources** and **persistence**. For model knowledge, for example:

$$
\text{Black box}
$$

might mean the attacker can only query the model.

$$
\text{Grey box}
$$

could mean they know the architecture or training process.

$$
\text{White box}
$$

could mean they possess the weights and implementation. For influence:

$$
\text{Input control}
<
\text{Training-data control}
<
\text{Training-code control}
<
\text{Registry/admin control}
$$

usually represents increasing power. NIST's adversarial-ML framework explicitly incorporates attacker capabilities and knowledge because attack feasibility changes dramatically depending on what the attacker can access or manipulate. ([NIST][1])

## How Do Conventional Threats, STRIDE, and MITRE ATLAS Extend into ML?
<!-- section-summary: Conventional software threats remain, while STRIDE organizes familiar categories and MITRE ATLAS provides adversarial-ML techniques that connect to lifecycle stages and attacker goals. -->

Conventional software threats remain, while STRIDE organizes familiar categories and MITRE ATLAS provides adversarial-ML techniques that connect to lifecycle stages and attacker goals.

It is a mistake to think:

“Because this is AI, ordinary cybersecurity no longer applies.”

The opposite is true. If someone steals a cloud administrator credential and replaces the production model, you do not need sophisticated adversarial ML. They simply own the system. Therefore:

$$
\boxed{
\text{ML security}
=
\text{traditional security foundation}
+
\text{ML-specific attack analysis}
}
$$

Microsoft's AI/ML threat-modeling guidance makes the same point: conventional secure-development controls remain foundational, with AI/ML-specific analysis added on top. ([Microsoft Learn][2]) STRIDE is useful for examining ordinary security properties around every component and trust boundary. It stands for **Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service and Elevation of Privilege**. ([Microsoft Learn][3]) For ML systems, we can reinterpret it like this:

| STRIDE threat              | ML example                                                           |
| -------------------------- | -------------------------------------------------------------------- |
| **Spoofing**               | Attacker pretends to be a trusted data producer                      |
| **Tampering**              | Training labels, weights or registry artifacts are altered           |
| **Repudiation**            | Nobody can determine who approved or deployed a model                |
| **Information disclosure** | Training data, secrets or proprietary model information leaks        |
| **Denial of service**      | Queries exhaust inference resources or create runaway cost           |
| **Elevation of privilege** | A model or user gains access to tools or data beyond their authority |

STRIDE is extremely useful. But it does not naturally give you vocabulary such as:

data poisoning
adversarial evasion
membership inference
model extraction
prompt injection

That is why AI-specific frameworks are useful alongside it. MITRE ATLAS plays a different role. Think of STRIDE as asking:

**“What fundamental security property might fail here?”**

ATLAS helps ask:

**“What techniques have adversaries actually used or plausibly can use against AI systems?”**

The current ATLAS matrix covers predictive AI, generative AI and agentic AI, alongside enterprise attack techniques, and organizes adversarial behaviour into tactics and techniques. ([MITRE ATLAS][4]) So a good workflow is:

$$
\text{Architecture}
\rightarrow
\text{Trust boundaries}
\rightarrow
\text{STRIDE}
\rightarrow
\text{AI-specific abuse cases}
\rightarrow
\text{ATLAS cross-check}
$$

Neither framework should become a checklist that substitutes for thinking. They are **lenses** for finding attack paths you may have forgotten.

![Two attack paths in an automated image-inspection system, comparing model artifact substitution with a visual backdoor and showing the different controls needed for the same unsafe outcome](/content-assets/articles/article-mlops-governance-and-responsible-ai-ml-threat-modeling/two-attack-paths-one-harm.png)

*Artifact substitution and a visual backdoor can both let an unsafe item pass, but their attack paths require different verification evidence.*

## How Can Data, Labels, Feedback, Training Infrastructure, Supply Chains, Registries, and Release Authority Be Attacked?
<!-- section-summary: Training data, labels, feedback loops, notebooks, infrastructure, dependencies, registries, and separated build, approval, and deployment duties each create integrity and authority boundaries. -->

Training data, labels, feedback loops, notebooks, infrastructure, dependencies, registries, and separated build, approval, and deployment duties each create integrity and authority boundaries.

ML creates a particularly important dependency:

$$
\boxed{
\text{Model behaviour depends on historical data}
}
$$

Therefore whoever can influence training data may be able to influence future behaviour. Consider:

$$
\text{User activity}
\rightarrow
\text{Feedback}
\rightarrow
\text{Training dataset}
\rightarrow
\text{New model}
$$

Now the “feedback” endpoint is effectively a write path into future model behaviour. Suppose a spam detector retrains from messages users mark as spam. An attacker might attempt:

$$
\text{Manipulated feedback}
\rightarrow
\text{Incorrect labels}
\rightarrow
\text{Retraining}
\rightarrow
\text{Changed classification}
$$

This is why provenance matters. For every important training item, ideally you can answer:

$$
\text{Where did this come from?}
$$

$$
\text{Who or what created its label?}
$$

$$
\text{Was it modified?}
$$

$$
\text{Which model versions consumed it?}
$$

Microsoft's threat-modeling guidance specifically highlights poisoning risk and the importance of data provenance and lineage. ([Microsoft Learn][2]) Suppose the raw image is authentic. But:

$$
\text{Image of defective product}
\rightarrow
\text{Label = “good”}
$$

The training example is still corrupted. So security must cover:

$$
\text{Data integrity}
+
\text{Label integrity}
$$

This matters particularly when labeling is outsourced. The trust chain may be:

$$
\text{Company}
\rightarrow
\text{Annotation vendor}
\rightarrow
\text{Individual annotator}
\rightarrow
\text{Dataset}
$$

An attacker might target any part of that chain. Responsible governance therefore asks not just:

“Where did our data come from?”

but:

**“Who was allowed to change its meaning?”**

Suppose production users can report:

👍 correct

or:

👎 incorrect

and that data is used for future optimization.

Then:

$$
\text{Public feedback}
\rightarrow
\text{future model behaviour}
$$

is a security-sensitive pathway. You may need identity controls, rate limits, statistical anomaly detection, weighting, sampling, human validation or quarantine. The deeper rule is:

$$
\boxed{
\text{Anything that changes future training is a privileged input}
}
$$

even when the interface looks harmless. Model development often involves highly privileged environments. A training notebook may access:

$$
\text{datasets}
+
\text{source code}
+
\text{cloud credentials}
+
\text{model artifacts}
+
\text{compute}
$$

That makes notebooks attractive attack targets. Training pipelines also consume dependencies:

$$
\text{Python packages}
+
\text{containers}
+
\text{pretrained models}
+
\text{datasets}
+
\text{scripts}
+
\text{drivers}
$$

So the real object being trusted is:

$$
\boxed{\text{ML supply chain}}
$$

not merely the source repository. If an attacker compromises a dependency before training, the final model may inherit the compromise. Useful controls include isolated training environments, least-privilege identities, dependency pinning, artifact scanning, controlled network egress, secrets management, code review, provenance records and immutable build outputs. Google's current Secure AI Framework guidance similarly treats datasets, models, code, libraries and other ML artifacts as part of the security problem, with inventory, access control and tamper detection across the lifecycle. ([Google Cloud][5]) After training, suppose someone generates:

$$
M_{47}
$$

and validates it. The production system should deploy exactly:

$$
M_{47}
$$

not:

$$
M_{47}'
$$

that somebody modified later. This sounds obvious, but it leads to several governance requirements. You need to establish:

$$
\text{Which artifact was evaluated?}
$$

$$
\text{Which artifact was approved?}
$$

$$
\text{Which artifact was deployed?}
$$

Ideally:

$$
\boxed{
\text{Evaluated Artifact}
=
\text{Approved Artifact}
=
\text{Deployed Artifact}
}
$$

Artifact identities, versions, hashes, signatures, lineage and registry state help establish that connection. Current SageMaker Model Registry documentation, for example, exposes model versions, metadata, lineage, lifecycle stages and approval status specifically so models can be governed as they move toward deployment. ([AWS Documentation][6]) The principle is platform-independent. Suppose one engineer can:

$$
\text{change training data}
$$

then:

$$
\text{train model}
$$

then:

$$
\text{mark it approved}
$$

then:

$$
\text{deploy to production}
$$

A single compromised account now controls the entire chain. A stronger design might separate:

$$
\text{Developer}
\rightarrow
\text{creates artifact}
$$

$$
\text{Reviewer}
\rightarrow
\text{approves artifact}
$$

$$
\text{Deployment identity}
\rightarrow
\text{deploys approved artifact}
$$

This is the traditional security principle of **separation of duties** applied to MLOps.

## How Do Evasion, Extraction, and Privacy Attacks Use Legitimate Model Interfaces?
<!-- section-summary: Evasion manipulates inputs, extraction learns from responses, and privacy attacks infer protected information through interfaces that may otherwise be operating as designed. -->

Evasion manipulates inputs, extraction learns from responses, and privacy attacks infer protected information through interfaces that may otherwise be operating as designed.

Suppose a vision system classifies:

$$
x \rightarrow \text{“safe”}
$$

An attacker changes the input slightly:

$$
x+\delta
$$

and obtains:

$$
x+\delta\rightarrow\text{“unsafe”}
$$

or vice versa. The application is functioning correctly from a software perspective. No server crashed. No account was hacked. The attacker instead exploited the decision function. That is the central idea behind **evasion attacks**. The attack surface is:

$$
\text{inference input}
$$

The protected asset is:

$$
\text{decision integrity}
$$

This is why:

$$
\text{API security}
\neq
\text{model robustness}
$$

NIST's current taxonomy includes evasion among major attack classes against predictive and generative systems. ([NIST][7]) Suppose an attacker cannot download your proprietary model. But they can ask it:

$$
x_1 \rightarrow y_1
$$

$$
x_2 \rightarrow y_2
$$

$$
\cdots
$$

$$
x_n \rightarrow y_n
$$

Given enough strategically selected observations, they may approximate aspects of the model's behaviour.

Conceptually:

$$
\{(x_i,y_i)\}_{i=1}^{n}
\rightarrow
\hat{M}
$$

where:

$$
\hat{M}\approx M
$$

This may create intellectual-property risk and can sometimes facilitate further attacks. So threat modeling must examine what an inference API reveals:

$$
\text{label only?}
$$

$$
\text{probabilities?}
$$

$$
\text{confidence to many decimal places?}
$$

$$
\text{embeddings?}
$$

$$
\text{internal reasoning or metadata?}
$$

Microsoft's ML threat guidance describes model-stealing scenarios involving repeated queries and recommends limiting unnecessary detail returned through prediction interfaces. ([Microsoft Learn][2]) Imagine the training dataset is completely inaccessible.

Could somebody nevertheless learn something about it through the model?

Potentially. For example, **membership inference** asks something like:

$$
\text{“Was this particular record probably part of training?”}
$$

Other attacks may attempt to infer or recover sensitive information related to training data. This is a distinctly ML security problem because:

$$
\text{Model}
=
\text{information derived from data}
$$

So protecting the database does not automatically guarantee that the trained model leaks nothing. NIST's current AML taxonomy explicitly includes privacy attacks for both predictive and generative AI. ([NIST][1]) Controls can include minimizing unnecessary sensitive training data, privacy-preserving training techniques where appropriate, reducing unnecessary output detail, access controls, query monitoring and explicit privacy testing.

## How Do Generative AI, Retrieval, Memory, Tools, Agents, Insiders, Tenants, and Third Parties Create New Trust Paths?
<!-- section-summary: Instructions embedded in data, retrieval sources, durable memory, tool effects, agent authority, insiders, tenant boundaries, and suppliers widen the paths from untrusted influence to consequential action. -->

Instructions embedded in data, retrieval sources, durable memory, tool effects, agent authority, insiders, tenant boundaries, and suppliers widen the paths from untrusted influence to consequential action.

Traditional software usually distinguishes:

$$
\text{code}
$$

from:

$$
\text{data}
$$

LLM systems blur that boundary because natural language can influence behaviour. Consider:

$$
\text{System instructions}
+
\text{User prompt}
+
\text{Retrieved web page}
\rightarrow
\text{LLM}
$$

The retrieved page may contain:

Ignore previous instructions and perform some other action.

To a human, that sentence is data inside a document. To the model, it may look like an instruction. This produces **indirect prompt injection**. Microsoft's current security guidance describes both direct prompt injection and indirect injection through external sources such as files or webpages. ([Microsoft Learn][8]) This gives us a crucial first principle for modern AI systems:

$$
\boxed{
\text{Natural-language content from an untrusted source must remain untrusted}
}
$$

The fact that an LLM has read something does not elevate that information's authority. A RAG system might look like:

$$
\text{Question}
\rightarrow
\text{Retriever}
\rightarrow
\text{Vector Database}
\rightarrow
\text{Documents}
\rightarrow
\text{LLM}
$$

Now ask:

Who can write documents into the retrieval corpus

If an attacker can add or edit them:

$$
\text{Attacker}
\rightarrow
\text{Poisoned Document}
\rightarrow
\text{Retrieval}
\rightarrow
\text{Model Context}
$$

The retrieval store has effectively become another input channel to the model. And authorization matters. Suppose Employee A asks:

“Summarize our customer contracts.”

The retrieval layer must not reason:

“I found relevant contracts.”

It must reason:

$$
\text{Relevant}
\cap
\text{Authorized for Employee A}
$$

Otherwise the AI can turn a search/retrieval mistake into a confidentiality breach. Recent Microsoft guidance goes even further, recommending that prompts, retrieved chunks, documents, tool outputs and memory writes all be treated as untrusted inputs, with provenance and authorization applied around retrieval and memory. ([Microsoft Learn][9]) Suppose someone tells an assistant:

“Remember this instruction forever.”

If the AI blindly writes it into persistent memory:

$$
\text{Malicious Input}
\rightarrow
\text{Memory}
\rightarrow
\text{Future Sessions}
$$

a one-time attack can become persistent. Memory therefore needs separate controls around:

$$
\text{who can write}
$$

$$
\text{what can be written}
$$

$$
\text{how long it persists}
$$

$$
\text{who can later read it}
$$

$$
\text{whether memory can influence privileged actions}
$$

This is remarkably similar to defending a database. The important insight is:

$$
\boxed{\text{AI memory is a security-sensitive data store}}
$$

not magical “memory.” Without tools:

$$
\text{LLM error}
\rightarrow
\text{bad text}
$$

With tools:

$$
\text{LLM error}
\rightarrow
\text{database mutation}
$$

or:

$$
\text{LLM error}
\rightarrow
\text{email sent}
$$

or:

$$
\text{LLM error}
\rightarrow
\text{payment initiated}
$$

The risk changes dramatically. Suppose an agent has:

$$
\text{Tool: issueRefund(customer, amount)}
$$

The dangerous architecture is:

$$
\text{LLM says “refund £5,000”}
\rightarrow
\text{tool executes £5,000}
$$

A stronger architecture is:

$$
\text{LLM proposes refund}
\rightarrow
\text{independent authorization check}
\rightarrow
\text{policy limit}
\rightarrow
\text{possibly human confirmation}
\rightarrow
\text{execution}
$$

This produces one of the most important principles in agent security:

$$
\boxed{
\text{The model should not be the final authority over its own permissions}
}
$$

Authorization should generally be enforced outside the model. Imagine:

$$
\text{User}
\rightarrow
\text{AI Agent}
\rightarrow
\text{Privileged CRM}
$$

The agent has more privilege than the user. The user says:

“Retrieve records for every customer.”

If the CRM trusts the agent's identity instead of checking the user's underlying authorization, the AI becomes a **confused deputy**. The proper rule is closer to:

$$
\text{Permitted action}
=
\text{Agent capability}
\cap
\text{User authority}
\cap
\text{Current policy}
$$

not simply:

$$
\text{Agent can technically do it}
\Rightarrow
\text{do it}
$$

This distinction becomes critical as models gain access to databases, browsers, code execution and enterprise applications. It is easy to draw:

$$
\text{Bad person outside}
\rightarrow
\text{Company}
$$

But many important ML assets are accessible to insiders. A malicious or compromised employee might have access to:

$$
\text{training data}
$$

$$
\text{model registry}
$$

$$
\text{deployment pipeline}
$$

$$
\text{evaluation results}
$$

$$
\text{production logs}
$$

So the threat model should ask:

What happens if a developer account is compromised
What happens if an annotator behaves maliciously
What happens if a model approver colludes with a developer

The answer should not rely entirely on:

“Employees are trusted.”

Trust should be bounded. Suppose an AI service hosts:

$$
\text{Tenant A}
$$

and:

$$
\text{Tenant B}
$$

The model might produce factually perfect information but still have a serious security failure if:

$$
\text{Tenant A request}
\rightarrow
\text{Tenant B data}
$$

Therefore:

$$
\text{Correct answer}
\neq
\text{authorized answer}
$$

Multi-tenant systems need tenant isolation in storage, retrieval, caches, memory, logs, connectors and tool authorization—not just at the login screen. Organizations increasingly depend on:

$$
\text{External foundation models}
+
\text{datasets}
+
\text{plugins}
+
\text{embedding services}
+
\text{annotation firms}
+
\text{model marketplaces}
$$

Your threat model should therefore contain external dependencies explicitly. For every third party, ask:

$$
\text{What data do they receive?}
$$

$$
\text{What can they modify?}
$$

$$
\text{What happens if they are compromised?}
$$

$$
\text{What happens if their behaviour changes?}
$$

$$
\text{Can we detect and replace them?}
$$

Governance of AI supply chains is therefore partly a problem of **transitive trust**:

$$
A \text{ trusts } B
$$

and:

$$
B \text{ trusts } C
$$

therefore:

$$
A
\text{ is indirectly exposed to }
C
$$

even if A never deliberately selected C.

![A compromised supplier account moving a visual backdoor through upload, labels, a training snapshot, and release, with preventive, detective, containment, recovery, and proof controls](/content-assets/articles/article-mlops-governance-and-responsible-ai-ml-threat-modeling/visual-backdoor-control-layers.png)

*The visual-backdoor abuse case connects one attacker path to prevention, detection, containment, clean recovery, and tests that prove the trusted model has been restored.*

## How Should Attack Paths Drive Prevention, Detection, Response, Release Gates, and Red-Team Evidence?
<!-- section-summary: Controls follow the concrete attack path across prevention, detection, response, artifact provenance, release gates, and system-level red-team tests rather than a detached checklist. -->

Controls follow the concrete attack path across prevention, detection, response, artifact provenance, release gates, and system-level red-team tests rather than a detached checklist.

Suppose the abuse case is:

$$
\text{Attacker contributes poisoned examples}
\rightarrow
\text{automatic retraining}
\rightarrow
\text{production model corrupted}
$$

Now choose controls that break different parts of that chain:

$$
\text{source authentication}
$$

then:

$$
\text{data validation}
$$

then:

$$
\text{anomaly detection}
$$

then:

$$
\text{quarantine}
$$

then:

$$
\text{independent evaluation}
$$

then:

$$
\text{manual approval before production}
$$

then:

$$
\text{production monitoring}
$$

then:

$$
\text{rollback}
$$

Notice something important. There is no single magic defense.

Instead:

$$
\boxed{
\text{Defense in depth}
=
\text{make one attack require several controls to fail}
}
$$

A mature threat model does not assume prevention will always work. For every important attack path, think about three layers:

$$
\text{Prevent}
\rightarrow
\text{Detect}
\rightarrow
\text{Respond}
$$

Take model theft.

- **Prevention** might involve strong authentication, least privilege, rate limiting and limiting unnecessary response detail.
- **Detection** might involve identifying abnormal query patterns or unusual download/access behaviour.
- **Response** might involve suspending credentials, blocking abusive clients, rotating secrets, investigating exposure and deploying a replacement artifact if necessary.

A system with only prevention is fragile. A system with only detection discovers harm after the fact. A resilient system combines all three. Before deploying model:

$$
M
$$

the organization should be able to establish something like:

$$
M
\leftarrow
\text{approved training pipeline}
$$

$$
\leftarrow
\text{approved code}
$$

$$
\leftarrow
\text{known dependencies}
$$

$$
\leftarrow
\text{known dataset versions}
$$

$$
\leftarrow
\text{documented configuration}
$$

This is **provenance**. Then verify:

$$
\text{artifact tested}
=
\text{artifact being deployed}
$$

A model that passed every security test becomes irrelevant if somebody can replace it between evaluation and production. So provenance, integrity and approval belong directly in the Responsible AI release gate. A threat model is initially a hypothesis.

For example:

“We believe an attacker cannot manipulate the agent through retrieved webpages.”

A red-team exercise asks:

$$
\text{Can we actually do it?}
$$

That transforms:

$$
\text{assumption}
$$

into:

$$
\text{evidence}
$$

For a predictive model, red-team exercises might test robustness to maliciously manipulated inputs, poisoning scenarios, information leakage or extraction behaviour. For a RAG agent, testing might examine:

$$
\text{malicious retrieved content}
\rightarrow
\text{prompt injection}
\rightarrow
\text{tool attempt}
$$

The most valuable test is usually not:

“Can I make the chatbot say something weird?”

but:

**“Can I traverse a path that reaches something we actually care about?”**

For example:

$$
\text{untrusted document}
\rightarrow
\text{agent}
\rightarrow
\text{privileged tool}
\rightarrow
\boxed{\text{unauthorized business action}}
$$

That is a security test tied to a real consequence. Suppose a vendor has extensively safety-tested its LLM. Your application then adds:

$$
\text{company documents}
+
\text{memory}
+
\text{custom prompts}
+
\text{payment API}
+
\text{CRM access}
$$

You have created a new system. Therefore:

$$
\boxed{
\text{secure foundation model}
\not\Rightarrow
\text{secure application}
}
$$

Many of the most serious failures arise from the glue surrounding the model.

## How Do Prepared Response, Threat-Aligned Monitoring, and Platform Controls Reduce Residual Risk?
<!-- section-summary: Prepared containment and recovery, signals tied to identified threats, and platform-enforced identity, isolation, provenance, and policy reduce but do not erase residual risk. -->

Prepared containment and recovery, signals tied to identified threats, and platform-enforced identity, isolation, provenance, and policy reduce but do not erase residual risk.

Suppose monitoring detects likely training-data poisoning.

What now?

If nobody has planned the answer, investigators may not know which records entered training, which model versions contain them, which endpoints run those models, or whether a safe previous model exists. A useful response chain might be:

$$
\text{detect}
\rightarrow
\text{contain}
\rightarrow
\text{identify affected artifacts}
\rightarrow
\text{rollback}
\rightarrow
\text{remove contaminated data}
\rightarrow
\text{retrain}
\rightarrow
\text{validate}
\rightarrow
\text{redeploy}
$$

Different attacks require different runbooks. Prompt-injection incident Perhaps disable a connector or tool. Credential compromise Revoke and rotate. Retrieval poisoning Quarantine documents and rebuild the index. Model compromise Remove the model from the registry's approved state and revert. Privacy leak Stop the affected interface, preserve evidence and invoke the relevant privacy-response process. This is why threat modeling and incident response should connect directly. Suppose your threat model identifies:

$$
T_1 = \text{training-data poisoning}
$$

$$
T_2 = \text{model extraction}
$$

$$
T_3 = \text{prompt injection}
$$

$$
T_4 = \text{unauthorized tool use}
$$

Then generic CPU monitoring is insufficient. You need signals related to those threats.

Conceptually:

$$
T_1
\rightarrow
\text{data-source and distribution monitoring}
$$

$$
T_2
\rightarrow
\text{query-pattern and access monitoring}
$$

$$
T_3
\rightarrow
\text{prompt/retrieval attack telemetry}
$$

$$
T_4
\rightarrow
\text{tool authorization and action logs}
$$

A strong threat model therefore generates monitoring requirements automatically. Cloud and AI platforms increasingly expose mechanisms that correspond directly to these threat-model controls. For example, current AWS SageMaker governance capabilities include model versioning, lineage, approval status, model cards, access controls and monitoring-related governance tools. ([AWS Documentation][10]) Google Cloud's current Secure AI Framework material maps controls such as IAM, organizational policy, VPC Service Controls, model registries, AI data governance and prompt/response protections to AI-security risks; its current guidance also discusses red teaming and attack-path analysis. ([Google Cloud][5])

Microsoft's recent AI-security guidance treats prompts, documents, retrieved context, tool results and memory as untrusted data and describes layered controls against direct and indirect prompt injection. ([Microsoft Learn][9]) But this leads to an important governance principle:

$$
\boxed{
\text{Having a security feature}
\neq
\text{having an effective security control}
}
$$

For example:

$$
\text{Cloud supports IAM}
$$

does not prove:

$$
\text{your model uses least privilege}
$$

Likewise:

$$
\text{registry supports approval}
$$

does not prove:

$$
\text{your deployment pipeline refuses unapproved models}
$$

Governance must verify **configuration and enforcement**, not merely product capability.

## How Does a Complete Agent Example Keep Threat Modeling Alive and Accountable?
<!-- section-summary: The enterprise-agent example maps the full system, tests realistic paths, assigns residual-risk ownership, updates the model after change and incidents, and connects security to Responsible AI. -->

The enterprise-agent example maps the full system, tests realistic paths, assigns residual-risk ownership, updates the model after change and incidents, and connects security to Responsible AI.

Imagine a company builds:

An AI support agent that reads internal knowledge, checks customer records and can issue refunds.

Its simplified architecture is:

$$
\text{Customer Prompt}
\rightarrow
\text{Agent}
$$

The agent receives:

$$
\text{Retrieved Documents}
+
\text{Conversation Memory}
+
\text{Customer Data}
$$

and has access to:

$$
\text{Refund Tool}
$$

Now identify the important asset:

$$
\text{Integrity of refunds}
$$

A threat scenario could be:

$$
\text{Attacker}
\rightarrow
\text{malicious content}
\rightarrow
\text{retrieval}
\rightarrow
\text{agent follows injected instruction}
\rightarrow
\text{refund tool}
\rightarrow
\text{unauthorized payment}
$$

Notice how many components are involved. The vulnerability is not simply:

“LLMs sometimes follow malicious instructions.”

The dangerous chain is:

$$
\boxed{
\text{Untrusted content}
\rightarrow
\text{model interpretation}
\rightarrow
\text{privilege}
\rightarrow
\text{irreversible action}
}
$$

Now we can design controls. Make retrieval permission-aware. Label retrieved material as untrusted content rather than authoritative instructions. Do not give the model unrestricted refund authority. Check the underlying user's/customer's authorization. Place hard refund limits outside the model. Require confirmation or human review for sufficiently consequential transactions. Log every tool call. Monitor unusual refund patterns. Provide a way to disable the refund connector without disabling the entire assistant. Now:

$$
\text{one prompt-injection success}
$$

does not automatically imply:

$$
\text{money lost}
$$

because the attack still encounters independent controls. That is what good threat modeling accomplishes. Engineering can identify:

“There is still a small chance of unauthorized tool activation.”

But engineering alone should not silently decide whether that is acceptable. Governance connects:

$$
\text{Threat}
\rightarrow
\text{Control}
\rightarrow
\text{Evidence}
\rightarrow
\text{Residual Risk}
\rightarrow
\text{Owner}
$$

A release reviewer can therefore ask:

| Governance question                        | Evidence                         |
| ------------------------------------------ | -------------------------------- |
| What are the important assets             | System/threat model              |
| Where are the trust boundaries            | Architecture/data-flow diagram   |
| Which adversaries matter                  | Capability assumptions           |
| What are the highest-impact attack paths  | Abuse-case analysis              |
| Which controls break each path            | Control mapping                  |
| Have those controls actually been tested  | Security/red-team evidence       |
| Is the deployed artifact authentic        | Provenance and registry evidence |
| Will attacks be detectable                | Monitoring specification         |
| Can we contain an attack                  | Incident-response runbook        |
| Can the system be disabled or rolled back | Recovery evidence                |
| What important risks remain               | Residual-risk assessment         |
| Who accepts those risks                   | Named accountable owner          |

This transforms threat modeling from:

“A security-team document.”

into:

> **A decision artifact for Responsible AI governance.**

Suppose the original system was:

$$
\text{User}
\rightarrow
\text{Chatbot}
$$

Then six months later you add:

$$
\text{Chatbot}
\rightarrow
\text{Web browsing}
$$

Later:

$$
\rightarrow
\text{persistent memory}
$$

Later:

$$
\rightarrow
\text{email tool}
$$

Later:

$$
\rightarrow
\text{payment system}
$$

The original threat model is no longer describing the same risk. The model weights might not have changed at all. Yet:

$$
\text{Potential Impact}
\uparrow
$$

dramatically. Therefore the threat model should be reconsidered when important assumptions change: new data sources, vendors, interfaces, models, deployment environments, retrieval stores, memory, tools, permissions, user populations, feedback mechanisms or known attack techniques. MITRE ATLAS itself evolves with the AI attack landscape, and NIST has stated that its adversarial-ML taxonomy is intended to evolve as the field changes. ([MITRE ATLAS][4]) Security and Responsible AI sometimes get discussed separately. But they meet at a very simple idea. Responsible AI asks:

**How could this system harm people?**

Threat modeling asks:

**How could an adversary intentionally make those harms happen?**

For example, Responsible AI might identify:

$$
\text{Harm}
=
\text{qualified loan applicants wrongly rejected}
$$

Threat modeling then asks:

Could somebody poison the training data to make that happen deliberately

Responsible AI might identify:

$$
\text{Harm}
=
\text{private information disclosed}
$$

Threat modeling asks:

Could repeated model queries, prompt injection, retrieval manipulation or unauthorized tool access produce that outcome

Responsible AI might identify:

$$
\text{Harm}
=
\text{agent performs an unauthorized financial transaction}
$$

Threat modeling asks:

Which path could an attacker use to cause that action

So:

$$
\boxed{
\text{Responsible AI harm analysis}
+
\text{adversarial thinking}
=
\text{AI threat modeling}
}
$$

The deepest way to understand ML threat modeling is not as a catalogue of exotic attacks. It is this:

$$
\boxed{
\textbf{Find every important path by which an untrusted actor can gain influence over an AI system's learning, information, decisions or actions.}
}
$$

Then, for each path:

$$
\boxed{
\text{Actor}
\rightarrow
\text{Capability}
\rightarrow
\text{Trust Boundary}
\rightarrow
\text{Weakness}
\rightarrow
\text{Attack}
\rightarrow
\text{Consequence}
}
$$

and design:

$$
\boxed{
\text{Prevent}
+
\text{Detect}
+
\text{Respond}
}
$$

controls that interrupt it. For conventional software, the attack might target:

$$
\text{code, credentials, network or database}
$$

For ML, also include:

$$
\text{training data}
+
\text{labels}
+
\text{features}
+
\text{weights}
+
\text{inference behaviour}
+
\text{feedback}
$$

For generative and agentic AI, add:

$$
\text{prompts}
+
\text{retrieval}
+
\text{memory}
+
\text{tools}
+
\text{external content}
+
\text{action authority}
$$

So the final mental model is:

$$
\boxed{
\begin{aligned}
\textbf{Threat-model the system, not just the model.}\\
\textbf{Threat-model influence, not just intrusion.}\\
\textbf{Threat-model actions, not just outputs.}\\
\textbf{Threat-model the entire lifecycle, not just production.}
\end{aligned}
}
$$

And from a governance perspective, the final question is not merely:

**“Did the security team run a threat model?”**

It is:

**“Do we understand the credible adversarial paths to serious harm, have we placed independent controls across those paths, have we tested those controls, can we detect and recover when they fail, and does an accountable person accept what remains?”**

That is the essence of **threat modeling ML systems in Governance and Responsible AI**.

![A threat-modeling summary from system decision through assets, adversary capability, abuse case, controls, and evidence to release outcomes and a production incident recovery loop](/content-assets/articles/article-mlops-governance-and-responsible-ai-ml-threat-modeling/threat-modeling-recovery-summary.png)

*A production threat model binds local abuse cases to release outcomes, then feeds incident containment, clean recovery, and regression evidence back into the next review.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Do Assets, Actors, Trust Boundaries, Capabilities, Attack Paths, and Residual Risk Define an ML Threat Model?]{kind="recap"}
Threat modeling identifies assets, actors, changing trust boundaries, realistic capabilities, attack paths, controls, and residual risk across the complete system before selecting defenses.
:::

:::expand[How Do Conventional Threats, STRIDE, and MITRE ATLAS Extend into ML?]{kind="recap"}
Conventional software threats remain, while STRIDE organizes familiar categories and MITRE ATLAS provides adversarial-ML techniques that connect to lifecycle stages and attacker goals.
:::

:::expand[How Can Data, Labels, Feedback, Training Infrastructure, Supply Chains, Registries, and Release Authority Be Attacked?]{kind="recap"}
Training data, labels, feedback loops, notebooks, infrastructure, dependencies, registries, and separated build, approval, and deployment duties each create integrity and authority boundaries.
:::

:::expand[How Do Evasion, Extraction, and Privacy Attacks Use Legitimate Model Interfaces?]{kind="recap"}
Evasion manipulates inputs, extraction learns from responses, and privacy attacks infer protected information through interfaces that may otherwise be operating as designed.
:::

:::expand[How Do Generative AI, Retrieval, Memory, Tools, Agents, Insiders, Tenants, and Third Parties Create New Trust Paths?]{kind="recap"}
Instructions embedded in data, retrieval sources, durable memory, tool effects, agent authority, insiders, tenant boundaries, and suppliers widen the paths from untrusted influence to consequential action.
:::

:::expand[How Should Attack Paths Drive Prevention, Detection, Response, Release Gates, and Red-Team Evidence?]{kind="recap"}
Controls follow the concrete attack path across prevention, detection, response, artifact provenance, release gates, and system-level red-team tests rather than a detached checklist.
:::

:::expand[How Do Prepared Response, Threat-Aligned Monitoring, and Platform Controls Reduce Residual Risk?]{kind="recap"}
Prepared containment and recovery, signals tied to identified threats, and platform-enforced identity, isolation, provenance, and policy reduce but do not erase residual risk.
:::

:::expand[How Does a Complete Agent Example Keep Threat Modeling Alive and Accountable?]{kind="recap"}
The enterprise-agent example maps the full system, tests realistic paths, assigns residual-risk ownership, updates the model after change and incidents, and connects security to Responsible AI.
:::

## References

[1]: https://www.nist.gov/publications/adversarial-machine-learning-taxonomy-and-terminology-attacks-and-mitigations-0 "Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations | NIST"
[2]: https://learn.microsoft.com/en-us/security/engineering/threat-modeling-aiml "Threat Modeling AI/ML Systems and Dependencies | Microsoft Learn"
[3]: https://learn.microsoft.com/en-us/archive/msdn-magazine/2006/november/uncover-security-design-flaws-using-the-stride-approach "Uncover Security Design Flaws Using The STRIDE Approach | Microsoft Learn"
[4]: https://atlas.mitre.org/ "MITRE ATLAS™"
[5]: https://cloud.google.com/use-cases/secure-ai-framework "Secure AI Framework (SAIF) | Google Cloud"
[6]: https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html "Model Registration Deployment with Model Registry - Amazon SageMaker AI"
[7]: https://www.nist.gov/news-events/news/2025/03/nist-trustworthy-and-responsible-ai-report-adversarial-machine-learning "NIST Trustworthy and Responsible AI Report Adversarial Machine Learning: A Taxonomy and Terminology of Attacks and Mitigations | NIST"
[8]: https://learn.microsoft.com/en-us/ai/playbook/technology-guidance/generative-ai/mlops-in-openai/security/security-plan-llm-application "Security planning for LLM-based applications | Microsoft Learn"
[9]: https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-defense-capabilities/input-context-retrieval-hygiene "4. Input, Context, and Retrieval Hygiene | Microsoft Learn"
[10]: https://docs.aws.amazon.com/sagemaker/latest/dg/governance.html "Model governance to manage permissions and track model performance - Amazon SageMaker AI"
