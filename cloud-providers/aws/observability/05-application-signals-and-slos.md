---
title: "Application Signals and SLOs"
description: "Use CloudWatch Application Signals to turn application telemetry into service health views, service maps, SLIs, SLOs, and error-budget investigations."
overview: "Distributed tracing shows the path of one request. Application Signals turns traces, metrics, canaries, and real user telemetry into service-level health so teams can decide whether critical application behavior is meeting customer expectations."
tags: ["cloudwatch", "application-signals", "slo", "sli", "x-ray", "aws"]
order: 5
id: article-cloud-providers-aws-observability-application-signals-and-slos
aliases:
  - application-signals-and-slos
  - cloud-providers/aws/observability/application-signals-and-slos.md
---

## Table of Contents

1. [Why Is One Trace Not Enough to Measure Service Health?](#why-is-one-trace-not-enough-to-measure-service-health)
2. [What Does Application Signals Add?](#what-does-application-signals-add)
3. [Why Must Instrumentation Run With the Application?](#why-must-instrumentation-run-with-the-application)
4. [How Do Metrics Become Service Level Indicators?](#how-do-metrics-become-service-level-indicators)
5. [How Do SLOs Create Error Budgets and Burn Rates?](#how-do-slos-create-error-budgets-and-burn-rates)
6. [How Should You Design Availability and Latency SLOs?](#how-should-you-design-availability-and-latency-slos)
7. [How Do You Investigate an Unhealthy Service?](#how-do-you-investigate-an-unhealthy-service)
8. [How Does the Complete Service-Health Model Fit Together?](#how-does-the-complete-service-health-model-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The service-health progression is `requests -> telemetry -> application signals -> SLIs -> SLOs -> engineering decisions`. Each layer answers a different question. A trace explains one request. Application Signals summarizes how an operation behaves across many requests. An SLO decides whether that behavior is good enough for users.

In the previous article, you followed a checkout request across services with OpenTelemetry and AWS X-Ray. That is a huge step forward. A trace can show that the checkout API spent 1.8 seconds waiting on a payment provider, 300 milliseconds writing to DynamoDB, and 40 milliseconds sending an event to SQS. A responder can finally see the path instead of guessing from separate logs.

A production team needs more than one trace at a time to run the business. During a real incident, the on-call engineer needs broader answers about traffic, errors, latency, dependencies, and customer impact.

Keep these questions in view as you work through the lesson:

1. **Why Is One Trace Not Enough to Measure Service Health?**
2. **What Does Application Signals Add?**
3. **Why Must Instrumentation Run With the Application?**
4. **How Do Metrics Become Service Level Indicators?**
5. **How Do SLOs Create Error Budgets and Burn Rates?**
6. **How Should You Design Availability and Latency SLOs?**
7. **How Do You Investigate an Unhealthy Service?**
8. **How Does the Complete Service-Health Model Fit Together?**

## Why Is One Trace Not Enough to Measure Service Health?
<!-- section-summary: Tracing explains individual requests, but production operations need a service-level view of customer-facing health. -->

* Which services are unhealthy right now?
* Which operation is hurting customers: `POST /checkout`, `GET /cart`, or `POST /payment/authorize`?
* Is the problem inside the service, in a dependency, in a canary journey, or in the browser?
* Did the service actually miss the reliability target the team promised, or did one noisy trace just look scary?

That last question matters a lot. A single slow request might be acceptable in a high-volume system. A steady burn of 5xx errors on checkout for 20 minutes is a different situation. Teams need a way to translate raw telemetry into **service health** and **customer promises**.

This is where **CloudWatch Application Signals** and **service level objectives** come in.

## What Does Application Signals Add?
<!-- section-summary: Application Signals uses application telemetry to discover services, show operational health, and connect service views to SLOs, canaries, RUM, logs, metrics, and traces. -->

**Amazon CloudWatch Application Signals** is an application performance monitoring feature in CloudWatch. In plain language, it takes the traces and metrics your application emits and organizes them around the services, operations, and dependencies that your team actually talks about during incidents.

If the checkout platform has an `orders-api`, a `payments-api`, a DynamoDB table, an external card processor, and a browser checkout page, Application Signals tries to show those pieces as an operational map instead of leaving them as separate metric names and trace documents. The main pages you use are **Services**, **Service detail**, and **Application Map**.

The important shift is this: logs, metrics, and traces still exist, but Application Signals gives them a service vocabulary.

| Raw telemetry question | Application Signals question |
|---|---|
| What is the p99 latency metric called? | Which operation is slow? |
| Which trace contains the failure? | Which dependency is causing faults? |
| Which log group should I search? | Which logs are correlated with this operation? |
| Is this alarm important? | Which SLO is unhealthy or burning budget? |

AWS documents that Application Signals can work with CloudWatch RUM, CloudWatch Synthetics canaries, AWS Service Catalog AppRegistry, and Amazon EC2 Auto Scaling to display client pages, canaries, and application names in dashboards and maps. That is why this article sits after tracing and before Synthetics and RUM. Tracing gives Application Signals service evidence. Synthetics and RUM add the outside-in and browser-side views that Application Signals can connect back to services.

For the rest of the article, imagine a production checkout system. Customers browse products, add items to a cart, and submit payment. The business cares about checkout completion, so the team needs more than a pile of telemetry. They need clear service health and clear reliability targets.

![The service view shows how Application Signals groups operations, dependencies, latency, errors, and throughput into one service health picture](/content-assets/articles/article-cloud-providers-aws-observability-application-signals-and-slos/application-signals-service-view.png)

*The service view shows how Application Signals groups operations, dependencies, latency, errors, and throughput into one service health picture.*


### How Do Services, Operations, and Dependencies Organize Health?
<!-- section-summary: Application Signals breaks application behavior into services, the operations they serve, and the dependencies they call. -->

Application Signals uses three ideas again and again: **service**, **operation**, and **dependency**. These sound simple, but they prevent many monitoring mistakes.

A **service** is one running application component that receives work. In our checkout example, `orders-api` is a service. `payments-api` is another service. A Lambda function called `send-receipt-email` can also be a service when it handles a request or event.

An **operation** is a named unit of work handled by a service. For an HTTP API, operations often look like routes or route groups, such as `POST /checkout`, `GET /orders/{id}`, or `POST /payment/authorize`. Operations are useful because different endpoints deserve different reliability targets. A slow admin export might be annoying. A slow payment authorization can block revenue.

This is why an organizational service boundary is not always the right reliability boundary. A high-volume `GET /profile` operation can keep a service-wide average healthy while a low-volume but critical `POST /checkout-info` operation is completely broken. The best SLO boundary is often the user-visible capability rather than the whole microservice.

A **dependency** is something a service calls while doing its work. Dependencies can be another service, an AWS service, a database, a queue, or an external endpoint. In checkout, `orders-api` might call DynamoDB, Amazon SQS, and a payment provider. If the service is slow because the payment provider is slow, the service detail page should help you follow that path.

The **Services page** gives the fleet view. It lists services enabled for Application Signals, shows operational metrics, highlights unhealthy service level indicators, and lets you filter by properties such as platform, environment, SLI health, and instrumentation status. It is the place an on-call engineer checks first when the incident channel says "checkout is timing out."

The **Service detail page** gives the focused view for one service. AWS documents tabs for overview, service operations, dependencies, Synthetics canaries, client pages, and related metrics. This is where the checkout team can see that `POST /checkout` is unhealthy, then compare operation latency, dependency latency, canary results, browser page data, traces, logs, and related metrics without jumping between five unrelated consoles.

The **Application Map** gives the topology view. It shows services, clients, canaries, and dependencies together so responders can see relationships. This matters during chain reactions. If checkout fails because `payments-api` is healthy but its card-network dependency is faulting, the map can point the team toward the dependency path instead of the wrong service.

Application Signals discovers services and operations from recent telemetry. AWS notes that Application Signals displays services and operations based on the selected time filter, defaults to the past three hours, may take up to 10 minutes for service topology discovery, and may take up to 15 minutes for SLI health evaluation. In production, that means a newly deployed service or a quiet operation might need real traffic before it appears in the expected places.


## Why Must Instrumentation Run With the Application?
<!-- section-summary: Enabling Application Signals depends on the runtime platform, but the common pattern is ADOT instrumentation plus the CloudWatch agent or Lambda layer. -->

Application Signals needs telemetry from the application. Behind the scenes, AWS uses OpenTelemetry-compatible instrumentation, AWS Distro for OpenTelemetry, the CloudWatch agent, and platform-specific setup paths. The exact setup depends on where the code runs.

Infrastructure monitoring cannot infer application meaning by itself. Container CPU can say `93%`; it cannot say that `POST /checkout` called `payments-api` and waited 720 milliseconds. Instrumentation around inbound and outbound application work supplies the semantic context needed to identify operations and dependencies.

The current AWS support matrix lists Application Signals support and testing for **Amazon EKS**, **native Kubernetes**, **Amazon ECS**, and **Amazon EC2**. The same support page includes runtime guidance for Java, .NET, PHP, Ruby, Python, Node.js, and Go, with version details such as JVM versions 8, 11, 17, 21, and 23, Python 3.9 and higher, Node.js versions 14 through 22, PHP 8.0 and higher, Ruby runtime ranges, and Go 1.18 and higher. Treat the support matrix as a rollout checklist, because instrumentation details can differ by runtime and language module system.

Here is the practical platform view.

| Runtime platform | What the team usually configures | Production note |
|---|---|---|
| **Amazon EKS** | Use the Amazon CloudWatch Observability EKS add-on and enable workloads through the console or Kubernetes annotations. | AWS says the console path can restart pods immediately, while manifest annotations give more control over rollout timing. |
| **Amazon ECS** | Install and configure the CloudWatch agent and ADOT yourself. Use a sidecar strategy or daemon strategy. | The sidecar strategy supports EC2 and Fargate launch types but must be added to each task definition. The daemon strategy is set up once per cluster and is limited to EC2 launch types. |
| **Amazon EC2** | Attach permissions such as `CloudWatchAgentServerPolicy`, install/start the CloudWatch agent, and configure OpenTelemetry instrumentation for the application. | Set `service.name` and `deployment.environment` through `OTEL_RESOURCE_ATTRIBUTES` so dashboards show useful names instead of vague defaults. |
| **AWS Lambda** | Enable Application Signals in the CloudWatch or Lambda console, or manually add the AWS Lambda Layer for OpenTelemetry. | AWS documents that the layer provides enhanced ADOT libraries for auto-instrumentation, and manual setup includes `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument` plus the `CloudWatchLambdaApplicationSignalsExecutionRolePolicy` policy. |

For EKS, a team might annotate a namespace that contains checkout workloads so every current and future workload in that namespace receives instrumentation. For ECS, the same team might add a CloudWatch agent sidecar to the `orders-api` task definition because the service runs on Fargate. For Lambda, they might enable Application Signals from the Lambda monitoring configuration because the receipt function already uses a supported runtime.

The goal is the same in each platform: make the application emit standard telemetry with stable service and environment names. If the names are inconsistent, the console gets noisy. If one service calls itself `checkout`, another calls it `orders-api`, and a third emits `UnknownService`, the incident view splits one service into several names.

## How Do Metrics Become Service Level Indicators?
<!-- section-summary: Application Signals collects latency, fault, and error metrics, and uses these metrics to power SLI health. -->

An **SLI**, or service level indicator, is the measurement you use to judge a service target. If the target is "checkout should stay available," the SLI might be availability. If the target is "checkout should respond quickly," the SLI might be latency.

A metric is only a measurement. An SLI interprets measurements as user-visible reliability. For availability, the team divides successful eligible requests by all eligible requests. If 999,500 of 1,000,000 checkout requests are good, availability is 99.95 percent. For latency, the team first defines a good experience, such as `latency <= 300 ms`, then divides requests meeting that condition by all eligible requests. If 992,000 of 1,000,000 requests meet it, latency compliance is 99.2 percent.

The interpretation is the important step. Raw latency values become good or bad user experiences only after the team defines eligibility and the acceptable condition.

Application Signals sends standard application metrics to the `ApplicationSignals` namespace in CloudWatch. The three core metrics to understand are **Latency**, **Fault**, and **Error**.

| Metric | Simple meaning | How the checkout team reads it |
|---|---|---|
| **Latency** | The delay before data transfer begins after a request is made. | `POST /checkout` has p99 latency of 1.9 seconds, so the slowest customers are waiting too long. |
| **Fault** | HTTP 5xx server-side faults and OpenTelemetry span status errors. | The service or dependency is failing in a way the application owns. |
| **Error** | HTTP 4xx client-side errors. | Customers or clients are sending invalid requests, missing auth, or hitting validation rules. |

AWS documents an important availability detail: the Application Signals dashboard availability calculation is `(1 - Faults / Total) * 100`. Total responses come from the sample count of latency, and HTTP 4xx responses count as successful for Application Signals availability because they are treated as request errors rather than service faults.

That means a 404 from a mistyped product URL stays outside the service availability failure count. A 500 from `POST /checkout` spends the availability budget. This distinction matters in real systems because 4xx spikes can come from bots, expired sessions, or invalid form submissions. Those deserve investigation, while paging the service owner should focus on server-side faults that hurt the checkout platform.

Application Signals uses SLOs to turn these measurements into health. After you create SLOs, the Services, Service detail, and Application Map pages can show whether service level indicators are healthy. The team moves from "latency looks high on a chart" to "the checkout latency SLO is unhealthy and budget is burning."

## How Do SLOs Create Error Budgets and Burn Rates?
<!-- section-summary: An SLO turns an SLI into a target over time, and the error budget tells the team how much unreliability remains before the target is missed. -->

A **service level objective**, or **SLO**, is a target for an SLI over a time window. It says what good enough means for a service. For example, the checkout team might choose:

* **Availability SLO**: 99.9% of `POST /checkout` requests should be successful over a rolling 30-day interval.
* **Latency SLO**: 99% of `POST /checkout` requests should complete within 800 milliseconds over a rolling 30-day interval.

The exact numbers should come from user experience, business risk, and historical performance. A public checkout endpoint usually deserves stricter targets than an internal report export. A team should also avoid turning every minor operation into a page-worthy SLO. Too many SLOs create noise, and noise trains responders to ignore the system.

AWS supports **period-based** and **request-based** SLOs.

| SLO type | How AWS evaluates it | Useful example |
|---|---|---|
| **Period-based SLO** | The time window is divided into periods. Each period passes or fails. Attainment is good periods divided by total periods. | Every 1-minute period should have p99 checkout latency under 800 ms. |
| **Request-based SLO** | Good requests are divided by total requests during the interval. | 99.9% of checkout requests should avoid server-side faults. |

An **error budget** is the amount of bad behavior the service can still have while meeting the SLO. If the checkout team sets a 99.9% monthly availability SLO, the remaining 0.1% is the budget for faults. If the service burns that budget quickly after a deployment, the team has evidence to slow down releases and fix reliability instead of debating opinions.

For ten million eligible requests, a 0.1 percent budget permits approximately 10,000 bad requests while still meeting a 99.9 percent objective. The point is not to celebrate failures. It is to avoid pretending that cost-free, risk-free 100 percent reliability is attainable, and to make the trade-off between change velocity and reliability explicit.

Burn rate gives the budget an operating speed. If the allowed bad rate is 0.1 percent and the current bad rate is 1 percent, the service burns budget at roughly `1 / 0.1 = 10` times the sustainable rate. If that rate continued, a 30-day budget would be consumed in roughly three days. AWS documents burn-rate configurations and alarms, including multi-window strategies. A severe short event may justify immediate paging, while a smaller problem sustained over days still needs planned action.

![The error-budget visual shows how availability or latency misses consume the budget that protects user experience](/content-assets/articles/article-cloud-providers-aws-observability-application-signals-and-slos/slo-error-budget.png)

*The error-budget visual shows how availability or latency misses consume the budget that protects user experience.*



## How Should You Design Availability and Latency SLOs?
<!-- section-summary: AWS recommends both latency and availability SLOs for critical applications, and real teams usually start with the user journeys that matter most. -->

AWS recommends setting both **latency** and **availability** SLOs on critical applications. That recommendation matches how customers experience a service. A checkout request that returns 200 after 12 seconds still hurts the customer. A checkout request that returns 500 quickly also hurts the customer. One SLO catches slowness. The other catches failure.

For the checkout system, a reasonable first set might look like this:

| User journey | SLI | First SLO target | Why this target matters |
|---|---|---|---|
| Submit checkout | Availability | 99.9% request-based availability over 30 days | Failed checkout directly blocks revenue. |
| Submit checkout | Latency | 99% of requests under 800 ms over 30 days | Slow checkout increases abandonment even when it succeeds. |
| Authorize payment dependency | Availability | 99.5% dependency availability over 30 days | The team needs to see provider pain separately from service code pain. |
| Load order details | Latency | p95 under 500 ms over 30 days | This is customer-facing, but less critical than payment submission. |

The first version should be realistic. If the current p99 checkout latency is usually 1.4 seconds, setting an 800 ms SLO on day one will mark the service unhealthy immediately. That can still be useful as an improvement target, while paging should wait until the service has been engineered to meet it. Many teams start with an achievable target based on recent production history, then tighten it after performance work.

There is also a naming detail that saves time during incidents. AWS recommends including the service or operation name and keywords such as latency or availability in the SLO name. A name like `checkout-post-availability-prod` gives responders more context than `slo-17`.

Finally, keep SLOs close to ownership. The checkout team can own `orders-api POST /checkout` availability. A platform team might own a shared ingress SLO. A third-party dependency might need a dependency SLO so the service owner can explain that checkout is unhealthy because payment authorization is failing outside the service boundary.

### How Do You Create an SLO in Practice?
<!-- section-summary: Teams can create SLOs through the CloudWatch console, CLI, or infrastructure as code once the service has reported standard metrics. -->

Before creating an SLO on a service operation discovered by Application Signals, the operation must have reported standard metrics. This detail surprises teams during early setup. If `POST /checkout` has received no traffic since instrumentation was enabled, it may stay out of the selector until a real or test request produces telemetry.

The CLI can confirm that Application Signals sees the operation before the team creates an SLO for it:

```bash
aws application-signals list-service-operations \
  --start-time 1781172000 \
  --end-time 1781175600 \
  --key-attributes Environment=ecs:prod-checkout,Name=orders-api,Type=Service \
  --query 'ServiceOperations[].{Operation:Name,MetricTypes:MetricReferences[].MetricType}' \
  --output json
```

Example output:

```json
[
  {
    "Operation": "POST /checkout",
    "MetricTypes": [
      "LATENCY",
      "FAULT",
      "ERROR"
    ]
  },
  {
    "Operation": "GET /cart",
    "MetricTypes": [
      "LATENCY",
      "FAULT",
      "ERROR"
    ]
  }
]
```

The output proves two things. `POST /checkout` is the operation name Application Signals discovered, and the standard latency, fault, and error metrics exist for that operation. If the output only shows `POST /api` or a different environment, the SLO should use that exact discovered identity or the instrumentation should be fixed before the target is created.

In the console, the usual path looks like this:

1. Open **CloudWatch**.
2. Choose **Service Level Objectives (SLO)**.
3. Choose **Create SLO**.
4. Choose **Service** as the SLI type.
5. Select the account, service, operation, or dependency.
6. Choose **Availability** or **Latency**.
7. Choose **Periods** or **Requests** as the calculation method.
8. Set the interval, attainment goal, optional burn rates, optional alarms, warning threshold, exclusions, and tags.

For infrastructure as code, AWS provides the `AWS::ApplicationSignals::ServiceLevelObjective` CloudFormation resource. The following example shows the shape of a period-based latency SLO for `POST /checkout`. The service name and environment must match the names Application Signals sees from the instrumented application.

```yaml
Resources:
  CheckoutLatencySlo:
    Type: AWS::ApplicationSignals::ServiceLevelObjective
    Properties:
      Name: checkout-post-latency-prod
      Description: p99 latency target for the production checkout operation.
      Sli:
        SliMetric:
          KeyAttributes:
            Type: Service
            Name: orders-api
            Environment: ecs:prod-checkout
          OperationName: POST /checkout
          MetricType: LATENCY
          Statistic: p99
          PeriodSeconds: 60
        MetricThreshold: 800
        ComparisonOperator: LessThanOrEqualTo
      Goal:
        Interval:
          RollingInterval:
            DurationUnit: DAY
            Duration: 30
        AttainmentGoal: 99.0
        WarningThreshold: 95.0
      BurnRateConfigurations:
        - LookBackWindowMinutes: 60
        - LookBackWindowMinutes: 360
      Tags:
        - Key: service
          Value: checkout
        - Key: environment
          Value: production
```

The important parts are easy to read after you know the vocabulary:

* `KeyAttributes` identifies the Application Signals service.
* `OperationName` scopes the SLO to a specific operation.
* `MetricType` chooses `LATENCY` or `AVAILABILITY`.
* `Statistic` and `MetricThreshold` define what counts as a good period for latency.
* `Goal` defines the rolling window and the target attainment.
* `BurnRateConfigurations` gives CloudWatch windows for budget consumption calculations.

AWS also supports SLOs on CloudWatch metrics and metric math, RUM app monitors, Synthetics canaries, and composite SLOs across multiple operations. That matters because some reliability targets live outside one service operation. Article 6 uses those canary and RUM SLO paths for user-facing checks.

After the SLO exists, inspect the saved definition instead of trusting memory from the console form:

```bash
aws application-signals get-service-level-objective \
  --id arn:aws:application-signals:us-east-1:123456789012:slo/checkout-post-latency-prod \
  --query 'Slo.{Name:Name,Evaluation:EvaluationType,Goal:Goal,Sli:Sli}' \
  --output json
```

Example output:

```json
{
  "Name": "checkout-post-latency-prod",
  "Evaluation": "PeriodBased",
  "Goal": {
    "Interval": {
      "RollingInterval": {
        "DurationUnit": "DAY",
        "Duration": 30
      }
    },
    "AttainmentGoal": 99.0,
    "WarningThreshold": 95.0
  },
  "Sli": {
    "SliMetric": {
      "KeyAttributes": {
        "Type": "Service",
        "Name": "orders-api",
        "Environment": "ecs:prod-checkout"
      },
      "OperationName": "POST /checkout",
      "MetricType": "LATENCY",
      "Statistic": "p99",
      "PeriodSeconds": 60
    },
    "MetricThreshold": 800,
    "ComparisonOperator": "LessThanOrEqualTo"
  }
}
```

This output is the contract the alarm and dashboard will follow. The service is `orders-api`, the environment is `ecs:prod-checkout`, the operation is `POST /checkout`, and a good 60-second period has p99 latency at or below 800 milliseconds. During an incident, this saved definition keeps the team from investigating the wrong service name, environment label, or operation.

## How Do You Investigate an Unhealthy Service?
<!-- section-summary: The operational workflow starts at SLO health, drills into service details, and then follows correlated traces, logs, metrics, canaries, and client pages. -->

Now let us put the pieces into an incident path.

It is 10:15 UTC. A deployment finished at 10:02. The checkout SLO page shows `checkout-post-latency-prod` in warning, and the burn rate is high. The team opens the SLO, then opens the service detail page for `orders-api`.

The first useful question is **which operation is unhealthy**. The service operations tab shows that `POST /checkout` latency is high, while `GET /cart` and `GET /orders/{id}` remain healthy. That narrows the response from "orders service is bad" to "checkout submission is slow."

The second question is **which dependency changed the timing**. The dependencies tab shows that the payment authorization dependency has p99 latency near 2 seconds, while DynamoDB and SQS remain normal. The service overview also shows recent change events, giving responders context about the deployment that happened minutes earlier.

The third question is **which evidence explains the slow path**. The service detail page can correlate operation metrics with X-Ray traces, Container Insights, application logs, standard metrics, runtime metrics, and custom metrics. The responder selects a high-latency data point, opens the traces and logs for that point, and sees a new retry loop around payment authorization.

The fourth question is **whether the SLO page and the raw metrics agree**. Application Signals still writes CloudWatch metrics, so responders can check the same time window in Metrics Explorer or with a metric query. The goal is to confirm the operation name, service name, environment, and time range before the team argues about cause.

```sql
SELECT AVG(Latency)
FROM SCHEMA("ApplicationSignals", Service, Operation, Environment)
WHERE Service = 'orders-api'
  AND Operation = 'POST /checkout'
  AND Environment = 'ecs:prod-checkout'
GROUP BY Operation
```

Example result for the same time window:

```console
Operation        AVG(Latency)
POST /checkout  1.87
```

The query uses the same three labels that the SLO uses: service, operation, and environment. If the result is empty, the time window, label names, or instrumentation rollout need review. If the result shows high latency while the SLO stays healthy, the SLO definition may point at a narrower path than the metric query. That usually means the instrumentation names changed, one runtime missed the rollout, or a new deployment emitted a different service identity.

AWS also documents CloudWatch investigations from Application Signals SLOs. From the SLO page, a responder can select an SLO metric and choose **Investigate** from the action menu, or use the AI icon in the visualization. Engineering judgment still leads the response, and the investigation workspace keeps the team anchored to the metric and time window that actually triggered concern.

A strong incident workflow usually follows this order:

1. **SLO health** shows which customer promise is at risk.
2. **Service detail** shows the unhealthy operation or dependency.
3. **Traces** show the slow or failing request path.
4. **Logs** show exact application errors for that path.
5. **Related metrics** show whether the cause is local resource pressure, runtime behavior, or dependency behavior.
6. **Canaries and RUM** show whether the problem is visible from outside the service or inside real user sessions.

This is the bridge from telemetry to operations. The team starts with the user-facing promise, then drills down into the evidence.

![The investigation flow connects an unhealthy SLO to service operations, traces, logs, dependencies, and release evidence](/content-assets/articles/article-cloud-providers-aws-observability-application-signals-and-slos/slo-investigation-flow.png)

*The investigation flow connects an unhealthy SLO to service operations, traces, logs, dependencies, and release evidence.*


## How Does the Complete Service-Health Model Fit Together?
<!-- section-summary: Application Signals turns raw telemetry into service health, while SLOs turn service health into explicit reliability targets. -->

Application Signals is the part of CloudWatch that helps an application team stop thinking in disconnected telemetry names and start thinking in services, operations, dependencies, and customer promises.

The checkout team now has a cleaner operational path:

* **OpenTelemetry and ADOT** collect traces and metrics from the application runtime.
* **CloudWatch agent or Lambda instrumentation** sends the telemetry into AWS.
* **Application Signals** discovers services, operations, and dependencies.
* **Services, Service detail, and Application Map** show operational health in the language the team uses during incidents.
* **Standard metrics** such as latency, fault, and error feed SLIs.
* **SLOs** define the reliability and latency targets for critical behavior.
* **Error budgets and burn rates** show whether the team is consuming reliability faster than planned.
* **Investigations, traces, logs, and related metrics** help responders explain an unhealthy SLO.


The important production habit is to create SLOs for the journeys that matter most. Checkout submission, payment authorization, login, signup, and order lookup are good candidates. Internal dashboards, admin exports, and batch jobs usually need different targets or simple dashboards without a paging SLO.

Once services have SLOs, the next visibility gap is the customer's actual path. A service can look healthy from inside AWS while the public checkout page is broken by a JavaScript error, a CDN problem, or a regional network issue. That is why the next article moves from service health to **CloudWatch Synthetics** and **CloudWatch RUM**.

## Check Your Answers
<!-- section-summary: Application Signals organizes application telemetry into health signals, while SLIs and SLOs turn those signals into explicit user-facing reliability decisions. -->

The conceptual hierarchy is:

```text
Business expectation
       |
       v
SLO: acceptable target
       |
       v
SLI: user-oriented measurement
       |
       v
Application Signals: services, operations, dependencies, health
       |
       v
Telemetry: metrics, traces, logs
       |
       v
Application requests
```

The purpose is not to collect more telemetry. It is to turn events into structure, structure into signals, signals into user-oriented indicators, indicators into objectives, and objectives into decisions.

:::expand[Why Is One Trace Not Enough to Measure Service Health?]{kind="recap"}
Tracing explains individual requests, but production operations need a service-level view of customer-facing health.

A trace is a diagnostic representation of one request. A production service may handle millions of requests, so overall health needs aggregated latency, traffic, and outcomes. Signals reveal where health changed; traces and logs explain why.
:::

:::expand[What Does Application Signals Add?]{kind="recap"}
Application Signals uses application telemetry to discover services, show operational health, and connect service views to SLOs, canaries, RUM, logs, metrics, and traces.

It uses application telemetry to discover services, their operations, and their dependencies, then organizes latency, faults, errors, availability, traces, logs, canaries, and client views around that application vocabulary.

Application Signals breaks application behavior into services, the operations they serve, and the dependencies they call.

A service is an independently observable application component. An operation is meaningful work that it handles. A dependency is something it calls. Operation-level health is often more useful than one service-wide average because critical low-volume work can otherwise be hidden.
:::

:::expand[Why Must Instrumentation Run With the Application?]{kind="recap"}
Enabling Application Signals depends on the runtime platform, but the common pattern is ADOT instrumentation plus the CloudWatch agent or Lambda layer.

External infrastructure metrics can measure CPU or memory but cannot infer that one route called a dependency or how long it waited. Instrumentation observes inbound and outbound application work and supplies the semantic service, operation, and dependency context.
:::

:::expand[How Do Metrics Become Service Level Indicators?]{kind="recap"}
Application Signals collects latency, fault, and error metrics, and uses these metrics to power SLI health.

A metric is a measurement such as latency or fault count. An SLI interprets measurements as user experience, such as the fraction of eligible requests that succeeded or completed within a stated latency boundary.
:::

:::expand[How Do SLOs Create Error Budgets and Burn Rates?]{kind="recap"}
An SLO turns an SLI into a target over time, and the error budget tells the team how much unreliability remains before the target is missed.

An SLO sets the required SLI attainment over a time window. The gap between that target and 100 percent is the allowed error budget. Burn rate shows how quickly current bad behavior is consuming that allowance relative to a sustainable rate.

Name a user-visible operation, choose the reliability dimension, define eligible events, define good behavior, set the target and time window, choose request or period evaluation, and decide how the error budget will change engineering behavior.
:::

:::expand[How Should You Design Availability and Latency SLOs?]{kind="recap"}
AWS recommends both latency and availability SLOs for critical applications, and real teams usually start with the user journeys that matter most.

Availability asks whether the operation worked. Latency asks whether it worked quickly enough. A service can return every response after 45 seconds or answer very quickly while failing 40 percent of requests, so either objective alone is incomplete.

Teams can create SLOs through the CloudWatch console, CLI, or infrastructure as code once the service has reported standard metrics.
:::

:::expand[How Do You Investigate an Unhealthy Service?]{kind="recap"}
The operational workflow starts at SLO health, drills into service details, and then follows correlated traces, logs, metrics, canaries, and client pages.

Start with the customer promise, identify the service and operation, determine whether latency or availability failed, compare dependencies, open representative traces, find the responsible span, and use correlated logs and runtime metrics to test the explanation.
:::

:::expand[How Does the Complete Service-Health Model Fit Together?]{kind="recap"}
Application Signals turns raw telemetry into service health, while SLOs turn service health into explicit reliability targets.

A request-based SLO measures the fraction of individual requests that were good. A period-based SLO divides time into windows and measures the fraction of windows whose aggregate condition passed. They describe different reliability promises and must be chosen intentionally.

Requests generate telemetry. Application Signals aggregates it into services, operations, dependencies, and standard health signals. SLIs interpret those signals as user experience. SLOs define acceptable experience, while budgets and burn rates guide response and release decisions.
:::

## References

* [Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Monitoring-Sections.html) - AWS overview of Application Signals features, supported regions, supported languages, and integrations with RUM, Synthetics, AppRegistry, and EC2 Auto Scaling.
* [Supported systems](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-supportmatrix.html) - Current AWS support matrix for Application Signals platforms, languages, runtime versions, and known runtime issues.
* [Enable your applications on Amazon EKS clusters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-EKS.html) - AWS setup path for enabling workloads through the CloudWatch Observability EKS add-on and Kubernetes annotations.
* [Enable your applications on Amazon ECS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-ECSMain.html) - AWS setup path for ECS sidecar and daemon strategies.
* [Enable your applications on Amazon EC2](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-EC2Main.html) - AWS setup path for the CloudWatch agent, ADOT instrumentation, and EC2 permissions.
* [Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html) - AWS setup path for Lambda Application Signals, the AWS Lambda Layer for OpenTelemetry, execution wrapper, and IAM policy.
* [Monitor operational health with Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Services.html) - AWS explanation of how Services, Service detail, Application Map, SLOs, canaries, RUM, and AppRegistry contribute to operational health.
* [Services page](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Services-page.html) - AWS details for service fleet health, filtering, SLI status, audit findings, and change events.
* [Service detail page](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ServiceDetail.html) - AWS details for operations, dependencies, canaries, client pages, logs, traces, and related metrics.
* [Metrics collected by Application Signals](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AppSignals-MetricsCollected.html) - AWS definitions for latency, fault, error, availability, and Application Signals dimensions.
* [Service level objectives (SLOs)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-ServiceLevelObjectives.html) - AWS guidance for latency and availability SLOs, period-based and request-based evaluation, burn rates, alarms, app monitor SLOs, canary SLOs, and composite SLOs.
* [AWS::ApplicationSignals::ServiceLevelObjective](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-applicationsignals-servicelevelobjective.html) - CloudFormation reference for defining SLOs as infrastructure as code.
* [Application Signals examples using AWS CLI](https://docs.aws.amazon.com/cli/v1/userguide/cli_application-signals_code_examples.html) - AWS CLI examples for listing services, service operations, and service level objectives.
* [Create an investigation from an Application Signals SLO](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Investigations-CreateInvestigation-SLO.html) - AWS steps for starting a CloudWatch investigation from an SLO metric.
