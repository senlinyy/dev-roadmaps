---
title: "ML API Request Design"
description: "Design ML API request and response contracts with stable fields, schema versions, batch support, trace IDs, and predictable output metadata."
overview: "ML API request design turns a model call into a durable contract covering product semantics, validation, response evidence, versioning, invocation shape, error behavior, and consumer verification."
tags: ["MLOps", "core", "api"]
order: 1
id: "article-mlops-model-serving-request-response-design-for-ml-apis"
aliases:
  - roadmaps/mlops/modules/model-serving/serving-apis/02-request-response-design-for-ml-apis.md
  - child-serving-apis-02-request-response-design-for-ml-apis
---

## Table of Contents

1. [How Should an ML API Represent the Product Decision and Model Inputs?](#how-should-an-ml-api-represent-the-product-decision-and-model-inputs)
2. [What Must the Response Explain about Prediction, Decision, and Provenance?](#what-must-the-response-explain-about-prediction-decision-and-provenance)
3. [How Do Request Granularity, Asynchronous Jobs, and Idempotency Change the Contract?](#how-do-request-granularity-asynchronous-jobs-and-idempotency-change-the-contract)
4. [How Do Governance, Size, Cost, Timeouts, and Errors Bound Safe Requests?](#how-do-governance-size-cost-timeouts-and-errors-bound-safe-requests)
5. [How Do API Versions, Model Selection, Routing, and Determinism Evolve Safely?](#how-do-api-versions-model-selection-routing-and-determinism-evolve-safely)
6. [How Do Streaming and Observability Preserve Meaning without Exposing Raw Inputs?](#how-do-streaming-and-observability-preserve-meaning-without-exposing-raw-inputs)
7. [How Do Fraud, Document, and Ranking APIs Require Different Shapes?](#how-do-fraud-document-and-ranking-apis-require-different-shapes)
8. [What Checklist Produces a Stable ML Request and Response Contract?](#what-checklist-produces-a-stable-ml-request-and-response-contract)
9. [Check Your Answers](#check-your-answers)

A model expects 128 floating-point values, but a fraud-review application thinks in transactions, customers, event times, and decisions. Exposing the training tensor would force every caller to reproduce feature engineering and make model changes break the product contract.

An **ML API** translates a product request into validated model input and returns a prediction or decision with clear meaning, identity, timing, and error semantics. Its contract also governs request size, sensitive data, compute cost, retries, versions, and observability.

These questions follow that boundary from the product decision to concrete fraud, document, and ranking API designs:

1. **How Should an ML API Represent the Product Decision and Model Inputs?**
2. **What Must the Response Explain about Prediction, Decision, and Provenance?**
3. **How Do Request Granularity, Asynchronous Jobs, and Idempotency Change the Contract?**
4. **How Do Governance, Size, Cost, Timeouts, and Errors Bound Safe Requests?**
5. **How Do API Versions, Model Selection, Routing, and Determinism Evolve Safely?**
6. **How Do Streaming and Observability Preserve Meaning without Exposing Raw Inputs?**
7. **How Do Fraud, Document, and Ranking APIs Require Different Shapes?**
8. **What Checklist Produces a Stable ML Request and Response Contract?**

## How Should an ML API Represent the Product Decision and Model Inputs?
<!-- section-summary: An ML API starts from the product decision and accepts domain-level inputs, identity, event time, missing-data semantics, and validation rules rather than exposing training tensors by accident. -->

The public contract should describe the decision the caller understands, not the internal tensors the model happened to train on.

An ML API is a **contract between a product decision and a prediction system**, rather than merely a way to send tensors over HTTP. The product knows why it needs a prediction. The model-serving system knows how to produce one. The API has to preserve the meaning between those two worlds. A useful model is:

$$
\boxed{
\text{decision context}
\rightarrow
\text{prediction request}
\rightarrow
\text{model inference}
\rightarrow
\text{prediction meaning}
\rightarrow
\text{product decision}
}
$$

If the API merely says:

```json
{
  "features": [0.17, 3.2, 91, 0]
}
```

and returns:

```json
{
  "score": 0.83
}
```

then technically data moved successfully. But almost everything important is unclear. What does `0.83` mean? Which model produced it? Which entity was scored? How fresh were the features? Can the caller retry? Is `0.83` a probability? What threshold should be used? Can the service log the request? What happens if one feature is missing? That is why good ML API design starts with **semantics**, not JSON. Suppose you're designing a fraud API. A weak starting point is:

"We need an endpoint that returns the model output."

A better starting point is:

"During payment authorization, the payment service needs information about whether this transaction is likely fraudulent."

Now we know the API participates in:

```text
payment attempted
      ↓
collect transaction context
      ↓
fraud prediction
      ↓
payment decision
```

The product decision tells us what the API must support.

For example:

$$
D=\text{maximum time available for fraud scoring}
$$

Perhaps:

$$
D=100\text{ ms}
$$

Now synchronous request/response may make sense. But suppose instead the task is:

"Analyze a 500-page insurance claim and classify it."

The decision may tolerate:

$$
D=10\text{ minutes}
$$

Now a synchronous HTTP call may be the wrong interface entirely. So API shape follows from:

$$
\boxed{
\text{decision}
+
\text{deadline}
+
\text{input size}
+
\text{output semantics}
}
$$

not from a generic `/predict` template. At minimum, the contract must make four things understandable:

$$
\boxed{
\text{what is being predicted}
}
$$

$$
\boxed{
\text{what information the prediction uses}
}
$$

$$
\boxed{
\text{what the returned value means}
}
$$

$$
\boxed{
\text{how the caller should behave operationally}
}
$$

These correspond roughly to:

```text
Request semantics
Response semantics
Timing semantics
Failure/retry semantics
```

A model API that gets only the first two right can still be dangerous in production. Suppose a churn model was trained on:

$$
x=
[
tenure\_days,
purchase\_count,
support\_tickets,
days\_since\_login
]
$$

The easiest serving API might be:

```json
{
  "features": [431, 8, 2, 17]
}
```

This creates a brittle contract. The caller must know:

```text
position 0 = tenure_days
position 1 = purchase_count
position 2 = support_tickets
position 3 = days_since_login
```

If the model changes feature order:

```text
v1:
[a, b, c, d]

v2:
[a, c, b, d]
```

the request can remain syntactically valid while becoming semantically wrong. A better contract exposes named concepts:

```json
{
  "customer": {
    "tenure_days": 431,
    "purchase_count_30d": 8,
    "support_tickets_90d": 2,
    "days_since_last_login": 17
  }
}
```

Now meaning is explicit. The larger principle is:

> **API contracts should expose stable product concepts, not accidental model internals.**

Model implementations should be easier to change than API consumers. Suppose the model needs:

$$
purchase\_count_{30d}
$$

Should every caller compute that? Usually not if the serving system already owns feature computation. Instead of:

```json
{
  "purchase_count_30d": 8
}
```

the request may simply contain:

```json
{
  "customer_id": "cust_123"
}
```

and the serving path does:

```text
customer_id
    ↓
feature service
    ↓
purchase_count_30d
days_since_login
support_history
...
    ↓
model
```

Why is this attractive? Because feature semantics remain centralized. Otherwise:

```text
Service A computes 30-day purchases one way
Service B computes it another way
Service C forgets refunds
```

and all three call the same model. The API boundary should therefore deliberately decide:

**Who owns feature computation?**

There are two valid designs.

### Caller supplies features

Useful when the caller already owns the relevant context.

```text
request context
      ↓
model service
```

### Model-serving system resolves features

Useful when features belong to shared ML infrastructure.

```text
entity/event identity
      ↓
feature system
      ↓
model
```

Neither is universally superior. But the ownership must be explicit. Suppose you score a transaction. The request might contain:

```json
{
  "transaction_id": "tx_8291",
  "customer_id": "cust_42",
  "amount": 389.50,
  "currency": "GBP"
}
```

These fields do different jobs. `transaction_id` tells us:

$$
\text{which logical event is being scored}
$$

while `amount` is part of:

$$
\text{the model input}
$$

That distinction matters for:

```text
deduplication
tracing
auditing
retries
joining predictions to business events
```

A good request often contains a stable logical identity even if the model itself never consumes that identity. Suppose you ask:

"What is this customer's fraud risk?"

Risk **when** If features depend on recent history, prediction meaning depends on time. A request might therefore include:

```json
{
  "transaction_id": "tx_8291",
  "occurred_at": "2026-08-30T10:04:17Z",
  "customer_id": "cust_42",
  "amount": 389.50
}
```

Then a feature such as:

$$
transactions_{10m}
$$

can mean:

$$
\text{transactions during the 10 minutes before } occurred\_at
$$

rather than vaguely:

"whatever happened recently when the server processed the call."

For systems sensitive to event time, this distinction is essential. Suppose a model expects:

```text
customer_age
account_age
device_reputation
```

What does this mean?

```json
{
  "device_reputation": null
}
```

Possibilities include:

```text
unknown
not applicable
not collected
temporarily unavailable
intentionally withheld
```

Those aren't necessarily equivalent. Likewise, omission:

```json
{}
```

may mean something different from:

```json
{
  "device_reputation": null
}
```

A contract should distinguish these cases where product behavior depends on them. Otherwise upstream implementation details silently become model behavior. Consider:

```json
{
  "amount": -999999,
  "currency": "BANANA"
}
```

The model might technically accept numeric/textual representations. That doesn't mean it should. The request path should usually establish invariants before inference:

$$
x\in X_{valid}
$$

For example:

```text
amount >= 0
currency ∈ supported currencies
timestamp valid
required IDs present
string sizes bounded
```

Then:

```text
request
   ↓
schema validation
   ↓
semantic validation
   ↓
feature construction
   ↓
model
```

This makes failures understandable. A bad request should usually not become:

"model prediction = 0.13"

It should become:

"request invalid."

## What Must the Response Explain about Prediction, Decision, and Provenance?
<!-- section-summary: Responses define score or label meaning, separate prediction from policy when needed, and include prediction and release identities that support traceability. -->

Once inputs have product meaning, the response must explain what the prediction means and which model and request produced it.

Suppose the model returns:

$$
0.87
$$

That number is useless without semantics. It might mean:

```text
87% probability of fraud
87th percentile risk
raw sigmoid score
ranking score
confidence in predicted class
normalized anomaly score
```

These are completely different. So instead of:

```json
{
  "score": 0.87
}
```

prefer something whose meaning is explicit:

```json
{
  "fraud_probability": 0.87
}
```

if it truly is a calibrated probability. Or:

```json
{
  "risk_score": 0.87,
  "score_scale": "0_to_1_higher_is_riskier"
}
```

if it is merely a score. The naming must reflect what can honestly be claimed.

**Do not call something a probability unless its semantics justify interpreting it as one.**

Suppose a fraud model returns:

$$
p=0.87
$$

Should the API also return:

```json
{
  "decision": "decline"
}
```

Maybe. But realize these are different functions. Prediction:

$$
p=P(fraud\mid x)
$$

Decision:

$$
a=g(p,\text{business rules},\text{costs},\text{policy})
$$

For example:

```text
fraud probability
      +
transaction amount
      +
merchant type
      +
regulatory policy
      ↓
approve / review / decline
```

Thresholds may change without retraining. So a clean architecture often separates:

```text
ML prediction
```

from:

```text
business decision
```

unless the serving product explicitly owns both. This prevents model APIs from accidentally becoming repositories for unrelated business policy. There is a counterpoint. Suppose the consumers should not understand thresholds, score calibration, or model versions. Then exposing:

```json
{
  "fraud_probability": 0.83417291
}
```

may leak implementation details. A higher-level decision service might deliberately expose:

```json
{
  "recommendation": "manual_review"
}
```

The distinction is therefore:

### Prediction API

Exposes model semantics.

```text
input → model score
```

### Decision API

Exposes product action semantics.

```text
input → model + policy → recommendation
```

Both are valid. The mistake is not deciding which one you are building. Suppose a prediction unexpectedly changes between Monday and Tuesday. You may need to know whether it came from:

$$
M_{17}
$$

or:

$$
M_{18}
$$

A response might include:

```json
{
  "fraud_probability": 0.87,
  "model_version": "fraud-v18"
}
```

Possibly also:

```json
{
  "prediction_id": "pred_7c921..."
}
```

This can help with:

```text
debugging
auditing
offline evaluation
A/B testing
incident investigation
joining feedback to predictions
```

But don't dump every internal implementation detail into every public API. You need a boundary between:

```text
caller-visible contract
```

and:

```text
internal trace metadata
```

For many systems, `prediction_id` is public while detailed lineage lives internally. Suppose request:

```text
transaction_id = tx_123
```

causes prediction:

```text
prediction_id = pred_789
```

Later the transaction turns out to be fraudulent. Your learning system can record:

```text
prediction_id = pred_789
label = fraud
```

Now you can connect:

```text
request
   ↓
prediction
   ↓
business outcome
   ↓
training/evaluation data
```

Without stable prediction identities, model feedback pipelines become much harder. So a response might include:

```json
{
  "prediction_id": "pred_789",
  "fraud_probability": 0.87
}
```

even if the caller does nothing with the ID immediately.

![A concrete risk-decision request passes through feature lookup, model scoring, and policy before returning an action plus separate model, policy, and release identities.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/prediction-api-decision-contract.png)

*The caller sends stable product facts; the service owns derived features and turns the model score into a policy decision whose exact release remains visible in the response.*

## How Do Request Granularity, Asynchronous Jobs, and Idempotency Change the Contract?
<!-- section-summary: Single, bounded batch, and asynchronous requests create different waiting and state contracts, while idempotency makes retries predictable and side effects limited. -->

The interaction pattern then determines whether callers wait for one item, submit a bounded batch, or track a durable asynchronous job.

There are three broad request shapes:

$$
\boxed{\text{single prediction}}
$$

$$
\boxed{\text{small synchronous batch}}
$$

$$
\boxed{\text{asynchronous job}}
$$

These solve different problems. The basic synchronous pattern is:

```text
caller
  ↓
one logical prediction
  ↓
response
```

Example:

```json
{
  "transaction_id": "tx_8291",
  "amount": 389.50
}
```

This works well when one product decision is waiting for one result. Advantages:

```text
simple semantics
simple retry behavior
simple latency budgeting
easy attribution
```

It is often the best default for interactive inference. Suppose a ranking service needs scores for 50 candidate products. Calling the model 50 times creates:

$$
50\times L_{network}
$$

and significant per-request overhead.

Instead:

```json
{
  "items": [
    {"item_id": "A", "...": "..."},
    {"item_id": "B", "...": "..."},
    {"item_id": "C", "...": "..."}
  ]
}
```

The system returns:

```json
{
  "predictions": [
    {"item_id": "A", "score": 0.71},
    {"item_id": "B", "score": 0.19},
    {"item_id": "C", "score": 0.84}
  ]
}
```

This can reduce overhead and enable efficient accelerator batching. But now new questions arise. What if one item is invalid? Does the entire request fail? Or return partial results

```json
{
  "predictions": [
    {"item_id": "A", "score": 0.71},
    {"item_id": "B", "error": "invalid_feature"},
    {"item_id": "C", "score": 0.84}
  ]
}
```

The contract must decide. Why not allow:

```text
10 million examples
```

in one request Because synchronous request handling assumes:

$$
T_{completion}\lesssim \text{reasonable request deadline}
$$

Large batches increase:

```text
memory pressure
request size
timeout risk
retry cost
head-of-line blocking
```

Imagine processing 99,999 items successfully and then losing the connection. Retrying the entire request can be expensive. So synchronous batch APIs should normally enforce explicit limits:

$$
N\le N_{max}
$$

and:

$$
payload\_size\le S_{max}
$$

Beyond that point, use an asynchronous job. Suppose a request requires minutes. Don't make the client hold an HTTP connection for minutes merely because the model was exposed through HTTP.

Instead:

```text
submit work
    ↓
receive job identity
    ↓
processing happens independently
    ↓
retrieve result later
```

Conceptually:

```json
POST /prediction-jobs
```

returns:

```json
{
  "job_id": "job_9281",
  "status": "queued"
}
```

Then later:

```text
GET /prediction-jobs/job_9281
```

might return:

```json
{
  "job_id": "job_9281",
  "status": "completed",
  "result": { "...": "..." }
}
```

Now the API contract must define a state machine. Possible states:

```text
QUEUED
  ↓
RUNNING
  ↓
SUCCEEDED
```

or:

```text
RUNNING
  ↓
FAILED
```

perhaps also:

```text
CANCEL_REQUESTED
CANCELLED
EXPIRED
```

Once work outlives an individual request, the API must answer:

```text
Can the caller cancel
How long are results retained
Can the same job be submitted twice
Can failed jobs be retried
What does progress mean
```

This is not a minor extension of synchronous prediction. It is a job-management API. Suppose the client submits:

```text
POST /prediction-jobs
```

The server creates job:

```text
job_123
```

but the network connection breaks before the response reaches the client. The client does not know whether the request succeeded. It retries. Without protection:

```text
first attempt → job_123
retry         → job_124
```

Now you perform the expensive inference twice. An idempotency key solves this:

```text
Idempotency-Key: claim-analysis-82919
```

Then:

$$
same\ logical\ request
\rightarrow
same\ logical\ job
$$

Retries become safe. The same principle can be useful in synchronous inference where side effects or expensive deduplication matter.

## How Do Governance, Size, Cost, Timeouts, and Errors Bound Safe Requests?
<!-- section-summary: The request is a governance and resource boundary with explicit sensitive-data handling, size and cost limits, timeouts, status meanings, and per-item batch errors. -->

Those requests consume data and compute, so privacy, size, timeouts, cost, and error semantics must be part of the boundary.

Suppose:

```text
POST /predict
```

both computes fraud probability **and freezes the account**. Now retry semantics become dangerous. Did the first call freeze the account before the response was lost? Could retry freeze it again Prediction services are generally easier to operate if:

$$
\boxed{\text{same input can safely be evaluated repeatedly}}
$$

That is, prediction should behave as close as possible to a pure function:

$$
y=f(x)
$$

Then a separate decision/action system handles:

```text
freeze account
send notification
charge payment
```

Sometimes combined endpoints are justified, but they require much more careful idempotency design. Suppose an underwriting model technically needs:

```text
income
employment history
debt
```

A developer sends the entire customer record:

```json
{
  "...hundreds of fields...": "..."
}
```

because it is easier. That creates several problems:

```text
more sensitive data crossing services
larger logs
larger attack surface
unclear model dependencies
harder auditing
```

A better principle is:

$$
\boxed{\text{send the minimum information required by the inference contract}}
$$

This is data minimization. The request schema becomes an explicit record of what the model-serving system is allowed and expected to consume. API payloads may appear in:

```text
application logs
gateway logs
traces
error reports
debug tooling
dead-letter systems
analytics systems
```

So whenever adding a field, ask:

**What happens if infrastructure logs this value?**

For example, raw free-form text might contain personal information. Images may contain faces or documents. Audio may contain conversations. Authentication tokens should generally not belong in model payloads at all. A useful classification is:

```text
safe to log
safe only in restricted logs
must be redacted
must never be logged
```

Then observability can be designed accordingly. Suppose the model needs a customer's profile. Option A:

```json
{
  "customer_name": "...",
  "home_address": "...",
  "purchase_history": [...]
}
```

Option B:

```json
{
  "customer_id": "cust_8291"
}
```

and the serving layer retrieves only approved features. Option B can reduce data movement and centralize access control. But it introduces:

$$
L_{feature\ lookup}
$$

and another dependency. So this is a latency/privacy/ownership trade-off. Again, first principles help:

> **Move only the information that needs to cross the API boundary.**

Suppose an image inference endpoint accepts arbitrary payload sizes. An attacker sends:

$$
5\text{ GB}
$$

per request. Even if inference never starts, parsing/storage can exhaust resources. So input design needs hard limits:

```text
maximum request bytes
maximum image resolution
maximum text length
maximum batch size
maximum sequence length
maximum number of nested objects
```

For generative systems, token limits are particularly important because work can scale roughly with input and output size. An API should bound:

$$
\text{maximum work one request can demand}
$$

not merely validate syntax. Not all requests are equal. Suppose an LLM API accepts:

```text
100-token prompt
```

or:

```text
100,000-token prompt
```

and can generate:

```text
20 tokens
```

or:

```text
10,000 tokens
```

Then:

$$
1\ request \neq 1\ unit\ of\ work
$$

This affects:

```text
rate limiting
quotas
timeouts
billing
scheduling
fairness
capacity planning
```

Request design should expose or constrain variables controlling work. A general principle is:

$$
\boxed{\text{make computational demand bounded and predictable enough to operate}}
$$

Suppose a page must render within:

$$
500\text{ ms}
$$

The prediction service should probably not have a 30-second timeout. If the caller needs:

$$
100\text{ ms}
$$

for fallback logic, then perhaps:

$$
D_{ML}=400\text{ ms}
$$

at most.

Conceptually:

```text
overall product deadline
          ↓
reserve fallback time
          ↓
ML deadline
```

The API should therefore participate in deadline propagation when appropriate. If the prediction is no longer useful after 300 ms, continuing to compute it for 8 seconds wastes capacity. These aren't the same. Suppose the caller stops waiting after 100 ms. The model might actually complete at 110 ms. From the caller's perspective:

```text
prediction unavailable before deadline
```

From the serving system's perspective:

```text
inference succeeded
```

This distinction matters operationally. You may track:

$$
\text{model errors}
$$

separately from:

$$
\text{deadline misses}
$$

because their remedies are different. Avoid reducing every failure to:

```text
500 Internal Server Error
```

There are conceptually different categories.

### Caller errors

```text
invalid field
unsupported format
payload too large
unsupported model capability
```

### Temporary serving outages

```text
service overloaded
dependency unavailable
timeout
```

### Permanent prediction impossibility

```text
unsupported language
corrupt media
required feature absent
```

The caller needs to know:

$$
\text{should I retry?}
$$

A good error contract makes that inferable. For example, a transient overloaded service and permanently invalid image should not look identical. Suppose five examples are submitted:

```text
A B C D E
```

and C is malformed. There are two broad contracts.

### Atomic

```text
C invalid
   ↓
whole request fails
```

Good when the batch itself represents one indivisible logical operation.

### Partial

```text
A success
B success
C invalid
D success
E success
```

Good for independent predictions. Neither is universally correct. But callers must not discover the behavior accidentally.

## How Do API Versions, Model Selection, Routing, and Determinism Evolve Safely?
<!-- section-summary: Contract versions represent semantic API changes independently from model versions, and routing or model selection should not leak experimental internals into public promises. -->

As the service changes, API meaning, model identity, routing, and determinism need separate version and compatibility decisions.

This is critical. Suppose the model changes:

```text
fraud_model_v17
→ fraud_model_v18
```

If request and response meaning stay unchanged, consumers should not necessarily care. So ideally:

$$
\text{API version}
\neq
\text{model version}
$$

The API might remain:

```text
FraudPrediction API v2
```

while internally:

```text
model v17
model v18
model v19
```

come and go. This separation lets model teams improve implementations without forcing every client to redeploy. Suppose response changes from:

```json
{
  "risk_score": 0.8
}
```

to:

```json
{
  "fraud_probability": 0.8
}
```

If the old score was arbitrary and the new one is calibrated probability, this isn't just a rename. The semantics changed. That may justify a new API contract. Likewise, if:

```text
0 = risky
1 = safe
```

becomes:

```text
0 = safe
1 = risky
```

the API has changed catastrophically even though the JSON type is still a number. Semantic compatibility matters more than structural compatibility. Suppose response v1 is:

```json
{
  "prediction_id": "p1",
  "fraud_probability": 0.81
}
```

Later you want to add:

```json
{
  "model_version": "v18"
}
```

If clients tolerate unknown fields, this can often be additive. But changing:

```text
fraud_probability
```

to represent something else is not additive. A stable API evolves more easily when:

```text
new optional fields can appear
old fields keep their meaning
enumerations have clear unknown behavior
```

This is ordinary API design, but ML systems make semantic drift particularly easy. Should callers specify:

```json
{
  "model": "fraud_v18"
}
```

Usually, product callers should not care about deployment versions. The service should own:

```text
traffic → approved production model
```

Otherwise every client becomes coupled to model lifecycle. There are cases where model selection is part of the product—for example, APIs intentionally exposing multiple model capabilities. But for internal ML services, a cleaner contract is often:

```text
caller requests capability
service chooses implementation
```

For example:

```text
"predict fraud risk"
```

rather than:

```text
"invoke artifact fraud_model_2026_08_17_final_v3"
```

Suppose you want:

```text
90% → model v17
10% → model v18
```

for evaluation. You don't need callers to implement this. The serving layer can route based on:

```text
prediction_id
customer_id hash
experiment assignment
```

while preserving one API contract. This separation allows controlled rollouts without changing product integration. For many classifiers:

$$
f(x)=y
$$

is effectively deterministic. But generative systems may intentionally be stochastic:

$$
Y\sim P(\cdot\mid x)
$$

The API should define controls such as:

```text
temperature
top_p
seed
maximum output length
```

only where callers genuinely need them. Exposing every low-level inference knob can make the API impossible to evolve. A higher-level product API may instead say:

```text
mode = precise
```

or:

```text
mode = creative
```

and let the serving implementation choose low-level parameters. Again:

**Expose stable intent whenever possible, not unstable implementation details.**

![Single-call, bounded-batch, and asynchronous ML API shapes compared by work size, deadline, identity, and error behavior.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/api-interaction-shapes.png)

*The interaction shape follows the amount of work that can safely finish inside the caller's deadline: one immediate decision, a bounded item set, or a durable job with its own lifecycle.*

## How Do Streaming and Observability Preserve Meaning without Exposing Raw Inputs?
<!-- section-summary: Streaming remains part of the response contract, while correlation and prediction metadata provide observability without logging raw sensitive inputs. -->

Streaming alters how the response arrives but does not remove the need for stable meaning and privacy-aware correlation.

Suppose an LLM requires ten seconds to produce a full response. A conventional API does:

```text
request
   ↓
10 seconds
   ↓
complete response
```

But generation happens incrementally:

$$
token_1,token_2,\ldots
$$

So the API can expose:

```text
request
   ↓
first token
   ↓
more tokens
   ↓
completion
```

This reduces **time to first useful output**, even though total inference time may be unchanged. The response contract now needs concepts such as:

```text
partial output
completion
stream error
cancellation
usage metadata
```

Streaming output therefore changes the protocol semantics, not the underlying product prediction alone. Suppose inference looks like:

```text
API gateway
    ↓
feature service
    ↓
model server
    ↓
database
```

To debug it, propagate an identity:

```text
request_id
```

Then logs can say:

```text
request abc
gateway: 4ms
features: 12ms
model queue: 7ms
inference: 28ms
postprocess: 2ms
```

without logging:

```text
full customer record
```

A well-designed API makes correlation easy while minimizing sensitive payload capture. For each logical prediction, you may internally want:

$$
(
prediction\_id,
model\_version,
event\_time,
latency,
features\_version,
output
)
$$

Then later:

$$
prediction\_id
\rightarrow
observed\ outcome
$$

allows calculation of production metrics.

For example:

```text
prediction p123:
fraud probability = 0.82

30 days later:
confirmed fraud = true
```

This lets you analyze calibration, precision/recall and drift. So prediction IDs are not merely tracing conveniences. They connect serving to the learning loop.

## How Do Fraud, Document, and Ranking APIs Require Different Shapes?
<!-- section-summary: Fraud, document, and ranking examples show that a useful API mirrors the product interaction and decision rather than forcing every task into one generic schema. -->

Concrete APIs for fraud, documents, and ranking demonstrate why request shapes should follow the product task.

Let's derive one from the product contract.

### Product meaning

The payment system needs:

"Estimated fraud risk for this payment attempt."

### Deadline

$$
D=100\text{ ms}
$$

So use synchronous serving.

### Logical identity

The transaction already has:

```text
transaction_id
```

Use it for correlation/idempotency.

### Inputs

The payment service owns immediate transaction context:

```text
amount
currency
merchant
device
```

Historical features belong to the ML platform and are resolved by customer ID. So request:

```json
{
  "transaction_id": "tx_82917",
  "occurred_at": "2026-08-30T10:04:17Z",
  "customer_id": "cust_42",
  "amount": 389.50,
  "currency": "GBP",
  "merchant_id": "merchant_17",
  "device_id": "device_93"
}
```

### Serving path

```text
request
   ↓
validate
   ↓
retrieve historical features
   ↓
combine with transaction context
   ↓
fraud model
   ↓
prediction
```

### Response

```json
{
  "prediction_id": "fraudpred_8129",
  "fraud_probability": 0.87
}
```

Perhaps model version is logged internally instead of exposed publicly.

### Decision

The payment system applies:

```text
probability
   +
business thresholds
   +
payment amount
   ↓
approve / review / decline
```

The prediction API stays distinct from payment policy. That is a semantically clean interface. Suppose the product needs:

"Extract structured information from a 300-page legal document."

Processing takes minutes. A synchronous endpoint like:

```text
POST /predict
```

that holds the connection open would be awkward.

Instead:

```text
document uploaded
       ↓
create analysis job
       ↓
job queued
       ↓
model processing
       ↓
result stored
```

Request:

```json
{
  "document_id": "doc_9182",
  "analysis_type": "contract_extraction"
}
```

Response:

```json
{
  "job_id": "job_8127",
  "status": "queued"
}
```

Later:

```json
{
  "job_id": "job_8127",
  "status": "completed",
  "result": {
    "...": "..."
  }
}
```

Same high-level concept—ML inference. Completely different API, because the product deadline and work size differ. Suppose the caller already generated 100 candidates. The product asks:

"Rank these candidates for this user and current context."

That maps naturally to:

```json
{
  "request_id": "search_1829",
  "user_id": "user_42",
  "query": "running shoes",
  "candidates": [
    {"item_id": "item_1"},
    {"item_id": "item_2"},
    {"item_id": "item_3"}
  ]
}
```

Response:

```json
{
  "request_id": "search_1829",
  "ranked_items": [
    {"item_id": "item_3", "score": 0.82},
    {"item_id": "item_1", "score": 0.71},
    {"item_id": "item_2", "score": 0.34}
  ]
}
```

Notice that the API speaks the language of the product:

```text
query
candidate
rank
```

not:

```text
tensor_1
tensor_2
embedding_17
```

That's generally a sign of a healthier abstraction. You can think of API design in layers:

```text
1. PRODUCT SEMANTICS
   What decision is being supported

          ↓

2. PREDICTION SEMANTICS
   What exactly does the model output mean

          ↓

3. EXECUTION SEMANTICS
   Sync, batch, async, streaming

          ↓

4. DATA CONTRACT
   What information crosses the boundary

          ↓

5. FAILURE SEMANTICS
   Validation, timeout, retry, idempotency

          ↓

6. EVOLUTION
   How can models and schemas change safely
```

Starting from the bottom often creates brittle APIs. Starting from the top makes technical choices much easier. A useful rule is to distinguish **product-level concepts** from **implementation-level details**. Usually stable enough to expose:

```text
customer_id
transaction_id
language
candidate item
fraud probability
predicted category
prediction_id
```

Often better kept internal unless there is a real consumer need:

```text
tensor names
layer names
feature vector positions
GPU batch size
model filename
deployment replica
operator versions
internal threshold
feature-store table name
```

If changing an internal model architecture forces dozens of upstream clients to change, the API abstraction is probably too low-level.

## What Checklist Produces a Stable ML Request and Response Contract?
<!-- section-summary: The final checklist fixes decision, inputs, timing, validation, output meaning, identity, errors, cost, privacy, versioning, and observability before implementation. -->

The checklist assembles these decisions into one contract that callers and servers can evolve deliberately.

For a new ML API, ask in this order:

1. **What real decision is waiting for this output?**
2. **What does the prediction mathematically and operationally mean?**
3. **When must the answer exist?**
4. **Should this be synchronous, small-batch, streaming, or asynchronous?**
5. **What is the logical identity of the prediction request?**
6. **What information actually needs to cross the API boundary?**
7. **Who owns feature construction?**
8. **What does missing or stale input mean?**
9. **How large or computationally expensive may one request become?**
10. **What should the caller do on validation failure, timeout, overload, or dependency failure?**
11. **Are retries safe?**
12. **What prediction metadata is needed for debugging and feedback?**
13. **Can the model implementation change without changing the product contract?**
14. **Can observability work without logging sensitive inputs?**

If these questions have good answers, the JSON is usually the easy part. The naive model of an ML API is:

```text
JSON
 ↓
model
 ↓
JSON
```

The useful model is:

```text
PRODUCT DECISION
       ↓
what information is known
       ↓
how quickly is the answer needed
       ↓
what does the prediction mean
       ↓
what data must cross the boundary
       ↓
what happens on retries/failures
       ↓
how will the contract evolve
       ↓
API
```

The central principle is:

$$
\boxed{
\text{Design the API around the stable meaning of the prediction,
not around the temporary shape of the current model.}
}
$$

From that principle, the rest follows:

```text
stable product concepts
        ↓
named semantic fields

one waiting decision
        ↓
single synchronous request

several closely related predictions
        ↓
small bounded batch

long-running computation
        ↓
asynchronous job

retries possible
        ↓
stable identity + idempotency

sensitive information
        ↓
minimal payload + controlled logging

model changes frequently
        ↓
separate API contract from model version

prediction used later for learning
        ↓
prediction identity + lineage
```

The best ML API is therefore not the one that exposes the model most directly. It is the one that allows **models, infrastructure, features, and deployment strategies to change while the product continues to understand exactly what it asked for and exactly what the answer means.**

![Five-part ML API contract lifecycle covering product definition, separate version identities, boundary protection, contract proof, and controlled migration.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/durable-api-contract-summary.png)

*A durable contract keeps product meaning stable while schemas, features, models, policies, and releases evolve through tested migrations with a retained fallback.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Should an ML API Represent the Product Decision and Model Inputs?]{kind="recap"}
An ML API starts from the product decision and accepts domain-level inputs, identity, event time, missing-data semantics, and validation rules rather than exposing training tensors by accident.
:::

:::expand[What Must the Response Explain about Prediction, Decision, and Provenance?]{kind="recap"}
Responses define score or label meaning, separate prediction from policy when needed, and include prediction and release identities that support traceability.
:::

:::expand[How Do Request Granularity, Asynchronous Jobs, and Idempotency Change the Contract?]{kind="recap"}
Single, bounded batch, and asynchronous requests create different waiting and state contracts, while idempotency makes retries predictable and side effects limited.
:::

:::expand[How Do Governance, Size, Cost, Timeouts, and Errors Bound Safe Requests?]{kind="recap"}
The request is a governance and resource boundary with explicit sensitive-data handling, size and cost limits, timeouts, status meanings, and per-item batch errors.
:::

:::expand[How Do API Versions, Model Selection, Routing, and Determinism Evolve Safely?]{kind="recap"}
Contract versions represent semantic API changes independently from model versions, and routing or model selection should not leak experimental internals into public promises.
:::

:::expand[How Do Streaming and Observability Preserve Meaning without Exposing Raw Inputs?]{kind="recap"}
Streaming remains part of the response contract, while correlation and prediction metadata provide observability without logging raw sensitive inputs.
:::

:::expand[How Do Fraud, Document, and Ranking APIs Require Different Shapes?]{kind="recap"}
Fraud, document, and ranking examples show that a useful API mirrors the product interaction and decision rather than forcing every task into one generic schema.
:::

:::expand[What Checklist Produces a Stable ML Request and Response Contract?]{kind="recap"}
The final checklist fixes decision, inputs, timing, validation, output meaning, identity, errors, cost, privacy, versioning, and observability before implementation.
:::
