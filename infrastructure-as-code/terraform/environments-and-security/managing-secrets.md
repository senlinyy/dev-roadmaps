---
title: "Managing Secrets"
description: "Keep database passwords, API keys, and private certificates out of your Terraform code and state file without blocking your automation pipelines."
overview: "Terraform can mark values as sensitive, but state still needs strong protection. This article shows safer secret patterns, where secret-related values are consumed in .tf files, how plans display them, and how teams avoid turning Terraform into a secret store."
tags: ["secrets", "security", "vault", "aws secrets manager", "terraform"]
order: 3
id: article-iac-terraform-environments-secrets
---

## Table of Contents

1. [The Secret Problem in Terraform](#the-secret-problem-in-terraform)
2. [What sensitive Actually Does](#what-sensitive-actually-does)
3. [Prefer Provider-Managed Secrets](#prefer-provider-managed-secrets)
4. [Passing Secret References Instead of Secret Values](#passing-secret-references-instead-of-secret-values)
5. [CI/CD Secret Handling](#cicd-secret-handling)
6. [Plan and State Review](#plan-and-state-review)
7. [Putting It All Together](#putting-it-all-together)

## The Secret Problem in Terraform
<!-- section-summary: Terraform often touches secret-related infrastructure, but raw secret values can leak through code, plans, logs, and state. -->

A **secret** is a value that grants access or protects private data. Database passwords, API keys, private keys, OAuth client secrets, and signing tokens all count. Terraform often creates the infrastructure around secrets, so it is easy to accidentally pass raw secret values through Terraform.

The danger is state. Terraform state can store resource attributes and output values. If a raw password is passed into a resource argument, Terraform may store it so future plans can compare configuration and real infrastructure. Marking a value as sensitive hides normal display, but it does not turn state into a vault.

The safer direction is to keep raw secret values in a secret manager or let the provider generate and manage them. Terraform should create references, policies, and wiring where possible, while applications read secrets at runtime through their identity.

## What sensitive Actually Does
<!-- section-summary: sensitive hides CLI display for values, but state and provider behavior still decide where the value is stored. -->

Terraform variables and outputs can be marked sensitive:

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

```hcl
Changes to Outputs:
  + bootstrap_token = (sensitive value)
```

This protects terminal output and CI logs from casual exposure. It does not guarantee the value is absent from state. If Terraform needs to remember the value for an output or resource argument, the state backend still needs strong protection.

Use `sensitive` for display control. Use secret managers, provider-managed secrets, and state access control for actual secret protection.

## Prefer Provider-Managed Secrets
<!-- section-summary: Provider-managed secrets let the cloud platform generate or store the secret so Terraform handles references instead of raw values. -->

For databases, prefer a provider feature that generates and manages the password when available. In AWS RDS, one practical pattern is `manage_master_user_password`:

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

The resource consumes a username and asks AWS to manage the password. Terraform does not need a `var.database_password` value. The plan shows the endpoint as provider-generated:

```hcl
  # aws_db_instance.app will be created
  + resource "aws_db_instance" "app" {
      + address                     = (known after apply)
      + db_name                     = "billing"
      + manage_master_user_password = true
      + username                    = "billing_admin"
    }

Changes to Outputs:
  + database_endpoint = (known after apply)
```

The application should receive permission to read the managed secret at runtime. Terraform can manage the IAM policy, but the app identity should fetch the secret directly from the secret service.

## Passing Secret References Instead of Secret Values
<!-- section-summary: Passing a secret ARN, name, or path is usually safer than passing the raw secret value through Terraform. -->

Sometimes Terraform needs to connect an application to a secret that already exists. Prefer passing a secret reference, such as an ARN or path, rather than the secret value.

In `variables.tf`:

```hcl
variable "database_secret_arn" {
  type        = string
  description = "ARN of the database secret the application reads at runtime."
}
```

In `main.tf`, the IAM policy consumes the ARN:

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

The plan shows the reference value but not the secret contents:

```hcl
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

The ARN is still sensitive in some organizations because it reveals structure, but it is much safer than passing the password itself.

:::expand[Data sources can pull secrets into state]{kind="pitfall"}
Terraform data sources can read existing secret values from a secret manager. That can be useful for a narrow bootstrap workflow, but it can also pull the secret value into state if the provider returns it as an attribute and another resource consumes it.

Before using a secret-value data source, ask whether Terraform truly needs the value or only needs the secret reference. Most application stacks only need to grant runtime identity permission to read the secret. The app then calls the secret manager when it starts.

If Terraform must handle a raw secret during a migration, keep the run small, protect the state backend, avoid exposing the value through outputs, and remove the secret path from Terraform once the migration is complete.
:::

## CI/CD Secret Handling
<!-- section-summary: CI should authenticate to cloud providers with short-lived identity and avoid writing raw secrets into plan files or backend config. -->

Modern Terraform pipelines should use short-lived workload identity where possible. For example, a GitHub Actions workflow can use OIDC to assume a cloud role. That avoids long-lived cloud access keys in repository secrets.

If a pipeline must supply a Terraform variable that is sensitive, use the CI secret store and mark the Terraform variable sensitive. Keep in mind that saved plan files can capture values and backend configuration. Do not upload plan files to broad-access artifact stores.

Backend credentials deserve extra care. Do not hardcode backend access keys in `backend.hcl`. Backend config can be copied into `.terraform/` metadata and saved plans. Use the runner identity or environment-based credentials instead.

## Plan and State Review
<!-- section-summary: Secret-safe review checks both what the plan prints and what the state backend may store. -->

A secret-aware plan review asks these questions:

1. Does any `.tf` file contain a raw password, token, private key, or API key?
2. Does a variable accept a raw secret where a secret reference would work?
3. Does any output expose a secret value?
4. Does the provider offer a managed password or generated secret option?
5. Does the state backend have encryption, access control, audit logs, and limited automation permissions?

The plan may hide sensitive values, but the absence of printed text is not the whole security story. Follow the value path through variables, resources, outputs, and state.

## Putting It All Together
<!-- section-summary: Terraform should manage secret wiring and permissions while secret managers and runtime identities handle the raw secret values. -->

Terraform can safely manage secret infrastructure when the design keeps raw secret values out of normal configuration. Prefer provider-managed passwords, secret references, runtime identity, and narrow IAM policies. Use `sensitive` for display control and protect state as sensitive data.

For official reference, use Terraform's docs for [managing sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data), [sensitive variables and outputs](https://developer.hashicorp.com/terraform/language/values/variables#suppressing-values-in-cli-output), [state](https://developer.hashicorp.com/terraform/language/state), and [backend configuration](https://developer.hashicorp.com/terraform/language/backend).
