---
title: "Human Review"
description: "Design human review workflows that route risky model outputs to qualified reviewers, capture audit trails, and turn decisions into feedback data."
overview: "Human review is a production decision system with routing, task context, qualified authority, adjudication, capacity controls, quality measurement, and governed feedback."
tags: ["MLOps", "production", "feedback"]
order: 2
id: "article-mlops-monitoring-and-feedback-human-review-workflows"
---

## Human Review Is Part of the Product

<!-- section-summary: Human review routes selected model outputs to qualified people who can confirm, correct, or escalate a decision with an auditable reason. -->

**Human review** is the production workflow that sends selected model outputs to qualified people for confirmation, correction, or escalation. Review may happen before a model influences the product, or afterward as an audit sample. In both cases, the workflow needs routing rules, clear tasks, deadlines, ownership, records, and quality measurement.

The review system has seven parts that work together:

| Part | Purpose | Failure when omitted | Main design choice |
|---|---|---|---|
| **Routing policy** | Selects cases that need a person | High-risk cases bypass review or every case overloads the queue | pre-action review, post-action audit, or both |
| **Task context** | Gives the reviewer enough evidence to decide | Reviewers guess or copy the model output | which source data and model evidence to reveal |
| **Authority** | Names who can confirm, override, or escalate | A review button records input without changing the product | reviewer qualification and allowed actions |
| **Workflow state** | Tracks assignment, deadline, decision, and escalation | Urgent tasks disappear inside an unowned queue | queue priority, service target, and fallback |
| **Adjudication** | Resolves disagreement and policy ambiguity | Conflicting labels collapse into arbitrary truth | senior review, consensus, or policy-owner decision |
| **Quality control** | Measures reviewer and queue reliability | Fast throughput hides rubber-stamping or weak guidance | blinded audits, agreement checks, and sampled re-review |
| **Feedback governance** | Preserves provenance before reuse | Selected emergency decisions enter training as clean labels | eligibility, weighting, maturity, and retention rules |

The main tradeoff is capacity versus risk coverage. Reviewing every prediction may add delay and still produce rushed decisions. Reviewing only the model's most uncertain cases misses confidently wrong outputs. Industrial systems combine risk-based pre-action review with representative post-action auditing, then watch both queue health and decision quality.

ClearScan Health illustrates this system with a chest X-ray triage model that suggests `critical`, `urgent`, or `routine` worklist priority. A qualified clinical team reads every study and makes the medical decision. The example shows how the framework handles consequential routing while preserving clinical authority.

## Different Cases Need Different Review Paths

<!-- section-summary: ClearScan uses pre-action review for high-risk or uncertain cases and blinded post-action sampling to measure routine performance. -->

**Pre-action review** happens before the model-driven action reaches the product. It fits decisions with high consequence and a tolerable review delay. **Post-action audit** samples completed decisions to measure quality and find systematic failures. It fits lower-risk traffic where adding a synchronous gate would damage the workflow. A third path, **exception review**, handles invalid input, policy conflict, or missing evidence rather than model uncertainty alone.

When the model assigns `critical` priority with a high score, ClearScan sends the study to a senior reviewer before the worklist alert fires. This confirmation protects the most consequential route. A study with two similar class scores also enters pre-action review because the model has not separated the choices clearly.

ClearScan uses another path for ongoing quality. It selects a stable random sample of routine studies and asks reviewers to make an independent priority judgement without seeing the model’s suggestion first. This **blinded audit** helps detect automation bias, where people accept an automated answer too readily because it is visible.

The network also samples more cases from important groups such as paediatric and portable studies. These samples do not replace representative random auditing, because an oversampled queue cannot estimate the overall production error rate without weighting. The review record therefore keeps the reason and probability for each sample.

The routing policy connects to available staff. A critical queue has a short deadline and alerts a supervisor when capacity is insufficient. Lower-risk audit work can wait for the next staffed period. ClearScan never silently drops a critical task because the queue is full.

## A Review Task Must Tell a Complete Story

<!-- section-summary: The task record connects the prediction, source case, routing reason, deadline, reviewer state, final decision, and policy version. -->

Each review task points to the original prediction and the governed image viewer. It records the model and policy versions, predicted priority, score, routing reason, creation time, deadline, assigned reviewer group, and current status. The reviewer’s final priority, rationale, confidence, and escalation also return to the same task.

A small database shape is enough to show the important boundary. Its submission idempotency key makes a retried decision produce one stored result instead of a duplicate action.

```sql
CREATE TABLE mlops.cxr_review_tasks (
  review_task_id TEXT PRIMARY KEY,
  prediction_id TEXT NOT NULL,
  study_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  review_reason TEXT NOT NULL,
  sampling_probability DOUBLE PRECISION,
  status TEXT NOT NULL,
  reviewer_group TEXT NOT NULL,
  assigned_reviewer_id TEXT,
  assigned_at TIMESTAMPTZ,
  assignment_expires_at TIMESTAMPTZ,
  submission_idempotency_key TEXT UNIQUE,
  model_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  predicted_priority TEXT NOT NULL,
  reviewer_priority TEXT,
  reviewer_rationale TEXT,
  decided_at TIMESTAMPTZ
);
```

The table stores identifiers rather than the raw medical image. Access to the viewer follows the clinical system’s normal authorization. Review notes and audit records use privacy and retention controls appropriate for health data.

Task status represents real workflow. An open task is waiting for assignment. An assigned task has an active owner. A submitted task contains one reviewer’s decision. An escalated task needs senior judgement, and an adjudicated task contains the accepted outcome after disagreement. An overdue critical task triggers an operational alert rather than quietly changing to a completed state.

Assignment must be atomic so two reviewers cannot claim the same critical case. A PostgreSQL worker can lock one eligible row, update it, and return the task in one transaction:

```sql
BEGIN;

WITH next_task AS (
  SELECT review_task_id
  FROM mlops.cxr_review_tasks
  WHERE status = 'open'
    AND reviewer_group = 'senior-radiology'
  ORDER BY due_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE mlops.cxr_review_tasks AS task
SET status = 'assigned',
    assigned_reviewer_id = 'reviewer-184',
    assigned_at = CURRENT_TIMESTAMP,
    assignment_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
FROM next_task
WHERE task.review_task_id = next_task.review_task_id
RETURNING task.*;

COMMIT;
```

`FOR UPDATE SKIP LOCKED` lets several workers claim different tasks without waiting on the same row. The earliest deadline receives priority. The transition records the reviewer and a five-minute assignment lease, which supports timeout recovery and audit. The schema uses PostgreSQL types because the claim query relies on PostgreSQL row-locking semantics; a warehouse copy of the records would use its own types and would not own task assignment.

If the reviewer disconnects, a lease monitor can return the task to `open` only after its assignment lease expires and no submitted decision exists. If the deadline passes first, the task moves to `escalated`, alerts the clinical supervisor, and activates the reviewed fallback worklist. A test starts two assignment transactions at the same time and verifies they return different task IDs; another expires one lease and verifies the task re-enters the queue exactly once.

Decision submission also uses a compare-and-set transition from `assigned` to `submitted`. A retry with the same idempotency key returns the original decision. A different second decision receives a conflict and enters adjudication rather than overwriting the first reviewer’s work.

## The Interface Shapes the Decision

<!-- section-summary: Reviewers need the case, task reason, label definitions, and relevant evidence without an interface that pushes them toward agreement. -->

The ClearScan review screen opens the image in the approved clinical viewer and shows study context, image-quality information, the reason the case entered review, and the available priority labels. Each label has a short definition connected to the worklist policy.

For an urgent operational decision, the screen shows the model suggestion and explains its intended role. Speed matters, and the reviewer needs to understand why the case surfaced. The interface still asks for an independent clinical priority and a reason when the reviewer overrides the model.

For the random audit sample, the model suggestion stays hidden until the reviewer submits an initial judgement. The system then reveals the prediction for disagreement review. This sequence gives ClearScan evidence about independent reviewer-model agreement instead of collecting labels that simply echo the model.

The score is displayed with its limitations. A value such as `0.87` is not an 87-percent promise that the clinical priority is correct unless the system has validated that interpretation. ClearScan uses calibrated score ranges only where calibration evidence supports them and avoids turning colour or layout into an instruction to approve.

## Disagreement Needs a Resolution Path

<!-- section-summary: Escalation and adjudication distinguish model errors, reviewer errors, ambiguous cases, and policy gaps. -->

A reviewer changes one study from `critical` to `urgent` because an image artifact resembles a finding that triggered the model. Another reviewer keeps `critical`. The task enters adjudication with both decisions, the image-quality note, and the active policy version.

A senior reviewer makes the final queue decision and records why the disagreement occurred. The reason may be a model error, poor image quality, ambiguous clinical evidence, inconsistent reviewer guidance, or a policy gap. These categories matter later because they lead to different work.

If reviewers regularly disagree on one finding group, more model training data may not solve the problem. ClearScan may need clearer guidance or a different label definition. If reviewers agree with each other and regularly override the model, the model or input pipeline likely needs attention.

The adjudicated outcome serves as the governed label for evaluation and possible future training. ClearScan keeps the original reviewer decisions too, because collapsing disagreement into one final value would erase information about task difficulty and label quality.

## Measure the Review System, Not Only the Model

<!-- section-summary: Operations and quality metrics show whether the queue protects users, uses reviewer capacity well, and produces trustworthy decisions. -->

ClearScan monitors how long critical tasks wait, how many miss their deadline, how much work sits in each queue, and how many cases each reviewer group completes. These measures reveal whether the human safety layer is actually available when the model needs it.

The team also measures agreement between reviewers, agreement between reviewers and the model, override reasons, adjudication rate, and quality by study type and site. Blinded audit samples estimate live model performance, while pre-action queues describe a risk-selected population and should not be reported as if they represent all studies.

Reviewer speed needs careful interpretation. A very fast reviewer may have simple cases, or the interface may encourage rubber-stamping. ClearScan samples completed work for quality and compares assisted and blinded decisions. It avoids ranking clinicians from raw throughput without context.

Capacity affects the routing policy. If critical volume rises, ClearScan adds qualified coverage or uses a safe fallback worklist rule. It does not quietly raise the review threshold to make the dashboard look healthier.

## Turn Decisions Into Useful Feedback

<!-- section-summary: Review outcomes join back to predictions with provenance, maturity, and quality information before they enter evaluation or training data. -->

Every completed review keeps the prediction ID, model version, reviewer decision, rationale, policy version, and timestamps. That identity lets the data team join the outcome back to the exact model event and feature snapshot.

ClearScan sends adjudicated cases into an evaluation dataset first. Recent overrides enter regression fixtures, and segment reports show whether the candidate repeats known mistakes. Training use follows a separate approval process because review data is selected by risk and uncertainty. Its distribution differs from production traffic.

The random audit sample helps estimate that distribution. Sampling probability allows analysts to weight results and understand which studies were overrepresented. The team also checks label maturity, reviewer quality, and policy changes before creating a training snapshot.

Feedback can improve more than the model. A common image-quality escalation may lead to a scanner workflow fix. Repeated policy ambiguity may change reviewer guidance. A queue overload may change staffing or fallback design. The review system should preserve enough context to assign the right repair.

## When the Human Layer Fails

<!-- section-summary: Overdue tasks, missing context, weak guidance, privacy leaks, and automation bias need operational response and regression coverage. -->

Suppose critical tasks begin missing their ten-minute target after one site adds a new scanner. Operations alerts on queue age and routes the work through the fallback clinical worklist. The team finds that the new device produces lower-quality images, which sends too many studies into uncertain review.

The response involves the imaging pipeline, model team, and clinical operations. They preserve the affected tasks and decisions, inspect the quality score and routing rule, and decide whether the device needs preprocessing calibration or a separate policy. The incident supplies a test for future model and routing changes.

Human review did not remove risk from the system. It created another production service with its own capacity, interfaces, data, and failure modes. ClearScan can rely on it only because the queue is observable, reviewers are qualified, decisions are auditable, and fallback behaviour is tested.

## The Complete Review Loop

<!-- section-summary: ClearScan connects risk-based routing, meaningful reviewer decisions, adjudication, operational measurement, and governed feedback. -->

ClearScan sends critical and uncertain cases to pre-action review and uses blinded random auditing to measure routine quality. Each task carries the model event, routing reason, policy, deadline, reviewer decision, and outcome. Disagreement moves through adjudication instead of disappearing. Queue and quality metrics show whether the human layer is protecting patients, and reviewed outcomes return to evaluation and training with their sampling and provenance intact.

That is what makes human review useful in MLOps. The person is part of a designed workflow, not a final button added after the model. The workflow decides which expertise is needed, supplies the evidence for a real judgement, and turns the result into trustworthy operational and learning data.

## References

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [FDA: Good Machine Learning Practice](https://www.fda.gov/medical-devices/software-medical-device-samd/good-machine-learning-practice-medical-device-development-guiding-principles)
- [Label Studio documentation](https://labelstud.io/guide/)
- [Label Studio webhooks](https://labelstud.io/guide/webhooks.html)
- [Google Cloud: Human-in-the-loop AI](https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)
- [scikit-learn: Model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html)
