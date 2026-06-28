---
title: "API Gateway"
description: "Use Amazon API Gateway as a managed request/response boundary for HTTP, REST, and WebSocket APIs."
overview: "Application integration often starts with one caller needing an answer now. This article follows a lesson publishing API and shows how API Gateway handles routes, stages, Lambda and private integrations, authorizers, throttling, logs, and the cases where another AWS entry point fits better."
tags: ["aws", "api-gateway", "http", "apis"]
order: 2
id: article-cloud-providers-aws-application-integration-api-gateway
aliases:
  - api-gateway
  - 1-api-gateway
  - 2-api-gateway
  - cloud-providers/aws/application-integration/1-api-gateway.md
  - cloud-providers/aws/application-integration/2-api-gateway.md
---

## Table of Contents

1. [The Request That Needs an Answer](#the-request-that-needs-an-answer)
2. [What API Gateway Does](#what-api-gateway-does)
3. [HTTP API, REST API, and WebSocket API](#http-api-rest-api-and-websocket-api)
4. [Routes, Integrations, and Stages](#routes-integrations-and-stages)
5. [Build a Small Publish API](#build-a-small-publish-api)
6. [Call the API and Inspect the Route](#call-the-api-and-inspect-the-route)
7. [Authorization and Backend Permissions](#authorization-and-backend-permissions)
8. [Throttling, Logs, and Request IDs](#throttling-logs-and-request-ids)
9. [Private Backends and VPC Links](#private-backends-and-vpc-links)
10. [Where API Gateway Fits](#where-api-gateway-fits)
11. [Putting It Together](#putting-it-together)
12. [What's Next](#whats-next)
13. [References](#references)

## The Request That Needs an Answer
<!-- section-summary: API Gateway fits the request/response part of application integration where the caller waits for a clear result. -->

The orientation article started with Northstar Learn. An instructor clicks **Publish lesson**, and the browser needs a clear answer from the backend. The answer may say the lesson is ready and publishing has started, or it may say the video upload is missing.

That request is a **request/response API**. The browser sends a request, waits for a response, and uses the response to update the screen. This is the right place to talk about API Gateway because the first communication job is a synchronous API boundary.

The API boundary should do edge work. It should receive HTTPS traffic, match the path and method, check the caller, apply basic protection, write useful access logs, and hand the request to the backend. The backend still owns the real lesson rules, such as whether the instructor can publish this specific lesson.

The example API in this article has two routes:

| Route | Caller need | Backend result |
|---|---|---|
| `POST /lessons/{lessonId}/publish` | Start publishing and get a tracking ID | `202 Accepted` with `publishRequestId` |
| `GET /publish-requests/{publishRequestId}` | Show current publish progress | `200 OK` with status such as `VALIDATING`, `TRANSCODING`, or `PUBLISHED` |

This keeps the user-facing API small. The direct request starts or checks work. SQS, SNS, EventBridge, and Step Functions can handle the slower work after the API returns.

## What API Gateway Does
<!-- section-summary: API Gateway gives callers one managed HTTPS surface before traffic reaches Lambda, containers, or private services. -->

Amazon API Gateway is an AWS service for creating, publishing, securing, monitoring, and operating APIs. A caller uses an HTTPS endpoint. API Gateway matches the request to a route, applies configured controls, calls an integration, and returns the response.

The beginner definition is: **API Gateway is a managed API boundary**. A boundary is the place where outside callers meet a stable contract. In Northstar Learn, callers use `https://api.learn.example.com/lessons/lesson-1042/publish` while the backend can run as Lambda today and a private container service later.

API Gateway often owns these jobs:

| Job | Example in the lesson API |
|---|---|
| Public endpoint | `https://api.learn.example.com` |
| Route table | `POST /lessons/{lessonId}/publish` |
| Caller check | JWT authorizer for signed-in instructors |
| Integration | Lambda function or private HTTP service |
| Stage | `dev`, `staging`, or `prod` deployment settings |
| Protection | Throttling, request limits, and optional AWS WAF with REST APIs |
| Signals | Access logs, execution metrics, latency, and status codes |

The split matters in production. API Gateway can reject a request with a missing token, but the lesson service still checks that the instructor owns `lesson-1042`. Edge authorization and domain authorization work together because they answer different questions.

![The request path shows how a client call passes through route matching, authorization, backend integration, response handling, and request logging](/content-assets/articles/article-cloud-providers-aws-application-integration-api-gateway/api-gateway-request-path.png)

*The request path shows how a client call passes through route matching, authorization, backend integration, response handling, and request logging.*


## HTTP API, REST API, and WebSocket API
<!-- section-summary: API Gateway has three API types, and the right choice depends on the boundary features the caller needs. -->

API Gateway offers **HTTP APIs**, **REST APIs**, and **WebSocket APIs**. The names can feel close together because HTTP APIs and REST APIs both receive normal HTTP requests. The practical choice comes from the features your boundary needs.

**HTTP APIs** fit many modern APIs that route to Lambda or HTTP backends. They support routes, stages, JWT authorizers, Lambda proxy integrations, HTTP integrations, custom domains, access logs, and CORS. They are often the clean first option for the Northstar lesson publish API.

**REST APIs** are the older and larger API Gateway product. They matter when the API needs features such as API keys and usage plans, request validation, richer request and response mapping, API Gateway caching, or certain private API endpoint patterns. A partner publishing API with per-partner quotas may choose REST API because usage plans are part of that product.

**WebSocket APIs** handle long-lived two-way connections. A lesson editing screen might use WebSockets to receive live collaboration updates or publish progress without polling. The publish request in this article uses normal HTTP because the caller only needs a request and a response.

For this article, the example uses an HTTP API. It keeps the implementation focused on the request/response pattern without adding REST API-only features before they are needed.

## Routes, Integrations, and Stages
<!-- section-summary: A route names the caller contract, an integration names the backend, and a stage exposes a deployed API environment. -->

A **route** is the method and path that API Gateway matches. `POST /lessons/{lessonId}/publish` is a route. The route key combines the HTTP method and the path pattern, so `GET /lessons/{lessonId}/publish` would be a different route.

An **integration** is the backend target for a route. API Gateway can call a Lambda function, an HTTP endpoint, a private service through a VPC link, or an AWS service integration depending on the API type and configuration. In this article, `POST /lessons/{lessonId}/publish` calls a Lambda function named `publishLesson`.

A **stage** exposes a deployed environment. A stage can hold settings such as auto-deploy, access logs, stage variables, and throttling depending on API type. For an HTTP API, a `$default` stage with auto-deploy is common in small examples, while production teams often use named stages and infrastructure as code to make changes reviewable.

This route-to-integration-to-stage path is the first thing to check during troubleshooting. If a caller gets a 404, route matching may be wrong. If API Gateway returns a 500, the integration or backend permission may be wrong. If one environment works and another fails, stage settings or deployment drift may be involved.

![The layer view separates the route key, backend integration, and stage URL so the API shape is easier to review](/content-assets/articles/article-cloud-providers-aws-application-integration-api-gateway/routes-integrations-stages.png)

*The layer view separates the route key, backend integration, and stage URL so the API shape is easier to review.*


## Build a Small Publish API
<!-- section-summary: A minimal HTTP API connects a public route to a Lambda integration and exposes it through a stage. -->

The example assumes a Lambda function already exists:

```json
{
  "functionName": "publishLesson",
  "functionArn": "arn:aws:lambda:us-east-1:123456789012:function:publishLesson",
  "job": "Validate a lesson publish request, create a publish record, and return a tracking ID"
}
```

This JSON is not an API Gateway configuration. It describes the backend that API Gateway will call. The function name appears in the integration command, and the function job explains why the direct API returns quickly instead of performing every publishing step itself.

The command below creates an HTTP API. The CORS settings allow the browser app to send `POST` and `GET` requests from the learning site.

```bash
aws apigatewayv2 create-api \
  --name northstar-publish-api \
  --protocol-type HTTP \
  --cors-configuration '{"AllowOrigins":["https://learn.example.com"],"AllowMethods":["POST","GET"],"AllowHeaders":["authorization","content-type"]}'
```

Example output:

```json
{
  "ApiEndpoint": "https://a1b2c3d4.execute-api.us-east-1.amazonaws.com",
  "ApiId": "a1b2c3d4",
  "Name": "northstar-publish-api",
  "ProtocolType": "HTTP"
}
```

`ApiId` is the identifier used in later API Gateway commands. `ApiEndpoint` is the generated execute-api hostname. A production API usually maps a custom domain such as `api.learn.example.com`, but the generated endpoint is useful for early testing.

Next, the command below creates a Lambda proxy integration. `AWS_PROXY` means API Gateway sends the request event to Lambda using the standard proxy event shape, and Lambda returns the HTTP-style status code, headers, and body.

```bash
aws apigatewayv2 create-integration \
  --api-id a1b2c3d4 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:publishLesson \
  --payload-format-version 2.0
```

Example output:

```json
{
  "IntegrationId": "abc123",
  "IntegrationType": "AWS_PROXY",
  "IntegrationUri": "arn:aws:lambda:us-east-1:123456789012:function:publishLesson",
  "PayloadFormatVersion": "2.0"
}
```

The `IntegrationId` connects routes to this backend. Payload format `2.0` is the HTTP API Lambda proxy event format, so the Lambda handler should read fields such as `requestContext`, `pathParameters`, `headers`, and `body` from that event shape.

The route command connects the caller-facing route to the integration:

```bash
aws apigatewayv2 create-route \
  --api-id a1b2c3d4 \
  --route-key "POST /lessons/{lessonId}/publish" \
  --target integrations/abc123
```

Example output:

```json
{
  "RouteId": "r-7k9m2",
  "RouteKey": "POST /lessons/{lessonId}/publish",
  "Target": "integrations/abc123"
}
```

The route key is the public contract. The target points to the integration. If the backend changes later, the public route can stay the same while the integration changes through reviewed infrastructure.

The stage command exposes the API. Auto-deploy is useful for a small tutorial because route changes become available without a separate deployment command.

```bash
aws apigatewayv2 create-stage \
  --api-id a1b2c3d4 \
  --stage-name prod \
  --auto-deploy
```

Example output:

```json
{
  "AutoDeploy": true,
  "StageName": "prod",
  "StageVariables": {}
}
```

The final URL uses the generated endpoint plus the stage name and route path: `https://a1b2c3d4.execute-api.us-east-1.amazonaws.com/prod/lessons/lesson-1042/publish`.

## Call the API and Inspect the Route
<!-- section-summary: A working API should return an application response, and inspection commands should show the route-to-integration wiring. -->

The `curl` command below sends a publish request. The idempotency key gives the backend a stable value it can use to avoid creating duplicate publish requests when a caller retries.

```bash
curl -i \
  -X POST "https://a1b2c3d4.execute-api.us-east-1.amazonaws.com/prod/lessons/lesson-1042/publish" \
  -H "content-type: application/json" \
  -H "authorization: Bearer eyJhbGciOi..." \
  -H "idempotency-key: publish-lesson-1042-2026-06-27" \
  -d '{"requestedBy":"instructor-77"}'
```

Example response:

```http
HTTP/2 202
content-type: application/json
x-amzn-requestid: 9ef0d6c8-8b3b-49bd-9f2d-28d6ad7b0f42

{
  "publishRequestId": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "lessonId": "lesson-1042",
  "status": "ACCEPTED"
}
```

The `202` status says the request was accepted and longer work will continue after the response. `publishRequestId` gives the UI a durable handle for progress. `x-amzn-requestid` helps connect a caller report to API Gateway logs and backend logs.

The inspection command below asks API Gateway which routes exist. This is useful when the API returns 404 or when a route was expected in one stage but not another.

```bash
aws apigatewayv2 get-routes \
  --api-id a1b2c3d4 \
  --query 'Items[].{RouteKey:RouteKey,Target:Target}' \
  --output table
```

Example output:

```bash
-------------------------------------------------------------
|                         GetRoutes                         |
+-------------------------------------------+---------------+
|                 RouteKey                  |    Target     |
+-------------------------------------------+---------------+
| POST /lessons/{lessonId}/publish          | integrations/abc123 |
+-------------------------------------------+---------------+
```

The output proves that API Gateway knows the `POST` route and points it at the expected integration. If the route exists and the backend still receives nothing, the next checks are Lambda permission, authorizer behavior, and access logs.

## Authorization and Backend Permissions
<!-- section-summary: API Gateway can check the caller, and the backend must also allow API Gateway to invoke it. -->

An **authorizer** checks the caller before the request reaches the integration. HTTP APIs commonly use JWT authorizers for identity providers that issue JSON Web Tokens. REST APIs can also use Lambda authorizers, IAM authorization, Cognito user pools, and API keys depending on the API design.

In the lesson API, a JWT authorizer can verify that the request came from a signed-in instructor. The Lambda function still checks whether that instructor owns the lesson. The API boundary answers "is this caller authenticated enough to enter this API," and the backend answers "can this caller publish this exact lesson."

There is another permission that beginners often miss. Lambda needs a resource-based permission statement allowing API Gateway to invoke the function. The command below grants that permission for this API route pattern.

```bash
aws lambda add-permission \
  --function-name publishLesson \
  --statement-id allow-api-gateway-publish-route \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4/*/POST/lessons/*/publish"
```

Example output:

```json
{
  "Statement": "{\"Sid\":\"allow-api-gateway-publish-route\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"apigateway.amazonaws.com\"},\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"arn:aws:lambda:us-east-1:123456789012:function:publishLesson\",\"Condition\":{\"ArnLike\":{\"AWS:SourceArn\":\"arn:aws:execute-api:us-east-1:123456789012:a1b2c3d4/*/POST/lessons/*/publish\"}}}"
}
```

The statement lets API Gateway call only the matching function route source. If this permission is missing, API Gateway can match the route but fail when it tries to invoke Lambda. The caller may see a 500, and the API Gateway logs will point toward an integration permission problem.

## Throttling, Logs, and Request IDs
<!-- section-summary: Production APIs need limits and signals so teams can protect backends and debug real requests. -->

Throttling limits how fast callers can send requests. This protects the backend from sudden bursts and gives teams a way to shape traffic. HTTP APIs support account-level and route-level throttling settings. REST APIs add usage plans and API keys for per-client quota and throttle management.

For Northstar Learn, the public lesson publish route might have a lower rate limit than a read-only status route. Publishing starts expensive downstream work, so the API can protect the system from accidental repeated clicks, buggy clients, or automation loops.

Access logs should include fields that connect the edge request to backend evidence. A useful log format includes request ID, route key, status, integration status, response latency, caller identity, source IP, and user agent. Teams often carry a correlation ID through API Gateway, Lambda, SQS messages, EventBridge events, and Step Functions executions.

Here is a compact JSON access log shape:

```json
{
  "requestId": "$context.requestId",
  "routeKey": "$context.routeKey",
  "status": "$context.status",
  "integrationStatus": "$context.integrationStatus",
  "responseLatency": "$context.responseLatency",
  "sourceIp": "$context.identity.sourceIp",
  "userAgent": "$context.identity.userAgent"
}
```

Each value comes from API Gateway context variables. This is configuration for log formatting, not a client payload. The goal is to make one API request searchable in CloudWatch Logs when an instructor reports a failed publish attempt.

## Private Backends and VPC Links
<!-- section-summary: VPC links let API Gateway call private HTTP services without placing those services directly on the public internet. -->

The example used Lambda because it keeps the first implementation small. Many production APIs call container services or internal HTTP services instead. The lesson service might run on ECS behind an internal load balancer in private subnets, with no public address of its own.

For that shape, API Gateway can use a **VPC link**. A VPC link lets API Gateway reach private resources through supported load balancer patterns. The API stays public or controlled at the edge, while the backend service remains inside private networking.

This design keeps ownership clear. API Gateway owns the public contract, authorizer, throttling, and access logs. The private service owns lesson publishing rules and database access. Security groups, load balancer health checks, service logs, and API Gateway logs all become part of the same request path.

Private integrations deserve extra operational checks. If API Gateway returns integration timeouts, the issue may sit in target group health, security groups, DNS, container port mappings, or backend latency. The API boundary can show the failing route, but the VPC and service layers still need their own signals.

## Where API Gateway Fits
<!-- section-summary: API Gateway is the right entry point when API management features matter for the caller contract. -->

API Gateway is a strong fit when the caller-facing API needs route management, authorizers, throttling, custom domains, stages, access logs, and integrations to Lambda or private HTTP services. It gives teams a managed API surface before requests enter application code.

There are other AWS entry points that can be simpler for some workloads. An Application Load Balancer can be a good fit for browser traffic to a containerized web app with normal HTTP routing and load balancing needs. Lambda Function URLs can be a small entry point for a single Lambda function with a narrow use case. CloudFront can sit in front of APIs and static assets when global caching, edge controls, or unified domains matter.

The decision should come from the caller contract. If the team needs API-specific controls and multiple backend integrations, API Gateway belongs in the conversation. If the team mainly needs load balancing for one web service, an Application Load Balancer may keep the design simpler.

## Putting It Together
<!-- section-summary: API Gateway handles the first synchronous boundary, while later integration services handle background work and downstream reactions. -->

For Northstar Learn, API Gateway receives the instructor's publish request and routes it to a backend handler. The handler validates the request, creates a publish record, and returns a `202 Accepted` response with a `publishRequestId`. That is the request/response job.

The handler should then hand slower work to the rest of the integration system. SQS can hold the video transcode job. SNS can fan out a final lesson-published notification. EventBridge can route product events across teams. Step Functions can coordinate the full publishing process when the sequence needs visible state and branching.

The important boundary stays concrete: **API Gateway is for the caller request that needs an answer**. It should make the API contract safe and observable without turning one user click into every downstream operation.

![The operations checklist summarizes the API controls that keep a public endpoint secure, observable, and connected to the right backend](/content-assets/articles/article-cloud-providers-aws-application-integration-api-gateway/api-operations-checklist.png)

*The operations checklist summarizes the API controls that keep a public endpoint secure, observable, and connected to the right backend.*


## What's Next
<!-- section-summary: The next article moves from direct request/response to durable background work with SQS. -->

The publish API has now accepted the instructor request. The next problem is slower work. Video transcode, caption generation, thumbnail creation, and external checks should continue after the HTTP response. That is where Amazon SQS comes in.

## References

- [What is Amazon API Gateway?](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)
- [Working with HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html)
- [Working with REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-rest-api.html)
- [Working with WebSocket APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [API Gateway Lambda proxy integrations for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)
- [Controlling access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [Using VPC links for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html)
