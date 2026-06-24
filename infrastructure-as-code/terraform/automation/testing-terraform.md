---
title: "Testing Terraform"
description: "Catch mistakes in your Terraform configurations before they reach production using static analysis, plan validation, and automated integration tests."
overview: "Terraform testing checks different risks at different speeds. This article walks through formatting, validation, linting, native terraform test files, plan review, and policy checks using a small module with visible variables, resources, outputs, and plan output."
tags: ["testing", "tflint", "terraform test", "checkov", "terraform"]
order: 2
id: article-iac-terraform-automation-testing
---

## Table of Contents

1. [What Testing Means for Terraform](#what-testing-means-for-terraform)
2. [Fast Checks: fmt and validate](#fast-checks-fmt-and-validate)
3. [Module Tests with terraform test](#module-tests-with-terraform-test)
4. [Linting and Security Scanning](#linting-and-security-scanning)
5. [Plan Review as a Test](#plan-review-as-a-test)
6. [A Practical Test Pipeline](#a-practical-test-pipeline)
7. [Putting It All Together](#putting-it-all-together)

## What Testing Means for Terraform
<!-- section-summary: Terraform testing combines syntax checks, module assertions, static analysis, plan review, and sometimes real integration environments. -->

Testing Terraform is not one single tool. It is a stack of checks that catch different problems. Formatting catches style drift. Validation catches invalid Terraform configuration. Linting catches provider-specific mistakes. Native tests can assert module behavior. Plan review checks the real change Terraform intends to make.

The goal is to catch boring mistakes before production. A missing tag, a wrong retention period, an accidental public bucket, or a resource replacement should be visible before apply.

For this article, use a log bucket module. It receives variables, shapes locals, creates resources, and exposes an output. That gives the tests something concrete to inspect.

## Fast Checks: fmt and validate
<!-- section-summary: fmt and validate are quick checks every Terraform project should run locally and in CI. -->

`terraform fmt` checks formatting:

```bash
terraform fmt -check -recursive
```

`terraform validate` checks whether the configuration is syntactically valid and internally consistent:

```bash
terraform init -backend=false
terraform validate
```

`-backend=false` is useful for module validation jobs that do not need a real backend. It lets CI initialize providers and modules without configuring remote state for every reusable module check.

These checks do not prove the cloud provider will accept every argument. They are still valuable because they catch many errors in seconds.

## Module Tests with terraform test
<!-- section-summary: terraform test lets a module define test files that run plans and assert expected values. -->

Terraform supports test files, often placed under `tests/`. A log bucket module might have this resource:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
  tags   = local.tags
}

output "bucket_name" {
  value = aws_s3_bucket.logs.bucket
}
```

A test file can pass input variables and assert the output shape:

```hcl
run "prod_bucket_name" {
  command = plan

  variables {
    environment    = "prod"
    service_name   = "billing"
    retention_days = 90
    extra_tags = {
      owner = "platform"
    }
  }

  assert {
    condition     = output.bucket_name == "dp-billing-prod-logs"
    error_message = "bucket_name should include service and environment."
  }
}
```

The test consumes the same variables a real root module would pass. It runs a plan and checks the module output. This catches naming rule changes before they surprise downstream callers.

The test result should be boring:

```hcl
tests/log_bucket.tftest.hcl... in progress
  run "prod_bucket_name"... pass
tests/log_bucket.tftest.hcl... tearing down
tests/log_bucket.tftest.hcl... pass

Success! 1 passed, 0 failed.
```

:::expand[What to test in a Terraform module]{kind="pattern"}
Good module tests focus on the module contract. Check that names are generated correctly, required tags exist, outputs have the expected shape, conditional resources turn on and off, and validation rejects bad inputs.

Avoid writing tests that only repeat the resource block line by line. If the resource says `retention_in_days = var.retention_days`, a useful test checks the caller-facing behavior: passing `90` for production produces a plan and output shape that the rest of the platform expects.

For risky modules, add an integration test environment that applies real infrastructure in a sandbox account, verifies it with cloud APIs, and destroys it afterward. Keep that slower test separate from quick pull request checks.
:::

## Linting and Security Scanning
<!-- section-summary: Linters and scanners catch provider conventions and security risks that Terraform validate does not try to enforce. -->

`terraform validate` checks Terraform language validity. It does not enforce your company's tagging standard or every cloud security rule. Teams often add tools such as TFLint for provider-aware linting and Checkov, tfsec, or Terrascan for security scanning.

For the log bucket, a scanner might flag missing encryption or public access controls. A linter might flag an invalid instance type in another module before a provider API call fails.

Use these tools as guardrails, not as a replacement for plan review. Configure rules that match your platform standards so engineers get useful failures instead of a wall of low-value warnings.

## Plan Review as a Test
<!-- section-summary: The plan is the test that shows the actual create, update, replace, destroy, and output changes Terraform intends to make. -->

The plan is the most important Terraform test before apply. It shows the evaluated result of variables, locals, resources, and outputs:

```hcl
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }

Changes to Outputs:
  + bucket_name = "dp-billing-prod-logs"
```

Reviewers should look for the action count, replacements, destroys, environment names, tags, state path, provider account, and output changes. A plan with `0 to add, 1 to change, 0 to destroy` can still be risky if the one change weakens a security rule.

## A Practical Test Pipeline
<!-- section-summary: A practical pipeline runs quick checks first, then module tests, static analysis, policy checks, and environment plans. -->

A useful CI order looks like this:

1. `terraform fmt -check -recursive`
2. `terraform init -backend=false`
3. `terraform validate`
4. `terraform test`
5. TFLint and security scanner jobs
6. `terraform plan -var-file=...` for affected environments
7. Policy checks against plan JSON

This order saves time. Fast checks fail early. Slower plan and policy jobs run after the code has passed basic checks.

## Putting It All Together
<!-- section-summary: Terraform testing works best as layered evidence, ending with a plan that humans and policies can review. -->

Terraform testing is layered. Use fast checks for syntax and style, native tests for module behavior, linters and scanners for standards, and plan review for real infrastructure impact. Each layer answers a different question.

For official reference, use Terraform's docs for [tests](https://developer.hashicorp.com/terraform/language/tests), [`terraform test`](https://developer.hashicorp.com/terraform/cli/commands/test), [`terraform validate`](https://developer.hashicorp.com/terraform/cli/commands/validate), and [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan).
