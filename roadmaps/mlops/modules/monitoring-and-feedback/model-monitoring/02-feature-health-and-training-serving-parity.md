---
title: "Feature Health and Training-Serving Parity"
description: "Monitor feature schemas, freshness, nulls, ranges, distributions, transformations, and point-in-time parity between training and online inference."
overview: "Feature health verifies that production inputs remain available, fresh, valid, and meaningful. Training-serving parity verifies that training and inference calculate the same feature definition for the same entity and event time."
tags: ["MLOps", "production", "monitoring"]
order: 2
id: "article-mlops-monitoring-feature-health-training-serving-parity"
aliases:
  - roadmaps/mlops/modules/monitoring-and-feedback/model-monitoring/04-feature-health-and-training-serving-parity.md
---

## The Model Only Knows the Values It Receives
<!-- section-summary: Feature health checks whether live model inputs still carry the same meaning and timing as the data used during training. -->

A model never sees a customer, a house, or a delivery truck directly. It sees **features**: values such as account age, number of bedrooms, current inventory, or distance to a destination. **Feature health** checks whether those live values are present, valid, fresh, and meaningful when the model uses them.

This distinction explains why an inference service can return `200 OK` while making poor decisions. A delivery model may receive yesterday's traffic estimate. A fraud model may receive an amount in cents after training on pounds. A product model may receive `0` when a category lookup fails, even though zero means a real category. The code runs successfully and the input shape is correct, while the value tells the model the wrong story.

**Training-serving parity** adds a second question: would the training pipeline and the live inference path calculate the same feature for the same case at the same point in time? Training often uses a warehouse or Spark job. Online inference may use a feature store, cache, stream processor, or request-time function. Those systems can implement the same feature name with different formulas, timestamps, defaults, or software versions.

The complete path looks like this:

![One feature contract feeding historical training and live serving paths, with request-time health checks and row-level parity replay](/content-assets/articles/article-mlops-monitoring-feature-health-training-serving-parity/feature-health-parity-map.png)

*The feature contract supplies one meaning to two calculation paths. Health checks protect the live value, while parity replay asks whether offline and online calculations agree for the same entity and decision time.*

The definition is the shared starting point. Health checks ask whether live delivery respected that definition. Parity replay compares the two calculation paths. Once the team knows which boundary failed, it can repair the data path instead of reaching immediately for a model rollback.

## A Feature Contract Explains What a Value Means
<!-- section-summary: A feature contract records the business meaning, time rules, validation limits, ownership, and serving behaviour of one model input. -->

A **feature contract** is the reviewed description of one feature. It explains what the value represents and which rules must remain true when the feature moves through training and production, so every pipeline answers the same business question.

The contract gives data producers, model developers, and serving engineers one shared definition. Without it, each team can build a locally reasonable implementation and still send a different meaning into the model. Monitoring thresholds and fallback behaviour also need this definition because the safe response depends on what the value represents.

Take a feature named `orders_last_30d`. The name sounds clear until two engineers implement it. Does it include cancelled orders? Does “30 days” mean 30 times 24 hours or 30 calendar dates? Which timezone applies? Does the current order count? How are refunds handled? Both pipelines can return an integer while answering different business questions.

The contract removes that ambiguity. It names the owner and version, describes the formula and units, identifies the entity key, and records the source. It also explains the time window, event timestamp, maximum age, missing-value rule, valid range, and serving fallback. Each part supports a different production decision.

For example, a missing `account_age_days` value may be valid for a new customer if the contract defines an explicit `unknown` state. A missing `current_inventory` value can make an availability promise unsafe. The first feature may use a known default, while the second may require a conservative stock rule or a pause in automated promises. The data type alone cannot make that choice; the meaning of the feature can.

Contracts also need versions. If the team changes `orders_last_30d` to exclude refunds, it can publish version 2 and bind new models to that definition. Changing the formula in place makes old predictions impossible to reproduce and turns parity comparisons into comparisons between two different questions.

The contract proves its value when enforcement happens close to each failure. At the producer boundary, a schema registry, Protobuf definition, or JSON Schema can reject incompatible event shapes. In the warehouse, dbt data tests check keys, relationships, allowed values, and business-specific queries. Great Expectations or Pandera can validate data frames inside Python and Spark jobs. At request time, Pydantic or the service's native schema validator can protect critical fields before inference.

These tools overlap, and each sees a different moment. A dbt test can catch that a daily table lost 12% of its customer rows. A request validator can stop a negative inventory value before it reaches a live decision. A schema registry can catch a producer changing an integer to a string before either consumer runs. Teams choose the smallest combination that covers their real boundaries instead of making every rule run in every system.

Enforcement also has a release path. A contract change is proposed with compatibility expectations and sample data. Producers publish the new field or formula alongside the old version, consumers dual-read or shadow the new path, and parity checks compare the results. Only after dependent models and dashboards understand the new meaning does the owner retire the previous version. This staged change prevents an innocent data migration from silently changing a model input.

## Follow the Value and Its Timestamps
<!-- section-summary: Feature telemetry records which value reached the model, where it came from, when it was produced, and whether a fallback path supplied it. -->

**Feature telemetry** is the evidence showing what the model actually received. The value matters, and its timing matters just as much. A stock count of `42` can be correct now, stale by three hours, or copied from a fallback cache after the normal source failed.

Three timestamps help explain that journey. **Event time** says when the real-world event happened. **Processing time** says when a pipeline handled it. **Materialization time** says when the derived feature reached the place used by inference. A widening gap between these timestamps can reveal late events, a stalled stream, or an online store that stopped updating.

Suppose `current_inventory` has a five-minute freshness limit. One region starts serving values that are forty minutes old after a materialization job stalls. Every request still contains an integer inside the expected range. A `feature_age_seconds` field exposes the failure, and a `fallback_reason` shows whether the service used an older cached value after a timeout.

Request-level values usually belong in a protected inference table with a retention and sampling policy. Fast aggregates such as stale-value share, missing-value rate, and fallback rate fit Prometheus or the cloud monitor. The metrics tell the on-call engineer that a route is unhealthy. The request records provide the feature versions and timestamps needed to explain why.

Freshness is usually written as a service-level objective for the feature path. The contract may say that 99% of `current_inventory` values must be no more than five minutes old over a ten-minute window. The monitor calculates age from the source timestamp that travelled with the value, rather than the time the inference service read it. Reading an old cache entry right now does not make the underlying fact current.

Streaming systems add a **watermark**, which is the platform's estimate of how far event-time processing has progressed. If the source is producing events at 10:30 while the feature job's watermark remains at 10:05, the pipeline is twenty-five minutes behind even if workers are busy. Consumer lag, watermark delay, materialization age, and request-time feature age describe different parts of the same path. Keeping them separate helps the responder locate whether events stopped at the source, stream processor, online store, or client cache.

For example, source events can arrive on time while one regional online store stops accepting writes. The global stream lag remains healthy, and a warehouse profile still sees current values. Request records from that region show rising feature age and a fallback to cached data. The product owner applies the approved regional fallback, while the platform owner repairs replication. A warehouse-only freshness check would miss the exact boundary that affected decisions.

## Health Checks Ask Several Different Questions
<!-- section-summary: Feature checks cover structure, completeness, validity, freshness, relationships, and population movement because each failure has a different cause. -->

A **feature-health check** turns one contract rule into a test that can run in the data pipeline, the inference service, or the monitoring job. Several kinds of tests are needed because a valid-looking number can still be wrong in many ways.

Each check answers a narrower question and points toward a different owner. A schema failure suggests that the shape changed at a producer boundary. A freshness failure suggests that delivery stopped moving. A distribution change may describe a healthy pipeline serving a genuinely different population. Separating these questions gives the alert a useful first action.

**Schema checks** protect names, types, and shapes. They catch a producer that changes an integer field into a string or removes a required column. These failures usually belong to the source or API boundary because the contract changed before the feature calculation ran.

**Completeness checks** look for missing entities, null values, and broken joins. Imagine that every account in one country disappears from a daily feature table after a country-code change. The rows that remain can all look valid. Coverage by country exposes the missing population.

**Value checks** enforce ranges, categories, units, and relationships between fields. A temperature of `70` can be valid Fahrenheit and invalid Celsius. `available_inventory` and `physical_inventory` can each be positive integers while the first exceeds the second. Relationship rules need input from the domain owner because the storage system cannot infer the business constraint.

**Freshness checks** compare source or materialization time with the decision time. They catch values that are still well formed but too old for the decision. **Distribution checks** look at the wider population: perhaps the share of four-bedroom homes rises sharply or a new device category appears. A distribution shift deserves investigation, while a freshness or schema failure already identifies a broken contract.

These checks run at different boundaries. The data pipeline tests source and derived tables before publication. The inference service validates critical fields and feature ages before making a decision. A scheduled job profiles accepted production values across a longer window. One successful warehouse test cannot prove that the online cache remained fresh during the hour between runs.

The response attached to a check depends on consequence. A nullable marketing attribute may produce a warning and a ticket when its missing rate rises slowly. An absent braking-distance feature in a safety-related system may route the case to a conservative rule immediately. The contract records this response so the validator does more than print an error that nobody owns.

Consider a supplier that changes parcel weight from kilograms to grams without changing the numeric type. Schema and completeness checks pass. A value-range check sees median weight jump from `2.4` to `2400`, while a relationship check shows calculated shipping cost far outside the reviewed range. The data owner quarantines the new partition, updates the adapter to convert the producer unit into the contract unit, and backfills a candidate table.

Recovery requires evidence at every affected boundary. The candidate table passes the contract suite, representative parcels match their source records after conversion, and a parity replay reconstructs decisions from the incident window. The model owner then recomputes prediction and action distributions to see whether any bad values reached production. If they did, the product owner identifies decisions that need correction or customer follow-up. Fixing the column alone would leave the incident only partly handled.

## Parity Means Replaying the Same Case
<!-- section-summary: Row-level parity reconstructs a live feature with the training logic for the same entity and time, then explains every meaningful mismatch. -->

**Row-level parity** compares the training and serving calculations for one real prediction. You can think of it as asking two kitchens to prepare the same recipe with the same ingredients and the same cutoff time. If the dishes differ, the team looks for a different ingredient, instruction, or timing rule.

A parity job starts with sampled production prediction IDs. It retrieves the value captured when each prediction was made, then asks the historical pipeline to reconstruct the feature using only data available at that moment. The comparison keeps the feature version, model route, source timestamp, and mismatch reason visible.

Different features need different comparison rules. A category, flag, or deterministic count should usually match exactly. A floating-point transformation may need a small absolute and relative tolerance because two runtimes can produce tiny numerical differences. An eventually consistent aggregate needs both a value tolerance and a source-time tolerance. A count that differs by one event during a reviewed two-minute delivery delay may be acceptable; a value served from a forty-minute-old source is a freshness failure.

Approximate sketches and embeddings need a distance measure rather than exact equality. The algorithm and configuration still have to match, and embeddings need the same embedding-model version.

A feature that exists only during the live request cannot always be reconstructed later. In that case, the captured value provides the starting evidence. Its definition version says which calculation produced it, while the source timestamp and fallback state explain whether the normal data path succeeded.

Consider a replay of 500 recent predictions. Eighteen percent disagree, and every mismatch belongs to a new serving route. The captured rows show that serving rounds a currency value before applying a logarithm, while training rounds afterward. The release owner pauses that route, deploys the reviewed transformation package, and reruns the same 500 IDs. Traffic returns only after the mismatch rate falls inside the agreed tolerance and new prediction records show the intended package version.

Shared transformation code reduces this risk. A versioned Python package can serve both the training job and inference service. TensorFlow Transform can export preprocessing logic for both paths. Shared code still needs replay because source visibility, time cutoffs, defaults, and deployment versions can differ around the calculation.

A production parity job normally produces a mismatch table rather than one percentage. Each row keeps the prediction ID, feature name, online value, reconstructed value, absolute and relative difference, online and offline source times, definition versions, and a mismatch category. Useful categories include formula mismatch, stale online value, late source event, default-value difference, unavailable reconstruction, and tolerance breach. This taxonomy turns “18% mismatch” into work that can be assigned to a specific owner.

Sampling should cover the routes most likely to differ. Teams include recent releases, fallbacks, important segments, and a stable random sample of normal traffic. A canary may replay every prediction because its volume is small. A mature high-volume route may use a few thousand cases per day plus any request involved in an alert. The sampling configuration is versioned so a sudden improvement cannot come from quietly dropping the difficult route.

The parity result can guard releases as well as monitor production. Before promotion, the candidate serving image processes a fixture of historical requests while the offline transformation reconstructs the same cases. After deployment, shadow traffic exercises live sources without changing the product action. The release gate checks mismatch rate, unavailable reconstructions, latency, and feature age. This sequence catches packaged-code drift before user outcomes have time to arrive.

## Historical Features Must Stop at the Prediction Time
<!-- section-summary: Point-in-time joins build each training row from information that was genuinely available when the historical decision would have happened. -->

**Point-in-time correctness** means that a historical training row uses only information available at its prediction time. It keeps offline training inside the same information boundary that the live model will face and prevents the pipeline from borrowing facts from the future.

This rule protects the promise made by offline evaluation. A model should be tested with the same information boundary it will face in production. If training sees facts that a live request could never have known, an excellent test score can disappear as soon as the model is deployed.

Imagine a model trained to predict whether an order will be returned. A training row represents the order at 10:00 on 1 June. The warehouse now contains a support complaint from 8 June and the confirmed return from 10 June. A normal “give me the latest customer record” join can attach those future facts to the older row. The model then learns part of the answer it is supposed to predict.

The correct join works backward from the prediction timestamp. It selects the newest eligible feature value whose availability timestamp is at or before that decision. Availability time matters because an event can happen before the decision and still arrive in the platform afterward.

| Candidate record | When it happened | When the platform received it | Usable at 1 June, 10:00? |
|---|---:|---:|---|
| Profile update | 28 May | 28 May | Yes |
| Support message | 1 June, 09:30 | 1 June, 10:20 | No |
| Confirmed return | 10 June | 10 June | No |

![Point-in-time timeline using a profile update and blocking a late-arriving support message and future return outcome](/content-assets/articles/article-mlops-monitoring-feature-health-training-serving-parity/point-in-time-boundary.png)

*Point-in-time retrieval follows availability as well as event time. The support message happened before the prediction, yet the platform learned about it twenty minutes too late for that historical row.*

The support message happened before the prediction, while the model service could not have seen it at 10:00. The return is the future outcome. Point-in-time logic excludes both. Small fixtures around these boundaries provide strong tests: one event just before the cutoff, one that arrives late, one after the prediction, and one outside the feature's lookback window.

Discovering leakage after training creates a data and release incident. The model owner freezes promotion from the affected dataset, and the data owner uses lineage to find the feature versions, snapshots, and registered models that consumed the faulty join. The team preserves the old dataset and marks it as affected, which stops another pipeline from treating its inflated evaluation as valid.

The replacement dataset is built separately. A warehouse can use an as-of join over the entity key and availability timestamp. Feast or a managed feature platform can perform point-in-time historical retrieval when the organization already operates that layer. The clean build publishes the relevant timestamps, runs the boundary fixtures, and reconciles entity and segment counts with the affected snapshot.

Every model trained on the contaminated data is evaluated again. If a production model earned approval from leaked results, the release owner can route traffic to the last approved artifact trained on clean data. A replacement model then passes segment evaluation, shadow traffic, and a canary before taking the full route. Historical reports receive a corrected revision, and the registry records which approvals changed. Recovery includes the dataset, the affected artifacts, and every downstream consumer of the old evidence.

## A Small Production Stack Can Cover the Important Boundaries
<!-- section-summary: Teams usually combine existing data tests, shared transformations, operational metrics, and replay before adding a dedicated feature platform. -->

The simplest credible stack follows the path the data already takes. A warehouse-based batch model can use dbt data tests for table contracts, a versioned Python package for transformations, scheduled SQL for replay, and the existing cloud monitor for alerts. An online model adds request-time validation and low-cardinality freshness metrics.

Here is a compact dbt data test for a five-minute freshness contract. dbt treats returned rows as failures, so the query returns only regions whose stale share exceeds one percent:

```sql
SELECT
  region,
  AVG(
    CASE
      WHEN feature_age_seconds IS NULL OR feature_age_seconds > 300 THEN 1.0
      ELSE 0.0
    END
  ) AS stale_share
FROM {{ ref('prediction_features') }}
GROUP BY region
HAVING AVG(
  CASE
    WHEN feature_age_seconds IS NULL OR feature_age_seconds > 300 THEN 1.0
    ELSE 0.0
  END
) > 0.01
```

The file lives in the dbt project's `tests/` directory and runs after the feature table is built. A failure can stop publication of a batch result or route an incident through the orchestrator. The inference service still checks a critical online feature at request time because this query cannot see a cache that turns stale between warehouse runs.

A feature platform earns its operating cost when many models reuse the same definitions. It can also help when teams repeatedly build point-in-time training sets or several online services need the same low-latency values. Feast, Databricks Feature Engineering, and managed provider services can cover these retrieval jobs.

The platform gives the organization a shared place for feature definitions and access. Data producers still own source correctness. The serving application still enforces request-time safety, and the model team still decides which changes matter to quality. Clear boundaries keep the feature platform from turning into an assumed owner for every data problem.

Current managed monitoring can automate parts of the work. As checked on 18 July 2026, Azure Machine Learning provides built-in signals for tabular data drift, prediction drift, and data quality. Its feature-attribution and model-performance signals remain in Preview.

Google now documents Model Monitoring under Gemini Enterprise Agent Platform. Model Monitoring v2 remains Preview, supports tabular models, and can monitor models served outside the platform. Databricks data profiling can work over governed Delta tables, while its newer Unity AI Gateway experience is Beta.

These services reduce integration work. They can schedule comparisons, store results, and connect alerts to the provider's monitoring service. The team still needs a trustworthy feature definition and production evidence because no managed monitor can reconstruct values that the application never captured.

Tool choice follows the latency and reuse pattern. A warehouse-first stack is usually enough for daily or hourly batch predictions: dbt owns tested transformations, Airflow or Dagster schedules them, and the serving job reads a versioned table or files from object storage. A low-latency online system may add Kafka or a cloud stream, Flink or Spark Structured Streaming, and Redis, DynamoDB, Bigtable, or a managed online feature store. The feature store sits between calculation and retrieval; it does not replace source validation, stream monitoring, or request-time safety.

Feast is useful when a team needs a common feature registry plus point-in-time historical retrieval and online serving across its own infrastructure. A managed feature service can reduce platform operations when most workloads already live with one cloud provider. Databricks Feature Engineering fits teams whose training data, governance, and serving path already center on Unity Catalog and Delta. Adopting a feature platform for one daily table usually adds more ownership and failure modes than it removes.

The alerting path remains deliberately small. The feature pipeline writes detailed validation failures to a warehouse audit table or Great Expectations validation store. Prometheus, Grafana, or the cloud monitor receives aggregates such as stale share, missing share, parity mismatch rate, and job freshness. Airflow or Dagster carries task failures and dataset dependencies. This separation gives the responder fast notification and enough row-level evidence to investigate without placing customer identifiers in metrics.

## Recover the Failing Feature Path
<!-- section-summary: A feature incident limits unsafe decisions, repairs the first broken boundary, verifies the replacement path, and restores traffic gradually. -->

When a feature alert fires, the team first finds the affected time window and serving route. Prediction records then show which feature and model versions passed through that route. Stable segment fields reveal whether the problem is global or limited to one part of traffic.

The response follows the first failed boundary. A renamed source column belongs to the producer or transformation owner. Materialization lag belongs to the streaming or feature-platform owner. A valid population shift needs model and product analysis.

Suppose two model versions lose quality at the same time and both show a sharp rise in `feature_age_seconds`. Rolling back the candidate model would leave both versions reading the same stale online value. The product owner activates a reviewed fallback only for the affected region, and the platform owner stops the damaged materializer so it cannot continue publishing old values.

The data owner restores the last confirmed checkpoint and replays missing events into a shadow namespace. Entity counts, source timestamps, and representative values are compared with the offline table. Once the shadow target reaches the current source watermark, the parity job reconstructs prediction IDs from the incident window.

A small share of traffic then moves to the repaired namespace. Freshness and row-level replay confirm that the values are current and correct. Lookup errors and latency show whether the repaired path can serve production safely. Fallback share confirms that normal retrieval has resumed.

Any breach sends traffic back to the fallback. The incident remains open through the agreed observation window, and delayed product outcomes later confirm whether the repaired feature path restored model quality.

A schema incident follows a similar structure with a different repair. Suppose a producer removes `country_code` after an API migration and the feature join silently drops all customers in two countries. The source contract test blocks the next batch publication, while request-time coverage metrics reveal the already affected online route. The product owner selects the conservative path for those countries. The producer restores a compatible field or publishes a versioned replacement, and the data owner backfills the missing entities into a shadow table.

The team compares source counts, feature-table coverage, and prediction receipts by country before switching readers. A canary then proves that the restored field reaches the intended transformation and online store. The rollback remains the old API adapter plus the conservative product rule until both parity and coverage remain healthy through a complete data cycle. This is the practical difference between detecting a missing column and recovering the decision path that depended on it.

![Feature incident recovery from detection and route containment through shadow repair, verification, canary traffic, staged restoration, and rollback](/content-assets/articles/article-mlops-monitoring-feature-health-training-serving-parity/feature-path-recovery.png)

*Feature recovery keeps the affected route safe first, repairs data in isolation, and restores traffic only after source progress, entity coverage, replay parity, and serving latency agree.*

## The Main Idea
<!-- section-summary: Reliable feature monitoring keeps the meaning, timing, and calculation of model inputs consistent from historical training data to live inference. -->

Feature health asks whether live values still satisfy their definitions. Training-serving parity asks whether historical and live calculations agree for the same case and time. Point-in-time correctness protects training from future information, while distribution monitoring shows how valid production inputs change around the model.

Together, these checks locate failures before the team changes the model itself. A stale cache calls for data-path recovery, while a changed unit calls for a producer or transformation fix. A mismatch isolated to one serving route points toward its deployed calculation. A genuine population shift sends the team toward drift and quality analysis.

The practical lesson is to preserve enough evidence to tell those cases apart. The contract explains the intended meaning. Captured timestamps show what reached inference, parity replay compares the two calculations, and a bounded recovery proves that the repaired route is safe. That chain keeps a data failure from turning into an unnecessary model change.

## References

- [TensorFlow Data Validation guide](https://www.tensorflow.org/tfx/guide/tfdv)
- [TensorFlow Transform preprocessing recommendations](https://www.tensorflow.org/tfx/guide/tft_bestpractices)
- [Feast point-in-time joins](https://docs.feast.dev/getting-started/concepts/point-in-time-joins)
- [Great Expectations Core overview](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/)
- [dbt data tests](https://docs.getdbt.com/docs/build/data-tests)
- [Azure Machine Learning model monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-monitoring?view=azureml-api-2)
- [Google Model Monitoring overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/model-monitoring/overview)
- [Databricks data profiling](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-quality-monitoring/data-profiling/)
