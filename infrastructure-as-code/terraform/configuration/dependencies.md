---
title: "Resource Dependencies"
description: "Understand how Terraform discovers resource order from references, when depends_on is useful, and how dependency choices appear in plan output."
overview: "Terraform does not use file order to decide what runs first. It follows references between resources, data sources, modules, and outputs. This article uses a small application stack to show implicit dependencies, explicit dependencies, cycles, and plan output."
tags: ["terraform", "dependencies", "graph", "depends_on"]
order: 4
id: article-iac-terraform-config-dependencies
---

## Table of Contents

1. [What a Dependency Means in Terraform](#what-a-dependency-means-in-terraform)
2. [The App Stack We Will Trace](#the-app-stack-we-will-trace)
3. [Implicit Dependencies from References](#implicit-dependencies-from-references)
4. [How Dependencies Show Up in the Plan](#how-dependencies-show-up-in-the-plan)
5. [When depends_on Is the Right Tool](#when-depends_on-is-the-right-tool)
6. [Cycles and How Teams Break Them](#cycles-and-how-teams-break-them)
7. [Module Dependencies Without Blocking Everything](#module-dependencies-without-blocking-everything)
8. [Putting It All Together](#putting-it-all-together)

## What a Dependency Means in Terraform
<!-- section-summary: A Terraform dependency tells the planner which value or operation must exist before another block can be planned or applied safely. -->

A **dependency** is an ordering relationship between two Terraform objects. It says one object needs a value, state record, or side effect from another object before Terraform can safely continue. A database that receives a KMS key ARN depends on the key. A public access block that receives an S3 bucket ID depends on the bucket.

Terraform finds most dependencies by reading references in your `.tf` files. If a resource argument says `kms_key_id = aws_kms_key.app.arn`, Terraform can see that the database needs the key ARN. You do not need to write a separate step that says "create the key first." The reference already says that.

This is why Terraform projects can split code across files without using file order. You can place the KMS key in `security.tf` and the database in `database.tf`. Terraform loads the whole directory, reads the references, and plans the order from those relationships.

## The App Stack We Will Trace
<!-- section-summary: A small web application stack gives us enough dependencies to see the real rules without turning the article into a giant production diagram. -->

Imagine a team deploying a small internal service. The service stores audit events in an encrypted database, runs on an EC2 instance, and needs an IAM policy attachment before its boot script can read a private S3 bucket. The database dependency is visible in an argument. The boot-time IAM dependency is a platform timing requirement that may need an explicit edge.

Here is the simplified `main.tf`:

```hcl
resource "aws_kms_key" "database" {
  description             = "KMS key for the audit database"
  deletion_window_in_days = 7
}

resource "aws_db_instance" "audit" {
  allocated_storage           = 20
  engine                      = "postgres"
  instance_class              = "db.t3.micro"
  db_name                     = "audit"
  username                    = "audit_admin"
  manage_master_user_password = true
  skip_final_snapshot         = true

  storage_encrypted = true
  kms_key_id        = aws_kms_key.database.arn
}

resource "aws_iam_role" "app" {
  name = "audit-app-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "read_config" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}

resource "aws_iam_instance_profile" "app" {
  name = "audit-app-profile"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                  = var.app_ami_id
  instance_type        = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.app.name
}
```

This file already has several dependencies. The database consumes the KMS key ARN. The policy attachment consumes the IAM role name. The instance profile consumes the IAM role name. The EC2 instance consumes the instance profile name. Terraform reads each reference and creates ordering from it.

## Implicit Dependencies from References
<!-- section-summary: An implicit dependency is the normal Terraform path: pass one object's attribute into another object's argument and let Terraform infer the order. -->

An **implicit dependency** comes from a reference expression. The database example uses one:

```hcl
kms_key_id = aws_kms_key.database.arn
```

That single line does two useful jobs. It gives the database the exact key ARN returned by AWS, and it tells Terraform the database must wait for the key operation. The reference is stronger than copying a literal ARN by hand because Terraform can connect the planned database change to the planned key change.

The same thing happens here:

```hcl
resource "aws_iam_instance_profile" "app" {
  name = "audit-app-profile"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                  = var.app_ami_id
  instance_type        = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.app.name
}
```

The instance profile waits for the role name. The EC2 instance waits for the instance profile name. Terraform can plan those steps without you writing a manual runbook.

The practical review habit is simple: prefer references over copied strings. If a resource needs an ID, ARN, name, endpoint, subnet list, security group ID, or policy document from another Terraform block, pass the reference directly. That makes the dependency visible in the code and in the plan.

:::expand[How Terraform uses the dependency graph]{kind="design"}
Terraform builds an internal graph from configuration, state, and provider schemas. A graph node can represent a resource, data source, provider configuration, module call, or a create, update, or destroy operation. A graph edge records that one node must wait for another node.

The useful beginner detail is that the graph lets Terraform run independent work in parallel. A KMS key and an IAM role can be created during the same apply because they do not need each other. The database waits for the KMS key, and the instance profile waits for the IAM role. This gives Terraform both safety and speed.

The exact graph representation can feel abstract, so connect it back to plan review. If the plan shows many resources waiting on one broad `depends_on`, the graph has less room for parallel work. If the plan shows references flowing through resource attributes, Terraform can usually order only the parts that truly depend on each other.
:::

## How Dependencies Show Up in the Plan
<!-- section-summary: Plan output marks provider-generated dependency values as known after apply and shows the arguments that already have concrete input values. -->

The plan does not print every dependency edge as a plain sentence. Instead, it shows you where values are already known and where Terraform must wait for provider results.

The KMS-backed database plan can look like this:

```hcl
  # aws_kms_key.database will be created
  + resource "aws_kms_key" "database" {
      + arn                    = (known after apply)
      + description            = "KMS key for the audit database"
      + deletion_window_in_days = 7
      + id                     = (known after apply)
    }

  # aws_db_instance.audit will be created
  + resource "aws_db_instance" "audit" {
      + allocated_storage   = 20
      + engine              = "postgres"
      + identifier          = (known after apply)
      + kms_key_id          = (known after apply)
      + storage_encrypted   = true
    }
```

`kms_key_id` is known after apply because the database consumes `aws_kms_key.database.arn`, and AWS has to create the key before Terraform can know the final ARN. The plan tells you the value path: the database argument is fed by another resource, and Terraform will resolve it during apply.

Now compare the instance profile path:

```hcl
  # aws_iam_instance_profile.app will be created
  + resource "aws_iam_instance_profile" "app" {
      + name = "audit-app-profile"
      + role = "audit-app-role"
    }

  # aws_instance.app will be created
  + resource "aws_instance" "app" {
      + ami                  = "ami-1234567890abcdef0"
      + iam_instance_profile = "audit-app-profile"
      + instance_type        = "t3.micro"
    }
```

Some values are already concrete because the configuration provides the names directly. The dependency still exists because the EC2 instance reads `aws_iam_instance_profile.app.name`. Terraform will still order the profile before the instance even though the string value is visible in the plan.

## When depends_on Is the Right Tool
<!-- section-summary: depends_on is for real ordering requirements that Terraform cannot infer from value references. -->

`depends_on` is a meta-argument that creates an explicit dependency. Use it when a real ordering requirement exists but no argument reference shows that requirement to Terraform.

The EC2 boot script is a good example. The instance references the instance profile, so Terraform knows the profile must exist first. The instance may also need the S3 read policy attachment to be fully active before the boot script starts. The instance block does not naturally consume the attachment's ID, so Terraform may not see that timing requirement.

That is where an explicit dependency helps:

```hcl
resource "aws_instance" "app" {
  ami                  = var.app_ami_id
  instance_type        = "t3.micro"
  iam_instance_profile = aws_iam_instance_profile.app.name

  depends_on = [
    aws_iam_role_policy_attachment.read_config
  ]
}
```

This says the app instance must wait for the policy attachment. The reason belongs in the surrounding review discussion: the boot script reads configuration from S3 during startup, and that read depends on the role policy being attached.

`depends_on` should stay narrow. A resource-level dependency on one policy attachment is usually clearer than a module-level dependency that makes every resource inside one module wait for every resource inside another module. Broad dependencies slow applies and can make plans show more values as unknown because Terraform has to be conservative.

## Cycles and How Teams Break Them
<!-- section-summary: A cycle means Terraform cannot choose a safe first step, so teams break cycles by separating containers from rules or splitting one operation into phases. -->

A **cycle** is a dependency loop. Resource A needs resource B first, and resource B needs resource A first. Terraform stops because no safe first operation exists.

Security groups often teach this lesson. A team wants app servers to talk to Redis, and Redis should only accept traffic from the app security group. If both security groups define inline rules that reference the other group, Terraform can end up with a loop.

The practical pattern is to create the security group containers first, then create the rules as separate resources:

```hcl
resource "aws_security_group" "app" {
  name   = "audit-app"
  vpc_id = var.vpc_id
}

resource "aws_security_group" "redis" {
  name   = "audit-redis"
  vpc_id = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "app_to_redis" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_app" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
```

Now the two security groups can be created first because they do not depend on each other. The two rule resources wait for both group IDs. This same pattern appears with IAM roles and policy attachments, route tables and routes, DNS zones and records, and other resources where the container can exist before its contents.

:::expand[How to read a cycle error without panic]{kind="pitfall"}
A cycle error often lists several resource addresses. Start by finding the smallest pair of resources that reference each other. In a security group case, look for inline rules that use the other group's ID. In a module case, look for two modules where each one consumes an output from the other.

The fix usually changes shape rather than order. Moving a block earlier in a file will not break the cycle because Terraform does not use file order as the dependency model. Splitting a resource into a container and separate child resources often gives Terraform a valid first step.

After the change, run `terraform plan` again and check the resource addresses. The plan should show the containers created first and the child rules consuming their IDs. If the plan still reports a cycle, repeat the same process with the remaining addresses until the hidden loop is gone.
:::

## Module Dependencies Without Blocking Everything
<!-- section-summary: Passing precise outputs between modules usually creates better dependencies than broad module-level depends_on. -->

Modules can depend on each other through outputs. A network module might create subnets, and an app module might consume those subnet IDs:

```hcl
module "network" {
  source = "./modules/network"

  environment = var.environment
}

module "app" {
  source = "./modules/app"

  environment        = var.environment
  private_subnet_ids = module.network.private_subnet_ids
}
```

This is a precise dependency. The app module waits where it consumes `module.network.private_subnet_ids`. Terraform can still plan unrelated resources inside each module where no dependency exists.

A broad module dependency looks like this:

```hcl
module "app" {
  source = "./modules/app"

  environment = var.environment

  depends_on = [
    module.network
  ]
}
```

Use that shape only for a hidden module-wide ordering requirement. Most of the time, passing the exact output is clearer. It documents the value the app actually needs, gives Terraform a more precise graph, and makes the plan easier to explain in review.

## Putting It All Together
<!-- section-summary: Good Terraform dependency design uses references for real data flow, keeps explicit dependencies narrow, and breaks cycles by changing resource shape. -->

When you review Terraform dependencies, trace the values first. A resource that consumes another resource's ID, ARN, name, endpoint, or output usually has the dependency it needs. The plan will show some of those values directly and mark provider-generated values as known after apply.

Reach for `depends_on` when a real platform behavior is invisible in the arguments, such as a boot script that needs an IAM policy attachment active before the instance starts. Keep that edge narrow and easy to justify in review.

When Terraform reports a cycle, split the problem into stable containers and separate rules or attachments. That gives Terraform a safe first step and keeps your configuration close to how cloud APIs usually work.

For official reference, use the Terraform docs for [references to values](https://developer.hashicorp.com/terraform/language/expressions/references), [the `depends_on` meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on), [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan), and [`terraform graph`](https://developer.hashicorp.com/terraform/cli/commands/graph).
