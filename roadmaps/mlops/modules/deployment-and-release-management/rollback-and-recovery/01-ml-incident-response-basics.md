---
title: "ML Incident Response"
description: "Connect alerts, owners, runbooks, and post-incident learning."
overview: "Learn how production ML teams respond when a model hurts users, costs, latency, or trust, from the first alert through rollback and post-incident learning."
tags: ["MLOps", "production", "incidents"]
order: 1
id: "article-mlops-deployment-and-release-management-ml-incident-response-basics"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/rollback-and-recovery/03-ml-incident-response-basics.md
  - child-rollback-and-recovery-03-ml-incident-response-basics
---

## Why ML Incidents Feel Different
<!-- section-summary: An ML incident is any production event where a model, feature pipeline, training pipeline, or serving path causes real harm to a product outcome. You might see the same... -->

An ML incident is any production event where a model, feature pipeline, training pipeline, or serving path causes real harm to a product outcome. You might see the same symptoms as a normal backend incident: high latency, 500 errors, timeouts, queue backlog, or rising cloud cost. You also get ML-specific symptoms: a model that keeps answering successfully while ranking the wrong listings, rejecting the wrong users, missing a fraud pattern, or drifting away from yesterday's behavior.

That mix is why incident response matters. You need the calm structure of regular SRE work, plus enough ML context to ask whether the model is bad, the inputs changed, the labels are delayed, the fallback is broken, or the release process let an unready version reach users.

Imagine you support `routewise-eta`, a delivery ETA service used by a grocery app. The API still returns `200 OK`, yet customer support gets flooded because drivers arrive 25 minutes later than promised in rainy neighborhoods. The model service is healthy from a container point of view. The incident lives in the gap between "the service is up" and "the prediction is trustworthy."

## Start With Roles And Severity
<!-- section-summary: During an incident, clear roles keep the team from turning into a noisy chat room. You want one person deciding the response path, one person doing technical investigation, one... -->

During an incident, clear roles keep the team from turning into a noisy chat room. You want one person deciding the response path, one person doing technical investigation, one person communicating, and one person keeping a timeline.

For a small ML team, the same person may cover two roles, yet the roles should still exist:

| Role | What they own during the incident |
|---|---|
| Incident commander | Severity, next action, escalation, and when to close the incident. |
| ML responder | Model version, input features, drift, evaluation slices, and fallback behavior. |
| Platform responder | Kubernetes, endpoint health, deploy status, queue depth, storage, and dependencies. |
| Scribe | Timeline, decisions, commands run, links, and unresolved follow-ups. |
| Comms owner | Internal status, customer-support notes, product owner updates, and partner notices. |

Severity should connect to user harm rather than technical drama. A single failed batch retrain may be low severity if production is still served by a stable model. A silent ranking regression may be high severity even when every dashboard is green.

For `routewise-eta`, a simple severity guide could look like this:

```yaml
severity:
  sev1:
    examples:
      - "More than 20 percent of active deliveries have ETA error above 15 minutes"
      - "Rollback path fails while bad model is live"
    response_time: "page immediately"
    required_roles: ["incident_commander", "ml_responder", "platform_responder", "comms_owner"]
  sev2:
    examples:
      - "One region has ETA error above threshold for 30 minutes"
      - "Fallback service is active for more than 10 percent of traffic"
    response_time: "page primary on-call"
  sev3:
    examples:
      - "Training job failed, current production model unaffected"
      - "Monitoring labels delayed, no product symptom yet"
    response_time: "next business day or normal on-call queue"
```

The severity guide gives you a shared language before emotions rise. You can still adjust it during the event, but you start from a written rule instead of whoever sounds most worried.

![routewise-eta incident roles](/content-assets/articles/article-mlops-deployment-and-release-management-ml-incident-response-basics/routewise-eta-incident-roles.png)
*The routewise-eta incident board keeps response roles, severity, and the incident channel visible before the team starts changing production.*

## Alerts Should Point At User Pain
<!-- section-summary: Good incident response starts before the page. If every GPU memory spike pages the team, responders learn to ignore alerts. If prediction quality drops and no one hears about... -->

Good incident response starts before the page. If every GPU memory spike pages the team, responders learn to ignore alerts. If prediction quality drops and no one hears about it, users discover the incident for you.

`routewise-eta` watches the ordinary serving signals—request success, latency, and saturation—alongside prediction volume, fallback use, feature freshness, and later ETA error. Release telemetry adds canary health, rollback failures, and disagreement between the approved and running model version. These signals belong together because an incident can begin in any one of those layers while the others remain healthy.

Here is a Prometheus rule for a model endpoint that combines platform and ML symptoms. The labels carry the service, model, version, and runbook, so the responder lands near the right evidence.

```yaml
groups:
  - name: routewise-eta-ml-alerts
    rules:
      - alert: RoutewiseEtaHighPredictionError
        expr: |
          avg_over_time(routewise_eta_absolute_error_minutes{region!="test"}[30m]) > 12
        for: 20m
        labels:
          severity: sev2
          service: routewise-eta
          model_name: eta-lightgbm
          runbook: https://runbooks.example.com/routewise-eta/prediction-error
        annotations:
          summary: "ETA prediction error is above the customer-visible threshold"
          dashboard: "https://grafana.example.com/d/routewise-eta"
          first_checks: "Check model version, rain feature freshness, and fallback rate"

      - alert: RoutewiseEtaFallbackRateHigh
        expr: |
          sum(rate(routewise_eta_predictions_total{decision="fallback"}[5m]))
          /
          sum(rate(routewise_eta_predictions_total[5m])) > 0.15
        for: 10m
        labels:
          severity: sev2
          service: routewise-eta
```

Alerts like this still need judgment. Labels can arrive late, so a quality alert may lag by hours. That is why many teams pair delayed outcome metrics with faster proxies: feature null rate, model version, response distribution, rule-based sanity checks, and support-ticket spikes.

## The First Fifteen Minutes
<!-- section-summary: The first response should reduce uncertainty and limit damage. You are gathering enough evidence to choose between rollback, traffic reduction, fallback, or continued diagnosis. -->

The first response should reduce uncertainty and limit damage. You are gathering enough evidence to choose between rollback, traffic reduction, fallback, or continued diagnosis.

For `routewise-eta`, the first pass could be:

1. Acknowledge the page and open the incident channel.
2. Name the incident commander and scribe.
3. Pull up the runbook, dashboard, recent deploys, and current model alias.
4. Confirm user impact by region, client, product surface, and model version.
5. Freeze risky deploys for the service and related feature pipelines.
6. Decide whether to rollback, disable the model, reduce traffic, or continue observation.

A good timeline is boring in the best way:

```markdown
# INC-2026-07-05 routewise-eta quality regression

14:04 UTC - Alert fired: RoutewiseEtaHighPredictionError, west-london segment.
14:06 UTC - Priya acknowledged page, opened #inc-routewise-eta-20260705.
14:08 UTC - Marco assigned incident commander, Chen assigned ML responder.
14:11 UTC - Current model alias champion -> version 42, deployed at 13:25 UTC.
14:14 UTC - Rain feature freshness delayed by 38 minutes in west-london.
14:18 UTC - Decision: route west-london traffic to previous model version 41.
14:26 UTC - Error proxy and support ticket rate trending down.
```

The point is less about ceremony and more about shared memory. In a stressful hour, people forget what was tried, who approved it, and why the team chose one rollback over another. The scribe protects the team from repeating work.

![First 15 minutes for routewise-eta](/content-assets/articles/article-mlops-deployment-and-release-management-ml-incident-response-basics/routewise-first-fifteen-minutes.png)
*The first fifteen minutes should gather enough evidence to choose between rollback, fallback, routing, or continued diagnosis.*

## A Runbook For Model Quality Incidents
<!-- section-summary: An ML runbook should help a tired responder find the right clues quickly. Keep it short, specific, and executable. A runbook that reads like a textbook stays unread during a... -->

An ML runbook should help a tired responder find the right clues quickly. Keep it short, specific, and executable. A runbook that reads like a textbook stays unread during a real page.

For a prediction-quality incident, the runbook helps the responder compare the model version, input data, traffic composition, dependencies, and fallback path around the start of the problem. It then gives exact commands and queries so a tired engineer does not have to invent an investigation from scratch:

```bash
kubectl -n ml-serving rollout history deployment/routewise-eta
kubectl -n ml-serving rollout status deployment/routewise-eta --timeout=120s
kubectl -n ml-serving logs deploy/routewise-eta --since=30m | grep model_version
```

```sql
select
  model_version,
  region,
  count(*) as predictions,
  avg(abs(predicted_eta_minutes - actual_eta_minutes)) as mae_minutes,
  avg(case when rain_feature_age_seconds > 900 then 1 else 0 end) as stale_rain_rate
from prod_ml.routewise_eta_predictions
where prediction_time >= current_timestamp - interval '2 hours'
group by model_version, region
order by mae_minutes desc;
```

```python
from mlflow import MlflowClient

client = MlflowClient()
champion = client.get_model_version_by_alias("routewise-eta", "champion")
candidate = client.get_model_version_by_alias("routewise-eta", "candidate")

print("champion", champion.version, champion.run_id)
print("candidate", candidate.version, candidate.run_id)

for version in [champion.version, candidate.version]:
    mv = client.get_model_version("routewise-eta", version)
    print(version, mv.tags)
```

Notice the registry code uses aliases rather than old stage-based APIs. Current MLflow guidance centers on model versions, aliases, and tags, which makes release evidence easier to represent without relying on deprecated stages.

## Choose A Mitigation Path
<!-- section-summary: Mitigation means reducing harm before you fully explain the incident. In ML systems, the first fix may be less accurate than the ideal model, yet it can still be safer than the... -->

Mitigation means reducing harm before you fully explain the incident. In ML systems, the first fix may be less accurate than the ideal model, yet it can still be safer than the live failure.

Common mitigation paths include:

| Mitigation | Use when | Watch out for |
|---|---|---|
| Roll back model alias | A newer model version caused the regression. | The old model may depend on compatible features and schemas. |
| Roll back service image | Packaging, dependency, or API code changed. | A model alias rollback alone will miss code regressions. |
| Switch to fallback model | The main model is unstable for a segment. | Fallback predictions need monitoring too. |
| Route only affected segment | The issue is isolated by region, customer, or traffic source. | Segment routing can hide wider damage if diagnosis is weak. |
| Disable automated action | Human review is safer than automatic decisions. | Queue growth and reviewer capacity need owners. |
| Stop retraining or feature update | A pipeline is generating bad artifacts. | Serving may still read already-published bad features. |

For a Kubernetes-backed service, a service image rollback might use the deployment controller:

```bash
kubectl -n ml-serving rollout undo deployment/routewise-eta --to-revision=17
kubectl -n ml-serving rollout status deployment/routewise-eta --timeout=180s
```

For a model alias rollback, you might keep the container image and move traffic by alias:

```python
from mlflow import MlflowClient

client = MlflowClient()
client.set_registered_model_alias(
    name="routewise-eta",
    alias="champion",
    version="41",
)

client.set_model_version_tag(
    name="routewise-eta",
    version="42",
    key="incident_hold",
    value="INC-2026-07-05",
)
```

The safer path depends on your architecture. If the service resolves the model alias only at startup, you also need a rollout restart. If it resolves aliases dynamically, you need cache invalidation and a metric showing which model version actually served requests.

## Communicate Like A Product Team
<!-- section-summary: ML incidents often affect customer trust before they affect uptime. Support, operations, risk, product, and legal teams may need different levels of detail. -->

ML incidents often affect customer trust before they affect uptime. Support, operations, risk, product, and legal teams may need different levels of detail.

A concise status update can follow this shape:

```markdown
Status: Mitigating
Impact: Delivery ETA predictions are over-optimistic for some rainy west-london deliveries.
User effect: Customers may see arrival windows that are too early.
Current action: Routing affected traffic to previous model version 41.
Next update: 15:00 UTC or sooner if mitigation completes.
Owner: Marco, incident commander
```

Avoid flooding the incident channel with side theories. Keep theories in a thread or investigation note, and keep the main channel for decisions, timestamps, commands, links, and user-facing status.

## Post-Incident Learning
<!-- section-summary: The post-incident review should explain how the system allowed the harm, which signals helped, which signals failed, and what you will change. A good review avoids blame and... -->

The post-incident review should explain how the system allowed the harm, which signals helped, which signals failed, and what you will change. A good review avoids blame and still names the missing guardrail.

For `routewise-eta`, the review finds that the canary passed global mean absolute error while west-London rainy deliveries were too small a slice. The rain feature had a freshness metric but no alert. Model rollback worked, but the service cached the old alias resolution for twenty minutes. Support tickets therefore exposed user pain before the monitoring system did.

Each finding leads to a change in the system rather than a vague promise to be more careful:

```yaml
follow_ups:
  - owner: ml-platform
    due: 2026-07-12
    change: "Add region/weather segment gates to canary evaluation"
  - owner: feature-platform
    due: 2026-07-10
    change: "Alert when rain feature age exceeds 15 minutes for active regions"
  - owner: serving
    due: 2026-07-16
    change: "Expose model_alias_resolved_version and cache age metrics"
  - owner: support-ops
    due: 2026-07-09
    change: "Route ETA complaint spikes into incident triage dashboard"
```

The best incident review makes the next incident smaller. It should add one or two strong guardrails rather than twenty aspirational tasks that never ship.

![ML incident learning loop](/content-assets/articles/article-mlops-deployment-and-release-management-ml-incident-response-basics/ml-incident-learning-loop.png)
*Post-incident learning works best when the timeline, impact, root cause, guardrail, and owner all connect to a concrete follow-up.*

## What The Team Carries Into The Next Incident
<!-- section-summary: Incident readiness comes from ownership, connected evidence, tested recovery, and learning that changes the production system. -->

After the review, `routewise-eta` has a named escalation path, a severity guide tied to customer harm, and one dashboard that places service health beside model version, feature freshness, prediction behaviour, and product outcomes. The team tests rollback during normal release work, and its runbook contains commands that match the current platform.

Those controls do not guarantee that another model will never fail. They reduce the time between a harmful decision and a safe response. More importantly, the timeline and follow-up work turn one rainy-region failure into stronger segment evaluation, faster feature alerts, and a rollback path the team has already proved.

## References

- [Google SRE: Managing Incidents](https://sre.google/sre-book/managing-incidents/)
- [Google SRE Incident Management Guide](https://sre.google/resources/practices-and-processes/incident-management-guide/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus alerting overview](https://prometheus.io/docs/alerting/latest/overview/)
- [Kubernetes deployments and rollback](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
