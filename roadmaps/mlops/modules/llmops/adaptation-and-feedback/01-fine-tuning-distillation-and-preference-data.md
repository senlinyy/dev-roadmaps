---
title: "Fine-Tuning, Distillation, and Preference Data"
description: "Learn when model weights should change, how each adaptation method learns, and how production teams govern, evaluate, release, and roll back tuned models."
overview: "Model adaptation can teach a repeated behaviour, encode a preference, transfer a capable teacher into a smaller model, or optimize a measurable reward. A decision framework connects those methods to governed data, failure controls, current industrial stacks, economics, and reversible releases."
tags: ["MLOps", "LLMOps", "advanced", "fine-tuning"]
order: 1
id: "article-mlops-llmops-fine-tuning-distillation-preference-data"
aliases:
  - roadmaps/mlops/modules/llmops/adaptation-and-feedback/02-fine-tuning-distillation-and-preference-data.md
  - child-adaptation-and-feedback-02-fine-tuning-distillation-and-preference-data
---

## Table of Contents

1. [What Model Adaptation Means](#what-model-adaptation-means)
2. [Decide Whether The Weights Need To Change](#decide-whether-the-weights-need-to-change)
3. [Four Learning Signals, Four Different Jobs](#four-learning-signals-four-different-jobs)
4. [Supervised Fine-Tuning Learns From Demonstrations](#supervised-fine-tuning-learns-from-demonstrations)
5. [Preference Optimization Learns From Comparisons](#preference-optimization-learns-from-comparisons)
6. [Reinforcement Fine-Tuning Learns From A Reward](#reinforcement-fine-tuning-learns-from-a-reward)
7. [Distillation Transfers A Bounded Behaviour](#distillation-transfers-a-bounded-behaviour)
8. [Full Fine-Tuning And PEFT Change The Training Footprint](#full-fine-tuning-and-peft-change-the-training-footprint)
9. [Build Training Data As A Governed Product](#build-training-data-as-a-governed-product)
10. [Establish The Baseline Before Training](#establish-the-baseline-before-training)
11. [Recognize Overfitting And Catastrophic Forgetting](#recognize-overfitting-and-catastrophic-forgetting)
12. [Test Safety And Reward Regressions](#test-safety-and-reward-regressions)
13. [Choose A Current Industrial Stack](#choose-a-current-industrial-stack)
14. [Calculate The Real Economics](#calculate-the-real-economics)
15. [Release And Roll Back The Complete System](#release-and-roll-back-the-complete-system)
16. [A Practical Adaptation Decision](#a-practical-adaptation-decision)
17. [References](#references)

## What Model Adaptation Means
<!-- section-summary: Model adaptation changes learned parameters so a behaviour persists across requests without being restated in every prompt. -->

At a high level, **model adaptation changes what a model has learned**. A normal prompt gives instructions for one request. Retrieval supplies information for one request. A tool lets the model act on an external system. Adaptation goes deeper: it updates model parameters and raises the probability of a behaviour across future requests.

Those parameters are commonly called **weights**. You can think of weights as millions or billions of adjustable values that shape which token the model is likely to produce next. Pretraining gives those values broad language and reasoning patterns. Fine-tuning makes a smaller, targeted adjustment using examples from a particular task.

Suppose a model repeatedly produces long explanations, although a product needs a compact JSON decision with a short evidence field. The prompt can request that format on every call. A supervised fine-tune can also teach the pattern from many reviewed examples. Both approaches may improve the output, though their operational consequences differ. The prompt is quick to edit and roll back. A tuned model requires approved data and a training run. It also needs an evaluated artifact and a controlled release.

The adaptation decision starts with a diagnosis. The team first names the repeated behaviour and measures it on representative data. A training job is justified after prompt, context, tool, or workflow changes have reached a measured limit.

```mermaid
flowchart TD
    A["Repeated production failure"] --> B["Measure it on an eval set"]
    B --> C{"Which layer owns the failure?"}
    C -->|"Instructions or format"| D["Prompt and schema"]
    C -->|"Changing knowledge"| E["Retrieval"]
    C -->|"External action or fact"| F["Tool"]
    C -->|"Workflow or policy"| G["Application logic"]
    C -->|"Stable learned behaviour"| H["Adaptation experiment"]
    D --> I["Re-run the same eval"]
    E --> I
    F --> I
    G --> I
    H --> I

    classDef start fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef choice fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef option fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef check fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A,B start; class C choice; class D,E,F,G,H option; class I check
```

Supervised fine-tuning, preference optimization, reinforcement fine-tuning, and distillation give the optimizer different kinds of evidence. The chosen method should match the evidence the team can produce reliably.

## Decide Whether The Weights Need To Change
<!-- section-summary: Prompting, retrieval, tools, application logic, routing, and adaptation solve different classes of failure. -->

At a high level, this decision asks which part of the system is failing. A model application has several layers, and each layer has its own repair. Changing weights for a retrieval or authorization problem adds training work while leaving the original responsibility unresolved.

**Prompting** supplies instructions, examples, constraints, and context at request time. It is the usual starting point for tone, structure, and task clarity because prompt changes are cheap to test and easy to reverse. Structured Outputs or schema validation can solve many format failures more reliably than training.

**Retrieval-augmented generation**, usually shortened to **RAG**, fetches current or private knowledge and places it in the model's context. Use it for policies, catalogues, account records, research, or other information that changes after the base model was trained. Fine-tuning is a poor database. Updating weights every time a policy changes creates stale knowledge and an expensive release cycle.

**Tools** connect the model to calculations and systems of record. A calculator, database lookup, search service, or transaction API can return an authoritative result. Training a model to guess a live balance or perform precise arithmetic moves responsibility into a probabilistic component.

**Application logic** owns deterministic product rules. Authorization, spend limits, approval gates, required fields, and irreversible actions belong in code and policy services. Examples can teach a model to propose an action, while the application still decides whether that action is allowed.

**Routing** selects a different model or workflow for a recognizable slice. If one model handles code well and another handles multilingual support well, routing may outperform a single heavily adapted model. It can also keep a powerful model for difficult requests and send routine work to a cheaper model.

Adaptation fits a narrower pattern. The desired behaviour is stable and appears often. Trustworthy training signals can represent it, while the existing system still produces it poorly or at excessive cost.

Consider four concrete failures:

- A support assistant quotes an old returns policy. Retrieval should supply the current policy.
- An extraction endpoint occasionally omits a required field. A schema, validation, and retry path should be tested before training.
- A model consistently uses the wrong specialist terminology despite a clear prompt and many repeated requests. Supervised examples may justify adaptation.
- A capable model produces excellent classifications at a cost that is too high for millions of daily requests. Distilling reviewed teacher behaviour into a smaller model may justify adaptation.

The team should compare every candidate with the strongest practical baseline. Testing a fine-tuned model against a weak, unstructured prompt exaggerates the benefit. Start with the best shippable prompt and retrieval setup. Add the real tools, routing, validation, and inference settings used by the application.

## Four Learning Signals, Four Different Jobs
<!-- section-summary: Demonstrations, preferences, rewards, and teacher outputs express different information, so each supports a different adaptation method. -->

At a high level, every adaptation method turns evidence into a weight update. The methods differ in the evidence they accept. Looking at one training row reveals the lesson the optimizer receives.

**Supervised fine-tuning**, or **SFT**, says, “For an input like this, produce an output like this.” The training signal is a demonstration.

**Preference optimization** says, “For this input, response A is better than response B.” The training signal is a comparison. Direct Preference Optimization, or **DPO**, is a widely used algorithm for learning from these pairs.

**Reinforcement fine-tuning**, or **RFT**, says, “Try several outputs; this grader assigns each one a reward.” The score produced after the model acts supplies the training signal.

**Distillation** says, “Learn the useful behaviour produced by this stronger teacher.” The signal may contain reviewed teacher responses or token probabilities. Some methods use teacher feedback generated while the student practises.

```mermaid
flowchart TD
    A{"What trustworthy signal<br/>can the team produce?"}
    A -->|"Desired answer"| B["Supervised fine-tuning"]
    A -->|"Chosen and rejected pair"| C["Preference optimization"]
    A -->|"Reliable numeric grader"| D["Reinforcement fine-tuning"]
    A -->|"Capable teacher behaviour"| E["Distillation"]
    B --> F["Learn a demonstrated pattern"]
    C --> G["Learn a relative preference"]
    D --> H["Increase high-reward behaviour"]
    E --> I["Transfer a bounded capability"]

    classDef question fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef method fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef result fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A
    class A question; class B,C,D,E method; class F,G,H,I result
```

These signals cannot be swapped casually. A task with several equally valid answers may be awkward for SFT because one demonstration can make other good answers look less likely. Preference pairs may express that one answer is better without pretending it is the only correct answer. A task with an exact verifier may suit RFT because thousands of sampled solutions can be scored consistently.

The quality of the signal matters more than the method's name. Hundreds of contradictory demonstrations can teach contradictory behaviour. Preference pairs with low reviewer agreement encode noise. A reward with an easy loophole teaches the loophole. Teacher outputs transfer teacher mistakes along with teacher strengths.

## Supervised Fine-Tuning Learns From Demonstrations
<!-- section-summary: SFT raises the probability of reviewed target responses and works best for stable tasks with repeatable examples of good behaviour. -->

Supervised fine-tuning teaches by example. Each training row contains an input and the response the model should learn to produce. During training, the model sees the target response token by token and adjusts its weights to make those tokens more probable after similar inputs.

In everyday terms, SFT is close to showing a new colleague many completed pieces of work. A single example demonstrates one case. A varied collection teaches the recurring pattern, the edge cases, and the boundaries.

SFT is a strong fit for:

- stable output structures and terminology;
- classification or extraction with reviewed labels;
- a consistent response style that prompts do not produce reliably;
- tool-call patterns with well-defined arguments;
- repeated task procedures that experts can demonstrate.

One chat-style row might look like this:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Classify the request and give one supporting fact: I was charged twice for order 4831."
    },
    {
      "role": "assistant",
      "content": "{\"category\":\"duplicate_charge\",\"evidence\":\"The customer reports two charges for order 4831.\"}"
    }
  ],
  "slice": "billing-duplicate-charge",
  "review_status": "approved"
}
```

The JSON format is only the storage contract. The important part is the meaning of the example. It teaches a category, a compact evidence style, and a rule against inventing facts. If the dataset contains many polished but unsupported explanations, SFT may make unsupported explanations more consistent.

### Coverage teaches the boundary of the task

A useful dataset includes ordinary cases, difficult cases, ambiguous cases, and cases that should be escalated. Suppose an extraction model needs to return `unknown` when an invoice has no due date. If every training invoice has a due date, the model never sees the correct abstention behaviour. It may infer a date from unrelated text because the training set taught that a date should always exist.

Negative and boundary examples are therefore part of the specification. They show what the model should do with missing evidence, conflicting instructions, unsupported languages, unusually long inputs, or requests outside the product's scope.

### Consistency matters more than polished prose

Two experts may both write good answers while following different rules. One includes every caveat; another keeps only the decision. Mixed together without a shared rubric, their examples teach unstable behaviour.

Teams usually define a short annotation guide, label a pilot batch, inspect disagreements, and revise the guide before scaling. Important disagreements receive adjudication by a qualified reviewer. The final dataset should retain the label version and review status. This lineage connects an unexpected model behaviour to the rule that produced it.

### SFT has a clear failure signal

Training loss normally falls as the model imitates the demonstrations. Product quality should also improve on a held-out evaluation set. If training loss keeps falling while held-out quality stalls or drops, the model is fitting the training rows more closely. It is failing to learn a general solution. That is overfitting, which we examine later.

## Preference Optimization Learns From Comparisons
<!-- section-summary: Preference optimization learns a relative boundary from chosen and rejected responses, making reviewer criteria and pair construction central to the method. -->

Some tasks have no single perfect response. A reviewer may struggle to write an ideal answer from scratch, yet can compare two plausible answers reliably. Preference optimization learns from that relative judgement.

A basic preference row contains the same input followed by a **chosen** response and a **rejected** response. DPO trains the model to increase the relative likelihood of the chosen response while limiting how far the model moves from a reference policy.

```json
{
  "input": "Explain why the payment is still pending.",
  "chosen": "The bank has authorized the payment, but settlement is still in progress. Check again after the displayed settlement window.",
  "rejected": "The bank is probably having technical problems. Your payment should clear soon.",
  "preference_dimensions": [
    "uses available evidence",
    "avoids speculation",
    "gives a useful next step"
  ],
  "rubric_version": "support-quality-v4",
  "adjudication": "agreed"
}
```

The pair teaches a narrow boundary. Here, the preferred response uses known payment state, avoids guessing about the bank, and gives an action. The example does not prove that every short answer is good or every mention of a technical problem is bad.

### Good rejected responses are close enough to be instructive

A nonsensical rejected answer creates an easy comparison and contributes little to the difficult product decision. Useful pairs often place two plausible responses side by side, with one meaningful defect between them.

For a summarization product, two responses might both be fluent. One includes an unsupported conclusion; the other stays within the source. For a coding assistant, both solutions might pass the happy path, while one fails a security constraint. These close comparisons teach the distinction the product actually cares about.

### Reviewer agreement is a model input

Preference data reflects the people and process that created it. Response order should be randomized, and model identity should be hidden where practical. The rubric should separate factuality, safety, relevance, and style. Teams should record ties and disagreement instead of forcing every pair into a false winner.

Imagine ten reviewers evaluating a medical explanation. Six choose the shorter answer because it reads more clearly. Four choose the longer answer because it includes a crucial warning. A single unexplained majority label hides the conflict. The team should revise the rubric and make the warning a safety constraint. A new pair can then compare two candidates that both include the warning.

Preference optimization works well after SFT has established the basic task. It can refine response tradeoffs that are hard to specify in one target answer. It still needs an independent evaluation set because a higher preference score on training pairs does not prove better production behaviour.

## Reinforcement Fine-Tuning Learns From A Reward
<!-- section-summary: RFT samples candidate outputs, grades them, and updates the model toward higher rewards, so grader validity defines the behaviour being optimized. -->

Reinforcement fine-tuning trains through attempts and consequences. For each prompt, the model produces several candidate outputs. A **grader** assigns each output a numeric reward. The training algorithm then raises the probability of higher-scoring behaviour.

You can think of the grader as an automated examiner used inside the training loop. It may run deterministic code, compare an answer with a reference, use a model-based rubric, or combine several checks. The examiner must measure the real task closely enough to guide learning.

```mermaid
flowchart TD
    A["Prompt from training set"] --> B["Sample several responses"]
    B --> C["Run grader checks"]
    C --> D["Assign rewards"]
    D --> E["Update the policy"]
    E --> F["Validate on held-out prompts"]
    F -->|"Reward and quality improve"| G["Continue or select checkpoint"]
    F -->|"Reward diverges from quality"| H["Repair grader or stop"]

    classDef data fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef work fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef check fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef stop fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A data; class B,C,D,E work; class F,G check; class H stop
```

RFT is suitable for tasks with several possible solution paths and a dependable way to score the result. One example is code generation backed by a carefully designed test suite. Another is a structured problem with a verified answer. Tool calls can also be scored through outcomes observed in a sandbox.

A compact grader contract might be:

```yaml
reward:
  schema_valid: 0.15
  final_answer_correct: 0.55
  required_evidence_present: 0.20
  unsafe_action_absent: 0.10
hard_fail:
  - fabricated_evidence
  - unauthorized_tool
validation:
  human_agreement_target: 0.90
  adversarial_cases_required: true
```

The weights in this example express product priorities. They should come from deliberate review, then be tested against outputs written to expose weaknesses.

### Reward hacking is a design failure

**Reward hacking** happens when the model finds a way to earn a high score without doing the intended job. A citation grader that counts links may reward irrelevant links. A code grader with shallow tests may reward a hard-coded answer. A model-based grader may prefer confident language even when the facts are wrong.

Teams test the grader before training. They collect correct, partially correct, wrong, adversarial, and malformed responses. Qualified reviewers score the same set. The grader should rank these examples in a similar order and explain failures by component. During training, compare training and validation rewards, inspect actual responses, and monitor each reward component. A rising total can hide a collapsing safety component.

RFT also needs some initial success. If the base model never produces a correct candidate, the grader has no positive behaviour to reinforce. The team may need a stronger base model, supervised warm-up, better context, or a narrower task before reinforcement can help.

## Distillation Transfers A Bounded Behaviour
<!-- section-summary: Distillation trains a student from a stronger teacher on a defined request distribution, aiming for an explicit quality, latency, or cost target. -->

**Knowledge distillation** transfers useful behaviour from a capable teacher model into a student model. The teacher usually has higher capability or cost. The student usually targets lower latency, lower cost, or a smaller deployment footprint.

In practical LLM systems, the simplest form is **response distillation**. The team runs representative prompts through the teacher and reviews or filters its outputs. The approved prompt-response pairs then provide supervised training data for the student. More advanced methods also match teacher token probabilities or let the student generate attempts that receive teacher guidance.

```mermaid
flowchart TD
    A["Representative production prompts"] --> B["Teacher model"]
    B --> C["Teacher outputs and metadata"]
    C --> D["Automatic checks"]
    D --> E["Human review for important slices"]
    E --> F["Versioned distillation dataset"]
    F --> G["Train student"]
    G --> H["Compare student, teacher, and baseline"]
    H --> I["Release only on target slices"]

    classDef input fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef teach fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef govern fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef release fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A input; class B,C teach; class D,E,F,G,H govern; class I release
```

The goal needs a boundary. “Make the student as good as the teacher” is too vague. A production target could preserve at least 98 percent of teacher accuracy on routine English extraction. It could also require every schema and safety gate to pass. The latency and cost targets would state the required improvement separately. Requests outside that slice can remain on the teacher.

### Teacher output is generated data, not ground truth

A fluent teacher can still hallucinate, misunderstand the source, or violate a policy. Saving every teacher response as a target turns those errors into training data. Strong pipelines retain the teacher model revision, prompt bundle, tool and retrieval context, sampling settings, source documents, automatic-check results, reviewer outcome, and generation cost.

For instance, a team may distil invoice extraction. Deterministic checks can reject invalid totals, missing required fields, and dates outside the document. Human reviewers can inspect rare layouts, handwritten invoices, and high-value cases. The approved rows then teach the student. The rejected rows remain useful for evaluating failure patterns, although they should not silently enter the supervised target set.

### Distillation loses capability unevenly

A student has less capacity. It may preserve routine formatting while losing rare-language performance, long-context reasoning, calibration, or safety behaviour. Average accuracy can hide those losses. Compare student and teacher by task slice, input length, language, risk level, and confidence or abstention behaviour.

Managed distillation services can generate teacher responses and train a supported student with less infrastructure. Open workflows expose the teacher and filtering stages. They also give the team control over the training loss and student architecture. Both paths need the same production evidence. Keep teacher lineage and permitted-use records. Retain the reviewed examples and independent evaluation. Route unsupported cases back to the teacher.

## Full Fine-Tuning And PEFT Change The Training Footprint
<!-- section-summary: Full fine-tuning updates the base model broadly, while PEFT methods such as LoRA train smaller adapters and reduce compute and artifact size. -->

At a high level, the learning signal describes what the model learns. The training approach determines how much of the model is allowed to change. This second decision controls accelerator memory, artifact size, and the amount of adaptation capacity available.

**Full fine-tuning** updates most or all of the model's weights. It offers high adaptation capacity and can support large behavioural changes. Large models also require substantial accelerator memory, optimizer state, checkpoint storage, and distributed-training discipline.

**Parameter-efficient fine-tuning**, or **PEFT**, updates a much smaller set of parameters. **Low-Rank Adaptation**, or **LoRA**, freezes the base weights and learns small low-rank matrices that modify selected layers. **QLoRA** combines LoRA-style adapters with a quantized base model during training to reduce memory further.

You can picture LoRA as placing a small learned correction beside the original model. The base weights remain intact. At inference, the runtime applies the base model plus the adapter, or merges compatible adapter weights into the model artifact.

```mermaid
flowchart TD
    A["Base model revision"] --> B{"Training approach"}
    B -->|"Full fine-tuning"| C["Update broad model weights"]
    B -->|"LoRA or QLoRA"| D["Freeze base weights"]
    D --> E["Train small adapter matrices"]
    C --> F["Full candidate checkpoint"]
    E --> G["Base plus adapter artifact"]
    F --> H["System evaluation"]
    G --> H

    classDef base fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef choice fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef train fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef check fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A base; class B choice; class C,D,E,F,G train; class H check
```

Hugging Face PEFT exposes LoRA through a small configuration:

```python
from peft import LoraConfig

lora = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules=["q_proj", "v_proj"],
    task_type="CAUSAL_LM",
)
```

The rank `r` controls the size of the learned update. `target_modules` identifies the model layers receiving adapters. These values are experiment inputs rather than universal defaults; architectures use different layer names, and more adapter capacity can require more data and memory.

PEFT reduces the training footprint and makes it practical to keep several task-specific adapters over one base model. It does not repair weak data or remove safety risk. A LoRA adapter can still overfit, teach unsafe behaviour, or lose performance outside its training slice.

The deployment artifact also needs a precise contract. Record the exact base model, tokenizer, and chat template. Keep the adapter configuration and weights beside their quantization and merge status. The inference library and serving configuration complete the contract. Loading the right adapter over the wrong base revision can fail outright or produce subtle behavioural changes.

## Build Training Data As A Governed Product
<!-- section-summary: Adaptation data needs permission, provenance, transformations, quality review, leakage-safe splits, versioning, and deletion controls. -->

Production conversations are raw material, not a ready-made training set. They may contain private or copyrighted material. They may also contain unreviewed model mistakes, duplicated incidents, prompt injection, or text whose permitted purpose excludes model training.

A governed data pipeline answers six questions for every included row:

1. Where did it come from?
2. Are we allowed to use it for this purpose?
3. Which transformations changed it?
4. Who or what produced the label?
5. Which quality checks did it pass?
6. Which immutable dataset version contains it?

```mermaid
flowchart TD
    A["Permitted source records"] --> B["Redact and normalize"]
    B --> C["Label, compare, or generate"]
    C --> D["Quality and policy review"]
    D --> E["Deduplicate and group"]
    E --> F["Train and validation split"]
    E --> G["Untouched test split"]
    F --> H["Immutable dataset version"]
    G --> I["Independent evaluation asset"]

    classDef source fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef process fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef split fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef asset fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A source; class B,C,D,E process; class F,G split; class H,I asset
```

A compact row manifest can carry the lineage beside the training content:

```yaml
example_id: support-18402-revision-3
source:
  system: reviewed-support-cases
  allowed_use: adaptation-approved
  source_revision: 3
transforms:
  redaction_policy: pii-v7
  chat_template: support-v5
label:
  signal: preference-pair
  rubric: grounded-support-v4
  status: adjudicated
group_id: case-18402
slices: [billing, duplicate-charge, english]
```

The **group ID** keeps related records in the same split. A conversation, its edited response, and three near-duplicate follow-ups should not be scattered across training and test data. That leakage would let the model see almost the same case during training, making the final score look better than performance on genuinely new cases.

Deduplication also controls hidden weighting. If one production incident generated two hundred similar retries, treating them as two hundred independent examples teaches that one pattern far more strongly than intended.

### Data balance follows product risk

An equal number of rows per category is not automatically balanced. The training set should represent normal traffic while deliberately covering rare, costly, and safety-critical situations. A payment assistant may see few chargeback threats, yet those examples deserve careful coverage because mishandling them is expensive.

Synthetic data can fill a missing slice. It should carry the generator version and prompt, pass the same validation as other data, and remain visible in evaluation reports. Synthetic fluency is no guarantee of factual or policy correctness.

### Deletion has to reach derived assets

If a source record must be removed, the team first locates every derived asset. Dataset versions and evaluation samples show where the record was reused. Checkpoints and adapters show which models learned from it. Generated teacher responses form another derived source. Some trained artifacts cannot remove one example cleanly. The governance policy should then require retirement, clean retraining, or a documented retention basis.

## Establish The Baseline Before Training
<!-- section-summary: An adaptation experiment needs a representative test set, strongest practical baseline, explicit improvement target, and guardrails before the first training job. -->

At a high level, the baseline records how well the current production system performs before any weights change. The held-out test set supplies the same examination for every candidate. Without these controls, repeated data and hyperparameter changes gradually leak knowledge of the test into the experiment.

One useful failure statement is: *On long customer messages containing two requests, the current system selects the correct primary category in 78 percent of reviewed cases. The candidate should reach 90 percent while preserving evidence accuracy, safety escalation, p95 latency, and cost limits.*

This statement identifies the slice, baseline, target, and guardrails. It can be disproved.

The evaluation set starts with representative traffic and difficult boundaries. Add important languages and long inputs. Adversarial, safety, abstention, and escalation cases test the system's limits. Keep an untouched test set for the final decision. Use a separate validation set for checkpoint selection and hyperparameter changes.

```mermaid
flowchart TD
    A["Versioned eval set"] --> B["Current production system"]
    A --> C["Candidate adapted system"]
    B --> D["Baseline results by slice"]
    C --> E["Candidate results by slice"]
    D --> F["Paired comparison"]
    E --> F
    F --> G{"Target and guardrails pass?"}
    G -->|"Yes"| H["Proceed to staged release"]
    G -->|"No"| I["Revise hypothesis, data, or method"]

    classDef data fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef system fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef decision fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef outcome fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A data; class B,C,D,E,F system; class G decision; class H,I outcome
```

Evaluate the complete application. A tuned model may respond differently to the system prompt, retrieved documents, tool schemas, structured-output rules, safety filters, retry policy, and sampling settings. A checkpoint score measured in isolation can miss failures introduced by those interactions.

The run record should bind:

- exact base model and tokenizer revision;
- training, validation, and test dataset hashes;
- prompt and chat-template versions;
- method, hyperparameters, seed, trainer, and environment;
- compute shape and distributed strategy;
- checkpoints, metrics, logs, and resource usage;
- evaluation report and approval outcome.

MLflow is a common experiment-tracking layer for open and managed training environments. A run can log parameters, metrics, datasets, checkpoints, and artifacts. The model registry or catalogue then links a candidate version to the evidence used for promotion.

## Recognize Overfitting And Catastrophic Forgetting
<!-- section-summary: Overfitting harms new examples from the target task, while catastrophic forgetting harms capabilities outside the narrow adaptation data. -->

At a high level, training can harm the narrow task or damage capabilities outside it. These two outcomes have different causes and repairs. **Overfitting** describes poor generalization within the target task, while **catastrophic forgetting** describes lost behaviour outside the narrow adaptation data.

**Overfitting** means the model learns the training examples more closely than the general task. Training performance improves, while validation or test performance stops improving or gets worse.

Suppose a model is tuned on 2,000 highly similar refund conversations. It scores highly on those phrases and starts copying their structure. New refund requests written differently show no improvement. The training loss looks healthy, although the product result is weak.

Common responses include deduplicating examples, increasing task diversity, reducing epochs or learning rate, selecting an earlier checkpoint, adding regularization, and gathering better boundary cases. More copies of the same pattern usually deepen the problem.

**Catastrophic forgetting** means the adaptation damages useful behaviour learned before the fine-tune. A model tuned heavily for terse classification may become worse at following longer instructions. A narrow domain tune may weaken another language, general reasoning, safe refusal, or tool use.

```mermaid
flowchart TD
    A["Training metrics improve"] --> B{"What happens on held-out evals?"}
    B -->|"Target task worsens"| C["Likely overfitting"]
    B -->|"Target improves,<br/>retained capabilities worsen"| D["Likely forgetting"]
    B -->|"Target and retained suites improve"| E["Continue safety and system gates"]
    C --> F["Reduce memorization and improve coverage"]
    D --> G["Reduce update strength and restore capability coverage"]
    F --> H["Train a new candidate"]
    G --> H

    classDef signal fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef failure fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827; classDef action fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef pass fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A
    class A,B signal; class C,D failure; class F,G,H action; class E pass
```

The evaluation design should therefore contain two suites:

- the **target suite** measures the behaviour the adaptation intends to improve;
- the **retention suite** measures important capabilities and safety behaviour that should remain intact.

Start by reducing the strength or duration of the update through a lower learning rate, fewer epochs, or PEFT. Carefully selected general and safety examples can restore missing coverage. Checkpoint selection can stop before the regression grows. Routing can limit the adapter to its intended slice. Every mitigation needs evidence. LoRA freezes the base weights, but an active adapter can still steer outputs away from retained behaviour.

Training curves help locate the moment a candidate starts to overfit. They do not reveal every form of forgetting. A multilingual or safety regression appears only if the evaluation set asks the corresponding questions.

## Test Safety And Reward Regressions
<!-- section-summary: Adaptation can weaken refusals, amplify sensitive patterns, leak memorized text, or exploit a reward, so safety tests need independent data and human review. -->

A base model's safety behaviour is part of the starting system. Adaptation can shift it. Repeated demonstrations that always answer a sensitive request may weaken abstention. Private text may be memorized. Preference labels may reward confidence over uncertainty. A reinforcement grader may contain a loophole.

Safety evaluation should cover the product's real risks:

- requests the model must refuse or escalate;
- prompt injection and attempts to override policy;
- unsupported claims and fabricated evidence;
- personal or confidential data leakage;
- harmful bias across relevant user groups;
- unsafe tool selection or arguments;
- memorized reproduction of training examples;
- adversarial attempts to maximize reward without completing the task.

Consider a tool-using assistant trained to issue refunds. The target eval may show better tool selection. A safety eval should also try requests above the user's authorization and requests containing altered customer IDs. Conflicting retrieved instructions and repeated attempts after denial test two more boundaries. The model may propose an action, while the tool gateway still enforces identity, limits, and approval.

For RFT, keep a **shadow grader** that is not optimized directly. It can use different tests, a separately written rubric, or qualified human review. If the training reward rises while the shadow score falls, the model may be learning the grader rather than the task.

```mermaid
flowchart TD
    A["Candidate checkpoint"] --> B["Target-task eval"]
    A --> C["Retention eval"]
    A --> D["Safety and privacy eval"]
    A --> E["Adversarial reward eval"]
    B --> F{"All release gates pass?"}
    C --> F
    D --> F
    E --> F
    F -->|"Yes"| G["Eligible for canary"]
    F -->|"No"| H["Reject or retrain"]

    classDef candidate fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef eval fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef gate fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef result fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A candidate; class B,C,D,E eval; class F gate; class G,H result
```

Provider safety checks are useful platform controls. They do not know every product-specific risk. A healthcare triage system, coding agent, and support assistant require different datasets, policies, and escalation tests.

## Choose A Current Industrial Stack
<!-- section-summary: Managed services reduce training operations, while open stacks expose more model and algorithm control; current maturity and deprecations should shape the choice. -->

At a high level, the stack decides where the training job runs and which parts the platform manages. The choice follows the model and learning signal. Data controls, regional requirements, accelerator scale, and the team's operational capacity narrow the options further.

### Managed model customization

Managed services operate the training infrastructure and return a provider-hosted customized model. They are a practical default for a supported model and method. The data must fit the provider's processing controls, and the team must accept the available training and deployment contract.

Amazon Bedrock supports model customization paths that vary by model and region. Its documentation covers supervised fine-tuning, reinforcement fine-tuning with a custom or model-based grader, and managed model distillation using a teacher and supported student. Training data and output artifacts use Amazon S3, with IAM roles, encryption, and VPC controls available for the job. Model and regional support changes, so the implementation should query current availability instead of hard-coding a model list in architecture.

Google's Gemini Enterprise Agent Platform Tuning API documents supervised fine-tuning for supported Gemini models. Training and optional validation data are supplied as JSONL in Cloud Storage. Tuning jobs expose adapter size and training hyperparameters where the selected model allows them. The current Tuning API page documents SFT; do not assume DPO or reinforcement support without checking the selected service and model.

Microsoft Foundry supports fine-tuning jobs through its portal, APIs, and Azure Developer CLI extension. Supported methods, deployment types, regions, and model families differ. Foundry's reinforcement fine-tuning path also depends on model access and grader support. Treat the model catalogue and access checks as deployment-time evidence.

OpenAI's fine-tuning documentation still explains SFT, DPO, and RFT. The platform is winding down access to new training jobs for active existing customers. Organizations without qualifying prior fine-tuning activity cannot create jobs or train models. Existing fine-tuned models remain available for inference until their base model is deprecated, so every current user needs a migration or retirement plan. A new architecture should not choose this surface as its long-term default.

### Open and self-managed training

Open-model training provides more control over model weights, algorithms, checkpoints, data locality, and serving. A common stack is:

- PyTorch for model execution and distributed primitives;
- Hugging Face Transformers and Datasets for models, tokenizers, and data;
- TRL for SFT, DPO, GRPO, reward modelling, and related post-training methods;
- PEFT for LoRA and other parameter-efficient adapters;
- FSDP or DeepSpeed for sharding large training workloads;
- MLflow or Weights & Biases for experiments and artifacts;
- an OCI image, Kubernetes or a managed GPU job, and object storage for reproducible execution;
- a governed model registry or catalogue for promotion and lineage.

TRL labels some trainers experimental. That status matters. Teams should pin exact library versions and use supported combinations. A small compatibility job should run before the full experiment. Research methods should not inherit the operational maturity of SFT by assumption.

### Databricks as a governed open-training platform

Databricks' earlier Foundation Model Fine-tuning product is deprecated. The current direction is **AI Runtime**, a serverless GPU environment for custom deep-learning and LLM training. Its examples cover LoRA, QLoRA, and full SFT. They also show TRL, DeepSpeed, and distributed PyTorch paths. AI Runtime remains a preview feature. A readiness check should confirm regional availability and the required accelerator. It should also confirm runtime support and the maximum workload duration.

A typical Databricks path stores governed data and checkpoints in Unity Catalog tables or Volumes. AI Runtime provides GPU training, and MLflow tracks the experiment. The resulting model version returns to Unity Catalog. Compatible fine-tuned models can then use Model Serving provisioned throughput.

```mermaid
flowchart TD
    A["Unity Catalog data<br/>and volume paths"] --> B["AI Runtime training job"]
    B --> C["TRL, PEFT, or PyTorch"]
    C --> D["MLflow run and checkpoints"]
    D --> E["Unity Catalog model version"]
    E --> F["Model Serving candidate"]
    F --> G["Offline gates and canary"]

    classDef data fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef train fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef govern fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef release fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A data; class B,C train; class D,E govern; class F,G release
```

Databricks is one option among managed GPU environments. SageMaker, Vertex AI, and Azure Machine Learning provide managed training jobs. Kubernetes with GPU operators offers another path. The durable design is a versioned job with governed data and pinned dependencies. It tracks experiments and checkpoints, runs evaluation gates, and produces a releasable artifact.

### Choose by constraints

A managed customization API is usually simpler for a supported proprietary model and a standard method. An open stack fits teams that need model ownership, custom algorithms, local data processing, specialized hardware control, or independent serving.

Provider choice does not replace the learning decision. A platform can execute SFT perfectly on a dataset that represents the wrong behaviour.

## Calculate The Real Economics
<!-- section-summary: The financial decision includes data work, teacher generation, training, evaluation, serving, and ongoing operations rather than GPU time alone. -->

At a high level, adaptation adds an upfront investment and changes the cost of every future request. The business case compares both sides at the quality level users actually need. GPU time is only one part of that calculation.

The one-time side starts with data discovery and permission review. Redaction, annotation, adjudication, and teacher generation prepare the learning signal. Training experiments, evaluation, security review, and integration complete the initial investment. Recurring costs cover inference or hosting, artifact management, monitoring, storage, retraining, and incident response.

A useful comparison measures **cost per accepted result**:

```text
cost per accepted result
  = total inference and retry cost
    / number of outputs that pass quality and safety checks
```

A cheaper model that needs frequent retries or human correction may cost more per useful result.

For distillation, a simple break-even estimate is:

```text
break-even requests
  = one-time adaptation cost
    / (teacher cost per accepted result - student cost per accepted result)
```

Suppose data, teacher generation, training, and evaluation cost £30,000. The student saves £0.006 per accepted request after accounting for retries. The break-even point is five million accepted requests. If the workload processes only 100,000 requests a year, distillation does not recover its initial cost through inference savings alone.

Latency, privacy, deployment footprint, and capacity may still justify it. The economic record should state which benefit matters.

PEFT reduces trainable parameters and checkpoint size, though data and evaluation work remain. Managed training removes much infrastructure work, though provider training and hosted inference pricing may be higher. Self-managed training can reduce marginal costs at scale, while adding accelerator scheduling, reliability, security, and serving work.

Track estimated and actual values. MLflow can record GPU hours, job duration, dataset size, and evaluation metrics. Cloud billing exports or Databricks system billing tables can supply compute usage. The release report should compare quality and safety first. It should then report latency, throughput, and cost under the same traffic assumptions.

## Release And Roll Back The Complete System
<!-- section-summary: A tuned model ships as part of a versioned application bundle with offline gates, staged exposure, monitoring, and a tested route to the previous bundle. -->

At a high level, a fine-tuning job produces one candidate component. Production combines that component with prompts, tools, retrieval, policies, and serving code. The release process evaluates and promotes this complete bundle.

The releasable unit includes:

- base model and adapter or fine-tuned checkpoint;
- tokenizer and chat template;
- system prompt and response schema;
- retrieval and tool configuration;
- inference settings and safety policies;
- dataset, training run, and evaluation lineage;
- runtime image and serving configuration.

Changing the prompt after evaluation can change the tuned model's behaviour. Upgrading the base model under an adapter can break compatibility. The bundle keeps these dependencies together.

```mermaid
flowchart TD
    A["Candidate bundle"] --> B{"Offline gates pass?"}
    B -->|"No"| C["Reject"]
    B -->|"Yes"| D["Shadow traffic"]
    D --> E{"Shadow evidence healthy?"}
    E -->|"No"| C
    E -->|"Yes"| F["Canary"]
    F --> G{"Quality and operations pass?"}
    G -->|"Yes"| H["Production"]
    G -->|"No"| I["Roll back"]
    H -->|"Regression"| I

    classDef candidate fill:#FFE04F,stroke:#536A9A,stroke-width:3px,color:#111827; classDef gate fill:#93C5FD,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef stage fill:#2DD4BF,stroke:#536A9A,stroke-width:3px,color:#0F172A; classDef stop fill:#FB7185,stroke:#536A9A,stroke-width:3px,color:#111827
    class A candidate; class B,E,G gate; class D,F,H stage; class C,I stop
```

Shadow traffic lets the candidate process real requests without controlling the user-visible result. A canary routes a small, eligible share of traffic to the candidate. Progressive promotion expands exposure only after the observation window contains enough evidence.

Monitoring should separate the candidate from the previous bundle by model route and version. Start with task quality, safety events, abstention, and escalation. Add schema failures, tool errors, and reviewer overrides. Operational views track latency, token use, accelerator saturation, and cost per accepted result. Slice views reveal a candidate that improves routine English traffic while harming long inputs or another language.

Rollback should change routing to a known-compatible previous bundle. It should not depend on rebuilding an old image or rediscovering a prompt. Teams test rollback in staging and define automatic or manual triggers before canary traffic begins.

Retirement stops new routing and revokes artifact access. It updates downstream aliases and applies retention policy to datasets and checkpoints. The minimum evidence needed to explain past decisions remains available. Provider-hosted customized models also need a base-model retirement plan because their inference lifetime may follow the provider's deprecation policy.

## A Practical Adaptation Decision
<!-- section-summary: The final choice links a measured failure to the smallest trustworthy signal, the safest training path, and a reversible production release. -->

At a high level, the final decision connects one measured failure to one trustworthy learning signal and one reversible release. Five questions keep the reasoning focused: what failed, which layer owns it, what evidence can teach the correction, where should training run, and which gates authorize production?

First, describe the repeated failure and reproduce it on a versioned evaluation set. Second, repair the prompt, context, tools, workflow, or routing if one of those layers owns the problem. Third, identify the strongest signal the team can produce honestly. It may be demonstrations, preferences, a grader, or teacher behaviour. Fourth, choose a managed or open training path that meets governance and operational constraints. Fifth, promote the complete system bundle after target, retention, safety, cost, and service gates pass.

Use SFT for repeatable desired outputs. Use preference optimization for reliable comparisons between plausible responses. Use RFT for tasks with a robust, hard-to-game grader and enough initial success to reinforce. Use distillation for a defined high-volume slice where a smaller student can meet explicit quality and safety thresholds.

The central idea is simple: adaptation turns data into durable model behaviour. The data must express the right behaviour, and evaluation must detect regressions. Production also needs a safe route to the previous system.

## References

- [OpenAI model optimization](https://developers.openai.com/api/docs/guides/model-optimization)
- [OpenAI supervised fine-tuning](https://developers.openai.com/api/docs/guides/supervised-fine-tuning)
- [OpenAI direct preference optimization](https://developers.openai.com/api/docs/guides/direct-preference-optimization)
- [OpenAI reinforcement fine-tuning](https://developers.openai.com/api/docs/guides/reinforcement-fine-tuning)
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [Amazon Bedrock model customization](https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html)
- [Amazon Bedrock reinforcement fine-tuning](https://docs.aws.amazon.com/bedrock/latest/userguide/reinforcement-fine-tuning.html)
- [Amazon Bedrock model distillation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-distillation.html)
- [Google Gemini Enterprise Agent Platform Tuning API](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/tuning)
- [Microsoft Foundry fine-tuning with the Azure Developer CLI](https://learn.microsoft.com/en-us/azure/foundry/fine-tuning/fine-tune-cli)
- [Microsoft Foundry reinforcement fine-tuning](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reinforcement-fine-tuning)
- [Hugging Face TRL](https://huggingface.co/docs/trl/index)
- [Hugging Face PEFT LoRA](https://huggingface.co/docs/peft/main/en/package_reference/lora)
- [PyTorch Fully Sharded Data Parallel](https://docs.pytorch.org/docs/stable/fsdp.html)
- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)
- [Databricks AI Runtime](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/)
- [Databricks AI Runtime LLM examples](https://docs.databricks.com/aws/en/machine-learning/ai-runtime/examples/gpu-llms)
- [Databricks Foundation Model Fine-tuning deprecation](https://docs.databricks.com/aws/en/large-language-models/foundation-model-training)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
