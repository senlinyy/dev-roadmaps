---
title: "Bad Predictions"
description: "Respond when model output harms product behavior by triaging impact, adding guardrails, routing around risky segments, and collecting evidence for rollback or repair."
overview: "Bad predictions need a response path that protects users while the team investigates. This guide follows a grocery substitution model through impact triage, segment isolation, fallback rules, human review, rollback choices, monitoring, and a repair packet."
tags: ["MLOps", "production", "incidents"]
order: 2
id: "article-mlops-deployment-and-release-management-handling-bad-predictions"
---

## Table of Contents

1. [Bad Predictions Are Product Incidents](#bad-predictions-are-product-incidents)
2. [Follow One Substitution Model](#follow-one-substitution-model)
3. [Triage The Prediction Impact](#triage-the-prediction-impact)
4. [Find The Failing Segment](#find-the-failing-segment)
5. [Choose A Containment Path](#choose-a-containment-path)
6. [Add Human Review And Fallbacks](#add-human-review-and-fallbacks)
7. [Collect The Repair Packet](#collect-the-repair-packet)
8. [Verify Recovery](#verify-recovery)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Bad Predictions Are Product Incidents
<!-- section-summary: Bad predictions matter because the model can harm a product workflow even while the service stays healthy. -->

A **bad prediction** is a model output that pushes the product toward a harmful or low-quality decision. The model service might return `200 OK`, the pods might stay healthy, and the latency dashboard might look calm. The issue lives in the decision. A customer gets the wrong recommendation, a support ticket goes to the wrong queue, a delivery estimate misleads the shopper, or a fraud model blocks a good payment.

That makes bad predictions different from ordinary service outages. With a service outage, the first question is often, "Is the API up?" With a prediction incident, the better first question is, "Which decisions are now unsafe?" You need product evidence, model evidence, and system evidence together.

You usually have several response choices:

| Response | What it protects | When it fits |
|---|---|---|
| Threshold change | A decision boundary | Scores are calibrated enough, and one threshold is too aggressive |
| Segment disablement | One risky group | The issue is concentrated in a region, product type, channel, or customer segment |
| Fallback rule | The whole workflow | A simple rule is safer than the current model output |
| Human review | High-risk decisions | The model can still help, yet the final action needs a person |
| Model rollback | Production model version | The new model is the likely cause |
| Feature rollback | Feature feed or transformation | The model version is stable, while input data changed |

This article teaches the response path. You will not try to debug everything at once. You will protect the workflow, isolate the failing slice, collect evidence, and then choose repair or rollback.

## Follow One Substitution Model
<!-- section-summary: The running scenario follows a grocery model that recommends product substitutions when an item is out of stock. -->

Imagine **ShelfSwap**, a grocery delivery company. When a shopper orders an item that is out of stock, ShelfSwap uses a model called `substitution_ranker` to suggest replacements. If oat milk is missing, the system might suggest another oat milk brand, lactose-free milk, almond milk, or a refund. The model ranks choices, and the product applies a decision policy.

The normal policy looks like this:

```yaml
substitution_policy:
  model: substitution_ranker
  production_alias: champion
  auto_accept:
    min_score: 0.82
    max_price_delta_percent: 15
    require_same_dietary_flags: true
  human_review:
    min_score: 0.55
    max_queue_wait_minutes: 8
  fallback:
    default_action: refund
```

The policy matters because the model score alone is not the final product behavior. A high score can auto-accept a replacement. A medium score can ask a store picker to review. A low score can refund the item. Bad predictions happen when that chain sends users to poor outcomes.

After a new model release, support tickets mention strange substitutions. Customers who ordered gluten-free bread receive regular bread suggestions. Vegan shoppers see dairy cheese suggestions. Store pickers also report that the review queue fills with products the old model handled well. The model service is healthy, but the product behavior is unsafe.

The incident owner opens a prediction incident:

```yaml
incident:
  id: inc-2026-07-05-substitutions
  service: substitution-api
  model: substitution_ranker
  current_alias: champion
  current_version: "42"
  previous_version: "41"
  first_bad_signal: support-ticket spike for dietary substitutions
  primary_owner: grocery-ml-oncall
  product_owner: substitutions-product
  decision_deadline_minutes: 20
```

That packet creates a shared clock. The team has 20 minutes to choose containment. Deeper retraining can wait.

## Triage The Prediction Impact
<!-- section-summary: Triage starts by measuring which decisions are affected, how many users are exposed, and whether the harm has a simple containment path. -->

Start with impact before model internals. You need to know how many decisions are affected and which customer promise is at risk. For ShelfSwap, the most urgent promise is dietary safety. Price quality and substitution relevance matter too. Dietary mismatch gets the first response.

A triage query can compare the new production window with the previous stable window:

```sql
WITH recent AS (
  SELECT
    request_id,
    event_time,
    model_version,
    ordered_item_id,
    suggested_item_id,
    ordered_dietary_flags,
    suggested_dietary_flags,
    auto_accepted,
    picker_overrode,
    customer_rejected,
    support_ticket_id
  FROM warehouse.substitution_decisions
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR)
),
checks AS (
  SELECT
    model_version,
    COUNT(*) AS decisions,
    AVG(CASE WHEN auto_accepted THEN 1 ELSE 0 END) AS auto_accept_rate,
    AVG(CASE WHEN picker_overrode THEN 1 ELSE 0 END) AS picker_override_rate,
    AVG(CASE WHEN customer_rejected THEN 1 ELSE 0 END) AS customer_reject_rate,
    AVG(
      CASE
        WHEN ordered_dietary_flags != suggested_dietary_flags THEN 1
        ELSE 0
      END
    ) AS dietary_mismatch_rate,
    COUNTIF(support_ticket_id IS NOT NULL) AS support_tickets
  FROM recent
  GROUP BY model_version
)
SELECT *
FROM checks
ORDER BY model_version;
```

The output might look like this:

| model_version | decisions | auto_accept_rate | picker_override_rate | customer_reject_rate | dietary_mismatch_rate |
|---|---:|---:|---:|---:|---:|
| 41 | 18,420 | 0.48 | 0.12 | 0.07 | 0.003 |
| 42 | 19,015 | 0.61 | 0.24 | 0.15 | 0.028 |

Version 42 is automatically accepting more substitutions, and the dietary mismatch rate has jumped. That points to immediate containment. You can lower auto-accept, disable auto-accept for dietary-sensitive categories, or move the `champion` alias back to version 41.

The triage note should name the business harm in plain language:

![ShelfSwap bad prediction triage](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/shelfswap-bad-prediction-triage.png)
*ShelfSwap's first triage view separates service health from decision safety, which is the key difference in a prediction incident.*

```yaml
impact:
  affected_workflow: grocery substitution
  strongest_signal: dietary_mismatch_rate increased from 0.3% to 2.8%
  user_harm: shoppers may receive unsafe or unwanted dietary substitutions
  current_scope: substitutions for bakery, dairy, and prepared meals
  immediate_risk: auto-accepted substitutions without picker review
```

This keeps the team aligned. The incident is not about "model quality" in the abstract. It is about a specific unsafe decision path.

## Find The Failing Segment
<!-- section-summary: Segment analysis helps the team contain the unsafe slice without overreacting across the whole product. -->

A bad prediction incident often starts broad and then narrows. You need to know whether the issue affects every substitution, one category, one region, one app version, or one feature feed. Segment analysis helps you avoid a blind rollback when a smaller guardrail can protect users.

For ShelfSwap, segment the decisions by product category and dietary flag:

```sql
SELECT
  category,
  ordered_dietary_flags,
  COUNT(*) AS decisions,
  AVG(CASE WHEN ordered_dietary_flags != suggested_dietary_flags THEN 1 ELSE 0 END) AS mismatch_rate,
  AVG(CASE WHEN customer_rejected THEN 1 ELSE 0 END) AS reject_rate,
  AVG(CASE WHEN picker_overrode THEN 1 ELSE 0 END) AS picker_override_rate
FROM warehouse.substitution_decisions
WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR)
  AND model_version = "42"
GROUP BY category, ordered_dietary_flags
HAVING decisions >= 100
ORDER BY mismatch_rate DESC
LIMIT 20;
```

The top rows show a clear pattern:

| category | ordered_dietary_flags | decisions | mismatch_rate | reject_rate |
|---|---|---:|---:|---:|
| bakery | gluten_free | 842 | 0.091 | 0.31 |
| dairy | vegan | 1,104 | 0.074 | 0.27 |
| prepared_meals | halal | 390 | 0.041 | 0.18 |

Now the team can choose a smaller containment rule. The model may still perform well for bottled water, paper goods, and household items. The unsafe slice is dietary-sensitive substitutions where category matching and item metadata must be strict.

The incident owner should also check feature freshness. A model can make bad predictions because a feature feed broke:

```sql
SELECT
  feature_name,
  MAX(event_time) AS last_update,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(event_time), MINUTE) AS age_minutes,
  COUNT(*) AS rows_seen
FROM warehouse.feature_freshness
WHERE feature_group IN ("catalog_item_metadata", "dietary_flags", "substitution_pairs")
GROUP BY feature_name
ORDER BY age_minutes DESC;
```

If dietary flags are stale, the fix may be data rollback or feature refresh. If features are fresh and version 42 alone changed behavior, model rollback or threshold containment is more likely.

![Find the failing ShelfSwap segment](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/shelfswap-failing-segment.png)
*Segment analysis shows whether the incident needs a broad rollback or a focused guardrail for the risky product categories.*

## Choose A Containment Path
<!-- section-summary: Containment should reduce harm quickly while preserving enough evidence for the real fix. -->

Containment is the first production action that lowers harm. It does not need to explain the root cause. It needs to make the product safer and keep the evidence trail intact.

ShelfSwap has four realistic containment paths:

| Path | Action | Expected effect | Risk |
|---|---|---|---|
| Disable auto-accept for dietary-sensitive substitutions | Route those cases to picker review or refund | Stops unsafe automatic decisions | Review queue may grow |
| Lower the auto-accept threshold | Require stronger confidence for automatic replacements | Reduces low-quality substitutions | More refunds or review work |
| Move registry alias back to version 41 | Serve the previous model | Restores known behavior if model 42 caused issue | Loses any real improvements in 42 |
| Roll back feature feed | Restore previous item metadata or feature table | Fixes feature-caused issue | Data rollback can affect other models |

A safe first action can combine a guardrail and an alias decision:

```yaml
containment:
  action_1:
    type: policy_guardrail
    rule: disable_auto_accept_for_dietary_sensitive_substitutions
    owner: substitutions-product
    expected_time_minutes: 5
  action_2:
    type: registry_alias_rollback
    model_name: substitution_ranker
    alias: champion
    from_version: "42"
    to_version: "41"
    owner: ml-platform-oncall
    expected_time_minutes: 10
  verification:
    - dietary_mismatch_rate_below_0_005
    - picker_override_rate_returns_to_baseline_band
    - support_ticket_rate_declines
```

If the system uses MLflow model aliases, the alias move should be recorded with an incident tag or release note. If the team uses Databricks Unity Catalog models, the same idea applies: move the serving alias or deployment target in the governed registry workflow, then record who approved the movement and why.

The key habit is to make the action reversible. A rushed change hidden in a manual console click creates a second incident later. Use a tracked config change, a registry alias event, a deployment event, or an incident command log.

## Add Human Review And Fallbacks
<!-- section-summary: Human review and fallback rules keep high-risk decisions moving while the model team investigates. -->

Bad predictions rarely require the whole product to stop. A good system has fallback choices. ShelfSwap can send high-risk substitutions to picker review, ask the customer in the app, or refund the item. Each fallback has a cost, so the incident team should choose based on customer safety and operational capacity.

Here is a temporary policy patch:

```yaml
temporary_policy_patch:
  incident_id: inc-2026-07-05-substitutions
  expires_at: "2026-07-06T12:00:00Z"
  rules:
    - name: dietary_sensitive_review
      when:
        any_ordered_flag:
          - gluten_free
          - vegan
          - halal
          - nut_free
      action: route_to_picker_review
      fallback_if_queue_wait_minutes_above: 8
      fallback_action: refund
    - name: auto_accept_threshold_raise
      when:
        category:
          - bakery
          - dairy
          - prepared_meals
      set_min_score: 0.92
  owner: substitutions-product
  approver: incident-commander
```

The expiration field matters. Temporary mitigations tend to stay forever when nobody names the cleanup time. An expiring policy forces the team to revisit the issue after the model or feature fix lands.

Human review needs its own monitoring. A mitigation that protects prediction quality can still overload store pickers:

```sql
SELECT
  store_region,
  COUNT(*) AS review_items,
  APPROX_QUANTILES(review_wait_minutes, 100)[OFFSET(95)] AS p95_wait_minutes,
  AVG(CASE WHEN fallback_action = "refund" THEN 1 ELSE 0 END) AS refund_rate
FROM warehouse.substitution_review_queue
WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
GROUP BY store_region
ORDER BY p95_wait_minutes DESC;
```

If review wait time rises too much, the product owner may choose refunds for the riskiest categories. That is a product tradeoff, and it should be explicit.

## Collect The Repair Packet
<!-- section-summary: The repair packet turns an incident into a focused model, data, or policy fix. -->

Once containment is in place, the team needs a repair packet. This packet helps the model owner reproduce the issue and decide whether the fix belongs in data, training, evaluation, policy, or serving.

A useful repair packet includes:

| Evidence | Why it matters |
|---|---|
| Current and previous model versions | Shows which release introduced the behavior |
| Decision log samples | Shows real product inputs and outputs |
| Segment metrics | Shows where the issue concentrates |
| Feature freshness and drift report | Separates model behavior from input-data problems |
| Policy config before and after mitigation | Shows how product decisions changed |
| Human review outcomes | Shows what expert reviewers chose |
| Customer rejection and support-ticket samples | Shows user-facing harm |

The model team can add a focused evaluation slice:

```yaml
eval_slice:
  name: dietary_sensitive_substitutions
  source: warehouse.substitution_decisions
  filters:
    ordered_dietary_flags:
      - gluten_free
      - vegan
      - halal
      - nut_free
  minimum_examples: 5000
  metrics:
    - top_1_category_match_rate
    - dietary_flag_match_rate
    - customer_reject_rate
    - picker_override_rate
  release_gate:
    dietary_flag_match_rate_min: 0.995
    customer_reject_rate_max_delta: 0.02
```

That slice should join the normal release gate. The next version should pass the general metric and the incident-specific metric. Otherwise, the same failure can return under a better average score.

## Verify Recovery
<!-- section-summary: Recovery means the harmful decision path returns to a safe band, and the temporary mitigation has an owner. -->

After containment, keep watching the same signals that triggered the incident. A service rollback is only successful when the product outcome recovers.

ShelfSwap can use this recovery checklist:

| Check | Target |
|---|---|
| Dietary mismatch rate | Below 0.5 percent for 60 minutes |
| Customer rejection rate | Back inside baseline band |
| Picker override rate | Back inside baseline band or explained by policy |
| Review queue wait | p95 below 8 minutes |
| Support tickets | New tickets declining for affected categories |
| Alias/deployment state | Version 41 or patched policy recorded as active |
| Follow-up owner | Named model/data owner for permanent fix |

The final incident note should name the current production state:

```yaml
recovery:
  production_model_alias: champion -> version 41
  temporary_policy: dietary_sensitive_review
  temporary_policy_expiry: "2026-07-06T12:00:00Z"
  repair_owner: catalog-ml-team
  next_release_gate_added: dietary_sensitive_substitutions
  incident_status: mitigated
```

That note prevents confusion the next morning. Everyone can see whether the system is running on rollback, temporary policy, or permanent repair.

![ShelfSwap containment and repair loop](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/shelfswap-containment-repair-loop.png)
*The response loop protects shoppers first, then turns the incident evidence into a stronger release gate for the next model.*

## Putting It Together
<!-- section-summary: Handling bad predictions means protecting the product first, then repairing the model with evidence. -->

Bad predictions are production incidents because they change real decisions. The service can stay healthy while the product gets worse. ShelfSwap's substitution model showed that clearly: the endpoint stayed up while dietary-sensitive replacements turned unsafe.

The response path is practical. Measure impact, find the failing segment, choose containment, add human review or fallback rules, collect a repair packet, and verify recovery with product metrics. Some incidents need model rollback. Some need feature rollback. Some need a temporary policy patch while the model team retrains or adds a missing evaluation slice.

The useful habit is to keep product safety and evidence together. A quick mitigation protects users. A clean incident packet helps the team repair the system instead of repeating the same failure in the next release.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [Databricks Manage Model Lifecycle In Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [OpenTelemetry HTTP Metrics Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [scikit-learn Model Evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html)
