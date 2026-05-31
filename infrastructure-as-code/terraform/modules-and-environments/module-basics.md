---
title: "Module Basics"
description: "Learn what Terraform modules are, why they exist, and how to create and use your first reusable module."
overview: "Terraform modules let you group related resources into a named, reusable unit with a defined interface. This article explains the problem they solve, how they are structured on disk, and how to call one from another configuration."
tags: ["modules", "reuse", "terraform", "hcl"]
order: 1
id: article-iac-terraform-modules-basics
---

## Table of Contents

1. [The Problem Modules Solve](#the-problem-modules-solve)
2. [What a Module Actually Is](#what-a-module-actually-is)
3. [Your First Module: A Shared Network](#your-first-module-a-shared-network)
4. [Calling a Module From Your Root Configuration](#calling-a-module-from-your-root-configuration)
5. [How Terraform Resolves a Module Call](#how-terraform-resolves-a-module-call)
6. [The Root Module and Child Modules](#the-root-module-and-child-modules)
7. [What Gets Isolated Inside a Module](#what-gets-isolated-inside-a-module)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem Modules Solve

A Terraform module is a directory of `.tf` files used as a reusable configuration unit with its own inputs, resources, and outputs.

Imagine your team manages three separate environments: a development environment that engineers use every day, a staging environment where you test releases before they go live, and a production environment where real customers log in. Each environment needs a private network, a handful of virtual servers, a database, and firewall rules to connect them. In total, you are describing the same logical structure three times.

Without any way to share that structure, your Terraform files become three separate copies of the same resource blocks. A developer on your team changes a firewall rule in the development configuration to fix a networking bug. Two weeks later the same bug appears in staging. Someone else patches staging. A month later it surfaces in production. Each copy quietly drifts from the others, and tracking down the differences requires reading hundreds of lines spread across three directories.

Modules eliminate this copying. You write the network, server, and database blocks once in a dedicated directory. Then your development, staging, and production configurations each reference that single directory as a module, passing different values, different region names, different server sizes, different IP address ranges, as inputs. When you fix a bug in the module, every environment picks up the fix the next time you run `terraform apply`. There is no second or third copy to forget.

The pattern is exactly what you do in a programming language when you extract repeated logic into a function. You write the function once, call it from multiple places, pass different arguments each time, and get consistent results everywhere. Terraform modules are that same idea applied to infrastructure resources.

## What a Module Actually Is

A module is a Terraform configuration directory with a boundary around it. The boundary gives the directory its own inputs, resources, locals, and outputs. Example: `modules/network/` can contain the VPC and subnet resources, while callers only provide CIDR ranges and read subnet IDs back.

If a directory contains one or more Terraform configuration files, it is a module. You can give that directory any name you want. Terraform does not care whether it is called `network`, `vpc`, `base-infra`, or anything else.

![A module call passes inputs into a child module boundary and receives selected outputs back.](/content-assets/articles/article-iac-terraform-modules-basics/module-call-boundary.png)

What matters is what is inside the directory. A typical module contains three files, each with a conventional but not mandatory name. The first is `main.tf`, which holds the actual resource blocks that the module manages. The second is `variables.tf`, which declares what values the caller must provide (similar to function parameters). The third is `outputs.tf`, which declares what information the module exposes back to the caller (similar to a function's return value). You can put everything in one file if you like, but separating these three concerns makes the module much easier to read and maintain.

Here is what a minimal module directory looks like on disk:

```
modules/
  network/
    main.tf
    variables.tf
    outputs.tf
```

That is all a module is: a directory with some `.tf` files in it. The power comes from how Terraform loads them and how you reference them from another configuration.

## Your First Module: A Shared Network

A shared network module is a reusable directory that creates the standard network pieces other stacks need. It exists so every environment can create the same network shape without copying the VPC and subnet blocks. Example: development can pass `10.0.0.0/16`, while staging passes `10.1.0.0/16`, and both get the same module structure.

To make this concrete, suppose you are building that shared network module. The network needs a virtual private cloud (a VPC, which is a logically isolated section of the cloud provider's network), two subnets inside it, one for web servers and one for databases, and an internet gateway plus route table entries for public outbound traffic. An internet gateway by itself is only an attached doorway; a subnet becomes public only when its route table sends internet-bound traffic to that gateway, and instances still need a public IPv4 address or Elastic IP for direct public IPv4 access.

Here is the `main.tf` inside the `modules/network` directory:

```hcl
resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
}

resource "aws_subnet" "web" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.web_subnet_cidr
  availability_zone = var.web_availability_zone
}

resource "aws_subnet" "db" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.db_subnet_cidr
  availability_zone = var.db_availability_zone
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_route_table" "web" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "web" {
  subnet_id      = aws_subnet.web.id
  route_table_id = aws_route_table.web.id
}
```

The resource blocks reference variables with the `var.` prefix. Those variables are declared in `variables.tf`:

```hcl
variable "web_availability_zone" {
  type        = string
  description = "Availability zone for the web subnet, for example us-east-1a."
}

variable "db_availability_zone" {
  type        = string
  description = "Availability zone for the database subnet, for example us-east-1b."
}

variable "cidr_block" {
  type        = string
  description = "The IP address range for the entire VPC, in CIDR notation."
}

variable "web_subnet_cidr" {
  type        = string
  description = "IP range for the web server subnet."
}

variable "db_subnet_cidr" {
  type        = string
  description = "IP range for the database subnet."
}
```

And `outputs.tf` exposes the identifiers that a caller will need to attach other resources to this network:

```hcl
output "vpc_id" {
  value       = aws_vpc.this.id
  description = "The ID of the VPC created by this module."
}

output "web_subnet_id" {
  value       = aws_subnet.web.id
  description = "The ID of the web-tier subnet."
}

output "db_subnet_id" {
  value       = aws_subnet.db.id
  description = "The ID of the database-tier subnet."
}
```

The module does not know anything about the environment it will be used in. It does not know whether it is running in development or production. It does not know the actual IP addresses. All of that comes in through the variables when a caller invokes the module. This separation is what makes the module reusable.

## Calling a Module From Your Root Configuration

A module call is a block in the root configuration that points to a module source and supplies values for that module's variables. It is similar to calling a function with arguments. Example: `module "network" { source = "./modules/network" ... }` tells Terraform to load the network module and pass in the VPC and subnet CIDR ranges.

The configuration directory where you run `terraform apply` is called the root module. That is where you wire everything together. To use your network module, you write a `module` block in your root configuration:

```hcl
module "network" {
  source = "./modules/network"

  web_availability_zone = "us-east-1a"
  db_availability_zone  = "us-east-1b"
  cidr_block      = "10.0.0.0/16"
  web_subnet_cidr = "10.0.1.0/24"
  db_subnet_cidr  = "10.0.2.0/24"
}
```

The `source` argument tells Terraform where to find the module's directory. Here it is a relative path (`./modules/network`), which means Terraform looks for that directory starting from the root configuration's location. The remaining arguments, `cidr_block`, `web_subnet_cidr`, `db_subnet_cidr`, `web_availability_zone`, and `db_availability_zone`, correspond exactly to the variables declared in the module's `variables.tf`. If you pass an argument that has no matching variable, Terraform throws an error. If you forget a required variable (one with no default value), Terraform also throws an error before doing anything.

To refer to the outputs that the module exposes, you use the pattern `module.<name>.<output_name>`. For example, if you want to place an EC2 instance inside the web subnet created by this module, you can write:

```hcl
resource "aws_instance" "app_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.small"
  subnet_id     = module.network.web_subnet_id
}
```

`module.network.web_subnet_id` reaches into the module and retrieves the subnet ID that was declared in the module's `outputs.tf`. The EC2 instance does not need to know how the subnet was created or what VPC it belongs to. It just receives an ID and attaches.

For staging, you create another root configuration in a different directory and call the same module with different inputs:

```hcl
module "network" {
  source = "../../modules/network"

  web_availability_zone = "us-west-2a"
  db_availability_zone  = "us-west-2b"
  cidr_block      = "10.1.0.0/16"
  web_subnet_cidr = "10.1.1.0/24"
  db_subnet_cidr  = "10.1.2.0/24"
}
```

One module definition. Two callers. Different inputs. Each environment gets its own isolated set of resources, but the logic for creating those resources lives in exactly one place.

## How Terraform Resolves a Module Call

Resolving a module call means finding the module source code Terraform should use for that call. Local sources are read from the filesystem, while remote sources are downloaded during `terraform init`. Example: `source = "./modules/network"` uses your local directory, but a Registry or Git source is copied into `.terraform/modules/`.

When you run `terraform init` in a directory that contains module blocks, Terraform reads all the `module` blocks and resolves the `source` paths. For local path sources, those starting with `./` or `../`, Terraform reads the module directly from that local directory. If you later edit the source files in `modules/network/`, you do not need to re-run `terraform init` just because the local module content changed.

For remote sources, such as modules hosted on the Terraform Registry, in a Git repository, or in an S3 bucket, `terraform init` performs a real download and stores the files in `.terraform/modules/`. Those downloaded files are a local copy of the selected module package. That is why you need to re-run `terraform init` whenever you add a new remote module source or change a version constraint.

After the init step, when you run `terraform plan`, Terraform evaluates every module block by loading its source files and processing the variable inputs. Each resource inside the module gets a unique address in Terraform's internal graph that includes the module path. For example, the VPC resource inside the `network` module gets the address `module.network.aws_vpc.this`. This namespacing means two different module calls can both contain an `aws_vpc` resource named `this` without colliding.

## The Root Module and Child Modules

The root module is the directory where you run Terraform commands. A child module is any module called from that root module. Example: `environments/prod` can be the root module, and `module.network` plus `module.database` are child modules inside that production run.

Terraform always has exactly one root module. A child module can itself call other child modules, creating a tree of modules. There is no limit to how deep this tree can go, but in practice most teams keep it shallow, one or two levels, because deeply nested modules become harder to understand and debug.

![The root module orchestrates child modules while each child keeps its resources encapsulated.](/content-assets/articles/article-iac-terraform-modules-basics/root-child-module-flow.png)

The root module is special in one concrete way: it is where Terraform stores the state file by default, and it is where the backend configuration (which tells Terraform where to store state remotely) must be declared. Child modules do not have their own state files. All resources managed by all modules in a single `terraform apply` run go into the same state file, regardless of which module created them. This is what allows resources in different modules to reference each other's outputs.

Because all resources share one state file, destroying the root module, running `terraform destroy`, destroys everything, including all resources created by all child modules. This is intentional: a root module represents a complete, coherent piece of infrastructure.

## What Gets Isolated Inside a Module

A module namespace is the private naming area for the module's resources and locals. Callers cannot reach into it unless the module exposes a value through an output. Example: `modules/network` can create a route table internally, but the root module cannot reference it unless the network module declares an output for it.

Resources defined inside a module are not visible to the root module or to sibling modules unless they are explicitly published through an `output` block. If the `modules/network` module creates a route table internally to manage traffic routing but does not expose it as an output, the caller has no way to reference that route table. The caller only sees what the module intentionally exposes.

This isolation is a deliberate design choice. It lets the module author change internal implementation details, perhaps switching from a single route table to multiple route tables for better traffic control, without breaking any caller. As long as the module's variables and outputs stay the same, every configuration that calls the module continues working without any changes. This is the same principle as a function with a stable interface: callers depend on the contract, not the internals.

There are limits to what modules isolate. Modules share the same provider configuration as their caller. If you configure the AWS provider with a specific region and access credentials in your root module, every child module that uses AWS resources also uses that same configuration by default. A module can accept an alternative provider configuration through a mechanism called provider aliases, but by default providers flow down from the root without any extra setup.

Modules also share Terraform's data sources. A `data` block inside a module can query any AWS resource it has permission to read, using the same provider credentials as a `data` block in the root module. A module does not receive an isolated credential boundary by default. It runs with the same credentials and the same level of access as everything else in the configuration.

## Putting It All Together

Return to the original problem: three environments, each needing the same network and server structure. With a module, the shape of the problem changes completely.

The `modules/network` directory contains the authoritative definition of what a network looks like in your organization. It declares variables for the VPC address range, the web and database subnet ranges, and the availability zones for each subnet. It creates one VPC, two subnets, an internet gateway, and the route table wiring that makes the web subnet's internet path explicit. It exposes three outputs: the VPC ID, the web subnet ID, and the database subnet ID.

Your `environments/dev/` directory contains a `main.tf` that calls this module with development-specific inputs. Your `environments/staging/` and `environments/prod/` directories do the same with different inputs. Each environment directory has its own state file, so a `terraform apply` in `environments/dev/` never touches production resources.

When someone finds a misconfiguration in the network, say the internet gateway is missing a route, they fix it once in `modules/network/main.tf`. The next time someone runs `terraform plan` in any of the three environment directories, Terraform detects the difference between what exists and what the updated module describes. Three environments, one fix, zero copying.

The same logic applies to the servers, the databases, and the firewall rules. Each piece of the infrastructure can live in its own module, tested independently and composed freely.

## What's Next

You now understand what a module is, how to write one, and how to call it with different inputs for different environments. The next article covers module inputs and outputs in depth, the full set of variable types, default values, validation rules, and the different ways to pass complex data structures like maps and lists into a module and receive structured results back out.


![Module basics summary: reuse structure, pass inputs, hide internals, and return outputs.](/content-assets/articles/article-iac-terraform-modules-basics/module-basics-summary.png)

---

**References**

- [Modules Overview (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules), Official reference for module syntax, sources, and the init/plan/apply lifecycle.
- [Module Blocks (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/syntax), Detailed syntax reference for the `module` block, including meta-arguments like `count` and `for_each`.
- [Enable Internet Access with an Internet Gateway (AWS Documentation)](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html), AWS explanation of the required route table and public-address conditions for internet access.
- [Terraform Up & Running, 3rd Edition (Yevgeniy Brikman)](https://www.terraformupandrunning.com), The definitive practical guide to structuring Terraform projects, with extensive coverage of module patterns and real-world use cases.
