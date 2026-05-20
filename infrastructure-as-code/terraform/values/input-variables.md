---
title: "Input Variables"
description: "Define Terraform input variables so environment choices are explicit, typed, validated, and easy to review."
overview: "Input variables are the doorway into a Terraform module. This article starts with an AWS web environment whose VPC CIDR, instance type, allowed CIDRs, and tags need to vary without copying resource blocks."
tags: ["terraform", "opentofu", "variables", "aws", "hcl"]
order: 2
id: article-infrastructure-as-code-terraform-input-variables
---

## Table of Contents

1. [Which Values Should Change](#which-values-should-change)
2. [Input Variables](#input-variables)
3. [Types and Defaults](#types-and-defaults)
4. [Validation](#validation)
5. [The AWS Example](#the-aws-example)
6. [Common First Mistakes](#common-first-mistakes)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Which Values Should Change

The orders team has one Terraform directory that creates a small AWS web environment. It worked when the only target was a sandbox. Now the same pattern has to run for development and production.

The first review gets noisy for a simple reason: the resource blocks mix permanent design with environment choices.

- The VPC CIDR is hardcoded as `10.0.0.0/16`, but production has an allocated range of `10.20.0.0/16`.
- The instance type is `t3.micro`, which is fine for development and too small for production.
- The web security group allows a temporary office range, but production should use approved ingress ranges.
- The tags say `Environment = "dev"` in several places.

A beginner fix is to copy the whole directory and edit the strings. That creates two sources of truth. A reviewer now has to compare repeated resources and decide whether each difference is intentional.

Input variables solve the first part of the value problem. They declare which values are chosen from outside the module. The configuration still owns the resource shape, but the caller or operator supplies the environment-specific choices.

## Input Variables

An input variable is a named value Terraform can receive before it plans. The variable block describes the value. Resource blocks read it through the `var.` namespace.

This hardcoded VPC has one useful decision buried inside the resource:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name        = "orders-dev-vpc"
    Environment = "dev"
  }
}
```

The CIDR block is not really part of the VPC resource pattern. It is an environment choice. Move that choice into a variable:

```hcl
variable "vpc_cidr" {
  description = "IPv4 CIDR block for this environment VPC."
  type        = string
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
}
```

The variable name is the module's input name. The description is for humans reading the module interface. The type tells Terraform what shape is acceptable. The resource keeps the same meaning, but now the CIDR comes from outside the resource block.

This is the main habit: use variables for choices that should be visible at the module boundary. If a value changes by environment, account, region, workload size, or caller, it probably belongs in a variable.

## Types and Defaults

Types keep the contract honest. Without a type, Terraform can infer a value shape, but the module author loses a chance to say what the module expects.

The orders environment needs several kinds of values:

```hcl
variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for the web server."
  type        = string
  default     = "t3.micro"
}

variable "allowed_http_cidrs" {
  description = "CIDR ranges allowed to reach the web server on HTTP."
  type        = set(string)
}

variable "tags" {
  description = "Extra tags to apply to created resources."
  type        = map(string)
  default     = {}
}
```

The `environment` variable has no default, so the caller must provide it. That is useful when a missing value would make the plan ambiguous. The `instance_type` variable has a default, so development can use the cheap default while production can override it. The `allowed_http_cidrs` variable is a set of strings because each CIDR becomes a separate security group rule and duplicate values do not help. The `tags` variable is a map because tag keys and values are both strings.

Defaults are a design choice. A default can make a module easy to try. It can also hide an important production decision. Use defaults for safe, ordinary choices. Require a value when a reviewer should always see the environment's answer.

## Validation

Types catch shape problems. They do not catch every bad value.

A `string` type accepts `"prod"`, `"production"`, and `"banana"`. A `set(string)` accepts `"0.0.0.0/0"` even when production should not allow the whole internet. Variable validation adds rules that are specific to this module.

The environment can be limited to known names:

```hcl
variable "environment" {
  description = "Deployment environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}
```

The VPC CIDR can be checked for CIDR syntax:

```hcl
variable "vpc_cidr" {
  description = "IPv4 CIDR block for this environment VPC."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}
```

The `can(...)` expression asks whether Terraform can evaluate `cidrhost` for the supplied value. If the value is not valid CIDR notation, validation fails before Terraform tries to create the VPC.

Validation should protect the module contract, not replace review. Terraform can tell you whether a value is shaped like a CIDR block. It cannot know whether the network team approved that CIDR for production unless you encode that policy or check it elsewhere.

## The AWS Example

With variables declared, the AWS resources can read environment choices without duplicating resource blocks.

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = merge(var.tags, {
    Name        = "orders-${var.environment}-vpc"
    Environment = var.environment
  })
}

resource "aws_security_group" "web" {
  name        = "orders-${var.environment}-web"
  description = "Web ingress for the orders service."
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "orders-${var.environment}-web-sg"
    Environment = var.environment
  })
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each = var.allowed_http_cidrs

  security_group_id = aws_security_group.web.id
  cidr_ipv4         = each.value
  from_port         = 80
  ip_protocol       = "tcp"
  to_port           = 80
}

resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.web.id]

  tags = merge(var.tags, {
    Name        = "orders-${var.environment}-web"
    Environment = var.environment
  })
}
```

Several value paths are visible here. `var.vpc_cidr` controls the network range. `var.allowed_http_cidrs` controls one security group rule per allowed source range. `var.instance_type` controls the EC2 size. `var.tags` lets the caller add business tags without editing every resource.

This still leaves repetition in the names and tags. The next articles will handle that with variable value files and locals. For now, the important change is that the module has an input interface. A production plan can show which values production supplied.

## Common First Mistakes

**Turning every string into a variable.** A variable is part of the module interface. If a value should stay fixed for every caller, keeping it in configuration is clearer.

**Using defaults for decisions that need review.** A missing production CIDR should stop the plan. A default is useful when the fallback is safe and ordinary.

**Leaving variables untyped.** A type constraint documents the expected shape and catches basic mistakes before provider calls happen.

**Expecting validation to understand business policy.** Validation can check names, formats, and relationships you encode. It does not know your IP allocation process by itself.

**Putting secrets in ordinary variables without a plan.** A password can be passed through a variable, but that raises state and output questions. The sensitive values article returns to this carefully.

## Putting It All Together

The orders environment started with hardcoded values scattered through AWS resource blocks. Input variables moved the environment choices to the module boundary.

- `environment` names the deployment target.
- `vpc_cidr` chooses the VPC address range.
- `instance_type` lets dev and prod use different EC2 sizes.
- `allowed_http_cidrs` controls web ingress sources.
- `tags` lets the caller add common metadata.

The resource blocks still describe the infrastructure shape. The variables describe the choices someone must supply or accept. That split makes review easier because the plan can be traced back to named inputs instead of repeated edited strings.

## What's Next

The next article shows how Terraform receives those input values. A variable declaration creates the doorway, but the team still needs a clear way to pass dev, staging, production, and CI values into the root module.

---

**References**

- [Use input variables to add module arguments](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform guide to variable declarations, references, defaults, validation, sensitive flags, and assignment methods.
- [Variable block reference](https://developer.hashicorp.com/terraform/language/block/variable) - Language reference for the arguments accepted by `variable` blocks.
- [Type Constraints](https://developer.hashicorp.com/terraform/language/expressions/type-constraints) - Terraform reference for primitive, collection, structural, and optional object type constraints.
- [Validate your infrastructure in Terraform's configuration language](https://developer.hashicorp.com/terraform/language/expressions/custom-conditions) - Terraform reference for input validation, preconditions, and postconditions.
- [aws_security_group](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group) - AWS provider documentation for security groups and separate ingress and egress rule resources.
