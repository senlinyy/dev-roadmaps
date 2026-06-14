---
title: "Your First Safe Terraform Project"
description: "Build a tiny Terraform project with the random provider, practice fmt, init, validate, plan, apply, verify, destroy, and learn what belongs in Git."
overview: "This hands-on article walks through your first safe Terraform project from an empty folder to a clean destroy. You will install Terraform, write main.tf, versions.tf, and outputs.tf, run the core workflow commands, review the plan before applying, verify what Terraform created, clean everything up, and learn the Git hygiene that keeps team repositories safe."
tags: ["terraform", "cli", "plan", "apply", "state"]
order: 3
id: article-iac-terraform-foundations-first-safe-project
---

## Table of Contents

1. [What This First Project Will Build](#what-this-first-project-will-build)
2. [Install Terraform and Check the CLI](#install-terraform-and-check-the-cli)
3. [Create a Small Project Folder](#create-a-small-project-folder)
4. [Write versions.tf](#write-versionstf)
5. [Write main.tf](#write-maintf)
6. [Write outputs.tf](#write-outputstf)
7. [Format and Initialize the Project](#format-and-initialize-the-project)
8. [Validate and Plan the Change](#validate-and-plan-the-change)
9. [Apply Only After Reading the Plan](#apply-only-after-reading-the-plan)
10. [Verify What Terraform Created](#verify-what-terraform-created)
11. [Destroy the Project Cleanly](#destroy-the-project-cleanly)
12. [Keep the Git Repository Clean](#keep-the-git-repository-clean)
13. [How the Same Workflow Maps to Cloud Resources](#how-the-same-workflow-maps-to-cloud-resources)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)

## What This First Project Will Build
<!-- section-summary: The first project uses the random provider so you can practice the Terraform workflow without touching a cloud account. -->

Your first Terraform project should teach the real workflow without putting a real cloud bill, production account, or shared resource at risk. We will use the **random provider**, which is a Terraform provider that generates values and stores them in Terraform state. It gives us real Terraform resources, real provider installation, real plan output, real apply output, and real destroy behavior, while keeping the first run inside a small local project.

The project will create two Terraform-managed resources. One resource will generate a readable project name such as `devpolaris-quiet-lion`. Another resource will generate a short random suffix such as `6f3a1c9b`. Then an output will combine those values into a fake training bucket name, like `devpolaris-devpolaris-quiet-lion-6f3a1c9b`. That name gives us something concrete to inspect without creating a real bucket yet.

This is a useful first exercise because Terraform still has to do the important parts. It reads `.tf` files, checks provider requirements, downloads a provider plugin during `terraform init`, creates a dependency lock file, builds a plan, asks for confirmation during apply, writes state, exposes outputs, and removes resources during destroy. Those are the same steps you will use later for AWS, Azure, Google Cloud, Kubernetes, GitHub, and other providers.

We will use three files:

| File | Purpose |
|---|---|
| `versions.tf` | Pins the Terraform version and provider source/version requirements. |
| `main.tf` | Defines the resources and local value for the tiny project. |
| `outputs.tf` | Prints useful values after apply so you can verify the result. |

By the end, the important habit is simple and serious: **edit, format, initialize when needed, validate, plan, read the plan, apply only when the plan matches your intent, verify, and destroy when the lab is finished**.

## Install Terraform and Check the CLI
<!-- section-summary: Terraform is a local command-line tool, so the first check is that the terraform command works on your machine. -->

Terraform runs as a command-line tool on your machine or in an automation runner. The official install page gives current instructions for macOS, Windows, Linux, FreeBSD, OpenBSD, and Solaris. Use that page for your operating system so you get the right package repository, installer, or binary download.

On macOS with Homebrew, the install flow usually looks like this:

```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

On Linux, the exact commands depend on the distribution, so use the official install page and follow the package manager path for your system. On Windows, download the binary from the official page or use the package path your team supports. The important result is that your shell can find the `terraform` command.

Check the installation:

```bash
terraform version
```

You should see a Terraform version printed. The exact version may differ from the examples in this article because Terraform releases continue over time. For this project, any recent Terraform 1.x version is fine, and later team projects can pin a stricter minimum version in `versions.tf`.

This first check matters because every later command starts with the same local binary. When a teammate says "run Terraform," they usually mean run the Terraform CLI from a folder containing `.tf` files.

## Create a Small Project Folder
<!-- section-summary: A Terraform project is usually just a folder with .tf files, so we start with a clean directory and three small files. -->

A **Terraform working directory** is the folder where you run Terraform commands. Terraform reads the `.tf` files in that folder together as one root module. A root module is the top-level set of Terraform configuration files for one project or one part of a project.

Create a small folder for the lab:

```bash
mkdir terraform-first-safe-project
cd terraform-first-safe-project
touch versions.tf main.tf outputs.tf
```

The file names are simple conventions with a useful purpose. Terraform reads all `.tf` files in the folder together, so `versions.tf`, `main.tf`, and `outputs.tf` all become one configuration. Teams split files this way because it keeps each idea easy to find: version rules in one file, resources in another file, and outputs in another file.

This structure also helps later in code review. A reviewer can open `versions.tf` to see which providers the project trusts, open `main.tf` to see what infrastructure the project manages, and open `outputs.tf` to see what values the project exposes after a run.

## Write versions.tf
<!-- section-summary: versions.tf declares the Terraform version and provider versions so init can download the right plugin. -->

Open `versions.tf` and add this configuration:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}
```

The `terraform` block configures Terraform itself. `required_version` says which Terraform CLI versions can run this project. This is a guardrail for teams because a project written for one Terraform generation may use language features that only newer binaries understand.

The `required_providers` block tells Terraform which provider plugins this project needs. A **provider** is a plugin that knows how to manage one external system or one category of resource. The random provider knows how to manage random values. The AWS provider knows how to manage AWS resources. The Azure provider knows how to manage Azure resources.

The `source` value `hashicorp/random` identifies the provider in the Terraform Registry. The `version` value `~> 3.7` allows compatible random provider releases in the 3.x line starting at 3.7. This gives the project patch and minor updates inside that compatibility range while avoiding an automatic jump to a future 4.x release with possible breaking changes.

This file is small, but it controls a lot. During `terraform init`, Terraform reads this provider requirement, downloads the matching provider package, and records dependency selections in `.terraform.lock.hcl`.

## Write main.tf
<!-- section-summary: main.tf defines the actual resources, and the first resources generate safe local values instead of cloud infrastructure. -->

Open `main.tf` and add this configuration:

```hcl
resource "random_pet" "project_name" {
  prefix = "devpolaris"
  length = 2
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

locals {
  training_bucket_name = "devpolaris-${random_pet.project_name.id}-${random_id.bucket_suffix.hex}"
}
```

A **resource block** tells Terraform to manage one object. The first label is the resource type, such as `random_pet` or `random_id`. The second label is the local name you use inside this project, such as `project_name` or `bucket_suffix`. Together, `random_pet.project_name` is the address of that resource in this Terraform configuration.

The `random_pet` resource generates a readable name. The `prefix` adds `devpolaris` to the front, and `length = 2` asks for two random words after the prefix. The exact words are only sample values. The important part is that Terraform will store the generated result in state so later plans know the value already exists.

The `random_id` resource generates bytes and exposes them in useful forms such as hex. Here we ask for 4 bytes, which gives an 8-character hex suffix. That suffix is useful in real cloud projects because many cloud resource names need to be globally unique.

The `locals` block creates a named expression inside the module. A **local value** is a reusable expression that exists only inside Terraform configuration. A local value creates no infrastructure by itself. In this project, `local.training_bucket_name` combines the readable name and random suffix into one fake cloud-style name that we can print later.

Notice the reference syntax in the string: `${random_pet.project_name.id}` and `${random_id.bucket_suffix.hex}`. Terraform uses those references to understand that the local value depends on both random resources. That dependency tracking is one reason Terraform can plan changes in the right order.

## Write outputs.tf
<!-- section-summary: outputs.tf prints values after apply so you can verify the result without digging through state first. -->

Open `outputs.tf` and add this configuration:

```hcl
output "project_name" {
  value = random_pet.project_name.id
}

output "training_bucket_name" {
  value = local.training_bucket_name
}
```

An **output value** prints useful information from a root module after Terraform applies successfully. Outputs often expose things people or later automation need, such as a load balancer DNS name, a database endpoint, a bucket name, or a generated project label.

Here the outputs give us an easy way to verify the random resources. After apply, Terraform will show `project_name` and `training_bucket_name`. You can also run `terraform output` later to print them again.

Outputs can contain sensitive data if you place sensitive values in them, so treat them carefully in real projects. This lab only outputs generated names, which are safe to display. In production, avoid printing passwords, tokens, private keys, or connection strings that contain secrets.

Now we have a complete tiny Terraform project. The next step is to let Terraform clean up formatting and prepare the working directory.

## Format and Initialize the Project
<!-- section-summary: fmt cleans the files, and init downloads the provider plugin plus writes the dependency lock file. -->

The first command to run in a Terraform folder is usually `terraform fmt`. The `fmt` command rewrites Terraform configuration files into the standard style. It fixes indentation and alignment so teams spend review time on behavior instead of spacing.

Run it from the project folder:

```bash
terraform fmt
```

If Terraform changes a file, it prints the file name. If everything already matches the standard style, it may print nothing. Both outcomes are fine. Many teams run `terraform fmt -check` in CI so formatting drift fails before a pull request merges.

Now initialize the project:

```bash
terraform init
```

`terraform init` prepares the working directory for other Terraform commands. In this project, it reads `versions.tf`, finds the `hashicorp/random` provider requirement, downloads the matching provider plugin, creates a local `.terraform/` directory for downloaded project data, and writes `.terraform.lock.hcl` with the provider version and checksums selected for this project.

After init, your folder should look roughly like this:

```bash
ls -a
```

```bash
.
..
.terraform
.terraform.lock.hcl
main.tf
outputs.tf
versions.tf
```

The `.terraform/` directory is local working data. The `.terraform.lock.hcl` file is the dependency lock file. That lock file matters for teams because it records exact provider selections and checksums so different machines can install the same provider package instead of silently drifting to a different build.

Now Terraform has the provider plugin it needs. The next step is checking whether the configuration is valid and then asking Terraform what it plans to do.

## Validate and Plan the Change
<!-- section-summary: validate checks configuration shape, while plan shows the exact resource changes Terraform intends to make. -->

Run validation:

```bash
terraform validate
```

`terraform validate` checks whether the configuration is syntactically valid and internally consistent. It can catch missing references, invalid arguments, and malformed configuration before you reach the plan step. A successful result usually says the configuration is valid.

Validation is useful, and the next question is what infrastructure changes will happen. That job belongs to `terraform plan`.

Run a plan:

```bash
terraform plan
```

The plan output should show two resources to create:

```hcl
Terraform will perform the following actions:

  # random_id.bucket_suffix will be created
  + resource "random_id" "bucket_suffix" {
      + byte_length = 4
      + hex         = (known after apply)
      + id          = (known after apply)
    }

  # random_pet.project_name will be created
  + resource "random_pet" "project_name" {
      + id     = (known after apply)
      + length = 2
      + prefix = "devpolaris"
    }

Plan: 2 to add, 0 to change, 0 to destroy.
```

The `+` marker means Terraform plans to create something. The phrase `(known after apply)` means Terraform cannot know the final generated value until the provider creates it. That makes sense here because the random provider generates the pet name and suffix during apply.

This plan is safe because it lists only `random_id.bucket_suffix` and `random_pet.project_name`, with `2 to add, 0 to change, 0 to destroy`. If a plan ever shows a resource type you did not expect, a delete you did not intend, or a cloud account you did not mean to touch, stop at the plan step and fix the configuration before applying.

## Apply Only After Reading the Plan
<!-- section-summary: apply changes real managed objects, so the safe habit is to read the plan first and apply only when it matches your intent. -->

`terraform apply` is the command that makes Terraform perform the planned changes. By default, Terraform shows a plan and asks for confirmation before it takes action. That confirmation prompt is an important pause, especially in cloud projects where apply can create billable resources or delete important infrastructure.

Run apply:

```bash
terraform apply
```

Terraform will show the plan again. In this lab, the plan should still say `2 to add, 0 to change, 0 to destroy`, and the only resources should be `random_id.bucket_suffix` and `random_pet.project_name`. When the plan matches that intent, type:

```bash
yes
```

Terraform will call the random provider, create the two random resources, write their values to `terraform.tfstate`, and print the outputs from `outputs.tf`. The output will look different on your machine because the names are generated:

```hcl
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.

Outputs:

project_name = "devpolaris-bright-raven"
training_bucket_name = "devpolaris-devpolaris-bright-raven-a1b2c3d4"
```

The new file `terraform.tfstate` is Terraform's local record of what it manages. In this lab, state contains the generated random values. In real cloud projects, state can contain resource IDs, attributes returned by provider APIs, and sometimes sensitive values depending on the resource type. That is why team state usually lives in a protected remote backend instead of being committed to Git.

We applied a safe local project. Now we should verify what Terraform created instead of trusting the success message alone.

## Verify What Terraform Created
<!-- section-summary: Verification connects the apply result back to outputs and state so you know what Terraform is managing. -->

Start with the outputs:

```bash
terraform output
```

You should see the same two output values from the apply result. Outputs are the friendly layer because they show the values this project intentionally exposes.

Then list the resources Terraform tracks in state:

```bash
terraform state list
```

You should see:

```bash
random_id.bucket_suffix
random_pet.project_name
```

This confirms that Terraform is managing two resources in this working directory. For one resource, you can inspect the stored attributes:

```bash
terraform state show random_pet.project_name
```

The state output should include the generated `id`, the `length`, and the `prefix`. This is the same idea you will use with cloud resources later. Instead of checking a random name, you might verify an S3 bucket in the AWS console, an Azure resource group with the Azure CLI, or a Google Cloud storage bucket with `gcloud`.

For this lab, the random values are the created resources. They exist in Terraform state because the random provider created and recorded them. That may sound small, but it gives you the complete lifecycle without creating anything expensive or public.

## Destroy the Project Cleanly
<!-- section-summary: destroy is the cleanup command, and it deserves the same plan-reading habit as apply. -->

A hands-on lab should end with cleanup. Terraform uses `terraform destroy` to remove resources managed by the current configuration and state.

Run destroy:

```bash
terraform destroy
```

Terraform will show a destroy plan. In this lab, it should list only the two random resources and say:

```hcl
Plan: 0 to add, 0 to change, 2 to destroy.
```

When the destroy plan matches the lab cleanup, type:

```bash
yes
```

Terraform removes the two managed random resources from state. The local state file may still exist, but the managed resource list should now be empty:

```bash
terraform state list
```

After cleanup, Terraform should have no resources left to list. This habit matters in real cloud work because a forgotten lab resource can cost money, expose a public endpoint, or confuse the next person reading the account.

The project lifecycle is complete now: write, format, init, validate, plan, apply, verify, destroy. The last safety topic is what goes into Git.

## Keep the Git Repository Clean
<!-- section-summary: Team repositories should commit Terraform code and the provider lock file while ignoring local working data and local state. -->

Terraform projects belong in version control because the `.tf` files are the shared record of intended infrastructure. For a real team repository, commit the Terraform configuration files and the dependency lock file:

```bash
git add versions.tf main.tf outputs.tf .terraform.lock.hcl
git commit -m "Add first Terraform project"
```

The rule is: **commit `.tf` files and `.terraform.lock.hcl`; ignore `.terraform/` and local state for real team repos**. The `.tf` files describe what the project should manage. The `.terraform.lock.hcl` file records the provider versions and checksums selected by `terraform init`. The `.terraform/` directory is local downloaded working data. Local state files such as `terraform.tfstate` and `terraform.tfstate.backup` can contain sensitive or environment-specific details, so team projects should use a proper remote backend and keep local state out of Git.

A starter `.gitignore` for this lab can look like this:

```gitignore
.terraform/
terraform.tfstate
terraform.tfstate.*
*.tfplan
crash.log
crash.*.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc
```

Plan files also stay out of normal commits because they can contain provider data and environment-specific details. Some teams generate saved plans inside CI for a controlled apply flow, and those files are build artifacts instead of source code.

Keep secret variable files out of commits, too. A file like `terraform.tfvars` can be safe if it contains only non-sensitive settings, but many teams ignore `*.tfvars` by default because those files often collect account IDs, passwords, tokens, or private values over time. If your team commits non-secret tfvars files, name that convention clearly and review them carefully.

Good Git hygiene turns Terraform from a local experiment into a team workflow. Reviewers can read the `.tf` change, see the provider lock file change, run the same commands, and keep local state and downloaded plugins out of the repository.

## How the Same Workflow Maps to Cloud Resources
<!-- section-summary: The random project teaches the command loop, and a small cloud resource uses the same loop with real provider credentials and cleanup responsibility. -->

The random provider gave us a safe first run. The next step in real infrastructure work is using the same command loop with a cloud provider. The shape stays the same: declare provider requirements, configure the provider, define a small resource, format, init, validate, plan, read the plan, apply, verify in the provider, and destroy the lab resource.

Here is a small AWS example that creates an S3 bucket in a sandbox account. S3 is AWS object storage for files, backups, exports, and static assets. Bucket names must be globally unique, so the configuration uses `random_id` again to create a suffix.

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "training" {
  bucket = "devpolaris-first-safe-${random_id.bucket_suffix.hex}"
}

output "bucket_name" {
  value = aws_s3_bucket.training.bucket
}
```

The workflow is the same:

```bash
terraform fmt
terraform init
terraform validate
terraform plan
terraform apply
terraform output
terraform destroy
```

The risk is different because AWS resources exist in an AWS account. Before applying a cloud example, make sure your AWS CLI or environment is authenticated to the intended sandbox account and region. Review the plan for the exact resource type and name. After apply, verify the bucket with the AWS console or CLI, then destroy the lab resource when you finish.

This is why the random provider is a good first step. It lets you practice the safety loop before real provider credentials, real APIs, real costs, and real cleanup enter the picture.

## Putting It All Together
<!-- section-summary: A safe Terraform workflow is a repeatable loop that makes each change visible before it touches managed resources. -->

You built a complete Terraform project from scratch. The project started as an empty folder, then gained `versions.tf`, `main.tf`, and `outputs.tf`. Terraform used `versions.tf` to install the random provider, used `main.tf` to create managed random resources, and used `outputs.tf` to show values after apply.

The command sequence matters. `terraform fmt` keeps code style consistent. `terraform init` prepares the working directory and installs providers. `terraform validate` catches configuration problems. `terraform plan` shows the proposed change. `terraform apply` performs the change only after confirmation. `terraform output` and `terraform state list` help verify the result. `terraform destroy` removes the lab resources.

The safety habit matters even more than the specific random resources. The plan step is where you slow down and compare Terraform's proposed action with your intent. If the plan says create two random resources in a local lab, apply is reasonable. If a future plan says delete a production database, change a security group, or create resources in the wrong account, the right move is to stop and investigate.

The Git rules finish the workflow. Commit the `.tf` files and `.terraform.lock.hcl`. Ignore `.terraform/`, local state files, saved plan files, crash logs, local CLI config, and local override files. In real team repos, use a protected remote backend for shared state so the repository stores configuration while the backend stores state.

## What's Next
<!-- section-summary: The next Terraform foundation step explains providers, provider versions, and the lock file that init writes. -->

You now have the core hands-on loop. You can create a folder, write small Terraform files, initialize providers, read a plan, apply carefully, verify the result, destroy the lab, and keep Git clean.

The next Terraform foundation topic explains providers, version constraints, provider source addresses, and `.terraform.lock.hcl`. That is the piece that makes `terraform init` more than a setup command. It is where Terraform chooses the provider packages your team will run.

---

**References**

- [Install Terraform](https://developer.hashicorp.com/terraform/install) - Official install instructions for supported operating systems and release channels.
- [Terraform CLI commands](https://developer.hashicorp.com/terraform/cli/commands) - Overview of Terraform CLI subcommands and the main workflow commands.
- [terraform fmt](https://developer.hashicorp.com/terraform/cli/commands/fmt) - Command reference for formatting Terraform configuration files.
- [terraform init](https://developer.hashicorp.com/terraform/cli/commands/init) - Command reference for initializing a Terraform working directory.
- [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate) - Command reference for checking whether a configuration is valid.
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Command reference for previewing changes required by the current configuration.
- [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply) - Command reference for applying configuration changes.
- [terraform destroy](https://developer.hashicorp.com/terraform/cli/commands/destroy) - Command reference for destroying previously created infrastructure.
- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements) - Official language reference for declaring provider source addresses and version constraints.
- [Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Official language reference for `.terraform.lock.hcl` and provider dependency selections.
