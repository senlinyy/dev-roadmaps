---
title: "Manipulating State"
description: "Learn how to safely rename, move, import, and remove Terraform state records without corrupting your infrastructure or causing unintended replacements."
overview: "Sometimes Terraform's view of the world needs manual correction — a resource was renamed in code, moved into a module, deleted outside of Terraform, or needs to be brought under management. This article covers the common state manipulation commands and when to use each one."
tags: ["state", "terraform state", "import", "mv", "rm", "terraform"]
order: 4
id: article-iac-terraform-state-manipulating
---

## Table of Contents

1. [When You Need to Manipulate State](#when-you-need-to-manipulate-state)
2. [Viewing State: terraform state list and show](#viewing-state-terraform-state-list-and-show)
3. [Moving Resources: terraform state mv](#moving-resources-terraform-state-mv)
4. [Removing Records: terraform state rm](#removing-records-terraform-state-rm)
5. [Importing Existing Resources: terraform import](#importing-existing-resources-terraform-import)
6. [The Moved Block: Renaming Without State Commands](#the-moved-block-renaming-without-state-commands)
7. [Pulling and Pushing State Manually](#pulling-and-pushing-state-manually)
8. [State Manipulation and Team Safety](#state-manipulation-and-team-safety)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## When You Need to Manipulate State

Most of the time, you do not touch the state file directly. You write configuration, run `terraform plan`, review the output, and run `terraform apply`. Terraform manages the state file automatically.

But there are situations where Terraform's automatic state management is not enough. You rename a resource in your configuration and Terraform thinks you deleted the old one and want to create a new one — proposing to destroy and replace perfectly good infrastructure. You move a resource into a module and the same problem occurs. A colleague deleted an EC2 instance directly from the AWS console and now the state file has a stale record. A new project inherits ten years of hand-built infrastructure that has never been managed by Terraform and you need to bring it under control without destroying and recreating it.

All of these situations require you to manipulate the state file directly — not by editing the JSON (which you should never do), but by using Terraform's dedicated state commands. These commands understand the state file's internal structure and make changes safely, updating related records and checksums as needed.

## Viewing State: terraform state list and show

Before making any changes to state, understand what is in it.

`terraform state list` prints the address of every resource currently tracked in state:

```bash
$ terraform state list
aws_vpc.main
aws_subnet.web
aws_subnet.db
aws_security_group.app
aws_instance.app_server
module.database.aws_db_instance.main
module.database.aws_db_subnet_group.main
```

Each line is a resource address — the combination of type, name, and module path that uniquely identifies a resource in the state file. Module resources show the full path including the module name.

`terraform state show` displays all stored attributes of a specific resource:

```bash
$ terraform state show aws_instance.app_server
# aws_instance.app_server:
resource "aws_instance" "app_server" {
    ami                          = "ami-0c55b159cbfafe1f0"
    arn                          = "arn:aws:ec2:us-east-1:123456789012:instance/i-0a1b2c3d4e5f6789"
    id                           = "i-0a1b2c3d4e5f6789"
    instance_type                = "t3.small"
    private_ip                   = "10.0.1.45"
    public_ip                    = "54.123.45.67"
    subnet_id                    = "subnet-0abc123def456789"
    ...
}
```

This output shows every attribute Terraform knows about, including computed ones like `arn`, `private_ip`, and `public_ip` that were not in your original configuration. Use `state show` before import operations to understand what attributes Terraform expects to see for a given resource type.

## Moving Resources: terraform state mv

When you rename a resource in your configuration code, Terraform sees a delete and a create — the old name disappears and a new name appears. For stateless things like IAM policy documents or local files, that is fine. For real infrastructure like running EC2 instances, RDS databases, or managed DNS zones, destroy-and-recreate causes downtime and data loss.

![State move and import commands change Terraform addresses while preserving the link to real resources.](/content-assets/articles/article-iac-terraform-state-manipulating/state-move-import-path.png)

The `terraform state mv` command renames a record in state to match the new name in your configuration. It takes two arguments: the current state address and the new state address.

Suppose you rename `aws_instance.app_server` to `aws_instance.web_server` in your configuration. Before running `terraform plan`, run:

```bash
terraform state mv aws_instance.app_server aws_instance.web_server
```

Now the state file tracks the same real EC2 instance (same `i-0a1b2c3d4e5f6789` ID) under the new name. When you run `terraform plan`, Terraform sees that `aws_instance.web_server` already exists in state with the current attributes. The plan shows no changes instead of a destroy-and-create.

The same command handles moving a resource into a module. If you refactor your configuration to move the EC2 instance into a module called `compute`, the new state address is `module.compute.aws_instance.web_server`:

```bash
terraform state mv aws_instance.web_server module.compute.aws_instance.web_server
```

After this, the state file tracks the same real instance under its new module-scoped address. `terraform plan` sees it in its correct location and proposes no changes.

`terraform state mv` can also move resources between state files using its source and destination state options, but this is an advanced operation. Both configurations need careful locking, backups, and a clean plan afterward. For many teams, the safer path is to remove the object from one state and import it into the other configuration, because that makes ownership boundaries explicit.

## Removing Records: terraform state rm

`terraform state rm` deletes a resource record from the state file without touching the real resource. After removing a record, Terraform no longer manages that resource — the real resource continues running, but Terraform has forgotten about it.

This is useful in two situations.

The first is when you want to stop managing a resource with Terraform. Perhaps a legacy database was imported into Terraform management a year ago, but the team has decided to manage it through a different system going forward. You remove the resource block from your configuration and also remove the state record:

```bash
terraform state rm module.database.aws_db_instance.main
```

The database keeps running. Terraform will never touch it again. You are responsible for managing it through whatever new system you choose.

The second situation is recovery from a resource that was deleted outside of Terraform. If a colleague manually deleted an S3 bucket that Terraform tracks, the state file still has a record for it. The next `terraform plan` detects that the bucket no longer exists and proposes to create it. If you do not want Terraform to recreate it, remove the state record:

```bash
terraform state rm aws_s3_bucket.old_uploads
```

Also remove the corresponding resource block from your configuration. Now Terraform neither tracks the bucket nor proposes to create it.

Be careful with `state rm`. After removing a record, Terraform treats that resource as non-existent. If the resource block is still in your configuration, the next `terraform plan` will propose to create a new resource — which might collide with the existing (untracked) one. Remove the resource block from configuration at the same time you remove the state record.

## Importing Existing Resources: terraform import

`terraform import` is the opposite of `state rm`. It takes a resource that already exists in the cloud and adds a record for it to the state file, bringing it under Terraform management.

The most common scenario is inheriting infrastructure. An organization has been running in AWS for years with servers, databases, and networks built manually or through custom scripts. They decide to adopt Terraform and want to manage their existing infrastructure without destroying and recreating it.

To import an existing EC2 instance, you first write the resource block in your configuration — describing what you know about it:

```hcl
resource "aws_instance" "legacy_api_server" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.medium"
}
```

Then import it by providing its real AWS ID:

```bash
terraform import aws_instance.legacy_api_server i-0a1b2c3d4e5f6789
```

Terraform contacts AWS, retrieves all current attributes of that instance, and writes a state record that maps `aws_instance.legacy_api_server` to `i-0a1b2c3d4e5f6789`. It does not modify the running instance.

After importing, run `terraform plan`. The plan will likely show differences — your resource block only specified two attributes, but the real instance has dozens. The plan will propose to remove tags, change security groups, or modify other settings to match the sparse configuration you wrote.

This is the hardest part of importing: writing a configuration block that matches what already exists closely enough that the plan shows no changes. You need to look at `terraform state show aws_instance.legacy_api_server` after the import and compare the stored attributes against your resource block. Add the attributes that differ until the plan is clean.

For large numbers of resources, this process is tedious. Current Terraform supports `import` blocks that can be placed inside configuration files and processed during plan. Terraform can also generate draft configuration for import targets with `terraform plan -generate-config-out=generated.tf` when import blocks are present, which dramatically speeds up bulk imports. Treat generated configuration as a starting point: review it, simplify it, and run a plan until the result is clean.

On Azure, Microsoft also provides Azure Export for Terraform, which can discover existing Azure resources and generate Terraform configuration and state import scaffolding. It is especially useful when an Azure environment was built manually and you want a first draft before refining the code into maintainable modules.

## The Moved Block: Renaming Without State Commands

The `moved` block is a cleaner alternative to `terraform state mv` when you rename or move resources as part of a configuration change that will be reviewed in a pull request.

Instead of running a manual state command, you add a `moved` block to your configuration that documents the rename:

```hcl
moved {
  from = aws_instance.app_server
  to   = aws_instance.web_server
}
```

When Terraform processes this block during `terraform plan`, it automatically updates the state mapping — effectively doing what `terraform state mv` would have done — and then shows no replacement in the plan. The `moved` block is processed alongside the configuration, so the rename is atomic with the rest of the change.

The `moved` block has a significant advantage over the state command: it is in the configuration file, visible in code review, and tracked in Git history. When someone looks at the history of the configuration six months later and wonders why there is no `aws_instance.app_server` resource, they can find the `moved` block that explains the rename.

For module moves, the syntax is the same:

```hcl
moved {
  from = aws_instance.web_server
  to   = module.compute.aws_instance.web_server
}
```

You can delete the `moved` block once the rename has been applied and is stable — once every environment that uses this configuration has been updated. Keeping `moved` blocks around permanently is fine for documentation but is not required for correctness.

## Pulling and Pushing State Manually

For advanced operations — transferring state between backends, restoring a previous version, or applying repairs that the standard commands cannot handle — you can work with the raw state JSON using `terraform state pull` and `terraform state push`.

`terraform state pull` downloads the current state from wherever the backend stores it and prints it to standard output:

```bash
terraform state pull > state_backup.json
```

This gives you a local copy of the current state. You can inspect it, diff it against an older version, or archive it as a backup.

`terraform state push` uploads a local state file to the backend, replacing the current one:

```bash
terraform state push state_backup.json
```

This is how you restore a previous state version. You download the version from S3 (using the AWS CLI to retrieve a specific version ID), verify it looks correct, and push it back as the current state.

`push` has a safety check: it compares the serial number in the file you are pushing against the serial number in the current backend state. If the current state is newer than what you are pushing, Terraform warns you and refuses unless you add the `-force` flag. The `-force` flag bypasses this check. Use it only when you are certain you want to overwrite the current state — for example, when restoring to a known-good version after a corrupted apply.

## State Manipulation and Team Safety

All state manipulation commands work on the live state file, which means they require the same care as a production `terraform apply`. Before running any state command:

![State manipulation needs guardrails: backup, lock, review, small changes, and verification.](/content-assets/articles/article-iac-terraform-state-manipulating/state-surgery-guardrails.png)

Communicate with your team. If a colleague is in the middle of an apply or about to start one, your state command can conflict with their operation or leave state in an unexpected condition.

Work in a low-traffic window. State manipulation on production infrastructure is best done when automated pipelines are paused and other engineers are not actively deploying.

Make a backup first. Run `terraform state pull > state_backup_$(date +%Y%m%d_%H%M%S).json` before any destructive operation. If something goes wrong, you have a local copy to restore from.

Verify with `terraform plan` after every state command. The plan is your confirmation that the state now reflects what you intended. A clean plan — one that proposes no unexpected changes — means the state is consistent with your configuration and with reality.

## Putting It All Together

State manipulation commands are the tools you reach for when Terraform's automatic state management does not cover a situation. Renaming a resource uses `state mv` or a `moved` block. Removing a record for something you no longer want Terraform to manage uses `state rm`. Bringing existing cloud resources under Terraform control uses `terraform import`. Viewing what is in state before taking action uses `state list` and `state show`.

The common thread is that these commands modify the state file in a controlled, structured way — they understand the file's format and consistency requirements. They are safer than editing the JSON by hand, but they still require care and communication in team environments.

## What's Next

With state management covered, the next articles shift to the values layer: how you parameterize your configurations using input variables, local values, and outputs. These are the tools that make the same configuration files usable across different environments and teams without copying code.


![State manipulation summary: inspect first, move addresses carefully, import existing resources, and verify with a plan.](/content-assets/articles/article-iac-terraform-state-manipulating/state-manipulation-summary.png)

---

**References**

- [Command: state mv (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/commands/state/mv) — Full reference for the `terraform state mv` command.
- [Command: state rm (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/commands/state/rm) — Reference for removing resource records from state.
- [Command: import (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/commands/import) — Reference for the `terraform import` command and the newer `import` block syntax.
- [Refactoring (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring) — Documentation for the `moved` block and how it handles resource address changes safely.
- [Import Existing Resources (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/import) — Configuration-driven import blocks and generated configuration workflow.
- [Azure Export for Terraform Overview (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/azure-export-for-terraform/export-terraform-overview) — Microsoft tool for exporting existing Azure resources into Terraform-friendly artifacts.
