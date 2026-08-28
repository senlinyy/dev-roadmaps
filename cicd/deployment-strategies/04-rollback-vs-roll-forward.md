---
title: "Rollback vs. Roll-Forward"
description: "Mitigate outages effectively by choosing between instant traffic reverts and hotfix patches under pressure."
overview: "When a production release fails, incident responders face a critical choice: revert traffic immediately or deploy a hotfix patch. Learn how Mean Time to Recovery (MTTR) governs outage decisions, why database schema changes complicate rollbacks, and how to write backwards-compatible database migrations."
tags: ["rollback", "roll-forward", "mttr", "incident-response"]
order: 4
id: article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions
aliases:
  - /cicd/deployment-strategies/rollback-vs-roll-forward-decisions
---

## Table of Contents

1. [Why Is Recovery a System State-Machine Decision?](#why-is-recovery-a-system-state-machine-decision)
2. [What Can Rollback Restore and What Can It Not Reverse?](#what-can-rollback-restore-and-what-can-it-not-reverse)
3. [When Is Roll-Forward the Safer Path?](#when-is-roll-forward-the-safer-path)
4. [How Do Reversibility, Uncertainty, and Recovery Time Choose the Path?](#how-do-reversibility-uncertainty-and-recovery-time-choose-the-path)
5. [Why Do Data, APIs, Messages, Side Effects, and Migrations Complicate Recovery?](#why-do-data-apis-messages-side-effects-and-migrations-complicate-recovery)
6. [When Is the Best Recovery Not a Deployment Rollback?](#when-is-the-best-recovery-not-a-deployment-rollback)
7. [How Do Architecture and Incident Policy Make Both Directions Cheaper?](#how-do-architecture-and-incident-policy-make-both-directions-cheaper)
8. [How Does a Practical Recovery Decision Fit Together?](#how-does-a-practical-recovery-decision-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Our application service can now release through rolling, blue-green, or canary patterns. Those patterns reduce risk, and failure can still happen. Version `2026.06.13.2` can still break under real users. Maybe coupon validation throws 500 errors for old carts. Maybe the new payment payload fails for one card network. Maybe the canary looked good at 5%, then the service started timing out at 50%.

When that happens, the team has two recovery paths. **Rollback** means returning users to the last known healthy version. **Roll-forward** means shipping another change that fixes the broken release. Both can be correct. The wrong choice is the one that burns time while users keep hitting the failure.

Model the system as state, not only code. Before release it contains application A, data state D1, configuration C1, queued messages M1, external side effects E1, and active traffic. The failed release may already have changed several dimensions. Rollback changes some state toward a previous configuration; roll-forward changes current state toward a new corrected configuration. Neither operation literally moves time backward.

Keep these questions in view as you work through the lesson:

1. **Why Is Recovery a System State-Machine Decision?**
2. **What Can Rollback Restore and What Can It Not Reverse?**
3. **When Is Roll-Forward the Safer Path?**
4. **How Do Reversibility, Uncertainty, and Recovery Time Choose the Path?**
5. **Why Do Data, APIs, Messages, Side Effects, and Migrations Complicate Recovery?**
6. **When Is the Best Recovery Not a Deployment Rollback?**
7. **How Do Architecture and Incident Policy Make Both Directions Cheaper?**
8. **How Does a Practical Recovery Decision Fit Together?**

## Why Is Recovery a System State-Machine Decision?
<!-- section-summary: A failed deployment needs a recovery decision before the team gets pulled into open-ended debugging. -->

At failure detection, first stop the growth of harm. Pause promotion, set candidate traffic to zero, disable a feature, or stop new work where the strategy allows. Then decide which reachable healthy state has the shortest safe path. Deep root-cause work can continue after service is restored.

This article focuses on the first response decision before the root cause investigation. Root cause matters, but the service needs to recover first. The release owner, incident commander, and on-call engineer need a shared rule for choosing the fastest safe path.

We will keep using the application service because payment failures make the tradeoff clear. Every minute of broken service creates failed requests and support load, so the recovery path needs to be calm, rehearsed, and measurable.

![Recovery decision map showing release failed, rollback to last healthy, roll-forward with small patch, and fastest safe path](/content-assets/articles/article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions/recovery-decision-map.png)

*Rollback and roll-forward are both recovery tools; the incident decision is which path restores service safely first.*

## What Can Rollback Restore and What Can It Not Reverse?
<!-- section-summary: Rollback restores the last healthy release when the previous version can still run safely. -->

A **rollback** returns the service toward a known healthy release. In Kubernetes, that might mean `kubectl rollout undo deployment/service`. In blue-green, it might mean moving traffic back to the old environment. In canary, it might mean setting candidate weight back to `0`.

Rollback usually gives the fastest recovery when three things are true:

| Requirement | Why it matters |
|---|---|
| The old version still exists | The platform needs an image, task definition, ReplicaSet, or environment to return to. |
| The old version can run against current data | A database or message format change should still support the old code. |
| The failure came from the new release | Returning to the old version should remove the user-facing problem. |

Here is a Kubernetes rollback command:

```bash
kubectl rollout undo deployment/service
kubectl rollout status deployment/service --timeout=5m
```

That command tells Kubernetes to move the Deployment back to the previous revision and then waits for the rollout to finish. The command itself is small. The preparation behind it matters more: the previous image must still be available, readiness checks must work, and the database must still support the old code.

Rollback can feel emotionally unsatisfying because the team still needs to fix the bug. That is okay. During an incident, the first job is to restore service. After users stop seeing failures, the team can debug version `2026.06.13.2` with less pressure and ship a safer version later.

Rollback is powerful because it uses already-tested knowledge. The previous artifact, traffic path, and operational behavior were recently healthy under production load. If they remain valid, recovery avoids inventing new code during an incident and can be rehearsed as one routine operation.

But rollback rarely means reversing time. It can restore an application binary or routing pointer while data writes, emitted messages, sent notifications, external transactions, configuration changes, and human actions remain. The honest description is “redeploy or reroute the previous compatible version,” not “put the whole system back exactly as it was.”

Rollback has one major weakness. It works cleanly when the system state can move back safely. The next path, roll-forward, matters when the old version lacks a safe path against current state or when the fix is smaller than the revert.

## When Is Roll-Forward the Safer Path?
<!-- section-summary: Roll-forward ships a focused fix when returning to the old version would be slower or unsafe. -->

A **roll-forward** fixes the bad release by deploying another version. The team keeps moving forward from `2026.06.13.2` to `2026.06.13.3` with a small patch.

Roll-forward can be the right path when the previous version lacks support for current state. For example, the new release may have already written rows in a new table, sent new message types to a queue, or completed an irreversible data migration. Returning to the old version could create more failures than the bug itself.

Roll-forward can also be right when the fix is tiny and already understood. Suppose the service bug comes from a missing environment variable name:

```diff
- PAYMENT_TIMEOUT_MS: "300"
+ PAYMENTS_TIMEOUT_MS: "300"
```

If the team has high confidence in that fix, the pipeline is fast, and the blast radius is understood, shipping `2026.06.13.3` may recover faster than moving the whole service back. The danger is turning an incident into live product development. A roll-forward patch should be narrow, reviewed, and verified through the same deployment gates as any other production change.

Roll-forward trades old-state reversibility for new-change confidence. It is strongest when the failure mechanism is understood, the patch has a direct test, build and deployment are fast, and the current data or external state already makes A unsafe. It is weak when responders are still guessing and each attempted patch adds new uncertainty.

Use a short checklist before choosing roll-forward:

| Question | Strong answer for roll-forward |
|---|---|
| Do we know the exact cause? | Yes, with logs, traces, or a failing test. |
| Is the patch small? | Yes, the change fits in one focused diff. |
| Can CI and deployment finish quickly? | Yes, inside the recovery target. |
| Can we test the fix before broad traffic? | Yes, through canary, blue-green validation, or smoke tests. |
| Is rollback unsafe? | Yes, current data or external state makes rollback risky. |

Rollback and roll-forward both need one shared measurement: recovery time. That is where MTTR enters the conversation.

## How Do Reversibility, Uncertainty, and Recovery Time Choose the Path?
<!-- section-summary: MTTR keeps the recovery decision focused on restoring service instead of winning a debugging debate. -->

**Mean Time to Recovery**, often shortened to **MTTR**, measures how long it takes to restore service after a failure. During a release incident, the practical question is: which path restores the user experience safely in the shortest time?

For the application service, we can write the decision in a simple table:

| Situation | Prefer |
|---|---|
| New version fails readiness before traffic | Rollback or stop rollout immediately. |
| Canary error rate spikes at 5% | Set canary weight to `0`, then investigate. |
| Blue-green promotion fails but old blue still works | Move traffic back to blue. |
| New release already completed a compatible schema expand | Rollback application if old version still works. |
| New release ran a destructive schema change | Roll-forward or restore from a planned database recovery path. |
| Bug is a one-line config mismatch with a tested fix | Roll-forward can be faster. |

The incident lead should make this call early. A useful time box is 5 to 10 minutes for a severe user-facing outage. If the team lacks a clear root cause and safe patch inside that time, rollback usually protects users better.

The deeper decision has two variables. **Reversibility** asks whether A can still run against current application, data, message, configuration, and external state. **Understanding** asks whether the team can explain the failure well enough to predict that a focused B2 change will fix it. High reversibility plus low understanding favors rollback. Low reversibility plus high understanding favors roll-forward. Low values for both indicate a harder recovery such as traffic isolation, feature disablement, data repair, or restoration.

MTTR is not permission to choose a fast unsafe action. Estimate time to actual healthy service, including artifact availability, rollout duration, data compatibility, verification, and possible failure of the recovery itself. The shortest command is not always the shortest recovery path.

The decision should live in the deployment runbook. A runbook line might say:

```yaml
recovery_policy:
  severe_service_failure:
    first_action: "route traffic to previous healthy release"
    debug_timebox_minutes: 10
    roll_forward_allowed_when:
      - "root cause is confirmed"
      - "patch is reviewed"
      - "database remains backward compatible"
      - "canary gate can validate the patch"
```

This keeps the team from debating from scratch while users are affected. The most important part of that policy is the database line, because database changes are the most common reason rollback surprises people.

## Why Do Data, APIs, Messages, Side Effects, and Migrations Complicate Recovery?
<!-- section-summary: Database and message changes can make application rollback unsafe even when the old image still exists. -->

Application rollback feels simple because container images and task definitions are versioned. Data changes are different. Once the new version writes data, changes schema, or sends messages, the old version may no longer understand the world around it.

Here is the classic failure. Version `2026.06.13.2` renames `orders.discount_code` to `orders.promotion_code` in one migration. The new application reads `promotion_code`. The release fails under production traffic. The team rolls the app back to `2026.06.13.1`. The old code starts and tries to read `discount_code`, but the column is gone. Now the rollback fails too.

Message queues create a similar trap. If the new version starts publishing events with a required `promotionId` field and old consumers lack support for it, rolling back one service may leave downstream workers broken. External systems add another version of the problem. If the new release creates payment intents with a new provider configuration, the old release may lack the logic to reconcile them.

APIs can create the same incompatibility in both directions. A new server may return fields or semantics an old client cannot tolerate; a new client may send requests the old server rejects after rollback. Independent deployments require a compatibility window across consumers and providers.

Data makes recovery harder because B may have partially transformed only some records. A rollback can expose A to a mixed data population, while a roll-forward repair must handle both old and new forms idempotently. Know whether migrations can pause, resume, retry, and prove completeness.

External side effects can be impossible to reverse. A notification was sent, a payment was captured, a partner API accepted an order, or a physical workflow began. Compensation may be possible, but compensation is a new business action, not time reversal. Recovery policy should distinguish reversible internal state from irreversible external commitments.

A rollback plan should classify changes before release:

| Change type | Rollback risk |
|---|---|
| App code only | Usually low if the previous image exists. |
| Config only | Medium because old code may expect different names or values. |
| Additive database change | Usually manageable if old columns and tables remain. |
| Destructive database change | High because old code may crash or lose data. |
| Queue message shape change | High unless producers and consumers support both shapes. |
| External side effect | High when the old version lacks support for new external state. |

![Database rollback trap showing drop column, old app breaks, expand, dual write, and rollback works](/content-assets/articles/article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions/database-rollback-trap.png)

*Destructive schema changes can break rollback, while expand-and-contract keeps both old and new versions able to read the data.*

This is why teams talk about **backward compatibility** before the release. Backward compatibility means the old and new versions can both operate during the transition. The next section shows how to design that into database changes.

<!-- section-summary: Compatible migrations split risky data changes into small releases so rollback remains available. -->

The safest database rollout pattern is **expand, migrate, and contract**. We introduced it in the blue-green article, and it matters even more when thinking about rollback. Instead of changing or deleting a field in one release, the team creates a path where old and new code can both work for a while.

Let's redo the discount column safely.

**Release 1: Expand the schema.** Add the new column while keeping the old one.

```sql
ALTER TABLE orders ADD COLUMN promotion_code text;
```

Version `2026.06.13.1` still reads `discount_code`. The database now also has `promotion_code`, but old code can ignore it safely.

**Release 2: Write both fields.** Deploy application code that writes both `discount_code` and `promotion_code` for new orders.

```ts
await orders.update(orderId, {
  discount_code: discountCode,
  promotion_code: discountCode,
});
```

Now rollback to the previous application still works because `discount_code` remains populated.

**Release 3: Backfill old rows.** Copy existing values into the new column in a controlled job.

```sql
UPDATE orders
SET promotion_code = discount_code
WHERE promotion_code IS NULL
  AND discount_code IS NOT NULL;
```

Large production tables need batched backfills, lock monitoring, and a tested pause or resume plan. The example is small so the idea stays visible.

**Release 4: Read the new field.** Deploy code that reads `promotion_code`, while still writing both fields during the rollback window.

**Release 5: Contract later.** After the team knows rollback to the old field is no longer needed, remove `discount_code` in a separate cleanup release.

This sequence feels slower than one big migration, but it gives the incident team options. If Release 4 has an application bug, traffic can return to Release 3 because the old data path still exists. The team buys recoverability by splitting the change into safer steps.

The same pattern applies to queue messages. Add new optional fields first, teach consumers to accept both shapes, then switch producers, then remove old fields after the rollback window. Compatibility is a release design habit across databases, queues, APIs, and external side effects.

Compatibility creates a rollback window: a bounded period during which both the old and new application versions can operate on current shared state. Contracting an old column, removing an API field, or rejecting an old message format closes that window. Close it deliberately only after the organization no longer intends to deploy A.

The rollback window is not only a duration. It is a set of preserved invariants: old artifact available, old configuration understood, old identity valid, schema additive, messages tolerated, sessions compatible, and external side effects reconcilable. Release records should say which cleanup action closes each invariant.

Now we can look at recovery actions that do not require changing the whole deployment.

## When Is the Best Recovery Not a Deployment Rollback?
<!-- section-summary: Traffic controls, feature flags, queue pauses, and dependency isolation can restore service faster than replacing every instance. -->

Sometimes the fastest safe recovery is to disable the failing feature, route around one dependency, stop consuming a harmful message type, pause a migration, shed optional load, or set canary traffic to zero. These actions reduce user harm while leaving enough state in place for diagnosis.

Canary reduces how much must recover because baseline already carries most traffic; aborting removes the small candidate share. Blue-green preserves an active or standby environment so routing can change without rebuilding. Both strategies exploit the same principle: keep a known healthy path reachable while uncertainty is high.

A feature flag can roll back behavior without rolling back the binary. That is useful when B contains several changes and one activation is failing. It is unsafe if the flag path was never tested, the new code already made incompatible writes, or disabling the feature leaves partial external work. Treat operational controls as rehearsed recovery mechanisms, not emergency improvisation.

The incident can also combine directions. Route users back to A immediately, then roll forward a data repair or compatibility patch. Or disable the broken feature while B remains deployed, then ship B2. “Rollback versus roll-forward” is a decision about the next recovery action, not a rule that the whole incident must use only one direction.

## How Do Architecture and Incident Policy Make Both Directions Cheaper?
<!-- section-summary: Immutable artifacts, compatible state, fast pipelines, traffic controls, and prewritten decisions keep rollback and roll-forward available. -->

Some organizations prefer roll-forward because their services deploy independently, pipelines are fast, patches are small, and database changes are designed to remain compatible. Others prefer rollback because previous artifacts and traffic controls are highly reliable while incident-time code changes carry too much uncertainty. The preference should follow demonstrated system capability, not culture slogans.

Rollback does not mean reverting the source-control commit. A source revert may create a new commit and new build, which is technically a roll-forward deployment of code resembling A. Operational rollback normally selects the already-built immutable A artifact or route. Keep source history correction separate from immediate service restoration.

The ideal architecture makes both directions cheap. Preserve immutable artifacts and configuration records. Keep data, API, and event changes compatible. Make build and deployment fast. Use health checks, traffic control, and feature flags. Rehearse rollback and small hotfix delivery. Record which migrations and side effects reduce reversibility.

Classify proposed changes by irreversibility before release: application-only, additive shared state, destructive shared state, or external commitment. Higher irreversibility requires a longer compatibility plan, stronger gate, smaller exposure, and an explicit recovery action.

A practical decision tree asks: is harm still growing; can it be stopped without deployment; is A still compatible; is rollback rehearsed and faster; is the cause understood; is B2 small and testable; did irreversible state change; and what verification proves recovery? Give the incident commander authority to choose the first safe branch without waiting for a perfect diagnosis.

## How Does a Practical Recovery Decision Fit Together?
<!-- section-summary: The recovery plan should choose the fastest safe path and make data compatibility part of the release design. -->

The application canary reaches 25%, and 500 errors spike for records using the older data path. The release owner declares a release incident. Recovery comes before deep debugging.

The team checks the prewritten decision table. The old version still exists. The schema change was additive, because the team used expand and contract. The canary has written both old and new fields. The fastest safe action is rollback: set canary traffic to `0` or move the deployment back to the previous healthy version.

If the same release had dropped the old column already, rollback would be dangerous. The team would choose a roll-forward patch or a database recovery path. That is a slower and riskier situation, so the release design should avoid it for normal product changes.

A good deployment strategy treats rollback as a feature that must be kept working. That means immutable previous artifacts, traffic controls, health checks, observability, and backward-compatible data changes. Roll-forward stays available for small confirmed fixes or situations where current state blocks a safe move backward.

![Recovery summary showing failed release, MTTR, data compatible, rollback ready, patch known, and restore service](/content-assets/articles/article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions/recovery-summary.png)

*A recovery plan keeps MTTR, data compatibility, rollback readiness, and patch confidence visible during the incident.*

## Check Your Answers

:::expand[Why Is Recovery a System State-Machine Decision?]{kind="recap"}
A release changes application, configuration, data, messages, external side effects, and traffic. Rollback and roll-forward move the current system toward reachable healthy states; neither reverses time. First stop harm, then choose the shortest safe state transition.
:::

:::expand[What Can Rollback Restore and What Can It Not Reverse?]{kind="recap"}
Rollback can redeploy a previous artifact or route users to an earlier environment. It is powerful because that path was recently healthy. It cannot unsend messages, undo external transactions, erase writes, or restore removed compatibility merely by changing application code.
:::

:::expand[When Is Roll-Forward the Safer Path?]{kind="recap"}
Roll-forward fits when A is incompatible with current state and the failure is understood well enough for a small, tested B2 fix. It is risky when responders are guessing, pipelines are slow, or each patch adds uncertainty during an active outage.
:::

:::expand[How Do Reversibility, Uncertainty, and Recovery Time Choose the Path?]{kind="recap"}
High reversibility and low understanding favor rollback. Low reversibility and high understanding favor roll-forward. Estimate time to verified healthy service, including rollout and state compatibility—not just command duration—and time-box incident debugging before harm continues.
:::

:::expand[Why Do Data, APIs, Messages, Side Effects, and Migrations Complicate Recovery?]{kind="recap"}
Old code may not understand new schemas, partial data, client requests, events, sessions, or external commitments. Compensation is a new action, not reversal. Classify shared and external changes before release and make migrations resumable and idempotent.

Expand the representation, deploy compatible behavior, backfill, switch reads, stop old writes, and contract later. The rollback window exists while old artifacts, configuration, identities, schemas, APIs, messages, and data remain usable by A.
:::

:::expand[When Is the Best Recovery Not a Deployment Rollback?]{kind="recap"}
Setting canary weight to zero, rerouting, disabling a flag, pausing a consumer or migration, shedding optional load, or isolating a dependency may restore service faster. An incident can roll back traffic now and roll forward data repair later.
:::

:::expand[How Do Architecture and Incident Policy Make Both Directions Cheaper?]{kind="recap"}
Keep immutable artifacts and configuration records, preserve compatible state, make pipelines fast, use traffic and feature controls, and rehearse both recovery paths. Preclassify irreversible changes and give the incident lead a decision tree and authority.
:::

:::expand[How Does a Practical Recovery Decision Fit Together?]{kind="recap"}
Stop exposure, verify A availability and compatibility, assess cause confidence and B2 size, inspect irreversible state, choose the faster safe path, and verify recovery. Compatibility design before release determines which choices remain available during the incident.
:::

## References

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents Deployment rollout status and selecting a previous revision.
