---
title: "API Gateway"
description: "Use Amazon API Gateway as a managed API boundary for HTTP, REST, and WebSocket APIs with routes, stages, integrations, authorization, throttling, private access, and observability."
overview: "Application integration starts with the API boundary: the place where callers meet a stable contract before work reaches Lambda, containers, queues, events, or private services. This article follows an orders platform and explains how API Gateway handles routes, stages, integrations, authorizers, throttling, VPC links, logging, and the cases where ALB or Lambda Function URLs are a cleaner fit."
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

1. [The Problem](#the-problem)
2. [What Is API Gateway](#what-is-api-gateway)
3. [The Three API Types](#the-three-api-types)
4. [How a Request Moves Through API Gateway](#how-a-request-moves-through-api-gateway)
5. [Routes](#routes)
6. [Stages](#stages)
7. [Integrations](#integrations)
8. [Authorizers](#authorizers)
9. [Throttling, Usage Plans, and API Keys](#throttling-usage-plans-and-api-keys)
10. [Private Integrations and VPC Links](#private-integrations-and-vpc-links)
11. [A Small API Configuration](#a-small-api-configuration)
12. [Observability](#observability)
13. [When ALB or Lambda Function URLs Are Simpler](#when-alb-or-lambda-function-urls-are-simpler)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)

## The Problem
<!-- section-summary: Application integration often starts at a public API boundary that keeps callers away from backend wiring. -->

The Application Integration module is about connecting AWS application pieces without making every service call every other service directly. The first place this shows up is the API front door. A browser, a mobile app, a partner system, and a payment webhook all need a stable way to reach the orders platform, even while the backend changes behind the scenes.

The orders team has a few different caller shapes. Customers need `GET /orders/{orderId}` from the web app. Checkout needs `POST /checkout`. A payment provider needs `POST /webhooks/payment` with a signed webhook header. A partner needs `GET /partner/exports/{exportId}`, but that partner should have a traffic limit. The actual order service runs privately in a VPC behind a load balancer, and one webhook handler runs as a Lambda function.

Without a managed API boundary, each backend has to carry too many jobs. Every service needs to know public paths, TLS, caller authentication, rate limits, partner quotas, request logging, and maybe a different network exposure story. The backend should focus on order rules: who owns the order, what the payment status means, and what data should be written. The API boundary should focus on the caller-facing contract and the first safe handoff.

That is the API Gateway job in this article. It gives the orders platform one controlled API surface, then connects each route to the right backend shape: Lambda for small handlers, HTTP services for container workloads, private integrations for VPC services, and AWS service integrations for direct AWS calls.

## What Is API Gateway
<!-- section-summary: API Gateway is a managed API boundary that receives caller requests and hands them to configured backends. -->

Amazon API Gateway is an AWS service for creating, publishing, securing, monitoring, and operating APIs. An API Gateway API gives callers an HTTPS endpoint. Behind that endpoint, AWS matches the request to a route, applies configured controls, calls an integration, and returns the response to the caller.

The beginner-friendly definition is this: **API Gateway is a managed API boundary**. A boundary is the place where the outside request first meets your application rules. In the orders platform, callers use `https://api.example.com/orders/1042` while the order-read backend can move between Lambda, ECS, or a private service behind an internal load balancer.

API Gateway is useful because API concerns repeat across many backends. The API needs a stable hostname, route table, deployment stage, authorization decision, throttling policy, logging format, and integration target. Keeping those concerns in one managed boundary gives the backend more room to stay focused on business behavior.

The same few words show up in every API Gateway design. This vocabulary gives the rest of the article a shared map:

| Concept | Plain meaning | Orders example |
| --- | --- | --- |
| **API** | The caller-facing API surface | `orders-api` |
| **Route** | The method and path a caller requests | `GET /orders/{orderId}` |
| **Stage** | A named deployed version or environment | `dev`, `staging`, `prod` |
| **Integration** | The backend target for a route | Lambda, ECS over VPC link, HTTP endpoint |
| **Authorizer** | The caller check before integration | JWT authorizer for customers |
| **Throttling** | Request-rate limits at the API layer | Partner export route limits |
| **Usage plan** | Per-client quota and throttling for REST APIs | Partner API key metering |

The important split is ownership. API Gateway owns the API edge behavior. The backend owns the real business decision. If a customer is authenticated at API Gateway, the order service still checks that the customer owns `order-1042`. The boundary can reject obvious bad requests early, and the backend still protects domain data.

## The Three API Types
<!-- section-summary: HTTP APIs fit many modern APIs, REST APIs carry the largest feature set, and WebSocket APIs handle long-lived two-way clients. -->

API Gateway has three main API types: **HTTP APIs**, **REST APIs**, and **WebSocket APIs**. The names are a little confusing at first because REST APIs and HTTP APIs both receive HTTP requests. The practical choice comes from the features the API boundary needs.

**HTTP APIs** are usually the first option for a modern HTTP API that routes to Lambda or HTTP backends. They have a smaller feature surface and are designed for lower cost and lower latency than REST APIs. For the orders platform, `GET /orders/{orderId}` and `POST /checkout` can often begin as HTTP API routes if the team needs JWT authorization, Lambda integrations, HTTP integrations, stages, custom domains, access logs, and normal route matching.

**REST APIs** are the older and larger API Gateway product. They are still important because they support features that HTTP APIs may not have, including API keys and usage plans, per-client throttling, request validation, request and response mapping options, caching, AWS WAF integration, and private API endpoint patterns. If the partner export API needs usage plans and API keys managed by API Gateway, REST API may be the better fit.

**WebSocket APIs** handle long-lived two-way communication. A normal HTTP request has one request and one response. A WebSocket connection stays open so the client and backend can send messages over time. In an orders system, WebSockets might support live kitchen display updates, driver dispatch updates, or an operations dashboard that receives status messages without polling every few seconds.

A better early design question is "Which boundary features does this API need?" A customer mobile API with JWT auth and Lambda handlers may fit HTTP API. A partner API with usage plans, API keys, request validation, and mature mapping controls may fit REST API. A live order-status screen with server-pushed updates may fit WebSocket API.

## How a Request Moves Through API Gateway
<!-- section-summary: A request matches a deployed route, passes API-layer controls, reaches an integration, and returns through the same boundary. -->

Following one request makes API Gateway easier to understand. Imagine the customer web app calls `GET /orders/order-1042` with a bearer token from the sign-in system. The DNS name points to API Gateway, and API Gateway receives the HTTPS request before any order service code runs.

First, API Gateway looks at the deployed API and stage. The request has a method, path, headers, query string, and maybe a body. API Gateway checks whether the stage has a route that matches the method and path. If no deployed route matches, the backend never sees the request.

Second, API Gateway applies configured boundary controls. This may include authorization, resource policies, request validation, throttling, usage-plan checks, and logging context. A bad token can stop at `401`. A caller without permission can stop at `403`. Too much traffic can stop at `429`. These failures are useful because they happen before the backend pays the cost.

Third, API Gateway calls the integration for the route. With a Lambda proxy integration, API Gateway sends an event payload to the function. With an HTTP integration, it forwards an HTTP request to a configured endpoint. With a private integration, it sends traffic through a VPC link to a private backend such as an internal load balancer or service discovery target.

Fourth, the backend returns a response. API Gateway sends that response back through the API surface. The response can pass through mostly unchanged, or API Gateway can apply mapping and response configuration depending on the API type and integration style. For beginner systems, simple proxy-style integrations usually keep debugging clearer.

This flow also helps during incident response. A spike in `401` or `403` points toward caller identity or authorization. A spike in `429` points toward throttling or client retry behavior. A spike in `5XXError` with high integration latency points toward the backend handoff, Lambda errors, load balancer health, private networking, or backend timeouts.

## Routes
<!-- section-summary: Routes translate caller intent into the API Gateway behavior and integration that should handle the request. -->

A **route** is the method-and-path pattern that API Gateway matches for an incoming request. In an HTTP API, route keys look like `GET /orders/{orderId}` or `POST /checkout`. The route tells API Gateway which authorizer, throttling settings, and integration belong to that caller action.

Routes should describe caller intent. The route `GET /orders/{orderId}` says the caller wants to read one order. The route name can avoid exposing whether the backend is a Lambda function named `GetOrderFunction` or a container service named `orders-read-api`. That separation lets the team change the backend without changing the public API contract.

A first route map for the orders API might look like this. Notice how each route records the caller and the boundary behavior before naming the backend:

| Route | Caller | Boundary behavior | Integration |
| --- | --- | --- | --- |
| `GET /orders/{orderId}` | Customer app | JWT authorizer | Lambda or private orders service |
| `POST /checkout` | Customer app | JWT authorizer and strict body validation | Private checkout service |
| `POST /webhooks/payment` | Payment provider | Lambda authorizer checks signature | Lambda webhook handler |
| `GET /partner/exports/{exportId}` | Partner system | IAM or authorizer plus traffic limits | Private export service |
| `$default` | Unknown callers | Controlled fallback response | Simple error handler |

The route map is also a design review tool. A route with no clear caller probably needs more thinking. A route with a name tied to an internal implementation may create migration pain later. A route with no authorization decision should be intentionally public, such as a health check or public status endpoint, rather than accidentally open.

For WebSocket APIs, routes work a little differently. Instead of HTTP method and path, WebSocket routes use route keys such as `$connect`, `$disconnect`, `$default`, or an application message action. For example, a client might send a message with `"action": "subscribeToOrder"`, and API Gateway can route that message to the integration for order subscriptions.

## Stages
<!-- section-summary: Stages are named deployed views of an API, so each environment has clear release and operation settings. -->

A **stage** is a named deployed view of an API. Common stage names are `dev`, `staging`, `prod`, `beta`, or `v1`. The stage gives callers and operators a concrete place where a specific API configuration is available.

For HTTP APIs, a stage can use auto-deploy, which means route and integration changes are deployed automatically to that stage. That is convenient in development. Production teams usually treat stage changes as release events. They want to know which route table, authorizer, integration, and logging settings went live, and they want rollback to mean something concrete.

For REST APIs, deployments and stages are more explicit. You create or update resources and methods, create a deployment, and associate that deployment with a stage. That extra ceremony can feel slower, but it also makes the deployed API snapshot easier to reason about for production change control.

Stages also influence URLs. The default execute-api URL often includes the stage name, such as:

```bash
https://api-id.execute-api.us-east-1.amazonaws.com/prod/orders/order-1042
```

Many production APIs use a custom domain and base path mapping so callers see a cleaner URL:

```bash
https://api.example.com/orders/order-1042
```

That custom domain is still mapped to an API stage behind the scenes. The clean public URL is for callers. The stage is for deployment and operations. Keep stage names, logging, throttling, and backend targets understandable, because stage configuration often explains why `dev` works and `prod` behaves differently.

## Integrations
<!-- section-summary: Integrations are the backend handoff points, and the best integration style matches the route's workload shape. -->

An **integration** is the backend target API Gateway calls after a route matches and API-layer controls pass. The integration can be a Lambda function, an HTTP endpoint, a private VPC backend, or certain AWS service actions. This is the handoff from "API boundary" to "application work."

Lambda integrations are a common starting point for small handlers. The payment webhook route is a good example. API Gateway can receive `POST /webhooks/payment`, run an authorizer that checks the provider signature, and send the request to a Lambda function that records the payment event. Lambda fits because the work is event-like, bounded, and easy to run without managing servers.

HTTP integrations fit services that already speak HTTP. The checkout service might run on ECS and expose `/checkout` behind a load balancer. API Gateway can route the public `POST /checkout` request to that HTTP backend. If the backend is private, API Gateway uses a VPC link, which we will cover soon.

AWS service integrations let API Gateway call supported AWS APIs directly. They can be useful for narrow cases, such as sending a request to SQS or starting a Step Functions workflow without a custom Lambda in the middle. The tradeoff is that request mapping and permissions need careful review, because the API boundary is now directly invoking an AWS service action.

The practical integration habit is to keep the first version boring. Proxy-style Lambda or HTTP integrations preserve the request shape and reduce mapping logic. Request and response transformations are powerful, especially in REST APIs, but heavy mapping can hide problems. A team should add mapping for a clear contract reason, such as removing a stage prefix, shaping a legacy backend response, or enforcing an external API schema.

## Authorizers
<!-- section-summary: Authorizers check caller trust at the API boundary before backend compute, connections, and application code run. -->

An **authorizer** decides whether a caller can invoke an API route. It belongs at the API boundary because caller trust should be checked before the request consumes backend resources. API Gateway supports different authorization patterns depending on API type, including JWT authorizers, Lambda authorizers, IAM authorization, Cognito user pool authorizers, and resource policies.

For the customer routes, a JWT authorizer is a natural fit. JWT means JSON Web Token. The customer signs in through an identity system, receives a token, and sends that token in the `Authorization` header. API Gateway verifies facts such as issuer, audience, expiration, and token claims before the route reaches the backend.

For the payment webhook route, a Lambda authorizer may fit better. Many webhook providers sign the request with a shared secret and place the signature in a header. A Lambda authorizer can read the header, verify the signature, and return an allow or deny decision. The webhook handler still needs idempotency, because providers often retry the same webhook after timeouts or errors.

For internal AWS callers, IAM authorization can be the cleanest option. A signed AWS request uses Signature Version 4, usually called SigV4. API Gateway checks that the caller has `execute-api` permission for the route. This fits service-to-service calls from AWS workloads that already use IAM roles and temporary credentials.

Authorization at API Gateway and authorization inside the backend solve different parts of the problem:

| Layer | Question | Orders example |
| --- | --- | --- |
| API Gateway authorizer | Is this caller trusted for this route? | Does the token come from the customer identity provider? |
| Backend service | Is this caller allowed to use this specific object? | Does this customer own `order-1042`? |
| IAM role | Can this runtime call AWS services? | Can the checkout service write to DynamoDB or send an SQS message? |

That split matters. Passing the authorizer means the caller has a trusted identity or credential for the route. The backend still checks object-level rules, tenant boundaries, payment state, and business permissions.

## Throttling, Usage Plans, and API Keys
<!-- section-summary: Throttling protects downstream systems, while usage plans and API keys help identify and meter REST API clients. -->

**Throttling** controls how quickly API Gateway accepts requests. It protects the application from sudden spikes and gives API owners a way to express traffic expectations. When a caller exceeds a configured limit, API Gateway can return `429 Too Many Requests` before the backend handles the request.

For the orders platform, customer reads may allow high burst traffic during a sale. Partner export routes may need tighter limits because exports are heavier. Payment webhooks may need enough burst room for provider retries, but the webhook handler should still be idempotent so repeated delivery does not double-process a payment.

Throttling exists at several layers. API Gateway has account-level and route or method-level controls depending on API type. REST APIs also support usage plans, which can attach throttling and quota settings to API keys for selected stages and methods. Backend services still need their own limits, timeouts, database connection pools, queue buffers, and retry discipline. API Gateway throttling is the first pressure valve alongside the backend reliability design.

**Usage plans** and **API keys** need a careful explanation. In API Gateway REST APIs, an API key mainly identifies an API client for metering, throttling, and quota rules. It is useful for partner management. For example, `partner-northwind` can have one key and a monthly quota, while `partner-contoso` has a different key and a lower rate limit.

An API key is easy to copy, paste, leak, and reuse. Strong caller trust usually comes from IAM authorization, JWTs, Cognito, Lambda authorizers, mutual TLS, or another real identity mechanism. Then an API key can add client identification and quota management where REST API usage plans are the right tool.

AWS also documents usage-plan throttling and quotas as best-effort targets rather than guaranteed hard ceilings. That means a client may exceed a quota in some cases. If cost control or abuse prevention is critical, combine API Gateway limits with AWS WAF where appropriate, AWS Budgets and alarms, backend limits, and business-level controls.

## Private Integrations and VPC Links
<!-- section-summary: VPC links let API Gateway call private VPC backends while those backends stay off public endpoints. -->

Many production backends should stay private. The orders service might run in ECS tasks inside private subnets behind an internal Application Load Balancer. Customers still need a public HTTPS API, while the service itself can stay away from public load balancers and public IP addresses.

A **private integration** lets API Gateway connect a route to a private resource in a VPC. A **VPC link** is the managed network path API Gateway uses for that private integration. With current API Gateway private integration patterns, a VPC link can connect routes to private resources such as Application Load Balancers, Network Load Balancers, and AWS Cloud Map services, depending on API type and configuration.

The shape for the orders service looks like this in plain terms. Each row has one networking job, from the public API edge to the private service:

| Piece | Job |
| --- | --- |
| Public API Gateway endpoint | Receives `https://api.example.com/orders/1042` |
| Authorizer and throttling | Checks caller and controls request pressure |
| VPC link | Carries allowed API traffic into the VPC path |
| Internal load balancer or Cloud Map service | Finds the private backend service |
| ECS orders service | Runs the business logic and data checks |

This pattern keeps the network boundary cleaner. The backend service stays private. API Gateway provides the public API contract. Security groups, listener rules, health checks, VPC link status, and backend routes still matter because private integration is real networking.

There is another phrase that sounds similar: **private API**. A private REST API is callable only from inside a VPC through an interface VPC endpoint. That is a different design from a public API with a private integration. A public API with a private integration lets external callers reach selected private backend routes through API Gateway. A private API is for internal callers that should access API Gateway privately from a VPC.

## A Small API Configuration
<!-- section-summary: A production API usually starts from a route table, explicit authorization choices, integration targets, logs, and deployment stages. -->

The practical build pass for an API Gateway service usually starts with a short design record before anyone writes infrastructure code. The orders team can write down the public routes, caller types, authorization pattern, backend target, and traffic expectation. That small table prevents the API from growing as a pile of unrelated console clicks.

| Route | API type | Auth | Backend | Notes |
| --- | --- | --- | --- | --- |
| `GET /orders/{orderId}` | HTTP API | JWT authorizer | Lambda or private HTTP service | Backend checks order ownership |
| `POST /checkout` | HTTP API | JWT authorizer | Private checkout service | Use idempotency key for retries |
| `POST /webhooks/payment` | HTTP API or REST API | Lambda authorizer | Lambda function | Verify provider signature |
| `GET /partner/exports/{exportId}` | REST API if usage plans are required | IAM or custom authorizer plus API key | Private export service | Apply partner quota and alarms |

Infrastructure as code keeps the API repeatable. The exact resource names vary by tool, but this small CloudFormation-style example shows the shape of an HTTP API route, Lambda integration, stage, and access logging. The example leaves out some supporting resources, such as the Lambda function and log group definitions, so the important API pieces stay visible.

```yaml
Resources:
  OrdersHttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: orders-api
      ProtocolType: HTTP

  ProdStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref OrdersHttpApi
      StageName: prod
      AutoDeploy: false
      AccessLogSettings:
        DestinationArn: !GetAtt OrdersApiAccessLogs.Arn
        Format: >-
          {"requestId":"$context.requestId","routeKey":"$context.routeKey","status":"$context.status","latency":"$context.responseLatency","integrationLatency":"$context.integrationLatency","error":"$context.error.message"}

  GetOrderIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref OrdersHttpApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetOrderFunction.Arn}/invocations
      PayloadFormatVersion: "2.0"

  GetOrderRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref OrdersHttpApi
      RouteKey: GET /orders/{orderId}
      AuthorizationType: JWT
      AuthorizerId: !Ref CustomerJwtAuthorizer
      Target: !Sub integrations/${GetOrderIntegration}

  GetOrderInvokePermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref GetOrderFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${OrdersHttpApi}/*/GET/orders/*
```

There are a few practical details hiding inside this small example. `AutoDeploy: false` means production changes need an intentional deployment flow. The route has an authorizer attached instead of relying on the Lambda handler alone. The Lambda permission scopes API Gateway invocation to the API route pattern. The access log format includes request ID, route key, status, latency, integration latency, and error message so operators have something useful during the first incident.

A Lambda handler for the route still validates the domain rule. The authorizer can prove the token is valid, but the function checks that the caller can read the requested order:

```json
{
  "routeKey": "GET /orders/{orderId}",
  "pathParameters": {
    "orderId": "order-1042"
  },
  "requestContext": {
    "authorizer": {
      "jwt": {
        "claims": {
          "sub": "customer-991"
        }
      }
    }
  }
}
```

The handler uses `orderId` from the path and `sub` from the authorizer claims. It then loads the order and checks that `customer-991` owns it. That check belongs in the backend because API Gateway cannot know every business rule for every object.

## Observability
<!-- section-summary: API Gateway observability combines access logs, metrics, tracing, CloudTrail, and backend correlation IDs. -->

Observability means the team can explain what happened after a request flows through the API. API Gateway gives several signals, and production teams usually combine them instead of relying on one dashboard.

**Access logs** record one line per request in a format you choose. For HTTP APIs and REST APIs, JSON access logs are usually easier to search than unstructured strings. A useful log line includes request ID, stage, route, status, source IP, user agent, response latency, integration latency, and error message. Avoid logging bearer tokens, API keys, full payment payloads, or customer personal data.

**CloudWatch metrics** show API-level trends. Watch `Count` for traffic volume, `4XXError` for caller-side failures, `5XXError` for service-side failures, `Latency` for total API time, and `IntegrationLatency` for backend time. If total latency rises but integration latency stays flat, the issue may sit in API Gateway overhead, authorization, client behavior, or edge conditions. If integration latency rises, the backend handoff deserves attention.

**Execution logs** exist for REST APIs and can help during deeper debugging, but they can get noisy and may expose sensitive data if configured carelessly. Access logs are usually the steady production signal. Execution logs are often a targeted troubleshooting tool.

**Tracing** with AWS X-Ray can connect API Gateway to downstream Lambda functions and services where supported. Tracing helps when one request crosses API Gateway, Lambda, service calls, and databases. The trace tells the team where the time went instead of forcing everyone to compare timestamps by hand.

**CloudTrail** records management-plane API Gateway activity, such as who changed an API, stage, deployment, or configuration. CloudTrail is useful when an API behavior changed and the team needs to know whether a deployment, route update, authorizer change, or stage setting caused it.

The practical production habit is to define alarms around symptoms callers feel. A high `5XXError` rate, sustained `Latency`, high `IntegrationLatency`, or sudden `429` spike should page or notify the owning team. Logs should let the team search by `requestId` and route key. Backend logs should include the API Gateway request ID or a propagated correlation ID so one request can be followed across the boundary.

## When ALB or Lambda Function URLs Are Simpler
<!-- section-summary: API Gateway earns its place for API management; ALB and Lambda Function URLs can be cleaner for narrower ingress jobs. -->

API Gateway is powerful. The best architecture uses it for the jobs it is good at, and some workloads need an HTTP entry point without a full API management layer.

An **Application Load Balancer**, or ALB, is often the direct fit for web services running on ECS, EKS, or EC2. ALB listeners receive HTTP or HTTPS traffic, listener rules route requests to target groups, and target groups send traffic to registered backends. If the orders platform only needs normal web traffic to containers, path-based routing, TLS termination, health checks, and load balancing, ALB may be the simpler front door.

API Gateway is stronger when the API boundary needs route-level authorizers, usage plans, API keys, request validation, stage-based API deployment, WebSocket routes, direct Lambda integrations, direct AWS service integrations, or a managed public API facade over private services. Those are API-management concerns, not just load-balancing concerns.

**Lambda Function URLs** are another small option. A function URL gives one Lambda function a dedicated HTTPS endpoint. It fits narrow internal tools, simple webhooks, prototypes, or single-function services where one function endpoint is enough. It has fewer API management features than API Gateway, so the application may need to carry more of the routing, authorization, throttling, and observability work itself.

A simple decision table helps during design review. It keeps the team focused on the ingress job instead of the service name:

| Need | Good starting point |
| --- | --- |
| One Lambda function needs a direct HTTPS endpoint | Lambda Function URL |
| Container web service needs HTTP load balancing and health checks | Application Load Balancer |
| Public API needs route-level auth, stages, throttling, and logs | API Gateway |
| Partner API needs API keys and usage plans | API Gateway REST API |
| Browser or mobile API needs JWT auth and Lambda or HTTP routes | API Gateway HTTP API |
| Live two-way client communication | API Gateway WebSocket API |

The point is to choose the smallest boundary that still covers the real production requirements. If the requirements grow into API management, API Gateway has a clear role. If the requirements are just "send HTTPS traffic to this web service," ALB can keep the system easier to operate.

## Putting It All Together
<!-- section-summary: API Gateway gives the orders platform a stable API contract while each route connects to the right backend and control set. -->

The orders platform needed a managed boundary for several different callers. Customers call order and checkout routes. A payment provider calls a signed webhook route. A partner calls export routes with traffic expectations. Some work runs in Lambda. Some work runs inside a private VPC. Operators need logs, metrics, alarms, and deployment stages so production behavior can be explained.

API Gateway handles that boundary. The **API** is the caller-facing contract. **Routes** connect methods and paths to intent. **Stages** make deployed states visible. **Integrations** hand requests to Lambda, HTTP services, private VPC backends, or AWS services. **Authorizers** check caller trust before backend work starts. **Throttling** protects downstream systems from request pressure. **Usage plans and API keys** help meter REST API clients, with the caution that API keys are client identifiers rather than strong authentication. **VPC links** let selected API routes reach private services without exposing those services directly.

The healthy shape is a clear split. API Gateway owns the first API decision. The backend owns business correctness. Observability connects both sides with logs, metrics, traces, request IDs, and alarms. Once that boundary exists, the next integration question appears naturally: what happens to work that should continue after the API responds?

## What's Next

Checkout can answer the customer before every side effect finishes. Receipt email, export generation, fraud review, search indexing, and vendor retries need a place to wait safely after the API accepts the request. The next article covers messaging with SQS and SNS, where work can move through queues and topics instead of staying inside the caller's request.

---

**References**

- [What is Amazon API Gateway?](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html) - Defines API Gateway as a service for creating, publishing, maintaining, monitoring, and securing REST, HTTP, and WebSocket APIs.
- [Amazon API Gateway concepts](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-basic-concept.html) - Explains API Gateway concepts such as REST APIs, HTTP APIs, WebSocket APIs, deployments, stages, routes, API keys, and integrations.
- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html) - Documents the feature differences between REST APIs and HTTP APIs, including API keys, per-client throttling, request validation, AWS WAF, and private endpoints.
- [Create routes for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html) - Defines HTTP API routes as method and path mappings such as `GET /pets`.
- [Stages for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-stages.html) - Describes stages as named lifecycle references for deployed APIs.
- [Control access to HTTP APIs with JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html) - Explains JWT authorizers for HTTP APIs.
- [Use API Gateway Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html) - Explains Lambda authorizers for custom authorization logic.
- [Control access to HTTP APIs with IAM authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html) - Documents SigV4 and `execute-api` permission requirements for IAM-authorized routes.
- [Usage plans and API keys for REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html) - Documents usage plans, API keys, best practices, and best-effort quota behavior.
- [Throttle requests to REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html) - Explains API Gateway throttling and quota behavior.
- [Create private integrations for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html) - Documents HTTP API private integrations through VPC links to private backends.
- [Private integrations for REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/private-integration.html) - Documents REST API private integrations and VPC link support.
- [Set up VPC links V2](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-links-v2.html) - Explains VPC links for connecting API routes to private VPC resources such as load balancers and ECS applications.
- [Configure logging for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html) - Shows how HTTP API access logging is configured.
- [Amazon API Gateway metrics and dimensions](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-metrics-and-dimensions.html) - Documents CloudWatch metrics such as `Count`, `4XXError`, `5XXError`, `Latency`, and `IntegrationLatency`.
- [Variables for access logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-variables-for-access-logging.html) - Lists `$context` variables available in API Gateway access logs.
- [Creating and managing Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html) - Documents Lambda function URLs as HTTPS endpoints for Lambda functions and compares them with API Gateway.
- [What is an Application Load Balancer?](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) - Explains ALB listeners, listener rules, and routing to registered targets.
