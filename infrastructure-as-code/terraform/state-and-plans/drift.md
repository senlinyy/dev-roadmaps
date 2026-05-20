---
title: "Drift"
description: "Recognize Terraform drift when AWS resources change outside the normal workflow, then decide whether to restore configuration or adopt the manual change."
overview: "Drift is the gap between Terraform's recorded view and real infrastructure. This article follows console edits to EC2 tags and S3 settings so the next plan becomes a decision point instead of a surprise."
tags: ["terraform", "opentofu", "aws", "drift", "plans"]
order: 4
id: article-infrastructure-as-code-terraform-drift
---

## Table of Contents

1. [The Surprise Plan](#the-surprise-plan)
2. [What Drift Means](#what-drift-means)
3. [How Terraform Finds Drift](#how-terraform-finds-drift)
4. [A Console Tag Edit](#a-console-tag-edit)
5. [When Configuration Should Win](#when-configuration-should-win)
6. [When the Manual Change Should Stay](#when-the-manual-change-should-stay)
7. [Refresh-Only Plans](#refresh-only-plans)
8. [Drift and Shared State](#drift-and-shared-state)
9. [Common First Mistakes](#common-first-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Surprise Plan

The previous article taught plan review when the pull request is the only intended change. Drift starts with a different feeling: you run a plan for a small tag update, and Terraform shows a change nobody put in the branch.

The orders team has a dev EC2 instance managed by Terraform:

```hcl
resource "aws_instance" "web" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id

  tags = {
    Name        = "orders-dev-web"
    Environment = "dev"
  }
}
```

During an incident, someone opened the AWS console and changed the `Environment` tag to `test` while trying to filter instances. The application still runs. The repository still says `dev`. State may still remember the previous value. The next Terraform plan has to reconcile the difference.

That is drift: real infrastructure moved away from the Terraform-managed shape.

## What Drift Means

Drift is a mismatch between Terraform's managed view and the real remote object.

The mismatch can happen for many reasons:

- a console edit changes an EC2 tag
- an AWS CLI command opens a security group rule
- an S3 bucket setting is changed during troubleshooting
- a managed resource is deleted outside Terraform
- a provider reads a default value differently after an upgrade
- another Terraform state manages the same object by mistake

Drift is not automatically an outage. A tag edit may be harmless. An open security group rule may be urgent. A deleted subnet may break the next apply. The point is visibility. Terraform cannot keep a system predictable if changes happen outside the workflow and nobody reviews how to reconcile them.

Drift also has a scope. Terraform detects drift for resources it manages and for attributes the provider reads. An unmanaged AWS resource can exist in the account without being drift for this state. A setting hidden from the provider or ignored by configuration may not appear the way a beginner expects.

## How Terraform Finds Drift

Terraform normally refreshes managed objects while creating a plan. It asks providers to read the real remote objects recorded in state, then uses the refreshed view while comparing configuration and state.

The three-way comparison looks like this:

```text
configuration: Environment = "dev"
state:         Environment = "dev"
AWS reality:   Environment = "test"
```

When AWS reality differs, Terraform has to decide what a normal plan would do. In the example above, the configuration still says `dev`, so a normal plan can propose to update AWS back to `dev`.

Drift is easiest to miss when the plan includes an intentional change too. If the pull request changes the EC2 instance size and the plan also restores a tag, both may appear under the same `aws_instance.web` block. The reviewer needs to separate the requested change from the detected drift.

## A Console Tag Edit

The console tag edit might appear like this:

```text
  # aws_instance.web will be updated in-place
  ~ resource "aws_instance" "web" {
        id = "i-0123456789abcdef0"

      ~ tags = {
          ~ "Environment" = "test" -> "dev"
            "Name"        = "orders-dev-web"
        }
    }

Plan: 0 to add, 1 to change, 0 to destroy.
```

The arrow tells the story. AWS currently reports `test`. Terraform configuration says `dev`. A normal apply would restore the tag to `dev`.

The right review question is not "how do we make the plan green?" The right question is "which source of truth should win?"

If `test` was a mistake, apply the plan or make a small PR that restores the configured value. If `test` was actually the new intended value, change the Terraform configuration to `test`, review that change, and apply it so configuration, state, and AWS line up again.

The same pattern applies to more serious drift. If someone opens port 22 to the internet in the AWS console, the next plan may propose to close it because Terraform still declares the approved CIDR. If someone suspends S3 versioning manually, Terraform can propose to re-enable it if versioning is modeled in configuration.

## When Configuration Should Win

Configuration should usually win when the manual change was accidental, temporary, or unsafe.

Consider an S3 bucket used by the demo app:

```hcl
resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

Someone suspends versioning in the console while testing cleanup behavior. Terraform later plans to restore it:

```text
  # aws_s3_bucket_versioning.assets will be updated in-place
  ~ resource "aws_s3_bucket_versioning" "assets" {
        bucket = "dp-orders-assets-dev"

      ~ versioning_configuration {
          ~ status = "Suspended" -> "Enabled"
        }
    }
```

If the team expects versioning for recovery, the plan is doing useful repair work. The fix is to apply the reviewed plan and tighten the workflow so console changes do not quietly change managed controls.

Configuration should also win when the manual change bypassed review. Opening an ingress rule, disabling encryption controls, changing route table targets, or editing IAM policies outside Terraform can create risk that the next plan should reverse.

## When the Manual Change Should Stay

Sometimes the manual change was intentional. An incident responder may resize an EC2 instance to restore service. A networking engineer may change a route while repairing connectivity. A platform engineer may update tags to match a new cost allocation rule.

If the manual change should stay, update the Terraform configuration. For the instance tag example, change the tag in code:

```hcl
tags = {
  Name        = "orders-dev-web"
  Environment = "test"
}
```

Then run a plan again. A healthy reconciliation plan should no longer try to flip the tag back to `dev`.

For larger changes, do the adoption carefully. If someone manually changed the EC2 instance type from `t3.micro` to `t3.small`, updating the Terraform file to `t3.small` may be enough. If someone created a new bucket, VPC endpoint, or route table outside Terraform, the team may need an import or a new resource block instead.

The key habit is to make the intended long-term shape visible in code. Manual changes can be emergency actions. Terraform configuration is where the steady-state decision should land.

## Refresh-Only Plans

Refresh-only mode is useful when you want to inspect drift as a state reconciliation problem.

```bash
terraform plan -refresh-only
```

A refresh-only plan does not propose changes to remote AWS objects to make them match configuration. Its goal is to show how Terraform state and outputs would change to match remote objects that changed outside Terraform.

That makes it safer than the older `terraform refresh` command, which updates state directly. With refresh-only planning, you can review the detected differences before deciding whether state should accept them.

Use refresh-only when the question is:

- What changed in AWS outside Terraform?
- What would state look like if we accepted the remote reality?
- Did an incident response change need to be recorded before the next normal change?

Use a normal plan when the question is:

- What will Terraform do to make AWS match configuration?
- Will the next apply restore drift or make a requested change?
- Does the pull request plan match the intended infrastructure story?

The distinction matters. A normal plan is about changing infrastructure to match configuration. A refresh-only plan is about reconciling Terraform's records with remote changes.

## Drift and Shared State

Drift becomes harder when several people and systems can change the same AWS account.

Shared state and locking protect Terraform's memory from overlapping Terraform writes. They do not prevent someone from using the AWS console, AWS CLI, another automation system, or a second Terraform state to change the real object.

Teams reduce drift through operating rules:

- run infrastructure changes through Terraform by default
- restrict console permissions for managed resources
- use break-glass access for emergency manual changes
- record emergency changes in a follow-up pull request
- run plans or drift checks regularly for important environments
- avoid managing the same AWS object from two states

The last point is especially important. If one Terraform state imports `dp-orders-assets-dev` and another state also manages that bucket, each state can see the other as drift. One apply can undo another apply. State ownership should be singular unless the provider resource model intentionally splits ownership across separate resource types.

## Common First Mistakes

**Applying drift without understanding it.** A plan that restores configuration may be right, but first identify why AWS changed.

**Keeping manual fixes out of code.** If a console change should remain, capture it in Terraform configuration.

**Using `terraform refresh` as a reflex.** Prefer refresh-only plan/apply workflows so detected changes are reviewed before state changes.

**Assuming Terraform sees everything.** Terraform detects drift for managed resources and provider-read attributes.

**Ignoring small drift.** A tag drift can affect cost reports, automation filters, IAM conditions, or incident triage.

**Letting two states own one object.** Competing ownership creates repeated drift and unpredictable applies.

## Putting It All Together

The surprise plan started with an EC2 tag changed in the AWS console. Terraform saw configuration saying `dev`, AWS saying `test`, and a state record for the same instance. The plan proposed to restore the configured value.

That is the drift review loop:

- identify the resource and argument that changed outside Terraform
- decide whether the configuration or the manual change should win
- apply the normal plan when configuration should win
- update configuration when the manual change should become the new desired state
- use refresh-only workflows when the goal is to inspect or accept remote changes into state
- protect shared ownership so the same object is not managed from several places

Drift is less about blame than source of truth. The team needs to decide which version of the system is intended, then bring configuration, state, and AWS reality back together.

## What's Next

The next article covers importing existing resources. Drift starts from objects Terraform already manages. Import starts from real AWS objects that exist, but Terraform has no state binding for them yet.

---

**References**

- [terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Explains normal planning and refresh-only planning modes.
- [terraform refresh command](https://developer.hashicorp.com/terraform/cli/commands/refresh) - Explains why the older refresh command is deprecated and how refresh-only apply is preferred.
- [Manage resource drift](https://developer.hashicorp.com/terraform/tutorials/state/resource-drift) - Shows drift detection and reconciliation using AWS resources.
- [Use health assessments to detect infrastructure drift](https://developer.hashicorp.com/terraform/tutorials/cloud/drift-detection) - Describes HCP Terraform drift detection and resolution choices.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains how state records managed resources and participates in planning.
- [aws_s3_bucket_versioning resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_versioning) - Documents the AWS provider resource used to manage S3 bucket versioning.
