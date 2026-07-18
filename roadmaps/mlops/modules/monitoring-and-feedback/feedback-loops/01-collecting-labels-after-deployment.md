---
title: "Production Labels"
description: "Define outcomes, preserve label provenance and maturity, join them to prediction-time identity, and control bias before monitoring or training use."
overview: "Production labels are observations about what happened after a model decision. This article develops the label lifecycle from outcome definition through provenance, delay, correction, joins, quality, bias, and eligibility."
tags: ["MLOps", "production", "feedback"]
order: 1
id: "article-mlops-monitoring-and-feedback-collecting-labels-after-deployment"
---

## A Production Label Is A Governed Outcome
<!-- section-summary: A production label records an outcome under a defined source, time, policy, and authority. -->

A **production label** is an observation collected after a live prediction that can be used to judge what happened. A fraud prediction may later connect to a chargeback. A support route may connect to the team that resolved the case. A delivery estimate may connect to actual arrival time.

The later event is not automatically a trustworthy training label. It may be delayed, partial, corrected, influenced by the model's own decision, or produced under a changed policy. A reliable label lifecycle has eight parts:

1. Define the outcome and when it can be known.
2. Identify sources, provenance, authority, and policy version.
3. Preserve delayed, partial, and **censored** events—cases whose observation period ended before the outcome could be determined—alongside corrections and conflicts.
4. Join the outcome to the exact prediction-time identity.
5. Measure coverage, freshness, agreement, and quality.
6. Account for selection bias created by routing and review.
7. Assign an eligible use: monitoring, evaluation, training, or audit.
8. Version the resulting label snapshot and retain lineage.

This framework prevents feedback pipelines from turning every click or workflow event into unexamined ground truth.

## Outcome Definition Comes Before Storage
<!-- section-summary: The label definition states what event represents truth, under which horizon and policy. -->

A support-ticket model may predict the correct destination queue. Possible later signals include an agent moving the ticket, the final resolution team, a manager's audit, a reopen event, and customer satisfaction. Each measures a different property.

The team should write the target definition in plain language and code. “Correct queue” might mean the specialized team that resolved the ticket under routing policy version 12, after transfers caused only by workload balancing are excluded. The definition includes the prediction point, observation horizon, positive and negative outcomes, exclusions, and finalization rule.

Time is part of the label. A fraud case may remain unconfirmed for weeks. Churn may be defined over ninety days. A support ticket can reopen after closure. The label contract states when an example is mature enough for its intended use.

Different uses may need different outcomes. Fast agent corrections can support operational monitoring. Final adjudicated outcomes can support release evaluation. A financial loss amount may support cost-sensitive thresholding. Combining them into one column would erase important meaning.

## Provenance Records Who Said What And Why
<!-- section-summary: Label events preserve source, actor, policy, timestamps, confidence, and correction history. -->

Every label event should identify its source and creation process. A human review, automated **reconciliation** that matches records across independent systems, customer report, sensor reading, appeal result, and business transaction have different reliability and bias.

Useful provenance includes event ID, entity and prediction IDs, label value, source, event time, available time, actor type, policy or guideline version, confidence, rationale, and source record. Sensitive actor identity can be protected while retaining accountability.

The following example uses BigQuery types. PostgreSQL, a lakehouse table, or an event schema can preserve the same fields with its native types.

```sql
CREATE TABLE mlops.label_events (
  label_event_id STRING NOT NULL,
  prediction_id STRING,
  entity_id STRING NOT NULL,
  label_name STRING NOT NULL,
  label_value STRING NOT NULL,
  label_source STRING NOT NULL,
  event_time TIMESTAMP NOT NULL,
  available_time TIMESTAMP NOT NULL,
  policy_version STRING,
  actor_type STRING,
  confidence FLOAT64,
  rationale STRING,
  is_authoritative BOOL NOT NULL,
  supersedes_event_id STRING,
  source_uri STRING NOT NULL
);
```

Append-only events preserve corrections. If an appeal reverses a moderation decision, the new event supersedes the old one rather than overwriting history. Consumers can construct the current adjudicated view while audits can reconstruct what was known at each time.

Correction history and policy history solve different problems. A correction says that an earlier judgement about one case was replaced. A policy change says that the meaning or authority of a label changed for a class of cases. Re-running a dataset under a new policy must not silently mutate an old snapshot. It creates a new resolved view with a new policy version, cutoff, and lineage, even if most source events are unchanged.

Consider a support-routing label that once treated billing disputes as “general support” and later introduced a dedicated “billing escalation” class. An old agent choice may be faithful to the old policy but incompatible with the new taxonomy. The system can retain the original event, add a reviewed relabel event where allowed, and publish separate snapshots for the two interpretations. Overwriting the string would make the historical model appear to have been trained and evaluated on a class that did not yet exist.

This event model also makes disagreement observable. A high reversal rate after appeal may identify an unclear guideline, a difficult segment, or a reviewer-training problem. That is a property of the label-production system, not noise to erase before model training.

The view needs to resolve corrections at a declared cutoff. This query keeps the latest eligible event for each prediction and label definition while preserving the source row:

```sql
WITH eligible AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (
      PARTITION BY prediction_id, label_name
      ORDER BY available_time DESC, label_event_id DESC
    ) AS recency
  FROM mlops.label_events AS e
  WHERE available_time <= TIMESTAMP '2026-07-14 00:00:00+00:00'
    AND policy_version = 'support-routing-v12'
    AND is_authoritative = TRUE
), current_labels AS (
  SELECT * FROM eligible WHERE recency = 1
)
SELECT
  prediction_id,
  label_value,
  label_source,
  label_event_id,
  available_time,
  policy_version
FROM current_labels;
```

The cutoff makes the snapshot repeatable. The authoritative flag is assigned by the versioned label-source policy, so a later provisional agent action cannot replace an adjudicated result merely because it arrived later. Ordering by both time and event ID makes output deterministic, although validation must still reject ambiguous duplicate authority. The policy filter prevents a new meaning of “correct queue” from silently rewriting an older evaluation.

Test the view with three events for one prediction: an agent correction, a later adjudication, and an appeal after the cutoff. The snapshot should choose the adjudication. Moving the cutoff beyond the appeal should create a new snapshot whose lineage names the new event. If two unsuperseded authoritative events share the same availability time, validation should fail and send the conflict to adjudication rather than choose by an arbitrary identifier.

## Delay, Maturity, And Censoring Change The Dataset
<!-- section-summary: Labels enter monitoring and training only after the relevant observation window has had time to complete. -->

A **maturity window** is the time allowed for an outcome to arrive or settle. Using recent rows before that window closes can create false negatives. Transactions without a chargeback after two days are not equivalent to transactions without a chargeback after sixty days.

An example is **right-censored** when the observation period ended before its outcome could be fully known. Censored examples may be excluded, analysed with survival methods, or used only for early signals. They should not silently receive the negative label.

Coverage needs a denominator by prediction cohort. A dashboard can show what fraction of predictions from each day have a mature label, the age distribution of pending labels, and coverage by important segment. Declining coverage may reflect a broken join, review backlog, or changed workflow rather than better model quality.

Some outcomes remain permanently unobserved. A blocked transaction never follows the same path as an approved one. A recommendation that was never shown cannot receive a click. The data collection process is part of the target and must appear in interpretation.

## Prediction Identity Makes The Join Reproducible
<!-- section-summary: Outcome joins connect labels to the model, policy, inputs, and decision that existed at prediction time. -->

The prediction event is the other half of the label system. It records a stable prediction ID, entity and request IDs, event time, concrete model and feature versions, score, threshold, action, policy version, route, and trace reference.

One entity can receive several predictions. Joining only by customer or ticket ID can attach a later outcome to the wrong model decision. The join rule should use prediction ID where possible and define the valid time relationship explicitly.

Prediction-time features should come from an immutable snapshot or **point-in-time reconstruction**, which recalculates the row using only facts available when the prediction occurred. Joining current profile data to an old label leaks information that was unavailable when the model acted. The training row must represent the decision-time world.

```sql
SELECT
  p.prediction_id,
  p.model_version,
  p.predicted_label,
  p.decision,
  l.label_value,
  l.label_source,
  l.policy_version
FROM mlops.predictions p
JOIN mlops.adjudicated_labels l
  ON l.prediction_id = p.prediction_id
WHERE l.available_time <= @dataset_cutoff
  AND l.is_mature = TRUE;
```

The dataset cutoff prevents future corrections from entering a historical snapshot unexpectedly. A later rebuild can use a newer cutoff and produce a new version.

The join job should publish coverage evidence beside its rows:

```json
{
  "snapshot_id": "support-labels-2026-07-14-v1",
  "prediction_cohort": "2026-06-01/2026-06-30",
  "dataset_cutoff": "2026-07-14T00:00:00Z",
  "eligible_predictions": 184200,
  "mature_labels": 171906,
  "join_coverage": 0.9333,
  "orphan_label_events": 17,
  "conflicting_authoritative_labels": 0
}
```

A lower join rate blocks training even when the joined rows themselves look valid, because missing outcomes may concentrate in one route or model version. The job compares coverage by source, language, route, and model. An orphan event triggers an identity investigation. A conflicting authoritative label blocks publication until the label policy resolves it.

## Conflicts Need Adjudication, Not Majority Guessing
<!-- section-summary: Conflicting labels reveal ambiguous policy, reviewer disagreement, or multi-stage outcomes that need an explicit resolution rule. -->

An agent may move a support ticket to Security, the final resolver may be Billing, and a lead reviewer may decide the correct initial route was Security. These events answer different questions. Selecting the most recent row or majority vote can erase the distinction.

The label policy ranks sources for a defined target or sends conflicts to adjudication. An adjudicator sees the original prediction-time evidence, guidelines, earlier decisions, and reason for disagreement. The final event records the decision and guideline version.

Agreement metrics reveal label-process health. Cohen's kappa, Krippendorff's alpha, class-specific disagreement, and reviewer confusion matrices can support analysis when appropriate. Raw agreement can be misleading for imbalanced classes, so class prevalence and sampling design matter.

Guidelines should include difficult examples and a correction process. When policy changes, teams decide whether old examples can be relabelled, need a policy-version feature, or should remain in separate eras.

## Model Routing Creates Selection Bias
<!-- section-summary: The deployed model and product policy determine which examples receive labels, so observed feedback is not a neutral traffic sample. -->

A review queue contains examples selected by the current score and threshold. User reports occur more often for visible or severe problems. Appeals come only from people who know and use the appeal path. These labels are useful but selective.

Training only on reviewed cases can teach the next model to imitate the current routing boundary. Offline metrics on the same process can look strong while low-score false negatives remain invisible.

Random or stratified sampling provides labels outside the model-selected path. Teams can reserve review capacity across score bands, segments, and routes. Logging the sampling probability allows weighted estimates when the design supports them. Active learning can prioritize informative cases, while a random holdout remains necessary for unbiased monitoring.

Feedback loops can also alter the target. A model that blocks fraud prevents some fraud outcomes from occurring. A recommendation model changes what users see and click. Causal evaluation or experimentation may be needed for product impact; supervised labels alone cannot answer every counterfactual question.

## Label Quality Is Measured As A System
<!-- section-summary: Coverage, delay, consistency, validity, segment balance, and leakage checks determine whether labels support a use. -->

Quality monitoring includes label coverage by cohort and segment, time-to-label, source mix, correction rate, disagreement, class distribution, unknown or invalid values, duplicate events, policy-version mix, and join success.

Alerts should connect to likely owners. A sudden fall in join rate points to event identity or pipeline changes. Longer review delay points to queue capacity. A class shift aligned with new policy may be expected. A single reviewer producing an unusual class pattern may require calibration or audit.

Representative samples should be inspected regularly. Aggregate tests can miss a source whose rationale no longer matches the guideline or a timestamp whose time zone shifted.

Privacy and retention remain part of label quality. Raw user text or medical records should not be copied into a general training table merely because they help annotation. Store governed references and approved features, apply access controls, and honour deletion or correction requirements.

## Eligibility Separates Monitoring, Evaluation, And Training
<!-- section-summary: A label can be useful for one purpose and too weak, biased, or immature for another. -->

The curated label record should state its eligible uses. A quick agent correction may support early monitoring and review sampling. An adjudicated mature result may support release evaluation. Training may require stricter provenance, point-in-time features, policy compatibility, consent, and segment coverage.

This prevents one “gold label” view from hiding compromises. The evaluation set may preserve random sampling and stay separate from training. Incident examples may enter a regression set with higher weight for testing but not represent ordinary prevalence. Audit records may be retained without entering model development at all.

Every dataset snapshot records label-policy version, source rules, maturity cutoff, exclusions, sampling design, counts, segment distribution, and lineage to prediction events. Rebuilding under a changed rule creates a new snapshot.

Eligibility should be explicit per label event or resolved label. A provisional reviewer action might be allowed on an operations dashboard within minutes, rejected from release evaluation until adjudicated, and admitted to training only after its appeal window closes. The same value is not copied into three tables with three implied meanings; one governed history is resolved through three declared policies.

## Production Labels Carry The History Of The Product
<!-- section-summary: Trustworthy labels preserve how outcomes were observed, selected, corrected, and used. -->

Production labels are not a delayed answer key detached from the system. They carry the product's routing, policy, review capacity, user behaviour, and observation limits. Reliable collection keeps that history visible.

The lifecycle starts with a precise outcome, preserves provenance and time, joins to prediction-time identity, measures quality and selection, and grants only appropriate downstream uses. That gives monitoring, evaluation, and retraining evidence they can defend.

## References

- [Google Rules of ML: Feedback loops](https://developers.google.com/machine-learning/guides/rules-of-ml)
- [TensorFlow Data Validation](https://www.tensorflow.org/tfx/data_validation/get_started)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [scikit-learn Cohen's kappa](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html)
