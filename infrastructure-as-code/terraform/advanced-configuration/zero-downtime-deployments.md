---
title: "Zero-Downtime Deployments"
description: "Terraform rollout patterns reduce service interruption during infrastructure changes, including server replacements."
overview: "Updating a running server with Terraform often means replacing the old one with a new one. Without planning for traffic handoff and health checks, your application can go offline during the switch. This article covers the create_before_destroy lifecycle setting, blue-green deployments, and how to roll out changes to auto-scaling groups while keeping service interruption to a minimum."
tags: ["zero-downtime", "create_before_destroy", "lifecycle", "blue-green", "terraform"]
order: 4
id: article-iac-terraform-advanced-zero-downtime
---

## Table of Contents

1. [One Replacement Outage](#one-replacement-outage)
2. [Replacement Before Destruction](#replacement-before-destruction)
3. [Health Checks Before Traffic Moves](#health-checks-before-traffic-moves)
4. [Deliberate Traffic Movement](#deliberate-traffic-movement)
5. [Rolling Replacement for Fleets](#rolling-replacement-for-fleets)
6. [State and Import Boundaries](#state-and-import-boundaries)
7. [Rollback Boundaries](#rollback-boundaries)
8. [Putting It All Together](#putting-it-all-together)

The previous articles showed how meta-arguments, loops, and conditionals change Terraform's plan. This article applies those ideas to one production problem: replacing infrastructure while users are still sending requests.

Terraform can create the new infrastructure, keep state aligned, and change routing resources. The runtime systems still have their own jobs. A load balancer proves whether a target is healthy. Auto Scaling decides whether a rolling refresh can continue. Application metrics show whether real requests are succeeding. A zero-downtime rollout needs evidence from all of those layers.

## One Replacement Outage
<!-- section-summary: A replacement can cause downtime if Terraform removes the old object before the new object is ready to serve traffic. -->

Picture a small web application running on one EC2 instance. The instance uses an AMI variable, and the team changes that AMI to roll out a patched image. Terraform reads the new value, compares it with state, and plans to replace the instance.

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id

  tags = {
    Name = "billing-app"
  }
}
```

In the plan, a replacement often shows as a destroy-and-create action. The exact marker depends on the CLI output, but reviewers should look for actions that include both delete and create for the same address. For a single server, that can mean the old instance is terminated, then the new instance boots, installs packages, starts the app, and finally passes health checks.

Users only care about the gap. If all traffic points at the old instance and Terraform removes it first, the application has no healthy target while the new instance starts. The first protection layer is to change the replacement order.

In a plan, reviewers should pause on replacement markers:

```console
  # aws_instance.app must be replaced
 -/+ resource "aws_instance" "app" {
      ~ ami = "ami-older" -> "ami-newer"
    }

Plan: 1 to add, 0 to change, 1 to destroy.
```

The plan tells you Terraform needs a new instance. A zero-downtime review also needs the traffic path, health check, state address, and rollback plan beside the plain Terraform action count.

## Replacement Before Destruction
<!-- section-summary: create_before_destroy changes Terraform's replacement order, but the new object still needs unique names and real readiness checks. -->

Terraform's **lifecycle** block changes how Terraform handles a resource during create, update, and destroy operations. The most common setting for replacement safety is `create_before_destroy`.

![Create Before Destroy Timeline](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/create-before-destroy-timeline.png)

*The timeline shows the intended low-downtime sequence: create the replacement, prove it is ready, then remove the old object.*

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "billing-app"
  }
}
```

With this setting, Terraform creates the replacement instance first and destroys the old instance later. That removes the Terraform-managed gap where the old object disappears before the new object exists.

This setting has an important practical limit. The cloud provider must allow the old and new objects to exist at the same time. If a resource name must be globally or regionally unique, the replacement needs a generated name, a suffix, or a `name_prefix` style argument so both copies can coexist during the handoff.

```hcl
resource "aws_security_group" "app" {
  name_prefix = "billing-app-"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}
```

A provider-created object only proves the API accepted the object. Application readiness for users needs a separate signal. The next safety layer is health checking.

There are two common mistakes with `create_before_destroy`. The first is using a fixed unique name, such as a security group name or target group name that the cloud API will reject while the old object still exists. The second is assuming the lifecycle setting moves traffic. It only changes Terraform's create and destroy order for that resource and its dependency graph. Traffic still needs a load balancer, service discovery update, DNS change, or release step.

The plan should show both clues. A healthy replacement plan creates the new object before removing the old one, and the configuration gives the new and old copies room to coexist.

## Health Checks Before Traffic Moves
<!-- section-summary: Terraform can create infrastructure, while load balancer and application health checks prove whether the new target can receive users. -->

The billing instance should sit behind a load balancer rather than receive traffic directly. The load balancer can keep sending users to healthy targets while a new target is starting. This gives the deployment a place to test readiness before traffic moves.

```hcl
resource "aws_lb_target_group" "app" {
  name     = "billing-app"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}
```

A health check should test something the application needs in order to serve real traffic. A shallow "process is running" endpoint can miss broken database credentials or failed migrations. A production-ready `/health` endpoint usually checks the app process, essential dependencies, and any startup work that must finish before requests arrive.

Terraform can declare the target group and health check settings. The load balancer performs the repeated health checks during the rollout. That separation matters because Terraform is an infrastructure planner, while the load balancer is the traffic controller.

A practical rollout checks the target group directly after apply:

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TARGET_GROUP_ARN"
```

The useful field is `TargetHealth.State`. A value of `healthy` means the load balancer can send traffic to that target. `Reason` and `Description` explain states such as failed health checks, registration delay, or draining, which helps separate a Terraform change from an application startup problem.

A healthy response might look like this:

```console
TargetId        Port  State    Reason
i-0abc12345     8080  healthy
i-0def67890     8080  healthy
```

An unhealthy response gives the next investigation step:

```console
TargetId        Port  State      Reason
i-0def67890     8080  unhealthy  Target.ResponseCodeMismatch
```

That output means Terraform may have created the instance and target attachment correctly, while the application health endpoint is returning the wrong status. The fix might be application config, database connectivity, security group access, or a bad image. Terraform is part of the rollout, but the health check tells you whether users can safely reach the new target.

For an Auto Scaling group, the group should also use load balancer health checks if the load balancer is the real readiness gate:

```hcl
resource "aws_autoscaling_group" "app" {
  health_check_type         = "ELB"
  health_check_grace_period = 120
  target_group_arns         = [aws_lb_target_group.app.arn]
}
```

The grace period gives new instances time to boot before Auto Scaling judges them. If the period is too short, healthy instances can churn during deployment. If it is too long, a bad version can sit behind slow feedback. Teams usually tune this from real startup time and load balancer health history.

## Deliberate Traffic Movement
<!-- section-summary: A safe cutover prepares the new target, proves health, changes routing, and keeps the old target available long enough for rollback. -->

Once the app is behind a load balancer, the deployment can move traffic deliberately. A common approach is blue-green deployment. Blue is the current group serving users. Green is the new group prepared with the new AMI or configuration.

![Traffic Cutover Boundary](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/traffic-cutover-boundary.png)

*The traffic boundary keeps Terraform actions separate from runtime readiness and user-facing routing.*

```hcl
resource "aws_lb_listener_rule" "green" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.green.arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}
```

The exact routing shape depends on the platform. Some teams switch an ALB listener from the blue target group to the green target group. Some use weighted target groups and shift from 10 percent to 50 percent to 100 percent. Some use DNS for a service boundary larger than one load balancer.

The important steps stay the same: green capacity comes up, health checks and smoke tests pass, traffic moves, error rate and latency stay under review, and blue stays available until the team has confidence that green is serving real production traffic.

Terraform can model the listener rule, target groups, and desired capacities. The pipeline or release process should decide the cutover time because that decision depends on health, monitoring, and human approval.

Weighted forwarding is a useful intermediate shape for services that can tolerate gradual exposure:

```hcl
resource "aws_lb_listener_rule" "app" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.blue.arn
        weight = var.green_weight == 100 ? 0 : 100 - var.green_weight
      }

      target_group {
        arn    = aws_lb_target_group.green.arn
        weight = var.green_weight
      }
    }
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}
```

The release runbook can move `green_weight` from `10` to `50` to `100` with a plan and approval at each step. After each step, target health, HTTP 5xx rate, latency, and application error logs should be checked. The blue target group and its capacity should stay alive until the rollback window closes.

A staged Terraform run can make the traffic decision visible:

```bash
terraform plan -var='green_weight=10' -out=tfplan
terraform show -no-color tfplan
terraform apply tfplan
```

The rendered plan should show only the listener rule weight change and any intended capacity changes. If it also shows target group replacement, subnet replacement, or a destroy of the blue fleet, stop the rollout and split those changes into a separate review.

After the 10 percent step, the verification should use runtime signals:

```console
green target health: healthy
HTTP 5xx rate:       below rollback threshold
p95 latency:         within release window target
error logs:          no new startup or dependency errors
```

Those lines can come from the team's monitoring tool, AWS CLI output, or CI release checks. The important part is that traffic moves only after both Terraform plan review and runtime checks agree.

## Rolling Replacement for Fleets
<!-- section-summary: Auto Scaling instance refresh replaces fleet members in batches while preserving a configured amount of healthy capacity. -->

Many services run more than one instance. For those fleets, replacing every instance at once can cause an outage even if each individual replacement is created first. AWS Auto Scaling groups can roll a launch template change through the fleet with an instance refresh.

```hcl
resource "aws_launch_template" "app" {
  name_prefix   = "billing-app-"
  image_id      = var.ami_id
  instance_type = "t3.small"
}

resource "aws_autoscaling_group" "app" {
  name                = "billing-app"
  min_size            = 3
  max_size            = 6
  desired_capacity    = 3
  vpc_zone_identifier = values(aws_subnet.web)[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]

  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      min_healthy_percentage = 80
      instance_warmup        = 120
    }
  }
}
```

The launch template describes how to build a new instance. The Auto Scaling group describes how many instances should run and where they should attach. The instance refresh tells AWS to replace instances gradually after the template changes.

`min_healthy_percentage` is the guardrail. With desired capacity `3` and a value of `80`, AWS keeps most of the fleet healthy while it replaces instances. `instance_warmup` gives a new instance time to boot and start the app before AWS treats it as healthy for the rollout.

Terraform configures and starts this provider operation, while AWS performs the rolling replacement. The pipeline should still watch the Auto Scaling activity, load balancer health, and application metrics after apply.

The runbook should include the provider-side commands because Terraform apply may finish before the whole fleet has settled:

```bash
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name billing-app

aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names billing-app
```

The first command reads refresh progress: `Status`, `PercentageComplete`, and any `StatusReason` explain whether the replacement is still moving. The second command shows current desired capacity, in-service instance count, and launch template details for the group. If the refresh fails, stop the release, inspect Auto Scaling activities, and decide whether to roll traffic back, cancel the refresh, or push a corrected launch template.

A healthy refresh output might show steady progress:

```console
InstanceRefreshId  Status      PercentageComplete
ir-0123456789      InProgress  66
```

A finished refresh should show a changed status:

```console
InstanceRefreshId  Status      PercentageComplete
ir-0123456789      Successful  100
```

A failed refresh needs a different response:

```console
InstanceRefreshId  Status  PercentageComplete  StatusReason
ir-0123456789      Failed  33                  Instance failed ELB health checks
```

That failure is a runtime rollout failure. Terraform configured the Auto Scaling group, but AWS stopped the replacement because the new instances did not pass health checks. The rollback path may be to send traffic back to blue, cancel the refresh, or publish a corrected launch template. Do not treat a completed `terraform apply` as proof that the whole fleet finished rolling.

## State and Import Boundaries
<!-- section-summary: Low-downtime changes can fail if Terraform state does not match reality or if imported resources use addresses that force replacement. -->

Replacement safety depends on Terraform knowing which object it manages. If state points at the wrong object, or a resource was renamed without a state move, a tidy code change can produce a risky plan.

For a simple rename, use a `moved` block so Terraform understands the address changed while the real object stayed the same:

```hcl
moved {
  from = aws_lb_target_group.app
  to   = aws_lb_target_group.blue
}
```

For an existing cloud object that Terraform should start managing, import it before changing its configuration:

```bash
terraform import aws_lb_target_group.blue arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/billing-blue/abc123
terraform plan
```

The first argument is the Terraform address that will manage the object. The second argument is the provider import ID, which is the existing AWS target group ARN in this example. A successful import adds the object to state; the follow-up plan should then show only configuration differences that need reconciliation.

A successful import usually prints a short confirmation:

```console
Import successful!

The resources that were imported are shown above. These resources are now in
your Terraform state and will henceforth be managed by Terraform.
```

The first plan after import should be treated as reconciliation work. The team checks which settings Terraform wants to change, updates configuration to match the intended state, and only then plans the rollout change. Importing and replacing in the same review makes the risky action difficult to isolate.

State also matters for `create_before_destroy`. Terraform records enough lifecycle behavior in state to keep dependency ordering safe. That is helpful, but it means teams should review lifecycle changes carefully and avoid editing state by hand except through an explicit state workflow.

Two lifecycle settings often appear near low-downtime work, and they need careful review:

```hcl
resource "aws_db_instance" "primary" {
  identifier = "billing-prod"

  lifecycle {
    prevent_destroy = true
  }
}
```

`prevent_destroy` protects critical resources from accidental destroy plans. It is useful for databases, long-lived buckets, and production keys. The tradeoff is operational: a planned decommission now needs an explicit code change that removes or changes the guardrail, so the review should include backup and ownership evidence.

```hcl
resource "aws_autoscaling_group" "app" {
  desired_capacity = 3

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
```

`ignore_changes` can keep Terraform from fighting an autoscaler that adjusts capacity during the day. It should only cover fields another controller intentionally owns. If a team hides broad attributes with `ignore_changes = all`, Terraform may stop reporting drift that matters during a rollout.

## Rollback Boundaries
<!-- section-summary: Terraform rollback usually means a new plan, while failed traffic cutovers often need provider or deployment controls first. -->

Rollback means different things at different layers. If the cutover sends traffic to green and error rates spike, the fastest rollback is usually to send traffic back to blue. That is a load balancer or release-control action, and it should happen before the team spends time reshaping Terraform code.

If Terraform changed infrastructure incorrectly, rollback usually means a new code change and a new plan. The team can restore the AMI variable, the old listener target, or the previous capacity values, then run the normal plan and approval flow. This keeps state, code, and cloud resources aligned.

Databases need a separate boundary. Engine upgrades, schema migrations, and data changes can have their own rollback rules. Terraform can create database infrastructure, but the application team still needs migration plans, backups, restore testing, and compatibility checks before a deployment that changes stored data.

The safest rollout has a written stop point. Before apply, the team knows which metric fails the rollout, which person can move traffic back, how long blue stays alive, and which Terraform change will reconcile the final state after the incident is stable.

A simple rollback record for the billing service should include the previous AMI, the previous listener target or weight, the Auto Scaling group name, the target group health output, the dashboard link used for error rate, and the commit that will reconcile Terraform afterward. This evidence lets the team move quickly during the incident and still clean up state and code after users are safe.

For a weighted blue-green rollout, the fastest Terraform-shaped traffic rollback is usually the previous weight:

```bash
terraform plan -var='green_weight=0' -out=tfplan
terraform show -no-color tfplan
terraform apply tfplan
```

The plan should show the listener forwarding all traffic back to blue. If the incident is active and the team has an approved emergency control in the load balancer or release tool, use that control first, then reconcile Terraform afterward so state and code describe the recovered traffic path.

For an Auto Scaling instance refresh that is still running, AWS has a provider-side stop button:

```bash
aws autoscaling cancel-instance-refresh \
  --auto-scaling-group-name billing-app
```

The follow-up command should show the refresh is no longer replacing instances:

```console
InstanceRefreshId  Status     PercentageComplete
ir-0123456789      Cancelled  33
```

Canceling the refresh stops the rolling operation. The team still needs the load balancer health output, the previous launch template or AMI value, and a Terraform plan that reconciles any traffic changes or unhealthy instances already launched.

## Putting It All Together
<!-- section-summary: Low-downtime Terraform work combines replacement order, health checks, traffic control, state hygiene, and clear rollback ownership. -->

The small outage started with one replaced EC2 instance. `create_before_destroy` fixed the resource ordering problem. Health checks added a readiness signal. Traffic cutover kept users on the healthy path while the new version warmed up. Instance refresh handled the same idea for a fleet.

![Zero Downtime Summary](/content-assets/articles/article-iac-terraform-advanced-zero-downtime/zero-downtime-summary.png)

*The summary board gathers the checks a team needs before calling a Terraform replacement safe for users.*

The last pieces are operational. State and import work should be clean before the rollout. Rollback should name the layer that can recover fastest: load balancer routing for bad traffic, Terraform code for bad infrastructure configuration, and database procedures for data changes.

Before a production replacement, run:

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
terraform state list
```

`plan -out=tfplan` saves the exact proposed actions into a binary plan file. `show -no-color tfplan` renders that saved plan in a review-friendly form without terminal color codes. `state list` shows the currently tracked addresses, which should match the important objects in the rendered plan. The review should confirm replacement order, resource addresses, and the absence of surprise destroys before apply.

Then check the non-Terraform readiness signals: load balancer health checks, Auto Scaling refresh status, application metrics, and rollback ownership. The plan is necessary evidence, but zero downtime comes from combining the plan with the traffic system that keeps healthy capacity in front of users.

The production runbook should end with three decisions. Roll forward after green is healthy and metrics stay inside the release window. Roll back traffic if users are at risk. Reconcile Terraform after the service is stable so state, code, and cloud resources agree again.

---

**References**

- [Terraform lifecycle meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
- [Terraform resource lifecycle tutorial](https://developer.hashicorp.com/terraform/tutorials/state/resource-lifecycle)
- [Terraform import command](https://developer.hashicorp.com/terraform/cli/import)
- [Terraform moved blocks for refactoring](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [AWS Auto Scaling instance refresh](https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html)
- [Elastic Load Balancing target group health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [Amazon RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments.html)
