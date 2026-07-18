---
title: "Retraining From Production Feedback"
description: "Explain how production feedback enters a governed training dataset, evaluated candidate, and controlled release."
overview: "Retraining from production feedback is a governed model-development cycle that controls selection bias, label maturity, dataset lineage, evaluation, release, and the next round of data collection."
tags: ["MLOps", "feedback", "retraining"]
order: 3
id: "article-mlops-monitoring-and-feedback-retraining-from-production-feedback"
---

## Feedback Does Not Train The Model By Itself
<!-- section-summary: Production feedback is useful only after it is matured, validated, versioned, and evaluated through a new training cycle. -->

**Retraining from production feedback** is the controlled process that turns selected production outcomes into a versioned dataset, trains a new candidate, compares it with the current model, and releases it through the normal safety path. The live model keeps its identity until a separately reviewed candidate earns traffic.

The cycle has connected control points:

| Control point | Why it exists | Failure without it |
|---|---|---|
| **Collection policy** | Records why each example received a label | The new model copies the old model's selection bias |
| **Label maturity and policy** | Waits for appeals and delayed outcomes, then applies one meaning | Temporary or contradictory decisions enter training |
| **Point-in-time dataset** | Reconstructs each historical row using only information available when its prediction occurred | Future data leaks into training or evaluation |
| **Trigger and hypothesis** | States why retraining may help | A scheduled job creates versions without a product question |
| **Reproducible training** | Pins data, code, configuration, environment, and lineage | A result cannot be replayed or investigated |
| **Comparative evaluation** | Tests the motivating problem and broad regressions | The candidate memorizes recent failures or shifts workload elsewhere |
| **Controlled release** | Measures live behaviour with rollback available | Offline improvement receives full product authority immediately |
| **Exploration and monitoring** | Keeps observing traffic outside model-selected queues | Each released model narrows the data available to its successor |

The cycle contains feedback in two senses. Outcomes inform the next candidate, and the deployed candidate changes which outcomes the system will collect next. Random audits, explicit collection routes, and policy-version records keep that second effect visible.

MarketSquare illustrates the framework with an abusive-listing classifier. High-risk listings go to moderators, some medium-risk listings enter audit samples, and low-risk listings may later receive user reports or appeals. A new counterfeit pattern gives the team a reason to open a retraining cycle; it does not give raw feedback automatic authority over the live model.

## The Old Model Shapes The Data You Collect
<!-- section-summary: Feedback is selective because the current model and product policy determine which examples people review or report. -->

MarketSquare has strong moderator labels for high-scoring listings because those listings are routinely reviewed. Low-scoring listings receive labels mainly when a user reports them or when the trust team samples them. The resulting dataset therefore contains many examples near the old model's idea of risk and relatively few ordinary low-score examples.

This is a form of **selection bias**: the collected examples are not a neutral sample of all marketplace traffic. Training only on reviewed items could teach the next model to imitate the previous model's routing mistakes. It could also inflate offline performance because the evaluation set would share the same collection process.

The feedback pipeline preserves how each label was obtained. A moderator pre-publication review, a user report later confirmed by a moderator, an appeal reversal, and a routine random audit are different sources. MarketSquare also stores the model version, score, routing rule, listing timestamp, review timestamp, policy version, and final adjudication.

Random review samples are especially valuable. They provide labels outside the model-selected queue and help estimate false negatives. The company cannot review everything, but it can reserve part of its review budget for an unbiased sample of low- and medium-score traffic.

Random sampling leaves some feedback effects in place. It still creates a comparison group that the current routing policy did not choose solely because of the score. The snapshot records each example's **selection probability** and collection route where known. Analysts can then weight estimates or at least report how much evidence came from model-routed review, user reports, and exploration. Dropping those fields turns a deliberate sampling design back into an unexplained mixture.

Some outcomes are fundamentally counterfactual. A removed listing cannot reveal what buyer reports it would have received if it remained visible. A model that prevents harm also prevents observation of the untreated outcome. Supervised retraining cannot reconstruct that missing world from labels alone. Product experiments, policy-safe exploration, causal methods, or carefully designed audits may be needed; when none is acceptable, the evaluation must state the blind spot.

This is why the feedback dataset should not optimize only for volume. Ten thousand labels selected by the old model can add less new information than a smaller, representative audit sample. Collection strategy is part of model development and needs its own budget, risk review, and monitoring.

## Wait For Labels To Mature
<!-- section-summary: A training cutoff allows delayed reviews, reports, and appeals to settle before examples are treated as final. -->

Not every label is final when it first appears. A moderator may remove a listing today, and an appeal may reverse that decision next week. A user report can be malicious or mistaken until it is investigated. MarketSquare defines a maturity window based on these operational delays.

For a July retraining run, the dataset ends several weeks before the training date. Examples after that cutoff remain available for monitoring but are not treated as final training labels. If the company changes its prohibited-items policy during the window, it records the policy boundary and either relabels affected examples or keeps the periods separate.

This prevents a common temporal error: using today's interpretation of an example to evaluate a prediction made before that information was available. Event timestamps, review timestamps, and label-finalization timestamps all remain distinct.

## Build A Dataset That Can Be Challenged
<!-- section-summary: The training snapshot records provenance, exclusions, label rules, and splits so reviewers can understand what the candidate learned from. -->

The pipeline joins listing features with matured feedback using the listing ID and event time. It removes duplicate review events, resolves appeals according to the current labeling policy, and excludes examples whose content was unavailable at prediction time. It does not silently replace missing values with current catalog data.

The dataset is saved under an immutable snapshot ID together with counts by label source, policy version, language, category, geography, and collection route. These summaries reveal whether one moderator, one campaign, or one newly introduced source dominates the run.

MarketSquare splits data by time. Older examples train the model, a later window tunes it, and the newest matured window tests it. Related listings from the same campaign or seller are grouped so near-duplicates do not leak across splits. The team also keeps a fixed regression set of important past incidents, including the counterfeit campaign that prompted this cycle.

Before training begins, validation checks that required fields exist, label rates are plausible, maturity rules were applied, group boundaries hold, and sensitive content follows retention policy. A failure stops the run. “More recent data” is not automatically “better training data.”

The snapshot manifest makes those claims testable:

```yaml
snapshot_id: abuse-feedback-2026-06-30
prediction_window: [2026-03-01, 2026-05-31]
label_available_cutoff: 2026-06-30T00:00:00Z
label_policy: trust-policy-17
rows: 523015
collection_routes:
  random_audit: {rows: 50000, sampling_probability: 0.02}
  model_review: {rows: 391204}
  user_report: {rows: 81811}
splits:
  train: {through: 2026-04-30, sellers: 184291}
  validation: {from: 2026-05-01, through: 2026-05-15, sellers: 41902}
  test: {from: 2026-05-16, through: 2026-05-31, sellers: 43881}
validation:
  immature_labels: 0
  seller_overlap_across_splits: 0
  unresolved_appeals: 0
  point_in_time_feature_violations: 0
```

The three mutually exclusive route counts sum to all 523,015 rows; a source-total assertion fails publication if they do not. The counts reveal selection, and the sampling probability enables weighted estimates from the random-audit route. Seller counts and the overlap check prove that related listings remain inside one split. The June 30 cutoff gives May 31 predictions a full thirty days to mature, and the zero-immature-label result proves that the builder applied that declared window.

Validation should fail on injected bad rows. Put one seller in train and test; the overlap count must rise and publication must stop. Add one feature timestamp later than the prediction; the point-in-time check must identify the listing ID. Add an appeal that arrived before the cutoff but leave the original decision active; the unresolved-appeal check must fail. These tests prove that the snapshot builder enforces the feedback policy.

## A Trigger Opens A Training Cycle
<!-- section-summary: Retraining starts for a declared reason, and that reason determines which evidence the new candidate must improve. -->

MarketSquare does not retrain merely because a calendar page turned. The trigger is a sustained rise in confirmed counterfeit misses, supported by enough matured examples and an incident review that suggests model improvement can help. Other triggers might include a policy change, segment regression, large traffic shift, or planned periodic refresh.

Triggers have different evidence requirements. A scheduled refresh controls staleness for systems with predictable seasonality, yet it can create unnecessary versions when nothing meaningful changed. A quality trigger responds to confirmed outcome regression, though delayed labels slow it down. A drift trigger provides earlier warning, while drift alone cannot show that retraining will improve the product. A policy trigger may require new labels and evaluation rules because the meaning of the task changed. The team records the trigger type and the evidence that supports opening the cycle.

Retraining also needs a stop condition. If the feedback snapshot lacks enough mature examples, if the incident points to a broken feature pipeline, or if the product can repair the issue with a deterministic rule, another training run may add cost without addressing the cause. The trigger opens investigation and candidate work; it never guarantees that a new model should be released.

The trigger is written into the run metadata. That gives the evaluation a concrete question: does the new candidate reduce counterfeit false negatives without creating unacceptable moderator load or damaging other abuse categories?

The training pipeline pins the code commit, container image, resolved configuration, feature definitions, and feedback snapshot. It writes the resulting model, metrics, and lineage to a new run. If a step is retried, it reads the same immutable inputs rather than querying a moving production table.

```yaml
run:
  reason: counterfeit_false_negative_regression
  code_commit: 8d4c1a2
data:
  feedback_snapshot: abuse-feedback-2026-06-30
  policy_version: trust-policy-17
model:
  family: lightgbm
  seed: 42
```

This small record does not replace the article's explanation or the dataset documentation. It shows how the declared reason and pinned inputs travel with the actual run.

## The Candidate Must Beat More Than The New Cases
<!-- section-summary: Evaluation checks the trigger problem, broad quality, segments, workload, calibration, and known incidents before registration. -->

The new model improves recall on the counterfeit incident set. That is encouraging but insufficient: a model can memorize one failure collection or increase recall by flagging almost everything.

MarketSquare compares the candidate with the production model on the same newest test window. It measures precision and recall by abuse type, language, category, label source, and collection route. It estimates the change in moderator queue volume at the proposed thresholds. It checks calibration so a risk score retains a useful relationship with observed outcomes. Confidence intervals help reviewers distinguish a meaningful improvement from sampling noise.

The fixed regression set contains past fraud campaigns, policy edge cases, appeal reversals, and ordinary legitimate listings. The candidate must retain performance on these examples. A separate sample of fresh, randomly reviewed traffic tests whether gains survive outside model-selected feedback.

Only after these checks does the registry receive a candidate version. The version links to the feedback snapshot, training run, evaluation report, code and image digests, limitations, and proposed rollout. Registration makes the candidate reviewable; it does not put it into production.

## Release Closes The Loop Carefully
<!-- section-summary: A canary release tests the candidate in the live workflow while preserving rollback and measuring how the new policy changes future feedback. -->

MarketSquare sends a small share of eligible traffic to the candidate. The canary monitors service health, score distribution, moderator queue size, review agreement, appeals, and confirmed abuse as labels mature. Traffic assignment and model version are recorded on every decision so outcomes can be compared correctly.

If queue load exceeds capacity or a protected segment regresses, the release system routes traffic back to the current model. The previous model, thresholds, and compatible feature path remain available throughout the canary. The candidate can be rejected without deleting its evidence.

The team also recognizes that releasing the new model changes the next feedback dataset. Different listings will be routed to moderators, and users may experience different enforcement. Random sampling continues so future training does not depend entirely on whichever model happens to be live.

Release telemetry records the model and routing policy together. If the candidate sends twice as many listings to review, a rise in confirmed abuse may reflect increased inspection rather than a more abusive population. The next training snapshot must preserve that policy boundary so it does not compare pre- and post-release labels as if collection were unchanged.

## A Feedback Loop Needs Friction
<!-- section-summary: Safe retraining preserves deliberate boundaries between evidence collection, label decisions, training, evaluation, and release. -->

MarketSquare's feedback loop is not instant, and that is a strength. Maturity windows allow appeals to settle. Dataset validation exposes selection bias and policy changes. A new version preserves reproducibility. Comparative evaluation tests both the motivating failure and the wider product. Canary release protects users from a candidate that looked good offline.

Production feedback is valuable because it contains the situations the real system encountered. It is also shaped by the system that collected it. A reliable retraining process keeps both truths visible instead of treating every click, report, or reviewer action as a clean instruction to the model.

## References

- [Google Rules of ML: Training-serving skew and feedback loops](https://developers.google.com/machine-learning/guides/rules-of-ml)
- [TensorFlow Data Validation](https://www.tensorflow.org/tfx/data_validation/get_started)
- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
