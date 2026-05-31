---
title: "Loops: count and for_each"
description: "Create many similar resources from a single resource block using count and for_each instead of copy-pasting."
overview: "When you need ten identical subnets or four EC2 instances that differ only in their availability zone, writing ten or four separate resource blocks is wasteful and error-prone. Terraform's count and for_each arguments let a single resource block create multiple real resources, each with slightly different settings."
tags: ["count", "for_each", "loops", "meta-arguments", "terraform"]
order: 1
id: article-iac-terraform-advanced-loops
---

## Table of Contents

1. [The Repetition Problem](#the-repetition-problem)
2. [count: Creating Multiple Copies by Number](#count-creating-multiple-copies-by-number)
3. [Accessing the Index Inside a count Resource](#accessing-the-index-inside-a-count-resource)
4. [The Downside of count: Index-Based Addressing](#the-downside-of-count-index-based-addressing)
5. [for_each: Creating Copies by Name](#for_each-creating-copies-by-name)
6. [for_each With a Map](#for_each-with-a-map)
7. [for_each With a Set of Strings](#for_each-with-a-set-of-strings)
8. [Choosing Between count and for_each](#choosing-between-count-and-for_each)
9. [Dynamic Blocks: Loops Inside Resource Arguments](#dynamic-blocks-loops-inside-resource-arguments)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Repetition Problem

Suppose you are building a private network with one subnet in each of three availability zones. Without any looping mechanism, you write three nearly identical resource blocks:

```hcl
resource "aws_subnet" "web_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "web_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_subnet" "web_c" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "us-east-1c"
}
```

Three blocks. Three times the code to maintain. If you add a fourth availability zone later, you add a fourth block. If you change the VPC ID — say, you rename the VPC resource — you update it in three places.

Terraform provides two mechanisms for creating multiple resources from one block: `count` and `for_each`. Both are meta-arguments, meaning they work on any resource block regardless of the provider. They tell Terraform "create this resource N times" or "create one copy of this resource for each item in this collection."

## count: Creating Multiple Copies by Number

The `count` meta-argument takes a whole number and creates that many copies of the resource. Each copy is a fully independent real resource with its own unique cloud ID.

Rewriting the three subnets with `count`:

```hcl
variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

resource "aws_subnet" "web" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, count.index)
  availability_zone = var.availability_zones[count.index]
}
```

`count = length(var.availability_zones)` evaluates to `3`, so Terraform creates three subnet resources. `count.index` is a special value available inside a `count` resource: it is the zero-based index of the current copy, ranging from `0` to `count - 1`. For the first subnet, `count.index` is `0`. For the second, it is `1`. For the third, it is `2`.

`cidrsubnet("10.0.0.0/16", 8, count.index)` is a built-in function that computes sub-network CIDR blocks. The `8` is the `newbits` argument: it extends the original `/16` network by 8 bits, producing `/24` subnets. With net numbers 0, 1, and 2, the function returns `10.0.0.0/24`, `10.0.1.0/24`, and `10.0.2.0/24`. Each subnet gets a unique address range automatically.

`var.availability_zones[count.index]` picks the availability zone that corresponds to the current index. Index 0 maps to `us-east-1a`, index 1 to `us-east-1b`, and index 2 to `us-east-1c`.

## Accessing the Index Inside a count Resource

The subnets created by `count` are stored in state as a list. Their Terraform addresses are:
- `aws_subnet.web[0]`
- `aws_subnet.web[1]`
- `aws_subnet.web[2]`

To reference all of them as a list — for example, to pass all subnet IDs to a load balancer — you use the splat expression:

```hcl
resource "aws_lb" "main" {
  name               = "app-lb"
  internal           = false
  load_balancer_type = "application"
  subnets            = aws_subnet.web[*].id
}
```

`aws_subnet.web[*].id` gives you a list of all three subnet IDs in the same order as the original list. This is the same as `[for s in aws_subnet.web : s.id]` but more concise.

To reference a single specific subnet by index, you use `aws_subnet.web[0].id`. This is valid but creates a fragile dependency: if the list of availability zones ever changes order, index 0 might point to a different subnet.

## The Downside of count: Index-Based Addressing

The major weakness of `count` is that Terraform identifies each copy by its index. If you remove an element from the middle of the list, every element after it shifts down by one index. Terraform sees this as every resource from that index onward changing its address, which often means destroying and recreating them.

Suppose you have three subnets at indexes 0, 1, and 2 corresponding to zones `us-east-1a`, `us-east-1b`, and `us-east-1c`. You decide to remove `us-east-1b`. The new list is `["us-east-1a", "us-east-1c"]`. After the removal:

- Index 0 is still `us-east-1a` — no change.
- Index 1 is now `us-east-1c` — but Terraform's state has index 1 as `us-east-1b`.

Terraform sees index 1 changing from `us-east-1b` to `us-east-1c` and proposes to destroy the `us-east-1b` subnet and create a new `us-east-1c` subnet. The `us-east-1c` subnet that was at index 2 is also destroyed because index 2 no longer exists in the new list.

Destroying real subnets because you removed an element from a list is dangerous. Subnets may have running EC2 instances or databases attached to them. The plan might show an unexpected destroy that you only catch if you read the plan output carefully.

This is the problem that `for_each` solves.

## for_each: Creating Copies by Name

The `for_each` meta-argument creates one copy of the resource for each element in a set or map. Each copy is identified by a stable key — a string that does not change when you add or remove other elements. Removing one element from the collection removes exactly that one resource and nothing else.

Rewriting the subnets with `for_each` works best when each key carries the values that must stay stable, such as the availability zone and the subnet number:

```hcl
variable "web_subnets" {
  type = map(object({
    availability_zone = string
    netnum            = number
  }))
  default = {
    use1a = { availability_zone = "us-east-1a", netnum = 0 }
    use1b = { availability_zone = "us-east-1b", netnum = 1 }
    use1c = { availability_zone = "us-east-1c", netnum = 2 }
  }
}

resource "aws_subnet" "web" {
  for_each = var.web_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, each.value.netnum)
  availability_zone = each.value.availability_zone
}
```

`for_each = var.web_subnets` creates one subnet per map entry. Inside the resource block, `each.key` is the stable Terraform key, like `"use1a"`, and `each.value` contains the values for that subnet. Keeping `netnum` inside the object matters: if you used `index(var.availability_zones, each.key)` to calculate the CIDR block, changing the input list order could still move address ranges around even though the resource keys were stable.

The subnet resources now have Terraform addresses keyed by availability zone name:
- `aws_subnet.web["use1a"]`
- `aws_subnet.web["use1b"]`
- `aws_subnet.web["use1c"]`

If you remove `use1b` from the map, Terraform sees that `aws_subnet.web["use1b"]` no longer exists in the `for_each` collection and proposes to destroy only that subnet. The subnets for `use1a` and `use1c` are untouched. No index shifting. No accidental destroys.

## for_each With a Map

When the resources you want to create differ in more than one attribute, using a map as the `for_each` value is cleaner than managing parallel lists.

Suppose you need to create multiple IAM users, each with different settings:

```hcl
variable "users" {
  type = map(object({
    email    = string
    team     = string
    admin    = bool
  }))
  default = {
    alice = { email = "alice@example.com", team = "platform", admin = true  }
    bob   = { email = "bob@example.com",   team = "backend",  admin = false }
    carol = { email = "carol@example.com", team = "frontend", admin = false }
  }
}

resource "aws_iam_user" "team" {
  for_each = var.users
  name     = each.key
  tags = {
    email = each.value.email
    team  = each.value.team
  }
}

resource "aws_iam_user_policy_attachment" "admin" {
  for_each   = { for k, v in var.users : k => v if v.admin }
  user       = aws_iam_user.team[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```

`for_each = var.users` creates one IAM user per map entry. `each.key` is the username (like `"alice"`). `each.value` is the corresponding object with `email`, `team`, and `admin` fields. `each.value.email` accesses the email for the current user.

The second resource uses a `for` expression to filter only the admin users: `{ for k, v in var.users : k => v if v.admin }`. This produces a map containing only the entries where `admin` is `true`. Terraform then attaches the admin policy only to those users.

Adding a new user means adding one entry to the `users` variable map. Removing a user means removing their entry. No index shifting. No risk of removing the wrong resource.

## for_each With a Set of Strings

When all the resources in a group differ only in one attribute — a name, an ID — a `set(string)` is the cleanest `for_each` value:

```hcl
variable "s3_buckets" {
  type    = set(string)
  default = ["logs", "uploads", "backups"]
}

resource "aws_s3_bucket" "app" {
  for_each = var.s3_buckets
  bucket   = "my-company-${each.key}"
}
```

This creates three S3 buckets: `my-company-logs`, `my-company-uploads`, and `my-company-backups`. Each is tracked in state as `aws_s3_bucket.app["logs"]`, `aws_s3_bucket.app["uploads"]`, and `aws_s3_bucket.app["backups"]`.

To collect all bucket names into a list (to pass as a variable to another resource or module), use a `for` expression:

```hcl
output "bucket_names" {
  value = [for b in aws_s3_bucket.app : b.bucket]
}
```

## Choosing Between count and for_each

Use `count` when:
- You want a simple number of identical resources with no meaningful difference between them (other than an index).
- You are toggling a resource on or off with a boolean: `count = var.enable_monitoring ? 1 : 0`.
- The resources will not be added or removed from the middle of the list — you will only ever add to the end or remove from the end.

![count uses numeric indexes that can shift, while for_each uses stable keys that preserve resource identity.](/content-assets/articles/article-iac-terraform-advanced-loops/count-vs-foreach-identity.png)

Use `for_each` when:
- Resources differ from each other in meaningful ways (different names, settings, or configurations).
- You need to be able to add or remove individual resources without affecting others.
- You want a stable, human-readable state address (`aws_iam_user.team["alice"]` is more meaningful than `aws_iam_user.team[0]`).

In practice, `for_each` is the better default for almost everything except simple on/off toggling. The index-shifting problem with `count` has caused real production incidents, and `for_each` avoids it entirely.

## Dynamic Blocks: Loops Inside Resource Arguments

Sometimes you do not need to create multiple resources — you need to create multiple repeated blocks inside a single resource. AWS security group rules are a classic example: a security group has one `ingress` block per allowed inbound port, and you want to specify those ports as a list without duplicating the block structure.

![Dynamic blocks repeat nested argument blocks inside one resource rather than creating multiple resources.](/content-assets/articles/article-iac-terraform-advanced-loops/dynamic-block-expansion.png)

A `dynamic` block generates repeated blocks inside a resource from a collection:

```hcl
variable "allowed_ports" {
  type    = list(number)
  default = [80, 443, 8080]
}

resource "aws_security_group" "app" {
  name   = "app-sg"
  vpc_id = aws_vpc.main.id

  dynamic "ingress" {
    for_each = var.allowed_ports
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

The `dynamic "ingress"` block generates one `ingress` configuration block for each element in `var.allowed_ports`. Inside the `content` sub-block, `ingress.value` is the current port number. This produces the same result as writing three separate `ingress` blocks manually, but from a list that can be changed without editing the resource structure.

The label after `dynamic` must match the name of the repeated block type in the resource schema — `ingress` for security group inbound rules, `rule` for some IAM resources, `setting` for Elastic Beanstalk, and so on. Check the provider documentation for the resource type to find which blocks can be dynamic.

## Putting It All Together

Three subnets, one resource block. Ten S3 buckets, one resource block. A security group with five inbound rules declared in a list, one resource block with a dynamic block. Terraform's `count` and `for_each` arguments turn repetitive, copy-pasted configuration into concise, parameterized declarations.

`count` is simple and works well for on/off toggling and truly identical resources. `for_each` is more robust for collections that might change over time, because it tracks each resource by a stable key rather than a fragile index. `dynamic` handles the case where the repetition is inside a resource's arguments rather than across separate resources.

Together, these tools eliminate most of the configuration repetition that makes Terraform projects hard to maintain as they grow.

## What's Next

Loops create multiple resources from one definition. The next article covers conditionals in more depth: how to use the ternary expression, `count`-based toggling, and `for_each` filtering to control which resources exist based on input values and environment settings.


![Loops summary: use count for simple copies, prefer keyed identity for change, and use dynamic blocks for nested arguments.](/content-assets/articles/article-iac-terraform-advanced-loops/loops-summary.png)

---

**References**

- [count Meta-Argument (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/meta-arguments/count) — Full reference for the `count` argument, `count.index`, and list-based resource collections.
- [for_each Meta-Argument (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each) — Full reference for the `for_each` argument, `each.key`, `each.value`, and map/set-based resource collections.
- [Dynamic Blocks (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/dynamic-blocks) — Reference for generating repeated nested blocks with the `dynamic` keyword.
