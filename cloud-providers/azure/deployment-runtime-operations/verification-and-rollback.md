---
title: "Verification, Rollback, and Runtime Operations"
description: "Use health checks, smoke tests, Application Insights, Azure Monitor alerts, release records, rollback, and runtime actions after Azure traffic moves."
overview: "A release still needs active judgment after traffic reaches the candidate. This article explains the watch window, layered verification, rollback versus fix-forward choices, and the runtime operations that keep the service stable after the release decision."
tags: ["verification", "rollback", "health-checks", "application-insights", "azure-monitor"]
order: 3
id: article-cloud-providers-azure-deployment-runtime-operations-release-verification-rollback-decisions
aliases:
  - verification-and-rollback
  - release-verification-and-rollback-decisions
  - cloud-providers/azure/deployment-runtime-operations/verification-and-rollback.md
  - cloud-providers/azure/deployment-runtime-operations/release-verification-and-rollback-decisions.md
---

## Table of Contents

1. [What This Article Covers](#what-this-article-covers)
2. [The Release Continues When Traffic Moves](#the-release-continues-when-traffic-moves)
3. [Watch Window](#watch-window)
4. [How To Run The Watch Window](#how-to-run-the-watch-window)
5. [Verification Has Layers](#verification-has-layers)
6. [The Industrial Observability And On-Call Stack](#the-industrial-observability-and-on-call-stack)
7. [Health Checks and Smoke Tests](#health-checks-and-smoke-tests)
8. [Real Traffic Telemetry](#real-traffic-telemetry)
9. [Rollback](#rollback)
10. [How To Roll Back In Azure](#how-to-roll-back-in-azure)
11. [Failure Scenarios and Decisions](#failure-scenarios-and-decisions)
12. [Runtime Operations After the Decision](#runtime-operations-after-the-decision)
13. [How To Verify After The Action](#how-to-verify-after-the-action)
14. [Release Record](#release-record)
15. [Putting It All Together](#putting-it-all-together)

## What This Article Covers
<!-- section-summary: The final part of the module focuses on evidence and decisions after users start reaching the candidate. -->

The previous article gave the orders API a controlled rollout path. The candidate revision has runtime settings, Key Vault access, traffic weights, and a rollback shape. This article starts at the moment real production traffic reaches that candidate and the team has to decide what happens next.

We will keep using `devpolaris-orders-api`. The team ships receipt retry code in revision `orders-api--v31`. Traffic starts at 10 percent on the candidate and 90 percent on the stable revision `orders-api--v30`. The first direct checks passed, but production traffic has real customers, real payment timing, real storage behavior, and real dependency pressure.

This article has four jobs. First, we define the **watch window** so the team knows who is watching which signals. Then we connect platform health, smoke tests, real traffic telemetry, and Azure Monitor alerts. After that, we compare **rollback** and **fix forward** decisions. Finally, we talk about runtime operations after the decision, such as scaling, restarting, draining traffic, restoring configuration, and writing the release record.

## The Release Continues When Traffic Moves
<!-- section-summary: Moving traffic starts the verification period where the team proves the candidate behaves well for real users. -->

Traffic movement is the moment the release is visible to users. In App Service, traffic might move through a slot swap or slot routing. In Container Apps, traffic might move through revision weights. In AKS, traffic might move through a rolling update, service selector, ingress route, or progressive delivery controller.

The team still has active work after traffic moves because staging only approximates production conditions. Production has real customer data, real concurrency, real dependency limits, real background jobs, real caching, and real user behavior. A candidate can pass `/healthz`, pass a staging smoke test, and then fail for a production-only path because the storage account permission, database lock, request size, or feature flag value only appears under real traffic.

For `devpolaris-orders-api`, the release question changes after 10 percent traffic moves to `orders-api--v31`. Before traffic, the team asked whether the candidate started and passed direct checks. After traffic, the team asks whether checkout stays healthy for customers. That includes failed requests, latency, Azure SQL dependency calls, Storage upload failures, unhandled exceptions, queue or event side effects, and customer support signals.

This is the point where the release can drift into guesswork if the team has no shared plan. One person watches a dashboard. Another checks logs. Someone else asks if the rollout is done. A watch window turns that loose attention into a named period of release verification.

## Watch Window
<!-- section-summary: A watch window is a time-boxed period where named owners inspect named production signals after traffic moves. -->

A **watch window** is a planned period of active observation after a release step. It has an owner, a duration, a traffic level, a signal list, and a decision rule. The team uses a watch window after each meaningful exposure change, such as 10 percent traffic, 50 percent traffic, or 100 percent traffic.

The watch window should match the user path that the release can affect. For a checkout API, a green process health check helps, and checkout-specific signals prove much more about payment confirmation, Azure SQL writes, receipt upload, and telemetry. The watch window needs signals that match those risks.

Here is a watch window for the orders API. It names the owner, the traffic level, the paths, the signals, and the decision rule before the candidate receives more traffic:

```yaml
watch_window:
  release: orders-api-2026-06-12-v31
  owner: platform-api-oncall
  traffic_level:
    orders-api--v30: 90
    orders-api--v31: 10
  duration: 20 minutes
  primary_paths:
    - POST /checkout
    - GET /orders/{id}
  signals:
    - failed checkout request rate
    - p95 checkout duration
    - Azure SQL dependency failures
    - receipt upload failures
    - unhandled exceptions
    - Application Insights ingestion present
  decision:
    continue_if: signals stay near baseline
    rollback_if: checkout failures rise above 2 percent for 5 minutes
    pause_if: telemetry is missing or evidence is incomplete
```

The exact numbers depend on the service. A high-traffic checkout API might need tighter thresholds and automated alerts. A low-traffic admin tool might need synthetic checks because real users arrive slowly. A risky migration might need a longer watch window because the failure appears after background jobs or delayed events run.

![Watch window board showing owner, traffic level, smoke tests, error rate, latency, and release decision](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-release-verification-rollback-decisions/watch-window-evidence.png)

*A watch window is useful when it names the owner, traffic level, evidence, and decision instead of asking people to casually watch dashboards.*

The useful habit is the same across those services: decide what evidence matters before traffic moves. A watch window gives the release owner a clear moment to continue, pause, roll back, or fix forward. Now we can talk about the layers of evidence inside that window.

## How To Run The Watch Window
<!-- section-summary: Running a watch window means capturing traffic state, checking health, watching targeted telemetry, and writing the decision at the end. -->

The hands-on watch window starts with a state capture. The release owner records the current traffic split and revision list before looking at graphs. That way, if the team later asks which version received traffic at 10:12, the release record has an answer.

```bash
az containerapp ingress traffic show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --output table

az containerapp revision list \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[].{name:name,active:active,trafficWeight:trafficWeight}" \
  --output table
```

The traffic table and revision table should agree. In this example, `v31` is active and serving 10 percent of traffic, so the watch window should filter telemetry by that candidate revision.

```console
RevisionName       Weight
-----------------  ------
orders-api--v30    90
orders-api--v31    10

Name             Active    TrafficWeight
---------------  --------  -------------
orders-api--v30  true      90
orders-api--v31  true      10
```

Then the release owner checks the direct health path for the candidate and stable paths. In a real system, those URLs might be a Container Apps revision label URL, an App Service staging slot URL, or a production URL with telemetry tags that identify the revision. The point is to check a user-facing endpoint rather than only the Azure resource page.

```bash
curl -fsS https://orders-api.devpolaris.example/healthz
curl -fsS https://orders-api.devpolaris.example/readyz
```

The next move is targeted telemetry. The release owner opens Application Insights Logs and keeps two saved Kusto queries ready: one for checkout requests and one for dependencies. The query should group by the revision or slot dimension that the app emits. That dimension lets the team connect failures to the candidate instead of only seeing a blended production error rate.

```kusto
requests
| where timestamp > ago(20m)
| where name == "POST /checkout"
| summarize
    total = count(),
    failed = countif(success == false),
    failureRate = todouble(countif(success == false)) / count(),
    p95DurationMs = percentile(duration, 95)
  by tostring(customDimensions.revision)
| order by failureRate desc
```

At the end of the watch window, the release owner writes one of four decisions in the release record: continue, pause, roll back, or fix forward. A useful record has the time, traffic split, signal snapshot, and decision. That short note is the difference between "we watched it for a while" and "we had a controlled release decision."

## Verification Has Layers
<!-- section-summary: Release verification combines platform health, direct checks, real traffic telemetry, alerts, and business signals. -->

**Verification** means proving that the candidate works well enough for the next release step. One signal rarely tells the whole story, so good verification has layers. Each layer answers a different question about the candidate.

The first layer is **platform health**. Azure can tell you whether the runtime started, whether probes pass, whether instances or replicas look healthy, and whether the platform can route traffic. App Service Health check, Container Apps probes, replica status, revision status, and platform logs all sit in this layer.

The second layer is **direct functional checks**. A smoke test sends a known request through a known path and checks the expected result. For the orders API, a smoke test might create a test checkout, verify an order row exists, verify a receipt object appears in Storage, and verify telemetry arrives in Application Insights.

The third layer is **real traffic telemetry**. Application Insights can show requests, dependencies, exceptions, traces, availability results, and operation correlation. This layer matters because production traffic can exercise paths that direct tests missed. It also lets the team compare candidate revision behavior against stable revision behavior during a split rollout.

The fourth layer is **alerting and business signals**. Azure Monitor alerts can watch metrics or log queries and route notifications through action groups. Business signals can include checkout conversion, support tickets, payment provider errors, or receipt delivery complaints. These signals connect platform health to user impact.

Here is a layered verification checklist for the orders API. Each row answers a different release question, which keeps the team from treating one green signal as the whole story:

| Layer | What it answers | Example signal |
|---|---|---|
| **Platform health** | Can Azure run and route to the candidate? | Container Apps revision ready, replicas available, probes passing |
| **Smoke tests** | Can a known path work on demand? | Test checkout writes order and receipt |
| **Real telemetry** | How does the candidate behave under users? | Failed requests, p95 latency, dependency failures, exceptions |
| **Alerts** | Did a threshold cross during the watch window? | Azure Monitor alert for checkout failure rate |
| **Business signals** | Are customers feeling the release? | Failed payment handoffs, support reports, missing receipts |

The layers work together. A green probe with rising checkout failures points toward application or dependency behavior. A failed probe with no user traffic points toward startup or readiness. Missing telemetry during a watch window turns the release into a blind rollout, so pausing can be the safer decision even if users look fine for the moment.

The layers work best when the team knows what each one proves. Health checks and smoke tests usually come first because they give the team controlled evidence before real users carry the release.

## The Industrial Observability And On-Call Stack
<!-- section-summary: Real release verification connects Azure telemetry to open standards, SLOs, alert routing, and an incident workflow. -->

Azure Monitor and Application Insights are the Azure surfaces in this article, but a production verification stack is usually wider. Many teams instrument application code with **OpenTelemetry**, send that telemetry to Application Insights or another backend, define **service level indicators** and **service level objectives**, route alerts through an on-call system, and keep a runbook next to the dashboard. The Azure tools hold the evidence; the operating practice tells the team what to do with it.

For the orders API, OpenTelemetry should add stable fields that make release queries possible. The exact backend can be Application Insights, Grafana, Datadog, New Relic, Honeycomb, or another tool chosen by the company. The important release fields are provider-neutral: service name, environment, version, revision, route, dependency target, and trace id. Azure Monitor's OpenTelemetry distribution can export those traces, metrics, and logs into Application Insights, where the Kusto queries in this article can group by revision.

AWS teams can use the same telemetry contract with CloudWatch, X-Ray, or another backend. The release query needs stable fields such as service, version, route, dependency target, and trace ID no matter which provider stores the telemetry.

```yaml
telemetry_contract:
  standard: OpenTelemetry
  backend: Application Insights
  required_attributes:
    service.name: devpolaris-orders-api
    deployment.environment: production
    service.version: v31
    revision: orders-api--v31
    http.route: POST /checkout
    cloud.region: uksouth
  release_queries_group_by:
    - revision
    - http.route
    - dependency target
```

SLOs turn that telemetry into a release decision. An SLI is the measured signal, such as successful checkout requests divided by total checkout requests. An SLO is the target, such as 99.5 percent successful checkout requests over a rolling window. The watch-window threshold can be stricter than the long-term SLO because a release owner wants to catch a bad candidate quickly.

```yaml
slo_release_gate:
  user_journey: checkout
  sli: successful POST /checkout requests / total POST /checkout requests
  long_term_slo: 99.5 percent success over 28 days
  watch_window_gate:
    rollback_if: failure rate above 2 percent for 5 minutes on candidate revision
    pause_if: telemetry missing for candidate revision
  alert_route:
    azure_monitor_action_group: ag-platform-api-prod
    incident_channel: teams-platform-api-incidents
    pager: platform-api-oncall
    runbook: rollback-orders-api-v31
```

The on-call workflow is the last piece. When an alert fires, the release owner should know who is paged, where the incident conversation happens, which dashboard or workbook to open, which rollback command is approved, and who writes the decision in the release record. That sounds procedural, but it is what keeps a release from turning into several people interpreting the same graph differently while users wait.

This stack also keeps the article grounded in real industry practice. Azure Monitor gives the alert and query surface. OpenTelemetry keeps instrumentation portable. SLOs and error budgets come from site reliability engineering practice. PagerDuty, Opsgenie, ServiceNow, Teams, Slack, or a similar system carries the human response. A good Azure release connects all of them before traffic moves.

## Health Checks and Smoke Tests
<!-- section-summary: Health checks prove the runtime can serve traffic, while smoke tests prove a small user path works end to end. -->

A **health check** is a lightweight endpoint or probe that tells the platform whether the app instance can receive traffic. App Service Health check pings a configured path and expects a healthy HTTP response. Container Apps supports startup, liveness, and readiness probes. Kubernetes-based runtimes use similar probe ideas through startup, liveness, and readiness checks.

Health checks should match the traffic decision. A shallow endpoint that only returns `200 OK` from memory proves the process is alive. A stronger readiness check can prove the app loaded configuration, can reach critical dependencies, and can serve the user path. The team should keep the endpoint fast and reliable, because a fragile health check can remove healthy instances from rotation and create extra trouble during a release.

For the orders API, a useful health response might expose readiness while keeping secrets hidden. The endpoint gives the release owner dependency evidence while leaving out connection strings and customer data:

```json
{
  "status": "ready",
  "version": "v31",
  "checks": {
    "configurationLoaded": true,
    "sqlReachable": true,
    "storageReachable": true,
    "telemetryConfigured": true
  }
}
```

This response tells the release owner that the runtime can see the dependencies it needs. It keeps connection strings, secret values, database names beyond what the team intentionally exposes, and customer data out of the response. It also gives the team a simple way to compare the candidate with the stable version.

A **smoke test** is a small test of a real user path. It runs after deployment and before or during traffic exposure. For the orders API, a smoke test can create a test order, verify the API returns a successful checkout response, confirm Azure SQL has the order row, confirm Storage has the receipt, and confirm Application Insights has a trace or request event for the operation.

```yaml
smoke_test:
  name: checkout receipt path
  target: orders-api--v31 direct revision endpoint
  steps:
    - create test checkout with sandbox payment token
    - verify API returns 201
    - verify order row exists in Azure SQL
    - verify receipt object exists in Storage
    - verify request telemetry appears in Application Insights
  cleanup:
    - mark test order as synthetic
    - delete synthetic receipt if policy allows
```

Health checks and smoke tests give the team controlled evidence. Real users still matter because they bring request shapes and timing that tests may miss.

## Real Traffic Telemetry
<!-- section-summary: Real traffic telemetry shows how the candidate behaves under production users, dependencies, and timing. -->

**Real traffic telemetry** is the evidence produced by actual production requests. In Azure, Application Insights is the main place many teams inspect this for applications. It can store request telemetry, dependency calls, exceptions, traces, availability results, custom events, and operation correlation so one checkout flow can be followed across several signals.

For a split rollout, the team needs a way to compare candidate and stable behavior. That might come from a revision name, slot name, deployment version, cloud role instance, custom dimension, or trace field. The application should include enough version context in telemetry so the release owner can separate `orders-api--v31` from `orders-api--v30`.

A simple Kusto query can summarize checkout requests during the watch window. The query groups by revision so the team can compare candidate and stable behavior side by side:

```kusto
requests
| where timestamp > ago(20m)
| where name == "POST /checkout"
| summarize
    total = count(),
    failed = countif(success == false),
    failureRate = todouble(countif(success == false)) / count(),
    p95DurationMs = percentile(duration, 95)
  by bin(timestamp, 5m), tostring(customDimensions.revision)
| order by timestamp asc
```

This query answers a release question directly: is the candidate revision failing or slowing down compared with the stable revision? It avoids mixing every endpoint together. A release that touches checkout should watch checkout. The team can create similar queries for dependencies and exceptions.

```kusto
dependencies
| where timestamp > ago(20m)
| where operation_Name == "POST /checkout"
| summarize
    calls = count(),
    failures = countif(success == false),
    p95DurationMs = percentile(duration, 95)
  by target, type, tostring(customDimensions.revision), bin(timestamp, 5m)
| order by timestamp asc
```

This dependency query helps the team see whether failures come from Azure SQL, Storage, payment provider calls, or another downstream service. If `orders-api--v31` has rising Storage failures while `v30` stays healthy, the receipt retry change is a strong suspect. If both revisions show Azure SQL failures, the release may have exposed an existing dependency problem rather than introduced a candidate-only bug.

Exceptions add another angle. They help the team see whether failures share one error type, one message, or one candidate revision:

```kusto
exceptions
| where timestamp > ago(20m)
| where operation_Name == "POST /checkout"
| summarize count() by type, outerMessage, tostring(customDimensions.revision)
| order by count_ desc
```

Telemetry also has a failure mode: it can go missing. A missing Application Insights connection string, broken Key Vault reference, sampling misconfiguration, or network issue can make the watch window look quiet. Quiet telemetry during a release should make the team cautious because the evidence layer itself is unhealthy.

![Telemetry correlation path showing a failing request connected to trace, dependency, exception, and alert evidence](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-release-verification-rollback-decisions/telemetry-correlation.png)

*Release telemetry works best when one user request can connect request status, trace context, dependency calls, exceptions, and alerts.*

When telemetry crosses a threshold, the team needs a recovery decision. That decision should protect users first and leave investigation for the stable period afterward.

## Rollback
<!-- section-summary: Rollback moves users back to a known-good runtime state when the candidate creates unacceptable impact. -->

**Rollback** means returning users to a known-good runtime state. It is a user-protection move first. The team can investigate the candidate after users are back on a stable path.

For Container Apps, rollback can mean moving 100 percent of traffic back to the previous revision. If `orders-api--v31` fails during the 10 percent watch window, the team can send all traffic to `orders-api--v30`. The candidate revision can stay available for direct inspection with zero traffic.

```yaml
container_apps_rollback:
  from:
    orders-api--v30: 90
    orders-api--v31: 10
  to:
    orders-api--v30: 100
    orders-api--v31: 0
  expected_effect: new checkout requests return to stable revision
```

For App Service, rollback often means swapping slots back. If the team swapped the staging slot into production and users start seeing failures, a swap back can restore the previous slot content and settings according to the slot configuration. The team still needs to check sticky settings because a slot swap may leave some values attached to the slot by design.

AWS rollback often uses the same pattern through different controls: a CodeDeploy rollback, a Lambda alias shifted back to the previous version, an ECS service deployment rollback, or an ALB weighted route moved away from the candidate. The Azure command changes, but the release decision is still about returning new traffic to a known-good path.

For configuration, rollback means restoring the previous setting or secret reference. If the retry feature flag causes failures, setting `CHECKOUT_RECEIPT_RETRY_ENABLED` back to `"false"` may stop the bad path. If a Key Vault reference points to a bad secret version, restoring the previous versioned URI may recover the app. The release record should show the previous values so nobody has to discover them during pressure.

Rollback has limits. If the release changed data in a way the old version fails to read, traffic rollback may need a data compatibility plan. If the release emitted duplicate receipt events, rollback may stop new damage while cleanup handles the duplicates. If the release changed a shared dependency, such as a SQL schema or storage layout, the recovery plan may include both traffic movement and data repair.

Rollback protects users. Fix forward can also be valid in some cases, so the team needs a decision framework.

## How To Roll Back In Azure
<!-- section-summary: A rollback runbook should name the exact Azure command, the expected state after the command, and the first verification check. -->

For Container Apps, the common rollback action is traffic movement. The release owner moves all traffic to the stable revision and then immediately shows the traffic split. The first command changes production behavior; the second command proves the platform accepted the change.

```bash
az containerapp ingress traffic set \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-weight orders-api--v30=100 orders-api--v31=0

az containerapp ingress traffic show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --output table
```

Healthy rollback output shows all new traffic returning to the stable revision. The candidate can remain active for investigation, but its traffic weight should be `0`.

```console
RevisionName       Weight
-----------------  ------
orders-api--v30    100
orders-api--v31    0
```

If the stable revision was deactivated earlier, the runbook needs to activate it before or during rollback. That is one reason release owners should keep the previous stable revision active through the watch window.

```bash
az containerapp revision activate \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision orders-api--v30
```

For App Service, the common rollback action after a slot swap is a swap back. The release owner uses the same slot swap command and then checks the production host. The team should also verify sticky settings, because a sticky production setting may remain attached to production through both swaps.

```bash
az webapp deployment slot swap \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --slot staging \
  --target-slot production

curl -fsS https://app-orders-api-prod.azurewebsites.net/healthz
```

For config rollback, the release owner restores the previous value in the same place it changed. If the bad change was an App Service feature flag, restore the app setting. If the bad change was a Container Apps env var, create a new revision with the previous value and control traffic to it after it passes checks.

```bash
az webapp config appsettings set \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --settings CHECKOUT_RECEIPT_RETRY_ENABLED=false

az containerapp update \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --revision-suffix v31-rollback-flag \
  --set-env-vars CHECKOUT_RECEIPT_RETRY_ENABLED=false
```

The runbook should end after the team verifies traffic, health, and user-path telemetry. A finished command is one checkpoint; recovered user traffic is the goal. That is where runtime operations take over.

## Failure Scenarios and Decisions
<!-- section-summary: The right release decision depends on user impact, evidence quality, rollback safety, and the size of the fix. -->

A **fix forward** is a small corrective change that keeps the release moving instead of returning to the previous version. It might be a feature flag change, a config restore, a quick patch, or a scale adjustment. Fix forward is useful when the issue is understood, the fix is small, and user impact stays controlled.

The choice between rollback and fix forward should use evidence rather than pride. A bad release can tempt a team to keep debugging because the fix feels close. Meanwhile users keep failing checkout. A clear decision rule helps the team protect users before the room gets too noisy.

Here are common scenarios for the orders API. The table keeps the decision tied to evidence rather than to a general feeling that the release is good or bad:

| Scenario | Evidence | Likely first decision |
|---|---|---|
| Candidate-only checkout failures | `v31` failure rate rises, `v30` stays healthy | Move traffic back to `v30` |
| Bad feature flag | Errors only happen when retry branch runs | Restore flag to `"false"` |
| Missing telemetry | App responds, but Application Insights receives no release data | Pause promotion and restore telemetry config |
| Dependency outage affecting both revisions | Azure SQL failures rise for `v30` and `v31` | Treat as dependency incident, pause release |
| Capacity pressure from rollout | Latency rises with replicas saturated | Scale or pause traffic increase, then re-evaluate |
| Harmless logging bug | Users unaffected, error understood, small patch ready | Fix forward can be reasonable |

The decision depends on four questions. These questions give the release owner a steady way to compare rollback and fix forward under pressure.

**How many users feel it?** A 10 percent rollout with rising checkout failures already affects real customers. A broken staging-only direct check affects nobody yet, so the team can pause and keep traffic steady.

**How good is the evidence?** Clear telemetry that points to `v31` supports a traffic rollback. Missing telemetry supports a pause because the team lacks proof that the candidate is healthy.

**How safe is rollback?** Traffic-only changes usually roll back cleanly. Database and data-shape changes may need compatibility checks before old code receives traffic.

**How small is the fix?** Restoring a feature flag can be smaller and faster than a full traffic rollback. Editing production code under pressure is a larger risk unless the issue is isolated and the deployment path is fast and reliable.

The team should also record the decision time. Release incidents often become confusing later because people remember the same 20 minutes differently. A timestamped decision gives the post-release review a stable timeline.

![Decision flow showing pause, rollback, or fix forward, followed by verification and evidence recording](/content-assets/articles/article-cloud-providers-azure-deployment-runtime-operations-release-verification-rollback-decisions/decision-recovery-loop.png)

*The release decision should lead to an action, a verification step, and a recorded evidence trail, not an open-ended debate during user impact.*

After the decision, runtime operations continue. The service still needs hands-on care even after the team chooses continue, pause, rollback, or fix forward.

## Runtime Operations After the Decision
<!-- section-summary: Runtime operations stabilize the service after continue, pause, rollback, or fix-forward decisions. -->

**Runtime operations** are the actions the team takes on the running service after the release decision. They include scaling, restarting, draining traffic, restoring settings, checking logs, validating telemetry, clearing bad instances, and watching alerts return to normal. These actions focus on production stability rather than product feature work.

If the team continues the rollout, runtime operations focus on controlled promotion. The team moves from 10 percent to 50 percent or 100 percent, starts another watch window, confirms alerts stay quiet, and checks that old revisions or slots remain available until rollback risk drops. The release record should show each traffic step and decision time.

If the team pauses, runtime operations focus on holding state. The candidate stays at its current traffic level or returns to zero traffic. The owner keeps the watch window active while the team gathers missing evidence. A pause is useful when the signal is unclear: telemetry missing, low traffic volume, noisy dependency errors, or a business signal that needs confirmation.

If the team rolls back, runtime operations focus on stabilization and cleanup. The owner moves traffic back, confirms new user requests hit the stable version, checks failure rate and latency return to baseline, and then inspects any partial work the candidate created. For the orders API, cleanup might involve failed checkout attempts, duplicate receipt uploads, or retry events that need reconciliation.

If the team fixes forward, runtime operations focus on proving the fix changed the right thing. A config restore needs a restart or revision update to take effect in some runtimes. A scale adjustment needs replica and latency monitoring. A patch release needs a new artifact, candidate version, and watch window. Fix forward still deserves release discipline because it changes production during an incident.

Here is a runtime operations board for the rollback case. It turns the decision into concrete platform actions and follow-up checks:

```yaml
runtime_operations:
  decision: rollback
  decision_time_utc: "2026-06-12T10:28:00Z"
  actions:
    - set orders-api--v30 traffic to 100 percent
    - set orders-api--v31 traffic to 0 percent
    - confirm POST /checkout requests land on v30
    - watch failed checkout rate for 20 minutes
    - inspect failed v31 operations for cleanup
  follow_up:
    - keep v31 active for investigation with no traffic
    - export release telemetry links
    - create issue for receipt retry bug
```

Runtime operations turn the decision into production stability. The last piece is recording enough of that work that the team can learn from it later.

## How To Verify After The Action
<!-- section-summary: Post-action verification proves that the recovery command actually changed user traffic and improved the user path. -->

After rollback or fix forward, the release owner should verify three things: Azure state, application health, and real traffic. Azure state proves the platform accepted the action. Application health proves the app can serve basic requests. Real traffic proves customers are recovering.

For Container Apps, Azure state means the traffic split shows 100 percent on the stable revision. If the bad revision still has traffic, the rollback is incomplete.

```bash
az containerapp ingress traffic show \
  --name ca-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --output table
```

For App Service, Azure state means the production host responds and the critical settings have the expected values. The exact setting list depends on the release, but feature flags, database targets, and Key Vault references are the usual suspects.

```bash
az webapp config appsettings list \
  --name app-orders-api-prod \
  --resource-group rg-devpolaris-prod \
  --query "[?name=='CHECKOUT_RECEIPT_RETRY_ENABLED' || name=='ORDERS_DB_SERVER']" \
  --output table

curl -fsS https://app-orders-api-prod.azurewebsites.net/healthz
```

The Container Apps output should still show `100` and `0` after a few minutes. The App Service output should show the recovered setting values, and the health endpoint should return the app-level checks that matter for this release.

```console
RevisionName       Weight
-----------------  ------
orders-api--v30    100
orders-api--v31    0

Name                            Value
------------------------------  --------------------------------
CHECKOUT_RECEIPT_RETRY_ENABLED  false
ORDERS_DB_SERVER                sql-orders-prod.database.windows.net

{"status":"ok","version":"2026.06.10","checks":{"sql":"ok","storage":"ok"}}
```

Real traffic verification goes back to Application Insights. The release owner checks the same query that triggered the rollback, then compares the period before and after the action. The goal is to see new checkout requests landing on the stable revision and failures returning near baseline.

```kusto
requests
| where timestamp > ago(30m)
| where name == "POST /checkout"
| summarize
    total = count(),
    failed = countif(success == false),
    failureRate = todouble(countif(success == false)) / count(),
    p95DurationMs = percentile(duration, 95)
  by bin(timestamp, 5m), tostring(customDimensions.revision)
| order by timestamp asc
```

The last verification step is cleanup evidence. The team checks whether failed checkout attempts, receipt retries, or duplicate receipt objects need repair. That work may become a separate incident task, but the release record should name it before the team closes the watch window.

## Release Record
<!-- section-summary: The release record captures the candidate, traffic steps, evidence, decisions, and runtime actions. -->

A **release record** is the timeline of the production change. The first article used a release record to name the artifact, runtime, settings, traffic plan, health signals, and rollback target. After traffic moves, the record should also capture evidence, decisions, and runtime operations.

The record can stay lightweight. It needs to answer the questions people ask during and after a release: what changed, who owned it, when traffic moved, what evidence appeared, what decision happened, what action followed, and what remains to clean up.

Here is a release record after the orders API rollback. It captures the traffic timeline, the evidence that triggered rollback, and the cleanup work that remains:

```yaml
release: orders-api-2026-06-12-v31
owner: platform-api-oncall
artifact:
  image: acrdevpolaris.azurecr.io/orders-api@sha256:8a7b2f42c49d
  commit: 7f31c9a
runtime:
  platform: Azure Container Apps
  stable_revision: orders-api--v30
  candidate_revision: orders-api--v31
traffic_timeline:
  - time_utc: "2026-06-12T10:00:00Z"
    state:
      orders-api--v30: 90
      orders-api--v31: 10
    decision: start 10 percent watch window
  - time_utc: "2026-06-12T10:25:00Z"
    evidence:
      checkout_failure_rate_v31: 4.8 percent
      checkout_failure_rate_v30: 0.3 percent
      storage_dependency_failures_v31: elevated
    decision: rollback
  - time_utc: "2026-06-12T10:28:00Z"
    state:
      orders-api--v30: 100
      orders-api--v31: 0
    decision: rollback complete
verification_after_action:
  - checkout failure rate returned near baseline
  - p95 checkout duration returned near baseline
  - no new receipt upload failures after traffic moved back
cleanup:
  - inspect failed v31 checkout operations
  - review retry branch storage handling
  - keep v31 active with zero traffic for debugging
```

This record is useful during the incident and after it. During the incident, it keeps the team aligned. After the incident, it gives the post-release review a timeline. The team can ask whether the watch window caught the problem quickly, whether rollback worked, whether telemetry had enough version context, and whether cleanup tasks were created.

Release records also feed better automation. If every rollback needs the same traffic command, the team can automate it. If every watch window needs the same Kusto queries, the team can save them in a workbook. If every release forgets to record previous config values, the pipeline can capture them before deployment.

Now let us connect the final story from traffic movement to stable production. Evidence behind each step keeps the release story clear.

## Putting It All Together
<!-- section-summary: Verification and runtime operations turn traffic movement into an evidence-based release decision. -->

The orders API release starts its 10 percent watch window. `orders-api--v31` receives a small slice of production traffic while `orders-api--v30` serves the rest. The owner watches checkout failures, p95 duration, Azure SQL dependency calls, Storage upload failures, exceptions, and telemetry health.

The first layer looks good: the candidate revision is ready, replicas are available, and probes pass. The smoke test also passes. A synthetic checkout writes an order row, uploads a receipt, and creates telemetry. At this point, the release has controlled evidence, but the watch window still needs real traffic evidence.

Real traffic shows the problem. Application Insights reports that checkout failures on `v31` climb above the rollback threshold while `v30` stays near baseline. The dependency query points toward Storage failures during the new retry branch. The evidence is candidate-specific, user-impacting, and above the decision rule.

The team rolls back by moving 100 percent traffic to `v30` and 0 percent to `v31`. Then runtime operations confirm new checkout requests land on the stable revision, failure rate returns near baseline, and no new receipt upload failures appear. The candidate revision stays active with no traffic so engineers can inspect logs and traces after user impact has stopped.

The release record captures the traffic step, evidence, rollback decision, action time, and cleanup tasks. The module ends with that habit: Azure release work is a loop of controlled exposure, layered evidence, clear decisions, and runtime operations. Tools like slots, revisions, app settings, Key Vault references, Application Insights, and Azure Monitor matter because they help the team run that loop with less guessing and less user pain.

---

**References**

- [Monitor App Service instances using Health check](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check) - Explains App Service Health check paths, expected status codes, and unhealthy instance behavior.
- [Health probes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/health-probes) - Documents startup, liveness, and readiness probes for Container Apps.
- [Application Insights telemetry data model](https://learn.microsoft.com/en-us/azure/azure-monitor/app/data-model-complete) - Documents request, dependency, exception, trace, availability, and operation correlation telemetry.
- [Application Insights overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview) - Explains how Application Insights monitors application performance and failures.
- [Overview of Azure Monitor alerts](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview) - Explains alert rules, metric alerts, log search alerts, action groups, and alert behavior.
- [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable) - Documents Azure Monitor OpenTelemetry distribution setup for collecting OpenTelemetry data into Application Insights.
- [OpenTelemetry documentation](https://opentelemetry.io/docs/) - Explains the vendor-neutral observability APIs, SDKs, collectors, and semantic conventions used across many monitoring backends.
- [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) - Introduces SLIs, SLOs, error budgets, and why service reliability needs explicit targets.
- [Implementing SLOs](https://sre.google/workbook/implementing-slos/) - Explains how teams turn SLOs and error budgets into operating policy and reliability decisions.
- [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions) - Describes revisions, revision modes, traffic control, labels, readiness checks, and reverting to previous revisions.
- [Traffic splitting in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting) - Documents weighted traffic splitting across active revisions.
- [Set up staging environments in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots) - Documents deployment slots, swap behavior, slot-specific settings, and swap rollback.
- [az containerapp ingress traffic](https://learn.microsoft.com/en-us/cli/azure/containerapp/ingress/traffic) - Documents Azure CLI commands for showing and setting Container Apps traffic weights.
- [az containerapp revision](https://learn.microsoft.com/en-us/cli/azure/containerapp/revision) - Documents Azure CLI commands for listing, activating, deactivating, and restarting Container Apps revisions.
- [az webapp deployment slot](https://learn.microsoft.com/en-us/cli/azure/webapp/deployment/slot) - Documents Azure CLI commands for App Service slot swaps.
- [az webapp config appsettings](https://learn.microsoft.com/en-us/cli/azure/webapp/config/appsettings) - Documents Azure CLI commands for listing and setting App Service app settings.
