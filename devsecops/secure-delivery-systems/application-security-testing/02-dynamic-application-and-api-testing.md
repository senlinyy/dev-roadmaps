---
title: "Dynamic Application and API Testing"
description: "Learn how DAST and API testing stimulate a running system, measure reachable behavior, and produce safe release evidence from controlled environments."
overview: "Build runtime security testing from first principles: stimulus, deployed system, and observation. Learn how discovery and OpenAPI shape coverage; how passive, active, and authenticated scans differ; why roles and business-aware tests matter; how to contain side effects; and how ZAP evidence becomes a deliberate release decision rather than a misleading green check."
tags: ["devsecops", "dast", "api-security", "owasp"]
order: 2
id: article-devsecops-application-security-testing-dynamic-application-api-testing
---

## Table of Contents

1. [Why Does Security Testing Need a Running System?](#why-does-security-testing-need-a-running-system)
2. [How Does DAST Discover and Exercise an Attack Surface?](#how-does-dast-discover-and-exercise-an-attack-surface)
3. [How Does an API Definition Improve Runtime Coverage?](#how-does-an-api-definition-improve-runtime-coverage)
4. [Why Do Authentication, Roles, and Business Rules Change the Scan?](#why-do-authentication-roles-and-business-rules-change-the-scan)
5. [How Do You Contain the Side Effects of Active Testing?](#how-do-you-contain-the-side-effects-of-active-testing)
6. [How Do You Run ZAP and Turn Findings into Policy?](#how-do-you-run-zap-and-turn-findings-into-policy)
7. [What Can Runtime Testing Prove and What Can It Miss?](#what-can-runtime-testing-prove-and-what-can-it-miss)
8. [What Does a Practical Runtime Security Workflow Look Like?](#what-does-a-practical-runtime-security-workflow-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Static analysis asks questions about a program model. Runtime security testing asks what a deployed system actually does when it receives a carefully chosen request. A useful first-principles model is:

```text
stimulus -> running system -> observation
```

The **stimulus** is an HTTP request, payload, header, authentication state, sequence of actions, or other input. The **system** includes application code plus the configuration and infrastructure around it. The **observation** is the response, state change, timing, error, callback, or other externally visible result.

This matters because a deployed application is more than its source. Reverse proxies route requests. Environment variables enable features. Framework middleware adds headers. Identity providers issue sessions. Gateways rewrite paths. Databases contain real-shaped state. Cloud permissions control downstream behavior. A source scanner can find a dangerous SQL composition pattern, but it cannot always show that one configured route exposes a stack trace, that a cookie lacks a required property, or that customer A can retrieve customer B's object.

Keep these questions in view as you work through the lesson:

1. **Why Does Security Testing Need a Running System?**
2. **How Does DAST Discover and Exercise an Attack Surface?**
3. **How Does an API Definition Improve Runtime Coverage?**
4. **Why Do Authentication, Roles, and Business Rules Change the Scan?**
5. **How Do You Contain the Side Effects of Active Testing?**
6. **How Do You Run ZAP and Turn Findings into Policy?**
7. **What Can Runtime Testing Prove and What Can It Miss?**
8. **What Does a Practical Runtime Security Workflow Look Like?**

## Why Does Security Testing Need a Running System?
<!-- section-summary: Runtime testing observes the real combination of application code, configuration, routing, identity, data, and infrastructure that source analysis cannot execute by itself. -->

**Dynamic application security testing**, or **DAST**, sends requests to a running application and analyzes the resulting behavior. For a web system, the interface is commonly HTTP. The tester may inspect status codes, response bodies, headers, cookies, redirects, caching, error handling, and the effect of unusual input.

DAST differs from ordinary functional testing in its intent and input selection. A functional test asks whether the expected customer workflow succeeds. A security test deliberately explores misuse, boundary conditions, unexpected data, missing authorization, and unsafe protocol behavior. Both use the interface, but they ask different questions.

For example, a normal test may confirm that a signed-in customer can retrieve order `1001`. A security test may send a quote character into a search parameter, request an order owned by another account, change an HTTP method, omit a content type, or supply an oversized value. It observes whether the application preserves its security rules under those stimuli.

Runtime testing does not replace SAST. The two controls observe different evidence:

```text
SAST -> risky relationships visible in code
DAST -> risky behavior reachable through a deployed interface
```

SAST can analyze code paths that the runtime scan never discovers. DAST can reveal configuration and integration behavior the source model cannot reproduce. A dynamic result can sometimes demonstrate exploitability more directly because it shows that a particular stimulus caused an unsafe response. It still cannot prove that no other vulnerability exists.

The timing follows from the evidence requirement. DAST needs a reachable deployment. That normally places it after build and deployment to an isolated test environment, but before promotion to production. The test is strongest when that environment runs the same release artifact and representative configuration intended for the next stage.

Consider what appears only after deployment. A framework may send secure cookies in one environment and omit the flag in another. A proxy may expose an internal error page. Cross-origin rules may be assembled from environment configuration. A gateway may publish a route that is absent from the application repository. A database account may have broader authority than developers assumed. Runtime testing can observe the combined consequence even when no single source file expresses it.

The observation should be reproducible. Record the target version or digest, request, relevant headers and identity, response, time, and environment. “The scanner found injection” is a weak statement. “Against digest D in isolated staging, this request caused this database-backed response under role R” gives a developer something to reproduce and gives the release process evidence it can evaluate.

DAST also changes the meaning of a failure. A unit test commonly knows the internal expected value. An external scanner infers risk from protocol behavior and heuristics. Its result is a hypothesis or experiment outcome that still needs triage, particularly when the application uses unusual encodings or error handling. Directly observed exploitation can raise confidence, but scanner interpretation and business impact remain distinct questions.

_The scanner observes a deployed system, so routing, identity, configuration, data, and external-service boundaries are part of the test._

## How Does DAST Discover and Exercise an Attack Surface?
<!-- section-summary: A dynamic scanner must first discover reachable inputs, then choose passive observations or active payloads that exercise those inputs without confusing discovery with complete coverage. -->

The **attack surface** is the collection of reachable interfaces and operations an attacker can try to influence. For a web application it can include pages, API routes, query parameters, form fields, headers, cookies, file uploads, WebSocket messages, redirects, and authentication flows.

A scanner cannot test an input it does not know exists. Traditional web DAST often begins by crawling pages and following links, forms, and scripts. It may also observe traffic captured while a browser or automated test uses the application. Discovery creates a working map of hosts, routes, methods, parameters, and content types.

Coverage in DAST is not equivalent to line coverage in a unit test. It can mean:

- Which hosts and deployed versions were reached?
- Which routes and HTTP methods were exercised?
- Which parameters and content types received payloads?
- Which authenticated roles and application states were available?
- Which scanner rules ran against which inputs?

A report can be green because the application is safe, or because the scanner only found `/health`. The scan therefore needs coverage evidence as well as findings.

Dynamic checks fall into two broad modes. **Passive scanning** observes ordinary requests and responses without deliberately changing the interaction into an attack. It can report missing security headers, unsafe cookie attributes, information disclosure, or suspicious caching. Passive checks are relatively safe and can accompany functional browser or API traffic.

**Active scanning** modifies requests and sends attack-style inputs. It may try injection characters, traversal sequences, alternate methods, malformed values, duplicate parameters, or unusual encodings. This can provide stronger evidence because the system responds to a security experiment, but the request may create data, trigger errors, fill logs, invoke downstream services, consume rate limits, or damage state.

The distinction is about behavior, not simply tool choice. The same scanner may perform both. A passive scan of production traffic has a different risk than an active scan that submits payloads to production forms.

A production-safe statement must therefore name the scan shape. “We run ZAP in production” is ambiguous. Observing response headers may be acceptable. Actively fuzzing a deletion endpoint with administrator credentials is not. Safety depends on the target, rules, authentication level, rate, data, and side effects.

This naturally creates a testing ladder:

```text
pull request       -> static and contract checks
test deployment    -> fast passive or constrained runtime checks
disposable staging -> authenticated active scan and stateful experiments
scheduled window   -> broader, slower runtime coverage
production         -> tightly controlled passive observation and monitoring
```

Not every team needs every rung immediately. The essential idea is to increase realism only while preserving control. Faster, safer checks can run frequently. Broader active scans run where state can be reset and downstream effects are contained.

Discovery can combine several sources. A crawler follows reachable pages. A proxy records routes used by browser automation. An API definition lists structured operations. A seed URL points at a hidden entry point. Authenticated exploration reveals links or calls unavailable to a public session. Comparing these inventories often reveals that one method alone was incomplete.

Active payload selection also affects coverage. Sending one quote character to every parameter is not equivalent to testing the parameter's interpreter and context. SQL, shell, template, path, XML, and browser output sinks have different failure modes. Tools group rules and payloads around known classes, while the scan plan decides which groups are permitted at this target.

Observe state changes as well as responses. A `200` response may hide an unintended database update, and a `500` may have queued a message before failing. Where the application exposes safe test hooks, compare seeded state before and after a run. Logs from the application and fake downstream services can show callbacks or commands that the immediate HTTP body does not reveal.

## How Does an API Definition Improve Runtime Coverage?
<!-- section-summary: An OpenAPI document gives a scanner a machine-readable route and schema map, but it improves discovery only when it matches the deployed service and does not itself prove security. -->

APIs create a discovery problem. A browser-facing site exposes links that a crawler can follow. An API client may already know that `/orders/{orderId}` exists, so the server has no page linking to it. An unaided crawler can miss most of the interface.

An **OpenAPI definition** is a machine-readable description of an HTTP API. It can name paths, methods, path and query parameters, request bodies, response schemas, content types, and authentication schemes. Importing it gives an API-aware scanner a much better map.

```yaml
openapi: 3.0.3
info:
  title: Orders API
  version: "1.0"
paths:
  /api/orders/{orderId}:
    get:
      security:
        - bearerAuth: []
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Order details
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

The scanner now knows that the path contains an `orderId`, that `GET` is supported, and that the route declares bearer authentication. It can construct requests instead of guessing URLs. A more complete schema can give it valid body shapes and parameter types before it mutates those inputs into security experiments.

The definition solves discovery, not security. A route declaration does not prove that the implementation authorizes access correctly. A schema does not prove the server rejects undocumented fields. A declared security scheme does not prove authentication succeeds or that every operation applies it.

Freshness is critical. If the deployed service adds `/api/refunds/{refundId}` but the imported document omits it, the scanner never tests that route. If the document describes version 2 while the environment still runs version 1, results apply to the wrong interface. Treat the API definition as part of the delivery input: update and validate it with contract changes, then verify the scanner imported the version served by the tested artifact.

API-aware testing can use the schema to create experiments:

- Omit required properties.
- Add unexpected properties.
- Send the wrong type or content type.
- Use boundary and oversized values.
- Change a path object identifier.
- Try methods not declared for the route.
- Compare authenticated and unauthenticated responses.

It is more effective than a generic crawler because it understands structured operations that have no hyperlinks. ZAP's packaged API scan can import OpenAPI, SOAP, or GraphQL descriptions and apply an API-oriented active policy.

OpenAPI also helps humans state coverage. A report can compare imported operations with attempted requests and highlight endpoints that authentication or setup prevented the scanner from exercising. The useful claim becomes “these declared operations were tested under this identity and configuration,” not “the API was scanned.”

Schema examples and realistic seed values can improve experiments. A scanner cannot meaningfully call `/orders/{orderId}` when it invents an identifier for no existing object and every request returns `404`. Supplying staging-only examples or preparing known objects lets the test reach the authorization and input-handling code behind lookup. The example values must remain non-sensitive and should be reset with the environment.

The declared method and response shape can also become assertions. If the specification permits only `GET`, try an undeclared write method and verify rejection. If a response schema should not contain an internal field, compare the runtime body with that contract. These checks do not replace dedicated authorization tests, but they turn interface assumptions into observable experiments.

Specification drift is itself evidence. If the deployed service responds on an operation absent from the document, the route may be forgotten, internal, or unintentionally public. If the document declares an operation that consistently returns `404`, the scan plan may be stale. Reconcile these mismatches before interpreting a clean result as broad API coverage.

![OpenAPI route map with short-lived test identities and cross-user authorization checks](/content-assets/articles/article-devsecops-application-security-testing-dynamic-application-api-testing/openapi-auth-scan.png)

_The API definition supplies the map; identity and product-aware assertions determine whether the resulting experiments test meaningful security rules._

## Why Do Authentication, Roles, and Business Rules Change the Scan?
<!-- section-summary: Authentication determines which surface the scanner can reach, while authorization and business semantics often require multiple identities and explicit expected outcomes. -->

An unauthenticated scanner may reach only login, health, documentation, and other public routes. Most important application behavior often sits behind a cookie, bearer token, API key, or multi-step session. **Authenticated scanning** supplies a dedicated test identity so the scanner can reach that protected surface.

Authentication is more than attaching a password. A test may need to obtain a token, preserve cookies, follow a redirect, refresh an expiring session, handle anti-CSRF state, or replay a header on every request. If that process fails, the scanner may receive only `401` responses and produce a deceptively quiet report.

Always verify the session before trusting results. A health check for the scan should confirm the expected application version, successful access to at least one protected route, the identity or role in use, and rejection of an intentionally unauthorized request. Authentication failure should make the scan incomplete rather than green.

One identity is often insufficient because authentication and authorization answer different questions. Authentication asks who the caller is. Authorization asks whether that caller may perform this operation on this object in this state.

Consider two customers:

```text
customer A owns order 1001
customer B owns order 1002
```

A generic authenticated scan might call `/api/orders/1001` as customer A and receive `200`. It has not tested whether A can change the identifier and read order `1002`. **Broken object-level authorization** requires business context about ownership.

A two-user test makes the invariant explicit:

```text
create object as B
      |
      v
request B's object as A
      |
      v
expect rejection without data disclosure
```

The same principle applies to functions. A support agent may search orders but not refund them. A customer may edit a shipping address before dispatch but not afterward. An administrator route may exist but should reject ordinary accounts. Generic payload generation cannot infer every product rule.

Use dedicated accounts with narrowly defined roles and known test objects. Short-lived staging tokens should have no production authority. Test data should establish ownership and state deliberately so assertions can distinguish expected access from a failure.

Business-aware tests complement broad scanning. Write explicit adversarial cases for important rules:

- User A cannot read or modify user B's object.
- A lower role cannot invoke an administrative function.
- A state transition cannot be repeated or skipped.
- A hidden or mass-assigned field cannot grant privilege.
- A token for one audience or tenant is rejected elsewhere.

When such a bug is fixed, preserve it as a security regression test. The dynamic scanner may have discovered the symptom, but a focused test now encodes the exact invariant and can run reliably on every change.

Authentication also changes risk. Running a broad active scan with an administrator token expands the possible side effects and can hide lower-role authorization gaps. Prefer the least privileged identity needed for each experiment, use several role-specific phases where necessary, and keep production credentials outside the test path.

Session setup needs its own failure evidence. Record how the token or cookie was obtained, its intended audience and role, and when it expires. Mask the credential in logs and reports. After setup, call a small identity endpoint or a protected known object to prove that the scanner is not operating anonymously. If refresh is required during a long scan, configure and verify that transition rather than assuming the initial session remains valid.

Build a role-and-object matrix for the highest-value APIs. Rows can represent anonymous user, customer A, customer B, support, and administrator. Columns can represent read-own, read-other, update-own, refund, and administrative configuration. Each cell states the expected allow or deny result. Generic scanning explores inputs inside a cell; targeted tests compare cells and reveal broken object- or function-level authorization.

Authorization failures may return `403`, `404`, or another product-specific response. The critical property is not one universal status code. It is that unauthorized data and state changes remain unavailable, the response does not disclose unnecessary existence information, and logs preserve useful security evidence. Tests should encode the product's chosen invariant.

## How Do You Contain the Side Effects of Active Testing?
<!-- section-summary: Active scans belong in an isolated, resettable environment with fake integrations, bounded identities, controlled rates, and clearly labeled data because their requests intentionally exercise unsafe paths. -->

Active testing deliberately changes interactions. A payload may create accounts, place orders, trigger emails, upload files, lock users, fill queues, or call an external payment system. The scanner may also generate unusual error and security logs. Those effects are part of why the test is informative, but they must be contained.

A suitable target commonly provides:

- A dedicated staging URL and network boundary.
- The same release artifact intended for promotion.
- Representative configuration without production credentials.
- Resettable databases and known seed data.
- Fake or sandbox payment, email, shipping, and webhook services.
- Dedicated test identities with short lifetimes.
- Rate and concurrency limits appropriate for the environment.
- Log labels that identify scanner traffic.

Test data matters because state changes coverage. An empty system cannot test access to an existing order. A permanently dirty environment can make runs interfere with one another. Seed the objects and roles the scan needs, run the experiment, preserve evidence, and reset to a known state.

External integrations must also be controlled. A test that sends a realistic refund request should reach a sandbox or fake service, not a production payment provider. Email and messaging should use sinks that capture content without contacting real users. Webhooks should terminate inside the test boundary. Otherwise a security check can create a real incident.

The exact artifact matters. If staging is scanned, then the pipeline rebuilds the application before production, the result does not apply to the new bytes. Promote the tested digest, or make the new build repeat the required evidence. Environment-specific differences should be understood because a safe test configuration can hide a production-only route or permission.

Runtime security testing is partly an infrastructure test. DNS, TLS termination, load balancers, API gateways, web application firewalls, identity providers, service meshes, and downstream permissions all affect observed behavior. That is a strength: the scanner tests an integrated system. It is also a limitation: a finding or pass may depend on this particular environment.

Passive checks can often run with less isolation because they do not intentionally mutate traffic. Active checks require explicit scope. Define allowed hosts and URLs so redirects or discovered links do not lead the scanner outside the test estate. Choose a scan window and maximum rate. Decide which destructive or denial-of-service-style rules are forbidden even in staging.

“Safe for production” is therefore not a property of DAST in general. It is a claim about a specific passive or constrained plan, identity, target, payload set, and rate. When that evidence is insufficient, keep active testing in the disposable environment and use monitoring plus narrow manual validation in production.

Reset must include more than the primary database. Clear queues, object storage, caches, test mailboxes, search indexes, and fake-provider histories when they influence later results. Otherwise one run can leave artifacts that change the next run's behavior or make a finding impossible to reproduce.

Use recognizable markers in created test data. A prefix containing the scan run ID helps operators distinguish scanner accounts, files, and transactions from manual testing. The same identifier can connect HTTP evidence with application, gateway, database, and fake-service logs. Cleanup can then target only objects owned by that run.

Availability is part of containment. Limit concurrency and requests per second, watch target health, and stop the plan when error or latency thresholds show the environment is destabilizing. Deliberate denial-of-service testing is a separate exercise that needs its own authorization and safeguards; it should not appear accidentally inside a routine release scan.

## How Do You Run ZAP and Turn Findings into Policy?
<!-- section-summary: ZAP offers baseline, full, and API-oriented scan shapes, but the delivery control must explicitly define target health, authentication, rule thresholds, evidence artifacts, and failure ownership. -->

OWASP ZAP can run interactively, in containers, or through an automation plan. Its packaged scan shapes serve different purposes:

- A **baseline scan** spiders briefly and applies passive checks. It is faster and safer for frequent feedback.
- A **full scan** performs active testing against discovered web inputs and needs a controlled target.
- An **API scan** imports OpenAPI, SOAP, or GraphQL and applies active rules suited to APIs.

Choose the shape from the security question. A baseline scan can check response behavior after each staging deployment. An API scan can exercise a declared route inventory. A broader active scan can run nightly against resettable staging.

A conceptual CI sequence is:

```text
deploy artifact to test environment
       |
       v
verify health, version, and authentication
       |
       v
seed or reset required test state
       |
       v
run chosen ZAP plan inside allowed scope
       |
       v
store human and machine-readable reports
       |
       v
apply reviewed policy and route findings
```

The health check is essential. Confirm that the target responds, runs the expected artifact or version, exposes the current API definition, and accepts the intended test identity. A scan against an old deployment or a login page is not evidence about the candidate release.

A small API scan can run from the stable ZAP container:

```bash
docker run --rm \
  -v "$PWD/evidence:/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py \
  -t https://staging.example.test/openapi.json \
  -f openapi \
  -J zap-report.json \
  -r zap-report.html \
  -c zap-rules.conf
```

The target identifies the machine-readable API map. JSON supports later automation and triage; HTML gives a human-readable record. The rule configuration states which findings warn, fail, or are intentionally ignored. Authentication can be supplied through a reviewed context or automation configuration using a short-lived staging credential.

As complexity grows, the ZAP Automation Framework moves contexts, OpenAPI import, authentication, active policy, and reports into reviewable YAML:

```yaml
env:
  contexts:
    - name: staging-api
      urls:
        - https://staging.example.test
jobs:
  - type: openapi
    parameters:
      apiUrl: https://staging.example.test/openapi.json
      targetUrl: https://staging.example.test
  - type: activeScan
    parameters:
      context: staging-api
  - type: report
    parameters:
      template: traditional-json
      reportDir: /zap/wrk
      reportFile: zap-report.json
```

The configuration is not complete merely because the scanner runs. Policy must state what a finding means for promotion. A confirmed injection path, authentication bypass, cross-user read, or exposed administrator function may block. An unstable low-confidence warning may enter triage rather than stop every release. A failed login or incomplete route import should block the decision because coverage evidence is missing.

Do not let noisy low-confidence output determine policy accidentally. Establish thresholds deliberately, preserve the original evidence, and route findings to an owner. A release exception should name scope, reason, compensating control, and expiration instead of changing the scanner to green.

Always upload reports even when the job fails. A red job with no endpoint, request, response, rule, or artifact forces developers to rerun the test merely to understand it. Useful evidence records target version, identity and role, imported definition, scan policy, start and finish, findings, skipped work, and report identifiers.

Policy should distinguish the scanner's confidence from the team's release decision. One rule can be noisy in a framework even when its nominal risk category is high. Another lower-severity symptom may reveal a direct authorization failure in a sensitive service. Start with stable, high-confidence outcomes; investigate broader results; and promote a result to a hard gate only after the team understands its behavior and response path.

Keep the rule file and automation plan under ordinary review. A change that turns a failure into a warning alters the release boundary and deserves the same visibility as other security-control changes. Record why an exclusion exists and when it should be revisited. Avoid editing the configuration merely to make one pipeline green.

Findings should carry enough reproduction evidence for triage without leaking credentials or sensitive response data. Preserve the route, method, parameter, rule, sanitized request and response evidence, target digest, role, and scan run. Restrict full reports when they contain tokens, internal URLs, or payload details that could aid misuse.

## What Can Runtime Testing Prove and What Can It Miss?
<!-- section-summary: A runtime finding can demonstrate unsafe behavior on a tested path, but discovery, state, semantics, environment, and scanner knowledge bound every clean result. -->

DAST is strongest when it records a reproducible stimulus and unsafe observation. A request that causes a stack trace, reflects executable content, returns another user's object, or changes protected state can demonstrate that the behavior is reachable in the tested environment. That is often more direct exploitability evidence than a static suspicion.

The tool still cannot prove absence. Its limits fall into several categories.

**Discovery limits:** the scanner cannot test an unknown route, hidden parameter, undocumented host, or feature that the crawler and API definition did not reveal.

**State limits:** behavior may require a particular account, object lifecycle, previous request sequence, feature flag, or time. A stateless payload run may never reach it.

**Semantic limits:** a scanner may not know that order `1002` belongs to another tenant, that a refund requires separation of duties, or that a field reveals sensitive business data. Product-aware assertions are necessary.

**Environment limits:** staging configuration, identity, data, network controls, or downstream permissions can differ from production. A result applies to the system actually tested.

**Scanner-knowledge limits:** tools encode known techniques and heuristics. New vulnerability classes, unusual protocols, and application-specific encodings may fall outside their rules.

Authentication mistakes can combine several limits. If the token expires immediately, protected endpoints all return `401`. The scanner records no injection findings and appears clean, while almost no application behavior was exercised. Coverage validation must make that run incomplete.

A scanner is not a penetration tester. A human can form hypotheses, chain weak signals, understand organizational context, adapt after each observation, and reason about business impact. Automated scans provide repeatability and breadth within configured models; focused manual testing adds adaptive exploration.

Two-user tests are particularly powerful for APIs because they supply missing ownership semantics. Security regression tests are equally important because a discovered product rule becomes a stable, fast assertion. Use the generic scanner to explore broad protocol and input behavior, then convert important confirmed weaknesses into targeted tests.

Finally, relate evidence to the release object. Record which artifact digest, environment, definition version, and test identities the scan covered. Promote that artifact rather than silently rebuilding. If production differs materially, state the limitation instead of expanding the claim.

Discovery and state limits can be measured rather than merely acknowledged. Count imported operations, successful authenticated operations, active rules attempted, and routes skipped through setup failures. Include these numbers beside the finding total. Zero findings with two of one hundred operations reached tells a very different story from zero findings with ninety-eight reached under the intended roles.

Semantic limits suggest where to spend human attention. Generic scanners are well suited to repeatable protocol checks and common injection classes. Engineers who understand the product should identify high-value objects, privilege transitions, workflows, and abuse cases, then encode the most stable ones as regression tests. Periodic human security testing can explore hypotheses that are too adaptive or contextual for CI.

Environment limits also cut both ways. A staging-only debug flag may produce a finding that production would not. A production-only gateway rule may hide behavior staging never exercised. Do not dismiss the first automatically or assume the second is safe. Explain the difference, decide which environment owns the control, and test as close to the relevant configuration as safely possible.

## What Does a Practical Runtime Security Workflow Look Like?
<!-- section-summary: A practical workflow combines contract freshness, a fast deployment check, role-aware active testing in resettable staging, targeted authorization tests, broader schedules, and explicit release outcomes. -->

A small team can start with a controlled loop instead of trying to reproduce a full penetration test in every pull request.

First, keep the interface map current. When a change adds or modifies an API operation, update the OpenAPI definition in the same change and validate it. Record the artifact digest and definition version deployed to staging.

Second, create the environment deliberately. Use representative configuration, seeded ownership relationships, fake external services, and dedicated test users. Give each role only staging authority and obtain short-lived credentials through automation.

Third, run fast feedback after deployment. Verify the host, artifact, API map, and one protected request. Perform a baseline or constrained API scan, save JSON and HTML evidence, and fail when the scan itself is incomplete.

Fourth, run important business-aware assertions. A two-user object test, lower-role function test, and state-transition test often protect more meaningful rules than another generic payload. Keep them beside the API test suite so fixes become permanent regression coverage.

Fifth, schedule broader active work. Reset staging, import the full definition, use several roles, expand the active policy, control request rate, and label traffic. Run it nightly or before a significant promotion if it is too slow or disruptive for every change.

Sixth, make release outcomes explicit:

| Evidence | Promotion decision |
|---|---|
| Confirmed injection, authentication bypass, cross-user access, or exposed privileged function | Block and repair |
| Required target, identity, definition, or coverage check failed | Treat as missing evidence and rerun |
| Stable lower-impact finding | Route to an owner under the reviewed threshold |
| Accepted temporary risk | Preserve original finding, decision, control, owner, and expiration |
| Clean scan with verified coverage | Accept only the bounded claim for the tested artifact and environment |

The end-to-end path is:

```text
release artifact and API definition
              |
              v
controlled staging deployment
              |
      +-------+--------+
      |                |
      v                v
generic runtime scan   business-aware tests
      |                |
      +-------+--------+
              |
              v
coverage and finding evidence
              |
              v
reviewed promotion policy
```

![Runtime testing loop from staging deployment through authenticated scans, findings, reset, and promotion policy](/content-assets/articles/article-devsecops-application-security-testing-dynamic-application-api-testing/runtime-testing-loop.png)

_Runtime evidence is useful when the team can state exactly which artifact, interface, identity, role, state, and environment the experiment covered._

The deepest mental model remains stimulus, system, and observation. DAST sends security experiments to a running integrated system. OpenAPI improves route discovery. Authentication exposes protected surface. Multiple roles and targeted tests supply business meaning. Isolation contains side effects. Policy turns findings and coverage into a release decision. None of those pieces alone is “the runtime security test.”

For a first implementation, prioritize five controls: verify that the candidate artifact is really deployed; import a current interface map; prove that authentication reaches protected routes; keep active payloads inside resettable staging with fake downstreams; and preserve reports plus coverage as release evidence. Those controls prevent the most misleading failure mode—a polished green report that never tested the intended system.

## Check Your Answers

:::expand[Why Does Security Testing Need a Running System?]{kind="recap"}
Runtime testing observes the deployed combination of code, configuration, routing, identity, data, infrastructure, and downstream behavior.
:::

:::expand[How Does DAST Discover and Exercise an Attack Surface?]{kind="recap"}
Discovery maps reachable inputs; passive checks observe them, while active checks deliberately mutate requests and require stronger containment.
:::

:::expand[How Does an API Definition Improve Runtime Coverage?]{kind="recap"}
OpenAPI supplies a route and schema map, but only a current definition plus verified requests can support a meaningful coverage claim.
:::

:::expand[Why Do Authentication, Roles, and Business Rules Change the Scan?]{kind="recap"}
Authentication exposes protected routes, while authorization and product semantics require several identities and explicit expected outcomes.
:::

:::expand[How Do You Contain the Side Effects of Active Testing?]{kind="recap"}
Use an isolated, resettable target with fake integrations, bounded identities, controlled scope and rate, and the candidate release artifact.
:::

:::expand[How Do You Run ZAP and Turn Findings into Policy?]{kind="recap"}
Choose the appropriate ZAP scan shape, validate target health and coverage, preserve reports, and apply reviewed risk thresholds.
:::

:::expand[What Can Runtime Testing Prove and What Can It Miss?]{kind="recap"}
A finding can demonstrate unsafe tested behavior, but clean results remain bounded by discovery, state, semantics, environment, and scanner knowledge.
:::

:::expand[What Does a Practical Runtime Security Workflow Look Like?]{kind="recap"}
Combine current contracts, controlled staging, fast scans, role-aware regression tests, broader schedules, and explicit promotion decisions.
:::

## References

- [OWASP ZAP API Scan](https://www.zaproxy.org/docs/docker/api-scan/) - Documents the packaged scan for OpenAPI, SOAP, and GraphQL APIs.
- [OWASP ZAP Baseline Scan](https://www.zaproxy.org/docs/docker/baseline-scan/) - Describes the short passive baseline scan.
- [OWASP ZAP Full Scan](https://www.zaproxy.org/docs/docker/full-scan/) - Describes the active web application scan.
- [OWASP ZAP Automation Framework](https://www.zaproxy.org/docs/automate/automation-framework/) - Documents reviewable YAML automation plans.
- [OWASP ZAP Authentication](https://www.zaproxy.org/docs/authentication/) - Describes authenticated scanning concepts and methods.
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) - Defines the machine-readable HTTP interface format.
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) - Lists major API risk categories.
- [OWASP API1:2023 Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) - Explains cross-object authorization failure.
- [OWASP API5:2023 Broken Function Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/) - Explains role and function authorization failure.
