---
title: "Observability Basics"
description: "Understand how logs, metrics, traces, dashboards, alarms, change records, and telemetry context help explain a running AWS workload."
overview: "Observability is the practice of collecting and connecting evidence so that a team can infer what a running system is doing. This article builds that idea from first principles and follows one checkout incident from user symptom to tested explanation."
tags: ["observability", "cloudwatch", "logs", "metrics", "traces", "aws"]
order: 1
id: article-cloud-providers-aws-observability-observability-mental-model
aliases:
  - observability-mental-model
  - observability-basics
  - what-is-observability
  - cloud-providers/aws/observability/observability-mental-model.md
  - cloud-providers/aws/observability/01-observability-mental-model.md
  - cloud-providers/aws/observability/observability-basics.md
  - cloud-providers/aws/observability/01-observability-basics.md
---

## Table of Contents

1. [Why Do Running Systems Need Observability?](#why-do-running-systems-need-observability)
2. [What Does the Example Application Look Like?](#what-does-the-example-application-look-like)
3. [What Do Logs Tell You?](#what-do-logs-tell-you)
4. [When Should an Alarm Notify Someone?](#when-should-an-alarm-notify-someone)
5. [What Do Traces and Correlation IDs Tell You?](#what-do-traces-and-correlation-ids-tell-you)
6. [How Do You Instrument an Application With Useful Context?](#how-do-you-instrument-an-application-with-useful-context)
7. [How Do All the Signals Work Together?](#how-do-all-the-signals-work-together)
8. [What Does Good Observability Look Like?](#what-does-good-observability-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A production system contains state that an operator cannot continuously inspect. Observability gives the operator evidence from which to infer that hidden state. It is not one AWS product or a collection of attractive graphs. It is the connected use of telemetry, context, and reasoning to understand what a running system is actually doing.

Imagine a small checkout path:

```text
User
  |
  v
Web application
  |
  +----> Database
  |
  +----> Payment API
```

The user selects **Place order** and expects a confirmation. Instead, the application returns `500 Internal Server Error`. From outside the system, the only certain fact is that the expected outcome did not happen. Internally, the request might have met an overloaded database, a payment timeout, an application exception, a slow network, malformed customer data, or a defect introduced by a recent release. It might even have succeeded after an unacceptable twenty-second delay.

Keep these questions in view as you work through the lesson:

1. **Why Do Running Systems Need Observability?**
2. **What Does the Example Application Look Like?**
3. **What Do Logs Tell You?**
4. **When Should an Alarm Notify Someone?**
5. **What Do Traces and Correlation IDs Tell You?**
6. **How Do You Instrument an Application With Useful Context?**
7. **How Do All the Signals Work Together?**
8. **What Does Good Observability Look Like?**

## Why Do Running Systems Need Observability?
<!-- section-summary: Observability lets people infer a system's hidden internal behavior from evidence that the system deliberately emits. -->

The system knows which operations ran and which state each component held, but a person cannot simply look at every variable inside every process. Cloud workloads make this limitation more obvious because a request may cross load balancers, containers, managed databases, queues, functions, and third-party services.

The practical answer is to make the system leave evidence behind:

```text
                    Running system
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
        Logs          Metrics         Traces
          |              |              |
          +--------------+--------------+
                         |
                         v
                  Human understanding
```

**Observability** is the ability to infer internal behavior from externally available signals. In engineering practice, the word also describes the work of creating, collecting, connecting, and using those signals. The aim is to reduce uncertainty: begin with many possible explanations, use evidence to eliminate most of them, and reach a hypothesis that can be tested.

![The signal map shows how logs, metrics, traces, and changes answer different beginner questions during an incident](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/three-signals-three-questions.png)

*Different signals answer different questions about the same hidden system state.*

### How Is Observability Different From Monitoring?
<!-- section-summary: Monitoring detects conditions you decided to watch, while observability also supports questions that were not predicted in advance. -->

Monitoring and observability overlap, but they emphasize different questions. **Monitoring** usually checks known conditions:

```text
Is CPU utilization above 90 percent?
Is the error rate above 5 percent?
Is the health endpoint responding?
```

The team already knew those conditions mattered and created measurements or alarms for them. Monitoring is how the team learns that something recognizable has crossed an expected boundary.

**Observability** must also help with questions that nobody encoded beforehand. For example:

```text
Why are European checkout requests slow only after version 2.7,
and only when the customer uses one payment provider?
```

It would be unrealistic to create a separate alarm for every combination of region, version, endpoint, customer behavior, and dependency. Rich, connected telemetry lets an engineer explore the unexpected combination after it appears.

A compact relationship is:

```text
Monitoring     -> Is a known bad condition happening?
Observability  -> What is happening, where, and why?
```

Monitoring is therefore part of observability. Detection starts the investigation; it does not complete it.

## What Does the Example Application Look Like?
<!-- section-summary: A small checkout application gives each observability signal a concrete role along one request path. -->

Consider an application with a frontend, an order service, a database, and a payment service:

```text
Browser
   |
   v
Frontend API
   |
   v
Order service
   |
   +------> Database
   |
   +------> Payment service ----> AcmePay API
```

Under normal conditions, `POST /checkout` validates the request, reads and writes order data, obtains payment authorization, and returns a confirmation. A normal request might spend 40 milliseconds on the first database operation, 120 milliseconds on payment, and 30 milliseconds on the final write.

Now customers report slow checkouts. The outside symptom does not tell you whether the frontend, order service, database, payment service, network, or AcmePay is responsible. Nor does it tell you whether every request is affected or only a small group. The example will use six kinds of evidence:

| Evidence | Main question |
|---|---|
| Metrics | Is there a problem, and how large is it? |
| Alarms | Does the condition require investigation now? |
| Dashboards | Which part of the system should we inspect first? |
| Traces | Where did a representative request spend its time? |
| Logs | What exactly happened during that work? |
| Changes | What moved shortly before the behavior changed? |

These signals are complementary. Expecting one of them to answer every question is a common source of slow incident response.

## What Do Logs Tell You?
<!-- section-summary: Logs preserve selected events and context so an engineer can reconstruct what happened during a particular operation. -->

A **log** is a timestamped event record. It is a memory that the program deliberately chose to preserve: a request started, input validation failed, a retry occurred, a database call returned an error, or payment completed.

Logs are useful because they can retain detail that would be too specific for an aggregate metric. Suppose the payment service records:

```text
13:42:18 payment request started
13:42:23 retry 1
13:42:28 retry 2
13:42:33 upstream timeout
```

Those events reveal the exact behavior behind a slow request: repeated calls consumed fifteen seconds before the dependency timed out. A single `payment error` counter would show the failure rate but not that sequence.

Machine-searchable **structured logs** are more useful than sentences with inconsistent wording. A JSON event can preserve stable fields:

```json
{
  "timestamp": "2026-06-13T13:42:33.000Z",
  "level": "ERROR",
  "service": "payment-service",
  "environment": "prod",
  "version": "2.7",
  "request_id": "req789",
  "trace_id": "abc123",
  "provider": "AcmePay",
  "error_type": "UpstreamTimeout",
  "duration_ms": 15000,
  "message": "Payment authorization failed after two retries"
}
```

The fields make it possible to find all errors for `version=2.7`, compare providers, or jump from `trace_id=abc123` to the matching trace. Amazon CloudWatch Logs can centralize logs from AWS workloads and query their fields, but the service cannot invent context the application never emitted. Useful logs begin with intentional application design.

Logs are not a perfect transcript of execution. Logging every internal operation can be expensive, noisy, and risky if sensitive data appears. The application should record meaningful decisions, boundary calls, failures, and identifiers while applying retention and data-protection rules.

### What Do Metrics and Percentiles Tell You?
<!-- section-summary: Metrics summarize behavior over time, and percentiles show how latency is distributed rather than hiding slow users inside one average. -->

A **metric** is a numeric measurement recorded over time. Examples include request count, error count, latency, CPU utilization, memory pressure, queue depth, or completed checkouts. Metrics trade event-level detail for an efficient view of scale and trend.

This difference matters. Ten thousand log events can describe ten thousand requests individually. A metric can summarize the same interval as:

```text
requests = 10,000
errors = 1,200
error rate = 12 percent
```

You cannot recover each request from that summary, but you can immediately see that the incident is broad rather than isolated. Metrics answer four especially useful questions:

- **Traffic:** How much work is arriving, such as requests per second or messages received?
- **Errors:** How often does work fail, and what portion of total work is failing?
- **Latency:** How long does work take from the user's or service's point of view?
- **Saturation:** How close is a limited resource to capacity, such as CPU, memory, connections, concurrency, or queue consumers?

These categories stop an engineer from staring only at host CPU while a business operation is failing elsewhere. For checkout, a useful first view combines completed orders, request rate, error rate, latency, payment failures, database connections, and runtime saturation.

Latency needs special care. Suppose nine requests take 100 milliseconds and one takes 10 seconds. The average is about 1.09 seconds, which describes no actual user's experience particularly well. Percentiles answer a different question:

```text
p50 -> half of requests completed at or below this value
p95 -> 95 percent completed at or below this value
p99 -> 99 percent completed at or below this value
```

If p50 is stable while p99 rises sharply, most users remain fast but a small, important group is suffering. If p50, p95, and p99 all rise, the slowdown is broad. A single average can hide both patterns.

Metrics also use **dimensions** to divide a measurement into bounded groups. `service`, `region`, `endpoint`, `version`, and `status_code` can reveal that version 2.6 has a 0.3 percent error rate while version 2.7 has an 11.8 percent error rate. Later in the article, we will see why unique request or user identifiers do not belong on ordinary metric dimensions.

## When Should an Alarm Notify Someone?
<!-- section-summary: An alarm evaluates a metric rule and should notify people when a sustained, actionable symptom becomes unacceptable. -->

An **alarm** repeatedly evaluates a metric against a threshold or anomaly rule. A CloudWatch alarm can enter `OK`, `ALARM`, or `INSUFFICIENT_DATA`, and can notify a team through Amazon SNS or participate in approved automated actions.

For example:

```text
checkout_error_rate > 5 percent for 3 consecutive minutes
```

The duration prevents one brief fluctuation from waking an operator. The threshold states when the observed behavior becomes unacceptable. The alarm should also lead to an owner, a dashboard, and a response instruction.

The strongest alarms usually represent **user-visible symptoms** before internal causes. Compare:

```text
Symptom: checkout success rate is below its acceptable level
Cause candidate: one ECS task has high CPU
```

High CPU may be harmless during efficient batch work, or it may be one consequence of a retry loop rather than the cause of failed checkouts. A customer-outcome alarm tells the team why investigation matters. Resource alarms still help localize pressure, but they should not replace service-level symptoms.

An alarm that fires on every harmless spike trains the team to ignore it. An alarm that waits until all customers fail arrives too late. Good alarm design balances sensitivity, persistence, missing-data behavior, expected traffic patterns, and a clear action.

### What Is a Dashboard For?
<!-- section-summary: A dashboard organizes related signals so responders can see impact and narrow the search area, but it cannot establish the cause by itself. -->

A dashboard is a shared starting view, not an explanation engine. It arranges customer outcomes, service behavior, dependencies, and resource pressure so a responder can scan the path without opening every AWS console page.

For the checkout system, a dashboard could be ordered like this:

| Row | Examples | Question answered |
|---|---|---|
| User outcome | Checkout success rate, p95 latency | Are customers affected? |
| Entry point | Request rate, 5xx responses | Is the symptom visible at the service boundary? |
| Services | Order and payment latency and errors | Which component looks abnormal? |
| Dependencies | Database time, AcmePay latency | Which downstream system lines up with the symptom? |
| Capacity | CPU, memory, connections, concurrency | Is a limited resource under pressure? |
| Response | Alarm state, release marker, runbook | Who acts and where is the procedure? |

At 13:42, the dashboard might show normal traffic, CPU, memory, and database connections; increasing latency and error rate; and a degraded payment service while order and inventory remain healthy. That reduces the search area from the whole system to the payment path.

The dashboard still does not prove why payment is degraded. It shows correlations and directs the next question. A carefully ordered dashboard is valuable because it shortens orientation time, not because every chart automatically explains a cause.

## What Do Traces and Correlation IDs Tell You?
<!-- section-summary: A distributed trace reconstructs one request as timed spans, while shared identifiers connect that request to its logs and other evidence. -->

A **trace** follows one request as it crosses components. The trace is divided into timed operations called **spans** in OpenTelemetry. AWS X-Ray represents service work with segments and nested work with subsegments, but the basic idea is the same.

One slow checkout may look like this:

```text
Checkout request                         15.2 s
└── Order service                        15.1 s
    ├── Read order data                    40 ms
    ├── Payment service                  15.0 s
    │   └── AcmePay API                  15.0 s ERROR
    └── Write order status                 30 ms
```

The trace shows that database operations were normal and that the AcmePay call consumed almost the entire request. Metrics first showed a broad latency problem; the trace localizes one representative failure.

For a distributed trace to remain connected, services must propagate trace context across HTTP calls, messages, and other boundaries. Correlation identifiers provide further pivots:

```text
Metric spike
    |
    v
Representative trace
    |
    v
trace_id=abc123
    |
    v
Matching application logs
```

A log that only says `database timeout` is weak. A log containing `service=checkout`, `region=eu-west`, `request_id=req789`, and `trace_id=abc123` can be connected to the affected operation and environment. Context changes isolated facts into investigatable evidence.

AWS X-Ray can store and visualize distributed traces. OpenTelemetry provides a vendor-neutral instrumentation model for generating spans and sending telemetry through SDKs, agents, or collectors. Regardless of tooling, a trace's beginner job is to answer: where did this request go, and where did it spend time or fail?

### Why Is Change History an Observability Signal?
<!-- section-summary: Deployments, configuration edits, feature flags, migrations, traffic shifts, and infrastructure events help explain why behavior changed at a particular time. -->

Production behavior rarely changes without an input or state change. Common examples include:

- a new application deployment;
- a configuration or feature-flag update;
- a database migration;
- a traffic increase;
- a dependency release or outage;
- certificate renewal;
- a scaling event;
- an IAM, security-group, or other infrastructure change.

Suppose checkout latency rises at 13:42. A graph alone gives only the symptom. Overlaying a version 2.7 deployment or a `use_new_payment_endpoint=true` flag change at 13:41 creates a testable question: did the new endpoint cause the latency increase?

Deployment systems preserve release events. AWS CloudTrail records AWS API activity, including many configuration and policy changes. CloudWatch alarm history records when an alarm changed state. Application telemetry can carry a version or commit identifier. Together, these records connect behavior to the system state that produced it.

Change proximity is evidence, not proof. A deployment one minute before an incident deserves attention, but an unrelated provider failure could have started at the same time. The team must test the suspected relationship.

## How Do You Instrument an Application With Useful Context?
<!-- section-summary: Instrumentation deliberately creates telemetry, and careful context choices make it searchable without producing unbounded metric series. -->

**Telemetry** is the raw evidence emitted by a system: logs, metrics, traces, events, profiles, and change records. A typical path is:

```text
Application
    |
    v
Instrumentation
    |
    v
Telemetry
    |
    v
Collector
    |
    v
Storage and observability platform
    |
    v
Queries, dashboards, and alarms
    |
    v
Engineer
```

**Instrumentation** means adding code, libraries, agents, or platform integrations that intentionally create useful evidence. An uninstrumented checkout function may perform the work correctly:

```python
def checkout(order):
    charge_card(order)
    save_order(order)
```

An instrumented version exposes important boundaries:

```python
def checkout(order):
    log.info("checkout_started")

    with trace_span("charge_card"):
        charge_card(order)

    with trace_span("save_order"):
        save_order(order)

    checkout_counter.increment()
    log.info("checkout_completed")
```

The additional evidence does not make the business operation work. It makes its behavior explainable when the operation is slow or fails.

Context must be chosen according to the signal. Metrics create a distinct time series for each unique combination of dimensions. Stable, bounded dimensions such as `region`, `service`, `endpoint`, `status_code`, and `version` allow useful comparisons. Adding `user_id` for ten million users could produce millions of series, increasing cost and making queries harder. This is a **high-cardinality** dimension.

Unique values such as `request_id`, `trace_id`, and often `user_id` fit better in logs or traces, where the purpose is to investigate individual events. The principle follows directly from signal purpose:

```text
Metrics       -> aggregate many events into bounded series
Logs/traces   -> preserve detail about particular events
```

Consistency matters too. If logs use `payment-service`, traces use `payment_service`, metrics use `pay`, and deployment records use a repository name, responders spend time translating identities. Shared service, environment, region, operation, and version conventions make pivots reliable.

## How Do All the Signals Work Together?
<!-- section-summary: An incident investigation combines alarms, metrics, dashboards, traces, logs, and change records to remove uncertainty one question at a time. -->

At 13:42, checkout errors rise from 0.3 percent to 12 percent. No single signal provides the full explanation.

1. **Alarm:** The sustained checkout error rule enters `ALARM` and pages the operator. The team knows that a user-facing condition requires investigation.
2. **Metrics:** Traffic, CPU, memory, and database connections are normal, while latency and errors rise. General resource exhaustion becomes less likely.
3. **Dashboard:** Order and inventory look healthy, but the payment service is degraded. The search area narrows.
4. **Trace:** A failed checkout shows `Order -> Payment -> AcmePay API`, with the external call consuming fifteen seconds and ending in a timeout.
5. **Logs:** Events for the trace show two retries followed by an upstream timeout. The team now knows the exact behavior.
6. **Changes:** Payment-service version 4.8 was deployed at 13:37, and `use_new_payment_endpoint=true` was enabled at 13:41. Errors began one minute later.

The reasoning path is:

```text
Alarm       -> Something important is wrong.
Metrics     -> How large is it, and what changed statistically?
Dashboard   -> Which component should we inspect?
Trace       -> Where did a request fail or slow down?
Logs        -> What exactly happened there?
Changes     -> Why might it have started now?
```

The evidence reduces a large set of possible explanations to one strong hypothesis: the new AcmePay endpoint is failing. Turning off the feature flag and observing the error rate return to normal tests that hypothesis.

This is why observability is best understood as uncertainty reduction. Telemetry is useful only when people can connect it, form an explanation, and decide what to test or change.

![The observability stack shows how application telemetry, AWS service signals, dashboards, alerts, and audit events fit into one view](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/aws-observability-stack.png)

*The observability stack connects application evidence, AWS service signals, investigation tools, and the people making decisions.*

### How Do You Investigate Without Mistaking Correlation for Cause?
<!-- section-summary: A sound investigation starts with user symptoms, iterates between signals, forms a hypothesis, and tests it instead of treating timing alone as proof. -->

A beginner-friendly incident flow is:

```text
1. State the user symptom.
2. Find when it began.
3. Measure the size of the impact.
4. Identify the abnormal service or dependency.
5. Find a representative bad request.
6. Locate where that request failed or slowed.
7. Read the relevant logs.
8. inspect changes shortly before the symptom.
9. Form a hypothesis.
10. Test the hypothesis and watch the outcome.
```

Starting at the user symptom preserves the right hierarchy:

```text
User symptom
    |
    v
Service behavior
    |
    v
Dependencies
    |
    v
Infrastructure
```

Starting with hundreds of CPU graphs reverses the hierarchy and can uncover abnormalities that do not affect users.

The hypothesis step is essential because **correlation is not causation**. If CPU and errors rise at the same minute, high CPU may have caused failures. But a defective deployment could also have started an infinite retry loop that independently raised CPU and error count. The two graphs share a cause rather than causing each other.

A healthy investigation is iterative rather than perfectly linear. A trace may create a question that sends you to logs; the logs may suggest checking a different metric; that metric may send you to release history and another trace. Good tooling preserves context while you pivot among those views.

Observability supports three increasing levels of understanding:

| Level | Question | Signals that commonly help |
|---|---|---|
| Detect | Is something wrong? | Metrics and alarms |
| Localize | Where is it wrong? | Dashboards, service metrics, and traces |
| Explain | Why is it wrong? | Traces, logs, changes, and domain knowledge |

Collecting terabytes of logs does not guarantee the third level. The test is whether people can answer important questions with the evidence.

![The evidence loop shows how responders move from symptom to signal, suspected layer, recent change, action, and follow-up](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/production-evidence-loop.png)

*Investigation is an evidence loop: observe, narrow, hypothesize, test, and check the new state.*

## What Does Good Observability Look Like?
<!-- section-summary: Good observability shortens the path from a vague report to a tested explanation by making relevant evidence connected and easy to query. -->

In a poorly observable system, `checkout is broken` can lead to random server access, unrelated CPU graphs, and a late question about recent deployments. The engineer cannot find the affected request or connect it to a version.

In a well-observable system, the chain is shorter:

```text
Checkout success rate dropped at 13:42
            |
            v
Only version 2.7 is affected
            |
            v
Payment traces show AcmePay timeouts
            |
            v
The new endpoint flag was enabled at 13:41
            |
            v
Disable the flag and verify recovery
```

The deepest model is a black box that emits enough signals for an observer to reconstruct meaningful behavior:

```text
              Running system
            /        |        \
         logs      metrics    traces
            \        |        /
                 observer
                    |
                    v
      state, request path, change, hypothesis, action
```

The objective is not prettier graphs. It is faster, cheaper, and more reliable understanding. A complete incident might move from a p95 alarm, to a payment-service dashboard, to a trace showing a 4.8-second database query, to a log identifying a new unindexed lookup, to a release record showing that version 7.2 introduced the query. Rolling back and seeing latency recover confirms the explanation. Every signal contributed; their connection solved the incident.

Remember the compact sequence:

```text
Metrics     -> Is something wrong, and how large is it?
Alarms      -> Should someone investigate now?
Dashboards  -> Where should the investigation begin?
Traces      -> Where did this request go?
Logs        -> What exactly happened?
Changes     -> What moved before the behavior changed?
```

Observability turns telemetry into evidence, evidence into hypotheses, and tested hypotheses into an understanding of a running system.

## Check Your Answers

:::expand[Why Do Running Systems Need Observability?]{kind="recap"}
Observability lets people infer a system's hidden internal behavior from evidence that the system deliberately emits.

A running system contains internal state that operators cannot inspect continuously. Instrumentation makes the system emit logs, metrics, traces, and other evidence. Observability is the practice of connecting that evidence so people can infer what the system is doing and reduce uncertainty about failures or slow behavior.

Monitoring detects conditions you decided to watch, while observability also supports questions that were not predicted in advance.

Monitoring checks known conditions such as an error threshold or a health endpoint. Observability includes that detection work but also supports questions the team did not predict, such as why only one version, region, or provider combination is slow.
:::

:::expand[What Does the Example Application Look Like?]{kind="recap"}
A small checkout application gives each observability signal a concrete role along one request path.
:::

:::expand[What Do Logs Tell You?]{kind="recap"}
Logs preserve selected events and context so an engineer can reconstruct what happened during a particular operation.

Metrics summarize behavior over time, and percentiles show how latency is distributed rather than hiding slow users inside one average.

An average can hide a slow minority or describe no user's actual experience. p50, p95, and p99 show different points in the latency distribution, making it possible to distinguish a broad slowdown from a severe tail-latency problem.
:::

:::expand[When Should an Alarm Notify Someone?]{kind="recap"}
An alarm evaluates a metric rule and should notify people when a sustained, actionable symptom becomes unacceptable.

A dashboard organizes related signals so responders can see impact and narrow the search area, but it cannot establish the cause by itself.
:::

:::expand[What Do Traces and Correlation IDs Tell You?]{kind="recap"}
A distributed trace reconstructs one request as timed spans, while shared identifiers connect that request to its logs and other evidence.

Deployments, configuration edits, feature flags, migrations, traffic shifts, and infrastructure events help explain why behavior changed at a particular time.

Two measurements can move together because one causes the other, because the relationship is reversed, or because a third event affects both. A nearby deployment or rising CPU is evidence for a hypothesis, but the team still needs a test such as a rollback or flag change.
:::

:::expand[How Do You Instrument an Application With Useful Context?]{kind="recap"}
Instrumentation deliberately creates telemetry, and careful context choices make it searchable without producing unbounded metric series.

Use bounded values such as service, region, endpoint, status class, and version as metric dimensions. Put highly unique values such as request IDs, trace IDs, and often user IDs in logs or traces, where they help investigate individual events without creating millions of metric series.
:::

:::expand[How Do All the Signals Work Together?]{kind="recap"}
An incident investigation combines alarms, metrics, dashboards, traces, logs, and change records to remove uncertainty one question at a time.

Metrics show scale and trend, alarms decide when a condition needs attention, dashboards organize the first view, traces reconstruct one request path, logs explain detailed events, and change records show what moved before behavior changed.

A sound investigation starts with user symptoms, iterates between signals, forms a hypothesis, and tests it instead of treating timing alone as proof.

Begin with the user symptom, establish its start time and impact, localize the abnormal component, inspect a representative request, read its logs, and compare recent changes. Then form a hypothesis, test it, and observe whether the system recovers.
:::

:::expand[What Does Good Observability Look Like?]{kind="recap"}
Good observability shortens the path from a vague report to a tested explanation by making relevant evidence connected and easy to query.

Good observability lets engineers move quickly from a vague symptom to scope, request path, exact behavior, relevant changes, and a tested explanation. The amount of telemetry matters less than whether people can connect it to answer important questions.
:::

## References

- [What is Amazon CloudWatch?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html) - Official overview of CloudWatch monitoring, metrics, alarms, dashboards, logs, cross-account monitoring, and OpenTelemetry support.
- [Implement observability - AWS Well-Architected Operational Excellence Pillar](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/implement-observability.html) - AWS guidance on observability, metrics, logs, traces, KPIs, anomalies, and data-driven workload decisions.
- [OPS04-BP01 Identify key performance indicators](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_observability_identify_kpis.html) - AWS guidance to align observability with business objectives and revisit KPIs as workloads evolve.
- [OPS04-BP02 Implement application telemetry](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_observability_application_telemetry.html) - AWS guidance on application telemetry, business KPIs, CloudWatch, X-Ray, and the CloudWatch agent.
- [What is Amazon CloudWatch Logs?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html) - Documents centralized log storage, querying, field filtering, metric filters, log classes, retention, and data protection.
- [AWS X-Ray concepts](https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html) - Explains traces, segments, subsegments, service graphs, and trace IDs for distributed request paths.
- [CloudWatch cross-account observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html) - Documents monitoring accounts, source accounts, Observability Access Manager, and shared telemetry types.
- [Application Signals - Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html) - Documents application health views, SLOs, services, dependencies, key metrics, and cross-account Application Signals.
