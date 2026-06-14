---
title: "What Is Terraform?"
description: "Understand how Terraform reads configuration, talks to providers, tracks state, builds a dependency graph, and runs the init, plan, apply, and destroy workflow."
overview: "Terraform lets a team describe infrastructure in configuration files and then use a repeatable loop to preview and apply changes. This article follows a small devpolaris-orders-api stack so the basic Terraform pieces feel connected: configuration, Terraform Core, providers, resources, state, the dependency graph, and the CLI workflow."
tags: ["terraform", "infrastructure-as-code", "providers", "state", "workflow"]
order: 2
id: article-iac-terraform-foundations-what-is-terraform
---

## Table of Contents

1. [The Basic Terraform Loop](#the-basic-terraform-loop)
2. [The Example Stack](#the-example-stack)
3. [Configuration Files](#configuration-files)
4. [Terraform Core, Providers, and Resources](#terraform-core-providers-and-resources)
5. [State](#state)
6. [The Dependency Graph](#the-dependency-graph)
7. [terraform init](#terraform-init)
8. [terraform plan](#terraform-plan)
9. [Reading a Plan Safely](#reading-a-plan-safely)
10. [terraform apply](#terraform-apply)
11. [terraform destroy](#terraform-destroy)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Basic Terraform Loop
<!-- section-summary: Terraform reads desired infrastructure from files, compares that desire with existing infrastructure, and applies the reviewed change through a repeatable loop. -->

Terraform is an **infrastructure as code** tool. Infrastructure as code means the important parts of your environment live in files: networks, databases, buckets, queues, service permissions, DNS records, and the other pieces an application needs before it can serve real users.

The basic Terraform loop has four everyday steps. A team writes configuration files, runs `terraform init` to prepare the working directory, runs `terraform plan` to preview the change, and runs `terraform apply` to make the reviewed change real. `terraform destroy` belongs to the same family of commands, usually for temporary environments that need to be cleaned up.

The useful idea is that Terraform always tries to answer one practical question: **what must change so the real infrastructure matches the configuration files?** It answers by comparing three things: the files you wrote, Terraform's state record, and the infrastructure that currently exists in the provider. That comparison is the heart of the tool.

We will follow one small service through the whole article: `devpolaris-orders-api`. It gives us a concrete stack to talk about, so `init`, `plan`, `apply`, state, providers, and the dependency graph stay connected to the same story.

## The Example Stack
<!-- section-summary: A small API stack gives Terraform something concrete to create, update, track, and eventually clean up. -->

Imagine the DevPolaris team wants a small orders API for a development environment. The service receives order requests, stores each order in DynamoDB, writes logs to CloudWatch, and exposes an HTTPS endpoint through API Gateway. DynamoDB is AWS's managed key-value and document database. CloudWatch collects logs and metrics. API Gateway exposes HTTP endpoints that can call a backend like Lambda.

The first version of `devpolaris-orders-api` needs a DynamoDB table, a Lambda function, an IAM role for that function, a log group, and an API Gateway route. Lambda runs code without the team managing servers. IAM controls what the Lambda function can do. The IAM role matters because the Lambda function needs permission to write logs and read or write order records.

This is a good beginner Terraform example because the pieces depend on each other. The Lambda function needs the IAM role before it can be created. The API route needs the Lambda function before traffic can reach the app. The table can usually be created at the same time as the role because neither resource depends on the other.

If the team created this by clicking around in the AWS Console, a future engineer would need to remember every setting and repeat the same clicks for staging or production. With Terraform, the team writes the desired shape once, reviews the plan, and repeats the same workflow every time the stack changes.

## Configuration Files
<!-- section-summary: Terraform configuration files describe the desired infrastructure with provider blocks, resource blocks, variables, and outputs. -->

Terraform configuration usually lives in files ending with `.tf`. The language is HCL, HashiCorp Configuration Language. HCL uses blocks and arguments, so the files look structured like code while staying readable for people who are still new to infrastructure automation.

All `.tf` files in the same directory are loaded together as one **root module**. Teams often split them by purpose, such as `providers.tf`, `variables.tf`, `main.tf`, and `outputs.tf`, but Terraform treats them as one configuration after it reads the directory. The file names help humans navigate the project.

Here is a small starting point for the orders API. It shows the provider declaration, provider configuration, one DynamoDB table, and one output:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

resource "aws_dynamodb_table" "orders" {
  name         = "devpolaris-orders-api-orders-dev"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "order_id"

  attribute {
    name = "order_id"
    type = "S"
  }

  tags = {
    Application = "devpolaris-orders-api"
    Environment = "dev"
  }
}

output "orders_table_name" {
  value = aws_dynamodb_table.orders.name
}
```

The `terraform` block says which provider package the configuration needs. In this example, the source address `hashicorp/aws` tells Terraform where the AWS provider comes from, and the version constraint controls which provider releases are acceptable for this project.

The `provider "aws"` block configures the AWS provider. A provider block tells Terraform how to talk to a platform or API. For AWS, that usually includes a region, and credentials usually come from the environment, an AWS profile, or the runtime where Terraform is running. Keeping credentials outside the `.tf` files avoids putting secrets in version control.

The `resource` block declares one managed object. The resource type is `aws_dynamodb_table`, and the local name is `orders`, so the full Terraform address is `aws_dynamodb_table.orders`. That address is how other resources refer to this table inside the configuration, and it is also how Terraform tracks this object in state.

The output exposes a value after apply finishes. In a real project, outputs often show endpoint URLs, bucket names, table names, or IDs that another system needs. For the orders API, the table name is useful for app configuration and for quick verification after the first apply.

## Terraform Core, Providers, and Resources
<!-- section-summary: Terraform Core plans and coordinates the run, while provider plugins know how to manage each platform's real resources. -->

When someone says "Terraform" in daily conversation, they usually mean the `terraform` CLI. Under the hood, it helps to separate **Terraform Core** from **providers**. Terraform Core is the main program that reads configuration, evaluates expressions, tracks state, builds the dependency graph, creates the plan, and coordinates apply.

A **provider** is a plugin that knows how to talk to a specific API. The AWS provider knows the AWS API shapes for DynamoDB tables, Lambda functions, IAM roles, API Gateway routes, and many other AWS resources. A GitHub provider knows GitHub repositories and teams. A Cloudflare provider knows DNS records and zones.

Terraform Core does the provider-neutral work. It can understand that `aws_lambda_function.orders_api` references `aws_iam_role.orders_lambda.arn`, so the role must exist first. The AWS provider does the AWS-specific work. It takes Terraform's request and calls the correct AWS APIs with the correct fields.

A **resource** is one object Terraform manages through a provider. In the orders API stack, the DynamoDB table is a resource, the Lambda function is a resource, the IAM role is a resource, and the API Gateway route is a resource. Each resource has a Terraform address in the configuration and a real identity in the provider after creation.

This split is why the same Terraform workflow works across many systems. The CLI commands stay the same, while providers bring the platform-specific resource types and arguments. The beginner habit to build early is simple: when a resource type starts with `aws_`, the AWS provider owns the API details for that resource.

## State
<!-- section-summary: State records the link between Terraform resource addresses and real provider objects, which lets future plans update existing infrastructure instead of guessing. -->

Terraform **state** is Terraform's record of the resources it manages. At a beginner level, the most important thing state stores is the binding between a Terraform address and a real object. For example, state records that `aws_dynamodb_table.orders` maps to the DynamoDB table named `devpolaris-orders-api-orders-dev`.

That binding matters during the next plan. The configuration says the table should exist. The state says which real table belongs to this resource address. The AWS API says what the table currently looks like. Terraform compares those three sources of information before proposing a change.

Here is the comparison in plain terms. Each row gives Terraform one part of the decision:

| Source | What it answers for `devpolaris-orders-api` |
|---|---|
| **Configuration** | What the team wants now, such as table name, billing mode, Lambda memory, and API route |
| **State** | Which real AWS objects Terraform already manages for each resource address |
| **Real infrastructure** | What AWS currently reports through its APIs during refresh and planning |

Terraform compares all three because each one tells a different part of the truth. If the configuration changed, Terraform needs a plan that updates real infrastructure. If someone changed the Lambda memory in the AWS Console, Terraform can notice that the real object drifted away from the last known state. If state is missing, Terraform may no longer know that an existing table belongs to `aws_dynamodb_table.orders`.

By default, Terraform stores local state in a file named `terraform.tfstate`. That is fine for a small solo experiment. A team normally uses a remote backend with access control, backups, and locking, because state is shared project memory and can contain sensitive values.

State should be treated carefully. Terraform provides CLI commands for state inspection and state changes, and direct editing of the state file can break the one-to-one relationship between a resource address and the real object it represents. For a beginner, the safe starting rule is that normal work happens through configuration changes, `plan`, and `apply`.

## The Dependency Graph
<!-- section-summary: Terraform builds a dependency graph so resources are created, updated, and destroyed in an order that respects references between them. -->

Terraform uses a **dependency graph** to decide operation order. A graph is a set of nodes and links. In Terraform, many of the nodes are resources, and the links come from references between resources.

Here is a simplified Lambda example from the orders API. The important detail is the reference from the function to the role:

```hcl
resource "aws_iam_role" "orders_lambda" {
  name = "devpolaris-orders-api-lambda-role-dev"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_lambda_function" "orders_api" {
  function_name = "devpolaris-orders-api-dev"
  role          = aws_iam_role.orders_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "build/orders-api.zip"
}
```

The Lambda function references `aws_iam_role.orders_lambda.arn`. That reference tells Terraform that the role must be available before the function can be created. Terraform can infer that dependency from the expression, so the configuration already carries the ordering instruction for this common case.

The graph also helps Terraform work efficiently. The DynamoDB table and the IAM role can usually be created in parallel because neither one references the other. The Lambda function waits for the role. The API Gateway integration waits for the Lambda function. The graph gives Terraform a safe order without the team writing a long step-by-step script.

There is also an explicit `depends_on` argument for unusual cases where the dependency exists in the real platform and normal expressions hide it. Beginners should reach for references first, because references both pass values and teach Terraform the ordering relationship. Explicit dependencies are useful, but they are clearer when reserved for cases Terraform cannot infer from the configuration.

## terraform init
<!-- section-summary: terraform init prepares a working directory by installing providers, setting up modules, and initializing the configured backend. -->

`terraform init` prepares a directory so the other Terraform commands can run. It is the first command after writing a new configuration or cloning an existing Terraform project. It is also safe to run multiple times, which is helpful when a teammate changes provider requirements or backend settings.

For the orders API, `init` reads the `required_providers` block and sees that the configuration needs the AWS provider. Terraform then downloads a provider version that matches the version constraint and records the exact selected version in `.terraform.lock.hcl`. That lock file helps the team use the same provider version across laptops and CI runs.

`init` also prepares the backend. A backend is the place Terraform stores state for the current workspace. A local backend stores `terraform.tfstate` on disk. A remote backend stores the state somewhere shared, such as a managed Terraform service or a cloud storage backend configured by the team.

The practical result is that `terraform init` makes the working directory ready. The `.terraform/` directory holds downloaded provider plugins and working data. The lock file records provider selections. The backend is ready for state reads and writes during plan and apply.

```bash
terraform init
```

After `init`, the project has the tools it needs to ask AWS about DynamoDB, Lambda, IAM, CloudWatch, and API Gateway. The next step is a plan, because the team needs to see what Terraform intends to change before any real infrastructure is touched.

## terraform plan
<!-- section-summary: terraform plan previews the actions Terraform proposes after refreshing real infrastructure and comparing it with configuration and state. -->

`terraform plan` creates an execution plan. The plan is Terraform's preview of the changes it proposes for the current configuration. A normal plan stays in preview mode, so real infrastructure remains unchanged during plan review.

For the orders API, Terraform starts by reading the `.tf` files. It sees the DynamoDB table, IAM role, Lambda function, API route, variables, outputs, provider configuration, and references between resources. Terraform Core then builds the graph and prepares to compare the desired stack with what already exists.

By default, Terraform refreshes state information by reading the current remote objects from the provider. If the table already exists in state, Terraform asks AWS what that table looks like now. Then Terraform compares the current configuration to the prior state and the refreshed provider data, and it proposes actions that would make the remote objects match the configuration.

The plan may say Terraform will create a new table, update Lambda memory, replace a resource, or destroy something that disappeared from the configuration. It may also say there are no changes, which means the current infrastructure already matches the desired configuration from Terraform's point of view.

```bash
terraform plan
```

Automation often saves a plan file. That gives review workflows a specific plan artifact to approve:

```bash
terraform plan -out=orders-api.tfplan
```

A saved plan is useful in review-heavy workflows because the approved plan can be passed to `terraform apply`. A normal unsaved plan is still valuable for local development because it shows the proposed effect before the team commits to the change.

## Reading a Plan Safely
<!-- section-summary: A safe plan review focuses on action symbols, resource addresses, replacements, destroys, unknown values, and the final summary line. -->

Plan output can feel noisy the first few times. A helpful reading style treats it as a proposed change list for real infrastructure. Every resource address names the object Terraform wants to touch, and every symbol tells you the kind of action Terraform plans.

Here is a small plan-shaped example for the orders API. The names come from the same service we have followed through the article:

```terraform
Terraform will perform the following actions:

  # aws_dynamodb_table.orders will be created
  + resource "aws_dynamodb_table" "orders" {
      + name         = "devpolaris-orders-api-orders-dev"
      + billing_mode = "PAY_PER_REQUEST"
      + arn          = (known after apply)
    }

  # aws_lambda_function.orders_api will be updated in-place
  ~ resource "aws_lambda_function" "orders_api" {
      ~ memory_size = 256 -> 512
    }

Plan: 1 to add, 1 to change, 0 to destroy.
```

The `+` symbol means Terraform proposes to create something. The `~` symbol means Terraform proposes to update an existing resource in place. The `-` symbol means Terraform proposes to destroy something. A `-/+` or `+/-` style replacement means Terraform will destroy and recreate a resource as part of the change.

The resource address deserves careful attention. `aws_lambda_function.orders_api` points to the Terraform resource named `orders_api`, which maps through state to one Lambda function in AWS. The address connects the plan back to the exact resource block in the configuration and the exact object binding in state.

The phrase `(known after apply)` means the provider will return the value only after the operation happens. For example, AWS can assign an ARN, ID, or generated endpoint after creating a resource. Unknown values are normal, but they deserve context. A new table ARN being unknown is expected. A security group rule becoming unknown during a broad replacement deserves a closer look.

Replacement and destroy lines carry the most risk. A Lambda memory update usually affects runtime behavior without replacing the function. A table replacement can mean data loss unless the table is temporary or protected by a migration plan. A safe review always explains why each destroy or replacement appears before apply runs.

The final summary line gives the quick count. It appears near the bottom of the plan after Terraform lists the resource-level changes:

```terraform
Plan: 1 to add, 1 to change, 0 to destroy.
```

That line is useful, and the resource changes above it still matter. `0 to destroy` is comforting. `1 to destroy` needs the reviewer to know exactly which resource is being destroyed and why that is acceptable for the environment.

## terraform apply
<!-- section-summary: terraform apply executes the reviewed plan, calls provider APIs in graph order, and updates state with the results. -->

`terraform apply` executes the operations proposed in a Terraform plan. In an interactive terminal, running `terraform apply` with no saved plan file makes Terraform create a fresh plan, show it, ask for approval, and then perform the indicated operations after approval.

For the orders API, apply might create the DynamoDB table and IAM role first. Then it can create the Lambda function after the role exists. Then it can create the API integration after the Lambda function is available. Terraform uses the dependency graph to keep this order straight while still running independent work in parallel where it can.

```bash
terraform apply
```

With a saved plan, apply uses that file:

```bash
terraform apply orders-api.tfplan
```

This two-step flow is common in CI/CD. A pipeline can create a plan, let reviewers inspect it, and then apply that approved plan. The apply can still fail if AWS rejects a request, credentials expire, quotas are reached, or real infrastructure changes in a way that makes the approved plan stale.

After each successful operation, Terraform updates state. If the DynamoDB table is created, state records the table identity and attributes. If Lambda memory changes from `256` to `512`, state records the new value after AWS confirms the update. Terraform uses this updated state in the next plan's comparison.

Apply is the point where Terraform changes real infrastructure. That is why the plan review matters so much. The workflow has a built-in pause so the team can catch accidental destroys, surprising replacements, wrong regions, wrong names, or changes aimed at the wrong environment.

## terraform destroy
<!-- section-summary: terraform destroy deprovisions the objects managed by the current configuration and is most useful for temporary environments. -->

`terraform destroy` deprovisions the objects managed by a Terraform configuration. It belongs in the core workflow because development and test environments often need clean teardown. A short-lived `devpolaris-orders-api` sandbox might exist for a workshop, a pull request environment, or a training exercise, and destroy removes the managed resources when that environment is finished.

Destroy uses Terraform's state and graph just like apply. Terraform knows which objects belong to the current configuration because state records the managed resource bindings. It then proposes destroy actions and, after approval, deletes resources in an order that respects dependencies.

```bash
terraform destroy
```

The safer review version is a destroy plan. It gives the team the same preview habit before teardown:

```bash
terraform plan -destroy
```

That plan shows the proposed deletions without executing them. For the orders API, a destroy plan might include the API route, Lambda function, IAM role, log group, and DynamoDB table. A temporary environment can tolerate that. A production orders table usually needs a backup, retention policy, migration path, or a different lifecycle strategy before any destroy operation is acceptable.

Terraform destroy is powerful because it uses the same managed inventory that apply uses. The same state that helps Terraform avoid duplicate creation also tells Terraform what it would remove during teardown. That is another reason state protection matters in team environments.

## Putting It All Together
<!-- section-summary: Terraform's operating loop connects configuration, providers, state, graph ordering, plan review, apply execution, and optional teardown. -->

The orders API started as a set of desired resources in `.tf` files. The configuration declared the AWS provider, configured the provider region, defined resources like `aws_dynamodb_table.orders`, and used references so Terraform could understand how the stack fits together.

Terraform Core read those files, loaded the provider plugin, evaluated expressions, built the dependency graph, and compared configuration with state and real AWS infrastructure. The provider handled AWS-specific API calls. State recorded the link between Terraform addresses and real AWS objects.

The daily loop is steady. `terraform init` prepares the directory. `terraform plan` previews the proposed change. The plan review checks symbols, addresses, replacements, destroys, unknown values, and the final count. `terraform apply` makes the reviewed change real and updates state. `terraform destroy` cleans up managed resources when the environment is meant to disappear.

That loop is the foundation of Terraform. The tool is useful because the team can repeat the same process for every infrastructure change, from a single DynamoDB table to a larger service with networking, compute, storage, IAM, observability, and DNS.

## What's Next

Now that the basic loop is clear, the next article turns it into a small safe project. You will create a Terraform folder, write `versions.tf`, `main.tf`, and `outputs.tf`, run `fmt`, `init`, `validate`, `plan`, and `apply`, then clean up with `destroy`.

---

**References**

- [Terraform CLI commands](https://developer.hashicorp.com/terraform/cli/commands) - Official overview of Terraform CLI subcommands, including the main workflow commands.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - Explains how Terraform stores state, maps resource instances to remote objects, refreshes state, and handles state files.
- [Provider block](https://developer.hashicorp.com/terraform/language/block/provider) - Documents provider blocks, provider plugins, provider-specific arguments, aliases, and provider configuration behavior.
- [terraform init](https://developer.hashicorp.com/terraform/cli/commands/init) - Documents initializing a working directory, provider installation, and repeated safe use of init.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Documents execution plans, refresh behavior, comparison with state, proposed actions, speculative plans, and saved plans.
- [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply) - Documents applying plans, automatic plan mode, saved plan mode, approval behavior, and apply options.
- [terraform destroy](https://developer.hashicorp.com/terraform/cli/commands/destroy) - Documents deprovisioning managed objects, destroy mode, and speculative destroy plans.
- [Terraform dependency graph](https://developer.hashicorp.com/terraform/internals/graph) - Explains how Terraform builds and uses a dependency graph for planning, refreshing, and applying infrastructure changes.
