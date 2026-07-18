---
title: "Monitoring Prediction Quality"
description: "Explain how production predictions are connected to delayed outcomes, meaningful metrics, segments, and product action."
overview: "Prediction-quality monitoring measures the deployed decision system by connecting prediction identity, policy, outcome maturity, comparable cohorts, uncertainty, and owned responses."
tags: ["MLOps", "monitoring", "quality"]
order: 1
id: "article-mlops-monitoring-and-feedback-monitoring-prediction-quality"
aliases:
  - roadmaps/mlops/modules/monitoring-and-feedback/model-monitoring/02-monitoring-prediction-quality.md
  - child-model-monitoring-02-monitoring-prediction-quality
---

## What Prediction Quality Means After Deployment
<!-- section-summary: Prediction-quality monitoring checks whether live model outputs still agree with real outcomes and still support the product decision they were built for. -->

**Prediction-quality monitoring** is the ongoing practice of checking whether a deployed model still makes useful predictions. During development, you can evaluate a model on a test dataset whose answers are already known. Production is different. New cases arrive every day, the correct answers often arrive later, and the people or systems using the prediction may change how they act on it.

Imagine a model that estimates the sale price of a home. It returns a price for every request, the API stays fast, and every response has the expected JSON shape. Six months later, the estimates are regularly £80,000 above the final sale price in city-centre neighbourhoods. From a software-health point of view, the service is working. From the buyer's point of view, the model has stopped being reliable.

This quiet gap between a successful response and a useful prediction is why model monitoring exists. **Data drift** can move the model into unfamiliar input data, such as a sudden increase in large family homes. **Concept drift** can change the relationship the model learned, such as buyers placing less value on city-centre locations. Quality can also fall because a feature pipeline serves stale values, a new threshold changes the product action, or the outcome data stops joining correctly. The monitor has to separate these causes instead of treating every bad metric as proof that the model needs retraining.

At a high level, the job follows one loop:

![Prediction quality loop from model output through product action, mature outcome, identity matching, cohort measurement, and response](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/prediction-quality-loop.png)

*Prediction-quality monitoring forms a continuous loop: preserve the prediction, observe the later outcome, measure comparable cases, and feed the evidence into the next safe decision.*

Each arrow answers a beginner-friendly question. What did the model predict? What did the product do with that prediction? What actually happened? Are we comparing the same kind of cases? Is the difference large enough to matter? What should the team change? The rest of the article builds that loop one part at a time.

## Keep a Receipt for Every Important Prediction
<!-- section-summary: A prediction record preserves enough information to explain which model produced an output and how the product used it. -->

A production prediction needs a durable **prediction record**. You can think of this record as a receipt. It preserves the information required to reconstruct the decision after the real outcome arrives and gives every later investigation a stable place to start.

This receipt solves a problem that appears only after the model has handled many versions and millions of requests. An average dashboard can show that something changed, while the receipt lets an investigator return to one affected decision and ask which model, data, and product rule produced it. The same identity then connects the service trace, the later outcome, and the monitoring result.

The receipt starts with a unique `prediction_id` and the time of the decision. It records the model version, the feature or preprocessing version, the raw model output, and a small set of useful segments such as region or product channel. It also records the rule that turned the model output into an action.

That last part deserves attention. Suppose a fraud model returns a risk score of `0.72`. One policy may approve scores below `0.80`. A stricter policy may send every score above `0.65` to manual review. The model output stayed at `0.72`, while the product action changed. Recording a `policy_version` keeps the model and the business rule separate during an investigation.

A compact record might look like this:

```json
{
  "prediction_id": "pred-8f31",
  "decision_time": "2026-07-18T09:42:00Z",
  "model_version": "price-model-17",
  "feature_version": "property-features-6",
  "prediction": 465000,
  "policy_version": "listing-policy-4",
  "action": "show-estimate",
  "region": "north-west"
}
```

This example contains identity rather than a full feature payload. Full inputs may contain personal or commercially sensitive data, so teams usually keep request-level records in protected object storage, a warehouse, or a lakehouse table. Prometheus and cloud monitoring are better suited to low-cardinality totals such as prediction count, failure count, or fallback rate. A unique prediction ID belongs in the protected record or trace because using it as a metric label would create a separate time series for every request.

In a common production design, the inference service writes the decision and the receipt as one logical operation. The service can publish the receipt to Kafka, Kinesis, Pub/Sub, or an equivalent event stream after it has chosen the product action. A consumer lands those events in an append-only object-store or lakehouse table. Smaller systems can write directly to a warehouse, although the write should remain asynchronous so a temporary analytics outage does not make the customer-facing prediction unavailable.

The capture path needs the same care as any other data pipeline. A retry can deliver the same event twice, so `prediction_id` acts as the idempotency key when the curated table is built. A schema version lets consumers handle an added field without confusing old and new records. A dead-letter destination retains rejected events for repair. The service also increments a low-cardinality counter for every prediction, and the monitoring job compares that counter with the number of unique receipts that arrived. That reconciliation reveals a silent capture failure before a quality dashboard starts reasoning from incomplete traffic.

Privacy rules shape what the receipt contains. Teams often store stable entity tokens, derived features that matter to investigation, and references to protected raw data rather than copying a complete customer request into every monitoring system. Access is restricted by role, retention follows the longest justified outcome window, and deletion workflows reach the monitoring copy as well as the product database. The result is enough identity to explain a decision without turning monitoring into an uncontrolled second customer-data store.

The prediction record gives the later outcome somewhere to attach. Without that stable link, a team may know that average quality fell while remaining unable to identify which model, feature path, policy, or segment produced the affected decisions.

## The Model Cannot Be Graded Until Reality Arrives
<!-- section-summary: Outcomes turn predictions into measurable evidence, and maturity rules prevent incomplete recent cases from distorting the result. -->

An **outcome**, often called a ground-truth label, is the real event used to judge a prediction. A home-price prediction can be compared with the final sale price. A delivery estimate can be compared with the actual arrival time. A fraud prediction may have to wait for a confirmed chargeback.

Some outcomes arrive in minutes, while others take weeks or months. The monitor therefore needs an **outcome maturity rule**: the amount of time a case must remain open before the team considers its outcome reliable enough for a final quality measure.

Consider a model that predicts whether a customer will cancel a subscription within 90 days. After two weeks, most customers have neither cancelled nor completed the full 90-day period. Counting every active customer as a successful negative prediction would make the model appear unusually accurate. The honest status for those cases is **pending**. Early evidence such as a cancellation request can appear on a separate panel, while the final metric waits for the full maturity window.

The same principle applies when labels arrive late or receive corrections. A disputed payment may first appear legitimate and later turn into a confirmed chargeback. The monitoring data should retain the original outcome, the correction, and the time each state became known. That history lets the team recompute the same prediction group without pretending that the final answer was available earlier.

Production teams usually make these rules explicit in a **label contract**. The contract identifies the source event and the key that connects it to a prediction. It separates an early useful signal from the rule for a final mature label, then states how corrections and arrival delays are handled. A named owner resolves changes to those rules. For a delivery estimate, `delivered_at` may be final within hours. For a credit decision, a delinquency label may need 90 days plus a short ingestion allowance. Giving both labels the same daily freshness target would create a false expectation for one and a dangerously slow response for the other.

The outcome pipeline keeps event time and observation time separate. Event time says when the outcome happened; observation time says when the monitoring system learned about it. This distinction matters during backfills. A chargeback created on Monday and imported on Thursday belongs to Monday's business event, while Thursday's observation time explains why earlier monitoring runs did not include it. Versioned outcome rows or a warehouse snapshot preserve this history, and the cohort job selects the newest outcome state known as of its run time.

There is a harder problem when the product action changes whether an outcome can ever be observed. If a payment is blocked, nobody gets to see whether approving it would have caused a chargeback. If only high-risk cases receive human review, the reviewed labels describe a model-selected group rather than all traffic. This missing view of the alternative action is called **censoring**.

Teams handle censoring carefully because measurement never justifies exposing users to unacceptable risk. A low-risk recommendation system may use a small random holdout to learn what happens without the normal ranking rule. A payment team may send a bounded sample to trained reviewers and combine that evidence with later disputes. The product and risk owners define the eligible cases, sampling rate, safety budget, and stop condition before the measurement starts.

The decision service records which cases entered the sample and the probability of selection. Once outcomes mature, the measurement owner checks whether the observed sample matches the intended design and whether important segments received enough coverage. If the review queue, loss estimate, or customer impact crosses its approved limit, the sampling policy rolls back immediately. Some outcomes will remain unknowable, and the published metric should say which population it genuinely represents.

For example, a payment team may review a random sample of low-risk approvals because blocking a payment hides the outcome that approval would have produced. The sampling service records eligibility, selection probability, reviewer result, and final dispute status. The monitor reports both the raw result and the weighted estimate for the eligible population, with the sampling assumptions visible. If reviewers fall behind, the sample shrinks before the queue changes which cases receive labels. This keeps the measurement process from creating an operational problem of its own.

## Compare Predictions That Belong Together
<!-- section-summary: A cohort groups predictions by time, version, policy, and maturity so the resulting quality comparison has a stable meaning. -->

A **cohort** is the exact group of predictions included in one result. In ordinary language, it means “the cases we are grading together.” Defining this group carefully matters because production traffic, model versions, policies, and label availability all change over time.

Suppose a home-price model version changes on 1 June. A sale completed on 15 June may belong to a prediction made in March by the previous version. Grouping results by sale date would mix the two versions. The cohort should begin with prediction time, then attach outcomes when they mature.

A useful cohort definition starts with the prediction window and the outcome maturity period. It then identifies the model, policy, and segment being measured. These boundaries tell the reader exactly which production decisions the result describes.

Coverage is reported beside the metric. The report separates predictions with a mature outcome from cases that remain pending. It also shows censored cases and records whose outcome failed to join. Those counts protect the metric from a common failure: a broken outcome feed can remove difficult cases and make quality appear to improve.

The following warehouse query shows the central idea. The SQL dialect may change, while the time and version boundaries remain the important part:

```sql
SELECT
  model_version,
  policy_version,
  region,
  COUNT(*) AS mature_predictions,
  AVG(ABS(predicted_price - sale_price)) AS mean_absolute_error
FROM monitoring.property_price_outcomes
WHERE prediction_time >= :cohort_start
  AND prediction_time < :cohort_end
  AND prediction_time < :as_of_time - INTERVAL '60 days'
  AND outcome_status = 'mature'
GROUP BY model_version, policy_version, region;
```

This query grades only predictions old enough to have a mature sale outcome. It keeps model and policy versions visible and calculates the error by region. A production job also reconciles the rows around this query: eligible predictions, matched outcomes, duplicates, orphan outcomes, and pending cases. The final error value is trustworthy only when those surrounding counts make sense.

The cohort table is normally an incremental, reproducible data product rather than a one-off query behind a dashboard. dbt works well when the source data already lives in a warehouse. Spark fits lakehouse-scale histories and large backfills. The transformation writes a candidate partition for a specific `cohort_start`, `cohort_end`, and `as_of_time`; data tests then check key uniqueness, accepted maturity states, outcome relationships, and coverage limits before that partition is published.

Late outcomes make idempotency important. Rerunning the same cohort after a backfill should update the affected prediction once, preserve the earlier run for audit, and produce a visible metric revision. A practical table keeps `cohort_definition_version`, `metric_definition_version`, `computed_at`, and the source snapshot identifiers beside the result. Investigators can then answer whether a chart moved because production changed or because a corrected label arrived.

Suppose an orchestrated job expects 600,000 eligible predictions and finds 599,700 unique receipts, 520,000 mature outcomes, 77,000 pending cases, 1,900 censored cases, and 800 failed joins. Those numbers tell a coherent story. If the next run still has 520,000 mature outcomes but only 260,000 matches, the orchestrator should stop metric publication and open a data incident. Publishing the resulting MAE would give a precise number built from a damaged population.

![Evidence funnel from durable prediction receipts through mature outcomes, joined records, governed cohorts, and a quality result, with missing joins stopping publication](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/trustworthy-quality-metric.png)

*A quality metric earns trust through the evidence funnel around it. Maturity, join coverage, cohort identity, sample size, and uncertainty are part of the result rather than optional dashboard details.*

## Choose a Metric That Matches the Real Mistake
<!-- section-summary: Quality metrics should reflect the type of prediction, the cost of each error, and the capacity of the process that acts on the result. -->

A **quality metric** turns many prediction errors into a number that can be tracked. It gives the team a consistent way to compare one time window, model version, or segment with another and decide whether the observed change deserves action.

The choice carries real product meaning because different metrics reward different behaviour. A measure that treats every error equally may suit one decision and hide the expensive mistakes in another. The team therefore starts with the prediction task and the harm created by each kind of error.

For a home-price model, **mean absolute error**, or MAE, answers a direct question: on average, how many pounds separate the estimate from the sale price? **Root mean squared error**, or RMSE, gives extra weight to large misses. A stable MAE can hide a growing number of extreme errors, so teams often inspect error percentiles and regional error alongside the average.

Classification models need a different view. For a fraud model, **precision** asks how many flagged payments were actually fraudulent. **Recall** asks how much fraud the model found. Raising the review threshold may improve precision because analysts see fewer weak cases, while recall falls because more fraud passes through. Neither number can choose the threshold alone.

The product process supplies the missing context. If investigators can review 1,200 cases each day, a threshold that produces 1,700 cases creates a growing queue even when recall improves. The team may choose an intermediate threshold, add review capacity, or apply the more sensitive threshold only to high-loss segments. Queue size and wait time belong beside the model metric because the decision depends on both.

Probability scores also need **calibration**. A calibrated risk score of `0.8` means that roughly eight out of ten comparable cases with that score eventually produce the event. A model can rank cases in the right order while its probabilities grow too high or too low. That failure matters when the score drives prices, credit limits, staffing, or another decision that treats the number as a probability.

Metric definitions need versions just like model code. Libraries can use different averaging rules, class handling, and thresholds. Teams keep a small fixture containing known predictions and outcomes, then verify that the monitoring job produces the expected denominator and result before a metric change reaches production.

Metrics also need a decision rule. Teams often combine an absolute guardrail with a relative comparison and a minimum sample size. For example, the release may be unsafe if mature recall falls below `0.82`, or if it falls by more than five percentage points against the approved route once at least 5,000 positives have matured. The absolute rule protects the minimum acceptable service; the relative rule catches a candidate that is materially worse even while both routes remain above that minimum.

Uncertainty belongs in the decision as well. A bootstrap interval can show how much MAE might vary across resampled cases, while a binomial interval can describe uncertainty around a classification rate. The exact method depends on the metric and sampling design. The beginner-friendly point is simpler: a monitoring number is an estimate from a finite group of cases, so the alert should reveal whether the apparent movement is larger than normal variation.

Threshold changes receive their own evaluation. A fraud classifier can keep the same ranking quality while a new review threshold sends twice as many cases to investigators. Teams replay candidate thresholds on mature recent cohorts, estimate precision, recall, expected loss, and queue volume, then canary the chosen policy separately from a model release. This prevents a policy incident from being recorded as a model-quality failure.

## A Global Average Can Hide a Local Failure
<!-- section-summary: Segment results and uncertainty reveal where a model is failing and whether the available evidence is strong enough to act on. -->

A **segment** is a meaningful slice of production traffic, such as region, device type, new customers, model route, or fallback path. Segment monitoring answers a simple question: is the overall result hiding a serious problem for one group?

Imagine that property-price error stays close to £25,000 across the whole country. In one newly added region, the error has risen to £110,000 because local leasehold rules were never represented in training. The national average can remain calm because that region handles only a small share of requests. Regional monitoring reveals the problem while it is still concentrated.

Teams choose important segments from product risks, release routes, previous incidents, and regulated analysis. Searching every possible column creates thousands of noisy comparisons and may expose sensitive data without a clear purpose. A smaller reviewed set gives responders signals they understand and can act on.

Every result should show its sample count and uncertainty. Perfect recall based on two positive cases provides weak evidence. A five-point recall drop across thousands of mature cases carries much more weight. Confidence intervals, sustained-window rules, and minimum sample sizes help the alert distinguish a real movement from ordinary variation.

Segment rules are reviewed like other production configuration. Each segment has a reason, an owner, a minimum volume, and an intended action. A region may exist because data sources differ by country. A `new_customer` slice may exist because the model has less behavioural history for those users. A `fallback_path` slice exists because a degraded data route can change the input meaning. This small catalog helps responders understand why a result is present instead of facing hundreds of automatically generated cuts.

The monitor usually computes the overall result first, then the governed segments, and finally release-specific comparisons. It adjusts alerting for the number of comparisons or requires sustained evidence so one random fluctuation among many slices does not page the team. Low-volume but high-harm segments can use longer windows, pooled evidence, or manual review rather than disappearing from the dashboard. The implementation respects statistical limits without treating small populations as unimportant.

## How Teams Build the Monitoring Loop
<!-- section-summary: A practical monitoring stack captures prediction records, joins mature outcomes, computes versioned metrics, publishes results, and checks that the evidence pipeline itself is healthy. -->

Most teams can build prediction-quality monitoring from systems they already operate. The serving application writes prediction records to an event stream, object store, warehouse, or lakehouse. Outcomes arrive through their normal product or data pipeline. A scheduled workflow then joins the two by `prediction_id`, applies the maturity rule, and builds the cohorts used for metrics.

For warehouse data, dbt is a common choice for the join and data-quality checks. Spark fits large distributed datasets, while ordinary SQL can be enough for a smaller batch model. Scikit-learn, Evidently, or application code can calculate the actual quality measures. Airflow, Dagster, or a managed ML pipeline runs the work on a schedule.

Fast operational signals take a different route. Prometheus or the cloud monitoring service tracks prediction volume, fallback rate, outcome-job freshness, and join coverage. The warehouse retains request-level rows and long outcome windows. This split gives the alerting system small, fast metrics and gives investigators the detailed evidence they need later.

An Airflow or Dagster workflow commonly runs the loop as separate tasks. It checks that prediction and outcome partitions arrived, builds the candidate cohort, executes dbt or Great Expectations validations, computes versioned metrics, writes detailed results, and publishes a small set of alertable time series. A failed validation stops the publish task. That dependency is important: a dashboard should keep the last accepted result with a visible stale timestamp instead of silently replacing it with a calculation from bad evidence.

Managed platforms can cover part of this path. Azure Machine Learning can schedule tabular monitoring signals and connect threshold events through Azure Event Grid. Gemini Enterprise Agent Platform Model Monitoring v2 can run scheduled comparisons for registered tabular model versions and remains a Preview service. Databricks teams can land requests and responses in governed inference tables, then profile or transform those Delta tables. Existing SageMaker Model Monitor users can continue scheduled monitoring, while AWS has announced that new-customer access closes on 30 July 2026 and that no new features are planned. A new AWS design should prefer ordinary governed capture, processing jobs or the established data platform, and CloudWatch for operational alerting.

These services reduce plumbing when the model already lives in their supported path. They still need the application to preserve decision identity and the data team to supply correct outcomes. A managed drift chart cannot decide when a chargeback is mature, recover a censored counterfactual, or explain why a product threshold changed. Those are properties of the decision system rather than features of a monitoring vendor.

The monitor must also check itself. The job records its last successful run, input window, code version, row counts, rejected records, and publication time. Serving counts are reconciled with captured prediction IDs. Outcome counts are reconciled with joined labels. A dashboard that still shows yesterday's healthy value after the job stopped is a monitoring failure, even though the chart remains green.

## From an Alert to a Safe Response
<!-- section-summary: A useful alert first verifies the evidence, then locates the failing boundary, limits harm, repairs the cause, and proves recovery. -->

A useful quality alert says which cohort moved, how much it moved, how many cases support the result, and whether label coverage stayed healthy. It also includes the model, policy, segment, recent releases, owner, and investigation link. This context lets the responder understand what the number claims before changing production.

The first investigation checks the measuring system: did the job run, did the schema change, did the expected outcomes arrive, and did the join coverage fall? The second pass checks model routes, feature health, policy changes, action rates, and affected segments. This order saves the team from rolling back a model because a label column was renamed.

Suppose recall falls from `0.88` to `0.63`, while outcome join coverage falls from `97%` to `46%` at the same time. The monitoring owner freezes promotion and automatic retraining because their evidence is incomplete. The data owner updates the source adapter or dbt model, reprocesses the affected outcome partitions into a candidate table, and checks eligible predictions, duplicates, orphan outcomes, and maturity states.

The corrected job recomputes the original cohorts beside the published results. When coverage returns to its expected range and sampled prediction IDs lead to the intended outcomes, the team promotes the corrected table and records the metric revision. A controlled outcome then travels through ingestion, cohort building, dashboard publication, and alert delivery. Release automation resumes only after that complete path works.

If the evidence path is healthy and the decline belongs to one new model route, the response changes. The release owner can shift that route to the approved model, pause the affected automated action, or send a risky score range to review. Early signals such as action rate, queue size, and fallback use confirm that the containment is active. Mature outcomes later confirm whether prediction quality recovered. The incident stays open until the evidence that justified the action has caught up.

Consider a second case in which join coverage stays at 98%, feature checks pass, and recall falls only for model version 18 on mobile traffic. The release owner routes that segment back to version 17 through the endpoint traffic configuration or feature-flag service. The model owner compares false negatives from the affected cohort with the candidate's training coverage and discovers that a mobile acquisition channel introduced a type of case missing from the candidate dataset.

The repair follows the normal release path. The data team builds a point-in-time-correct training snapshot containing the new channel, the training platform produces a candidate, and the registry links the model to its data and code versions. Offline evaluation checks global and mobile results. Shadow traffic verifies execution and feature parity, followed by a small canary with explicit recall, latency, action-rate, and queue limits. Any breach returns the segment to version 17. Promotion continues only after the immediate signals and the first mature outcome window support the same conclusion.

![Quality alert response branches into evidence-pipeline repair or decision-system containment, evaluation, canary release, and mature confirmation](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/quality-alert-response.png)

*The first check decides which system needs repair. Broken coverage freezes publication and promotion; trustworthy evidence with a real regression sends the affected decision through containment and a controlled release path.*

## The Whole Idea in One View
<!-- section-summary: Prediction-quality monitoring connects live predictions to trustworthy outcomes and turns that evidence into a controlled production response. -->

Prediction quality answers a direct question: do the model's live predictions still agree with reality well enough for the decision they support? Answering it requires more than a metric chart. The team needs a receipt for each prediction, an honest rule for when outcomes are ready, a fair group of cases to compare, a metric tied to real harm, and enough segment and sample context to judge the result.

That evidence also has to lead somewhere. A broken label join calls for data repair. A policy change calls for policy analysis. Stale features call for feature-path recovery. A model-specific decline can justify containment, evaluation, and a controlled release. Prediction-quality monitoring is useful when it points the team toward the right part of the system and gives them a clear way to prove that production is healthy again.

## References

- [Google Rules of ML: monitoring](https://developers.google.com/machine-learning/guides/rules-of-ml#monitoring)
- [scikit-learn model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html)
- [Evidently classification quality](https://docs.evidentlyai.com/metrics/preset_classification)
- [dbt data tests](https://docs.getdbt.com/docs/build/data-tests)
- [Great Expectations Checkpoints and Actions](https://docs.greatexpectations.io/docs/core/trigger_actions_based_on_results/create_a_checkpoint_with_actions/)
- [Azure Machine Learning model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring?view=azureml-api-2)
- [Google Model Monitoring overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-monitoring/overview)
- [Databricks AI Gateway inference tables](https://docs.databricks.com/aws/en/ai-gateway/inference-tables-serving-endpoints)
- [Amazon SageMaker Model Monitor availability change](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-custom-monitoring-schedules.html)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
