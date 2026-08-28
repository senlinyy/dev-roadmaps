---
title: "Policy as Code"
description: "Learn how Terraform policy evaluates plan outcomes, blocks protected changes, handles unknowns and exceptions, and authorizes an exact apply."
overview: "Source review alone cannot reliably reveal a Terraform plan's final resources or state transition. This article converts plan JSON into policy input, builds outcome-oriented OPA rules for tags and deletion, and explains enforcement levels, testing, exceptions, layered controls, and the authorization boundary before apply."
tags: ["terraform", "policy-as-code", "opa", "plan-json", "governance"]
order: 3
id: article-iac-terraform-automation-policy
---

## Table of Contents

1. [Why Is Terraform Source Alone a Weak Policy Input?](#why-is-terraform-source-alone-a-weak-policy-input)
2. [How Does a Plan Become Policy Data?](#how-does-a-plan-become-policy-data)
3. [How Can OPA Report Useful Violations?](#how-can-opa-report-useful-violations)
4. [How Should Policy Handle Deletes, Replacements, and Unknowns?](#how-should-policy-handle-deletes-replacements-and-unknowns)
5. [Where Should Policy Sit in the Pipeline?](#where-should-policy-sit-in-the-pipeline)
6. [How Do You Test Rules and Manage Exceptions?](#how-do-you-test-rules-and-manage-exceptions)
7. [Which Rules Belong in Which Enforcement Layer?](#which-rules-belong-in-which-enforcement-layer)
8. [How Does Policy Become Deployment Authorization?](#how-does-policy-become-deployment-authorization)
9. [Check Your Answers](#check-your-answers)

Infrastructure automation can propose hundreds of changes in seconds. Human review remains essential, but repetitive or organization-wide rules should not depend on every reviewer spotting the same missing tag, public exposure, or protected deletion in every long plan.

Suppose an organization requires every production resource to include `Owner`, `Environment`, and `CostCenter` tags. A direct resource may be easy to read:

```hcl
resource "aws_s3_bucket" "data" {
  bucket = "company-production-data"

  tags = {
    Environment = "prod"
  }
}
```

But real configurations compute tags:

```hcl
locals {
  standard_tags = {
    Owner       = var.team
    Environment = var.environment
    CostCenter  = var.cost_center
  }
}

resource "aws_s3_bucket" "data" {
  bucket = var.bucket_name
  tags   = merge(local.standard_tags, var.extra_tags)
}
```

The source spans variables, locals, modules, loops, and conditional branches. A text scanner must partially reimplement Terraform evaluation to know which resources exist and what their final tags are. It can also miss values returned by modules or computed by provider-aware planning.

Keep these questions in view as you work through the lesson:

1. **Why Is Terraform Source Alone a Weak Policy Input?**
2. **How Does a Plan Become Policy Data?**
3. **How Can OPA Report Useful Violations?**
4. **How Should Policy Handle Deletes, Replacements, and Unknowns?**
5. **Where Should Policy Sit in the Pipeline?**
6. **How Do You Test Rules and Manage Exceptions?**
7. **Which Rules Belong in Which Enforcement Layer?**
8. **How Does Policy Become Deployment Authorization?**

## Why Is Terraform Source Alone a Weak Policy Input?
<!-- section-summary: Modules, expressions, variables, and provider values make final infrastructure hard to infer reliably from source text alone. -->

The plan is a better policy boundary because Terraform has already evaluated much of the language against a specific target. It represents a proposed state transition:

```text
current state + configuration + variables + provider information
                              |
                              v
                    proposed actions and values
```

Policy asks questions about the outcome:

```text
Will every governed resource have required tags?
Does this transition delete or replace protected infrastructure?
Does it create public access?
How many resources or regions can one change affect?
```

Outcome policy is usually more stable than source-style policy. Teams can implement the same result through locals, module outputs, or direct arguments without rewriting the rule.

Source checks still have a place. A linter can reject forbidden syntax or provider versions before planning. The important distinction is that source rules reason about how configuration is written, while plan policy reasons about what Terraform proposes to make true.

Modules make this distinction concrete. A root may call a shared module with `team = "payments"`, while the child merges that value into tags on several resources. A source scanner looking only at the root does not see the resource blocks; one looking only at the child does not know the concrete team. Terraform evaluation connects the two, and the planned `after` values expose the result.

Loops add another layer. One `for_each` block can create several addressed instances, and a conditional filter can remove some of them. Policy usually needs to judge each expanded instance rather than the one source block. Plan changes provide addresses such as `aws_s3_bucket.data["archive"]`, which makes a denial precise.

Source-level policy is appropriate when implementation itself is the governed concern. An organization may prohibit unversioned module sources or require a provider constraint. Those facts are easier to inspect before planning. Do not force every rule onto plan JSON; choose the representation that actually contains the fact.

The rule humans keep missing is often not complex. The difficulty is scale and repetition. A reviewer may correctly inspect 99 resources and overlook the hundredth. Policy applies the same calculation to every governed change and frees human attention for relationships the rule cannot encode.

## How Does a Plan Become Policy Data?
<!-- section-summary: Terraform renders a saved plan as JSON so a policy engine can inspect resource addresses, action lists, and before-and-after values. -->

Create a saved plan and render it as JSON:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
```

The JSON contains planned values and resource changes. A simplified change resembles:

```json
{
  "address": "aws_instance.app",
  "type": "aws_instance",
  "change": {
    "actions": ["update"],
    "before": {
      "tags": {
        "Owner": "payments"
      }
    },
    "after": {
      "tags": {
        "Owner": "payments",
        "Environment": "prod"
      }
    }
  }
}
```

Policy can inspect `address` for an explainable diagnostic, `type` to scope resource families, `actions` to recognize create, update, delete, no-op, or replacement, and `after` to reason about the proposed object.

This transforms policy evaluation into ordinary data processing:

```text
Terraform configuration
    -> saved plan
    -> JSON representation
    -> policy engine
    -> violations, warnings, or pass
```

OPA with Rego is one implementation. Sentinel and other policy systems can occupy the same conceptual role. The choice of engine matters less than the invariant that it evaluates the exact proposal intended for deployment.

Plan JSON can contain sensitive data even when terminal output redacts it. Restrict access, avoid publishing raw JSON in logs, and retain it only as long as policy, approval, and audit require. The policy engine and its logs join the sensitive artifact boundary.

The plan also contains unknown values. Some provider-generated IDs or computed attributes do not exist until apply. Policy input is therefore richer than final JSON state but not always complete. Rules must define what unknown means rather than treating absence as proof of compliance.

Plan JSON distinguishes the proposed `after` structure from metadata indicating which paths remain unknown. A missing concrete value can mean the attribute is absent, null, or unknown; those cases have different policy meaning. Reusable helpers should normalize that representation so every rule does not invent inconsistent unknown handling.

The policy engine may benefit from a smaller normalized document rather than unrestricted raw input. A trusted preparation step can extract resource address, provider type, actions, selected tags, environment, and unknown markers. The transformation itself then becomes security-sensitive code and needs tests that prove it does not omit governed changes.

Policy context can also arrive outside Terraform. Repository ownership, deployment environment, change ticket, requested exception, or business classification may not appear in plan JSON. Bind that context to the same plan identity and validate its source. A pull-request author should not be able to declare a resource noncritical merely by adding an untrusted label.

Plans can be large. Policy should evaluate all relevant changes deterministically and produce bounded, readable diagnostics. Truncating after a few violations may improve the interface, but the report should say that additional failures exist so the developer does not assume the visible list is complete.

## How Can OPA Report Useful Violations?
<!-- section-summary: A policy should collect concrete violations with resource addresses and actionable reasons instead of returning an unexplained boolean. -->

A useful policy model produces a collection of violations. Deployment is allowed when the collection is empty:

```text
violations = []
    -> allowed

violations = [message, ...]
    -> denied or requires controlled override
```

A simplified Rego rule for required tags can be written as:

```rego
package terraform.tags

required_tags := {"Owner", "Environment", "CostCenter"}

violation contains message if {
  change := input.resource_changes[_]
  change.change.actions != ["delete"]

  tags := object.get(change.change.after, "tags", {})
  missing := required_tags - {key | tags[key]}
  count(missing) > 0

  message := sprintf(
    "%s is missing required tags: %v",
    [change.address, sort([tag | tag := missing[_]])]
  )
}
```

The exact Rego syntax depends on the OPA version and policy conventions, but the logic is durable: iterate planned changes, select governed resources and actions, inspect the proposed `after` value, calculate missing keys, and return an address-specific message.

Checking `after` is important. Terraform may merge tags from locals or modules, so the final planned object can comply even when no literal tag block appears beside the resource. Conversely, an override can remove a required tag even when standard tags exist elsewhere in source.

Policy scope should be explicit. Not every resource type supports tags, and providers use different tag fields. Maintain a governed type set or normalized policy input rather than assuming every change has identical attributes.

Messages should tell the developer how to fix the problem:

```text
aws_s3_bucket.data is missing required tags: [CostCenter Owner]
```

An unexplained “policy failed” forces the author to inspect policy implementation. A good denial identifies address, rule, observed value, expected outcome, and where to request a documented exception if necessary.

An explicit `allowed` decision can be derived from the violation collection:

```rego
default allowed := false

allowed if {
  count(violation) == 0
}
```

The collection is more useful than the boolean because CI can render every actionable failure in one run. The boolean remains useful as the machine gate.

Rules should avoid assuming every `after` object is complete. Deletes may have no proposed after value. No-op resources may be omitted from `resource_changes` depending on the representation being inspected. Imported or moved addresses can have special transition behavior. Select the relevant actions first, then safely retrieve the fields the rule needs.

Required-tag policy can be scoped to creates and updates, while a separate delete rule handles destructive transitions. Combining unrelated reasoning into one rule makes messages vague and tests harder to enumerate. Small rules can feed one overall decision.

Normalize tag keys only if the organization has explicitly chosen case-insensitive semantics. Cloud platforms and downstream systems may treat `Owner`, `owner`, and `OWNER` differently. A policy that silently lowercases them could approve data that cost reports or IAM conditions will not recognize.

## How Should Policy Handle Deletes, Replacements, and Unknowns?
<!-- section-summary: Action arrays reveal destruction and replacement, while unknown values require an explicit fail, defer, or conditional-review strategy. -->

Destruction is especially valuable to inspect because the same `delete` action has different consequences for a temporary VM and a production customer database.

Terraform represents a simple deletion with an action list containing `"delete"`. A normal replacement commonly appears as both delete and create actions, so policy must not look only for exactly `["delete"]`.

A protected-delete rule can ask:

```text
Does actions contain delete?
Is the resource classified as critical or production?
Is an approved, unexpired exception attached?
```

The classification might come from resource type, address, tags such as `Protection = "critical"`, or external inventory. Outcome-oriented data is preferable to brittle filename assumptions.

Policy protection differs from `lifecycle.prevent_destroy`. The lifecycle rule sits inside the resource configuration and makes Terraform reject a destroy while it remains present. An organization policy runs outside the code it governs and can reject deletion even if a pull request removes the lifecycle block.

```text
prevent_destroy
    local resource guardrail maintained with the resource

external policy
    independent organization rule over the proposed plan
```

Both can be useful. Provider deletion protection and backups add further layers. No policy restores deleted data.

Unknown proposed values require a conscious semantic. Suppose encryption must use an approved key, but the key ID is unknown until apply. The policy can:

```text
fail closed
    reject because compliance cannot be proven

defer
    require a later control or post-apply verification

allow under constrained evidence
    accept a trusted module or relationship that establishes the outcome
```

Critical policies should not treat unknown as equivalent to an approved value. Lower-risk advisory rules may report uncertainty for human review. The decision should be documented and tested.

Blast radius rules can count creates, deletes, replacements, accounts, regions, or critical types. A plan changing too many protected resources can require a higher approval level even if each individual change is otherwise allowed.

Replacement ordering can vary, but its action set still means the old object will be removed. `create_before_destroy` may reduce downtime; it does not make deletion harmless. A protected database replacement can lose data or change an endpoint even if a new instance is created first. Policy should classify the outcome according to resource semantics, not assume create-plus-delete is safer than delete alone.

Deletion classification should be resilient. Tags in `before` may be the only classification available for a delete because there is no `after` object. A rule that checks only proposed tags can miss the exact protected object being removed. For replacement, policy may need both before and after to detect that critical classification was removed along with the old object.

Unknown handling can be per attribute. An unknown generated resource ID may be harmless for a tagging rule, while an unknown encryption-key reference is central to compliance. Do not reject a whole plan merely because some unrelated provider field is computed; inspect whether the governed proposition can be established.

Deferral needs a real later gate. Marking encryption “verify after apply” without an enforced post-apply check turns uncertainty into silent approval. Record the obligation, prevent promotion until verification succeeds where the risk requires it, and make failure trigger a defined recovery response.

## Where Should Policy Sit in the Pipeline?
<!-- section-summary: Policy belongs after the target-aware saved plan and before approval and exact apply so passing policy is a prerequisite for write authority. -->

The strongest sequence is:

```text
reviewed configuration
    -> verify target
    -> terraform plan -out=tfplan
    -> render plan JSON
    -> evaluate policy
    -> approval or controlled override
    -> terraform apply tfplan
```

Policy that checks source before planning cannot see the final transition. Policy that runs after apply reports a violation too late. Running it between saved plan and exact apply creates a useful invariant:

```text
apply is reachable only if policy(the exact plan) passed
```

Applying the exact saved artifact matters. If the apply job recalculates a new plan, the policy result belongs to the earlier proposal, not the new one. The binary plan, policy report, and approval should share an artifact identity or checksum.

Policy belongs outside the governed configuration when separation of duties matters. A repository author should not be able to delete the rule in the same change that violates it. Central pipeline controls, protected policy bundles, or managed policy systems create that independence.

Not every rule needs hard enforcement. Common levels include:

```text
advisory
    report but do not block

soft mandatory
    block unless an authorized override is recorded

hard mandatory
    block without ordinary override
```

Use severity according to consequence and confidence. A naming preference may be advisory. Public exposure or critical deletion may be mandatory. Making every preference a hard gate produces noise and encourages broad bypasses.

Policy versions are deployment dependencies. Record which bundle evaluated the plan. A later policy update should not retroactively imply that an earlier plan passed the new rule set.

Soft and hard enforcement need protected ownership. If a repository can change its own rule level from hard to advisory, the gate is only documentation. Keep central policy and enforcement configuration under a separate review boundary when independence is a goal.

Advisory findings should remain visible and measurable. A warning that appears on every run without ownership becomes background noise. Track recurring advisories, decide whether to fix, formalize an exception, strengthen the rule, or remove it. Policy quality includes the signal-to-noise ratio experienced by developers.

The pipeline should fail safely if policy evaluation itself crashes, times out, or cannot load its trusted bundle. For mandatory production rules, “engine unavailable” cannot mean “allowed.” Advisory-only systems may choose a different availability tradeoff, but the behavior should be explicit.

Policy evaluation must happen under a reproducible engine and bundle version. Pin the OPA or Sentinel runtime where applicable, verify bundle integrity, and include engine diagnostics without dumping sensitive input. A policy result that cannot be reproduced is weak deployment evidence.

## How Do You Test Rules and Manage Exceptions?
<!-- section-summary: Policy is production code that needs positive, negative, unknown, replacement, and exception tests using small synthetic plan fixtures. -->

Policy can block every infrastructure deployment, so it needs the same engineering discipline as application code:

```text
version control
code review
unit tests
release process
observability
rollback or bundle pinning
clear ownership
```

Test rules with minimal synthetic plan inputs. A required-tag suite should include:

```text
all tags present -> passes
one tag missing -> violation names address and key
resource type outside scope -> ignored
delete-only action -> handled according to rule
unknown tags -> chosen uncertainty behavior
```

Deletion policy tests should include create, update, delete, and replacement action arrays. Test both critical and noncritical resources. Negative inputs are essential: a suite that only proves compliant fixtures pass can contain a rule that never fires.

Exceptions are unavoidable. Emergency repair, migration, provider limitation, or a legacy system may require a temporary deviation. The unsafe pattern comments out the policy or adds an unconditional address bypass.

An exception should be data:

```text
rule ID
exact resource or narrow scope
reason
owner
approver
ticket or change reference
creation time
expiry time
```

The policy evaluates that record. A narrow exception permits only the intended violation, and expiry prevents temporary risk from becoming permanent by neglect. Denials should link to the exception process without making bypass easier than compliance.

Test exceptions too: valid scoped exception passes, wrong resource fails, wrong rule fails, expired exception fails, missing approval fails. Audit overrides and review them after use.

Synthetic fixtures should stay small enough that a failed test points to one semantic. A replacement fixture needs only the action array, protected classification, and address fields used by the rule. Full production plans are valuable regression fixtures for parser coverage but are harder to understand and can contain secrets.

Property-focused tests can check invariants across several inputs: adding an unrelated compliant resource must not erase another violation; reordering changes must not change the decision; narrowing an exception must never broaden access. These protect the policy composition, not just individual examples.

Exceptions should not be encoded as comments such as `# temporarily disabled`. Comments have no enforced expiry or approval semantics. A structured record lets the policy compare current time, exact address patterns, rule identifiers, and approver authority.

Wildcards should be rare and constrained. An exception for `module.database.*` may cover future resources that did not exist when it was approved. Prefer one immutable resource address or a narrow typed selector with a short expiry. If a wider migration exception is necessary, require higher approval and record the expected blast radius.

After expiry, the next plan should fail normally. Do not auto-renew because the violating system still exists. Renewal is a new risk decision with updated context and owner confirmation.

## Which Rules Belong in Which Enforcement Layer?
<!-- section-summary: Local validation, module conditions, plan policy, cloud controls, and runtime checks enforce different scopes and should reinforce rather than imitate one another. -->

Some rules belong directly in Terraform. Variable validation can reject unsupported environment names. A resource precondition can enforce a module assumption. `prevent_destroy` can guard a critical resource for every caller. These controls provide immediate, contextual feedback.

Cross-repository or separation-of-duty rules belong in external policy. “Every production database deletion requires platform approval” should not depend on every module author preserving the same block. Policy can evaluate all stacks through one governed pipeline.

Cloud controls constrain reality even if Terraform and policy are bypassed. IAM denies, organization policies, service control policies, network boundaries, deletion protection, and quotas act at the API layer. Policy evaluates proposals; cloud controls authorize actual calls.

Runtime controls observe properties a plan cannot prove: health, latency, data correctness, and successful traffic. Post-apply verification closes that gap.

```text
variable validation
    caller input contract

module preconditions and lifecycle
    local resource invariants

static analysis
    known source and provider patterns

plan policy
    organization rules over proposed outcomes

cloud authorization and guardrails
    constraints on actual API operations

runtime verification
    behavior after change
```

Avoid duplicating every rule in every layer. Use complementary defense for high-consequence outcomes and place the clearest feedback as early as possible. If a module can cheaply reject an invalid input, do so; the organization policy can still defend against modules that omit the local condition.

Plan and policy artifacts remain sensitive. Give the policy engine only the access it requires, avoid logging full input on failure, and redact diagnostic values while preserving useful resource addresses and rule explanations.

Layering prevents one control from carrying an impossible burden. A Terraform validation can reject an invalid environment before a plan exists. Plan policy can reject a proposed public bucket. An organization-level cloud policy can deny the API even if somebody runs Terraform outside CI. A runtime scanner can find an exposure introduced through another tool. Each layer sees a different representation and failure path.

The layers also differ in feedback quality. A variable error points directly to the caller. A policy denial points to the planned address and organization rule. A cloud API denial may arrive late with provider-specific text. Put common mistakes in the earliest trustworthy layer while retaining downstream constraints for bypass resistance.

Some implementation restrictions are justified. Requiring a reviewed encryption module can centralize key configuration and support. The policy should state the outcome that module use guarantees and handle version or migration requirements explicitly. Otherwise “must use module X” can freeze architecture without explaining the risk.

Cloud controls and policy can disagree during rollout. A new policy may approve an action that an older organization policy still denies, or vice versa. Treat both rule sets as deployed systems, coordinate changes, and test with the actual target account before assuming the pipeline decision predicts API authorization.

## How Does Policy Become Deployment Authorization?
<!-- section-summary: Policy converts an exact proposal and organizational context into an allow, deny, or escalation decision before protected credentials can execute it. -->

Policy evaluation is a form of authorization. The question is not only whether configuration is valid; it is whether this proposed change may proceed under the organization's rules and current context.

The decision can include:

```text
subject
    repository, team, workflow, requester

action
    create, update, replace, delete

resource
    type, address, environment, classification

context
    account, region, time, approvals, exception, blast radius
```

Outcome rules should dominate implementation-style rules. “Production storage must not be public” survives changes in module structure. “All buckets must come from module X” constrains implementation and should be used only when that module restriction intentionally supplies audited security, support, or ownership guarantees.

A complete flow is:

```text
Terraform produces exact saved plan
    -> plan JSON enters protected policy engine
    -> rules produce explainable violations and risk level
    -> approved exceptions are evaluated as scoped data
    -> mandatory violations block
    -> advisory findings remain visible
    -> required reviewer accepts the exact artifact
    -> protected job obtains short-lived apply identity
    -> exact plan is applied
    -> cloud controls still authorize each API call
    -> runtime verification checks the result
```

The core invariants are:

```text
Policy evaluates the intended target and exact plan.
Unknown values receive explicit semantics.
Deletes and replacements are both recognized.
Denials explain the address, rule, and fix.
Exceptions are narrow, approved, auditable, and expiring.
Policy code and bundles are reviewed and tested.
The applied artifact is the policy-approved artifact.
Cloud and runtime controls remain necessary after policy passes.
```

Policy as code does not replace judgment. It makes repeated organizational judgment executable, consistent, reviewable, and hard to bypass silently. Humans can then spend attention on architecture and unusual risk rather than rediscovering the same missing rule in every plan.

Blast-radius reasoning can drive escalation rather than a binary deny. A routine create in one development account may need no human approval. Replacing one production service may need its owner. Deleting several critical resources across regions may require platform and security approval. The same rule engine can calculate that risk tier from plan actions and trusted context.

Decision logs should retain the rule bundle, input-plan checksum, violations, advisories, exceptions, and approvers without retaining raw sensitive JSON longer than necessary. This lets an auditor reconstruct why write authority became available while honoring data-minimization requirements.

Policy owners should review outcomes after incidents and near misses. If the rule approved a dangerous proposal, determine whether the input lacked the needed fact, unknown semantics were too permissive, classification was untrusted, or the rule encoded implementation instead of outcome. Improve the smallest relevant layer and add a failing fixture before changing production enforcement.

The mature result is not the largest possible rule set. It is a small, well-tested set of high-signal decisions placed at the right boundary, supported by clear local validation, strong cloud authorization, and runtime evidence. Such policy earns trust because developers can predict it, reviewers can explain it, and exceptions leave a narrow trail instead of a permanent hole.

## Check Your Answers

:::expand[Why Is Terraform Source Alone a Weak Policy Input?]{kind="recap"}
Modules and expressions hide final outcomes from text scanning. A target-aware plan represents the proposed transition that policy usually needs to govern.
:::

:::expand[How Does a Plan Become Policy Data?]{kind="recap"}
Save the plan and render JSON containing addresses, actions, before-and-after values, and unknowns. Protect that representation as a sensitive artifact.
:::

:::expand[How Can OPA Report Useful Violations?]{kind="recap"}
Collect address-specific violations over proposed values and governed types. Explain the missing requirement and how to fix or request a controlled exception.
:::

:::expand[How Should Policy Handle Deletes, Replacements, and Unknowns?]{kind="recap"}
Inspect action arrays for any delete, including replacement, and define whether unknown compliance values fail, defer, or require constrained evidence.
:::

:::expand[Where Should Policy Sit in the Pipeline?]{kind="recap"}
Evaluate the exact target-aware saved plan before approval and protected apply, then execute that same artifact rather than calculating an unchecked decision.
:::

:::expand[How Do You Test Rules and Manage Exceptions?]{kind="recap"}
Test passing and failing synthetic plans, uncertainty, replacements, and expiry. Represent exceptions as narrow, approved, auditable data.
:::

:::expand[Which Rules Belong in Which Enforcement Layer?]{kind="recap"}
Use local validation for module contracts, plan policy for organization outcomes, cloud controls for API reality, and runtime checks for operational behavior.
:::

:::expand[How Does Policy Become Deployment Authorization?]{kind="recap"}
Policy decides whether an exact proposal may reach write authority, considering subject, actions, resources, environment, blast radius, and approved exceptions.
:::

---

**References**

- [Terraform: JSON output format](https://developer.hashicorp.com/terraform/internals/json-format)
- [Terraform CLI: show](https://developer.hashicorp.com/terraform/cli/commands/show)
- [OPA: Terraform policy tutorial](https://www.openpolicyagent.org/docs/terraform)
- [OPA: Policy testing](https://www.openpolicyagent.org/docs/policy-testing)
- [Terraform: Lifecycle `prevent_destroy`](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
- [HCP Terraform: Sentinel policies](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement/sentinel)
- [HCP Terraform: OPA policies](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement/opa)
- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
