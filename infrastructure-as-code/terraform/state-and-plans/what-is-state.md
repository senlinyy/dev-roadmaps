---
title: "What Is Terraform State?"
description: "Understand why Terraform keeps a state file, what it stores, and why it is the most important file in your infrastructure project."
overview: "Terraform's state file is the bridge between your configuration code and the real resources running in the cloud. This article explains what state stores, why it exists, and what happens when state is lost, corrupted, or out of sync with reality."
tags: ["state", "terraform.tfstate", "terraform", "infrastructure"]
order: 1
id: article-iac-terraform-state-what-is-state
---

## Table of Contents

1. [The Problem State Solves](#the-problem-state-solves)
2. [What the State File Looks Like](#what-the-state-file-looks-like)
3. [How Terraform Uses State During a Plan](#how-terraform-uses-state-during-a-plan)
4. [The Refresh Step](#the-refresh-step)
5. [When State Drifts From Reality](#when-state-drifts-from-reality)
6. [What Gets Stored in State](#what-gets-stored-in-state)
7. [Why You Must Not Edit State by Hand](#why-you-must-not-edit-state-by-hand)
8. [Sensitive Data in State](#sensitive-data-in-state)
9. [The State Serial and Lineage](#the-state-serial-and-lineage)
10. [The terraform.tfstate.backup File](#the-terraformtfstatebackup-file)
11. [Reading State Safely](#reading-state-safely)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Problem State Solves

Terraform state is the mapping file that connects Terraform resource addresses to real remote object IDs and last-known attributes.

When you run `terraform apply` and it creates an EC2 instance, AWS generates a unique identifier for that instance, something like `i-0a1b2c3d4e5f6789`. This identifier is what AWS uses internally to refer to that exact virtual machine. It is different from the name you gave the resource in your Terraform configuration. Your configuration says `resource "aws_instance" "app_server"`, but AWS does not know or care about that label. AWS only knows the ID it generated.

![Terraform state maps configuration addresses to real infrastructure IDs and stored attributes.](/content-assets/articles/article-iac-terraform-state-what-is-state/state-snapshot-map.png)

The next time you run `terraform plan`, Terraform needs to figure out whether the EC2 instance described in your configuration already exists. It cannot ask AWS for a list of all your instances and match them by name, because names are not unique, you might have ten instances all legitimately named `app-server`. And Terraform cannot simply check if an instance with those exact settings exists, because many of those settings (like the instance type or AMI) can be changed after creation, making the match ambiguous.

Terraform solves this with a state file. After a successful apply, Terraform writes a record that says: the resource called `aws_instance.app_server` in my configuration corresponds to the real AWS resource with ID `i-0a1b2c3d4e5f6789`. This mapping is persistent. The next time you run any Terraform command, it reads the state file to understand which real resources already correspond to which configuration blocks.

Without state, Terraform would have no memory. Every `terraform plan` would look at your configuration and the cloud provider's current reality and have no way to determine what it created versus what was already there. It would either attempt to create duplicates of everything or refuse to operate at all.

## What the State File Looks Like

The state file is a JSON document that stores Terraform's records. By default, local Terraform writes it as `terraform.tfstate` in your working directory. Example: after creating `aws_instance.app_server`, the state file stores the Terraform address, the real EC2 instance ID, and attributes such as private IP and subnet ID.

You can open the file in any text editor, though you should not edit it directly. More on that later.

A typical state file entry for an EC2 instance looks roughly like this:

```json
{
  "resources": [
    {
      "mode": "managed",
      "type": "aws_instance",
      "name": "app_server",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "schema_version": 1,
          "attributes": {
            "id": "i-0a1b2c3d4e5f6789",
            "ami": "ami-0c55b159cbfafe1f0",
            "instance_type": "t3.small",
            "subnet_id": "subnet-0abc123def456789",
            "private_ip": "10.0.1.45",
            "public_ip": "54.123.45.67",
            "tags": {
              "Name": "app-server",
              "environment": "production"
            }
          }
        }
      ]
    }
  ]
}
```

Notice that the state file stores far more information than you wrote in your configuration. The configuration specified the AMI, instance type, and subnet ID. The state file also stores the private IP address, the public IP address, and every other attribute that AWS returned when the instance was created. This full snapshot is what allows Terraform to detect when something has changed, it compares what the state file says an attribute should be against what the cloud provider currently reports.

The state file also stores the provider configuration used, the Terraform version that created it, and a serial number that increments each time the state is modified. The serial number is important for conflict detection in team environments.

## How Terraform Uses State During a Plan

A plan compares three pictures: the configuration you wrote, the last state Terraform stored, and the current resource data returned by the provider. This is how Terraform decides whether to create, update, replace, or delete anything. Example: if code says `t3.medium` but state and AWS say `t3.small`, the plan shows an instance type update.

Every `terraform plan` follows the same sequence. Terraform reads your configuration files. It reads the current state file. It queries the cloud provider for the current real-world attributes of each resource listed in the state. Then it produces a diff.

![A plan compares configuration, prior state, and refreshed real infrastructure before proposing changes.](/content-assets/articles/article-iac-terraform-state-what-is-state/plan-state-refresh-loop.png)

The diff compares three things: what your configuration says should exist, what the state file says currently exists, and what the cloud provider reports actually exists right now. The plan shows the difference between your configuration and the combined picture from state and reality.

If the state file says an instance exists with ID `i-0a1b2c3d4e5f6789` and the cloud provider confirms that instance is still running with the same attributes, and your configuration has not changed, the plan shows no changes. Everything matches.

If you change the instance type in your configuration from `t3.small` to `t3.medium`, the plan detects that the configuration now describes a `t3.medium` but the state (and the running instance) say `t3.small`. The plan proposes an update, in this case, stopping the instance, changing its type, and restarting it.

If someone deleted the instance directly from the AWS console without going through Terraform, the state file still has the record for `i-0a1b2c3d4e5f6789`, but the cloud provider reports that no instance with that ID exists. The plan detects this discrepancy and proposes to re-create the instance.

## The Refresh Step

Refresh is the part of planning where Terraform asks the provider what each tracked resource looks like right now. It exists so the plan is based on current infrastructure instead of only yesterday's state file. Example: if someone added a tag to an EC2 instance in the AWS console, refresh lets Terraform see that tag before calculating the plan.

In modern Terraform, refresh normally happens automatically as part of every plan. The old standalone `terraform refresh` command exists for compatibility but is deprecated because it can update state without showing the same review boundary as a plan. When you need an explicit refresh-only workflow, use `terraform plan -refresh-only` and review it before applying.

During refresh, Terraform loops through every resource listed in the state file and calls the provider's Read function for each one. The Read function is an API call to the cloud provider, AWS, Google Cloud, Azure, or whichever provider you are using, that asks for the current attributes of that specific resource. The provider returns all current attributes, and Terraform updates its in-memory picture of reality. This updated picture is what the plan diff compares against your configuration.

Refresh is where Terraform detects drift, situations where the real infrastructure has been changed outside of Terraform. If a colleague added a tag to your EC2 instance manually through the AWS console, the refresh step picks that up. The plan will then show that your configuration does not include that tag, and if you apply, the tag will be removed to bring reality back in line with your configuration.

You can skip the refresh step with `terraform plan -refresh=false`. This makes the plan faster because it skips all the API calls, but it means the plan is based on what the state file last recorded rather than what is actually running now. Use this only when you know the state is accurate and you need a quick plan in a large, complex configuration where the refresh takes several minutes.

## When State Drifts From Reality

Drift is a mismatch between the real infrastructure and Terraform's recorded state or configuration. It usually happens when someone changes infrastructure outside Terraform, or when the state file is lost or corrupted. Example: a manually deleted S3 bucket still exists in Terraform state until refresh discovers it is gone.

There are two directions this can go.

The more common direction is external changes: someone modified or deleted a resource outside of Terraform. They clicked through the AWS console, ran an AWS CLI command, or another automation tool made a change. Terraform's state file still holds the old picture, so the next plan detects the discrepancy and proposes to fix it.

The less common direction is state corruption or loss. If the state file is deleted, Terraform loses all memory of what it created. The next `terraform plan` sees all the resources in your configuration as new, nothing in state maps to anything real. If you run `terraform apply` at this point, Terraform attempts to create everything from scratch. For resources that AWS enforces uniqueness on (like a specific DNS record or an S3 bucket name), the creation fails with a collision error. For resources where duplicates are allowed (like EC2 instances), Terraform creates a second set of instances alongside the ones that are already running, which is expensive and chaotic.

Recovering from lost state is painful. You have to manually re-import every existing resource back into a new state file using `terraform import`, one resource at a time. This is why protecting your state file, storing it remotely with backups and access controls, is not optional for production infrastructure.

## What Gets Stored in State

State stores Terraform's full working record for each tracked resource. That includes values from your configuration, values the provider assigned, and metadata Terraform needs for future plans. Example: an EC2 state record can store the configured AMI plus the assigned instance ID, private IP address, and provider schema version.

This includes:

Every attribute that was in your configuration, the instance type, the AMI ID, the subnet ID, the tags you specified.

Every attribute that the cloud provider returned after creation that was not in your configuration, the assigned private IP address, the public IP address, the ARN, the creation timestamp, the DNS hostname. These are called computed attributes, because their values are not known until the resource is created and the provider returns them.

The provider's internal schema version for that resource type. When a provider upgrades and changes the structure of a resource's attributes, this version number tells Terraform how to interpret the stored data and whether a migration is needed.

For module resources, the full module path. A resource at `module.compute.aws_instance.app` has a state address that includes the module name, which is how Terraform distinguishes it from a resource with the same type and name in a different module.

## Why You Must Not Edit State by Hand

Manual state editing means changing Terraform's ownership record without Terraform's state commands. It is risky because the JSON has consistency rules that are easy to break by hand. Example: changing an instance's subnet ID in the state file does not move the real instance, so the next plan may become misleading.

The state file is a JSON document, and it is technically possible to open it in a text editor and change values directly. You should not do this for several reasons.

The state file has internal consistency requirements. Changing one attribute value without updating related computed values can leave the state in an inconsistent condition. For example, if you change the subnet ID of an instance without also updating any attribute that references the old subnet, Terraform may produce a plan that shows no changes (because it reads what you wrote) but the real resource is still attached to the original subnet.

State also has serial and lineage metadata that Terraform uses to detect conflicts and avoid pushing the wrong state snapshot to the wrong place. Remote backends add their own consistency controls. If you edit a state file by hand and push it back, Terraform may reject it, or worse, accept an internally inconsistent snapshot.

For situations where you need to make corrections to state, removing a resource record that no longer exists, moving a resource from one module to another, replacing a corrupted attribute value, Terraform provides dedicated commands (`terraform state rm`, `terraform state mv`, `terraform import`) that perform state operations safely. These commands understand the consistency rules and update the state correctly.

## Sensitive Data in State

Sensitive data in state means secrets can be present inside `terraform.tfstate` even when Terraform hides them from terminal output. The `sensitive` flag controls display, not whether the provider stores the value in state. Example: a generated private key or database password can still be written to state if the provider returns it as an attribute.

Any attribute that your cloud provider returns is stored in the state file, regardless of whether you marked the corresponding variable as sensitive. This includes database passwords, private key material, and API tokens. If a provider resource stores such values in its attributes and the provider's API returns them, they end up in your state file in plain text.

The AWS provider, for example, stores RDS master passwords and ElastiCache auth tokens in state. The TLS provider stores generated private keys in state. If your state file is accessible to unauthorized people, they can read those secrets directly from the JSON.

This has two practical implications. First, the state file must be treated as a secret. Do not store it in a public repository. Do not share it over chat or email. If you are storing state in an S3 bucket (covered in the next article), configure server-side encryption and restrict access with IAM policies.

Second, the sensitive flag in Terraform variable declarations (`sensitive = true`) only controls what Terraform prints in terminal output. It does not prevent the value from being written to the state file. Newer Terraform features such as ephemeral values and provider write-only arguments can keep some short-lived values out of state and plan files when the provider supports that pattern, but they do not change the basic rule: state access is sensitive access.

## The State Serial and Lineage

The state serial is a write counter, and the lineage is the unique identity of one state history. Terraform uses them to avoid mixing up state snapshots during state operations. Example: if your local state has `serial: 4` but the remote backend already has `serial: 5`, Terraform can detect that your copy is older.

Inside the state file, two fields help Terraform detect conflicts and track history.

The `serial` field is a counter that increments by one every time the state is successfully modified. When you run `terraform apply` and three resources are created, the serial might go from `4` to `5`. This is useful for state push and snapshot conflict checks, but it is not the main team concurrency control. Remote backend locking is the guard that prevents two active Terraform runs from writing the same state at the same time.

The `lineage` field is a random unique identifier generated when the state file is first created. It stays constant for the entire life of that state file, even as the serial increments. If you make a literal copy of a state file, the copy keeps the same lineage, which is one reason copying state to create a new environment is risky. For a new environment, start with an empty state and import only the resources that truly belong there, or use Terraform's state commands carefully so lineage and resource ownership remain intentional.

Here is what the top of a state file looks like with these fields visible:

```json
{
  "version": 4,
  "terraform_version": "1.6.3",
  "serial": 12,
  "lineage": "3a4b5c6d-7e8f-9012-abcd-ef1234567890",
  "outputs": {},
  "resources": [...]
}
```

`version` is the state file format version, currently 4 for modern Terraform. This is separate from the `serial`. When Terraform introduces a new state file format, the `version` changes and Terraform knows to upgrade old files automatically on the next apply.

## The terraform.tfstate.backup File

`terraform.tfstate.backup` is the previous local state snapshot. It exists only for local-backend workflows and gives you one rollback point. Example: after a local apply changes `terraform.tfstate`, the backup file contains the state from just before that apply.

When you use the local backend, Terraform saves a copy of the previous state to `terraform.tfstate.backup` in the same directory whenever it successfully modifies the local state file. This gives you a one-level rollback for local workflows: if an apply produces unexpected results and you want to return to the pre-apply state, the backup file contains exactly what the state looked like before the apply ran.

The backup file is not a full history. It only keeps the most recent previous version. Each apply overwrites the backup with the state from before that apply. In team environments, use a remote backend with storage-level versioning, such as S3 object versioning or Azure Blob Storage versioning, rather than relying on a local backup file.

When working locally for learning and experimentation, the backup file is useful for recovering from mistakes. In team environments with remote backends and storage versioning, the local backup file is less important because the backend preserves previous versions.

## Reading State Safely

Reading state safely means using Terraform commands that understand the state format. These commands show tracked addresses and attributes without inviting accidental JSON edits. Example: use `terraform state show aws_vpc.main` to inspect a VPC record instead of opening `terraform.tfstate` and searching by hand.

The safest way to inspect the state file is through Terraform's own commands rather than opening the JSON directly.

`terraform state list` shows the address of every resource currently tracked:

```bash
$ terraform state list
aws_vpc.main
aws_subnet.web
aws_subnet.db
module.database.aws_db_instance.main
```

`terraform state show` displays the full attribute set for one specific resource:

```bash
$ terraform state show aws_vpc.main
# aws_vpc.main:
resource "aws_vpc" "main" {
    arn                              = "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-0abc..."
    cidr_block                       = "10.0.0.0/16"
    enable_dns_hostnames             = true
    enable_dns_support               = true
    id                               = "vpc-0abc123def456789"
    ...
}
```

This output looks like HCL, making it easy to read. It shows every attribute, both the ones you specified in your configuration and the computed ones that AWS assigned. If you are planning to import an existing resource, `state show` on a similar existing resource tells you what attributes to include in your configuration block.

`terraform show` with no file argument shows the current state. To inspect a saved plan, pass the plan file explicitly:

```bash
terraform show myplan.tfplan
```

This is more verbose than `state show` for individual resources but useful for getting a full picture.

## Putting It All Together

State is Terraform's memory. It is the record that connects your configuration files, the descriptions of what should exist, to the real resources running in your cloud account. Without state, Terraform could not determine which resources it created, could not detect changes you made in your configuration, and could not safely update or delete resources without risking collisions or duplicates.

Every `terraform plan` does a refresh pass, comparing the state file's picture against what the cloud provider actually reports, then produces a diff against your current configuration. This three-way comparison, desired state from configuration, last known state from the state file, and current real state from the provider, is what gives Terraform its predictability.

The `serial` and `lineage` fields protect the state from concurrent modification and cross-environment accidents. The `terraform.tfstate.backup` file gives you a one-step local rollback. The `terraform state list` and `terraform state show` commands let you inspect state safely without risking accidental edits to the raw JSON.

Because the state file holds sensitive data and is critical to safe operations, it needs to be stored securely, backed up, and protected from concurrent modification. The local state file that Terraform creates by default (`terraform.tfstate`) is fine for learning and experimentation, but any real team environment needs remote state storage.

## What's Next

The state file sitting on your local disk is dangerous in a team environment. If two engineers run `terraform apply` at the same time, both start from the state as it was when they began, and the second apply overwrites whatever the first one wrote, potentially corrupting the state. The solution is remote state storage with locking, which is exactly what the next article covers.


![Terraform state summary: map addresses, store attributes, detect drift, and protect the state file.](/content-assets/articles/article-iac-terraform-state-what-is-state/state-summary.png)

---

**References**

- [State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state), The official overview of what state is and why it exists.
- [State: Purpose of Terraform State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/purpose), A deeper explanation of the technical reasons Terraform needs state.
- [Sensitive Data in State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/sensitive-data), Guidance on handling secrets that end up in the state file.
- [Manage Sensitive Data (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/manage-sensitive-data), Current guidance on sensitive, ephemeral, and write-only value patterns.
- [Refresh-Only Mode (HashiCorp Tutorial)](https://developer.hashicorp.com/terraform/tutorials/state/refresh), Current refresh-only workflow that replaces routine use of `terraform refresh`.
- [Store Terraform State in Azure Storage (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/store-state-in-azure-storage), Microsoft guidance for Azure Storage-backed Terraform state.
