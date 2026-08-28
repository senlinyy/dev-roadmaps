---
title: "Zero-Downtime Deployments"
description: "Learn how replacement overlap, readiness, traffic control, state identity, and rollback boundaries work together in Terraform deployments."
overview: "Terraform can describe both the old and new infrastructure, but availability depends on the transition between them. This article derives low-downtime deployment patterns from one invariant: enough healthy capacity must remain available throughout every change."
tags: ["zero-downtime", "create-before-destroy", "lifecycle", "blue-green", "terraform"]
order: 4
id: article-iac-terraform-advanced-zero-downtime
---

## Table of Contents

1. [Why Is Availability About the Transition?](#why-is-availability-about-the-transition)
2. [What Does Replacement Overlap Actually Guarantee?](#what-does-replacement-overlap-actually-guarantee)
3. [How Do Readiness Checks Protect the Handoff?](#how-do-readiness-checks-protect-the-handoff)
4. [How Should Traffic Move Between Versions?](#how-should-traffic-move-between-versions)
5. [How Do Fleets Roll Out Changes Safely?](#how-do-fleets-roll-out-changes-safely)
6. [Why Do State Identity and Boundaries Affect Deployments?](#why-do-state-identity-and-boundaries-affect-deployments)
7. [What Makes Rollback Possible?](#what-makes-rollback-possible)
8. [How Do You Design the Complete Deployment?](#how-do-you-design-the-complete-deployment)
9. [Check Your Answers](#check-your-answers)

The goal of a zero-downtime deployment is not that Terraform finishes without an error. It is that, at every moment during the change, some healthy version of the application can still serve the required traffic. Terraform moves infrastructure between desired states, but users experience the steps in between.

Suppose users currently reach server A running version 1, and the desired result is server B running version 2:

```text
before                         after

Users                          Users
  |                              |
  v                              v
Server A                       Server B
version 1                      version 2
```

Those end states do not reveal the path. A dangerous replacement can destroy A, create B, boot its operating system, start the application, and wait for it to become usable. Between the first and final steps, users have no healthy destination.

The deployment invariant is continuous service while old and new capacity overlap during the transition.

Keep these questions in view as you work through the lesson:

1. **Why Is Availability About the Transition?**
2. **What Does Replacement Overlap Actually Guarantee?**
3. **How Do Readiness Checks Protect the Handoff?**
4. **How Should Traffic Move Between Versions?**
5. **How Do Fleets Roll Out Changes Safely?**
6. **Why Do State Identity and Boundaries Affect Deployments?**
7. **What Makes Rollback Possible?**
8. **How Do You Design the Complete Deployment?**

## Why Is Availability About the Transition?
<!-- section-summary: Terraform describes end states, while users experience every intermediate step between the old and new service. -->

```text
healthy capacity >= capacity required to serve traffic
```

It must hold for the entire transition, not merely before and after `terraform apply`. That makes zero downtime a systems property involving Terraform, the provider platform, application startup, health checks, routing, and operational decisions.

Consider a generic server resource:

```hcl
resource "some_server" "app" {
  image = "app-v1"
}
```

Changing the image to `app-v2` can be an in-place update if the provider supports it, or it can require replacement. Provider schemas and remote API behavior decide which attributes can update and which force a new object. A replacement is conceptually two operations: destroy the old object and create a new one.

The smallest replacement outage comes from performing those operations in the wrong order:

```text
A(v1) -> destroy -> no server -> create B(v2) -> ready
```

The first low-downtime principle follows directly: replacement can avoid a capacity gap only if the old and new objects are able to overlap. If the platform cannot host both at once, Terraform syntax cannot invent the missing capacity.

Availability also depends on what “required capacity” means. For a lightly used single-instance service, one healthy server may be enough. For a busy fleet, keeping one instance alive may still overload it. The invariant should be expressed in terms of useful service capacity, not merely a positive object count.

## What Does Replacement Overlap Actually Guarantee?
<!-- section-summary: create_before_destroy changes object ordering, but overlap alone does not prove readiness, route traffic, or preserve enough capacity. -->

Terraform's `create_before_destroy` lifecycle rule asks Terraform to create a replacement before removing the object currently associated with the address:

```hcl
resource "some_server" "app" {
  image = var.image

  lifecycle {
    create_before_destroy = true
  }
}
```

The desired ordering becomes:

```text
old remains available
        |
        v
create replacement
        |
        v
old + new overlap
        |
        v
destroy old
        |
        v
new remains
```

![Create before destroy timeline](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/create-before-destroy-timeline.png)

*The lifecycle rule creates an overlap opportunity; readiness and routing still decide whether users remain safe.*

Overlap is necessary for many replacement patterns, but it is not sufficient. A remote API returning “created” may mean that a virtual machine record exists, not that the operating system has booted, the application has started, dependencies are reachable, and requests succeed. Terraform can create B and then remove A while B is still warming up unless some dependency or controller connects destruction and traffic movement to real readiness.

The platform must also allow both generations to coexist. A globally unique fixed name cannot belong to the old and new objects at the same time. Other blockers include quotas, fixed addresses, exclusive attachments, and capacity limits. Generated names or name prefixes often make overlap possible, but naming is only one constraint.

Think of `create_before_destroy` as providing this one capability:

```text
old and replacement may exist concurrently
```

It does not provide these capabilities by itself:

```text
replacement is healthy
replacement receives traffic
old connections drain
enough capacity remains
rollback remains available
```

A real zero-downtime sequence has three broad phases. First, create the new capacity without disturbing the old. Second, prove readiness and move traffic. Third, retire the old capacity only after the handoff is safe. Each phase needs a component that can observe and enforce its condition.

`prevent_destroy` can protect a critical object from an accidental Terraform destroy, but it is not a rollout engine. It rejects destruction while the rule is present; it does not coordinate traffic or make a replacement healthy. Likewise, `depends_on` can order operations but cannot prove that a process inside a server is ready.

## How Do Readiness Checks Protect the Handoff?
<!-- section-summary: Readiness must represent the ability to serve real work, and each check must be interpreted according to the component that enforces it. -->

Creation and readiness answer different questions:

```text
created
    Did the infrastructure API accept and materialize the object?

ready
    Can this generation safely perform the work users will send to it?
```

A replacement may exist while its application cannot reach a database, has not loaded configuration, is still running migrations, or returns errors. A meaningful readiness check should cover the dependencies required to serve traffic rather than only report that a process is alive.

A load balancer is often the best runtime judge because it repeatedly checks the same target that would receive requests. It can keep an unhealthy target out of rotation and continue routing to the old healthy generation. Readiness might require:

```text
process started
expected port listening
health endpoint returning success
database or cache reachable when essential
startup and migration work complete
```

Terraform can configure a load balancer and its health-check policy, but the load balancer performs the ongoing observations. That boundary is useful: Terraform declares infrastructure and relationships, while a runtime traffic controller evaluates changing health.

Terraform also offers checks, and their semantics matter. A `check` block can evaluate an assertion and report a warning without necessarily blocking the overall operation. That makes checks useful for continuous validation and diagnostic signals, but a warning is not automatically a release gate.

A resource `postcondition` is stronger for dependency ordering:

```hcl
resource "some_server" "app" {
  image = var.image

  lifecycle {
    postcondition {
      condition     = self.status == "ready"
      error_message = "The replacement must be ready before dependent changes continue."
    }
  }
}
```

A failed postcondition can stop downstream actions that depend on the resource. It still does not turn the entire apply into a transaction: operations already completed are not automatically undone. The check also depends on what the provider's `status` actually means. If it represents only API-level creation, it remains weaker than application health.

The strongest design connects the health signal to the traffic system. New capacity registers as a target, remains excluded until it passes health checks, begins receiving controlled traffic, and is monitored under real load. The old generation remains available until the new one has demonstrated sufficient readiness.

![Traffic cutover boundary](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/traffic-cutover-boundary.png)

*Terraform, readiness checks, and routing have different responsibilities during a handoff.*

## How Should Traffic Move Between Versions?
<!-- section-summary: A stable front door lets replaceable backends overlap, prove health, and receive traffic through an explicit cutover. -->

If users connect directly to one replaceable server, replacing that server also replaces the user-facing destination. A stable front door separates service identity from backend identity:

```text
Users
  |
  v
stable load balancer or service endpoint
  |
  +--> old backend
  +--> new backend
```

The front door remains stable while backends change. This makes the traffic switch an explicit deployment step instead of an accidental consequence of object creation or destruction.

Blue/green deployment follows naturally. Blue is the current generation, green is the candidate generation:

```text
1. traffic -> blue
2. create green
3. verify green
4. traffic -> green
5. observe
6. retire blue after the rollback window
```

The old version is not destroyed merely because the new version exists. It stays available until the release has earned confidence. If green fails before the cutover, users remain on blue. If green fails soon after the cutover, traffic can move back while blue still exists.

Canary deployment makes the traffic step smaller. Instead of switching 100 percent at once, the controller might send 5 percent to green, then 25 percent, then 50 percent, and finally 100 percent. Each stage asks whether error rate, latency, saturation, and business outcomes remain within an acceptable release window.

Terraform can model weights or routing configuration, but this reveals an important boundary. A full `terraform apply` is not necessarily the best feedback loop for rapid traffic control during an incident. A deployment controller or load balancer API may own the staged movement while Terraform defines the durable routing structure. Whichever tool moves traffic, ownership must be explicit so Terraform does not later fight an intentional runtime decision.

The safe traffic sequence is:

```text
prepare candidate
    -> prove readiness
    -> expose a small amount of traffic
    -> evaluate runtime evidence
    -> increase or reverse traffic
    -> drain old connections
    -> remove old capacity
```

Dependencies can ensure that a routing resource is considered after a target exists, but ordering is not readiness. The routing step should depend on a signal that actually means the candidate can serve. Otherwise the graph only proves “created first,” not “healthy first.”

## How Do Fleets Roll Out Changes Safely?
<!-- section-summary: Fleet rollouts preserve a capacity threshold while replacing members gradually, usually through a platform controller. -->

One machine and a fleet present different problems. For a single server, overlap means temporarily having A and B. For ten servers, replacing all ten simultaneously can still remove too much healthy capacity even if replacements are created first.

A rolling deployment divides the fleet into batches:

```text
old old old old old
        |
replace a bounded group
        v
new new old old old
        |
verify capacity and health
        v
new new new new old
        |
verify again
        v
new new new new new
```

The safety control is a minimum healthy capacity or maximum unavailable count. The rollout pauses when new members fail readiness rather than continuing until every healthy old member is gone. Warm-up time also matters because a newly started instance may pass an infrastructure check before it can sustain normal load.

Terraform can model each machine directly, but a provider's fleet controller is usually better at runtime orchestration. Auto Scaling Groups, Managed Instance Groups, Kubernetes Deployments, and similar controllers continually observe members and already understand batch replacement, health, retry, and capacity.

The responsibility split becomes:

```text
Terraform
    declares the fleet controller, template, capacity, and rollout policy

fleet controller
    performs the rolling replacement and reacts to member health

monitoring and release process
    evaluates user-facing success and decides to continue or stop
```

An apply can finish after configuring or initiating a provider-side rollout while the fleet is still converging. Operators must inspect the controller's status after Terraform returns. “Terraform completed” and “all new members are healthy” are distinct pieces of evidence.

Resource identity remains important inside a fleet. Treating instances as individually meaningful Terraform addresses can make routine rotation harder. When the domain cares about desired capacity and a launch template rather than one named VM, the fleet controller should own member identity. Terraform then manages the stable controller rather than every transient worker.

The chosen rollout threshold must reflect actual load. Keeping 80 percent healthy is safe only if that remaining capacity can carry traffic. Quotas must also allow temporary surge capacity if new and old members overlap. Health-check timing should be derived from observed startup behavior rather than guessed.

## Why Do State Identity and Boundaries Affect Deployments?
<!-- section-summary: State addresses determine what Terraform believes is being replaced, while state boundaries determine the risk and concurrency scope of an apply. -->

Terraform state associates a resource address with a remote object. A harmless-looking refactor can become a deployment if it changes that address. Renaming:

```hcl
resource "aws_instance" "app" {
  # ...
}
```

to:

```hcl
resource "aws_instance" "application" {
  # ...
}
```

changes `aws_instance.app` to `aws_instance.application`. Without migration information, Terraform may interpret that as the old object disappearing and a new object being declared. A `moved` block records the intended identity-preserving refactor:

```hcl
moved {
  from = aws_instance.app
  to   = aws_instance.application
}
```

The same risk appears when introducing `count`, changing `for_each` keys, moving a resource into a module, or reorganizing module addresses. Review the resulting plan as a deployment, not as a cosmetic code diff.

Import is also an identity operation. If an existing remote server should become `aws_instance.production`, import associates the real object with that address. The first plan after import is reconciliation: configuration must be aligned with reality before any replacement or rollout change is mixed into the work.

```bash
terraform import aws_instance.production i-0123456789abcdef0
terraform plan
```

State boundaries are deployment boundaries because one apply can affect everything in the selected state. A state containing network, database, fleet, load balancer, DNS, and observability resources gives one run a broad failure and locking domain. A small canary weight adjustment and a database replacement do not share the same risk profile.

Separating state can reduce blast radius and allow independent deployment cadence, but it introduces contracts between states. Outputs, remote-state reads, or another discovery mechanism must connect them. The right boundary groups resources that need coordinated lifecycle while separating components whose ownership, approval, and failure modes differ.

State protection and locking prevent concurrent writers from racing over the same ownership record. They do not make a large transition atomic. Backends, identities, variables, and state selection must all point at the intended environment before a deployment plan has meaning.

## What Makes Rollback Possible?
<!-- section-summary: Rollback is easiest while the old healthy generation still exists, because Terraform apply does not automatically undo completed operations. -->

Terraform apply is not a database transaction. It walks a dependency graph and performs remote operations. If an action fails midway, earlier successful actions may remain. A failed postcondition can stop downstream work, but it does not reverse everything Terraform already changed.

This changes the meaning of rollback. Application rollback often means routing traffic back to an old healthy generation. Infrastructure rollback usually means changing configuration again, producing a new plan, and applying another forward transition. Restoring an old Git commit does not by itself reverse cloud operations or data changes.

Rollback is easiest before destruction:

```text
blue healthy + green unhealthy
    -> keep or restore traffic to blue
    -> investigate or remove green
```

It becomes harder after blue is gone:

```text
green unhealthy + blue destroyed
    -> recreate old capacity
    -> wait for boot and readiness
    -> recover traffic under pressure
```

That is why an overlap window is also a rollback window. Keep the previous generation until the candidate has handled enough real traffic to justify retirement. Define the rejection metrics and the person or controller authorized to reverse traffic before the deployment begins.

Stateful resources are a different category. Two stateless application generations can often run side by side. Two databases are not interchangeable merely because both exist; data, writes, schema, authority, and replication must cross the transition correctly.

Database migration exposes the deeper problem. Old application code may need the old schema while new code needs a changed schema. Safe deployment can require expand-and-contract changes: add backward-compatible schema first, deploy code that works with both forms, migrate data, switch authority, then remove the old form later. Terraform can manage database infrastructure, but it does not make an incompatible schema transition reversible.

For critical stateful objects, `prevent_destroy` is a useful Terraform guardrail, not a recovery strategy. Backups, tested restore procedures, replication, provider protections, and application compatibility planning carry the actual rollback burden.

## How Do You Design the Complete Deployment?
<!-- section-summary: A complete design preserves healthy capacity by coordinating creation, readiness, traffic, state, observation, and retirement. -->

The complete model has several layers:

```text
desired configuration
        |
        v
Terraform graph and state identity
        |
        v
provider creates overlapping capacity
        |
        v
runtime controller proves readiness
        |
        v
traffic moves in controlled stages
        |
        v
monitoring accepts or rejects the release
        |
        v
old capacity drains and is retired
```

Terraform contributes most directly to desired configuration, addresses, dependency ordering, provider operations, and lifecycle policy. It can also configure health and traffic resources. Runtime controllers supply continuous readiness and fleet convergence. The release process supplies approval, observation windows, and rollback decisions.

![Zero-downtime deployment summary](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/zero-downtime-summary.png)

*Availability comes from the full transition, not from any single lifecycle setting.*

Use this hierarchy when choosing a pattern:

```text
single replaceable object
    require overlap and readiness

stable endpoint with replaceable backends
    add explicit traffic handoff

multiple interchangeable members
    use a rolling fleet controller and capacity threshold

high-risk release
    use blue/green or canary traffic stages with rollback window

stateful system
    add data migration, compatibility, backup, and authority planning
```

Before a production apply, verify:

```text
Which changes update in place, and which require replacement?
Can old and new resources coexist under names, quotas, and attachments?
What health signal means the application can serve real work?
Which component enforces that signal before traffic moves?
How much healthy capacity is required throughout the rollout?
Does the plan preserve intended resource addresses?
Do any refactors require moved blocks or imports first?
Is the selected state boundary appropriately narrow?
Can the old generation remain through an observation window?
Which signal triggers rollback, and how is traffic reversed?
Are database and other stateful migrations backward-compatible?
Who verifies runtime convergence after Terraform finishes?
```

The sequence should also have explicit observation points. Before creation, confirm that quotas and naming permit the overlap. After creation, inspect infrastructure status without moving traffic. After readiness passes, expose only the intended share of requests and compare the new generation with the established baseline. Before destruction, confirm that old connections have drained and that the rollback window has actually closed. These are different decisions, so one successful command should not silently authorize all of them.

Dependencies require the same care. A listener reference to a new target can ensure that the target object is created first, but that dependency says nothing about successful requests. A postcondition may block dependent Terraform work if its assertion fails, yet earlier provider operations remain completed. A runtime controller may declare a member healthy according to a shallow probe while user-visible latency is already unacceptable. Tie every signal to the claim it can actually support, and do not infer a stronger guarantee from it.

Finally, plan cleanup instead of treating it as an afterthought. Keeping every old generation forever avoids immediate destruction but consumes quota, preserves outdated software, and makes ownership confusing. Retirement is a real deployment phase: stop new traffic, allow in-flight work to finish, capture necessary evidence, remove old capacity, and verify that state describes the surviving generation. Safe rollback needs temporary redundancy; safe operations also need an intentional end to that redundancy.

The first-principles conclusion is straightforward: `create_before_destroy` offers overlap, not availability. Zero downtime requires overlap plus readiness, controlled traffic, sufficient capacity, correct state identity, observation, and a rollback path that still exists. When those pieces are explicit, Terraform becomes a reliable participant in deployment rather than being mistaken for the whole deployment system.

Availability depends on the provider's real replacement sequence, load-balancer behavior, quotas, health checks, and application compatibility—not the wording “zero downtime.” `create_before_destroy` can overlap old and new capacity only when names, addresses, quotas, and dependencies permit two copies. Review the plan for replacement actions, verify temporary capacity and mixed-version compatibility, and observe the service path during apply. When infrastructure cannot overlap safely, design a separate blue-green, rolling, or maintenance workflow rather than assuming a lifecycle setting removes disruption.

## Check Your Answers

:::expand[Why Is Availability About the Transition?]{kind="recap"}
Terraform defines desired end states, but users experience intermediate operations. Healthy service capacity must remain above the required level throughout the transition.
:::

:::expand[What Does Replacement Overlap Actually Guarantee?]{kind="recap"}
`create_before_destroy` lets old and new objects coexist when the platform permits it. It does not prove health, move traffic, or preserve enough usable capacity by itself.
:::

:::expand[How Do Readiness Checks Protect the Handoff?]{kind="recap"}
Readiness should represent the ability to serve real work. Interpret Terraform checks, postconditions, provider status, and load-balancer health according to what each can actually prove.
:::

:::expand[How Should Traffic Move Between Versions?]{kind="recap"}
A stable front door supports blue/green or canary movement. Prepare, verify, expose gradually, observe, drain, and only then retire the previous generation.
:::

:::expand[How Do Fleets Roll Out Changes Safely?]{kind="recap"}
A fleet controller replaces bounded batches while maintaining a healthy-capacity threshold. Terraform configures the controller, while runtime status proves convergence.
:::

:::expand[Why Do State Identity and Boundaries Affect Deployments?]{kind="recap"}
Address changes can cause unintended replacement, and one state defines the resources a run can affect. Use moves, isolated imports, locking, and risk-aware state boundaries.
:::

:::expand[What Makes Rollback Possible?]{kind="recap"}
Terraform does not automatically undo completed operations. Rollback is fastest while the old generation still exists, and stateful changes require separate data and compatibility plans.
:::

:::expand[How Do You Design the Complete Deployment?]{kind="recap"}
Coordinate Terraform's graph with overlap, runtime readiness, traffic control, sufficient capacity, observation, state hygiene, and an explicit rollback decision.
:::

---

**References**

- [Terraform: Resource behavior](https://developer.hashicorp.com/terraform/language/resources/behavior)
- [Terraform: Lifecycle meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
- [Terraform: Checks](https://developer.hashicorp.com/terraform/language/checks)
- [Terraform: Custom conditions](https://developer.hashicorp.com/terraform/language/expressions/custom-conditions)
- [Terraform: Refactor modules and resources](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [Terraform CLI: Import](https://developer.hashicorp.com/terraform/cli/commands/import)
- [Terraform: State](https://developer.hashicorp.com/terraform/language/state)
