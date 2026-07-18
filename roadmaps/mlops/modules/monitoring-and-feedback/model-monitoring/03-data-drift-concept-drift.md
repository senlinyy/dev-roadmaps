---
title: "Data Drift and Concept Drift"
description: "Understand how changing inputs, outputs, and real-world relationships affect deployed models, and how teams detect and respond to those changes."
overview: "Drift monitoring compares a defined production window with a meaningful reference, then combines distribution changes with feature health, prediction behaviour, and mature outcomes before choosing an action."
tags: ["MLOps", "drift", "monitoring"]
order: 3
id: "article-mlops-monitoring-data-drift-concept-drift"
aliases:
  - roadmaps/mlops/modules/monitoring-and-feedback/model-monitoring/01-data-drift-concept-drift.md
  - child-model-monitoring-01-data-drift-concept-drift
---

## Drift Means That Production Has Changed
<!-- section-summary: Drift describes a change in the data or in the real-world relationship a model learned, and it gives the team a reason to investigate. -->

Machine-learning models learn patterns from historical data. Production keeps moving after training finishes. Customers change their behaviour, new products appear, prices move, sensors age, policies change, and data pipelines receive new sources. **Drift** is the name for a meaningful change between the world represented by the model's earlier data and the world the model sees now.

Imagine a model that predicts house prices from bedrooms, floor area, property type, and neighbourhood. It was trained on sales from 2020 to 2023 and performed well on a held-out test set. A year after deployment, its estimates start missing the final sale price more often.

Two very different changes could explain the decline. The mix of homes may have changed because families are buying more four-bedroom houses. The model now receives inputs that were rare during training. The meaning of a location may also have changed because remote work reduced the price premium for city-centre homes. In that case, familiar inputs lead to different outcomes.

Those two cases are called **data drift** and **concept drift**. Telling them apart matters because they lead to different responses. A new mix of valid homes may need observation or new training coverage. A changed relationship between location and price may require a new model. A broken unit conversion or stale feature needs data repair instead of either response.

The monitoring flow follows a simple set of questions:

![Drift investigation from approved reference and current production windows through comparison, feature and outcome context, and a choice to observe, repair, or retrain](/content-assets/articles/article-mlops-monitoring-data-drift-concept-drift/drift-investigation-map.png)

*A drift score sits in the middle of the investigation. The reference defines the question, and feature health, prediction behaviour, and outcomes determine whether the team observes, repairs, or changes the model.*

A drift score answers only the middle question: how different are these two groups of data? The baseline, production context, and outcome evidence explain whether that difference matters and what the team should do.

## Data Drift Changes the Inputs
<!-- section-summary: Data drift occurs when the kinds or frequencies of input values change, even if the relationship between those inputs and the outcome remains stable. -->

**Data drift**, also called **covariate shift**, happens when the distribution of model inputs changes. In probability notation, this is written as a change in `P(X)`. The `X` stands for the model's input features, and `P(X)` describes how often different input values appear.

Return to the house-price model. Training mostly contained studios and one-bedroom flats. Production now contains far more four-bedroom houses. The distribution of `bedroom_count` has changed, so `P(X)` has changed. The rule connecting bedrooms, location, and sale price may still be valid. The model is simply working in a part of the input space it saw less often.

That difference can matter in several ways. A tree-based model may have weak or unstable splits for large homes. A linear model may extrapolate beyond the range it learned. A model can also handle the new mix perfectly well if the relevant relationship was learned from enough examples. Data drift therefore raises a question; it does not prove that prediction quality fell.

Data drift can come from the real world or from the data system. A marketing campaign may attract a different customer group. A new country launch may introduce currencies and categories that were absent from training. A producer can also rename a category, change a unit, or start filling missing values with zero. The first two examples describe genuine population movement. The last examples describe feature-health failures that need repair.

The distinction changes the first production action. If a campaign deliberately brings in larger homes, the product owner confirms the launch and the model owner checks coverage and error for that population. If a producer changed square feet to square metres without updating the contract, the data owner quarantines the affected values and repairs the transformation. Retraining on the damaged unit would teach the model from a pipeline defect and make the original problem harder to see.

Teams therefore pair every drift result with basic feature evidence: schema version, null rate, freshness, category coverage, range checks, and training-serving parity. Distribution monitoring is good at saying that a population moved. Contract checks are better at saying that a known rule broke. Reading them together keeps an early warning from turning into the wrong engineering project.

## Concept Drift Changes the Relationship
<!-- section-summary: Concept drift occurs when the same input can lead to a different outcome because the real-world relationship learned by the model has changed. -->

**Concept drift** means that the relationship between the inputs and the outcome has changed. The probability notation is a change in `P(Y|X)`: the chance of an outcome `Y`, given the same input `X`.

For the house-price model, consider a two-bedroom city-centre home. The feature values remain common and valid. After a large shift toward remote work, buyers may pay less for the city-centre location and more for suburban space. The same kind of home now produces a different sale price. `P(X)` can remain fairly stable while `P(Y|X)` moves.

Concept drift is harder to detect because the input data may look ordinary. The strongest evidence usually arrives from mature outcomes: prediction errors rise, calibration changes, or one segment develops a consistent residual pattern. Domain evidence can explain why, such as a regulation, market change, new competitor, or altered customer behaviour.

The term **target drift** describes a change in the overall distribution of outcomes, written as `P(Y)`. Average house prices may rise across the whole market. Fraud prevalence may increase during a holiday period. Target drift is useful context, while it still leaves an important question: did the inputs change, did the relationship change, or did both move together?

A residual often makes concept drift easier to see. A **residual** is the difference between the prediction and the observed outcome. If a price model is consistently £70,000 too high for city-centre homes after remote-work behaviour changes, the residual distribution for that segment moves below zero even though the input values remain familiar. Classification teams examine calibration by score band, false negatives, false positives, and threshold-specific results for the same reason.

Concept drift can be sudden, gradual, recurring, or limited to one segment. A new regulation can change approval outcomes on a single date. Customer preferences may move over several months. Holiday fraud can return every year. A supplier change may affect one device family. The monitor keeps time and segment identity visible because one global monthly accuracy number would flatten these different shapes into the same vague decline.

When labels are delayed, teams can maintain an early and a final view. Reviewer disagreement, override rate, or a short-term proxy can raise an investigation quickly. The final view uses the outcome contract and mature cohort from the prediction-quality monitor. A proxy receives a measured relationship to the final outcome and a clear owner; otherwise it can drift independently and give the team false confidence.

![Side-by-side comparison of data drift changing the input mix and concept drift changing the outcome for familiar inputs](/content-assets/articles/article-mlops-monitoring-data-drift-concept-drift/data-vs-concept-drift.png)

*Data drift changes which inputs arrive. Concept drift changes what familiar inputs imply about the outcome. The housing example makes the distinction visible while the probability relationships remain the governing theory.*

## Observable Drift and Hidden Drift Need Different Evidence
<!-- section-summary: Input and prediction changes can appear quickly, while concept drift usually needs delayed outcomes or carefully chosen proxy evidence. -->

Input features and predictions are available at decision time, so teams can compare their distributions within minutes or hours. These are **leading signals**. They provide early warning while saying little by themselves about final accuracy.

Concept drift is often **hidden** until outcomes arrive. A churn model may need 90 days before an account can receive a final label. A payment model may wait weeks for disputes.

During that delay, score distributions show whether the model's outputs have moved. Action rates show whether the product is treating more cases differently. Reviewer overrides and complaints provide early evidence that those decisions may be wrong. These signals can justify investigation or temporary containment, while the final quality claim still waits for mature labels.

Suppose a fraud model's high-risk score share doubles overnight, while input distributions and model versions remain stable. The team checks the policy version and upstream feature path first. If those remain healthy, the movement may describe a real change in fraud behaviour or a relationship the monitor cannot yet see. Review decisions can provide early evidence, and mature chargebacks later confirm whether model recall changed.

This delay is why a good drift dashboard keeps different claims separate. It can say “the input distribution moved,” “the prediction distribution moved,” or “mature quality declined.” Combining them into one generic health score hides which evidence is available and which conclusion is still waiting.

## The Reference Window Defines the Question
<!-- section-summary: A drift result only has meaning when the reader knows what production data was compared with and why that reference represents a useful expectation. -->

A drift monitor compares two groups of data. The **reference window** represents the earlier state, and the **current window** represents the production state being examined. Choosing the reference defines what “different” means and determines which production change the result can reveal.

Training data answers how far production has moved from the model's original experience. A recent healthy production period answers whether something changed after a release. The same week last year can help with seasonal behaviour. A canary comparison can use baseline and candidate model routes over the same time window.

Consider a retail demand model during December. Comparing holiday traffic with an average week in March will produce obvious drift every year. That alert teaches the team very little. Comparing this December with the same holiday period last year can reveal an unusual change while respecting the expected seasonal pattern.

Reference data needs an identity. Teams assign a `baseline_id` and record the exact time range. The dataset or table version identifies the rows, while the filters and feature definitions explain how the comparison was built. An approval reason records why this period represents a useful expectation. Together, this information lets an investigator reproduce the result and prevents a quiet baseline replacement from making an alert disappear.

A mature system can keep several baselines because they answer different questions. The immutable training baseline asks how far production moved from the model's original experience. A recent approved baseline asks whether production changed after a release. Seasonal baselines compare like with like. A canary baseline compares candidate and approved routes during the same live period. The dashboard labels these questions directly instead of combining their scores.

Baseline promotion follows a controlled workflow. The monitor first runs the proposed reference beside the current reference through a complete business cycle. Owners review alerts under both references. They also confirm that mature quality remains healthy for important segments.

The approved record points to the exact data snapshot and stores the filters used to build it. Its feature definitions preserve the meaning of each comparison. The record also keeps the approval reason and reviewers. Rolling back means selecting the previous `baseline_id`; it should not require rebuilding history from an undocumented query.

Window size also changes the signal. A short window reacts quickly and may contain too few examples. A longer window is more stable and can hide a short incident inside mostly healthy traffic. Monitoring frequency should follow traffic volume and response speed. A busy payment model may support hourly windows, while a low-volume medical workflow may need weeks of carefully governed evidence.

## A Drift Score Needs Plain-English Context
<!-- section-summary: Statistical methods measure distribution differences, while effect size, sample count, feature meaning, and quality evidence determine whether the difference matters. -->

A drift method compares two distributions and returns evidence about their difference. Numerical features and categorical features need different methods because their distributions have different shapes, while every method still needs product context before it can drive an alert.

For a number such as house area or delivery distance, teams may use the Kolmogorov–Smirnov test, Wasserstein distance, Jensen–Shannon distance, or Population Stability Index. For a category such as property type or device family, they may use a chi-squared test, Jensen–Shannon distance, or a change in category shares. The method name matters less to a beginner than the question it answers: did the shape move, and by how much?

A **p-value** measures how surprising the observed difference would be under a statistical assumption. With millions of rows, a tiny harmless change can produce a very small p-value. With a few dozen rows, a meaningful change may remain uncertain.

Production alerts also need an **effect size**, which describes how large the movement is. The sample count shows how much evidence supports that estimate. Reading these values together keeps statistical sensitivity from being mistaken for product importance.

Different methods emphasize different shapes. The Kolmogorov–Smirnov statistic focuses on the largest gap between two numerical cumulative distributions and is sensitive to sample size. Wasserstein distance can be understood as how far probability mass would have to move to turn one numerical distribution into the other, which preserves the unit after appropriate scaling. Jensen–Shannon distance works with numeric histograms or categorical shares and gives a bounded comparison. Chi-squared tests suit category counts when expected counts are adequate.

Population Stability Index, or PSI, is widely used in credit and other tabular monitoring because it is easy to compute from bins. Its result depends heavily on where those bins were defined. Recomputing bins from every current window changes the ruler while measuring the movement. Teams usually derive bin edges from the approved reference, preserve missing and unseen categories explicitly, and version the binning rule with the baseline.

No universal score of `0.2` or p-value of `0.05` carries the same meaning for every feature. A two-millimetre sensor shift can matter in one system and be irrelevant in another. Teams replay the candidate method and threshold across known healthy periods, seasonal events, and previous incidents. That backtest reveals expected alert volume and shows whether the rule would have caught a change the organization actually cared about.

Suppose the average floor area changes from 82 to 82.3 square metres across two million predictions. A test may call the difference statistically significant, while the change has no practical effect on price error. A shift from 82 to 118 square metres in one high-volume region has a much clearer operational meaning. The monitor should show the before-and-after distribution or quantiles so the investigator can see the movement behind the score.

Thresholds come from healthy history and product consequence. Teams replay candidate rules over known periods, measure alert volume, and review important incidents. A feature tied to a safety decision may have a strict contract threshold. A weakly used feature may need only a dashboard annotation unless quality or predictions move with it.

## Segments and Versions Tell You Where the Change Entered
<!-- section-summary: Segment and version fields turn a fleet-wide drift number into a bounded question about a route, release, population, or fallback path. -->

A global distribution can hide a concentrated change because a high-volume healthy group can outweigh a smaller failing group. Drift monitoring therefore uses the same product and system segments as prediction-quality monitoring, including regions, customer stages, serving routes, and fallback paths.

Suppose the overall share of the `unknown` category rises from 2% to 5%. The global movement seems moderate. A regional view shows that one route jumped to 48% immediately after an upstream release. That pattern points toward a mapping or schema failure. A gradual increase across every route may describe a real new category entering the product.

Version identity gives another useful boundary. During a canary release, candidate and baseline models may receive similar traffic. Prediction drift isolated to the candidate suggests a model or preprocessing difference. A shift shared by both versions points toward the population, features, or policy around them.

Counts remain visible beside every slice. A dramatic score from 20 examples can guide investigation and rarely deserves the same alert as a sustained movement across 200,000 decisions. Sensitive segments need controlled access and a clear purpose, especially when they involve protected or personal attributes.

Segment selection combines domain risk and system architecture. Product segments include region, customer stage, device class, or risk tier. System segments include model route, feature version, policy version, data source, and fallback path. The first group shows who or what is affected. The second group often shows where the change entered. Monitoring both prevents the team from seeing a harmed population without seeing the release or pipeline that serves it.

The monitor limits combinatorial growth. It computes approved one-dimensional segments and a few reviewed intersections that have a real operating purpose. For example, `region × model_route` may be useful during a canary, while every possible combination of five customer attributes creates noise and privacy risk. Low-volume segments use longer windows or manual analysis, with their sample size shown openly.

## Combine Signals Before Choosing a Cause
<!-- section-summary: Drift diagnosis compares inputs, predictions, quality, feature health, and system identity so the response follows evidence instead of one score. -->

One drift chart says what moved. Diagnosis asks how that movement lines up with the model's predictions, mature outcomes, feature checks, policy versions, and release history. These connections narrow the likely cause and show which team can test it directly.

If inputs move while predictions and mature quality remain stable, the model may be handling a legitimate population change. The team checks the affected features and segments, then observes through a complete operating cycle. A reviewed baseline update may follow after enough outcomes confirm that the new population remains healthy.

If inputs and predictions move together while quality remains stable, the model may be adapting correctly to a seasonal or product change. The team records the event and watches action volume because a healthy model can still create more work for a downstream queue.

If inputs, predictions, and mature quality all move, the cause still needs evidence. A freshness or parity failure sends the team toward the feature path. Healthy contracts with worsening residuals or calibration suggest that the real-world relationship has changed.

Quality can also fall while input and prediction distributions look stable. This pattern can reveal concept drift, a changed label definition, an unmonitored feature, or a policy change after the model output. The team verifies label coverage and policy identity before concluding that the concept changed.

An apparent quality improvement with falling label coverage takes a different path. The monitoring owner marks the metric unavailable and freezes promotion. The data owner repairs the join and recomputes the same cohort. The corrected result replaces the apparent improvement only after coverage is restored and sampled IDs reach the intended outcomes.

Another common pattern is a prediction shift without input drift. The team checks artifact identity, preprocessing package, and policy version. If the candidate model alone produces more high scores from comparable inputs, the release comparison should explain whether the behaviour was expected. If both models produce the same scores but action volume changes, the decision policy or downstream eligibility rule is the stronger suspect.

A population shift can also expose a model weakness without changing the underlying concept. Suppose larger homes make up more production traffic and error rises only beyond the size range represented in training. The model owner can limit automated estimates for that unsupported range, collect more examples, and train a candidate with broader coverage. The cause is data drift with poor generalization, while the remediation can still include a new model. Diagnosis explains the need for model work and shapes that work.

## How Teams Run Drift Monitoring
<!-- section-summary: A production drift job selects governed windows, validates them, computes versioned comparisons, stores the evidence, and sends bounded alerts. -->

The smallest credible drift stack often uses the data platform the team already has. A warehouse or lakehouse stores the reference and current datasets. dbt, Spark, or scheduled SQL builds the windows and checks their schemas and counts. Evidently, TensorFlow Data Validation, or application code performs the statistical comparison. Airflow, Dagster, or a managed workflow runs the job.

The current Evidently API can create a report with its data-drift preset:

```python
from evidently import Report
from evidently.presets import DataDriftPreset

report = Report([DataDriftPreset()])
evaluation = report.run(
    current_data=current_window,
    reference_data=reference_window,
)
```

The code performs the comparison. The production workflow supplies the meaning around it. Before this step, the job selects the approved `baseline_id`, verifies the schema, and checks that both windows contain enough rows. Afterward, it writes feature-level results to a warehouse table with the method, threshold, time ranges, segment, data version, and library version.

A typical scheduled run has five stages. Airflow, Dagster, or the managed pipeline first waits for complete reference and current partitions. dbt, Great Expectations, or TensorFlow Data Validation checks schema, counts, missingness, and contract rules. The comparison task then computes drift with pinned methods and library versions. A publishing task stores summary and feature-level results, while a separate notification task sends only actionable signals to Prometheus, Cloud Monitoring, Azure Monitor, or the incident platform.

Each run writes a manifest containing its input snapshots, row counts, rejected rows, baseline ID, code revision, start and finish times, and status. Detailed results retain before-and-after quantiles or category shares and a bounded sample of representative records. If validation fails, the comparison is marked unavailable and publication stops. This behaviour distinguishes “no drift” from “the job could not measure drift.”

The orchestrator also supports backfills. If a source partition arrives late, the team reruns the exact affected window with the same baseline and configuration, then records a metric revision. Historical results are not silently overwritten. A corrected result links back to the previous run so investigators and release reviewers know that the evidence changed after its original publication.

Prometheus or the cloud monitor receives a small alert signal. The warehouse retains the detailed result and representative rows for investigation. This boundary matters because changing a library default should never silently redefine which baseline or production population the organization monitors.

Managed platforms can package collection, scheduled comparison, dashboards, and alerts. Azure Machine Learning offers built-in tabular drift and data-quality signals. Gemini Enterprise Agent Platform Model Monitoring v2 can monitor tabular models on Google or other serving infrastructure and remains Preview as checked on 18 July 2026. Databricks data profiling can compare governed Delta tables over time. A specialist platform such as Arize, Fiddler, WhyLabs, or NannyML can help with large cross-platform fleets or delayed-label analysis. The best starting point is still the smallest toolset that preserves the required evidence and that the team can operate reliably.

Evidently is a practical library when the team wants transparent reports inside its own Python pipeline. TensorFlow Data Validation fits a TFX-oriented workflow and can validate schema and distribution statistics at scale. Managed cloud monitors reduce integration work when model collection and registry already live in that provider; the service can then reuse the provider's storage and alerting path. Specialist platforms suit fleets where many models, clouds, and teams need a common investigation experience. Tool adoption follows the operating boundary. Every choice still needs defined baselines and segments, an honest label-maturity rule, and an owner for action.

## Repair, Update the Baseline, or Retrain
<!-- section-summary: The response depends on whether the drift came from a damaged data path, a healthy new population, or a changed relationship between inputs and outcomes. -->

A drift alert should name the feature or prediction, both windows, the method, the size of the movement, sample counts, affected segments, versions, and related quality signals. That context gives the owner a real investigation instead of a message saying only “drift detected.”

When a pipeline defect causes the shift, the repair stays at the data boundary first. Suppose an upstream release maps every new category to `unknown`. The source or transformation owner restores the reviewed mapping and reprocesses the affected partitions into a candidate table. Schema, category, freshness, and parity checks run again. The drift job compares the corrected window with the same baseline, and the quality job recomputes the same mature cohort. Retraining remains frozen until this evidence separates the defect from any genuine new category.

If the defect reached live decisions, containment happens before the backfill finishes. The product can route the affected category to an approved fallback, hold a high-risk action for review, or return one serving route to the last compatible feature version. The repaired path runs in shadow, representative records are traced from source to prediction, and a canary confirms freshness, parity, latency, and action rates. The team restores normal traffic gradually and keeps the old route available until those controls stay healthy.

A healthy population change needs a baseline decision. The monitoring owner runs the proposed reference beside the existing one through a full business cycle. Model and product owners check quality, calibration, and downstream capacity across important segments. If they approve the new baseline, it receives a new version and reason. The old reference remains available for historical interpretation and rollback.

Sometimes the model remains healthy while the product process needs adjustment. A fraud model may retain precision and recall during a seasonal increase in risky traffic, yet the number of reviews exceeds analyst capacity. The product owner can change routing, staff the queue, or use a reviewed high-loss tier while keeping the model in place. Drift monitoring has still done useful work because it revealed a production consequence that accuracy alone would miss.

Confirmed concept drift opens the normal model-release path. The data team builds a point-in-time-correct training set containing the new relationship. A managed training job or the established platform produces a candidate, and the model registry links it to its data, code, feature definitions, and evaluation results.

Offline segment evaluation shows whether the candidate addresses the change. Shadow or canary traffic then compares it with the approved model. Promotion requires explicit quality and product thresholds, and any breach returns traffic to the previous artifact. Drift starts this investigation; release evidence controls training and promotion.

Retraining is only one possible model response. If ranking remains strong and probabilities are consistently too high, a versioned recalibration step may repair the score meaning with less change than a full model rebuild. If one threshold no longer matches cost or capacity, the team can replay and canary a new policy while preserving the artifact. If feature relationships changed across several segments, a newly trained model is more likely to be appropriate. Offline and live evidence choose among these options.

![Drift response map separating contract repair, healthy-population observation and baseline review, and relationship change requiring recalibration or retraining](/content-assets/articles/article-mlops-monitoring-data-drift-concept-drift/drift-response-decision.png)

*Drift has several valid responses. Contract failures stay at the data boundary, healthy changes may justify observation or a reviewed baseline, and changed relationships enter the normal model-release path with rollback.*

## The Main Idea
<!-- section-summary: Drift monitoring describes change, while feature health and mature quality evidence explain its cause and consequence. -->

Data drift means the model is seeing a different mix of inputs. Concept drift means the relationship between those inputs and the outcome has changed. Target drift means the overall outcome distribution moved. These ideas answer different questions, and a production system can experience several at once.

The drift score provides the first clue. A meaningful reference, visible distributions, segments, versions, feature-health checks, and mature outcomes turn that clue into a supported diagnosis. The team can then observe a healthy change, repair a damaged pipeline, update an approved baseline, or start a controlled model release for genuine concept drift.

## References

- [Evidently data drift preset](https://docs.evidentlyai.com/metrics/preset_data_drift)
- [Evidently Report API](https://docs.evidentlyai.com/docs/library/report)
- [Evidently drift methods and defaults](https://docs.evidentlyai.com/metrics/explainer_drift)
- [TensorFlow Data Validation](https://www.tensorflow.org/tfx/guide/tfdv)
- [SciPy two-sample Kolmogorov–Smirnov test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ks_2samp.html)
- [SciPy Wasserstein distance](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.wasserstein_distance.html)
- [Azure Machine Learning model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring?view=azureml-api-2)
- [Google Model Monitoring overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-monitoring/overview)
- [Databricks data profiling](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/)
- [Google Rules of ML: monitoring](https://developers.google.com/machine-learning/guides/rules-of-ml#monitoring)
