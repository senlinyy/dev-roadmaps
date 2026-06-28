---
title: "Observability Basics"
description: "Understand how AWS workloads use logs, metrics, traces, dashboards, alarms, KPIs, and telemetry context to explain production behavior."
overview: "Observability gives a cloud team enough evidence to understand a running workload without logging in to every machine or guessing from one graph. This article explains the basic AWS observability pieces and shows how they connect during a real production incident."
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

1. [Start With Four Beginner Questions](#start-with-four-beginner-questions)
2. [Meet the Simple App](#meet-the-simple-app)
3. [Logs: What Happened](#logs-what-happened)
4. [Metrics and Alarms: How Bad Is It](#metrics-and-alarms-how-bad-is-it)
5. [Dashboards: Where Do We Look First](#dashboards-where-do-we-look-first)
6. [Traces: Where Did the Request Spend Time](#traces-where-did-the-request-spend-time)
7. [Changes: What Moved Before the Symptom](#changes-what-moved-before-the-symptom)
8. [How the Signals Work Together](#how-the-signals-work-together)
9. [A Beginner Response Flow](#a-beginner-response-flow)
10. [What's Next](#whats-next)
11. [References](#references)

## Start With Four Beginner Questions
<!-- section-summary: Observability helps a team answer what happened, where it happened, how bad it is, and what changed. -->

When a production app breaks, a beginner usually wants one clear place to look. AWS rarely works that way because even a small app can use a load balancer, containers, a database, a queue, a function, and a few managed services. The useful starting point is a small set of questions that work no matter which AWS service is involved.

The first question is **what happened?** A user saw a failed page, a worker crashed, a database call timed out, or a payment provider returned an error. The second question is **where did it happen?** The symptom may sit at the load balancer, the application, the database, a queue, a Lambda function, or an outside API. The third question is **how bad is it?** One failed request has a different response path from every checkout failing for ten minutes. The fourth question is **what changed?** A deployment, policy edit, scaling event, secret rotation, or network rule may explain why the system changed behavior.

**Observability** is the practice of designing a workload so it emits evidence that answers those questions while it runs. The evidence is called **telemetry**. In AWS, telemetry usually means logs, metrics, traces, alarms, dashboards, and change records. Those signals help the team understand the app without signing in to every machine or guessing from one graph.

The goal here is to know what each signal is for and how a responder uses it. Later articles turn the same ideas into CloudWatch metric commands, Logs Insights queries, alarm settings, trace instrumentation, and service health targets.

![The signal map shows how logs, metrics, traces, and changes answer different beginner questions during an incident](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/three-signals-three-questions.png)

*The signal map shows how logs, metrics, traces, and changes answer different beginner questions during an incident.*


## Meet the Simple App
<!-- section-summary: A simple checkout app gives every signal a concrete job in one request path. -->

We will use a small app called `tiny-checkout`. A customer opens a checkout page, submits an order, pays through a payment provider, and waits for a confirmation email. The app runs as an Amazon ECS service behind an Application Load Balancer. It writes order rows to Amazon RDS, sends email work to Amazon SQS, and uses a Lambda function for a fraud check.

That sounds like a lot, but each piece has a normal job. The load balancer receives web traffic. ECS runs the application container. RDS stores rows. SQS holds background work. Lambda runs a small event-driven function. The payment provider is an outside dependency that the app calls during checkout.

Here is the request path in plain language:

| Step | What happens | Signal that helps later |
|---|---|---|
| Customer submits checkout | The browser sends `POST /checkout` | Load balancer metrics and access logs |
| App handles the request | ECS task validates the cart and starts payment | Application logs, custom metrics, and traces |
| App stores the order | The app writes an order row to RDS | RDS metrics and application logs |
| App calls payment provider | The app waits for authorization | Logs, dependency metrics, and trace spans |
| App queues email work | The app sends a message to SQS | SQS metrics and trace context |
| Worker sends email | Lambda handles the message later | Lambda metrics, logs, and traces |

This article follows one incident: customers report that checkout is slow and sometimes fails. We will use the same four beginner questions all the way through: what happened, where did it happen, how bad is it, and what changed?

## Logs: What Happened
<!-- section-summary: Logs are timestamped event records that explain specific requests, errors, and decisions. -->

**Logs** are event records. A log event usually describes one thing that happened at one time: a request started, a payment call timed out, a database write failed, a worker retried a message, or a deployment script finished. Logs are the closest signal to the exact story of one request.

For `tiny-checkout`, a useful log event is structured as JSON. JSON gives every important fact a field name, so the team can search by `requestId`, filter by `level`, group by `errorType`, and connect the line to a trace. A plain sentence can help a human read one line, but structured fields help a responder search thousands of lines during an incident.

```json
{
  "timestamp": "2026-06-13T10:15:22.481Z",
  "level": "ERROR",
  "service": "checkout-api",
  "environment": "prod",
  "requestId": "req-7f3a8c",
  "traceId": "1-666c182a-4f7d9b2e9a1d5c67b8142a10",
  "route": "POST /checkout",
  "statusCode": 502,
  "durationMs": 8420,
  "errorType": "PaymentGatewayTimeout",
  "message": "Payment authorization timed out after provider retry"
}
```

This event answers **what happened**. The checkout API returned a `502` for `POST /checkout`, the request took `8420` milliseconds, and the error type was `PaymentGatewayTimeout`. It also gives the team handles for the next step. `requestId` helps find every line from the same request inside logs. `traceId` helps jump from one log line to the full request path. `service` and `environment` tell the responder which workload wrote the event.

CloudWatch Logs is the main AWS service for storing and querying logs. ECS containers, Lambda functions, EC2 instances, and many AWS services can send logs there. A good first production habit is simple: every important service should write logs to a log group with a clear owner, a clear retention period, and a small set of stable fields.

## Metrics and Alarms: How Bad Is It
<!-- section-summary: Metrics summarize behavior over time, and alarms turn important metric changes into action. -->

**Metrics** are numbers recorded over time. A metric can count requests, errors, successful checkouts, queue depth, CPU usage, memory usage, database connections, or latency. Metrics help answer **how bad is it** because they show scale and trend.

If one checkout request failed, the log line may be enough. If completed checkouts dropped by 80 percent, the team needs a different response. Metrics show whether the failure is isolated, growing, recovering, or spreading across the system.

For `tiny-checkout`, the first metric set should connect customer outcome to technical pressure:

| Question | Metric example | What the answer means |
|---|---|---|
| Are customers completing checkout? | Custom `CompletedCheckouts` count | A drop means the user-facing flow is harmed |
| Is the API slow? | ALB `TargetResponseTime` p95 | A rise means many users wait longer |
| Are requests failing? | ALB `HTTPCode_Target_5XX_Count` | A rise means backend responses are failing |
| Are containers saturated? | ECS CPU and memory utilization | High values can point to compute pressure |
| Is the database under pressure? | RDS connections and latency | High values can point to connection or query trouble |
| Is background work delayed? | SQS oldest message age | A rise means queued work is falling behind |

An **alarm** watches a metric and changes state when the metric crosses a rule. In CloudWatch, an alarm can be `OK`, `ALARM`, or `INSUFFICIENT_DATA`. An alarm can notify a team through Amazon SNS, feed an incident tool, or support approved automation for some resource actions.

For beginners, the important idea is that alarms should point to action. A useful alarm says something like "checkout p95 latency has been above two seconds for several minutes, and the checkout team should inspect the dashboard and runbook." A noisy alarm that fires for harmless one-minute spikes teaches people to ignore it. A missing alarm leaves the team waiting for a customer report.

## Dashboards: Where Do We Look First
<!-- section-summary: Dashboards put related metrics and status in one ordered view so responders can see customer impact and system pressure. -->

A **dashboard** is a shared view of health. In CloudWatch, a dashboard can show metrics, alarms, logs widgets, and text notes. A dashboard helps answer **where do we look first** because the responder can scan the request path instead of opening every AWS service page one by one.

The order of the dashboard matters. Put the user outcome first, then the entry point, then the application, then the data and background systems. That shape teaches the on-call engineer to check customer impact before chasing a noisy infrastructure chart.

| Dashboard row | `tiny-checkout` widgets | What the row tells the team |
|---|---|---|
| Customer outcome | Completed checkouts, payment failures, checkout p95 latency | Whether users are actually affected |
| Entry point | ALB request count, target 5xx, target response time | Whether traffic reaches healthy app targets |
| Compute | ECS running task count, CPU, memory, deployments | Whether the app runtime has enough capacity |
| Data | RDS connections, CPU, write latency | Whether database pressure lines up with symptoms |
| Background work | SQS visible messages, oldest message age, Lambda errors | Whether async work is delayed or failing |
| Response | Alarm state widgets, runbook link, owner notes | Who owns the next action |

Dashboards give the first shape of the problem and point the next investigation step. If completed checkouts drop, target 5xx rises, and payment failures rise at the same time, the team can move toward payment logs and traces. If checkout completes normally while SQS age rises, the customer payment path may be healthy while confirmation emails lag.

## Traces: Where Did the Request Spend Time
<!-- section-summary: Traces connect the timed work inside one request as it moves through services and dependencies. -->

**Traces** follow one request across service boundaries. A trace is made of timed pieces of work. In OpenTelemetry, those pieces are called **spans**. In AWS X-Ray, service-level records are called segments, and nested dependency records are called subsegments. The names differ, but the beginner idea is the same: a trace shows the path and timing of one request.

For `tiny-checkout`, one trace might show this:

| Timed work | Duration | What it suggests |
|---|---:|---|
| `POST /checkout` in `checkout-api` | 8,480 ms | The whole request was slow |
| Validate cart | 18 ms | Local app work was fast |
| Write order row to RDS | 42 ms | Database write was normal |
| Authorize payment | 8,210 ms | Payment provider call dominated the request |
| Send SQS email message | 25 ms | Queue handoff was normal |

That table answers **where did it happen** in a way logs alone can struggle to show. The slow part was the payment authorization call, not the database or the queue. The trace also gives the team a path to the exact log events through the shared `traceId`.

Traces need **context propagation**. That means the request carries a trace identity as it moves from one service to the next. With HTTP, that identity travels in headers. With queues, it may travel in message attributes or AWS-supported trace fields. Each service reads the incoming trace context, records its own span, and passes context to the next service.

AWS X-Ray is the AWS tracing service that stores and visualizes trace data. OpenTelemetry is the common instrumentation standard that creates spans and sends them through an SDK, agent, or collector. Later articles go deeper into X-Ray, OpenTelemetry, spans, collectors, and sampling. For this first article, remember the beginner job: traces show where one request spent time.

## Changes: What Moved Before the Symptom
<!-- section-summary: Change evidence connects symptoms to deployments, AWS API activity, scaling, policy edits, and configuration updates. -->

The fourth beginner question is **what changed**. Many incidents start after a deployment, scaling event, feature flag change, secret rotation, IAM policy edit, security group update, database parameter change, or dependency outage. Observability includes these records because a symptom without change context can lead to slow guessing.

AWS has several places to find change evidence. **AWS CloudTrail** records AWS API activity such as security group edits, IAM policy changes, Lambda configuration updates, and ECS service changes. Deployment tools record which application version went out. CloudWatch alarm history records when alarms changed state and why. Application logs can include `deploymentVersion` or `gitSha` so runtime behavior connects back to the release.

For the checkout incident, a change table might look like this:

| Time | Change evidence | Why it matters |
|---|---|---|
| 10:00 | ECS deployed `checkout-api:2026.06.13.4` | The app version changed before symptoms |
| 10:03 | Payment timeout logs started rising | The failure started after the deployment |
| 10:05 | Checkout p95 latency alarm entered `ALARM` | User-facing delay became sustained |
| 10:07 | Completed checkouts dropped | Business impact appeared |
| 10:09 | No RDS or SQS pressure changed | Database and queue look less likely |

That timing gives the team a strong next question: what changed in `checkout-api:2026.06.13.4` around payment authorization? The answer often guides the next action, such as rolling back, disabling a feature flag, or comparing traces between the old and new version.

## How the Signals Work Together
<!-- section-summary: Logs, metrics, traces, alarms, dashboards, and change records answer different parts of the same production question. -->

Each signal has a job. Logs explain individual events. Metrics show patterns over time. Alarms turn important metric changes into notifications. Dashboards organize the first view. Traces connect one request across services. Change records explain what moved before the symptom.

The signals are strongest when they share names. If logs use `service=checkout-api`, metrics use `Service=checkout-api`, traces use `service.name=checkout-api`, and dashboards use the same service name, the team can move through evidence quickly. If every tool uses a different name, the incident starts with translation work.

For `tiny-checkout`, the shared fields should include:

| Shared field | Where it appears | Example |
|---|---|---|
| Service name | Logs, metrics, traces, dashboards, alarms | `checkout-api` |
| Environment | Logs, metrics, traces | `prod` |
| Request ID | Logs and response headers | `req-7f3a8c` |
| Trace ID | Logs and traces | `1-666c182a-4f7d9b2e9a1d5c67b8142a10` |
| Deployment version | Logs, traces, dashboards, release records | `2026.06.13.4` |
| Route or operation | Logs, metrics, traces | `POST /checkout` |

There is one important design habit here. Put high-cardinality values, such as request IDs, customer IDs, order IDs, and session IDs, in logs and traces. Keep metric dimensions limited to stable values such as service, environment, route, dependency, and status class. A metric dimension creates a separate metric series for each unique value, so per-request dimensions can create cost and noise.

![The observability stack shows how application telemetry, AWS service signals, dashboards, alerts, and audit events fit into one view](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/aws-observability-stack.png)

*The observability stack shows how application telemetry, AWS service signals, dashboards, alerts, and audit events fit into one view.*


## A Beginner Response Flow
<!-- section-summary: A first response follows customer impact, scope, exact errors, request path, and recent changes in that order. -->

Now replay the incident from a beginner's point of view. A customer says checkout failed. The team should avoid jumping straight to one AWS service. The better first response follows the four questions and lets the evidence decide the next step.

| Step | Signal | Question it answers | Example finding |
|---|---|---|---|
| Check customer outcome | Business metrics and dashboard | How bad is it? | Completed checkouts dropped 40 percent |
| Check entry point | ALB metrics and alarm state | Where is the symptom visible? | Target 5xx and p95 latency both rose |
| Check exact errors | CloudWatch Logs | What happened? | `PaymentGatewayTimeout` dominates errors |
| Check request path | X-Ray or trace view | Where did time go? | Payment authorization spans take 8 seconds |
| Check recent changes | Deployment record and CloudTrail | What changed? | New checkout image deployed five minutes earlier |
| Choose action | Runbook and owner decision | What should we do next? | Roll back the app version and keep watching metrics |

This flow is intentionally simple. A real production incident may include database deep dives, provider status pages, feature flag checks, traffic shifts, customer support updates, and post-incident review. The beginner habit stays the same: use evidence to move from symptom to scope, detail, path, change, and action.

![The evidence loop shows how responders move from symptom to signal, suspected layer, recent change, action, and follow-up](/content-assets/articles/article-cloud-providers-aws-observability-observability-mental-model/production-evidence-loop.png)

*The evidence loop shows how responders move from symptom to signal, suspected layer, recent change, action, and follow-up.*


## What's Next
<!-- section-summary: The next article turns metrics, dashboards, and alarms into concrete CloudWatch operations. -->

You now have the basic AWS observability map. Logs answer what happened. Metrics and alarms answer how bad it is. Dashboards organize where to look first. Traces show where one request spent time. Change records help explain why the behavior shifted.

The next article goes one level deeper into CloudWatch metrics, dashboards, and alarms. We will publish and inspect metrics, build dashboard widgets, read alarm history, tune missing-data behavior, and connect alarms to action without losing the beginner questions that started this article.

---

**References**

- [What is Amazon CloudWatch?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html) - Official overview of CloudWatch monitoring, metrics, alarms, dashboards, logs, cross-account monitoring, and OpenTelemetry support.
- [Implement observability - AWS Well-Architected Operational Excellence Pillar](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/implement-observability.html) - AWS guidance on observability, metrics, logs, traces, KPIs, anomalies, and data-driven workload decisions.
- [OPS04-BP01 Identify key performance indicators](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_observability_identify_kpis.html) - AWS guidance to align observability with business objectives and revisit KPIs as workloads evolve.
- [OPS04-BP02 Implement application telemetry](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_observability_application_telemetry.html) - AWS guidance on application telemetry, business KPIs, CloudWatch, X-Ray, and the CloudWatch agent.
- [What is Amazon CloudWatch Logs?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html) - Documents centralized log storage, querying, field filtering, metric filters, log classes, retention, and data protection.
- [AWS X-Ray concepts](https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html) - Explains traces, segments, subsegments, service graphs, and trace IDs for distributed request paths.
- [CloudWatch cross-account observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html) - Documents monitoring accounts, source accounts, Observability Access Manager, and shared telemetry types.
- [Application Signals - Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html) - Documents application health views, SLOs, services, dependencies, key metrics, and cross-account Application Signals.
