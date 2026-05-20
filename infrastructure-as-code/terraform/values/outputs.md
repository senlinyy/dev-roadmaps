---
title: "Outputs"
description: "Expose selected Terraform results for humans, automation, and parent modules without turning every resource attribute into a public contract."
overview: "Outputs are the values a module intentionally sends outward after Terraform plans or applies. This article uses the orders AWS environment to expose VPC, security group, and instance details with enough context for review and reuse."
tags: ["terraform", "opentofu", "outputs", "modules", "aws"]
order: 5
id: article-infrastructure-as-code-terraform-outputs
---

## Table of Contents

1. [What Should Leave the Module](#what-should-leave-the-module)
2. [Outputs](#outputs)
3. [Root Module Outputs](#root-module-outputs)
4. [Child Module Outputs](#child-module-outputs)
5. [Output Shape](#output-shape)
6. [Reading Outputs](#reading-outputs)
7. [Common First Mistakes](#common-first-mistakes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Should Leave the Module

The orders Terraform module can now receive values and derive internal names and tags. After apply, it creates real AWS objects: a VPC, a security group, and an EC2 instance.

That creates a different question: which results should other people or tools be allowed to depend on?

The answer is usually smaller than the full resource. A deployment script may need the instance ID. A parent module may need the VPC ID. A runbook may need the security group ID when checking network rules. Nobody needs every computed attribute from every resource printed after every apply.

Outputs make that boundary explicit. They say which values leave the module as part of its interface.

## Outputs

An output block gives a name to a value that Terraform should expose from the module.

```hcl
output "vpc_id" {
  description = "ID of the VPC created for this environment."
  value       = aws_vpc.main.id
}
```

The name `vpc_id` is how callers and humans refer to the output. The description explains what the value is for. The `value` expression can refer to resources, variables, locals, data sources, and other expressions available inside the module.

For the orders environment, useful outputs might be:

```hcl
output "vpc_id" {
  description = "ID of the VPC created for this environment."
  value       = aws_vpc.main.id
}

output "web_security_group_id" {
  description = "ID of the security group attached to the web instance."
  value       = aws_security_group.web.id
}

output "web_instance_id" {
  description = "ID of the web EC2 instance."
  value       = aws_instance.web.id
}

output "web_instance_private_ip" {
  description = "Private IPv4 address assigned to the web instance."
  value       = aws_instance.web.private_ip
}
```

These outputs are chosen because someone outside the resource block has a realistic reason to use them. The VPC ID can connect later networking resources. The security group ID can be passed to another module or inspected in AWS. The instance ID and private IP can help operations find the running server.

## Root Module Outputs

When outputs live in the root module, Terraform shows them after apply and makes them available through the `terraform output` command.

A simple apply result might end like this:

```text
Apply complete! Resources: 4 added, 0 changed, 0 destroyed.

Outputs:

vpc_id = "vpc-0abc1234def567890"
web_instance_id = "i-0123456789abcdef0"
web_instance_private_ip = "10.0.12.45"
web_security_group_id = "sg-0789abcd1234ef567"
```

The output is not a separate AWS object. It is Terraform showing selected values from state. If the instance is replaced later, the output value can change because it points at the current resource attribute.

This is useful for humans, but it also creates dependencies. If a runbook, script, dashboard, or another Terraform module starts using `web_instance_private_ip`, that output becomes part of the module contract. Rename it or remove it carefully.

## Child Module Outputs

Outputs become more important when modules are reused.

Imagine the VPC resources move into a child module:

```hcl
module "network" {
  source = "../modules/network"

  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  tags        = local.common_tags
}
```

The child module can expose the VPC ID:

```hcl
output "vpc_id" {
  description = "ID of the VPC created by this module."
  value       = aws_vpc.main.id
}
```

The parent module can then use that output:

```hcl
resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Web ingress for the orders service."
  vpc_id      = module.network.vpc_id
}
```

The reference `module.network.vpc_id` means the network module intentionally exposed `vpc_id`. The parent does not need to know the child module's internal resource name. The child can keep `aws_vpc.main` as an implementation detail while still giving the parent the VPC ID it needs.

For a root module to show a child module output through `terraform output`, the root module must define its own output:

```hcl
output "vpc_id" {
  description = "ID of the orders environment VPC."
  value       = module.network.vpc_id
}
```

That extra step is useful. It lets the root module decide which child outputs are part of the environment's public surface.

## Output Shape

Outputs can return simple strings, numbers, booleans, lists, maps, or objects. The shape should match how the value will be used.

Several separate outputs are easy to read in the CLI:

```hcl
output "vpc_id" {
  description = "ID of the VPC created for this environment."
  value       = aws_vpc.main.id
}

output "web_security_group_id" {
  description = "ID of the security group attached to the web instance."
  value       = aws_security_group.web.id
}
```

An object output can make related values travel together:

```hcl
output "web_instance" {
  description = "Selected identifiers and addresses for the web instance."

  value = {
    id         = aws_instance.web.id
    private_ip = aws_instance.web.private_ip
    name       = "${local.name_prefix}-web"
  }
}
```

The object form is helpful when automation wants one structured payload. The separate form is helpful when humans use `terraform output` interactively. Choose the shape based on the consumer, not on how many attributes are available.

Avoid outputting whole resources:

```hcl
output "web_instance" {
  value = aws_instance.web
}
```

That makes the module leak provider-specific implementation details. It also exposes many values the module never meant to promise. A focused output is easier to keep stable.

## Reading Outputs

The `terraform output` command reads output values from state.

Listing all root outputs is useful after apply:

```bash
terraform output
```

Reading one value by name is useful in scripts:

```bash
terraform output -raw web_instance_id
```

Reading JSON is useful when automation needs structured data:

```bash
terraform output -json
```

These commands do not ask AWS for fresh values. They read Terraform state. If state is stale, outputs are stale too. A normal plan refreshes provider data before showing changes, but the output command itself is a state reader.

That behavior matters during debugging. If the EC2 instance was changed outside Terraform, an old output can mislead you until Terraform refreshes state during a plan or apply.

## Common First Mistakes

**Outputting every attribute.** Outputs should expose values with a real outside consumer. A module that prints everything is harder to change safely.

**Using outputs for internal wiring.** Resources inside the same module can reference each other directly. Outputs are for values leaving the module.

**Forgetting root module re-exports.** A child module output is available to the parent as `module.<name>.<output>`. It appears in `terraform output` only if the root module defines an output for it.

**Changing output names casually.** Scripts and parent modules may depend on output names. Rename outputs with the same care as variable names.

**Printing secrets as ordinary outputs.** A password output should be rare and marked sensitive when it is truly needed. The next article explains why that still does not make it safe storage.

## Putting It All Together

The orders module now has values moving in both directions.

Inputs bring environment choices in:

```hcl
variable "vpc_cidr" {
  description = "IPv4 CIDR block for this environment VPC."
  type        = string
}
```

Locals name internal decisions:

```hcl
locals {
  name_prefix = "orders-${var.environment}"
}
```

Outputs send selected results out:

```hcl
output "vpc_id" {
  description = "ID of the VPC created for this environment."
  value       = aws_vpc.main.id
}

output "web_security_group_id" {
  description = "ID of the security group attached to the web instance."
  value       = aws_security_group.web.id
}

output "web_instance_id" {
  description = "ID of the web EC2 instance."
  value       = aws_instance.web.id
}
```

That gives the module a clear interface. A caller can provide the VPC CIDR and instance type. The module can derive names and tags. After apply, the module can expose the VPC ID, security group ID, and instance ID without exposing every internal detail.

## What's Next

The final article in this values submodule covers sensitive values. Variables and outputs can hide values from normal display, but Terraform state and automation logs still need careful handling, especially for database passwords and other secrets.

---

**References**

- [Use outputs to expose Terraform data](https://developer.hashicorp.com/terraform/language/values/outputs) - Terraform guide to output values and how parent modules consume child module outputs.
- [Output block reference](https://developer.hashicorp.com/terraform/language/block/output) - Language reference for output block arguments, including descriptions, value expressions, sensitivity, and validation.
- [terraform output command reference](https://developer.hashicorp.com/terraform/cli/commands/output) - CLI reference for reading root module output values from state.
- [Manage values in modules](https://developer.hashicorp.com/terraform/language/values) - Terraform overview of how inputs, locals, and outputs define module boundaries.
