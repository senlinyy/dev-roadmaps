---
title: "Module Contracts: Inputs and Outputs"
description: "Variable types, validation rules, and structured outputs give Terraform modules a clear, safe contract with callers."
overview: "A reliable module contract has inputs callers set, validation that catches mistakes early, careful handling for sensitive values, and outputs that expose only the values other code needs. This article shows the module side and the caller side together."
tags: ["modules", "variables", "outputs", "validation", "terraform"]
order: 2
id: article-iac-terraform-modules-inputs-outputs
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/module-inputs-and-outputs.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/module-inputs-and-outputs.md
---

## Table of Contents

1. [The Module Contract Between Caller and Module](#the-module-contract-between-caller-and-module)
2. [Declaring Input Variables](#declaring-input-variables)
3. [Using Types to Describe Shape](#using-types-to-describe-shape)
4. [Adding Validation Rules](#adding-validation-rules)
5. [Handling Sensitive Values](#handling-sensitive-values)
6. [Declaring Outputs](#declaring-outputs)
7. [Wiring Outputs Into Other Modules](#wiring-outputs-into-other-modules)
8. [Outputs and State](#outputs-and-state)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Module Contract Between Caller and Module
<!-- section-summary: Inputs and outputs form the contract that lets callers use a module without depending on its internal resource layout. -->

The private bucket module solved the copy-paste problem. Now the team has a new question: how do callers know which values they should provide and which values they can safely use afterward?

That public edge is the **module contract**. Inputs are the values callers pass in. Outputs are the values the module returns. The internal resources can change over time, but the contract should change slowly and intentionally because other Terraform code depends on it.

For the next example, the Orders team builds a load balancer module. The caller should provide the VPC, subnets, domain name, tags, and health check choices. The module should return the DNS name and target group ARN. Listener rules, target groups, access logs, and security settings can stay inside.

This split lets both sides work. The service root can wire the module without reading every internal resource. The module author can improve internals while keeping the same inputs and outputs.

In production, this contract is what other teams depend on. A renamed input can break every caller. A removed output can break another module that consumes it. Additive changes usually roll out in smaller steps, while removals and type changes need release notes, versioning, and a migration path.

## Declaring Input Variables
<!-- section-summary: Input variables name the values callers can provide and let Terraform check those values before provider APIs run. -->

An **input variable** is one value the caller can pass into a module. The variable block gives it a name, type, description, and optional default.

The first load balancer inputs are required because the module cannot safely guess them. The caller must choose the VPC, subnets, DNS name, and environment.

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

variable "environment" {
  type        = string
  description = "Deployment environment for tags, names, and policy checks."
}
```

Optional inputs come next. Tags can default to an empty map. Access logs default to enabled because logs are a production-safe baseline.

```hcl
variable "tags" {
  type        = map(string)
  description = "Extra tags applied to resources created by this module."
  default     = {}
}

variable "enable_access_logs" {
  type        = bool
  description = "Whether the module writes load balancer access logs."
  default     = true
}
```

Inside the module, resources consume those values through `var.<name>` references:

```hcl
resource "aws_lb" "this" {
  name               = "orders-${var.environment}"
  load_balancer_type = "application"
  subnets            = var.subnet_ids

  tags = merge(
    var.tags,
    {
      service     = "orders"
      environment = var.environment
    }
  )
}
```

The caller then passes values with matching argument names:

```hcl
module "load_balancer" {
  source = "../../modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  domain_name = "orders.example.com"
  environment = "prod"

  tags = {
    owner       = "platform"
    cost_center = "orders"
  }
}
```

The `default` on `enable_access_logs` makes that input optional. The default is enabled because access logs are a production-safe baseline. A test environment with a clear reason to skip logs can still set it explicitly.

Defaults should express a safe normal case. If a value must be chosen deliberately, leave out the default so Terraform asks the caller for it. For example, `vpc_id` and `subnet_ids` should be required because the module cannot safely guess where to place a load balancer.

## Using Types to Describe Shape
<!-- section-summary: Terraform types describe the shape of module inputs, from simple strings to structured objects that keep related settings together. -->

Terraform types give callers early feedback. A `string` accepts one string. A `number` accepts a number. A `bool` accepts true or false. Collections such as `list(string)` and `map(string)` hold multiple values.

Tags are a good map example:

```hcl
variable "tags" {
  type        = map(string)
  description = "Tags applied to resources created by this module."
  default     = {}
}
```

Health check settings belong in an object because the values move as one group:

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

This object keeps the module call readable:

```hcl
module "load_balancer" {
  source = "../../modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  domain_name = "orders.example.com"
  environment = "prod"

  health_check = {
    path                = "/ready"
    interval_seconds    = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}
```

Inside the module, the target group can consume the object one field at a time:

```hcl
resource "aws_lb_target_group" "app" {
  name     = "orders-${var.environment}"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    path                = var.health_check.path
    interval            = var.health_check.interval_seconds
    healthy_threshold   = var.health_check.healthy_threshold
    unhealthy_threshold = var.health_check.unhealthy_threshold
  }
}
```

The `any` type gives Terraform little to check in normal shared modules, so callers get less helpful errors. Explicit types give the interface a readable contract and lower the risk of accidental breaking changes.

Object types work well for fields reviewed together. A health check object keeps path, interval, and thresholds in one visible block. A loose set of unrelated variables can make module calls longer and can hide that several values must change as a group.

## Adding Validation Rules
<!-- section-summary: Validation rules check both input shape and operational meaning before provider APIs run. -->

Types answer whether a value has the right shape. **Validation rules** answer whether the value is allowed for this module.

![Validation Sensitive Flow](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/validation-sensitive-flow.png)

*The validation and sensitivity flow shows where Terraform can reject bad input and where secret handling still needs state protection.*

The load balancer module can allow only known environments:

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment for this load balancer."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}
```

The module can also protect production logging:

```hcl
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

That second validation compares two variables: `environment` and `enable_access_logs`. Cross-variable validation is available in Terraform 1.9 and later. If a shared module must support older Terraform 1.x projects, keep validation inside one object variable or move the rule to a resource precondition, a test, or policy check. The module should say its required Terraform version so callers do not copy a validation pattern their runtime cannot evaluate.

Error messages should tell the caller what to fix. A message like "invalid value" sends people into the module internals. A message that names the rule helps them correct the module call.

A caller mistake can now fail before provider APIs run:

```hcl
module "load_balancer" {
  source = "../../modules/load-balancer"

  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.public_subnet_ids
  domain_name        = "orders.example.com"
  environment        = "prod"
  enable_access_logs = false
}
```

The validation output points at the module call and repeats the rule:

```console
Error: Invalid value for variable

  on main.tf line 12, in module "load_balancer":
  12:   enable_access_logs = false

Production load balancers must keep access logs enabled.
```

That is the kind of failure a team wants in CI. The caller can fix one argument in the root module instead of discovering the issue from an AWS API error or a later security review.

Validation works well for environment names, CIDR ranges, allowed sizes, naming patterns, and required production controls. Provider facts that are known only after apply belong in provider arguments, resource preconditions, tests, or policy checks.

Validation should stay close to the caller's mistake. If the module accepts `domain_name`, the domain-shape rule belongs there. If the module accepts `desired_capacity`, the supported range rule belongs there. A fast Terraform validation error gives the caller a clear repair path before several resources have already been planned.

## Handling Sensitive Values
<!-- section-summary: Sensitive values hide routine display, while state access still needs protection because Terraform may store the underlying data. -->

A **sensitive variable** hides its value from normal plan and apply output:

```hcl
variable "database_password" {
  type        = string
  sensitive   = true
  description = "Password used by the application database user."
}
```

This helps with terminal output and CI logs. State still needs protection because a provider may store a password as it flows into a resource argument for future comparison.

Production modules are usually safer with secret references or provider-managed secrets. For example, `database_secret_arn` lets the application identity read the secret at runtime. If a raw secret must pass through Terraform during bootstrap, the run should stay small, the backend should have tight access control, and outputs should not print the value.

The caller can look up a secret record without reading the secret value:

```hcl
data "aws_secretsmanager_secret" "orders_database" {
  name = "/prod/orders/database-url"
}

module "compute" {
  source = "../../modules/compute"

  image               = var.orders_image
  database_secret_arn = data.aws_secretsmanager_secret.orders_database.arn
}
```

Inside the compute module, the task definition can pass that ARN to the runtime platform:

```hcl
variable "database_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing the database URL."
}

variable "image" {
  type        = string
  description = "Container image used by the Orders API task."
}

resource "aws_ecs_task_definition" "orders" {
  family = "orders-api"

  container_definitions = jsonencode([
    {
      name  = "orders"
      image = var.image
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = var.database_secret_arn
        }
      ]
    }
  ])
}
```

In that design, Terraform wires the reference and the running task reads the secret through its own identity. The Terraform state contains the ARN, not the secret string.

Current Terraform also supports **ephemeral input variables** and provider **write-only arguments** for specific secret workflows. Ephemeral input variables are available in Terraform 1.10 and later. An ephemeral input variable is available during the current operation, while Terraform omits it from plan and state artifacts. Write-only arguments require Terraform 1.11 or later and a resource argument that the provider marks as write-only. A provider write-only argument accepts a value during the operation and then avoids storing that value in Terraform artifacts for provider-supported write-only fields.

For example, a temporary database password can pass into a provider-supported write-only argument:

```hcl
variable "database_password" {
  type      = string
  sensitive = true
  ephemeral = true
}

resource "aws_db_instance" "example" {
  identifier          = "example-db"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  engine              = "postgres"
  username            = "app"
  password_wo         = var.database_password
  password_wo_version = 1
}
```

This is useful for bootstrap paths where the provider supports write-only arguments. Long-lived application secrets usually belong in secret managers with runtime identity because that gives teams a cleaner operating boundary.

A module that must accept a secret reference should name it as a reference. `database_secret_arn` tells the caller to pass an ARN. `database_password` tells the caller to pass the secret value. That naming choice guides safer usage before anyone reads the module internals.

## Declaring Outputs
<!-- section-summary: Outputs expose selected values from a module so callers can wire resources together without depending on internals. -->

An **output** is one value the module intentionally returns. Outputs are the supported public exit points of a child module.

The load balancer module might expose only these values:

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

The module can keep listener details, security group rules, and internal log bucket attributes private. Too many outputs create accidental public API. Callers start depending on details the module author may want to refactor later.

For shared modules, each output needs a clear consumer. A load balancer DNS name, target group ARN, and security group ID often have real downstream use. Internal listener rule priorities or generated names usually belong inside the module unless another root module or operator needs them.

The caller consumes the output through `module.<name>.<output>`:

```hcl
resource "aws_route53_record" "orders" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "orders.example.com"
  type    = "CNAME"
  ttl     = 60
  records = [module.load_balancer.load_balancer_dns_name]
}
```

That root resource does not need to know which internal `aws_lb` name the module uses. It only depends on the output contract.

Outputs can also be sensitive:

```hcl
output "database_connection_string" {
  value       = "postgres://${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}"
  sensitive   = true
  description = "Database endpoint string for application configuration."
}
```

Sensitive outputs are still available to Terraform expressions. Terraform hides routine display, while backend access remains the real security boundary.

## Wiring Outputs Into Other Modules
<!-- section-summary: The root module wires outputs from one child module into inputs on another child module, which keeps the children independent. -->

The root module is the wiring layer. It can pass output from one module into input on another module:

![Output Chain State Map](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/output-chain-state-map.png)

*The output chain shows how one module publishes values that another module can consume through the root wiring.*

```hcl
module "network" {
  source = "../../modules/network"

  environment = var.environment
  cidr_block  = var.cidr_block
}

module "database" {
  source = "../../modules/database"

  subnet_ids              = module.network.private_subnet_ids
  database_name           = "orders"
  backup_retention_days   = 14
  deletion_protection     = true
}

module "load_balancer" {
  source = "../../modules/load-balancer"

  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  domain_name = var.domain_name
}

module "compute" {
  source = "../../modules/compute"

  subnet_ids        = module.network.private_subnet_ids
  target_group_arn  = module.load_balancer.target_group_arn
  database_endpoint = module.database.endpoint
}
```

The database module has to publish the value before the root can pass it along. Inside `modules/database/outputs.tf`, the contract can make the endpoint explicit:

```hcl
output "endpoint" {
  value       = aws_db_instance.orders.endpoint
  description = "Database endpoint, including host and port, used by application modules."
}
```

Now `module.database.endpoint` has a clear source. Terraform resolves it as the output named `endpoint` from the child module call named `database`.

The network module can publish subnet IDs without knowing which modules consume them. The load balancer module can receive a VPC ID without knowing where it came from. The root shows the full service assembly in one place.

Terraform reads those references and builds a dependency graph. The load balancer waits for network outputs. The compute module waits for the target group ARN and database endpoint. The references provide the ordering.

This wiring belongs in the root because the root knows the service architecture. The network module publishes private subnet IDs. The compute module accepts subnet IDs. The root passes outputs into inputs so the dependencies stay visible in one place.

## Outputs and State
<!-- section-summary: Terraform evaluates outputs during planning and stores root output values in state after apply. -->

Terraform evaluates outputs during the plan. If a value comes from a resource that is still pending, the plan can show `(known after apply)`. After apply, root outputs are stored in state and shown at the end of the run.

Operators often read useful root outputs later:

```bash
terraform output orders_url
```

The named output is usually a quoted value:

```console
"https://orders.example.com"
```

This command reads the named root output from state. Automation often uses `terraform output -raw orders_url` for the plain string. Automation can use `terraform output -json` without a name for all root outputs with type and sensitivity metadata.

The root can re-export a child module value:

```hcl
output "orders_url" {
  value       = "https://${module.load_balancer.load_balancer_dns_name}"
  description = "HTTPS endpoint for the Orders service."
}
```

The best root outputs stay useful for humans and automation. A short list of service URLs, bucket names, or dashboard links helps operators. A huge list of internal attributes makes state noisier and exposes more information than callers need.

Verification is simple after apply:

```bash
terraform output
terraform output -json
terraform state show module.load_balancer.aws_lb.this
```

`terraform output` lists all root outputs by name. `terraform output -json` returns a JSON object where each output has `sensitive`, `type`, and `value` fields. `terraform state show module.load_balancer.aws_lb.this` shows recorded attributes for the load balancer instance; useful fields include DNS name, ARN, scheme, subnets, and security groups. Scripts should use the JSON output instead of the human table output because formatting can change and sensitive values require explicit handling.

For a normal output, the JSON form can look like this:

```console
{
  "orders_url": {
    "sensitive": false,
    "type": "string",
    "value": "https://orders.example.com"
  }
}
```

For a sensitive output, Terraform marks the metadata while controlled tooling can still retrieve the value with state access:

```console
{
  "database_connection_string": {
    "sensitive": true,
    "type": "string",
    "value": "postgres://app:example-password@orders-db.example.com:5432/orders"
  }
}
```

That is why sensitive outputs should stay rare. The flag reduces accidental display in normal human output, while backend permissions and CLI access decide who can read the stored value through machine-readable output.

## Putting It All Together
<!-- section-summary: A strong module contract keeps caller choices explicit, catches bad inputs early, and returns only stable values. -->

The Orders load balancer module now has a usable contract. Inputs describe the VPC, subnets, domain name, environment, tags, and health check settings. Validation catches unsafe or unsupported choices before provider APIs run. Sensitive values are redacted in routine output, while the team still protects state.

Outputs expose only the values other code needs: DNS name, target group ARN, and maybe a security group ID if another module needs it. The root wires modules together, so each child module stays focused.

![Module Contract Shape](/content-assets/articles/article-iac-terraform-modules-inputs-outputs/module-contract-shape.png)

*The contract shape summarizes the final boundary: callers pass inputs in, module internals stay private, and stable outputs come back out.*

## What's Next

The next article covers module versioning: Registry versions, Git refs, `terraform init -upgrade`, and the review workflow for shared module changes.

---

**References**

- [Terraform: Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Documents variable blocks, types, defaults, validation, sensitive, and ephemeral options.
- [Terraform: Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Documents root and child module outputs, sensitive outputs, and output behavior.
- [Terraform: Type constraints](https://developer.hashicorp.com/terraform/language/expressions/type-constraints) - Documents primitive, collection, structural, and dynamic types.
- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Explains sensitive values, ephemeral values, write-only arguments, plans, and state.
- [Terraform: Module block](https://developer.hashicorp.com/terraform/language/block/module) - Documents how root modules call child modules and pass input arguments.
- [AWS provider: aws_db_instance](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance) - Documents the RDS instance attributes used by database module outputs.
