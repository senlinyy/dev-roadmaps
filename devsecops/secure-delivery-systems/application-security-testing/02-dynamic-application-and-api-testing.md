---
title: "Dynamic Application and API Testing"
description: "Test a running application with DAST, API scanning, authenticated flows, and OpenAPI-driven checks."
overview: "Dynamic testing checks the behavior of a running application. This article follows the checkout API team as they add OWASP ZAP, OpenAPI-driven API scanning, authenticated staging tests, safe test data, and a clean handoff into finding triage."
tags: ["devsecops", "dast", "api-security", "owasp"]
order: 2
id: article-devsecops-application-security-testing-dynamic-application-api-testing
---

## Table of Contents

1. [Why Runtime Testing Exists](#why-runtime-testing-exists)
2. [Dynamic Application Security Testing](#dynamic-application-security-testing)
3. [API Testing With an OpenAPI Definition](#api-testing-with-an-openapi-definition)
4. [Authenticated Scans](#authenticated-scans)
5. [Active Scans, Passive Checks, and Safe Environments](#active-scans-passive-checks-and-safe-environments)
6. [Running ZAP in CI](#running-zap-in-ci)
7. [What Runtime Testing Can and Cannot Prove](#what-runtime-testing-can-and-cannot-prove)
8. [A Small Team Workflow](#a-small-team-workflow)
9. [What's Next](#whats-next)

## Why Runtime Testing Exists
<!-- section-summary: Runtime testing checks how the deployed application behaves after routing, authentication, configuration, and real HTTP responses enter the picture. -->

In the previous article, the checkout API team added CodeQL, secret scanning, and push protection. That gives them early feedback while code is still in a pull request. The team can catch risky SQL construction, obvious unsafe framework calls, and exposed credentials before a change reaches production.

Now the team has a different question. What happens when the API is actually running?

A running application has behavior that source scanning may only partially understand. The API has headers, cookies, redirects, CORS rules, authentication tokens, rate limits, error responses, deployed configuration, reverse proxies, and real authorization checks. A scanner that only reads code may miss a staging setting that exposes stack traces. It may struggle to prove whether user A can read user B's order. It may miss a route that exists because a gateway maps traffic in front of the service.

**Dynamic application security testing**, usually shortened to **DAST**, checks the application from the outside while it runs. It sends HTTP requests and studies the responses. For the checkout team, that means testing the staging checkout API after deployment but before the release moves to production.

This gives the team a second kind of feedback. SAST says, "This code pattern looks risky." DAST says, "This running endpoint responded in a risky way." The two are connected. Code scanning might catch a dangerous string passed into SQL. Runtime testing might catch a verbose error page, missing security header, reflected input, weak cookie setting, or API authorization gap.

The first step is understanding how a dynamic scanner behaves.

## Dynamic Application Security Testing
<!-- section-summary: DAST sends requests to the running application and looks for risky responses, configuration mistakes, and reachable behavior. -->

**DAST** means testing an application through its public interface. For web apps and APIs, that interface is usually HTTP. The scanner crawls or imports routes, sends requests, watches status codes and response bodies, checks headers, and sometimes sends attack payloads to see whether the application handles them safely.

A basic DAST check might request the checkout API health page and inspect headers:

```bash
curl -i https://checkout-staging.example.com/health
```

The response might include:

```http
HTTP/2 200
content-type: application/json
x-content-type-options: nosniff
strict-transport-security: max-age=31536000; includeSubDomains

{"status":"ok"}
```

Those headers do not make the application secure by themselves, but they show that the deployed edge is applying some browser-facing protections. A missing or misconfigured header can be a small finding. A verbose stack trace on an error route can be more serious because it can expose framework versions, file paths, or internal names.

Dynamic testing also sends suspicious input. For example, the scanner might call:

```bash
curl "https://checkout-staging.example.com/orders/search?term=%27%20OR%20%271%27%3D%271"
```

If the API returns every order, the scanner has found behavior that needs urgent attention. If the API returns a normal empty result or a validation error, the app handled that input more safely.

Tools such as OWASP ZAP can run passive checks and active checks. A **passive check** observes traffic and responses without changing the request in dangerous ways. It can report missing headers or cookie attributes. An **active check** sends test payloads that may trigger unusual code paths. Active checks create better evidence for some vulnerabilities, but they need a controlled environment because they can create records, produce noisy logs, or stress endpoints.

The checkout API is mostly an API, so crawling pages is only part of the story. The team needs API-aware testing.

![Runtime scan path through staging gateway, checkout API, fake services, and report artifact](/content-assets/articles/article-devsecops-application-security-testing-dynamic-application-api-testing/runtime-scan-path.png)

*This image separates the scanner, staging gateway, checkout API, fake downstream services, and report artifact so the runtime test stays useful without touching production data.*

## API Testing With an OpenAPI Definition
<!-- section-summary: API scanners need an inventory of endpoints, and an OpenAPI definition gives the scanner a structured map of routes, methods, parameters, and schemas. -->

An **API security test** checks endpoints that accept structured requests and return structured responses. APIs often use JSON, path IDs, bearer tokens, and machine-to-machine calls. Some of the most important API risks involve authorization, object IDs, excessive data in responses, unsafe mass assignment, missing rate limits, and confusing versioned routes.

OWASP's API Security Top 10 2023 puts **Broken Object Level Authorization** at API1. That issue appears when an API lets a caller access an object they should not access by changing an ID. In the checkout API, a customer might call:

```http
GET /api/orders/ord_1001
Authorization: Bearer token-for-customer-a
```

Then an attacker changes the ID:

```http
GET /api/orders/ord_1002
Authorization: Bearer token-for-customer-a
```

If `ord_1002` belongs to another customer and the API returns it, the endpoint has an object-level authorization problem. A static scanner may see an authorization helper in the code and assume the route is covered. A runtime test can prove what the endpoint actually returns for two different users.

For API scanners, route discovery matters. A web crawler can follow links on a website, but APIs often have no links to follow. That is where an **OpenAPI definition** helps. OpenAPI is a machine-readable description of API paths, methods, parameters, request bodies, response bodies, and authentication schemes.

A small OpenAPI slice for the checkout API might look like this:

```yaml
openapi: 3.0.3
info:
  title: Checkout API
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

ZAP's API scan can import OpenAPI, SOAP, or GraphQL definitions and run an API-tuned active scan against the discovered URLs. That gives the scanner a route map. It can send test payloads to real endpoints instead of guessing every path.

The OpenAPI file should come from the same delivery path as the API. Many teams generate it from route schemas or keep it in the repository and validate it in CI. If the definition drifts away from the deployed service, the scanner tests the wrong map. The practical rule is simple: update the API definition in the same pull request that changes the API contract.

Now the scanner can find routes. The next problem is access.

## Authenticated Scans
<!-- section-summary: Authenticated scans let the tester reach real user flows, but the tokens, roles, and test accounts must be tightly controlled. -->

Many useful API routes require authentication. **Authentication** proves who the caller is, usually through a session cookie, API key, or bearer token. A scanner without authentication sees only public routes such as `/health`, `/login`, and `/docs`. That misses most checkout behavior.

An **authenticated scan** gives the scanner a test identity. For the checkout API, the team might create three staging users:

| Test identity | Purpose |
|---|---|
| `customer-a@example.test` | Owns order `ord_1001` |
| `customer-b@example.test` | Owns order `ord_1002` |
| `support-agent@example.test` | Can search orders but cannot change payment status |

The scanner can use a short-lived token for `customer-a` to test normal customer routes. A separate custom test can try `customer-a` against `ord_1002` and expect a `403` or `404`, depending on the product's chosen response style.

The token should come from a safe automation path. A GitHub Actions job can request a staging token from a test-auth endpoint or use a short-lived secret from the CI secret store. The token should expire quickly, belong only to staging, and have no production permissions.

Here is a simple CI shape:

```bash
TOKEN="$(curl -s \
  -X POST https://checkout-staging.example.com/test-auth/token \
  -H "content-type: application/json" \
  -d '{"user":"customer-a@example.test"}' | jq -r .access_token)"

docker run --rm \
  -v "$PWD:/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py \
  -t https://checkout-staging.example.com/openapi.json \
  -f openapi \
  -z "-config replacer.full_list(0).description=auth \
      -config replacer.full_list(0).enabled=true \
      -config replacer.full_list(0).matchtype=REQ_HEADER \
      -config replacer.full_list(0).matchstr=Authorization \
      -config replacer.full_list(0).replacement=Bearer $TOKEN"
```

This example shows the idea: get a staging token, run the ZAP API scan, and attach the token as an Authorization header. Real teams usually wrap this in a script or use the ZAP Automation Framework YAML so the scan is easier to review.

Authenticated scans should never use a personal developer account or a production admin token. Use dedicated test users. Keep the permissions narrow. Reset test data often. Make the token lifetime short. Those details keep a useful security test from turning into a new security risk.

Authentication gives the scanner access. The next question is where the scan is allowed to act.

![OpenAPI route map with short-lived test identities checking blocked cross-user access](/content-assets/articles/article-devsecops-application-security-testing-dynamic-application-api-testing/openapi-auth-scan.png)

*This visual shows how an OpenAPI route map, short-lived customer tokens, and a 403 expectation work together to test object-level authorization.*

## Active Scans, Passive Checks, and Safe Environments
<!-- section-summary: Active scans should run against controlled staging environments with resettable data because they send unusual requests on purpose. -->

A dynamic scanner can send unusual input by design. It may try quote characters, long strings, path traversal patterns, unexpected content types, duplicate parameters, strange HTTP methods, or payloads that look like injection attempts. This is useful, but it can create side effects.

For the checkout API, an active scan should run against staging, not production. The staging environment should use fake payment credentials, fake email delivery, fake customer records, and resettable databases. The scanner should never charge a real card, send a real receipt, or create a real shipment.

A safe scan environment usually has these pieces:

| Control | What it protects |
|---|---|
| Dedicated staging URL | Keeps scanner traffic away from production users |
| Fake downstream services | Prevents real payments, emails, and shipments |
| Resettable test data | Lets the team return the environment to a known state |
| Short-lived test tokens | Limits damage if a CI log or artifact leaks |
| Rate limits and scan windows | Keeps active testing from overwhelming staging |
| Clear logging labels | Helps teams separate scanner traffic from real debugging |

Passive checks can run more often because they mostly inspect traffic and responses. Active checks need more care. Many teams run a light smoke scan on every staging deployment and a deeper active scan nightly or before a larger release.

The scan should also fail in a controlled way. A missing security header might create a warning but not block the release. A confirmed SQL injection behavior, exposed admin route, or cross-user order read should block promotion. The gate should match the risk and the confidence of the finding.

Now we can turn the idea into a repeatable CI job.

## Running ZAP in CI
<!-- section-summary: A repeatable CI scan should define the target, authentication, rules, thresholds, artifacts, and ownership of failures. -->

OWASP ZAP is a common open-source DAST tool. It can run locally for exploration, in Docker for CI, and through the Automation Framework for more structured jobs. The checkout team can start with the packaged API scan, then move to an automation plan as the workflow grows.

A first GitHub Actions job might look like this:

```yaml
name: Staging API Security Scan

on:
  workflow_dispatch:
  deployment_status:

permissions:
  contents: read

jobs:
  zap-api-scan:
    if: github.event_name == 'workflow_dispatch' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run ZAP API scan
        run: |
          docker run --rm \
            -v "$PWD:/zap/wrk/:rw" \
            ghcr.io/zaproxy/zaproxy:stable \
            zap-api-scan.py \
            -t https://checkout-staging.example.com/openapi.json \
            -f openapi \
            -r zap-report.html \
            -J zap-report.json \
            -c zap-rules.conf

      - name: Upload ZAP reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: zap-api-scan
          path: |
            zap-report.html
            zap-report.json
```

The `zap-rules.conf` file controls which warnings are informational, ignored, or failing. This matters because a security gate should be explicit. If the team decides that missing `Strict-Transport-Security` fails staging for public browser routes but only warns for an internal API behind a gateway, that decision should live in reviewable configuration.

As the job gets more serious, the team can move to the ZAP Automation Framework:

```yaml
env:
  contexts:
    - name: checkout-staging
      urls:
        - https://checkout-staging.example.com
jobs:
  - type: openapi
    parameters:
      apiUrl: https://checkout-staging.example.com/openapi.json
      targetUrl: https://checkout-staging.example.com
  - type: activeScan
    parameters:
      context: checkout-staging
  - type: report
    parameters:
      template: traditional-json
      reportDir: /zap/wrk
      reportFile: zap-report.json
```

The Automation Framework keeps the scan plan in one YAML file. That makes changes easier to review. It also gives the team a path to add contexts, authentication, passive scan settings, active scan policies, reports, and thresholds without stuffing everything into one long shell command.

CI should store the report as an artifact even when the job fails. A failed scan without a report forces people to rerun the job just to understand the finding. A useful failure gives a link to the artifact, the endpoint, the rule, the evidence, and the owner.

Before the team treats the workflow as a release gate, they can run the same scan locally against staging and save the first evidence bundle. This helps beginners see the loop without waiting for a CI run.

```bash
TARGET="https://checkout-staging.example.com"
OPENAPI="$TARGET/openapi.json"
TOKEN="$(curl -s \
  -X POST "$TARGET/test-auth/token" \
  -H "content-type: application/json" \
  -d '{"user":"customer-a@example.test"}' | jq -r .access_token)"

mkdir -p evidence/zap-staging

docker run --rm \
  -v "$PWD/evidence/zap-staging:/zap/wrk/:rw" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py \
  -t "$OPENAPI" \
  -f openapi \
  -J zap-report.json \
  -r zap-report.html \
  -z "-config replacer.full_list(0).description=auth \
      -config replacer.full_list(0).enabled=true \
      -config replacer.full_list(0).matchtype=REQ_HEADER \
      -config replacer.full_list(0).matchstr=Authorization \
      -config replacer.full_list(0).replacement=Bearer $TOKEN"

jq '.site[].alerts[] | {riskdesc, name, url}' \
  evidence/zap-staging/zap-report.json \
  > evidence/zap-staging/alert-summary.json
```

That local run gives the reviewer three useful records: the JSON report for machines, the HTML report for humans, and a small summary that can move into the finding triage article. The team should still use dedicated staging accounts and fake data, even for this local command.

Runtime scans now produce evidence. The team still needs to understand the limits.

## What Runtime Testing Can and Cannot Prove
<!-- section-summary: Runtime scanners are strong at reachable behavior, but business authorization and deep logic still need targeted tests and human review. -->

DAST is powerful because it tests real behavior. It can show that a response contains a stack trace, a cookie lacks `HttpOnly`, an endpoint reflects input, or a route accepts a method it should reject. For API work, it can test the routes in the OpenAPI definition and catch many configuration and input-handling problems.

Some important risks still need targeted tests. **Broken object-level authorization** is the best example. A scanner can send requests, but it needs to know which objects belong to which test users and what response is correct. A generic scan may call `/api/orders/{orderId}` with one ID. A product-aware test should call the same route with `customer-a` and `customer-b`, then verify the cross-user request fails.

That test can live beside the API test suite:

```ts
it("does not allow one customer to read another customer's order", async () => {
  const customerAToken = await tokenFor("customer-a@example.test");
  const customerBOrder = await createOrderFor("customer-b@example.test");

  await request(app)
    .get(`/api/orders/${customerBOrder.id}`)
    .set("Authorization", `Bearer ${customerAToken}`)
    .expect(403);
});
```

This kind of test gives stronger evidence than a generic scanner for business authorization. The scanner still helps with broad protocol and input checks. The targeted test proves the product rule.

Runtime testing also depends on coverage. If the OpenAPI definition omits `/api/refunds/{refundId}`, the scanner may never touch it. If the staging deployment disables a feature flag, the scanner cannot test that path. If authentication setup fails and the scanner receives only `401` responses, the report can look clean while protected routes were never tested.

That means every scan result needs a small coverage check:

1. Did the scanner reach the expected host and version?
2. Did it authenticate as the expected test user?
3. Did it import the current OpenAPI definition?
4. Did it hit the sensitive routes the team cares about?
5. Did the report include warnings, failures, and skipped checks?

A green scan can create false comfort when nobody checks coverage. A scan with coverage evidence gives the team something useful to trust.

The workflow is ready to connect with triage.

## A Small Team Workflow
<!-- section-summary: The delivery path should combine quick staging scans, deeper scheduled scans, targeted authorization tests, and clear release gates. -->

Here is a practical workflow for the checkout API.

Every pull request still runs CodeQL and unit tests. If the pull request changes an API contract, it also updates the OpenAPI definition. The review includes the route, the schema, and the expected authorization rule.

Every staging deployment runs a light ZAP API scan against the deployed URL. The job imports the OpenAPI definition from staging, uses a short-lived customer test token, stores HTML and JSON reports, and fails only on findings the team has chosen as release blockers.

Every night, the team runs a deeper scan. The nightly scan can use more active rules, more test users, and a reset staging database. It can take longer because it does not sit directly in the developer's pull request path.

For important authorization rules, the team writes targeted tests. Customer A cannot read Customer B's order. A support agent can search orders but cannot change payment status. A customer cannot call admin refund routes. These tests run in CI because they are product rules, not generic scanner guesses.

The release gate is clear:

| Signal | Release action |
|---|---|
| New confirmed injection, cross-user data access, auth bypass, or exposed admin function | Block promotion |
| Missing security header on public browser route | Fix before production or accept with owner-approved due date |
| Scanner warning without confirmed exploit path | Triage into backlog with evidence |
| Auth setup failed and scan had low coverage | Rerun scan before release decision |

This workflow keeps runtime testing grounded. The team tests a real deployment. The scanner gets a route map. Authentication uses safe test identities. Active checks stay in staging. Findings flow into triage with enough evidence to make a decision.

![Runtime testing loop from staging deployment to ZAP findings and release gate](/content-assets/articles/article-devsecops-application-security-testing-dynamic-application-api-testing/runtime-testing-loop.png)

*This summary pulls together the runtime testing loop: deploy to staging, import OpenAPI, use a test token, run ZAP, triage findings, reset test data, and decide the release gate.*

That last step matters because scanners produce findings, not finished decisions.

## What's Next

The checkout team now has early code scanning, secret scanning, and runtime API testing. That means the team will start seeing alerts from multiple places: CodeQL, secret scanning, ZAP, targeted authorization tests, and dependency tools.

The next article covers what happens after a finding appears. We will triage alerts, compare severity with exploitability and reachability, assign owners, decide due dates, dismiss false positives with evidence, and record accepted risk in a way future reviewers can understand.

---

**References**

- [OWASP ZAP: API Scan](https://www.zaproxy.org/docs/docker/api-scan/) - Documents the packaged ZAP API scan for OpenAPI, SOAP, and GraphQL definitions.
- [OWASP ZAP: Automation Framework](https://www.zaproxy.org/docs/automate/automation-framework/) - Describes the YAML-based ZAP automation format for repeatable scans.
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) - Defines the standard interface description for HTTP APIs, including paths, operations, parameters, schemas, and security schemes.
- [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) - Lists common API security risks, including Broken Object Level Authorization.
- [OWASP API1:2023 Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) - Explains object-level authorization failures in APIs.
- [OWASP API5:2023 Broken Function Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/) - Explains authorization failures around functions and administrative endpoints.
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) - Provides current broad web application risk categories.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) - Provides a basis for verifying application security controls.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - Recommends secure software development practices that can be integrated into delivery workflows.
