---
title: "Locals"
description: "Use Terraform local values to name repeated expressions inside a module without turning internal decisions into public inputs."
overview: "Locals keep repeated names, tags, and derived values readable inside a Terraform module. This article continues the AWS orders environment by giving common tags and name prefixes one clear home."
tags: ["terraform", "opentofu", "locals", "tags", "aws"]
order: 4
id: article-infrastructure-as-code-terraform-locals
---

## Table of Contents

1. [Where Should Repeated Decisions Live](#where-should-repeated-decisions-live)
2. [Locals](#locals)
3. [Name Prefixes](#name-prefixes)
4. [Common Tags](#common-tags)
5. [Derived Values](#derived-values)
6. [Module Boundaries](#module-boundaries)
7. [Common First Mistakes](#common-first-mistakes)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Where Should Repeated Decisions Live

The orders Terraform module now receives values from the outside. Development and production can supply different VPC CIDRs, instance types, allowed HTTP CIDRs, and extra tags.

The resource blocks still repeat internal decisions:

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = merge(var.tags, {
    Name        = "orders-${var.environment}-vpc"
    Environment = var.environment
  })
}

resource "aws_security_group" "web" {
  name        = "orders-${var.environment}-web"
  description = "Web ingress for the orders service."
  vpc_id      = aws_vpc.main.id

  tags = merge(var.tags, {
    Name        = "orders-${var.environment}-web-sg"
    Environment = var.environment
  })
}
```

Every resource needs the same environment tag. Most names start with `orders-${var.environment}`. The repeated expression is small, but the review problem grows with every resource. If the naming rule changes later, someone has to find every copy and update it consistently.

The question is where this kind of internal decision should live. It should not become another input variable if callers should not choose it directly. It needs a name inside the module. That is what locals are for.

## Locals

A local value assigns a name to an expression inside a module.

```hcl
locals {
  name_prefix = "orders-${var.environment}"
}
```

Other blocks in the same module read that value through the singular `local.` namespace:

```hcl
resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Web ingress for the orders service."
  vpc_id      = aws_vpc.main.id
}
```

The block keyword is `locals`, because the block can define several local values. The reference prefix is `local`, because each reference reads one named local value.

A local is not a second kind of input. A tfvars file cannot set `local.name_prefix`. A caller cannot override it from the command line. Terraform evaluates the expression from the values and resources available inside the module.

That makes locals useful for naming decisions, tag maps, calculated lists, and repeated expressions that belong to the module implementation.

## Name Prefixes

The orders module uses the same naming pattern for the VPC, security group, instance, and later outputs. A local gives that pattern one home:

```hcl
locals {
  name_prefix = "orders-${var.environment}"
}
```

The resources then read the local:

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Web ingress for the orders service."
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-web-sg"
  }
}

resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.web.id]

  tags = {
    Name = "${local.name_prefix}-web"
  }
}
```

The local does not make the configuration shorter in every line. It makes the rule explicit. A reviewer can now see that `orders-dev-web`, `orders-prod-web`, and `orders-staging-web` come from one naming expression.

Use locals this way when the expression has a meaning. A name like `name_prefix` teaches more than repeating string interpolation in every resource.

## Common Tags

Tags usually need both caller-provided values and module-owned values. The caller might supply ownership and cost metadata. The module should still set the service name, environment, and Terraform ownership consistently.

The input variable can accept extra tags:

```hcl
variable "tags" {
  description = "Extra tags to apply to created resources."
  type        = map(string)
  default     = {}
}
```

The local can build the final common tag map:

```hcl
locals {
  name_prefix = "orders-${var.environment}"

  common_tags = merge(var.tags, {
    Service     = "orders"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}
```

The `merge` function combines maps. When the same key appears more than once, the later map wins. In this example, module-owned tags come after `var.tags`, so a caller cannot accidentally replace `Environment` or `ManagedBy` through the generic tag map.

Each resource can then merge the common tags with its own `Name` tag:

```hcl
resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = "Web ingress for the orders service."
  vpc_id      = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-web-sg"
  })
}
```

Now tag review has a single source. If the organization adds `DataClass = "internal"` to every resource, the team changes `local.common_tags` instead of hunting through resources.

## Derived Values

Locals can also name derived values that would be awkward to read inline.

For example, the module might need a short description for the web security group:

```hcl
locals {
  name_prefix = "orders-${var.environment}"

  security_group_description = "HTTP access for ${local.name_prefix}"
}
```

The security group can read it:

```hcl
resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web"
  description = local.security_group_description
  vpc_id      = aws_vpc.main.id
}
```

This is a good local because the expression has a clear meaning and is used where a reader benefits from the name.

A local can become harmful when it hides simple information behind extra indirection. This is harder to read:

```hcl
locals {
  web_instance_type = var.instance_type
}
```

The resource should just use `var.instance_type`. The variable already has a useful name. A local that only renames it forces the reader to jump between files for no added meaning.

## Module Boundaries

Locals are scoped to the module where they are declared. A child module cannot read a local from its parent directly. A parent module cannot read a child module's locals directly.

If a parent module wants to pass the name prefix into a child module, it passes it as a module argument:

```hcl
module "web" {
  source = "../modules/web-server"

  name_prefix          = local.name_prefix
  vpc_id               = aws_vpc.main.id
  instance_type        = var.instance_type
  allowed_http_cidrs   = var.allowed_http_cidrs
  tags                 = local.common_tags
}
```

Inside the child module, those values arrive as input variables:

```hcl
variable "name_prefix" {
  description = "Prefix used for resources created by this module."
  type        = string
}
```

This boundary matters. Locals are implementation details. If a value needs to cross a module boundary, make that crossing visible through input variables or outputs.

## Common First Mistakes

**Using locals as hidden inputs.** If the caller needs to choose the value, declare a variable. A local should be derived inside the module.

**Wrapping every variable in a local.** `local.web_instance_type = var.instance_type` adds a hop without adding meaning.

**Forgetting merge order.** With `merge`, later maps win when keys repeat. Put the map with the intended winning keys last.

**Hiding important production differences.** A local can calculate a value from `var.environment`, but major production choices should stay visible as inputs when reviewers need to approve them.

**Expecting locals to cross module boundaries.** Locals belong to one module. Pass values through module arguments or outputs when another module needs them.

## Putting It All Together

The orders module now has a cleaner value flow.

Variables bring outside choices into the module:

```hcl
variable "environment" {
  description = "Deployment environment name."
  type        = string
}
```

Locals name decisions derived inside the module:

```hcl
locals {
  name_prefix = "orders-${var.environment}"

  common_tags = merge(var.tags, {
    Service     = "orders"
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}
```

Resources use both:

```hcl
resource "aws_instance" "web" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.web.id]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-web"
  })
}
```

The distinction is the main lesson. Variables are part of the module interface. Locals are part of the module implementation. Keeping those roles separate makes Terraform easier to review and easier to reuse.

## What's Next

The next article looks at values that leave the module. After Terraform creates the VPC, security group, and instance, humans, scripts, and parent modules often need selected results such as IDs and addresses. Outputs make those results intentional.

---

**References**

- [Use locals to reuse expressions](https://developer.hashicorp.com/terraform/language/values/locals) - Terraform guide to defining and referencing local values inside a module.
- [Manage values in modules](https://developer.hashicorp.com/terraform/language/values) - Terraform overview of how input variables, local values, and output values shape module interfaces.
- [Style Guide](https://developer.hashicorp.com/terraform/language/style) - Terraform style guidance for local values, file placement, and naming.
- [merge Function](https://developer.hashicorp.com/terraform/language/functions/merge) - Terraform reference for combining maps and objects.
