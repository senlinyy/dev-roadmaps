---
title: "Policy as Code"
description: "Learn how versioned policy decisions, tested rules, enforcement points, contextual data, managed engines, exceptions, and failure behavior make security requirements repeatable."
overview: "Turn a review rule humans repeatedly forget into an executable decision. Separate policy decision from enforcement, choose the configuration, plan, identity, environment, and exception data rules need, write and test a small OPA rule, compare local and managed enforcement, and make exceptions, expiry, and fail-open or fail-closed behavior part of the system."
tags: ["devsecops", "policy-as-code", "opa", "sentinel"]
order: 2
id: article-devsecops-cloud-infrastructure-security-policy-as-code
---

## Table of Contents

1. [Why Turn Repeated Security Review into Code?](#why-turn-repeated-security-review-into-code)
2. [How Do Policy Decision and Enforcement Stay Separate?](#how-do-policy-decision-and-enforcement-stay-separate)
3. [What Data Should a Security Policy Evaluate?](#what-data-should-a-security-policy-evaluate)
4. [How Do You Write and Test a Small OPA Rule?](#how-do-you-write-and-test-a-small-opa-rule)
5. [Where Should Policy Run Across the Delivery Path?](#where-should-policy-run-across-the-delivery-path)
6. [How Do OPA and Managed Policy Engines Fit the Same Model?](#how-do-opa-and-managed-policy-engines-fit-the-same-model)
7. [How Should Exceptions and Failure Behavior Work?](#how-should-exceptions-and-failure-behavior-work)
8. [What Does a Complete Policy-as-Code System Look Like?](#what-does-a-complete-policy-as-code-system-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Imagine reviewers repeatedly ask the same question: “Does this Terraform plan expose a database to the Internet?” One reviewer notices an open ingress rule; another focuses on cost; a third assumes another tool will catch it. Human judgment remains valuable, but repetitive deterministic checks are easy to miss under time pressure.

**Policy as code** expresses the rule in a machine-evaluable form:

```text
if production database ingress includes 0.0.0.0/0
then deny the change
```

The rule can live in version control, receive review, run automatically, and produce the same result for equivalent input. Developers receive feedback before apply, and the organization can show which policy version made the decision.

Policy code does not eliminate security judgment. Humans still decide the desired rule, acceptable environments, approved identities, exceptions, and response to uncertainty. Code makes the chosen part repeatable.

Policy as code adds several properties:

- **Consistency:** the same input receives the same decision.
- **Speed:** evaluation can occur on every pull request or admission request.
- **Reviewability:** policy changes appear as code changes.
- **Testability:** examples can prove allow and deny behavior.
- **Evidence:** runs record input identity, policy version, result, and messages.
- **Distribution:** one policy package can serve local, CI, and runtime controls.

Keep these questions in view as you work through the lesson:

1. **Why Turn Repeated Security Review into Code?**
2. **How Do Policy Decision and Enforcement Stay Separate?**
3. **What Data Should a Security Policy Evaluate?**
4. **How Do You Write and Test a Small OPA Rule?**
5. **Where Should Policy Run Across the Delivery Path?**
6. **How Do OPA and Managed Policy Engines Fit the Same Model?**
7. **How Should Exceptions and Failure Behavior Work?**
8. **What Does a Complete Policy-as-Code System Look Like?**

## Why Turn Repeated Security Review into Code?
<!-- section-summary: Policy as code converts a recurring security decision into versioned, testable, reviewable logic that can evaluate every relevant change consistently. -->

Do not reduce the goal to “make CI green.” A useful rule explains the security property and consequence. “Public database ingress allows untrusted network paths” teaches more than `RULE-104 failed`.

Start with high-confidence requirements whose consequence is clear: no public administrative ports, no wildcard production IAM actions, encryption required for protected data, no unapproved registries, or no destructive production plan without extra approval. Expand only when ownership and response can support the signals.

Policy code itself becomes a security control. Protect who can change it, require review, and retain history. If a pull request can weaken the rule and infrastructure in the same unreviewed transition, automation has not created an independent boundary.

## How Do Policy Decision and Enforcement Stay Separate?
<!-- section-summary: A policy decision point evaluates inputs and returns allow, deny, or findings, while an enforcement point controls the real transition and decides what that result means operationally. -->

The most important architectural separation is between decision and enforcement.

The **Policy Decision Point**, or PDP, evaluates input and policy:

```text
input + policy + contextual data -> decision and reasons
```

The **Policy Enforcement Point**, or PEP, controls a transition such as merge, Terraform apply, API admission, or deployment. It asks the PDP for a decision and allows, blocks, warns, or invokes an exception path.

```text
change request
      |
      v
enforcement point -> policy decision point
      |                  |
      |             allow / deny + evidence
      v                  |
real transition <--------+
```

A policy engine that reports a denial in a dashboard but cannot stop production is a detection control. A CI job acts as a merge gate only if protected branch policy requires it. A Terraform policy acts as an apply control only if the apply system consumes and enforces the result.

The separation improves reuse. The same decision logic can evaluate a local plan for fast feedback, a pull-request plan in CI, and a managed run before apply. Each enforcement point can use environment-appropriate behavior while sharing the rule.

It also clarifies failure. If evaluation is unavailable, the enforcement point must decide whether to fail open, fail closed, use cached policy, or invoke break-glass. The policy language alone cannot decide infrastructure availability behavior.

Decision output should be structured: rule or policy identifier, object, message, severity or enforcement level, evidence, and policy version. A Boolean can control the gate but is weak for developer response and audit.

Evidence production and authorization should not collapse. A plan generator supplies input. The policy engine evaluates it. The protected apply path enforces the decision. Giving the proposed change complete control of all three lets it manufacture its own approval.

## What Data Should a Security Policy Evaluate?
<!-- section-summary: Useful policy combines the configuration or planned state with environment, change, identity, approved-list, and time-bounded exception data rather than reasoning from syntax alone. -->

Policy quality depends on input quality. A static rule can inspect Terraform HCL, Kubernetes YAML, or another declaration. A semantic rule can inspect a Terraform plan, resolved deployment request, or admission object that reveals computed changes.

Possible inputs include:

- Configuration and module metadata.
- Plan or change-set JSON with creates, updates, replacements, and deletes.
- Target environment, account, project, region, or namespace.
- Caller, repository, workflow, source revision, and approval context.
- Resource ownership and data classification.
- Approved registries, networks, regions, machine types, or identities.
- Existing resource state where the decision needs it.
- Structured exceptions with scope and expiry.

![Policy inputs map sends plan JSON, run context, approved lists, and exceptions into a decision engine](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-inputs-map.png)

_The rule is stable logic; contextual data tells it which environment, owner, approved set, and exception apply._

Configuration-level analysis gives early feedback but may not know computed values, module expansion, or current state. Plan analysis can reveal that a change replaces a database, opens an effective ingress rule, or grants an IAM action after expressions resolve. A plan is still a prediction based on credentials, provider behavior, and state at planning time.

Environment context matters. Public ingress may be acceptable for an intentional public load balancer and forbidden for a database. A development experiment and production data store may use different thresholds. Encode the environment deliberately rather than infer it from an editable resource name alone.

Identity context supports authorization policy. A destructive production change may require a protected workflow or additional approval. A policy should verify trusted identity claims supplied by the enforcement system rather than trust a caller-controlled string saying `environment=production-approved`.

Separate policy code from organizational data where possible. The rule can say “the region must belong to the approved production region set.” Data can list the current set. That avoids changing and retesting logic whenever an approved region changes, while data changes still receive ownership and review.

Do not feed secrets into the policy engine unnecessarily. Plans and configuration can contain sensitive values. Redact output, restrict artifacts and logs, and give the engine only data required for the decision.

## How Do You Write and Test a Small OPA Rule?
<!-- section-summary: An OPA rule turns structured input into explicit deny messages, and policy tests prove both unsafe rejection and safe acceptance before enforcement. -->

Open Policy Agent, or OPA, evaluates policies written in Rego against structured data. Suppose input contains planned resources with type, address, environment, and ingress CIDRs. A simplified rule can deny public production database ingress:

```rego
package devpolaris.infrastructure

import rego.v1

deny contains message if {
  resource := input.resources[_]
  resource.environment == "production"
  resource.type == "database"
  resource.ingress[_] == "0.0.0.0/0"
  message := sprintf("%s exposes a production database to the Internet", [resource.address])
}
```

The package names the policy namespace. `deny` returns one or more explanatory messages. The body selects a production database whose ingress contains the public IPv4 CIDR. The message names the affected object and consequence.

![OPA rule flow connects Terraform plan data to Rego denial, CI feedback, and the allow or block decision](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/opa-rule-flow.png)

_Policy evaluation should return an actionable reason, not only a generic failure._

Policy tests matter as much as policy. Test the unsafe case:

```rego
test_public_production_database_is_denied if {
  result := deny with input as {
    "resources": [{
      "address": "database.orders",
      "type": "database",
      "environment": "production",
      "ingress": ["0.0.0.0/0"]
    }]
  }

  count(result) == 1
}
```

Also test safe private ingress, a public load balancer, development context, IPv6 public ranges, missing fields, multiple resources, and a valid scoped exception. A rule tested only against its first deny example may block the wrong objects or miss near variants.

Tests preserve intent during refactoring. When plan schemas, modules, or organizational data change, failures show whether policy behavior changed. Treat policy-test review like application-test review.

Run policy locally so developers can inspect failures before pushing. CI remains necessary because protected enforcement should not depend on every workstation using the correct version and input.

Version the OPA binary or execution environment, policy bundle, input schema, and test fixtures. A policy decision is reproducible only when its evaluator and data are identified.

## Where Should Policy Run Across the Delivery Path?
<!-- section-summary: Policy should run early for feedback, at protected CI for merge and apply decisions, and again near runtime when alternate clients or drift could bypass earlier checks. -->

“Shift left” means earlier feedback, not only-left enforcement. A local check helps the author. A pull-request check protects the trusted branch. A managed apply check protects the real infrastructure change. Runtime admission or cloud configuration policy can protect paths outside CI.

```text
editor or local plan -> fast feedback
pull request          -> reviewed change gate
managed apply         -> final plan and identity gate
runtime admission     -> protect actual API transition
continuous audit      -> find drift and policy changes
```

Run the policy on the most semantic input available at each stage. Local source scanning can catch obvious public CIDRs. CI plan evaluation sees resolved resources and destructive transitions. An admission control sees the exact runtime object. Continuous evaluation sees current reality.

Do not assume an early pass covers later changes. The plan can become stale, a provider may compute values during apply, an administrator can mutate reality, or a different client can call the API. Re-evaluate where the security consequence becomes real.

Policy should run after merge for inventory and drift reasons even when pull requests are gated. New policy versions can discover historical violations. Separate blocking new changes from remediating existing state so old debt does not freeze all work.

Feedback must identify object, rule, consequence, and repair direction. Link to policy ownership and exception process. Developers should not need to decode raw engine output.

## How Do OPA and Managed Policy Engines Fit the Same Model?
<!-- section-summary: OPA and managed engines such as Sentinel differ in packaging and integration, but both evaluate structured input at a decision point that an external system must enforce. -->

OPA is a general-purpose policy engine that can run locally, in CI, as a service, or beside an admission controller. The organization owns its input mapping, policy distribution, enforcement integration, and operations.

Sentinel is a policy framework integrated with HashiCorp products and managed run workflows. It can evaluate plan and run context inside the platform's enforcement path. Integration can make final-run enforcement and policy levels easier to govern.

Think architecture, not syntax. Ask:

- What exact data does the policy receive?
- Where is the decision point?
- Which system enforces the result?
- Who can change policy, data, and enforcement?
- How are tests, versions, exceptions, and logs handled?
- What happens when evaluation is unavailable?

An elegant rule language does not create security if the apply path ignores it. A managed enforcement mode does not create good policy if rules are noisy, untested, or based on untrusted inputs.

Teams may use different engines at different boundaries while sharing policy intent. Avoid inconsistent copies whose behavior drifts. Define authoritative requirements and test equivalent decisions with common fixtures where multiple implementations are necessary.

## How Should Exceptions and Failure Behavior Work?
<!-- section-summary: Exceptions are structured, narrow, owned, and expiring policy data, while fail-open or fail-closed behavior is an explicit risk decision for each enforcement boundary. -->

Exceptions are part of the policy system, not comments that disable it. A legitimate temporary public endpoint or migration may violate the ordinary rule. The exception should record:

```text
policy and resource scope
environment
technical reason
owner and approver
compensating controls
created and expiry times
tracking record
```

Avoid broad scanner ignores or `allow_all=true`. Scope to the exact object and rule. An exception for one load balancer should not authorize public databases.

Expiry is the key control. Context changes and temporary projects persist. On expiry, enforcement should deny, warn and escalate, or require an explicit current renewal according to the boundary. Silent permanent renewal defeats review.

Keep policy code and exception data separate where practical. A one-off exception should not require editing the rule to add a resource name. Data changes still need review and audit.

**Fail closed** blocks the transition when policy cannot evaluate. This protects high-consequence boundaries but can reduce availability. **Fail open** allows the transition and records the failure. This may fit low-risk feedback, but an attacker can target policy availability if outage becomes bypass.

Choose per enforcement point. Local feedback can fail open with a clear warning. Production admission or destructive apply may fail closed with a narrow audited break-glass path. Cached policy can improve resilience when bundle identity and freshness are controlled.

Monitor exceptions and evaluation health: expired records, repeated fail-open events, policy bundle download failures, untested changes, manual bypass, and rules with overwhelming false positives.

## What Does a Complete Policy-as-Code System Look Like?
<!-- section-summary: A complete system versions requirements and data, tests decisions, distributes identified bundles, evaluates trusted inputs, enforces at real transitions, records evidence, and reviews exceptions and control health. -->

The full flow is:

```text
security requirement
  -> versioned policy and organizational data
  -> allow, deny, edge, and exception tests
  -> identified policy bundle
  -> local feedback
  -> pull-request plan evaluation
  -> protected merge or apply enforcement
  -> runtime and continuous evaluation
  -> evidence, exceptions, and policy improvement
```

![Policy-as-code summary connects authoring, tests, local checks, CI, managed enforcement, exception expiry, and evidence review](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-as-code-summary.png)

_Tested decisions reaching protected enforcement points turn policy into a system and their exceptions and failures remain observable._

Protect three authority paths: who changes policy logic, who changes organizational data or exceptions, and who can bypass enforcement. Log all three.

Record policy decision evidence: input object and digest where possible, environment, caller identity, policy bundle version, external data version, messages, decision, enforcement action, exception, and time. Avoid retaining sensitive plan data unnecessarily.

Review policy health. High deny counts can reveal widespread risk or a bad rule. Repeated exceptions can show the standard does not fit architecture. Repeated false positives can indicate missing context. A policy nobody can satisfy will eventually be bypassed.

The core mental model is:

```text
policy = repeatable decision logic
PDP    = evaluates trusted input
PEP    = controls the real transition
tests  = preserve intended decisions
data   = supplies current organizational context
exception = bounded alternate decision
evidence  = proves what rule and action applied
```

Policy deployment needs a controlled promotion path. A rule change can begin in test mode against recorded plans, run in warning mode on live pull requests, and then become mandatory after owners review expected denials. Preserve the bundle digest promoted to each enforcement point so local, CI, and managed apply do not silently evaluate different logic.

Use test fixtures from real sanitized failures. They capture nested resource shapes, computed values, deletions, replacements, and environment context that toy examples miss. Keep one fixture for every past policy escape or false positive so the control becomes more accurate over time.

Decisions should remain explainable to both developer and reviewer. Return the exact resource and risky transition, the requirement, the evaluated contextual fact, and the expected correction. A message such as “database.orders would gain public ingress in production” is more actionable than a generic deny and makes exception review more precise.

Finally, test enforcement itself. Present a denied plan and confirm merge or apply cannot proceed through ordinary identities. Simulate policy unavailability and observe the designed fail behavior. Use one expired exception and confirm it no longer authorizes. A correct rule that is never enforced is only documentation.

Review the audit trail after each exercise. It should identify the caller, input, bundle, exception state, decision, enforcement action, and time without exposing sensitive plan values. Missing fields become concrete work for the policy platform owner.

Repeat the exercise after repairs and preserve the successful evidence chain.

Keep that evidence with the policy bundle and enforcement configuration used during the test.

Review it with policy authors, enforcement owners, and the teams whose changes were evaluated so the result is understandable outside the security platform team.

Then use that shared review to improve the next tested policy release.

## Check Your Answers

:::expand[Why Turn Repeated Security Review into Code?]{kind="recap"}
Encode high-confidence recurring decisions as versioned, testable logic while humans remain responsible for policy intent and context.
:::

:::expand[How Do Policy Decision and Enforcement Stay Separate?]{kind="recap"}
The decision point returns a reasoned result; the enforcement point uses it to allow, block, warn, or invoke a controlled exception.
:::

:::expand[What Data Should a Security Policy Evaluate?]{kind="recap"}
Combine configuration or plan semantics with trusted environment, identity, ownership, approved-list, and exception context.
:::

:::expand[How Do You Write and Test a Small OPA Rule?]{kind="recap"}
Return actionable deny messages and test unsafe, safe, edge, malformed, and excepted inputs before relying on the rule.
:::

:::expand[Where Should Policy Run Across the Delivery Path?]{kind="recap"}
Run early for feedback and again at protected apply, admission, and continuous evaluation where the real state transition or drift occurs.
:::

:::expand[How Do OPA and Managed Policy Engines Fit the Same Model?]{kind="recap"}
Compare engines by input, decision, enforcement, governance, tests, evidence, and failure behavior rather than syntax alone.
:::

:::expand[How Should Exceptions and Failure Behavior Work?]{kind="recap"}
Use exact, approved, expiring exception data and explicitly choose fail-open, fail-closed, cache, and break-glass behavior for each boundary.
:::

:::expand[What Does a Complete Policy-as-Code System Look Like?]{kind="recap"}
Connect reviewed policy and data, tests, identified bundles, trusted inputs, real enforcement, evidence, exceptions, and continuous improvement.
:::

## References

- [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest/) - Defines OPA policy evaluation architecture and Rego.
- [OPA policy testing](https://www.openpolicyagent.org/docs/latest/policy-testing/) - Documents rule tests and coverage.
- [Terraform Sentinel](https://developer.hashicorp.com/sentinel/docs) - Describes managed policy evaluation and enforcement levels.
- [Terraform plan JSON format](https://developer.hashicorp.com/terraform/internals/json-format) - Defines structured plan input for policy analysis.
