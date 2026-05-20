---
title: "Backends and Locking"
description: "Store Terraform state in a shared backend, choose safe S3 backend boundaries, and use locking to prevent overlapping AWS changes."
overview: "A backend turns state from one local file into a shared system boundary. This article follows an S3 backend for the AWS example and explains state paths, locking, bucket protection, and migration from local state."
tags: ["terraform", "opentofu", "aws", "s3", "backends", "locking"]
order: 2
id: article-infrastructure-as-code-terraform-backends-locking
---

## Table of Contents

1. [The Team Problem](#the-team-problem)
2. [What a Backend Does](#what-a-backend-does)
3. [An S3 Backend](#an-s3-backend)
4. [State Keys Are Boundaries](#state-keys-are-boundaries)
5. [Locking](#locking)
6. [Protecting the State Bucket](#protecting-the-state-bucket)
7. [Moving From Local State](#moving-from-local-state)
8. [Common First Mistakes](#common-first-mistakes)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Team Problem

The previous article showed why Terraform needs state. A local `terraform.tfstate` file can explain the idea, but it does not answer the next team question.

Mira changes the security group for the demo EC2 instance. Jamal changes the S3 bucket tags. CI is ready to apply a VPC route update after the pull request merges. All three runs need the same memory of the same AWS environment.

If each run reads a different local state file, Terraform is no longer reviewing one shared system. It is reviewing three separate memories. One run might miss another run's resource update. One laptop might hold the newest object IDs. CI might plan from stale state. Two applies might both start from the same snapshot and race to write different results.

A backend solves the storage side of that problem. Locking solves the coordination side.

## What a Backend Does

A backend decides where Terraform stores state and how Terraform reads and writes it.

The default backend is local. It stores state in a JSON file on disk. A remote backend stores state somewhere outside the working directory, such as S3, HCP Terraform, Azure Blob Storage, Google Cloud Storage, or another supported system.

The backend is configured in the root module because state belongs to the operation boundary. The `orders-dev` root module should have its own backend path. The `orders-prod` root module should have a different backend path. A reusable child module should not decide where production state lives.

The backend becomes part of the run context:

```text
root module: infra/live/dev
backend:     s3
state key:   orders/dev/terraform.tfstate
region:      us-east-1
```

That context matters as much as the `.tf` files. A correct VPC resource in the wrong backend can plan against the wrong memory. A correct EC2 change with the wrong AWS credentials can affect the wrong account.

## An S3 Backend

AWS teams often store Terraform state in S3. The state snapshot is an object in a bucket, and the backend key is the object's path inside that bucket.

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state-prod"
    key          = "orders/dev/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
```

The `bucket` value names the S3 bucket that stores state. The `key` value names this root module's state object. The `region` tells Terraform where to find the bucket. The `use_lockfile` setting enables native S3 state locking for this backend.

Read the key as carefully as a resource name. In the example above, the bucket name says `prod` because it is a protected state bucket, but the key says `orders/dev/terraform.tfstate` because this root module manages the dev environment. Another root module might use the same bucket with a different key:

```hcl
terraform {
  backend "s3" {
    bucket       = "dp-terraform-state-prod"
    key          = "orders/prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
```

The bucket can be shared across several state objects. The key must be unique to the root module and environment. Reusing one key for dev and prod makes both environments share one Terraform memory, which is usually a serious mistake.

Backend configuration should avoid hardcoded credentials. Use the normal AWS credential chain, CI identity, role assumption, environment variables, or an approved profile. Backend secrets passed through command-line flags or backend config files can be written into Terraform working data and plan files.

## State Keys Are Boundaries

The backend key is more than a path. It is the state boundary.

This layout keeps dev and prod separate:

```text
s3://dp-terraform-state-prod/orders/dev/terraform.tfstate
s3://dp-terraform-state-prod/orders/prod/terraform.tfstate
```

Each state file has its own managed object list. The dev state can map `aws_vpc.main` to the dev VPC. The prod state can use the same resource address to map to the prod VPC. The address looks the same because the root modules have the same shape, but the state files are different.

```text
orders/dev state:
  aws_vpc.main -> vpc-0dev1234

orders/prod state:
  aws_vpc.main -> vpc-0prod5678
```

That separation is one reason root modules are common for real environments. The directory path, backend key, variables, and AWS credentials can all point at the same environment boundary.

If a plan for dev shows a state key containing `prod`, stop before reading the resource changes. The run context is already suspicious. Many Terraform mistakes start with files that look right and a backend that points somewhere else.

## Locking

Locking prevents two Terraform operations from writing the same state at the same time.

Picture two applies against the same state key:

```text
Run A reads state serial 18
Run B reads state serial 18
Run A changes the EC2 instance and writes serial 19
Run B changes the S3 bucket and writes serial 19 from its older view
```

Without coordination, the final state can lose part of the story. AWS may have both changes, but state may only remember the last writer's view. The next plan starts from damaged memory.

When the backend has locking and locking is enabled, Terraform takes a lock before operations that could write state. Another run using the same state must wait or fail instead of writing over the first run.

The S3 backend can use native S3 locking with `use_lockfile = true`. Older S3 backend designs often used a DynamoDB table for locking. Current Terraform documentation marks DynamoDB-based locking for the S3 backend as deprecated, so new designs should prefer the native S3 lock file path unless a team has a compatibility reason.

A lock error is a coordination signal:

```text
Error: Error acquiring the state lock

Lock Info:
  Operation: OperationTypeApply
  Who: mira@example.com
  Path: dp-terraform-state-prod/orders/prod/terraform.tfstate
```

The first response is to find the active run. Maybe CI is applying. Maybe another engineer has a plan open. Maybe an earlier run crashed and left a stale lock. Force-unlock belongs to recovery after you confirm the lock is stale. Using it because the lock is inconvenient can create the overlapping write problem locking was designed to prevent.

## Protecting the State Bucket

The S3 bucket that stores state is production infrastructure. It may not serve application traffic, but it controls Terraform's ability to manage the environment.

Give the state bucket a small, explicit security design:

| Control | Why it matters |
| --- | --- |
| Restricted IAM access | Only Terraform operators and automation should read or write state. |
| Bucket versioning | Previous state object versions can help recovery after accidental overwrite or deletion. |
| Encryption | State should be encrypted at rest, with KMS when the team needs key-level control. |
| Public access block | State buckets should never be publicly readable. |
| Logging or CloudTrail review | State reads and writes are important operational events. |
| Separate keys per root module | Each environment needs a clear state boundary. |

S3 now encrypts new objects by default with SSE-S3, but many teams still configure explicit bucket encryption so the intent is visible and so they can use AWS KMS controls where required. Versioning is especially useful because state changes over time. If a state object is overwritten by accident, a previous version can be the difference between recovery and manual reconstruction.

The bucket that stores state is often bootstrapped before the rest of the Terraform environment. That bootstrap step can be manual, scripted, or managed by a separate root module with its own state boundary. Keep it small. The state backend should not depend on the state file it is meant to store.

## Moving From Local State

When a learning project becomes shared, the team usually migrates from local state to a backend.

The safe shape is:

1. Create and protect the backend resources.
2. Add the backend block to the root module.
3. Run `terraform init` and migrate the existing state when prompted.
4. Run a plan and confirm Terraform still sees the same AWS objects.
5. Remove local state files from the working directory after migration succeeds.

Terraform initialization is the moment backend configuration takes effect. If backend settings changed, `terraform init` asks whether to migrate state to the new backend. Read the source and destination carefully before approving.

After migration, a healthy plan should still connect the same addresses to the same AWS objects. If the plan suddenly wants to create a new VPC, EC2 instance, or S3 bucket, Terraform may be looking at empty or wrong state. Stop and fix the backend context before applying.

## Common First Mistakes

**Using one backend key for several environments.** Dev, staging, and prod need separate state paths.

**Skipping locking.** Shared state needs coordination. Locking prevents overlapping writes.

**Force-unlocking too quickly.** Confirm the original run is gone before removing a lock.

**Putting credentials in backend configuration.** Use approved credential sources instead of hardcoding secrets in `.tf` files or backend config artifacts.

**Treating the state bucket as ordinary storage.** State storage needs restricted access, versioning, encryption, and review.

**Changing backend settings without checking context.** A wrong bucket, key, region, account, or profile can make Terraform plan against the wrong memory.

## Putting It All Together

The team problem was shared memory. Mira, Jamal, and CI all need the same state for the same AWS environment, and only one writer should update that state at a time.

The backend gives Terraform a shared place to store state. The S3 backend stores the state snapshot at a bucket and key. The key is the environment boundary. Locking prevents overlapping writes to that boundary. Bucket controls protect state as sensitive operational data.

The practical review habit is to read backend context before resource changes:

- Which root module is running?
- Which backend type is configured?
- Which bucket and key hold state?
- Which AWS account and region are active?
- Is locking enabled for this backend?
- Who can read and write the state object?

Once state is stored and coordinated, the next review surface is the plan. The plan is where Terraform turns configuration, state, provider refresh, and schemas into proposed AWS actions.

## What's Next

The next article teaches how to read Terraform plans. A backend makes state shared and safe to update; a plan shows exactly what Terraform intends to create, change, replace, or destroy from that state.

---

**References**

- [Backends: State Storage and Locking](https://developer.hashicorp.com/terraform/language/state/backends) - Explains backend responsibilities for remote state storage and locking.
- [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3) - Documents S3 state storage, `use_lockfile`, backend keys, and S3 backend permissions.
- [State locking](https://developer.hashicorp.com/terraform/language/state/locking) - Explains automatic state locking and force-unlock recovery.
- [Backend block configuration](https://developer.hashicorp.com/terraform/language/backend) - Describes backend configuration and secret-handling concerns.
- [Retaining multiple versions of objects with S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) - Explains S3 object versioning and recovery from accidental overwrite or deletion.
- [Configuring default encryption for S3 buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html) - Explains default S3 encryption and KMS options for stronger key control.
- [OpenTofu State Storage and Locking](https://opentofu.org/docs/language/state/backends/) - Describes backend storage and locking behavior for OpenTofu.
