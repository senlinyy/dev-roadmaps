---
title: "Human Review"
description: "Design human review workflows that route risky model outputs to qualified reviewers, capture audit trails, and turn decisions into feedback data."
overview: "Human review is the controlled workflow for routing uncertain, risky, or high-impact model outputs to qualified people. This guide follows a medical image triage model through review queues, labeling configs, escalation rules, adjudication, audit logs, quality checks, and feedback export."
tags: ["MLOps", "production", "feedback"]
order: 2
id: "article-mlops-monitoring-and-feedback-human-review-workflows"
---

## Table of Contents

1. [Human Review Is A Production Workflow](#human-review-is-a-production-workflow)
2. [Follow One Medical Image Triage Queue](#follow-one-medical-image-triage-queue)
3. [Decide Which Predictions Need Review](#decide-which-predictions-need-review)
4. [Build The Review Queue Schema](#build-the-review-queue-schema)
5. [Give Reviewers The Right Context](#give-reviewers-the-right-context)
6. [Capture Decisions, Escalations, And Audit Evidence](#capture-decisions-escalations-and-audit-evidence)
7. [Measure Review Quality And Throughput](#measure-review-quality-and-throughput)
8. [Send Review Data Back To The ML System](#send-review-data-back-to-the-ml-system)
9. [Practical Checks, Mistakes, And Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
10. [References](#references)

## Human Review Is A Production Workflow
<!-- section-summary: Human review routes selected model decisions to qualified people with clear instructions, deadlines, audit trails, and feedback outputs. -->

**Human review** is the workflow where a model output goes to a qualified person before the product takes a final action, or soon after the action for audit and learning. The person may confirm the model, correct it, escalate it, or mark the case as ambiguous. The important part is that review has rules, ownership, records, and quality checks.

Teams add human review when a model decision can create real harm, when the model is uncertain, when regulation or policy requires human oversight, or when the team wants high-quality labels for future training. Review can happen before an action, such as holding a medical triage decision for a clinician. It can also happen after an action, such as auditing a sample of marketplace moderation decisions.

The model should help the reviewer by showing a prediction, score, evidence, and suggested priority. The reviewer should never receive a mysterious score with no context. The workflow should also protect reviewers from overload. If every prediction enters a manual queue, the queue grows faster than people can work. If too few cases enter review, the team misses risky failures.

This article follows a medical image triage scenario because it makes the stakes clear. The same workflow pattern applies to fraud review, content moderation, loan review, insurance claims, legal document classification, and LLM response quality review.

## Follow One Medical Image Triage Queue
<!-- section-summary: The running scenario uses a chest X-ray triage model where clinicians review urgent, uncertain, and sampled routine cases. -->

Imagine **ClearScan Health**, a radiology network that receives chest X-ray studies from emergency departments and outpatient clinics. A model called `cxr_triage_model` scores each incoming study and predicts a triage priority: `critical`, `urgent`, or `routine`. The product uses that priority to help reading teams organize the worklist.

ClearScan uses human review because the model affects a clinical queue. A critical finding should surface quickly. A routine case should still receive normal reading by the care team. The model output supports prioritization, and a qualified reviewer can correct or escalate selected cases before the worklist changes.

The workflow has four review paths:

| Review path | Example case | Reviewer action |
|---|---|---|
| **Critical auto-review** | Model predicts `critical` with high confidence | A senior reviewer confirms priority before the worklist alert fires |
| **Low-confidence review** | Top score is close to the second score | Reviewer chooses final priority and rationale |
| **Segment safety sample** | Pediatric or portable studies sampled at a fixed rate | Reviewer checks quality in sensitive segments |
| **Post-decision audit** | Routine predictions sampled after reading | Reviewer measures ongoing quality and drift |

The point is balance. The workflow gives urgent cases fast attention, uncertain cases a human decision, and routine cases enough sampling to catch slow quality changes. Reviewers can focus on the cases where their expertise adds the most value.

ClearScan writes its policy in a config file so product, clinical, and ML owners can review it together:

```yaml
human_review_policy:
  model: cxr_triage_model
  policy_version: "2026-07-05"
  queues:
    critical_pre_action:
      reviewer_group: senior_radiology_reviewers
      due_minutes: 10
      triggers:
        - predicted_priority: critical
          min_score: 0.85
    uncertain_pre_action:
      reviewer_group: radiology_reviewers
      due_minutes: 30
      triggers:
        - margin_between_top_two_scores_lt: 0.10
        - predicted_score_lt: 0.70
    segment_safety_sample:
      reviewer_group: radiology_reviewers
      due_hours: 24
      sampling:
        pediatric: 0.20
        portable_xray: 0.10
        routine_baseline: 0.02
  escalation:
    overdue_critical_minutes: 12
    second_reviewer_required_for:
      - reviewer_disagrees_with_critical_prediction
      - image_quality_too_low
      - ambiguous_finding
```

This config is easier to review than scattered application code. It names the queues, triggers, deadlines, reviewer groups, and escalation conditions. During an incident, the team can point to the exact policy version that routed a study.

![ClearScan review routing policy](/content-assets/articles/article-mlops-monitoring-and-feedback-human-review-workflows/clearscan-review-routing-policy.png)
*ClearScan routes each prediction through a named policy version so critical, uncertain, sampled, and audit cases land in the right human queue.*

## Decide Which Predictions Need Review
<!-- section-summary: Review routing should combine model uncertainty, risk level, segment sampling, policy requirements, and reviewer capacity. -->

Human review starts with routing. Routing decides which predictions enter which queue, how urgent they are, and which reviewers can handle them. A good router uses model signals and product-risk signals together.

ClearScan uses these signals:

| Signal | Field | Why reviewers care |
|---|---|---|
| Model priority | `predicted_priority` | Critical predictions need fast confirmation |
| Model uncertainty | `predicted_score`, `score_margin` | Close calls have higher correction value |
| Study context | `study_type`, `patient_age_group`, `site_id` | Some segments need extra safety sampling |
| Image quality | `image_quality_score` | Poor-quality images may need escalation |
| Capacity | `open_tasks_by_queue` | Routing should respect reviewer workload |
| Policy | `policy_version` | Review decisions should be tied to current rules |

The router should run after prediction logging and before the product takes any pre-action step. ClearScan writes a simple routing query for batch-created review tasks:

```sql
WITH scored AS (
  SELECT
    prediction_id,
    study_id,
    predicted_at,
    predicted_priority,
    predicted_score,
    top_score - second_score AS score_margin,
    study_type,
    patient_age_group,
    image_quality_score,
    model_version,
    policy_version
  FROM mlops.cxr_prediction_log
  WHERE predicted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
),
routed AS (
  SELECT
    *,
    CASE
      WHEN predicted_priority = 'critical' AND predicted_score >= 0.85 THEN 'critical_pre_action'
      WHEN score_margin < 0.10 OR predicted_score < 0.70 THEN 'uncertain_pre_action'
      WHEN patient_age_group = 'pediatric' AND RAND() < 0.20 THEN 'segment_safety_sample'
      WHEN study_type = 'portable_xray' AND RAND() < 0.10 THEN 'segment_safety_sample'
      WHEN RAND() < 0.02 THEN 'post_decision_audit'
      ELSE NULL
    END AS review_queue
  FROM scored
)
SELECT *
FROM routed
WHERE review_queue IS NOT NULL;
```

This query uses priority, uncertainty, and sampling. The random sampling rates should be stable enough for operations. In a production implementation, many teams replace `RAND()` with deterministic sampling based on `prediction_id`, because deterministic sampling makes reruns and audits easier.

Routing should also have a capacity rule. If the queue is full, the system can raise the threshold, add reviewers, or switch low-risk samples into the next day. For high-risk queues, the system should alert instead of silently dropping tasks. Capacity is a patient-safety or customer-safety control in high-impact workflows.

## Build The Review Queue Schema
<!-- section-summary: A review queue stores task state, assignment, deadline, model evidence, reviewer decision fields, and audit metadata. -->

A **review queue** is the table or service that tracks tasks from open to complete. It should hold one row per review task, with enough state for assignment, deadlines, escalation, and audit. The queue should avoid storing raw medical image data directly; it can store governed URIs and access-controlled viewer links.

ClearScan keeps the queue in a database table that the review application reads:

```sql
CREATE TABLE mlops.cxr_review_tasks (
  review_task_id STRING NOT NULL,
  prediction_id STRING NOT NULL,
  study_id STRING NOT NULL,
  patient_id_hash STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  due_at TIMESTAMP NOT NULL,
  review_queue STRING NOT NULL,
  priority STRING NOT NULL,
  status STRING NOT NULL,
  assigned_reviewer_group STRING NOT NULL,
  assigned_reviewer_id_hash STRING,
  model_name STRING NOT NULL,
  model_version STRING NOT NULL,
  policy_version STRING NOT NULL,
  predicted_priority STRING NOT NULL,
  predicted_score FLOAT64 NOT NULL,
  score_margin FLOAT64,
  study_type STRING,
  patient_age_group STRING,
  image_quality_score FLOAT64,
  image_viewer_uri STRING NOT NULL,
  decision_priority STRING,
  decision_finding_group STRING,
  decision_confidence FLOAT64,
  reviewer_rationale_code STRING,
  reviewer_notes_uri STRING,
  decision_submitted_at TIMESTAMP,
  escalation_reason STRING,
  second_review_required BOOL NOT NULL,
  audit_packet_uri STRING
)
PARTITION BY DATE(created_at)
CLUSTER BY review_queue, status, priority;
```

The queue keeps both model evidence and reviewer fields. That is useful because the team can later compare the model prediction with the reviewer decision. The row also records `policy_version`, so a future audit can see which routing rule created the task.

Status values should be explicit:

```yaml
review_task_states:
  open: "Task created and waiting for assignment."
  assigned: "Reviewer opened the task or received it through work allocation."
  submitted: "Reviewer entered a decision and rationale."
  escalated: "Task needs senior or second-review decision."
  adjudicated: "Final decision accepted after disagreement or escalation."
  expired: "Task missed its deadline and triggered an operational alert."
```

A queue with clear states gives operations a live picture. Supervisors can see overdue critical tasks, reviewers can filter assigned work, and engineers can measure whether the queue meets service-level targets.

![ClearScan review queue states and context](/content-assets/articles/article-mlops-monitoring-and-feedback-human-review-workflows/clearscan-queue-states-context.png)
*The queue state, privacy-safe context, reviewer decision, and event log all need to line up so a task can move from open to adjudicated with evidence.*

## Give Reviewers The Right Context
<!-- section-summary: Review screens should show the case, model output, confidence, policy reason, and clear label choices without pushing reviewers toward blind approval. -->

Reviewers need enough context to make a decision. For ClearScan, that context includes the image viewer link, study metadata, model prediction, model confidence, routing reason, and label instructions. Reviewers also need clear choices, because vague label definitions create noisy training data.

A review interface might use a Label Studio-style configuration:

```xml
<View>
  <Header value="Chest X-ray triage review"/>
  <Image name="image" value="$image_url" zoom="true"/>
  <Text name="metadata" value="$study_summary"/>
  <Text name="model_output" value="$model_summary"/>
  <Choices name="priority" toName="image" choice="single" showInLine="true">
    <Choice value="critical"/>
    <Choice value="urgent"/>
    <Choice value="routine"/>
    <Choice value="insufficient_image_quality"/>
  </Choices>
  <Choices name="finding_group" toName="image" choice="multiple">
    <Choice value="suspected_pneumothorax"/>
    <Choice value="suspected_pneumonia"/>
    <Choice value="line_or_tube_position"/>
    <Choice value="other"/>
    <Choice value="none_visible"/>
  </Choices>
  <Choices name="rationale" toName="image" choice="single">
    <Choice value="confirmed_model_priority"/>
    <Choice value="overrode_model_priority"/>
    <Choice value="ambiguous_case"/>
    <Choice value="image_quality_issue"/>
  </Choices>
  <TextArea name="notes" toName="image" rows="3" placeholder="Short reviewer note"/>
</View>
```

The interface should avoid turning the model score into an instruction. A reviewer can see the model prediction, and the task should still ask for an independent decision. If reviewers always accept the model suggestion, the feedback loop may only confirm existing errors.

Clear label guidelines help reviewers agree:

```yaml
reviewer_guidelines:
  critical:
    definition: "Findings that should move to immediate clinical attention according to the reviewed triage policy."
    examples:
      - suspected_pneumothorax
      - severe line placement concern
  urgent:
    definition: "Findings that should move ahead of routine queue items while allowing normal reviewer workflow."
    examples:
      - suspected_pneumonia_with_concerning_context
      - moderate image quality issue with possible acute finding
  routine:
    definition: "No triage-priority finding identified under the policy."
  insufficient_image_quality:
    definition: "Image quality prevents a reliable triage decision."
```

The review guide should be owned by clinical leadership, product, and ML operations together. The model team can help with examples and edge cases, while domain experts define the review policy. That ownership split keeps the ML system aligned with the actual workflow.

## Capture Decisions, Escalations, And Audit Evidence
<!-- section-summary: Review decisions need durable audit records with reviewer identity, timestamps, rationale, escalations, and final adjudication. -->

The decision record is the bridge from human review back to the ML system. It should capture the reviewer decision, timestamp, rationale, escalation state, and final adjudication. It should also create an audit packet with the prediction, policy version, task history, reviewer decision, and any second-review outcome.

ClearScan writes every task state change to an event table:

```sql
CREATE TABLE mlops.cxr_review_events (
  event_id STRING NOT NULL,
  review_task_id STRING NOT NULL,
  prediction_id STRING NOT NULL,
  event_type STRING NOT NULL,
  event_at TIMESTAMP NOT NULL,
  actor_type STRING NOT NULL,
  actor_id_hash STRING,
  previous_status STRING,
  new_status STRING,
  decision_priority STRING,
  decision_finding_group ARRAY<STRING>,
  rationale_code STRING,
  escalation_reason STRING,
  policy_version STRING NOT NULL,
  audit_packet_uri STRING
)
PARTITION BY DATE(event_at)
CLUSTER BY event_type, new_status;
```

This event table lets the team replay the workflow. If a critical task expired, operations can see when it opened, who received it, when alerts fired, and whether a second reviewer joined. If a reviewer changed a priority, the ML team can compare the original prediction with the final decision.

Escalation rules should also live in config:

```yaml
escalation_rules:
  critical_task_overdue:
    when:
      review_queue: critical_pre_action
      status_in: [open, assigned]
      overdue_minutes: 12
    action:
      - page: radiology_review_supervisor
      - create_second_reviewer_task: true
  reviewer_overrides_critical:
    when:
      predicted_priority: critical
      decision_priority_in: [urgent, routine]
    action:
      - require_second_review: true
      - attach_original_prediction_to_audit_packet: true
  insufficient_quality:
    when:
      decision_priority: insufficient_image_quality
    action:
      - route_to_image_quality_workflow
      - exclude_from_training_until_adjudicated
```

Escalation belongs in review design from the first policy draft. The workflow should know which cases need a second reviewer, which cases require supervisor attention, and which labels should stay out of training until adjudication finishes.

![ClearScan adjudication and feedback export](/content-assets/articles/article-mlops-monitoring-and-feedback-human-review-workflows/clearscan-adjudication-feedback-export.png)
*Disagreement should create a second-review path, and the feedback export should include final labels while holding unfinished or low-quality cases back.*

## Measure Review Quality And Throughput
<!-- section-summary: Review operations need metrics for queue age, reviewer agreement, override rates, label quality, and segment coverage. -->

Human review creates its own operations system. You need to know whether reviewers can keep up, whether decisions are consistent, and whether the review queue covers the segments that matter. Queue metrics belong next to model metrics because both affect product quality.

ClearScan monitors throughput and timeliness:

```sql
SELECT
  review_queue,
  priority,
  COUNT(*) AS tasks,
  AVG(TIMESTAMP_DIFF(decision_submitted_at, created_at, MINUTE)) AS avg_minutes_to_decision,
  APPROX_QUANTILES(TIMESTAMP_DIFF(decision_submitted_at, created_at, MINUTE), 100)[OFFSET(95)] AS p95_minutes_to_decision,
  AVG(CASE WHEN decision_submitted_at <= due_at THEN 1 ELSE 0 END) AS on_time_rate
FROM mlops.cxr_review_tasks
WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND status IN ('submitted', 'adjudicated')
GROUP BY review_queue, priority
ORDER BY review_queue, priority;
```

Then it monitors model override rates:

```sql
SELECT
  review_queue,
  model_version,
  COUNT(*) AS reviewed_tasks,
  AVG(CASE WHEN predicted_priority = decision_priority THEN 1 ELSE 0 END) AS model_reviewer_agreement,
  AVG(CASE WHEN reviewer_rationale_code = 'image_quality_issue' THEN 1 ELSE 0 END) AS image_quality_issue_rate
FROM mlops.cxr_review_tasks
WHERE decision_submitted_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY review_queue, model_version
ORDER BY model_reviewer_agreement ASC;
```

Agreement is useful, and it needs context. A low agreement rate in the `uncertain_pre_action` queue may be expected because that queue intentionally selects hard examples. A falling agreement rate in a routine safety sample may signal drift, bad image quality, or a model release issue.

Reviewer consistency also matters. For a sample of repeated cases or second reviews, ClearScan can track disagreement:

```sql
SELECT
  study_type,
  patient_age_group,
  COUNT(*) AS adjudicated_cases,
  AVG(CASE WHEN first_decision_priority != second_decision_priority THEN 1 ELSE 0 END) AS reviewer_disagreement_rate
FROM mlops.cxr_review_adjudication
WHERE adjudicated_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY study_type, patient_age_group
HAVING adjudicated_cases >= 50
ORDER BY reviewer_disagreement_rate DESC;
```

High disagreement may mean the label guide needs clearer definitions. It may also mean the task is genuinely hard and should stay away from automatic action. Either way, the review system gives you evidence instead of vague opinions about label quality.

## Send Review Data Back To The ML System
<!-- section-summary: Review output should feed monitoring, evaluation, retraining, and incident review with clear source, timing, and adjudication status. -->

After review, the decision should flow back into the ML system. The output can serve several purposes: production monitoring, active learning, offline evaluation, retraining, incident evidence, and model card updates. The key is to preserve source and status so the training pipeline knows which labels are final.

ClearScan exports a feedback dataset from completed and adjudicated review tasks:

```sql
CREATE TABLE ml_training.cxr_review_feedback_2026_07 AS
SELECT
  t.prediction_id,
  t.study_id,
  t.created_at AS review_created_at,
  t.decision_submitted_at,
  t.model_name,
  t.model_version,
  t.policy_version,
  t.predicted_priority,
  t.predicted_score,
  t.score_margin,
  t.study_type,
  t.patient_age_group,
  t.image_quality_score,
  t.decision_priority AS reviewed_priority,
  t.decision_finding_group,
  t.reviewer_rationale_code,
  t.second_review_required,
  CASE
    WHEN t.status = 'adjudicated' THEN 'final_adjudicated'
    WHEN t.second_review_required = false AND t.status = 'submitted' THEN 'single_reviewer_final'
    ELSE 'hold_for_review'
  END AS label_status,
  t.audit_packet_uri
FROM mlops.cxr_review_tasks t
WHERE t.decision_submitted_at >= TIMESTAMP '2026-07-01 00:00:00 UTC'
  AND t.decision_submitted_at < TIMESTAMP '2026-08-01 00:00:00 UTC'
  AND t.status IN ('submitted', 'adjudicated');
```

The `label_status` field is important. Training can use `final_adjudicated` and `single_reviewer_final` according to policy. It should hold back labels that still need second review. Monitoring can still count holdback cases as operational signals, because a surge in second-review tasks may reveal a model or policy issue.

A feedback export should write a manifest:

```yaml
feedback_manifest:
  dataset: ml_training.cxr_review_feedback_2026_07
  source_tables:
    - mlops.cxr_prediction_log
    - mlops.cxr_review_tasks
    - mlops.cxr_review_events
  policy_version: "2026-07-05"
  included_statuses:
    - submitted
    - adjudicated
  training_allowed_label_statuses:
    - single_reviewer_final
    - final_adjudicated
  excluded:
    - hold_for_review
    - insufficient_image_quality_pending_adjudication
  owner: cxr-mlops
  reviewer_owner: radiology-review-leads
```

This manifest gives the next training job a clean contract. It also helps an auditor or incident responder understand which review labels entered the model.

## Practical Checks, Mistakes, And Interview Understanding
<!-- section-summary: A strong human review workflow has clear routing, reviewer guidance, quality metrics, audit logs, and feedback exports. -->

Before launching a human review workflow, ClearScan checks the whole path:

```yaml
human_review_launch_checks:
  routing:
    - review_policy_has_named_owner
    - critical_and_uncertain_triggers_tested_on_recent_predictions
    - queue_capacity_and_due_times_approved
  reviewer_experience:
    - label_choices_match_review_guidelines
    - model_output_shown_as_context
    - escalation_button_available
  audit:
    - every_status_change_writes_review_event
    - policy_version_saved_on_task_and_event
    - audit_packet_uri_created_for_submitted_tasks
  feedback:
    - label_status_present
    - second_review_holdbacks_excluded_from_training
    - segment_coverage_report_reviewed
```

Common mistakes are easy to name. Some teams add a review button and skip queue ownership, so urgent cases wait too long. Some teams record only the final label and lose the reviewer, timestamp, rationale, and policy version. Some teams route every uncertain case to people and overload the queue. Some teams train on review labels before adjudication finishes.

In an interview, explain human review as a controlled feedback workflow. You route selected predictions into queues, give reviewers clear context and label choices, track every state change, escalate high-risk or ambiguous cases, measure review quality, and export final labels with source and status. The model output is one piece of evidence, and the reviewer decision creates a labeled record that monitoring and retraining can use.

The best answer also mentions capacity. Human review is a limited resource. A good MLOps system uses risk, uncertainty, sampling, and quality metrics so people spend time on the cases where their expertise protects users and improves the model.

## References

- [Label Studio: Labeling configuration](https://labelstud.io/guide/setup)
- [Label Studio: Import pre-annotated data](https://labelstud.io/guide/predictions)
- [Label Studio: Machine learning integration](https://labelstud.io/guide/ml)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/)
