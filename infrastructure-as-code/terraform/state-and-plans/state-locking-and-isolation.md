---
title: "State Locking and Isolation"
description: "Prevent concurrent state corruption and isolate each environment's state so a change in development can never affect production."
overview: "Two engineers running terraform apply at the same time against the same state file will corrupt it. State locking prevents this. But even with locking, putting all environments in one state file creates risk. This article covers how locking works and the two main strategies for keeping each environment's state completely separate."
tags: ["state", "locking", "isolation", "workspaces", "terraform"]
order: 3
id: article-iac-terraform-state-locking-isolation
---

## Table of Contents

1. [The Concurrent Apply Problem](#the-concurrent-apply-problem)
2. [How State Locking Works](#how-state-locking-works)
3. [What Happens When a Lock Is Stuck](#what-happens-when-a-lock-is-stuck)
4. [Why Environments Need Separate State](#why-environments-need-separate-state)
5. [Isolation Strategy One: Separate State Files in One Bucket](#isolation-strategy-one-separate-state-files-in-one-bucket)
6. [Isolation Strategy Two: Separate Directories With Separate Backends](#isolation-strategy-two-separate-directories-with-separate-backends)
7. [Isolation Strategy Three: Terraform Workspaces](#isolation-strategy-three-terraform-workspaces)
8. [Comparing the Three Approaches](#comparing-the-three-approaches)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Concurrent Apply Problem

State locking is Terraform's concurrency guard that prevents two runs from writing the same state file at the same time.

Picture a Friday afternoon. Two engineers on your platform team both notice that a security group needs a new inbound rule. They each pull the latest code from the Git repository. Both run `terraform plan` within a few minutes of each other. Both see the same expected change. Both run `terraform apply`.

Without locking, here is what happens inside Terraform. The first engineer's apply starts. Terraform reads the current state from S3, begins making API calls to AWS, and progressively updates the state file with the results. After a few minutes, the first apply finishes and writes the final updated state back to S3.

Meanwhile, the second engineer's apply also started. It also read the state from S3, but it read the version that existed before the first apply began. It started making its own API calls. When it finishes and writes the state back to S3, it overwrites the first engineer's completed state with a version that does not include any of the first apply's results. Resources the first apply created now appear missing in state. Resources the first apply modified appear to be in their pre-modification state. The two state files have merged into one corrupted record.

This is not a theoretical edge case. It happens regularly on teams that share state without locking, especially in CI/CD systems where multiple pipelines can trigger simultaneously on different branches.

## How State Locking Works

A state lock is a temporary claim on one state file. Terraform takes the lock before a state-changing operation so only one run can write that state at a time. Example: if CI is applying `prod/app/terraform.tfstate`, a second `terraform apply` for that same state must wait or fail until the first run releases the lock.

When Terraform begins any operation that might modify state, such as a plan, an apply, or a destroy, it first tries to acquire a lock. The mechanism depends on the backend.

![State locking serializes apply runs so only one writer updates the shared state at a time.](/content-assets/articles/article-iac-terraform-state-locking-isolation/lock-isolation-timeline.png)

For the current S3 backend with `use_lockfile = true`, acquiring a lock means writing a lock file next to the state object. If another process already holds the lock for that state, Terraform reports that the state is locked and identifies the operation when that information is available. Older S3 backend configurations may use DynamoDB locking instead. In that legacy pattern, Terraform writes a conditional record keyed by the state path, so only one operation can hold the lock for that state file at a time.

Once the lock is acquired, Terraform proceeds with the operation. While the lock is held, any other Terraform process that tries to start an operation against the same state will fail immediately with a message like:

```
Error: Error acquiring the state lock

Error message: state blob is already locked

Lock Info:
  ID:        abc12345-def6-7890-ghij-klmnopqrstuv
  Path:      production/app/terraform.tfstate
  Operation: OperationTypeApply
  Who:       alice@workstation
  Version:   1.6.0
  Created:   2024-01-15 14:22:31.123 UTC
  Info:
```

This message tells you exactly who is running an operation, what they are doing, and when they started. If Alice is in the middle of a legitimate apply, you wait. If Alice started an apply two hours ago and her terminal has frozen, you know there is a stuck lock.

When the operation finishes, successfully or with an error, Terraform releases the backend lock. Any process waiting to acquire the lock can then proceed.

## What Happens When a Lock Is Stuck

A stuck lock is a lock record left behind after the Terraform process that owned it stopped running. It blocks later operations because the backend cannot know by itself whether the original apply is still active. Example: a killed CI job may leave a lock for `production/app/terraform.tfstate`, and every later plan reports that state is locked.

Locks get stuck. An engineer's laptop crashes in the middle of an apply. A CI/CD job is killed abruptly. A network connection drops before Terraform can release the lock. In these cases, the lock record or lock file can remain in place, blocking every subsequent Terraform operation against that state.

You can force-unlock a stuck lock with the `terraform force-unlock` command. You need to provide the lock ID, which you can find in the error message that appears when you try to run a locked operation, or by inspecting the backend's lock metadata:

```bash
terraform force-unlock abc12345-def6-7890-ghij-klmnopqrstuv
```

Before force-unlocking, verify that the original operation is genuinely finished and not still running somewhere. Force-unlocking a lock that belongs to an active apply allows a second apply to start while the first is still running, which brings you back to the concurrent apply corruption problem.

If you are confident the original operation is dead, the process is gone, the CI job shows as failed, and the machine that ran it is unreachable, force-unlock is the recovery path. It is still a dangerous administrative action, not a normal cleanup command. Terraform will release the lock and allow the next operation to proceed, so make sure you are not letting two active writers run against the same state.

It is also worth checking whether the apply that was interrupted left the infrastructure in a partial state. Run `terraform plan` after unlocking to see what changed and what might be missing. Terraform's state refresh will detect any resources that were partially created or modified.

## Why Environments Need Separate State

Separate state means each environment has its own Terraform ownership record. This limits mistakes to the environment whose state file is being changed. Example: a failed development apply should affect `dev/app/terraform.tfstate`, not the production records in `prod/app/terraform.tfstate`.

Even with locking, storing development, staging, and production infrastructure in the same state file is dangerous.

![Separate environment state keeps dev, staging, and production changes inside smaller blast-radius boundaries.](/content-assets/articles/article-iac-terraform-state-locking-isolation/workspace-state-boundary.png)

The problem is blast radius. If something goes wrong during a Terraform operation, a bug in your configuration, a provider crash, a corrupted plan, the damage is limited to whatever state file was being modified. If all three environments share one state file, a botched apply targeting development resources could corrupt or destroy production records in the same state.

There is also a human risk. With shared state, a command run in the wrong directory can modify the wrong environment. Running `terraform destroy` while thinking you are in the development directory when you are actually in the production directory is a catastrophe. Separate state files mean that command only affects what it is supposed to affect.

Separate state also means separate plans. A production plan is clean and focused: it shows only what will change in production. It does not include dozens of development resources mixed in. This makes plans easier to review and approve.

## Isolation Strategy One: Separate State Files in One Bucket

Using separate keys in one bucket means each environment writes to a different object path. The bucket is shared, but the state records and locks are separate. Example: development can use `dev/app/terraform.tfstate`, while production uses `prod/app/terraform.tfstate`.

The simplest way to isolate environments is to give each one a different `key` in the backend configuration, while sharing the same S3 bucket.

In your CI/CD pipeline or in each environment's backend configuration:

Development:
```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "dev/app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}
```

Production:
```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "prod/app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}
```

These are two separate state files, each with its own locking. An apply in development locks `dev/app/terraform.tfstate`. An apply in production locks `prod/app/terraform.tfstate`. They do not block each other at the state level. They are not as isolated as completely different cloud accounts or subscriptions, because the same bucket, backend credentials, and IAM boundary may still be shared.

The main downside of this approach is that you need a mechanism to inject the correct key for each environment. The usual solution is partial backend configuration, leaving the key out of the backend block and passing it via `terraform init -backend-config="key=dev/app/terraform.tfstate"`.

## Isolation Strategy Two: Separate Directories With Separate Backends

Separate directories give each environment its own root configuration and backend settings. This makes the target environment visible in the filesystem path and in the backend configuration. Example: running Terraform from `infrastructure/environments/prod` uses the production backend, while `infrastructure/environments/dev` uses the development backend.

A stronger isolation strategy is to keep each environment in its own directory with its own fully specified backend configuration. The directory layout looks like:

```
infrastructure/
  modules/
    network/
    database/
    compute/
  environments/
    dev/
      main.tf
      variables.tf
      backend.tf
    staging/
      main.tf
      variables.tf
      backend.tf
    prod/
      main.tf
      variables.tf
      backend.tf
```

Each environment directory has its own `backend.tf` (or equivalent backend block inside the `terraform` block in `main.tf`) with all the configuration hardcoded for that environment. The `main.tf` in each directory calls the shared modules from `../../modules/` with environment-specific variables.

This approach makes accidental cross-environment changes almost impossible. You have to `cd` into the correct directory before running any command, and the backend configuration there points to only that environment's state. There is no mechanism by which a command in the dev directory can touch production state.

It also makes the Terraform commands very explicit. Your deploy script for production contains something like:

```bash
cd infrastructure/environments/prod
terraform init
terraform plan -out=prod.plan
terraform apply prod.plan
```

Anyone reading the script knows exactly which directory and which environment is being affected.

The downside is some duplication in the environment directories. The `main.tf` files in dev, staging, and prod are often very similar, they call the same modules with slightly different variable values. Using Terraform's `var` files or environment-specific `.tfvars` files reduces this repetition.

## Isolation Strategy Three: Terraform Workspaces

A Terraform workspace is a named state instance for the same root configuration. It lets one directory keep separate state files, but it does not automatically create separate credentials or account boundaries. Example: the `dev` and `prod` workspaces can use the same Terraform files while writing to different workspace state paths.

Terraform workspaces allow a single directory and a single backend configuration to maintain multiple independent state files. By default, every configuration runs in a workspace named `default`. You can create additional workspaces and switch between them:

```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod
terraform workspace list
terraform workspace select prod
```

When you select the `prod` workspace and run `terraform apply`, Terraform stores the state in a separate location within your backend. For the S3 backend, the state path becomes `env:/prod/production/app/terraform.tfstate` rather than the base key you specified.

Inside the configuration, you can reference the current workspace name:

```hcl
resource "aws_instance" "app" {
  instance_type = terraform.workspace == "prod" ? "t3.medium" : "t3.micro"
}
```

Workspaces seem convenient, but they have a significant limitation: they share the same backend configuration and often the same provider credential pattern. If your production and development environments live in separate AWS accounts or Azure subscriptions, workspaces do not enforce that separation by themselves. You can write provider configuration that changes by workspace, but the isolation then depends on that configuration and the credentials used by the runner, not on workspaces as a security boundary.

Workspaces also create a subtle risk: the configuration code is identical across workspaces except for where you use `terraform.workspace` conditionals. A bug in the shared configuration affects every workspace simultaneously. Testing a configuration change in the dev workspace does not fully protect production if the change touches a section that does not use workspace-conditional logic.

## Comparing the Three Approaches

Choosing an isolation strategy is choosing how strong the boundary should be between environments. Separate keys reduce state collisions, separate directories make the target environment explicit, and workspaces keep code duplication low but rely on careful provider configuration. Example: a production system in a separate AWS account usually deserves a separate directory and backend, while a short-lived branch test may fit a workspace.

| Approach | Credential or account boundary | Code duplication | Accidental cross-env risk | Best for |
| :--- | :--- | :--- | :--- | :--- |
| Different keys, same bucket | Possible, but shared backend access is common | Low | Moderate | Small teams, same account or subscription |
| Separate directories | Natural to separate accounts, subscriptions, and credentials | Moderate | Very low | Teams needing strong isolation |
| Workspaces | Not enforced by workspaces themselves | Very low | Moderate | Non-production or same-boundary setups |

For most organizations that take security seriously, separate directories with separate backends, and ideally separate AWS accounts with separate IAM roles, is the right answer. It requires slightly more code, but it gives you the strongest isolation guarantees.

Workspaces are most useful in early-stage projects, same-boundary deployments, or short-lived environments, spinning up a new workspace per Git branch, for example, to test a feature branch's infrastructure before merging. Terraform's own CLI workspace guidance warns against using workspaces alone for deployments that need separate credentials and access controls.

## Putting It All Together

State locking is what makes remote state safe for teams. The backend's locking mechanism, such as S3 lock files, legacy DynamoDB locks, Azure Blob leases, or HCP Terraform locks, ensures only one Terraform process holds the lock for a state at any given moment. Force-unlock is the escape hatch when locks get stuck, but it requires judgment: only use it when you are certain the original operation is truly finished.

Environment isolation determines the blast radius of mistakes. Separate state files, whether through different keys, different directories, or different workspaces, mean that a corrupted or destroyed state file only affects one environment. For teams where production availability is critical, separate directories with fully independent backends (and ideally separate cloud accounts) provide the strongest guarantee that development operations can never reach production resources.

## What's Next

Even with locking and isolation in place, you will eventually need to make direct changes to the state file, renaming a resource, moving it into a module, removing a record for a resource that was deleted outside of Terraform. The next article covers the commands for safely manipulating state without causing corruption.


![State locking and isolation summary: one writer at a time, safe waiting, and separate environment state.](/content-assets/articles/article-iac-terraform-state-locking-isolation/locking-isolation-summary.png)

---

**References**

- [State Locking (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/locking), Reference for how locking works and the force-unlock command.
- [Workspaces (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/workspaces), Full reference for Terraform workspaces and their limitations.
- [CLI Workspaces (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/workspaces), Official guidance on when CLI workspaces are and are not appropriate.
- [S3 Backend (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/settings/backends/s3), Official S3 backend arguments, including current lockfile support and legacy DynamoDB locking.
- [Store Terraform State in Azure Storage (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/store-state-in-azure-storage), Microsoft guidance for Azure Storage-backed Terraform state.
- [Lease Blob (Azure Storage REST API)](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob), Official Azure Blob lease behavior used for locking.
