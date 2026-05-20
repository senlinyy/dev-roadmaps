---
title: "Value Flow"
description: "Understand how Terraform values enter a module, become internal decisions, leave as outputs, and stay protected when sensitive."
overview: "This orientation article gives the values submodule one complete map before the deeper articles on input variables, variable passing, locals, outputs, and sensitive values."
tags: ["terraform", "opentofu", "aws", "variables", "locals", "outputs"]
order: 1
id: article-infrastructure-as-code-terraform-variables-locals-outputs
aliases:
  - infrastructure-as-code/terraform/variables-locals-outputs.md
---

## Table of Contents

1. [Why Value Flow Matters](#why-value-flow-matters)
2. [Input Variables](#input-variables)
3. [Locals](#locals)
4. [Outputs](#outputs)
5. [Sensitive Values](#sensitive-values)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## Why Value Flow Matters

The same AWS web environment needs different values in dev and prod. Dev might use a smaller EC2 instance and a sandbox CIDR range. Prod might use a larger instance, a different VPC range, and stricter access rules. Copying the whole Terraform configuration for each environment makes review noisy.

Terraform values have direction. Some values enter from outside the module. Some are derived inside the module. Some leave after apply because humans, automation, or parent modules need them. Sensitive values need extra care because hiding terminal output does not remove them from state.

This article gives the map before the deeper values articles.

## Input Variables

Input variables bring outside choices into a module.

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
```

Resources use those values through the `var.` prefix:

```hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type
}
```

Variables are part of the module interface. If a value should differ by environment, account, or caller, a variable may be appropriate.

## Locals

Local values name decisions inside a module.

```hcl
locals {
  name_prefix = "orders-${var.environment}"

  common_tags = {
    Service     = "orders"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

Resources use locals through the `local.` prefix:

```hcl
tags = merge(local.common_tags, {
  Name = "${local.name_prefix}-web"
})
```

Locals are useful for derived values, repeated names, and shared tags. They should make internal decisions clearer. They should not hide choices the caller needs to make.

## Outputs

Outputs expose selected values after Terraform finishes.

```hcl
output "web_instance_id" {
  description = "ID of the web server instance."
  value       = aws_instance.web.id
}
```

Outputs help humans inspect results, help automation read values, and let parent modules connect child modules together. They are part of the module interface, so expose values deliberately.

## Sensitive Values

Terraform can mark variables and outputs as sensitive:

```hcl
variable "db_password" {
  description = "Database password."
  type        = string
  sensitive   = true
}
```

Sensitive values are hidden from normal CLI display. They can still appear in state when Terraform needs them to manage resources. Protect the backend and avoid using Terraform as long-term secret storage.

## Putting It All Together

Terraform value flow has four main parts.

- Input variables bring choices into the module.
- Variable files, CLI flags, environment variables, and defaults decide the actual values.
- Locals name derived decisions inside the module.
- Outputs expose selected values after apply.
- Sensitive flags control display, while state protection still matters.

The deeper articles split these jobs apart so each one gets the attention it needs.

## What's Next

The next article focuses on input variables: names, descriptions, types, defaults, validation, and the decisions that belong in a module interface.

---

**References**

- [Manage values in modules](https://developer.hashicorp.com/terraform/language/values) - Terraform overview of input variables, local values, and output values.
- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform language reference for variable declarations, types, defaults, validation, and sensitive variables.
- [Local values](https://developer.hashicorp.com/terraform/language/values/locals) - Terraform language reference for local values and local expressions.
- [Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Terraform language reference for output declarations, descriptions, and sensitive outputs.
