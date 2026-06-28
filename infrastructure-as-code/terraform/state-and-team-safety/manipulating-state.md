---
title: "Manipulating State"
description: "Safe Terraform state renames, moves, imports, and removals without corrupting infrastructure or causing unintended replacements."
overview: "State manipulation changes Terraform's record of which address manages which real object. This article turns one bucket rename into a careful runbook for moved blocks, imports, removals, direct state commands, and plan evidence."
tags: ["state", "terraform state", "import", "mv", "rm", "terraform"]
order: 3
id: article-iac-terraform-state-manipulating
aliases:
  - infrastructure-as-code/terraform/state-and-plans/manipulating-state.md
---

## Table of Contents

1. [Why State Surgery Exists](#why-state-surgery-exists)
2. [Renaming a Resource with a moved Block](#renaming-a-resource-with-a-moved-block)
3. [Importing an Existing Object](#importing-an-existing-object)
4. [Removing an Object from State Without Destroying It](#removing-an-object-from-state-without-destroying-it)
5. [Using terraform state Commands Carefully](#using-terraform-state-commands-carefully)
6. [A Safe Runbook](#a-safe-runbook)
7. [Putting It All Together](#putting-it-all-together)

This article assumes the state target is already understood and protected. The team has a backend, a lock, and separate state records for environments. Now the work is more advanced: changing Terraform's address-to-object bindings without accidentally deleting, recreating, or forgetting the wrong infrastructure.

## Why State Surgery Exists
<!-- section-summary: State manipulation changes Terraform's address-to-object bindings, so every change needs a plan that proves the real infrastructure stays safe. -->

The billing log bucket has been running for a while. The resource address started as `aws_s3_bucket.logs`, which worked while there was one bucket. Now the team has application logs, audit logs, and export buckets. The name `logs` is too vague.

Changing the Terraform resource label looks harmless:

```hcl
resource "aws_s3_bucket" "<new_local_name>" {
  bucket = "existing-real-bucket-name"
}
```

The resource type stays the same. The local name changes, and the bucket argument still points at the existing real bucket. For the billing logs bucket, the new address looks like this:

```hcl
resource "aws_s3_bucket" "service_logs" {
  bucket = "dp-billing-prod-logs"
}
```

Terraform state still has the old address, `aws_s3_bucket.logs`. If Terraform sees the new address with no instruction, it can plan one deletion and one creation. The real bucket stayed in place while the address-to-object binding changed.

**State manipulation** is controlled maintenance on that binding. It applies to resource renames, module moves, imports of existing objects, and handoffs where Terraform stops managing an object while leaving it in place. The goal is always the same: the plan should prove that Terraform's record changed in the intended way.

The safest state changes keep configuration and state moving together. If the code says a bucket moved into `module.log_bucket`, the state should show the same address move. If the code says Terraform should adopt an existing audit bucket, the state should gain one binding for that bucket. The plan is the receipt for that work.

## Renaming a Resource with a moved Block
<!-- section-summary: A moved block tells Terraform that an existing state binding has a new address, so a code rename plans as a move instead of a destroy and create. -->

Modern Terraform gives you a configuration-driven way to record a rename. The new resource block stays in code, and a `moved` block records the old and new addresses:

```hcl
resource "aws_s3_bucket" "service_logs" {
  bucket = "dp-billing-prod-logs"
}

moved {
  from = aws_s3_bucket.logs
  to   = aws_s3_bucket.service_logs
}
```

The `moved` block says that the object previously managed at `aws_s3_bucket.logs` should now be managed at `aws_s3_bucket.service_logs`. The change is reviewable because it lives in code with the rename.

The plan should show the move:

```console
  # aws_s3_bucket.logs has moved to aws_s3_bucket.service_logs
    resource "aws_s3_bucket" "service_logs" {
        bucket = "dp-billing-prod-logs"
        id     = "dp-billing-prod-logs"
    }

Plan: 0 to add, 0 to change, 0 to destroy.
```

That last line is the evidence reviewers want. The state address changes, and the real bucket stays in place. For module refactors, the same pattern works with module paths, such as moving `aws_s3_bucket.service_logs` to `module.log_bucket.aws_s3_bucket.this`.

Teams usually keep moved blocks in version control long enough for every active environment to apply the refactor. Development, staging, and production may apply on different days. If the block disappears before production applies, production may see the rename as a new address with no move instruction.

For a larger module refactor, the move list should be clear before plan review:

```hcl
moved {
  from = aws_s3_bucket.service_logs
  to   = module.log_bucket.aws_s3_bucket.this
}

moved {
  from = aws_s3_bucket_public_access_block.service_logs
  to   = module.log_bucket.aws_s3_bucket_public_access_block.this
}
```

The plan should contain the same set of moves and no surprise destroys. That comparison gives reviewers a simple way to check a refactor without reading every module file first.

## Importing an Existing Object
<!-- section-summary: Importing creates a state binding for an object that already exists, then the configuration must match the real object closely enough for a clean plan. -->

Sometimes the real object already exists because someone created it before Terraform. A common example is an audit bucket created during an incident. The team now wants Terraform to manage it.

![State Move Import Path](/content-assets/articles/article-iac-terraform-state-manipulating/state-move-import-path.png)

*The move and import path shows how Terraform ownership changes should pass through explicit, reviewed steps.*

Import has two parts. First, write the resource block close to the real object:

```hcl
resource "aws_s3_bucket" "audit_archive" {
  bucket = "company-audit-archive-prod"

  tags = {
    environment = "prod"
    service     = "audit"
    managed_by  = "terraform"
  }
}
```

Then declare the import:

```hcl
import {
  to = aws_s3_bucket.audit_archive
  id = "company-audit-archive-prod"
}
```

A plan then shows the import intent:

```console
  # aws_s3_bucket.audit_archive will be imported
    resource "aws_s3_bucket" "audit_archive" {
        bucket = "company-audit-archive-prod"
        id     = "company-audit-archive-prod"
    }

Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.
```

After the import apply, a second normal plan tells you whether the configuration matches the existing object. It may propose adding missing tags or changing settings. Those changes deserve normal infrastructure review because after import Terraform will enforce the configuration you wrote.

For important resources, a dedicated pull request keeps the import review focused. The pull request should include the resource block, import block, backend target, and plan output so reviewers can see that Terraform is adopting the object.

Older workflows used the CLI form:

```bash
terraform import aws_s3_bucket.audit_archive company-audit-archive-prod
```

```console
aws_s3_bucket.audit_archive: Importing from ID "company-audit-archive-prod"...
aws_s3_bucket.audit_archive: Import prepared!
  Prepared aws_s3_bucket for import
aws_s3_bucket.audit_archive: Import complete!
```

The first argument is the Terraform address that will own the object. The second argument is the provider import ID, which is the existing bucket name for this S3 example. After a successful import, the next plan should be small and explain only real configuration differences.

That command still works, and it can help during recovery. The configuration-driven `import` block gives reviewers a clearer record because the intended import lives beside the resource code. After a successful import and clean follow-up plan, many teams remove the import block in a later cleanup because the state binding already exists.

Import recovery usually fails in one of two ways. If the provider says the object cannot be found, the provider account, region, partition, and import ID format need review. If the follow-up plan wants large changes, the resource block should match the existing object more closely before any apply.

## Removing an Object from State Without Destroying It
<!-- section-summary: A removed block can tell Terraform to stop managing an object while leaving the real infrastructure in place. -->

State removal is useful for a Terraform-owned object that should stay alive after Terraform forgets it. The team may move a DNS zone to another stack, hand a bucket to a different platform team, or retire Terraform management for a legacy object. Current Terraform documentation describes this configuration-driven workflow with a `removed` block and a `lifecycle` rule.

A `removed` block with `destroy = false` records that intent in configuration:

```hcl
removed {
  from = aws_s3_bucket.legacy_reports

  lifecycle {
    destroy = false
  }
}
```

The plan should say that Terraform will stop managing the object while leaving it in place:

```console
  # aws_s3_bucket.legacy_reports will no longer be managed by Terraform, but will not be destroyed
  . resource "aws_s3_bucket" "legacy_reports" {
      . bucket = "legacy-reports-prod"
    }

Plan: 0 to add, 0 to change, 0 to destroy.
```

The output proves Terraform will remove the state binding without deleting the remote bucket. The plan summary stays at zero creates, changes, and destroys because the infrastructure object is intentionally left in place.

This is safer than deleting the resource block and hoping every reviewer notices the intent. The configuration records the decision, and the plan proves that Terraform will remove only the state binding.

State removal has a clear consequence: Terraform forgets the object. Future plans from this root will ignore drift on that object, and Terraform will no longer destroy it during stack teardown. Another stack, team, or manual runbook needs to own the object afterward. If another Terraform root will manage it, the handoff should include an import there before or during the removal so ownership stays visible.

## Using terraform state Commands Carefully
<!-- section-summary: CLI state commands are useful recovery tools, but configuration-driven moves and imports usually leave a clearer review record. -->

Terraform still includes direct state commands:

```bash
terraform state list
terraform state show aws_s3_bucket.logs
terraform state mv aws_s3_bucket.logs aws_s3_bucket.service_logs
terraform state rm aws_s3_bucket.legacy_reports
```

The first two commands are read-only inspection: list the tracked addresses, then show one address. Their output gives the team evidence before changing anything:

```console
$ terraform state list
aws_s3_bucket.logs
aws_s3_bucket_lifecycle_configuration.logs
aws_s3_bucket_public_access_block.logs

$ terraform state show aws_s3_bucket.logs
# aws_s3_bucket.logs:
resource "aws_s3_bucket" "logs" {
    bucket = "dp-billing-prod-logs"
    id     = "dp-billing-prod-logs"
    tags   = {
        "environment" = "prod"
        "service"     = "billing"
    }
}
```

The address list shows which objects this state currently manages. The `state show` output connects one address to one provider ID and selected attributes. Reviewers use that evidence to confirm the source address before a move or removal.

The last two commands mutate state: `mv` changes an address binding, and `rm` removes a binding without destroying the remote object. They can help during emergency recovery, older Terraform workflows, or a controlled migration where configuration-driven blocks are awkward. They also leave less review evidence unless the team records exactly what happened.

For a direct move, the output should name the source and destination:

```console
$ terraform state mv aws_s3_bucket.logs aws_s3_bucket.service_logs
Move "aws_s3_bucket.logs" to "aws_s3_bucket.service_logs"
Successfully moved 1 object(s).
```

For a direct removal, the output should name the forgotten address:

```console
$ terraform state rm aws_s3_bucket.legacy_reports
Removed aws_s3_bucket.legacy_reports
Successfully removed 1 resource instance(s).
```

Those messages only confirm that Terraform changed the state record. The next `terraform plan` proves whether the state edit matches the configuration and leaves the real infrastructure in the intended shape.

Before a direct state edit, the change record should confirm the backend key, workspace, provider account, region, and variable file. The state lock should belong to the current run. The recovery path should be either a required backup or confirmed backend versioning. The operation should stay as small as possible, and the command output should be saved.

After the command, `terraform plan` is the proof that the state edit had the intended result. Surprising creates, replacements, or destroys mean the team should pause and investigate before applying any infrastructure change.

Direct state commands are best as single-purpose operations. For example, one `terraform state mv` should cover one address move, followed by a plan. If ten moves are needed, the scripted command list should be reviewed source by source and destination by destination before it runs.

Address mistakes are recoverable only with evidence. `terraform state list` before and after the edit, backend object versioning, and a saved state backup give the team a route back. Without those, the team may have to reconstruct bindings by importing objects one by one.

## A Safe Runbook
<!-- section-summary: The safest state changes are small, backed up, planned, and proven by plan output. -->

State work deserves a runbook because the command can be small and the blast radius can be large. A practical runbook answers these questions before anyone edits state:

![State Surgery Guardrails](/content-assets/articles/article-iac-terraform-state-manipulating/state-surgery-guardrails.png)

*The guardrail view shows the checks that belong around direct state operations: target, lock, backup, command, and follow-up plan.*

1. Which Terraform address is changing?
2. Which real provider object does that address manage?
3. Is the action a move, import, forget, or direct state edit?
4. Which backend key, workspace, account, and variable file are in use?
5. Is there a backend version, backup, or recovery path?
6. What exact plan output proves the change is safe?

The review should stay narrow. One state move has a smaller review surface than a state move plus a module upgrade plus a provider upgrade. If a refactor needs several moves, list them clearly and compare the plan against that list.

State manipulation should also happen during a quiet window for important stacks. No other apply should race against the same state while the address map changes.

If a state change goes wrong, the first corrective plan should not be applied in a hurry. Applies should pause, the current state version should be preserved, and the team should identify whether the mistake changed only Terraform's record or also changed cloud infrastructure. A wrong `state rm` may need an import. A wrong `state mv` may need another move back to the original address. A wrong apply may need provider-specific recovery before Terraform state can be trusted again.

## Putting It All Together
<!-- section-summary: State manipulation is safe after Terraform's record changes in the exact way the team intended and the plan proves it. -->

State manipulation is maintenance on Terraform's address-to-object map. `moved`, `import`, and `removed` blocks keep the intent in configuration for the workflows they support. Direct `terraform state` commands need a backup, a lock, and a plan review.

![State Manipulation Summary](/content-assets/articles/article-iac-terraform-state-manipulating/state-manipulation-summary.png)

*The summary board separates normal refactors from state surgery and shows which tool fits each case.*

The plan decides whether the operation is safe. A rename should show a move. An import should show an import and then a clean or understood follow-up plan. A removal with `destroy = false` should leave real infrastructure in place.

---

**References**

- [Terraform: Moved block](https://developer.hashicorp.com/terraform/language/block/moved) - Documents configuration-driven address moves for refactors.
- [Terraform: Import blocks](https://developer.hashicorp.com/terraform/language/import) - Documents declarative imports and the `import` block workflow.
- [Terraform: Removed block](https://developer.hashicorp.com/terraform/language/block/removed) - Documents removing a resource from Terraform management while controlling destroy behavior.
- [Terraform: Remove resources from state](https://developer.hashicorp.com/terraform/language/state/remove) - Explains state removal and how Terraform treats forgotten objects.
- [Terraform CLI: state](https://developer.hashicorp.com/terraform/cli/commands/state) - Documents direct state subcommands such as `list`, `show`, `mv`, and `rm`.
- [Terraform CLI: state rm](https://developer.hashicorp.com/terraform/cli/commands/state/rm) - Documents the direct CLI command for removing bindings from state.
