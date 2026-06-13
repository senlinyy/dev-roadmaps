---
title: "Synthetics and RUM"
description: "Monitor user-facing behavior with CloudWatch Synthetics canaries and CloudWatch RUM real user telemetry."
overview: "Service SLOs show whether instrumented services meet reliability targets. This article adds the customer edge: scheduled synthetic journeys, real user sessions, browser errors, page load performance, and X-Ray connections back to backend services."
tags: ["cloudwatch", "synthetics", "rum", "canaries", "x-ray", "aws"]
order: 6
id: article-cloud-providers-aws-observability-synthetics-and-rum
aliases:
  - synthetics-and-rum
  - cloud-providers/aws/observability/synthetics-and-rum.md
---

## Table of Contents

1. [The User Experience Gap](#the-user-experience-gap)
2. [What CloudWatch Synthetics Does](#what-cloudwatch-synthetics-does)
3. [Designing Canaries for Real Journeys](#designing-canaries-for-real-journeys)
4. [Canary Runtimes, Artifacts, and Safe Updates](#canary-runtimes-artifacts-and-safe-updates)
5. [Canary Permissions and Security](#canary-permissions-and-security)
6. [Groups, Alarms, and Canary SLOs](#groups-alarms-and-canary-slos)
7. [What CloudWatch RUM Adds](#what-cloudwatch-rum-adds)
8. [App Monitors, Sessions, and Privacy](#app-monitors-sessions-and-privacy)
9. [Errors, Page Load Performance, and Custom Context](#errors-page-load-performance-and-custom-context)
10. [X-Ray and Application Signals Integration](#x-ray-and-application-signals-integration)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The User Experience Gap
<!-- section-summary: Service health can miss browser failures, public-route failures, and rare client-side problems that customers actually feel. -->

Application Signals and SLOs give the checkout team a service-health layer. The team can see whether `orders-api` is available, whether `POST /checkout` is slow, and whether a dependency is burning the error budget.

But customer experience can still fail outside that service view.

Imagine this Monday morning incident. Application Signals shows the backend checkout service as healthy. The availability SLO is green. The latency SLO is green. The payment dependency is green. Then support tickets arrive: customers can add items to the cart, but the final checkout button stays inert.

The backend is fine because the request never reaches it. A new JavaScript bundle shipped with a frontend error. Some browsers throw an exception before calling `POST /checkout`. Service metrics stay quiet because no backend request happens. From the customer's point of view, checkout is broken.

A second incident looks different. The browser code works, but the public URL is unavailable from one region because of a DNS or routing issue. Again, backend service telemetry might look fine because internal calls and warm traffic still succeed.

This is the user experience gap. To close it, teams add two more signals:

* **Synthetics**: Scheduled checks that act like scripted users and test important routes even when no real users are active.
* **RUM**: Real user monitoring that records actual browser and mobile experience from sampled customer sessions.

Synthetics answers, "Can a known journey work from the outside right now?" RUM answers, "What are real users experiencing across browsers, devices, pages, and geographies?"

## What CloudWatch Synthetics Does
<!-- section-summary: CloudWatch Synthetics runs scheduled canary scripts from your AWS account to test endpoints, APIs, and browser journeys before customers report problems. -->

**CloudWatch Synthetics** creates **canaries**. A canary is a configurable script that runs on a schedule to monitor endpoints and APIs. AWS says canaries follow the same routes and perform the same actions as a customer, so they can discover issues before customers do.

In practical terms, a canary is an automated user. It might open the home page, search for a product, add it to a cart, load checkout, and verify that the checkout form appears. For an API, it might call `GET /health`, `POST /payment/quote`, or a full multi-step test route with expected status codes and response fields.

CloudWatch Synthetics creates AWS Lambda functions in your account to run canary scripts. AWS documents canary script support for Node.js, Python, and Java runtimes. For browser canaries, Node.js and Python runtimes can use headless browsers through Playwright, Puppeteer, or Selenium WebDriver. Canaries work over HTTP and HTTPS, can run once or on a recurring schedule, and can run as often as once per minute.

The checkout team usually starts with a small set of canaries:

| Canary | What it checks | Why it matters |
|---|---|---|
| `checkout-homepage-heartbeat` | Public home page returns a successful response. | Catches DNS, TLS, CDN, and frontend hosting failures. |
| `checkout-api-health` | Public API health endpoint responds quickly. | Separates public API reachability from browser behavior. |
| `checkout-journey-browser` | Browser opens cart and reaches checkout form. | Catches broken JavaScript, missing assets, bad redirects, and page rendering failures. |
| `checkout-payment-api` | API can receive a safe test payment quote request. | Catches deeper backend path issues without creating real orders. |

Canaries complement service SLOs. A service SLO tells you the instrumented backend is meeting its target. A canary tells you the route customers use from outside still works.

## Designing Canaries for Real Journeys
<!-- section-summary: Good canaries test important customer paths with safe data, clear step names, and enough depth to catch real failures without creating noisy traffic. -->

A good canary is small, realistic, and safe.

**Small** means the script checks one journey. A single giant script that logs in, browses, checks out, opens account settings, and downloads invoices creates confusing failures. If it fails at step six, responders have to inspect the whole script before they know which user path broke. Smaller canaries give clearer operational signals.

**Realistic** means the script follows the path customers use, not only a private health endpoint. A health endpoint can return 200 while the JavaScript bundle is missing, the CDN blocks an asset, or the checkout button throws a browser error. Browser canaries are valuable because they load the page and exercise browser behavior.

**Safe** means the script uses controlled test data and avoids destructive actions. For checkout, the canary might stop at the payment quote step or use a test payment method in a sandbox path. It should not create real customer orders every minute.

CloudWatch Synthetics supports blueprint scripts and custom scripts. For API-style canaries, the Node.js library includes `executeHttpStep`, which runs an HTTP step, publishes `SuccessPercent` and `Duration` metrics, and records a step summary in the canary report. A production canary usually names every step clearly because those names appear in metrics and reports.

```javascript
const synthetics = require('Synthetics');

const apiCanaryBlueprint = async function () {
  await synthetics.executeHttpStep(
    'Public checkout health',
    'https://shop.example.com/api/checkout/health'
  );

  await synthetics.executeHttpStep(
    'Payment quote',
    {
      protocol: 'https:',
      hostname: 'shop.example.com',
      method: 'POST',
      path: '/api/payment/quote',
      port: 443,
      body: JSON.stringify({ cartId: 'synthetic-cart' }),
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );
};

exports.handler = async () => {
  return await apiCanaryBlueprint();
};
```

For a browser journey, the same idea applies, but the canary opens a page and verifies visible behavior. It should wait for the page to load, click stable controls, and fail with a useful step name. The script should avoid relying on fragile CSS selectors that change every release. Teams often add stable test IDs to important controls so canaries break only when the journey breaks, not every time the design changes.

Creating a canary with the AWS CLI follows this general shape. The runtime version must be a currently supported Synthetics runtime, and the role must have the permissions covered later in this article.

```bash
aws synthetics create-canary \
  --name checkout-api-health \
  --code '{"S3Bucket":"synthetics-source-prod","S3Key":"checkout-api-health.zip","Handler":"index.handler"}' \
  --artifact-s3-location s3://synthetics-artifacts-prod/checkout-api-health/ \
  --execution-role-arn arn:aws:iam::123456789012:role/checkout-api-health-canary-role \
  --schedule Expression="rate(5 minutes)" \
  --runtime-version syn-nodejs-puppeteer-9.1
```

The command puts the important operational choices in one place: script package, artifact location, execution role, schedule, and runtime version. In real infrastructure, most teams put this in CloudFormation, CDK, Terraform, or another infrastructure workflow so runtime updates, schedules, tags, and permissions go through review.

## Canary Runtimes, Artifacts, and Safe Updates
<!-- section-summary: Canary runtime versions need active maintenance, and safe update dry runs reduce the chance of breaking monitoring while updating code or dependencies. -->

A **Synthetics runtime** is the combination of the Synthetics code that calls your handler and the Lambda layers that contain bundled dependencies. AWS currently documents runtimes for Node.js, Python, and Java, with Puppeteer, Playwright, and Selenium as supported browser automation frameworks.

Runtime versions matter because a canary is production monitoring code. If the browser engine, library, or language runtime ages out, the canary can fail for reasons unrelated to your application. AWS recommends using the most recent runtime version to get the latest Synthetics library features and updates. AWS also documents a runtime support policy: deprecated runtimes cannot be used to create new canaries, existing canaries on deprecated runtimes continue to run, and AWS recommends migrating canaries to supported runtimes for new functionality, security, and performance enhancements.

The safe way to update a canary is to test the update before committing it. CloudWatch Synthetics supports **safe canary updates** and dry runs. AWS recommends dry runs before production updates, reviewing logs and artifacts after a dry run, and using dry runs to validate runtime, dependency, and library compatibility.

The operational process looks like this:

1. Review the current runtime and script behavior.
2. Choose a supported runtime version.
3. Start a dry run with the new runtime, code, memory, VPC, or artifact settings.
4. Review the dry run result, logs, screenshots, HAR files, and generated artifacts.
5. Commit the update only after the dry run succeeds.

The CLI exposes `start-canary-dry-run` for testing updates on an existing canary.

```bash
aws synthetics start-canary-dry-run \
  --name checkout-api-health \
  --runtime-version syn-nodejs-puppeteer-9.1
```

Canary artifacts also deserve attention. Canaries can store load timing data, screenshots, logs, reports, and HAR-style request evidence. This is useful during incidents because the responder can see what the synthetic browser saw. It also means artifact storage needs retention, encryption, and access controls. AWS documents that canaries store artifacts in Amazon S3 by default, with encryption at rest using an AWS-managed KMS key unless you choose another encryption option.

## Canary Permissions and Security
<!-- section-summary: Canary roles need the permissions to write artifacts, logs, metrics, optional traces, and optional VPC network interfaces, while scripts and artifacts need tight access controls. -->

Every canary runs with an IAM role. The trust policy allows `lambda.amazonaws.com` to assume the role because CloudWatch Synthetics runs the canary as a Lambda function.

At minimum, a canary role usually needs permissions to:

* Put and get objects in the S3 results location.
* Get the S3 bucket location.
* Create and write CloudWatch Logs streams.
* Publish CloudWatch metrics to the `CloudWatchSynthetics` namespace.
* Put X-Ray trace segments if active tracing is enabled.
* Create, describe, and delete network interfaces if the canary runs in a VPC.
* Use the configured KMS key if custom encryption protects artifacts.

AWS can create a scoped-down role when you create a canary in the console. If you create the role yourself, keep the S3, Logs, and KMS resources narrow. A canary that only writes to `s3://synthetics-artifacts-prod/checkout-api-health/` should not have broad write access to every bucket in the account.

Security also applies to the script itself. AWS warns that if you pass canary code directly as a zip file, the script contents can appear in CloudTrail logs. If the script contains sensitive material, AWS strongly recommends storing it as a versioned S3 object and passing the S3 location instead. In practice, the better pattern is stronger: keep secrets out of canary code, read secrets from a managed secret store when needed, and use a test identity with the smallest possible permissions.

Canaries also collect evidence that can contain sensitive data. AWS documents that exception messages and stack traces can appear in CloudWatch Synthetics, CloudWatch Logs, and S3 artifacts. Request URLs, status codes, headers, and bodies can appear in reports if configured. For this reason, canary scripts should redact sensitive URL parameters, avoid logging authorization headers, and keep request and response bodies disabled unless a specific investigation needs them.

One more safety rule is about ownership. AWS says to use Synthetics canaries only for endpoints and APIs where you have ownership or permission. A canary that runs every minute creates real traffic. Pointing it at a third-party or untrusted site can create security, cost, and policy problems.

## Groups, Alarms, and Canary SLOs
<!-- section-summary: Canary groups organize related checks, while CloudWatch alarms and SLOs turn canary success and duration into operational targets. -->

As the number of canaries grows, teams need a way to organize them. **Synthetics groups** collect related canaries so a team can view and manage a customer journey or application surface together.

AWS documents groups as global resources. A group can include canaries from multiple Regions and can be viewed from supported Regions. Current AWS limits documented for groups are:

| Group limit | AWS documented value |
|---|---|
| Canaries per group | 10 |
| Groups per account | 20 |
| Groups per canary | 10 |

For the checkout team, a group called `checkout-critical-path` might contain the homepage heartbeat, API health canary, browser checkout journey, and payment quote canary. If customers report checkout trouble, responders can open one group and see the synthetic view of the whole path.

Canaries publish metrics that can feed CloudWatch alarms. When you create a canary in the console, AWS can create default alarms. For SLO-style operations, Application Signals can create an SLO on a Synthetics canary. AWS documents two canary SLO metrics:

* **SuccessPercent**: The percentage of successful canary runs.
* **Duration**: How long each canary run takes to complete.

A practical checkout canary SLO might say: `checkout-journey-browser` should have 99.5% successful runs over 30 days, and duration should stay under 8 seconds for 99% of periods. That target catches public route failures even if backend service SLOs still look healthy.

This is where Synthetics connects back to article 5. Service SLOs track instrumented backend behavior. Canary SLOs track a planned outside-in journey. During incidents, the difference between those two signals is valuable. If the service SLO is green and the canary SLO is red, the problem might be DNS, CDN, frontend assets, auth redirects, browser code, or public network reachability.

## What CloudWatch RUM Adds
<!-- section-summary: CloudWatch RUM collects near real-time client-side telemetry from sampled real user sessions so teams can see browser, mobile, geography, and device impact. -->

CloudWatch Synthetics tells you whether a scripted journey works from scheduled checks. **CloudWatch RUM**, or real user monitoring, tells you what actual users are experiencing.

For web applications, AWS documents that CloudWatch RUM can collect and view client-side data about page load times, client-side errors, and user behavior from actual user sessions in near real time. For mobile applications, AWS documents screen load times, app launch times, network errors, crashes, Android ANR, and iOS app hangs.

This signal catches problems canaries can miss. A canary might run from one Region with one browser shape and one test account. Real users arrive from many countries, devices, browsers, extensions, networks, and cached states. A page can work for the canary while failing for Safari users, low-memory devices, or users in a specific geography.

RUM helps answer questions like:

* Which browsers see the new checkout JavaScript error?
* Did page load time rise after the last frontend release?
* Are mobile users seeing more HTTP 5xx calls than desktop users?
* How many unique users or sessions were affected?
* Which page route has the worst experience?

In the checkout incident from the opening section, RUM is the signal that reveals the browser error before the backend service receives any request.

## App Monitors, Sessions, and Privacy
<!-- section-summary: A RUM app monitor controls sampling, telemetry types, authorization, cookies, retention, page coverage, and optional X-Ray tracing. -->

To use CloudWatch RUM, you create an **app monitor**. An app monitor is the CloudWatch RUM resource that receives telemetry for one web or mobile application. For a web app, the console generates a code snippet or NPM configuration that loads the RUM web client in the application.

The app monitor controls several choices:

| App monitor setting | What it controls | Production guidance |
|---|---|---|
| **Telemetry types** | Errors, performance, HTTP telemetry, and optional custom events. | Collect the data you need, because more events can increase cost. |
| **Session sample rate** | The portion of sessions that send RUM data. | Start with enough coverage to see patterns, then adjust for traffic and cost. |
| **Cookies** | Whether RUM sets user and session cookies. | Enable only after privacy review because cookies allow session and user journey views. |
| **Authorization** | Resource policy, Cognito identity pool, or another identity provider. | Decide who can send `PutRumEvents` to the app monitor. |
| **CloudWatch Logs copy** | Whether RUM sends copies of telemetry into CloudWatch Logs. | Use when longer retention or log querying is needed, with clear retention settings. |
| **Page include/exclude rules** | Which pages RUM monitors. | Exclude admin or sensitive pages if they should not send client telemetry. |
| **X-Ray tracing** | Whether sampled `XMLHttpRequest` and `fetch` calls create traces. | Enable for critical user journeys that need frontend-to-backend correlation. |

AWS documents that RUM data is retained for 30 days and then deleted. If you want to keep copies longer, the app monitor can send telemetry to CloudWatch Logs, where the log group's retention can be adjusted.

Privacy deserves a real review. AWS strongly recommends avoiding sensitive identifying information such as account numbers, email addresses, or other personal information in free-form fields. If cookies are enabled, the RUM web client can collect a randomly generated user ID and a session ID that persist across page loads. That enables unique user counts, session counts, sessions with errors, and user journeys. Without cookies, RUM can still record aggregated page-specific information such as browser, operating system, device type, web vitals, page views, and pages that experienced errors.

The AWS CLI can create an app monitor with explicit sampling, telemetry types, cookies, and X-Ray. In a real application, the `IdentityPoolId` and role would come from your authorization setup.

```bash
aws rum create-app-monitor \
  --name checkout-web-prod \
  --domain shop.example.com \
  --platform Web \
  --app-monitor-configuration '{
    "IdentityPoolId": "us-east-1:00000000-0000-0000-0000-000000000000",
    "SessionSampleRate": 0.25,
    "AllowCookies": true,
    "Telemetries": ["errors", "performance", "http"],
    "EnableXRay": true
  }' \
  --cw-log-enabled
```

The app monitor is only the receiver. The web application still needs the RUM client snippet or NPM package installed so browser sessions can send events.

## Errors, Page Load Performance, and Custom Context
<!-- section-summary: RUM gives teams better filters when they collect the right built-in telemetry and add safe release or page context. -->

RUM has three everyday uses for a web application: **JavaScript errors**, **page load performance**, and **HTTP request behavior**.

A **JavaScript error** is a client-side exception thrown by browser code. RUM can collect error type, message, and stack trace when error telemetry is enabled. In production, this is how the checkout team sees that version `2026.06.13.4` throws `TypeError` on the checkout page only in one browser family.

**Page load performance** is the time and resource behavior of page navigation and rendering. RUM performance telemetry can show page load times, Apdex scores in the dashboard, device breakdowns, and metrics in the `AWS/RUM` namespace. For checkout, this helps separate "the API is slow" from "the page bundle is too heavy" or "one geography has poor client-side load time."

**HTTP telemetry** is browser-side network behavior from calls made by the page. RUM can collect HTTP errors thrown by the application. This is useful when the backend returns 5xx only for real user headers, auth states, or geographies that a canary did not cover.

Built-in dimensions are useful, but release context makes them much better. AWS documents custom metadata with session attributes and page attributes. A team can add a release version as a session attribute and a route template as a page attribute. Then, during an incident, responders can filter RUM errors by version and page template.

```typescript
import { AwsRum, AwsRumConfig } from 'aws-rum-web';

const config: AwsRumConfig = {
  allowCookies: true,
  endpoint: 'https://dataplane.rum.us-east-1.amazonaws.com',
  guestRoleArn: 'arn:aws:iam::123456789012:role/RUM-Monitor-us-east-1-checkout-Unauth',
  identityPoolId: 'us-east-1:00000000-0000-0000-0000-000000000000',
  sessionSampleRate: 0.25,
  telemetries: ['errors', 'performance', 'http'],
  enableXRay: true,
  disableAutoPageView: true,
  sessionAttributes: {
    applicationVersion: '2026.06.13.4'
  }
};

const rum = new AwsRum(
  '00000000-0000-0000-0000-000000000000',
  '2026.06.13.4',
  'us-east-1',
  config
);

rum.recordPageView({
  pageId: '/checkout',
  pageAttributes: {
    template: 'checkout'
  }
});
```

AWS documents limits for custom metadata: each event can include up to 10 custom attributes, keys have length and character limits, values must be strings, numbers, or booleans, and keys cannot begin with `aws:`. That limit is healthy. Custom metadata should describe release, route, experiment, or customer segment in a safe way. It should not contain emails, account IDs, names, cart contents, or tokens.

RUM also supports custom events when the app monitor allows them. Use custom events sparingly. A custom event like `checkout_button_clicked` can help measure funnel behavior. A custom event that dumps form state creates privacy risk and noisy data.

## X-Ray and Application Signals Integration
<!-- section-summary: X-Ray tracing connects canary and RUM client behavior back to backend services, and Application Signals can display those client and canary relationships. -->

Synthetics and RUM become much more powerful when they connect to traces.

For canaries, AWS documents that active X-Ray tracing is available for canaries using the `syn-nodejs-2.0` or later runtime. With tracing enabled, calls made by the canary through the browser, AWS SDK, HTTP modules, or HTTPS modules send traces. Traced canaries can appear on the X-Ray Trace Map and within Application Signals after the application is enabled for Application Signals. AWS also notes that Firefox browser canaries currently lack X-Ray tracing support and that tracing adds some canary runtime overhead.

For RUM, AWS documents that enabling X-Ray on an app monitor traces sampled `XMLHttpRequest` and `fetch` requests. The RUM dashboard, X-Ray Trace Map, and trace detail pages can then show traces and segments from those user sessions. By default, client-side traces stay separate from downstream server-side traces. To connect client and server traces, the RUM web client can add an X-Ray trace header to HTTP requests by setting `addXRayTraceIdHeader` to `true` for HTTP telemetry.

```javascript
const rumConfig = {
  enableXRay: true,
  telemetries: [
    'errors',
    'performance',
    ['http', { addXRayTraceIdHeader: true }]
  ]
};
```

This changes the incident path.

Without client tracing, the checkout team sees that real users have a page error or HTTP failure, then manually searches backend traces around the same time. With client tracing, a sampled user session can connect the browser request to the backend path. The team can move from RUM page view to X-Ray trace to Application Signals service detail, then to logs and dependency metrics.

Application Signals also brings the views together. AWS documents that when X-Ray tracing is enabled on Synthetics canaries, calls from canary scripts can be associated with services and displayed in the service detail page. When X-Ray tracing is enabled on the RUM web client, requests to services can be associated and displayed within the service detail page. This gives the responder one service page that includes backend operations, dependencies, canary checks, and client pages.

## Putting It All Together
<!-- section-summary: Synthetics, RUM, X-Ray, and Application Signals close the gap between backend service health and actual customer experience. -->

The AWS Observability module now has a full path from raw evidence to customer experience.

* **Logs** preserve detailed events and stack traces.
* **Metrics and alarms** show fleet-wide numeric behavior and trigger response.
* **Distributed tracing** connects one request across service boundaries.
* **Application Signals** turns telemetry into services, operations, dependencies, SLIs, SLOs, and investigations.
* **CloudWatch Synthetics** runs scheduled canary checks for public endpoints, APIs, and browser journeys.
* **CloudWatch RUM** collects real user experience from sampled web and mobile sessions.
* **X-Ray integration** connects canary and RUM requests back to backend traces and Application Signals service pages.

For the checkout platform, the final operating model is clear:

| Question | Best first signal |
|---|---|
| Is the backend service meeting its target? | Application Signals SLO |
| Which operation or dependency is unhealthy? | Service detail page |
| Can the public journey work right now? | Synthetics canary |
| What are real users seeing? | RUM app monitor |
| Which request path explains the failure? | X-Ray trace |
| What exact error did the code write? | CloudWatch Logs |

This is the practical version of observability on AWS. The team starts before the customer screenshot arrives. It watches the service promise, tests the public journey, records real user experience, and keeps the trace and log path ready for diagnosis.

## What's Next
<!-- section-summary: The next article applies the observability pieces to Lambda, ECS, and EKS runtime operations. -->

You now have the customer edge covered. Synthetics checks whether the public journey works on schedule, and RUM shows what sampled real users experience in browsers and mobile clients.

The next article turns back toward the runtime layer. Lambda, ECS, and EKS all send logs, metrics, traces, and platform-specific health signals in different ways. Understanding those differences helps the team wire the same observability practice into serverless functions, container services, and Kubernetes clusters.

---

**References**

* [Synthetic monitoring (canaries)](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html) - AWS overview of canaries, supported script languages, Lambda runtime model, browser support, scheduling, Application Signals integration, and X-Ray tracing requirement.
* [Creating a canary](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_Create.html) - AWS steps for canary creation, blueprint and custom scripts, schedules, retention, artifacts, roles, alarms, and created resources.
* [Synthetics runtime versions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_Library.html) - AWS runtime version overview and recommendation to use recent runtimes.
* [Runtime versions support policy](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Runtime_Support_Policy.html) - AWS runtime maintenance, deprecation behavior, and migration guidance.
* [Performing safe canary updates](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/performing-safe-canary-upgrades.html) - AWS guidance for dry runs, runtime updates, code changes, and safe update practices.
* [Required roles and permissions for canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_CanaryPermissions.html) - AWS trust policy and permission examples for S3 artifacts, CloudWatch Logs, CloudWatch metrics, X-Ray, KMS, and VPC access.
* [Security considerations for Synthetics canaries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/servicelens_canaries_security.html) - AWS guidance for secrets, script storage, S3 permissions, stack traces, URL redaction, request data, and scoped roles.
* [Groups](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Groups.html) - AWS group behavior, global resource behavior, and group limits.
* [Canaries and X-Ray tracing](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries_tracing.html) - AWS guidance for active tracing, canary trace visibility, Application Signals integration, limitations, and `xray:PutTraceSegments`.
* [create-canary CLI reference](https://docs.aws.amazon.com/cli/latest/reference/synthetics/create-canary.html) - AWS CLI shape for creating a canary with code, artifacts, schedule, execution role, and runtime version.
* [start-canary-dry-run CLI reference](https://docs.aws.amazon.com/cli/latest/reference/synthetics/start-canary-dry-run.html) - AWS CLI shape for testing canary updates before committing them.
* [CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html) - AWS overview of real user monitoring for web and mobile apps, user sessions, retention, app monitors, sampling, dashboards, and Application Signals integration.
* [Creating a CloudWatch RUM app monitor](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-get-started-create-app-monitor.html) - AWS setup for telemetry types, cookies, session sample rate, retention, authorization, page filtering, X-Ray tracing, and code snippets.
* [Viewing the CloudWatch RUM dashboard](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-view-data.html) - AWS dashboard details for app monitors, performance, errors, sessions, metrics, and configuration views.
* [Information collected by the CloudWatch RUM web client](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-datacollected.html) - AWS schema for sessions, events, metadata, page views, JavaScript errors, DOM events, navigation events, and user-agent data.
* [Data protection and data privacy with CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-privacy.html) - AWS privacy guidance for sensitive data, cookies, user IDs, session IDs, user journeys, and aggregated data without cookies.
* [Modifying the RUM web client snippet](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-modify-snippet.html) - AWS guidance for X-Ray end-to-end tracing and `addXRayTraceIdHeader`.
* [CloudWatch metrics collected with RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-metrics.html) - AWS metric namespace and web/mobile RUM metrics.
* [Specify custom metadata](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-custom-metadata.html) - AWS guidance for session attributes, page attributes, limits, and console filtering.
* [Send custom events](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-custom-events.html) - AWS guidance for custom RUM events, requirements, and search.
* [create-app-monitor CLI reference](https://docs.aws.amazon.com/cli/latest/reference/rum/create-app-monitor.html) - AWS CLI shape for app monitor configuration, telemetry types, sampling, cookies, X-Ray, CloudWatch Logs copies, and platform values.
