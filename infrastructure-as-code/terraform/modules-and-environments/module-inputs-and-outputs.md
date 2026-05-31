---
title: "Module Inputs and Outputs"
description: "Define variable types, validation rules, and structured outputs so your Terraform modules have a clear, safe contract with callers."
overview: "A module is only as good as its interface. This article covers the full range of input variable types, how to validate them, how to set sensible defaults, and how outputs carry data back out to the caller or to other modules."
tags: ["modules", "variables", "outputs", "validation", "terraform"]
order: 2
id: article-iac-terraform-modules-inputs-outputs
---

## Table of Contents

1. [The Contract Between a Module and Its Caller](#the-contract-between-a-module-and-its-caller)
2. [Declaring Input Variables](#declaring-input-variables)
3. [Variable Types: Scalars, Collections, and Objects](#variable-types-scalars-collections-and-objects)
4. [Validation Rules](#validation-rules)
5. [Sensitive Variables](#sensitive-variables)
6. [Declaring Outputs](#declaring-outputs)
7. [Chaining Module Outputs Into Other Modules](#chaining-module-outputs-into-other-modules)
8. [What Happens to Outputs in the State File](#what-happens-to-outputs-in-the-state-file)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Contract Between a Module and Its Caller

A module contract is the boundary between what callers may provide as inputs and what the module returns as outputs.

When you write a module, you are making a promise to everyone who calls it. You are saying: give me these specific pieces of information and I will build the resources correctly, every time, no matter what environment you are running in. The caller only needs to understand the promise, not the internal machinery. The variables file is how you state the inputs you require. The outputs file is how you state what you give back.

![A module interface contract defines which inputs callers may set and which outputs the module exposes.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/module-contract.png)

This promise is called the module's interface, and it matters enormously as teams grow. If you change a variable's name or remove an output without warning, every configuration that calls the module breaks the next time someone runs `terraform plan`. Designing a thoughtful interface upfront saves your team from painful refactoring later.

Consider a module that provisions an application load balancer with SSL termination. The module needs to know the VPC to place the load balancer in, the subnets it should span, the domain name for the SSL certificate, and whether to keep access logs. Once built, the caller needs the load balancer's DNS name to point their DNS records at. Those four inputs and one output form the complete interface. Everything else, the target group health check config, the listener rules, the log group retention settings, is an internal detail that the caller should never have to think about.

## Declaring Input Variables

An input variable is one value the caller is allowed or required to pass into the module. The `variable` block names that input and defines its expected shape. Example: a load balancer module can require `vpc_id`, `subnet_ids`, and `domain_name` so it never guesses where it should run.

Variables are declared with a `variable` block. The block's label is the variable name. Terraform enforces that callers use this exact name when they pass values.

```hcl
variable "vpc_id" {
  type        = string
  description = "The ID of the VPC where the load balancer will be placed."
}

variable "subnet_ids" {
  type        = list(string)
  description = "List of subnet IDs across which the load balancer distributes traffic."
}

variable "domain_name" {
  type        = string
  description = "The domain name used to look up the ACM certificate for HTTPS."
}

variable "enable_access_logs" {
  type        = bool
  description = "Whether to write access logs to an S3 bucket."
  default     = false
}
```

The `type` field is not required, but you should almost always include it. Without a type, Terraform accepts any value, similar to `type = any`, and then tries to infer the type from how the value is used. That can lead to confusing errors later when the value is used in a context that expects a list or a number. With a type declared, Terraform validates the input immediately during the plan phase before it talks to any cloud API, so you get a clear error message right away instead of a cryptic provider error halfway through an apply.

The `description` field is also technically optional, but it serves as built-in documentation. When someone calls your module and wonders what `subnet_ids` means, they can run `terraform console` or look at the generated documentation to read the description. A good description answers the question "what should I pass here?" in one plain sentence.

The `default` field makes a variable optional. If a caller does not provide a value, Terraform uses the default. If there is no default, the variable is required, and Terraform will stop and ask for a value if none is provided. Design required variables for information that fundamentally differs between environments (like the VPC ID) and default values for sensible behaviors that most environments will want (like disabling access logs in development but enabling them in production).

## Variable Types: Scalars, Collections, and Objects

A variable type describes the shape of input a module accepts. Simple inputs can be strings, numbers, or booleans, while larger inputs can be lists, maps, sets, or objects. Example: `subnet_ids` is clearer as `list(string)` than as three separate variables named `subnet_1`, `subnet_2`, and `subnet_3`.

Terraform's type system covers more ground than simple strings and numbers. Understanding it lets you design module interfaces that pass complex structures cleanly rather than decomposing everything into a flat list of individual string variables.

**Scalar types** are the simplest. `string` is a text value. `number` accepts integers and decimals, Terraform is permissive here and will silently convert a string like `"3"` to the number `3`. `bool` accepts `true` or `false`.

**Collection types** hold multiple values of the same type. `list(string)` is an ordered list of strings, where order matters and duplicates are allowed. `set(string)` is an unordered collection of unique strings. Terraform removes duplicates from a set, and you should not rely on a set preserving the caller's original order. `map(string)` is a collection of string values each identified by a string key. You might use `map(string)` to pass a set of resource tags:

```hcl
variable "tags" {
  type = map(string)
  default = {}
  description = "A map of tags to apply to all resources created by this module."
}
```

And a caller would provide:

```hcl
module "load_balancer" {
  source = "./modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.web_subnet_ids
  domain_name = "app.example.com"

  tags = {
    environment = "production"
    team        = "platform"
    cost-center = "eng-infra"
  }
}
```

**Structural types** let you group related values under one variable. An `object` type defines a fixed structure with named attributes, each with its own type. This is useful when you want to pass a configuration bundle rather than many separate variables:

```hcl
variable "health_check" {
  type = object({
    path                = string
    healthy_threshold   = number
    unhealthy_threshold = number
    interval_seconds    = number
  })
  default = {
    path                = "/"
    healthy_threshold   = 3
    unhealthy_threshold = 2
    interval_seconds    = 30
  }
  description = "Health check settings for the load balancer target group."
}
```

A caller can now override the value by passing a full object. If they pass an object that is missing any of the required declared attributes, Terraform reports an error. If Terraform is converting a larger object into this object type, extra attributes can be discarded during conversion, so design object inputs carefully and document the exact attributes your module uses.

Object attributes can also be optional when the module has sensible defaults for only part of a nested object. That lets a caller set the health check path without repeating every threshold value. For module interfaces, optional object attributes are often clearer than using `any` and then trying to validate the shape manually.

**The `any` type** turns off type checking for that variable entirely. Avoid it. It removes Terraform's ability to give you useful error messages and makes the module harder to understand. Use it only as a last resort when you are wrapping a module that genuinely cannot know the shape of its inputs ahead of time.

## Validation Rules

A type constraint tells Terraform what shape a value should have. A validation rule tells Terraform what range of values makes sense. Both run during the plan phase, before any cloud API calls happen.

Validation is declared inside the variable block with one or more `validation` sub-blocks:

```hcl
variable "instance_count" {
  type        = number
  description = "Number of EC2 instances to create in the auto-scaling group."
  default     = 2

  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 20
    error_message = "Instance count must be between 1 and 20."
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment: must be dev, staging, or prod."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, or prod."
  }
}
```

The `condition` is any Terraform expression that evaluates to `true` or `false`. The `error_message` is the plain-English text that Terraform shows when the condition is false. Write error messages that tell the user exactly what value is acceptable, not just that the value is wrong.

Validation rules are particularly valuable in shared modules that multiple teams call. Without them, a caller might pass `0` for `instance_count` thinking it means "use the default," and Terraform would happily create an auto-scaling group with a minimum of zero instances, which deploys nothing. The validation rule catches this mistake before any money is spent.

Older Terraform versions allowed validation conditions to reference only the variable being validated. Current Terraform versions support cross-object references in variable validation, so you can write rules that compare related variables as long as the expression can be evaluated during planning:

```hcl
variable "environment" {
  type = string
}

variable "instance_count" {
  type = number

  validation {
    condition = (
      var.environment != "prod" || var.instance_count >= 2
    )
    error_message = "Production requires at least 2 instances for high availability."
  }
}
```

Keep validation focused on input correctness. If a rule needs information from resources that are only known after apply, it does not belong in a variable validation block.

## Sensitive Variables

A sensitive variable is an input Terraform should redact from normal output. It protects logs and terminal display, but it does not encrypt the value in state. Example: mark `db_password` sensitive so the plan shows `(sensitive value)` instead of the actual password.

Some variable values should never appear in terminal output, in logs, or in plan files that engineers might share. Database passwords, API keys, and private certificate contents all fall into this category.

Terraform marks a variable as sensitive by adding `sensitive = true` to the variable block:

```hcl
variable "db_password" {
  type        = string
  sensitive   = true
  description = "The master password for the RDS database instance."
}
```

When a variable is sensitive, Terraform replaces its value with `(sensitive value)` in normal plan and apply output, and in many error messages. The value is still stored in the state file, but it is marked with a sensitive flag that instructs the Terraform UI to hide it in casual display.

Sensitive values propagate automatically. If you pass a sensitive variable into a resource argument, that argument's value is also treated as sensitive in the plan output. If you use a sensitive variable in a local value, the local is also sensitive. You do not have to manually track where a secret flows; Terraform's type system tracks it for you.

There is one important limitation: Terraform marks a variable sensitive in its own output, but the state file often stores values in plain text. If your state file is accessible to people who should not see the database password, the `sensitive` flag alone does not protect it. You need to restrict access to the state file itself, for example, by using an S3 bucket with a strict IAM policy and server-side encryption. For temporary values that should not be stored in Terraform artifacts, use `ephemeral` inputs and provider-supported write-only arguments where they are available.

## Declaring Outputs

An output is one selected value a module returns to its caller. Outputs are the only supported way for callers to use resource details created inside a child module. Example: a load balancer module can return `load_balancer_dns_name`, while keeping listener rules and health check internals private.

Outputs give callers access to information produced by a module. They are declared with `output` blocks in the module's `outputs.tf` file:

```hcl
output "load_balancer_dns_name" {
  value       = aws_lb.this.dns_name
  description = "The DNS name assigned to the load balancer. Point your domain's CNAME record here."
}

output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "The ARN of the target group, used to register EC2 instances or ECS tasks."
}
```

The `value` field is any Terraform expression. It most commonly references an attribute of a resource created inside the module, but it can also be a processed value, a list comprehension, a string interpolation, or a conditional expression, that reshapes raw resource data into something more convenient for the caller.

You can also mark outputs as sensitive:

```hcl
output "rds_connection_string" {
  value       = "postgres://${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  sensitive   = true
  description = "Full database connection string. Treat as sensitive because callers may combine it with credentials."
}
```

A sensitive output is still accessible to callers, they can reference it in their own resources, but Terraform hides it from plain display in terminal output. This is useful when the output is an endpoint or hostname that, combined with credentials, could be used to access a protected resource.

## Chaining Module Outputs Into Other Modules

Chaining modules means wiring an output from one module into an input of another module at the root layer. This keeps modules independent while still letting them work together. Example: `module.network.vpc_id` can feed both the load balancer module and database module without either module knowing how the network was built.

One of the most powerful patterns in Terraform is passing one module's output directly as another module's input. This lets you build complex infrastructure from small, independent pieces without creating tight coupling between the pieces themselves.

![Root configurations can wire selected outputs from one module into another module without coupling to internals.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/output-wiring.png)

Here is a root configuration that chains three modules together:

```hcl
module "network" {
  source = "./modules/network"

  region          = var.region
  cidr_block      = "10.0.0.0/16"
  web_subnet_cidr = "10.0.1.0/24"
  db_subnet_cidr  = "10.0.2.0/24"
}

module "load_balancer" {
  source = "./modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = [module.network.web_subnet_id]
  domain_name = var.domain_name
}

module "database" {
  source = "./modules/database"

  vpc_id    = module.network.vpc_id
  subnet_id = module.network.db_subnet_id
  password  = var.db_password
}
```

Terraform reads these three module blocks and notices that `load_balancer` and `database` both depend on outputs from `network`. It automatically creates a dependency: the network module must complete before either the load balancer or the database module can begin. Terraform then runs the load balancer and database modules in parallel, since neither depends on the other.

You do not write any explicit `depends_on` to express this ordering. The reference `module.network.vpc_id` is enough for Terraform to infer the dependency. This automatic dependency tracking is one of the most useful things about the declarative model.

## What Happens to Outputs in the State File

Outputs become stored values in Terraform state after apply. The state stores the result, not the expression text that produced it. Example: an output expression like `aws_lb.this.dns_name` becomes the actual DNS name string assigned by AWS.

Root module outputs are written to the state file after a successful `terraform apply`. The state file stores the computed value, not the expression that produced it, but the actual string or list or map that the expression evaluated to.

Child module outputs are available to the calling module through expressions like `module.network.vpc_id`. Terraform evaluates those expressions from the resources and values inside the child module as part of the plan. If those values already exist in state, Terraform can often plan with the known values; if they depend on resources that will be created in the same apply, they may appear as `(known after apply)` until the provider returns them.

Root-level outputs, outputs declared directly in the root module rather than inside a child module, are shown to the user at the end of `terraform apply`. They are also accessible via `terraform output` after the fact. This is how you surface key information to the operators running the infrastructure: the load balancer's DNS name, the database's connection string (marked sensitive), or the public IP address of a bastion host that engineers need to connect through.

Child module outputs are not shown directly at the end of apply unless you re-export them from the root module. If you want the root module to surface `module.load_balancer.load_balancer_dns_name` to the user, you add an output block in the root module's `outputs.tf`:

```hcl
output "lb_dns_name" {
  value       = module.load_balancer.load_balancer_dns_name
  description = "Point your domain's CNAME record to this address."
}
```

## Putting It All Together

The load balancer module now has a clear interface. Callers pass four inputs: the VPC ID, the subnet IDs, the domain name, and optionally a health check configuration object. The module validates that the instance count is reasonable, marks the database password as sensitive, and exposes two outputs: the load balancer's DNS name and the target group ARN. None of the internal details, the listener rules, the access log group, the ACM certificate lookup, leak outside the module's boundary.

The root configuration chains three modules by passing outputs directly as inputs. Terraform reads these references, builds a dependency graph, and applies resources in the correct order without any manual instruction from you. When the apply finishes, the load balancer's DNS name appears as a root-level output so the infrastructure operator knows exactly where to point the DNS record.

This is the power of a well-designed module interface: simple inputs, clear validation, sensitive handling where needed, and outputs that give callers only what they need and nothing more. Callers stay insulated from implementation changes, and the module author can improve internals confidently.

## What's Next

With inputs and outputs covered, the next article looks at how modules express their own dependency on specific Terraform versions and provider versions, what version constraints mean, how to pin them, and why getting this wrong in a shared module can break callers across your entire organization.


![Module inputs and outputs summary: define inputs, validate shape, expose outputs, and chain safely.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/module-io-summary.png)

---

**References**

- [Input Variables (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables), Full reference for variable blocks, type system, defaults, and the sensitive flag.
- [Output Values (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/outputs), Reference for output blocks, sensitive outputs, and how they integrate with module chaining.
- [Type Constraints (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/type-constraints), Reference for collection ordering, object types, and optional object attributes.
- [Manage Sensitive Data (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/manage-sensitive-data), Current guidance on sensitive, ephemeral, and write-only value handling.
- [Custom Validation Rules (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables#custom-validation-rules), Documentation for the `validation` block syntax and the expressions allowed inside `condition`.
