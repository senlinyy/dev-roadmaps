---
title: "Blue-Green Deployments"
description: "Eliminate version mixing and achieve instant traffic switches using fully cloned, isolated production environments."
overview: "Running old and new application versions concurrently under a shared load balancer can cause data collisions. Learn how Blue-Green deployments isolate active production from the new release, how to swap traffic instantly at the load balancer, and how to manage database backward compatibility safely."
tags: ["blue-green", "load-balancer", "database-migration", "continuous-deployment"]
order: 2
id: article-cicd-deployment-strategies-blue-green-deployments
aliases:
  - /cicd/deployment-strategies/blue-green-deployments
---

## Table of Contents

1. [Why Rolling Is Sometimes Too Mixed](#why-rolling-is-sometimes-too-mixed)
2. [The Blue and Green Environments](#the-blue-and-green-environments)
3. [Traffic Switching](#traffic-switching)
4. [Validation Before the Switch](#validation-before-the-switch)
5. [Database Compatibility](#database-compatibility)
6. [Cost and Cleanup](#cost-and-cleanup)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Rolling Is Sometimes Too Mixed
<!-- section-summary: Blue-green deployments help when old and new versions need stronger isolation than a rolling rollout gives. -->

In the rolling deployment article, the checkout API moved from version `2026.06.13.1` to `2026.06.13.2` a few containers at a time. That worked because the old and new versions could safely run together for a short period. Many releases fit that pattern.

Now imagine a bigger checkout change. The old version stores discount data in a column called `discount_code`. The new version reads a new table called `cart_discounts`, writes a new audit event, and changes the payment authorization payload. During a rolling deployment, both versions may process live checkouts at the same time. One user request could hit the old version, the next request could hit the new version, and background jobs may read data written by either version.

That mixed state can create real production problems. The old version may read data shaped by the new version. The new version may assume a queue message includes a field the old version never writes. A payment retry may pass through a different version than the original request. This can work if the team designed every interface to handle both versions. The risk grows when the change crosses application code, database schema, queues, and third-party calls.

A **blue-green deployment** gives the new version a separate production-like environment before users touch it. One environment serves all real traffic. The other environment runs the new release and waits for validation. When the team accepts the new environment, traffic moves over in one controlled switch.

The important thing is the boundary. Rolling deployment changes instances inside one live service pool. Blue-green deployment changes which full environment receives traffic.

## The Blue and Green Environments
<!-- section-summary: Blue-green uses two complete environment pools so the new release can be built and tested away from live users. -->

The names **blue** and **green** are just labels. Blue might run the current production version today, and green might run the next version. After the switch, green serves production and blue moves into the standby or cleanup role.

For our checkout API, a blue-green setup might look like this:

| Environment | Version | Traffic role | Main pieces |
|---|---|---|---|
| Blue | `2026.06.13.1` | Serves users now | Checkout tasks, target group, config, secrets, alarms |
| Green | `2026.06.13.2` | Receives test traffic | New checkout tasks, separate target group, same production dependencies where safe |

In Amazon ECS with CodeDeploy, this pattern usually uses two target groups behind a load balancer. The original task set sits behind one target group. CodeDeploy creates a replacement task set and connects it to the other target group. A production listener sends user traffic to the active target group. An optional test listener can send validation traffic to the replacement task set before production traffic moves.

In Kubernetes, teams often use a controller such as Argo Rollouts for blue-green behavior. The rollout has an active Service that points to the live ReplicaSet and a preview Service that points to the new ReplicaSet. The preview Service lets smoke tests and manual checks reach the green version before promotion.

Here is a simplified Argo Rollouts shape:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: checkout-api
spec:
  replicas: 10
  strategy:
    blueGreen:
      activeService: checkout-api
      previewService: checkout-api-preview
      autoPromotionEnabled: false
      scaleDownDelaySeconds: 900
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      containers:
        - name: checkout-api
          image: registry.example.com/checkout-api:2026.06.13.2
```

The preview Service gives the pipeline a stable address for green validation. The active Service stays on blue until someone or some automated policy promotes the release. The `scaleDownDelaySeconds` value keeps the old version alive for a short time after promotion, which gives the team a fast path back if the new version fails immediately.

![Blue-green deployment showing blue live environment, green preview environment, load balancer switch, test traffic, promote, and fast revert](/content-assets/articles/article-cicd-deployment-strategies-blue-green-deployments/blue-green-environment-switch.png)

*Blue-green keeps a full live environment and a full preview environment, then moves traffic at the routing layer when green is ready.*

Once the green environment exists, the release is a routing problem. The team needs a traffic switch that moves users cleanly and predictably.

## Traffic Switching
<!-- section-summary: Blue-green traffic should move at the router or load balancer layer instead of depending on slow DNS-only changes. -->

**Traffic switching** means changing which environment receives production requests. The switch should happen close to the load balancer, gateway, ingress controller, or service routing layer. That gives the deployment system one controlled place to move traffic.

For ECS and CodeDeploy, the switch happens by rerouting the production listener from the original task set target group to the replacement task set target group. For Kubernetes blue-green, the active Service selector changes from the old ReplicaSet to the new ReplicaSet, or a rollout controller updates the routing object that backs the active Service.

This is different from using public DNS as the main release switch. DNS is useful for many traffic-management tasks, but DNS records can live in client caches, resolver caches, mobile networks, and corporate proxies. If the release depends on every client seeing a DNS change quickly, some users may stay on the old environment long after the team thinks the switch finished.

A practical blue-green switch has a small set of controlled actions:

```bash
./scripts/deploy-green.sh registry.example.com/checkout-api@sha256:8f3a...
./scripts/smoke-test.sh https://checkout-preview.example.com
./scripts/promote-green.sh checkout-api
./scripts/watch-release.sh checkout-api --minutes 30
```

That flow tells us something important. Deployment creates the green environment. Promotion moves production traffic to it. Keeping those two moments separate gives the team time to inspect the new environment before customers use it.

The green environment still needs proof before the switch. A working container process is only the first signal. The next step is validation.

## Validation Before the Switch
<!-- section-summary: The green environment needs pre-traffic checks that prove the real release path works before promotion. -->

**Pre-traffic validation** means testing the green environment before it serves normal users. These checks should use the same image, config style, routing path, and observability that production uses. The point is to catch wiring problems while blue still carries the business.

For the checkout API, a good validation set might include:

| Check | What it proves |
|---|---|
| `/ready` health check | The app booted, loaded config, and can reach required dependencies. |
| Synthetic checkout | The main user path can create a cart, apply a discount, and authorize a test payment. |
| Database migration status | The schema version expected by the app exists. |
| Queue compatibility | The app can publish and consume expected message shapes. |
| Observability labels | Logs, metrics, traces, and alerts identify the new version. |

AWS CodeDeploy supports lifecycle hooks for ECS deployments. A validation Lambda can run after test traffic reaches the replacement task set and before production traffic moves. If validation fails and rollback is configured, CodeDeploy can fail the deployment and return components to the previous state. In Kubernetes, Argo Rollouts can pause before promotion and use analysis checks to decide whether to continue.

The smoke test should avoid fake success. A request to `/health` can say the web server is running while checkout itself is broken. A better synthetic check calls the smallest meaningful business path. For a checkout service, that could be:

```bash
curl -fsS https://checkout-preview.example.com/internal/smoke/checkout \
  -H "X-Smoke-Test: true" \
  -H "X-Release: 2026.06.13.2"
```

The endpoint should use test data, never charge a real customer, and write logs that make the run easy to find. Teams often gate this endpoint behind internal auth, network rules, or a signed header because it exercises sensitive paths.

Validation can prove the green application environment works. The hardest shared part still remains: the database. Blue and green often point at the same production data store, and that makes compatibility the center of safe blue-green work.

## Database Compatibility
<!-- section-summary: Blue-green still needs backward-compatible database changes because both environments may touch the same data store. -->

A **database schema** is the shape of the database: tables, columns, indexes, constraints, and relationships. Blue-green gives code strong environment isolation, but many teams keep one shared production database. That means the old blue code and the new green code may both need to work with the database during deployment, validation, promotion, and rollback.

The most dangerous database change is a destructive one that ships too early. Dropping a column, renaming a column in place, changing a type in place, or changing a constraint can break the old version immediately. If the team promotes green and then needs to return traffic to blue, blue may crash because the database no longer has the shape blue expects.

Real teams handle this with **expand and contract migrations**. The idea is to spread the database change across multiple releases:

| Phase | What happens | Why it helps |
|---|---|---|
| Expand | Add the new table, column, or nullable field while keeping the old shape. | Old code still works. New code can start writing new data. |
| Migrate | Backfill existing rows and write to both old and new places if needed. | Data catches up while production keeps running. |
| Read switch | Deploy code that reads from the new shape after data is ready. | The app moves to the new model safely. |
| Contract | Remove old columns or old write paths later. | Cleanup happens after rollback risk has passed. |

![Blue-green shared database compatibility showing blue app, green app, expand, migrate, read switch, and contract later](/content-assets/articles/article-cicd-deployment-strategies-blue-green-deployments/blue-green-database-compatibility.png)

*Blue and green can share one production database safely when schema changes stay compatible during the release window.*

Here is a very small example. Suppose `orders.discount_code` needs to become a richer `cart_discounts` table. The expand release adds the new table first:

```sql
CREATE TABLE cart_discounts (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id),
  code text NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

The next application release writes to both `orders.discount_code` and `cart_discounts`. A backfill job copies existing discount data into the new table. Once the team verifies the new table has the right data, a later application release reads from `cart_discounts`. The final cleanup release removes `orders.discount_code`.

This matters for rollback. If green has a bug after promotion, blue can still read the old column because the database still has it. The database gives both versions a common safe shape during the release window.

Once database compatibility is handled, the remaining blue-green question is cost. A second environment gives safety, but it also needs resources and cleanup discipline.

## Cost and Cleanup
<!-- section-summary: Blue-green costs more during the release window, so teams automate scale-up, scale-down, and cleanup. -->

Blue-green deployments usually need more infrastructure than rolling deployments. For a short time, the team may run two full sets of application containers, two target groups, extra load balancer rules, preview routes, and extra monitoring. If the green environment stays running forever at full size, blue-green can double compute cost for that service.

The practical answer is automation. The green environment should scale up for the release, stay alive for validation and the rollback window, then scale down or become the next standby according to the platform design.

A common production policy looks like this:

| Moment | Resource policy |
|---|---|
| Before deployment | Standby environment stays at zero or low capacity if the platform supports quick scale-up. |
| During validation | Green scales to production-equivalent capacity for realistic checks. |
| After promotion | Old blue stays alive for 15 to 60 minutes for fast revert. |
| After watch window | Old blue scales down or moves into the next preview slot. |

The cost conversation should include observability too. Blue and green need separate release labels in metrics and logs so the team can compare behavior after promotion. A good label set includes `service`, `version`, `environment_color`, `deployment_id`, and `git_sha`. The names can differ by stack, but the goal is the same: when an alert fires, responders can tell which environment produced it.

Blue-green gives us stronger isolation and a fast traffic switch. It still switches all production users at promotion time. Some releases need smaller exposure than that, especially when the risk only appears under real traffic patterns. That leads naturally to canary deployments.

## Putting It All Together
<!-- section-summary: Blue-green separates deployment from promotion so teams can validate the new environment before users reach it. -->

Let's put the checkout release together.

Blue runs version `2026.06.13.1` and serves all users. The pipeline deploys version `2026.06.13.2` into green using the same image digest that passed CI. Green gets its own task set or ReplicaSet, its own target group or preview Service, and the same runtime configuration style as production.

Before promotion, the team runs readiness checks, synthetic checkout, migration checks, queue checks, and log or metric label checks against green. The database change follows expand and contract, so both blue and green can work with the shared production data during the release window.

Promotion moves the load balancer, Service, or rollout controller from blue to green. The pipeline watches error rate, latency, target health, and business smoke tests. Blue stays alive for a short rollback window. If the new version fails, traffic can move back quickly because the old environment still exists and the database still supports it.

Blue-green is a strong choice when version mixing creates risk, when validation needs a full production-like environment, or when the team wants a clear traffic switch. The tradeoff is extra cost and a large exposure jump at promotion time.

![Blue-green release summary showing deploy green, validate, promote, watch, keep blue, and clean up](/content-assets/articles/article-cicd-deployment-strategies-blue-green-deployments/blue-green-release-summary.png)

*A complete blue-green release separates deployment from promotion, keeps blue nearby for fast revert, and cleans up after the watch window.*

## What's Next
<!-- section-summary: Canary deployments add smaller production exposure steps before the whole user base moves to the new version. -->

The next article covers **canary deployments**. We will keep the checkout API, but instead of switching all production traffic to green at once, we will send a small percentage to the new version, compare telemetry, and increase traffic only when the signals look healthy.

---

**References**

- [AWS CodeDeploy deployments on an Amazon ECS compute platform](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-steps-ecs.html) - Documents ECS blue/green components, target groups, test listeners, lifecycle events, and traffic rerouting.
- [AWS CodeDeploy deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html) - Explains predefined and custom deployment configurations, including blue/green and traffic shifting options.
- [Argo Rollouts blue-green strategy](https://argo-rollouts.readthedocs.io/en/stable/features/bluegreen/) - Documents active services, preview services, promotion, and scale-down delay behavior.
- [Prisma expand-and-contract migrations](https://www.prisma.io/docs/guides/database/data-migration) - Shows a practical expand, migrate, and contract workflow for production database changes.
- [GitLab backwards compatibility across updates](https://docs.gitlab.com/development/multi_version_compatibility/) - Explains why multi-component deployments need backward compatibility during non-atomic updates.
