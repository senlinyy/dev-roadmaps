---
title: "Reading Plans"
description: "Read Terraform plans as review evidence for AWS changes, including action symbols, replacements, destroys, unknown values, sensitive values, and saved plans."
overview: "A Terraform plan is the proposed change before provider APIs modify infrastructure. This article follows realistic VPC, EC2, and S3 plan output so the review habit becomes concrete."
tags: ["terraform", "opentofu", "aws", "plans", "review"]
order: 3
id: article-infrastructure-as-code-terraform-reading-terraform-plans
aliases:
  - reading-terraform-plans
  - infrastructure-as-code/terraform/reading-terraform-plans.md
---

## Table of Contents

1. [The Review Question](#the-review-question)
2. [What Terraform Reads](#what-terraform-reads)
3. [The Summary Line](#the-summary-line)
4. [Action Symbols](#action-symbols)
5. [Creates and Updates](#creates-and-updates)
6. [Replacements](#replacements)
7. [Destroys](#destroys)
8. [Unknown and Sensitive Values](#unknown-and-sensitive-values)
9. [Drift](#drift)
10. [Saved Plans](#saved-plans)
11. [Common First Mistakes](#common-first-mistakes)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Review Question

The previous articles gave Terraform a shared memory in an S3 backend. Now a pull request changes the AWS demo environment. It adds HTTP access to the web server, increases the EC2 instance size, and leaves the VPC and S3 bucket alone.

The reviewer opens the plan and sees several screens of output. The important question is simple:

Does this plan tell the same story as the pull request?

If the pull request claims to add HTTP and resize one instance, the plan should show one security group rule create and one EC2 update. It should not change the VPC CIDR. It should not destroy the S3 bucket. It should not point at the production state key when the pull request says dev.

A Terraform plan is review evidence. It is the place where configuration, state, provider refresh, and provider rules become a proposed set of AWS actions.

## What Terraform Reads

Terraform does not build a plan from the `.tf` files alone. A normal plan combines several inputs.

| Input | What it contributes |
| --- | --- |
| Configuration | Resource blocks, module calls, variables, locals, outputs, providers, and backend settings |
| Variable values | Environment choices such as CIDR ranges, instance size, and tags |
| State | The managed resource bindings and last known attributes |
| Provider refresh | Current data read from AWS for managed objects |
| Provider schemas | Rules for which arguments update in place and which force replacement |

This is why a plan can change when no Terraform files changed. The AWS console might have changed a tag. The selected variable file might be different. The provider version might classify an argument differently. The backend key might point at another environment's state.

Before reading resource changes, read the run context:

```text
root module: infra/live/dev
state key:   orders/dev/terraform.tfstate
account:     111122223333
region:      us-east-1
command:     terraform plan -var-file=dev.tfvars
```

That context decides which real system the plan describes. A clean-looking plan in the wrong AWS account is still wrong.

## The Summary Line

The plan summary is the fastest way to decide where to focus first.

```text
Plan: 1 to add, 1 to change, 0 to destroy.
```

For the pull request story, that summary is plausible. One security group rule is new. One EC2 instance changes size. No resources are destroyed.

A different summary changes the review:

```text
Plan: 2 to add, 1 to change, 1 to destroy.
```

The destroy may be intentional, but the reviewer now has to find it. The summary does not approve the plan. It tells you which parts of the body need attention.

| Summary | First question |
| --- | --- |
| `1 to add, 0 to change, 0 to destroy` | Is the new resource expected? |
| `0 to add, 1 to change, 0 to destroy` | Is the in-place change safe? |
| `1 to add, 0 to change, 1 to destroy` | Is this a replacement or an unrelated deletion? |
| `0 to add, 0 to change, 1 to destroy` | Did the pull request intentionally remove something? |

Read the summary first, then read the body. The body explains which resources and arguments create those counts.

## Action Symbols

Terraform marks planned actions with symbols in the plan body.

| Symbol | Meaning | Review focus |
| --- | --- | --- |
| `+` | Create | Should this new object exist, and are its values safe? |
| `~` | Update in place | Is the changed argument expected and operationally safe? |
| `-` | Destroy | Is removing this object intentional? |
| `-/+` | Destroy then create replacement | What argument forced replacement, and can the system tolerate it? |
| `+/-` | Create then destroy replacement | Is create-before-destroy intentional and supported for this resource? |

The symbols are compact, but they carry operational meaning. A `~` on an EC2 tag may be routine. A `-/+` on a database, disk, route table, or state bucket can be a high-risk change. The symbol tells you the action shape; the resource type tells you the blast radius.

## Creates and Updates

The pull request adds HTTP ingress to a public demo web server. The plan might show a create action like this:

```text
  # aws_vpc_security_group_ingress_rule.http will be created
  + resource "aws_vpc_security_group_ingress_rule" "http" {
      + cidr_ipv4         = "0.0.0.0/0"
      + from_port         = 80
      + ip_protocol       = "tcp"
      + security_group_id = "sg-0789abcd"
      + to_port           = 80
    }
```

The create matches the pull request story, but the values still need review. `0.0.0.0/0` means any IPv4 source. That might be right for public HTTP in a demo environment. The same source range for SSH would usually be a serious problem.

The EC2 size change might look like this:

```text
  # aws_instance.web will be updated in-place
  ~ resource "aws_instance" "web" {
        id            = "i-0123456789abcdef0"
      ~ instance_type = "t3.micro" -> "t3.small"
        tags = {
          "Environment" = "dev"
          "Name"        = "orders-dev-web"
        }
    }
```

The arrow shows the old value and the new value. The unchanged `id` tells you this is the same managed instance. The reviewer still asks whether the size change is expected, whether the app can tolerate the update, and whether the cost change was approved.

Plans often hide unchanged attributes so the output stays readable. Hidden lines are not an excuse to ignore the resource. They mean Terraform is focusing the display on the changed fields.

## Replacements

Replacement means Terraform plans to discard one remote object and create another for the same resource address. It is one of the most important plan shapes to recognize.

Changing an EC2 AMI often forces replacement:

```text
  # aws_instance.web must be replaced
-/+ resource "aws_instance" "web" {
      ~ ami = "ami-11111111111111111" -> "ami-22222222222222222"
        id  = "i-0123456789abcdef0" -> (known after apply)
    }
```

The address is still `aws_instance.web`, but the real object ID will change. For a stateless demo server behind a load balancer, that may be fine. For a hand-managed instance with local data, it may be dangerous. For a database or bucket, replacement deserves even more attention.

The provider schema decides which arguments force replacement. Terraform shows the result in the plan; reviewers decide whether that result is acceptable for this system.

Ask these questions whenever replacement appears:

- Which argument forced replacement?
- Does the resource hold data, identity, or network attachment that other systems depend on?
- Is there a migration path that avoids replacement?
- Does the pull request mention the replacement plainly?
- Is the replacement in the right environment?

Replacement is sometimes exactly right. The plan needs to make it visible enough that the team chooses it deliberately.

## Destroys

Destroy actions use `-`. A destroy can be a cleanup, a risk reduction, or a mistake.

Removing open SSH from a security group might look like this:

```text
  # aws_vpc_security_group_ingress_rule.ssh will be destroyed
  - resource "aws_vpc_security_group_ingress_rule" "ssh" {
      - cidr_ipv4 = "0.0.0.0/0" -> null
      - from_port = 22 -> null
      - to_port   = 22 -> null
    }
```

That destroy is probably good if the team is closing public SSH. The resource being destroyed is the rule, not the whole security group.

Now compare that with a bucket destroy:

```text
  # aws_s3_bucket.assets will be destroyed
  - resource "aws_s3_bucket" "assets" {
      - bucket = "dp-orders-assets-dev" -> null
      - id     = "dp-orders-assets-dev" -> null
    }
```

This is a different review. A bucket can hold data and can be referenced by applications, IAM policies, event notifications, replication, and backups. Even if the bucket is empty, the name and permissions may matter.

Destroy review is resource-specific. Deleting one bad ingress rule and deleting one shared S3 bucket both count as "1 to destroy," but the operational meaning is completely different.

## Unknown and Sensitive Values

Plans often include values marked `(known after apply)`.

```text
  # aws_instance.web will be created
  + resource "aws_instance" "web" {
      + arn       = (known after apply)
      + id        = (known after apply)
      + public_ip = (known after apply)
    }
```

Unknown values are normal when AWS assigns values during creation. Terraform can know that an instance will have an ID, ARN, and public IP without knowing the exact values before AWS creates it.

Unknown becomes a review question when another resource depends on it. If an output exposes `public_ip`, reviewers can see that the output will exist, but they cannot approve the exact IP value before apply. If a security rule depends on a value known after apply, Terraform may still know the dependency order even though the final string is unknown.

Sensitive values are displayed differently:

```text
  ~ password = (sensitive value)
```

Sensitive display reduces accidental leakage in terminals and logs. It does not mean the value is irrelevant. A password rotation can restart applications. A secret ARN change can break permissions. A hidden database password value can still be stored in state or in a saved plan artifact.

Read the surrounding resource and argument name. The value may be hidden, but the operational change still needs review.

## Drift

Drift appears in a plan when AWS no longer matches the state and configuration Terraform expected.

For example, someone might change a tag in the AWS console:

```text
  # aws_instance.web will be updated in-place
  ~ tags = {
      ~ Environment = "test" -> "dev"
    }
```

That plan reports more than a file edit. It reports a mismatch between Terraform's desired configuration and the real AWS object. The reviewer has to decide which source should win. If the console edit was accidental, Terraform should restore the configured value. If the console edit was intentional, the Terraform configuration should be updated so the plan stops trying to undo it.

The next article gives drift a full treatment. In this article, the important plan-reading habit is to notice when Terraform is correcting AWS reality rather than applying a pull request change.

## Saved Plans

A saved plan connects review and apply more tightly:

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

The saved plan records the actions Terraform selected at planning time. Applying that file tells Terraform to execute those planned actions instead of creating a fresh plan during apply.

This is useful in automation. CI can produce a plan for review, store it as a protected artifact, and an approved apply job can apply the reviewed file. That gives the team a stronger connection between what was reviewed and what changed.

Saved plans need protection. They can contain sensitive data, resource details, and provider decisions. Treat them like state artifacts. Do not upload them to public logs or broad-access storage.

Saved plans also have a limit: they describe a point in time. If the AWS account changes after the plan is created, an old saved plan may fail or become a poor reflection of current reality. For important environments, keep the plan and apply close together and let automation rebuild plans when inputs change.

## Common First Mistakes

**Reading only the summary.** The summary tells you where to look. The body shows the risky values.

**Ignoring run context.** Account, region, backend key, variable file, and root module decide which system the plan describes.

**Treating replacement like an update.** Replacement changes object identity and may interrupt service or lose data.

**Assuming destroy is always bad.** Removing an unsafe rule can be good. Destroying a bucket can be dangerous. Resource type matters.

**Treating unknown values as errors.** Many AWS-assigned values are unknown until apply.

**Trusting sensitive display too much.** Hidden output still needs state and artifact protection.

**Approving unrelated changes.** If the pull request says EC2 size and the plan changes the VPC CIDR, stop and investigate.

## Putting It All Together

The pull request said it would add HTTP access and resize one EC2 instance. A good plan review follows that story all the way through the output.

- Confirm the root module, backend key, account, region, and variables.
- Read the summary for add, change, and destroy counts.
- Use action symbols to find creates, updates, replacements, and destroys.
- Read resource types before judging risk.
- Inspect changed argument values, especially network ranges, identities, and stateful resources.
- Understand unknown values instead of fearing them.
- Treat sensitive values and saved plans as protected artifacts.

Terraform produces the plan, but the team supplies the intent. The review succeeds when those two stories match.

## What's Next

The next article covers drift. Plans are clear when configuration, state, and AWS reality line up. Drift is what happens when the AWS account changes outside the Terraform workflow and the next plan has to reveal that mismatch.

---

**References**

- [terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Explains how Terraform creates execution plans, planning modes, and saved plan files.
- [terraform apply command](https://developer.hashicorp.com/terraform/cli/commands/apply) - Explains automatic plan mode and saved plan mode during apply.
- [Create a Terraform plan](https://developer.hashicorp.com/terraform/tutorials/cli/plan) - Shows plan review, saved plans, and automation use.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains how state is used as an input to planning.
- [Input variables](https://developer.hashicorp.com/terraform/language/values/variables) - Describes sensitive variables and how Terraform handles their values.
- [Output values](https://developer.hashicorp.com/terraform/language/values/outputs) - Describes sensitive outputs and output display behavior.
