---
title: "Designing Composable Modules"
description: "Learn how to structure Terraform modules so they are easy to combine, test in isolation, and reuse without creating hidden dependencies."
overview: "Composable Terraform modules have one clear job, an explicit interface, and no hidden dependency on names or state outside the module. This article shows how to design those modules so the root configuration can assemble infrastructure from small, reviewable pieces."
tags: ["modules", "design", "composability", "terraform", "architecture"]
order: 4
id: article-iac-terraform-modules-composable
---

## Table of Contents

1. [What Composability Means](#what-composability-means)
2. [One Job Per Module](#one-job-per-module)
3. [Avoiding Leaky Modules](#avoiding-leaky-modules)
4. [Outputs as the Public Interface](#outputs-as-the-public-interface)
5. [Flat Over Deep Module Hierarchy](#flat-over-deep-module-hierarchy)
6. [Data Sources Inside Modules](#data-sources-inside-modules)
7. [A Composable Module in Practice](#a-composable-module-in-practice)
8. [Testing Modules in Isolation](#testing-modules-in-isolation)
9. [Putting It All Together](#putting-it-all-together)

## What Composability Means
<!-- section-summary: A composable module has a focused responsibility, explicit dependencies, and outputs that let the root assemble it with other modules. -->

A **composable Terraform module** is a module that works as a clean building block. It has one clear responsibility, receives outside facts through variables, and exposes selected results through outputs. The root configuration can combine it with other modules without editing the module internals.

The Orders platform team already has a private bucket module and a load balancer module. Now the team wants a reusable service stack made from several pieces: network, database, compute, load balancer, DNS, and monitoring. The easiest way to keep that stack reviewable is to keep each piece small enough to understand.

![A composable Terraform design keeps focused child modules independent while the root configuration wires their outputs together.](/content-assets/articles/article-iac-terraform-modules-composable/composable-root-wiring.png)

*Composable modules stay small and independent. The root layer shows how the service pieces connect.*

The root configuration is the place where infrastructure is assembled. The network module returns subnet IDs. The database module returns an endpoint. The compute module receives both values and returns a target group ARN. The load balancer module receives that target group ARN and exposes a DNS name. Each module has a narrow job, and the root shows the whole story.

This design helps the team grow the platform. A batch processing service can reuse the network and database modules while skipping the load balancer. A public API can reuse the load balancer and monitoring modules while choosing its own database pattern. Composability gives teams reusable parts rather than one giant preset.

## One Job Per Module
<!-- section-summary: A module with one clear job is easier to review, test, reuse, and safely change. -->

A strong module should be easy to describe in one plain phrase: "creates a private S3 bucket," "creates a VPC and subnets," "creates an application load balancer," or "creates an RDS database." That short phrase matters because it tells callers what kind of responsibility they are accepting.

The common mistake is a module called `application_stack` that creates everything: network, database, compute, DNS, monitoring, alarms, dashboards, and IAM roles. It feels convenient during the first project because one module call creates the whole stack. It causes pain when the next project wants the database and compute pattern but already has its own network. The giant module forces callers to accept decisions outside their needs.

A focused module gives callers a better contract. A database module can own the RDS instance, subnet group, parameter group, and database security group because those resources change together. DNS records for the application might belong in a separate DNS module because DNS ownership and release timing often differ from database changes.

Here is how the Orders root can assemble focused modules:

```hcl
module "network" {
  source = "./modules/network"

  environment = var.environment
  cidr_block  = var.cidr_block
}

module "database" {
  source = "./modules/database"

  subnet_ids            = module.network.private_subnet_ids
  database_password     = var.database_password
  backup_retention_days = 14
}

module "compute" {
  source = "./modules/compute"

  subnet_ids        = module.network.private_subnet_ids
  database_endpoint = module.database.endpoint
  image_id          = var.orders_image_id
}

module "load_balancer" {
  source = "./modules/load-balancer"

  subnet_ids        = module.network.public_subnet_ids
  target_group_arn  = module.compute.target_group_arn
  certificate_arn   = var.certificate_arn
}
```

Security group rules that connect compute to the database often live in the root configuration or a small network-security module. That keeps the database module focused on the database and keeps the compute module focused on runtime capacity. The root can then review connection policy as wiring instead of hiding it inside either module.

That kind of review is possible because the modules are small. Reviewers can see which module owns which decision and where the wiring creates risk.

## Avoiding Leaky Modules
<!-- section-summary: A leaky module hides a real dependency instead of declaring it as an input. -->

A **leaky module** is a module that secretly depends on something outside its interface. The caller reads `variables.tf` and thinks the module needs only `subnet_id` and `ami_id`, but the resources inside the module quietly look up a security group by name, read a remote state file, or assume a tag convention in the account.

Here is a leaky compute module:

```hcl
data "aws_security_group" "shared_web" {
  name = "orders-shared-web"
}

resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id

  vpc_security_group_ids = [data.aws_security_group.shared_web.id]
}
```

The module depends on a security group named `orders-shared-web`, but the interface never says so. The module may work in one AWS account and fail in another account where the shared group has a different name. A new caller has to read the internals to discover the real dependency.

The fix is to make the dependency explicit:

```hcl
variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs attached to each application instance."
}

resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id

  vpc_security_group_ids = var.security_group_ids
}
```

Now the caller chooses the security group and the module declares that requirement honestly. If the root configuration lacks a suitable security group, Terraform reports a missing required input instead of failing during a hidden lookup.

![A leaky module hides dependencies like names, remote state, or shared resources, while a composable module receives them as inputs.](/content-assets/articles/article-iac-terraform-modules-composable/module-leak-check.png)

*Good module design turns outside dependencies into visible inputs so callers can review them before apply.*

This pattern applies to account IDs, VPC IDs, secret ARNs, hosted zone IDs, KMS key ARNs, and shared security groups. If the module needs a specific outside object, the caller should pass the stable identifier in. Hidden names make modules fragile; explicit IDs make the contract honest.

## Outputs as the Public Interface
<!-- section-summary: Outputs are the only supported public exit points from a child module, so they should stay useful and small. -->

Outputs tell callers which results they may use. A compute module might expose `target_group_arn`, `security_group_id`, and `autoscaling_group_name`. It might keep the launch template ID, user data, IAM instance profile, and CloudWatch log group internal.

This selective interface keeps refactors possible. The module author can replace EC2 with ECS, change the launch template shape, or split the log group configuration into a separate resource. Callers keep working as long as the exposed outputs keep the same meaning.

```hcl
output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "Target group ARN used by the load balancer module."
}

output "security_group_id" {
  value       = aws_security_group.app.id
  description = "Security group ID for database ingress rules."
}

output "autoscaling_group_name" {
  value       = aws_autoscaling_group.app.name
  description = "Auto Scaling group name for alarms and deployment checks."
}
```

Too many outputs can create a trap. If a module exposes every internal resource attribute, callers will eventually depend on details the module author wanted to keep private. A later cleanup then creates a breaking change. The safer pattern is to expose the values another module or operator genuinely needs and add new outputs only when a real caller has a real use case.

This is how mature module libraries stay maintainable. The public interface grows slowly, and the internals can improve quickly.

## Flat Over Deep Module Hierarchy
<!-- section-summary: A flat hierarchy keeps module wiring visible in the root and keeps plan addresses easier to trace. -->

Terraform allows a module to call another module, which can call another module. That can be useful for packaging a complex subsystem, but deep hierarchies make plans harder to read. A resource address such as `module.platform.module.network.module.subnets.aws_subnet.private[0]` sends reviewers through several directories before they find the resource.

Most service roots benefit from a flatter layout:

```
root
  module.network
  module.database
  module.compute
  module.load_balancer
  module.dns
  module.monitoring
```

The root then shows the integration story in one place. Reviewers can see which output feeds which input. When a plan shows a change under `module.database`, they can jump straight to the database module call and the database module source.

Nested modules still have a place. A Kubernetes cluster module might call private internal modules for node pools, cluster add-ons, and identity wiring because those pieces form one larger subsystem. Even then, the parent module should expose a small interface and keep the nesting shallow enough that errors remain traceable.

When a module hierarchy starts to hide environment boundaries or team ownership boundaries, the team should consider separate root modules with separate state. Modules organize code. Root modules and backends organize operational blast radius.

## Data Sources Inside Modules
<!-- section-summary: Data sources inside modules are useful for provider facts, but risky when they hide dependencies on external resource names. -->

A **data source** is a read-only provider lookup. Inside a module, data sources can be helpful when they read facts from the current provider context. They become risky when they hide a dependency on a specific external resource.

Reading the current region and account ID is usually reasonable:

```hcl
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  log_group_arn = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/orders/*"
}
```

The provider identity already knows the current AWS account ID, so the caller can leave that value out of the interface. The data source makes the module easier to call without creating a hidden dependency on a named object.

Looking up a shared resource by name is a different story:

```hcl
data "aws_kms_key" "shared" {
  key_id = "alias/orders-shared"
}
```

That lookup assumes the alias exists in every account where the module runs. If the KMS key is part of the caller's architecture, the caller should pass `kms_key_arn` or `kms_key_id` as an input. The module can still use a default for development if the team wants, but the production dependency should be visible in the interface.

The practical rule is this: **provider context can often be read, architecture dependencies should be passed**. Region and caller identity are context. VPCs, security groups, hosted zones, KMS keys, and secret ARNs are architecture.

## A Composable Module in Practice
<!-- section-summary: A composable compute module declares every outside dependency as an input and exposes only the values the root needs. -->

Here is a compute module shaped for composition. It receives the network, security, image, and sizing decisions from the caller. It creates the application runtime pieces internally. It exposes only the values other modules and operators need.

`variables.tf`:

```hcl
variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs where application instances run."
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where the target group receives traffic."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs attached to each instance."
}

variable "image_id" {
  type        = string
  description = "Machine image ID for the Orders application."
}

variable "instance_type" {
  type        = string
  description = "Instance type for application servers."
  default     = "t3.small"
}

variable "desired_capacity" {
  type        = number
  description = "Desired number of application instances."
  default     = 2

  validation {
    condition     = var.desired_capacity >= 1 && var.desired_capacity <= 20
    error_message = "desired_capacity must be between 1 and 20."
  }
}
```

`main.tf`:

```hcl
resource "aws_launch_template" "app" {
  name_prefix   = "orders-app-"
  image_id      = var.image_id
  instance_type = var.instance_type

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = var.security_group_ids
  }
}

resource "aws_lb_target_group" "app" {
  port     = 8080
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_autoscaling_group" "app" {
  vpc_zone_identifier = var.subnet_ids
  desired_capacity    = var.desired_capacity
  min_size            = 1
  max_size            = 20

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.app.arn]
}
```

`outputs.tf`:

```hcl
output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "Target group ARN used by the load balancer module."
}

output "autoscaling_group_name" {
  value       = aws_autoscaling_group.app.name
  description = "Auto Scaling group name used by deployment checks and alarms."
}
```

Every outside dependency is visible in `variables.tf`: VPC, subnets, security groups, image ID, instance size, and capacity. The module creates the runtime pieces, then returns target group and scaling group values. A reviewer can understand the boundary without reading every resource first.

## Testing Modules in Isolation
<!-- section-summary: Isolated module tests work when the module can run from only its declared inputs. -->

**Testing a module in isolation** means wrapping the module with just enough test infrastructure to supply its inputs, then checking the plan or apply result. This works only when the module has an honest interface. Hidden account names, shared state lookups, and secret external resources make isolated tests fragile.

For the compute module, a test wrapper can create a temporary VPC, subnet, and security group, pass their IDs into the module, and run a plan. A deeper integration test can apply the wrapper in a sandbox account, verify the target group and Auto Scaling group, then destroy the test stack.

Native `terraform test` gives teams a way to run module tests from HCL test files. Provider mocks and overrides can cover fast interface checks, validation rules, and output wiring. Real apply tests still matter for behavior that only the cloud provider can prove, such as health checks, IAM behavior, and service-specific constraints.

The pipeline shape usually looks like this:

```shell
terraform fmt -check
terraform init
terraform validate
terraform test
```

For modules that manage expensive or slow resources, teams often split tests into fast checks on every pull request and scheduled or manually approved apply tests in a sandbox account. That split gives reviewers feedback without spending money on every small edit.

Composable modules make this practical. The test only has to provide declared inputs, so it avoids recreating a secret set of resources that the module looked up by name.

## Putting It All Together
<!-- section-summary: Composable module design keeps responsibilities small, dependencies visible, and root wiring reviewable. -->

The Orders module library now has a clear design style. Each module has one job. Outside dependencies arrive through variables. Useful results leave through outputs. The root configuration wires the modules together so reviewers can see the full service shape in one place.

![Composable module summary showing one responsibility, explicit inputs, small outputs, flat root wiring, and isolated tests.](/content-assets/articles/article-iac-terraform-modules-composable/composable-modules-field-guide.png)

*Composable modules are easier to reuse because each piece declares what it needs, returns what callers use, and keeps internals replaceable.*

This style helps production teams because it makes change smaller. A database change stays in the database module. A load balancer change stays in the load balancer module. A service-level wiring change stays in the root. When a plan shows a surprise, the address points to a focused part of the system instead of a giant module that owns everything.

The final habit is simple: **small modules, explicit inputs, careful outputs, flat wiring, and tests that prove the contract**. That gives Terraform modules the same kind of maintainability teams expect from any other shared code.

---

**References**

- [Module Composition (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/composition), Official guidance for dependency inversion, composition patterns, and module design.
- [Standard Module Structure (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/structure), Guidance for module file layout, documentation, examples, and reusable module conventions.
- [Tests (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/tests), Reference for native Terraform tests, run blocks, mocks, overrides, and module validation workflows.
- [Input Variables (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/variables), Reference for defining explicit module inputs and validation rules.
- [Output Values (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/outputs), Reference for exposing selected module values to callers.
