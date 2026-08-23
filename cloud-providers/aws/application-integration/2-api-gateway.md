---
title: "Amazon API Gateway"
description: "Learn how API Gateway separates public contracts from backends, applies security and traffic policies, and integrates HTTP or WebSocket clients with AWS capabilities."
overview: "Build a first-principles model of routes, integrations, stages, API types, permissions, throttling, logging, transformations, private backends, and synchronous-to-asynchronous handoffs."
tags: ["aws", "api-gateway", "http-api", "rest-api", "websocket", "application-integration"]
order: 2
id: article-cloud-providers-aws-application-integration-api-gateway
aliases:
  - api-gateway
  - 1-api-gateway
  - 2-api-gateway
  - amazon-api-gateway
  - cloud-providers/aws/application-integration/api-gateway.md
  - cloud-providers/aws/application-integration/1-api-gateway.md
  - cloud-providers/aws/application-integration/2-api-gateway.md
---

## Table of Contents

1. [Why Do Applications Need an API Boundary?](#why-do-applications-need-an-api-boundary)
2. [How Does One Request Move Through API Gateway?](#how-does-one-request-move-through-api-gateway)
3. [How Do HTTP, REST, and WebSocket APIs Differ?](#how-do-http-rest-and-websocket-apis-differ)
4. [How Can API Gateway Call AWS Services Directly?](#how-can-api-gateway-call-aws-services-directly)
5. [How Do Throttling, Logs, and Transformations Protect the Boundary?](#how-do-throttling-logs-and-transformations-protect-the-boundary)
6. [How Does API Gateway Reach a Private Backend?](#how-does-api-gateway-reach-a-private-backend)
7. [How Do You Follow a Request from Client to EventBridge?](#how-do-you-follow-a-request-from-client-to-eventbridge)
8. [How Do You Choose an API Gateway Design?](#how-do-you-choose-an-api-gateway-design)
9. [References](#references)

A client can begin with a simple request such as `POST https://my-server.example.com/orders`. As the application grows, that endpoint has to answer more than where the server is. It must identify and authorize callers, route different operations, protect backends from excess traffic, expose new versions without breaking old clients, log requests, and sometimes invoke something that is not an HTTP server at all.

Amazon API Gateway addresses that boundary. It accepts HTTP or WebSocket traffic, applies API policies, selects a backend capability, invokes it, and returns or delivers the result. AWS often describes it as a front door; a more precise first-principles definition is: **API Gateway is a managed boundary between callers and backend capabilities.**

The sections below answer these questions in order:

1. **Why Do Applications Need an API Boundary?**
2. **How Does One Request Move Through API Gateway?**
3. **How Do HTTP, REST, and WebSocket APIs Differ?**
4. **How Can API Gateway Call AWS Services Directly?**
5. **How Do Throttling, Logs, and Transformations Protect the Boundary?**
6. **How Does API Gateway Reach a Private Backend?**
7. **How Do You Follow a Request from Client to EventBridge?**
8. **How Do You Choose an API Gateway Design?**

## Why Do Applications Need an API Boundary?
<!-- section-summary: API Gateway keeps the external contract stable while routing to changing backends and applying shared security and operational policies. -->

Suppose three backend operations are implemented as separate functions:

```text
createOrder()
getOrder()
cancelOrder()
```

Exposing each implementation independently forces clients to know the internal layout:

```text
client
  ├── knows the create function's endpoint
  ├── knows the read function's endpoint
  └── knows the cancellation function's endpoint
```

That implementation knowledge becomes part of the client contract. Renaming a function, moving one operation to containers, or coordinating cancellation through a workflow can break clients.

API Gateway provides one external vocabulary:

```text
                         API Gateway
                              |
          +-------------------+-------------------+
          |                   |                   |
   POST /orders       GET /orders/{id}   DELETE /orders/{id}
          |                   |                   |
          v                   v                   v
       Lambda            ECS service       Step Functions
```

Clients understand `https://api.example.com` and its documented operations. The internal implementation can change independently as long as the API contract remains compatible.

This separation has four dimensions:

1. **Protocol boundary:** HTTP or WebSocket traffic becomes a Lambda invocation, HTTP request, or AWS service operation.
2. **Contract boundary:** Public routes remain stable while internal implementations evolve.
3. **Security boundary:** Caller identity and permission are checked before access to a controlled capability.
4. **Operational boundary:** Uncontrolled traffic becomes throttled, logged, observable traffic.

Most API Gateway features can also be grouped under three jobs.

### Routing chooses the capability

Given `POST /orders`, which backend should receive the operation? Routing connects the public method and path to the intended handling path.

### Mediation adapts the caller to the backend

The caller may speak HTTP while the backend expects a Lambda event or an AWS API call:

```text
HTTP request -> API Gateway -> Lambda invocation
HTTP request -> API Gateway -> EventBridge PutEvents
```

The second path needs no web server solely to translate the protocol.

### Policy enforcement protects the boundary

Authentication, authorization, throttling, CORS, TLS, logging, and selected request or response transformations can be applied at the shared entry point instead of being reimplemented inconsistently by every backend.

The gateway does not remove all application responsibility. Backends still enforce business rules, validate domain state, produce safe errors, and authorize operations that depend on resource ownership or data. The boundary handles the cross-cutting API concerns that belong before the backend capability.

## How Does One Request Move Through API Gateway?
<!-- section-summary: API Gateway receives a request, chooses its stage and route, applies policy, invokes an integration, records evidence, and returns the result. -->

Consider a caller publishing an order event:

```http
POST /publish/orders/OrderCreated
Content-Type: application/json

{
  "orderId": "o-123",
  "total": 42
}
```

Conceptually, the request moves through this pipeline:

```text
                         API Gateway
                 +-------------------------+
Client --------> | 1. Receive request      |
                 | 2. Select stage         |
                 | 3. Match route          |
                 | 4. Authorize caller     |
                 | 5. Apply throttling     |
                 | 6. Transform if needed  |
                 | 7. Invoke integration   |
                 | 8. Write access log     |
                 +------------+------------+
                              |
                              v
                 Lambda / HTTP / AWS service
```

The exact order and available controls depend on the API type and configuration, but this flow contains the core vocabulary.

The gateway first terminates the managed HTTPS connection and identifies the API and stage. It matches the HTTP method and path to a route. An authorizer or IAM configuration may authenticate the caller and determine whether the route can be invoked. Throttling evaluates whether the request fits the allowed traffic rate and burst behavior. Mapping can adapt parameters or payloads. The chosen integration invokes the backend using its own permission relationship. Finally, access logging records evidence such as request ID, route, status, and latency.

This separation makes failure diagnosis more precise. A `401` can indicate caller authentication failure. A `403` can indicate insufficient permission. A `429` means the gateway throttled traffic. A `5xx` may come from the gateway-to-backend path or the backend itself. Logging the request and integration context lets the team distinguish those cases.

### What Are Routes, Integrations, Deployments, and Stages?
<!-- section-summary: Routes name incoming request patterns, integrations name backend actions, deployments snapshot configuration, and stages expose lifecycle versions. -->

These four objects answer different questions:

```text
ROUTE       = Which incoming request pattern matches?
INTEGRATION = Which backend action handles that route?
DEPLOYMENT  = Which snapshot of API configuration exists?
STAGE       = Which deployed lifecycle version is exposed?
```

#### A route matches the public request

An HTTP API route combines an HTTP method and path:

```text
GET  /orders
GET  /orders/{id}
POST /orders
POST /publish/{source}/{detailType}
```

`POST /orders` is a route key. API Gateway selects the most specific route that matches an incoming request. HTTP APIs also support greedy path variables such as `{proxy+}` and a `$default` catch-all route.

```text
Incoming POST /orders
          |
          v
+----------------------+------------------+
| GET /orders          | backend A        |
| GET /orders/{id}     | backend B        |
| POST /orders         | backend C  <---- |
| DELETE /orders/{id}  | backend D        |
+----------------------+------------------+
```

REST APIs use the terms **resource** and **method** for a similar model:

```text
Resource: /orders
Methods:  GET, POST
```

Do not let the terminology hide the underlying relationship: a request pattern maps to a backend operation.

#### An integration defines the backend action

The route describes the frontend vocabulary. The integration describes the backend vocabulary:

```text
POST /orders          -> Lambda createOrder
GET /orders/{id}      -> HTTP service
POST /jobs            -> SQS SendMessage
POST /workflows       -> Step Functions StartExecution
```

An integration can target a Lambda function, public HTTP service, private load balancer, supported AWS service operation, or other API-type-specific backend. For HTTP APIs, AWS supports Lambda proxy, HTTP proxy, direct AWS service, and private integrations.

The route points to an integration identifier. This indirection lets the public contract remain readable and stable while the internal handling mechanism changes.

#### A deployment captures API configuration

A deployment is a snapshot of API configuration. It represents a particular set of routes, integrations, and related settings that can be exposed through a stage.

#### A stage exposes a lifecycle version

Stages can represent environments or lifecycle states such as `dev`, `test`, `beta`, and `prod`:

```text
API configuration
       |
       +-- deployment A <- dev stage
       |
       +-- deployment B <- prod stage
```

A stage name can appear in the URL:

```text
https://abc123.execute-api.eu-west-1.amazonaws.com/dev/orders
https://abc123.execute-api.eu-west-1.amazonaws.com/prod/orders
```

HTTP APIs also support a `$default` stage, which serves routes directly from the root API URL. HTTP API stages can automatically deploy configuration changes when configured to do so.

For one operation, the compact model is:

```text
Route       POST /orders
Integration Lambda createOrder
Stage       prod
```

For two stages using different implementation snapshots:

```text
                           API
                 +----------+----------+
                 |                     |
              dev stage             prod stage
                 |                     |
          POST /orders route    POST /orders route
                 |                     |
          createOrder-v2         createOrder-v5
             integration           integration
```

## How Do HTTP, REST, and WebSocket APIs Differ?
<!-- section-summary: HTTP APIs provide streamlined HTTP routing, REST APIs add richer API-management controls, and WebSocket APIs maintain bidirectional connections. -->

API Gateway has product names that can confuse beginners:

```text
API Gateway HTTP API
API Gateway REST API
API Gateway WebSocket API
```

Both HTTP APIs and REST APIs can expose REST-style HTTP resources. "HTTP API" does not mean HTTP rather than REST. It identifies the streamlined, lower-cost API Gateway choice. REST API identifies the broader API-management feature set.

### Start with an HTTP API for straightforward HTTP needs

HTTP APIs provide method-and-path routing, Lambda and HTTP backends, IAM authorization, native JWT authorizers, Lambda authorizers, CORS support, access logging, automatic deployments, AWS service integrations, and private backend integrations through VPC Link.

A practical default is to begin with an HTTP API unless a known requirement belongs to REST APIs. A typical JWT-protected Lambda or container API with ordinary CORS and route throttles often fits an HTTP API.

### Choose a REST API for richer management features

REST APIs add capabilities that can drive the choice, including API keys and usage plans, per-client throttling, request validation, API Gateway caching, AWS WAF integration, execution logging, X-Ray integration, and private API endpoints. They use resources and methods rather than HTTP API route terminology.

The raw feature boundary can be summarized as follows:

| Capability | HTTP API | REST API |
| --- | :---: | :---: |
| Normal HTTP routing | Yes | Yes |
| Lambda and public HTTP backends | Yes | Yes |
| IAM authorization | Yes | Yes |
| Lambda authorizer | Yes | Yes |
| Native JWT authorizer | Yes | No native equivalent |
| Built-in CORS support | Yes | Yes |
| Automatic deployments | Yes | No equivalent mode |
| API keys and usage plans | No | Yes |
| Per-client throttling | No | Yes |
| Request validation | No | Yes |
| API Gateway caching | No | Yes |
| AWS WAF integration | No | Yes |
| Execution logs | No | Yes |
| X-Ray tracing | No | Yes |
| Private API endpoint | No | Yes |
| Private backend through VPC Link | Yes | Yes |

The selection rule is not "HTTP API for HTTP and REST API for REST." It is:

```text
Need ordinary routes, JWT, Lambda or HTTP, CORS, and access logs?
-> Start with HTTP API.

Need usage plans, API keys, caching, WAF, request validation,
private API entry, or richer execution visibility?
-> Consider REST API.
```

### Use a WebSocket API for persistent bidirectional communication

An ordinary HTTP exchange follows request and response:

```text
client -- request --> server
client <-- response -- server
```

For chat or another real-time interaction, the server may need to push a message without waiting for the client to poll repeatedly. A WebSocket keeps a bidirectional connection:

```text
Client <======================> Server
          persistent connection
```

API Gateway can manage these connections and route messages with route keys such as `$connect`, `$disconnect`, `$default`, `sendMessage`, and `subscribe`. The backend can send data to a connected client after the initial connection is established.

The three choices therefore correspond roughly to:

```text
HTTP API      -> streamlined synchronous HTTP APIs
REST API      -> synchronous APIs with richer management controls
WebSocket API -> persistent bidirectional communication
```

## How Can API Gateway Call AWS Services Directly?
<!-- section-summary: An AWS service integration maps the public HTTP contract directly to a supported AWS operation, avoiding translation code that adds no business logic. -->

API Gateway is a protocol adapter. An external developer can understand:

```http
POST /publish/orders/OrderCreated
```

while the internal platform uses EventBridge's `PutEvents` operation. API Gateway can map the public HTTP request into that AWS service call:

```text
External caller
POST /publish/orders/OrderCreated
{"orderId":"o-123"}
             |
             v
        API Gateway
   HTTP -> AWS API mapping
             |
             v
EventBridge PutEvents(
  Source="orders",
  DetailType="OrderCreated",
  Detail="{...}"
)
```

The client does not need to know that EventBridge exists, and a Lambda function is not required merely to rename fields and call `PutEvents`.

### Build the public publish contract

Use this route:

```text
POST /publish/{source}/{detailType}
```

For the request:

```http
POST /publish/orders/OrderCreated
Content-Type: application/json

{
  "orderId": "o-123",
  "customerId": "c-44",
  "total": 42
}
```

the mapping is:

```text
HTTP source path value       orders       -> EventBridge Source
HTTP detailType path value   OrderCreated -> EventBridge DetailType
HTTP request body            JSON         -> EventBridge Detail
```

The API configuration is conceptually:

```text
API
└── $default stage
    └── POST /publish/{source}/{detailType}
            └── EventBridge-PutEvents integration
```

HTTP APIs provide first-class AWS service integration subtypes that include EventBridge `PutEvents`, SQS `SendMessage`, Kinesis `PutRecord`, and Step Functions `StartExecution`.

### Call and inspect the route

If the API endpoint is:

```text
https://a1b2c3d4.execute-api.eu-west-1.amazonaws.com
```

a client can send:

```bash
curl -i \
  -X POST \
  'https://a1b2c3d4.execute-api.eu-west-1.amazonaws.com/publish/orders/OrderCreated' \
  -H 'content-type: application/json' \
  -d '{
    "orderId": "o-123",
    "customerId": "c-44",
    "total": 42
  }'
```

API Gateway matches the method and path, extracts `orders` and `OrderCreated`, constructs the integration call, and invokes EventBridge.

HTTP API routes can be inspected with:

```bash
aws apigatewayv2 get-routes \
  --api-id <api-id>
```

The output relates a route key such as `POST /publish/{source}/{detailType}` to a target such as `integrations/abc123`. The route remains public vocabulary; the integration identifier leads to the backend definition.

Direct integration is most useful when the gateway mapping fully expresses the handoff and no custom business logic is needed before the AWS action. Add a compute layer when the request requires domain validation, state access, complex authorization, or behavior that should be owned and tested as application code.

### How Do Authentication and Backend Permissions Stay Separate?
<!-- section-summary: A caller proves who it is and may invoke a route, while API Gateway separately receives permission to invoke the backend capability. -->

Authentication answers **who are you?** Authorization answers **may you perform this operation?** A verified token can establish that the caller is Alice, while route authorization determines that Alice may read an order but not delete it.

HTTP APIs support IAM authorization, JWT authorizers, and Lambda authorizers.

#### JWT authorization fits users and OAuth or OIDC clients

A user can sign in through Amazon Cognito, Auth0, Okta, or another compatible identity provider and receive a JSON Web Token. The client sends:

```http
Authorization: Bearer eyJhbGciOi...
```

API Gateway validates relevant token properties such as the signature, issuer, audience, and scopes according to the authorizer. A valid token can proceed to the route. An invalid or unauthorized request receives a `401` or `403` response as appropriate.

Central validation avoids separately implementing the same token-verification plumbing in every backend route. The backend can still use verified claims to enforce resource-specific business authorization.

#### IAM authorization fits AWS workload callers

A Lambda function, ECS task, AWS CLI user, or another AWS principal can sign a request using Signature Version 4 or 4A. Its identity policy needs `execute-api:Invoke` permission for the relevant API resources. API Gateway verifies the signed request and IAM decision.

#### Caller and backend authorization are two locks

Consider the direct EventBridge path:

```text
Alice -> API Gateway -> EventBridge
```

Two independent questions exist:

1. Can Alice invoke the API route?
2. Can API Gateway call `events:PutEvents` on the selected event bus?

The first relationship is controlled by JWT, IAM, a Lambda authorizer, or another route-access configuration. The second is typically controlled by an IAM role that API Gateway can assume:

```text
Role: ApiGatewayEventPublisher
Trust: apigateway.amazonaws.com
Permission: events:PutEvents
Resource: selected event bus
```

The client needs permission to call the route. It does not need direct `events:PutEvents` permission. This lets the API expose a narrow business capability without handing callers raw access to the underlying AWS service.

#### Lambda and downstream services add more permission arrows

For a Lambda integration, the function generally has a resource-based permission allowing API Gateway to invoke it. Console setup may add this automatically; command-line, SDK, or infrastructure-as-code setup must ensure the permission exists.

If the function then writes DynamoDB, the full path contains three separate relationships:

```text
1. Client -> API Gateway
   May this principal invoke POST /orders?

2. API Gateway -> Lambda
   May this API invoke the function?

3. Lambda -> DynamoDB
   May the function role write this table?
```

Debugging "access denied" requires identifying which arrow failed rather than adding broad permissions to every role.

#### API keys identify consumers but are not strong authentication

REST APIs support API keys and usage plans. These are best understood as client identification, metering, and usage management. One partner key might receive a 10-request-per-second target and monthly quota, while another receives a larger plan.

An API key is not equivalent to a password or proof of identity. It can be combined with real authorization. AWS also describes usage-plan throttles and quotas as best-effort targets, not hard security or cost-control boundaries.

## How Do Throttling, Logs, and Transformations Protect the Boundary?
<!-- section-summary: Throttling absorbs bursts, access logs correlate requests, and mappings keep public and internal representations independent. -->

An API boundary has to manage both normal operation and failure evidence.

### Token-bucket throttling separates burst from sustained rate

If a backend handles roughly 1,000 requests per second and receives 100,000, the system can enter an overload and retry spiral. API Gateway can throttle before excess requests reach the backend.

Its token-bucket model can be imagined as a bucket of request permissions:

```text
tokens refill at configured rate
             |
       +------------+
       | ● ● ● ● ●  |
       +------------+
             |
    each request consumes one
```

**Rate** describes how quickly tokens return and therefore the approximate sustained flow. **Burst** describes how many tokens can accumulate for a short spike. If the configured rate is 100 per second and burst capacity is 200, an uneven burst can use the accumulated capacity while long-running traffic remains controlled around the refill rate.

```text
burst = short-term shock absorber
rate  = long-term flow target
```

When capacity is unavailable, the gateway can return `429 Too Many Requests`. API Gateway throttling targets are best effort rather than absolute ceilings.

HTTP APIs can configure throttling at stage and route levels. REST APIs additionally support account, stage/method, and usage-plan/per-client controls, which can distinguish partner or customer traffic plans.

### Access logs create one correlated record per request

When a path is `Client -> API Gateway -> Lambda -> DynamoDB`, a report that "the request failed around 14:03" is difficult to trace. API Gateway access logging can create a structured record:

```json
{
  "requestId": "abc123",
  "method": "POST",
  "route": "POST /orders",
  "status": 500,
  "sourceIp": "203.0.113.7"
}
```

Useful fields include request ID, timestamp, route, method, response status, latency, source, response size, and integration error context. Do not log secrets such as bearer tokens.

The request ID supports correlation across boundaries:

```text
API Gateway log requestId=abc123
                |
Lambda log      requestId=abc123
                |
application log requestId=abc123
```

At scale, this identifier is more reliable than trying to align timestamps manually.

Access logs provide one summary per request. REST API execution logging can provide more detail about internal processing. Both HTTP and REST APIs support access logs, while execution logs and native X-Ray integration belong to the REST API feature set in the source comparison.

### Transformations separate external and internal representations

A client might send:

```json
{
  "customer": "123",
  "amount": 42
}
```

while the backend expects:

```json
{
  "customerId": "123",
  "orderTotal": 42
}
```

A proxy-style integration passes most of the public representation to the backend, which understands that contract. A mapping-style integration adapts the representation at API Gateway. REST APIs provide especially rich request and response mappings. HTTP APIs deliberately expose a smaller surface but support parameter mapping and integration parameters for their AWS service integrations.

Mapping is useful when it cleanly mediates protocols and field shapes. Excessively complex business transformation at the gateway can become difficult to test and maintain; that logic may belong in an application service.

## How Does API Gateway Reach a Private Backend?
<!-- section-summary: A VPC Link provides private backend connectivity, while a private REST API makes the API entry point itself reachable only through private networking. -->

An ECS service may run in private subnets with no public address. That is desirable, but the managed API Gateway service still needs a private route to it. A **VPC Link** creates managed connectivity between API Gateway and selected resources in the application's VPC:

```text
Internet client
      |
      v
Public API Gateway endpoint
      |
      | VPC Link
      v
+---------------------------+
| Application VPC           |
| private ALB -> ECS service |
+---------------------------+
```

API Gateway manages network interfaces for the VPC Link in the chosen VPC networking configuration. VPC Links V2 are available for both HTTP APIs and REST APIs.

For HTTP APIs, a private integration can reach an Application Load Balancer, Network Load Balancer, or AWS Cloud Map service through a VPC Link. A common design is:

```text
Client -> API Gateway -> VPC Link -> private ALB -> ECS services
```

API Gateway owns the API contract, caller policy, throttling, and access logs. ALB distributes traffic among healthy application targets inside the VPC.

Older guidance may say that a REST API private integration requires an NLB. That is incomplete for the current source material. VPC Links V2 support REST API private integration with Application Load Balancers, and AWS recommends V2 for new links.

### A private backend is not the same as a private API

In the design above, the API entry point is public while the backend remains private:

```text
Internet -> public API Gateway -> VPC Link -> private backend
```

A **private API** solves a different problem. The API Gateway entry point itself is not reachable from the public internet:

```text
Internet   X

VPC or connected corporate network
        |
        v
interface VPC endpoint
        |
        v
private API Gateway REST API
```

API Gateway private API endpoints are a REST API capability and are reached through interface VPC endpoints powered by AWS PrivateLink. HTTP APIs can privately integrate with a backend but do not provide the same private API endpoint type.

Remember the distinction:

```text
private integration = the backend path is private
private API         = the API entry point is private
```

### How Does API Gateway Fit with Other AWS Services?
<!-- section-summary: API Gateway owns controlled ingress, while queues, topics, event buses, workflows, load balancers, and CDNs own different downstream or delivery concerns. -->

API Gateway is commonly the ingress layer. Other application-integration services can provide asynchronous handoff and distribution after the request enters:

```text
Internet or apps -> API Gateway -> Lambda / ECS / AWS service
                                      |
                                      +-> SQS
                                      +-> SNS
                                      +-> EventBridge
```

#### API Gateway and SQS

API Gateway receives a request from a caller that expects an HTTP response. SQS stores a message until a consumer processes it later. They combine when a client needs quick acknowledgement but the work is slow:

```text
Client -> POST /jobs -> API Gateway -> SQS -> later worker
             |
             +<-- 202 Accepted
```

The response confirms that the handoff was accepted, not that the business job finished.

#### API Gateway and EventBridge

API Gateway asks how an external caller invokes a controlled capability. EventBridge asks which targets should receive a fact that happened. A checkout API can accept the request, while the application later publishes `OrderCreated` for inventory, analytics, email, and fraud rules.

#### API Gateway and SNS

API Gateway provides a controlled caller-to-backend boundary. SNS provides one-to-many publish-subscribe delivery. A direct AWS integration can turn an external HTTP request into an SNS publication when that contract is appropriate.

#### API Gateway and Step Functions

Step Functions stores and orchestrates a process such as validate, charge, reserve, and notify. API Gateway can expose the operation that starts that process. HTTP APIs support a first-class `StepFunctions-StartExecution` integration.

#### API Gateway and Application Load Balancer

Both understand HTTP, but their first questions differ:

```text
ALB:
Which healthy target should receive this network or application request?

API Gateway:
What is the API contract, who may invoke it, which backend capability
does it map to, and which API policies apply?
```

ALB focuses on load distribution, target health, and host or path routing to applications. API Gateway adds API routes, authorization, lifecycle stages, throttling, transformations, AWS service integrations, WebSocket connection management, and other API-management features. They are complementary in `API Gateway -> VPC Link -> ALB -> ECS`.

#### API Gateway and CloudFront

CloudFront distributes and caches content closer to users. API Gateway exposes and controls application operations. An architecture can put CloudFront before API Gateway when each layer has a deliberate responsibility.

#### Synchronous ingress can lead to asynchronous work

API Gateway-to-Lambda or API Gateway-to-HTTP normally uses a synchronous request-response relationship. API Gateway can also bridge that synchronous client request into SQS, SNS, or EventBridge for asynchronous downstream processing:

```text
HTTP caller -> API Gateway -> queue or event bus -> later consumer
```

The boundary returns an acknowledgement while the consumer works independently.

## How Do You Follow a Request from Client to EventBridge?
<!-- section-summary: One publish request crosses connection, stage, route, caller authorization, throttling, mapping, backend authorization, service invocation, response, and logging. -->

Follow the sample request all the way through:

```http
POST /publish/orders/OrderCreated
Authorization: Bearer eyJ...
Content-Type: application/json

{
  "orderId": "o-123"
}
```

### 1. The client reaches the managed HTTPS endpoint

TLS terminates at the API boundary:

```text
Client -- HTTPS --> API Gateway endpoint
```

### 2. API Gateway selects a stage

The request may target `$default` or a named stage such as `prod`, depending on the URL and API configuration.

### 3. The route matches

API Gateway matches:

```text
POST /publish/{source}/{detailType}
```

and extracts:

```text
source     = orders
detailType = OrderCreated
```

### 4. The gateway authorizes the caller

A configured JWT authorizer validates the bearer token and any required scopes. Failure returns an authorization error before the backend operation is attempted.

### 5. Throttling evaluates traffic

The route or stage traffic must fit the available rate and burst capacity. Excess traffic can receive `429 Too Many Requests` without overloading EventBridge or another backend.

### 6. Integration mapping constructs the AWS call

The gateway creates an EventBridge request equivalent to:

```text
Source:     orders
DetailType: OrderCreated
Detail:     {"orderId":"o-123"}
```

### 7. API Gateway uses backend credentials

It assumes the configured integration role, whose narrow permission allows `events:PutEvents` on the designated event bus. The caller's JWT does not directly grant this AWS service action.

### 8. EventBridge accepts and routes the event

Matching EventBridge rules can independently route `OrderCreated` to Lambda, SQS, Step Functions, or other targets.

### 9. The integration response returns to the client

EventBridge's service response is mapped through API Gateway into the HTTP response. The contract should make clear that an accepted publication is not proof that every downstream consumer completed its work.

### 10. Access logs preserve request evidence

The gateway records a request identifier, matched route, status, latency, and configured integration context. That ID can be propagated into later logs and event detail for diagnosis.

The full trust and processing path is:

```text
Client
  |
  | HTTPS + JWT
  v
API Gateway
  | stage
  | route
  | caller authorization
  | throttle
  | access log
  | request mapping
  |
  | assumes integration role
  | events:PutEvents
  v
EventBridge
  |
  +--> Lambda
  +--> SQS
  +--> Step Functions
```

## How Do You Choose an API Gateway Design?
<!-- section-summary: Choose the API type, backend integration, caller identity, backend permission, network path, traffic policy, and evidence independently. -->

Begin by asking whether a web, mobile, partner, or service caller needs a controlled API. Then identify the communication type:

```text
Request and response -> HTTP API or REST API
Persistent two-way   -> WebSocket API
```

For request-response APIs, start with HTTP API unless a concrete requirement points to REST API:

```text
Straightforward routes, JWT, CORS, Lambda/HTTP, AWS integration
-> HTTP API

API keys, usage plans, caching, WAF, request validation,
private API entry, execution logs, richer management
-> REST API
```

Choose the backend independently:

| Backend need | Integration direction |
| --- | --- |
| Lambda application code | Lambda integration |
| Public HTTP service | HTTP integration |
| Supported AWS operation | AWS service integration |
| Private ALB, NLB, or service discovery | VPC Link private integration |

Choose who may call the route:

```text
User or application with OAuth/OIDC token -> JWT authorizer
AWS workload                              -> IAM authorization
Custom decision logic                     -> Lambda authorizer
```

Then separately grant the gateway only the backend permissions it requires. For Lambda, confirm invocation permission. For an AWS service integration, create a narrow assumable role. For a private HTTP integration, design the VPC Link and network controls.

Finally, decide:

- Which sustained and burst traffic the backend can tolerate
- Which request IDs, routes, statuses, latency, and integration errors must be logged
- Whether the public and internal payloads need mapping
- Whether the entry point is public even if the backend is private
- Whether the client receives a completed business result or only an asynchronous acceptance

Seven sentences capture the core model:

1. API Gateway is a controlled front door between callers and backend capabilities.
2. A route identifies the incoming request pattern.
3. An integration identifies the backend action.
4. A deployment snapshots API configuration, and a stage exposes a lifecycle version.
5. Caller authorization and gateway-to-backend authorization are separate relationships.
6. HTTP API is streamlined, REST API adds richer API management, and WebSocket API supports persistent bidirectional communication.
7. API Gateway can invoke Lambda, public or private HTTP services, and supported AWS services, including asynchronous handoffs.

:::expand[Why Do Applications Need an API Boundary?]{kind="recap"}
API Gateway keeps the external contract stable while routing to changing backends and applying shared security and operational policies.

The boundary keeps routes and caller expectations stable while backends change. It also centralizes protocol adaptation, caller policy, throttling, and request evidence before traffic reaches controlled capabilities.
:::

:::expand[How Does One Request Move Through API Gateway?]{kind="recap"}
API Gateway receives a request, chooses its stage and route, applies policy, invokes an integration, records evidence, and returns the result.

The gateway receives the request, selects its stage, matches a route, authorizes and throttles the caller, maps the request if needed, invokes the integration with separate backend permission, writes logs, and returns the result.

Routes name incoming request patterns, integrations name backend actions, deployments snapshot configuration, and stages expose lifecycle versions.

A route names the public request pattern. An integration names the backend action. A deployment is a configuration snapshot. A stage exposes a selected lifecycle version or automatically deployed HTTP API configuration.
:::

:::expand[How Do HTTP, REST, and WebSocket APIs Differ?]{kind="recap"}
HTTP APIs provide streamlined HTTP routing, REST APIs add richer API-management controls, and WebSocket APIs maintain bidirectional connections.

HTTP APIs are the streamlined HTTP choice. REST APIs provide additional management features such as usage plans, caching, WAF, request validation, and private API endpoints. WebSocket APIs keep bidirectional connections for server push and ongoing messages.
:::

:::expand[How Can API Gateway Call AWS Services Directly?]{kind="recap"}
An AWS service integration maps the public HTTP contract directly to a supported AWS operation, avoiding translation code that adds no business logic.

An AWS service integration maps path parameters, body data, and other request values into a supported AWS operation such as EventBridge PutEvents or SQS SendMessage. This avoids translation compute when no custom business logic is required.

A caller proves who it is and may invoke a route, while API Gateway separately receives permission to invoke the backend capability.

JWT, IAM, or a Lambda authorizer controls whether the caller may invoke a route. A separate role or resource policy controls whether API Gateway may invoke Lambda, EventBridge, or another backend. Downstream application permissions form additional arrows.
:::

:::expand[How Do Throttling, Logs, and Transformations Protect the Boundary?]{kind="recap"}
Throttling absorbs bursts, access logs correlate requests, and mappings keep public and internal representations independent.

Token-bucket rate and burst settings reduce overload. Structured access logs and request IDs create evidence across services. Mappings adapt the public contract to the backend representation without exposing internal service vocabulary.
:::

:::expand[How Does API Gateway Reach a Private Backend?]{kind="recap"}
A VPC Link provides private backend connectivity, while a private REST API makes the API entry point itself reachable only through private networking.

A VPC Link privately connects the managed gateway to an ALB, NLB, or supported service-discovery target. That private integration can sit behind a public API. A private REST API is different because its entry point is reachable only through private networking and an interface VPC endpoint.

API Gateway owns controlled ingress, while queues, topics, event buses, workflows, load balancers, and CDNs own different downstream or delivery concerns.

API Gateway owns controlled ingress. SQS owns deferred work, SNS owns fanout, EventBridge owns event routing, Step Functions owns process state, ALB distributes to healthy application targets, and CloudFront distributes or caches content near users.
:::

:::expand[How Do You Follow a Request from Client to EventBridge?]{kind="recap"}
One publish request crosses connection, stage, route, caller authorization, throttling, mapping, backend authorization, service invocation, response, and logging.

Confirm the HTTPS entry, stage, route variables, caller authorization, throttle decision, request mapping, integration role, EventBridge acceptance, HTTP response, and correlated access log. Each step has distinct evidence and permissions.
:::

:::expand[How Do You Choose an API Gateway Design?]{kind="recap"}
Choose the API type, backend integration, caller identity, backend permission, network path, traffic policy, and evidence independently.

Choose the API type from the protocol and management needs, the integration from the backend capability, caller authorization from the identity model, backend permission separately, and then define networking, throttling, logging, mapping, and synchronous or asynchronous response meaning.
:::

## References

- [Amazon API Gateway documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)
- [API Gateway documentation: HTTP API routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html)
- [API Gateway documentation: HTTP API integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations.html)
- [API Gateway documentation: HTTP API stages](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-stages.html)
- [API Gateway documentation: Choose between HTTP APIs and REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [API Gateway documentation: Develop REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/rest-api-develop.html)
- [API Gateway documentation: WebSocket API overview](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html)
- [API Gateway documentation: AWS service integration subtypes](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services-reference.html)
- [API Gateway documentation: HTTP API access control](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control.html)
- [API Gateway documentation: IAM permissions](https://docs.aws.amazon.com/apigateway/latest/developerguide/permissions.html)
- [API Gateway documentation: AWS service integration credentials](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services.html)
- [API Gateway documentation: Lambda integration troubleshooting](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-troubleshooting-lambda.html)
- [API Gateway documentation: Usage plans and API keys](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)
- [API Gateway documentation: HTTP API throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html)
- [API Gateway documentation: REST API throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [API Gateway documentation: HTTP API logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html)
- [API Gateway documentation: VPC Links V2](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-vpc-links-v2.html)
- [API Gateway documentation: HTTP API private integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-private.html)
- [API Gateway documentation: REST API private integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/private-integration.html)
