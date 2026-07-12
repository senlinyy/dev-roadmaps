---
title: "Approval Gates"
description: "Design model deployment approval gates with evidence packets, owners, registry tags, risk review, serving checks, rollout controls, and rollback proof."
overview: "Approval gates turn model release judgment into a repeatable workflow. This tutorial follows a delivery ETA candidate through data, evaluation, robustness, responsible AI, serving, monitoring, rollback, and business approval gates before any production alias changes."
tags: ["MLOps", "production", "approval"]
order: 2
id: "article-mlops-model-evaluation-approval-gates-before-deployment"
---

## Table of Contents

1. [Approval Gates Make Release Evidence Explicit](#approval-gates-make-release-evidence-explicit)
2. [Follow The Delivery ETA Candidate Into Review](#follow-the-delivery-eta-candidate-into-review)
3. [Define The Gate Stack](#define-the-gate-stack)
4. [Write Gate Evidence That Reviewers Can Inspect](#write-gate-evidence-that-reviewers-can-inspect)
5. [Attach Gate Status To The Model Version](#attach-gate-status-to-the-model-version)
6. [Check Serving, Monitoring, And Rollback](#check-serving-monitoring-and-rollback)
7. [Run The Approval Meeting](#run-the-approval-meeting)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Approval Gates Make Release Evidence Explicit
<!-- section-summary: Approval gates are review checkpoints that require named evidence and named owners before a model can deploy. -->

An **approval gate** is a checkpoint a model must pass before deployment. Each gate names the evidence reviewers need, the owner who signs off, and the action to take when evidence fails. The title answer is direct: **approval gates prevent a model from moving to production until the team has checked model quality, product risk, serving safety, monitoring, and rollback readiness.**

Approval gates help because model releases cross several kinds of work. Data scientists know the metrics. ML platform engineers know the registry, serving path, and rollback controls. Product owners know which errors hurt users. Operations teams know support load. Responsible AI or compliance reviewers know when a decision needs extra governance.

The previous article compared a candidate delivery ETA model with the production version. The candidate improved the average score, yet rain behavior blocked release. Now imagine the team trained `delivery_eta:v44` with more rain examples and a repaired weather join. The comparison packet passes. Before the model can take production traffic, it still needs approval gates.

## Follow The Delivery ETA Candidate Into Review
<!-- section-summary: The running scenario uses a fixed candidate version that has passed comparison and now needs deployment approval across product, ML, platform, and operations checks. -->

CityCart now has `delivery_eta:v44`. The production alias `champion` still points to `v42`. The candidate passed the candidate-vs-production comparison:

| Metric | Production v42 | Candidate v44 | Gate |
|---|---:|---:|---|
| MAE | 6.8 min | 5.9 min | Pass |
| P90 absolute error | 15.4 min | 14.2 min | Pass |
| Late underestimation | 8.7% | 7.9% | Pass |
| Rain late underestimation | 11.8% | 10.9% | Pass |
| API p95 latency | 42 ms | 61 ms | Pass |

That comparison tells the team the candidate deserves deployment review. It does not grant deployment by itself. The release path still needs evidence that the data contract is stable, the model artifact is registered, the serving container can load it, the monitors know what to watch, and rollback is tested.

CityCart uses approval gates because the serving endpoint touches every order estimate. A bad ETA model can increase refunds, missed courier handoffs, and support tickets. The gates make sure the team reviews those risks before changing the alias.

## Define The Gate Stack
<!-- section-summary: A useful gate stack covers data, evaluation, robustness, responsible use, serving readiness, observability, rollout, rollback, and final owner approval. -->

A **gate stack** is the ordered set of checks a model must pass. The order matters because early gates catch evidence gaps before the team spends time on deployment mechanics. CityCart uses this stack:

| Gate | Owner | Evidence | Pass condition |
|---|---|---|---|
| Data contract | Data platform | Feature schema, freshness report, join coverage | No required feature missing; freshness within SLA |
| Evaluation | ML owner | Candidate-vs-production packet | All blocking metrics pass |
| Robustness | ML owner | Stress suite and segment report | Risk segments pass approved floors |
| Responsible use | Product and governance | Intended use, user impact, escalation path | Use stays within approved ETA display workflow |
| Registry | ML platform | Model version, signature, input example, tags | Registered version has serving contract metadata |
| Serving | ML platform | Load test, p95 latency, error rate | Endpoint meets latency and error budgets |
| Monitoring | Operations | Dashboards, alerts, prediction log checks | Alerts and owners configured before rollout |
| Rollback | ML platform | Rehearsed alias rollback and feature flag plan | Rollback completed in staging |
| Final approval | Release owner | Signed decision record | All required owners approve |

This shape lines up with the spirit of NIST AI RMF work. NIST frames AI risk management through governance, mapping context, measuring risk, and managing the response. CityCart does not copy the framework into a checklist. It uses the same idea: name the context, measure the risk, assign owners, and prepare the response.

The gate stack lives in the repo:

```yaml
approval_gates:
  model: citycart.delivery_eta
  candidate_version: "44"
  production_alias: champion
  required_gates:
    - id: data_contract
      owner: data-platform
      evidence: artifacts/data_contract_report.json
      status: pass
    - id: evaluation
      owner: delivery-ml-platform
      evidence: artifacts/candidate_vs_production_packet.yaml
      status: pass
    - id: robustness
      owner: delivery-ml-platform
      evidence: artifacts/robustness_by_segment.csv
      status: pass
    - id: serving
      owner: ml-platform
      evidence: artifacts/staging_load_test.json
      status: pass
    - id: rollback
      owner: ml-platform
      evidence: artifacts/staging_rollback_rehearsal.md
      status: pass
    - id: final_approval
      owner: delivery-release-council
      evidence: artifacts/release_decision.yaml
      status: pending
```

![CityCart approval gate stack for v44 with data, evaluation, robustness, responsible use, registry, serving, monitoring, rollback, and final approval gates](/content-assets/articles/article-mlops-model-evaluation-approval-gates-before-deployment/citycart-approval-gate-stack.png)

*The gate stack separates evidence, runtime checks, and owner approval so v44 moves from a good comparison score into traffic only after deployment evidence clears.*

This file gives automation and humans the same source of release truth.

## Write Gate Evidence That Reviewers Can Inspect
<!-- section-summary: Gate evidence should be concrete enough that a reviewer can reproduce the result or understand exactly which artifact supports approval. -->

A gate with no evidence is only a meeting opinion. Good gate evidence shows the inputs, the result, the owner, and the decision rule. For CityCart, the evaluation gate points to the comparison packet. The data contract gate points to a JSON report. The serving gate points to load-test output.

Here is a compact data contract report:

```json
{
  "dataset": "delivery_eta_features_2026_07_04",
  "candidate_version": "44",
  "required_features": 31,
  "missing_required_features": [],
  "freshness_minutes_p95": 4.2,
  "freshness_sla_minutes": 10,
  "weather_join_coverage": 0.997,
  "store_queue_depth_null_rate": 0.002,
  "status": "pass"
}
```

This report answers a concrete question: can the serving path produce the features the model expects? Feature contracts matter because a model that scores beautifully offline can fail in production if the request payload changes or an upstream join breaks.

![CityCart evidence review packet collecting data report, comparison packet, robustness CSV, load test, alert dashboard, rollback rehearsal, and owner signoff](/content-assets/articles/article-mlops-model-evaluation-approval-gates-before-deployment/citycart-evidence-review-packet.png)

*The approval packet gives every reviewer a concrete artifact to inspect instead of relying on a meeting summary or chat thread.*

The responsible-use gate is more qualitative, yet it still needs structured evidence:

```yaml
responsible_use_gate:
  model: citycart.delivery_eta
  candidate_version: "44"
  intended_use: show customer-facing grocery delivery ETA in minutes
  blocked_uses:
    - courier pay decisions
    - courier performance ranking
    - customer refund eligibility
  user_impact_review:
    main_harm: overly optimistic ETA during delays
    mitigation: support credit workflow and delay messaging
    escalation_owner: delivery-operations
  status: pass
  approvers:
    product: delivery-product-lead
    operations: delivery-operations-lead
    governance: responsible-ai-reviewer
```

This gate keeps the model inside its approved purpose. The ETA model can help customers understand delivery timing. A separate governance review would be needed before the same predictions affected courier pay or refund eligibility.

## Attach Gate Status To The Model Version
<!-- section-summary: Registry tags and descriptions keep gate status close to the model version that reviewers may approve for deployment. -->

Approval evidence should travel with the model version. MLflow Model Registry supports model versions, tags, descriptions, and aliases. Tags are useful for machine-readable status, while descriptions and artifacts help humans understand the decision.

CityCart writes gate status to the candidate version:

```python
from mlflow import MlflowClient

client = MlflowClient()
model_name = "citycart.delivery_eta"
version = "44"

gate_status = {
    "data_contract": "pass",
    "evaluation": "pass",
    "robustness": "pass",
    "responsible_use": "pass",
    "serving": "pass",
    "monitoring": "pass",
    "rollback": "pass",
    "final_approval": "pending",
}

for gate, status in gate_status.items():
    client.set_model_version_tag(model_name, version, f"gate.{gate}", status)

client.set_model_version_tag(model_name, version, "release_packet", "runs:/2f41.../approval_gates.yaml")
client.set_model_version_tag(model_name, version, "approved_alias_target", "champion")
```

This does two things. First, deployment automation can refuse to move the alias unless every required `gate.*` tag says `pass` or `approved`. Second, humans can open the model version and see the release story without hunting through chat messages.

The alias still stays on v42 until final approval. A tag describes readiness. The alias controls traffic.

## Check Serving, Monitoring, And Rollback
<!-- section-summary: Deployment approval needs runtime proof: the model loads, serves within budgets, emits logs, triggers alerts, and can roll back quickly. -->

Model quality gates protect the prediction. Runtime gates protect the service. CityCart checks serving with a staging load test:

```yaml
serving_gate:
  endpoint: delivery-eta-api-staging
  model_uri: models:/citycart.delivery_eta/44
  request_sample: artifacts/recent_eta_requests_10k.jsonl
  results:
    p50_latency_ms: 22
    p95_latency_ms: 61
    p99_latency_ms: 93
    error_rate: 0.0004
    cold_start_success: true
  budgets:
    p95_latency_ms_max: 75
    error_rate_max: 0.001
  status: pass
```

Then operations checks the monitoring gate. Monitoring needs enough detail to catch bad behavior after rollout. CityCart logs prediction IDs, model version, request timestamp, feature freshness, predicted ETA, actual ETA when it arrives, city zone, weather condition, and rollout group.

```sql
SELECT
  model_version,
  rollout_group,
  weather_condition,
  COUNT(*) AS completed_orders,
  AVG(ABS(actual_eta_minutes - predicted_eta_minutes)) AS mae_minutes,
  AVG(CASE WHEN actual_eta_minutes - predicted_eta_minutes > 10 THEN 1 ELSE 0 END) AS late_underestimation_rate
FROM prod_ml.delivery_eta_prediction_logs
WHERE prediction_timestamp >= CURRENT_TIMESTAMP - INTERVAL '6 hours'
  AND actual_eta_minutes IS NOT NULL
GROUP BY model_version, rollout_group, weather_condition;
```

The query supports rollout monitoring. If the canary starts underestimating rainy deliveries again, operations can see it by model version and weather condition.

Rollback needs rehearsal. CityCart uses the registry alias as the release switch. In staging, the team moves `champion` from v42 to v44, sends test requests, then moves it back to v42 and confirms the serving endpoint loads the old version.

```python
from mlflow import MlflowClient

client = MlflowClient()
model_name = "citycart.delivery_eta"

client.set_registered_model_alias(model_name, "champion", "44")
# run staging smoke tests here
client.set_registered_model_alias(model_name, "champion", "42")
# run rollback smoke tests here
```

The rollback gate passes only after the endpoint returns correct predictions from the restored alias. The team should know the rollback command before production traffic changes.

## Run The Approval Meeting
<!-- section-summary: The approval meeting should confirm the packet, unresolved risks, rollout scope, rollback trigger, and named on-call owners. -->

An approval meeting should be boring in the best way. The evidence already exists. The meeting checks that every owner understands the release, accepts the remaining risk, and knows what happens during rollout.

CityCart uses this meeting checklist:

| Review question | Expected answer |
|---|---|
| Which model is asking for release? | `citycart.delivery_eta:v44` |
| Which alias will change? | `champion` after final approval |
| Which gates passed? | Data, evaluation, robustness, responsible use, registry, serving, monitoring, rollback |
| Which risks remain? | Rain performance needs close canary monitoring |
| What is the rollout scope? | 5% canary for two hours, then 25%, then full release after metrics pass |
| Who watches the rollout? | ML platform on-call and delivery operations |
| What triggers rollback? | P95 latency above 75 ms, error rate above 0.1%, or late underestimation above 9% for two monitoring windows |

The final approval record is short:

```yaml
final_approval:
  model: citycart.delivery_eta
  version: "44"
  decision: approve_canary
  canary_plan:
    start: 5_percent
    expand_after: two_clean_monitoring_windows
    full_release_after: product_owner_approval
  rollback_triggers:
    - api_p95_latency_ms > 75
    - prediction_error_rate > 0.001
    - late_underestimation_rate > 0.09 for two windows
  approvers:
    ml_platform: approved
    product: approved
    operations: approved
    responsible_ai: approved
  alias_change_allowed: true
```

![CityCart canary approval room showing owners, champion v42, candidate v44, rollout ladder, and approve canary decision](/content-assets/articles/article-mlops-model-evaluation-approval-gates-before-deployment/citycart-canary-approval-room.png)

*The final approval meeting ties passed gates to a controlled canary plan, with owners and rollback triggers visible before the alias moves.*

After this record exists, automation can move the alias for the canary path. The team is no longer relying on memory or chat history. The gate record shows why the model was allowed to deploy and how the team planned to respond.

## Putting It Together
<!-- section-summary: Approval gates combine model evidence, risk ownership, registry metadata, runtime checks, monitoring, rollback, and final approval before deployment. -->

Approval gates turn release judgment into a repeatable workflow. Define the gates, write concrete evidence, attach status to the model version, test serving and rollback, and run a final approval meeting where owners accept the rollout plan.

For CityCart, `delivery_eta:v44` passes the comparison packet, robustness report, serving test, monitoring setup, and rollback rehearsal. The final decision approves a controlled canary, keeps the rollback trigger clear, and allows the registry alias to move only after the owners sign off.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official registry concepts for registered models, versions, aliases, tags, and descriptions.
- [MLflow Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/) - Official workflow guide for aliases, tags, status metadata, and model organization for deployment.
- [MLflow sklearn log_model API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html#mlflow.sklearn.log_model) - Official API reference covering current model logging arguments, signatures, input examples, and the deprecated `artifact_path` parameter.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) - Official NIST overview for AI risk management across AI design, development, use, and evaluation.
- [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/) - Official NIST playbook for voluntary suggestions aligned to Govern, Map, Measure, and Manage functions.
