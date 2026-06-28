---
title: "Designing Composable Modules"
description: "Terraform module structure that is easy to combine, test in isolation, and reuse without hidden dependencies."
overview: "Composable Terraform modules have one clear job, an explicit interface, and no hidden dependency on names or state outside the module. This article turns the Orders module library into small pieces that the root configuration can wire together."
tags: ["modules", "design", "composability", "terraform", "architecture"]
order: 4
id: article-iac-terraform-modules-composable
aliases:
  - infrastructure-as-code/terraform/modules-and-environments/designing-composable-modules.md
  - infrastructure-as-code/terraform/existing-infrastructure-and-reuse/designing-composable-modules.md
---

## Table of Contents

1. [From One Useful Module to a Module Library](#from-one-useful-module-to-a-module-library)
2. [One Job Per Module](#one-job-per-module)
3. [Outside Dependencies as Inputs](#outside-dependencies-as-inputs)
4. [Outputs as the Public Interface](#outputs-as-the-public-interface)
5. [Flat Root Wiring](#flat-root-wiring)
6. [Root-Owned Discovery](#root-owned-discovery)
7. [A Composable Compute Module](#a-composable-compute-module)
8. [Testing Modules in Isolation](#testing-modules-in-isolation)
9. [Putting It All Together](#putting-it-all-together)

## From One Useful Module to a Module Library
<!-- section-summary: A composable module has a focused responsibility, explicit dependencies, and outputs that let the root assemble it with other modules. -->

The Orders team extracted a private bucket module, then a load balancer module. The next temptation is to make one giant `orders_stack` module that creates the network, database, compute, load balancer, DNS records, alarms, and dashboards in one call.

That giant module helps the first service move quickly. The problem appears with the second service. One team wants the database and compute pattern but already has a shared network. Another team wants the load balancer and monitoring but uses a managed container platform instead of EC2.

A **composable module** works as a clean building block. It has one focused responsibility, receives outside facts through variables, and returns selected results through outputs. The root configuration assembles the pieces.

For Orders, the root can call `network`, `database`, `compute`, `load_balancer`, `dns`, and `monitoring` modules. Each module owns a small piece. The root shows how those pieces connect for one environment.

This design also makes ownership clearer. The platform team may own the network module. The database team may own the database module. The service team owns the root wiring for Orders. Each pull request can name which boundary it changes.

## One Job Per Module
<!-- section-summary: A module with one clear job has a direct review, test, reuse, and change path. -->

A strong module is easy to describe in one phrase: creates a private bucket, creates a VPC and subnets, creates an application load balancer, or creates an RDS database with its supporting resources.

The phrase matters because it describes the responsibility callers accept. A database module can own the database instance, subnet group, parameter group, monitoring settings, and database security group because those pieces change together. DNS records often belong somewhere else because DNS ownership and release timing may differ from database changes.

The root can assemble focused modules like this:

```hcl
module "network" {
  source = "../../modules/network"

  environment = var.environment
  cidr_block  = var.cidr_block
}

module "database" {
  source = "../../modules/database"

  subnet_ids            = module.network.private_subnet_ids
  backup_retention_days = 14
}

module "compute" {
  source = "../../modules/compute"

  subnet_ids        = module.network.private_subnet_ids
  database_endpoint = module.database.endpoint
  image_id          = var.orders_image_id
}

module "load_balancer" {
  source = "../../modules/load-balancer"

  subnet_ids       = module.network.public_subnet_ids
  target_group_arn = module.compute.target_group_arn
  certificate_arn  = var.certificate_arn
}
```

This example assumes the database module publishes an `endpoint` output and the compute module accepts a `database_endpoint` input. The root owns the connection between those two contracts.

The root is now the readable service assembly. Reviewers can see which module owns which decision and where values cross module boundaries.

One useful boundary question is: would this resource normally change for the same reason as the rest of the module? Database parameter groups and subnet groups often change with a database module. A public DNS cutover may follow a release process owned by another team, so it may deserve its own module or root wiring.

## Outside Dependencies as Inputs
<!-- section-summary: A leaky module hides a real dependency instead of declaring it as an input. -->

A module gets fragile if it secretly depends on something outside its interface. For example, this compute module looks up a security group by name:

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

The caller reads `variables.tf` and sees no security group input. The module still requires a security group named `orders-shared-web` in the account. That hidden requirement can fail in another environment or attach the wrong group if names drift.

The module interface should name that dependency directly:

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

This same rule applies to VPC IDs, hosted zone IDs, KMS key ARNs, secret ARNs, account IDs, and shared subnet IDs. If the outside object is part of the architecture, the root should pass its stable identifier into the module.

The benefit shows up during failure. If a module receives `kms_key_arn` as an input, a plan reviewer can see exactly which key production will use. If the module searches for an alias internally, a failed lookup or wrong alias sends the reader into provider lookup behavior before they even understand the intended architecture.

## Outputs as the Public Interface
<!-- section-summary: Outputs are the only supported public exit points from a child module, so they should stay useful and small. -->

Outputs are the values callers are allowed to use. A compute module might expose a target group ARN, security group ID, and Auto Scaling group name:

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

The module can keep launch template IDs, user data, log group internals, and detailed listener rules private. If callers depend on every internal attribute, the module author loses room to refactor.

Outputs belong in the contract for real module or operator use cases. A small output surface helps shared modules stay stable while internals improve.

Changing an output name or type is a breaking contract change. For internal modules, one release with both the old output and the replacement output gives callers time to migrate without forcing every root to update in the same pull request.

## Flat Root Wiring
<!-- section-summary: A flat hierarchy keeps module wiring visible in the root and keeps plan addresses direct to trace. -->

Terraform allows child modules to call more child modules. That can help package a complex subsystem, but deep nesting makes plans difficult to trace. A resource address like this sends reviewers through several layers:

![Composable Root Wiring](/content-assets/articles/article-iac-terraform-modules-composable/composable-root-wiring.png)

*The root wiring view shows how a root module connects small modules without hiding the environment decisions.*

```hcl
module.platform.module.network.module.subnets.aws_subnet.private[0]
```

Most service roots read clearly with a flat shape:

```hcl
module.network
module.database
module.compute
module.load_balancer
module.dns
module.monitoring
```

The root then shows which output feeds which input. If a plan changes `module.database`, reviewers can go straight to the database module call and source.

Nested modules still have a place for a larger subsystem such as a Kubernetes cluster with node pools and add-ons. Even there, a small public interface and shallow nesting keep plan addresses understandable.

Flat roots also lower state-operation risk. If a resource address is only one module deep, a moved block stays direct to write and review. Deep nesting creates long addresses with more room for refactor mistakes.

## Root-Owned Discovery
<!-- section-summary: Reusable modules stay practical to test if shared-resource discovery lives in the root and modules receive stable IDs. -->

Reusable modules stay practical to test if they receive architecture decisions as inputs. Discovery belongs in the root configuration for values that depend on the environment, account, naming scheme, or team ownership.

Provider context is the small exception. A child module can read facts that already come from the configured provider, such as the current region or account ID:

![Module Leak Check](/content-assets/articles/article-iac-terraform-modules-composable/module-leak-check.png)

*The leak check shows the difference between a reusable module and one that quietly hardcodes outside dependencies.*

```hcl
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  log_group_arn = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/orders/*"
}
```

The current region and account are already part of the provider context. Reading them keeps every caller from passing basic context values by hand.

Named architecture resources need a different boundary. This lookup hides an Orders KMS key inside the module:

```hcl
data "aws_kms_key" "shared" {
  key_id = "alias/orders-shared"
}
```

If production depends on a specific KMS key, `kms_key_arn` or `kms_key_id` belongs in the module interface. The dependency is then visible in the module call and review.

The root module can own the lookup because the root knows the production alias and environment boundary:

```hcl
data "aws_kms_key" "orders" {
  key_id = "alias/orders-prod"
}

module "compute" {
  source = "../../modules/compute"

  subnet_ids          = module.network.private_subnet_ids
  vpc_id              = module.network.vpc_id
  security_group_ids  = [module.security_groups.app_id]
  image_id            = var.orders_image_id
  kms_key_arn         = data.aws_kms_key.orders.arn
}
```

Inside the compute module, the KMS key remains a normal input:

```hcl
variable "kms_key_arn" {
  type        = string
  description = "KMS key ARN used to encrypt application log data."
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/aws/orders/app"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
}
```

That pattern keeps discovery close to the environment that knows the alias and keeps the child module easy to test with any valid key ARN.

The practical rule is: provider context can often be read; architecture dependencies belong in inputs.

This keeps provider lookups in a narrow supporting role for module design. The direct data-source article teaches lookup behavior. In this module article, the important lesson is ownership: shared modules keep environment-specific discovery visible instead of hiding names that may differ between accounts.

## A Composable Compute Module
<!-- section-summary: A composable compute module declares every outside dependency as an input and exposes only the values the root needs. -->

Here is a compute module shaped for composition. It receives network, security, image, and capacity choices from the caller. It creates application runtime resources internally.

The `variables.tf` file comes first. Required inputs name the outside dependencies: subnets, VPC, security groups, and image. Optional inputs cover capacity choices that have safe defaults.

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
  description = "EC2 instance type for application instances."
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

The first `main.tf` piece creates the launch template. The module receives the image and security groups from the caller, and it keeps instances private by setting `associate_public_ip_address = false`.

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
```

The second piece creates the target group that the load balancer will send traffic to. The target group needs the VPC ID, so the VPC remains an explicit module input.

```hcl
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
```

The Auto Scaling group connects the private subnets, launch template, desired capacity, and target group. The launch template version uses `aws_launch_template.app.latest_version` instead of the literal string `$Latest`.

```hcl
resource "aws_autoscaling_group" "app" {
  vpc_zone_identifier = var.subnet_ids
  desired_capacity    = var.desired_capacity
  min_size            = 1
  max_size            = 20

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  target_group_arns = [aws_lb_target_group.app.arn]
}
```

`$Latest` asks AWS to resolve the newest launch template version at runtime, which can hide an out-of-band launch template version from Terraform review. The Terraform-tracked attribute makes the Auto Scaling group configuration point at the launch template version Terraform just planned.

This setting controls the Auto Scaling group configuration. Existing instances may keep running their old launch template version until a scale event, deployment process, or explicit instance refresh replaces them. A production compute module needs visible rollout behavior instead of a moving `$Latest` reference.

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

Every outside dependency is visible in `variables.tf`. The outputs are small. The root can wire this module into a load balancer and monitoring module without reaching into internals.

The production root might wire it like this:

```hcl
module "compute" {
  source = "../../modules/compute"

  subnet_ids          = module.network.private_subnet_ids
  vpc_id              = module.network.vpc_id
  security_group_ids  = [module.security_groups.app_id]
  image_id            = var.orders_image_id
  instance_type       = "t3.small"
  desired_capacity    = var.desired_capacity
}

module "monitoring" {
  source = "../../modules/monitoring"

  autoscaling_group_name = module.compute.autoscaling_group_name
  service_name           = "orders"
}
```

The compute module and monitoring module stay independent. The root decides that Orders monitoring should watch this Auto Scaling group.

## Testing Modules in Isolation
<!-- section-summary: Isolated module tests work if the module can run from only its declared inputs. -->

**Testing a module in isolation** means wrapping the module with just enough temporary infrastructure to supply its inputs, then checking the plan or apply result.

For the compute module, a test wrapper can create a temporary VPC, subnets, and security group, pass their IDs into the module, and run a plan. A deeper sandbox test can apply the wrapper, verify the target group and Auto Scaling group, then destroy the test stack.

Native Terraform tests can cover validation rules, output wiring, and module behavior through HCL test files:

```bash
terraform fmt -check
terraform init
terraform validate
terraform test
```

`fmt -check` fails for formatting errors, `init` prepares modules and providers, `validate` catches configuration and schema issues, and `terraform test` reports passing or failing `.tftest.hcl` runs. A healthy fast check ends with successful validation and passing test runs before any sandbox apply begins.

A small validation test can call the module with a bad desired capacity and expect Terraform to reject it:

```hcl
run "rejects_zero_capacity" {
  command = plan

  variables {
    subnet_ids          = ["subnet-123", "subnet-456"]
    vpc_id              = "vpc-123"
    security_group_ids  = ["sg-123"]
    image_id            = "ami-123"
    desired_capacity    = 0
  }

  expect_failures = [
    var.desired_capacity
  ]
}
```

The test output makes the contract failure visible:

```console
tests/compute.tftest.hcl... in progress
  run "rejects_zero_capacity"... pass
tests/compute.tftest.hcl... tearing down
tests/compute.tftest.hcl... pass

Success! 1 passed, 0 failed.
```

Expensive or slow resources often need two test layers: fast validation on every pull request and scheduled or approved apply tests in a sandbox account. Composable modules make this practical because the test only has to provide the declared inputs.

A useful module test checks the interface before it checks every provider detail. Does a bad `desired_capacity` fail with a clear validation message? Does the module output the target group ARN after apply? Does the plan avoid public IP addresses for private compute? Those checks protect the contract the callers actually use.

## Putting It All Together
<!-- section-summary: Composable module design keeps responsibilities small, dependencies visible, and root wiring reviewable. -->

The Orders module library now has a clear design style. Each module has one job. Outside dependencies arrive through inputs. Useful results leave through outputs. The root configuration wires the modules together so reviewers can see the service shape in one place.

This style keeps changes smaller. A database change stays in the database module. A load balancer change stays in the load balancer module. A service wiring change stays in the root. A surprising plan points to a focused part of the system instead of one giant module.

![Composable Modules Field Guide](/content-assets/articles/article-iac-terraform-modules-composable/composable-modules-field-guide.png)

*The field guide turns module design into a final review checklist: one job, clear inputs, small outputs, visible wiring, and isolated tests.*

---

**References**

- [Terraform: Module composition](https://developer.hashicorp.com/terraform/language/modules/develop/composition) - Documents patterns for composing modules through root configuration.
- [Terraform: Standard module structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure) - Documents reusable module layout and public interface conventions.
- [Terraform: Tests](https://developer.hashicorp.com/terraform/language/tests) - Documents native Terraform test files and `terraform test`.
- [Terraform: Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Documents module inputs, types, validation, and descriptions.
- [Terraform: Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Documents module outputs and how callers consume them.
- [AWS provider: aws_launch_template](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/launch_template) - Documents launch template attributes, including version values exposed to Terraform.
- [AWS provider: aws_autoscaling_group](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/autoscaling_group) - Documents Auto Scaling group launch template configuration and instance refresh options.
