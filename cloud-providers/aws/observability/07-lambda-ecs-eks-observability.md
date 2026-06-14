---
title: "Lambda / ECS / EKS Observability"
description: "Observe Lambda functions, ECS services, and EKS workloads with CloudWatch Logs, metrics, Lambda Insights, Container Insights, agents, and OpenTelemetry."
overview: "AWS compute workloads all emit telemetry, but each runtime has a different starting point. This article follows one production checkout system across Lambda, ECS, and EKS so you can see what to enable, what to query, and how teams connect logs, metrics, and traces during incidents."
tags: ["lambda", "ecs", "eks", "cloudwatch", "container-insights", "observability", "aws"]
order: 7
id: article-cloud-providers-aws-observability-lambda-ecs-eks-observability
---

## Table of Contents

1. [One Checkout Flow, Three Compute Shapes](#one-checkout-flow-three-compute-shapes)
2. [Lambda Observability](#lambda-observability)
3. [Lambda Insights and Tracing](#lambda-insights-and-tracing)
4. [ECS Observability](#ecs-observability)
5. [ECS Container Insights](#ecs-container-insights)
6. [EKS Observability](#eks-observability)
7. [EKS Add-ons, Agents, and OpenTelemetry](#eks-add-ons-agents-and-opentelemetry)
8. [Correlating Logs, Metrics, and Traces](#correlating-logs-metrics-and-traces)
9. [Production Checklist](#production-checklist)
10. [What's Next](#whats-next)

## One Checkout Flow, Three Compute Shapes
<!-- section-summary: The same customer request can cross Lambda, ECS, and EKS, so observability has to follow the workload shape instead of assuming one setup fits everything. -->

Imagine a production checkout system. The customer clicks **Place order**, an **ECS** service called `orders-api` receives the HTTP request, an **EKS** deployment called `inventory-worker` reserves stock, and a **Lambda** function called `receipt-renderer` creates a PDF receipt. One customer action crossed three compute models in a few seconds.

This is a normal AWS production shape. **Lambda** runs code in managed execution environments, **ECS** runs containers as tasks inside services, and **EKS** runs Kubernetes pods inside a managed Kubernetes control plane. Each platform can write logs, publish metrics, and send traces, but the setup details differ because AWS manages different parts of the runtime for each one.

Here is the shape we will use through the article:

| Runtime | Concrete workload | First telemetry you expect | Extra telemetry real teams usually add |
|---|---|---|---|
| **Lambda** | `receipt-renderer` function | CloudWatch Logs, Lambda service metrics | Lambda Insights, JSON logging controls, X-Ray or OpenTelemetry tracing |
| **ECS** | `orders-api` service on Fargate | Container logs through `awslogs`, ECS service metrics | Container Insights with enhanced observability, FireLens for routing, ADOT for app telemetry |
| **EKS** | `inventory-worker` deployment | Kubernetes events and pod logs if collected | CloudWatch Observability add-on, OTel Container Insights, CloudWatch agent, Fluent Bit, ADOT |

The important idea is simple: **observability starts with the runtime boundary**. Lambda already knows about invocations, duration, errors, throttles, and memory. ECS knows about clusters, services, tasks, and containers. EKS knows about Kubernetes objects such as namespaces, pods, deployments, nodes, and DaemonSets. A good setup respects those native shapes, then adds a shared trace ID and shared log fields so one checkout can be followed across all of them.

![Three runtime shapes showing Lambda, ECS, and EKS connected to logs, metrics, traces, and runtime health](/content-assets/articles/article-cloud-providers-aws-observability-lambda-ecs-eks-observability/three-runtime-shapes.png)

*The image shows the shared goal across different compute models. Lambda, ECS, and EKS all need logs, metrics, traces, and runtime health, but each runtime exposes them through a different setup path.*

We will start with Lambda because it gives the most managed experience. AWS runs the host, the runtime lifecycle, and the scaling path, so your first job is to read the signals Lambda already emits and then add the missing detail.

## Lambda Observability
<!-- section-summary: Lambda gives every invocation logs and metrics, but production troubleshooting depends on structured logs, execution-role permissions, and focused Logs Insights queries. -->

An **invocation** is one attempt to run a Lambda function handler. The handler is the function in your code that Lambda calls when an event arrives. For `receipt-renderer`, one invocation might receive an order ID, fetch order details, create a PDF, write the PDF to S3, and return a receipt URL.

Lambda sends function logs to **CloudWatch Logs** by default when the execution role has the right permissions. An **execution role** is the IAM role Lambda assumes while running your function. For CloudWatch Logs delivery, that role needs `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents`; the AWS managed policy `AWSLambdaBasicExecutionRole` provides those write permissions.

By default, Lambda writes logs to a log group named `/aws/lambda/<function-name>`. Each execution environment writes to a log stream, and a scaled-out function can have many streams at the same time. AWS also writes platform lines such as `START`, `END`, and `REPORT`, and the `REPORT` line includes details such as duration, billed duration, configured memory, maximum memory used, and initialization duration.

A responder usually starts with the log group:

```bash
aws logs tail /aws/lambda/receipt-renderer --since 30m --follow
```

That command is useful during a live incident, but production teams move quickly to **CloudWatch Logs Insights** because it can query many events and many streams together. A basic Lambda investigation query looks like this:

```sql
fields @timestamp, @requestId, @duration, @maxMemoryUsed, @message
| filter @type = "REPORT" or @message like /ERROR|Task timed out|AccessDenied/
| sort @timestamp desc
| limit 50
```

This query mixes two useful views. The `REPORT` events show runtime facts such as duration and memory, while the message filter catches application failures and AWS SDK errors. If `receipt-renderer` suddenly slows down, the team can check whether duration rose, memory hit the ceiling, or the code started logging S3 `AccessDenied` errors.

Modern Lambda logging also supports **advanced logging controls**. That means you can choose plain text or structured JSON, set application and system log levels, and choose a custom log group. JSON logs matter because they let you query fields such as `orderId`, `customerId`, `traceId`, and `paymentAttemptId` instead of searching raw text.

```bash
aws lambda update-function-configuration \
  --function-name receipt-renderer \
  --logging-config LogFormat=JSON,ApplicationLogLevel=INFO,SystemLogLevel=WARN
```

With JSON logging enabled, application log entries can carry the exact fields responders need:

```json
{
  "level": "ERROR",
  "message": "receipt upload failed",
  "service": "receipt-renderer",
  "orderId": "ord-1042",
  "traceId": "1-667af5a1-4b8c2c6d1c9f7b4a6d2e9f01",
  "bucket": "prod-checkout-receipts",
  "errorType": "AccessDenied"
}
```

This gives you the first Lambda layer: logs and service metrics. Lambda service metrics in CloudWatch cover invocation counts, errors, throttles, duration, concurrency, asynchronous delivery failures, and event source mapping behavior. Those metrics answer broad questions such as "did the function fail more often?" and "did Lambda throttle invocations?" The logs answer the next question: "which order failed, and why?"

Sometimes the broad metrics and the application logs still leave a gap. If the function spends more time initializing, uses more memory than expected, or struggles with network calls, the team needs deeper runtime telemetry. That is where Lambda Insights and tracing fit.

## Lambda Insights and Tracing
<!-- section-summary: Lambda Insights adds runtime performance detail, while tracing links the function invocation to the upstream and downstream request path. -->

**Lambda Insights** is a CloudWatch feature for troubleshooting Lambda runtime performance. It uses a Lambda extension delivered as a Lambda layer. A **Lambda extension** is code that runs beside your function inside the Lambda execution environment, and a **layer** is the packaging mechanism that adds shared code or tools to a function.

When Lambda Insights runs, it collects system-level metrics such as CPU time, memory, disk, and network usage. It also collects diagnostic details such as cold starts and worker shutdowns. For every invocation, the extension emits a performance log event, and CloudWatch extracts metrics from those embedded metric format events. AWS documents one important runtime caveat: the Lambda Insights agent is supported on Lambda runtimes that use Amazon Linux 2 and Amazon Linux 2023.

In infrastructure as code, the moving parts look like this:

```yaml
Resources:
  ReceiptRenderer:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: receipt-renderer
      Policies:
        - AWSLambdaBasicExecutionRole
        - CloudWatchLambdaInsightsExecutionRolePolicy
      Layers:
        - !Sub "arn:aws:lambda:${AWS::Region}:580247275435:layer:LambdaInsightsExtension:<current-version>"
      Tracing: Active
```

The exact Lambda Insights layer version changes over time, so teams usually pin the current version from the AWS Lambda Insights extension version table instead of copying an old example forever. The IAM policy is the other required piece because the extension writes its own performance log events.

**Tracing** answers a different question. Logs show events inside the function. Metrics show aggregate behavior. A trace shows how one request moved through multiple services. If `orders-api` called `receipt-renderer` through an event and the receipt function then wrote to S3, the trace connects those operations into one request path.

Lambda supports two X-Ray tracing modes:

| Mode | What Lambda does | Production use |
|---|---|---|
| **Active** | Lambda creates trace segments for sampled invocations and sends them to X-Ray | Good default for important functions in request paths |
| **PassThrough** | Lambda propagates upstream tracing context and sends traces only when another service already sampled the request | Useful when upstream services own sampling decisions |

A team can enable active tracing with the Lambda API:

```bash
aws lambda update-function-configuration \
  --function-name receipt-renderer \
  --tracing-config Mode=Active
```

The function execution role needs permission to send trace data. When tracing is enabled through the Lambda console, AWS can add the needed permissions. For infrastructure as code, teams usually attach the documented X-Ray write policy or an equivalent least-privilege policy.

For new application instrumentation, AWS now points teams toward **OpenTelemetry**. OpenTelemetry is the common open standard for emitting traces, metrics, and logs. AWS Distro for OpenTelemetry, usually called **ADOT**, packages OpenTelemetry components for AWS. AWS X-Ray SDKs and the X-Ray daemon entered maintenance mode on February 25, 2026, with AWS recommending migration to OpenTelemetry-based instrumentation for new tracing work.

That gives Lambda a clear production path: CloudWatch Logs for invocation detail, Lambda service metrics for health, Lambda Insights for runtime performance, and tracing for request flow. The next runtime, ECS, has the same goals, but the units change from invocations to containers and tasks.

## ECS Observability
<!-- section-summary: ECS observability starts with task logs and service metrics, then adds task-level and container-level detail for real production debugging. -->

**Amazon ECS** runs containers as **tasks**. A task is one running copy of a task definition, and a task definition is the JSON blueprint that describes containers, CPU, memory, networking, environment variables, and log configuration. A **service** keeps the desired number of tasks running and replaces failed tasks.

For our checkout system, `orders-api` runs as an ECS service on Fargate. A customer request enters the service through an Application Load Balancer, the container writes JSON logs to standard output, and the task definition sends those logs to CloudWatch Logs.

The basic ECS log setup uses the `awslogs` log driver:

```json
{
  "containerDefinitions": [
    {
      "name": "orders-api",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/orders-api:2026-06-11",
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/aws/ecs/orders-api/application",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "orders"
        }
      }
    }
  ]
}
```

The log stream prefix matters during incidents because ECS includes the container name and task ID in the stream name. When `orders-api` has one crashing task among twenty healthy tasks, the task ID links container logs to service events, task metadata, deployment history, and Container Insights metrics.

For higher-volume or multi-destination logging, ECS teams often use **FireLens**. FireLens is the ECS log routing integration for Fluent Bit or Fluentd. It lets a task route application logs to CloudWatch Logs, Firehose, or supported partner destinations without baking log shipping code into the application container. A practical pattern is simple: keep `awslogs` for ordinary services, then use FireLens when the team needs custom parsing, buffering, enrichment, or multiple destinations.

The first Logs Insights query for `orders-api` usually filters by service fields:

```sql
fields @timestamp, level, service, route, orderId, traceId, message
| filter service = "orders-api"
| filter level in ["ERROR", "WARN"] or message like /timeout|throttle|connection reset/
| sort @timestamp desc
| limit 100
```

This query assumes the application writes JSON logs. If the service still writes plain text, responders end up searching strings and guessing which order, customer, task, or request produced the line. Structured logs turn each container into a searchable event source.

ECS also sends ordinary CloudWatch metrics for cluster and service health, but those metrics stay fairly high level. When an incident depends on a single task using too much memory, one container restarting, or one deployment creating noisy task churn, the team needs Container Insights.

## ECS Container Insights
<!-- section-summary: Container Insights with enhanced observability adds cluster, service, task, and container detail so ECS incidents can be debugged at the right level. -->

**Container Insights** is a CloudWatch feature that collects, aggregates, and summarizes metrics and logs from containerized applications. For ECS, the current AWS guidance points teams toward **Container Insights with enhanced observability** because it adds more task and container detail than the original Container Insights setup.

Enhanced observability uses the `containerInsights` setting value `enhanced`. The account setting controls new clusters, and the cluster setting updates existing clusters:

```bash
aws ecs put-account-setting \
  --name containerInsights \
  --value enhanced \
  --principal-arn arn:aws:iam::123456789012:root

aws ecs update-cluster-settings \
  --cluster prod-checkout \
  --settings name=containerInsights,value=enhanced
```

The account-wide command matters because `put-account-setting` without the root principal applies only to the currently authenticated IAM principal. In real accounts, platform teams usually set the account default through their provisioning workflow, then explicitly update older clusters.

Container Insights metrics for ECS live in the `ECS/ContainerInsights` namespace. The normal incident path changes after it is enabled. Instead of asking only "is the service CPU high?", the responder can ask "which task is high?", "which container inside the task is high?", "did the deployment start a replacement loop?", and "did the task stop because of memory pressure?"

Here is a practical ECS incident loop for `orders-api`:

1. CloudWatch alarm fires on high p95 latency or elevated HTTP 5xx from the load balancer.
2. ECS service events show that deployment `orders-api:2026-06-11` started ten minutes before the alarm.
3. Container Insights shows that only the new task revision has rising memory use.
4. CloudWatch Logs for the matching task ID show repeated `OutOfMemoryError` lines after large cart checkouts.
5. The team rolls back the ECS service to the previous task definition while they fix the memory regression.

For ECS clusters on EC2 instances, AWS also documents an ECS agent version requirement for Container Insights setup. EC2-backed clusters should run a current ECS-optimized AMI and a modern ECS agent. Fargate removes that host-maintenance step, but the task definition still needs proper log configuration for application logs.

Container Insights gives ECS strong infrastructure visibility, and application traces sit beside it. For a service such as `orders-api`, teams commonly add ADOT as a sidecar or collector path so the application can emit OpenTelemetry traces to X-Ray or another backend. The infrastructure view tells you which task hurt; the trace tells you which downstream call hurt inside the request.

![Container Insights view showing cluster, node, task, pod, CPU, memory, restart, network, and logs](/content-assets/articles/article-cloud-providers-aws-observability-lambda-ecs-eks-observability/container-insights-view.png)

*Container Insights adds the runtime layer that service metrics often miss. The team can move from cluster health to node, task, pod, CPU, memory, restarts, network, and logs.*

Now the same checkout flow moves into EKS, where the container unit changes again. ECS tasks map neatly to AWS task metadata, while EKS adds Kubernetes objects and a cluster control plane.

## EKS Observability
<!-- section-summary: EKS observability has to cover Kubernetes objects, node behavior, pod logs, control plane signals, and application telemetry together. -->

**Amazon EKS** is AWS's managed Kubernetes service. Kubernetes schedules containers inside **pods**, groups pods with **deployments**, places pods on **nodes**, and organizes resources into **namespaces**. A **DaemonSet** runs one pod on each selected node, which makes it a common pattern for log and metric collectors.

Our checkout system uses an EKS deployment called `inventory-worker` in the `checkout` namespace. It consumes queue messages, checks stock records, and calls a warehouse API. When the worker slows down, the team needs to know whether the problem sits in the application, the pod, the node, the Kubernetes scheduler, or a downstream service.

That creates a wider observability surface than Lambda or ECS:

| EKS layer | What responders inspect | Example question |
|---|---|---|
| **Application** | JSON logs, traces, custom metrics | Which order reservation failed? |
| **Pod** | Restarts, CPU, memory, network, container logs | Did one pod crash or restart repeatedly? |
| **Node** | Node CPU, memory, disk, kubelet health | Did the node run out of allocatable memory? |
| **Cluster** | Namespace, deployment, service, scheduling signals | Did a rollout create pending pods? |
| **Control plane** | API server, audit, scheduler, authenticator logs when enabled | Did Kubernetes reject or throttle changes? |

Kubernetes writes container logs on nodes, but CloudWatch needs an agent or collector to ship and enrich those logs. Without that collection path, the team may see pods failing in `kubectl` while the central log system stays quiet. In production, that gap causes slow handoffs between platform and application teams.

A useful EKS log query includes Kubernetes metadata:

```sql
fields @timestamp, kubernetes.namespace_name, kubernetes.pod_name, kubernetes.container_name, log
| filter kubernetes.namespace_name = "checkout"
| filter log like /ERROR|timeout|reservation failed/
| sort @timestamp desc
| limit 100
```

The Kubernetes fields let responders filter by namespace, pod, and container instead of searching a raw stream of text. When the application includes `traceId` and `orderId`, the same query can narrow from "the checkout namespace is noisy" to "order `ord-1042` failed in pod `inventory-worker-7d9c...`."

EKS can also publish Kubernetes metrics into CloudWatch through Container Insights. The setup path matters because AWS currently documents several choices, and the preferred path has changed as OpenTelemetry support matured.

## EKS Add-ons, Agents, and OpenTelemetry
<!-- section-summary: The current EKS path uses the CloudWatch Observability add-on or related collectors, with version, Fargate, Windows, and OpenTelemetry caveats that affect real deployments. -->

The **Amazon CloudWatch Observability EKS add-on** is the managed EKS add-on for CloudWatch observability. AWS documents that the add-on or Helm chart can install the CloudWatch agent and Fluent Bit on EKS, enabling Container Insights with enhanced observability and CloudWatch Application Signals by default in the classic path. AWS also documents **OTel Container Insights** as the recommended EKS Container Insights approach for new EKS customers, using the same `amazon-cloudwatch-observability` add-on with OpenTelemetry-based configuration.

The version and platform caveats deserve attention before a team turns this on:

| Caveat | Practical meaning |
|---|---|
| **EKS version** | The CloudWatch Observability EKS add-on is supported on EKS clusters running Kubernetes 1.23 or later. The quick start method for Container Insights is documented for EKS 1.24 and later. |
| **Fargate pods** | EKS Fargate uses a separate ADOT path because Container Insights with enhanced observability for EKS is unsupported on Fargate. |
| **Windows nodes** | Windows worker node support exists, but Container Insights on Windows requires version 1.5.0 or later of the add-on or Helm chart, and CloudWatch Application Signals is unsupported on Windows in EKS clusters. |
| **OpenTelemetry metrics** | AWS documents OpenTelemetry metrics support in recent CloudWatch Observability add-on versions, and the OTel Container Insights quick start enables it with `otelContainerInsights.enabled`. |
| **IAM permissions** | The add-on needs IAM permissions to send metrics, logs, and traces. AWS recommends EKS Pod Identity for add-on version 3.1.0 or later. |

A current OTel-style add-on install has three ideas: an IAM role, a pod identity association, and the add-on configuration:

```bash
aws iam attach-role-policy \
  --role-name EKS-CloudWatch-Observability-Role \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

aws eks create-pod-identity-association \
  --cluster-name prod-eks \
  --namespace amazon-cloudwatch \
  --service-account cloudwatch-agent \
  --role-arn arn:aws:iam::123456789012:role/EKS-CloudWatch-Observability-Role

aws eks create-addon \
  --cluster-name prod-eks \
  --addon-name amazon-cloudwatch-observability \
  --configuration-values '{"otelContainerInsights":{"enabled":true}}'
```

After installation, the team checks the add-on status and agent pods:

```bash
aws eks describe-addon \
  --cluster-name prod-eks \
  --addon-name amazon-cloudwatch-observability \
  --query "addon.status" \
  --output text

kubectl get pods -n amazon-cloudwatch
```

The add-on handles the platform collection path. Application instrumentation still belongs to the application. For `inventory-worker`, the team usually adds OpenTelemetry SDK instrumentation in the service code and sends traces to an ADOT collector or CloudWatch-supported OTLP endpoint. The collector path keeps instrumentation portable and avoids tying application code to one backend forever.

Now all three compute shapes have their local telemetry. The last step is correlation, because the checkout incident will rarely stay inside one runtime.

## Correlating Logs, Metrics, and Traces
<!-- section-summary: A shared request identity turns separate Lambda, ECS, and EKS telemetry into one investigation path. -->

**Correlation** means carrying the same request identity through every service that handles the customer action. In practice, teams usually carry a `traceId`, an `orderId`, and a small set of stable service fields in every log line. The trace ID connects telemetry systems, while the business ID helps humans understand which customer or transaction they are following.

For the checkout system, the entry service creates or receives the trace context. `orders-api` logs the `traceId` and `orderId`, passes trace context to downstream calls, publishes queue messages with trace metadata, and includes the same IDs in application logs. `inventory-worker` extracts that context when it processes the queue message. `receipt-renderer` includes the same fields in Lambda JSON logs.

A cross-runtime Logs Insights query then works across selected log groups:

```sql
fields @timestamp, service, traceId, orderId, level, message
| filter traceId = "1-667af5a1-4b8c2c6d1c9f7b4a6d2e9f01"
| sort @timestamp asc
| limit 200
```

The trace view and the log view answer different parts of the same incident. The trace shows that `orders-api` waited 1.8 seconds on `inventory-worker`. The EKS metrics show that the pod restarted twice. The EKS logs show a warehouse timeout. Lambda logs show that receipt rendering succeeded after the worker retried. The incident now has a timeline instead of three disconnected service dashboards.

This is the production pattern worth practicing:

1. **Metrics page the team** because aggregate behavior crossed a threshold.
2. **Container or Lambda runtime metrics locate the affected unit** such as a function, task, pod, or node.
3. **Logs explain the concrete failure** with request IDs, business IDs, error types, and dependency names.
4. **Traces connect the request path** across Lambda, ECS, EKS, queues, databases, and external APIs.
5. **Dashboards and alarms keep the loop visible** after the fix ships.

No one signal carries the whole story. Metrics compress behavior, logs preserve detail, and traces connect service boundaries. Lambda, ECS, and EKS simply give you different starting points for those same three jobs.

## Production Checklist
<!-- section-summary: A strong compute observability setup makes the default AWS signals useful, adds runtime-specific depth, and keeps shared request fields consistent. -->

For Lambda, start with the execution role and log format. The function role needs CloudWatch Logs permissions, the log group needs a useful retention policy, and application logs should use JSON with `service`, `env`, `requestId`, `traceId`, and business IDs. Add Lambda Insights to functions where runtime performance matters, and enable tracing for functions in important request paths.

For ECS, start with the task definition. Every essential application container should send logs through `awslogs` or FireLens, and the stream prefix should make the task ID visible. Enable Container Insights with enhanced observability at the account and cluster level, then build dashboards around service health, task churn, CPU, memory, and deployment events.

For EKS, start with the cluster collection path. The CloudWatch Observability add-on, OTel Container Insights, CloudWatch agent, Fluent Bit, and ADOT each solve different parts of the collection problem. Platform teams should document which path they use, which namespaces they collect, which fields they enrich, and which add-on versions they support.

For all three, keep the application fields boring and consistent:

| Field | Why it matters |
|---|---|
| `service` | Lets responders filter logs by workload name. |
| `env` | Separates production, staging, and development telemetry. |
| `traceId` | Connects logs to traces across services. |
| `orderId` or business ID | Gives humans a real transaction to follow. |
| `dependency` | Names the downstream service, table, queue, bucket, or API involved in a failure. |
| `errorType` | Lets teams group failures without parsing full stack traces. |

The final setup should feel practical in a real incident. A responder should move from an alarm to a function, task, pod, trace, or log query in a few clicks or commands. The goal is to collect the signals that answer where the failure happened, who or what it affected, and what changed just before it happened.

![Runtime observability checklist with structured logs, platform metrics, runtime insights, trace context, service names, and alert path](/content-assets/articles/article-cloud-providers-aws-observability-lambda-ecs-eks-observability/runtime-observability-checklist.png)

*The checklist keeps the runtime work concrete. Before an incident, the team wires the shared fields, runtime metrics, trace context, and alert path that make Lambda, ECS, and EKS debuggable.*

## What's Next
<!-- section-summary: The next article moves from runtime symptoms to audit evidence about who changed AWS and what the resource looked like. -->

CloudWatch explains how the workload behaved. It shows slow requests, high memory, container restarts, Lambda errors, and noisy logs. After the team fixes the immediate symptom, the next question usually sounds different: who changed the security group, who updated the Lambda environment variable, or who replaced the ECS task definition?

The next article uses CloudTrail and AWS Config to answer that change question. CloudTrail records the API activity, and AWS Config records resource configuration history. Together, they help the team connect a production symptom to the person, role, pipeline, or service that changed AWS.

---

**References**

- [Sending Lambda function logs to CloudWatch Logs](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html) - Documents default Lambda log delivery, log group naming, execution-role permissions, and the `AWSLambdaBasicExecutionRole` policy.
- [Working with Lambda function logs](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-logs.html) - Covers Lambda log destinations, JSON/plain text formats, log levels, and custom log groups.
- [Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html) - Explains structured JSON logs for Lambda system and application logs.
- [Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html) - Lists Lambda invocation, performance, concurrency, asynchronous, and event source mapping metrics.
- [Lambda Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Lambda-Insights.html) - Describes Lambda Insights, the extension layer, collected system metrics, diagnostic information, and runtime support.
- [Monitor function performance with Amazon CloudWatch Lambda Insights](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-insights.html) - Covers enabling Lambda Insights, required policy attachment, dashboards, and troubleshooting workflows.
- [Visualize Lambda function invocations using AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html) - Documents Lambda active and pass-through tracing modes, sampling behavior, and execution-role permissions.
- [X-Ray SDK and Daemon support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html) - Documents the February 25, 2026 maintenance-mode date and AWS migration guidance toward OpenTelemetry.
- [Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html) - Documents ECS `awslogs` task-definition logging for Fargate and EC2 launch types.
- [Setting up Container Insights on Amazon ECS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/deploy-container-insights-ECS-cluster.html) - Documents ECS Container Insights setup, enhanced observability, account settings, and cluster settings.
- [ClusterSetting](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ClusterSetting.html) - Defines supported `containerInsights` values: `enhanced`, `enabled`, and `disabled`.
- [Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html) - Defines Container Insights and supported container platforms.
- [Install the CloudWatch agent with the Amazon CloudWatch Observability EKS add-on or the Helm chart](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Observability-EKS-addon.html) - Documents the EKS add-on, IAM options, supported Kubernetes versions, Windows caveats, Application Signals caveats, and Pod Identity recommendation.
- [Setting up Container Insights on Amazon EKS and Kubernetes](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/deploy-container-insights-EKS.html) - Documents EKS Container Insights support, Fargate caveats, OpenTelemetry metrics notes, and log collection notes.
- [OTel Container Insights (Recommended)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/container-insights-eks-otel.html) - Describes the recommended OpenTelemetry-based Container Insights path for EKS.
- [Quick start: OTel Container Insights on Amazon EKS](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/container-insights-eks-otel-quickstart.html) - Provides the current AWS CLI setup path for IAM, Pod Identity, and add-on configuration.
- [Collect metrics, logs, and traces using the CloudWatch agent](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Install-CloudWatch-Agent.html) - Documents CloudWatch agent capabilities for metrics, logs, traces, OpenTelemetry, and X-Ray.
- [What is Amazon CloudWatch?](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html) - Describes CloudWatch observability features, including support for native OTLP ingestion.
- [AWS Distro for OpenTelemetry and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-adot.html) - Explains ADOT for collecting and sending traces and metrics to X-Ray and CloudWatch.
