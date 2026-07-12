---
title: "ML A/B Testing"
description: "Compare model versions with controlled product experiments, stable assignment, guardrail metrics, delayed labels, and clear analysis before widening traffic."
overview: "ML A/B testing compares model behavior through user impact, not only offline scores. This tutorial follows a subscription music recommendation model through experiment design, assignment, metrics, SQL analysis, guardrails, delayed labels, and release decisions."
tags: ["MLOps", "production", "delivery"]
order: 2
id: "article-mlops-deployment-and-release-management-ab-testing-for-ml-products"
---

## Table of Contents

1. [A/B Testing Answers A Product Question](#ab-testing-answers-a-product-question)
2. [Follow One Recommendation Experiment](#follow-one-recommendation-experiment)
3. [Define The Unit, Variants, And Eligibility](#define-the-unit-variants-and-eligibility)
4. [Assign Users And Keep The Assignment Stable](#assign-users-and-keep-the-assignment-stable)
5. [Choose Metrics Before The First User Enters](#choose-metrics-before-the-first-user-enters)
6. [Analyze The Experiment With Segments And Delayed Labels](#analyze-the-experiment-with-segments-and-delayed-labels)
7. [Turn The Result Into A Release Decision](#turn-the-result-into-a-release-decision)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## A/B Testing Answers A Product Question
<!-- section-summary: ML A/B testing compares model versions by measuring user and business outcomes under controlled assignment. -->

**ML A/B testing** is a controlled experiment that sends eligible users or requests to different model versions, then compares the outcomes that matter to the product. A canary mainly protects the service while a release is underway. An A/B test asks whether the candidate model improves the product for real users without breaking guardrails.

The title answer is direct: A/B testing for ML products helps a team decide whether a model change should ship, roll back, or stay in research. Offline evaluation can say that a model scored better on historical data. A/B testing checks how users respond when the model changes the live product. That matters because recommendation, ranking, fraud, pricing, and personalization models influence behavior. Users may click differently, wait longer, complain, ignore prompts, or buy more.

This article builds on the release strategy article. Blue-green, canary, and shadow control traffic. A/B testing adds experiment design and product analysis. The model version still needs stable labels, logs, alerts, and rollback. The new piece is the experiment record: who was eligible, which variant they received, which metrics counted, and how the team made the decision.

## Follow One Recommendation Experiment
<!-- section-summary: The running scenario follows a music recommendation model where click gains can hide retention or fairness problems. -->

Imagine **SoundGarden**, a subscription music app. The home page has a "Because you listened to" rail. The current model, `home-rec:v12`, mixes familiar artists, new releases, and discovery picks. The candidate, `home-rec:v13`, uses a new sequence model trained on recent listening sessions.

Offline ranking metrics improved for `v13`. In replay, users would have received more songs from artists they have never played before. Product likes that because discovery drives long-term retention. The team still worries about a few risks. A more adventurous model could reduce immediate plays. It could over-recommend one genre to new users. It could increase skips, which annoys listeners and weakens the training signal for the next model.

SoundGarden wants to answer one product question:

| Experiment question | Candidate success signal |
|---|---|
| Should `home-rec:v13` replace `v12` on the home page discovery rail? | Increase seven-day saved-track rate without raising skips, app exits, latency, or complaint rate |

That question is narrower than "is the model better?" A real A/B test needs one clear product decision. If the decision is vague, every metric can tell a different story and the team can spend days arguing after the experiment ends.

![SoundGarden experiment design](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/soundgarden-experiment-design.png)

*SoundGarden splits eligible listeners into stable control and treatment groups, then reads product and service guardrails from the same experiment logs.*

## Define The Unit, Variants, And Eligibility
<!-- section-summary: A useful experiment names the assignment unit, the model variants, and the users or requests that can safely enter. -->

The **assignment unit** is the thing that gets placed into a variant. For SoundGarden, the unit should be the user account, not a single page view. If the same listener sees `v12` in the morning and `v13` in the evening, their behavior mixes both experiences. A stable user-level assignment keeps the comparison cleaner.

The **variants** are the experiences being compared. SoundGarden has a control and a treatment:

| Variant | Model | Experience |
|---|---|---|
| Control | `home-rec:v12` | Current production recommendation rail |
| Treatment | `home-rec:v13` | Candidate sequence model with the same API contract |

The **eligibility rules** decide who can enter the experiment. SoundGarden excludes child accounts, users in regions where recommendation consent has a different policy, and accounts with fewer than three listening sessions. Those exclusions should live in the experiment config because they affect the analysis. The team also keeps paid and trial users in separate segments, because trial users may react differently to discovery.

An experiment config can be simple and reviewable:

```yaml
experiment:
  key: home_rec_v13_discovery
  owner: recommendations@soundgarden.example
  start_after_utc: "2026-07-08T10:00:00Z"
  assignment_unit: user_id
  allocation:
    control:
      model_uri: models:/prod_ml.music.home_rec/12
      traffic_percent: 50
    treatment:
      model_uri: models:/prod_ml.music.home_rec/13
      traffic_percent: 50
  eligibility:
    min_listening_sessions: 3
    exclude_account_types:
      - child
    included_regions:
      - US
      - CA
      - GB
  segments:
    - plan_type
    - region
    - signup_age_bucket
    - primary_genre
```

The model URI gives each variant a concrete artifact. The assignment unit tells engineering how to route users. The segments tell analysis which cuts must be reviewed before the decision. This config should ship through code review like a deployment manifest.

## Assign Users And Keep The Assignment Stable
<!-- section-summary: Stable assignment ensures a user keeps the same variant so product outcomes can be tied to one model experience. -->

**Experiment assignment** is the routing step that chooses a variant for an eligible unit. The assignment must be stable. If user `u_124` enters treatment today, they should keep treatment for the duration of the experiment unless the team stops the test. Stability protects the user experience and protects the analysis.

Many teams use a feature flag or experiment service for assignment. The key idea is deterministic bucketing. The service hashes the experiment key and user ID, maps the hash into a bucket, and returns `control` or `treatment`. That assignment is also logged so analysts can join outcomes later.

A small assignment function can show the shape:

```python
import hashlib


def assign_variant(experiment_key: str, user_id: str) -> str:
    raw = f"{experiment_key}:{user_id}".encode("utf-8")
    bucket = int(hashlib.sha256(raw).hexdigest()[:8], 16) % 100
    if bucket < 50:
        return "control"
    return "treatment"
```

Production code usually has more controls: overrides for internal testers, holdout groups, kill switches, and audit logs. The core requirement stays the same. The same user should land in the same variant, and every prediction event should record that variant.

The recommendation response should carry experiment fields:

```json
{
  "user_id": "u_124",
  "rail_id": "because_you_listened",
  "experiment_key": "home_rec_v13_discovery",
  "variant": "treatment",
  "model_name": "home-rec",
  "model_version": "13",
  "trace_id": "8f7b2c9b..."
}
```

Those fields connect product events, service metrics, and traces. OpenTelemetry trace IDs help the team follow a slow recommendation request across the API, feature service, and model server. Prometheus metrics can show service health by variant if the service emits labels carefully and keeps label cardinality under control.

## Choose Metrics Before The First User Enters
<!-- section-summary: Experiment metrics should include one primary outcome plus guardrails for user harm, model behavior, and service health. -->

Metrics should be written before the experiment starts. If the team chooses metrics after seeing the results, the analysis turns into a search for a story. SoundGarden writes one primary metric, a few guardrails, and several diagnostic metrics.

The **primary metric** is the main success measure. For SoundGarden, that is `saved_tracks_per_user_7d`, because saving a track is stronger than a quick click and fits the discovery goal. The **guardrail metrics** protect areas the team refuses to harm, such as skip rate, app exit rate, p95 latency, and complaint rate. **Diagnostic metrics** help explain the result, such as genre diversity, new-artist exposure, and cold-start behavior.

| Metric type | Metric | Decision use |
|---|---|---|
| Primary | Saved tracks per eligible user over seven days | Main success measure |
| Guardrail | Skip rate in first 30 seconds | Stop or reject if it rises past threshold |
| Guardrail | p95 recommendation latency | Stop if treatment hurts page load |
| Guardrail | Complaint or "hide artist" rate | Reject if treatment increases negative feedback |
| Diagnostic | New-artist exposure per user | Explains discovery behavior |
| Diagnostic | Genre concentration by segment | Finds over-personalization or segment issues |

The metric definitions should be concrete enough for SQL. A dashboard title such as "engagement" is too vague. A definition such as "saved tracks within seven days of assignment divided by eligible users assigned to the variant" is reviewable.

SoundGarden stores assignment and product events in warehouse tables:

| Table | Important fields |
|---|---|
| `experiment_assignments` | `experiment_key`, `user_id`, `variant`, `assigned_at_utc`, `model_version` |
| `recommendation_impressions` | `user_id`, `trace_id`, `variant`, `model_version`, `shown_at_utc`, `rail_id` |
| `listening_events` | `user_id`, `track_id`, `event_name`, `event_time_utc`, `listen_seconds` |
| `user_feedback_events` | `user_id`, `event_name`, `artist_id`, `event_time_utc` |

This schema is part of the release system. If variant or model version is missing from product events, the analysis gets weaker. The experiment can still route traffic, but the team loses evidence.

## Analyze The Experiment With Segments And Delayed Labels
<!-- section-summary: ML experiment analysis needs assignment checks, segment review, delayed outcomes, and guardrail comparisons. -->

The first analysis check is **sample ratio mismatch**. That means the observed split between control and treatment differs from the planned split. A 50/50 experiment with 49.8 percent treatment is probably fine. A 65/35 split may mean eligibility, caching, or assignment logging broke.

A simple assignment check looks like this:

```sql
SELECT
  variant,
  COUNT(DISTINCT user_id) AS assigned_users,
  COUNT(DISTINCT user_id) * 1.0
    / SUM(COUNT(DISTINCT user_id)) OVER () AS share
FROM experiment_assignments
WHERE experiment_key = 'home_rec_v13_discovery'
GROUP BY variant;
```

After assignment looks healthy, compare the primary metric and guardrails. This query builds a seven-day saved-track rate by variant:

```sql
WITH assigned AS (
  SELECT
    user_id,
    variant,
    assigned_at_utc
  FROM experiment_assignments
  WHERE experiment_key = 'home_rec_v13_discovery'
),
saves AS (
  SELECT
    a.user_id,
    a.variant,
    COUNTIF(e.event_name = 'track_saved') AS saved_tracks_7d
  FROM assigned a
  LEFT JOIN listening_events e
    ON e.user_id = a.user_id
   AND e.event_time_utc >= a.assigned_at_utc
   AND e.event_time_utc < TIMESTAMP_ADD(a.assigned_at_utc, INTERVAL 7 DAY)
  GROUP BY a.user_id, a.variant
)
SELECT
  variant,
  COUNT(*) AS users,
  AVG(saved_tracks_7d) AS avg_saved_tracks_7d,
  APPROX_QUANTILES(saved_tracks_7d, 100)[OFFSET(50)] AS median_saved_tracks_7d
FROM saves
GROUP BY variant;
```

The query uses assignment time as the anchor. That avoids counting saves from before the user entered the experiment. It also leaves room for delayed outcomes. A user assigned today may need seven full days before the primary metric is final.

Segments matter because a total win can hide a local problem. SoundGarden reviews trial users, paid users, new users, long-time subscribers, and primary genre groups. If treatment improves total saves but harms new jazz listeners through repeated recommendations, the team should inspect that segment before ramping.

Guardrails can use faster windows. Latency and errors should page during the experiment, not after seven days. Prometheus alerting rules can watch the treatment service while the product analysis waits for delayed labels:

```yaml
groups:
  - name: recommendation-experiment
    rules:
      - alert: TreatmentRecommendationLatencyHigh
        expr: |
          histogram_quantile(
            0.95,
            sum by (le) (
              rate(http_request_duration_seconds_bucket{
                service_name="home-rec-api",
                experiment_key="home_rec_v13_discovery",
                variant="treatment"
              }[5m])
            )
          ) > 0.20
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "Treatment recommendation p95 latency is above 200 ms"
```

This alert protects the user request path while the experiment continues. The final decision still needs product metrics, but service health should never wait for the experiment readout.

![From assignment to seven-day readout](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/assignment-to-seven-day-readout.png)

*The assignment table, recommendation impressions, listening events, and feedback events connect a day-zero variant to the seven-day saved-track readout.*

## Turn The Result Into A Release Decision
<!-- section-summary: The experiment result should lead to ship, stop, iterate, or rerun, with the decision tied to metrics and review evidence. -->

An A/B test should end with a decision record. SoundGarden wants one of four outcomes: ship `v13`, stop and keep `v12`, iterate on a new `v14`, or rerun because the experiment evidence was invalid. The decision should name the metric movement, guardrails, affected segments, and release action.

A decision packet can look like this:

```yaml
experiment_result:
  experiment_key: home_rec_v13_discovery
  decision: ship_with_25_percent_ramp
  control_model_version: 12
  treatment_model_version: 13
  primary_metric:
    name: saved_tracks_per_user_7d
    relative_lift: 0.034
  guardrails:
    skip_rate_30s: pass
    app_exit_rate: pass
    p95_latency: pass
    complaint_rate: pass
  segment_notes:
    trial_users: "positive lift, wider uncertainty"
    primary_genre_jazz: "neutral, no guardrail breach"
  next_release_action:
    rollout: canary
    first_step: 25
    rollback_model: 12
```

The release action should still use the release strategy controls from the previous article. A winning A/B test does not require an instant full rollout. SoundGarden can promote `v13` to a canary, continue watching guardrails, then move the registry alias after production signals stay healthy.

The clean habit is to keep the experiment record, dashboard link, analysis notebook or SQL file, model versions, and release manifest together. Future incidents and future model work will ask why `v13` shipped. The answer should live in evidence, not in a chat thread.

![Experiment result to release action](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/experiment-result-release-action.png)

*The decision packet turns metric lift, guardrail status, segment review, and rollback planning into one release action for `home-rec:v13`.*

## Putting It Together
<!-- section-summary: ML A/B testing connects model versions to product outcomes through stable assignment, prewritten metrics, and decision evidence. -->

ML A/B testing helps SoundGarden decide whether a better offline model should change the live product. The team defines the product question, assigns users stably, logs model and variant fields, chooses metrics before launch, checks assignment quality, analyzes delayed outcomes, reviews segments, and turns the result into a release action.

The important shift is from model score to user impact. Offline metrics help pick candidates. Canary protects the release path. A/B testing shows whether real users and the business gain from the model change while guardrails keep harm visible.

## References

- [OpenTelemetry: HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/)
- [OpenTelemetry: HTTP metrics semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [Prometheus: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus: Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
