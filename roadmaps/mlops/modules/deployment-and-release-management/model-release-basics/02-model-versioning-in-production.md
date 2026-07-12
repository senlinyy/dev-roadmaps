---
title: "Model Versioning"
description: "Teach how production systems identify, approve, route, compare, and roll back model versions with registries, aliases, manifests, and serving labels."
overview: "Model versioning gives every releasable model a stable identity and a movable production pointer. This article follows a support ticket triage service through MLflow aliases, Databricks Unity Catalog model lifecycle ideas, SageMaker-style approval gates, release manifests, routing labels, and rollback."
tags: ["MLOps", "production", "release"]
order: 2
id: "article-mlops-deployment-and-release-management-model-versioning-in-production"
---

## Table of Contents

1. [Versioning Gives The Model A Production Name](#versioning-gives-the-model-a-production-name)
2. [Follow One Ticket Triage Service](#follow-one-ticket-triage-service)
3. [Separate Version, Alias, Image, And Config](#separate-version-alias-image-and-config)
4. [Use Registry Approval Before Promotion](#use-registry-approval-before-promotion)
5. [Route Requests With Version Labels](#route-requests-with-version-labels)
6. [Compare Versions With Release Evidence](#compare-versions-with-release-evidence)
7. [Rollback By Moving The Pointer](#rollback-by-moving-the-pointer)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Versioning Gives The Model A Production Name
<!-- section-summary: Model versioning gives each releasable model an immutable identity and gives production a controlled pointer to the approved version. -->

**Model versioning** is the practice of giving every releasable model a stable identity, then using controlled pointers to decide which version serves each environment or traffic group. A version says, "this exact model artifact came from this exact training evidence." A production pointer says, "this is the approved version callers should use right now."

The title answer is direct: model versioning helps production systems identify which model produced a prediction, route traffic to the intended model, compare candidates against a baseline, and roll back quickly when a release hurts users. Without versioning, a team may know that "the support model changed last week," yet they may struggle to prove which artifact, data snapshot, code commit, and serving image handled a customer ticket.

Versioning is more than a number in a file name. Real systems usually track a registered model version, a registry alias such as `champion`, a container image digest, a serving config, a feature schema, and release notes. These pieces work together so a model release can be reviewed, promoted, observed, and reversed.

## Follow One Ticket Triage Service
<!-- section-summary: The running scenario follows a support ticket model where version identity protects customer service routing. -->

Imagine **PineDesk**, a helpdesk platform used by small software companies. Customers send tickets about billing, outages, login problems, and product questions. A model called `ticket-triage` predicts the ticket category and urgency so the helpdesk can route the message to the right queue.

The current production version is `ticket-triage:v17`. It handles 80,000 tickets per day and feeds two callers:

| Caller | What it sends | What it needs back |
|---|---|---|
| Inbox API | ticket subject, body, account tier, language | category, urgency, confidence |
| Workforce planner | hourly ticket batch | category counts and urgent-ticket forecast |

The NLP team trained `ticket-triage:v18` after adding a new multilingual embedding feature. Offline metrics improved for Spanish and Portuguese tickets. The risk is practical: if the model sends urgent outage reports to the billing queue, customers wait too long and support managers lose trust in automation.

PineDesk needs versioning so every prediction log can answer four questions: which model version ran, which alias or environment selected it, which serving image loaded it, and which feature schema shaped the request.

## Separate Version, Alias, Image, And Config
<!-- section-summary: A reliable release record separates immutable model identity from movable aliases and runtime packaging. -->

Beginners often use one word, "version," for several different things. Production release work gets much clearer when you separate them.

| Name | PineDesk example | Changes how often | Purpose |
|---|---|---|---|
| Registered model version | `ticket-triage` version `18` | Never for that artifact | Identifies the trained model artifact and run evidence |
| Registry alias | `champion` points to version `17`, then `18` | Moves during promotion or rollback | Gives serving code a stable lookup name |
| Container image digest | `ghcr.io/pinedesk/triage-api@sha256:4c19...` | Changes when serving code changes | Identifies runtime code and dependencies |
| Feature schema version | `ticket_features_v6` | Changes when request fields change | Protects model input compatibility |
| Release manifest | `release-2026-07-04-v18.yaml` | One per release | Ties artifact, alias, image, schema, and owners together |

MLflow Model Registry supports registered models, model versions, and aliases. Databricks now treats Unity Catalog models as the modern governed model lifecycle surface, including permissions, lineage, audit, aliases, and deployment workflows. Managed cloud registries such as SageMaker Model Registry also track model package versions and approval status. The tool names vary, yet the useful pattern stays the same: immutable version for evidence, movable pointer for serving.

A PineDesk release manifest can look like this:

```yaml
release:
  service: ticket-triage-api
  model:
    registry: mlflow
    name: ticket-triage
    version: 18
    alias_after_approval: champion
    source_run_id: 7ff412be7b104d9aa2ad0fdc21e8a01c
  runtime:
    image: ghcr.io/pinedesk/triage-api@sha256:4c19b2...
    entrypoint: app.main:app
    feature_schema: ticket_features_v6
  environments:
    dev: models:/ticket-triage/18
    staging: models:/ticket-triage/18
    production: models:/ticket-triage@champion
  reviewers:
    ml_owner: nora@pinedesk.example
    support_owner: marcus@pinedesk.example
    platform_owner: release-platform@pinedesk.example
```

The production line uses the alias because serving code should not need a new image every time the approved model changes. Staging uses the explicit version because review should point at the exact candidate. Prediction logs should record both the alias requested and the resolved version, so an incident review can prove what happened.

![PineDesk version identity stack](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/version-identity-stack.png)
*Production versioning separates the immutable model version, movable alias, runtime image digest, and feature schema, then records them together in prediction logs.*

## Use Registry Approval Before Promotion
<!-- section-summary: Approval gates make the version move from candidate to production only after evidence and owners agree. -->

A **registry approval** is the point where a team says a model version is allowed to move toward a real environment. This is especially important in ML because a trained artifact may have strong metrics and still carry product, fairness, latency, or compatibility risk. Approval connects the model evidence to people who own the release decision.

For PineDesk, version `18` should carry a review packet before any production alias moves:

| Evidence | Example |
|---|---|
| Offline metrics | macro F1, urgent-ticket recall, language segment performance |
| Compatibility | `ticket_features_v6` accepts current Inbox API fields |
| Safety checks | urgent outage tickets stay above approved recall threshold |
| Runtime checks | p95 under 80 ms at 150 requests per second |
| Drift plan | prediction distribution monitored by category and language |
| Rollback owner | support operations approves route back to version `17` |

SageMaker Model Registry has model package approval statuses such as approved and rejected, and deployment workflows can require an approved package before endpoint update. MLflow and Databricks teams often express the same control with model aliases, permissions, review comments, jobs, and deployment automation. The exact button or API changes by platform, so the article habit is to make the approval visible in the release manifest and registry history.

Here is the kind of review command a platform job might run after approval:

```bash
python release/promote_model.py \
  --registered-model ticket-triage \
  --from-version 18 \
  --alias champion \
  --review-packet s3://pinedesk-ml-reviews/ticket-triage/v18/review.yaml
```

The command is intentionally small. The job behind it should check reviewer identity, read the review packet, update the registry alias, and write an audit event. A production release should leave evidence beyond a chat message.

![PineDesk approval gate for v18](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/approval-gate-v18.png)
*The approval gate turns a candidate model into a reviewed production pointer only after metrics, runtime checks, owners, and audit evidence line up.*

## Route Requests With Version Labels
<!-- section-summary: Serving systems should label requests and metrics with the resolved model version so routing decisions can be audited. -->

After approval, the serving system needs to route real requests. PineDesk can resolve the model alias during startup, load the artifact, and expose the resolved version as a metric label and response field. That version label is the thread that connects a customer ticket to the model evidence.

The response can carry version information:

```json
{
  "ticket_id": "tkt_941882",
  "category": "incident",
  "urgency": "high",
  "confidence": 0.91,
  "model_name": "ticket-triage",
  "model_version": "18",
  "model_alias": "champion",
  "feature_schema": "ticket_features_v6"
}
```

Logs should carry the same fields:

```json
{
  "event": "prediction",
  "ticket_id": "tkt_941882",
  "model_name": "ticket-triage",
  "model_version": "18",
  "model_alias": "champion",
  "feature_schema": "ticket_features_v6",
  "latency_ms": 42,
  "language": "es",
  "predicted_category": "incident",
  "predicted_urgency": "high"
}
```

With these fields, the team can compare `v18` against `v17` during canary, filter dashboards by language, and search the warehouse for tickets affected by a bad release. Without these labels, the team may only know that the service was running during the incident window.

## Compare Versions With Release Evidence
<!-- section-summary: Version comparison should include product metrics, service metrics, segments, compatibility, and delayed labels. -->

PineDesk should compare model versions before and during release. Offline comparison uses the validation set. Staging comparison uses replayed traffic. Canary comparison uses live requests from a small traffic slice. Later label comparison uses human support outcomes after agents finish tickets.

A useful comparison table might look like this:

| Metric | v17 baseline | v18 candidate | Decision |
|---|---:|---:|---|
| Macro F1 | 0.842 | 0.861 | Candidate improves |
| Urgent-ticket recall | 0.934 | 0.936 | Candidate stays inside guardrail |
| Spanish macro F1 | 0.781 | 0.833 | Candidate improves target segment |
| Portuguese macro F1 | 0.764 | 0.819 | Candidate improves target segment |
| Billing-to-incident confusion | 2.8 percent | 2.6 percent | Candidate stays stable |
| p95 latency | 54 ms | 68 ms | Candidate inside 80 ms budget |

During canary, the comparison query should use version labels:

```sql
SELECT
  model_version,
  language,
  COUNT(*) AS predictions,
  AVG(CASE WHEN predicted_urgency = 'high' THEN 1 ELSE 0 END) AS high_rate,
  APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)] AS p95_latency_ms
FROM support_prediction_logs
WHERE prediction_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
  AND model_name = 'ticket-triage'
GROUP BY model_version, language
ORDER BY language, model_version;
```

This query will not prove final accuracy because support outcomes arrive later. It still helps during rollout because a sudden category-rate change, language-specific latency jump, or missing feature spike can stop a bad release early.

![PineDesk version comparison during canary](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/version-comparison-canary.png)
*Version labels let PineDesk compare accuracy, language segments, and latency for v17 and v18 during canary, while keeping the rollback pointer clear.*

## Rollback By Moving The Pointer
<!-- section-summary: A rollback should move traffic or aliases back to the known-good model while preserving evidence from the failed version. -->

Rollback works best when the team can move a pointer instead of rebuilding the whole system. For PineDesk, the known-good version is `ticket-triage:v17`. If `v18` starts routing urgent outage tickets incorrectly, the incident commander should move the `champion` alias back to `17` and make the serving layer reload or reroute.

The rollback record should state the old pointer and the new pointer:

```yaml
rollback:
  reason: "Spanish urgent outage tickets under-routed during v18 canary"
  model_name: ticket-triage
  alias: champion
  previous_version: 18
  restored_version: 17
  started_at_utc: "2026-07-04T19:12:00Z"
  owners:
    incident_commander: priya@pinedesk.example
    support_ops: marcus@pinedesk.example
```

The failed version should stay in the registry. Deleting it removes evidence. Keep the artifact, metrics, logs, and review packet so the team can reproduce the failure, patch the issue, and decide whether `v19` should retry the release.

## Putting It Together
<!-- section-summary: Versioning connects model evidence to serving routes, observability labels, approvals, and rollback. -->

Model versioning gives production a safe way to name and move models. PineDesk needs immutable versions for evidence, aliases for controlled serving, image digests for runtime identity, schema versions for compatibility, and logs that record what served each ticket.

When versioning is strong, a release question has a concrete answer. Which model served this request? Which evidence approved it? Which alias selected it? Which labels compare it to the baseline? Which pointer returns production to the previous model? Those answers are the foundation for every release strategy that comes next.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow Model Registry aliases](https://mlflow.org/docs/latest/ml/model-registry/tutorial)
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Amazon SageMaker Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html)
- [Amazon SageMaker Model approval status](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-approve.html)
- [Vertex AI Model Registry](https://cloud.google.com/vertex-ai/docs/model-registry/introduction)
