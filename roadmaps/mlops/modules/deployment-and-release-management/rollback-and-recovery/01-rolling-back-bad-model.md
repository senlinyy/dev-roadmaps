---
title: "Model Rollbacks"
description: "Revert bad model releases by moving traffic, aliases, manifests, features, and owners through a practiced rollback runbook."
overview: "A model rollback sends production behavior back to the last approved serving state after a bad model release. This guide follows a delivery ETA incident through rollback decision points, MLflow and Databricks alias moves, Kubernetes and Argo Rollouts commands, Argo CD recovery, verification checks, and owner handoffs."
tags: ["MLOps", "production", "incidents"]
order: 1
id: "article-mlops-deployment-and-release-management-rolling-back-bad-model"
---

## Table of Contents

1. [What a Model Rollback Means](#what-a-model-rollback-means)
2. [The Rollback Map](#the-rollback-map)
3. [Deciding the Rollback Level](#deciding-the-rollback-level)
4. [Rolling Back the Model Alias](#rolling-back-the-model-alias)
5. [Rolling Back Serving Traffic](#rolling-back-serving-traffic)
6. [Rolling Back GitOps State](#rolling-back-gitops-state)
7. [Verification After Rollback](#verification-after-rollback)
8. [Owners and the Runbook](#owners-and-the-runbook)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## What a Model Rollback Means
<!-- section-summary: A model rollback returns production behavior to the last approved model, route, feature, and serving state. -->

A **model rollback** sends production traffic back to the last approved model-serving state after a bad release. In a real MLOps system, that state includes more than one model file. It includes the registry alias, the serving container, the Kubernetes rollout, feature defaults, configuration, traffic routes, and the monitoring thresholds that prove users have recovered.

Let's continue with ParcelPilot, a delivery company that predicts arrival time through `POST /v1/eta/predict`. Version 18 of the `delivery_eta` model passed offline validation and a 5 percent canary. At 25 percent traffic, support tickets spike in rainy London neighborhoods. Customers see delivery estimates that are 15 to 25 minutes too optimistic. Dispatchers start reassigning drivers late because the ETA service says the route is safe.

The team has one urgent goal: protect customers and operators. The fastest safe action might be to abort the Argo Rollouts canary, move the MLflow `Champion` alias back to version 17, or roll back the whole Argo CD application to a previous Git revision. The right answer depends on where the bad behavior lives.

Rollback work should feel boring because the team practiced it before release. A good runbook answers four questions before the incident starts:

- Which production state was last approved?
- Which switch moves traffic away from the bad model fastest?
- Which owners approve that switch?
- Which checks prove the rollback actually helped?

This article builds that rollback path step by step.

## The Rollback Map
<!-- section-summary: A rollback can happen at the alias, route, container, manifest, feature, or downstream workflow level. -->

Model systems have several layers. A release can fail in one layer while the others still work. Rollback starts by locating the layer with the lowest-risk fix.

| Rollback layer | What changes | Common tool | When it fits |
|---|---|---|---|
| **Traffic route** | Move users away from the canary | Argo Rollouts, Istio, ingress controller | Canary metrics fail while the stable version still handles traffic |
| **Model alias** | Point `Champion` back to the previous model version | MLflow Model Registry or Databricks Unity Catalog model alias | Serving code is healthy, and only the model artifact is bad |
| **Serving deployment** | Restore the previous container, environment, or deployment revision | Kubernetes Deployment or Argo Rollouts | New container code, dependency, or resource setting caused failures |
| **GitOps application** | Return cluster manifests to a previous Git or app history state | Argo CD | Multiple Kubernetes objects changed together |
| **Feature/config switch** | Disable a feature, default a missing value, or route a segment | Feature flag, config service, online feature store | One feature source or segment causes harm |
| **Downstream workflow** | Pause automated actions that trust predictions | Queue controls, scheduler pause, product flag | The model output has already triggered risky business actions |

For the ETA incident, the team should first check whether version 17 still serves correctly. If yes, the fastest containment path is traffic or alias rollback. If the new container broke request handling, model alias rollback cannot fix the broken service code. If the new model and service are fine while a weather feature feed sends wrong values, feature rollback may protect users faster than moving the whole deployment.

The rollback map keeps the team from using one heavy tool for every problem. A rollback should remove harm with the smallest safe change that the team can verify.

![ParcelPilot ETA rollback map](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/parcelpilot-eta-rollback-map.png)
*ParcelPilot's rollback path starts with the customer-facing ETA signal, then moves through canary traffic, registry alias, GitOps state, and verification.*

## Deciding the Rollback Level
<!-- section-summary: The rollback decision uses live evidence, blast radius, and owner approval rather than guesswork. -->

During a rollback, the team needs enough evidence to act fast without chasing every theory. ParcelPilot uses a short decision packet in the incident channel:

```yaml
incident: INC-2026-07-05-ETA-RAIN
service: eta-api
current_canary_weight: 25
current_model:
  name: prod.ml_team.delivery_eta
  candidate_version: "18"
  champion_version_before_release: "17"
symptoms:
  - p90_absolute_eta_error_proxy increased from 9m to 21m for rainy London bike orders
  - support_ticket_rate doubled for "ETA too early"
  - API 5xx and latency remain normal
first_safe_rollback:
  action: "abort canary and keep Champion on v17"
  owner: "ml-platform-serving"
  approvers:
    - "eta-modeling"
    - "delivery-experience"
verification:
  - "Candidate traffic returns to 0 percent"
  - "model_alias in prediction logs returns to Champion v17"
  - "late-arrival support ticket rate falls for new orders"
```

This packet says the API is healthy and the model behavior is bad in one segment. That points away from a container rollback and toward traffic rollback plus alias control. The product owner cares because customers receive wrong estimates. The model owner cares because version 18 created the behavior. The platform owner cares because traffic routing and serving health live in their system.

![ETA rollback decision packet](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/eta-rollback-decision-packet.png)
*A useful decision packet keeps the live symptom, model version, first action, and approvers visible in one place.*

The decision should also name the rollback window. A canary can usually roll back immediately. A full production release may need a staged rollback if caches, feature data, or downstream batch jobs depend on the new version. For a real-time ETA endpoint, moving traffic back quickly usually wins because each new bad prediction can create new customer harm.

## Rolling Back the Model Alias
<!-- section-summary: Alias rollback changes the registry pointer so serving code loads or routes to the previous approved model version. -->

An **alias rollback** changes a stable registry alias back to the previous approved model version. The service keeps the same endpoint and code path, while the model behind the alias changes.

In MLflow and Databricks Unity Catalog, a model alias such as `Champion` can point to a concrete version. Before the release, ParcelPilot records that `Champion` points to version 17. Version 18 receives a `Candidate` alias during validation. If the team moved `Champion` to version 18 too early, rollback means moving it back.

```python
from datetime import datetime, timezone

from mlflow import MlflowClient

MODEL_NAME = "prod.ml_team.delivery_eta"
ROLLBACK_VERSION = "17"

client = MlflowClient()

client.set_registered_model_alias(
    name=MODEL_NAME,
    alias="Champion",
    version=ROLLBACK_VERSION,
)

client.set_model_version_tag(
    name=MODEL_NAME,
    version=ROLLBACK_VERSION,
    key="rollback_active",
    value=datetime.now(timezone.utc).isoformat(),
)

champion = client.get_model_version_by_alias(MODEL_NAME, "Champion")
print(f"Champion now points to version {champion.version}")
```

The important part is the print line at the end. The runbook should always verify the registry state after changing it. If the serving service caches models, the platform owner must also know how that cache refreshes. Some services load the alias at startup. Some poll the registry. Some receive a deployment event and then reload. Alias rollback only protects users after the serving layer actually picks up the alias change.

A rollout-safe serving service should expose the loaded version in metrics and responses:

```json
{
  "order_id": "ord_84721",
  "eta_minutes": 34,
  "confidence": 0.81,
  "model_name": "prod.ml_team.delivery_eta",
  "model_version": "17",
  "model_alias": "Champion",
  "request_id": "req_01hz..."
}
```

That response lets support, platform, and model owners see whether a new prediction came from the rollback version. Without version metadata, the team has to infer state from logs and deployment history during a stressful incident.

## Rolling Back Serving Traffic
<!-- section-summary: Traffic rollback shifts requests away from the candidate workload and keeps the stable workload ready for all traffic. -->

If the bad model is still in canary, traffic rollback is usually the fastest containment step. Argo Rollouts has commands for aborting and undoing rollouts, and Kubernetes Deployments have `kubectl rollout undo` for returning to an earlier deployment revision.

For an Argo Rollouts canary, the platform owner first checks current state:

```bash
kubectl argo rollouts get rollout eta-api \
  --namespace ml-serving
```

If version 18 is currently receiving canary traffic, abort the rollout:

```bash
kubectl argo rollouts abort eta-api \
  --namespace ml-serving
```

Abort stops the current rollout and returns active traffic to the previous stable ReplicaSet. The team should still update the desired state afterward if the Git manifest or rollout template still points at the bad candidate. Otherwise, the controller may try the same bad version again after the aborted state clears or after someone retriggers sync.

If the service uses a plain Kubernetes Deployment, inspect rollout history:

```bash
kubectl rollout history deployment/eta-api \
  --namespace ml-serving
```

Then roll back to the previous deployment or a specific revision:

```bash
kubectl rollout undo deployment/eta-api \
  --namespace ml-serving \
  --to-revision=31
```

The Kubernetes command changes the deployment revision. It helps when the service image, environment variables, or deployment template caused the failure. It may have no effect on a model alias if the service still loads `Champion` from the registry at runtime. That is why the incident owner should name the layer being rolled back in the channel.

After either rollback command, the platform owner checks rollout status:

```bash
kubectl rollout status deployment/eta-api \
  --namespace ml-serving \
  --timeout=5m

kubectl get pods \
  --namespace ml-serving \
  -l app=eta-api
```

These checks confirm that the Kubernetes objects are healthy. They do not prove the model predictions improved. Model rollback verification needs prediction-specific signals too.

## Rolling Back GitOps State
<!-- section-summary: GitOps rollback restores the declared production manifests when the incident spans several Kubernetes resources. -->

Many teams use GitOps so production state follows Git. GitHub Actions may build and update manifests, while Argo CD watches the Git repository and syncs the desired state into the cluster. Argo CD automated sync can remove the need for CI to talk directly to the Argo CD API, because the pipeline commits the desired manifest and Argo CD applies it.

GitOps gives the team a strong audit trail, but it also creates one extra rollback question: should the team roll back live cluster state, Git state, or both? During an urgent incident, the platform owner may use Argo Rollouts to protect traffic immediately. Then the release owner should update Git so the declared state matches the recovered state.

A common rollback pull request changes only the release values:

```yaml
etaApi:
  image:
    repository: registry.example.com/ml/eta-api
    tag: "2026-07-05.3"
  model:
    name: "prod.ml_team.delivery_eta"
    alias: "Champion"
    expectedVersion: "17"
  rollout:
    canaryWeight: 0
```

GitHub Actions can require a production environment approval before merging or deploying a rollback workflow:

```yaml
name: eta-api-rollback

on:
  workflow_dispatch:
    inputs:
      target_model_version:
        description: "Registered model version to restore"
        required: true
      incident_id:
        description: "Incident ticket"
        required: true

jobs:
  rollback:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v5
      - run: ./scripts/set-eta-model-version.sh "${{ inputs.target_model_version }}"
      - run: ./scripts/open-rollback-pr.sh "${{ inputs.incident_id }}"
```

Some teams also use Argo CD's application rollback command to return an application to a previous deployed history entry:

```bash
argocd app history eta-api
argocd app rollback eta-api 42 --prune
argocd app wait eta-api --health --timeout 300
```

That command is useful when the application history already contains the desired healthy state. In strict GitOps workflows, teams often prefer a Git revert or rollback pull request so the repository remains the source of truth. The practical runbook can support both: use the fastest live containment action first, then repair declared state in Git with review.

## Verification After Rollback
<!-- section-summary: Rollback verification checks traffic, registry state, service health, prediction quality proxies, and customer impact. -->

A rollback is complete only after the team proves that production behavior returned to the safe state. The verification checklist should include several signals because each layer can tell a different story.

| Check | Owner | Example evidence |
|---|---|---|
| Traffic is stable | Platform owner | Canary weight is 0 percent, stable ReplicaSet receives requests |
| Registry alias is safe | Model owner | `Champion` points to version 17 |
| Service is healthy | Platform owner | `5xx`, p95 latency, pod restarts, and saturation are normal |
| Predictions use safe version | API owner | New prediction logs show `model_version="17"` |
| Product harm is falling | Product owner | New support tickets and dispatcher overrides trend down |
| Incident record is complete | Incident owner | Timeline, commands, approvers, and verification links are recorded |

Prometheus can answer the first service-level questions:

```promql
sum by (model_version) (
  rate(eta_predictions_total{service="eta-api"}[5m])
)
```

This query shows which model versions are serving traffic. After rollback, version 18 should drop to zero for production traffic. The exact label names depend on the service instrumentation, but the release readiness checklist should require `model_name`, `model_version`, `model_alias`, and `route` labels before canarying starts.

Prediction logs answer the product-specific questions:

```sql
SELECT
  model_version,
  city,
  vehicle_type,
  COUNT(*) AS predictions,
  APPROX_QUANTILES(abs_eta_error_minutes, 100)[OFFSET(90)] AS p90_error
FROM `ml_warehouse.prediction_labels.delivery_eta`
WHERE prediction_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR)
GROUP BY model_version, city, vehicle_type
ORDER BY p90_error DESC;
```

This query needs delayed labels, so it may lag behind the live incident. That is normal for ML systems. The team should combine fast proxy signals, such as dispatcher overrides and support tickets, with slower ground-truth labels when they arrive.

The incident owner should keep a simple rollback timeline:

```yaml
timeline:
  - time: "2026-07-05T14:02:00Z"
    event: "Alert fired: ETA rainy London p90 proxy error high"
  - time: "2026-07-05T14:07:00Z"
    event: "Canary held at 25 percent"
  - time: "2026-07-05T14:10:00Z"
    event: "Rollback approved by model, platform, and product owners"
  - time: "2026-07-05T14:12:00Z"
    command: "kubectl argo rollouts abort eta-api -n ml-serving"
  - time: "2026-07-05T14:18:00Z"
    event: "Candidate traffic at 0 percent; new predictions show model v17"
```

That timeline is useful during the incident, and it also powers the post-incident review. The team should record what happened while memories are fresh.

![Rollback verification board](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/rollback-verification-board.png)
*Rollback verification should prove that traffic, aliases, pods, logs, and user-facing signals all moved back to the safe state.*

## Owners and the Runbook
<!-- section-summary: A rollback runbook names decision owners, commands, communication paths, and aftercare before the release starts. -->

A model rollback runbook should fit on one page during the incident. Long architecture documents rarely help when the team is under pressure. The runbook should name the system, owners, decision rules, commands, verification links, and communication templates.

ParcelPilot keeps this runbook in the service repository:

```yaml
service: eta-api
primary_model: prod.ml_team.delivery_eta
production_alias: Champion
rollback_policy:
  page_when:
    - "canary validation error rate exceeds threshold for 10 minutes"
    - "p90 ETA error proxy increases by more than 8 minutes for a protected segment"
    - "support ticket rate doubles for ETA-related categories"
  preapproved_actions:
    - "abort Argo Rollouts canary"
    - "set canary weight to 0"
    - "move Champion alias back to last approved version"
owners:
  incident_commander: "ml-oncall-primary"
  platform_owner: "ml-platform-serving"
  model_owner: "eta-modeling"
  product_owner: "delivery-experience"
  support_owner: "customer-operations"
commands:
  inspect_rollout: "kubectl argo rollouts get rollout eta-api -n ml-serving"
  abort_rollout: "kubectl argo rollouts abort eta-api -n ml-serving"
  check_predictions: "dashboard: ETA Production Model Versions"
```

The owner list matters as much as the commands. The platform owner should not have to guess whether a product metric is severe enough. The model owner should not have to find the right Kubernetes namespace during the incident. The support owner should know when to send a customer-facing update. Clear ownership keeps the rollback focused.

The runbook should also include aftercare. After rollback, freeze version 18, preserve logs and feature snapshots, link the training run and release PR, and create a follow-up ticket for the model fix. If the team immediately starts another release without that evidence, they risk repeating the same failure.

## Putting It Together
<!-- section-summary: Good rollbacks are practiced release operations that move the smallest safe layer and verify customer recovery. -->

A model rollback returns production behavior to a known safe state. The safest rollback may live in the traffic route, the model alias, the serving deployment, the GitOps application, the feature configuration, or a downstream workflow. The incident owner should choose the smallest safe change that removes user harm and can be verified quickly.

For ParcelPilot, version 18 harmed rainy London bike deliveries while the service stayed healthy. The team could abort canary traffic, keep or restore `Champion` on version 17, update GitOps state, and verify that new predictions came from the safe model. That rollback protects customers first, then gives the model team a clean evidence trail for fixing version 18.

The best rollback happens before the incident in one sense: the owners, commands, dashboards, aliases, and approval rules already exist. During the incident, the team should execute the practiced path, verify recovery, and preserve evidence for the next model release.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Kubernetes: kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)
- [Argo Rollouts abort command](https://argo-rollouts.readthedocs.io/en/stable/generated/kubectl-argo-rollouts/kubectl-argo-rollouts_abort/)
- [Argo Rollouts undo command](https://argo-rollouts.readthedocs.io/en/stable/generated/kubectl-argo-rollouts/kubectl-argo-rollouts_undo/)
- [Argo CD automated sync policy](https://argo-cd.readthedocs.io/en/latest/user-guide/auto_sync/)
- [Argo CD app rollback command](https://argo-cd.readthedocs.io/en/latest/user-guide/commands/argocd_app_rollback/)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
