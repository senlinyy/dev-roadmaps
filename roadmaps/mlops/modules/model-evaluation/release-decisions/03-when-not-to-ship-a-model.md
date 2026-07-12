---
title: "When Not to Ship"
description: "Learn how to stop a model release when evidence shows product, segment, approval, or rollback risk."
overview: "A no-ship decision is a controlled release decision backed by evidence. This tutorial follows a patient-message triage model through red flags, segment risk, rollback readiness, approval owners, and an operational checklist."
tags: ["MLOps", "production", "approval"]
order: 3
id: "article-mlops-model-evaluation-when-not-to-ship-a-model"
---

## Table of Contents

1. [The Short Answer](#the-short-answer)
2. [The Scenario](#the-scenario)
3. [The No-Ship Decision Packet](#the-no-ship-decision-packet)
4. [Red Flags That Stop the Release](#red-flags-that-stop-the-release)
5. [Segment Risk](#segment-risk)
6. [Rollback Readiness](#rollback-readiness)
7. [Approval Owners](#approval-owners)
8. [Hands-On Evidence](#hands-on-evidence)
9. [Operational Checklist](#operational-checklist)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

This article uses one running example from start to finish. You will see the candidate model, the evidence packet, the red flags, the segment review, the rollback gate, the approval owners, and the final checklist. The goal is simple: when a release should pause, the team can explain the pause with facts instead of guesswork.

## The Short Answer
<!-- section-summary: A model should stay out of production when the release evidence shows unacceptable user harm, weak segment performance, missing operational controls, or unclear ownership. -->

You should **not ship a model** when the team cannot show that it is ready for the specific production job it will perform. A model can have a strong overall score and still create harm for a small group of users, fail under real traffic, lack a tested rollback path, or sit in a registry with no clear owner. The release decision has to cover the product risk, the technical evidence, and the operating plan.

A **no-ship decision** is a normal production decision. It says the candidate model stays in evaluation, shadow mode, or offline testing until the team closes specific gaps. In a healthy MLOps process, "no ship" has a packet, owners, dates, and retest criteria. It protects users and also protects the team from turning a weak release into an incident.

Think back to the previous release-decision articles. You already saw the difference between a candidate model and a production model, and you saw how approval gates turn evaluation into a controlled handoff. This article takes the next step. It shows what happens when the gate says no and how the team writes that decision so everyone understands the reason.

The practical rule is direct: a model should stay out of production when the release evidence fails one of the gates the team agreed to before deployment. The most common gates are minimum performance, safe segment behavior, data and feature readiness, rollback readiness, monitoring readiness, approval coverage, and incident ownership. Those gates give the team a release standard before launch pressure arrives.

## The Scenario
<!-- section-summary: The running example follows a patient-message triage model where false negatives can delay urgent review, so the release gate cares about recall, segments, monitoring, and rollback. -->

CareBridge Health runs a patient portal for small clinics. Patients send messages such as "I need a medication refill," "My appointment time changed," or "I have chest pain after taking a new medicine." Nurses review the inbox and escalate urgent messages first. The product team wants a model that scores each incoming message for urgency, so the portal can move likely urgent messages to the top of the nurse queue.

The existing production system is a rules engine called `rules-v7`. It catches obvious phrases and routes them to the urgent queue. It misses some subtle messages, and it creates a lot of extra nurse review work, yet the team knows how it behaves. The candidate model is `carebridge-urgent-message-v14`, a binary classifier that outputs a probability from 0 to 1. Higher scores mean the message should receive urgent review.

For a beginner, a **binary classifier** is a model that chooses between two labels. In this scenario, the labels are `urgent` and `routine`. The release threshold turns the probability into an action. For example, the team may send any message with a score of `0.62` or higher to the urgent queue.

The key risk is a **false negative**. That happens when the model predicts routine for a message that truly needed urgent review. A false positive also matters because nurses have limited time, yet false negatives carry the main harm in this product. The release gate therefore gives extra weight to urgent recall and segment recall.

Here is the evaluation structure the team agrees to before reviewing the candidate. The table gives each reviewer the same starting point before the model team opens the deeper artifacts.

| Review area | What it answers | CareBridge gate |
|---|---|---|
| Overall metrics | Does the candidate beat the current system for the intended task? | Urgent recall at least `0.92`, average precision at least `0.84` |
| Segment metrics | Does the model work for important user groups and contexts? | No monitored segment below `0.88` urgent recall |
| Data readiness | Did the evaluation data match the planned production traffic? | Last 90 days, delayed labels joined, no leakage fields |
| Operational readiness | Can the team monitor, pause, and roll back the release? | Prediction logs, alerts, rollback runbook, owner coverage |
| Governance approval | Did the right people accept the remaining risk? | Product, clinical operations, ML owner, support, privacy, SRE |

Those rows make the rest of the article concrete. The team is not asking whether the model seems interesting. They are asking whether `v14` can safely replace or assist `rules-v7` for this portal workflow.

## The No-Ship Decision Packet
<!-- section-summary: A no-ship packet records the model version, intended release, failed gates, user impact, owners, next actions, and retest criteria. -->

A **decision packet** is the release evidence in one place. It gives reviewers enough context to understand the candidate model, the intended deployment, the failed gate, and the next action. In real teams, the packet may live as a pull request comment, an MLflow registered model description, a governance ticket, a model card section, or a release-review document.

The packet matters because a no-ship decision can otherwise sound vague. One person says the model has "risk." Another says the score "looks fine." A packet forces the team to name the exact model version, the exact traffic path, the exact failed checks, and the owner for each follow-up. It also gives future reviewers a clean audit trail when the model returns for approval.

CareBridge writes the packet in a small YAML file attached to the release ticket. The same fields also get copied into MLflow model-version tags, so the registry and the ticket agree. This keeps the release decision close to the deploy metadata people will inspect later.

```yaml
decision_id: release-review-2026-07-05-carebridge-v14
model_name: carebridge_urgent_message
model_version: 14
candidate_alias: candidate
current_production_alias: champion
intended_release: canary_5_percent_patient_portal
decision: no_ship
decision_date: 2026-07-05

failed_gates:
  - gate: segment_recall
    finding: Spanish-language urgent recall was 0.74 against a minimum of 0.88.
    user_impact: Urgent messages from Spanish-language patients could wait too long for nurse review.
    owner: clinical-ml-lead
    retest_required: Retrain with reviewed Spanish-language labels and rerun the segment report.
  - gate: rollback_readiness
    finding: The feature flag rollback test failed in staging during traffic replay.
    user_impact: The team could struggle to return all traffic to rules-v7 during an incident.
    owner: sre-oncall-lead
    retest_required: Pass staging rollback drill with prediction logging enabled.
  - gate: monitoring_readiness
    finding: Prediction logs missed model_version for 18 percent of replayed requests.
    user_impact: Incident review could lose the link between a prediction and the model that served it.
    owner: platform-engineering
    retest_required: Log completeness above 99.5 percent for 24 hours of shadow traffic.

approval_status:
  product_owner: blocked
  clinical_operations: blocked
  ml_engineering: blocked
  sre: blocked
  privacy: pending_no_user_impact_change
```

![CareBridge no-ship packet for model v14 with Spanish recall, rollback drill, logging, owners, retest, and shadow-only status](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/carebridge-no-ship-packet.png)

*The no-ship packet keeps the failed gates, owners, and retest requirements visible beside the candidate model version.*

The packet uses plain fields because release decisions often cross team boundaries. Product, clinical operations, SRE, privacy, and support can all read it without knowing the training code. The model team still keeps the deeper artifacts nearby: evaluation notebooks, MLflow run IDs, data snapshots, registry version links, and rollback logs.

The decision field says `no_ship`, rather than a softer phrase like "needs work." That clarity helps automation. CI/CD can block a deployment job when the decision is `no_ship`. A registry webhook can prevent the `champion` alias from moving. A release manager can see that the candidate has no approval path until owners close the failed gates.

## Red Flags That Stop the Release
<!-- section-summary: Red flags give the team concrete stop signs such as weak recall, data leakage, missing logs, untested rollback, and unresolved owner approval. -->

A **red flag** is evidence that the model should pause before production traffic. Red flags need clear definitions because teams can talk past each other during release pressure. A data scientist may focus on average precision. A nurse operations lead may focus on missed urgent messages. An SRE may focus on rollback. The no-ship list gives everyone the same stop signs.

CareBridge keeps a release red-flag table in the model-card template. Each row has a technical signal, a product meaning, and a required response. That last column matters. A red flag should trigger an action, not a long debate with no owner.

| Red flag | Product meaning | Required response |
|---|---|---|
| Overall urgent recall below the minimum | Too many urgent messages may stay in the routine queue | Block release and tune threshold or retrain |
| Any protected or operational segment below the minimum | A specific user group or workflow may receive worse service | Block release and investigate data, labels, threshold, or product fallback |
| Evaluation data contains leakage fields | Offline score may overstate real production behavior | Rebuild evaluation set and rerun all metrics |
| Label delay ignored | The model learned from outcomes unavailable at prediction time | Recreate point-in-time labels and rerun evaluation |
| Prediction logs miss request ID, model version, or score | Incident review cannot reconstruct what happened | Block release until logging completeness passes |
| Monitoring alerts have no owner | Drift or harm signal can sit unnoticed | Assign owner, severity, dashboard, and escalation path |
| Rollback path untested | Incident response may take too long | Run rollback drill and attach evidence |
| Approval owner absent | Residual risk has no accountable decision maker | Pause release review until owner signs or delegates |

Notice that the table mixes model quality and operations. That is intentional. A model release is a production change. The team has to ask whether the candidate predicts well, whether the data proves it, whether the system can observe it, and whether humans know what to do when it fails.

For the `v14` candidate, the largest red flags are segment recall, rollback readiness, and logging completeness. The model has a better average precision score than `rules-v7`, so one dashboard looks exciting. The release gate still blocks it because the patient impact concentrates in one language segment and the rollback drill failed.

## Segment Risk
<!-- section-summary: Segment risk asks whether the model hides weak behavior inside a strong overall score, especially across user groups, channels, clinics, and message types. -->

**Segment risk** means the model performs acceptably on the average user while performing poorly for a specific group, channel, location, device, condition, or workflow. Beginners often meet this problem after celebrating a good overall metric. The overall metric blends everyone together, so a large low-risk group can hide a small high-risk group.

In the CareBridge example, the overall urgent recall for `v14` is `0.91`. That is close to the `0.92` gate, and the average precision is `0.86`, which clears the `0.84` gate. If the team only reads those two numbers, the candidate seems close. Segment review changes the decision.

| Segment | Urgent examples | Urgent recall | Minimum | Decision |
|---|---:|---:|---:|---|
| All messages | 18,420 | 0.91 | 0.92 | Fail |
| English messages | 13,910 | 0.94 | 0.88 | Pass |
| Spanish messages | 2,180 | 0.74 | 0.88 | Fail |
| Mobile app | 10,640 | 0.90 | 0.88 | Pass |
| Web portal | 7,780 | 0.92 | 0.88 | Pass |
| Rural clinics | 1,320 | 0.78 | 0.88 | Fail |
| Cardiology routing topic | 930 | 0.76 | 0.90 | Fail |

![CareBridge segment risk chart showing overall recall, gate threshold, and blocked Spanish, rural clinic, and cardiology segments](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/carebridge-segment-risk.png)

*The segment view shows why the release pauses even when the overall score looks close to the gate.*

The segment table shows the no-ship case. Spanish-language messages, rural clinics, and cardiology routing topics miss the minimum. Each weak area maps to a user impact. Spanish-language patients may write symptoms differently from the training examples. Rural clinics may have different message templates. Cardiology routing topics may include subtle phrases that the model under-scores.

The team also checks segment size and label quality. A tiny segment with five examples needs careful review because one label can swing the metric. A segment with thousands of examples and a clear miss needs immediate action. Here, the Spanish-language segment has enough urgent examples to treat the miss as real, so the release stays blocked.

A useful segment review includes at least four pieces of evidence. Each item turns a broad concern into something a reviewer can inspect.

- **Metric by segment**, such as recall, precision, average precision, calibration error, and support count.
- **Threshold behavior**, because one global threshold may hurt a segment even when ranking quality is acceptable.
- **Error examples**, especially false negatives reviewed by someone who understands the workflow.
- **Product fallback**, such as routing low-confidence messages to human review rather than allowing automatic routine handling.

CareBridge decides against a quick threshold-only fix. Lowering the global threshold improves Spanish-language recall, yet it floods nurses with too many false positives from other segments. The follow-up plan adds reviewed Spanish-language examples, audits translation and template features, and tests either a segment-aware threshold or a safer fallback for low-confidence messages.

## Rollback Readiness
<!-- section-summary: Rollback readiness proves the team can move traffic away from the candidate, verify the old path, and preserve evidence during an incident. -->

**Rollback readiness** means the team can return production traffic to the previous safe path quickly and verify that the return worked. In model releases, rollback often touches more than a model file. It can include a registry alias, a feature flag, a model-serving deployment, a routing rule, a cache, a queue, and prediction logging.

CareBridge plans a 5 percent canary. A **canary** sends a small slice of real traffic to the candidate while most users stay on the current path. The canary only makes sense if the team can stop it fast. If the model sends urgent messages to the wrong queue and the rollback takes two hours, the small canary can still create a serious incident.

The team writes the rollback plan as an operational table. The table keeps the drill concrete because every step has an owner and a proof point.

| Step | Owner | Evidence required |
|---|---|---|
| Freeze the canary flag at 0 percent | SRE on call | Feature flag audit event with timestamp |
| Point serving traffic to `models:/carebridge_urgent_message@champion` | ML platform | Registry alias check and serving config diff |
| Confirm `rules-v7` handles new requests | Backend owner | Request logs show `decision_source=rules-v7` |
| Preserve candidate prediction logs | Data platform | Log export path and retention confirmation |
| Notify clinical operations and support | Incident commander | Message in incident channel and support macro |
| Review delayed labels for impacted traffic | Clinical ML lead | Incident follow-up query and sample review |

Two details make this more than a checkbox. First, the plan names the exact alias the service should use. MLflow Model Registry supports registered models, model versions, aliases, tags, descriptions, and lineage, so a team can point a serving system at a mutable alias such as `champion` while keeping the immutable version history. The rollback plan should say which alias or version the serving system reads.

Second, the plan protects evidence. During an incident, the team needs request IDs, model version, input features, score, threshold, decision, and outcome labels when they arrive. Rolling back should stop the bad path, and it should preserve the evidence needed to understand impact. Deleting logs during a rollback trades one problem for another.

CareBridge fails the staging rollback drill. The canary flag turns off, yet the replayed traffic still hits the candidate model for nine minutes because the model-serving cache keeps the old route. The no-ship decision names this directly. The SRE owner has to update the serving cache invalidation step and rerun the drill before the candidate can return to release review.

## Approval Owners
<!-- section-summary: Approval owners connect each release risk to a person or role that can accept, reject, or delegate the decision. -->

**Approval owners** are the people or roles accountable for release risk. A model release affects product behavior, user trust, operations, privacy, and support. One ML engineer cannot responsibly approve all of that alone. The owner list tells the team who must review which part of the packet.

CareBridge uses owners because each team sees a different failure mode. Product owns the user experience and launch scope. Clinical operations owns the nurse workflow and urgency policy. ML engineering owns model evidence and retraining. SRE owns runtime safety, rollback, and alerts. Privacy owns logging fields and data retention. Support owns customer communication and escalation scripts.

| Owner | Reviews | Can block for |
|---|---|---|
| Product owner | Release scope, user-facing behavior, success criteria | Unclear product impact or launch scope |
| Clinical operations owner | Urgency policy, false negative review, human fallback | Unsafe routing or weak clinical workflow evidence |
| ML engineering owner | Evaluation data, metrics, model version, error analysis | Failed model gate, leakage, weak segment evidence |
| SRE owner | Canary plan, rollback drill, alerts, incident runbook | Missing operational control or failed rollback |
| Privacy owner | Logged fields, retention, access, data minimization | Excessive logging or unclear retention |
| Support owner | Support macro, escalation path, incident messaging | Team cannot handle user reports |

This owner map also helps during disagreement. Suppose ML engineering argues that retraining will likely fix Spanish-language recall in two days. Clinical operations still blocks the release today because patient messages would receive live routing before the fix exists. The owner map gives clinical operations that authority. The model can return after the evidence changes.

NIST AI RMF uses the functions Govern, Map, Measure, and Manage for AI risk work, and its Manage function includes deciding whether an AI system should proceed, assigning responsibilities for deactivation, and planning response and recovery. CareBridge treats the framework as guidance for the release conversation. The team uses it as a reminder that release approval covers context, measurement, risk treatment, and owner accountability.

## Hands-On Evidence
<!-- section-summary: Practical no-ship evidence includes metric code, segment reports, registry tags, signatures, input examples, and SQL checks that reviewers can reproduce. -->

A no-ship decision should have evidence that another engineer can rerun. The exact tooling varies by team, yet the shape is common: metrics from a held-out dataset, segment tables, error samples, registry metadata, prediction-log checks, and rollback drill logs. CareBridge uses scikit-learn for metric calculations, MLflow for experiment and model registry evidence, and SQL for warehouse checks.

Here is a small Python example that computes overall and segment metrics. The important beginner detail is that threshold metrics and ranking metrics answer different questions. Recall at the release threshold tells the team how many urgent messages the product catches. Average precision uses scores across thresholds and helps review ranking quality for an imbalanced problem.

```python
import mlflow
import mlflow.sklearn
import pandas as pd

from mlflow.models import infer_signature
from sklearn.metrics import average_precision_score, classification_report, recall_score

threshold = 0.62

eval_df = pd.read_parquet("s3://carebridge-eval/urgent-message/2026-07-05/eval.parquet")
X_valid = eval_df[["message_length", "language", "clinic_region", "topic_score", "hour_of_day"]]
y_valid = eval_df["is_urgent"]

scores = model.predict_proba(X_valid)[:, 1]
predictions = (scores >= threshold).astype(int)

overall = {
    "urgent_recall": recall_score(y_valid, predictions, pos_label=1),
    "average_precision": average_precision_score(y_valid, scores),
}

segment_rows = []
for language, segment_df in eval_df.assign(score=scores, prediction=predictions).groupby("language"):
    segment_rows.append(
        {
            "segment": f"language={language}",
            "urgent_examples": int(segment_df["is_urgent"].sum()),
            "urgent_recall": recall_score(
                segment_df["is_urgent"],
                segment_df["prediction"],
                pos_label=1,
            ),
            "average_precision": average_precision_score(
                segment_df["is_urgent"],
                segment_df["score"],
            ),
        }
    )

segment_report = pd.DataFrame(segment_rows).sort_values("urgent_recall")
print(classification_report(y_valid, predictions, target_names=["routine", "urgent"]))
print(segment_report)

with mlflow.start_run(run_name="carebridge-urgent-message-v14-release-review"):
    signature = infer_signature(X_valid.head(20), scores[:20])
    model_info = mlflow.sklearn.log_model(
        sk_model=model,
        name="urgent_message_triage",
        signature=signature,
        input_example=X_valid.head(3),
        registered_model_name="carebridge_urgent_message",
    )
    mlflow.log_metrics(overall)
    mlflow.log_table(segment_report, artifact_file="segment_report.json")
    mlflow.set_tags(
        {
            "release_decision": "no_ship",
            "failed_gate": "segment_recall",
            "candidate_review": "release-review-2026-07-05-carebridge-v14",
            "serving_threshold": str(threshold),
        }
    )
```

This code uses `predict_proba` because probability scores matter for average precision and threshold review. It logs a model with `name=`, a signature, and an input example so reviewers can inspect the expected request shape. The registered model name links the run to the model registry, and the tags make the decision visible without opening the notebook.

The classification report gives precision, recall, F1 score, and support for each class. The segment report adds the release-specific question: who receives weak behavior? That is where the no-ship decision comes from.

The warehouse check covers operational evidence. CareBridge wants prediction logs to include the request ID, model version, score, threshold, decision, and source. Missing model versions block the release because incident review needs that link.

```sql
SELECT
  DATE(prediction_timestamp) AS prediction_date,
  COUNT(*) AS total_predictions,
  COUNTIF(model_version IS NULL) AS missing_model_version,
  SAFE_DIVIDE(COUNTIF(model_version IS NULL), COUNT(*)) AS missing_model_version_rate
FROM mlops_prediction_logs.patient_message_triage
WHERE prediction_timestamp >= TIMESTAMP '2026-07-04 00:00:00 UTC'
  AND prediction_timestamp < TIMESTAMP '2026-07-05 00:00:00 UTC'
  AND release_review_id = 'release-review-2026-07-05-carebridge-v14'
GROUP BY prediction_date;
```

The query is small, yet it answers a serious release question. If the missing model-version rate is high, the team cannot reliably connect a decision to the model that produced it. CareBridge sets the log completeness requirement at 99.5 percent for shadow traffic before canary approval.

## Operational Checklist
<!-- section-summary: The operational checklist turns the no-ship lesson into a repeatable review that teams can run before every model deployment. -->

An **operational checklist** turns the release standard into repeatable work. The checklist should fit on one page, and each item should produce evidence. CareBridge reviews this list before any candidate can move from evaluation into canary.

| Check | Evidence | Ship gate |
|---|---|---|
| Candidate version identified | Registry model name, immutable version, run ID, commit SHA | Required |
| Production comparison present | Current `champion` metrics and candidate metrics on same evaluation set | Required |
| Segment report reviewed | Segment table with support counts, thresholds, false negatives | Required |
| Error samples reviewed | Sampled false negatives and false positives with domain owner notes | Required |
| Data leakage scan complete | Feature list and point-in-time join review | Required |
| Input contract stored | MLflow signature and input example | Required |
| Prediction logs complete | Request ID, model version, score, threshold, decision, source | Required |
| Monitoring alerts owned | Alert names, thresholds, severity, owner, escalation channel | Required |
| Rollback drill passed | Staging or replay drill with timestamp and evidence | Required |
| Support path ready | Support macro, escalation owner, user-report triage path | Required |
| Approval owners signed | Product, operations, ML, SRE, privacy, support | Required |
| Retest plan written after a block | Failed gate, owner, action, retest data, due date | Required for no-ship |

The checklist helps beginners because it separates three ideas that often blur together. **Evaluation** asks whether the model predicts well on the right data. **Release readiness** asks whether the serving system can run, observe, and roll back the model. **Approval** asks whether accountable owners accept the remaining risk.

For `v14`, the checklist result is clear. Candidate identity passes. Production comparison passes for average precision and fails for urgent recall. Segment report fails. Rollback drill fails. Prediction logging fails. Approval owners block. The final decision is no ship, with three owners and three retest criteria.

The team also writes what would change the decision. That is important for morale and execution. The no-ship packet should never leave the model team guessing. For CareBridge, the candidate can return when Spanish-language urgent recall reaches at least `0.88`, rural-clinic recall reaches at least `0.88`, cardiology topic recall reaches at least `0.90`, logging completeness reaches 99.5 percent in shadow traffic, and the rollback drill passes with cache invalidation included.

![CareBridge no-ship workflow from failed gate to user impact, owner assignment, retest rule, and return to review](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/carebridge-no-ship-workflow.png)

*The workflow keeps the no-ship path actionable: find the failed gate, name the user impact, assign the owner, write the retest rule, and return to review when evidence changes.*

## Putting It Together
<!-- section-summary: A strong no-ship process protects users by connecting model evidence, segment risk, rollback proof, and accountable approval into one repeatable release decision. -->

When a model should stay out of production, the team needs a clear decision rather than a nervous conversation. The decision should say which model version paused, which release path paused, which gates failed, which users could receive harm, who owns the fix, and what evidence will reopen the review.

The CareBridge example shows the full path. `carebridge-urgent-message-v14` has a promising average precision score, yet the release evidence finds weak recall for Spanish-language messages, rural clinics, and cardiology routing topics. The serving rollback drill also fails, and prediction logs miss model versions. Those are real stop signs because they affect users, incident response, and accountability.

The no-ship packet keeps the release healthy. It records the model version, failed gates, owners, retest criteria, and approval status. Segment risk makes the user impact visible. Rollback readiness proves the team can protect production traffic. Approval owners make the decision accountable across product, operations, ML, SRE, privacy, and support.

That is the practical habit to carry forward. A good model release process can say yes with evidence, and it can say no with the same level of evidence. The no-ship path belongs inside production engineering and gives the model team a clean route to improve.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) for registered models, versions, aliases, tags, descriptions, lineage, and rollback-friendly model references.
- [MLflow Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/) for classic ML evaluation with metrics, visualizations, and `mlflow.models.evaluate`.
- [MLflow model signatures and input examples](https://mlflow.org/docs/latest/ml/model/signatures/) for storing request and response shape evidence with model artifacts.
- [MLflow scikit-learn API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html) for current `log_model` parameters such as `name`, `signature`, `input_example`, and registered model support.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) and [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) for governance, risk measurement, risk management, deployment decisions, deactivation, response, and recovery concepts.
- [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/) for voluntary suggested actions aligned to Govern, Map, Measure, and Manage.
- [scikit-learn model evaluation guide](https://scikit-learn.org/stable/modules/model_evaluation.html) for classification metrics, probability-score evaluation, ROC AUC, log loss, and Brier score context.
- [scikit-learn classification_report](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.classification_report.html) for precision, recall, F1 score, and support by class.
- [scikit-learn average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) for average precision on ranked classifier scores.
