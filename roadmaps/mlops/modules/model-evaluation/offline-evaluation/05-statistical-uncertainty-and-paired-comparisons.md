---
title: "Statistical Uncertainty and Paired Model Comparisons"
description: "Measure uncertainty in offline model metrics with paired bootstrap intervals, permutation tests, cluster-aware resampling, and practical release gates."
overview: "Offline metrics come from a finite evaluation sample. A supporting example follows a hospital triage team as it compares two classifiers on the same patients, builds paired confidence intervals, checks a permutation test, handles dependent rows, and writes an uncertainty-aware release packet."
tags: ["MLOps", "evaluation", "statistics"]
order: 5
id: "article-mlops-model-evaluation-statistical-uncertainty-paired-comparisons"
aliases:
  - roadmaps/mlops/modules/model-evaluation/offline-evaluation/04-statistical-uncertainty-and-paired-comparisons.md
---


## Offline Scores Carry Sampling Uncertainty
<!-- section-summary: An offline metric estimates future behavior from a finite sample, so a release review needs the estimate and a defensible description of its uncertainty. -->

**Statistical uncertainty** describes how much an evaluation result could vary because the team observed a finite sample instead of every future case. A candidate can show recall of `0.862` on one holdout dataset and `0.848` on another equally valid sample. Both values can come from the same underlying model behavior.

This matters during release decisions. A dashboard may show a candidate ahead of production by `0.6` percentage points. That difference may reflect a repeatable improvement, normal sample variation, or a data problem. A confidence interval helps reviewers see a range of effects supported by the evaluation procedure. A hypothesis test answers a related question about compatibility with a stated null hypothesis. Product risk, **effect size**—the measured size of the candidate's change—and segment evidence still decide whether the model should ship.

The practical workflow has five parts:

| Part | Question | Review artifact |
|---|---|---|
| Estimand | Which exact difference matters? | Candidate-minus-baseline recall at a fixed workload |
| Pairing | Did both models score the same units? | One row with both predictions |
| Interval | How precise is the estimated difference? | 95% paired bootstrap interval |
| Assumptions | Which units can be treated as independent? | Patient-level or hospital-day resampling plan |
| Decision | Which effects are useful or harmful? | Practical floor, safety guardrails, and outcome |

An **estimand** is the exact quantity the team wants to estimate. Giving it a name prevents a review from drifting between overall AUC, threshold recall, and a hand-picked segment. This article estimates the change in emergency-case recall while holding the review workload near its approved limit.

## A Supporting Example: Triage Model Review
<!-- section-summary: The running review compares a candidate and production classifier on the same patients with a threshold policy tied to nurse-review capacity. -->

HarborCare routes incoming telehealth cases to an urgent nurse queue. Production model `triage:v21` and candidate `triage:v22` assign a risk score. The policy chooses a threshold that sends at most 18 percent of eligible cases to urgent review. Missing an emergency case creates patient risk, while sending too many low-risk cases can overwhelm the queue.

The frozen evaluation dataset contains 84,200 encounters from eight hospitals. Each row has a patient encounter ID, hospital, service day, mature emergency label, protected evaluation segment, baseline score, and candidate score. The dataset manifest records the extraction time, label maturity rule, exclusions, and content hash.

```csv
encounter_id,hospital_id,service_day,emergency_label,age_band,baseline_score,candidate_score
enc_001,hosp_03,2026-06-02,1,65_plus,0.81,0.88
enc_002,hosp_03,2026-06-02,0,18_39,0.22,0.19
enc_003,hosp_07,2026-06-02,1,40_64,0.61,0.67
```

HarborCare prewrites these decision quantities:

- primary effect: candidate recall minus baseline recall at each model's approved workload threshold;
- practical floor: at least `+0.5` percentage points of recall improvement;
- safety boundary: the 95% interval lower bound must stay above `-0.2` percentage points;
- workload guardrail: urgent-review rate stays between 17.5 and 18.5 percent;
- segment guardrails: no hospital or age band loses more than 1.0 percentage point of recall when support is sufficient.

The practical floor prevents a tiny, expensive change from shipping only because a large dataset produced a narrow interval. The safety boundary protects against meaningful regression. These values need clinical, operational, and statistical review before anyone looks at the candidate result.

## Keep Candidate And Baseline Predictions Paired
<!-- section-summary: A paired comparison preserves the fact that each evaluation unit received both model predictions and removes variation shared by the two scores. -->

A **paired comparison** keeps the baseline and candidate result for the same unit together. Encounter `enc_001` may be unusually difficult, yet that difficulty affects both models. The useful evidence is the difference in how the two models handled that encounter, not a comparison between unrelated patient samples.

HarborCare creates one table and checks its keys before calculating metrics:

```python
import pandas as pd

scores = pd.read_parquet("harborcare_triage_holdout_2026_06.parquet")

assert scores["encounter_id"].is_unique
assert scores[["emergency_label", "baseline_score", "candidate_score"]].notna().all().all()
assert scores["emergency_label"].isin([0, 1]).all()

baseline_threshold = 0.58
candidate_threshold = 0.61
scores["baseline_decision"] = scores["baseline_score"] >= baseline_threshold
scores["candidate_decision"] = scores["candidate_score"] >= candidate_threshold
```

The thresholds differ because each model has a different score distribution. The policy compares them under the same workload constraint rather than forcing the same numeric threshold. The release packet records both threshold-selection rules and uses a separate tuning split so the final holdout does not choose the threshold and judge it.

Pairing also catches data bugs. A join that drops candidate failures can make the candidate appear stronger. HarborCare checks row count, key uniqueness, label equality, missingness, and exact dataset-manifest identity before calculation. A mismatch blocks the report.

## Build A Paired Bootstrap Confidence Interval
<!-- section-summary: A paired bootstrap resamples evaluation units with replacement and recalculates the metric difference to estimate its sampling distribution. -->

The **bootstrap** repeatedly samples rows from the observed evaluation set with replacement. Each resample has the same number of rows as the original. The metric difference across thousands of resamples forms an estimated sampling distribution. SciPy provides percentile, basic, and bias-corrected and accelerated methods; its default BCa method adjusts for bias and skew in the bootstrap distribution.

The statistic below returns candidate recall minus baseline recall. `paired=True` tells SciPy to use the same sampled indices for labels and both prediction arrays:

```python
import numpy as np
from scipy.stats import bootstrap

y = scores["emergency_label"].to_numpy(dtype=int)
baseline = scores["baseline_decision"].to_numpy(dtype=bool)
candidate = scores["candidate_decision"].to_numpy(dtype=bool)

def recall_delta(y, baseline, candidate, axis=-1):
    positives = np.sum(y == 1, axis=axis)
    baseline_tp = np.sum((y == 1) & baseline, axis=axis)
    candidate_tp = np.sum((y == 1) & candidate, axis=axis)
    return candidate_tp / positives - baseline_tp / positives

result = bootstrap(
    (y, baseline, candidate),
    recall_delta,
    paired=True,
    vectorized=True,
    n_resamples=20_000,
    confidence_level=0.95,
    method="BCa",
    rng=np.random.default_rng(20260712),
)

observed = float(recall_delta(y, baseline, candidate))
interval = {
    "estimate": observed,
    "ci_low": float(result.confidence_interval.low),
    "ci_high": float(result.confidence_interval.high),
    "standard_error": float(result.standard_error),
}
```

Suppose the result is `+0.009` with interval `[+0.003, +0.015]`. The candidate improved recall by an estimated 0.9 percentage points, and the interval stays above the 0.5-point practical floor only at its point estimate, not at its lower bound. HarborCare can label this result `promising` while requiring more evidence for an automatic full release. A staged release may still make sense when other guardrails pass.

A confidence interval describes the behavior of the procedure across repeated samples. The common phrase “there is a 95 percent probability that the fixed true value lies in this computed interval” does not match the frequentist interpretation. The release packet uses plain wording: “Using the registered paired BCa bootstrap procedure, the 95% interval for candidate-minus-baseline recall was 0.3 to 1.5 percentage points.”

## Use A Permutation Test For A Different Question
<!-- section-summary: A paired permutation test estimates how unusual the observed difference would be if the two model labels were exchangeable under the null hypothesis. -->

A **permutation test** asks whether the observed statistic is compatible with a null hypothesis. For a paired model comparison, the null says the baseline and candidate outcomes are exchangeable within each evaluation unit. Randomly swapping the two decision columns within rows creates results expected under that null.

SciPy's `permutation_test` supports paired samples with `permutation_type="samples"`:

```python
from scipy.stats import permutation_test

positive_rows = scores.loc[scores["emergency_label"] == 1]
baseline_hits = positive_rows["baseline_decision"].to_numpy(dtype=float)
candidate_hits = positive_rows["candidate_decision"].to_numpy(dtype=float)

def mean_hit_delta(baseline_hits, candidate_hits, axis=-1):
    return np.mean(candidate_hits, axis=axis) - np.mean(baseline_hits, axis=axis)

test = permutation_test(
    (baseline_hits, candidate_hits),
    mean_hit_delta,
    permutation_type="samples",
    alternative="two-sided",
    n_resamples=50_000,
    rng=np.random.default_rng(20260712),
)
```

The p-value estimates how often the permutation procedure produces a statistic at least as extreme as the observed one under the null. It does not measure the probability that the candidate is good, the probability that the null is true, or the size of patient benefit. HarborCare keeps the confidence interval and practical thresholds as the main decision evidence. The permutation result is a consistency check registered before analysis.

The team avoids running many tests and reporting only the smallest p-value. That practice increases false discoveries and hides the comparison family from reviewers.

## Choose The Right Resampling Unit
<!-- section-summary: The resampling unit should follow the source of independence, which may be a patient, household, hospital day, site, or time block rather than one row. -->

Row-level bootstrap assumes encounters act like independent draws. HarborCare can have repeated encounters from one patient, shared staff conditions within a hospital day, or a temporary device outage affecting every case at one site. Treating all those rows as independent can make an interval too narrow.

The evaluation owner writes a dependence review:

| Dependence source | Possible unit | Reason |
|---|---|---|
| Repeat visits | `patient_id` | One patient's conditions connect encounters |
| Site operations | `(hospital_id, service_day)` | Staffing and device issues affect a daily cluster |
| Seasonal traffic | calendar week block | Nearby days share weather and respiratory outbreaks |
| Household product | `household_id` | Decisions can affect related users |

For this release, HarborCare resamples hospital-day clusters. Each sampled cluster contributes all its encounters and both model predictions. A custom cluster bootstrap builds a list of unique cluster keys, samples keys with replacement, concatenates their row indices, and calculates the metric. The report includes the row-level interval as a diagnostic and the wider cluster-aware interval as the release evidence.

Cluster choice requires subject-matter judgment. A cluster that is too broad can leave very few effective units and create unstable estimates. A cluster that is too narrow can ignore dependence. When only eight hospitals exist, a hospital-level interval has limited information. The team may add evaluation months, use a hierarchical analysis with statistical support, or treat site evidence as descriptive rather than claiming precision it cannot support.

## Handle Segments And Multiple Metrics
<!-- section-summary: Segment and metric families need prewritten priorities because many unplanned comparisons can produce convincing chance results. -->

Production reviews need segments. Emergency recall for older patients, language groups, and each hospital can matter more than the overall average. Every extra comparison also creates another opportunity for a chance extreme result. **Multiple-comparison control** describes procedures that limit false findings across a family of tests.

HarborCare separates comparisons into three groups:

1. The primary overall recall effect has one confidence interval and one decision floor.
2. Five prewritten safety segments have non-inferiority floors and family-wise review using a documented Holm adjustment.
3. Exploratory segments appear with intervals, support counts, and an explicit exploratory label. They can trigger investigation or another study, but they cannot alone justify a positive release claim.

The packet always shows denominators. A 12-point recall loss based on three positive cases needs urgent case review, yet its numerical estimate is unstable. The team combines minimum support rules with clinical review rather than hiding the segment.

Metrics receive the same structure. Recall is primary. Review workload and false-positive rate are guardrails. Calibration error and ROC AUC are diagnostic. A candidate cannot trade a failed safety guardrail for a strong AUC gain unless the governance process approved that trade before the run.

## Write An Uncertainty-Aware Release Gate
<!-- section-summary: A release gate combines interval bounds, practical importance, workload limits, segment safety, data validity, and an explicit inconclusive outcome. -->

HarborCare stores the decision policy as versioned configuration:

```yaml
uncertainty_release_gate:
  model: triage-risk
  baseline: v21
  candidate: v22
  dataset_manifest: harborcare-triage-holdout-2026-06@sha256:7c2f...
  resampling:
    unit: hospital_id_service_day
    method: paired_cluster_bootstrap
    confidence_level: 0.95
    resamples: 20000
    seed: 20260712
  primary:
    metric: emergency_recall_delta
    safety_lower_bound_min: -0.002
    practical_point_estimate_min: 0.005
  workload:
    urgent_review_rate_min: 0.175
    urgent_review_rate_max: 0.185
  segments:
    correction: holm
    max_recall_regression: 0.01
    minimum_positive_labels: 100
  outcomes:
    pass: eligible_for_clinical_canary
    fail: keep_v21_and_open_blocker
    inconclusive: collect_more_mature_labels
```

The `inconclusive` outcome is important. It gives reviewers a correct action when evidence cannot separate a useful gain from a harmful regression. Without that option, teams can pressure an uncertain result into pass or fail.

The gate also separates statistical approval from deployment approval. Passing allows a monitored clinical canary. It does not move the production alias automatically. The release owner still verifies serving latency, schema compatibility, rollback, monitoring, and human escalation.

## Run The Review And Investigate Failures
<!-- section-summary: A reproducible uncertainty job stores predictions, code, configuration, distributions, interval results, and failure evidence so reviewers can replay the decision. -->

The CI evaluation job runs in a pinned container and writes these artifacts:

- dataset manifest and join-quality checks;
- threshold-selection artifact from the separate tuning split;
- row-level and cluster-level point estimates;
- bootstrap distribution summary and confidence intervals;
- permutation result registered in the plan;
- segment table with supports and comparison-family labels;
- gate result, reviewer, code SHA, package lock hash, and timestamp.

When an interval is unexpectedly wide, the team checks effective cluster count, label prevalence, missing rows, threshold instability, and segment mixture. When row and cluster intervals differ sharply, shared site or time conditions deserve investigation. When the point estimate changes after a small data correction, the evaluation pipeline may be fragile.

The team never responds to a wide interval by increasing resamples. More bootstrap resamples reduce simulation noise in the interval calculation; they do not create more independent evaluation evidence. Collecting more representative labeled units, extending time coverage, or improving the experimental design addresses sampling uncertainty.

## Putting It Together
<!-- section-summary: Statistical uncertainty turns a model comparison from two dashboard numbers into a paired, assumption-aware, reproducible release decision. -->

HarborCare compares production and candidate predictions on the same patients, defines the metric difference before analysis, and uses paired resampling to preserve that relationship. The paired bootstrap reports an effect range, while the permutation test checks a registered null question. Cluster-aware resampling handles shared hospital-day conditions, and prewritten comparison families keep segment analysis honest.

The release gate combines statistical uncertainty with practical value and patient safety. A narrow positive interval can support a canary. A clear regression blocks release. A wide interval leads to more evidence instead of an invented conclusion. That workflow gives engineers, clinicians, and reviewers one repeatable way to discuss what the evaluation shows and what remains uncertain.

## References

- [SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html)
- [SciPy permutation_test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html)
- [scikit-learn model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html)
- [NIST/SEMATECH e-Handbook: Confidence limits](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm)
- [NIST/SEMATECH e-Handbook: Sample sizes required](https://www.itl.nist.gov/div898/handbook/prc/section2/prc222.htm)
