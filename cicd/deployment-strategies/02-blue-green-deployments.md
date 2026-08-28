---
title: "Blue-Green Deployments"
description: "Deploy a complete candidate environment beside the active one, validate it, switch routing, preserve rollback, and keep shared data compatible."
overview: "Blue-green deployment separates creating a candidate environment from releasing it to users. Learn how the active and candidate pools, routing switch, validation, shared-state compatibility, rollback window, and cleanup rules fit together."
tags: ["blue-green", "load-balancer", "database-migration", "continuous-deployment"]
order: 2
id: article-cicd-deployment-strategies-blue-green-deployments
aliases:
  - /cicd/deployment-strategies/blue-green-deployments
---

## Table of Contents

1. [Why Do Blue and Green Separate the Active Environment from the Candidate?](#why-do-blue-and-green-separate-the-active-environment-from-the-candidate)
2. [How Do Routing and Validation Prepare the Production Switch?](#how-do-routing-and-validation-prepare-the-production-switch)
3. [When Is Fast Rollback Actually Possible?](#when-is-fast-rollback-actually-possible)
4. [How Must Databases, Queues, Sessions, and Caches Remain Compatible?](#how-must-databases-queues-sessions-and-caches-remain-compatible)
5. [How Does Blue-Green Differ from Rolling and Canary?](#how-does-blue-green-differ-from-rolling-and-canary)
6. [Why Do Parity, Cost, and Cleanup Define the Rollback Window?](#why-do-parity-cost-and-cleanup-define-the-rollback-window)
7. [How Can Blue-Green Be Implemented and Verified?](#how-can-blue-green-be-implemented-and-verified)
8. [How Does a Production-Quality Blue-Green Sequence Fit Together?](#how-does-a-production-quality-blue-green-sequence-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

In the rolling deployment article, an application service moved from version `2026.06.13.1` to `2026.06.13.2` a few containers at a time. That worked because the old and new versions could safely run together for a short period. Many releases fit that pattern.

Now imagine a larger service change. The old version stores one simple field. The new version reads a richer table, writes a new audit event, and changes an external request payload. During a rolling deployment, both versions may process live traffic at the same time. One request could hit the old version, the next could hit the new version, and background jobs may read data written by either version.

That mixed state can create real production problems. The old version may read data shaped by the new version. The new version may assume a queue message includes a field the old version never writes. A payment retry may pass through a different version than the original request. This can work if the team designed every interface to handle both versions. The risk grows when the change crosses application code, database schema, queues, and third-party calls.

Keep these questions in view as you work through the lesson:

1. **Why Do Blue and Green Separate the Active Environment from the Candidate?**
2. **How Do Routing and Validation Prepare the Production Switch?**
3. **When Is Fast Rollback Actually Possible?**
4. **How Must Databases, Queues, Sessions, and Caches Remain Compatible?**
5. **How Does Blue-Green Differ from Rolling and Canary?**
6. **Why Do Parity, Cost, and Cleanup Define the Rollback Window?**
7. **How Can Blue-Green Be Implemented and Verified?**
8. **How Does a Production-Quality Blue-Green Sequence Fit Together?**

## Why Do Blue and Green Separate the Active Environment from the Candidate?
<!-- section-summary: Blue-green deployments help when old and new versions need stronger isolation than a rolling rollout gives. -->

A **blue-green deployment** gives the new version a separate production-like environment before users touch it. One environment serves all real traffic. The other environment runs the new release and waits for validation. When the team accepts the new environment, traffic moves over in one controlled switch.

The important thing is the boundary. Rolling deployment changes instances inside one live service pool. Blue-green deployment changes which full environment receives traffic.

Rolling creates too much version mixing for a release that needs a clean environment boundary, a long validation phase, synchronized change across several runtime components, or simpler separation in logs and debugging. Blue-green does not eliminate coexistence everywhere—the database and messages may still be shared—but it prevents ordinary production requests from being distributed across application version A and B during preparation.

Deployment and release become visibly separate. **Deployment** constructs green and proves it can operate. **Release** changes routing so users reach green. A candidate can fail deployment without affecting production because blue remains active. A release can fail after the switch because behavior under real production traffic differs from preview validation.

This separation can make debugging easier. Before promotion, green logs and metrics belong to one version and controlled validation traffic. Blue's production behavior remains a stable comparison. During rolling replacement, failures may be interleaved across old and new instances behind one route, which can make attribution harder unless telemetry labels are excellent.

The clean boundary is still selective. Application processes and routing targets are separate, while a database, event bus, identity provider, third-party API, or cache may remain shared. Blue-green isolates the layer you duplicate; it does not automatically create a second copy of the whole world.

<!-- section-summary: Blue-green uses two complete environment pools so the new release can be built and tested away from live users. -->

The names **blue** and **green** are just labels. Blue might run the current production version today, and green might run the next version. After the switch, green serves production and blue moves into the standby or cleanup role.

The colors are roles, not permanent identities. “Blue” does not always mean old, and “green” does not always mean new. The useful terms are **active environment** and **candidate environment**. After a successful promotion, yesterday's candidate becomes active; the other slot may become the next candidate.

Green reaches full intended capacity before the switch. That allows startup, warm-up, and validation without first removing blue capacity. At promotion, the platform changes the routing pointer rather than replacing instances under live traffic. The tradeoff is that both environment pools consume resources during the overlap.

For our application service, a blue-green setup might look like this:

| Environment | Version | Traffic role | Main pieces |
|---|---|---|---|
| Blue | `2026.06.13.1` | Serves users now | Application instances, routing target, config, identity, alarms |
| Green | `2026.06.13.2` | Receives validation traffic | Candidate instances, preview route, production-equivalent settings |

On Kubernetes, blue and green can be two Deployments with stable labels such as `slot: blue` and `slot: green`. A production Service selects the active slot. A separate preview Service selects the candidate slot so automation can validate it before promotion.

Here is the routing part of that shape:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: service
spec:
  selector:
    app: service
    slot: blue
  ports:
    - port: 80
      targetPort: 8080
```

Promotion changes the production Service selector from `slot: blue` to `slot: green`. The preview Service remains a stable address for candidate validation. Automation deliberately keeps the old Deployment alive after promotion, giving the team a fast routing path back if the candidate fails immediately.

![Blue-green deployment showing blue live environment, green preview environment, load balancer switch, test traffic, promote, and fast revert](/content-assets/articles/article-cicd-deployment-strategies-blue-green-deployments/blue-green-environment-switch.png)

*Blue-green keeps a full live environment and a full preview environment, then moves traffic at the routing layer when green is ready.*

Once the green environment exists, the release is a routing problem. The team needs a traffic switch that moves users cleanly and predictably.

## How Do Routing and Validation Prepare the Production Switch?
<!-- section-summary: Blue-green traffic should move at the router or load balancer layer instead of depending on slow DNS-only changes. -->

**Traffic switching** means changing which environment receives production requests. The switch should happen close to the load balancer, gateway, ingress controller, or service routing layer. That gives the deployment system one controlled place to move traffic.

On Kubernetes, the active Service selector can change from the blue Deployment labels to the green Deployment labels. Another pattern keeps two Services and changes an Ingress or gateway backend. Outside Kubernetes, a load balancer or reverse proxy can switch from one server group to another. Blue-green is a routing pattern, not a Kubernetes feature.

This is different from using public DNS as the main release switch. DNS is useful for many traffic-management tasks, but DNS records can live in client caches, resolver caches, mobile networks, and corporate proxies. If the release depends on every client seeing a DNS change quickly, some users may stay on the old environment long after the team thinks the switch finished.

The switch is usually not literally instantaneous. Existing keep-alive connections may continue to blue, in-flight requests finish there, endpoint propagation takes time, and load balancers may drain old targets. The goal is a controlled, bounded routing transition above individual instances—not a physically simultaneous change for every packet.

Load-balancer, Service, Ingress, or gateway switching is usually cleaner than public DNS because the operator controls the routing object close to the service and can observe target health. DNS can be appropriate at larger geographic or disaster-recovery boundaries, but its caches make the rollback window harder to reason about.

Think of promotion as changing desired routing state in a control plane. The data plane then converges: endpoint lists update, proxies receive configuration, new connections choose green, and old connections drain from blue. Automation should observe that convergence instead of declaring success immediately after an API accepted the update.

The routing layer also defines how precise a switch can be. Some systems support only one selected backend, producing the classic 0-to-100 change. Others support weights, letting the operator move 1%, 10%, 50%, then 100%. The environments remain blue and green, but the release begins to incorporate canary-style exposure control.

Client behavior matters. Long-lived streams, WebSockets, and connection pools can remain attached to blue long after new HTTP requests choose green. Decide whether to drain, terminate, or tolerate those sessions, and include their maximum lifetime in the rollback and cleanup plan.

A practical blue-green switch has a small set of controlled actions:

```bash
./scripts/deploy-green.sh registry.example.com/service@sha256:8f3a...
./scripts/smoke-test.sh https://service-preview.example.com
./scripts/promote-green.sh service
./scripts/watch-release.sh service --minutes 30
```

That flow tells us something important. Deployment creates the green environment. Promotion moves production traffic to it. Keeping those two moments separate gives the team time to inspect the new environment before customers use it.

The green environment still needs proof before the switch. A working container process is only the first signal. The next step is validation.

<!-- section-summary: The green environment needs pre-traffic checks that prove the real release path works before promotion. -->

**Pre-traffic validation** means testing the green environment before it serves normal users. These checks should use the same image, config style, routing path, and observability that production uses. The point is to catch wiring problems while blue still carries the business.

For an application service, a good validation set might include:

| Check | What it proves |
|---|---|
| `/ready` health check | The app booted, loaded config, and can reach required dependencies. |
| Synthetic transaction | The main user path completes with controlled test data. |
| Database migration status | The schema version expected by the app exists. |
| Queue compatibility | The app can publish and consume expected message shapes. |
| Observability labels | Logs, metrics, traces, and alerts identify the new version. |

The pipeline should treat any failed candidate check as a **failed deployment**, not as a production incident. Green can be repaired or replaced while blue continues serving. Promotion should not occur until the full validation set passes.

The smoke test should avoid fake success. A request to `/health` can say the web server is running while the main service path is broken. A better synthetic check calls the smallest meaningful business path. For an application service, that could be:

```bash
curl -fsS https://service-preview.example.com/internal/smoke/transaction \
  -H "X-Smoke-Test: true" \
  -H "X-Release: 2026.06.13.2"
```

The endpoint should use controlled test data and write logs that make the run easy to find. Teams gate it behind internal authentication, network rules, or a signed header because it exercises a meaningful path.

Validation can prove the green application environment works. The hardest shared part still remains: the database. Blue and green often point at the same production data store, and that makes compatibility the center of safe blue-green work.

Readiness is necessary but insufficient. It proves an instance can accept requests under the endpoint's definition. Pre-switch validation should also prove configuration, secrets and identities, dependencies, migrations, routes, observability, background workers, and meaningful business behavior. Green may need cache warming, JIT warm-up, connection-pool establishment, or model and data loading before its latency represents steady state.

Preview tests are not production traffic. They may use synthetic data, low concurrency, familiar paths, and a different caller identity. They cannot fully reproduce user distribution, cache behavior, traffic volume, unusual payloads, or every downstream interaction. The switch remains a release event that needs close post-switch observation and stop criteria.

This creates a useful incident distinction. If green fails before promotion, the **deployment** failed and users remain on blue. If green passes preview but real signals fail after routing changes, the **release** failed. The response, urgency, and evidence differ. Recording the boundary prevents teams from treating every candidate startup problem as a customer incident or every post-switch correctness problem as a mere deployment timeout.

Automation should also record the candidate identity beside every result: artifact digest, source revision, configuration version, schema state, and validation run. Otherwise a repaired green may be promoted after tests that actually exercised an earlier candidate.

## When Is Fast Rollback Actually Possible?
<!-- section-summary: Routing back is fast only while the old environment, its artifact, its configuration, and every shared-state contract remain valid. -->

Conceptually, rollback changes the routing pointer from green back to blue. That is much simpler than rebuilding the previous version and can happen quickly because blue still exists at full or recoverable capacity. The simplicity is conditional.

Blue must still be healthy, reachable, sufficiently scaled, and configured for the current dependencies. The exact old artifact and secrets must remain usable. Database schemas, messages, sessions, and caches modified by green must remain understandable to blue. If green performed an irreversible external action, routing alone cannot undo it.

This is why teams keep blue through a written rollback window. Immediate failures may appear within minutes, while memory leaks, cache growth, unusual traffic, delayed queue processing, or business drift may take longer. A longer window improves recovery opportunity but costs capacity and constrains how long shared state must remain backward compatible.

Rollback is therefore a prepared capability, not a button. Before promotion, automation should verify that blue is healthy and that the reverse routing action works. After promotion, it should continuously protect the conditions that make return possible.

## How Must Databases, Queues, Sessions, and Caches Remain Compatible?
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

Write compatibility is often harder than read compatibility. Green may write a richer structure, new enum value, or new invariant that blue does not preserve when it later updates the same record. During the rollback window, design both directions: blue must read green's writes, and green must tolerate any writes blue may still produce before or after a revert.

Queues and events extend the overlap in time. Messages created by green can remain queued after traffic returns to blue. Producers should add fields compatibly, consumers should tolerate unknown fields, and semantics that cannot be compatible should use explicit event versions or separate topics with a migration plan.

Session state also crosses the switch. A browser with an old cookie, a server-side serialized session, or an in-flight retry may reach green after beginning on blue, then return to blue during rollback. Use compatible formats and external session stores rather than assuming environment-local memory will follow routing.

Shared caches can surprise the release. Green may populate entries with a shape blue cannot decode or change key semantics in a way that causes collisions. Version cache keys or values when formats change, and warm green deliberately so promotion does not create an avoidable latency spike.

Database migration may become a multi-release process: release one expands schema; release two deploys compatible dual-read or dual-write code and migrates data; release three switches reads and later contracts the old form after the rollback window. Blue-green does not compress those data-safety steps into one release.

The three releases have distinct recovery behavior. During expansion, both environments ignore or tolerate the new form. During migration and read switching, both forms remain valid and progress is measurable. Only after every rollback target no longer requires the old form does contraction delete it. Treating contraction as routine cleanup inside the same promotion would erase blue's promised recovery path.

Once shared-state compatibility is handled, we can compare the release shape with other strategies.

## How Does Blue-Green Differ from Rolling and Canary?
<!-- section-summary: Blue-green prepares a full candidate and changes routing between environment pools, while rolling replaces instances and canary controls exposure by traffic fraction. -->

Rolling changes membership inside one serving pool. Old and new application instances coexist behind the same service while replacement proceeds. It usually needs less duplicate capacity, but version mixing is the normal transition.

Blue-green creates a complete candidate pool before release and switches the active route. It gives cleaner application-version separation and easier environment-level comparison, at the cost of duplicate capacity and an often-large traffic jump.

Canary is defined by limited production exposure. A small fraction of real traffic reaches B, signals are compared, and exposure grows through steps. A blue-green platform can perform a gradual weighted switch and therefore add canary-like risk control, but a classic 0-to-100 blue-green promotion is not a canary.

Blue-green is especially useful when creating the candidate is routine and the routing switch is cheap, observable, and reversible. If the database change dominates risk, or if maintaining two equivalent environments is difficult, the colored application pools do not solve the hard part.

A simple decision intuition is to compare the cost of duplicate capacity with the cost of mixed versions and slow recovery. Choose blue-green when a full candidate can be prepared reliably, the route is centralized, the active environment can remain available, and the team values a clean operational comparison. Avoid treating it as automatic when shared state cannot support both versions, traffic cannot switch predictably, or the candidate cannot reproduce production-relevant conditions.

Blue-green can make a coordinated multi-component release easier to observe because every candidate component can carry the same deployment identity before the switch. It can also make the candidate larger and more complex to validate. The environment boundary should group only the components that truly need one promotion decision.

## Why Do Parity, Cost, and Cleanup Define the Rollback Window?
<!-- section-summary: Blue-green costs more during the release window, so teams automate scale-up, scale-down, and cleanup. -->

Blue-green deployments usually need more infrastructure than rolling deployments. For a short time, the team may run two full sets of application containers, two routing targets, preview routes, and extra monitoring. If the green environment stays running forever at full size, blue-green can double compute cost for that service.

The practical answer is automation. The green environment should scale up for the release, stay alive for validation and the rollback window, then scale down or become the next standby according to the platform design.

Environment parity is essential. Green must match blue in runtime class, network routes, policies, service dependencies, limits, observability, and configuration semantics. A “preview” using smaller resources or different security paths can pass validation and still fail immediately after promotion. Differences should be deliberate inputs such as version and slot, not accidental snowflake state.

Configuration travels with the release. Record the image digest, code revision, configuration version, migration version, environment identity, and routing change as one release record. Secrets remain separate values but must use equivalent scope and permission. Green should not accidentally validate with a broader identity than production or share credentials in a way that destroys environment boundaries.

Secrets and identities need slot-aware boundaries. Preview automation may require an internal route and test capability, while the active slot needs production authority. Do not let the candidate gain destructive production power merely because it is production-sized. Where both slots must call the same dependency, give each a separately identifiable principal so audit logs reveal which environment acted and revocation can target one slot.

Parity means equivalent policy, not necessarily identical secret values. Both slots can have the same allowed operations through distinct credentials or workload identities. That design supports comparison without making a leaked candidate credential indistinguishable from the active environment.

A common production policy looks like this:

| Moment | Resource policy |
|---|---|
| Before deployment | Standby environment stays at zero or low capacity if the platform supports quick scale-up. |
| During validation | Green scales to production-equivalent capacity for realistic checks. |
| After promotion | Old blue stays alive for 15 to 60 minutes for fast revert. |
| After watch window | Old blue scales down or moves into the next preview slot. |

The cost conversation should include observability too. Blue and green need separate release labels in metrics and logs so the team can compare behavior after promotion. A good label set includes `service`, `version`, `environment_color`, `deployment_id`, and `git_sha`. The names can differ by stack, but the goal is the same: when an alert fires, responders can tell which environment produced it.

Do not clean blue too early. Some failures appear slowly, and destroying blue closes the fastest rollback path. Do not keep it indefinitely without cost and compatibility policy either. Cleanup removes obsolete compute, routes, preview access, temporary data, and stale configuration only after the watch window and rollback decision are complete.

The application pools may cost close to twice their normal compute during the overlap, but the whole system cost does not necessarily double because databases, queues, gateways, and observability may be shared. Those shared components are exactly where isolation is weaker and compatibility matters most.

## How Can Blue-Green Be Implemented and Verified?
<!-- section-summary: Kubernetes Services, ingress routing, load-balancer groups, or VM pools can implement the same two-environment routing pattern. -->

Kubernetes can use two Deployments and one production Service whose selector names the active slot. Promotion patches the selector. Because selector updates and endpoint propagation have subtleties, keep stable labels, verify the candidate endpoints are ready, observe both endpoint sets during the change, and drain old connections before scale-down.

Do not make the production selector so broad that it matches both colors accidentally. The application label identifies the service; the slot label identifies the environment. Before promotion, query the candidate Deployment and preview Service endpoints directly. During promotion, verify that every production endpoint has the candidate slot and that no unintended pod matches.

Service selector switching changes endpoint membership, not the pods themselves. Readiness still controls whether a selected pod is published as ready, and connection draining still needs application termination behavior. A successful selector patch says only that desired routing changed; it does not prove that all clients now use green.

Another Kubernetes shape uses one Service per color and switches an Ingress or gateway backend. That keeps each Service's endpoints stable and makes the routing object the explicit promotion pointer. Outside Kubernetes, blue and green may be two VM autoscaling groups behind a load balancer. The implementation differs, but both create full candidate capacity and switch an upper routing layer.

Before switching, automation should verify green replica count, readiness, capacity under representative load, configuration version, secret and identity access, database migration state, queue and session compatibility, route reachability, metrics and logs, synthetic behavior, and blue health for rollback.

After switching, verify target distribution, error and latency deltas, saturation, business signals, background processing, and blue's standby health. Routing back is not enough if green wrote incompatible state or caused external side effects, so the release decision must include those checks.

Shadow traffic can improve validation by copying production requests to green without using green's response. It must suppress or isolate side effects, protect sensitive data, and avoid doubling downstream writes. Feature flags offer another layer: deploy and route to green with risky behavior disabled, then activate that behavior separately after infrastructure health is known.

At a VM or autoscaling-group level, the same checks apply. Build green from an immutable machine or container artifact, attach it to a candidate backend, prove health and capacity, switch the load balancer, keep blue registered or quickly re-registerable, and terminate it only after the rollback window. The colors describe routing roles, not a specific orchestrator.

Blue-green gives us stronger isolation and a fast traffic switch. It still switches all production users at promotion time. Some releases need smaller exposure than that, especially when the risk only appears under real traffic patterns. That leads naturally to canary deployments.

## How Does a Production-Quality Blue-Green Sequence Fit Together?
<!-- section-summary: Blue-green separates deployment from promotion so teams can validate the new environment before users reach it. -->

Let's put the service release together.

Blue runs version `2026.06.13.1` and serves all users. The pipeline deploys version `2026.06.13.2` into green using the same image digest that passed CI. Green gets its own Deployment or server group, preview route, and production-equivalent runtime configuration.

Before promotion, the team runs readiness checks, synthetic transaction, migration checks, queue checks, and log or metric label checks against green. The database change follows expand and contract, so both blue and green can work with the shared production data during the release window.

Promotion moves the load balancer, Service, or rollout controller from blue to green. The pipeline watches error rate, latency, target health, and business smoke tests. Blue stays alive for a short rollback window. If the new version fails, traffic can move back quickly because the old environment still exists and the database still supports it.

The production sequence begins earlier. Build one immutable artifact and record its configuration. Apply only backward-compatible shared-state expansion. Provision green from reviewed infrastructure definitions, give it scoped secrets and identity, scale it to the intended capacity, and warm it. Validate readiness, meaningful behavior, routing, observability, background work, and rollback prerequisites.

Immediately before promotion, confirm blue is healthy and freeze competing environment changes. Change the routing pointer through one controlled operation, observe endpoint propagation and connection draining, then run post-switch checks under real traffic. Stop or route back when written thresholds fail. Preserve blue and compatibility through the watch window; only then remove obsolete resources and later contract shared state.

The blue-green invariants are: exactly one environment is the intended production route; the candidate receives no uncontrolled user traffic before authorization; green reaches sufficient capacity before release; blue remains returnable during the rollback window; both environments understand every shared-state change; configuration and identity are equivalent in policy but isolated in scope; and cleanup never begins before the rollback decision closes.

The deepest distinction from rolling is the unit of transition. Rolling changes serving instances inside one environment. Blue-green first constructs a complete environment state and then changes a routing reference between environment states. The application versions may still coexist operationally through shared databases, messages, sessions, and draining connections, so the clean diagram does not remove compatibility work.

Remember the mental model: build green completely, prove it as far as non-production traffic allows, switch the production route deliberately, observe the release, preserve blue while return is valid, and close the old path only after evidence supports that decision.

Blue-green is a strong choice when version mixing creates risk, when validation needs a full production-like environment, or when the team wants a clear traffic switch. The tradeoff is extra cost and a large exposure jump at promotion time.

![Blue-green release summary showing deploy green, validate, promote, watch, keep blue, and clean up](/content-assets/articles/article-cicd-deployment-strategies-blue-green-deployments/blue-green-release-summary.png)

*A complete blue-green release separates deployment from promotion, keeps blue nearby for fast revert, and cleans up after the watch window.*

## Check Your Answers

:::expand[Why Do Blue and Green Separate the Active Environment from the Candidate?]{kind="recap"}
Blue-green constructs and validates B away from normal production routing while A remains active. Deployment creates the candidate; release changes the route. This reduces application-version mixing during preparation but does not remove shared-state compatibility or post-release risk.

The colors are temporary roles: active and candidate. Green reaches full intended capacity, configuration, identity, and observability before promotion. After a successful switch, green is active and blue becomes the retained rollback environment or the next candidate slot.
:::

:::expand[How Do Routing and Validation Prepare the Production Switch?]{kind="recap"}
A Service, Ingress, gateway, load balancer, or proxy changes its active backend above individual instances. The switch still includes propagation, connection draining, and in-flight work. Public DNS is less precise because clients and resolvers cache it independently.

Validate readiness, configuration, identity, dependencies, migrations, routes, observability, background work, meaningful behavior, warm-up, and blue rollback health. Preview checks can reject a bad deployment, but they cannot reproduce every production traffic pattern, so promotion remains a release event.
:::

:::expand[When Is Fast Rollback Actually Possible?]{kind="recap"}
Routing back is fast only while blue remains healthy, scaled, reachable, correctly configured, and compatible with every write or side effect green produced. The written rollback window preserves those conditions long enough to observe failures without retaining duplicate capacity indefinitely.
:::

:::expand[How Must Databases, Queues, Sessions, and Caches Remain Compatible?]{kind="recap"}
Both environments can touch shared state before and after the switch. Expand-and-contract schemas, bidirectional write compatibility, version-tolerant events, compatible sessions, and versioned cache formats keep blue usable. Destructive contraction waits beyond the rollback window.
:::

:::expand[How Does Blue-Green Differ from Rolling and Canary?]{kind="recap"}
Rolling replaces members within one live pool. Blue-green prepares a full candidate pool and switches an environment route. Canary limits real production exposure and grows it gradually. A weighted blue-green switch can add canary behavior, but a classic full switch cannot.
:::

:::expand[Why Do Parity, Cost, and Cleanup Define the Rollback Window?]{kind="recap"}
Green must match blue in resources, routes, policy, dependencies, and configuration semantics. Duplicate application capacity costs money, while shared services preserve compatibility risk. Keep blue until the observation window closes, then clean routes, compute, and temporary state deliberately.
:::

:::expand[How Can Blue-Green Be Implemented and Verified?]{kind="recap"}
Use two Kubernetes Deployments plus a Service selector, two Services plus ingress routing, or two VM groups behind a load balancer. Verify candidate and active health before switching, production signals afterward, and use shadow traffic or feature flags only with controlled side effects.
:::

:::expand[How Does a Production-Quality Blue-Green Sequence Fit Together?]{kind="recap"}
Build immutably, expand shared state, create and warm green, validate it, confirm blue rollback health, switch one routing pointer, observe real traffic, route back on written failures, preserve compatibility through the window, then clean and contract later.
:::

## References

- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Explains Service selectors and endpoint routing used to point production traffic at an active Deployment.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents the versioned application groups that can form blue and green pools.
