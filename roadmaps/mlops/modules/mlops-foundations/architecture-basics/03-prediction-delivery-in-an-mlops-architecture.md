---
title: "Prediction Delivery in an MLOps Architecture"
description: "Follow a production prediction from a request, dataset, event, or device signal through features, model execution, product policy, action, evidence, failure handling, and feedback."
overview: "Prediction delivery gets an approved model's result to the product before its deadline, using valid and fresh inputs, a defined decision policy, traceable records, observable behavior, and a safe failure path."
tags: ["MLOps", "core", "architecture", "delivery"]
order: 3
id: "article-mlops-mlops-foundations-batch-online-streaming-systems"
aliases:
  - roadmaps/mlops/modules/mlops-foundations/architecture-basics/03-batch-online-streaming-systems.md
  - child-architecture-basics-03-batch-online-streaming-systems
---

## Table of Contents

1. [How Do Product Timing and Triggers Define Prediction Delivery?](#how-do-product-timing-and-triggers-define-prediction-delivery)
2. [How Does Raw Context Become a Valid Model Input?](#how-does-raw-context-become-a-valid-model-input)
3. [How Does Inference Become a Product Action?](#how-does-inference-become-a-product-action)
4. [How Are Predictions Connected to Later Outcomes?](#how-are-predictions-connected-to-later-outcomes)
5. [What Happens If a Prediction Cannot Be Delivered?](#what-happens-if-a-prediction-cannot-be-delivered)
6. [How Do Batch, Online, Streaming, and Asynchronous Delivery Differ?](#how-do-batch-online-streaming-and-asynchronous-delivery-differ)
7. [Where Should the Model Run and How Should Delivery Be Operated?](#where-should-the-model-run-and-how-should-delivery-be-operated)
8. [How Should the Complete Delivery Path Be Built and Tested?](#how-should-the-complete-delivery-path-be-built-and-tested)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A fraud score returned five minutes after a payment request is useless even if the score is accurate. A churn score produced overnight may be completely useful if the marketing team receives it before the morning campaign. The delivery path has to match the moment when the product needs the prediction.

That path begins with a trigger. It gathers and validates inputs, builds features, and runs the approved model. It then applies the business rule, sends the result to its consumer, and records the model version and action. Later, it connects the decision to the real outcome.

The path also needs a failure rule. A recommendation service might return popular items. A fraud system might use fixed rules or send the payment to manual review. The correct fallback depends on the product risk, not on the model alone.

Design the full prediction path through these questions:

1. **How Do Product Timing and Triggers Define Prediction Delivery?**
2. **How Does Raw Context Become a Valid Model Input?**
3. **How Does Inference Become a Product Action?**
4. **How Are Predictions Connected to Later Outcomes?**
5. **What Happens If a Prediction Cannot Be Delivered?**
6. **How Do Batch, Online, Streaming, and Asynchronous Delivery Differ?**
7. **Where Should the Model Run and How Should Delivery Be Operated?**
8. **How Should the Complete Delivery Path Be Built and Tested?**

## How Do Product Timing and Triggers Define Prediction Delivery?
<!-- section-summary: The last useful decision moment and the event that requests a prediction determine the delivery mode, latency budget, and shape of the production path. -->

A fraud model may estimate:

$$
f(x)=P(\text{fraud}\mid x)=0.91
$$

The product needs that estimate in time to approve, verify, or block the transaction. A policy might use:

$$
Action(p)=
\begin{cases}
Approve & p<0.30 \\
Verify & 0.30\le p<0.80 \\
Block & p\ge0.80
\end{cases}
$$

The delivery system's responsibility is to make the estimate available correctly and reliably before the action deadline.

Total delivery time includes more than model execution:

$$
T_{delivery}=T_{input}+T_{feature}+T_{inference}+T_{network}+T_{policy}
$$

For example:

```text
feature retrieval       15 ms
model inference         20 ms
network                 10 ms
business policy          2 ms
other overhead          13 ms
-----------------------------
total                   60 ms
```

If the requirement is P95 below 100 milliseconds, the path has 40 milliseconds of headroom. A 20-millisecond model does not imply a 20-millisecond product response.

Something must trigger each prediction. A homepage request can trigger recommendations. A card transaction can trigger fraud scoring. A 02:00 schedule can trigger churn scoring for every active customer. A sensor event can trigger anomaly detection. The trigger largely determines whether the path is interactive, batch, or event-driven.

The generic path is:

```text
product event or schedule
    ↓
prediction request
    ↓
input validation
    ↓
feature retrieval or computation
    ↓
approved model inference
    ↓
post-processing
    ↓
decision policy
    ↓
product action
    ↓
prediction record
    ↓
eventual outcome
```

### Budget the Entire Deadline

The product deadline should be divided among the components that share it. Feature retrieval cannot consume 90 milliseconds of a 100-millisecond request and still leave enough time for networking, model execution, policy, serialization, and safety margin. Teams can assign internal budgets and observe each one separately.

The useful lifetime also differs from technical availability. A churn score may remain useful for a day, a customer-value estimate for an hour, a page recommendation for the current response, and a fraud score only until authorization completes. The contract should state both the required completion time and how long a delivered result remains valid.

Triggers carry identity and context. A scheduled batch should record the logical scoring date and input snapshot. A stream event should preserve its event ID and event time. An online transaction should use a stable request or transaction ID. These identifiers later support retry, traceability, and outcome joins.

![Complete prediction-delivery path from a production trigger through input checks, features, model execution, product policy, action, and later outcome](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/trigger-to-product-action.png)

*A useful result crosses the entire path before the product deadline and leaves evidence for later evaluation.*

## How Does Raw Context Become a Valid Model Input?
<!-- section-summary: A versioned contract, explicit validation, semantically consistent feature logic, and a freshness policy turn request data and historical context into trustworthy model features. -->

The product and prediction system need a request and response contract. A fraud service may accept:

```text
transaction_id
customer_id
amount
merchant_id
timestamp
```

and return:

```text
fraud_probability
model_version
prediction_id
```

The contract specifies required and optional fields, types, units, ranges, meaning, schema version, response structure, and error behavior:

$$
RequestSchema \rightarrow PredictionSystem \rightarrow ResponseSchema
$$

Validation runs before inference. A model expecting ages from 18 to 120, a known country category, and nonnegative amounts should not silently accept `age=-43`, `country=null`, and `transaction_amount="unknown"`.

Useful checks include presence, type, range, category, timestamp freshness, and schema compatibility. The delivery layer requires (Valid(x)=True) before it calls (f_\theta(x)).

Input validity and model confidence answer different questions. A corrupted input can produce a fraud probability of `0.99`. The high score says what the model calculated given the supplied representation. It does not prove that the representation was trustworthy.

The request often lacks the full model vector. It may include customer ID, £900, and merchant M19 while the model needs:

$$
x=[amount,transactions_{24h},average\_spend_{30d},merchant\_risk,account\_age]
$$

The serving path retrieves or computes history and context before inference.

Feature delivery has three properties:

$$
\boxed{Correctness+Availability+Freshness}
$$

A stored value of `transactions_24h=2` may be correct for three hours ago and wrong for the current decision after twelve additional transactions. Each feature needs a freshness limit and defined behavior after the limit is exceeded.

Training and serving must preserve the same semantics. If training counts successful transactions in a rolling 24-hour window while serving counts all transactions since midnight, then (F_{train}\neq F_{serve}) despite the shared column name. The delivery path must construct the representation the model actually learned.

### Treat Feature Failure as a Delivery Failure

Feature lookup can fail even while the model endpoint remains healthy. The service might receive the customer ID and amount but time out while retrieving account age or recent transaction counts. A delivery contract should distinguish missing, invalid, unavailable, and stale values because they can justify different responses.

Some features can use an approved default. Others can use a recent cached value within a named age limit. A critical risk feature may require rejection or additional verification. The model should receive the same missing-value representation used during training; inventing a production-only zero can create skew.

Feature freshness should be visible in monitoring. A value can pass its type and range checks while exceeding its maximum age. Recording the feature version and observation time makes later prediction investigation more precise.

## How Does Inference Become a Product Action?
<!-- section-summary: Serving executes the approved model, post-processing converts raw outputs into usable results, and a separate product policy turns estimates into decisions and actions. -->

After feature construction, inference evaluates:

$$
\hat{y}=f_\theta(x)
$$

The output shape depends on the task. Classification may return (P(Y=1|x)). Regression may return `£327.40`. Recommendation may return `[item17,item81,item4]`. An embedding model may return a vector in (\mathbb{R}^d).

Model serving describes this execution step. Prediction delivery continues beyond it.

Raw output may require post-processing. A logit of `2.31` can be converted with (p=\sigma(2.31)). A recommender may return thousands of candidates that must be filtered for availability, remove purchased items, satisfy diversity rules, and be truncated to ten results.

```text
raw output
    ↓
calibration
    ↓
filtering
    ↓
ranking
    ↓
business constraints
    ↓
final result
```

These transformations influence the product and should be versioned and tested.

Prediction and decision remain separate. The model estimates what is likely. The policy decides what to do. If false blocking costs £15 and missed fraud costs £200, the action can consider expected cost:

$$
Block \quad \text{if} \quad p\cdot C_{FN}>(1-p)\cdot C_{FP}
$$

The business can change a threshold from `0.80` to `0.85` without retraining the model. A release record should still identify which policy version operated with which model.

The final result can reach a web or mobile application, payment system, CRM, warehouse, analyst, robot, industrial controller, or another ML system. Delivery can use an API response, table, message event, or embedded library call. HTTP is one mechanism rather than the definition of serving.

### Version Post-Processing and Policy

Post-processing often carries material behavior. A calibrated probability can differ substantially from a raw model score. A recommendation filter can remove items because of stock, prior purchases, legal constraints, or diversity rules. A label map can turn class index `2` into a product status. These assets belong in the release and its tests.

Policy ownership should remain clear. The ML team can explain the estimate and its calibration. The product or risk owner can explain the threshold and cost tradeoff. A change in either layer can affect actions and outcomes, so prediction records should capture both versions.

## How Are Predictions Connected to Later Outcomes?
<!-- section-summary: Prediction identity and trace context connect the serving release, score, policy, action, and delayed outcome so production quality can be measured and investigated. -->

A production prediction should usually receive an identifier:

```text
prediction_id: p-91281
timestamp: recorded
release: fraud-release-42
model_version: 42
score: 0.82
decision: verify
```

If transaction T123 is challenged, the record traces it to p-91281, release R82, and model v42. The service can include model and release identities in internal responses or logs even when users never see them.

A distributed request may travel through the web application, checkout API, feature service, prediction service, and rules engine. A shared trace or request ID such as `R991` joins logs across every hop.

At prediction time, the system knows (\hat{y}). Weeks or months later, it may learn (y). A fraud score of `.82` can join to a later fraud result; a churn score can join to status 90 days later. This enables production loss and quality measures.

Actions need to be recorded too:

$$
Prediction \rightarrow Decision \rightarrow Action \rightarrow Outcome
$$

A blocked high-risk transaction with no later chargeback does not automatically indicate a wrong prediction, because blocking altered the possible outcome. The action and policy version help analysts interpret the evidence.

Prediction records therefore support incident explanation, release comparison, production evaluation, feedback analysis, and future training. Without the outcome link, a team can know that an endpoint is healthy without knowing whether its predictions help.

The link also enables version-specific evaluation during rollout. If v40 serves 90% and v41 serves 10%, later outcomes can be grouped by model and release instead of mixing both populations. Exposure policy and routing may affect which requests reach each version, so the comparison should preserve those assignment details.

Privacy policy determines how much input evidence remains. Some systems can store a complete feature snapshot. Others retain encrypted references, hashes, or limited aggregates. The record design should be deliberate enough that investigators know which questions can and cannot be answered later.

## What Happens If a Prediction Cannot Be Delivered?
<!-- section-summary: Product risk determines whether failure uses a safe default, deterministic rules, a cached or previous result, manual review, explicit rejection, or another controlled fallback. -->

Model servers, feature services, networks, databases, and other dependencies fail. Requests can be malformed, features can be stale, infrastructure can overload, and inference can exceed its deadline. The product must define the response before deployment.

A movie recommender can show popular titles. Search can use basic keyword ranking. A fraud product can use conservative deterministic rules. Other options include the previous model, a valid cached result, additional verification, manual review, rejection, fail-open behavior, or fail-closed behavior.

This is **graceful degradation**: a simpler safe behavior replaces unavailable ML where the product permits it.

Deadlines are part of failure handling. If the product has 100 milliseconds and the prediction path is allowed 80 milliseconds, it should stop waiting at the deadline and execute the fallback. A correct result at 120 milliseconds may be operationally unusable.

Reliability compounds across required dependencies. If the prediction API, feature service, and database are each 99.9% available and all three are required:

$$
Availability_{system}\approx0.999^3\approx99.7\%
$$

Every added synchronous network call increases latency and failure exposure, so critical paths benefit from justified and limited dependencies.

The fallback matrix should cover:

| Failure | Deliberate response to define |
| --- | --- |
| Missing feature | Fallback value, alternate policy, or request rejection |
| Model timeout | Cached or previous result, rules engine, or safe default |
| Model unavailable | Previous version, fail closed, or fail open |
| Invalid request | Explicit rejection with a contract error |
| Logging failure | Continue or stop according to evidence and policy needs |

Duplicate requests need attention because distributed clients retry. A stable request ID such as `transaction-89172` lets the system recognize repeated delivery and avoid duplicate prediction records, business actions, or charges. This is idempotency.

Caching can reduce cost and latency only if its validity window matches the product. Reusing an hour-old customer lifetime-value estimate may be acceptable. Reusing yesterday's transaction fraud score is not. Cache lifetime is another freshness contract.

## How Do Batch, Online, Streaming, and Asynchronous Delivery Differ?
<!-- section-summary: Delivery mode follows input freshness, answer deadline, work size, event shape, and completion semantics rather than a universal serving pattern. -->

**Batch prediction** scores many entities together. A 02:00 job can load five million active customers, compute features, run the model, write a predictions table, and allow marketing to read it. Churn scoring, demand forecasts, weekly risk ranking, and lead scoring often fit this mode.

Batch latency measures the interval from data readiness to a complete usable output:

```text
source ready: 01:00
features complete: 01:20
scoring complete: 01:35
consumer receives table: 01:40
```

Job duration, freshness, completeness, retries, and partial failure matter more than HTTP response time.

**Online inference** scores on request. Fraud, recommendations, ads, search ranking, and dynamic pricing may depend on current context and immediate interaction. The design emphasizes low latency, high availability, and fresh features.

**Streaming inference** reacts continuously to events. Sensor readings can update windowed state, run an anomaly model, and emit maintenance alerts. Ordering, duplicates, late events, event-time semantics, and state recovery add complexity and should be accepted only when continuous response is required.

**Asynchronous prediction** suits expensive work that need not hold an interactive request open. A document-analysis request can return a job ID, process in the background, store the result, and notify the consumer. Large images, long documents, heavy optimization, and expensive generative workloads may fit this mode. Eventual completion replaces immediate response as the main contract.

| Input and result requirement | Likely mode |
| --- | --- |
| Older data acceptable and result needed later | Batch |
| Fresh data and immediate answer | Online |
| Continuous events and near-immediate response | Streaming |
| Heavy work and later result acceptable | Asynchronous |

### Match Operational Semantics to the Mode

Batch work needs an identifiable output version and rules for partial failure. If four of five million customers score successfully, the pipeline should not silently publish an incomplete table as complete. Retries should reproduce or safely replace the same logical output.

Online work needs request deadlines, capacity planning, tail-latency monitoring, and a per-request fallback. The model and its recent features are usually kept ready because loading them during every request would waste the budget.

Streaming work needs state checkpoints and rules for late, duplicated, and out-of-order events. A retry should not emit duplicate real-world actions. Feature windows should use defined event-time semantics.

Asynchronous work needs durable job identity, status, retry behavior, result storage, notification, expiry, and cancellation rules. Returning a job ID moves the immediate contract from “produce the answer now” to “accept this work durably and make progress observable.”

![Online, asynchronous, batch, streaming, and edge prediction delivery compared by deadline and work shape](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/delivery-modes-by-deadline.png)

*Freshness, deadline, and work shape determine the delivery mode.*

## Where Should the Model Run and How Should Delivery Be Operated?
<!-- section-summary: The model may run behind a dedicated service, inside an application, in a data platform job, or on a managed endpoint, with ownership and monitoring aligned to the selected boundary. -->

A dedicated prediction service lets several applications share a model, centralizes monitoring, and allows independent model updates. It also adds a network hop, a service to operate, and infrastructure.

Embedding the model inside an application removes the network hop and can be simple at small scale. Model updates may require application releases, the runtime becomes coupled to the application language, and sharing across services is harder. This remains a valid design.

A data platform can run scheduled batch scoring and publish a table. This avoids an unnecessary online stack when predictions are naturally consumed as data.

A managed model endpoint may handle model loading, scaling, routing, health checks, and deployment. The team still owns input contracts, model identity, release control, monitoring, lineage, and fallback behavior.

Ownership follows these boundaries. The ML team may own model quality, the data or ML platform team feature availability, platform or SRE the endpoint, the ML/application team the API contract, and product the fallback policy. A 03:00 incident should have a known owner for each part.

Monitoring covers several layers:

```text
request health: volume, success, timeout
latency: P50, P95, P99
input health: missing, invalid, stale, schema error
output health: score distribution, confidence, unexpected class
business outcome: fraud caught, legitimate payment blocked, retention, click
```

A useful diagnostic order is: did the request arrive, were inputs valid, were features available, did inference succeed, did the result reach the product, did the product apply the intended action, and was the eventual outcome acceptable? A falling business metric does not prove the model itself is the first failed component.

Avoid unnecessary work on the critical path. Many serial calls to databases, feature services, model services, post-processing services, and policy services increase latency and risk. Local preprocessing, a bounded set of recent features, an in-memory model, and a co-located policy may provide a simpler path when the contract allows it.

Delivery also owns rollout routing. During a 90/10 release of v40 and v41, every prediction record must identify the version that handled it. Shadow mode can send the same request to v41 for logging while v40 controls the action. Comparing errors, latency, score distributions, and later outcomes gives evidence before v41 receives decision authority.

### Compare the Operating Boundaries

| Pattern | Main advantage | Main cost |
| --- | --- | --- |
| Dedicated service | Independent updates, shared use, centralized monitoring | Network latency and another service to operate |
| Embedded model | No network hop and simple local execution | Application/runtime coupling and harder sharing |
| Data-platform batch job | Natural table-based consumption with little serving infrastructure | Results wait for the batch schedule |
| Managed endpoint | Platform-managed loading, scaling, routing, and health checks | Continued dependence on platform contracts and team-owned ML controls |

No pattern removes ownership. The team must know who restores feature availability, who handles endpoint capacity, who evaluates model quality, who changes policy, and who owns the fallback.

A healthy endpoint should expose a stable service identity while internal metadata reveals model and release identity. This combination allows clients to remain decoupled from model versions and operators to identify exactly what handled each request.

## How Should the Complete Delivery Path Be Built and Tested?
<!-- section-summary: The first milestone is one traceable production-like event, result, fallback, record, and outcome join, followed by tests of every transformation and failure boundary. -->

The first milestone should be one complete vertical path rather than an autoscaling cluster, feature platform, service mesh, stream-processing system, multi-region serving layer, and advanced router built before any consumer receives a prediction.

```text
application request
    ↓
validate
    ↓
retrieve required context
    ↓
compute features
    ↓
run the approved model
    ↓
apply decision policy
    ↓
return the result
    ↓
write the prediction record
    ↓
join the eventual outcome
```

A minimal online system can place validation, feature work, model loading, inference, and policy inside one prediction API, then log the result and later join outcomes. A minimal batch system can use a warehouse, scheduled job, validation, feature query, approved model, predictions table, and later labels. Both are legitimate production architectures.

Testing `model.predict(x)` covers only one step. End-to-end tests should include request parsing, feature retrieval, transformations, model identity, post-processing, policy, response, logging, and outcome linkage. Many failures occur outside the weights: wrong units, lookup timeouts, schema mismatch, incorrect category encoding, wrong version, or threshold misconfiguration.

### Diagnose from the Outside In

When a product metric changes, the investigation can follow the delivery path:

```text
Did the request or batch trigger arrive?
    ↓
Did contract validation pass?
    ↓
Were the correct and fresh features available?
    ↓
Did the intended model release execute?
    ↓
Did post-processing and policy produce the expected result?
    ↓
Did the consumer receive and apply it?
    ↓
What outcome appeared later?
```

This hierarchy prevents every incident from being labeled a model-quality problem. A request-routing defect, stale feature, wrong unit, failed policy handoff, or missing outcome join can each create an apparent quality loss.

Load tests should measure end-to-end P50, P95, and P99 latency, error rate, timeout rate, dependency behavior, and fallback use. Batch tests should prove completeness, deterministic membership, safe retry, and atomic publication. Streaming and asynchronous tests should exercise duplicates, late events, lost workers, and resumed work.

Failure tests should remove a feature, make the model time out, make the current version unavailable, send an invalid request, and interrupt logging. The expected fallback, rejection, or continued behavior should be observable and match the product policy.

The complete delivery system fulfills four responsibilities:

1. Turn raw context into valid features.
2. Turn features into an ML estimate.
3. Turn the estimate into an intended product action.
4. Preserve enough evidence to connect that action with its outcome and future learning.

Latency, reliability, fallbacks, monitoring, and lineage surround all four.

![Safe prediction delivery connecting trusted input, an approved release, model output, product action, prediction evidence, and real outcomes](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/safe-prediction-delivery-summary.png)

*A dependable delivery path connects a trusted input to a useful action, a traceable record, and a tested fallback.*

## Check Your Answers

Use these answers to verify that you can explain delivery as a product path rather than only as model execution.

:::expand[How Do Product Timing and Triggers Define Prediction Delivery?]{kind="recap"}
The product deadline determines the end-to-end latency budget, and the triggering request, schedule, business event, or stream event determines the broad delivery shape. Every stage must finish while the result remains useful.
:::

:::expand[How Does Raw Context Become a Valid Model Input?]{kind="recap"}
A contract defines request meaning and errors. Validation checks structure and freshness, then feature work combines current and historical context using the same semantics the model saw during training.
:::

:::expand[How Does Inference Become a Product Action?]{kind="recap"}
The approved model produces an estimate. Versioned post-processing makes it usable, and a separate policy applies thresholds, costs, constraints, and business consequences to select an action and delivery mechanism.
:::

:::expand[How Are Predictions Connected to Later Outcomes?]{kind="recap"}
Prediction, request, model, and release IDs connect the score to its distributed trace. Recording policy, action, and delayed outcome enables production evaluation, investigation, and responsible feedback.
:::

:::expand[What Happens If a Prediction Cannot Be Delivered?]{kind="recap"}
The product follows a preselected fallback such as deterministic rules, a previous or cached result, manual review, verification, rejection, fail-open, or fail-closed behavior. Deadlines, dependency reliability, cache freshness, and duplicate requests belong in that policy.
:::

:::expand[How Do Batch, Online, Streaming, and Asynchronous Delivery Differ?]{kind="recap"}
Batch optimizes complete scheduled outputs, online optimizes immediate fresh responses, streaming reacts to continuous events and state, and asynchronous delivery completes expensive work later. Freshness and deadline choose among them.
:::

:::expand[Where Should the Model Run and How Should Delivery Be Operated?]{kind="recap"}
The model can run in a dedicated service, application, batch platform, or managed endpoint. The chosen boundary determines latency, coupling, infrastructure, ownership, monitoring, routing, shadowing, and rollback responsibilities.
:::

:::expand[How Should the Complete Delivery Path Be Built and Tested?]{kind="recap"}
Build one production-like event through validation, features, inference, policy, response, record, fallback, and outcome join. Test every data, dependency, version, transformation, timeout, and logging boundary in addition to the model function.
:::

## References

- [Google Cloud Architecture Center: MLOps continuous delivery and automation pipelines](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)
- [Microsoft Azure Architecture Center: Machine learning operations](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/machine-learning-operations-v2)
- [Amazon SageMaker AI: Real-time inference](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints.html)
