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

1. [The Moment a Release Fails](#the-moment-a-release-fails)
2. [Rollback](#rollback)
3. [Roll-Forward](#roll-forward)
4. [Choosing by Recovery Time](#choosing-by-recovery-time)
5. [The Database Trap](#the-database-trap)
6. [Compatible Migrations](#compatible-migrations)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Moment a Release Fails
<!-- section-summary: A failed deployment needs a recovery decision before the team gets pulled into open-ended debugging. -->

Our checkout API can now release through rolling, blue-green, or canary patterns. Those patterns reduce risk, and failure can still happen. Version `2026.06.13.2` can still break under real users. Maybe coupon validation throws 500 errors for old carts. Maybe the new payment payload fails for one card network. Maybe the canary looked good at 5%, then the service started timing out at 50%.

When that happens, the team has two recovery paths. **Rollback** means returning users to the last known healthy version. **Roll-forward** means shipping another change that fixes the broken release. Both can be correct. The wrong choice is the one that burns time while users keep hitting the failure.

This article focuses on the first response decision before the root cause investigation. Root cause matters, but the service needs to recover first. The release owner, incident commander, and on-call engineer need a shared rule for choosing the fastest safe path.

We will keep using the checkout service because payment failures make the tradeoff clear. Every minute of broken checkout creates failed orders and support load, so the recovery path needs to be calm, rehearsed, and measurable.

![Recovery decision map showing release failed, rollback to last healthy, roll-forward with small patch, and fastest safe path](/content-assets/articles/article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions/recovery-decision-map.png)

*Rollback and roll-forward are both recovery tools; the incident decision is which path restores service safely first.*

## Rollback
<!-- section-summary: Rollback restores the last healthy release when the previous version can still run safely. -->

A **rollback** returns the service to a known healthy release. In Kubernetes, that might mean `kubectl rollout undo deployment/checkout-api`. In ECS with CodeDeploy, it might mean an automatic rollback or a new deployment that redeploys the previous application revision. In blue-green, it might mean moving traffic back to the old environment. In canary, it might mean setting the canary weight back to `0`.

Rollback usually gives the fastest recovery when three things are true:

| Requirement | Why it matters |
|---|---|
| The old version still exists | The platform needs an image, task definition, ReplicaSet, or environment to return to. |
| The old version can run against current data | A database or message format change should still support the old code. |
| The failure came from the new release | Returning to the old version should remove the user-facing problem. |

Here is a Kubernetes rollback command:

```bash
kubectl rollout undo deployment/checkout-api
kubectl rollout status deployment/checkout-api --timeout=5m
```

That command tells Kubernetes to move the Deployment back to the previous revision and then waits for the rollout to finish. The command itself is small. The preparation behind it matters more: the previous image must still be available, readiness checks must work, and the database must still support the old code.

Rollback can feel emotionally unsatisfying because the team still needs to fix the bug. That is okay. During an incident, the first job is to restore service. After users stop seeing failures, the team can debug version `2026.06.13.2` with less pressure and ship a safer version later.

Rollback has one major weakness. It works cleanly when the system state can move back safely. The next path, roll-forward, matters when the old version lacks a safe path against current state or when the fix is smaller than the revert.

## Roll-Forward
<!-- section-summary: Roll-forward ships a focused fix when returning to the old version would be slower or unsafe. -->

A **roll-forward** fixes the bad release by deploying another version. The team keeps moving forward from `2026.06.13.2` to `2026.06.13.3` with a small patch.

Roll-forward can be the right path when the previous version lacks support for current state. For example, the new release may have already written rows in a new table, sent new message types to a queue, or completed an irreversible data migration. Returning to the old version could create more failures than the bug itself.

Roll-forward can also be right when the fix is tiny and already understood. Suppose the checkout bug comes from a missing environment variable name:

```diff
- PAYMENT_TIMEOUT_MS: "300"
+ PAYMENTS_TIMEOUT_MS: "300"
```

If the team has high confidence in that fix, the pipeline is fast, and the blast radius is understood, shipping `2026.06.13.3` may recover faster than moving the whole service back. The danger is turning an incident into live product development. A roll-forward patch should be narrow, reviewed, and verified through the same deployment gates as any other production change.

Use a short checklist before choosing roll-forward:

| Question | Strong answer for roll-forward |
|---|---|
| Do we know the exact cause? | Yes, with logs, traces, or a failing test. |
| Is the patch small? | Yes, the change fits in one focused diff. |
| Can CI and deployment finish quickly? | Yes, inside the recovery target. |
| Can we test the fix before broad traffic? | Yes, through canary, blue-green validation, or smoke tests. |
| Is rollback unsafe? | Yes, current data or external state makes rollback risky. |

Rollback and roll-forward both need one shared measurement: recovery time. That is where MTTR enters the conversation.

## Choosing by Recovery Time
<!-- section-summary: MTTR keeps the recovery decision focused on restoring service instead of winning a debugging debate. -->

**Mean Time to Recovery**, often shortened to **MTTR**, measures how long it takes to restore service after a failure. During a release incident, the practical question is: which path restores the user experience safely in the shortest time?

For the checkout API, we can write the decision in a simple table:

| Situation | Prefer |
|---|---|
| New version fails readiness before traffic | Rollback or stop rollout immediately. |
| Canary error rate spikes at 5% | Set canary weight to `0`, then investigate. |
| Blue-green promotion fails but old blue still works | Move traffic back to blue. |
| New release already completed a compatible schema expand | Rollback application if old version still works. |
| New release ran a destructive schema change | Roll-forward or restore from a planned database recovery path. |
| Bug is a one-line config mismatch with a tested fix | Roll-forward can be faster. |

The incident lead should make this call early. A useful time box is 5 to 10 minutes for a severe user-facing outage. If the team lacks a clear root cause and safe patch inside that time, rollback usually protects users better.

The decision should live in the deployment runbook. A runbook line might say:

```yaml
recovery_policy:
  severe_checkout_failure:
    first_action: "route traffic to previous healthy release"
    debug_timebox_minutes: 10
    roll_forward_allowed_when:
      - "root cause is confirmed"
      - "patch is reviewed"
      - "database remains backward compatible"
      - "canary gate can validate the patch"
```

This keeps the team from debating from scratch while customers are failing checkout. The most important part of that policy is the database line, because database changes are the most common reason rollback surprises people.

## The Database Trap
<!-- section-summary: Database and message changes can make application rollback unsafe even when the old image still exists. -->

Application rollback feels simple because container images and task definitions are versioned. Data changes are different. Once the new version writes data, changes schema, or sends messages, the old version may no longer understand the world around it.

Here is the classic checkout failure. Version `2026.06.13.2` renames `orders.discount_code` to `orders.promotion_code` in one migration. The new application reads `promotion_code`. The release fails because payment authorization times out. The team rolls the app back to `2026.06.13.1`. The old code starts and tries to read `discount_code`, but the column is gone. Now the rollback fails too.

Message queues create a similar trap. If the new version starts publishing events with a required `promotionId` field and old consumers lack support for it, rolling back one service may leave downstream workers broken. External systems add another version of the problem. If the new release creates payment intents with a new provider configuration, the old release may lack the logic to reconcile them.

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

## Compatible Migrations
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

Now we can combine rollback, roll-forward, MTTR, and compatibility into a practical response plan.

## Putting It All Together
<!-- section-summary: The recovery plan should choose the fastest safe path and make data compatibility part of the release design. -->

The checkout canary reaches 25%, and 500 errors spike for users with saved discounts. The release owner declares a release incident. Recovery comes before deep debugging.

The team checks the prewritten decision table. The old version still exists. The schema change was additive, because the team used expand and contract. The canary has written both old and new fields. The fastest safe action is rollback: set canary traffic to `0` or move the deployment back to the previous healthy version.

If the same release had dropped the old column already, rollback would be dangerous. The team would choose a roll-forward patch or a database recovery path. That is a slower and riskier situation, so the release design should avoid it for normal product changes.

A good deployment strategy treats rollback as a feature that must be kept working. That means immutable previous artifacts, traffic controls, health checks, observability, and backward-compatible data changes. Roll-forward stays available for small confirmed fixes or situations where current state blocks a safe move backward.

![Recovery summary showing failed release, MTTR, data compatible, rollback ready, patch known, and restore service](/content-assets/articles/article-cicd-deployment-strategies-rollback-vs-roll-forward-decisions/recovery-summary.png)

*A recovery plan keeps MTTR, data compatibility, rollback readiness, and patch confidence visible during the incident.*

## What's Next
<!-- section-summary: Environment promotion makes sure the exact same artifact moves through quality gates before production. -->

The next article moves earlier in the release path. We will look at **environment promotion**, where one built artifact moves from development to staging to production through quality gates. That process gives rollback and roll-forward decisions a cleaner foundation because everyone knows exactly which artifact is running where.

---

**References**

- [AWS CodeDeploy rollback and redeployment](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployments-rollback-and-redeploy.html) - Explains automatic rollbacks, manual rollbacks, and how CodeDeploy redeploys previous revisions.
- [AWS CodeDeploy stop deployment](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployments-stop.html) - Documents stopping a deployment and stop-and-roll-back behavior.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents rollout status and rolling back a Deployment.
- [Google SRE Workbook: Incident Response](https://sre.google/workbook/incident-response/) - Describes incident response roles, communication, and response structure.
- [Prisma expand-and-contract migrations](https://www.prisma.io/docs/guides/database/data-migration) - Shows a stepwise production workflow for schema changes and data migration.
- [GitLab backwards compatibility across updates](https://docs.gitlab.com/development/multi_version_compatibility/) - Explains compatibility risks when a deployed system can contain multiple versions at once.
