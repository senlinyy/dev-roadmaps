---
title: "Runtime Configuration and Safe Rollouts"
description: "Treat configuration, secrets, feature flags, traffic, and runtime state as versioned production changes that must be validated, observed, progressively exposed, and reversible."
overview: "Follow runtime values from parsing and precedence through dynamic propagation, secret rotation, candidate cohorts, health comparison, rollout units, configuration failure, last-known-good recovery, and incident barriers."
tags: ["configuration", "secrets", "feature-flags", "rollouts", "runtime"]
order: 2
id: article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables
aliases:
  - runtime-configuration-and-safe-rollouts
  - runtime-configuration-safe-rollouts
  - aws-runtime-configuration-and-safe-rollouts
  - article-cloud-providers-aws-deployment-runtime-operations-runtime-configuration-safe-rollouts
  - runtime-config-secrets-and-environment-variables
  - config-and-secrets
  - cloud-providers/aws/deployment-runtime-operations/runtime-config-secrets-and-environment-variables.md
  - cloud-providers/aws/deployment-runtime-operations/03-config-secrets.md
---

## Table of Contents

1. [What Is Runtime Configuration?](#what-is-runtime-configuration)
2. [How Do You Make Configuration Understandable and Valid?](#how-do-you-make-configuration-understandable-and-valid)
3. [How Do You Roll Out Secrets Safely?](#how-do-you-roll-out-secrets-safely)
4. [How Do Progressive Rollouts Reduce Risk?](#how-do-progressive-rollouts-reduce-risk)
5. [How Do You Measure the Candidate Correctly?](#how-do-you-measure-the-candidate-correctly)
6. [How Should a Distributed Configuration System Fail?](#how-should-a-distributed-configuration-system-fail)
7. [How Do Ownership, Guardrails, and Automation Make Changes Safer?](#how-do-ownership-guardrails-and-automation-make-changes-safer)
8. [How Does a Complete Safe Rollout Work?](#how-does-a-complete-safe-rollout-work)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A production system does not run on code alone. Its behavior is better modeled as:

```text
Runtime behavior = f(
  code,
  configuration,
  secrets,
  traffic,
  data,
  permissions,
  environment
)
```

The same binary can behave differently on a thousand instances because configuration differs. A healthy code deployment can be broken without changing one source line by changing a timeout, concurrency limit, database endpoint, feature flag, credential, or traffic weight. Anything capable of changing production behavior is part of the rollout system.

The rollout boundary therefore extends beyond the image or function package. A safe change must identify the configuration version, validate values before use, control secret rotation, expose only part of the fleet or traffic, compare candidate evidence with a trustworthy baseline, and define what pauses or reverses the change when the distributed system cannot read a new value safely. Clear ownership and automation make those decisions repeatable.

Keep these questions in view as you work through the lesson:

1. **What Is Runtime Configuration?**
2. **How Do You Make Configuration Understandable and Valid?**
3. **How Do You Roll Out Secrets Safely?**
4. **How Do Progressive Rollouts Reduce Risk?**
5. **How Do You Measure the Candidate Correctly?**
6. **How Should a Distributed Configuration System Fail?**
7. **How Do Ownership, Guardrails, and Automation Make Changes Safer?**
8. **How Does a Complete Safe Rollout Work?**

## What Is Runtime Configuration?
<!-- section-summary: Configuration selects how one deployed capability should behave now, and therefore represents executable production intent. -->

Suppose `PaymentService` contains logic that rejects payments above a limit and calls a bank with a timeout. The executable stays unchanged while these values change:

```text
MAX_PAYMENT=5000
BANK_TIMEOUT_MS=2000
```

Code and configuration answer different questions:

```text
Code:          How can this system behave?
Configuration: How should this instance behave right now?
```

The separation is useful. Changing a bank timeout from two seconds to three should not require recompiling the service. The same mechanism can also produce severe incidents. Changing `database.read_only=false` to `true` can disable writes. Raising `requests.max_concurrent` from 5,000 to 500,000 can overwhelm a dependency.

Configuration is therefore **executable intent**. It may be YAML, environment variables, flags, remote values, or command arguments rather than source code, but it directs production behavior.

Configuration includes more than obvious application settings:

- Environment variables and configuration files
- Feature flags and kill switches
- Dependency endpoints and connection pools
- Rate limits, concurrency, timeouts, and retry settings
- Routing weights and cohort targeting
- Database connection behavior
- Logging levels
- Secrets and credential versions
- Sometimes operational data that changes decision behavior

Treat important configuration with properties expected from software changes:

```text
versioned
reviewable
validated
auditable
observable
progressively deployable
reversible
```

Plain configuration should be boring. A visible document such as:

```yaml
server:
  port: 8080

database:
  host: db.internal
  pool_size: 40

payments:
  timeout: 2500ms

logging:
  level: INFO
```

is easier to reason about than hidden arithmetic or a deep inheritance chain from global through environment, Region, country, cluster, service, and one-off instance override.

For an important value, operators should be able to answer:

```text
effective value
source and precedence
configuration version
when it changed
who or what changed it
```

The **effective configuration** seen by the running process matters more during an incident than any one source file.

### Why Is a Rollout a Sequence of Runtime States?
<!-- section-summary: Production passes through mixed code, configuration, secret, flag, and traffic combinations, so safe engineering makes every adjacent state compatible. -->

Deployment is often pictured as version 17 becoming 18. The real production transition is larger:

```text
OLD STATE
code=v17 config=C42 flags=F11 secret=S8 traffic=100% v17

NEW STATE
code=v18 config=C43 flags=F12 secret=S9 traffic=100% v18
```

The risk lies in the intermediate combinations:

```text
v17 with C43
v18 with C42
v18 with the old secret
v18 deployed with the feature disabled
v18 with the feature enabled
20% v18 mixed with 80% v17
```

Every combination is a real runtime state. Some may never have been tested. Updates also do not normally arrive everywhere atomically.

Suppose four instances change `MAX_ITEMS` from 100 to 50:

```text
t0: A=100 B=100 C=100 D=100
t1: A=50  B=100 C=100 D=100
t2: A=50  B=50  C=100 D=50
t3: A=50  B=50  C=50  D=50
```

For part of the rollout, the fleet is heterogeneous. The design must ask whether requests, sessions, shared data, protocols, and external effects remain correct while old and new values coexist.

This yields two central principles:

1. A rollout is a sequence of intermediate states, not an atomic jump from A to B.
2. Adjacent states should be deliberately compatible.

Configuration belongs in the same model as code and traffic:

```text
Production behavior
  ├── Code:    versioned, tested, recoverable
  ├── Config:  versioned, validated, recoverable
  └── Traffic: controlled, progressive, reversible
```

A new database-connection implementation can start successfully and pass `/health` while an omitted queue-size setting defaults to 100,000 and fails only under load. Successful deployment mechanics do not prove that the effective runtime state is safe.

## How Do You Make Configuration Understandable and Valid?
<!-- section-summary: Resolve precedence visibly, reject invalid values and combinations before readiness, use explicit critical settings, and express units and bounds unambiguously. -->

### Make precedence explainable

Applications often combine sources:

```text
compiled defaults
  -> config file
  -> environment variables
  -> command-line arguments
  -> remote configuration
```

If the default timeout is 5,000 ms, the file says 3,000, and an environment variable says 1,000, which value wins? A developer can inspect the file and reach the wrong conclusion because an old environment variable silently overrides it.

Expose resolution:

```text
database.timeout effective: 1000ms
source: environment DATABASE_TIMEOUT
config file: 3000ms [overridden]
default: 5000ms [overridden]
```

This converts implicit precedence into observable runtime state.

### Validate before the process becomes ready

Reject values such as:

```text
PORT=eighty
DATABASE_POOL_SIZE=-500
REQUEST_TIMEOUT=-2
LOG_LEVEL=BANANA
```

Startup should follow:

```text
read -> parse -> validate shape -> validate values
     -> validate relationships -> construct dependencies -> become ready
```

Do not accept traffic first and discover an invalid value through customer errors.

Validation includes:

- **Types:** port is an integer, timeout is a duration, enabled is a Boolean.
- **Ranges:** `1 <= database_pool_size <= 500`.
- **Enums:** logging level is one of `DEBUG`, `INFO`, `WARN`, or `ERROR`.
- **Cross-field invariants:** minimum workers cannot exceed maximum workers; TLS enabled requires a certificate.

It is usually safer to fail fast than to start in an unknown state.

### Use defaults deliberately

Defaults reduce repetitive configuration, but a changed default can alter behavior without a visible production config diff. Version 1 can default `new_parser=false`, while version 2 silently changes it to true.

Defaults are useful for development convenience, noncritical tuning, and backward compatibility. Security behavior, data modification, traffic, resource limits, and external dependencies often deserve explicit production values.

### Make units and dangerous values hard to confuse

`timeout=5000` is ambiguous. Does it mean milliseconds or seconds? Prefer typed values:

```yaml
timeout: 5s
memory: 2GiB
rate: 1000 requests/second
duration: 500ms
percentage: 5%
```

If concurrency normally belongs between 50 and 200, do not accept ten million. Enforce a safety range such as `50 <= concurrency <= 500`; exceptional operation can change the guardrail through review.

Good configuration design makes correct values easy, dangerous values difficult, and invalid states impossible to express.

### How Do Static and Dynamic Configuration Behave Differently?
<!-- section-summary: Static values change with process restart, while dynamic values create a separate high-speed deployment system with propagation, consistency, cache, and failure semantics. -->

**Static configuration** is read at startup and remains until the process exits. Updating it requires replacing or restarting processes.

```text
process starts -> reads config -> uses it until exit
```

**Dynamic configuration** changes while the application runs:

```text
remote value changes -> application receives update -> behavior changes
```

Feature flags, rate limits, kill switches, routing preferences, and logging levels can be dynamic. This creates a deployment system that does not look like one. A global behavior change can reach every instance without a build, container rollout, or restart.

That speed is powerful and dangerous. A bad dynamic value can spread faster than bad code because it may activate everywhere nearly at once. Dynamic configuration therefore needs versioning, authorization, validation, progressive exposure, change history, monitoring, and rollback at least as seriously as code deployment.

#### Propagation creates mixed configuration

Instances can temporarily disagree while an update propagates. Whether that is acceptable depends on the setting. A recommendation flag can often be eventually consistent. A tax-rule version that changes invoices may require stronger coordination.

Every configuration platform needs clear semantics:

```text
How quickly should updates propagate?
May instances disagree temporarily?
What happens when the service is unavailable?
Are cached values allowed?
How stale may they become?
```

These are distributed-systems questions. A configuration service is itself a distributed system.

#### Separate versions but correlate them

Code and configuration change at different rates, so version them independently:

```text
application:   payments:v84
configuration: payments-prod:cfg-6221
flag snapshot: ff-9934
```

If healthy instances use `cfg-6220` and unhealthy instances use `cfg-6221` while both run v84, the configuration version immediately narrows the investigation.

Runtime logs and metrics should expose version, configuration revision, Region, and cohort:

```json
{
  "request_id": "abc123",
  "service": "payments",
  "version": "v84",
  "config_revision": "cfg-6221",
  "region": "eu-west",
  "new_checkout": true
}
```

Without this runtime identity, a customer report becomes forensic guesswork.

## How Do You Roll Out Secrets Safely?
<!-- section-summary: Secrets add confidentiality and lifecycle requirements, and safe rotation uses overlapping validity so clients and servers can change independently. -->

Database passwords, API credentials, TLS private keys, signing keys, OAuth client secrets, and encryption keys are runtime configuration with an additional requirement: unauthorized disclosure must be prevented.

Normal settings may be appropriate in a reviewed repository:

```yaml
database:
  host: db.production.internal
  timeout: 3s
```

Secret material needs a secret store and tightly scoped runtime access. Hiding the value is not enough; secrets also need creation, distribution, rotation, revocation, audit, and recovery.

### Rotation is a rollout, not a string replacement

If a database currently accepts `OLD`, this sequence fails:

```text
1. Server changes to NEW.
2. Application changes to NEW.
```

Between the steps, clients send OLD while the server accepts only NEW.

Use adjacent compatibility:

```text
State 1: server accepts OLD; clients use OLD
State 2: server accepts OLD+NEW; clients use OLD
State 3: server accepts OLD+NEW; clients gradually use NEW
State 4: server accepts OLD+NEW; all clients use NEW
State 5: server accepts NEW only
```

This overlap lets distributed clients update at different times.

### Cryptographic keys often need read and write roles

New writes can use key 18 while historical data still requires key 17 for decryption:

```text
key17: decrypt=yes, encrypt=no
key18: decrypt=yes, encrypt=yes
```

Only after historical data is migrated or no longer needs key 17 can it be retired. The same dual-version thinking applies to certificates, protocols, message formats, and API credentials.

The general pattern is:

```text
A -> A+B -> B
```

Expand compatibility before contracting it.

### How Do Feature Flags Control Candidate Behavior?
<!-- section-summary: A flag separates deployment from activation, lets candidate exposure expand by cohort, and should be removed after the stable path is established. -->

Suppose version 42 contains a new recommender. Without a flag, deploying v42 activates it. With a flag:

```python
if feature_flags.new_recommender:
    return new_recommender()
return old_recommender()
```

the code can be deployed while behavior remains stable:

```text
deploy v42 -> new code available -> flag=false -> old behavior
```

Activation becomes a separate rollout:

```text
employees -> 1% users -> 10% -> 50% -> 100%
```

This separates **software availability** from **software activation**.

The candidate is simply behavior with less evidence, not necessarily a separate binary. The safety question is how much exposure behavior with this uncertainty should receive.

Flags can target employees, customer IDs, tenants, Regions, devices, or random percentages. A Boolean global switch is often too coarse for progressive delivery.

#### Flags multiply possible behavior

One independent Boolean produces two combinations. Ten produce `2^10 = 1,024`; twenty produce `2^20 = 1,048,576`. No team can test every combination.

Treat most rollout flags as temporary:

```text
create -> deploy candidate code -> progressively enable -> reach 100%
       -> verify -> remove old path -> delete flag
```

Otherwise nested flag logic becomes permanent archaeology that makes behavior hard to reason about.

#### Kill switches provide fast degraded recovery

A dependency-heavy recommender can have `recommendations_enabled=false`. If it overloads the database, disabling it moves the site from personalized results to popular products instead of total outage.

```text
normal feature -> failure -> safe degraded mode
```

A kill switch is a specialized flag optimized for reducing recovery time. Use it where a risky or nonessential feature can be isolated without disabling the core service.

## How Do Progressive Rollouts Reduce Risk?
<!-- section-summary: Progressive exposure treats production as a feedback-driven experiment that limits blast radius while real evidence accumulates. -->

Testing reduces uncertainty but cannot reproduce all production traffic, data, scale, dependencies, timing, and user behavior. A rollout introduces the remaining uncertainty gradually:

```text
small exposure -> observe -> larger exposure -> observe
```

This is the common principle under canary deployment, progressive delivery, percentage rollout, blue/green traffic shifting, rings, and regional rollout. Increase blast radius only after evidence improves confidence.

### Blast radius limits expected damage

A catastrophic change sent to ten million users can affect ten million. At 1%, the initial exposure is roughly 100,000. Internal users may reduce it to dozens.

A rough damage model is:

```text
expected damage ≈ probability of failure
                × blast radius
                × time to recovery
```

Testing reduces failure probability. Progressive rollout reduces blast radius. Rollback and kill switches reduce recovery time. Good systems use all three.

An expanded risk model is:

```text
Risk ∝ Change size × Blast radius × Uncertainty × Recovery time
```

Reduce change size by changing one concern at a time. Reduce blast radius through cohorts and Regions. Reduce uncertainty through validation and comparative telemetry. Reduce recovery time through traffic shifting, last-known-good configuration, kill switches, and compatible rollback.

### Traffic steps create decision points

With stable v1 and candidate v2:

```text
100/0 -> 99/1 -> 90/10 -> 50/50 -> 0/100
```

The percentages are not the central idea. Each step must ask whether evidence is sufficient to expand. A controller that blindly advances regardless of signals is scheduled traffic movement, not controlled rollout.

Safe rollout automation is a feedback system:

```text
change exposure -> production response -> metrics -> evaluate
        ^                                      |
        |                                      v
   reduce/restore <---- unhealthy / healthy -> expand
```

Automation changes deployment from repeated human dashboard watching into encoded risk control.

## How Do You Measure the Candidate Correctly?
<!-- section-summary: Candidate and stable cohorts need separate technical, dependency, business, and user-experience evidence because global averages can hide a broken minority. -->

Health is multidimensional:

```text
1. Process:         Is it alive?
2. Infrastructure:  CPU, memory, disk, networking, target health
3. Application:     Errors, latency, throughput
4. Dependencies:    Database, cache, queues, downstream APIs
5. Business:        Purchases, logins, deliveries, completed jobs
6. User experience: Rendering, abandonment, retries, support signals
```

A candidate can have normal HTTP errors, latency, and CPU while checkout completion falls from 92% to 71% due to a logical error. Technical health cannot substitute for the system's purpose.

### Fleet averages can hide candidate failure

If 99% of requests use healthy v1 and 1% use broken v2, the global error rate can appear acceptable while v2 fails badly:

| Metric | Stable v1 | Candidate v2 |
| --- | ---: | ---: |
| Error rate | 0.1% | 8.2% |
| p99 latency | 300 ms | 2.8 s |
| Checkout success | 94% | 76% |

Measure the changed population separately from the unchanged baseline. Metrics should carry dimensions such as version, Region, Availability Zone, config revision, flag cohort, and experiment group.

### Configuration changes need the same timeline

An incident timeline should combine all production changes:

```text
13:50 deployment v51
14:02 config cfg-801 -> cfg-802
14:03 latency alarm
14:05 flag X -> 50%
14:07 config rollback cfg-802 -> cfg-801
14:08 latency recovery
```

If operators inspect only code deployments, a configuration-caused regression can look like unexplained infrastructure failure.

### Correctness and rollout safety are separate

`cache.ttl=0` may be valid and intentional, yet applying it globally can send 100 times more traffic to the database. Schema and invariant validation ask whether the configuration makes sense. Progressive rollout asks whether applying it at this scale is safe. Both are necessary.

### How Do You Choose the Right Rollout Unit and Pace?
<!-- section-summary: Evidence volume, state affinity, tenant concentration, failure domain, and delayed failure modes determine cohort choice and observation duration. -->

#### Clock time alone does not create confidence

A one-percent canary of a service handling one billion requests per hour receives ten million requests in an hour. A service handling 100 requests per day receives roughly one canary request per day. Thirty minutes is rich evidence for the first and almost none for the second.

```text
evidence ≈ traffic volume × observation quality
```

Low-volume systems may need synthetic checks or targeted test traffic.

#### Failure modes have different timescales

Syntax and startup errors appear in seconds. Latency regressions may take minutes. A connection leak can take an hour. A daily batch interaction takes a day, and billing defects can take longer.

There is no universal bake time. Choose observation windows from plausible failure modes and the amount of evidence collected, not a ritual number of minutes.

#### Sticky traffic may preserve workflow consistency

A stateful session that moves `v1 -> v2 -> v1` can fail if versions interpret state differently. During some experiments, route User A consistently to v1 and User B to v2.

Candidate assignment can be based on:

```text
request
user
account
tenant
organization
device
Region
host or Availability Zone
```

Choose a unit aligned with the failure domain and state boundary.

#### Random percentages can be unsafe for concentrated tenants

If one customer produces 35% of all traffic, a random 10% request canary spreads candidate behavior throughout that important customer's workload. A tenant ring may be safer:

```text
internal tenants -> small external tenants -> medium -> strategic large tenants
```

Infrastructure changes may use hosts, racks, Availability Zones, or Regions rather than requests.

#### Regions can contain geographic blast radius

Deploy London, observe, then Frankfurt, then Virginia and Singapore. The first Region should be large enough to reveal problems but small enough to contain them. The smallest Region can lack evidence; the largest can create unacceptable risk.

## How Should a Distributed Configuration System Fail?
<!-- section-summary: Applications need deliberate consistency, caching, staleness, fail-open or fail-closed, and last-known-good policies when dynamic configuration is invalid or unavailable. -->

If a remote configuration service becomes unavailable, an application can fail closed, fail open, or use a cached last-known-good value. No one policy fits every setting.

For uncertain permission or security decisions, denial may be safer. For an optional recommender flag, preserving the last working behavior may protect availability. The choice should be explicit, tested, and observable rather than an accidental result of exception handling.

### Last-known-good activation protects availability

Use:

```text
new config arrives -> validate
                    ├── invalid -> retain previous and report rejection
                    └── valid   -> activate
```

The process can say:

```text
Rejected cfg-9221; continuing with cfg-9220.
```

This preserves a working runtime while exposing the failed update. It does not silently pretend the rollout succeeded.

### Staleness must be bounded by consequence

If cached configuration is allowed, define how old it may be and how the system reports that it cannot refresh. A stale logging level is different from a stale credential revocation or tax rule. The cache policy is part of the business and security design.

Configuration consumers should expose:

```text
active revision
last refresh time
source reachability
rejected revision and reason
cache age
```

This makes a degraded configuration plane visible before operators mistakenly debug the application binary.

### How Do You Keep Rollout States Compatible and Reversible?
<!-- section-summary: Version history, additive compatibility, expand-and-contract migrations, and separated changes preserve recovery options across mixed versions. -->

#### Version every recoverable configuration state

If `database.pool_size` changes from 50 to 500 and the database collapses, rollback should restore configuration revision C103, not depend on someone's memory of the old number.

Record immutable revisions and diffs:

```text
Revision cfg-1042
database.pool_size: 50 -> 500
changed by: deploy-controller
change: rollout-2931
time: 18:42 UTC
```

You cannot reliably reverse a state you cannot reconstruct. History and audit logs are recovery mechanisms.

#### Design rollback before rollout

A previous binary is only a recovery option while it remains compatible with current data, APIs, messages, config, and secrets. If v2 deletes `users.name` and replaces it with `first_name` and `last_name`, v1 cannot be restored safely.

Use expand-and-contract:

1. Add new fields while old fields remain.
2. Deploy code that understands old and new forms and writes both if necessary.
3. Backfill historical data.
4. Move reads to the new form.
5. Stop old writes.
6. Remove the old field only after the rollback window closes.

Configuration formats need the same approach. If v1 accepts `cache_enabled` and v2 introduces `cache.mode`, make v2 temporarily understand both. Roll the new form only after old instances are gone, then remove legacy support later.

#### Roll forward can be safer than rollback

If v2 already wrote data that v1 cannot interpret, going backward can worsen the incident. A targeted v3 repair may restore safety faster. The objective is not "always roll back"; it is "restore safe service predictably." Available levers include traffic rollback, config rollback, flag disable, code rollback, dependency isolation, and roll forward.

#### Change fewer independent variables together

Do not simultaneously deploy code, change schema and database password, alter cache behavior, raise worker concurrency, enable checkout globally, and move all traffic. A failure then has six plausible causes.

A safer sequence is:

```text
1. Add compatible schema.
2. Deploy code with the feature disabled.
3. Verify runtime health.
4. Enable a small cohort.
5. Expand feature exposure.
6. Rotate secret separately with overlap.
7. Change tuning independently.
```

Changing fewer variables preserves causal information and makes the right recovery action clearer.

## How Do Ownership, Guardrails, and Automation Make Changes Safer?
<!-- section-summary: Named owners define intent and safe ranges, machines enforce repeatable invariants, and rollout controllers use feedback to expand or restore exposure. -->

Configuration values encode operational assumptions. Raising a timeout from 500 to 5,000 ms can reduce timeouts while keeping worker slots occupied ten times longer, growing queues and memory until the service collapses.

Record ownership and intent for high-impact knobs:

```text
database.pool_size
owner: Payments Platform
purpose: maximum database concurrency
safe range: 20-100
```

Human approval can judge tradeoffs and novel context, but two reviewers can both miss `100 -> 10000`. Machine checks are stronger for schema, units, bounds, invariants, repeatable rollout steps, and automatic comparisons.

Combine both:

```text
Humans: intent, risk, business judgment, exceptions
Machines: types, ranges, invariants, policy, metrics, stop conditions
```

### Safe rollout automation controls risk

A controller can encode:

```text
Deploy candidate -> route 1% -> observe
  -> healthy: 10% -> observe -> 50% -> 100%
  -> unhealthy: stop and restore stable
```

Health policy can require candidate errors below 0.5%, p99 below 600 ms, checkout success within one percent of stable, and no critical alert. Humans do not have to recreate the policy from memory for each release.

Automation means safety and velocity are not opposites. Poorly designed manual gates can be slow and unreliable. Safe defaults, automated guardrails, and fast recovery support frequent change.

Three properties describe a good production change:

- **Observability:** What changed, where, when, for whom, and what followed?
- **Controllability:** Can exposure be limited to one instance, tenant, Region, or percentage?
- **Reversibility:** Can the system restore a safe state through a flag, config, traffic, credential, or artifact action?

An observable, controllable, reversible change is safer than one that is invisible, global, and irreversible.

### How should a configuration-only rollout run?

Consider changing the payments database pool from 50 connections per instance to 80. The change is valid in principle, but the fleet has 40 instances. If every instance opens 30 additional connections at once, the database can receive 1,200 new connections. The risk comes from aggregate production scale rather than the syntax of `80`.

Create an immutable candidate revision:

```text
cfg-6220, current:
database.pool_size = 50

cfg-6221, candidate:
database.pool_size = 80
```

The revision passes type and range checks, and the application validates it against related settings such as maximum workers and connection acquisition timeout. The configuration service or application calculates and displays the effective value after precedence. This prevents an environment variable from silently keeping part of the fleet at another pool size.

Before activation, estimate the system effect:

```text
maximum new connections
= 40 instances × (80 - 50)
= 1,200
```

That estimate does not prove safety, but it identifies the database as the dependency that needs a rollout gate.

Activate cfg-6221 on a small, identified cohort, perhaps two instances or five percent of sticky tenants. Runtime telemetry now separates:

```text
stable:    code=v84 config=cfg-6220
candidate: code=v84 config=cfg-6221
```

Compare request latency, error rate, connection-acquisition time, open connections, database CPU, query latency, transaction success, and checkout completion. Global application latency alone can hide candidate failure, and candidate application health alone can hide database pressure that will become catastrophic at full scale.

If the candidate is healthy, expand to 25%, 50%, and 100% with a dependency-capacity decision at each step. The exact stages are less important than the feedback. If database connection utilization rises faster than the model allowed or the candidate's checkout success falls, stop expansion.

After reaching all instances, keep a bake period long enough to observe normal connection turnover, traffic peaks, and scheduled jobs. Then mark cfg-6221 as the accepted revision and keep cfg-6220 available as the known-good recovery target.

If the database degrades at 25%, reactivate cfg-6220 for the candidate cohort and confirm that every process reports the restored revision. The database may take additional time to drain connections and queued work, so "rollback command succeeded" is not the same as "service recovered." Continue monitoring until dependency and customer signals return to the stable baseline.

Record the full timeline:

```text
14:00 cfg-6221 validated
14:05 5% activation
14:15 25% activation
14:18 database pressure gate failed
14:19 rollout stopped
14:20 cfg-6220 restored
14:24 all instances report cfg-6220
14:31 database latency returns to baseline
```

This configuration-only event is a production rollout even though no image changed. It uses the same disciplines as code: exact version, bounded exposure, version-specific evidence, automatic stop, deterministic restoration, and proof of recovery.

### Why do dependency endpoints and timeouts need the same care?

Suppose `REQUEST_TIMEOUT` changes from 500 ms to 5,000 ms. Fewer callers may see a timeout, which looks like an improvement when viewed narrowly. But each blocked request now occupies resources for up to ten times longer. Worker slots remain busy, queues grow, memory rises, and a slow dependency receives more concurrent work. Client retries can then amplify the load.

The safe review asks both what the value means locally and how it changes the system:

```text
local intent: wait longer for the bank
system effect: more in-flight requests and slower failure release
```

Roll out the timeout to a candidate cohort and compare in-flight requests, queue age, memory, dependency latency, retry volume, and transaction completion against stable. A value can be within its allowed type and range while the system response proves it unsafe. This is exactly why validation and progressive rollout are separate barriers.

Changing an endpoint also needs compatibility. New and old instances may call different dependency versions during propagation. Confirm that both versions can operate on shared data and that the rollback endpoint remains reachable. Record the effective endpoint without logging secret credentials, and make the active configuration revision visible in dependency metrics.

### Preserve a recovery path for the configuration plane itself

The mechanism that delivers dynamic configuration can fail during the rollout. Candidate processes may fetch cfg-6221 while others cannot refresh and remain on cfg-6220. The controller should report partial propagation rather than declaring success from the desired revision alone.

Define completion from observed state:

```text
desired revision: cfg-6221
reported active revision: cfg-6221 on every intended target
rejected or stale targets: zero, or an explicitly accepted threshold
```

If the configuration service becomes unavailable during rollback, applications need their predesigned cache and last-known-good behavior. Persisting the prior valid revision locally or through the runtime agent can be the difference between retaining safe behavior and failing at the moment the control plane is needed most. Test this failure path before an incident: disconnect the configuration source, present an invalid update, expire a cache, and verify that security-sensitive and availability-oriented settings follow their intended fail-closed or last-known-good policies.

### How Should You Learn from a Configuration Incident?
<!-- section-summary: Incident review should identify missing system barriers and causal amplification rather than stop at the operator's mistaken input. -->

Suppose normal `MAX_CONCURRENT_JOBS` is 100. An operator intends 200 and enters 2,000. Processes remain alive and CPU initially looks acceptable, but every worker sends database queries:

```text
2,000 workers -> database saturation
              -> slower queries
              -> requests stay open
              -> queues and memory grow
              -> timeouts rise
              -> clients retry
              -> load amplifies
```

The timeline can be:

```text
10:00 setting 100 -> 2000
10:02 database CPU 40% -> 95%
10:03 request latency rises
10:05 customer errors
10:08 on-call paged
10:13 change identified
10:15 config reverted
10:18 database begins recovery
10:23 service recovered
```

A weak conclusion is "the engineer should be more careful." A stronger question is: **Why could one incorrect number create an uncontrolled global blast radius?**

Missing barriers may include:

- No enforced safe upper bound
- Direct global propagation rather than a config canary
- No config revision dimension in telemetry
- No database-pressure rollout gate
- No one-command rollback
- Delayed saturation alert

Corrective actions can enforce a maximum of 500, roll to five percent first, attach revision IDs to metrics, add dependency-pressure checks, and automate restoration of the previous revision.

#### Review defense in depth

Trace the harmful change toward customers:

```text
bad input -> review -> validation -> staging -> canary
          -> monitoring -> automatic stop -> rollback -> customer
```

Every box is a possible barrier. No barrier is perfect, but independent layers make recurrence less likely.

The review should separate **correctness** from **safe application**. A value can be valid yet dangerous at global scale. It should also identify why recovery took time: Was the change invisible? Was rollback ambiguous? Did the database need to drain after configuration was restored? This turns one incident into improvements across a class of changes.

## How Does a Complete Safe Rollout Work?
<!-- section-summary: A fraud-algorithm rollout expands compatibility, separates activation and secret rotation, compares cohorts, bakes for delayed failure, and removes temporary paths only after stability. -->

Suppose a new fraud-detection algorithm requires new code, configuration, and an external credential. A fragile rollout deploys everywhere, replaces config, rotates the key, enables the model globally, and hopes.

A safer sequence is:

### 1. Expand compatibility

Deploy code capable of old and new behavior. Keep the candidate flag off. If data, event, or API formats change, make this version understand adjacent old and new forms.

### 2. Validate startup and effective configuration

Reject malformed config before readiness. Report:

```text
code=v85
config=cfg-202
flag snapshot=ff-9934
fraud_candidate=false
```

Confirm dependencies, identity, secret access, and last-known-good behavior.

### 3. Exercise internal traffic

Enable the candidate for employees or a controlled tenant. Compare stable and candidate technical, dependency, fraud-decision, and business metrics.

### 4. Expand through evidence gates

Move through 1%, 5%, 25%, 50%, and 100% only when cohort-specific thresholds pass. Use a sticky user or tenant assignment if one workflow must not switch algorithms midway.

### 5. Observe long enough

Collect enough traffic and wait for plausible delayed failures such as connection leakage, cache effects, scheduled work, or downstream saturation.

### 6. Keep recovery levers independent

If candidate health fails at 25%, set the flag off or route candidate traffic to zero. Restore config revision cfg-201 if cfg-202 caused the problem.

Rotate the API credential separately with an OLD+NEW acceptance window so credential failure is not confused with algorithm behavior.

### 7. Contract only after stability

After 100% candidate behavior remains healthy, remove the old implementation and then delete the temporary flag. Retire old config fields and credentials only after all dependent readers have moved.

The rollout has controlled uncertainty rather than pretending to eliminate it.

Ten principles summarize the model:

1. Production behavior depends on configuration, secrets, flags, routing, data, permissions, and environment as well as code.
2. Every rollout is a distributed state transition in which old and new worlds coexist.
3. Unknown behavior should begin with limited exposure.
4. Validation checks whether a state is sensible; rollout evidence checks whether it is safe in reality.
5. Runtime telemetry must identify exact code, config, Region, and cohort.
6. Reversibility must be designed before destructive change.
7. Add compatibility before removing the old path: `A -> A+B -> B`.
8. Secret rotation is a compatibility rollout, not a string replacement.
9. Reduce blast radius and recovery time as well as failure probability.
10. Configuration is a production control plane and deserves versioning, permission, audit, monitoring, and safe delivery.

The mindset changes from "we tested it, so it should work" to: **we tested it thoroughly, production can still surprise us, so we will introduce uncertainty gradually, visibly, and reversibly.**

Those words describe concrete platform capabilities. "Gradually" means the controller can target a bounded cohort and pause. "Visibly" means every request, metric, and change timeline can identify the active code, configuration, secret generation, Region, and flag state. "Reversibly" means the previous compatible state still exists and the system has a tested action for restoring it. If any one of those properties is missing, the rollout plan should name the risk explicitly instead of treating a successful configuration write as proof that production is safe.

## Check Your Answers

:::expand[What Is Runtime Configuration?]{kind="recap"}
Configuration selects how one deployed capability should behave now, and therefore represents executable production intent.

Configuration selects how a deployed capability behaves now. Because timeouts, flags, endpoints, concurrency, and other values can change production outcomes, configuration is executable intent and belongs to the production rollout system.

Production passes through mixed code, configuration, secret, flag, and traffic combinations, so safe engineering makes every adjacent state compatible.

Old and new code, configuration, secret, flag, and traffic values coexist during propagation. Each combination is a real state, so adjacent states need deliberate compatibility rather than an assumption of atomic change.
:::

:::expand[How Do You Make Configuration Understandable and Valid?]{kind="recap"}
Resolve precedence visibly, reject invalid values and combinations before readiness, use explicit critical settings, and express units and bounds unambiguously.

Expose the effective value and precedence source, validate type, range, enum, and cross-field invariants before readiness, use explicit critical settings, and express units and safe bounds in forms that prevent dangerous ambiguity.

Static values change with process restart, while dynamic values create a separate high-speed deployment system with propagation, consistency, cache, and failure semantics.

Static values change with process restart. Dynamic values can change behavior while processes run, creating a fast separate deployment plane with propagation, consistency, caching, versioning, authorization, and rollback requirements.
:::

:::expand[How Do You Roll Out Secrets Safely?]{kind="recap"}
Secrets add confidentiality and lifecycle requirements, and safe rotation uses overlapping validity so clients and servers can change independently.

Protect secret disclosure and manage its lifecycle. Rotation usually moves through OLD, OLD+NEW, and NEW states so servers and clients can update independently. Encryption keys may remain valid for reading after new writes move to another key.

A flag separates deployment from activation, lets candidate exposure expand by cohort, and should be removed after the stable path is established.

Flags let candidate code exist before activation and expand behavior through targeted cohorts. Kill switches provide fast degraded recovery. Remove the old path and temporary flag after stability so combinations do not grow indefinitely.
:::

:::expand[How Do Progressive Rollouts Reduce Risk?]{kind="recap"}
Progressive exposure treats production as a feedback-driven experiment that limits blast radius while real evidence accumulates.

Production supplies evidence unavailable in testing. Start with limited exposure, compare signals, and expand only when healthy. This reduces blast radius, while rollback and kill switches reduce recovery time.
:::

:::expand[How Do You Measure the Candidate Correctly?]{kind="recap"}
Candidate and stable cohorts need separate technical, dependency, business, and user-experience evidence because global averages can hide a broken minority.

Observe process, infrastructure, application, dependency, business, and user layers. Compare candidate and stable cohorts directly and include version, config, Region, and flag dimensions because global averages can hide a broken minority.

Evidence volume, state affinity, tenant concentration, failure domain, and delayed failure modes determine cohort choice and observation duration.

Choose request, user, tenant, host, Availability Zone, or Region according to state and failure boundaries. Pace follows traffic evidence and plausible failure timescales, not only elapsed minutes or a universal percentage sequence.
:::

:::expand[How Should a Distributed Configuration System Fail?]{kind="recap"}
Applications need deliberate consistency, caching, staleness, fail-open or fail-closed, and last-known-good policies when dynamic configuration is invalid or unavailable.

Define whether each setting fails closed, fails open, or uses cached last-known-good data. Validate before activation, retain the previous revision after rejection, bound staleness, and expose refresh and cache health.

Version history, additive compatibility, expand-and-contract migrations, and separated changes preserve recovery options across mixed versions.

Version every recoverable state, expand compatibility before contraction, keep previous applications compatible with current schemas and config, separate independent changes, and choose rollback or roll forward according to the safest recovery path.
:::

:::expand[How Do Ownership, Guardrails, and Automation Make Changes Safer?]{kind="recap"}
Named owners define intent and safe ranges, machines enforce repeatable invariants, and rollout controllers use feedback to expand or restore exposure.

Owners explain intent and safe operating ranges. Machines enforce types, bounds, invariants, traffic steps, and metric thresholds. Feedback-driven automation makes changes observable, controllable, reversible, and repeatably safe.

Incident review should identify missing system barriers and causal amplification rather than stop at the operator's mistaken input.

Trace the causal amplification and find missing barriers such as bounds, canaries, telemetry dimensions, automatic stops, and deterministic rollback. Do not stop at blaming the person who entered a value the system allowed globally.
:::

:::expand[How Does a Complete Safe Rollout Work?]{kind="recap"}
A fraud-algorithm rollout expands compatibility, separates activation and secret rotation, compares cohorts, bakes for delayed failure, and removes temporary paths only after stability.

Deploy compatible code with the flag off, validate effective state, start with internal traffic, expand through cohort-specific gates, observe delayed failure modes, rotate secrets separately, keep fast recovery controls, and remove old paths only after stability.
:::

## References

- [AWS AppConfig documentation](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html)
- [AWS AppConfig documentation: Deployment strategies](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html)
- [AWS AppConfig documentation: Feature flags](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile-feature-flags.html)
- [AWS Secrets Manager documentation: Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [Amazon ECS documentation: Pass environment variables to containers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html)
