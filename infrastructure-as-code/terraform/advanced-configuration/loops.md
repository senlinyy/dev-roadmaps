---
title: "Loops: count and for_each"
description: "count and for_each create many similar resources from a single resource block instead of copied Terraform blocks."
overview: "Ten identical subnets or four EC2 instances that differ only in their availability zone do not need ten or four copied resource blocks. Terraform's count and for_each arguments let a single resource block create multiple real resources, each with slightly different settings."
tags: ["count", "for_each", "loops", "meta-arguments", "terraform"]
order: 2
id: article-iac-terraform-advanced-loops
---

## Table of Contents

1. [Three Copied Resources](#three-copied-resources)
2. [count for Plain Repetition](#count-for-plain-repetition)
3. [Why Indexes Can Hurt](#why-indexes-can-hurt)
4. [for_each for Named Items](#foreach-for-named-items)
5. [Looping Over Maps and Sets](#looping-over-maps-and-sets)
6. [dynamic for Nested Blocks Only](#dynamic-for-nested-blocks-only)
7. [Choosing the Smallest Loop](#choosing-the-smallest-loop)
8. [Putting It All Together](#putting-it-all-together)

The previous article introduced `count` and `for_each` as meta-arguments. This article slows down and uses one simple resource shape to show why the choice matters. The goal is practical: remove copy-paste while keeping Terraform's state addresses tied to the real things the team cares about.

We will start with three copied subnets for a web application, then move the same example through `count`, `for_each`, and `dynamic`. Every step has two questions. What code gets smaller? What address does Terraform store in state? The second question matters during every future plan.

## Three Copied Resources
<!-- section-summary: The need for loops appears after three copied blocks differ by only a few values. -->

Imagine a tiny web application that needs one subnet in each availability zone. The first version works, and it is easy to understand because every subnet has its own block.

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

This is fine for the first commit. The problem shows up during the second and third commits. A tag needs to be added to every subnet. A VPC reference gets renamed. A fourth availability zone appears. Every repeated block is another place to forget the same change.

Terraform has two main resource-level loop tools: **count** and **for_each**. Both are meta-arguments, so they belong inside a resource block and work across providers. They tell Terraform to create several instances from one block while still tracking each real cloud object in state.

The important word is **instances**. Terraform keeps one resource block in your code, then expands it into several resource instances in the plan and state. Reviewers should look at those instance addresses because the address is how Terraform remembers which cloud object is which during later changes.

That state address is the thread through the whole article. If the address uses a number, Terraform remembers a position. If the address uses a key, Terraform remembers a name. The right loop is the one whose address still makes sense after the next person changes the input.

## count for Plain Repetition
<!-- section-summary: count creates a fixed number of resource instances and gives each instance a numeric index. -->

`count` is the simplest loop. It says, "make this many copies." The subnet example can move the changing values into a list and let Terraform create one subnet per list item.

![Count Vs Foreach Identity](/content-assets/articles/article-iac-terraform-advanced-loops/count-vs-foreach-identity.png)

*The identity view compares position-based `count` instances with name-based `for_each` instances, which is the key review difference.*

```hcl
variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

resource "aws_subnet" "web" {
  count = length(var.availability_zones)

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, count.index + 1)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "web-${var.availability_zones[count.index]}"
  }
}
```

`length(var.availability_zones)` returns `3`, so Terraform plans three subnet instances. Inside the resource, `count.index` is the current copy number. The first copy uses index `0`, the second uses index `1`, and the third uses index `2`.

Those instances have addresses with numeric indexes:

```hcl
aws_subnet.web[0]
aws_subnet.web[1]
aws_subnet.web[2]
```

The indexes let you read matching values from lists. They also let you collect all generated values later:

```hcl
output "web_subnet_ids" {
  value = aws_subnet.web[*].id
}
```

This fits instances that are truly interchangeable. A small pool of identical workers, a feature that creates `var.replica_count` copies, or an optional resource with `count = var.enabled ? 1 : 0` can all use this style.

The plan shows the expansion:

```console
  # aws_subnet.web[0] will be created
  # aws_subnet.web[1] will be created
  # aws_subnet.web[2] will be created
```

Terraform stores those same addresses in state after apply. If you run `terraform state list`, the output uses the indexes too:

```bash
terraform state list aws_subnet.web
```

```console
aws_subnet.web[0]
aws_subnet.web[1]
aws_subnet.web[2]
```

Those addresses are how Terraform tracks each subnet in state. If the list order changes later, the index can point at a different intended subnet, which is why `count` works best for identical replicas.

That is why `count` is pleasant for replica-style resources. The number is the real decision, and the individual copies do not need business names.

## Why Indexes Can Hurt
<!-- section-summary: count tracks instances by position, so removing an item from the middle of a list can shift resource addresses. -->

The subnet list looks harmless until the team removes one availability zone from the middle. Maybe `us-east-1b` has capacity trouble, so the list changes from three zones to two.

```hcl
availability_zones = ["us-east-1a", "us-east-1c"]
```

The first subnet still lives at index `0`, but `us-east-1c` has moved from index `2` to index `1`. Terraform state remembers addresses, so it sees a change at `aws_subnet.web[1]` and the disappearance of `aws_subnet.web[2]`.

That can produce a plan that replaces or destroys more than the team intended. For a subnet, that is serious because other resources may depend on it. EC2 instances, databases, route tables, and load balancer attachments can all sit behind a subnet address.

The issue is resource identity. With `count`, Terraform remembers "the second subnet" rather than "the subnet for `us-east-1b`." After the list order changes, the meaning of "second" changes too.

A plan might show a replacement at index one and a destroy at index two even though the author only removed one zone:

```console
  # aws_subnet.web[1] must be replaced
 -/+ resource "aws_subnet" "web" {
      ~ availability_zone = "us-east-1b" -> "us-east-1c"
      ~ cidr_block        = "10.0.2.0/24" -> "10.0.3.0/24"
    }

  # aws_subnet.web[2] will be destroyed
```

In this plan, the list position is the identity. If the resource has a natural name, account, region, availability zone, or owner, `for_each` usually gives Terraform a safer identity to remember.

## for_each for Named Items
<!-- section-summary: for_each tracks resource instances by stable keys, so one removed key affects one resource instance. -->

The safer version gives every subnet a stable key. A map works well because the key can be the name Terraform should remember, and the value can hold the settings for that subnet.

```hcl
variable "web_subnets" {
  type = map(object({
    availability_zone = string
    netnum            = number
  }))

  default = {
    use1a = { availability_zone = "us-east-1a", netnum = 1 }
    use1b = { availability_zone = "us-east-1b", netnum = 2 }
    use1c = { availability_zone = "us-east-1c", netnum = 3 }
  }
}

resource "aws_subnet" "web" {
  for_each = var.web_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet("10.0.0.0/16", 8, each.value.netnum)
  availability_zone = each.value.availability_zone

  tags = {
    Name = "web-${each.key}"
  }
}
```

`for_each` creates one resource instance for each map entry. `each.key` is the stable name, such as `use1a`. `each.value` is the object with the availability zone and subnet number.

The state addresses now carry those keys:

```hcl
aws_subnet.web["use1a"]
aws_subnet.web["use1b"]
aws_subnet.web["use1c"]
```

If the team removes `use1b`, Terraform removes `aws_subnet.web["use1b"]`. The `use1a` and `use1c` addresses do not shift because their keys stayed the same.

Stable values belong inside the map too. The example stores `netnum` beside the availability zone so the CIDR block stays tied to the subnet key. If the code calculated subnet numbers from list position later, the index problem would sneak back in through a side door.

The plan now names the business key:

```console
  # aws_subnet.web["use1b"] will be destroyed
```

That address gives the reviewer the resource identity directly. The reviewer can ask, "Are we intentionally removing the `use1b` subnet?" without looking up which value currently lives at list position one.

If a module already used `count` in production and you need to migrate to `for_each`, plan the state address move as a separate refactor. Terraform supports `moved` blocks for address changes:

```hcl
moved {
  from = aws_subnet.web[0]
  to   = aws_subnet.web["use1a"]
}

moved {
  from = aws_subnet.web[1]
  to   = aws_subnet.web["use1b"]
}
```

After the move, `terraform plan` should show address moves rather than subnet replacements. That keeps the loop cleanup separate from a real infrastructure change.

The plan output should use wording like this after Terraform understands the move:

```console
  # aws_subnet.web[0] has moved to aws_subnet.web["use1a"]
  # aws_subnet.web[1] has moved to aws_subnet.web["use1b"]
```

That output means Terraform is changing the state address for the existing objects. It is very different from a plan that destroys the old indexed subnets and creates new keyed subnets.

## Looping Over Maps and Sets
<!-- section-summary: Maps fit resources with several per-item settings, while sets fit resources where the string itself is the identity. -->

Maps are the usual production choice because real resources often need more than one setting. An S3 bucket might need a retention period, an owner tag, and a lifecycle flag. An IAM user might need an email address, team name, and permission level.

```hcl
variable "log_buckets" {
  type = map(object({
    retention_days = number
    owner          = string
  }))

  default = {
    app     = { retention_days = 30, owner = "platform" }
    audit   = { retention_days = 365, owner = "security" }
    billing = { retention_days = 90, owner = "finance" }
  }
}

resource "aws_s3_bucket" "logs" {
  for_each = var.log_buckets
  bucket   = "dp-${each.key}-logs"

  tags = {
    owner     = each.value.owner
    retention = tostring(each.value.retention_days)
  }
}
```

A set of strings is enough for cases where the string is the whole identity. For example, a simple list of dashboard names can create one object per name.

```hcl
variable "dashboard_names" {
  type    = set(string)
  default = ["billing", "checkout", "search"]
}

resource "aws_cloudwatch_dashboard" "service" {
  for_each       = var.dashboard_names
  dashboard_name = "dp-${each.key}"
  dashboard_body = jsonencode({ widgets = [] })
}
```

Sets remove duplicates and do not preserve order. That is acceptable for `for_each` because Terraform tracks by string value, not by position. If the order matters to the resource, use a map with explicit keys and explicit order values.

A common mistake is to feed `for_each` a plain list. Terraform asks for a map or a set of strings because list indexes are exactly the identity problem `for_each` tries to avoid. Convert only if the string value is a good key:

```hcl
resource "aws_cloudwatch_dashboard" "service" {
  for_each = toset(var.dashboard_names)

  dashboard_name = "dp-${each.key}"
  dashboard_body = jsonencode({ widgets = [] })
}
```

If each item has more than one field, keep a map of objects instead of trying to squeeze everything into a string.

## dynamic for Nested Blocks Only
<!-- section-summary: dynamic repeats nested blocks inside one resource, and it should only appear for provider schemas that require repeated nested blocks. -->

Sometimes the repeated thing lives as a nested block inside one resource. Security group ingress blocks are a common teaching example because each allowed port has the same nested shape, and the provider schema accepts several `ingress` blocks in the same security group.

![Dynamic Block Expansion](/content-assets/articles/article-iac-terraform-advanced-loops/dynamic-block-expansion.png)

*The expansion view shows how one repeated nested block turns into several provider arguments without hiding the parent resource.*

```hcl
variable "allowed_ports" {
  type    = set(number)
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
      cidr_blocks = ["10.0.0.0/16"]
    }
  }
}
```

The `dynamic "ingress"` label must match a nested block type supported by that resource. Terraform generates one `ingress` block for each port. Inside `content`, `ingress.value` is the current port number.

`dynamic` belongs to repeated nested blocks. Several security group rule resources, buckets, or subnets usually belong behind `for_each` on the resource itself. A resource-level loop gives each object its own Terraform address, which gives plans and drift checks a clear target.

For current AWS modules, many teams prefer standalone `aws_vpc_security_group_ingress_rule` and `aws_vpc_security_group_egress_rule` resources for production security group rules. The dynamic block still teaches the language feature, but standalone rule resources give each rule its own address and change history.

The under-the-hood behavior is different from `for_each` on a resource. `dynamic` expands nested configuration blocks inside one resource instance. The state still has one `aws_security_group.app` address, so a change to one generated ingress block appears inside that resource. A standalone rule resource would give the port its own address, such as `aws_vpc_security_group_ingress_rule.app["https"]`.

That address boundary matters during incidents. If one rule is wrong, a separate rule resource gives the plan and state a smaller object to talk about.

## Choosing the Smallest Loop
<!-- section-summary: count fits simple numbers, for_each fits named objects, and dynamic fits repeated nested blocks. -->

The loop should match the thing Terraform must remember. If the instances are identical and only the number matters, `count` is small and clear. If each item has a name or settings, `for_each` with a map gives Terraform stable keys. If the provider asks for repeated nested blocks inside one resource, `dynamic` can generate those blocks.

This choice is part of production safety. A plan with `aws_subnet.web["use1c"]` tells reviewers exactly which subnet is changing. A plan with `aws_subnet.web[1]` asks reviewers to know which item currently sits at index one.

This quick check helps before choosing:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
terraform state list
```

`terraform plan -out=tfplan` saves the exact proposal. `terraform show -no-color tfplan` prints the saved plan in a review-friendly form. `terraform state list` shows the addresses Terraform already tracks. Comparing the plan with state helps catch index-based addresses such as `aws_subnet.web[1]` for a business identity that is really a named subnet like `use1b`.

If the resource addresses in the plan would still make sense to a teammate six months later, the loop identity is probably healthy. If the addresses are only numbers and every instance has a real name in the business, use a keyed map.

## Putting It All Together
<!-- section-summary: Terraform loops remove copy-paste, but the right loop also protects resource identity during later changes. -->

The subnet example started with three copied blocks. `count` removed the duplication, but it introduced numeric addresses that can shift after list items move. `for_each` fixed that by giving each subnet a stable key. `dynamic` handled the separate case where the repetition lives inside one resource block.

![Loops Summary](/content-assets/articles/article-iac-terraform-advanced-loops/loops-summary.png)

*The summary board keeps the loop decision practical: count for simple numbers, `for_each` for named things, and `dynamic` only for nested blocks.*

That is the practical flow. A copied version helps while the shape is still new. `count` fits number-only repetition. `for_each` fits named items. `dynamic` fits repeated nested blocks inside a provider schema.

A production review should check four things: whether the loop keys are stable, whether any removed key matches an intentional removal, whether the plan contains replacements caused by address changes, and whether outputs expose useful collections for callers. For example, a subnet module can return a map keyed the same way as the input:

```hcl
output "web_subnet_ids" {
  value = {
    for name, subnet in aws_subnet.web : name => subnet.id
  }
}
```

That output lets downstream modules keep the same stable keys instead of converting the result back into a fragile list.

---

**References**

- [Terraform count meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [Terraform for_each meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform dynamic blocks](https://developer.hashicorp.com/terraform/language/expressions/dynamic-blocks)
- [Terraform splat expressions](https://developer.hashicorp.com/terraform/language/expressions/splat)
- [Terraform state list command](https://developer.hashicorp.com/terraform/cli/commands/state/list)
- [Terraform moved blocks for refactoring](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [AWS provider aws_vpc_security_group_ingress_rule](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule)
- [AWS provider aws_vpc_security_group_egress_rule](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule)
