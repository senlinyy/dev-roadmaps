---
title: "Child Modules"
description: "Build a reusable Terraform child module for an AWS web server pattern while keeping inputs, outputs, and review boundaries clear."
overview: "Child modules package repeated infrastructure shapes. This article follows a small AWS web server module so you can see what belongs in the module, what stays visible in the root module, and how refactors affect state addresses."
tags: ["terraform", "opentofu", "aws", "modules", "reuse"]
order: 1
id: article-infrastructure-as-code-terraform-modules-and-reuse
aliases:
  - modules-and-reuse
  - infrastructure-as-code/terraform/modules-and-reuse.md
---

## Table of Contents

1. [Why Modules Matter](#why-modules-matter)
2. [Root and Child Modules](#root-and-child-modules)
3. [A Small Web Server Module](#a-small-web-server-module)
4. [Module Contract](#module-contract)
5. [Inputs](#inputs)
6. [Outputs](#outputs)
7. [Reuse Judgment](#reuse-judgment)
8. [Refactors](#refactors)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Modules Matter

The orders team has one small AWS web server in Terraform. Then the billing team asks for the same shape. A week later, the notifications team asks too. Each service needs an EC2 instance in a subnet, a security group that allows HTTP from approved CIDR ranges, and the same tags for ownership and cost reporting.

The first copy is easy. The third copy is where the review problem starts:

- One service changes the instance size in one file but forgets the matching tag.
- Another service leaves a wider CIDR range in a copied security group rule.
- A reviewer has to compare similar blocks across several directories to see which differences are intentional.

What should the team reuse, and what should stay visible for each service? Terraform's answer is a child module. A child module packages a repeated resource shape, while the root module still chooses the environment values that reviewers need to see.

## Root and Child Modules

A root module is the directory where Terraform runs. When you run `terraform plan` or `terraform apply` in a directory, the `.tf` files in that directory form the root module for that operation.

A child module is a module called by another module. The root module uses a `module` block to say, "Load this other collection of Terraform files and create the resources described there."

In the orders service, the root module can call a reusable web server module:

```hcl
module "web" {
  source = "../../modules/aws-web-server"

  name_prefix   = "orders-dev"
  ami_id        = var.web_ami_id
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public.id
  instance_type = "t3.micro"
  allowed_cidrs = ["10.0.0.0/16"]
  common_tags   = local.common_tags
}
```

The `source` line points at the child module directory. The rest of the arguments are inputs. They are the choices this root module is making for this service and environment.

The root module still owns the context. It decides which AWS provider configuration is active, which backend stores state, which VPC and subnet are used, and which values are safe for dev or prod. The child module owns the repeated shape: the security group, the ingress rule, the instance, and the outputs that other code may need.

That separation is the main idea. A module should remove repeated implementation details without hiding the decisions that carry risk.

## A Small Web Server Module

A module is a directory of Terraform files. It can contain resources, variables, outputs, locals, data sources, and nested module calls. A simple repository might keep reusable modules beside the live root modules:

```text
infra/
  modules/
    aws-web-server/
      main.tf
      variables.tf
      outputs.tf
  live/
    dev/
      main.tf
    prod/
      main.tf
```

The `modules/aws-web-server` directory describes the repeated pattern. It does not know whether it is being used by orders dev, billing prod, or a temporary test environment. It only knows the values passed into it.

Inside the child module, the resources can use those values:

```hcl
resource "aws_security_group" "this" {
  name   = "${var.name_prefix}-web"
  vpc_id = var.vpc_id

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-web"
  })
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each = toset(var.allowed_cidrs)

  security_group_id = aws_security_group.this.id
  cidr_ipv4         = each.value
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_instance" "this" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id

  vpc_security_group_ids = [aws_security_group.this.id]

  tags = merge(var.common_tags, {
    Name = "${var.name_prefix}-web"
  })
}
```

This snippet is deliberately small. The important detail is where each value comes from. `var.vpc_id`, `var.subnet_id`, `var.allowed_cidrs`, `var.ami_id`, and `var.instance_type` are inputs. The child module creates the same resource shape each time, but the root module decides which image, network, size, and access range apply.

If the team later improves the tagging pattern or the security group naming convention, it can change the child module once. Each root module that calls it can get that improvement after a review and plan.

## Module Contract

A module contract is the set of inputs the module accepts and outputs it returns. It is the part of the module that callers depend on.

For the web server module, the contract might look like this:

| Direction | Name | Meaning |
| --- | --- | --- |
| Input | `name_prefix` | Prefix used for names and tags |
| Input | `ami_id` | AMI used for the EC2 instance |
| Input | `vpc_id` | VPC where the security group belongs |
| Input | `subnet_id` | Subnet where the instance launches |
| Input | `instance_type` | EC2 instance size |
| Input | `allowed_cidrs` | CIDR ranges allowed to reach HTTP |
| Input | `common_tags` | Tags applied to created resources |
| Output | `instance_id` | ID of the created EC2 instance |
| Output | `security_group_id` | ID of the created security group |

The contract should make important choices visible. If the child module hardcodes `allowed_cidrs`, a reviewer may miss who can reach the instance. If the root module passes `allowed_cidrs`, the access decision is visible where the environment is defined.

The contract should also avoid exposing every internal detail. If callers depend on every attribute inside the child module, changing the module becomes harder later. A useful module contract is narrow enough to preserve the module's freedom to change, and clear enough that callers can still wire real systems together.

## Inputs

Child module inputs are Terraform variables. They belong in the child module's `variables.tf` file.

```hcl
variable "name_prefix" {
  description = "Prefix used for names and tags."
  type        = string
}

variable "ami_id" {
  description = "AMI used for the web server instance."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the web security group."
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID for the web server instance."
  type        = string
}

variable "allowed_cidrs" {
  description = "CIDR ranges allowed to reach the web server over HTTP."
  type        = list(string)
}

variable "common_tags" {
  description = "Tags applied to every resource in the module."
  type        = map(string)
}
```

Types matter because they turn a module contract into something Terraform can check. `allowed_cidrs` is a list of strings. `common_tags` is a map of strings. If a caller passes a single string where the module expects a list, Terraform can stop before the plan becomes misleading.

Input names should describe the caller's decision. `allowed_cidrs` tells the caller exactly what is being decided. A vague name like `rules` forces the caller to inspect module internals before understanding the risk.

Defaults need the same care. A default is useful for harmless repetition, such as a standard port or a tag map that can be empty. A default is risky when it hides an environment choice. Production instance size, CIDR ranges, and AMI selection are usually better passed explicitly by the root module.

## Outputs

Outputs return selected values from the child module to its caller. They belong in the child module's `outputs.tf` file.

```hcl
output "instance_id" {
  description = "ID of the web server instance."
  value       = aws_instance.this.id
}

output "security_group_id" {
  description = "ID of the web server security group."
  value       = aws_security_group.this.id
}
```

The root module can then reference those outputs:

```hcl
output "web_instance_id" {
  value = module.web.instance_id
}
```

Outputs are useful when another part of the root module needs a value for wiring, review, or automation. The instance ID may be useful for deployment scripts. The security group ID may be needed by another module that creates load balancer rules.

Outputs are also dependencies. Once callers rely on an output, removing or changing it can break them. Avoid returning every internal resource attribute. Return the values that make the caller's job possible, and keep the rest inside the child module.

## Reuse Judgment

A module is useful when it packages a real repeated pattern. The web server module earns its place if several services need the same security group shape, tagging rules, EC2 settings, and outputs.

The module is weaker if it hides one resource behind another name:

```hcl
module "bucket" {
  source = "../../modules/s3-bucket"

  name = "orders-dev-artifacts"
}
```

If the child module only passes `name` into one `aws_s3_bucket` resource, the root module may be clearer with the resource block directly in place. A module should reduce meaningful duplication, enforce a shared pattern, or make a risky shape easier to review.

The strongest signal is the review. If a reviewer can now focus on `allowed_cidrs`, `instance_type`, and the module version instead of reading the same EC2 and security group blocks again, the module helped. If the reviewer has to open several extra files to understand one simple resource, the module made the change harder to inspect.

## Refactors

Moving existing resources into a child module changes Terraform addresses.

Before the refactor, state may contain these addresses:

```text
aws_instance.web
aws_security_group.web
```

After the resource blocks move into `modules/aws-web-server`, the addresses become:

```text
module.web.aws_instance.this
module.web.aws_security_group.this
```

Terraform sees addresses as the identity of managed objects. The real EC2 instance may be the same intended server, but Terraform needs an explicit mapping from the old address to the new address.

Use `moved` blocks when the real object should stay and only the Terraform address is changing:

```hcl
moved {
  from = aws_instance.web
  to   = module.web.aws_instance.this
}

moved {
  from = aws_security_group.web
  to   = module.web.aws_security_group.this
}
```

The plan should then show address moves rather than destroy and create actions. This is one of the most important module gotchas. A refactor that looks like file cleanup can become real infrastructure replacement if state addresses are not handled.

## Common First Mistakes

Beginners usually struggle less with module syntax than with module boundaries.

**Creating a module for every resource.** A module should package a repeated shape. A one-resource wrapper often adds indirection without improving review.

**Hiding environment decisions.** CIDR ranges, instance sizes, subnet choices, and access rules usually belong at the root module call site.

**Using loose input types.** `any` feels flexible, but it removes checks that help callers use the module safely. Prefer specific types when the contract is known.

**Returning every internal value.** Outputs become caller dependencies. Expose the values that callers need, and keep internal details private.

**Refactoring without state moves.** Moving resources into a module changes addresses. Preserve the state binding when the real object should remain in place.

## Putting It All Together

The orders team started with a copying problem. Several services needed the same AWS web server shape, and each copy made review harder.

A child module solves that problem when it keeps the right boundary:

- The child module owns repeated implementation details: the security group, EC2 instance, tags, and selected outputs.
- The root module owns environment context: provider configuration, state, VPC, subnet, instance size, CIDR ranges, and credentials.
- Inputs make caller choices visible.
- Outputs return only the values callers need.
- Refactors need `moved` blocks so Terraform connects old addresses to new module addresses.

The goal is reusable infrastructure that remains reviewable. A module should make the AWS design easier to understand, not harder to inspect.

## What's Next

The next article focuses on where child modules come from. Local paths, registry addresses, Git URLs, and version constraints all change how a team reviews module code and upgrades it safely.

---

**References**

- [Modules overview](https://developer.hashicorp.com/terraform/language/modules) - Terraform overview of root modules, child modules, sources, and module workflow.
- [Use modules in your configuration](https://developer.hashicorp.com/terraform/language/modules/configuration) - Terraform documentation for calling modules, passing inputs, referencing outputs, and moving state into modules.
- [Develop modules](https://developer.hashicorp.com/terraform/language/modules/develop) - Terraform guidance for reusable module structure and module authoring.
- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform language reference for variable blocks, types, defaults, validation, and value assignment.
- [Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Terraform language reference for output blocks and caller-facing values.
- [Refactor modules](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring) - Terraform documentation for `moved` blocks during resource and module refactors.
