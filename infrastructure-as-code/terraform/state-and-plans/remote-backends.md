---
title: "Remote Backends"
description: "Store Terraform state in a shared, remote location so your whole team works from the same source of truth."
overview: "The default local state file breaks down the moment a second person joins your team. Remote backends move the state file to a shared storage service with versioning, access controls, and locking. This article explains how backends work, how to configure them, and how current S3 and Azure Blob Storage state locking patterns work."
tags: ["state", "backend", "s3", "remote", "terraform"]
order: 2
id: article-iac-terraform-state-remote-backends
---

## Table of Contents

1. [Why Local State Is Not Enough](#why-local-state-is-not-enough)
2. [What a Backend Does](#what-a-backend-does)
3. [Configuring the S3 Backend](#configuring-the-s3-backend)
4. [Creating the S3 Bucket and Locking Resources](#creating-the-s3-bucket-and-locking-resources)
5. [The terraform init Migration Process](#the-terraform-init-migration-process)
6. [Partial Backend Configuration for Teams](#partial-backend-configuration-for-teams)
7. [Other Backend Options](#other-backend-options)
8. [State Versioning and Encryption](#state-versioning-and-encryption)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Local State Is Not Enough

When you run `terraform apply` for the first time, Terraform writes a file called `terraform.tfstate` into your current working directory. This file is the state — the record of every resource Terraform created and the real cloud IDs that correspond to them. As long as you are the only person working on this infrastructure and you never lose that file, local state works fine.

![Remote backends move state out of one laptop into a shared location for teams and automation.](/content-assets/articles/article-iac-terraform-state-remote-backends/remote-backend-boundary.png)

Both of those conditions break down quickly in a real team.

First, the sharing problem. Your colleague needs to run `terraform plan` to preview a change. But the state file is on your laptop, or inside your home directory on a CI server. Your colleague has no way to access it. If they run Terraform with their own local state (or no state at all), Terraform thinks none of the existing infrastructure exists and proposes to create everything from scratch. Applying that plan creates duplicates of your entire infrastructure — double the servers, double the databases, double the cost, and complete chaos.

Second, the safety problem. Even if your colleague does have a copy of the state file (say, they checked it into the Git repository alongside the configuration files — which is a common but very bad idea), two people running `terraform apply` at the same time both start from the version of the state file they each have. One person's apply finishes first and writes an updated state. The second person's apply then finishes and overwrites that updated state with an older version. Resources the first person created are now missing from state, even though they exist in the cloud. Terraform has no idea they exist, and the next plan will propose to create them again.

Remote backends solve both problems. They store the state file in a shared location that every team member and every CI/CD pipeline reads from and writes to. They also implement locking: only one operation can modify state at a time.

## What a Backend Does

A backend is the storage and locking system that Terraform uses for the state file. Every Terraform configuration has exactly one backend. If you do not specify one, Terraform uses the built-in local backend, which stores state in a file on disk.

![Remote state locking lets one apply write state while competing runs wait for the lock to release.](/content-assets/articles/article-iac-terraform-state-remote-backends/state-lock-flow.png)

When you configure a remote backend, Terraform changes how it handles state in three ways.

Storage moves from your local disk to the remote service. Instead of reading and writing `terraform.tfstate` in your working directory, Terraform reads from and writes to an S3 bucket, a Terraform Cloud workspace, a Google Cloud Storage bucket, or wherever your backend is configured.

Locking prevents concurrent operations. Before starting an apply (or any operation that could modify state), Terraform acquires a lock on the state file. If another process already holds the lock, Terraform waits or fails with a clear error message telling you who holds the lock and when they acquired it. After the operation finishes, Terraform releases the lock. This prevents the double-apply corruption scenario described above.

History and versioning come for free with most remote storage services. S3 can keep every previous version of the state file, so you can see exactly what state looked like before any apply and roll back if something goes wrong.

## Configuring the S3 Backend

The most widely used remote backend for AWS users is the S3 backend. Current Terraform supports S3-native lock files using `use_lockfile = true`. Older configurations often use a DynamoDB table for locking; HashiCorp now marks DynamoDB-based locking as deprecated for the S3 backend, so treat it as a legacy compatibility option.

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "production/app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}
```

Each argument controls one aspect of the backend setup.

`bucket` is the name of the S3 bucket where state will be stored. This bucket must already exist before you run `terraform init`. Terraform will not create it for you.

`key` is the path within the bucket where the state file will be written. Think of it like a file path inside the bucket. By choosing a meaningful key — like `production/app/terraform.tfstate` — you can store multiple projects' state files in the same bucket, organized by environment and project name.

`region` is the AWS region where the S3 bucket lives. This does not have to match the region where your infrastructure is deployed; it is just where the state storage resources live.

`encrypt = true` tells Terraform to use server-side encryption when writing the state file to S3. This protects the contents of the state file at rest, but access to the bucket and any KMS key still controls who can read the decrypted state.

`use_lockfile = true` tells Terraform to create a lock file beside the state object while an operation is running. If another process tries to modify the same state while the lock file exists, Terraform refuses or waits according to the lock settings.

## Creating the S3 Bucket and Locking Resources

Before your configuration can use the S3 backend, the S3 bucket must exist. This creates a bootstrapping problem: you need Terraform to manage your infrastructure, but you need some infrastructure to store Terraform's state.

The practical solution is to create the state storage resources manually — either through the AWS console or with a small separate Terraform configuration that uses local state. This small bootstrap configuration only needs to be run once.

Here is what that bootstrap configuration looks like:

```hcl
resource "aws_s3_bucket" "terraform_state" {
  bucket = "my-company-terraform-state"
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

```

A few things deserve attention here.

Versioning is enabled on the S3 bucket. This means every time Terraform writes a new state file, S3 keeps the previous version. If an apply causes a problem, you can restore the previous state version and Terraform will be back to the pre-apply picture.

Public access is blocked. The state bucket should never be publicly readable. AWS has a tendency to default to allowing public access on some bucket configurations, so explicitly blocking it at the bucket level is important.

No separate DynamoDB table is needed when you use S3 lock files. If you are maintaining an older backend that still uses `dynamodb_table`, the table's hash key must be `LockID` with string type, because that is the convention the legacy S3 backend locking path expects.

## The terraform init Migration Process

Once the S3 bucket exists, you add the backend configuration to your `terraform` block and run `terraform init`.

Terraform detects that you have configured a new backend. It asks whether you want to copy the existing state to the new backend. If you answer yes, Terraform reads the local `terraform.tfstate` file, writes its contents to the S3 bucket at the path you specified, and verifies the write was successful. From that point on, all Terraform commands use the remote state.

After a successful migration, you should delete the local `terraform.tfstate` file. It is now stale — the remote copy is the authoritative one. Leaving the local copy around creates confusion: you might accidentally run a Terraform command from a directory where you have a local state file, which would shadow the remote state.

If you add the backend configuration to a fresh configuration that has no existing state, `terraform init` just initializes the backend without any migration. The first `terraform apply` will create the state file in S3.

If you switch from one backend to another — for example, moving from S3 to Terraform Cloud — the same migration process applies. Run `terraform init` after updating the backend configuration and choose to migrate the state.

## Partial Backend Configuration for Teams

One challenge with the S3 backend configuration is that it contains values that differ between environments. A development environment might use the key `dev/app/terraform.tfstate` while production uses `prod/app/terraform.tfstate`. If you hardcode these values in your backend block, you need a different configuration file for each environment.

A common solution is partial backend configuration. You leave the backend block mostly empty — specifying only values that are the same everywhere — and pass the environment-specific values as arguments to `terraform init`:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}
```

Then when initializing:

```bash
terraform init -backend-config="key=production/app/terraform.tfstate"
```

Or you can store the backend configuration in a separate file and point to it:

```bash
terraform init -backend-config=backends/production.hcl
```

Where `backends/production.hcl` contains:

```hcl
key = "production/app/terraform.tfstate"
```

This lets you share the same Terraform configuration code across environments by injecting the environment-specific backend key at init time. Your CI/CD pipeline for the production deployment uses one key; the development pipeline uses another.

## Other Backend Options

S3 is the common choice for AWS-centric teams, but Terraform supports several other backends.

**Terraform Cloud / HCP Terraform** is HashiCorp's managed platform. When you use it as a backend, it stores state, provides locking, and can also run `terraform plan` and `terraform apply` on its own managed infrastructure rather than on your local machine. It is the simplest option if your team does not want to manage the state storage infrastructure itself.

**Google Cloud Storage** is the equivalent of S3 for teams using Google Cloud Platform. It stores state in a GCS bucket and uses GCS's own object lock mechanism for locking, so no separate locking table is needed.

**Azure Blob Storage** is the equivalent for Azure. Microsoft documents storing Terraform state in an Azure Storage account and container. Azure Blob Storage provides locking through blob leases, and state access should be protected with Microsoft Entra ID/RBAC where possible, storage encryption, private networking when required, and tight permissions on the storage account.

**PostgreSQL** is an unusual but valid backend. Terraform can store state in a Postgres database table. This is occasionally used in environments where a database is already the organization's standard for durable storage.

The local backend — the default — is also a valid choice for personal projects, experimentation, and learning. For any infrastructure that more than one person touches, use a remote backend.

## State Versioning and Encryption

When versioning is enabled on your S3 bucket, every write to the state file creates a new version. S3 keeps all versions indefinitely unless you configure a lifecycle rule to expire old ones. You can browse versions in the S3 console or via the AWS CLI:

```bash
aws s3api list-object-versions \
  --bucket my-company-terraform-state \
  --prefix production/app/terraform.tfstate
```

To restore a previous version, you download it and replace the current version:

```bash
aws s3api get-object \
  --bucket my-company-terraform-state \
  --key production/app/terraform.tfstate \
  --version-id YOUR_VERSION_ID \
  terraform.tfstate.backup
```

Then you can use `terraform state push` to upload the backup as the new current state (after careful review).

Encryption protects the state file's contents from anyone who can access the S3 bucket but should not read infrastructure secrets. The `encrypt = true` setting in the backend configuration uses S3's default encryption key. For stricter control — for example, to restrict which IAM principals can decrypt the state — you can specify a customer-managed KMS key:

```hcl
backend "s3" {
  bucket         = "my-company-terraform-state"
  key            = "production/app/terraform.tfstate"
  region         = "us-east-1"
  encrypt        = true
  kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/mrk-abc123"
  use_lockfile   = true
}
```

With a KMS key, even an AWS administrator who can access the bucket cannot read the state contents without also having permission to use that specific KMS key.

## Putting It All Together

The local state file is a convenience for solo projects. For any team, it is a liability. Two engineers using local state are working from different pictures of the same infrastructure, setting up a collision every time both run Terraform.

The S3 backend with lock files replaces the local file with a shared, versioned, encrypted, locked store. Every engineer and every CI/CD pipeline reads from and writes to the same state. The S3 lock file ensures only one operation modifies a given state object at a time. S3 versioning means every previous state is preserved and recoverable. Server-side encryption protects the sensitive values that inevitably end up in state at rest.

Setting up the S3 bucket is a one-time bootstrap task. Once done, the backend configuration in your Terraform block is a few lines of HCL, and `terraform init` handles migration automatically. Every subsequent plan and apply goes through the remote backend transparently; the commands are the same, only where the state lives has changed.

## What's Next

Storing state remotely solves the sharing problem. But what happens when you have multiple environments — development, staging, production — that each need completely isolated state? The next article covers state locking in detail and the strategies for isolating state across environments so a change in development can never accidentally affect production.


![Remote backend summary: share state, lock writes, version changes, and encrypt access.](/content-assets/articles/article-iac-terraform-state-remote-backends/remote-backends-summary.png)

---

**References**

- [Backend Configuration (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/settings/backends/configuration) — Full reference for backend configuration, partial configuration, and migration.
- [S3 Backend (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/settings/backends/s3) — All arguments for the S3 backend, including KMS encryption, locking, and workspace support.
- [State: Remote State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/remote) — Overview of what remote state provides compared to local state.
- [Store Terraform State in Azure Storage (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/terraform/store-state-in-azure-storage) — Microsoft guidance for Azure Storage-backed Terraform state.
- [Lease Blob (Azure Storage REST API)](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob) — Official Azure Blob lease behavior used for exclusive write-style coordination.
- [Azure Storage Encryption (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/storage/common/storage-service-encryption) — Microsoft guidance on encryption at rest for Azure Storage.
- [Authorize Azure Blob Access with Microsoft Entra ID (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory) — Microsoft guidance on RBAC-based blob access.
