---
title: "Why Infrastructure as Code?"
description: "Understand why teams move infrastructure changes out of one-off console work and into reviewable, repeatable Terraform workflows."
overview: "Infrastructure as Code gives a team a shared record of what its cloud infrastructure should look like. This orientation follows devpolaris-orders-api from a one-time manual setup to repeatable environments, reviewed changes, drift detection, and the Terraform plan/apply loop without going deep into Terraform syntax yet."
tags: ["iac", "terraform", "devops", "infrastructure"]
order: 1
id: article-iac-terraform-foundations-why-iac
---

## Table of Contents

1. [The Manual Setup That Works Once](#the-manual-setup-that-works-once)
2. [The Second Environment Request](#the-second-environment-request)
3. [What Infrastructure as Code Changes](#what-infrastructure-as-code-changes)
4. [Why Terraform Previews the Change](#why-terraform-previews-the-change)
5. [Drift and Shared Memory](#drift-and-shared-memory)
6. [Scripts, Git, and Team Workflow](#scripts-git-and-team-workflow)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

This article follows one service from a manual setup into a reviewed Terraform workflow. First we will see why the first set of console clicks works only once, then why the second environment exposes hidden differences, then how Infrastructure as Code turns those choices into files, plans, shared history, and drift review.

## The Manual Setup That Works Once
<!-- section-summary: A manual setup can launch a first environment, but the exact choices quickly spread across console pages, chat messages, and memory. -->

Imagine the DevPolaris team is creating a small service called `devpolaris-orders-api`. The service needs somewhere to store exported order files, somewhere to store order records, an identity the application can use, and a few network rules so the pieces can talk to each other. One engineer opens the cloud console and creates the development environment by hand.

That first setup can be completely reasonable. The engineer sees the forms, chooses a region, accepts a few defaults, fixes one permission error, and gets the service running. Everyone can see the API respond, the database accepts test orders, and the export bucket receives files.

The trouble starts after the setup works. The exact choices now live in several places: the bucket screen, the database screen, the identity screen, the networking screen, a few chat messages, and the engineer's memory. The cloud has the final result, but the team lacks one shared recipe that explains how the environment was built.

That is the ordinary beginning of the Infrastructure as Code story. A one-time manual setup solves the first launch, then the team needs a way to repeat, review, and change that setup without reconstructing it from clicks.

![Manual to Code Flow](/content-assets/articles/article-iac-terraform-foundations-why-iac/manual-to-code-flow.png)

*The flow shows the shift from one-off console clicks to reviewed files, plans, and a shared record the whole team can use.*

## The Second Environment Request
<!-- section-summary: Repeating a manual setup exposes hidden defaults and small differences between environments. -->

Now staging needs the same orders service. A second engineer follows the notes from development and creates another bucket, database, service identity, and network path. They do careful work, but the cloud console has many choices and defaults, so small differences slip in.

Maybe the staging bucket has versioning turned off while development has it on. Maybe the database backup window is different because a console default changed. Maybe the service identity gets a broader permission because the exact development permission was hard to find during setup.

Each difference can look harmless by itself. Together, they weaken staging as a rehearsal for production. A release that works in staging gives less confidence if staging and production have hidden differences in storage, permissions, backups, or networking.

The team now needs a repeatable habit. The goal is an infrastructure shape with controlled differences, such as `dev`, `staging`, and `prod`, instead of a fresh set of clicks for every environment.

## What Infrastructure as Code Changes
<!-- section-summary: Infrastructure as Code records the desired setup in files so the team can review the change before a tool applies it. -->

**Infrastructure as Code**, or **IaC**, means the important parts of infrastructure are described in files and managed through a tool. The files can describe buckets, databases, networks, service identities, permissions, DNS records, and other cloud objects an application needs.

For the orders service, IaC moves the question from "who remembers the setup?" to "what do the files say the setup should be?" The bucket name, the environment tag, the database backup choice, and the service permission can live in reviewed configuration instead of scattered console screens.

Terraform is one popular IaC tool. Terraform reads configuration files, talks to providers such as AWS, Azure, Google Cloud, GitHub, Kubernetes, and Cloudflare, and works out the changes needed to make real infrastructure match the files. A **provider** is the plugin that knows how to call one platform's API.

Here is a tiny preview of the kind of shape Terraform uses. This is only a first look, and the next module teaches the syntax properly.

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"
}
```

The word `resource` tells Terraform this block describes one managed object. The name `aws_s3_bucket` says the object is an AWS S3 bucket, and `orders_exports` is the local label the team can use inside the Terraform project. The `bucket` line gives the real bucket name the team wants in AWS.

The important idea for this orientation is the workflow, not the syntax. The team can put a small change like this in Git, review it in a pull request, and let Terraform preview what it would do before anything changes in the cloud.

## Why Terraform Previews the Change
<!-- section-summary: Terraform's plan step gives the team an infrastructure change list before apply changes real resources. -->

The orders team now has files. The next safety layer is a preview of the cloud actions those files would cause. Terraform calls that preview a **plan**.

A plan answers a practical question: "If we apply this configuration now, what would Terraform create, update, replace, or delete?" Terraform builds that answer by reading the files, checking its saved record of managed objects, and asking the provider what currently exists.

For a first bucket, the plan might say Terraform will create one S3 bucket. For a later change, the plan might say Terraform will update tags, adjust a policy, or replace a resource. The exact plan format comes later, but the first command is worth seeing now:

```bash
terraform plan
```

A tiny first plan for the export bucket should include an action line and a summary like this:

```console
  # aws_s3_bucket.orders_exports will be created
  + resource "aws_s3_bucket" "orders_exports" {
      + bucket = "devpolaris-orders-api-dev-exports"
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

The `+` signs mean Terraform plans to create something. The summary says one resource will be added, no existing resources will be changed, and nothing will be destroyed. That is the useful habit: a teammate reads the proposed infrastructure actions before `terraform apply` changes anything.

**Apply** is the step that performs the approved actions through the provider API. In a healthy team workflow, apply follows review. The pull request explains the intent, the plan shows the expected provider actions, and the team applies only after the preview matches the change they wanted.

That preview changes the conversation around `devpolaris-orders-api`. A reviewer can ask why a database setting changes, why a new permission appears, or why a replacement is planned before the service is affected. The team can decide with the plan in front of them instead of discovering the result later.

![Plan Review Loop](/content-assets/articles/article-iac-terraform-foundations-why-iac/plan-review-loop.png)

*The review loop keeps the important steps visible: code change, pull request, plan, approval, apply, and verification.*

## Drift and Shared Memory
<!-- section-summary: Drift means the real infrastructure changed outside the reviewed files, and Terraform state helps connect files to real objects. -->

Once the team starts using IaC, one more word shows up: **drift**. Drift means the real cloud object no longer matches the configuration the team expects. For example, someone might change a bucket setting in the console during an incident and forget to bring that change back into the Terraform files.

Drift matters because the team can end up with two stories. The files say the orders export bucket has one policy, while the cloud console shows a different policy. A security review that only reads the file may miss the real production setting.

Terraform uses **state** as its record of managed objects. At a beginner level, state connects a Terraform address, such as the bucket preview above, to the real bucket in the provider. That record helps Terraform know which real object it should inspect and update during the next plan.

State and drift get their own deeper module later because teams need to protect state carefully. For this orientation, the main idea is enough: Terraform gives the team a way to compare the files, Terraform's record, and the provider's current view before changing the infrastructure again.

## Scripts, Git, and Team Workflow
<!-- section-summary: Scripts can repeat commands, while Git plus Terraform gives the team review, history, plans, and a shared change process. -->

After a few manual rebuilds, many teams write scripts. That instinct is useful. A script can create a bucket, set tags, attach a policy, run checks, or call Terraform commands in the right order.

Scripts alone usually lack the long-lived memory Terraform provides. A script often says which commands to run. Terraform configuration says what infrastructure should exist, and Terraform compares that desired setup with state and real provider data before proposing a plan.

Git gives the workflow its team shape. An engineer opens a branch, changes Terraform files, and opens a pull request. Reviewers see the code diff, the plan summary, and the reason for the change before the apply step runs.

For `devpolaris-orders-api`, a pull request might say, "Add a 90-day lifecycle rule for exported order files." The code diff shows the configuration change, the plan shows the expected bucket change, and the verification note after apply says the lifecycle rule exists in the provider. That gives the team a clean path from intention to review to real infrastructure.

Rollback also uses the same habit. Reverting a Git change gives the team a previous version of the files, and a fresh Terraform plan shows what returning to those files would do now. Infrastructure rollback still needs care because databases, storage, and networking can affect real data and traffic, so the team reads the new plan before applying it.

## Putting It All Together
<!-- section-summary: Infrastructure as Code turns one-time setup into reviewed files, planned changes, shared state, and repeatable team workflow. -->

The orders service started with a normal manual setup. One engineer created a bucket, database, service identity, and network path so development could move forward. Then staging needed the same shape, production needed stronger controls, and every hidden console choice started to matter.

Infrastructure as Code gives the team a shared operating pattern. The desired setup lives in files, Git records the discussion, Terraform shows a plan, apply performs the approved change, and state helps Terraform remember which real objects belong to the configuration.

![IaC Summary](/content-assets/articles/article-iac-terraform-foundations-why-iac/iac-summary.png)

*The summary board gathers the beginner reasons IaC matters: repeatable setup, reviewed change, shared history, drift detection, and safer teamwork.*

The official [Terraform language documentation](https://developer.hashicorp.com/terraform/language) and [Terraform CLI command documentation](https://developer.hashicorp.com/terraform/cli/commands) are useful references while you learn the details. This article only used a tiny preview because the goal was to explain why the workflow exists before the roadmap teaches the building blocks.

The key beginner idea is simple and practical: Terraform lets a team discuss infrastructure before changing it. That habit reduces surprise, makes rebuilds more repeatable, and gives future teammates a clearer record of why each piece exists.

## What's Next
<!-- section-summary: The next article names Terraform's main parts before the syntax module teaches them in detail. -->

Next, we will look directly at Terraform at an overview level. You will meet configuration, providers, resources, state, plan, apply, and destroy as vocabulary first, then the next module teaches the syntax and hands-on details. Keep that boundary in mind: the next article names the moving parts, and the following module teaches how to write them.

---

**References**

- [Terraform: What is Terraform?](https://developer.hashicorp.com/terraform/intro) - HashiCorp's overview of Terraform as an Infrastructure as Code workflow across providers.
- [Terraform language documentation](https://developer.hashicorp.com/terraform/language) - Official reference for Terraform configuration files, blocks, expressions, resources, variables, and modules.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Documents the command Terraform uses to preview proposed infrastructure changes.
- [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply) - Documents the command Terraform uses to execute an approved plan.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains Terraform's record of managed infrastructure and why state matters for drift and future plans.
