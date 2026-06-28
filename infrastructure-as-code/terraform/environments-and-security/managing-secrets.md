---
title: "Managing Secrets"
description: "Secret values outside Terraform code and normal state paths through managed secrets, references, and runtime identity."
overview: "Terraform can mark values as sensitive, but state still needs strong protection. This article starts with a dev password mistake, then shows safer production patterns: provider-managed secrets, reference-based wiring, runtime identity, CI handling, and state review."
tags: ["secrets", "security", "vault", "aws secrets manager", "terraform"]
order: 4
id: article-iac-terraform-environments-secrets
---

## Table of Contents

1. [The Small Secret Mistake](#the-small-secret-mistake)
2. [What sensitive Actually Does](#what-sensitive-actually-does)
3. [Ephemeral and Write-Only Values](#ephemeral-and-write-only-values)
4. [Provider-Managed Secrets First](#provider-managed-secrets-first)
5. [Secret References Instead of Values](#secret-references-instead-of-values)
6. [Runtime Identity Reads the Secret](#runtime-identity-reads-the-secret)
7. [CI/CD Secret Handling](#cicd-secret-handling)
8. [Plan and State Review](#plan-and-state-review)
9. [Putting It All Together](#putting-it-all-together)

The previous articles separated the Terraform run by identity, folder, backend, variables, and sometimes workspace. Secrets add one more boundary. The safest Terraform design keeps raw secret values away from normal code review, plan review, state access, and CI logs.

The running example stays with the billing service. The service needs a database password in production. Terraform should help create the secret location, grant the application permission, and pass a reference such as an ARN or resource ID. The application should read the secret through its own runtime identity after it starts.

## The Small Secret Mistake
<!-- section-summary: Terraform often touches secret-related infrastructure, but raw secret values can leak through code, plans, logs, and state. -->

The billing team starts with a dev database. Someone needs a password quickly and adds it to `dev.tfvars`:

![Secret Input Boundary](/content-assets/articles/article-iac-terraform-environments-secrets/secret-input-boundary.png)

*The boundary view shows how secret values leak after they enter Terraform as normal variables.*

```hcl
database_password = "dev-only-change-me"
```

That single line teaches the wrong habit. A `.tfvars` file can be committed by mistake, copied into CI logs, saved in plan files, or passed into a provider argument that ends up in Terraform state. In production, a real password in a variable file is a serious leak path.

A **secret** is any value that grants access or protects private data: database passwords, API keys, private keys, OAuth client secrets, signing tokens, and certificate private keys. Terraform often creates the infrastructure around secrets, so the safe design avoids moving raw secret values through Terraform if a reference or provider-managed option can work.

The production preference is clear: let a secret manager or provider feature hold the secret value, and let Terraform manage references, permissions, and wiring.

That means Terraform can still be part of secret management. It can create a secret container, grant an application role permission to read it, configure a database to use a provider-managed password, or pass a secret ARN into an application module. The safer design keeps the raw secret value out of normal Terraform inputs and outputs.

The review question is always about the value path. If a password starts in a `.tfvars` file, Terraform may carry it into a plan, a provider request, state, a saved plan artifact, and CI output. If the password starts in a secret manager and Terraform only passes the secret reference, the normal Terraform path carries the name of the secret instead of the secret value.

## What sensitive Actually Does
<!-- section-summary: sensitive hides CLI display for values, but state and provider behavior still decide where the value is stored. -->

Terraform variables and outputs can be marked `sensitive`:

![Sensitive State Flow](/content-assets/articles/article-iac-terraform-environments-secrets/sensitive-state-flow.png)

*The state flow shows why `sensitive` hides display but still requires protected state and careful downstream handling.*

```hcl
variable "bootstrap_token" {
  type        = string
  description = "Temporary token used only during bootstrap."
  sensitive   = true
}

output "bootstrap_token" {
  value     = var.bootstrap_token
  sensitive = true
}
```

The plan hides the value:

```console
Changes to Outputs:
  + bootstrap_token = (sensitive value)
```

This gives useful display control. It protects terminal output and routine CI logs from casual exposure. State can still contain the underlying value if a provider needs it to compare future configuration with the remote object.

`sensitive` belongs anywhere Terraform must handle a sensitive value. The state backend still needs encryption, access control, audit logs, limited automation permissions, and careful handling of saved plan files.

Value-path review follows the value from input to resource argument to output and state. If `var.bootstrap_token` flows into a resource argument, the provider's state behavior matters. If a sensitive output re-exports the token, root-output access matters too. The CLI redaction helps, while backend access remains the stronger control.

The key lesson is practical: `sensitive = true` changes display behavior. Terraform state still needs secret-level protection, and Terraform may still keep the value in artifacts it needs for future comparisons.

## Ephemeral and Write-Only Values
<!-- section-summary: Terraform can omit some temporary values from state and plans through ephemeral values and provider-supported write-only arguments. -->

Terraform now has three separate tools that people often mix together: **sensitive values**, **ephemeral values**, and **write-only arguments**. They solve different parts of the secret problem.

`sensitive = true` redacts display. It keeps a value out of normal CLI output, but the underlying value can still be stored in state or saved plans if Terraform or the provider needs it later.

`ephemeral` values are available in Terraform 1.10 and later. An ephemeral value exists only for the current Terraform operation, so Terraform omits it from state and plan files. This is useful for short-lived tokens, generated passwords, and one-run bootstrap values.

**Write-only arguments** are available in Terraform 1.11 and later for providers and resources that support them. A write-only argument lets Terraform send a value to a managed resource during the operation without storing that argument value in state or plan files. Provider docs usually mark these arguments with names ending in `_wo`, along with a version argument such as `_wo_version` for later rotations.

The safest secret designs combine the right tool with the right value path:

| Tool | What it protects | What still needs care |
|---|---|---|
| `sensitive = true` | Routine Terraform display and logs | State, saved plans, provider behavior, and anyone who can read artifacts |
| `ephemeral` value | State and plan persistence for temporary values | Only works in supported contexts and current-run flows |
| Write-only argument | State and plan persistence for provider-supported resource arguments | Requires Terraform 1.11+ and explicit provider support |

The write-only database password pattern has three pieces: an ephemeral value, a write-only provider argument, and a version number that records rotation intent. The skeleton looks like this:

```hcl
ephemeral "<ephemeral_type>" "<local_name>" {
  setting = value
}

resource "<provider_resource_type>" "<local_name>" {
  write_only_argument         = ephemeral.<ephemeral_type>.<local_name>.result
  write_only_argument_version = 1
}
```

The concrete RDS example generates an ephemeral password and passes it to the AWS provider through the `password_wo` argument:

```hcl
ephemeral "random_password" "db_password" {
  length           = 20
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "app" {
  allocated_storage   = 100
  engine              = "postgres"
  instance_class      = "db.r6g.large"
  db_name             = "billing"
  username            = "billing_admin"
  skip_final_snapshot = false

  password_wo         = ephemeral.random_password.db_password.result
  password_wo_version = 1
}
```

In this example, the password value exists during the current Terraform operation. Terraform sends it to the provider, then omits that value from the plan and state files. The version number gives Terraform a visible change to apply for a later intentional password rotation.

The plan should show the resource and the version, while the raw password remains absent:

```console
  # aws_db_instance.app will be created
  + resource "aws_db_instance" "app" {
      + db_name             = "billing"
      + engine              = "postgres"
      + password_wo_version = 1
      + username            = "billing_admin"
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

This is stronger than only marking a normal `password` variable as sensitive because the write-only value is designed to avoid Terraform state persistence. It still needs careful CI handling. Provider debug logs, shell tracing, wrapper scripts, or application-side logging can expose values outside Terraform's normal plan and state path.

## Provider-Managed Secrets First
<!-- section-summary: Provider-managed secrets let the cloud platform generate or store the secret so Terraform handles references instead of raw values. -->

For databases, many cloud providers offer a way to generate and manage the password. The skeleton is a normal database resource with a provider-managed password setting instead of a password variable:

```hcl
resource "<database_resource_type>" "<local_name>" {
  username                         = "application_admin"
  provider_managed_password_option = true
}
```

In AWS RDS, one common concrete setting is `manage_master_user_password`:

```hcl
resource "aws_db_instance" "app" {
  allocated_storage           = 100
  engine                      = "postgres"
  instance_class              = "db.r6g.large"
  db_name                     = "billing"
  username                    = "billing_admin"
  manage_master_user_password = true
  skip_final_snapshot         = false
}

output "database_endpoint" {
  description = "Database endpoint used by the application."
  value       = aws_db_instance.app.address
}
```

Terraform asks AWS to manage the password. The configuration contains a username and database settings while avoiding a `var.database_password` input. The application should receive permission to read the managed secret at runtime through its identity.

The plan shape should show the managed-secret setting rather than a password:

```console
  # aws_db_instance.app will be created
  + resource "aws_db_instance" "app" {
      + db_name                     = "billing"
      + engine                      = "postgres"
      + manage_master_user_password = true
      + username                    = "billing_admin"
      + master_user_secret          = (known after apply)
    }
```

`manage_master_user_password = true` tells AWS to generate and store the master password. `master_user_secret` appears after apply as provider-managed metadata, so Terraform can connect later IAM permissions to the generated secret without putting the password itself in the configuration.

The Terraform output returns only the database endpoint. The password stays in the provider's secret system. The next piece of Terraform work is usually IAM: grant the application task role, instance profile, or workload identity permission to read the generated secret. That keeps deployment automation away from the raw password.

This differs from the write-only argument example in the previous section. With `manage_master_user_password = true`, AWS generates and manages the master password in AWS Secrets Manager. Terraform manages the database setting and can read metadata about the generated secret, but the team does not supply the password value. With `password_wo`, the team supplies a password for the current operation, and Terraform avoids persisting that supplied value if the provider supports the write-only argument. For new RDS production databases, the managed password option is often cleaner because AWS owns generation and storage from the start.

The same idea exists across platforms in different forms: generated passwords, secret manager integrations, managed identities, Key Vault references, Secrets Manager references, Parameter Store references, or Kubernetes external secret operators. The details vary, but the goal stays the same. Terraform wires the access path while the secret system holds the raw value.

Rotation also belongs in the design. Provider-managed database passwords and secret managers often support rotation workflows. Terraform should create the resources and permissions needed for rotation, then the secret platform should perform routine value changes without a Terraform pull request for every password update.

## Secret References Instead of Values
<!-- section-summary: Passing a secret ARN, name, or path is usually safer than passing the raw secret value through Terraform. -->

Sometimes the secret already exists. In that case, a reference such as an ARN, resource ID, name, or path is safer than the secret value.

`variables.tf`:

```hcl
variable "database_secret_arn" {
  type        = string
  description = "ARN of the database secret the application reads at runtime."
}
```

`main.tf`:

```hcl
resource "aws_iam_policy" "read_database_secret" {
  name = "billing-read-database-secret"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = var.database_secret_arn
      }
    ]
  })
}
```

The plan shows the secret reference while omitting the password:

```console
  # aws_iam_policy.read_database_secret will be created
  + resource "aws_iam_policy" "read_database_secret" {
      + name   = "billing-read-database-secret"
      + policy = jsonencode(
            {
              + Statement = [
                  + {
                      + Action   = [
                          + "secretsmanager:GetSecretValue",
                        ]
                      + Effect   = "Allow"
                      + Resource = "arn:aws:secretsmanager:us-east-1:123456789012:secret:billing/prod/db-AbCdEf"
                    },
                ]
              + Version   = "2012-10-17"
            }
        )
  }
```

The plan shows the policy name and the secret ARN reference while the password stays hidden. That is the intended review shape: reviewers can confirm which secret the role can read without exposing the secret value.

The ARN can still reveal naming and account structure, so treat it with reasonable care. It is still much safer than placing the secret value in Terraform variables, outputs, or state.

Data sources that read secret values need extra review. A data source can pull a secret from a secret manager and pass it into a resource, but that can place the returned value in state. The review question is whether Terraform needs the secret value or only needs to grant runtime permission to read it.

For application configuration, the usual production pattern is:

1. Terraform creates or references the secret location.
2. Terraform grants the runtime identity permission to read that secret.
3. The application reads the secret at startup or request time through the cloud SDK, sidecar, or platform integration.
4. Terraform state stores the reference and IAM policy while the password stays in the secret manager.

## Runtime Identity Reads the Secret
<!-- section-summary: The application should use its deployed identity to read secrets at runtime, while Terraform manages the permission path. -->

A **runtime identity** is the cloud identity attached to the running workload. In AWS this might be a Lambda execution role, ECS task role, EC2 instance profile, or EKS pod identity. In Azure it is often a managed identity. In Google Cloud it is commonly a service account, sometimes reached through Workload Identity. The name changes by platform, but the pattern is the same: the running application receives temporary access from the platform and uses that access to read the secret.

Terraform can wire this without carrying the password. The root module passes the secret reference to the application and grants the runtime role permission to read that one secret:

```hcl
variable "database_secret_arn" {
  type        = string
  description = "ARN of the database secret read by the billing service at runtime."
}

resource "aws_iam_role_policy" "billing_read_database_secret" {
  name = "billing-read-database-secret"
  role = aws_iam_role.billing_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = var.database_secret_arn
      }
    ]
  })
}
```

The application configuration receives a reference:

```hcl
environment = {
  DATABASE_SECRET_ARN = var.database_secret_arn
}
```

The running service then calls the secret manager with its runtime identity. Terraform state stores the environment variable value as the secret ARN and stores the IAM policy. The database password stays in the secret manager and moves to the application through the provider's runtime access path.

This pattern also improves rotation. After the secret manager rotates the password, the ARN or secret name can stay stable. The application reads the current version at startup or through a refresh path, and the team avoids a Terraform change for every password update.

## CI/CD Secret Handling
<!-- section-summary: CI should authenticate to cloud providers with short-lived identity and avoid writing raw secrets into plan files or backend config. -->

Modern Terraform pipelines should use short-lived identity where possible. For example, a CI job can use OIDC to assume a cloud role instead of storing long-lived cloud access keys in repository secrets.

If a pipeline must pass a sensitive Terraform variable, the CI secret store should provide it, the Terraform variable should be marked `sensitive`, and the job should avoid printing the environment. Saved plan files belong in restricted storage because plan files can contain values and backend details.

Backend credentials need the same care. Backend access keys should stay out of `backend.hcl` because backend configuration can be copied into `.terraform/` metadata. Runner identity, managed identity, workload identity, or environment-based credentials should provide backend access.

A safer production pipeline prints context without printing secrets:

```bash
echo "environment=prod"
echo "backend_key=infrastructure/billing/prod/terraform.tfstate"
terraform init -backend-config=backend/prod.s3.hcl
terraform plan -var-file=env/prod.tfvars -out=tfplan
```

`-backend-config` points Terraform at the production state backend, `-var-file` loads production values, and `-out=tfplan` saves the exact planned actions for later review or apply. The context helps reviewers verify the target. The secrets stay in the identity provider or secret manager, and the saved plan file should have restricted access because it can still contain sensitive values or backend details.

The visible output should look boring:

```console
environment=prod
backend_key=infrastructure/billing/prod/terraform.tfstate
Plan: 1 to add, 0 to change, 0 to destroy.
```

The output should name the environment and state target without printing a database password, API key, private key, or token. A debug flag that prints all environment variables should be disabled for Terraform jobs that can see secrets.

Command-line flags such as `-var="database_password=..."` are a risky path for secrets. Shell history, process listings, CI logs, and wrapper debug output can expose them. If Terraform must receive a secret during bootstrap, the CI secret store or environment variable path is safer than a command-line flag. The variable should be marked sensitive, the plan should stay restricted, and the bootstrap path should be replaced with a secret manager reference afterward.

## Plan and State Review
<!-- section-summary: Secret-safe review checks both what the plan prints and what the state backend may store. -->

A secret-aware review follows the value path from code and variables into resources, outputs, plans, and state.

A checklist can look like this:

1. Do any `.tf` or `.tfvars` files contain a raw password, token, private key, or API key?
2. Does a variable accept a raw secret where a secret reference would work?
3. Does the provider offer a managed password or generated secret option?
4. Does any output expose a secret value?
5. Are saved plan files stored with restricted access?
6. Does the state backend have encryption, access control, audit logs, and limited permissions?

The plan hiding a value as `(sensitive value)` is good, but it is only one signal. The state backend may still store the underlying value. Production teams protect state and reduce the number of raw secrets Terraform ever sees.

A recovery runbook for a leaked Terraform secret should include both Terraform and the secret system:

1. Revocation or rotation of the leaked secret in the provider or secret manager.
2. Identification of state, saved plans, CI logs, or local files that received the value.
3. Restricted access to affected artifacts while the incident is reviewed.
4. Terraform code updated to pass a reference or use a managed secret option.
5. A plan that proves Terraform no longer carries the raw value.

State history can retain old secret values through backend versioning. Rotation protects the live system even if old artifacts cannot be fully erased.

## Putting It All Together
<!-- section-summary: Terraform should manage secret wiring and permissions while secret managers and runtime identities handle the raw secret values. -->

Terraform can manage secret-related infrastructure safely by keeping raw values out of normal configuration. Provider-managed passwords, secret manager references, runtime identity, and narrow IAM policies are the safer default. `sensitive` helps with display control, and state still deserves sensitive-data treatment.

![Secrets Summary](/content-assets/articles/article-iac-terraform-environments-secrets/secrets-summary.png)

*The summary board keeps the secret strategy concrete: pass references, protect state, use runtime identity, and control CI logs.*

The dev password in a `.tfvars` file was a useful warning. It showed the easy path and why production teams choose a different path. Terraform should wire the access. The secret manager should hold the secret. The application should read the secret at runtime through its own identity.

The state backend still deserves strong controls because Terraform state can contain sensitive provider data even with safer configuration patterns. Restrict state access, restrict saved plan artifacts, and keep the raw secret path in the secret manager if the provider gives you that option.

---

**References**

- [Terraform: Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Explains how sensitive values interact with configuration, state, plans, and outputs.
- [Terraform: Ephemeral values](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral) - Documents ephemeral values and write-only resource arguments for keeping temporary values out of state and plan files.
- [Terraform: Input variables and sensitive values](https://developer.hashicorp.com/terraform/language/values/variables#suppressing-values-in-cli-output) - Documents `sensitive = true` for variables.
- [Terraform: State](https://developer.hashicorp.com/terraform/language/state) - Explains the role of state and why state access matters.
- [Terraform: Backend configuration](https://developer.hashicorp.com/terraform/language/backend) - Documents backend setup for remote state storage.
- [AWS provider: `aws_db_instance`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/db_instance) - Documents `manage_master_user_password`, `master_user_secret`, and write-only password arguments for RDS instances.
- [AWS RDS: Managed master user passwords](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html) - Documents RDS integration with AWS Secrets Manager for managed master credentials.
