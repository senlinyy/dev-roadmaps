---
title: "ML A/B Testing"
description: "Compare model versions with controlled product experiments, stable assignment, guardrail metrics, delayed labels, and clear analysis before widening traffic."
overview: "ML A/B testing compares model behavior through user impact, not only offline scores. A supporting example follows a subscription music recommendation model through experiment design, assignment, metrics, SQL analysis, guardrails, delayed labels, and release decisions."
tags: ["MLOps", "production", "delivery"]
order: 3
id: "article-mlops-deployment-and-release-management-ab-testing-for-ml-products"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/release-strategies/02-ab-testing-for-ml-products.md
  - child-release-strategies-02-ab-testing-for-ml-products
---


## A/B Testing Answers A Product Question
<!-- section-summary: ML A/B testing compares model versions by measuring user and business outcomes under controlled assignment. -->

**ML A/B testing** is a controlled experiment that sends eligible users or requests to different model versions, then compares the outcomes that matter to the product. A canary mainly protects the service while a release is underway. An A/B test asks whether the candidate model improves the product for real users without breaking guardrails.

The title answer is direct: A/B testing for ML products helps a team decide whether a model change should ship, roll back, or stay in research. Offline evaluation can say that a model scored better on historical data. A/B testing checks how users respond when the model changes the live product. That matters because recommendation, ranking, fraud, pricing, and personalization models influence behavior. Users may click differently, wait longer, complain, ignore prompts, or buy more.

This article builds on the release strategy article. Blue-green, canary, and shadow control traffic. A/B testing adds experiment design and product analysis. The model version still needs stable labels, logs, alerts, and rollback. The new piece is the experiment record: who was eligible, which variant they received, which metrics counted, and how the team made the decision.

## A Supporting Example: Recommendation Experiment
<!-- section-summary: A supporting example follows a music recommendation model where click gains can hide retention or fairness problems. -->

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

The model **Uniform Resource Identifier (URI)** gives each variant a concrete artifact location or registry reference. The assignment unit tells engineering how to route users. The segments tell analysis which cuts must be reviewed before the decision. This config should ship through code review like a deployment manifest.

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

The **primary metric** is the main success measure. For SoundGarden, that is `saved_tracks_per_user_7d`, because saving a track is stronger than a quick click and fits the discovery goal. The **guardrail metrics** protect areas the team refuses to harm, such as skip rate, app exit rate, 95th-percentile (**p95**) latency, and complaint rate. P95 is the response time that 95 percent of requests meet or beat. **Diagnostic metrics** help explain the result, such as genre diversity, new-artist exposure, and cold-start behavior.

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

## Plan Sample Size And A Stopping Rule
<!-- section-summary: A trustworthy experiment sets its detectable effect, power, duration, and stopping rule before assignment starts. -->

An experiment needs enough independent units to distinguish a useful effect from normal variation. The **minimum detectable effect (MDE)** is the smallest improvement that would justify changing the product. SoundGarden chooses an MDE of `0.08` saved tracks per eligible user over seven days. A smaller lift would not cover the engineering and editorial cost of operating the new ranker.

**Statistical power** is the probability that the planned analysis detects an effect of at least the MDE when that effect really exists. Teams commonly plan for 80% or 90% power and a 5% false-positive rate, then adjust for expected exclusions and missing outcomes. The calculation needs a historical estimate of metric variance. A heavy-tailed count metric such as saved tracks can require a bootstrap simulation or a variance-reduction method rather than a simple normal formula.

SoundGarden runs this planning simulation on historical user-level rows:

```python
import numpy as np

rng = np.random.default_rng(20260712)
historical = user_metrics["saved_tracks_7d"].to_numpy()

def simulated_power(users_per_arm: int, mde: float, repetitions: int = 2_000) -> float:
    detected = 0
    for _ in range(repetitions):
        control = rng.choice(historical, users_per_arm, replace=True)
        treatment = rng.choice(historical, users_per_arm, replace=True) + mde
        delta = treatment.mean() - control.mean()
        pooled_se = np.sqrt(
            control.var(ddof=1) / users_per_arm
            + treatment.var(ddof=1) / users_per_arm
        )
        detected += delta / pooled_se > 1.959964
    return detected / repetitions

for n in (25_000, 50_000, 75_000, 100_000):
    print(n, simulated_power(n, mde=0.08))
```

The production analysis should use a reviewed statistics package and analysis plan; this simulation exposes the inputs so beginners can see why sample size depends on variance, MDE, false-positive tolerance, and desired power. SoundGarden records `75,000` mature users per arm, a minimum fourteen-day enrollment period to cover weekday and weekend behavior, and seven more days for the final cohort's outcome window.

The plan also defines stopping rules. Safety guardrails can stop traffic immediately. A normal success decision waits for the prewritten sample size and maturity window. The team avoids stopping on the first positive dashboard because repeated daily looks increase the chance of seeing a lucky result. If the business needs continuous monitoring for success, a statistician selects a sequential design with adjusted boundaries before launch.

```yaml
analysis_plan:
  unit: user_id
  primary_metric: saved_tracks_per_eligible_user_7d
  minimum_detectable_effect: 0.08
  power: 0.90
  two_sided_alpha: 0.05
  required_mature_users_per_arm: 75000
  minimum_enrollment_days: 14
  outcome_maturity_days: 7
  success_readout: once_after_maturity
  safety_stop:
    skip_rate_absolute_increase: 0.015
    complaint_rate_relative_increase: 0.20
    recommendation_p95_ms: 200
```

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

## Handle Uncertainty, Repeated Looks, And Interference
<!-- section-summary: Confidence intervals, a prewritten comparison set, novelty checks, and interference review keep a positive lift from turning into a premature launch. -->

A point estimate such as `+3.4% relative lift` leaves out how uncertain that result is. SoundGarden reports the **absolute treatment effect** first, which is treatment mean minus control mean, plus a 95% confidence interval. A confidence interval built by a valid procedure would contain the true effect in about 95% of repeated experiments under the procedure's assumptions. The frequentist interpretation describes that repeated procedure rather than assigning a 95% probability to this one fixed interval.

The same users create the control and treatment outcome distributions, so the analysis resamples user rows inside each arm and computes a bootstrap interval for the mean difference:

```python
from scipy.stats import bootstrap
import numpy as np

control = mature_users.loc[mature_users.variant == "control", "saved_tracks_7d"].to_numpy()
treatment = mature_users.loc[mature_users.variant == "treatment", "saved_tracks_7d"].to_numpy()

def mean_difference(control_sample, treatment_sample, axis=-1):
    return np.mean(treatment_sample, axis=axis) - np.mean(control_sample, axis=axis)

result = bootstrap(
    (control, treatment),
    mean_difference,
    paired=False,
    confidence_level=0.95,
    n_resamples=20_000,
    method="BCa",
    rng=np.random.default_rng(20260712),
)

print(float(mean_difference(control, treatment)))
print(result.confidence_interval)
```

The experiment ships only when the interval excludes harmful values and the lower bound clears the smallest useful improvement recorded in the analysis plan. A p-value alone cannot answer whether the improvement is large enough to matter.

Multiple comparisons need the same discipline. SoundGarden has one primary metric, so it avoids selecting the best result from twenty engagement measures. The four guardrails each have prewritten harm thresholds. Segment analyses are diagnostic unless the plan names a segment as a decision gate and adjusts the error control. If the team tests many model variants or many primary outcomes, it should use a documented family-wise or false-discovery procedure with statistical review.

Two product effects can also invalidate a clean-looking estimate. **Novelty effects** happen when users react to a changed experience because it is new; the team plots effect by cohort week and checks whether the lift decays. **Interference** happens when one user's treatment affects another user's outcome. Playlist sharing and collaborative queues can cross variant boundaries. For a strongly social feature, SoundGarden may randomize households or friendship clusters, or limit the claim to isolated listening surfaces. Randomizing individual users while ignoring those links would overstate the independence of the observations.

The final review asks five questions:

- Did assignment pass the sample-ratio check and remain stable?
- Did every cohort receive its complete seven-day outcome window?
- Does the confidence interval exclude both zero and the prewritten practical floor?
- Did any guardrail or prewritten segment fail after the planned comparison adjustment?
- Did novelty, network interference, instrumentation changes, or concurrent launches weaken the causal claim?

These checks give the release owner a defensible result. They also allow an honest `inconclusive` decision when the interval stays wide. Extending or rerunning an experiment under a new plan can be the correct engineering choice.

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
  assignment_check:
    sample_ratio_mismatch: pass
    stable_user_assignment: pass
  maturity:
    users_per_arm: 78214
    all_users_have_complete_7d_window: true
    stopping_rule_followed: true
  primary_metric:
    name: saved_tracks_per_user_7d
    absolute_effect: 0.10
    relative_lift: 0.043
    confidence_interval_95: [0.083, 0.117]
    practical_effect_floor: 0.08
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
- [SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)
- [NIST: Selecting sample sizes](https://www.itl.nist.gov/div898/handbook/prc/section2/prc222.htm)
- [Microsoft Research: Diagnosing Sample Ratio Mismatch](https://www.microsoft.com/en-us/research/publication/diagnosing-sample-ratio-mismatch-in-online-controlled-experiments-a-taxonomy-and-rules-of-thumb-for-practitioners/)
- [Microsoft Research: External validity and novelty in online experiments](https://www.microsoft.com/en-us/research/articles/external-validity-of-online-experiments-can-we-predict-the-future/)
