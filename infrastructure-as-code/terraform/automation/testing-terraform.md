---
title: "Testing Terraform"
description: "Catch mistakes in your Terraform configurations before they reach production using static analysis, plan validation, and automated integration tests."
overview: "Terraform configurations can have bugs just like application code — wrong resource types, misconfigured security groups, accidentally exposed S3 buckets. This article covers the testing tools available at each stage of the development process, from static checks you can run in seconds to full integration tests that deploy real resources."
tags: ["testing", "tflint", "terraform test", "checkov", "terraform"]
order: 2
id: article-iac-terraform-automation-testing
---

## Table of Contents

1. [Why Test Terraform](#why-test-terraform)
2. [Formatting and Syntax: terraform fmt and validate](#formatting-and-syntax-terraform-fmt-and-validate)
3. [Static Analysis with tflint](#static-analysis-with-tflint)
4. [Security Scanning with Checkov](#security-scanning-with-checkov)
5. [Plan-Based Testing: Asserting on the Plan Output](#plan-based-testing-asserting-on-the-plan-output)
6. [Native Test Framework: terraform test](#native-test-framework-terraform-test)
7. [Module Testing Patterns](#module-testing-patterns)
8. [When to Write Which Kind of Test](#when-to-write-which-kind-of-test)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Test Terraform

A Terraform plan that succeeds does not mean the configuration is correct. A plan with no errors might create an S3 bucket with public access enabled, configure a security group that accepts traffic from anywhere on all ports, or set up a database with no backup retention. The plan succeeds — Terraform can execute those operations — but the resulting infrastructure is insecure or misconfigured.

Testing Terraform means checking the configuration against expectations before those expectations hit production. Some checks take milliseconds and run entirely locally. Others deploy real resources and check their behavior. The right testing strategy uses a combination of both, applying fast checks early (to catch obvious mistakes quickly) and slow integration tests later (to verify complex interactions that only appear when real resources exist).

The other argument for testing Terraform is refactoring confidence. When you restructure a large module — moving resources, renaming variables, changing how outputs are computed — tests tell you whether the refactoring preserved the correct behavior. Without tests, you find out at the next production deploy.

## Formatting and Syntax: terraform fmt and validate

Two commands built into the Terraform CLI provide the fastest and cheapest checks.

`terraform fmt` reformats all `.tf` files in the current directory to the canonical style — consistent indentation, line spacing, and attribute alignment. It is not a linter; it does not check for logical errors. But running it before committing code ensures your team does not waste code review time on formatting debates.

```bash
terraform fmt -recursive
```

The `-recursive` flag processes all subdirectories, which is useful in repositories with a `modules/` directory and multiple environment directories.

`terraform fmt -check` exits with a non-zero status if any file would be reformatted. Use this in CI to enforce formatting:

```bash
terraform fmt -check -recursive
```

`terraform validate` checks the configuration for syntax errors and obvious logical mistakes. It catches things like referencing a variable that was not declared, using a function with the wrong argument types, or including an attribute that does not exist in a resource's schema. Critically, it can run without cloud credentials because it only inspects the configuration files — it does not contact any cloud API.

```bash
terraform init -backend=false
terraform validate
```

The `-backend=false` flag skips backend initialization, which means you do not need actual AWS credentials or a real S3 bucket to run the validation in a CI context. After `validate`, you know the configuration is syntactically correct and all references resolve properly.

Run both commands on every pull request as the first step in the CI pipeline. They finish in seconds and catch the most basic mistakes before slower, more expensive checks run.

## Static Analysis with tflint

`tflint` is a pluggable linter for Terraform configurations. Where `terraform validate` checks syntax and references, `tflint` checks for semantic issues — things that are syntactically valid but wrong.

The AWS plugin for `tflint` catches a large class of common mistakes:

- Using an EC2 instance type that does not exist (like `t3.xxxxlarge`)
- Using an AMI in the wrong region
- Missing required tags based on your organization's policy
- Using a deprecated resource attribute
- Passing a CIDR block in the wrong format

Installing and running it:

```bash
# Install tflint and the AWS plugin
tflint --init

# Run checks on the current directory
tflint --recursive
```

A `.tflint.hcl` configuration file in your repository root configures the plugins:

```hcl
plugin "aws" {
  enabled = true
  version = "0.29.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

rule "aws_instance_invalid_type" {
  enabled = true
}

rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}
```

tflint is significantly faster than running `terraform plan` because most rules analyze configuration statically rather than planning live infrastructure. Provider-specific rules may need provider metadata or credentials depending on how they are configured, so treat it as a fast linting layer, not a complete replacement for plan checks. Add it to your CI pipeline immediately after `fmt` and `validate`.

## Security Scanning with Checkov

Checkov is an open-source security and compliance scanner for Terraform. It reads your configuration files and checks them against hundreds of security policies — things that are valid Terraform but represent security risks.

Examples of what Checkov catches:
- S3 buckets with public access not explicitly blocked
- Security groups with inbound rules open to `0.0.0.0/0` on sensitive ports (like 22 for SSH)
- RDS instances with backup retention set to zero
- CloudTrail not enabled for S3 data events
- KMS keys without rotation enabled
- ELB access logging disabled

Install and run it:

```bash
pip install checkov
checkov -d . --framework terraform
```

Checkov exits with a non-zero status if any checks fail, which makes it easy to integrate into CI. It also provides an output format that shows exactly which file and line triggered each finding, along with a brief explanation and a remediation suggestion.

For a new project or an existing project with many findings, running Checkov for the first time often produces a long list of violations. Rather than fixing everything at once, you can tell Checkov to skip specific rules using inline comments:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = "my-company-logs"

  #checkov:skip=CKV_AWS_21:Log bucket does not need versioning
  #checkov:skip=CKV2_AWS_62:Notifications not required for log bucket
}
```

The skip comment documents the conscious decision to accept the finding for this specific resource, rather than hiding the finding globally.

## Plan-Based Testing: Asserting on the Plan Output

`terraform plan -out=plan.tfplan` saves the plan to a binary file. `terraform show -json plan.tfplan` converts it to JSON. That JSON contains every planned operation — which resources will be created, destroyed, or modified, and what their attributes will be. You can parse this JSON in a test script to assert that the plan matches your expectations.

A simple shell script that checks the plan:

```bash
terraform plan -out=plan.tfplan
terraform show -json plan.tfplan > plan.json

# Check that no resources are being destroyed
DESTROY_COUNT=$(jq '[.resource_changes[] | select(.change.actions[] == "delete")] | length' plan.json)
if [ "$DESTROY_COUNT" -gt "0" ]; then
  echo "ERROR: Plan contains $DESTROY_COUNT resource deletions"
  cat plan.json | jq '[.resource_changes[] | select(.change.actions[] == "delete") | .address]'
  exit 1
fi

echo "Plan is safe: no resources being destroyed"
```

More sophisticated plan-based testing uses tools like `conftest` (which applies OPA policies to JSON) or `terraform-compliance` (a Python tool with a BDD-style assertion language). These let you write policy rules like "all S3 buckets must have versioning enabled" and assert them against the plan before applying.

Plan-based tests run against real cloud credentials (to produce an accurate plan) but do not make any changes. They are slower than static analysis but faster than full integration tests.

On Azure, Microsoft recommends integration tests that run against real Azure resources for the parts static analysis cannot prove. Keep those tests isolated in a dedicated subscription or resource group, use short-lived credentials or managed identity, tag every test resource, and destroy the test deployment after assertions complete. That mirrors the AWS testing advice in this article: use static tools early, then reserve real cloud tests for shared modules and high-risk behavior.

## Native Test Framework: terraform test

Terraform 1.6 introduced a native test framework. Tests are written in `.tftest.hcl` files alongside your module's `.tf` files. They use the same HCL syntax as configuration files.

Here is a test for a network module that verifies the module creates the expected number of subnets:

```hcl
run "creates_correct_number_of_subnets" {
  command = apply

  variables {
    region             = "us-east-1"
    cidr_block         = "10.0.0.0/16"
    availability_zones = ["us-east-1a", "us-east-1b"]
  }

  assert {
    condition     = length(aws_subnet.web) == 2
    error_message = "Expected 2 subnets, got ${length(aws_subnet.web)}"
  }

  assert {
    condition     = aws_subnet.web["us-east-1a"].cidr_block == "10.0.0.0/24"
    error_message = "Web subnet CIDR does not match expected value"
  }
}
```

You run tests with:

```bash
terraform test
```

Terraform applies the test configuration when a run uses `command = apply`, evaluates the `assert` conditions, and then attempts to destroy the resources it created for the test. If an assert fails, Terraform still attempts cleanup before reporting the failure. As with any real cloud operation, cleanup can fail if the provider API errors, credentials expire, or a resource has deletion protection, so test accounts should have cost controls and periodic cleanup checks.

Tests can also use `command = plan` instead of `command = apply` to check conditions without creating resources, though plan-only tests cannot verify computed attributes that are only known after creation (like auto-assigned IP addresses or ARNs).

## Module Testing Patterns

Testing individual modules in isolation is the most valuable form of Terraform testing. A module test creates only the resources in that module — not the full stack — which makes tests faster and cheaper.

The key to testable modules is the composability principle: a module that declares all its dependencies as variables can be tested with any values, including test-specific values. You provide minimal test inputs:

```hcl
run "module_creates_vpc_with_correct_cidr" {
  command = apply

  variables {
    region     = "us-east-1"
    cidr_block = "10.99.0.0/16"
  }

  assert {
    condition     = aws_vpc.this.cidr_block == "10.99.0.0/16"
    error_message = "VPC CIDR block does not match the provided variable"
  }

  assert {
    condition     = aws_vpc.this.enable_dns_hostnames == true
    error_message = "DNS hostnames should be enabled on the VPC"
  }
}
```

A separate test file can test edge cases:

```hcl
run "module_handles_minimum_configuration" {
  command = plan

  variables {
    region     = "eu-west-1"
    cidr_block = "172.16.0.0/12"
  }

  assert {
    condition     = output.vpc_id != ""
    error_message = "vpc_id output should not be empty"
  }
}
```

The `command = plan` variant is faster (no real resources) and checks that the configuration can be planned with the given inputs. Use it for testing that optional variables produce the expected plan shape, not for testing the actual attribute values of created resources.

## When to Write Which Kind of Test

Different tests have different costs and different coverage, and you want a balanced approach rather than relying exclusively on any one kind.

**`terraform fmt -check`** — run on every push, takes a fraction of a second, catches formatting drift. Zero maintenance overhead.

**`terraform validate`** — run on every pull request, takes a few seconds, catches syntax errors and missing references. Zero maintenance overhead.

**tflint** — run on every pull request, takes a few seconds, catches semantic mistakes like invalid instance types. Low maintenance overhead (update the plugin version periodically).

**Checkov** — run on every pull request, takes 10–30 seconds, catches security misconfigurations. Medium maintenance overhead (review and suppress false positives for your specific use case).

**Plan-based assertion scripts** — run on every pull request when cloud credentials are available, takes 2–5 minutes per environment, catches unexpected destroys or structural surprises. Medium maintenance overhead (update assertions when the module changes).

**`terraform test` integration tests** — run in CI on pushes to main or on a nightly schedule, takes 5–30 minutes (real resources are created and destroyed), verifies end-to-end correctness. High cost in cloud spend and pipeline time. Write these for critical, shared modules.

The pyramid principle applies: many fast, cheap tests at the bottom, fewer slow, expensive tests at the top. Most of the value comes from the fast checks that run on every pull request. Integration tests catch subtle issues that static analysis misses, but you would not want to wait 30 minutes for every pull request.

## Putting It All Together

A complete Terraform testing strategy layers multiple kinds of checks at different stages:

On every commit: `terraform fmt -check` to enforce formatting.

On every pull request: `terraform validate` for syntax, `tflint` for semantic mistakes, and Checkov for security policies. These three together catch perhaps 80% of the common configuration mistakes in seconds.

On pull requests to production branches: a plan-based check that asserts no unexpected destroys and validates the plan structure against critical expectations.

On a scheduled basis or when critical modules change: `terraform test` integration tests that deploy real resources, verify their attributes, and confirm that the module behaves correctly in a real cloud environment.

Each layer adds depth. The fast static checks catch obvious mistakes early. The slower integration tests catch the subtle issues that only appear when real AWS APIs are involved.

## What's Next

The final article in this module covers Policy as Code — using tools like Open Policy Agent (OPA) and HashiCorp Sentinel to enforce organization-wide rules on Terraform configurations, preventing non-compliant infrastructure from being applied regardless of who writes the code.

---

**References**

- [Command: validate (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/commands/validate) — Reference for `terraform validate` including what it checks and its limitations.
- [tflint (GitHub)](https://github.com/terraform-linters/tflint) — The tflint linter and its documentation for the AWS, GCP, and Azure rule sets.
- [Checkov (Bridgecrew/Palo Alto Networks)](https://www.checkov.io) — Checkov documentation including the full list of Terraform security checks.
- [Tests (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/tests) — Reference for the native `terraform test` framework introduced in Terraform 1.6.
- [Terraform Integration Testing on Azure (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/azurerm/best-practices-integration-testing) — Microsoft guidance for testing Terraform configurations against Azure.
