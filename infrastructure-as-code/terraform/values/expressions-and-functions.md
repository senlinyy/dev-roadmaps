---
title: "Expressions and Functions"
description: "Use Terraform's built-in expressions and functions to compute, transform, and query values inside your configurations."
overview: "Expressions are the calculations inside Terraform arguments. This article shows how variables, locals, functions, for expressions, conditionals, and resource references combine into values that show up in plan output."
tags: ["expressions", "functions", "hcl", "for", "terraform"]
order: 4
id: article-iac-terraform-values-expressions
---

## Table of Contents

1. [What Expressions Are](#what-expressions-are)
2. [A Practical Tagging and Networking Example](#a-practical-tagging-and-networking-example)
3. [Functions That Shape Values](#functions-that-shape-values)
4. [For Expressions and Conditionals](#for-expressions-and-conditionals)
5. [Consuming Expressions in Resources](#consuming-expressions-in-resources)
6. [How Expressions Appear in Plans](#how-expressions-appear-in-plans)
7. [Putting It All Together](#putting-it-all-together)

## What Expressions Are
<!-- section-summary: An expression is any Terraform value calculation, from a literal string to a function call that builds a map for a resource. -->

An **expression** is the part of Terraform configuration that produces a value. `"prod"` is an expression. `var.environment` is an expression. `merge(local.default_tags, var.extra_tags)` is an expression. Terraform evaluates expressions while it builds the plan.

Expressions are everywhere because most resource arguments need values. Some values are literal. Some come from variables. Some come from resources. Some are calculated with functions, conditionals, and loops.

The goal is not to make clever one-line formulas. The goal is to make the value path clear enough that a reviewer can see what a resource will receive before apply.

## A Practical Tagging and Networking Example
<!-- section-summary: A real module often computes names, tags, and filtered subnet lists before resources consume them. -->

Imagine an application module that receives subnets from a network module and creates one security group rule per private subnet. The module also builds standard tags and names from a service name and environment.

In `variables.tf`:

```hcl
variable "environment" {
  type = string
}

variable "service_name" {
  type = string
}

variable "subnets" {
  type = map(object({
    id      = string
    tier    = string
    az      = string
    cidr    = string
  }))
}

variable "vpc_id" {
  type = string
}

variable "extra_tags" {
  type    = map(string)
  default = {}
}
```

The caller passes a map keyed by subnet name. Each subnet object includes its ID, tier, availability zone, and CIDR block.

## Functions That Shape Values
<!-- section-summary: Terraform functions transform values so resources receive the exact strings, maps, lists, and objects they need. -->

In `locals.tf`, functions create reusable values:

```hcl
locals {
  name_prefix = lower(format("dp-%s-%s", var.service_name, var.environment))

  default_tags = {
    service     = var.service_name
    environment = var.environment
    managed_by  = "terraform"
  }

  tags = merge(local.default_tags, var.extra_tags)
}
```

`format` builds a string from inputs. `lower` normalizes the result. `merge` combines the default tags with caller-supplied tags. The final `local.tags` value is the map resources will consume.

Functions should earn their place by making resource values safer or clearer. `lower` can prevent mixed-case naming drift. `merge` can keep common tags consistent. `coalesce` can select the first non-null value when a caller may omit an optional setting.

## For Expressions and Conditionals
<!-- section-summary: For expressions build new collections, and conditionals choose between values based on a true-or-false test. -->

A **for expression** builds a new collection from an existing collection. This module only wants private subnets:

```hcl
locals {
  private_subnets = {
    for name, subnet in var.subnets :
    name => subnet
    if subnet.tier == "private"
  }
}
```

This consumes `var.subnets` and creates `local.private_subnets`, a smaller map with only private entries. Keeping the original keys is useful because resource addresses will include names like `["app-a"]` and `["app-b"]`.

A conditional expression chooses one of two values:

```hcl
locals {
  log_retention_days = var.environment == "prod" ? 90 : 14
}
```

Production receives 90 days. Other environments receive 14 days. This is fine for a simple policy. If the condition grows into a long business rule, move it into a clearer variable or map.

:::expand[Prefer named expressions over clever chains]{kind="pitfall"}
Terraform lets you nest function calls, for expressions, conditionals, and resource references in one argument. That can produce a compact line that only the author understands.

A better pattern is to name the important steps. Build `local.private_subnets` first. Build `local.tags` first. Then resource blocks can consume those locals with short references. The final plan output will show evaluated values either way, but named locals make the code review much easier.

When a reviewer asks "where did this value come from," they should be able to trace it through two or three named steps, not decode a long expression inside a resource argument.
:::

## Consuming Expressions in Resources
<!-- section-summary: Resource arguments consume expression results just like they consume literal values. -->

In `main.tf`, resources consume the expression results:

```hcl
resource "aws_security_group" "app" {
  name   = "${local.name_prefix}-app"
  vpc_id = var.vpc_id
  tags   = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "private_subnet_https" {
  for_each = local.private_subnets

  security_group_id = aws_security_group.app.id
  cidr_ipv4         = each.value.cidr
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/aws/app/${local.name_prefix}"
  retention_in_days = local.log_retention_days
  tags              = local.tags
}
```

The security group name consumes `local.name_prefix`. The ingress rules consume `local.private_subnets` through `for_each`, then consume each subnet object's `cidr`. The log group consumes the conditional retention value.

## How Expressions Appear in Plans
<!-- section-summary: Plans show evaluated expression results, resource addresses from for_each keys, and unknown values when provider results are needed. -->

If the caller passes two private subnets and one public subnet, the plan shows only the private ones as rule addresses:

```hcl
  # aws_vpc_security_group_ingress_rule.private_subnet_https["app-a"] will be created
  + resource "aws_vpc_security_group_ingress_rule" "private_subnet_https" {
      + cidr_ipv4   = "10.0.10.0/24"
      + from_port   = 443
      + ip_protocol = "tcp"
      + to_port     = 443
    }

  # aws_vpc_security_group_ingress_rule.private_subnet_https["app-b"] will be created
  + resource "aws_vpc_security_group_ingress_rule" "private_subnet_https" {
      + cidr_ipv4   = "10.0.11.0/24"
      + from_port   = 443
      + ip_protocol = "tcp"
      + to_port     = 443
    }

  # aws_cloudwatch_log_group.app will be created
  + resource "aws_cloudwatch_log_group" "app" {
      + name              = "/aws/app/dp-billing-prod"
      + retention_in_days = 90
      + tags              = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "owner"       = "platform"
          + "service"     = "billing"
        }
    }
```

The plan shows evaluated results: the generated name, the selected retention number, the merged tags, and the filtered subnets. This is the proof that your expressions produced the values you intended.

## Putting It All Together
<!-- section-summary: Expressions are safest when they create clear values that resources and outputs consume visibly. -->

Expressions are Terraform's value language. Use them to build names, merge tags, filter maps, choose environment settings, and connect resources. Keep important expressions named with locals so reviewers can trace the path from variable input to resource argument to plan output.

For official reference, use Terraform's docs for [expressions](https://developer.hashicorp.com/terraform/language/expressions), [functions](https://developer.hashicorp.com/terraform/language/functions), [for expressions](https://developer.hashicorp.com/terraform/language/expressions/for), and [conditional expressions](https://developer.hashicorp.com/terraform/language/expressions/conditionals).
