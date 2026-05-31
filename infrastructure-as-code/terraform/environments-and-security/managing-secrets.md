---
title: "Managing Secrets"
description: "Keep database passwords, API keys, and private certificates out of your Terraform code and state file without blocking your automation pipelines."
overview: "Secrets are the hardest part of infrastructure automation. They need to reach your cloud resources, but they must not appear in version control, CI/CD logs, or shared state files. This article covers the practical options for injecting secrets into Terraform without exposing them."
tags: ["secrets", "security", "vault", "aws secrets manager", "terraform"]
order: 3
id: article-iac-terraform-environments-secrets
---

## Table of Contents

1. [The Secret Problem](#the-secret-problem)
2. [What You Should Never Do](#what-you-should-never-do)
3. [Environment Variables: The Simplest Safe Option](#environment-variables-the-simplest-safe-option)
4. [AWS Secrets Manager as a Data Source](#aws-secrets-manager-as-a-data-source)
5. [Azure Key Vault as a Data Source](#azure-key-vault-as-a-data-source)
6. [HashiCorp Vault as a Provider](#hashicorp-vault-as-a-provider)
7. [Encrypted Variable Files with Age or SOPS](#encrypted-variable-files-with-age-or-sops)
8. [The State File Problem](#the-state-file-problem)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Secret Problem

A database password needs to reach your Terraform configuration so it can be set on the RDS instance. An API key needs to reach a Lambda function's environment variables. A TLS private key needs to be stored in AWS Certificate Manager.

![Secret inputs should come from runtime sources or vaults while plaintext secrets stay out of versioned code.](/content-assets/articles/article-iac-terraform-environments-secrets/secret-input-boundary.png)

The natural instinct is to put these values in a `.tfvars` file alongside your other variable values and pass it to `terraform apply`. That works mechanically, but it creates a risk: if that file is committed to your Git repository, every person who has ever cloned the repository has access to that secret, forever, even if you delete the file later. Git history is permanent.

Even if you keep the file off of Git, storing secrets in plain text files on engineers' laptops or on CI/CD servers is risky. Laptops get lost. Build servers get compromised. Environment variables in shell scripts get logged. Every path a secret takes is a potential exposure point.

Managing secrets for infrastructure automation requires thinking carefully about every place a secret appears — in the running configuration, in the plan output, in the state file, in the CI/CD logs — and ensuring that none of those places is accessible to anyone who should not have the secret.

## What You Should Never Do

**Never commit secrets to version control.** Not in `.tfvars` files, not in `main.tf`, not in `locals.tf`, not as default values in variable declarations. Once a secret is committed to Git, it exists in the history of every clone of that repository. Removing it requires rewriting history, which disrupts every developer who has a copy.

**Never hardcode secrets in Terraform code.** Writing `password = "MyS3cr3tP@ssw0rd"` directly in a resource block is the equivalent of writing it on a whiteboard in the office. It is visible to everyone who reads the code and to every CI/CD system that runs it.

**Never use default values for secret variables.** A variable declaration like:
```hcl
variable "db_password" {
  type    = string
  default = "changeme"
}
```
is useless. Every deployment that does not override the default uses the same obvious password, and the default is visible in the code.

**Do not log secrets in CI/CD pipelines.** If your deployment script echoes variable values to the console, make sure secret variables are excluded. Most CI/CD systems (GitHub Actions, GitLab CI, CircleCI) have mechanisms for masking secret values in logs — use them.

## Environment Variables: The Simplest Safe Option

The simplest way to pass a secret to Terraform without putting it in a file is through an environment variable. Terraform reads any environment variable named `TF_VAR_<variable_name>` and uses it as the value for the corresponding variable.

For a variable called `db_password`:

```bash
export TF_VAR_db_password="$(aws secretsmanager get-secret-value \
  --secret-id prod/app/db_password \
  --query SecretString \
  --output text)"

terraform apply
```

The secret is fetched from AWS Secrets Manager (using an AWS CLI call that is not logged), stored in a shell environment variable, and picked up by Terraform automatically. It is never written to a file. It is never in the Terraform code. It appears in the `terraform apply` output only as `(sensitive value)` because you declared the variable with `sensitive = true`.

In a CI/CD system like GitHub Actions, you inject secrets through the platform's secret store and reference them as environment variables in your workflow:

```yaml
- name: Apply Terraform
  env:
    TF_VAR_db_password: ${{ secrets.PROD_DB_PASSWORD }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  run: |
    cd environments/prod
    terraform init
    terraform apply -auto-approve
```

GitHub Actions masks `${{ secrets.* }}` values in log output automatically. The secret never appears in the build log. It is injected directly into the environment of the Terraform process.

This approach has one limitation: the secret must exist somewhere before the pipeline runs. In the example above, `PROD_DB_PASSWORD` must be configured in GitHub Actions' secrets settings. Someone has to put it there, and changing it means updating it in the CI/CD platform. For organizations that rotate secrets frequently, this becomes a maintenance burden.

## AWS Secrets Manager as a Data Source

A more integrated approach is to store secrets in AWS Secrets Manager (or AWS Systems Manager Parameter Store) and have Terraform read them directly during apply, using a data source.

This approach requires that the IAM role Terraform is running as has permission to read the specific secret. The Terraform configuration does not contain the secret value; it contains only the name of the secret to look up. The important caveat is state: once Terraform reads the secret and passes it into a resource argument, that value may still be stored in Terraform state if the provider schema stores that argument.

```hcl
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "prod/app/db-password"
}

resource "aws_db_instance" "main" {
  engine            = "postgres"
  instance_class    = "db.t3.medium"
  allocated_storage = 20
  username          = "appuser"
  password          = data.aws_secretsmanager_secret_version.db_password.secret_string
  skip_final_snapshot = true
}
```

When Terraform runs, it makes an API call to AWS Secrets Manager to retrieve the current value of `prod/app/db-password`. The value is then passed to the RDS resource. The secret value is never in the code — only the secret's name is.

This approach integrates naturally with secret rotation. AWS Secrets Manager can automatically rotate secrets on a schedule. Each time Terraform applies, it reads the current value. However, there is a subtle issue: if the secret is rotated between Terraform runs but the database password is already set on the RDS instance, Terraform will read the new secret value and see it differs from what is stored in state. It may propose to update the database password, which could cause a brief outage.

For this reason, some teams use AWS Secrets Manager to manage the initial creation of the password but then let the rotation happen outside of Terraform, using `lifecycle { ignore_changes = [password] }` on the RDS resource to tell Terraform not to update the password attribute after the initial creation.

AWS Systems Manager Parameter Store is an alternative to Secrets Manager. SecureString parameters are encrypted with KMS and accessed through a similar data source:

```hcl
data "aws_ssm_parameter" "db_password" {
  name            = "/prod/app/db-password"
  with_decryption = true
}
```

Parameter Store is simpler and cheaper than Secrets Manager (no per-secret monthly cost) but lacks some of Secrets Manager's features like automatic rotation for RDS and automatic credential distribution to applications.

## Azure Key Vault as a Data Source

On Azure, the equivalent secret store is Azure Key Vault. Terraform can read an existing Key Vault secret with the AzureRM provider and pass the value into resources:

```hcl
data "azurerm_key_vault" "platform" {
  name                = "kv-prod-platform"
  resource_group_name = "rg-prod-security"
}

data "azurerm_key_vault_secret" "db_password" {
  name         = "db-password"
  key_vault_id = data.azurerm_key_vault.platform.id
}
```

This keeps the secret out of Git and out of `.tfvars` files, and Azure Key Vault gives you access policies or RBAC, audit logging, and integration with managed identities. The same state warning still applies: reading a secret from Key Vault does not magically keep it out of Terraform state if you pass the secret value into a Terraform-managed resource attribute. Prefer platform features where the application reads the secret directly from Key Vault at runtime, or provider-supported write-only/ephemeral patterns where available.

## HashiCorp Vault as a Provider

For organizations that use HashiCorp Vault for secrets management across multiple systems, Terraform has a Vault provider that can read secrets directly from Vault:

```hcl
provider "vault" {
  address = "https://vault.example.com"
}

data "vault_generic_secret" "db_password" {
  path = "secret/prod/app/db"
}

resource "aws_db_instance" "main" {
  password = data.vault_generic_secret.db_password.data["password"]
}
```

The Vault provider authenticates to Vault using whatever auth method is configured — AWS IAM auth (Vault verifies the IAM role making the call), Kubernetes service account tokens, or a Vault token injected as an environment variable. The secret value is read at apply time and never committed to code or checked into version control.

Vault is the most sophisticated option because it provides fine-grained access control (you can restrict which Vault paths specific IAM roles or Kubernetes service accounts can read), comprehensive audit logging, and automatic secret leasing and revocation. But it requires running and maintaining a Vault cluster, which is a significant operational commitment.

## Encrypted Variable Files with Age or SOPS

Some teams prefer to commit their variable files to version control but encrypt the secret values before committing. The secret is stored alongside the rest of the configuration, but encrypted in a way that only authorized people and machines can decrypt.

SOPS (Secrets OPerationS, originally from Mozilla, now maintained as a community project) is the most common tool for this. It encrypts specific keys in YAML, JSON, or INI files using AWS KMS, GCP KMS, Azure Key Vault, or age (a modern encryption tool). The structure of the file is visible (you can see which keys exist), but the values are encrypted.

A SOPS-encrypted `.tfvars` file looks like:

```yaml
db_password: ENC[AES256_GCM,data:abc123...,iv:xyz...,tag:def...,type:str]
api_key: ENC[AES256_GCM,data:ghi456...,iv:mno...,tag:pqr...,type:str]
region: us-east-1
```

The `region` value is not sensitive and is stored in plain text. The `db_password` and `api_key` values are encrypted. Anyone who clones the repository sees the encrypted values; only someone with access to the KMS key can decrypt them.

To use the file, you decrypt it and pass it to Terraform:

```bash
sops --decrypt terraform.tfvars.enc > /tmp/terraform.tfvars
terraform apply -var-file=/tmp/terraform.tfvars
rm /tmp/terraform.tfvars
```

Or you can use `sops exec-env` to inject decrypted values directly as environment variables without writing them to disk.

The advantage of this approach is that secrets live in the repository alongside the configuration — versioned, audited, and reviewable (as encrypted blobs). The disadvantage is that managing KMS key access and SOPS configuration adds operational complexity.

## The State File Problem

All of the approaches above protect secrets while they are in transit to Terraform. But as discussed in the state article, the state file stores every attribute of every resource — including secrets — in plain text.

![Sensitive values can be redacted in display output while the real values may still exist inside protected state.](/content-assets/articles/article-iac-terraform-environments-secrets/sensitive-state-flow.png)

If your RDS password ends up as an attribute of the `aws_db_instance` resource in state, it is in the state file. If your TLS private key is generated by the `tls_private_key` resource, the private key material is in the state file. No amount of careful secret injection protects these values once they are in state.

The first line of defense is to restrict access to the state file. For the S3 backend, this means:

Enabling server-side encryption on the bucket (using the `encrypt = true` backend setting and optionally a KMS key).

Configuring an S3 bucket policy that allows access only to specific IAM roles — the roles used by your CI/CD pipeline and by engineers who need to run Terraform. Deny access to everyone else, including other AWS accounts.

Enabling S3 access logging so you have a record of every time the state file is accessed.

Avoiding the temptation to download and examine state files casually. Treat the state file as you would treat the secrets database itself — with the same access controls and the same care.

For particularly sensitive values, Terraform's `sensitive` markings help with display, but they do not affect what is stored in state. The `nonsensitive()` function does the opposite of protection: it removes the sensitive marking from a value, so use it only when you intentionally want a derived, non-secret value to be printable. Newer Terraform and provider features can also help when available, including ephemeral values and provider-supported write-only arguments. The strongest structural solution is still to avoid storing the secret in Terraform-managed resource state at all, for example by letting an application read from AWS Secrets Manager or Azure Key Vault directly at runtime.

## Putting It All Together

Secret management for Terraform is a set of overlapping safeguards, not a single solution.

Secrets stay out of the code through variable declarations without defaults and the `sensitive = true` attribute. Secrets stay out of version control through environment variables, data sources reading from a secrets manager, or SOPS-encrypted files. Secrets stay out of CI/CD logs through CI/CD platform secret stores and the `sensitive` marking that suppresses output. Secrets in state are protected by restricting access to the state file with IAM policies and encryption.

The simplest starting point for most teams is environment variables sourced from your CI/CD platform's secret store (GitHub Actions secrets, GitLab CI/CD variables, CircleCI contexts). As the organization grows and secret management becomes more complex, graduating to AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault provides centralized control, rotation, and audit logging.

## What's Next

With secrets safely managed, the next module moves into advanced configuration techniques: how to use loops and conditionals to create many similar resources from a single resource block, and how to deploy infrastructure changes without causing downtime.


![Secrets summary: keep secrets out of code, read them at runtime, mark sensitive values, and protect state.](/content-assets/articles/article-iac-terraform-environments-secrets/secrets-summary.png)

---

**References**

- [Sensitive Data in State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/sensitive-data) — Official guidance on what ends up in state and how to protect it.
- [Manage Sensitive Data in Terraform (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) — Official guidance on sensitive, ephemeral, and write-only handling.
- [AWS Secrets Manager Data Source (HashiCorp)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/secretsmanager_secret_version) — Reference for reading secrets from AWS Secrets Manager during Terraform applies.
- [Azure Key Vault Basic Concepts (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/key-vault/general/basic-concepts) — Microsoft overview of Key Vault, secrets, keys, certificates, access control, and auditing.
- [SOPS: Secrets OPerationS](https://github.com/getsops/sops) — The SOPS tool for encrypting files with KMS or age, compatible with Terraform variable files.
- [Vault Provider for Terraform](https://registry.terraform.io/providers/hashicorp/vault/latest/docs) — Reference for the HashiCorp Vault Terraform provider and available data sources.
