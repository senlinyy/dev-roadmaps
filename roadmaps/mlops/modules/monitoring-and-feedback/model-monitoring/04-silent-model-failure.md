---
title: "Silent Model Failure"
description: "Detect model failures that leave APIs healthy by connecting execution identity, feature contracts, prediction behaviour, product actions, delayed outcomes, and monitoring coverage."
overview: "Silent-failure monitoring connects ordinary service health to model identity, feature health, decision behaviour, mature outcomes, and the health of the monitoring system itself."
tags: ["MLOps", "monitoring", "reliability"]
order: 4
id: "article-mlops-monitoring-silent-model-failure"
aliases:
  - roadmaps/mlops/modules/monitoring-and-feedback/model-monitoring/03-silent-model-failure.md
  - child-model-monitoring-03-silent-model-failure
---

## A Model Can Fail While the API Stays Healthy
<!-- section-summary: Silent failure happens when a model service keeps returning successful responses while the resulting decisions grow less useful or more harmful. -->

A normal software failure often gives engineers a clear signal. The process crashes, an API returns an error, latency rises, or a dependency times out. A **silent model failure** is harder to notice. The service keeps returning successful responses, while the predictions or decisions drift away from what users need.

Imagine a delivery-time model that returns an estimate in 40 milliseconds for every request. The endpoint has no errors, CPU use is normal, and the deployment is stable. A traffic feature stopped updating three hours ago, so the model now promises delivery times that are consistently too short. Customers see the failure long before the infrastructure dashboard does.

Silent failure can enter through the model, the data, or the product rule that uses the prediction. The monitoring system can also fail and keep showing an old green result. Detecting these cases requires a connected view of the decision path instead of one model metric or one service dashboard.

The path can be read as a sequence of claims:

![Successful 200 OK response passing through execution, feature, prediction, decision, outcome, and monitoring-coverage checks while stale traffic data creates a bad promise](/content-assets/articles/article-mlops-monitoring-silent-model-failure/silent-failure-boundaries.png)

*The endpoint can stay green while meaning fails deeper in the path. Each checkpoint makes a different claim, and monitoring coverage determines whether the evidence supporting those claims is current and complete.*

Each level depends on the level above it. A successful request cannot prove that the intended model version ran. The intended model cannot produce a trustworthy decision from stale inputs. A plausible prediction cannot prove that a new threshold used it safely. A healthy outcome chart cannot be trusted when half of the labels stopped joining.

## Find the Boundary Where Reality Diverged
<!-- section-summary: A failure boundary is the first point where live execution stops matching an assumption that the team reviewed and approved. -->

A **failure boundary** is the first part of the production path that no longer behaves as designed. Locating this boundary gives the incident a useful owner, a direct containment option, and a smaller system to test during repair.

The **service boundary** covers availability, latency, timeouts, and malformed responses. Ordinary observability already handles these well. The **execution boundary** checks whether the expected model artifact, preprocessing package, feature version, and policy version actually ran. A routing mistake can send traffic to an old artifact while every pod remains healthy.

The **input boundary** checks schema, units, missing values, freshness, and training-serving parity. A stale stock count or changed unit can damage both the candidate and baseline model because they share the same data path. The **prediction boundary** watches score distributions, confidence, calibration, and fallback behaviour for movement that deserves investigation.

The **decision boundary** sits after the model. Thresholds, ranking rules, eligibility filters, and human review can change how the product uses an identical score. The **outcome boundary** checks whether decisions still produce acceptable results after labels mature. Finally, the **monitoring boundary** checks whether the evidence pipeline still captures, joins, computes, publishes, and alerts as expected.

Suppose quality declines for both the new and old model versions at exactly the same time. Their prediction records show the same feature version turning stale. That evidence places the first failure at the input boundary. Changing model versions would leave the stale feature in place, so the team contains the feature path and repairs materialization instead.

Each boundary has a practical proof. Service metrics prove that requests complete. Deployment metadata and traces prove which artifact and preprocessing package ran. Captured source times and parity replays prove what the model received. Prediction distributions and fixtures prove that outputs remain numerically plausible. Policy logs and action counters prove how the product used those outputs. Mature cohorts prove what happened later. Coverage checks prove that the monitoring path saw enough of production to support those claims.

This sequence gives responders an investigation order. They first verify monitoring freshness and coverage, then execution identity, feature contracts, policy changes, and finally delayed quality. The order moves from evidence that is available quickly toward evidence that takes longer. It also prevents a broken label job from triggering a model rollback or a stale feature from being mistaken for concept drift.

Consider a routing incident. A deployment reports model version 25 as healthy, while traces from one region keep showing version 23. Prediction and latency metrics look normal because both artifacts return the same response shape. The platform owner finds a stale endpoint traffic rule, routes that region to the approved version, and verifies artifact identity with a synthetic request before restoring the normal rollout. The first broken boundary was execution, so retraining would have been unrelated work.

## One Decision Record Connects the Whole Path
<!-- section-summary: A decision record ties one request to the exact model, features, policy, action, and later outcome used during investigation. -->

A **decision record** extends the prediction receipt from the first article. It tells the story of one production decision from request to action. This record lets an investigator move from a fleet-wide alert to representative cases without guessing which versions or fallbacks were involved.

A compact record can contain:

```json
{
  "prediction_id": "pred-8f31",
  "decision_time": "2026-07-18T09:42:00Z",
  "model_version": "eta-model-24",
  "feature_version": "delivery-features-19",
  "policy_version": "promise-policy-7",
  "prediction": 34,
  "action": "promise-35-minutes",
  "feature_age_seconds": 1320,
  "fallback_reason": "traffic-cache-timeout",
  "region": "west"
}
```

The record shows that the model predicted 34 minutes and the product promised 35. It also shows that the traffic feature was 22 minutes old and came through a fallback. A normal application log that records only the HTTP response would miss the most useful part of this explanation.

OpenTelemetry traces can carry bounded identity such as model, feature, and policy versions through the request path. Request-level IDs and full feature values belong in protected logs or inference tables. Prometheus holds low-cardinality aggregates by stable route or region. The warehouse or lakehouse keeps the decision records long enough to join delayed outcomes.

This separation keeps fast monitoring affordable and detailed evidence governed. It also lets the same `prediction_id` connect a trace, a decision record, a reviewer action, and a final outcome when an incident needs deeper analysis.

In practice, the application creates the ID before feature retrieval and carries it through the request context. OpenTelemetry propagation connects spans from the API, feature service, model server, and policy service. Each span records bounded attributes such as model route, artifact version, feature definition version, and fallback state. A separate asynchronous event contains the decision record and lands in protected storage. This design keeps the customer response independent from analytics availability while preserving one identity across both paths.

Capture is verified through reconciliation. The service increments prediction and action counters, the event consumer counts unique decision records, and the warehouse checks duplicates and rejected schemas. A retry can safely write the same prediction twice because the curated table deduplicates by `prediction_id` and record version. A dead-letter queue retains malformed events, and its age and volume are monitored. These controls prevent an observability outage from quietly reducing the population used for model analysis.

Attribute design matters for cost and privacy. Stable values such as `model_route=baseline` or `region=west` fit trace attributes and metric labels. Customer IDs, prediction IDs, free-form errors, and complete feature vectors have high cardinality or sensitive content, so they stay in governed logs and inference tables. An alert links to a filtered investigation view rather than copying raw customer evidence into a paging message.

## Use Early Signals Without Pretending They Are Final Answers
<!-- section-summary: Leading signals reveal broken assumptions quickly, while lagging outcomes show whether users and the product were actually harmed. -->

**Leading signals** arrive around prediction time and describe what the system is doing right now. They include feature age, missing-value rate, fallback share, score distribution, model-route identity, and action volume. These signals can expose a broken contract before final outcomes exist.

**Lagging signals** arrive after the decision. They include prediction error, calibration, customer complaints, reviewer overrides, cancellations, financial loss, and safety events. They carry stronger product meaning and often arrive after the best containment window.

The two groups answer different questions. If a safety-related feature exceeds its maximum age for 35% of requests, the reviewed input contract has already failed. The product owner may route those requests to manual review without waiting a month for final outcomes. The team records the affected prediction IDs so the mature cohort can later show whether the fallback limited harm.

A prediction-distribution change with stable mature quality deserves a lighter response. The model owner checks traffic mix, policy versions, and important segments, then observes through the relevant business cycle. A model rollback would add release risk without evidence that decisions are worse.

Quality can also decline while every existing leading signal stays inside its limit. The team first verifies label definitions and coverage, then examines calibration, residuals, policy behaviour, and inputs that the monitor does not yet cover. This incident can reveal concept drift or a missing leading signal. The final fix may include a new segment or invariant so the next occurrence appears earlier.

Signal selection starts from a failure the team could act on. A maximum feature age protects a time-sensitive input. Artifact identity protects a deployment promise. Fallback share protects a degraded serving path. Action rate protects the process that consumes model output. Each signal has an owner, a normal range, an affected decision, and a safe response. A collection of convenient metrics without those links gives the team more charts and little additional safety.

Thresholds come from contracts and healthy history. A hard safety invariant can page as soon as a sustained minimum volume crosses the limit. A noisy behavioural measure may require a longer window, a relative change against the approved route, and a minimum sample count. Teams replay proposed alerts over known healthy periods and previous incidents, then test their delivery. The goal is a rule that responds quickly enough for the consequence and quietly enough that responders still trust it.

For example, a loan-decision system may send a case to manual review whenever a required income feature is older than its contract. That path does not wait for default outcomes. A recommendation system seeing a small score-distribution movement may open a ticket, compare segments, and wait for engagement outcomes. Both are monitoring responses; their urgency differs because the decisions and available containment differ.

![Timeline connecting leading signals at prediction time to lagging quality and harm signals after outcomes mature, with containment and recovery confirmation](/content-assets/articles/article-mlops-monitoring-silent-model-failure/signal-timeline.png)

*Leading signals buy time for a reversible safety action. Prediction identity connects those early warnings to the later outcomes that confirm harm and prove whether recovery worked.*

## Combine Signals Around the Same Route and Time
<!-- section-summary: Multi-signal rules connect related evidence by route, version, segment, and time so one movement can strengthen or weaken another. -->

**Multi-signal detection** looks for related changes along the same decision path and asks whether they support one coherent failure story. A stale-feature signal carries more consequence when fallback use rises on the same route and later quality worsens for those prediction IDs.

The time boundaries still need care. A five-minute freshness window and a thirty-day mature outcome cohort describe different groups. The dashboard links them through prediction time and version identity without pretending that both are available at the same moment.

Several kinds of detection can work together. Hard invariants protect maximum feature age, allowed categories, expected artifact identity, and minimum label coverage. Change detection finds sustained movement in fallback use, actions, predictions, or features. Canary and shadow comparisons isolate candidate behaviour. Synthetic records and replay tests prove that known failures still travel through capture, dashboards, and alerts.

Prometheus can implement the fast part of a cross-signal rule. This example pages only when stale feature age and a high fallback ratio persist on the same region and model route:

```yaml
groups:
  - name: ml-decision-safety
    rules:
      - alert: StaleFeatureFallbackSpike
        expr: |
          max by (region, model_route) (
            max_over_time(ml_feature_age_seconds{feature="traffic"}[10m])
          ) > 300
          and on (region, model_route)
          (
            sum by (region, model_route) (rate(ml_feature_fallback_total[5m]))
            /
            sum by (region, model_route) (rate(ml_prediction_total[5m]))
          ) > 0.20
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "Stale traffic feature and fallback spike in {{ $labels.region }}"
```

The expression first reduces each signal to one series per region and route. The `and on` clause then matches the two conditions using those labels. The ten-minute `for` period requires the problem to persist before the alert fires. Alertmanager handles grouping and notification routing, while the annotation can include a runbook link and owner.

Before release, `promtool check rules` validates the file. A staging replay or controlled metric series confirms that the alert reaches the intended receiver. Request IDs stay out of metric labels because they would create unbounded cardinality; the alert links the responder to traces and stored prediction records for representative cases.

Production rules also handle missing data explicitly. The fallback ratio in the example has no meaning when the prediction counter is absent or zero. A separate alert checks that expected routes continue exporting `ml_prediction_total`, and a recording rule can calculate a guarded ratio for reuse across dashboards and alerts. This separates “the ratio is healthy” from “the exporter or route disappeared.”

Label matching is another common failure. The two sides of `and on (region, model_route)` must produce the same labels. If one metric uses `route` and the other uses `model_route`, the alert can return no result while both conditions are bad. Unit tests built from input series and expected alerts catch this before deployment. Staging then proves the complete Alertmanager route, including grouping, inhibition, receiver credentials, and the on-call destination.

High-volume systems often precompute expensive or repeated expressions as Prometheus recording rules. The recorded stale share and fallback ratio create stable, inspectable series, while the final alert combines them. This keeps query cost predictable and lets dashboards show the exact signals that drove the page. The warehouse still holds request-level evidence for delayed analysis; Prometheus remains the fast aggregate layer.

## The Monitor Also Needs a Health Check
<!-- section-summary: Monitoring coverage verifies that collection, storage, outcome joins, metric jobs, dashboards, and notifications still represent live production. -->

**Monitoring coverage** asks whether the evidence pipeline can support the claims shown on the dashboard. It protects every other signal because a broken monitor can freeze an old healthy result while production continues to change.

The first check compares eligible requests with captured prediction IDs over the same time window. The next check looks for duplicates, missing partitions, rejected schemas, and retention gaps in durable storage. Outcome jobs report mature predictions, joined labels, orphan labels, pending cases, and censoring. Metric jobs publish their last successful run, input window, code version, duration, and rejected rows.

Publication and alert delivery need their own evidence. Every dashboard panel shows the source window or last computed time. A controlled record with a known stale feature should enter storage, increase the violation count, appear on the dashboard, and route a test notification. A small metric fixture checks maturity and denominator logic.

An absent time series receives explicit treatment. It can mean zero events, a disabled route, a failed exporter, or a monitoring query that stopped matching after a label change. Treating all four states as a healthy zero creates exactly the kind of silent failure the monitor is meant to catch.

Teams usually give the monitoring pipeline its own service-level objectives. Examples include 99.9% prediction-receipt coverage, outcome-join coverage above the expected contract level, drift jobs published within two hours of their input window, and paging tests delivered within a few minutes. These objectives describe the freshness and completeness required before a dashboard can claim that production is healthy.

Reconciliation happens between independent sources. API or model-server counters are compared with unique receipts in durable storage. Product action counts are compared with recorded actions. Source outcome counts are compared with mature joined labels. A large gap creates a monitoring incident even if the model metric itself appears stable. Using an independent count is important because a broken consumer can report both its own numerator and denominator as healthy.

Synthetic probes exercise the path with controlled evidence. One record can contain a deliberately stale feature and an expected fallback. Another can represent a known mature outcome for a metric fixture. The probe should reach storage, validation results, the aggregate metric, dashboard, and notification receiver. Teams schedule this test and alert when any checkpoint fails, while clearly separating synthetic IDs from real quality cohorts.

Dashboards show data time as prominently as render time. “Updated at 10:02” is weak evidence if the underlying cohort ends three days earlier. A useful panel shows the production window, outcome maturity cutoff, last successful job, row coverage, and metric version. This lets a beginner and an incident commander see whether the chart describes current production or an old accepted result.

## Write Alerts for the Decision That May Be Unsafe
<!-- section-summary: A useful alert names the protected decision, failing boundary, evidence strength, owner, safe action, and condition for recovery. -->

A silent-failure alert should explain which decision may be unsafe even though the service is available. It includes the affected boundary, time window, segment, model and policy versions, sample count, related signals, monitoring coverage, recent changes, and runbook owner.

Severity follows consequence and available containment. A critical freshness failure can page before outcomes arrive because the input contract is already broken. A small score-distribution shift can create an investigation. A confirmed outcome regression can page even when every leading signal remained inside its range.

Ownership often crosses team boundaries. The data owner may repair feature freshness, the platform owner may verify routing, the model owner may interpret quality, and the product owner may pause an automated action. The runbook names one primary responder and an escalation path so the alert does not sit between teams.

For example, an alert reports that model version 24 and feature version 19 produced a 38% stale-feature rate and a fourfold fallback increase on the west route. The feature contract names the data owner as primary. The product owner pauses the affected delivery promise through a versioned feature flag. The model owner prepares the later quality comparison for the captured prediction IDs. Everyone works on the same bounded incident.

The alert also defines when containment can end. Fresh inputs and the intended execution versions provide early proof. Stable action rates and complete monitoring show that the route is operating normally. Mature outcomes later show whether the decision quality recovered.

The runbook turns those fields into a short operating path. It starts with links that already filter traces, prediction records, and recent deployments to the affected route and window. It names the reversible control, the person authorized to use it, the command or console location, and the expected confirmation signal. It then lists the evidence needed to hand the incident from containment to repair and the evidence needed to restore traffic.

Alert ownership follows the first likely boundary, with a clear escalation when that hypothesis fails. A feature-age page can start with the data or feature-platform owner. An artifact-identity mismatch starts with the serving platform. A mature quality regression with healthy inputs starts with the model owner and product owner together. The incident can change owner as evidence moves the boundary; the page still reaches someone who can take the first safe action.

An alert should never trigger irreversible automation from one noisy statistical signal. Automated containment is appropriate for deterministic, reviewed failures such as an artifact checksum mismatch or a missing safety-critical feature when a tested fallback exists. Retraining and full promotion require fresh data, evaluation, registry records, and staged release evidence. Automation shortens a known safe response; it does not remove the release process.

## Contain the First Broken Boundary
<!-- section-summary: Industrial incident response uses a reversible control, repairs the failing component in isolation, verifies it with replay and canary traffic, and restores production gradually. -->

**Containment** is a temporary, reversible production change that limits harm while diagnosis and repair continue. It gives the team a safer operating state before every cause is known. The safest control targets the first broken boundary and keeps the rest of the service available where possible.

Teams prepare these controls before an incident. A feature-flag service, versioned policy store, or managed endpoint traffic rule can map one route to an approved baseline, conservative fallback, or review queue. The responder records the old configuration version, affected segment, start time, owner, and rollback action beside the incident.

For a stale online feature, the product owner activates the approved fallback only where the contract failed. The data owner repairs the stream or materialization job in a shadow target. Source offsets and entity counts prove that the replay is complete. Captured source timestamps show that values are current, and row-level parity checks their meaning against the offline calculation.

The platform owner then sends a synthetic request and a small canary through the repaired path. OpenTelemetry traces verify the feature and policy versions. Prometheus watches age, fallback use, error rate, and latency. The warehouse confirms that complete decision records are arriving.

Traffic returns in stages. The team first restores a low-risk segment, then expands while queue age, product completion, and fallback quality remain inside their limits. Any breach sends the route back to the last approved control version. Immediate evidence closes the containment phase, while the captured prediction IDs remain grouped for mature outcome analysis.

A model rollback is appropriate when the failure is isolated to a candidate artifact or its preprocessing package. It helps much less when old and new models share the same stale feature or changed policy. Failure-boundary evidence keeps the response attached to the actual mechanism.

Policy incidents need their own control. Suppose a threshold configuration sends twice as many low-risk transactions to review while model scores remain unchanged. The policy owner restores the previous version, verifies action volume and queue age, and replays the proposed threshold on a mature cohort before another canary. Rolling back the model would preserve the same policy error because the broken boundary sits after prediction.

A broken outcome join calls for a different containment. The monitoring owner marks quality results unavailable, freezes automated retraining and model promotion, and leaves the serving route unchanged if leading safety signals remain healthy. The data owner repairs the join in a candidate table and recomputes the same cohorts. Coverage, representative ID traces, metric fixtures, and a controlled alert prove recovery before automation resumes.

When the cause is still unknown and the potential harm is high, the product owner can choose a conservative mode. Reducing the eligible population limits exposure. Human review suits decisions where trained reviewers can handle the extra volume. A cap can limit the size of an automated action. Some systems can route to a simple approved rule with known behaviour.

The team records exactly which predictions received that control. A conservative fallback can reduce immediate risk while investigation continues. Its latency shows whether users can still complete the product flow. Queue depth shows whether people or downstream systems can handle the extra work. Mature outcomes later show the quality of the fallback itself.

## Choose Tools Around the Evidence You Need
<!-- section-summary: Managed services and open tools can automate collection and analysis, while decision identity, outcome joins, coverage, and containment remain architectural responsibilities. -->

A practical open stack uses OpenTelemetry for request traces and Prometheus with Grafana or cloud monitoring for fast operational signals. Object storage, a warehouse, or a lakehouse retains decision records. dbt or Spark builds verified outcome cohorts, and Evidently or application code calculates model analysis. Airflow, Dagster, or a managed workflow schedules the jobs.

The components divide work by timescale. OpenTelemetry and Prometheus answer what is happening during the request and the next few minutes. Kafka or a cloud event stream moves receipts without coupling analytics to the response. S3, GCS, ADLS, Snowflake, BigQuery, or Delta tables retain governed history. dbt suits warehouse transformations and tests; Spark suits distributed backfills and large lakehouse windows. Evidently or a specialist platform performs model-focused analysis, while Airflow, Dagster, or managed ML pipelines enforce the dependency order.

A small organization does not need every product in that sentence. One service can write receipts to a protected warehouse table. dbt can build and test daily cohorts, the existing scheduler can run the dependency chain, and cloud monitoring can deliver operational alerts.

A larger real-time fleet has a different operating problem. Streaming capture decouples high request volume from durable storage. OpenTelemetry Collector infrastructure and Prometheus recording rules give several services a consistent fast-signal path. Governed inference tables preserve long histories, and a cross-platform monitoring product can provide one investigation view across teams. Latency, volume, reuse, and organizational boundaries justify those extra components.

Provider services can package parts of this path. As checked on 18 July 2026, Azure Machine Learning supports built-in tabular data drift, prediction drift, and data quality. Its classification, regression, and feature-attribution signals remain in Preview.

Google now documents Model Monitoring under Gemini Enterprise Agent Platform. Model Monitoring v2 remains Preview and supports tabular models running on the platform or elsewhere. Production teams that need generally available endpoint support should examine Model Monitoring v1 and its narrower scope before choosing a version.

Databricks can capture requests and responses in Unity Catalog Delta inference tables and run table-based profiling. The newer Unity AI Gateway experience is Beta. Teams need a supported serving route and region, and the workspace must use Unity Catalog. The identity configuring the table also needs the required catalog and table permissions.

AI Gateway payload logging can arrive less than an hour after a request. That delay suits later analysis and audit, while fast service telemetry still needs a separate path.

Amazon SageMaker Model Monitor remains available to existing customers for data quality, model quality, bias drift, and feature-attribution drift. AWS says new-customer access closes on 30 July 2026 and no new features are planned. Existing customers can continue operating it. A new AWS design should use governed prediction storage, managed processing or the existing data platform, and CloudWatch or another monitoring layer rather than adopting Model Monitor as a new strategic default.

Specialist platforms such as Arize, Fiddler, and WhyLabs can add fleet views, managed investigations, and governance across several serving platforms. They provide the most value when cross-platform scale justifies another control plane. A smaller team with one data platform may learn more from a well-built warehouse pipeline and clear runbooks.

Managed services also have different release stages and timing. Azure's built-in tabular data drift, prediction drift, and data-quality signals are available alongside Preview model-performance and feature-attribution signals. Google's v2 monitor is Preview and requires registered tabular model versions plus supported data sources. Databricks inference-table logging is designed for governed later analysis and can arrive too slowly for minute-level safety controls. Existing SageMaker Model Monitor customers can continue to use scheduled jobs, while a new AWS architecture should account for the announced access change rather than make the service a future dependency.

These limits influence the architecture. Provider monitoring can automate scheduled comparisons and dashboards, while request-time freshness, artifact identity, decision policy, and emergency routing remain in the application and observability path. The warehouse or lakehouse keeps a portable evidence history. This layered design lets a team change one monitoring product without losing the record needed to explain earlier decisions.

No platform can recover identity or outcomes that the application never recorded. The tool choice comes after the team decides which decision evidence, time windows, owners, and containment controls the system requires.

![Silent-failure response locating the broken boundary, applying a reversible control, repairing in shadow, replaying evidence, canarying the route, restoring gradually, and confirming immediate and mature proof](/content-assets/articles/article-mlops-monitoring-silent-model-failure/silent-failure-response.png)

*The recovery framework stays the same across tools: locate the first broken boundary, contain it with a reversible control, repair in isolation, and expand only when immediate and mature evidence support the change.*

## The Main Idea
<!-- section-summary: Silent model failure is detected by connecting successful computation to execution identity, healthy inputs, expected decisions, mature outcomes, and monitoring coverage. -->

Silent model failure lives in the space between “the request succeeded” and “the decision helped.” Ordinary service metrics protect the request. Execution identity, feature health, prediction behaviour, product actions, and mature outcomes protect the meaning of that request.

The monitoring system completes the chain by proving that its own evidence is current. When several signals point to the same boundary, the team can contain the affected decision, repair the cause, verify the replacement path, and restore traffic gradually. That connected evidence turns a quiet model failure into an incident the organization can understand and control.

## References

- [Google Rules of ML: monitoring](https://developers.google.com/machine-learning/guides/rules-of-ml#monitoring)
- [Prometheus instrumentation practices](https://prometheus.io/docs/practices/instrumentation/)
- [Prometheus metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus operators and vector matching](https://prometheus.io/docs/prometheus/latest/querying/operators/)
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [Azure Machine Learning model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring?view=azureml-api-2)
- [Google Model Monitoring overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-monitoring/overview)
- [Databricks AI Gateway inference tables](https://docs.databricks.com/aws/en/ai-gateway/inference-tables-serving-endpoints)
- [Databricks data profiling](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/)
- [Amazon SageMaker Model Monitor](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html)
- [Amazon SageMaker Model Monitor availability change](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor-custom-monitoring-schedules.html)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
