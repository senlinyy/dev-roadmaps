---
title: "Testing Terraform"
description: "Terraform testing catches mistakes before CI/CD by combining local checks, module tests, linting, plan review, and selective integration tests."
overview: "Terraform testing works best as a set of layers. This article starts on the developer machine with formatting and validation, then tests a reusable module contract, adds provider-aware linting, reviews the plan as evidence, and finishes with sandbox integration tests for behavior only the cloud API can prove."
tags: ["testing", "tflint", "terraform test", "checkov", "terraform"]
order: 1
id: article-iac-terraform-automation-testing
---

## Table of Contents

1. [A Reusable Team Module](#a-reusable-team-module)
2. [Local Checks Before Anything Else](#local-checks-before-anything-else)
3. [The Module Contract Test](#the-module-contract-test)
4. [Provider-Aware Linting](#provider-aware-linting)
5. [Plan Review as Evidence](#plan-review-as-evidence)
6. [Integration Tests for Cloud-Only Behavior](#integration-tests-for-cloud-only-behavior)
7. [The Right Check for the Risk](#the-right-check-for-the-risk)
8. [Putting It All Together](#putting-it-all-together)

This article follows a small Terraform module through the same checks a real platform team uses before a pipeline ever applies infrastructure. The module creates a log bucket for the billing service. The examples use AWS S3 because the resource shape is easy to read, but the testing pattern applies to Azure, Google Cloud, Kubernetes, and other providers too.

The order matters. A local formatting error should fail before a cloud plan starts. A module contract error should fail before a production stack imports the module. A provider rule should fail before the reviewer studies a long plan. The plan itself gives evidence for the next article, where CI/CD protects the same checks inside a shared workflow.

## A Reusable Team Module
<!-- section-summary: Terraform tests make the most sense for module rules that callers depend on. -->

Imagine the platform team owns a reusable module called `log_bucket`. Product teams use it whenever a service needs a bucket for audit logs, application logs, or exported reports. The billing service calls the module with `service_name = "billing"` and `environment = "prod"`, and the platform naming standard expects the bucket name `dp-billing-prod-logs`.

![Terraform Test Pyramid](/content-assets/articles/article-iac-terraform-automation-testing/terraform-test-pyramid.png)

*The testing pyramid shows why fast local checks sit below slower provider and sandbox tests.*

The first version of the module has a small mistake:

```hcl
variable "environment" {
  type = string
}

variable "service_name" {
  type = string
}

locals {
  bucket_name = "dp-${var.environment}-${var.service_name}-logs"
}

resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name

  tags = {
    service     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

output "bucket_name" {
  value = aws_s3_bucket.logs.bucket
}
```

Terraform can parse this configuration. AWS can also create a bucket with that name if the name is globally available. The problem lives in the team's own contract: service name should come before environment name. If this reaches production, dashboards, IAM conditions, lifecycle jobs, and cost reports may look for `dp-billing-prod-logs` while Terraform created `dp-prod-billing-logs`.

This is a good testing example because it shows the difference between **valid Terraform** and **correct infrastructure for this organization**. Terraform language checks can prove the syntax and references work. Module tests can prove the module returns the values callers expect. Provider-aware checks can compare the resource settings with cloud standards. A plan review can show the exact production effect.

## Local Checks Before Anything Else
<!-- section-summary: Formatting, initialization without a backend, and validation give fast feedback before module tests or provider checks run. -->

The first checks should run on the developer machine and in every pull request. They need to be fast, boring, and reliable because they protect the rest of the workflow from basic noise.

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

`terraform fmt -check -recursive` scans the current directory and child directories for files that do not match Terraform's standard formatting. The `-check` flag makes the command report drift instead of rewriting files, which fits CI because the job should fail and ask the author to format locally.

`terraform init -backend=false` downloads providers and modules without configuring the remote backend. That is useful for reusable module folders because the module may have no real state of its own. It also keeps a fast local check from touching production state configuration.

`terraform validate` checks the initialized configuration for Terraform language errors. It catches invalid references, missing required arguments, unsupported block types, and type mismatches that Terraform can detect without creating a plan for a real environment.

The same Terraform version should run locally and in CI. A module can declare the supported CLI range with `required_version`, and the repository can pin the exact CI version in one place, such as a tool-version file or a CI variable named `TERRAFORM_VERSION`. The first line of a check job should print the version so the run record shows which Terraform binary evaluated the module:

```bash
terraform version
```

A healthy run prints the pinned version instead of whatever happened to be installed on the machine:

```console
Terraform v<repo-pinned-version>
```

A typical validation failure looks like this:

```console
Error: Reference to undeclared input variable

  on main.tf line 9, in locals:
   9:   bucket_name = "dp-${var.servce_name}-${var.environment}-logs"

An input variable with the name "servce_name" has not been declared.
```

That output gives the author the file, line, expression, and missing variable name. The team should fix this before running slower checks. These commands remove broken Terraform from the path early, before the workflow reaches slower naming and security checks.

Local checks also give the next article a clean starting point. CI/CD should run the same commands, and the author should see most of these failures before opening a pull request. A shared pipeline should protect the team instead of acting as the first place obvious local mistakes appear.

## The Module Contract Test
<!-- section-summary: Native Terraform tests can plan a module with example inputs and assert the caller-facing outputs or validation failures. -->

After the basic language checks pass, the next risk is the module contract. A **module contract** means the behavior callers rely on: required inputs, defaults, outputs, tags, naming rules, optional resource toggles, and validation errors. For the log bucket module, the most visible contract is the bucket name.

Terraform test files use the `.tftest.hcl` extension. A test can run a plan with example input values and assert the result. A common file name for this module is `tests/log_bucket.tftest.hcl`. The test has three pieces: example variables, the assertion, and the message Terraform prints after the assertion fails:

```hcl
run "prod_bucket_name" {
  command = plan

  variables {
    environment  = "prod"
    service_name = "billing"
  }

  assert {
    condition     = output.bucket_name == "dp-billing-prod-logs"
    error_message = "bucket_name should use service, environment, and logs in that order."
  }
}
```

The `run` block names this test case. `command = plan` tells Terraform to evaluate a plan rather than apply real infrastructure. The `variables` block gives the module a production-like example. The `assert` block checks the output that callers use.

The developer can run the test from the module directory:

```bash
terraform test
```

With the original module, the test fails because the output value uses the wrong order:

```console
tests/log_bucket.tftest.hcl... in progress
  run "prod_bucket_name"... fail

Error: Test assertion failed

bucket_name should use service, environment, and logs in that order.
```

The fix is small and direct:

```hcl
locals {
  bucket_name = "dp-${var.service_name}-${var.environment}-logs"
}
```

The value of the test is bigger than the fix. A future refactor can move locals around, add prefixes, or add new environments, and this test still protects what the caller expects. The test speaks in the language of the module's public behavior instead of repeating every resource argument.

Terraform tests can also check validation behavior. Imagine production buckets require a customer-managed KMS key. The module may define a validation rule on `kms_key_id`, and the test can expect a failure if production leaves that value empty:

```hcl
run "prod_requires_kms_key" {
  command = plan

  variables {
    environment  = "prod"
    service_name = "billing"
    kms_key_id   = null
  }

  expect_failures = [
    var.kms_key_id,
  ]
}
```

`expect_failures` says the test should pass only if Terraform rejects the listed value. That gives the module a regression test for an important production rule. A test like this catches a weakened validation rule before a real stack plans an unencrypted bucket.

Good module tests stay close to decisions the module owns. They check names, tags, outputs, validation, optional resources, and conditional behavior. Tests that simply copy Terraform's syntax checks usually add noise because `terraform validate` already covers that layer.

## Provider-Aware Linting
<!-- section-summary: Linters and scanners add cloud-specific rules that Terraform validate cannot know by itself. -->

The module now passes Terraform language checks and module contract tests. The next layer asks whether the resource shape follows the team's cloud standards. Terraform itself usually cannot know that your organization requires encryption, public access blocks, approved regions, minimum retention, or a particular tag set.

Tool installation and version pinning should happen before their commands appear in CI. TFLint has its own binary and provider rulesets. Checkov is commonly installed as a pinned Python package or run from a pinned container image. The exact version numbers should live in repository tooling config or CI variables, so a pull request that changes the scanner version receives the same review as a rule change.

Two common commands in this layer are:

```bash
tflint --version
checkov --version
tflint --init
tflint --recursive
checkov -d .
```

The version commands should print the repository-pinned versions:

```console
TFLint version <repo-pinned-version>
<repo-pinned-checkov-version>
```

`tflint --init` downloads the configured ruleset plugins from `.tflint.hcl`. It belongs after TFLint config changes and before `tflint --recursive` in CI. `tflint --recursive` scans Terraform files across nested module and environment folders. TFLint can use provider rulesets, so an AWS-focused repository can catch issues such as invalid instance types, deprecated arguments, missing provider constraints, or resource values that do not match the provider's expected shape.

`checkov -d .` scans the directory tree for security and compliance rules. Tools such as Checkov, tfsec, Terrascan, and Trivy can catch missing encryption, public access settings, overly broad IAM, and other security patterns. The exact scanner matters less than the quality of the rules and how clearly failures explain the fix.

A useful finding names the file, resource, rule, and reason:

```console
FAILED CKV_AWS_21: "Ensure all data stored in the S3 bucket have versioning enabled"
File: /modules/log_bucket/main.tf:18-30
Resource: aws_s3_bucket.logs
```

That output gives the author enough context to decide whether the module needs a fix or a reviewed exception. A vague warning such as `security failed` slows the team down because nobody knows which resource or standard caused the failure.

Tool configuration should live in the repository so rule changes go through review. A small `.tflint.hcl` can enable the AWS ruleset:

```hcl
plugin "aws" {
  enabled = true
  version = "0.32.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
```

This file tells TFLint to load the AWS ruleset at a specific version. Pinning the ruleset helps make CI results repeatable. The platform team can update the version in a normal pull request, read the new findings, and decide which standards should be required.

Skip comments and exceptions should stay rare and specific. A useful skip names the rule, the resource, and the reason. A broad repository-wide skip makes the pipeline look green while the original risk stays hidden. If the same skip appears many times, the platform team should either improve the module or decide that the rule does not match the organization's current standard.

## Plan Review as Evidence
<!-- section-summary: The Terraform plan shows the evaluated create, update, replace, delete, and output changes for a specific target. -->

Local checks, module tests, and linters all run before the target environment plan. The plan is different because it combines the configuration, input values, provider data, and current state for one stack. That is where reviewers see what Terraform intends to change.

![Plan Fixture Flow](/content-assets/articles/article-iac-terraform-automation-testing/plan-fixture-flow.png)

*The fixture flow shows how a plan turns into review evidence and policy input instead of being treated as terminal noise.*

For a production stack, the command usually saves the plan and renders a readable copy:

```bash
terraform plan -var-file=terraform.tfvars -out=tfplan
terraform show -no-color tfplan > tfplan.txt
```

`terraform plan -var-file=terraform.tfvars -out=tfplan` loads the target values and saves the exact planned actions in `tfplan`. `terraform show -no-color tfplan > tfplan.txt` turns the saved plan into plain text for review without terminal color codes.

After the module fix, the readable plan should show the expected bucket name and tags:

```console
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "service"     = "billing"
        }
    }

Changes to Outputs:
  + bucket_name = "dp-billing-prod-logs"

Plan: 1 to add, 0 to change, 0 to destroy.
```

Reviewers should check the target context before they read individual resources. The target context includes the working directory, backend key, workspace if the team uses workspaces, cloud account or subscription, region, variable file, and Terraform version. A perfect bucket change in the wrong account is still a failed deployment.

The action summary matters too. `Plan: 1 to add, 0 to change, 0 to destroy.` gives a quick shape of the change, but the details still need review. One update can be risky if it opens a network rule, rotates a credential, lowers retention, or changes a database setting. A replacement can be safe for a stateless cache and dangerous for a stateful database.

Saved plan files need careful handling. Terraform can mark values as sensitive in terminal output, but saved binary plans and plan JSON can still contain configuration, input values, planned values, and secrets. The text summary helps humans review. The binary plan and JSON plan should have restricted artifact access, short retention, and environment-scoped permissions.

This plan evidence connects directly to CI/CD. The next article moves the same checks into a protected workflow, publishes a readable plan for review, and applies only after approvals and locks protect the target stack.

## Integration Tests for Cloud-Only Behavior
<!-- section-summary: Integration tests apply real infrastructure in a sandbox for provider behavior that static checks and plans cannot prove. -->

Some behavior only appears after a provider API runs. General purpose S3 bucket names must be unique across all AWS accounts in the partition, so a sandbox test should never depend on a fixed name like `dp-billing-test-logs` being available forever. A pull request number, run id, short commit SHA, or random suffix can go into the test inputs, and the actual bucket name should come from Terraform output before the AWS call. IAM policies may behave differently once AWS evaluates a real request. Load balancer health checks need real targets. Database parameter changes may have restart behavior that a plan cannot fully prove.

That is where **integration tests** help. An integration test creates real infrastructure in a sandbox, verifies the behavior, and destroys it. It spends real cloud resources, so it should be used for modules where the extra confidence is worth the cost and time.

A simple sandbox flow for the log bucket module has four pieces: initialize without a backend, apply in the sandbox, read the Terraform output, and ask AWS for the actual tags:

```bash
terraform init -backend=false
terraform apply -auto-approve -var-file=test.tfvars
TEST_BUCKET="$(terraform output -raw bucket_name)"
aws s3api get-bucket-tagging --bucket "$TEST_BUCKET"
terraform destroy -auto-approve -var-file=test.tfvars
```

`terraform init -backend=false` prepares the test directory without connecting to production state. `terraform apply -auto-approve -var-file=test.tfvars` creates the sandbox resources with test values. `terraform output -raw bucket_name` reads the exact globally unique name Terraform created. `aws s3api get-bucket-tagging` asks AWS for the real bucket tags, so the test checks actual provider behavior rather than Terraform's planned values. `terraform destroy -auto-approve` removes the resources with the same test values.

These examples assume AWS CLI v2, and the test job should print the version:

```bash
aws --version
```

The output should identify the AWS CLI v2 binary:

```console
aws-cli/2.x.x Python/3.x.x ...
```

The test identity needs `s3:GetBucketTagging` for the bucket. If AWS returns `NoSuchTagSet`, the bucket exists but has no tags, which is a useful integration-test failure for this module.

Successful tag verification returns a tag set like this:

```json
{
  "TagSet": [
    {
      "Key": "service",
      "Value": "billing"
    },
    {
      "Key": "environment",
      "Value": "test"
    },
    {
      "Key": "managed_by",
      "Value": "terraform"
    }
  ]
}
```

The `-auto-approve` flag belongs only in controlled automation or a disposable sandbox test. It skips Terraform's interactive confirmation prompt, so the identity, account, variable file, and cleanup process must be tightly scoped. A production apply should use the protected workflow from the next article.

Integration tests need cleanup even after failure. A shell runner can use a trap:

```bash
set -euo pipefail
trap 'terraform destroy -auto-approve -var-file=test.tfvars' EXIT

terraform init -backend=false
terraform apply -auto-approve -var-file=test.tfvars
TEST_BUCKET="$(terraform output -raw bucket_name)"
aws s3api get-bucket-tagging --bucket "$TEST_BUCKET"
```

`set -euo pipefail` stops the script on failed commands, unset variables, and failed pipeline stages. The `EXIT` trap runs the destroy command whenever the script exits, including after a failed verification command. Sandbox cost limits still matter, and the trap catches many ordinary failure paths.

The test identity should have permission only in the sandbox account or project. The names should include a unique suffix, such as a pull request number or short commit SHA. The account should have budget alerts and cleanup jobs because failed cleanup is the most common way infrastructure tests create surprise costs.

## The Right Check for the Risk
<!-- section-summary: A useful Terraform test suite maps each risk to the cheapest reliable check that can catch it. -->

Terraform testing works well with a clear job for each layer. The team should avoid sending every risk to the slowest test. A naming rule can use a native module test. A missing tag can use a module test, scanner, or policy rule depending on where the standard lives. A real provider behavior needs a sandbox integration test.

This table gives a practical map:

| Risk | Best first check | Why this check fits |
|---|---|---|
| Formatting drift | `terraform fmt -check -recursive` | Fast and deterministic across the repository |
| Invalid references or types | `terraform validate` | Terraform can catch the language issue before planning a target stack |
| Wrong module output | `terraform test` | The module can assert caller-facing behavior with example variables |
| Missing required tags | Module test, scanner, or policy | The right layer depends on whether the rule is module-specific or organization-wide |
| Deprecated provider argument | TFLint provider ruleset | Provider-aware linting catches this before a live plan review |
| Public access or missing encryption | Security scanner or policy | Security standards should produce clear, repeatable failures |
| Provider behavior after creation | Sandbox integration test | The cloud API must answer the question |
| Production replacement or delete | Plan review and policy | The action depends on state and must be reviewed in target context |

This map also helps with maintenance. If a check fails often for the same harmless reason, the team should tune it. Noisy checks teach people to ignore the pipeline. High-signal checks build trust because a failure usually points to a real fix.

## Putting It All Together
<!-- section-summary: Terraform testing is layered: local checks, module contract tests, provider-aware rules, plan evidence, and selective sandbox tests. -->

The log bucket module started with a small naming bug. Formatting and validation gave quick local feedback, but the naming rule needed a native module test. Provider-aware linting and scanners added cloud standards such as tags, versioning, public access, and encryption. The plan showed the final evaluated change for the target stack. Integration tests stayed available for the cases where a real cloud API response matters.

![Testing Summary](/content-assets/articles/article-iac-terraform-automation-testing/testing-summary.png)

*The summary board maps each Terraform risk to the check that catches it soonest.*

The practical habit is simple to describe and powerful in daily work. A developer runs the fast checks locally. The module protects its contract with `terraform test`. The repository keeps lint and scanner rules close to the code. The plan gives reviewers evidence. Slow integration tests run only for modules where real provider behavior justifies the time and cost.

This testing foundation sets up the CI/CD workflow. The next article takes these same checks and places them inside a protected pipeline with target context, plan artifacts, approvals, state locking, evidence, and a rollback note.

---

**References**

- [Terraform tests](https://developer.hashicorp.com/terraform/language/tests)
- [`terraform test`](https://developer.hashicorp.com/terraform/cli/commands/test)
- [`terraform fmt`](https://developer.hashicorp.com/terraform/cli/commands/fmt)
- [`terraform init`](https://developer.hashicorp.com/terraform/cli/commands/init)
- [`terraform validate`](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [`terraform show`](https://developer.hashicorp.com/terraform/cli/commands/show)
- [TFLint](https://github.com/terraform-linters/tflint)
- [TFLint AWS ruleset](https://github.com/terraform-linters/tflint-ruleset-aws)
- [Checkov](https://www.checkov.io/)
- [Checkov installation](https://github.com/bridgecrewio/checkov#installation)
- [AWS CLI installation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [Amazon S3 bucket naming rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)
- [AWS CLI get-bucket-tagging command](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3api/get-bucket-tagging.html)
