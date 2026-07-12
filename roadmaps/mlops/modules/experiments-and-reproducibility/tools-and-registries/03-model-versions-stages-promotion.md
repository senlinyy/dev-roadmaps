---
title: "Model Promotion"
description: "Teach candidate, shadow, staging, canary, production, archived, and rollback flows with version aliases, approval gates, and release evidence."
overview: "Model promotion moves a registered model version through controlled release states. This tutorial follows a support ticket routing model through candidate review, shadow and staging tests, canary traffic, production alias changes, archived versions, rollback targets, and concrete release gates."
tags: ["MLOps", "production", "registry"]
order: 3
id: "article-mlops-experiments-and-reproducibility-model-versions-stages-promotion"
---

## Table of Contents

1. [What Model Promotion Means](#what-model-promotion-means)
2. [The Ticket Routing Scenario](#the-ticket-routing-scenario)
3. [The Promotion Path](#the-promotion-path)
4. [Candidate Review](#candidate-review)
5. [Shadow And Staging](#shadow-and-staging)
6. [Canary Release](#canary-release)
7. [Production Alias And Archive](#production-alias-and-archive)
8. [Rollback Practice](#rollback-practice)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## What Model Promotion Means
<!-- section-summary: Model promotion moves one registered version through release states after evidence proves it is ready for the next step. -->

**Model promotion** is the controlled movement of a registered model version through release states such as candidate, shadow, staging, canary, production, archived, and rollback target. Each state says what the version may do. A candidate may only be reviewed. A shadow version may score live inputs without changing user-facing decisions. A canary version may affect a small slice of traffic. A production version serves the main path.

Promotion should be recorded in the registry or release system with evidence. A team should know which version moved, who approved it, which metrics passed, which alias changed, and which version can receive traffic again if rollback is needed. The promotion record is the release history for the model.

This article follows a support ticket routing model. The example uses concrete aliases, gates, metrics, and deployment checks so you can see how promotion works beyond a status label in a UI.

## The Ticket Routing Scenario
<!-- section-summary: A support ticket routing model needs careful promotion because wrong predictions send customers to the wrong queue and slow down urgent cases. -->

BrightDesk sells help desk software to B2B companies. Its support product receives thousands of customer tickets every day. A ticket routing model reads the ticket subject, product area, customer tier, language, account region, and a short message preview. It predicts the best queue, such as `billing`, `security`, `api-integrations`, `enterprise-success`, or `bug-triage`.

The current production model is `support-ticket-router:23`. A new version, `support-ticket-router:24`, trained on `tickets_labeled_2026_06_28`, improves routing for API integration tickets and Spanish-language billing tickets. It also changes the way high-severity tickets are detected, so the release owner wants a cautious promotion path.

The registry record for version `24` includes these fields:

```yaml
model_version:
  name: support-ticket-router
  version: 24
  source_run: mlflow-run-20260702-2110
  training_data: warehouse.support.tickets_labeled_2026_06_28
  artifact_uri: s3://brightdesk-ml-artifacts/ticket-router/24/model/
  current_aliases:
    candidate: 24
    production: 23
  rollback_target: 23
  owner: support-ml-platform
  release_owner: support-routing-oncall
```

The important part is the contrast between `candidate: 24` and `production: 23`. Version `24` exists, and the team can review it. Version `23` still serves customers. Promotion moves aliases and traffic only after the gates pass.

## The Promotion Path
<!-- section-summary: A practical promotion path defines each stage, the allowed traffic, the required evidence, and the owner who can approve movement. -->

Stage names vary across tools. Some teams use MLflow aliases such as `candidate`, `shadow`, and `production`. Some teams use SageMaker approval statuses and pipeline steps. Databricks teams using Unity Catalog often combine aliases, tags, permissions, lineage, and deployment jobs rather than relying on the older Workspace Model Registry stage workflow. Some teams store stages in GitOps config and use the registry only for model versions. The reliable pattern is to define what each stage allows.

For BrightDesk, the release path is:

| Stage | What version 24 can do | Required evidence |
|---|---|---|
| Candidate | Exist in the registry for review | Offline metrics, model card, artifact digest, rollback target |
| Shadow | Score live tickets with no routing effect | Shadow agreement, latency, schema compatibility, high-severity safety checks |
| Staging | Serve internal test traffic in a staging help desk workspace | End-to-end routing test, dependency check, queue mapping review |
| Canary | Route a small slice of low-risk production tickets | Reassignment rate, first-response impact, override rate, on-call approval |
| Production | Route the main production ticket stream | Canary pass, product approval, support operations approval |
| Archived | Stay in history after replacement or rejection | Reason, final alias state, retention and rollback notes |

You can capture those gates in a promotion policy file. The policy is useful because humans can review it, and CI/CD can enforce it.

```yaml
model: support-ticket-router
version: 24
rollback_target: 23
gates:
  candidate:
    require:
      macro_f1: ">= 0.812"
      escalation_miss_rate: "<= 0.035"
      artifact_digest: present
      model_card: present
  shadow:
    require:
      live_schema_match_rate: ">= 0.999"
      p95_latency_ms: "<= 80"
      human_queue_agreement: ">= 0.830"
      high_severity_override_misses: 0
  canary:
    traffic_percent: 5
    require:
      reassignment_rate: "<= 0.060"
      first_response_time_delta: "<= 0.020"
      customer_tier_regression: "none"
      oncall_acknowledged: true
```

The numbers should come from the business risk and the current production baseline. BrightDesk accepts a small change in low-severity routing, while it has no tolerance for missed high-severity escalations. The promotion policy says that clearly before the release starts.

![BrightDesk promotion path for version 24 through candidate, shadow, staging, canary, production, archive, and rollback.](/content-assets/articles/article-mlops-experiments-and-reproducibility-model-versions-stages-promotion/brightdesk-promotion-path.png)
*BrightDesk moves version 24 through each release state only after the matching evidence gate passes.*

## Candidate Review
<!-- section-summary: Candidate review checks offline evidence before the version receives live inputs or traffic. -->

The candidate stage starts after training registers version `24`. At this point, the model should have a complete review packet. The release owner should avoid any traffic movement until offline evidence, artifact integrity, input/output shape, and rollback target are all visible.

The candidate review checks the model against the current production version:

```yaml
candidate_review:
  model: support-ticket-router
  candidate_version: 24
  baseline_version: 23
  offline_metrics:
    macro_f1:
      candidate: 0.824
      baseline: 0.811
    escalation_miss_rate:
      candidate: 0.031
      baseline: 0.036
    spanish_billing_f1:
      candidate: 0.792
      baseline: 0.748
    api_integrations_f1:
      candidate: 0.836
      baseline: 0.801
  required_artifacts:
    - model.pkl
    - tokenizer.json
    - queue_label_map.yml
    - requirements.lock
    - evaluation/segment_metrics.csv
    - evaluation/high_severity_examples.csv
```

The release owner should read this packet like a production change. The model improved important segments, and the escalation miss rate moved in the right direction. The queue label map matters because a model can predict a valid class that the ticketing system has no route for. The dependency lock matters because staging and production must load the same tokenizer and model package.

Candidate approval can update a registry alias:

```python
from mlflow import MlflowClient

client = MlflowClient()
client.set_model_version_tag(
    name="support-ticket-router",
    version="24",
    key="candidate_review",
    value="approved_offline_2026-07-03",
)
client.set_registered_model_alias(
    name="support-ticket-router",
    alias="candidate",
    version="24",
)
```

This alias stays in review territory and keeps customer traffic on version `23`. It gives automation a stable way to fetch the reviewed candidate for the next gate.

## Shadow And Staging
<!-- section-summary: Shadow scoring tests the candidate on live inputs without changing decisions, while staging tests the full serving path before production traffic. -->

Shadow testing sends live ticket inputs to version `24` while version `23` still controls routing. The product keeps version `24` predictions hidden from agents and customers during shadow. The goal is to compare live behavior safely: schema compatibility, latency, queue agreement, confidence distribution, and high-severity handling.

BrightDesk runs both versions on the same live tickets and stores a comparison table:

```sql
SELECT
  DATE(event_time) AS day,
  COUNT(*) AS tickets_seen,
  AVG(candidate_latency_ms) AS avg_candidate_latency_ms,
  APPROX_QUANTILES(candidate_latency_ms, 100)[OFFSET(95)] AS p95_candidate_latency_ms,
  AVG(CASE WHEN candidate_queue = human_final_queue THEN 1 ELSE 0 END) AS human_queue_agreement,
  SUM(CASE WHEN severity = 'high' AND candidate_queue != 'enterprise-success' THEN 1 ELSE 0 END) AS high_severity_override_misses
FROM warehouse.support.ticket_router_shadow_events
WHERE event_time >= TIMESTAMP '2026-07-03 00:00:00 UTC'
  AND model_version = 24
GROUP BY day
ORDER BY day;
```

The query shows whether the candidate can handle real inputs. Offline test data can miss strange ticket formats, new product names, or customer-specific fields. Shadow data reveals those issues while version `23` still protects the live routing path.

Staging tests the whole application path. BrightDesk deploys version `24` to an internal help desk workspace with synthetic tickets and sampled historical tickets. This catches configuration problems that pure model scoring may miss: missing environment variables, wrong queue IDs, broken authentication to the feature service, or a stale label map in the ticketing integration.

```yaml
staging_check:
  model_uri: models:/support-ticket-router@candidate
  workspace: brightdesk-support-staging
  synthetic_ticket_set: s3://brightdesk-ml-tests/ticket-router/staging-smoke-2026-07.jsonl
  expected:
    queue_ids_resolve: true
    p95_latency_ms: "<= 80"
    unknown_language_fallback: triage-general
    high_severity_route: enterprise-success
```

If both shadow and staging pass, the release owner can move the candidate toward canary. The registry can record this with an alias change or a tag that says version `24` passed shadow and staging gates.

## Canary Release
<!-- section-summary: Canary release sends a small controlled slice of production traffic to the candidate while monitors compare business and safety metrics. -->

Canary is the first stage where version `24` affects real routing. BrightDesk starts with 5% of low-risk production tickets: free-tier accounts, normal severity, English-language tickets, and product areas with high historical agreement. The goal is to learn from real decisions while limiting customer impact.

A deployment system can read the registry alias and split traffic. The details vary by serving stack. A Kubernetes and Argo Rollouts setup might express the canary like this:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: ticket-router-api
  namespace: ml-serving
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause:
            duration: 2h
        - analysis:
            templates:
              - templateName: ticket-router-canary-check
            args:
              - name: modelVersion
                value: "24"
              - name: rollbackTarget
                value: "23"
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/brightdesk/ticket-router-api:2026.07.03
          env:
            - name: MODEL_URI
              value: "models:/support-ticket-router@canary"
```

The model URI points at the `canary` alias. The rollout starts at 5% and pauses while monitors run. If the analysis fails, the rollout stops and the team returns traffic to version `23`.

The canary monitor should combine model metrics and product metrics:

| Metric | Healthy canary signal |
|---|---|
| Reassignment rate | Agents reassign fewer than 6% of canary-routed tickets |
| First response time | Canary cohort stays within 2% of baseline |
| High-severity safety | Zero missed high-severity enterprise routes |
| Queue imbalance | No team receives an unexpected ticket spike |
| Prediction latency | P95 stays under 80 ms |
| Override feedback | Support operations approves the observed mistakes |

These checks keep the release grounded in the support workflow. Offline F1 helped the candidate enter release review. Canary success depends on agent behavior, ticket queues, and customer response time.

![BrightDesk shadow, staging, and canary checks before production traffic.](/content-assets/articles/article-mlops-experiments-and-reproducibility-model-versions-stages-promotion/brightdesk-safe-checks.png)
*Shadow compares live inputs safely, staging checks the full integration path, and canary limits the first customer-facing traffic.*

## Production Alias And Archive
<!-- section-summary: Production promotion changes the serving alias after canary passes, then archives old or rejected versions with enough history for audits and rollback. -->

Production promotion should be a small recorded action because all the hard review already happened. The release owner changes the production alias from version `23` to version `24`, records the approval, and keeps version `23` as the rollback target until the monitoring window ends.

```python
from mlflow import MlflowClient

client = MlflowClient()
client.set_registered_model_alias(
    name="support-ticket-router",
    alias="production",
    version="24",
)
client.set_model_version_tag(
    name="support-ticket-router",
    version="24",
    key="production_approved_by",
    value="support-routing-release-council",
)
client.set_model_version_tag(
    name="support-ticket-router",
    version="24",
    key="rollback_target",
    value="23",
)
```

The serving service should read the alias instead of hardcoding version `24`. That lets the team move the production pointer during rollback without rebuilding every artifact. Some serving stacks reload model aliases automatically. Others need a deployment restart or config refresh. The runbook should say which behavior your platform uses.

Older versions should move to archived state after the rollback window closes. Archive preserves history and marks the version as out of the normal release path. The version should stay available for audit and maybe emergency rollback, while new releases should ignore it by default.

```yaml
archive_record:
  model: support-ticket-router
  version: 22
  archived_at: 2026-07-04T10:15:00Z
  reason: replaced_by_versions_23_and_24
  keep_until: 2027-07-04
  final_status: superseded
```

Rejected versions also deserve archive records. A failed candidate can teach future releases. If version `25` later fails because Spanish billing tickets regress, the archive note should preserve the failed gate, evidence files, and owner decision.

## Rollback Practice
<!-- section-summary: Rollback returns traffic to a known good version, records the reason, and preserves evidence for incident review. -->

Rollback is part of promotion design. BrightDesk already named version `23` as the rollback target before canary started. That means the release owner knows which model can take traffic again, where the artifact lives, and which serving config should be restored.

A rollback runbook should be short and executable under pressure:

```bash
python scripts/set_model_alias.py \
  --model support-ticket-router \
  --alias production \
  --version 23 \
  --reason "rollback: canary reassignment rate above 6 percent"

kubectl rollout restart deployment/ticket-router-api \
  --namespace ml-serving

python scripts/record_model_incident.py \
  --model support-ticket-router \
  --bad-version 24 \
  --restored-version 23 \
  --incident INC-2026-0704-ticket-router-canary
```

The first command moves the registry alias. The second command refreshes serving if the platform caches the loaded model. The third command records why the rollback happened, because a future reviewer needs to understand whether version `24` failed due to model behavior, integration behavior, or a monitoring bug.

The incident packet should include the canary metrics, the exact time traffic moved, the alias history, the affected ticket cohorts, and the final customer impact. A good rollback record helps the team improve the next candidate instead of repeating the same release mistake.

![BrightDesk rollback moving the production alias from version 24 back to version 23, restarting serving, and recording the incident.](/content-assets/articles/article-mlops-experiments-and-reproducibility-model-versions-stages-promotion/brightdesk-rollback.png)
*Rollback should move the production alias, refresh serving if needed, and preserve the incident evidence for the next review.*

## Putting It Together
<!-- section-summary: Promotion connects registry aliases, release gates, deployment traffic, archive history, and rollback readiness into one controlled model lifecycle. -->

Model promotion turns a registered version into a controlled release. Candidate review checks offline evidence. Shadow and staging test live inputs and integration behavior. Canary sends a small slice of production traffic through the candidate. Production promotion moves the main alias after the gates pass. Archive and rollback preserve history and give the team a way back.

For BrightDesk, version `24` earns production traffic only after evidence supports each step. The registry stores aliases and release metadata, while deployment automation reads those aliases and monitors business metrics. That combination gives the support team a clear path from candidate to production without losing rollback safety.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official MLflow guide for registered models, model versions, aliases, tags, and model metadata.
- [MLflow Model Registry Workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/) - Official MLflow workflow guide for registering models, managing versions, applying aliases, and using APIs.
- [Databricks MLflow 3 deployment jobs](https://docs.databricks.com/aws/en/mlflow/deployment-job) - Official Databricks guide for deployment jobs that control model lifecycle movement in Unity Catalog workflows.
- [Amazon SageMaker Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html) - Official SageMaker guide for model package groups, versions, metadata, approval status, lineage, model cards, and lifecycle stages.
- [Update the Approval Status of a Model in SageMaker](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-approve.html) - Official SageMaker guide for approval status updates.
- [Vertex AI Model Registry](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-registry/introduction) - Official Google Cloud guide for model versions, evaluation, lifecycle management, and deployment from the registry.
- [Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/) - Official Databricks guide for registered models, aliases, permissions, and lifecycle management.
