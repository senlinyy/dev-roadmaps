---
title: "Designing Composable Modules"
description: "Learn how to structure Terraform modules so they are easy to combine, test in isolation, and reuse without creating hidden dependencies."
overview: "A module that does too much is just as harmful as no module at all. This article covers the principles of composability: keeping modules focused, avoiding hidden state coupling, using outputs as the only public interface, and building a flat module hierarchy that scales."
tags: ["modules", "design", "composability", "terraform", "architecture"]
order: 4
id: article-iac-terraform-modules-composable
---

## Table of Contents

1. [What Composability Means](#what-composability-means)
2. [The Single-Responsibility Principle for Modules](#the-single-responsibility-principle-for-modules)
3. [Avoiding Leaky Modules](#avoiding-leaky-modules)
4. [Outputs as the Only Public Interface](#outputs-as-the-only-public-interface)
5. [Flat Over Deep: Module Hierarchy](#flat-over-deep-module-hierarchy)
6. [Data Sources Inside Modules](#data-sources-inside-modules)
7. [A Composable Module in Practice](#a-composable-module-in-practice)
8. [Testing Modules in Isolation](#testing-modules-in-isolation)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Composability Means

Composability is the quality of being easy to combine. A composable module is one that works correctly on its own, in combination with other modules it has never been paired with before, without requiring changes to either one. Building composable modules is the difference between a module library that grows with your organization and one that becomes a tangled mess after six months.

![Composable modules keep small responsibilities and let the root layer connect their outputs deliberately.](/content-assets/articles/article-iac-terraform-modules-composable/composition-layers.png)

The way to think about it is in terms of surfaces. Every module has two surfaces: its inputs and its outputs. Everything that flows in goes through variables. Everything that flows out goes through outputs. Composable modules keep these surfaces small, clear, and stable. They hide everything else. When you change the internal implementation of a composable module, callers notice nothing, because they only depend on the surface.

Non-composable modules have large surfaces — they reach out to external state, they depend on resources that must exist outside their directory, they assume a specific naming convention in another part of the configuration. These implicit dependencies are what make modules fragile. Composable modules make all dependencies explicit by requiring them as variable inputs.

## The Single-Responsibility Principle for Modules

The most common mistake with Terraform modules is making them too big. A "complete application stack" module that creates the network, the servers, the database, the load balancer, the DNS records, the monitoring dashboards, and the alerting rules might seem convenient at first. But it is almost impossible to reuse. Every project that calls it needs all of those pieces. Every change to any of those pieces potentially breaks every caller. Testing it requires building the entire stack.

![A module boundary should expose a small public interface while hiding implementation details inside.](/content-assets/articles/article-iac-terraform-modules-composable/module-responsibility-boundary.png)

A better approach is to give each module one clear job. A network module creates the VPC and subnets. A database module creates the RDS instance and its security group. A compute module creates the auto-scaling group and its launch template. A load balancer module creates the ALB and the target groups. Each module has a handful of inputs and a handful of outputs. Each can be tested independently by deploying just that module in isolation.

When a project needs the full stack, the root configuration assembles the pieces:

```hcl
module "network" {
  source = "./modules/network"

  region     = var.region
  cidr_block = var.cidr_block
}

module "database" {
  source = "./modules/database"

  vpc_id    = module.network.vpc_id
  subnet_id = module.network.db_subnet_id
  password  = var.db_password
}

module "compute" {
  source = "./modules/compute"

  vpc_id        = module.network.vpc_id
  subnet_id     = module.network.web_subnet_id
  db_endpoint   = module.database.endpoint
}

module "load_balancer" {
  source = "./modules/load-balancer"

  vpc_id     = module.network.vpc_id
  subnet_ids = [module.network.web_subnet_id]
  target_arn = module.compute.target_group_arn
}
```

Four focused modules. Each does one thing. Each has a clear input surface and a clear output surface. A team that needs the same database module in a different project — say a batch processing pipeline that has no web servers or load balancer — can pull in just the database module and the network module without dragging in anything else.

The rule is simple: if you cannot describe what a module does in one short sentence without using the word "and," the module probably does too much.

## Avoiding Leaky Modules

A leaky module is one where the caller has to know something about the module's internals to use it correctly. The most common form of leakage is expecting an external resource to exist before the module runs, without declaring that expectation as a variable.

Imagine a module that creates an application server and hardcodes a security group name:

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.instance_type
  subnet_id     = var.subnet_id

  vpc_security_group_ids = [data.aws_security_group.shared_web.id]
}

data "aws_security_group" "shared_web" {
  name = "shared-web-sg"
}
```

This module silently requires that a security group named `shared-web-sg` already exists in the account. It does not ask for it as an input — it reaches out and looks it up. If any caller deploys this module into an account where the security group has a different name, the deployment fails. The caller has no way to know from the module's variable interface alone that this dependency exists.

The fix is to make the dependency explicit:

```hcl
variable "security_group_ids" {
  type        = list(string)
  description = "List of security group IDs to attach to the application server."
}

resource "aws_instance" "app" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
}
```

Now the module cannot be used without the caller explicitly providing security group IDs. If the caller does not have the right security group, the error is clear: a required variable is missing. The module is honest about what it needs.

This principle extends to any external information the module relies on: account IDs, region names, existing resource IDs, external secrets. If the module needs it, it should be a variable.

## Outputs as the Only Public Interface

Just as a module should declare all its needs as inputs, it should share information only through outputs. Internal resources — security groups, IAM roles, CloudWatch log groups — that the module creates for its own use should stay invisible to the caller unless there is a specific reason to expose them.

Exposing too much is just as harmful as requiring too much. If a module outputs every single resource attribute it creates, callers might start depending on those attributes directly. When you later refactor the module — splitting one resource into two, or renaming an internal resource — any caller that referenced those extra outputs breaks.

Decide on a minimal output surface. For the compute module in the example above, the essential outputs are:

```hcl
output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "ARN of the target group. Pass this to the load balancer module."
}

output "autoscaling_group_name" {
  value       = aws_autoscaling_group.app.name
  description = "Name of the auto-scaling group, for use in scaling policies or monitoring."
}
```

The IAM instance profile, the launch template ID, the CloudWatch log group ARN — these are all internal. Callers do not need them. If a future use case requires an output that does not currently exist, add it then. Start with less and add more as needed rather than exposing everything upfront.

This conservative approach to outputs is what makes refactoring safe. You can completely rewrite the internals of a module — replace the auto-scaling group with an ECS service, or swap the target group for a different load balancer type — as long as the output surface stays the same. Every caller continues working without any changes.

## Flat Over Deep: Module Hierarchy

Terraform supports modules calling other modules. A network module could call a subnet module which calls a route table module. This nesting creates a hierarchy: the root calls the network module, which calls the subnet module, which calls the route table module.

In practice, deep hierarchies create more problems than they solve. When something goes wrong during an apply, the error address includes the full nesting path: `module.network.module.subnet.module.route_table.aws_route_table.this`. Tracing that back to the source requires navigating multiple directories. Testing any individual piece requires understanding the entire chain above it. Refactoring any level of the hierarchy risks breaking the levels above it.

The recommendation for almost all teams is to keep module hierarchies flat. The root configuration calls modules directly. Modules do not call other modules. Each module is a leaf in the tree, not a node.

```
root configuration
├── module "network"      (leaf)
├── module "database"     (leaf)
├── module "compute"      (leaf)
└── module "load-balancer" (leaf)
```

There are legitimate exceptions to this rule. A module that manages a complex, self-contained subsystem — like a Kubernetes cluster with several related components — might reasonably call sub-modules for its internal pieces. But even then, those sub-modules should be private to the parent module (not shared with other callers), and the nesting should go no deeper than two levels.

If you find yourself building a hierarchy deeper than two levels, the configuration has likely grown beyond what a module structure can manage cleanly. That is usually a signal to split it into multiple independent root configurations with their own state files, sharing information through data sources or remote state lookups.

## Data Sources Inside Modules

Data sources are read-only queries to the cloud provider's API. They let you look up information about existing resources — resources that were created outside of Terraform, or by a different Terraform configuration — without managing those resources directly.

Used carefully, data sources are a clean way for a module to query for information it cannot reasonably require as a variable. For example, a compute module that needs the current AWS region and account ID to construct a CloudWatch Logs ARN can use data sources for that:

```hcl
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "app" {
  name = "app-policy"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:PutLogEvents"]
      Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/app/*"
    }]
  })
}
```

Here the region and account ID are inferred automatically rather than required as variables, which reduces the caller's input surface for values that can be queried reliably from the active provider identity.

Be careful about using data sources to look up resources by name or tag rather than by ID. Name-based lookups are fragile: they fail if the resource does not exist or if multiple resources match the filter. A module that does `data "aws_security_group" "shared" { name = "shared-web-sg" }` internally is the leaky module pattern discussed earlier — it has an implicit dependency on a specific naming convention.

The safer approach is to pass IDs as variables when the module needs to reference externally-managed resources. IDs are stable and unique; names are neither.

## A Composable Module in Practice

Here is what the full compute module looks like when designed for composability. Variables declare all external dependencies. Resources use only those variables and internal data. Outputs expose only what callers need.

`variables.tf`:

```hcl
variable "vpc_id" {
  type        = string
  description = "ID of the VPC where the compute resources will be deployed."
}

variable "subnet_id" {
  type        = string
  description = "ID of the subnet for the auto-scaling group instances."
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs to attach to each instance."
}

variable "instance_type" {
  type        = string
  default     = "t3.small"
  description = "EC2 instance type for the application servers."
}

variable "min_size" {
  type        = number
  default     = 1
  description = "Minimum number of instances in the auto-scaling group."
}

variable "max_size" {
  type        = number
  default     = 4
  description = "Maximum number of instances in the auto-scaling group."
}

variable "ami_id" {
  type        = string
  description = "AMI ID for the application server image."
}
```

`main.tf`:

```hcl
resource "aws_launch_template" "app" {
  name_prefix   = "app-"
  image_id      = var.ami_id
  instance_type = var.instance_type

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = var.security_group_ids
  }
}

resource "aws_autoscaling_group" "app" {
  vpc_zone_identifier = [var.subnet_id]
  min_size            = var.min_size
  max_size            = var.max_size

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.app.arn]
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
```

`outputs.tf`:

```hcl
output "target_group_arn" {
  value       = aws_lb_target_group.app.arn
  description = "Pass this to the load balancer module to route traffic to this compute group."
}

output "autoscaling_group_name" {
  value       = aws_autoscaling_group.app.name
  description = "The name of the auto-scaling group, for monitoring and scaling policy references."
}
```

Notice what is not in the outputs: the launch template ID, the target group health check settings, the network interface configuration. Those are internal details. The caller gets two stable, meaningful values and nothing more.

## Testing Modules in Isolation

Composable modules are independently testable because they have no hidden dependencies. To test the compute module, you create a small test configuration that provides the minimum required inputs and deploys just that module:

```hcl
module "compute" {
  source = "../../modules/compute"

  vpc_id             = aws_vpc.test.id
  subnet_id          = aws_subnet.test.id
  security_group_ids = [aws_security_group.test.id]
  ami_id             = data.aws_ami.amazon_linux.id
}
```

This test configuration creates its own VPC and security group just for the test. It does not depend on anything external. You can deploy it, run whatever verification you need — check that the auto-scaling group exists, that the target group is healthy — and then destroy it completely. The test is self-contained.

If the module had hidden dependencies on external resources (the leaky module pattern), you could not test it this way. You would need to set up the external resources first, coordinate between multiple teams, and deal with shared state between tests. The test would be fragile and slow.

Composable modules are also easier to review in code review. A reviewer can look at the variable list and immediately understand what the module depends on. There are no surprise lookups hidden in the resource blocks.

## Putting It All Together

The four modules in the example — network, database, compute, load balancer — are composable because each one has a clear job, declares all dependencies as inputs, exposes only necessary outputs, and has no hidden dependency on external naming conventions or shared state.

The root configuration wires them together by passing outputs from earlier modules as inputs to later ones. Terraform reads these references, infers the dependency order, and applies the modules in the correct sequence without any manual instruction. Adding a fifth module — say a monitoring module that watches the auto-scaling group — requires only adding a new module block in the root configuration and passing the `autoscaling_group_name` output into it.

That growth pattern — adding new modules without touching existing ones, combining modules in new ways without rewriting them — is what composability enables. The library of modules grows alongside the organization, and each new project is assembled from proven pieces rather than built from scratch.

## What's Next

Composable modules are the building block. The next step is understanding how to manage multiple environments — development, staging, production — in a way that shares module code while keeping each environment's state completely separate. The next article covers Terraform workspaces and file-layout patterns, both common approaches to environment isolation, and the tradeoffs between them.


![Composable modules summary: keep one responsibility, expose a small interface, compose in the root, and test alone.](/content-assets/articles/article-iac-terraform-modules-composable/composable-modules-summary.png)

---

**References**

- [Module Composition (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/composition) — HashiCorp's official guidance on structuring modules for reuse and composition.
- [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/) — Microsoft-backed catalog and guidance for reusable Azure Terraform modules.
- [Terraform Up & Running, 3rd Edition (Yevgeniy Brikman)](https://www.terraformupandrunning.com) — Chapter 4 covers module design patterns in depth, including the pitfalls of monolithic modules and the benefits of small, focused modules.
- [Testing Terraform Modules (HashiCorp)](https://developer.hashicorp.com/terraform/language/tests) — Reference for the native `terraform test` framework, introduced in Terraform 1.6, for writing module tests directly in HCL.
