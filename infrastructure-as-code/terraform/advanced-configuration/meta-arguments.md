---
title: "Meta-Arguments: Controlling Resources"
description: "Meta-arguments control how Terraform protects resources, creates repeated instances, orders hidden dependencies, and chooses provider aliases."
overview: "Meta-arguments are Terraform instructions about how to manage a resource or module block. This article introduces lifecycle, count, for_each, depends_on, and provider aliases before the next articles go deeper into repetition, conditionals, and safe replacement."
tags: ["terraform", "meta-arguments", "lifecycle", "providers"]
order: 1
id: article-iac-terraform-config-meta-arguments
aliases:
  - infrastructure-as-code/terraform/configuration/meta-arguments.md
---

## Table of Contents

1. [A Resource Block Has Two Kinds of Instructions](#a-resource-block-has-two-kinds-of-instructions)
2. [lifecycle for Guardrails and Replacement Behavior](#lifecycle-for-guardrails-and-replacement-behavior)
3. [count for a Simple Number of Instances](#count-for-a-simple-number-of-instances)
4. [for_each for Named Instances](#foreach-for-named-instances)
5. [depends_on for Hidden Ordering](#dependson-for-hidden-ordering)
6. [provider for the Right Account or Region](#provider-for-the-right-account-or-region)
7. [Plan and State Address Review](#plan-and-state-address-review)
8. [Putting It All Together](#putting-it-all-together)

This module is about configuration that changes how Terraform behaves. The next articles spend more time on loops, conditionals, and low-downtime replacement. This first article gives you the control knobs that show up across all of those topics.

The example is a small billing service. It stores monthly exports in S3, runs web workers in private subnets, writes logs to CloudWatch, and keeps a disaster recovery copy in a second AWS region. The resource arguments describe those cloud objects. The meta-arguments tell Terraform how to manage the blocks that create them.

The most important habit is plan review. A meta-argument can change a resource address, a provider target, a dependency edge, or a destroy rule. Those changes are visible before apply if you know where to look.

## A Resource Block Has Two Kinds of Instructions
<!-- section-summary: Normal arguments configure provider objects, while meta-arguments tell Terraform how to manage the block itself. -->

A normal argument describes the remote object. In an S3 bucket resource, `bucket = "dp-billing-prod-exports"` names the bucket AWS should create. In an EC2 instance resource, `instance_type = "t3.small"` tells AWS which size to run.

A **meta-argument** describes Terraform's handling of the block. It answers questions such as: should this resource be protected from accidental destroy, should one block create several instances, should Terraform wait for a side effect it cannot infer, or should this resource use a provider alias for another region?

Here is the short map before we look at each one:

| Meta-argument | Main job | Address impact |
|---|---|---|
| `lifecycle` | Controls destroy protection, replacement order, and selected drift handling | Usually keeps the same address, but changes plan behavior |
| `count` | Creates a number of instances from one block | Adds numeric addresses like `aws_instance.worker[0]` |
| `for_each` | Creates one instance per map key or set item | Adds keyed addresses like `aws_s3_bucket.logs["audit"]` |
| `depends_on` | Adds an explicit dependency for a hidden side effect | Keeps the same address, but changes graph ordering |
| `provider` | Selects a configured provider instance, often an alias | Keeps the same address, but changes the target account, region, or endpoint |

These lines do their work before the provider API call. Terraform uses them while building the graph, selecting provider instances, comparing state, and deciding the order of operations. That is why a small meta-argument edit can produce a large plan.

The official [Terraform meta-arguments documentation](https://developer.hashicorp.com/terraform/language/meta-arguments) is the reference for the full language behavior. The goal here is to make the common production choices understandable before the next articles go deeper.

## lifecycle for Guardrails and Replacement Behavior
<!-- section-summary: lifecycle changes Terraform's destroy, replacement, and selected drift behavior for a resource. -->

The highest-risk question comes first: what should Terraform do for a change that touches a critical object? The `lifecycle` block gives Terraform extra instructions for create, update, and destroy behavior.

![Create Before Destroy Order](/content-assets/articles/article-iac-terraform-config-meta-arguments/create-before-destroy-order.png)

*The order diagram shows why replacement can still require provider support, names, capacity, and health checks.*

![Lifecycle Guardrails](/content-assets/articles/article-iac-terraform-config-meta-arguments/lifecycle-guardrails.png)

*The lifecycle view separates guardrails such as `prevent_destroy` from replacement behavior such as `create_before_destroy`.*

The first lifecycle setting many teams add is **prevent_destroy**. It makes Terraform reject any plan that would destroy that resource while the rule remains in the configuration.

```hcl
resource "aws_db_instance" "billing" {
  identifier                  = "dp-billing-prod"
  engine                      = "postgres"
  instance_class              = "db.t3.small"
  allocated_storage           = 50
  username                    = "billing_admin"
  manage_master_user_password = true

  lifecycle {
    prevent_destroy = true
  }
}
```

This is useful for production databases, long-lived buckets, encryption keys, and other resources where an accidental delete would create a serious incident. The lifecycle rule is one guardrail. Teams still need backups, provider-side deletion protection where available, reviewed destroy workflows, and state access controls.

A plan that tries to delete this database fails with a direct error:

```console
Error: Instance cannot be destroyed

Resource aws_db_instance.billing has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed.
```

The second common setting is **create_before_destroy**. It asks Terraform to create a replacement before destroying the old object for required replacements that the provider can support with two copies at the same time.

```hcl
resource "aws_security_group" "app" {
  name_prefix = "billing-app-"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}
```

The `name_prefix` matters because the old and new security groups can coexist during replacement. A fixed unique name can block this pattern because the cloud API may reject the new object while the old object still owns the name.

The third setting beginners often see is **ignore_changes**. It tells Terraform to ignore drift for selected arguments because another controller intentionally owns that field.

```hcl
resource "aws_autoscaling_group" "app" {
  name             = "billing-app"
  min_size         = 2
  max_size         = 8
  desired_capacity = 3

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
```

This can make sense for an autoscaling policy that changes `desired_capacity` during the day. The ignored list should stay narrow. If a team hides too much with `ignore_changes`, Terraform stops showing drift that reviewers may need during an incident.

Lifecycle is introduced first because it affects safety even for one resource block. Repetition comes next, and repetition changes the resource address itself.

## count for a Simple Number of Instances
<!-- section-summary: count creates a fixed number of instances and tracks them by numeric index. -->

`count` is the simplest repetition meta-argument. It tells Terraform to create a specific number of resource instances from one block. It fits interchangeable instances or a single optional resource that should exist zero or one times.

![Count Foreach Expansion](/content-assets/articles/article-iac-terraform-config-meta-arguments/count-foreach-expansion.png)

*The expansion view shows how Terraform creates separate addresses from `count` and `for_each`, which is what later appears in plans and state.*

```hcl
variable "worker_count" {
  type    = number
  default = 2
}

resource "aws_instance" "worker" {
  count = var.worker_count

  ami           = var.worker_ami_id
  instance_type = "t3.micro"
  subnet_id     = var.private_subnet_ids[count.index]

  tags = {
    Name    = "billing-worker-${count.index + 1}"
    service = "billing"
  }
}
```

`count.index` is the current numeric position. The first worker uses index `0`, the second uses index `1`, and so on. Terraform also stores those indexes in state:

```console
aws_instance.worker[0]
aws_instance.worker[1]
```

Those addresses are the important part. With `count`, Terraform remembers "worker at position zero" and "worker at position one." If the list behind `count.index` changes order, the meaning of an index can change. That is safe for identical replicas and risky for resources that have real names, locations, or owners.

`count` also appears in conditionals:

```hcl
resource "aws_cloudwatch_metric_alarm" "billing_errors" {
  count = var.environment == "prod" ? 1 : 0

  alarm_name          = "billing-prod-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "Billing/App"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
}
```

The production plan creates `aws_cloudwatch_metric_alarm.billing_errors[0]`. The development plan creates no instance. The conditionals article will go deeper into references such as `[0]`, `one()`, and zero-instance output handling.

## for_each for Named Instances
<!-- section-summary: for_each creates one instance per stable key, which gives named resources reviewable addresses. -->

The billing service also needs named S3 buckets for exports, audit files, and reports. These buckets have business names, so keyed addresses are clearer than numeric indexes. That is where **for_each** fits.

```hcl
variable "log_buckets" {
  type = map(object({
    purpose        = string
    retention_days = number
  }))

  default = {
    exports = { purpose = "monthly customer exports", retention_days = 90 }
    audit   = { purpose = "security audit evidence", retention_days = 365 }
    reports = { purpose = "scheduled finance reports", retention_days = 180 }
  }
}

resource "aws_s3_bucket" "billing_logs" {
  for_each = var.log_buckets

  bucket = "dp-billing-prod-${each.key}"

  tags = {
    service        = "billing"
    purpose        = each.value.purpose
    retention_days = tostring(each.value.retention_days)
  }
}
```

`each.key` is the map key, such as `audit`. `each.value` is the object attached to that key. Terraform stores each bucket with a keyed address:

```console
aws_s3_bucket.billing_logs["exports"]
aws_s3_bucket.billing_logs["audit"]
aws_s3_bucket.billing_logs["reports"]
```

If the team removes the audit bucket from the map, the plan talks about `aws_s3_bucket.billing_logs["audit"]`. The other addresses stay tied to their keys. The address names the resource identity instead of asking reviewers to decode a list index.

Changing keys is still a state change. If the team renames the key from `audit` to `security`, Terraform sees one address disappear and another address appear. A safe rename usually needs a `moved` block so the state address changes without replacing the real bucket:

```hcl
moved {
  from = aws_s3_bucket.billing_logs["audit"]
  to   = aws_s3_bucket.billing_logs["security"]
}
```

The loops article builds from these two ideas: `count` uses numeric identity, and `for_each` uses key identity. That identity choice is the safety decision behind almost every Terraform loop.

## depends_on for Hidden Ordering
<!-- section-summary: depends_on documents a side-effect dependency that Terraform cannot infer from ordinary references. -->

Terraform usually infers dependencies from references. If a subnet uses `vpc_id = aws_vpc.main.id`, Terraform knows the subnet depends on the VPC. That is the best kind of dependency because the value relationship is visible in the code.

Sometimes the real dependency is a side effect rather than a value. The billing app instance can reference an instance profile, but the boot script may also need the IAM policy attachment to be fully ready before it fetches a startup object from S3.

```hcl
resource "aws_iam_role_policy_attachment" "read_bootstrap" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.read_bootstrap.arn
}

resource "aws_instance" "app" {
  ami                  = var.app_ami_id
  instance_type        = "t3.small"
  iam_instance_profile = aws_iam_instance_profile.app.name
  subnet_id            = aws_subnet.web["use1a"].id

  depends_on = [
    aws_iam_role_policy_attachment.read_bootstrap
  ]
}
```

`depends_on` tells Terraform to place the policy attachment before the instance in the dependency graph. It fits a real dependency with no useful resource argument that can reference the hidden side effect directly.

Broad explicit dependencies make plans more conservative, so `depends_on` works best in small, specific cases. Terraform may have to mark more values as unknown during planning, and it may lose parallelism during apply. A normal value reference is usually clearer for a resource that simply needs another resource's ID, ARN, or name.

The review question is simple: does the dependency describe a real side effect? If yes, `depends_on` is a readable signal. If it only tries to force a preferred order across a whole stack, the design probably needs a clearer value relationship or a smaller module boundary.

## provider for the Right Account or Region
<!-- section-summary: The provider meta-argument selects a specific provider configuration, often an alias for another region or account. -->

Terraform can configure the same provider more than once. A provider **alias** gives one configuration a name, such as `dr` for disaster recovery. The `provider` meta-argument then chooses that provider instance for one resource.

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "dr"
  region = "us-west-2"
}

resource "aws_s3_bucket" "primary_exports" {
  bucket = "dp-billing-prod-exports"
}

resource "aws_s3_bucket" "dr_exports" {
  provider = aws.dr

  bucket = "dp-billing-dr-exports"
}
```

The first bucket uses the default AWS provider in `us-east-1`. The second bucket uses the aliased provider in `us-west-2`. The Terraform address still reads `aws_s3_bucket.dr_exports`, so reviewers need to read the `provider = aws.dr` line to know where the object will be created.

Provider aliases matter even more in multi-account layouts. Clear alias names such as `prod`, `audit`, `shared_services`, or `dr` help reviewers catch accidental resource creation in the wrong account or region.

Modules can receive provider aliases from the root module:

```hcl
module "billing_dr_exports" {
  source = "./modules/export-bucket"

  providers = {
    aws = aws.dr
  }

  bucket_name = "dp-billing-dr-exports"
}
```

The child module can write ordinary `aws_*` resources. The root module decides which configured provider instance the child module uses. This keeps reusable module code focused on the resource shape while the environment wiring stays in the caller.

## Plan and State Address Review
<!-- section-summary: Meta-arguments are safest as reviewers compare the planned actions with the state addresses Terraform already tracks. -->

The best way to review meta-arguments is to inspect both the plan and the current state addresses.

```bash
terraform plan -out=tfplan
terraform show -no-color tfplan
terraform state list
```

`terraform plan -out=tfplan` saves the exact proposed plan into a binary file. `terraform show -no-color tfplan` renders that saved plan without terminal color codes, which creates a paste-friendly review artifact. `terraform state list` prints the addresses Terraform already tracks.

For a repeated resource, the state list might look like this:

```console
aws_s3_bucket.billing_logs["audit"]
aws_s3_bucket.billing_logs["exports"]
aws_s3_bucket.billing_logs["reports"]
aws_instance.worker[0]
aws_instance.worker[1]
```

Those addresses are Terraform's memory. Keyed addresses usually mean Terraform remembers business identities. Indexed addresses mean Terraform remembers positions. Both are valid, but the choice must match the resource.

Plan output shows the same identity. A safe `for_each` removal names the key:

```console
  # aws_s3_bucket.billing_logs["reports"] will be destroyed
```

A risky `count` reorder may show a replacement at an index:

```console
  # aws_instance.worker[1] must be replaced
```

That line deserves review because index `1` may have changed meaning after a list edit. The next article will spend more time on that problem, but the review habit starts here.

For lifecycle, provider aliases, and dependencies, review the behavior around the address. Confirm that `prevent_destroy` protects the intended resources, `create_before_destroy` has naming room to create a second copy, `ignore_changes` is narrow, `depends_on` describes a real side effect, and provider aliases point at the intended account or region.

## Putting It All Together
<!-- section-summary: Meta-arguments are Terraform management instructions, so they deserve the same review attention as normal resource settings. -->

Meta-arguments are Terraform's management instructions for a block. `lifecycle` handles destroy protection, replacement order, and selected drift. `count` creates numeric instances. `for_each` creates keyed instances. `depends_on` adds hidden ordering. `provider` chooses the configured provider instance for the resource or module.

![Meta Arguments Summary](/content-assets/articles/article-iac-terraform-config-meta-arguments/meta-arguments-summary.png)

*The summary board turns the meta-arguments into review questions about identity, ordering, provider target, and lifecycle risk.*

The billing service used all of them for real reasons: protect the database, create worker instances, create named buckets, wait for a boot-time IAM side effect, and place a disaster recovery bucket in another region. Each line changed how Terraform planned the work before any provider call happened.

The plan and state addresses are the final check. If the address names the intended resource, the provider alias points at the intended target, and the lifecycle rule matches the operational risk, the meta-argument is doing a clear job.

---

**References**

- [Terraform meta-arguments](https://developer.hashicorp.com/terraform/language/meta-arguments)
- [Terraform lifecycle meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle)
- [Terraform count meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/count)
- [Terraform for_each meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/for_each)
- [Terraform depends_on meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/depends_on)
- [Terraform provider selection meta-argument](https://developer.hashicorp.com/terraform/language/meta-arguments/resource-provider)
- [Terraform moved blocks for refactoring](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
