---
title: "Canary Deployments"
description: "Limit release exposure with staged production traffic, comparable telemetry, statistical watch windows, and fail-closed gates."
overview: "A canary deployment treats release as controlled risk. Learn how traffic, sample size, comparison groups, version-segmented signals, capacity, stop rules, and progressive promotion turn a production change into a measured control loop."
tags: ["canary-deployments", "traffic-routing", "telemetry", "progressive-delivery"]
order: 3
id: article-cicd-deployment-strategies-canary-deployments
aliases:
  - /cicd/deployment-strategies/canary-deployments
---

## Table of Contents

1. [Why Is a Canary Deployment Controlled Risk?](#why-is-a-canary-deployment-controlled-risk)
2. [How Do Release Shape, Traffic Weight, Sample Size, and Time Fit Together?](#how-do-release-shape-traffic-weight-sample-size-and-time-fit-together)
3. [How Should Baseline and Canary Telemetry Be Compared?](#how-should-baseline-and-canary-telemetry-be-compared)
4. [How Do Assignment, Compatibility, and Feature Flags Affect the Test?](#how-do-assignment-compatibility-and-feature-flags-affect-the-test)
5. [How Do Automated Gates Form a Fail-Closed Control Loop?](#how-do-automated-gates-form-a-fail-closed-control-loop)
6. [How Do Capacity, Autoscaling, and Progressive Steps Interact?](#how-do-capacity-autoscaling-and-progressive-steps-interact)
7. [What Should Special Canary Forms and Metrics Prove?](#what-should-special-canary-forms-and-metrics-prove)
8. [How Does a Complete Canary Control Loop Fit Together?](#how-does-a-complete-canary-control-loop-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Blue-green deployments gave an application service a clean environment switch. Green was validated, traffic moved, and blue stayed nearby for rollback. That is a strong pattern, but promotion still sends the full user base to the new version at once.

Some bugs only appear with real production traffic. A request pattern may use more memory than staging ever showed. An edge case may fail only for a small subset of real users, or a dependency may behave differently under production latency and scale. Local tests, integration tests, and smoke tests help, but production traffic has a variety that test data rarely matches.

A **canary deployment** sends a small, controlled slice of production traffic to the new version while most users stay on the stable version. The team watches the new version beside the stable version. If the new version behaves well, the team increases traffic in steps. If it behaves badly, the team sends traffic back to the stable version before the whole service feels the failure.

A smaller audience limits exposure only when measurement and stop conditions can detect harm before the next promotion step.

Keep these questions in view as you work through the lesson:

1. **Why Is a Canary Deployment Controlled Risk?**
2. **How Do Release Shape, Traffic Weight, Sample Size, and Time Fit Together?**
3. **How Should Baseline and Canary Telemetry Be Compared?**
4. **How Do Assignment, Compatibility, and Feature Flags Affect the Test?**
5. **How Do Automated Gates Form a Fail-Closed Control Loop?**
6. **How Do Capacity, Autoscaling, and Progressive Steps Interact?**
7. **What Should Special Canary Forms and Metrics Prove?**
8. **How Does a Complete Canary Control Loop Fit Together?**

## Why Is a Canary Deployment Controlled Risk?
<!-- section-summary: Canary deployments reduce release exposure by letting a small part of real traffic try the new version first. -->

The key difference from blue-green is exposure. Blue-green asks, "Can the green environment handle production?" Canary asks, "Can a small amount of real production traffic prove this version deserves more traffic?"

To make that useful, we need two things: a traffic system that can split requests by weight, and telemetry that can compare the new version against the current baseline.

The name comes from the earlier practice of using a canary as an early warning in a dangerous environment. The software version is not “safer” because it is called a canary; the release is safer because exposure is bounded and evidence can stop further exposure.

Canary deployment is controlled risk. If B has failure probability or unknown behavior, moving 100% of traffic makes the initial blast radius the whole service. Starting with a small traffic share bounds the number of affected requests while creating an opportunity to learn. The goal is not to test casually on users; it is to limit unavoidable production uncertainty under explicit safeguards.

Deployment and traffic are separate dimensions. The team may deploy B at enough capacity before it receives any production request. It can then move traffic from 0% to 1%, 5%, and higher without changing the artifact. Conversely, running 5% of replicas as B does not guarantee 5% of traffic reaches B unless the routing layer enforces that relationship.

## How Do Release Shape, Traffic Weight, Sample Size, and Time Fit Together?
<!-- section-summary: A canary release keeps a stable baseline active while the new version receives a measured traffic slice. -->

The **baseline** is the current healthy version. The **canary** is the new version under evaluation. Both versions run at the same time, but the canary receives only a small percentage of traffic at first.

For the application service, the first step might look like this:

| Version | Role | Traffic |
|---|---|---:|
| `2026.06.13.1` | Baseline | 99% |
| `2026.06.13.2` | Canary | 1% |

The pipeline waits for a few minutes and checks signals. If the canary looks healthy, the next steps might be 5%, 10%, 25%, 50%, and 100%. The exact numbers depend on the service. A low-traffic internal API might need bigger steps or longer windows to collect enough requests. A high-traffic service path can collect meaningful signal from 1% quickly.

Rolling and canary can look similar because both run old and new instances together. Their control variable differs. Rolling primarily replaces replica membership according to capacity and health. Canary explicitly limits production exposure and promotes based on comparative evidence. A rolling update with no traffic analysis is not a canary merely because only a few new pods exist initially.

Blue-green prepares a separate full environment and commonly makes one routing switch. Canary can use two environment pools as its baseline and candidate, but changes the route progressively. Blue-green emphasizes environment separation and fast pointer reversal; canary emphasizes evidence at increasing real-traffic exposure.

Here is the same plan as controller-neutral release policy:

```yaml
canary:
  baseline-version: "2026.06.13.1"
  candidate-version: "2026.06.13.2"
  stages:
    - traffic: 1%
      observe: 10m
    - traffic: 5%
      observe: 15m
    - traffic: 25%
      observe: 20m
    - traffic: 100%
```

This is the release story written into the controller: start tiny, wait, increase, wait, increase again. The pauses give monitoring time to collect enough evidence. A canary step without a watch window can move too fast for metrics and alerts to catch up.

![Canary traffic ladder showing baseline, canary, 1 percent, 5 percent, 25 percent, 100 percent, and pass gates](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-traffic-ladder.png)

*A canary release earns more traffic in steps instead of asking the new version to handle everyone immediately.*

The shape depends on traffic routing. The next question is how the platform sends exactly 1%, 5%, or 25% of requests to the new version.

<!-- section-summary: Weighted routing lets the platform control how much live traffic reaches each version. -->

**Weighted routing** means the traffic layer sends a configured percentage of matching requests to each version. A gateway, load balancer, proxy, or routing layer can own that split. Its desired state can be represented simply:

```yaml
route:
  baseline:
    version: "2026.06.13.1"
    weight: 95
  canary:
    version: "2026.06.13.2"
    weight: 5
```

The stable subset receives 95% of matching requests. The canary subset receives 5%. The platform can change these weights during the release without rebuilding the application.

Weighted routing has a few practical details that beginners often miss.

Traffic weight is statistical, not a promise about every short interval. With independent 5% assignment, a sequence of twenty requests may contain zero, one, or several canary requests. Over larger samples the observed share tends toward the configured weight. Do not interpret a tiny window as if exactly one in every twenty requests must go to B.

Sample size matters because rare failures need enough opportunities to appear. If an error occurs once in ten thousand requests, a canary that sees one hundred requests is unlikely to reveal it. Very small canaries bound exposure strongly but may provide weak evidence. Choose weight and duration together from traffic volume, event rarity, business risk, and the minimum detectable regression.

Suppose baseline error probability is 0.1% and the team wants to detect a rise to 0.5%. A handful of candidate requests cannot distinguish those rates. The controller should not turn one success into proof or one isolated error into certain regression without considering sample and severity. Some events, such as corruption or a security violation, are severe enough to stop on one occurrence; ordinary noisy metrics need a planned statistical rule.

The number of candidate observations is approximately traffic rate multiplied by candidate weight and watch duration. If a service receives 100 requests per minute, a 1% canary expects about one request per minute, or roughly ten in ten minutes. That is useful for catastrophic failures but weak for a subtle ratio change. Increasing weight, time, or a targeted cohort increases information while changing exposure.

Time matters independently of request count. Memory leaks, queue buildup, cache expiry, scheduled work, connection exhaustion, and delayed downstream responses need elapsed time. A high-traffic service can collect a million requests in minutes and still miss a bug that appears after one hour.

The ideal comparison has a concurrent control group: baseline and canary serve comparable traffic during the same period. That controls for time-of-day load, a downstream incident, marketing traffic, or a regional network problem. Historical baselines help with context but cannot remove every current confounder.

Control and candidate should differ mainly by the release variable. If B receives one region while A receives another, a regional dependency outage can look like a version regression. Sticky cohorts, infrastructure pools, cache warmth, and autoscaling policy can all become confounders. Record these differences and interpret the comparison at the level its assignment supports.

First, low request volume can make percentages feel strange. If an admin API receives ten requests per hour, a 1% canary may receive no requests for a long time. For low-volume services, teams may use test users, internal users, region-based routing, or a longer watch window.

Second, user sessions may need stickiness. If a user starts a multi-step action through the canary and the next request goes to stable, the stable version must understand the session or data the canary wrote. The platform can use session affinity, header-based routing, or feature flags for selected users, but compatibility still matters.

Third, traffic percentage and capacity percentage are related. If the canary receives 5% of traffic, the team still needs enough canary instances to handle that traffic plus normal bursts. Heavy requests can overload a single canary pod despite the small traffic percentage.

Traffic weights create the experiment. Telemetry tells us whether the experiment is healthy.

## How Should Baseline and Canary Telemetry Be Compared?
<!-- section-summary: Canary decisions need side-by-side signals for baseline and canary, separate from one global service chart. -->

**Telemetry** is the data the system emits while it runs: metrics, logs, traces, and events. During a canary release, telemetry needs labels that separate baseline and canary. A global checkout error-rate chart can hide the problem because 1% bad traffic may barely move the total line.

For canary decisions, the team should compare the same signals for both versions:

| Signal | Baseline question | Canary question |
|---|---|---|
| Error rate | What is normal right now? | Is the new version worse than normal? |
| Latency | What p95 and p99 values are users seeing? | Is the new version slower under the same traffic period? |
| Saturation | How full are CPU, memory, queue workers, and DB pools? | Does the new version consume more resources per request? |
| Business result | How many requests succeed? | Does the canary reduce successful requests or successful outcomes? |

Labels make this comparison possible. An HTTP request metric might include service, route, status, and version. Calculate the error ratio independently for candidate and baseline during the same time window. Comparing a canary at 9 AM with a historical baseline at 2 AM mixes version change with different production conditions.

The tooling is secondary to consistent release and version attributes across metrics, logs, traces, and events. Without segmentation, a badly failing 1% canary contributes only a small change to the global service graph and can disappear inside baseline volume.

Compare ratios rather than only totals. Ten canary errors and one hundred baseline errors say little if the canary served one hundred requests and the baseline served one million. Error rate, success rate, CPU per request, and business completions per eligible attempt normalize different traffic volumes.

Latency averages can hide tail regressions. Compare percentiles such as p95 and p99, while remembering that a tiny sample makes high percentiles unstable. Segment by version first, then by relevant route, region, customer type, or workload class when those dimensions explain materially different behavior.

Business metrics may be more important than infrastructure health. B can return HTTP 200 quickly while calculating the wrong price, dropping an event, or reducing completion. Define the user or business outcome that the release is expected not to harm, and ensure the sample is large enough to interpret it.

## How Do Assignment, Compatibility, and Feature Flags Affect the Test?
<!-- section-summary: Random or sticky assignment changes what the canary measures, while mixed-version state and flags determine whether limited traffic truly limits risk. -->

Random request assignment produces a broad sample but may send one user's consecutive requests to different versions. Sticky assignment keeps a user, account, region, or device in one cohort for the watch period. Stickiness supports multi-step journeys and makes user-level debugging easier.

Cohorts can bias the test. Internal users, one region, new accounts, or opted-in customers may behave differently from the population that will receive 100%. A clean canary result for a friendly cohort is evidence only about that cohort. Expand cohorts or combine sticky and random stages before general promotion.

Old and new versions still coexist. They may share database rows, messages, sessions, and caches. A database migration applied once has a 100% blast radius even when B gets 1% of HTTP traffic. Use backward-compatible expand-and-contract changes and delay destructive contraction beyond the rollback window.

Feature flags reduce risk by separating deployed code from activated behavior. B can receive production traffic with a new path disabled, then enable that path for the canary cohort. Flags also support rapid deactivation without replacing the artifact. They do not remove the need to test the code and clean up obsolete branches later.

The assignment mechanism and data contract must agree. If B writes a new session or message that A cannot read, a sticky route may hide the problem until failover or promotion. Compatibility remains necessary even when traffic routing tries to keep users on one version.

![Canary telemetry comparison dashboard showing baseline and canary 5xx rate, p95 latency, checkout success, and CPU per request](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-telemetry-compare.png)

*Canary decisions need version-labeled telemetry so the team can compare the new slice against the stable baseline during the same time window.*

Once the signals exist, the deployment system can use them as gates.

## How Do Automated Gates Form a Fail-Closed Control Loop?
<!-- section-summary: Canary gates turn telemetry into release decisions that pause, promote, or roll back automatically. -->

A **gate** is a rule that decides whether the canary can continue. A manual gate might be a person reviewing a dashboard. An automated gate reads metrics and returns pass or fail. Mature teams usually combine both: automation catches clear failures, and humans review ambiguous changes for high-risk services.

For the application service, a canary policy might look like this:

```yaml
steps:
  - weight: 1
    duration: 10m
    pass:
      canary_5xx_rate: "< 0.5%"
      canary_p95_latency: "< baseline_p95 * 1.2"
      synthetic_checkout: "passing"
  - weight: 5
    duration: 15m
    pass:
      canary_5xx_rate: "< baseline_5xx_rate + 0.2%"
      payment_authorization_rate: ">= baseline - 0.5%"
  - weight: 25
    duration: 20m
    pass:
      canary_cpu_per_request: "< baseline * 1.3"
      support_error_events: "no spike"
```

Those rules should match the risk of the service. For a homepage banner service, the business gate may be page-render errors. For checkout, business success and business completion matter more than generic CPU. For a background worker, queue depth and processing delay may matter more than HTTP latency.

A good gate also defines the action on failure:

| Failure | Action |
|---|---|
| Readiness fails before canary traffic | Stop rollout and keep all traffic on baseline. |
| Canary error rate exceeds threshold | Set canary weight to 0 and mark release failed. |
| Canary latency rises but errors stay low | Pause and page the release owner for review. |
| Business metric drops | Stop promotion even if infrastructure metrics look healthy. |

The rollback action should be boring and rehearsed. With weighted routing, rollback often means setting the canary weight back to `0` and keeping the baseline at `100`. The team still needs to check whether the canary wrote data that makes the baseline fail. That is why the database compatibility lessons from blue-green also apply to canary.

Gates turn deployment into a feedback control loop. The controller applies a traffic input, observes system output, evaluates policy, then changes the next input. Three outcomes are useful: **advance** when evidence passes, **hold** when evidence is insufficient or ambiguous, and **abort** when a guardrail fails. Treating uncertainty as success makes automation dangerous.

Stop rules matter more than advancement rules because they bound harm. A release can wait safely for more evidence, but a clear error or business regression should remove canary traffic immediately. Define stop thresholds, evaluation delay, missing-data behavior, and the exact rollback action before the first request.

A canary should usually fail closed. Missing metrics, a broken analysis query, absent version labels, or an unreachable telemetry system should pause or abort the rollout rather than promote by default. The controller cannot infer health from missing evidence.

## How Do Capacity, Autoscaling, and Progressive Steps Interact?
<!-- section-summary: The candidate needs capacity proportional to routed work plus bursts, while autoscaling and nonlinear failure shape how quickly traffic may grow. -->

Canary capacity must match traffic. Sending 10% of traffic to one B instance while ninety A instances handle the rest creates a much higher per-instance load for B. A resulting latency spike would measure underprovisioning, not necessarily code quality. Provision a representative candidate pool and account for burst distribution.

Autoscaling can confound comparison. A and B may have different warm-up states, replica counts, scaling thresholds, or queue backlogs. CPU per request may look high while B is cold, and the autoscaler may add capacity during the analysis window. Observe replica and saturation state alongside service outcomes, and wait for an interpretable steady period.

Promotion should be progressive because scaling failures can be nonlinear. B may behave well at 1% and 5% but cross a lock, cache, database, or queue threshold at 25%. Each materially larger stage asks a new capacity question. Do not extrapolate a tiny slice blindly to full load.

Choose stage sizes from risk and system shape, not a ritual ladder. A low-risk stateless change may use fewer stages. A critical stateful path may use 0.1%, 1%, 5%, 10%, 25%, 50%, and 100% with long windows. Preserve enough baseline capacity to absorb immediate rollback at every stage.

## What Should Special Canary Forms and Metrics Prove?
<!-- section-summary: When percentage routing cannot produce useful samples, canaries can target cohorts, work partitions, or shadow evaluation instead. -->

Low-traffic systems may never collect a useful 1% sample. Use a larger weight, longer window, selected customers, one region, internal traffic, or a synthetic load that exercises representative behavior. The choice changes what the evidence can generalize to, so record the population explicitly.

Batch jobs have canaries too. Run B on a small partition, date range, queue shard, or duplicate input set; compare completion, errors, resource cost, and output quality with A; then expand the assigned work. Rollback may mean stopping future B assignments rather than routing HTTP traffic.

Shadow traffic is an earlier stage that copies real inputs to B but discards its response. It can reveal crashes, latency, and output differences without serving users. Side effects must be suppressed or redirected, sensitive data protected, and duplicate downstream load controlled.

For deterministic or comparable operations, analysis can compare A and B outputs directly. Differences may be expected, so normalize nondeterministic fields and define acceptable tolerances. A shadow mismatch is diagnostic evidence, not automatically a user-visible failure.

Canary users should not become test subjects blindly. Limit harm, respect privacy and consent requirements, avoid selecting vulnerable cohorts, and ensure support and incident teams can identify the affected population. Progressive delivery is an operational safety mechanism, not permission to experiment without product responsibility.

<!-- section-summary: Guardrails stop harm, success metrics evaluate intended outcomes, and noisy or weak metrics should not all become automatic blockers. -->

**Guardrail metrics** bound unacceptable harm: crash rate, errors, latency objectives, saturation, data loss, security events, and critical business failure. A clear guardrail breach should abort even if other signals improve.

**Success metrics** test the reason for the release: faster completion, better conversion, lower cost, improved quality, or fewer retries. They may require larger samples and longer analysis than safety guardrails. A neutral success result can still permit a technically safe release depending on product policy; a safety breach cannot be averaged away.

Not every metric should block deployment. Noisy dashboards, unrelated downstream totals, or measures with weak causal connection can create false stops. Classify each signal as blocking guardrail, advancement evidence, diagnostic context, or longer-term product analysis.

Beware multiple comparisons. If automation evaluates dozens of noisy metrics, at least one may cross a threshold by chance. Preselect the metrics and hypotheses tied to plausible failure modes, use persistence windows, and require sufficient sample. More graphs do not automatically produce stronger evidence.

Use independent evidence where possible. A version-relative error ratio, a synthetic transaction, a resource-per-request measure, and a business completion ratio fail for different reasons. Agreement across them is more useful than several near-duplicate alerts derived from the same request counter. Keep the blocking set small enough that owners understand every gate.

The metric itself can mislead through missing labels, retries counted as separate successes, aggregation across routes, survivorship bias, or delayed reporting. Validate the measurement path before trusting it to promote production code.

Now we can put the full canary release together.

## How Does a Complete Canary Control Loop Fit Together?
<!-- section-summary: A canary release combines weighted routing, labeled telemetry, watch windows, and automatic rollback rules. -->

The service team builds image `registry.example.com/service@sha256:8f3a...` and deploys it as the canary version. The stable version keeps most traffic. The traffic layer sends 1% of production requests to the canary.

During the first watch window, the deployment system compares canary and baseline telemetry. It checks readiness, HTTP 5xx rate, p95 latency, business success rate, CPU per request, and a synthetic transaction. Because metrics include a `version` label, the team can see whether the canary behaves differently from the stable version during the same time period.

If the canary passes, the controller increases traffic to 5%, then 25%, then 50%, then 100%, with pauses between steps. If a gate fails, the controller sends traffic back to stable and marks the release failed. The release owner can debug the canary with logs, traces, and metrics tied to the canary version.

The complete automated sequence deploys B at zero traffic, verifies readiness and observability, establishes a concurrent A baseline, assigns the first production cohort, waits for minimum time and sample, evaluates guardrails and success evidence, then advances, holds, or aborts. Every advance repeats the loop with a larger risk budget. Completion includes a full-traffic watch period before baseline capacity and rollback support are removed.

The rollout controller is not proving that B is universally correct. It is applying a policy that turns observations into bounded routing decisions. Progressive delivery is the broader practice of combining deployment automation, traffic control, measurement, and policy so release proceeds through evidence rather than one irreversible jump.

At each loop, the controller holds four pieces of state: desired candidate exposure, observed candidate and baseline behavior, policy thresholds, and the last known recoverable route. It should advance only from a stable measured state, serialize conflicting release changes, and preserve enough evidence to explain why the weight moved. This makes automation auditable instead of a hidden sequence of timer-driven percentages.

Promotion to 100% is still a canary decision, not the end of observation. Keep the former baseline available through a post-promotion watch window, continue version-aware checks while connections and background work converge, and close rollback only after full-load evidence covers the failure modes that smaller stages could not exercise.

The safety invariants are: baseline capacity can absorb rollback; candidate traffic never exceeds candidate capacity; telemetry distinguishes versions and comparable cohorts; mixed-version data remains compatible; missing evidence cannot silently promote; written guardrails stop harm; and every stage has a rehearsed path back to zero candidate traffic.

Choose strategies from the dominant risk. Use rolling when mixed versions are compatible and simple capacity-controlled replacement is enough. Use blue-green when a full candidate environment and clean routing pointer are valuable. Use canary when the uncertain behavior needs limited real production exposure and the service has enough traffic and observability to evaluate it.

Canary deployments shine when the main risk appears under real production behavior. They need more observability discipline than rolling or blue-green, because the release decision depends on measured signals. Without clear labels, thresholds, and rollback behavior, a canary acts like a slow full rollout with a nicer name.

![Canary release summary showing small slice, measure, pass, increase, fail, and rollback to zero percent](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-release-summary.png)

*A canary release is a loop: send a small slice, measure it, increase only on pass, and roll back to zero when a gate fails.*

There is still one more production question. When a deployment fails, should the team roll back to the previous version or roll forward with a fix? The next article focuses on that decision.

## Check Your Answers

:::expand[Why Is a Canary Deployment Controlled Risk?]{kind="recap"}
A canary bounds the first production exposure to B, observes it, and stops before the whole service is affected. Deployment creates candidate capacity; traffic assignment releases behavior. The canary is safer only when exposure, evidence, and rollback are controlled.
:::

:::expand[How Do Release Shape, Traffic Weight, Sample Size, and Time Fit Together?]{kind="recap"}
Rolling primarily replaces replicas; blue-green primarily switches between full environments; canary primarily limits and grows real traffic based on evidence. They can share infrastructure mechanisms, but the release control variable and safety question differ.

A weight is a probability over requests, not an exact short-window count. Small samples miss rare regressions, while short windows miss time-dependent failures. Choose weight and duration together and compare with a concurrent baseline under the same production conditions.
:::

:::expand[How Should Baseline and Canary Telemetry Be Compared?]{kind="recap"}
Segment signals by version and comparable route or cohort. Compare ratios such as errors per request and resources per request, plus tail latency and meaningful business outcomes. Global totals can hide a failing small canary inside baseline volume.
:::

:::expand[How Do Assignment, Compatibility, and Feature Flags Affect the Test?]{kind="recap"}
Random assignment broadens sampling; sticky cohorts support multi-step journeys but can bias results. A 1% traffic canary can still make global database changes, so preserve mixed-version compatibility. Flags separate deployment, routing, and feature activation into smaller controls.
:::

:::expand[How Do Automated Gates Form a Fail-Closed Control Loop?]{kind="recap"}
The controller applies a traffic step, observes, then advances, holds, or aborts. Stop rules bound harm and should be written first. Missing metrics, broken queries, or insufficient samples should hold or abort rather than count as health.
:::

:::expand[How Do Capacity, Autoscaling, and Progressive Steps Interact?]{kind="recap"}
Candidate capacity must match routed load plus bursts so comparison does not measure underprovisioning. Autoscaling and warm-up can confound early signals. Failures may be nonlinear, so larger stages ask new capacity questions and baseline must remain able to absorb rollback.
:::

:::expand[What Should Special Canary Forms and Metrics Prove?]{kind="recap"}
Low traffic needs larger or targeted cohorts, longer windows, or representative synthetic work. Batch canaries assign partitions or shards. Shadow traffic compares B without serving its response, but must isolate side effects and protect data. Each design limits what results generalize to.

Guardrails stop unacceptable harm; success metrics test intended benefit; diagnostic context explains behavior. Do not block on every noisy graph. Preselect causal signals, use persistence and sufficient samples, limit multiple comparisons, and validate measurement semantics.
:::

:::expand[How Does a Complete Canary Control Loop Fit Together?]{kind="recap"}
Deploy B at zero, verify instrumentation, establish baseline, route a small cohort, wait for sample and time, evaluate, then advance, hold, or abort repeatedly. Watch full traffic before cleanup and preserve invariants for capacity, compatibility, segmentation, missing data, and rollback.
:::

## References
