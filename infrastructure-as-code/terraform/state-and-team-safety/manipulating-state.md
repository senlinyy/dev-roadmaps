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

1. [What Does State Manipulation Change?](#what-does-state-manipulation-change)
2. [How Does a moved Block Preserve Identity?](#how-does-a-moved-block-preserve-identity)
3. [How Does Import Adopt an Existing Object?](#how-does-import-adopt-an-existing-object)
4. [How Does Terraform Relinquish Ownership Without Destroying?](#how-does-terraform-relinquish-ownership-without-destroying)
5. [How Should You Use Direct State Commands?](#how-should-you-use-direct-state-commands)
6. [How Do You Hand an Object Between States?](#how-do-you-hand-an-object-between-states)
7. [What Makes a State Change Safe?](#what-makes-a-state-change-safe)
8. [How Do the State Operations Fit Together?](#how-do-the-state-operations-fit-together)
9. [Check Your Answers](#check-your-answers)

Assume the state target is already understood and protected. The team has a backend, a lock, and separate state records for environments. The advanced task is changing Terraform's address-to-object bindings without accidentally deleting, recreating, forgetting, or double-owning infrastructure.

Suppose Terraform already manages an S3 bucket at `aws_s3_bucket.logs`. The label worked initially, but the configuration now needs the clearer address `aws_s3_bucket.archive`. A human sees one bucket with a better local name; Terraform sees two different logical addresses.

Changing the Terraform resource label looks harmless:

```hcl
resource "aws_s3_bucket" "<new_local_name>" {
  bucket = "existing-real-bucket-name"
}
```

The resource type stays the same. The local name changes, and the bucket argument still points at the existing real bucket:

```hcl
resource "aws_s3_bucket" "archive" {
  bucket = "company-logs"
}
```

Terraform state still has the old address, `aws_s3_bucket.logs`. If Terraform sees the new address with no instruction, it can plan one deletion and one creation. The real bucket stayed in place while the address-to-object binding changed.

Keep these questions in view as you work through the lesson:

1. **What Does State Manipulation Change?**
2. **How Does a `moved` Block Preserve Identity?**
3. **How Does Import Adopt an Existing Object?**
4. **How Does Terraform Relinquish Ownership Without Destroying?**
5. **How Should You Use Direct State Commands?**
6. **How Do You Hand an Object Between States?**
7. **What Makes a State Change Safe?**
8. **How Do the State Operations Fit Together?**

## What Does State Manipulation Change?
<!-- section-summary: State manipulation changes Terraform's address-to-object bindings, so every change needs a plan that proves the real infrastructure stays safe. -->

**State manipulation** is controlled maintenance on that binding. It applies to resource renames, module moves, imports of existing objects, and handoffs where Terraform stops managing an object while leaving it in place. The goal is always the same: the plan should prove that Terraform's record changed in the intended way.

The safest state changes keep configuration and state moving together. If the code says a bucket moved into `module.log_bucket`, the state should show the same address move. If the code says Terraform should adopt an existing audit bucket, the state should gain one binding for that bucket. The plan is the receipt for that work.

The fundamental invariant is one Terraform resource instance bound to one remote object. Configuration, state, and reality are independent parts of that relationship:

```text
configuration: resource "aws_instance" "web" { ... }
state:         aws_instance.web ↔ i-0123456789
reality:       EC2 instance i-0123456789 exists
```

Normal plan and apply operations maintain the binding while changing desired or remote state. State manipulation changes the binding itself. When you import, move, or forget an object, you temporarily take responsibility for preserving the one-to-one relationship that Terraform usually maintains automatically.

Modern Terraform can describe the three common transitions in configuration. A `moved` block changes an address, an `import` block adopts an existing object, and a `removed` block ends ownership without destroying the object. These mechanisms pass through plan, review, and apply. Direct CLI state commands remain useful, but they mutate Terraform's ownership database immediately and therefore require stronger operational care.

## How Does a `moved` Block Preserve Identity?
<!-- section-summary: A moved block tells Terraform that an existing state binding has a new address, so a code rename plans as a move instead of a destroy and create. -->

Modern Terraform gives you a configuration-driven way to record a rename. The new resource block stays in code, and a `moved` block records the old and new addresses:

```hcl
resource "aws_s3_bucket" "archive" {
  bucket = "company-logs"
}

moved {
  from = aws_s3_bucket.logs
  to   = aws_s3_bucket.archive
}
```

The `moved` block says that the object previously managed at `aws_s3_bucket.logs` should now be managed at `aws_s3_bucket.archive`. The change is reviewable because it lives in code with the rename.

The plan should show the move:

```console
  # aws_s3_bucket.logs has moved to aws_s3_bucket.archive
    resource "aws_s3_bucket" "archive" {
        bucket = "company-logs"
        id     = "company-logs"
    }

Plan: 0 to add, 0 to change, 0 to destroy.
```

That last line is the evidence reviewers want. The state address changes, and the real bucket stays in place. For module refactors, the same pattern works with module paths, such as moving `aws_s3_bucket.archive` to `module.storage.aws_s3_bucket.this`.

Teams usually keep moved blocks in version control long enough for every active environment to apply the refactor. Development, staging, and production may apply on different days. If the block disappears before production applies, production may see the rename as a new address with no move instruction.

This history matters for published modules too. Different consumers upgrade on different dates, so the migration instruction must remain available to any state that still uses the old address. Removing a historical `moved` block can break consumers despite a clean current source layout.

For a larger module refactor, the move list should be clear before plan review:

```hcl
moved {
  from = aws_s3_bucket.archive
  to   = module.storage.aws_s3_bucket.this
}

moved {
  from = aws_s3_bucket_public_access_block.archive
  to   = module.storage.aws_s3_bucket_public_access_block.this
}
```

The plan should contain the same set of moves and no surprise destroys. That comparison gives reviewers a simple way to check a refactor without reading every module file first.

The lower-level equivalent is `terraform state mv SOURCE DESTINATION`. It rewrites the state address immediately while leaving the cloud object untouched. For an ordinary rename, prefer the declarative block because it documents the transition and lets every environment review it. Use the direct command when the situation genuinely cannot be expressed or coordinated through configuration.

## How Does Import Adopt an Existing Object?
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

Import solves identity, not desired configuration. It tells Terraform which remote object belongs at an address; it does not guarantee that the written arguments describe the object's current settings. If the bucket already has versioning, encryption, or lifecycle behavior that the destination block omits or contradicts, Terraform may propose follow-up changes. Adjust the configuration until that transition is intentional before applying it.

The CLI form and configuration-driven form establish the same binding. `terraform import ADDRESS ID` changes one resource in state directly and does not generate the destination configuration. An `import` block can join normal plan/apply review and express several planned imports. In both cases, confirm the provider-specific ID format and never bind the same remote object to more than one resource instance.

## How Does Terraform Relinquish Ownership Without Destroying?
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

The direct equivalent is `terraform state rm ADDRESS`. It deletes only the binding; the provider object remains. If the resource declaration stays in configuration, the next plan sees a desired address with no state entry and normally proposes creation. That can produce a duplicate or a provider error when names must be unique. “Forget” and “destroy” are radically different operations, but forgetting without changing configuration can lead Terraform straight back toward creation.

## How Should You Use Direct State Commands?
<!-- section-summary: CLI state commands are useful recovery tools, but configuration-driven moves and imports usually leave a clearer review record. -->

Terraform still includes direct state commands:

```bash
terraform state list
terraform state show aws_s3_bucket.logs
terraform state mv aws_s3_bucket.logs aws_s3_bucket.archive
terraform state rm aws_s3_bucket.legacy_reports
```

The wider command set forms a supported administration interface:

| Command | Meaning |
|---|---|
| `state list` | List the addresses this state owns |
| `state show ADDRESS` | Inspect the binding and stored attributes for one instance |
| `state mv A B` | Keep the object but change its Terraform address |
| `state rm A` | Keep the object but remove Terraform ownership |
| `state pull` | Read the current raw state snapshot |
| `state push` | Replace backend state with a supplied snapshot |
| `state replace-provider` | Change the provider association for matching entries |

Use these commands instead of editing `terraform.tfstate` JSON. State is a database format with metadata and backend coordination requirements, not a document intended for hand editing.

The first two commands are read-only inspection: list the tracked addresses, then show one address. Their output gives the team evidence before changing anything:

```console
$ terraform state list
aws_s3_bucket.logs

$ terraform state show aws_s3_bucket.logs
# aws_s3_bucket.logs:
resource "aws_s3_bucket" "logs" {
    bucket = "company-logs"
    id     = "company-logs"
    tags   = {
        "environment" = "prod"
        "service"     = "archive"
    }
}
```

The address list shows which objects this state currently manages. The `state show` output connects one address to one provider ID and selected attributes. Reviewers use that evidence to confirm the source address before a move or removal.

The last two commands mutate state: `mv` changes an address binding, and `rm` removes a binding without destroying the remote object. They can help during emergency recovery, older Terraform workflows, or a controlled migration where configuration-driven blocks are awkward. They also leave less review evidence unless the team records exactly what happened.

For a direct move, the output should name the source and destination:

```console
$ terraform state mv aws_s3_bucket.logs aws_s3_bucket.archive
Move "aws_s3_bucket.logs" to "aws_s3_bucket.archive"
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

Always resolve the exact instance address first. A resource might really be `module.storage.aws_s3_bucket.assets["primary"]`, not the shorter address someone remembers. Run `state list`, then `state show` to verify the remote identity. Quote addresses containing brackets or string keys so the shell does not reinterpret them:

```bash
terraform state show 'aws_instance.web["production"]'
```

For direct moves and removals, `-dry-run` can show which instances match before mutation. Keep backend locking enabled: a state move racing with another apply changes the identity map while the other process makes decisions from its old version. The safe sequence is identify, inspect, dry-run when available, mutate once, and plan immediately.

Address mistakes are recoverable only with evidence. `terraform state list` before and after the edit, backend object versioning, and a saved state backup give the team a route back. Without those, the team may have to reconstruct bindings by importing objects one by one.

`terraform state pull` writes the selected state to standard output, which can be redirected to a protected recovery snapshot. Treat that file like backend state because it may contain sensitive data. `terraform state push` is far more dangerous: it makes an entire supplied snapshot authoritative. Terraform compares lineage—the state history family—and serial—the revision within that history—to resist overwriting unrelated or newer state. Bypassing those checks with `-force` can erase later work, so manual push belongs only in a verified recovery procedure.

## How Do You Hand an Object Between States?
<!-- section-summary: A handoff removes one state's binding and establishes one binding in another state while the remote object remains unchanged. -->

A state split or team handoff combines removal and import. Suppose an old root owns `company-assets`, but a new storage root should manage it. The steady-state invariant remains one object with one owner:

```text
before: old state ── aws_s3_bucket.assets ↔ company-assets
after:  new state ── aws_s3_bucket.assets ↔ company-assets
```

The bucket should never be destroyed, and the two states should not both believe they own it after the handoff. Coordinate a quiet window, verify both backends and provider identities, preserve recoverable versions, then remove the old binding and import the same provider identity into the new destination configuration. The exact order and maintenance window should minimize the time with either zero owners or two apparent owners.

Run a plan in both roots afterward. The old root should no longer propose management or recreation of the object. The new root should recognize the imported binding and show only configuration differences that the receiving team intentionally accepts. This two-sided evidence is stronger than checking only that the commands succeeded.

State boundaries may change during module extraction, organizational handoff, or a split of a large root into independently deployable systems. The operation is still the same identity transformation: reality stays fixed while the authoritative binding moves from one ownership database to another.

## What Makes a State Change Safe?
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

Make one conceptual transition at a time. A rename, import, removal, and provider upgrade in one plan obscure which operation caused an unexpected action. For a pure rename, the strongest expected evidence is usually zero infrastructure changes. For an import, expect the binding plus understood configuration differences. For a removal, confirm Terraform relinquishes ownership without proposing recreation or remote deletion. Save the before-and-after address lists with that evidence.

If a state change goes wrong, the first corrective plan should not be applied in a hurry. Applies should pause, the current state version should be preserved, and the team should identify whether the mistake changed only Terraform's record or also changed cloud infrastructure. A wrong `state rm` may need an import. A wrong `state mv` may need another move back to the original address. A wrong apply may need provider-specific recovery before Terraform state can be trusted again.

## How Do the State Operations Fit Together?
<!-- section-summary: State manipulation is safe after Terraform's record changes in the exact way the team intended and the plan proves it. -->

State manipulation is maintenance on Terraform's address-to-object map. `moved`, `import`, and `removed` blocks keep the intent in configuration for the workflows they support. Direct `terraform state` commands need a backup, a lock, and a plan review.

![State Manipulation Summary](/content-assets/articles/article-iac-terraform-state-manipulating/state-manipulation-summary.png)

*The summary board separates normal refactors from state surgery and shows which tool fits each case.*

The plan decides whether the operation is safe. A rename should show a move. An import should show an import and then a clean or understood follow-up plan. A removal with `destroy = false` should leave real infrastructure in place.

The operations can be classified by what changes. A move keeps the object and ownership but changes the Terraform address. An import keeps the object and creates Terraform ownership. A removal keeps the object and ends Terraform ownership. Normal create and destroy differ because remote reality changes as well as the binding.

Never begin state manipulation merely to make a surprising plan look smaller. First verify the working directory, backend, workspace, cloud account, module version, and state. State surgery against the wrong target can rewrite Terraform's ownership model and hide the original diagnostic evidence.

The deepest model is an identity table with Terraform addresses on the left and remote objects on the right. `moved` and `state mv` change the left-hand identity. Import adds a binding to an existing right-hand object. `removed` and `state rm` delete the binding while leaving the right-hand object. `state pull` reads the database, while `state push` replaces it. The governing rule is always to preserve a one-to-one ownership relationship and make the intended transition visible in a plan.

State commands change Terraform's bookkeeping relationship to real infrastructure; they do not usually mutate the remote object directly, which is precisely why a mistake can leave an unmanaged object or attach configuration to the wrong object. Back up state, lock the correct workspace, resolve exact addresses, preview refactoring or import intent, perform the narrow command, and run an immediate plan. The desired result is a plan that explains the intended relationship without surprise creation or destruction. Preserve an audit record and never hand-edit state when a supported command expresses the transition.

State commands change Terraform's bindings immediately; they are not deferred until `terraform apply`. After a move, removal, or import, run a fresh plan and read every proposed action. Apply only when that plan represents the intended infrastructure transition. If the plan proposes recreation or destruction after an address-only change, stop and repair the binding before making remote changes.

## Check Your Answers

:::expand[What Does State Manipulation Change?]{kind="recap"}
It changes Terraform's binding between a resource-instance address and a remote object. Configuration, state, and reality are separate, and state work deliberately changes the ownership relationship.
:::

:::expand[How Does a `moved` Block Preserve Identity?]{kind="recap"}
A `moved` block declares that an old address and a new address represent the same managed object. Terraform updates the binding without destroying and recreating reality.
:::

:::expand[How Does Import Adopt an Existing Object?]{kind="recap"}
Import binds a provider identity that already exists to a configured Terraform address. It solves identity; the destination configuration still determines future desired state.
:::

:::expand[How Does Terraform Relinquish Ownership Without Destroying?]{kind="recap"}
A `removed` block with `destroy = false`, or direct `state rm`, removes the binding while preserving the object. Leaving the resource declaration behind can cause a new create plan.
:::

:::expand[How Should You Use Direct State Commands?]{kind="recap"}
Treat them as a database administration API: inspect exact addresses, quote instance keys, dry-run when possible, lock the state, back it up, make one mutation, and plan immediately.
:::

:::expand[How Do You Hand an Object Between States?]{kind="recap"}
Coordinate removal from the old state and import into the new one so one real object ends with exactly one Terraform owner. Verify the result with plans in both roots.
:::

:::expand[What Makes a State Change Safe?]{kind="recap"}
Verify context and identity, prefer configuration-driven transitions, protect recoverability, preserve locking, change one concept at a time, and stop whenever the plan is surprising.
:::

:::expand[How Do the State Operations Fit Together?]{kind="recap"}
Moves change an address, imports add ownership, removals end ownership, and create or destroy changes reality. Each operation is understandable as a controlled update to one identity table.
:::

---

**References**

- [Terraform: Moved block](https://developer.hashicorp.com/terraform/language/block/moved) - Documents configuration-driven address moves for refactors.
- [Terraform: Import blocks](https://developer.hashicorp.com/terraform/language/import) - Documents declarative imports and the `import` block workflow.
- [Terraform: Removed block](https://developer.hashicorp.com/terraform/language/block/removed) - Documents removing a resource from Terraform management while controlling destroy behavior.
- [Terraform: Remove resources from state](https://developer.hashicorp.com/terraform/language/state/remove) - Explains state removal and how Terraform treats forgotten objects.
- [Terraform CLI: state](https://developer.hashicorp.com/terraform/cli/commands/state) - Documents direct state subcommands such as `list`, `show`, `mv`, and `rm`.
- [Terraform CLI: state rm](https://developer.hashicorp.com/terraform/cli/commands/state/rm) - Documents the direct CLI command for removing bindings from state.
