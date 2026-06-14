---
title: "Why Infrastructure as Code?"
description: "Understand why teams move cloud infrastructure changes out of the console and into reviewable Terraform configuration."
overview: "Infrastructure as Code gives a team a shared, reviewable record of what its cloud infrastructure should look like. This article follows one manual setup for devpolaris-orders-api, shows where click-ops and scripts start to hurt, and explains how Terraform turns infrastructure intent into a plan, an apply, and a verified change."
tags: ["iac", "terraform", "devops", "infrastructure"]
order: 1
id: article-iac-terraform-foundations-why-iac
---

## Table of Contents

1. [The Manual Setup That Starts the Problem](#the-manual-setup-that-starts-the-problem)
2. [What Infrastructure as Code Means](#what-infrastructure-as-code-means)
3. [Why Click-Ops Gets Risky](#why-click-ops-gets-risky)
4. [Drift: When Cloud Reality Moves](#drift-when-cloud-reality-moves)
5. [Terraform as Shared Infrastructure Intent](#terraform-as-shared-infrastructure-intent)
6. [Where Shell Scripts Hit Their Limit](#where-shell-scripts-hit-their-limit)
7. [Reviewable Changes Through Git](#reviewable-changes-through-git)
8. [Repeatable Environments](#repeatable-environments)
9. [Change Records and Rollback Thinking](#change-records-and-rollback-thinking)
10. [What Real Teams Do](#what-real-teams-do)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

Before Terraform enters the story, we need to name the day-to-day problem. A team can have excellent engineers, a careful cloud provider, and a small application, then still lose track of its infrastructure because the important decisions live in console forms, chat messages, and people's memories. This article follows that ordinary path and then turns each painful part into a Terraform idea.

The path is simple. We start with a team creating infrastructure by hand, then look at the specific problems that come from that workflow: hidden changes, missing review, drift, and rebuilds that depend on memory. After that, Terraform shows up as the shared place where the team writes what it wants, previews the change, reviews it in Git, applies it, and verifies the result.

## The Manual Setup That Starts the Problem
<!-- section-summary: A manual cloud setup can work on day one, then leave the team without a shared record of the exact infrastructure choices. -->

Imagine the DevPolaris team is launching a new backend called `devpolaris-orders-api`. The service needs a network, a database, an object storage bucket for exports, and a service account that lets the application talk to the cloud APIs it needs. The team is moving quickly, so one engineer opens the cloud console and starts creating things by hand.

They create a **VPC**, which is the private network where cloud resources can live together. They choose a CIDR range, add subnets, attach route tables, and set up a few security rules so the service can reach the database. Then they create a **database** for orders, a **bucket** for invoice exports, and a **service account** named `devpolaris-orders-api` so the service can read and write only the resources it needs.

At this point, the setup works. The API can boot, connect to the database, write export files to the bucket, and authenticate as its service account. Everyone is happy for about ten minutes, because the next question arrives quickly: "Which exact settings did we choose?"

That question sounds small, but it is the beginning of the whole Infrastructure as Code story. The VPC has a CIDR range, subnet sizes, regions, routing settings, firewall rules, database flags, backup settings, bucket encryption options, lifecycle rules, and service account permissions. Some of those choices came from the engineer's memory, some came from defaults, and some came from quick fixes made after the first deployment failed.

The team now has working infrastructure, but the full recipe lives across the cloud console and one person's memory. If another engineer needs to review it, they have to click through the console and inspect each resource one by one. If staging needs the same setup next week, someone has to repeat the setup and hope they pick the same settings.

## What Infrastructure as Code Means
<!-- section-summary: Infrastructure as Code means writing the desired cloud setup in files that a tool can plan, review, and apply. -->

**Infrastructure as Code**, usually shortened to **IaC**, means describing infrastructure in files and using a tool to make the cloud match those files. The files might describe networks, databases, buckets, service accounts, permissions, load balancers, DNS records, and many other resources. The key idea is that the important settings move from console forms into versioned configuration.

For Terraform, those files are written in HashiCorp Configuration Language, usually called **HCL**. HCL is designed to be readable enough for humans and structured enough for Terraform to understand. A Terraform file can say, in a practical way, "this service needs a VPC, this database, this bucket, and this service account."

Here is a small example of what a team might write around the orders service. The details stay intentionally small so we can focus on the workflow shape before provider-specific settings arrive later.

```hcl
module "orders_api" {
  source = "./modules/service"

  name        = "devpolaris-orders-api"
  environment = "dev"

  vpc_cidr        = "10.40.0.0/16"
  database_engine = "postgres"
  bucket_name     = "devpolaris-orders-api-dev-exports"
}
```

This configuration gives the team a shared place to discuss intent. If someone asks which CIDR range the development VPC should use, the answer is in the file. If someone asks why the bucket name changed, the answer can be found in the Git diff and the pull request discussion.

Terraform then uses cloud provider APIs to compare the configuration with the real resources. A **plan** previews the changes Terraform would make. An **apply** performs the approved changes. Terraform also keeps **state**, which maps resources in the configuration to real cloud objects, so it can keep track of what it manages over time.

That gives us the basic definition. The next step is understanding why this matters so much for teams that already know how to use the console.

## Why Click-Ops Gets Risky
<!-- section-summary: Click-ops hides important decisions inside console activity, so teams lose review, shared memory, and rebuild confidence. -->

**Click-ops** means managing infrastructure by clicking through a cloud provider's web console. It is useful for learning and investigation because the console shows available options, validation messages, and resource screens in one place. Many engineers first learn cloud services this way, and that is completely normal.

The risk shows up in teams that use click-ops as the main change process for shared infrastructure. The console can create the same resources Terraform can create because both paths call provider APIs behind the scenes. The difference is that console clicks usually leave the team with the final resource, while Terraform leaves the team with the resource plus the reviewed configuration that created it.

Go back to `devpolaris-orders-api`. The first engineer manually creates the VPC, database, bucket, and service account. Later, a second engineer changes the database backup window from 01:00 to 03:00 because a nightly import job runs at 01:30. That might be the right fix, but the change happened in the console during a busy afternoon.

Now the team has three click-ops problems. They look small one by one, but together they explain why console-only workflows wear teams down.

| Problem | What it looks like for `devpolaris-orders-api` | Why it hurts |
|---|---|---|
| **Hidden changes** | The database backup window changes in the console. | The current setting exists in the cloud, but the reason and timing live in memory. |
| **No review** | A firewall rule opens wider access so a test can pass. | Teammates see the result after the fact, if they notice at all. |
| **No repeatable rebuild** | A new environment needs the same VPC, bucket, database, and service account. | The team has to reconstruct the setup from screenshots, notes, and console inspection. |

The painful part is that each individual click can be reasonable. The backup window change helps the import job. The firewall tweak helps a developer unblock a test. The bucket lifecycle rule keeps storage costs down. Trouble grows because the team lacks one shared, reviewed place where those decisions accumulate.

Terraform gives the team that place. It moves the change from "someone clicked this" to "someone proposed this configuration change, Terraform planned the result, reviewers looked at it, and the team applied it."

## Drift: When Cloud Reality Moves
<!-- section-summary: Drift means real cloud resources have changed outside the configuration that the team expects to represent them. -->

Once a team writes infrastructure in Terraform, a new word starts showing up in reviews and incident notes: **drift**. Drift means the real cloud resources have moved away from the configuration the team expects to represent them. In plain English, the file says one thing and the cloud now has another thing.

Drift can happen for ordinary reasons. Someone fixes an incident by editing a rule in the console. A managed service changes a default value after an upgrade. A one-time migration script changes a database flag. A teammate tests a setting in development and forgets to copy the change back into Terraform.

For `devpolaris-orders-api`, imagine the Terraform file says the service account can read and write only the export bucket. During a production incident, someone adds broader storage permissions in the console so the service can finish a delayed export. The incident ends, but the console permission stays in place.

Now the infrastructure has two stories. The Terraform configuration says the service account has narrow access. The cloud provider says the service account has broader access. The security review reads the file and thinks the permission is tight, while the running system has a wider permission than the team agreed to.

Terraform helps because planning checks configuration, state, and provider reality together. State is Terraform's record that connects a resource block, such as a bucket or service account, to the real object in the cloud. Before Terraform decides what to change, it refreshes its view of the real resources and compares that view with the configuration.

The plan may show that the service account has extra permission and propose removing it. Sometimes the team decides the emergency change should become permanent, so they update the Terraform file to include the new permission with a clear explanation. Either way, drift turns into a visible conversation instead of a quiet surprise.

## Terraform as Shared Infrastructure Intent
<!-- section-summary: Terraform configuration records what the team wants the infrastructure to be, then Terraform plans how to move real resources toward that intent. -->

Terraform configuration is best understood as **shared infrastructure intent**. Intent means the team writes down what should exist and which important settings should be true. The file describes the desired VPC shape, database setup, bucket settings, and service account permissions for `devpolaris-orders-api`.

That wording matters because the file carries the team conversation as well as the automation input. When an engineer changes the database instance size, they are changing the team's declared intent for the database. When another engineer reviews the change, they are reviewing a real infrastructure decision before it reaches the cloud.

Terraform's plan step connects that intent to reality. A plan reads the current configuration, checks Terraform state, asks the provider about existing objects, and proposes actions that would make the remote resources match the configuration. The plan might say Terraform will create a bucket, update a database backup window, remove an extra permission, or destroy a resource that disappeared from the configuration.

For a beginner, the word **desired state** will come up often. Desired state means the target shape written in the Terraform files. Terraform compares that target with the actual infrastructure and works out the operations needed to close the gap.

This is why Terraform feels different from manually following a checklist. The checklist says which steps a human should remember to do. Terraform configuration says which end result the team wants, and Terraform works out the dependency order through resource references and provider data.

The shared-intent idea also explains why Terraform state matters. If the configuration says `bucket exports`, Terraform state records which real provider object belongs to that resource. That mapping lets Terraform update the correct bucket next time instead of guessing based on a name that might have changed.

## Where Shell Scripts Hit Their Limit
<!-- section-summary: Shell scripts help automate steps, but long-lived infrastructure needs memory, comparison, planning, and review around the target state. -->

After the click-ops pain shows up, many teams try a shell script. That is a reasonable instinct. A script can run cloud CLI commands, create resources in a consistent order, and live in Git beside application code.

For a short-lived demo environment, a script may be enough. It can create a test bucket, upload a sample file, run a command, and clean up. The script has a clear beginning and end, and the resources only live for the exercise.

Long-lived infrastructure creates a different problem. The `devpolaris-orders-api` VPC, database, bucket, and service account will exist for months or years. They will receive small changes over time: a new subnet, a database storage increase, a bucket lifecycle rule, a tighter permission, a new tag, a new environment, and a few incident fixes.

A shell script can create resources, but it has limited built-in memory about what it created last month. To make the script safe to run repeatedly, the team has to add checks everywhere. Does the VPC already exist? Does it have the correct CIDR? Does the bucket already have encryption enabled? Does the service account have exactly the expected permissions? Each check adds more script code, and each provider edge case adds another branch.

Here is the shape of the problem. Even this tiny branch hints at the work the script has to carry.

```bash
if bucket_exists "devpolaris-orders-api-dev-exports"; then
  update_bucket_settings "devpolaris-orders-api-dev-exports"
else
  create_bucket "devpolaris-orders-api-dev-exports"
fi
```

That tiny example looks fine. Now imagine writing the same create-or-update logic for networks, routes, firewalls, databases, backups, users, policies, secrets, DNS records, and load balancers. The team slowly grows the script into a custom infrastructure tool.

Terraform already focuses on that job. It stores state, refreshes real resources, builds a dependency graph, creates a plan, and applies changes. Shell scripts still have a place around Terraform for glue tasks, release steps, or one-off operations, but the long-lived infrastructure record belongs in a tool built for stateful infrastructure changes.

## Reviewable Changes Through Git
<!-- section-summary: Git turns infrastructure changes into pull requests that teammates can review before the cloud changes. -->

Once Terraform files live in Git, infrastructure changes can use the same collaboration habits as application code. An engineer creates a branch, edits the Terraform configuration, opens a pull request, and asks the team to review the proposed change. The PR shows exactly which lines changed and gives reviewers a place to ask questions.

For `devpolaris-orders-api`, suppose an engineer wants to make the production database larger before a traffic launch. In a console workflow, they might click into the database page, choose a larger size, confirm the change, and post a chat message afterward. In a Terraform workflow, they change the database size in a file and open a PR.

That PR can answer better questions before the change reaches production. Is the database size increase only for production? Does staging need a matching change for load testing? Will the change require downtime? Does the plan show an in-place update or a replacement? Did the engineer include the reason for the change in the PR description?

The **Terraform plan** gives reviewers an infrastructure-specific diff. The Git diff shows the file change, while the plan shows Terraform's expected cloud actions. Those are related, but they answer different questions. The Git diff might show `instance_size = "large"`, and the plan might show whether the provider can update the existing database or needs to replace it.

That review step changes the team's habits. Infrastructure decisions move into visible discussion. New engineers can read old PRs and understand why a bucket lifecycle rule exists or why a service account has a specific permission. Security and operations teammates can review sensitive changes before they land.

## Repeatable Environments
<!-- section-summary: Terraform lets teams create development, staging, and production with the same structure and controlled differences. -->

The next pressure point is environments. The orders service may start in development, but soon the team needs staging and production. Each environment needs the same basic shape: a VPC, database, bucket, service account, and application settings.

Repeatable environments mean the team can create the same infrastructure pattern again with controlled differences. Development might use a small database and short retention. Production might use a larger database, longer backups, stricter access, and stronger monitoring. The important part is that the differences are written down instead of remembered.

A simple Terraform setup might pass environment values into the same module. The shared module holds the common shape, and each environment sends its own values.

```hcl
module "orders_api_dev" {
  source = "./modules/orders-api"

  environment       = "dev"
  database_size     = "small"
  backup_retention  = 3
  export_bucket_tier = "standard"
}

module "orders_api_prod" {
  source = "./modules/orders-api"

  environment       = "prod"
  database_size     = "large"
  backup_retention  = 30
  export_bucket_tier = "standard"
}
```

The module captures the shared structure, while the inputs capture the differences. Reviewers can see that production has longer backup retention and a larger database. They can also spot accidental differences, such as a missing encryption setting or a service account permission that exists in development but never reached production.

This matters during incidents and launches. If staging fails because the bucket policy differs from production, the team can compare Terraform inputs and module code. If a temporary performance environment is needed for a week, the team can create it from the same pattern and remove it cleanly afterward.

Repeatability also helps disaster recovery thinking. If the team needs to rebuild the infrastructure in another region, Terraform gives them a written starting point for networks, buckets, service accounts, and compute resources. Data restore, DNS failover, provider quotas, and secrets still need careful planning, but the infrastructure shape is no longer reconstructed from memory.

## Change Records and Rollback Thinking
<!-- section-summary: Git history, plans, and apply logs create a change record, while rollback requires reading the next plan instead of blindly undoing. -->

Infrastructure changes need a record because infrastructure decisions affect security, reliability, cost, and data. A good record answers simple questions later: who changed this, when did they change it, what did Terraform plan to do, who reviewed it, and what happened after apply?

Git gives part of that record through commits and pull requests. Terraform gives another part through plans and apply logs. Together they create a timeline for the orders service: the VPC CIDR choice, the database backup change, the bucket lifecycle rule, the service account permission adjustment, and the production size increase.

Rollback needs careful thinking because infrastructure rollback can mean several different things. For application code, rollback often means deploying the previous version. For infrastructure, a rollback might shrink a database, remove a firewall rule, recreate a bucket policy, restore from a snapshot, or move traffic back to an older environment.

The safe habit is to make rollback a planned change too. If a Terraform PR increased the database size and the team needs to reverse it, they can revert the Git commit or edit the configuration back, then run a new plan. That new plan shows what Terraform would actually do in the cloud. If the plan says it will replace the database, the team should pause and choose a safer recovery path, such as restoring a snapshot or creating a new instance.

This is the main lesson: Git history helps you find the previous intent, and Terraform plan tells you the current effect of returning to that intent. The team should read the rollback plan with the same care as the original change, especially around databases, storage, networking, identity, and anything that can affect production traffic.

## What Real Teams Do
<!-- section-summary: A practical Terraform workflow moves from pull request to plan, review, apply, and verification. -->

A starter team workflow can stay simple. The important part is that every shared infrastructure change follows the same path. The orders service should use one visible workflow instead of a mix of console clicks, private scripts, and late-night fixes.

Here is a common flow. The exact automation can change from team to team, but the review path should stay visible.

| Step | What happens | What the team checks |
|---|---|---|
| **PR** | An engineer changes Terraform files for `devpolaris-orders-api`. | The diff explains the intended infrastructure change. |
| **Plan** | CI or the engineer runs `terraform plan`. | The plan shows creates, updates, deletes, and possible replacements. |
| **Review** | Teammates review the Git diff, plan output, and reason for the change. | Reviewers look for security, reliability, cost, and environment mistakes. |
| **Apply** | An approved person or pipeline runs `terraform apply`. | The apply uses the approved configuration and reports the actual result. |
| **Verify** | The team checks the service, metrics, logs, and important cloud settings. | The application still works, and the cloud matches the expected change. |

In a small team, the first version might happen from a laptop. These commands give the team the same rhythm that later moves into CI.

```bash
terraform fmt
terraform validate
terraform plan
terraform apply
```

As the team grows, CI/CD usually runs formatting, validation, and plan on pull requests. Production apply often happens through an approved pipeline with controlled credentials, state locking, and audit logs. The mechanics can mature over time, but the shape stays the same: propose the intent, preview the cloud effect, review it, apply it, then verify the real system.

Verification deserves its own mention because Terraform confirms infrastructure operations while the team still checks application health. After the orders database changes, the team checks that `devpolaris-orders-api` can connect, write an order, create an export file, and emit normal logs. Terraform handles the infrastructure workflow, while the team still owns production readiness.

## Putting It All Together
<!-- section-summary: Infrastructure as Code gives teams a shared, reviewable, repeatable way to manage infrastructure over time. -->

Let's replay the story with Terraform in place from the beginning. The team wants `devpolaris-orders-api`, so an engineer writes Terraform configuration for the VPC, database, bucket, and service account. They open a PR with the reason for the change and include the Terraform plan.

Reviewers can see the proposed infrastructure before it exists. They can ask why the VPC CIDR is `10.40.0.0/16`, whether the database backups are long enough, whether the bucket encryption setting is correct, and whether the service account permissions match the service's real job. Those questions happen before a production resource changes.

When someone needs staging, the team creates another environment from the same pattern with different inputs. When someone changes a cloud setting by hand during an incident, the next plan exposes the drift. When a release causes trouble, the team uses Git history and a fresh plan to reason about rollback instead of guessing which console screens changed.

That is why Infrastructure as Code matters. The real win is the team habit around the files: a shared record of infrastructure intent, a review process, repeatable environments, visible drift, and a safer way to change long-lived systems.

Terraform is one tool for that job, and this module uses it because it is widely used, provider-friendly, and built around planning before applying. The next articles will make those ideas practical, one Terraform command and one configuration file at a time.

## What's Next

The next article introduces Terraform itself: the CLI, configuration files, providers, state, and the basic workflow behind `terraform init`, `terraform plan`, and `terraform apply`. You now have the reason for the tool, so the next step is learning the tool's moving parts.

---

**References**

- [Terraform CLI commands](https://developer.hashicorp.com/terraform/cli/commands) - Official overview of Terraform CLI commands, including `init`, `validate`, `plan`, `apply`, and `destroy`.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Official reference for creating a plan that previews proposed infrastructure changes.
- [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply) - Official reference for applying the operations proposed by a Terraform plan.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Official explanation of how Terraform maps configuration resources to real infrastructure objects and tracks metadata.
