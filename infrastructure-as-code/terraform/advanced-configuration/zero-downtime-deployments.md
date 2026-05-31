---
title: "Zero-Downtime Deployments"
description: "Deploy infrastructure changes — including server replacements — without taking your application offline."
overview: "Updating a running server with Terraform often means replacing the old one with a new one. Without planning for traffic handoff and health checks, your application can go offline during the switch. This article covers the create_before_destroy lifecycle setting, blue-green deployments, and how to roll out changes to auto-scaling groups while keeping service interruption to a minimum."
tags: ["zero-downtime", "create_before_destroy", "lifecycle", "blue-green", "terraform"]
order: 3
id: article-iac-terraform-advanced-zero-downtime
---

## Table of Contents

1. [Why Terraform Replacements Cause Downtime](#why-terraform-replacements-cause-downtime)
2. [The lifecycle Block](#the-lifecycle-block)
3. [create_before_destroy: Creating the Replacement First](#create_before_destroy-creating-the-replacement-first)
4. [Blue-Green Deployments with Auto-Scaling Groups](#blue-green-deployments-with-auto-scaling-groups)
5. [Updating a Launch Template Without Replacing the Group](#updating-a-launch-template-without-replacing-the-group)
6. [Instance Refresh: Rolling Updates for Auto-Scaling Groups](#instance-refresh-rolling-updates-for-auto-scaling-groups)
7. [Azure Rolling and Slot-Based Updates](#azure-rolling-and-slot-based-updates)
8. [prevent_destroy: Protecting Critical Resources](#prevent_destroy-protecting-critical-resources)
9. [ignore_changes: Keeping Terraform Out of Certain Attributes](#ignore_changes-keeping-terraform-out-of-certain-attributes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Terraform Replacements Cause Downtime

Many infrastructure changes require Terraform to destroy the existing resource and create a new one. This is called a replacement, and Terraform's default behavior is to destroy first and create second.

The destroy-first approach causes downtime because there is a gap between when the old resource is gone and when the new resource is ready. For an EC2 instance, this gap is typically two to five minutes — the time it takes for the new instance to boot, run its initialization scripts, and pass the load balancer's health checks. During those minutes, traffic destined for the old instance has nowhere to go.

Changes that commonly trigger replacements include:
- Changing an EC2 instance's AMI (the operating system image)
- Changing an EC2 instance's availability zone
- Changing a security group's VPC
- Changing an RDS instance's identifier or engine version
- Changing any attribute that the cloud provider does not allow to be modified in-place

Terraform's plan output tells you which resources will be replaced. Look for lines marked with `+/-` (destroy and create) rather than `~` (modify in place). When you see `+/-`, think carefully about whether that replacement will cause downtime and whether `create_before_destroy` or another technique is appropriate.

## The lifecycle Block

The `lifecycle` block is a special sub-block inside resource blocks that modifies how Terraform handles the create, update, and destroy operations for that resource. It is not sent to the cloud provider — it only affects Terraform's own behavior.

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = var.instance_type

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = false
    ignore_changes        = []
  }
}
```

The four settings inside `lifecycle` are:

`create_before_destroy` — when set to `true`, Terraform creates the replacement resource before destroying the old one. This removes the Terraform destroy-before-create gap, but it does not automatically register the new resource with a load balancer, wait for application health, or move traffic safely.

`prevent_destroy` — when set to `true`, Terraform refuses to destroy this resource. Any plan that includes destroying this resource fails with an error. Used to protect databases and other critical resources from accidental deletion.

`ignore_changes` — a list of attribute names that Terraform should not track for change detection. When a listed attribute is changed outside of Terraform, Terraform ignores the difference and does not propose a plan to correct it.

`replace_triggered_by` — a list of resource references or resource attributes. When any item in the list changes, Terraform triggers a replacement of this resource even if none of this resource's own attributes changed. Useful for forcing an instance replacement when a new AMI is available.

## create_before_destroy: Creating the Replacement First

With `create_before_destroy = true`, Terraform reverses the order of operations during a replacement. It creates the new resource first and then destroys the old one after the provider reports creation complete.

![create_before_destroy changes the replacement order so the new resource can pass health checks before the old one is removed.](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/create-before-destroy-timeline.png)

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id

  lifecycle {
    create_before_destroy = true
  }
}
```

When you change `var.ami_id` to a new AMI value, Terraform plans a replacement. With `create_before_destroy`, the sequence is:

1. Create a new EC2 instance with the new AMI in the same subnet.
2. Wait for the cloud provider to report the new instance as created.
3. Destroy the old EC2 instance.

Provider "created" does not always mean "ready to serve users." If the new instance is behind a load balancer, you still need to model registration, health checks, warmup, and traffic handoff. This is where the combination with an auto-scaling group and instance refresh (covered later) becomes important.

There is a constraint to keep in mind: if the resource name must be unique in the cloud provider, you cannot have both the old and new resource with the same name at the same time. AWS security groups, for example, must have unique names within a VPC. With `create_before_destroy`, the new security group must have a different name than the old one while both exist simultaneously. Using a random suffix or a `name_prefix` argument (which lets AWS generate a unique name) solves this:

```hcl
resource "aws_security_group" "app" {
  name_prefix = "app-sg-"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}
```

`name_prefix` tells AWS to use the given string as the start of the name and append a provider-generated suffix. Each replacement gets a new unique name, so the old and new security groups can coexist during the transition.

## Blue-Green Deployments with Auto-Scaling Groups

A more sophisticated zero-downtime strategy for application servers is a blue-green deployment. You maintain two complete sets of servers — blue and green — and switch traffic between them.

![A traffic cutover shifts users from the old environment to the healthy new environment with a rollback path.](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/traffic-cutover-boundary.png)

In the blue-green model, only one color is active at a time and receives production traffic. The other color is either shut down (to save cost) or running with the previous version. To deploy a new version:

1. The inactive group gets new servers with the updated AMI or configuration.
2. The new servers initialize and run automated health checks.
3. The load balancer shifts traffic from the active group to the new group.
4. The old active group is shut down or kept as a rollback target.

In Terraform, this pattern is usually implemented with two auto-scaling groups behind the same load balancer. For a true blue-green cutover, the groups normally use separate target groups or weighted listener rules so you can decide which group receives traffic. The simplified version below uses capacity changes to show the idea:

```hcl
resource "aws_autoscaling_group" "blue" {
  name                = "${var.project}-blue"
  vpc_zone_identifier = [aws_subnet.web.id]
  min_size            = 0
  max_size            = 4
  desired_capacity    = var.blue_desired_capacity

  launch_template {
    id      = aws_launch_template.blue.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.blue.arn]
}

resource "aws_autoscaling_group" "green" {
  name                = "${var.project}-green"
  vpc_zone_identifier = [aws_subnet.web.id]
  min_size            = 0
  max_size            = 4
  desired_capacity    = var.green_desired_capacity

  launch_template {
    id      = aws_launch_template.green.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.green.arn]
}
```

In `terraform.tfvars`, the active deployment is:

```hcl
blue_desired_capacity  = 3
green_desired_capacity = 0
```

To deploy a new version, you update the green launch template with the new AMI, then apply with:

```hcl
blue_desired_capacity  = 3
green_desired_capacity = 3
```

Both groups run simultaneously. You verify the green instances are healthy and shift the load balancer listener to the green target group. Then:

```hcl
blue_desired_capacity  = 0
green_desired_capacity = 3
```

Blue is now idle. Green carries all traffic. The deployment is complete and the old instances are gone. To roll back, you shift the listener back to blue and restore the blue capacity.

## Updating a Launch Template Without Replacing the Group

An auto-scaling group (ASG) defines a fleet of EC2 instances. The group configuration — the VPC, the load balancer, the health check settings — is separate from the instance configuration — the AMI, the instance type, the user-data script. Instance configuration lives in a launch template.

When you update a launch template (for example, changing the AMI), the ASG itself does not change. The ASG uses the `$Latest` version of the launch template, but existing running instances do not automatically switch to the new version. They continue running with the old AMI until they are replaced.

This is actually useful. A launch template update is a low-risk Terraform change — it creates a new version of the template in AWS but does not touch any running instances. The plan and apply for a launch template change completes quickly with no disruption.

The next step — refreshing the actual instances with the new template version — is a deliberate, controlled operation.

## Instance Refresh: Rolling Updates for Auto-Scaling Groups

AWS Auto Scaling's instance refresh feature replaces instances in an ASG one at a time (or in configurable batches), waiting for new instances to pass health checks before terminating old ones. This is the recommended way to roll out a new AMI or configuration to a running fleet without downtime.

Terraform can trigger an instance refresh automatically when the launch template version changes:

```hcl
resource "aws_autoscaling_group" "app" {
  name                = "${var.project}-app"
  vpc_zone_identifier = [aws_subnet.web.id]
  min_size            = 2
  max_size            = 6
  desired_capacity    = 3

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 80
      instance_warmup        = 60
    }
  }

  target_group_arns = [aws_lb_target_group.app.arn]
}
```

When `aws_launch_template.app.latest_version` changes (because you updated the launch template), Terraform updates the ASG to use the new template version. AWS then starts an instance refresh, replacing instances in rolling batches. `min_healthy_percentage = 80` ensures that at least 80% of the desired capacity is healthy at all times during the refresh. `instance_warmup = 60` gives new instances 60 seconds after boot before they are counted toward the healthy percentage, allowing time for the application to start.

The rolling replacement continues until all instances run the new template version. If any instance fails to become healthy within the configured timeout, AWS pauses the refresh and allows you to investigate before continuing or cancelling.

## Azure Rolling and Slot-Based Updates

The same principle applies on Azure: Terraform can describe the infrastructure settings, but the Azure service controls the actual rollout mechanism.

For Azure Virtual Machine Scale Sets, platform rolling upgrades replace instances in batches and can pause between batches while health is checked. Terraform can configure the scale set and its upgrade policy, but availability depends on capacity, health probes, load balancer settings, and the rolling upgrade policy Azure applies.

For Azure App Service, deployment slots are often a better fit than replacing the production app directly. Terraform can create the production slot and a staging slot, while the deployment pipeline warms the staging slot and swaps it into production after validation. The important pattern is the same as the AWS examples: provision the new version, verify it is healthy, then move traffic.

## prevent_destroy: Protecting Critical Resources

Some resources should never be destroyed as part of a normal Terraform workflow — RDS databases, production S3 buckets with irreplaceable data, KMS keys that encrypt stored data. Accidentally destroying these resources could cause catastrophic data loss.

`prevent_destroy = true` makes Terraform refuse to destroy the resource in any plan:

```hcl
resource "aws_db_instance" "production" {
  identifier        = "prod-database"
  engine            = "postgres"
  instance_class    = "db.t3.large"
  allocated_storage = 100
  username          = var.db_username
  password          = var.db_password

  lifecycle {
    prevent_destroy = true
  }
}
```

If any plan includes destroying `aws_db_instance.production` — because someone accidentally ran `terraform destroy`, or because the database identifier was changed in code (triggering a replacement) — Terraform aborts with:

```
Error: Instance cannot be destroyed

  on main.tf line 1, in resource "aws_db_instance" "production":
   1: resource "aws_db_instance" "production" {

Resource aws_db_instance.production has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed.
```

To intentionally destroy a resource with `prevent_destroy = true` — for example, to decommission the database at end of life — you first remove the `lifecycle` block from the code, commit that change, and then run `terraform destroy`. The two-step process makes accidental deletion much harder.

## ignore_changes: Keeping Terraform Out of Certain Attributes

When an attribute is managed by something outside of Terraform — an auto-scaling policy that adjusts instance counts, an AWS feature that modifies tags automatically, an external application that updates configuration — Terraform will keep proposing to revert those changes on every plan.

`ignore_changes` tells Terraform to stop tracking specific attributes for drift detection:

```hcl
resource "aws_autoscaling_group" "app" {
  min_size         = 2
  max_size         = 10
  desired_capacity = 3

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
```

Without `ignore_changes`, if AWS's auto-scaling policies scale the group to 7 instances, the next `terraform plan` sees `desired_capacity` is `7` in reality but `3` in the configuration and proposes to change it back to `3`. With `ignore_changes = [desired_capacity]`, Terraform looks at the current value (`7`) and decides it does not matter — it will not change it.

Use `ignore_changes` sparingly. Every attribute you tell Terraform to ignore is an attribute where drift goes undetected. If you accidentally set `desired_capacity = 0` in your code and have `ignore_changes = [desired_capacity]`, Terraform will never catch it and will never propose to restore the correct capacity. The ASG will scale to zero on the next recycle and stay there.

Good candidates for `ignore_changes`: auto-scaling dynamic attributes (`desired_capacity`), tags managed by external systems, AMI IDs managed by a separate deployment pipeline.

## Putting It All Together

Low-downtime infrastructure updates are a combination of architectural choice, platform rollout behavior, and Terraform configuration.

For single instances or simple resources, `create_before_destroy` ensures the replacement exists before the original is gone, eliminating the Terraform destruction gap. For auto-scaling groups running web applications, instance refresh provides a rolling replacement strategy that can keep the application available when health checks and capacity are configured correctly. For applications that need stronger guarantees during upgrades, a blue-green deployment maintains two parallel fleets and switches traffic deliberately.

The `lifecycle` block gives you fine-grained control over Terraform's create, update, and destroy behavior. `create_before_destroy` and `instance_refresh` handle update safety. `prevent_destroy` provides a guard against catastrophic mistakes. `ignore_changes` keeps Terraform from fighting with other systems that legitimately modify specific attributes.

## What's Next

With advanced configuration techniques covered, the final module moves into automation: how to run Terraform in CI/CD pipelines, how to enforce organization-wide policies using Policy as Code, and how to test Terraform configurations to catch mistakes before they reach production.


![Zero-downtime deployment summary: create first, check health, shift traffic, and protect critical resources.](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/zero-downtime-summary.png)

---

**References**

- [The lifecycle Meta-Argument (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle) — Full reference for all `lifecycle` settings: `create_before_destroy`, `prevent_destroy`, `ignore_changes`, and `replace_triggered_by`.
- [AWS Auto Scaling Instance Refresh (AWS Documentation)](https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html) — How instance refresh works, including warmup periods, health checks, and cancellation behavior.
- [Configure Rolling Upgrades for Azure Virtual Machine Scale Sets (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-configure-rolling-upgrades) — Azure guidance for rolling scale set upgrades.
- [Upgrade Policy Modes for Azure Virtual Machine Scale Sets (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/virtual-machine-scale-sets-upgrade-policy) — How manual, automatic, and rolling upgrade policies affect VM scale set changes.
- [Terraform Up & Running, 3rd Edition (Yevgeniy Brikman)](https://www.terraformupandrunning.com) — Chapter 5 covers zero-downtime deployment patterns in depth, including a full blue-green deployment implementation.
