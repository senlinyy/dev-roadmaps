---
title: "Continuous Delivery"
description: "Learn how continuous delivery keeps a tested artifact safely releasable through repeatable promotion, health checks, controlled rollout, and recovery."
overview: "Passing CI creates a verified candidate, but releasing that candidate is a separate engineering problem. This article follows one immutable artifact through runtime configuration, promotion environments, approval gates, health checks, gradual rollout, production feedback, and recovery."
tags: ["delivery", "environments", "rollbacks", "architecture", "deployment"]
order: 3
id: article-cicd-fundamentals-continuous-delivery
aliases:
  - continuous-delivery
  - article-cicd-fundamentals-continuous-delivery
  - cicd/fundamentals/continuous-delivery.md
---

## Table of Contents

1. [Why Is Releasing Software Different from Passing CI?](#why-is-releasing-software-different-from-passing-ci)
2. [How Do Continuous Delivery and Continuous Deployment Differ?](#how-do-continuous-delivery-and-continuous-deployment-differ)
3. [Why Should One Artifact Move Through Every Environment?](#why-should-one-artifact-move-through-every-environment)
4. [How Do Environments and Approval Gates Add Evidence?](#how-do-environments-and-approval-gates-add-evidence)
5. [How Do Health Checks and Gradual Rollouts Limit Failure?](#how-do-health-checks-and-gradual-rollouts-limit-failure)
6. [How Should Rollback and Recovery Be Designed?](#how-should-rollback-and-recovery-be-designed)
7. [How Does Production Feedback Complete the Release?](#how-does-production-feedback-complete-the-release)
8. [How Does the Complete Continuous Delivery Loop Work?](#how-does-the-complete-continuous-delivery-loop-work)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Passing Continuous Integration establishes a useful result: a commit satisfied the automated checks selected for joining the shared codebase. The commit may lint, test, and build successfully. Users still do not run it.

The candidate has another journey:

```text
verified source
      ↓
identified release artifact
      ↓
pre-production environment
      ↓
production transition
      ↓
healthy service for users
```

**Continuous Delivery** engineers that journey so an exact verified version can be released safely, repeatedly, and on demand. CI reduces uncertainty about combining code. Delivery reduces uncertainty about moving that code into a working environment.

These are separate problems because correct application code can still fail through an incorrect release procedure. A manual deployer can omit an environment variable, select an old build, run the wrong database migration, copy files to three of four servers, mistype a command, or restart only part of the service. The software passed its checks; the delivery operation produced a broken system.

Keep these questions in view as you work through the lesson:

1. **Why Is Releasing Software Different from Passing CI?**
2. **How Do Continuous Delivery and Continuous Deployment Differ?**
3. **Why Should One Artifact Move Through Every Environment?**
4. **How Do Environments and Approval Gates Add Evidence?**
5. **How Do Health Checks and Gradual Rollouts Limit Failure?**
6. **How Should Rollback and Recovery Be Designed?**
7. **How Does Production Feedback Complete the Release?**
8. **How Does the Complete Continuous Delivery Loop Work?**

## Why Is Releasing Software Different from Passing CI?
<!-- section-summary: CI checks whether a change can integrate, while continuous delivery makes the verified version safely releasable. -->

It helps to distinguish two forms of correctness:

```text
software correctness
       +
delivery correctness
       =
a candidate that becomes a healthy running release
```

The core delivery operation can be written as `Deploy(X, Y)`: given verified artifact X, produce artifact X running correctly in environment Y. The definition is much stronger than “Dave knows the server commands.” It names the object, destination, and expected result.

Manual release instructions often begin innocently: SSH to each server, copy a directory, edit a configuration file, restart the process, run a database command, and inspect logs. Repetition introduces variation. One host remains on version `4.2` while the others run `4.3`; one migration is forgotten; one configuration differs. The actual fleet drifts away from the state the team believes it has.

Continuous Delivery moves release knowledge from human memory into versioned, executable automation. The procedure becomes reviewable, repeatable, and auditable. A human may still choose whether to release, but a machine performs the steps that should be the same every time.

Versioning the procedure matters because it ties release behavior to review. A change to how the service starts, where a migration runs, or which health condition blocks traffic can be proposed and inspected like application code. A release record can then show both the application artifact and the automation definition that moved it. The team no longer has to reconstruct an operator's terminal history to understand why two deployments behaved differently.

Automation also makes partial execution visible. A controller can record that the artifact reached two instances, readiness failed on the third, and the fourth was never touched. A handwritten checklist often records only “deployment started” or “deployment done,” leaving ambiguous middle states during an incident.

## How Do Continuous Delivery and Continuous Deployment Differ?
<!-- section-summary: Continuous delivery maintains release readiness, while continuous deployment automatically releases every qualifying change. -->

The two meanings of “CD” describe different policies at the final production boundary.

**Continuous Delivery** keeps every validated change in a releasable state. Automation can build the artifact, deploy it to staging, run technical checks, collect evidence, and wait at a production gate. A human decision may still authorize the release:

```text
CI passes
   ↓
artifact and staging checks
   ↓
ready for production
   ↓
human approval
   ↓
automated production deployment
```

**Continuous Deployment** removes that manual production decision. A qualifying change proceeds automatically after all defined delivery checks pass:

```text
CI and delivery checks pass
            ↓
automatic production deployment
```

Continuous in Continuous Delivery refers primarily to continuous **releasability**, not to forcing every commit into production. The team can release when it chooses without assembling a special manual procedure or rebuilding the software.

An approval gate is useful when machines cannot decide the surrounding context: a maintenance window, customer communication, business coordination, regulatory authorization, or support readiness. It is less useful when a person manually repeats the same 27 technical checks on every release. Repeatable technical verification belongs in automation. Contextual judgment belongs with a responsible human.

This division also clarifies what approval should do. A person decides **whether** the known candidate should move now. The pipeline decides **how** to move it. Approval should not begin an undocumented sequence of file copies and server commands.

Frequent delivery can be safer than rare delivery. A six-month release may contain 1,500 changes. Twenty daily releases may each contain one to three. The frequent team changes production more often, yet each transition has a smaller uncertainty set. When an incident begins, “What changed?” has a bounded answer.

The goal is not automation for its own sake. Large batches, rare releases, manual procedures, unknown artifacts, environment drift, and slow recovery make releases risky. Small changes, repeatable automation, known artifacts, comparable environments, and practiced recovery make release work routine enough to become boring.

The choice between delivery and deployment can vary by service. A low-risk internal service with excellent automated checks may release every passing change. A payment system may stop for contextual approval even though every technical step is automated. Both can use the same artifact, environment, health, observation, and recovery machinery; only the policy at the production gate differs.

## Why Should One Artifact Move Through Every Environment?
<!-- section-summary: Build-once promotion preserves artifact identity while runtime configuration supplies environment-specific values and secrets. -->

Suppose commit `abc123` is built once for tests, again for staging, and a third time for production. The three outputs share source code, but they can differ because of dependency versions, compiler versions, build flags, timestamps, generated files, network downloads, or environment variables.

The object tested in staging may therefore differ from the object delivered to users. A stronger release chain follows one rule:

> Build once, then promote the same artifact.

```text
commit abc123
      ↓ one build
artifact digest sha256:9af...
      ├── integration tests
      ├── staging
      └── production
```

Promotion changes which destination is authorized to run the artifact. It does not recreate or modify the artifact. If `app:v2.7.1` with digest `sha256:abc123...` passed staging, production approval should mean “allow this digest into production,” not “rebuild tag `v2.7.1` and hope the result matches.”

The artifact should be immutable: one identity continues to refer to the same bytes. A cryptographic digest makes that identity verifiable. Release records can then connect production to an exact object, the pipeline that created it, and the commit used as input.

Environments still need different database endpoints, domains, credentials, feature flags, and resource limits. Build-once promotion works by separating the application artifact from **runtime configuration**:

```text
same application artifact
        +
staging configuration
        = staging behavior

same application artifact
        +
production configuration
        = production behavior
```

Hard-coding `DATABASE_HOST=production.company.internal` into the build forces environment-specific bytes. Reading `DATABASE_HOST` at runtime lets staging provide `staging-db.internal` and production provide `prod-db.internal` to the same program.

Configuration should not turn into two structurally different applications. Extensive `if environment == "prod"` behavior weakens staging evidence because staging no longer exercises the system production will run. Some environmental differences are unavoidable, but the application shape should remain comparable while external endpoints, credentials, domains, limits, and flags vary.

Secrets are sensitive configuration. Database passwords, API tokens, private keys, signing keys, and cloud credentials should not be baked into the artifact. Anyone able to inspect such an image could recover the credential, and every secret rotation would require an application rebuild. Runtime injection lets the artifact stay stable while the secret changes independently.

Secrets also mark trust boundaries. Lint and unit-test jobs require no production credential. A staging job receives staging access. Only a protected production deployment receives production access. Least privilege prevents compromised validation code from automatically gaining the ability to modify production.

Separating secrets also improves rotation. If a production database password changes, the environment can supply the replacement without rebuilding or retesting unrelated application bytes. The release artifact remains traceable, while credential lifecycle follows its own authorization and audit process. This independence is safer than coupling every secret update to a new software release.

## How Do Environments and Approval Gates Add Evidence?
<!-- section-summary: Each meaningful environment answers a new release question, and gates prevent risk from increasing before required evidence exists. -->

Promotion environments are named places where the same artifact runs for different purposes:

```text
development → integration → staging → production
```

Integration can answer whether components communicate. Staging can answer whether the production-like topology, configuration shape, TLS, proxies, service discovery, network policy, load balancing, and resource limits support the release. Production answers whether the artifact performs correctly for real users.

Staging therefore tests more than application logic. CI may use controlled databases and local service containers. Staging exercises the release procedure and an environment closer to production. It provides evidence that the team can operate this artifact, not just compile it.

More environments do not automatically create more confidence. `dev1`, `dev2`, `qa1`, `qa2`, `preqa`, `uat`, `preprod`, and `staging` each add cost, configuration, maintenance, delay, and drift. An environment should exist because it answers a useful question before the blast radius increases.

An **approval gate** pauses the graph before sensitive work. Its release packet should identify the artifact, source commit, tests, security evidence, staging results, migration compatibility, known previous artifact, and any timing or business context. An approver can then make a bounded decision about a known candidate.

The pipeline should keep technical checks on the machine side of the boundary. If staging smoke tests, schema compatibility, or artifact signature verification can be expressed objectively, run them before requesting approval. The human gate focuses on questions automation cannot settle, such as whether customers were notified or whether a high-risk change is authorized during this window.

Each successful stage adds evidence:

```text
source commit
  ↓ unit checks
local behavior evidence
  ↓ build
identified deployable artifact
  ↓ integration
component cooperation evidence
  ↓ staging
production-like deployment evidence
  ↓ controlled production exposure
real workload evidence
```

The closer the artifact gets to users, the stronger and more realistic the evidence should become. Promotion is a change in confidence and authorization around the same bytes.

Staging evidence has limits. It may reproduce the topology and configuration shape while using smaller data, lower traffic, or sandbox providers. Promotion should state what staging proved instead of treating the environment name as a universal guarantee. Real production behavior supplies the evidence that pre-production cannot, which is why limited exposure and observation belong to the same delivery chain.

## How Do Health Checks and Gradual Rollouts Limit Failure?
<!-- section-summary: Success conditions, deadlines, and limited exposure let the delivery system detect a bad version before it replaces healthy capacity. -->

Copying files or starting a process does not complete a deployment. Five seconds later the process may crash, or it may remain alive while unable to reach its database. A meaningful deployment succeeds when the new version becomes healthy enough to serve its intended workload.

A health endpoint such as `GET /health` can provide part of that signal. Two distinctions are useful:

- **Liveness** asks whether the process is alive enough that a restart is unnecessary.
- **Readiness** asks whether this instance can currently receive traffic.

A service loading data or establishing dependencies can be alive but not ready. A load balancer should keep user traffic away until readiness succeeds. A check that reports only “process exists” can mark an application healthy even when it cannot perform its user-facing work.

Waiting also needs a failure definition. A version that remains unready forever cannot leave the pipeline hanging forever. A **rollout deadline** says the new capacity must become healthy within a bounded time or the rollout fails. Every automated wait should define both success and the point at which lack of success becomes failure.

A safe strategy avoids replacing all healthy capacity at once. A **rolling deployment** replaces instances gradually:

```text
v1 v1 v1 v1
   ↓ add and check one v2
v2 v1 v1 v1
   ↓ continue only while healthy
v2 v2 v1 v1
   ↓
v2 v2 v2 v2
```

If the first `v2` fails readiness, the system stops while the `v1` fleet continues serving. Failure is contained before uncertainty reaches every instance.

A **canary deployment** limits exposure through traffic share. Version 2 might receive 1% of requests while version 1 handles 99%. The team observes error rate, latency, CPU, and business outcomes, then moves to 10%, 50%, and 100% only when the evidence remains healthy. Production behavior becomes another validation layer with a bounded blast radius.

A **blue-green deployment** prepares two complete groups. Blue serves users on version 1 while Green runs version 2 for verification. Traffic switches to Green after it is ready. If the release fails and Blue remains compatible, traffic can switch back quickly. The tradeoff is temporarily maintaining capacity for both groups.

All three strategies express one principle:

```text
uncertain change + small initial exposure = limited potential damage
```

A deployment plan should define a success condition, failure condition, time limit, failure response, and recovery path before it begins. “Replace everything and hope” has none of those protections.

Failing safely means more than marking a job red. Suppose one new instance starts, misses readiness, and repeatedly crashes. The controller halts further replacement, preserves healthy old capacity, records the artifact and failed condition, alerts the team, and optionally restores the previous state. Logs and metrics then describe one bounded failed attempt rather than a fleet-wide outage. The system expects failures to occur and arranges the transition so one failure does not automatically consume all available capacity.

## How Should Rollback and Recovery Be Designed?
<!-- section-summary: Rollback re-promotes a known previous artifact, while broader recovery planning handles state changes that cannot simply be undone. -->

If production runs artifact 42 and artifact 43 causes a severe problem, **rollback** returns the environment to artifact 42. Immutable retained artifacts make that operation concrete: re-promote the known previous object instead of trying to reconstruct yesterday's build during an incident.

Rollback should be designed before failure. The release record can name both the current artifact and the previous known-good artifact. The pipeline can use the same automated deployment and health-verification path for recovery, preserving logs, authorization, and evidence instead of starting an emergency manual procedure.

Application rollback is not always system rollback. Suppose version 2 replaces `users.name` with `users.first_name` and `users.last_name`, then migrates the data. Redeploying version 1 may fail because its expected column no longer exists.

Backward-compatible database changes reduce that risk through phases:

1. Add new columns while retaining the old column.
2. Deploy code that understands both representations.
3. Migrate or backfill the data.
4. Switch reads and writes fully to the new form.
5. Remove the old column in a later release after the overlap is no longer needed.

During the overlap, old and new application versions remain compatible enough for rolling deployment or rollback. Destructive schema changes are delayed until the old version no longer needs them.

Some effects cannot be reversed by restoring a binary: an external payment already happened, messages were published, customer data was transformed, or an irreversible migration completed. Recovery may require a forward fix, feature disablement, backup restoration, failover, or data repair. Design for recovery rather than treating rollback as a universal undo button.

Feature flags can separate technical deployment from product release. New checkout code can reach production with `NEW_CHECKOUT=false`. Later, the team can enable it for 5% of users and expand exposure. The artifact is deployed while customer access remains separately controllable. Flags still need ownership, test coverage, and eventual removal.

An idempotent deployment also makes retry safer. Repeatedly applying `Deploy(X)` should converge on artifact X rather than corrupting the environment each time. Distributed operations can fail after performing some work but before returning success, so retries are unavoidable. Idempotence reduces ambiguous half-applied states.

Deployments cannot always be perfectly transactional, yet the system can aim for a known transition: start from a known previous state, perform a controlled change, and end in either a known healthy new state or a known recovery state. A half-migrated, partly upgraded fleet with no recorded completion state is the outcome to avoid.

Recovery authority should also be defined early. The on-call engineer may be allowed to restore a prior artifact when a customer-impacting metric crosses a threshold. A regulated change may require a release manager to authorize the rollback while an incident commander coordinates communication. The exact organization differs, but a responder should not discover during the outage that nobody knows who may trigger the recovery job.

The plan should be exercised. A retained artifact and a rollback button provide little confidence if the previous version no longer starts against the current schema or configuration. Compatibility checks and occasional drills turn the theoretical path into evidence that restoration still works.

## How Does Production Feedback Complete the Release?
<!-- section-summary: Production health includes technical and business signals, and the release remains incomplete until the new state is observed. -->

The delivery graph does not logically end when a deployment command returns exit code `0`. The running version must be observed under its intended workload.

Technical signals can include:

- request success and error rates;
- latency distributions;
- CPU and memory;
- queue depth and retry rate;
- dependency health;
- readiness and instance availability.

Business signals can reveal a failure that infrastructure health misses. HTTP success, CPU, and memory can remain normal while successful purchases fall by 90% because the new checkout logic produces an incorrect price. Production validation therefore combines system health with outcomes that express what users are trying to accomplish.

Think of a release as a state transition. Production begins in state `P₁`. Applying identified release `R` produces candidate state `P₂`:

```text
P₁ + R → P₂
```

Continuous Delivery seeks known properties around that transition. `R` is identified and verified. The operation is automated. `P₂` is observed. Failure is detectable. A recovery path is available. The model is more precise than “the deployment script ran.”

Production feedback can continue staged exposure. A canary remains small while both technical and business metrics are compared with the existing version. Healthy evidence expands the rollout. Unhealthy evidence halts or reverses it. Monitoring participates in the release decision rather than becoming a dashboard someone may inspect later.

Fast detection and recovery matter because failures cannot be eliminated. A safe system does not promise that every release succeeds. It detects failure quickly, limits the affected population, preserves healthy capacity where possible, and follows a known recovery operation.

Frequent small releases support that response. One to three changes are easier to correlate with a shifted metric than 1,500 changes. The same small-batch principle that makes CI useful also reduces release uncertainty and shortens recovery diagnosis.

Metrics need decision rules rather than passive visibility. A canary policy can define acceptable error and latency changes, the observation window, minimum request volume, and the response to missing data. Business metrics need similar baselines. Without a defined threshold and action, a dashboard may show degradation while automation continues increasing exposure.

## How Does the Complete Continuous Delivery Loop Work?
<!-- section-summary: Continuous Delivery promotes one known artifact through increasing evidence, controlled exposure, observation, and recovery. -->

Suppose commit `7fa92ac` passes CI and produces `checkout-service:2.8.4` with digest `sha256:98fe...`. Integration tests run against that digest. Staging receives the same digest with staging configuration and verifies API behavior, database compatibility, health endpoints, and the deployment procedure.

The production gate presents the artifact identity, source, evidence, and previous known-good digest. A release manager approves. Production initially contains four `v2.8.3` instances. A rolling strategy starts one `v2.8.4` instance and waits for readiness.

If it becomes healthy, the transition continues one bounded step at a time until all four instances run `v2.8.4`. Error rate, latency, and checkout success remain normal, so the release record marks the new digest healthy.

The environments supplied different endpoints and credentials, but the application digest never changed. The staging evidence refers to the same object production receives. The approval changed its authorization, the rollout changed its exposure, and the final observations changed its status from candidate to healthy production release.

If the first new instance fails readiness, the deadline stops the rollout. The old instances continue serving. The system restores or retains `v2.8.3`, records the failed digest and evidence, alerts operators, and gives developers logs, metrics, release metadata, and artifact identity for diagnosis.

The failure path is a first-class part of the pipeline. It does not imply that failures never happen; it ensures that a failed candidate is detected within a bounded interval, receives limited exposure, and leaves a known next action. That is the practical meaning of reducing release risk.

```text
developer commit
      ↓
CI: integrate, test, build
      ↓
identified candidate artifact
      ↓
CD: integration and staging evidence
      ↓
approval where contextual judgment matters
      ↓
limited production rollout
      ↓
technical + business observation
      ├── healthy → continue and record
      └── unhealthy → contain and recover
```

The strongest mental model is an engineering discipline that keeps every validated change reliably releasable. Known source leads to a reproducible build and immutable artifact. External configuration adapts that artifact to environments. Controlled promotion gathers evidence. Automated deployment defines success and failure. Gradual exposure limits risk. Observation validates the running state. Recovery is planned before it is needed.

CI asks whether a change can safely join the codebase under selected checks. Continuous Delivery asks whether this exact candidate can be released safely now through a repeatable path. Continuous Deployment applies a policy that automatically releases once those conditions are satisfied.

Together, CI and CD replace “we think the code works and someone probably knows how to deploy it” with an inspectable account of what was built, which evidence it passed, which configuration it receives, how exposure increases, how health is judged, and what happens when the transition fails.

That account should remain usable after the release team goes home. From a running instance, an investigator can find the artifact digest and release record. From the record, they can find the pipeline, source commit, approval, configuration version, rollout observations, and recovery target. Forward traceability supports promotion; reverse traceability supports incident response. Continuous Delivery is mature when both directions depend on recorded system state instead of one operator's memory.

## Check Your Answers

:::expand[Why Is Releasing Software Different from Passing CI?]{kind="recap"}
CI checks selected integration properties. Delivery must also move the identified candidate into a healthy running environment through a procedure that is itself correct and repeatable.
:::

:::expand[How Do Continuous Delivery and Continuous Deployment Differ?]{kind="recap"}
Continuous Delivery keeps software release-ready and may retain a human production decision. Continuous Deployment automatically releases every candidate that satisfies the defined gates.
:::

:::expand[Why Should One Artifact Move Through Every Environment?]{kind="recap"}
Build-once promotion ensures staging and production receive the same bytes. Runtime configuration and secrets adapt that immutable artifact without rebuilding it.
:::

:::expand[How Do Environments and Approval Gates Add Evidence?]{kind="recap"}
Each environment should answer a meaningful new question, while gates prevent the blast radius from increasing until technical evidence and necessary contextual approval exist.
:::

:::expand[How Do Health Checks and Gradual Rollouts Limit Failure?]{kind="recap"}
Readiness, failure deadlines, and rolling, canary, or blue-green exposure detect unhealthy versions before they replace or reach the entire healthy fleet.
:::

:::expand[How Should Rollback and Recovery Be Designed?]{kind="recap"}
Rollback re-promotes a retained known-good artifact. Recovery planning also covers compatible database evolution, forward fixes, feature disablement, backups, failover, and data repair.
:::

:::expand[How Does Production Feedback Complete the Release?]{kind="recap"}
A successful command is insufficient. Technical and business signals must show that the new production state serves its intended workload, with unhealthy evidence triggering containment.
:::

:::expand[How Does the Complete Continuous Delivery Loop Work?]{kind="recap"}
One identified artifact moves through increasing evidence, controlled approval and exposure, production observation, and a predesigned recovery path while its bytes remain unchanged.
:::

## References

- [Continuous Delivery](https://continuousdelivery.com/) - Defines the discipline of releasing changes safely, quickly, and sustainably.
- [DORA: Continuous delivery](https://dora.dev/capabilities/continuous-delivery/) - Connects on-demand low-risk releases with delivery performance.
- [GitHub Actions deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) - Documents protected environments, reviewers, timers, restrictions, and environment secrets.
- [The Twelve-Factor App: Config](https://12factor.net/config) - Explains separating deploy-specific configuration from application code.
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Documents traffic readiness, restart checks, and startup protection.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Describes rolling updates, progress deadlines, failed rollout conditions, and revision history.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Documents waiting for a rollout to complete or time out.
