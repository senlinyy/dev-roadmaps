---
title: "Service Health Metrics"
description: "Service health measures whether users can obtain predictions within operational expectations, while model health asks whether those predictions remain useful and correct."
overview: "Service health measures whether users can obtain predictions within operational expectations, while model health asks whether those predictions remain useful and correct. Implementation begins with the smallest set of user-facing reliability signals, release segmentation, actionable alerts, and a compact design method that grows with real incidents."
tags: ["MLOps", "core", "observability"]
order: 1
id: "article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources"
---

## Table of Contents

1. [What Does Service Health Measure beside Model Quality?](#what-does-service-health-measure-beside-model-quality)
2. [How Do Traffic, Latency, Errors, Saturation, Availability, and Dependencies Describe an ML Service?](#how-do-traffic-latency-errors-saturation-availability-and-dependencies-describe-an-ml-service)
3. [How Do Batch Signals, Release Views, SLIs, SLOs, SLAs, and Error Budgets Differ?](#how-do-batch-signals-release-views-slis-slos-slas-and-error-budgets-differ)
4. [How Should Alerts Connect Symptoms, Causes, Metrics, Logs, and Traces to a Response?](#how-should-alerts-connect-symptoms-causes-metrics-logs-and-traces-to-a-response)
5. [What Makes a Dashboard Investigable without Hiding Problems or Creating Unbounded Dimensions?](#what-makes-a-dashboard-investigable-without-hiding-problems-or-creating-unbounded-dimensions)
6. [How Do You Test Monitoring and Treat the Service as a Feedback Control System?](#how-do-you-test-monitoring-and-treat-the-service-as-a-feedback-control-system)
7. [How Do Incidents, Causal Metrics, Leading Signals, and User Journeys Fit Together?](#how-do-incidents-causal-metrics-leading-signals-and-user-journeys-fit-together)
8. [Which Health Signals Should a Team Implement First?](#which-health-signals-should-a-team-implement-first)
9. [Check Your Answers](#check-your-answers)

A prediction endpoint returns HTTP 200, yet users wait several seconds and many abandon the workflow. Another endpoint responds quickly but returns errors whenever a feature store is saturated. A single uptime percentage cannot describe either experience.

**Service health metrics** describe whether an ML service can accept work, complete it within its deadline, avoid failures, and stay within sustainable capacity. They cover the complete request path and remain separate from evidence about whether the model's predictions are good.

The questions below move from the core signals to objectives, alerts, dashboards, recovery tests, and the user journey those measurements protect:

1. **What Does Service Health Measure beside Model Quality?**
2. **How Do Traffic, Latency, Errors, Saturation, Availability, and Dependencies Describe an ML Service?**
3. **How Do Batch Signals, Release Views, SLIs, SLOs, SLAs, and Error Budgets Differ?**
4. **How Should Alerts Connect Symptoms, Causes, Metrics, Logs, and Traces to a Response?**
5. **What Makes a Dashboard Investigable without Hiding Problems or Creating Unbounded Dimensions?**
6. **How Do You Test Monitoring and Treat the Service as a Feedback Control System?**
7. **How Do Incidents, Causal Metrics, Leading Signals, and User Journeys Fit Together?**
8. **Which Health Signals Should a Team Implement First?**

## What Does Service Health Measure beside Model Quality?
<!-- section-summary: Service health measures whether users can obtain predictions within operational expectations, while model health asks whether those predictions remain useful and correct. -->

Service health measures whether users can obtain predictions within operational expectations, while model health asks whether those predictions remain useful and correct.

A machine-learning model can be statistically excellent and still be part of a terrible service. Suppose a fraud model correctly identifies fraud 99% of the time, but:

* prediction requests sometimes take 20 seconds,
* the inference server crashes every few hours,
* requests fail when the feature store is unavailable,
* traffic spikes overwhelm the GPUs,
* a deployment causes half the requests to time out.

The **model itself may be healthy**, while the **service delivering the model is unhealthy**. That distinction is the starting point for service health metrics.

### Start from the most basic question

Why does an ML service exist?

Because some user or system wants something to happen.

For example:

```text
Client
   │
   │ "Is this transaction fraudulent?"
   ▼
Prediction Service
   │
   ├── fetch features
   ├── preprocess
   ├── run model
   ├── postprocess
   │
   ▼
Prediction
```

The user does not particularly care whether the model's GPU utilization is 63%, whether Kubernetes has five replicas, or whether the feature store took 40 ms. They care about something much simpler:

"Did the service give me the answer I needed, correctly and fast enough?"

So from the underlying mechanism:

> **Service health is the degree to which a service successfully performs its intended job for its users.**

Monitoring exists because we cannot continuously inspect every individual request manually. Instead, we observe **metrics** that summarize the service's behaviour. Imagine a service receives one million prediction requests. Each request produces facts such as:

```text
request arrived at       10:00:00.100
request completed at     10:00:00.180
duration                  80 ms
status                    success
model version             v17
region                    eu-west
GPU utilization           72%
```

Looking at one request tells us very little. But aggregating many requests gives us metrics:

```text
requests / second             2,400

p50 latency                   75 ms
p95 latency                  140 ms
p99 latency                  480 ms

error rate                    0.3%

availability                 99.97%

GPU utilization              72%

queue depth                   38
```

These numbers compress millions of individual events into an understandable description of system behaviour.

Conceptually:

$$
\text{Metric} = \text{Aggregation of observations over time}
$$

For example:

$$
\text{Error Rate}
=
\frac{\text{Failed Requests}}
{\text{Total Requests}}
$$

or:

$$
\text{Availability}
=
\frac{\text{Successful Eligible Requests}}
{\text{Total Eligible Requests}}
$$

A metric therefore does not describe some abstract property of the software. It describes **what the software actually did**. This distinction is extremely important in ML systems. Consider two layers.

### Model health

Questions such as:

```text
Is prediction accuracy falling

Has the input distribution changed

Has concept drift occurred

Are probabilities still calibrated

Has the feature distribution changed

Is fairness deteriorating
```

These describe the **statistical behaviour of the model**.

### Service health

Questions such as:

```text
Can clients reach the prediction API

How quickly does it respond

How many requests fail

Are machines overloaded

Are downstream dependencies failing

Did the latest deployment make things worse
```

These describe the **operational behaviour of the system delivering the model**. You can therefore have four situations:

| Model     | Service   | Result                                    |
| --------- | --------- | ----------------------------------------- |
| Healthy   | Healthy   | Ideal                                     |
| Healthy   | Unhealthy | Good model that users cannot reliably use |
| Unhealthy | Healthy   | Reliable delivery of poor predictions     |
| Unhealthy | Unhealthy | Both operational and ML problems          |

For example:

```text
Accuracy = 97%
Latency = 4 seconds
```

The model may be good. The product experience may still be unacceptable. Likewise:

```text
Availability = 99.999%
Accuracy = 54%
```

The infrastructure is extremely reliable at serving predictions that are nearly useless. Monitoring therefore usually needs both:

```text
                 PRODUCTION ML HEALTH

        ┌────────────────┬─────────────────┐
        │ Service health │  Model health   │
        ├────────────────┼─────────────────┤
        │ latency        │ accuracy        │
        │ errors         │ drift           │
        │ traffic        │ calibration     │
        │ saturation     │ feature quality │
        │ availability   │ bias/fairness   │
        └────────────────┴─────────────────┘
```

Every service health metric should answer a question. Bad monitoring often starts with:

"What metrics can our infrastructure export?"

Good monitoring starts with:

"What failure are we trying to detect?"

Suppose users complain:

"Predictions sometimes take forever."

Then a useful observation might be:

$$
L_i = t_{\text{response},i} - t_{\text{request},i}
$$

where $$L_i$$ is the latency of request $$i$$. After observing thousands of requests, we can ask:

```text
What is typical latency
What is bad latency
How often does bad latency happen
Which version causes it
Which region causes it
```

The metric becomes a measurement connecting real-world behaviour to an operational question. This principle applies to every useful metric. A useful mental model is:

```text
                      SERVICE
                         │
         ┌───────────────┼───────────────┐
         │               │               │
      WORK IN         WORK DONE       CAPACITY
         │               │               │
      Traffic       Latency/Errors    Saturation
                         │
                    Availability
```

These dimensions are closely related to Google's famous "four golden signals":

* traffic,
* latency,
* errors,
* saturation.

Availability and dependency health are often useful explicit additions.

## How Do Traffic, Latency, Errors, Saturation, Availability, and Dependencies Describe an ML Service?
<!-- section-summary: Traffic, latency distributions, errors, saturation, availability, and dependency health describe demand, response time, failure, capacity, reachability, and the wider request path. -->

Traffic, latency distributions, errors, saturation, availability, and dependency health describe demand, response time, failure, capacity, reachability, and the wider request path.

A service cannot be understood without knowing how much demand it is receiving. For an online inference service, traffic might mean:

```text
requests per second
requests per minute
tokens per second
predictions per second
bytes received
concurrent requests
```

Suppose normal traffic is:

```text
1,000 requests/sec
```

and suddenly it becomes:

```text
8,000 requests/sec
```

A latency increase at the same moment becomes easier to explain. Without traffic data, you might see:

```text
p99 latency ↑
```

and conclude:

"Something is wrong with the model server."

But traffic shows:

```text
traffic       ↑↑↑
latency       ↑
GPU usage     ↑
queue depth   ↑
```

Now the probable explanation becomes:

Demand exceeded available capacity.

Traffic can also reveal failures by going **down**. Suppose normal traffic is:

```text
5,000 requests/minute
```

and suddenly becomes:

```text
20 requests/minute
```

Perhaps the service did not become wonderfully efficient. Maybe:

* routing broke,
* DNS failed,
* a gateway configuration changed,
* clients cannot reach the endpoint.

Therefore both unexpected increases and decreases matter. For request $$i$$:

$$
Latency_i =
t_{\text{response}}
-
t_{\text{request}}
$$

If a request arrives at:

```text
12:00:00.100
```

and finishes at:

```text
12:00:00.250
```

then:

$$
Latency = 150ms
$$

But average latency alone is dangerous. Imagine ten requests:

```text
50
50
50
50
50
50
50
50
50
2000 ms
```

Most requests are fast, but one user waited two seconds. Averages hide this structure. That is why latency is commonly measured using percentiles.

### p50

Half of requests are faster than this.

```text
p50 = 70 ms
```

roughly represents the typical request.

### p95

95% are faster.

```text
p95 = 180 ms
```

The slowest 5% take longer.

### p99

99% are faster.

```text
p99 = 700 ms
```

This exposes tail latency. An API might therefore show:

```text
p50     60 ms
p95    130 ms
p99   1800 ms
```

The median looks excellent. But roughly 1% of users encounter very slow responses. For sufficiently large services, 1% may represent millions of requests.

### Latency should usually be decomposed

A prediction request rarely consists only of model execution. Suppose:

```text
Total latency = 220 ms
```

That could consist of:

```text
API gateway        10 ms
authentication      8 ms
feature lookup     90 ms
preprocessing      12 ms
model inference    45 ms
postprocessing     15 ms
network            40 ms
------------------------
total              220 ms
```

If only total latency is measured, investigation becomes difficult. If components are measured, you can see:

```text
feature-store latency ↑
```

while:

```text
model inference latency → unchanged
```

This tells you the model server probably isn't the cause. Latency asks:

How long did the operation take

Errors ask:

Did it succeed at all

A simple error rate is:

$$
ErrorRate
=
\frac{FailedRequests}{TotalRequests}
$$

Suppose:

```text
requests = 100,000
failed   = 800
```

Then:

$$
ErrorRate = 0.8\%
$$

But "error" needs careful definition. Failures may include:

```text
HTTP 500
HTTP 503
timeout
model loading failure
feature lookup failure
invalid model output
dependency failure
out-of-memory failure
```

And not every unsuccessful request indicates service failure. For instance:

```text
400 Bad Request
```

might happen because a client sent invalid input. This may need separate tracking from:

```text
500 Internal Server Error
```

which usually indicates a server-side problem. Therefore a useful dashboard might separate:

```text
2xx success
4xx client errors
5xx server errors
timeouts
dependency failures
```

rather than showing one ambiguous "errors" number. Consider a road. At 2 a.m.:

```text
100 cars/hour
```

Traffic moves easily. At rush hour:

```text
8,000 cars/hour
```

The road approaches capacity. Eventually tiny disturbances cause large queues. Computer systems behave similarly. Saturation asks:

**How much unused capacity remains?**

Signals might include:

```text
CPU utilization
GPU utilization
memory utilization
GPU memory
thread-pool usage
connection-pool usage
queue depth
disk I/O
network bandwidth
number of active workers
```

Suppose:

```text
GPU utilization = 98%
```

That is not automatically bad. GPUs are expensive, so high utilization can be desirable. The important question is whether increasing demand begins causing:

```text
queue depth ↑
latency ↑
timeouts ↑
errors ↑
```

For example:

```text
Traffic
   ↑
   │
   ▼
GPU saturated
   │
   ▼
Requests queue
   │
   ▼
Latency rises
   │
   ▼
Timeouts
   │
   ▼
Errors
```

This is why service metrics should be interpreted together rather than independently. Availability tries to capture the most fundamental reliability question:

When users need the service, does it work

Conceptually:

$$
Availability
=
\frac{\text{Successful service attempts}}
{\text{Eligible service attempts}}
$$

If:

```text
999,500 requests succeed
500 requests fail
```

then:

$$
Availability
=
\frac{999500}{1000000}
=
99.95\%
$$

Small percentage differences matter greatly at scale. Approximate downtime equivalents are:

| Availability | Downtime/year |
| -----------: | ------------: |
|          99% |    ~3.65 days |
|        99.9% |    ~8.8 hours |
|       99.99% |   ~53 minutes |
|      99.999% |    ~5 minutes |

But the definition matters. For one application, "available" might mean:

```text
HTTP status = 200
```

For another it might require:

```text
HTTP status = 200
AND latency < 500 ms
AND response structurally valid
```

A response arriving 30 seconds later may technically be successful while being functionally useless. Thus availability should reflect user experience rather than simply process uptime. Production ML systems usually look more like this:

```text
                         ┌── Feature Store
                         │
Client ──> Gateway ──> Prediction API ──> Model Server
                         │
                         ├── Cache
                         │
                         ├── Database
                         │
                         └── Logging / Policy Service
```

A request can fail even if the model server itself is perfect. Suppose the feature store fails. The request path becomes:

```text
request
   │
   ▼
API healthy
   │
   ▼
feature store ✕
   │
   ▼
prediction impossible
```

From the user's perspective:

The prediction service is down.

Therefore dependencies should be monitored with metrics such as:

```text
dependency latency
dependency error rate
connection failures
timeouts
cache hit rate
circuit-breaker state
retry count
```

A common mistake is monitoring only components rather than the end-to-end experience. Every component might say:

```text
"I'm healthy."
```

while the complete request path is broken. You need both:

```text
component metrics
        +
end-to-end metrics
```

![Complete ML service request path from incoming traffic through validation, feature retrieval, queueing, inference, response policy, and returned decision, with five service-health signals](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/service-health-request-path.png)

*Traffic, latency, errors, saturation, and availability describe the whole caller path. Stage-specific evidence explains where a delivery failure entered without confusing service health with model quality.*

## How Do Batch Signals, Release Views, SLIs, SLOs, SLAs, and Error Budgets Differ?
<!-- section-summary: Batch work needs completion and freshness signals; every release needs its own view, while SLIs measure, SLOs set targets, SLAs make commitments, and error budgets guide change. -->

Batch work needs completion and freshness signals; every release needs its own view, while SLIs measure, SLOs set targets, SLAs make commitments, and error budgets guide change.

So far we have mostly considered online inference:

```text
request → prediction
```

Batch inference works differently.

For example:

```text
Every night at 02:00
        │
        ▼
load 50 million users
        │
        ▼
run recommendation model
        │
        ▼
write recommendations
        │
        ▼
finish before 06:00
```

Requests per second may not be the main reliability concern. The important questions become:

```text
Did the job start

Did it finish

How long did it take

How many records were processed

How many records failed

Did output arrive on time

Was the output complete
```

Useful batch metrics include:

### Job success rate

$$
\frac{\text{Successful Jobs}}
{\text{Total Jobs}}
$$

### Processing throughput

```text
records / second
```

### Completion latency

```text
job start → job completion
```

### Record error rate

$$
\frac{\text{Failed Records}}
{\text{Processed Records}}
$$

### Freshness

Suppose recommendations must be regenerated every day. At 10 a.m.:

```text
latest successful output = yesterday 02:00
```

The pipeline may not technically be "down", but the output is stale. So **data freshness** becomes a service-health signal. Imagine deploying model version `v42`. Overall metrics show:

```text
error rate = 0.8%
```

That might appear acceptable. But suppose traffic is:

```text
v41 → 95% of requests → 0.1% errors
v42 →  5% of requests → 14% errors
```

The aggregate hides the disaster. This is why metrics should carry dimensions or labels such as:

```text
model_version
service_version
region
availability_zone
instance
endpoint
customer tier
request type
hardware type
```

Then we can ask:

```text
error_rate{model_version="v41"}
error_rate{model_version="v42"}
```

Conceptually:

```text
                    All requests
                         │
             ┌───────────┴───────────┐
             │                       │
           v41                     v42
        healthy                   broken
```

This is especially important for:

* canary releases,
* A/B tests,
* blue-green deployment,
* model rollouts,
* infrastructure migrations.

Metrics alone tell you what happened. Reliability management needs another question:

How good must the service be

This leads to three useful concepts.

### SLI — Service Level Indicator

An **SLI** is the actual measurement.

For example:

```text
99.94% of prediction requests succeeded
```

or:

```text
99.2% completed within 300 ms
```

Conceptually:

$$
SLI = \text{measured service behaviour}
$$

### SLO — Service Level Objective

An **SLO** is the target.

For example:

```text
99.9% of valid prediction requests
must succeed over a 30-day window.
```

or:

```text
99% of predictions must complete
within 300 ms.
```

Conceptually:

$$
SLO = \text{desired SLI level}
$$

So:

```text
SLI = 99.94%
SLO = 99.90%
```

means the target is currently satisfied.

### SLA — Service Level Agreement

An **SLA** is typically an external contractual commitment.

For example:

```text
Availability must be at least 99.9%.

If it falls below that,
the customer may receive service credits.
```

So a useful distinction is:

```text
SLI = what happened

SLO = what we aim for

SLA = what we formally promise
```

Organizations often make the internal SLO stricter than the contractual SLA.

For example:

```text
internal SLO   = 99.95%
customer SLA   = 99.9%
```

That creates operational safety margin. An SLO also tells you how much unreliability you can tolerate. Suppose:

$$
SLO = 99.9\%
$$

Then:

$$
ErrorBudget = 100\%-99.9\%=0.1\%
$$

Over 1,000,000 requests:

$$
1,000,000 \times 0.001 = 1,000
$$

So approximately 1,000 requests may fail before exhausting the error budget. This creates a useful engineering trade-off:

```text
Reliability <----------------------> Change velocity
```

If the system is extremely reliable and has plenty of error budget:

```text
deploy faster
experiment more
```

If the budget is almost exhausted:

```text
reduce risky releases
focus on reliability
```

This turns reliability into something measurable instead of saying:

"The system should basically never break."

## How Should Alerts Connect Symptoms, Causes, Metrics, Logs, and Traces to a Response?
<!-- section-summary: An alert represents a user-relevant condition with an owner and action, and metrics, logs, and traces help separate a visible symptom from its underlying cause. -->

An alert represents a user-relevant condition with an owner and action, and metrics, logs, and traces help separate a visible symptom from its underlying cause.

Monitoring and alerting are not the same thing. A dashboard might display:

```text
CPU = 91%
```

Monitoring has occurred. But whether anyone should be interrupted is another question. An alert should mean approximately:

Something important has happened that requires action.

Bad alert:

```text
CPU > 80%
```

Why is this bad?

Perhaps high CPU is perfectly normal. A better alert might be:

```text
p99 latency > 700 ms
for 10 minutes
AND request volume > minimum threshold
```

Or:

```text
5xx rate > 2%
for 5 minutes
```

Or even better, alert based on SLO consumption.

### Every alert should answer several questions

An engineer receiving an alert should know:

```text
What happened

How severe is it

What users are affected

When did it begin

Which service/version/region is involved

What should I inspect first

What action might fix it
```

A useful principle is:

**If nobody knows what to do when an alert fires, it probably should not be an alert.**

It may still belong on a dashboard. Another useful distinction:

### Symptom

Something the user experiences:

```text
high latency
errors
unavailability
```

### Cause

Something internal:

```text
GPU saturation
memory exhaustion
database latency
queue growth
bad deployment
```

For paging humans, symptoms are often more important.

Why?

Suppose:

```text
GPU = 97%
```

but:

```text
latency = normal
errors = normal
availability = normal
```

There may be no incident. Contrast:

```text
availability = 92%
```

Users are definitely suffering, even if you do not yet understand why. Thus:

```text
Alert on symptoms
Investigate using causes
```

is a useful default strategy. A dashboard is not magically reading the service. There is usually an observability pipeline.

Conceptually:

```text
Request
   │
   ▼
Application
   │
   ├── records counter
   ├── records latency
   ├── records status
   └── records labels
          │
          ▼
Metric collector
          │
          ▼
Time-series database
          │
          ▼
Query system
          │
          ▼
Dashboard / Alerting
```

For example, each successful request might increment:

```text
prediction_requests_total
```

An error might increment:

```text
prediction_errors_total
```

Latency could be recorded into a histogram:

```text
prediction_latency_seconds
```

Infrastructure collectors might separately record:

```text
cpu_usage
memory_usage
gpu_utilization
network_bytes
```

These observations are stored with timestamps:

```text
12:00 traffic      1100 req/s
12:01 traffic      1150 req/s
12:02 traffic      5800 req/s
12:03 traffic      6300 req/s
```

The dashboard then queries these time series. Service monitoring becomes much easier if you distinguish three observability tools.

### Metrics

Tell you:

Is something wrong

Example:

```text
error rate rose from 0.1% to 8%
```

Metrics are compact and excellent for trends and alerts.

### Logs

Tell you:

What happened in a specific event

Example:

```text
ERROR feature fetch failed:
customer_id=...
timeout after 500ms
```

### Traces

Tell you:

Where did time or failure occur across the request path

Example:

```text
Prediction request            740 ms
│
├─ API gateway                 20 ms
├─ feature lookup             610 ms   ← problem
├─ preprocessing               15 ms
├─ model inference             70 ms
└─ postprocessing              25 ms
```

Together:

```text
Metrics → detect

Logs    → explain events

Traces  → explain request paths
```

That is why production observability usually uses all three.

## What Makes a Dashboard Investigable without Hiding Problems or Creating Unbounded Dimensions?
<!-- section-summary: A useful dashboard preserves tails, releases, regions, dependencies, and investigation paths while controlling averages and label cardinality that could hide or overload evidence. -->

A useful dashboard preserves tails, releases, regions, dependencies, and investigation paths while controlling averages and label cardinality that could hide or overload evidence.

A dashboard should not simply contain every metric the system can produce. Its purpose is to help answer questions. A useful service dashboard might begin with:

```text
┌──────────────── SERVICE HEALTH ────────────────┐

Traffic              4,210 req/s

Availability         99.96%

Error rate           0.04%

Latency
  p50                 72 ms
  p95                160 ms
  p99                480 ms

Saturation
  CPU                 61%
  GPU                 79%
  memory              68%
  queue depth          12

SLO status            Healthy
Error budget          63% remaining

└─────────────────────────────────────────────────┘
```

Then provide deeper layers.

For example:

```text
Overall health
     │
     ▼
By region
     │
     ▼
By service/model version
     │
     ▼
By dependency
     │
     ▼
Individual traces/logs
```

This supports an investigation. Suppose latency rises. You might mentally follow:

```text
Latency ↑
   │
   ├── Traffic ↑
   │
   ├── Saturation ↑
   │
   ├── Errors ↑
   │
   ├── Specific region
   │
   ├── Specific version
   │
   └── Dependency latency ↑
```

The dashboard should make those questions easy to answer. Suppose your service runs in:

```text
Europe       50% traffic
America      40%
Asia         10%
```

Latency is:

```text
Europe       100 ms
America      120 ms
Asia        3000 ms
```

An overall summary can obscure the regional incident. Likewise, aggregate metrics can hide problems by:

```text
region
model version
customer type
endpoint
hardware
deployment
```

Healthy global numbers do not imply every user is healthy. There is a counterproblem. Suppose you label metrics with:

```text
user_id
transaction_id
request_id
```

and millions of values exist. The monitoring system now has millions of unique time series. This is called **high cardinality**. Metrics systems generally work best with bounded dimensions such as:

```text
region = {eu, us, asia}

status = {success, error}

model_version = {v41, v42}
```

Highly unique identifiers usually belong in logs or traces. A good conceptual split is:

```text
Metrics
→ aggregation

Logs/traces
→ individual events
```

![A 420-millisecond request decomposed into 260 milliseconds of feature lookup, 90 of queueing, 40 of inference, 20 of preprocessing, and 10 of post-processing](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/request-latency-breakdown.png)

*Feature lookup and queueing consume 350 of the 420 milliseconds. Model inference is under ten percent, so model optimisation cannot address most of the caller’s wait.*

## How Do You Test Monitoring and Treat the Service as a Feedback Control System?
<!-- section-summary: Injected failures and recovery tests prove the signal path, and the control-system view connects measurement, comparison, corrective action, and observed recovery. -->

Injected failures and recovery tests prove the signal path, and the control-system view connects measurement, comparison, corrective action, and observed recovery.

An observability system that has never been tested may fail exactly when needed. Suppose you configure:

```text
Alert if error_rate > 5%
```

You should know:

```text
Does the metric actually update

Does the threshold trigger

Does the alert reach someone

Does the alert identify the service

Does the runbook work

Can the team rollback

Does recovery clear the alert
```

The complete reliability loop is not:

```text
service → metric
```

It is:

```text
Service
   │
   ▼
Instrumentation
   │
   ▼
Monitoring system
   │
   ▼
Detection
   │
   ▼
Alert
   │
   ▼
Human / automation
   │
   ▼
Diagnosis
   │
   ▼
Mitigation
   │
   ▼
Recovery
   │
   └─────────────► monitoring confirms recovery
```

Every link can fail.

For example:

```text
service breaks
↓
metric exporter also breaks
↓
dashboard shows no data
↓
alert never fires
```

So organizations sometimes deliberately inject failures or run game days to verify that the monitoring and recovery mechanisms actually work. This connects service health directly to the broader idea of **monitoring and feedback**. Without feedback:

```text
Build
  ↓
Deploy
  ↓
Hope
```

With monitoring:

```text
             ┌───────────────────────┐
             │                       │
             ▼                       │
Build → Deploy → Observe → Evaluate → Act
                    │
                    └── metrics
```

For example:

```text
Deploy model v42
        │
        ▼
Observe
        │
        ├── error rate ↑
        ├── p99 latency ↑
        └── saturation ↑
        │
        ▼
Evaluate against SLO
        │
        ▼
SLO threatened
        │
        ▼
Rollback v42
        │
        ▼
Metrics return to normal
```

The metrics are therefore not the final goal. They are sensors inside a **control loop**. You can think of production operations as a control system. There is some desired state:

```text
Availability ≥ 99.9%
p99 latency ≤ 300 ms
error rate ≤ 0.1%
```

There is an actual measured state:

```text
Availability = 98.7%
p99 latency = 900 ms
error rate = 1.3%
```

The difference is an error signal:

$$
Error =
DesiredBehaviour - ObservedBehaviour
$$

The organization then acts:

```text
autoscale
rollback
restart
reroute traffic
disable feature
repair dependency
```

And observes again. So:

```text
               desired behaviour
                       │
                       ▼
                   compare
                  ▲       │
                  │       ▼
             monitoring   action
                  ▲       │
                  │       ▼
                service
```

That is the deeper reason monitoring exists. A service cannot reliably maintain a desired state if nobody can observe whether it has left that state.

## How Do Incidents, Causal Metrics, Leading Signals, and User Journeys Fit Together?
<!-- section-summary: The worked incident uses causal signal order, leading and lagging indicators, and user journeys to turn several metrics into one explanation of service behaviour. -->

The worked incident uses causal signal order, leading and lagging indicators, and user journeys to turn several metrics into one explanation of service behaviour.

Suppose a recommendation API normally behaves like this:

```text
traffic          4,000 req/s
p99 latency        240 ms
error rate         0.1%
GPU utilization     65%
```

A new model is released. Five minutes later:

```text
traffic          4,050 req/s
p99 latency       1.8 s
error rate         3.5%
GPU utilization     99%
queue depth        840
```

What do these metrics tell us?

### Step 1 — Traffic

```text
4,000 → 4,050
```

Traffic barely changed. So sudden demand probably isn't responsible.

### Step 2 — Latency

```text
240 ms → 1.8 s
```

Users are experiencing serious slowdown.

### Step 3 — Errors

```text
0.1% → 3.5%
```

Some requests now fail completely.

### Step 4 — Saturation

```text
GPU 65% → 99%
queue 15 → 840
```

The service appears capacity-constrained.

### Step 5 — Release segmentation

Suppose:

```text
v41:
p99 = 230 ms

v42:
p99 = 2.4 s
```

Now the deployment becomes the strongest suspect. Investigation reveals:

```text
v42 model
= 4× larger
= inference takes much longer
```

The causal chain is approximately:

```text
larger model
     ↓
longer inference
     ↓
GPU saturation
     ↓
request queue
     ↓
higher latency
     ↓
timeouts
     ↓
errors
     ↓
availability falls
```

The response might be:

```text
rollback v42
```

After rollback:

```text
GPU             67%
queue             8
p99             245 ms
error rate      0.1%
```

Monitoring confirms recovery. Notice that **no single metric told the whole story**. The diagnosis came from the relationship between them. This is one of the most useful ways to think about service health. Don't memorize:

```text
traffic
latency
errors
saturation
availability
```

as five unrelated dashboard boxes. Instead understand the causal system.

For example:

```text
Traffic increases
       │
       ▼
Resource demand increases
       │
       ▼
Saturation increases
       │
       ▼
Queues grow
       │
       ▼
Latency increases
       │
       ▼
Timeouts occur
       │
       ▼
Errors increase
       │
       ▼
Availability decreases
```

Not every incident follows this exact sequence. But reasoning about relationships is much more powerful than memorizing metric names. Some service metrics tell you about trouble **before users are seriously affected**. Others tell you that users are **already affected**.

### Leading indicators

```text
queue depth rising
memory approaching limit
connection pool nearly exhausted
GPU utilization rising
disk nearly full
```

These may warn of future trouble.

### Lagging indicators

```text
timeouts
errors
availability loss
SLO violations
```

These indicate the consequences are already visible. Good monitoring often combines both.

```text
capacity warning
      ↓
potential intervention
      ↓
avoid user-visible failure
```

Suppose your application has three endpoints:

```text
/check_fraud
/get_recommendations
/admin/debug
```

If `/admin/debug` fails, the impact may be small. If `/check_fraud` fails, payments may stop. Therefore reliability should not blindly treat every endpoint equally. You can define SLIs around important user journeys.

For example:

"A merchant can obtain a fraud decision within 300 ms."

Then the SLI measures exactly that workflow. This creates a chain:

```text
Business need
    ↓
User journey
    ↓
Service behaviour
    ↓
SLI
    ↓
SLO
    ↓
Metrics
    ↓
Alerts
```

That order is much stronger than:

```text
We have 600 metrics.
Let's build a dashboard.
```

## Which Health Signals Should a Team Implement First?
<!-- section-summary: Implementation begins with the smallest set of user-facing reliability signals, release segmentation, actionable alerts, and a compact design method that grows with real incidents. -->

Implementation begins with the smallest set of user-facing reliability signals, release segmentation, actionable alerts, and a compact design method that grows with real incidents.

If you inherit a service with almost no monitoring, start with the user-visible path. A practical minimum is:

```text
1. Traffic
2. Success/error rate
3. Latency percentiles
4. Availability
5. Resource saturation
6. Critical dependency health
7. Version/deployment segmentation
```

Then add service-specific indicators. For an LLM service, for example:

```text
tokens/sec
time to first token
generation latency
context length
GPU memory
batch size
queue waiting time
```

For batch ML:

```text
job success
job duration
records processed
failed records
freshness
```

The correct metrics derive from the service's job. When deciding whether a metric belongs in your monitoring system, ask:

- **1. What user behaviour are we protecting?**

Example:

```text
Customer receives fraud decision quickly.
```

- **2. How can it fail?**

```text
request rejected
service unreachable
response too slow
dependency unavailable
capacity exhausted
```

- **3. What observable signal reveals each failure?**

```text
error rate
availability
latency
dependency errors
saturation
```

- **4. What level is acceptable?**

```text
99.9% availability
p99 < 300 ms
```

- **5. What happens when the metric violates that level?**

```text
alert
autoscale
rollback
page engineer
```

This produces useful monitoring rather than metric collection for its own sake. At the deepest level, service health monitoring is about closing a feedback loop. A production service has a desired behaviour:

```text
handle expected traffic
       +
respond quickly
       +
succeed reliably
       +
remain within capacity
       +
keep working when dependencies and releases change
```

We cannot directly know "health." So we measure observable consequences:

```text
                 SERVICE HEALTH
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
    Demand          Behaviour         Capacity
       │               │                │
    Traffic       Latency/errors    Saturation
                       │
                       ▼
                  Availability
                       │
                       ▼
                     SLO
                       │
                       ▼
                  Alert / Action
                       │
                       ▼
                    Recovery
                       │
                       └──────► measure again
```

So the most important principle is:

> **A service health metric is useful only insofar as it helps you understand whether the service is delivering the experience it is supposed to deliver, diagnose why it is not, or decide what action to take.**

That is why good monitoring starts with the user-facing service contract and works backward to metrics—not with whatever numbers happen to be easiest to collect.

![Capacity incident summary showing traffic rising from 200 to 500 requests per second, ready replicas falling short, queue and p99 growth, errors, containment, and recovery checks](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/capacity-incident-summary.png)

*A traffic jump saturates the ready replicas, builds a queue, and raises tail latency and errors while model runtime stays normal. Recovery restores capacity, drains the queue, and verifies the original user-visible symptoms.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Does Service Health Measure beside Model Quality?]{kind="recap"}
Service health measures whether users can obtain predictions within operational expectations, while model health asks whether those predictions remain useful and correct.
:::

:::expand[How Do Traffic, Latency, Errors, Saturation, Availability, and Dependencies Describe an ML Service?]{kind="recap"}
Traffic, latency distributions, errors, saturation, availability, and dependency health describe demand, response time, failure, capacity, reachability, and the wider request path.
:::

:::expand[How Do Batch Signals, Release Views, SLIs, SLOs, SLAs, and Error Budgets Differ?]{kind="recap"}
Batch work needs completion and freshness signals; every release needs its own view, while SLIs measure, SLOs set targets, SLAs make commitments, and error budgets guide change.
:::

:::expand[How Should Alerts Connect Symptoms, Causes, Metrics, Logs, and Traces to a Response?]{kind="recap"}
An alert represents a user-relevant condition with an owner and action, and metrics, logs, and traces help separate a visible symptom from its underlying cause.
:::

:::expand[What Makes a Dashboard Investigable without Hiding Problems or Creating Unbounded Dimensions?]{kind="recap"}
A useful dashboard preserves tails, releases, regions, dependencies, and investigation paths while controlling averages and label cardinality that could hide or overload evidence.
:::

:::expand[How Do You Test Monitoring and Treat the Service as a Feedback Control System?]{kind="recap"}
Injected failures and recovery tests prove the signal path, and the control-system view connects measurement, comparison, corrective action, and observed recovery.
:::

:::expand[How Do Incidents, Causal Metrics, Leading Signals, and User Journeys Fit Together?]{kind="recap"}
The worked incident uses causal signal order, leading and lagging indicators, and user journeys to turn several metrics into one explanation of service behaviour.
:::

:::expand[Which Health Signals Should a Team Implement First?]{kind="recap"}
Implementation begins with the smallest set of user-facing reliability signals, release segmentation, actionable alerts, and a compact design method that grows with real incidents.
:::
