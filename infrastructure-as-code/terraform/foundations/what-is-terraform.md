---
title: "What Is Terraform?"
description: "Understand Terraform as a workflow for turning reviewed configuration into provider API changes, without diving into syntax yet."
overview: "Terraform is an Infrastructure as Code tool that reads configuration files, asks providers about real infrastructure, shows a plan, applies approved changes, and records what it manages in state. This orientation follows devpolaris-orders-api and explains the main Terraform words before the next module teaches the details."
tags: ["terraform", "infrastructure-as-code", "providers", "state", "workflow"]
order: 2
id: article-iac-terraform-foundations-what-is-terraform
---

## Table of Contents

1. [Terraform in One Small Story](#terraform-in-one-small-story)
2. [Configuration Is the Team's Starting Point](#configuration-is-the-teams-starting-point)
3. [Providers Connect Terraform to Real Platforms](#providers-connect-terraform-to-real-platforms)
4. [Resources Are the Things Terraform Manages](#resources-are-the-things-terraform-manages)
5. [State Is Terraform's Record](#state-is-terraforms-record)
6. [Plan and Apply Are the Change Loop](#plan-and-apply-are-the-change-loop)
7. [Destroy and Cleanup Need Extra Care](#destroy-and-cleanup-need-extra-care)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Terraform in One Small Story
<!-- section-summary: Terraform reads files, plans changes, applies approved work through providers, and records managed objects in state. -->

Terraform is an **Infrastructure as Code** tool. It helps a team describe infrastructure in files, preview what would change, apply the approved change through provider APIs, and keep a record of the real objects it manages.

We keep the same `devpolaris-orders-api` service from the previous article. The service needs an export bucket, an orders database, an application identity, and a few network rules. Terraform gives the team one workflow for those pieces: write the desired setup, preview the change, review it, apply it, and verify that the service still works.

That workflow is the whole orientation. Terraform has many details, and the next module teaches the syntax and commands step by step. This article names the main parts first so the words are familiar before you start writing real configuration.

The main parts are **configuration**, **providers**, **resources**, **state**, **plan**, **apply**, and **destroy**. Each part has a simple job in the orders service story, and the rest of this article connects them in that order.

![Terraform Change Loop](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/terraform-change-loop.png)

*The change loop shows the beginner workflow before the syntax arrives: write configuration, plan, review, apply, verify, and keep state updated.*

## Configuration Is the Team's Starting Point
<!-- section-summary: Terraform configuration files describe the desired infrastructure at a readable, reviewable level. -->

**Configuration** means the `.tf` files the team writes for Terraform. Those files describe the infrastructure the team wants, such as a bucket for exports, a database for orders, and an identity for the application. Terraform uses HashiCorp Configuration Language, usually called **HCL**, for those files.

At this orientation level, HCL is just the readable language Terraform understands. The next module teaches blocks, arguments, variables, outputs, references, and formatting. For now, it helps to recognize that Terraform configuration has named blocks that describe pieces of infrastructure.

Here is a tiny preview of one block. The block is intentionally small so the next paragraph can name every visible part without turning this orientation into a syntax lesson.

```hcl
resource "aws_s3_bucket" "orders_exports" {
  bucket = "devpolaris-orders-api-dev-exports"
}
```

This small block says the team wants Terraform to manage one AWS S3 bucket. The word `resource` introduces a managed object. The text `aws_s3_bucket` names the kind of object, `orders_exports` gives the object a local Terraform label, and the `bucket` line gives AWS the bucket name to create or manage.

This small preview keeps the bucket intentionally simple. A real production bucket needs decisions around encryption, public access, ownership, retention, tags, and permissions. The preview stays small because this article is about Terraform's role, while the next module teaches how to write and review full configuration carefully.

## Providers Connect Terraform to Real Platforms
<!-- section-summary: Providers are plugins that know how to call each platform's API on Terraform's behalf. -->

A **provider** is a Terraform plugin that knows how to talk to a real platform. The AWS provider knows AWS APIs. The AzureRM provider knows Azure APIs. Other providers know Google Cloud, Kubernetes, GitHub, Cloudflare, Datadog, and many more systems.

This split keeps Terraform's workflow consistent across platforms. **Terraform Core** is the main Terraform program that reads configuration, evaluates values, builds the plan, and coordinates the run. The provider handles the platform-specific work, such as creating an S3 bucket or reading the current settings of an IAM role.

For the orders export bucket, Terraform Core can understand that the configuration contains a resource address. The AWS provider knows the S3 API calls and the AWS rules for that bucket. Core and provider work together so the plan can say what would happen before the apply step makes the provider request.

Provider versions matter in real projects. A provider version controls which resource types, arguments, validation rules, and API behaviors Terraform uses. The syntax module introduces provider requirements and the lock file, so for now the main idea is that providers are the bridge between Terraform's workflow and real platform APIs.

![Provider State Boundary](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/provider-state-boundary.png)

*The boundary view separates Terraform Core, provider plugins, platform APIs, state, and plan output so the main Terraform parts have visible jobs.*

## Resources Are the Things Terraform Manages
<!-- section-summary: A resource is one managed infrastructure object, such as a bucket, database, role, network, or DNS record. -->

A **resource** is one infrastructure object Terraform manages through a provider. In the orders service, a resource might be an export bucket, a database table, an application identity, a policy, a subnet, or a DNS record.

Resources give the team a clear way to discuss ownership. If Terraform manages the export bucket, changes to that bucket should normally go through Terraform. A console change during an emergency may happen, but the team should bring the final decision back into the Terraform files so the shared record stays true.

Each resource has a Terraform address, such as `aws_s3_bucket.orders_exports`. The first part points to the provider resource type, and the second part is the local label in the project. That address lets Terraform, reviewers, and future articles talk about one managed object without guessing which cloud screen contains it.

The next module teaches resource syntax in detail. This orientation only needs the practical meaning: resources are the named things Terraform plans, creates, updates, replaces, or deletes.

## State Is Terraform's Record
<!-- section-summary: State connects Terraform resource addresses to the real objects that already exist in the provider. -->

Terraform needs a record of what it already manages. That record is called **state**. At a beginner level, state connects a Terraform address, such as `aws_s3_bucket.orders_exports`, to the real bucket in AWS.

State helps Terraform answer ordinary questions during planning. Did Terraform already create this bucket? Which real provider object belongs to this resource address? What values did the provider return after the last apply? Which object should Terraform update if the configuration changes?

For a first solo lab, state may appear as a local `terraform.tfstate` file. For a team, state usually belongs in a protected remote backend with access control and locking. Locking matters because two people applying changes to the same state at the same time can cause dangerous confusion.

State also deserves care because it can contain sensitive values returned by providers. The state module later in the roadmap explains storage, locking, drift, import, and state operations more deeply. For this article, the important idea is that state is Terraform's project memory, not a throwaway cache.

## Plan and Apply Are the Change Loop
<!-- section-summary: Plan previews the proposed actions, and apply performs the approved actions through provider APIs. -->

The everyday Terraform workflow centers on **plan** and **apply**. A plan previews the infrastructure actions Terraform proposes. Apply performs the approved actions through the providers and updates state afterward.

For `devpolaris-orders-api`, a plan might show that Terraform wants to create the export bucket for the development environment. Later, another plan might show a tag update, a permission change, or a database setting change. The plan gives the team a chance to review the provider actions before real infrastructure changes.

The command names are simple at this level. The next module makes them hands-on, but the first shape is useful now.

```bash
terraform plan
```

A first plan for the orders export bucket might end with this summary:

```console
Plan: 1 to add, 0 to change, 0 to destroy.
```

`terraform plan` stays in preview mode. It reads the configuration, checks state, asks providers about real objects, and shows proposed actions. In this example, the summary says Terraform would create one managed object and leave existing objects alone.

After review, the approved change is applied:

```bash
terraform apply
```

For a small first apply, the end of the output may look like this:

```console
Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

`terraform apply` is the step that changes real infrastructure after approval, so teams read the plan before they approve it. The apply summary should match the reviewed intent. If the apply wants to do more than the plan the team discussed, the review loop has broken and the team should stop.

Production workflows usually add more steps around those two commands. Teams often run formatting and validation checks, save plan output in CI/CD, require human approval, apply with a controlled deployment identity, and verify the service after apply. Those details come later, but the basic loop stays the same: preview, review, apply, verify.

## Destroy and Cleanup Need Extra Care
<!-- section-summary: Destroy removes managed objects, so teams reserve it for temporary environments or carefully reviewed cleanup. -->

**Destroy** is Terraform's cleanup path for managed objects. A temporary lab environment might use destroy at the end so the bucket, database, role, and other test resources disappear. That is useful for learning and short-lived environments.

Shared environments need a much stricter review. A production bucket may hold audit files, a database may hold customer records, and an identity may be used by a running service. Removing those objects can affect data, security, and traffic.

The command name appears here so you recognize it as later labs create temporary resources. A safer cleanup review starts with a destroy plan:

```bash
terraform plan -destroy
```

For a temporary bucket lab, the output should make the removal obvious:

```console
  # aws_s3_bucket.orders_exports will be destroyed
  - resource "aws_s3_bucket" "orders_exports" {
      - bucket = "devpolaris-orders-api-dev-exports" -> null
    }

Plan: 0 to add, 0 to change, 1 to destroy.
```

After the team approves that exact removal, the cleanup command performs it:

```bash
terraform destroy
```

Terraform will show the planned removals and ask for confirmation in an interactive terminal. A successful cleanup ends with output like this:

```console
Destroy complete! Resources: 1 destroyed.
```

The orientation lesson is that destroy uses the same managed inventory as apply, so the team must understand the current working directory, backend, workspace, provider identity, and data impact before approving removal.

Many production teams avoid broad destroy as a normal workflow. They retire specific resources through reviewed pull requests, protect critical data stores, keep backups or retention windows, and document manual steps where Terraform should not be the only safety gate.

## Putting It All Together
<!-- section-summary: Terraform connects configuration, providers, resources, state, plan, apply, and cleanup into one repeatable workflow. -->

Terraform starts with configuration files and ends with provider API calls. The files describe the desired setup for the orders service. Providers know how to talk to the real platforms. Resources name the objects Terraform manages. State records which real objects belong to those resources.

The plan/apply loop connects all of that into daily work. Terraform reads the files, checks state, asks the provider what exists, shows a plan, applies approved changes, and updates state. The team then verifies the service result, such as the orders API writing an export file or using the expected application identity.

![Terraform Summary](/content-assets/articles/article-iac-terraform-foundations-what-is-terraform/terraform-summary.png)

*The summary board keeps the core vocabulary together: configuration, provider, resource, state, plan, and apply.*

The official [Terraform CLI command documentation](https://developer.hashicorp.com/terraform/cli/commands) is a helpful map of these commands, and the official [Terraform language documentation](https://developer.hashicorp.com/terraform/language) explains the configuration language. This roadmap will use those ideas slowly, with hands-on work after the orientation.

The most useful beginner takeaway is the order of responsibility. Humans write and review intent, Terraform plans the provider actions, apply performs approved work, and state helps the next plan understand what Terraform already manages.

## What's Next
<!-- section-summary: The next module teaches the Terraform language and building blocks in detail. -->

Next, the roadmap moves into **Terraform Syntax and Building Blocks**. That module teaches HCL syntax, provider requirements, resources, input variables, local values, outputs, dependencies, and the first Terraform project in detail. That is where these overview names turn into actual practice.

---

**References**

- [Terraform: What is Terraform?](https://developer.hashicorp.com/terraform/intro) - HashiCorp's official overview of Terraform's workflow and provider model.
- [Terraform language documentation](https://developer.hashicorp.com/terraform/language) - Explains configuration, resources, providers, input variables, output values, and modules.
- [Terraform providers](https://developer.hashicorp.com/terraform/language/providers) - Documents how Terraform uses providers to interact with remote systems.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains state as Terraform's record of managed resources.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan), [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply), and [terraform destroy](https://developer.hashicorp.com/terraform/cli/commands/destroy) - Official CLI references for the preview, apply, and cleanup commands introduced here.
