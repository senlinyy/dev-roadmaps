---
title: "Testing Terraform"
description: "Learn how formatting, validation, Terraform tests, mocking, linting, plans, conditions, and integration tests answer different infrastructure questions."
overview: "Infrastructure testing is a ladder of evidence. Cheap checks catch source and contract mistakes; provider-aware tools and plans add context; integration tests answer the cloud-only questions that mocks cannot. This article shows how to choose the smallest check strong enough for each risk."
tags: ["terraform", "testing", "terraform-test", "linting", "integration-tests"]
order: 1
id: article-iac-terraform-automation-testing
---

## Table of Contents

1. [What Does It Mean to Test Terraform?](#what-does-it-mean-to-test-terraform)
2. [Which Cheap Checks Should Run First?](#which-cheap-checks-should-run-first)
3. [How Do Terraform Tests Check a Module Contract?](#how-do-terraform-tests-check-a-module-contract)
4. [What Do Mocks Prove and Hide?](#what-do-mocks-prove-and-hide)
5. [How Do Validation and Provider-Aware Linting Differ?](#how-do-validation-and-provider-aware-linting-differ)
6. [Why Is Plan Review a Form of Testing?](#why-is-plan-review-a-form-of-testing)
7. [When Do You Need Real Infrastructure?](#when-do-you-need-real-infrastructure)
8. [How Do You Build a Terraform Testing Strategy?](#how-do-you-build-a-terraform-testing-strategy)
9. [Check Your Answers](#check-your-answers)

Terraform testing does not have one universal target. Configuration can parse correctly while encoding the wrong retention rule. A mock can prove expression logic while hiding an invalid cloud service value. A plan can show what Terraform intends to do without proving the new application will work after the API calls complete.

Consider a small log-retention rule:

```hcl
variable "environment" {
  type = string
}

locals {
  retention_days = var.environment == "prod" ? 30 : 7
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/app/${var.environment}"
  retention_in_days = local.retention_days
}
```

The configuration can be valid HCL and use a real provider argument while still implementing the business rule backward. If the intended rule was production 7 days and development 30 days—or more plausibly production 30 and development 7—the parser cannot choose the team's intent.

Keep these questions in view as you work through the lesson:

1. **What Does It Mean to Test Terraform?**
2. **Which Cheap Checks Should Run First?**
3. **How Do Terraform Tests Check a Module Contract?**
4. **What Do Mocks Prove and Hide?**
5. **How Do Validation and Provider-Aware Linting Differ?**
6. **Why Is Plan Review a Form of Testing?**
7. **When Do You Need Real Infrastructure?**
8. **How Do You Build a Terraform Testing Strategy?**

## What Does It Mean to Test Terraform?
<!-- section-summary: Terraform tests can examine source shape, evaluated configuration, proposed state transitions, provider assumptions, or real remote behavior. -->

Different tests ask different questions:

```text
Does the source follow canonical formatting?
Can Terraform parse and type-check the configuration?
Given inputs, does the module produce the intended values and graph?
Does provider-aware analysis recognize suspicious arguments?
What transition does Terraform propose for a real state?
Will the provider API accept the request?
Does the created infrastructure actually behave correctly?
```

Testing Terraform means gathering enough evidence for the risk under review. The cheapest useful check should run frequently, while expensive real-infrastructure checks should focus on uncertainty that only the remote system can resolve.

Infrastructure has two important dimensions. **Configuration behavior** includes expressions, branches, resource counts, names, inputs, and outputs. **Deployment behavior** includes API validation, permissions, quotas, eventual consistency, runtime health, and cleanup. Terraform-native plan tests can cover much of the first dimension without creating objects; integration tests cover selected parts of the second.

No single green result means “the infrastructure is correct.” A strong test report states which claim passed and which uncertainty remains.

Testing also has a time dimension. A static check can be repeated against the same source with the same result. A plan and integration test observe mutable remote systems, so their evidence can become stale. Record the configuration revision, provider versions, target, and run time whenever results depend on external state.

The subject under test should be small enough to diagnose. A failed assertion about a module output gives a direct contract signal. A failed end-to-end environment containing hundreds of resources may expose the same bug only after a long run, mixed with unrelated provider failures. Layering tests preserves both speed and explanatory value.

Negative cases matter. A test suite that only proves valid production inputs succeed says nothing about rejected environments, disabled branches, missing keys, or dangerous combinations. Assertions should cover both intended presence and intended absence.

## Which Cheap Checks Should Run First?
<!-- section-summary: Formatting and validation provide fast source-level evidence before tests need credentials, a backend, or real infrastructure. -->

Start with:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

`terraform fmt` checks canonical formatting. It is intentionally narrow: it does not inspect cloud accounts, state, or business intent. Run it locally and in CI so feedback is quick and the pipeline independently verifies the repository.

`terraform validate` checks syntax and internal consistency, including references, argument shapes, and value types that Terraform and installed provider schemas can understand. It can catch a misspelled variable reference or an invalid block structure.

Reusable-module validation often initializes with `-backend=false` because the module should not need access to a deployment backend merely to install provider requirements and validate its configuration. Deployable roots later need real backend initialization for a target-aware plan.

Validation does not call every remote API or prove eventual values. A syntactically valid instance type string may not exist in the selected region. A valid bucket configuration can request a globally unavailable name. A valid policy can still grant the wrong business access.

Variable validation adds another cheap boundary:

```hcl
variable "environment" {
  type = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

This rejects unsupported caller inputs wherever the variable is used. It is part of the module contract, not a replacement for tests. A test can show that supported inputs produce the intended resources and that invalid inputs fail as designed.

Cheap checks belong before cloud credentials, locks, or integration resources. They reduce feedback time and prevent simple source errors from consuming expensive test environments.

Initialization itself should be deterministic. Commit `.terraform.lock.hcl` for deployable roots, pin the Terraform CLI range used by CI, and avoid silently upgrading providers during a test run. A changed provider schema can alter validation and plan behavior even when the module source is unchanged.

Formatting failures usually should be fixed mechanically with `terraform fmt`, not debated in review. Validation failures need their full diagnostic, including file and expression context. CI should preserve readable output without enabling provider debug logs that may disclose credentials or sensitive arguments.

Validation can run on a child module without concrete caller values because type declarations and defaults define much of the contract. Tests supply representative inputs to evaluate branches. A real root plan adds backend state, provider identity, and remote observations. Keeping these phases separate avoids giving basic validation more authority than it needs.

Syntax and type checks also do not establish organizational conventions. Terraform accepts many valid names, tag shapes, and resource combinations. Those belong in module tests, linters, policy, or shared abstractions according to whether the rule is local intent, a known static risk, or organization-wide authorization.

## How Do Terraform Tests Check a Module Contract?
<!-- section-summary: Terraform test files supply inputs, run plan or apply behavior, and assert properties of resources and outputs. -->

A reusable module has a contract:

```text
inputs
    -> evaluated configuration and resource graph
    -> outputs and externally visible behavior
```

For the retention example, the contract includes:

```text
environment = prod -> retention_in_days = 30
environment = dev  -> retention_in_days = 7
```

A Terraform test can express that rule:

```hcl
# tests/retention.tftest.hcl
run "production_retention" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition = (
      aws_cloudwatch_log_group.app.retention_in_days == 30
    )
    error_message = "Production must use 30-day retention."
  }
}
```

The run supplies a production input, evaluates a plan, and inspects the planned resource property. `command = plan` avoids creating infrastructure, making this analogous to a configuration unit test.

Terraform “unit tests” differ from ordinary pure-function tests because the subject is declarative configuration and a resource graph. Assertions can inspect resource instances, output values, conditions, and the effects of `count`, `for_each`, and expressions.

Branches are especially valuable to test:

```hcl
count = var.enable_monitoring ? 1 : 0

instance_type = var.environment == "prod" ? "m7i.large" : "t3.micro"

for_each = {
  for name, app in var.apps : name => app
  if app.enabled
}
```

A production plan may exercise only `prod + monitoring`. Tests can cover `prod + no monitoring`, `dev + monitoring`, and `dev + no monitoring`, including the zero-instance case:

```hcl
run "monitoring_disabled" {
  command = plan

  variables {
    environment       = "dev"
    enable_monitoring = false
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.app) == 0
    error_message = "Monitoring resources should not exist."
  }
}
```

Tests protect the module's intended abstraction. They should describe outcomes important to callers rather than every implementation detail, or harmless refactors will break the suite without changing the contract.

Assertions can reference outputs when outputs are the public contract:

```hcl
run "development_retention_output" {
  command = plan

  variables {
    environment = "dev"
  }

  assert {
    condition     = output.retention_days == 7
    error_message = "Development must expose seven-day retention."
  }
}
```

Resource assertions are appropriate when the module contract includes provider configuration that callers rely on. Output assertions reduce coupling when the internal resource layout is meant to remain private. Choose the boundary deliberately.

Test names and messages should explain the business rule. “Assertion failed” sends a maintainer back through the expressions; “Production must use 30-day retention” identifies the expected contract. Realistic supported inputs turn a small test file into executable documentation.

`command = apply` is not a stronger version of every plan test. It changes the cost and side effects. Use it only when assertions require provider-created results or remote behavior. Most branching and composition cases remain clearer with `command = plan`.

Tests should also cover stable identity. If a collection uses `for_each`, assert the expected keys where those keys are part of the interface. This catches a refactor that changes addresses even if resource counts remain equal.

## What Do Mocks Prove and Hide?
<!-- section-summary: Mock providers isolate configuration logic by supplying fake provider values, but deliberately remove evidence about real APIs and service behavior. -->

Provider calls can make a test slow, expensive, credential-dependent, or destructive. Terraform tests can use provider mocking to supply computed values and evaluate configuration without calling the real cloud.

Conceptually:

```text
real provider test
    configuration -> provider plugin -> remote API

mocked provider test
    configuration -> mock provider values -> assertions
```

Mocks are valuable when the question is about Terraform logic: Was the correct branch selected? Did a module compose the expected name? Did enabled inputs create the right number of resource instances? Did an output preserve the expected keys?

They create a clean boundary because remote credentials, quotas, and service latency are not involved. Tests run quickly and can be deterministic.

That speed comes from intentionally throwing away evidence. A mock cannot prove:

```text
the cloud accepts the arguments
the name is globally available
the execution role has permission
the selected region supports the feature
the resource becomes healthy
the service applies the setting exactly as expected
cleanup will succeed
```

A mock returns the values the test defines. If the mock gives an impossible ID or reports success for an invalid configuration, Terraform can still evaluate dependent expressions. That is useful for isolation, not proof of provider realism.

Use mocks for configuration uncertainty and real infrastructure for service uncertainty. Do not call a mocked test an integration test merely because the configuration contains provider resources.

Mocks should remain minimal. Configure only the computed values the contract needs, and avoid recreating the entire cloud API in test fixtures. An elaborate fake becomes another implementation that can drift from the provider it imitates.

Defaults from a mock provider can make dependent resources evaluable, while per-resource overrides supply values needed by one case. Review those fake values as test inputs. If several assertions rely on a mocked ARN shape, document that the test proves string flow, not that AWS will issue that ARN.

Mocking is particularly useful for child modules that call data sources. A module may transform a looked-up image ID or account value into resource arguments. The mock can return a deterministic result so the test exercises the transformation. A separate integration test can verify that the real lookup filters select the intended remote object.

Keep at least one route from configuration to reality for high-risk modules. A large suite of mocks can become internally consistent while provider releases or platform policy drift outside it. Target-aware plans and focused integration tests supply that missing evidence.

## How Do Validation and Provider-Aware Linting Differ?
<!-- section-summary: Validation checks Terraform's structural model, while provider-aware linting adds known semantic rules without becoming the remote provider API. -->

Terraform can validate this shape:

```hcl
resource "aws_instance" "app" {
  ami           = "ami-123456"
  instance_type = "definitely-not-a-real-instance-type"
}
```

The argument may be the correct type—a string—even though AWS will reject its value. Provider-aware linters can add rules derived from provider knowledge, deprecations, and common mistakes. Static security tools can flag public access, missing encryption, or overly broad policies.

These tools sit between structural validation and a live plan or apply:

```text
fmt
    source style

validate
    Terraform syntax, types, references, schema shape

provider-aware lint and static security
    known semantic and risk patterns

plan
    proposed transition for a selected target

integration
    real service behavior
```

Provider-aware linting still is not the provider API. It cannot know every account policy, current quota, regional rollout, name collision, runtime interaction, or remote state. Rule sets also change over time and can produce false positives or miss valid organization-specific risks.

Treat linter configuration as maintained code. Pin versions, review suppressions, explain exceptions, and avoid disabling a whole rule when one narrow case is justified. A tool is valuable when its findings lead to clear fixes and its limitations are understood.

Built-in preconditions and postconditions form another layer. They encode invariants close to the module and fail whenever the configuration is used. Tests verify that those conditions behave correctly. Policy as code enforces cross-repository organizational rules outside the module.

A precondition is valuable when the resource cannot be used safely unless an assumption holds. A postcondition can prevent downstream Terraform actions when a provider result violates a contract. Neither automatically reverses earlier operations. Test both the accepted and rejected path so a later expression change does not silently weaken the guard.

Static security analysis should prioritize outcome-oriented findings: public exposure, unencrypted storage, unrestricted ingress, or missing logging. Style preferences are cheaper to enforce with formatting or module conventions. When every preference blocks CI, teams learn to add broad suppressions and the truly dangerous findings become harder to see.

Provider-aware tool versions and rule packs are dependencies. Pin them, review upgrades, and test their configuration. If a suppression is necessary, scope it to the exact resource and include a reason rather than disabling the rule repository-wide.

## Why Is Plan Review a Form of Testing?
<!-- section-summary: A Terraform plan tests the proposed state transition for a particular configuration, state, variable set, provider context, and point in time. -->

Suppose production currently has three application instances. A configuration change modifies an image and a lifecycle rule. Only a plan against the production state can show whether Terraform proposes in-place updates, replacements, extra capacity, or deletion.

`terraform plan` compares configuration with state and current remote information and proposes operations without carrying them out. A plan without `-out` is speculative: useful evidence now, but potentially stale before later apply.

Plan review is testing because it evaluates a concrete proposition:

> For this root, state, variables, provider context, dependency set, and current remote system, what does Terraform intend to do?

Reviewers inspect:

```text
resource addresses
create, update, replace, and delete actions
replacement reasons
changes to identity and for_each keys
unknown values
sensitive-value boundaries
output changes
unexpected drift
blast radius
```

A source diff can look harmless while an address rename produces destroy and create actions. Conversely, a large refactor with correct `moved` blocks can produce no remote change. The plan observes Terraform's state-aware interpretation rather than guessing from text.

Plan review does not prove that the operations will succeed or that the application will work. Permissions can differ at apply, remote conditions can change, and provider APIs can reject or partially complete operations. Runtime health lies beyond the plan.

A saved plan provides stronger deployment evidence because the exact approved decision can be applied later:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
terraform apply tfplan
```

Protect the artifact because plans can contain sensitive values. Also verify the target context beside the plan; an accurate plan against the wrong state or account is still the wrong evidence.

Plan testing can be automated without reducing the plan to counts. Machine-readable JSON lets policy inspect action types and final values, but unknown and sensitive values need careful semantics. Human rendering remains valuable for relationships, replacement reasons, and changes a generic rule does not understand.

Drift adds another input. A configuration change may appear to modify one tag, while refresh discovers an out-of-band security-group edit. The plan combines both. Reviewers should distinguish changes caused by the commit from drift that needs separate ownership or remediation.

Address migrations deserve focused plan assertions or review. Renaming a resource, changing `count` to `for_each`, or moving into a module can propose replacement unless `moved` blocks preserve identity. Tests may validate the new graph shape, but only a plan against existing state proves the migration behavior for that deployment.

Saved plans strengthen the handoff to deployment, not the underlying functional test. They execute the approved transition under compatible conditions. Runtime verification still follows apply because a correct plan can encounter provider errors or create unhealthy infrastructure.

## When Do You Need Real Infrastructure?
<!-- section-summary: Integration tests create real resources only for questions involving provider APIs, account policy, service behavior, readiness, or cleanup. -->

Some questions exist only after a remote API runs:

```text
Is a name available in this account or global namespace?
Does the role really have permission?
Does the region support the feature?
Does the service normalize or reject this setting?
Does a load balancer declare the target healthy?
Does a policy allow the intended request and deny another?
Can the resource be destroyed cleanly?
```

A Terraform test run can use `command = apply` to create infrastructure, assert resulting values or behavior, and perform cleanup. The test should run in an isolated account or project with restricted credentials, cost controls, unique names, and no path to production data.

Use unique, traceable inputs rather than fixed global names. A run ID, pull-request number, short commit SHA, or random suffix can distinguish resources. Read the actual created name from Terraform outputs before making provider CLI or application checks.

Integration tests should target cloud-only uncertainty. Do not spend minutes and money creating a bucket merely to test a string concatenation that a plan assertion can prove. Do create one when the risk depends on provider authorization, service rules, or runtime behavior.

Cleanup failure is part of integration-test risk. A failed assertion or interrupted runner can leave billable infrastructure. Use time-to-live tags, periodic janitor jobs, budget alerts, restricted quotas, and a runbook for leaked resources. Record the state and identifiers needed for cleanup.

Some behavior extends beyond resources. A real test may need to send a request, verify DNS resolution, read an object under an application identity, or observe a rollout. Terraform can provision the test fixture, but the assertion may belong to a service-specific tool.

An integration test proves behavior in the tested account, region, provider version, and time. It increases confidence; it does not establish a timeless universal guarantee.

Design integration credentials for the fixture. The role should create only the resource types under test in an isolated boundary and should not reach production. Use provider-side policy and quotas in addition to naming conventions. If the test needs destructive permissions for cleanup, scope them to resources carrying the run's traceable tags where the platform supports it.

Separate setup failure, assertion failure, and cleanup failure in the report. A permission error during creation does not disprove the module's business assertion, though it does reveal the test environment is unusable. A passed assertion followed by failed destroy means the behavior was observed but the run still requires operational cleanup.

Integration state must survive long enough to clean up. An ephemeral runner that loses local state after a failure can strand resources. Use a recoverable test backend or preserve the state securely until cleanup completes, then expire it according to policy.

End-to-end checks should use the identity a real consumer would use. Testing a secret read as an administrator proves less than testing it through the application's workload role. Testing a service from inside its network boundary proves something different from a public client request. State the vantage point in the assertion.

## How Do You Build a Terraform Testing Strategy?
<!-- section-summary: Build a pyramid of frequent cheap checks, focused plan and mock tests, fewer provider-aware tests, and narrow real-infrastructure tests. -->

A useful testing pyramid is:

```text
many:   fmt, validate, variable validation
many:   plan-based Terraform tests and focused mocks
some:   provider-aware lint and static security analysis
every deployment: target-aware plan review and policy
few:    real integration and end-to-end behavior tests
```

The bottom layers are fast and deterministic, so they run on every change. Higher layers cost more authority, time, money, and cleanup effort, so they focus on uncertainty lower layers cannot answer.

In CI, a module change can follow this flow:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
# run pinned linters and security rules
# plan affected real roots under verified read-oriented identities
# run selected integration suite in an isolated test environment
```

Keep two distinctions explicit:

```text
tests
    assert intended configuration behavior across chosen cases

plans
    show proposed changes for one selected state and current target
```

and:

```text
mocks
    isolate Terraform logic by removing remote behavior

integration
    spends real API calls to observe remote behavior
```

For the retention module, format and validation catch source errors, plan-based tests assert production and development retention branches, a linter checks provider-aware issues, a target plan shows the effect on an existing log group, and an isolated integration test is reserved for provider behavior that cannot be established otherwise.

Choose tests by risk, not by fashion. If the failure is a wrong branch, write a configuration test. If it is an invalid provider value, add lint or a focused integration test. If it is accidental replacement, require plan review. If it is runtime reachability, run a real end-to-end check.

The first-principles model is evidence with boundaries. Every test removes some uncertainty while leaving other uncertainty intact. A trustworthy pipeline makes those boundaries visible instead of summarizing all green checks as “Terraform is safe.”

Maintain a risk-to-check map for important modules. Naming and branching can be covered by plan tests. Public exposure and required tags can use static analysis and policy. Provider acceptance can use a small integration fixture. Service readiness can use an end-to-end probe. Destructive changes require target plan review and approval. This prevents expensive tests from being added without a specific claim.

When a production incident escapes the suite, add evidence at the lowest layer capable of detecting the cause. A typo belongs in validation or a contract test, not an always-on cloud environment. A region-specific API rule belongs in provider-aware or integration coverage. A bad rollout health signal belongs in runtime verification. The suite becomes more useful without becoming uniformly slower.

Tests that create infrastructure should also verify Terraform's ownership record. A passing service check can coexist with the wrong state address, an accidental replacement, or an unmanaged object. Inspect the applied state and a second clean plan before destroying the fixture; this proves both runtime behavior and convergence under Terraform's control loop.

## Check Your Answers

:::expand[What Does It Mean to Test Terraform?]{kind="recap"}
Testing can target source shape, evaluated configuration, proposed transitions, provider assumptions, or real service behavior. Name the proposition each check supports.
:::

:::expand[Which Cheap Checks Should Run First?]{kind="recap"}
Run formatting, backend-free initialization, validation, and input validation early. They catch fast failures without cloud write authority or integration cost.
:::

:::expand[How Do Terraform Tests Check a Module Contract?]{kind="recap"}
Test files supply inputs and use plan or apply runs with assertions. They are especially useful for branches, counts, keys, outputs, and module outcomes.
:::

:::expand[What Do Mocks Prove and Hide?]{kind="recap"}
Mocks make configuration tests fast and isolated, but they discard evidence about permissions, quotas, provider validation, availability, and runtime behavior.
:::

:::expand[How Do Validation and Provider-Aware Linting Differ?]{kind="recap"}
Validation checks Terraform's structural model; linting adds known provider and risk rules. Neither is the live API or a target-aware plan.
:::

:::expand[Why Is Plan Review a Form of Testing?]{kind="recap"}
A plan tests Terraform's proposed transition for one context and time. It reveals address, replacement, drift, and blast-radius behavior but not runtime success.
:::

:::expand[When Do You Need Real Infrastructure?]{kind="recap"}
Use isolated integration tests for API acceptance, authorization, regional behavior, readiness, and cleanup questions that lower layers cannot answer.
:::

:::expand[How Do You Build a Terraform Testing Strategy?]{kind="recap"}
Run many cheap checks, focused mocks and plan tests, provider-aware analysis, every-deployment plans, and a small set of risk-driven integration tests.
:::

---

**References**

- [Terraform CLI: fmt](https://developer.hashicorp.com/terraform/cli/commands/fmt)
- [Terraform CLI: validate](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [Terraform: Tests](https://developer.hashicorp.com/terraform/language/tests)
- [Terraform: Mocking providers](https://developer.hashicorp.com/terraform/language/tests/mocking)
- [Terraform CLI: plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform: Custom conditions](https://developer.hashicorp.com/terraform/language/expressions/custom-conditions)
- [TFLint](https://github.com/terraform-linters/tflint)
