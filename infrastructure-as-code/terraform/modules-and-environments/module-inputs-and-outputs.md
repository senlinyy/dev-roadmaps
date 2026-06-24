---
title: "Module Inputs and Outputs"
description: "Define variable types, validation rules, and structured outputs so your Terraform modules have a clear, safe contract with callers."
overview: "A reliable module has an interface that is boring in the best way: clear inputs, helpful validation, careful handling for sensitive values, and outputs that expose only the values callers need."
tags: ["modules", "variables", "outputs", "validation", "terraform"]
order: 2
id: article-iac-terraform-modules-inputs-outputs
---

## Table of Contents

1. [The Contract Between a Module and Its Caller](#the-contract-between-a-module-and-its-caller)
2. [Declaring Input Variables](#declaring-input-variables)
3. [Variable Types: Scalars, Collections, and Objects](#variable-types-scalars-collections-and-objects)
4. [Validation Rules](#validation-rules)
5. [Sensitive and Ephemeral Values](#sensitive-and-ephemeral-values)
6. [Declaring Outputs](#declaring-outputs)
7. [Chaining Module Outputs Into Other Modules](#chaining-module-outputs-into-other-modules)
8. [How Outputs Appear in the State File](#how-outputs-appear-in-the-state-file)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Contract Between a Module and Its Caller
<!-- section-summary: Inputs and outputs form the contract that lets callers use a module without depending on its internal resource layout. -->

A **module contract** is the set of inputs callers may provide and outputs callers may read. The contract matters because it is the part of the module other teams build around. The resources inside the module can change over time, but the inputs and outputs should change carefully.

Picture the Orders platform team building a load balancer module. The service team wants HTTPS traffic, health checks, and access logs, and the root configuration should only provide the VPC, subnets, domain name, and a few behavior choices. The module should return values such as the load balancer DNS name and target group ARN. Listener rules and target group settings can stay inside the module.

![A Terraform module contract maps caller inputs to selected outputs while internal resources stay private.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/module-contract-shape.png)

*The contract is the part callers depend on: the variables they set and the outputs they can wire into other resources.*

This contract gives both sides room to work. The caller can read `variables.tf` and know what it must supply. The module author can improve internals without making every caller edit their root configuration. In a real platform team, that is the difference between a reusable module and a shared file that everyone is afraid to change.

## Declaring Input Variables
<!-- section-summary: Input variables name the values callers can provide and let Terraform check those values before provider APIs run. -->

An **input variable** is one value the caller can pass into a module. The `variable` block gives that input a name, type, description, and optional default. Terraform uses the variable name as the argument name in the module call.

For the load balancer module, the caller needs to tell the module where to deploy and how to expose the service:

```hcl
variable "vpc_id" {
  type        = string
  description = "ID of the VPC where the load balancer runs."
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the load balancer, usually one per availability zone."
}

variable "domain_name" {
  type        = string
  description = "Public DNS name for the application, for example orders.example.com."
}

variable "enable_access_logs" {
  type        = bool
  description = "Whether the module writes load balancer access logs."
  default     = true
}
```

The `type` line gives Terraform an early check. If a caller passes one subnet string where the module expects `list(string)`, Terraform can stop during planning with an input error. That feedback is much clearer than waiting for the AWS provider to reject a malformed API request later.

The `description` line acts as small built-in documentation. Teams that generate module docs from Terraform files also use these descriptions directly. A useful description tells the caller what the value represents and how to choose it. Good descriptions add context beyond the variable name.

The `default` line changes a required input into an optional input. In the example, access logs default to enabled because the platform team wants production-safe behavior by default. Callers can still set `enable_access_logs = false` in a disposable test environment if the team allows that.

## Variable Types: Scalars, Collections, and Objects
<!-- section-summary: Terraform types describe the shape of module inputs, from simple strings to structured objects that keep related settings together. -->

Terraform input types help the module say what shape of data it accepts. **Scalar types** hold one value: `string`, `number`, or `bool`. **Collection types** hold several values, such as `list(string)`, `set(string)`, and `map(string)`. **Structural types** such as `object({...})` let the module group related settings under one variable.

Collections become useful as soon as the infrastructure has repeated pieces. A load balancer usually spans multiple subnets, so `subnet_ids = list(string)` is clearer than `subnet_a_id`, `subnet_b_id`, and `subnet_c_id`. Tags usually arrive as a key-value map, so `map(string)` matches how cloud teams review ownership, cost, and environment labels.

```hcl
variable "tags" {
  type        = map(string)
  description = "Tags applied to resources created by this module."
  default     = {}
}
```

A caller can then pass the tags as one map:

```hcl
module "load_balancer" {
  source = "./modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  domain_name = "orders.example.com"

  tags = {
    service     = "orders"
    environment = "prod"
    owner       = "platform"
  }
}
```

Objects help when several settings belong together. A health check has a path, interval, and threshold values. Passing those settings as one `health_check` object makes the call easier to read and keeps the module interface from growing a long list of loose variables.

```hcl
variable "health_check" {
  type = object({
    path                = string
    interval_seconds    = number
    healthy_threshold   = number
    unhealthy_threshold = number
  })

  default = {
    path                = "/health"
    interval_seconds    = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  description = "HTTP health check settings for the application target group."
}
```

The broad `any` type gives Terraform very little to check. It can help in rare wrapper modules where the shape genuinely has to pass through untouched, but most shared modules should choose explicit types. Clear types give callers better errors and give reviewers a faster way to understand the interface.

## Validation Rules
<!-- section-summary: Validation rules check both input shape and operational meaning before provider APIs run. -->

A type check answers "is this value the right shape?" A **validation rule** answers "is this value allowed for this module?" Both checks happen before Terraform changes infrastructure, which makes validation a cheap way to catch mistakes.

For the load balancer module, the platform team wants `environment` to come from an approved list and production to use access logs. Those rules encode review standards directly into the module interface.

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment for this load balancer."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "enable_access_logs" {
  type        = bool
  description = "Whether the module writes load balancer access logs."
  default     = true

  validation {
    condition     = var.environment != "prod" || var.enable_access_logs
    error_message = "Production load balancers must keep access logs enabled."
  }
}
```

The error message should tell the caller what acceptable input looks like. "Invalid value" sends people searching through module internals. "Production load balancers must keep access logs enabled" tells the caller exactly which team rule they hit.

The second validation compares two variables, `environment` and `enable_access_logs`. Terraform 1.9 and newer support that kind of cross-object validation. Teams with an older `required_version` usually group related settings into one object variable, use resource preconditions, or enforce the rule in policy-as-code until they can upgrade.

Validation works best for facts the module can check from inputs and known values. It is a good fit for naming patterns, allowed environments, CIDR ranges, minimum instance counts, and required production controls. Provider facts that become known only after apply belong in resource arguments, provider validation, tests, or policy checks rather than variable validation.

![Terraform variable checks catch shape errors, policy-like input mistakes, and sensitive display risks before apply.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/validation-sensitive-flow.png)

*Validation turns team rules into early feedback, while sensitivity controls keep routine output cleaner.*

## Sensitive and Ephemeral Values
<!-- section-summary: Sensitive values hide routine display, while state access still needs protection because Terraform may store the underlying data. -->

A **sensitive variable** tells Terraform to redact the value in normal plan and apply output. Passwords, API tokens, private keys, and connection strings are common examples. The redaction helps logs and terminal output, especially when CI stores plan output for reviewers.

```hcl
variable "database_password" {
  type        = string
  sensitive   = true
  description = "Password used by the application database user."
}
```

Sensitive marking follows the value. If the password flows into a local value or resource argument, Terraform treats the derived expression as sensitive in normal output too. That behavior helps keep accidental display under control as the value moves through the module.

The sensitive flag primarily controls display. Terraform state can still contain sensitive values because providers often need those values to compare desired configuration with real infrastructure. Teams still need protected remote state, tight IAM access, encryption, and careful handling of saved plan files.

Current Terraform also supports **ephemeral** input variables for values that should stay out of state and plan files, with restrictions on where those values can flow. Provider-supported write-only arguments can use this pattern for secrets that exist only during an operation. In production, teams combine these features with a real secret manager rather than putting long-lived secrets in `.tfvars` files.

## Declaring Outputs
<!-- section-summary: Outputs expose selected values from a module so callers can wire resources together without depending on internals. -->

An **output** is one value the module intentionally returns. Outputs are the public exit points of the module. If the load balancer module creates listeners, target groups, security groups, and logs, it still might expose only two outputs: the DNS name and the target group ARN.

```hcl
output "load_balancer_dns_name" {
  value       = aws_lb.this.dns_name
  description = "DNS name assigned to the load balancer."
}

output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "ARN of the target group that receives application traffic."
}
```

The output value can be a resource attribute, a list, a map, or a shaped object. A module that creates several subnets might return a map keyed by tier or availability zone. That often gives callers a more stable contract than returning a raw list whose order the caller has to remember.

Outputs should stay purposeful. Exposing every internal resource attribute creates a wide public surface that callers start depending on. A later refactor then breaks callers that reached for details the module author never intended to support. A strong module exposes what the next root configuration or module genuinely needs and keeps the rest internal.

Outputs can also be marked sensitive:

```hcl
output "database_connection_string" {
  value       = "postgres://${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  sensitive   = true
  description = "Database endpoint string for application configuration."
}
```

Sensitive outputs still work in expressions. Terraform hides them from casual display, but callers with access to the configuration and state boundary can still use them. This is useful for reducing accidental leakage, while state access remains the real security control.

## Chaining Module Outputs Into Other Modules
<!-- section-summary: The root module wires outputs from one child module into inputs on another child module, which keeps the children independent. -->

**Chaining modules** means passing an output from one module into an input on another module. The root configuration does the wiring. The child modules stay independent because the network module can publish subnet IDs without knowing whether a load balancer, database, or compute module will consume them.

![A root configuration wires network outputs into load balancer, compute, and database module inputs.](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/output-chain-state-map.png)

*The root module is the integration layer. Child modules expose selected values, and the root decides how those values connect.*

Here is a root configuration that wires four modules together:

```hcl
module "network" {
  source = "./modules/network"

  environment = var.environment
  cidr_block  = var.cidr_block
}

module "load_balancer" {
  source = "./modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  domain_name = var.domain_name
}

module "database" {
  source = "./modules/database"

  subnet_ids = module.network.private_subnet_ids
  password   = var.database_password
}

module "compute" {
  source = "./modules/compute"

  subnet_ids        = module.network.private_subnet_ids
  target_group_arn  = module.load_balancer.target_group_arn
  database_endpoint = module.database.endpoint
}
```

Terraform reads those references and builds the dependency graph. The network must provide subnet IDs before the load balancer, database, and compute modules can use them. The compute module waits for the load balancer target group and database endpoint. The team gets the right order from references rather than a separate handwritten sequence.

This wiring style also improves code review. A reviewer can open the root module and see how the system is assembled. The network module stays focused on networking, the database module stays focused on database resources, and the root shows how the Orders service uses them together.

## How Outputs Appear in the State File
<!-- section-summary: Terraform evaluates outputs during planning and stores root output values in state after apply. -->

Terraform evaluates child module outputs as expressions during the plan. When a value already exists in state, Terraform can often show the value. When the value comes from a resource that will be created during the apply, Terraform may show it as known after apply until the provider returns the real value.

Root module outputs are stored in the root state after apply and shown at the end of a successful apply. Operators can read them later with `terraform output`. Teams often expose operational values this way, such as the load balancer DNS name, a service URL, or a monitoring dashboard URL.

Child module outputs are available to their caller. Terraform prints root outputs after apply, so the root re-exports the values it wants operators to see:

```hcl
output "orders_url" {
  value       = "https://${module.load_balancer.load_balancer_dns_name}"
  description = "HTTPS endpoint for the Orders service."
}
```

This pattern keeps the root output list useful. The team can surface the values humans need after apply while keeping noisy internal values available only for wiring.

## Putting It All Together
<!-- section-summary: A strong module contract keeps caller choices explicit, catches bad inputs early, and returns only stable values. -->

The Orders load balancer module now has a clear interface. Callers provide the VPC ID, subnet IDs, domain name, environment, tags, and health check settings. Validation catches unsupported environments and unsafe production logging choices before apply. Sensitive values stay redacted in routine output, while the team still protects remote state because Terraform may store underlying values.

The module exposes only the values other configurations need: DNS name, target group ARN, and maybe a security group ID if another module must attach to it. The root configuration wires those outputs into compute, DNS, and monitoring modules. The child modules stay focused, and the root remains the readable place where the full service comes together.

That is the practical goal: **small public contract, strong early checks, and stable outputs**. When a module has those three things, callers can use it confidently and module authors can improve it without surprising every environment.

## What's Next

The next article covers module versioning: how Registry versions, Git refs, version constraints, `terraform init -upgrade`, and `.terraform.lock.hcl` fit together when shared module code changes over time.

---

**References**

- [Input Variables (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables), Reference for variable blocks, defaults, validation, sensitivity, ephemeral variables, and value assignment.
- [Output Values (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/outputs), Reference for output blocks, sensitive outputs, and child module output usage.
- [Type Constraints (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/type-constraints), Details on primitive types, collections, structural types, optional object attributes, and `any`.
- [Manage Sensitive Data (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/manage-sensitive-data), Current guidance on sensitive values, ephemeral values, write-only arguments, state, and plan files.
- [Module Block Reference (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/block/module), Reference for passing module inputs and reading `module.<label>.<output>` values.
- [Terraform 1.9 variable validation improvements (HashiCorp Blog)](https://www.hashicorp.com/en/blog/terraform-1-9-enhances-input-variable-validations), Official HashiCorp announcement for cross-object references in input variable validation.
