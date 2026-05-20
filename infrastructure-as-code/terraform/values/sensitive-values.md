---
title: "Sensitive Values"
description: "Handle Terraform passwords, tokens, and other sensitive values with clear redaction, state protection, and secret-management boundaries."
overview: "Sensitive values need more than a hidden CLI display. This article follows the orders AWS environment through a database password example and explains what Terraform redacts, what it can still store, and when to use a secret manager instead."
tags: ["terraform", "opentofu", "sensitive-values", "state", "secrets"]
order: 6
id: article-infrastructure-as-code-terraform-sensitive-values
---

## Table of Contents

1. [What Counts as Hidden](#what-counts-as-hidden)
2. [Sensitive Values](#sensitive-values)
3. [Sensitive Variables](#sensitive-variables)
4. [Sensitive Outputs](#sensitive-outputs)
5. [State Still Matters](#state-still-matters)
6. [Database Passwords](#database-passwords)
7. [Safer Patterns](#safer-patterns)
8. [Common First Mistakes](#common-first-mistakes)
9. [Putting It All Together](#putting-it-all-together)

## What Counts as Hidden

The orders Terraform module now has a value flow. Variables bring in choices. Locals name internal decisions. Outputs expose selected results.

That is fine for VPC CIDRs, instance types, tags, and IDs. A database password raises a different question: if Terraform needs the password to create or configure infrastructure, where does that password appear?

A team might start with this input:

```hcl
variable "db_password" {
  description = "Password for the orders database administrator."
  type        = string
}
```

Then someone runs a plan and sees the password in output, logs, or state. Marking the variable sensitive is the next step, but it is easy to misunderstand what that step does.

Sensitive handling is about two separate controls:

- Redaction: whether Terraform hides a value from normal CLI and UI display.
- Storage: whether Terraform, the provider, state, plan files, logs, or another system retain the value.

The sensitive flag helps with redaction. It does not turn Terraform state into a secret manager.

## Sensitive Values

Terraform can mark variables and outputs as sensitive. When a value is sensitive, Terraform redacts it from normal plan and apply display. Expressions that depend on a sensitive value are also treated as sensitive.

That display behavior prevents accidental leaks in common places:

```text
db_password = (sensitive value)
```

This is useful and worth doing. It keeps routine terminal output, pull request comments, and copied plan text from showing the secret directly.

The redaction boundary has limits. Terraform may still need the real value to call a provider. State may still contain sensitive values. Some commands and machine-readable output modes can reveal sensitive outputs because they are designed for automation. Anyone who can read the state or the selected output may still be able to read the secret.

Treat `sensitive = true` as a display control. Then design storage and access controls separately.

## Sensitive Variables

A sensitive input variable looks like this:

```hcl
variable "db_password" {
  description = "Password for the orders database administrator."
  type        = string
  sensitive   = true
}
```

If a resource uses that value, Terraform tries to avoid printing the password in normal plan and apply output:

```hcl
resource "aws_db_instance" "orders" {
  identifier             = "${local.name_prefix}-db"
  engine                 = "postgres"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  username               = "orders_admin"
  password               = var.db_password
  skip_final_snapshot    = true
  vpc_security_group_ids = [aws_security_group.db.id]
}
```

The variable declaration makes the input value sensitive. The resource still receives the password because AWS needs it to configure the database. If the provider stores that value or enough related data in state, the backend must be protected as sensitive infrastructure.

How the value is supplied also matters. A local `terraform.tfvars` file with a real password is dangerous if it can be committed. A shell export can leak through shell history, CI logs, or debugging output if the pipeline is careless. A CI secret store or a dedicated secret manager is usually a better source for real credentials.

## Sensitive Outputs

Outputs can be sensitive too:

```hcl
output "db_password" {
  description = "Database administrator password for a downstream bootstrap step."
  value       = var.db_password
  sensitive   = true
}
```

This output should be rare. A password output means the module is deliberately sending a secret outward. Sometimes a temporary bootstrap workflow needs that, but most systems should read secrets from a secret manager or runtime secret injection path instead of from Terraform outputs.

A non-secret database output is usually more appropriate:

```hcl
output "db_endpoint" {
  description = "Hostname and port for the orders database endpoint."
  value       = aws_db_instance.orders.endpoint
}
```

The endpoint helps applications and operators find the database. The password should follow a stricter path.

Sensitive outputs also have a sharp CLI caveat. Terraform redacts sensitive outputs in normal summary output, but commands intended to extract a specific output or produce machine-readable data can reveal the value. That is useful for automation that truly needs the secret. It is risky when logs capture those commands.

## State Still Matters

Terraform state is the main caveat for sensitive values.

State is Terraform's record of managed objects and their attributes. Providers can place values in state because Terraform needs them to compare configuration, detect drift, plan updates, or remember generated results.

For sensitive values, that means:

- Marking a variable sensitive can hide normal CLI display.
- Marking an output sensitive can hide normal output display.
- State access can still expose values Terraform or a provider stored.
- Plan files and automation artifacts can also become sensitive when they include real values.

This is why backend security is part of secret handling. A remote state backend should have restricted access, encryption, auditability, and careful separation between environments. A production state reader may effectively be a production secret reader.

The values submodule connects directly to the state article for this reason. Sensitive inputs are a value concern, but state protection is the control that decides who can read retained values later.

## Database Passwords

A database password is a good example because it looks simple and creates several hidden paths.

The root module might accept a password:

```hcl
variable "db_password" {
  description = "Password for the orders database administrator."
  type        = string
  sensitive   = true
}
```

Development might supply it through a local ignored file:

```hcl
db_password = "replace-this-dev-password"
```

CI might supply it through a secret variable:

```bash
export TF_VAR_db_password="$ORDERS_DB_PASSWORD"
terraform plan
```

The sensitive flag reduces accidental display, but the team still has to answer storage questions:

| Place | Review question |
| --- | --- |
| tfvars file | Can this file be committed, copied, or read by the wrong people? |
| CI secret store | Who can edit or reveal the secret variable? |
| plan artifact | Does the pipeline upload a plan file with sensitive data? |
| state backend | Who can read current and historical state? |
| outputs | Does any output intentionally expose the password? |
| AWS tags or names | Did anyone put the secret in metadata that many systems can read? |

For AWS databases, a stronger pattern is often to let AWS Secrets Manager or an RDS-managed secret own the password lifecycle, then give the application permission to read the secret at runtime. Terraform can create the infrastructure and wire permissions without making a long-lived password a normal module output.

The exact design depends on the service, provider support, and organization. The habit is stable: keep credentials in a system built to store and rotate credentials, and keep Terraform outputs focused on infrastructure identifiers and connection metadata.

## Safer Patterns

Sensitive values need a chain of controls, not one flag.

Use `sensitive = true` on variables and outputs that contain secrets:

```hcl
variable "db_password" {
  description = "Password for the orders database administrator."
  type        = string
  sensitive   = true
}
```

Keep real secret value files out of version control. If the repository needs an example, use a placeholder file that cannot be mistaken for a real credential:

```hcl
db_password = "set-this-through-your-secret-source"
```

Protect the backend as sensitive infrastructure. State readers should be reviewed like people who can inspect credentials and private configuration.

Use secret managers for runtime secrets. In AWS, Secrets Manager and RDS-managed secrets can keep database credentials under a service designed for access control and rotation. Terraform can manage the secret container, policy, and references, while applications retrieve the secret through their runtime identity.

Use newer Terraform sensitive-data features when they fit the provider path. Ephemeral variables, child module ephemeral outputs, and provider write-only arguments are designed for cases where a value can be used without persisting it to state or plan files. They come with restrictions, so use them deliberately rather than assuming every password can become ephemeral automatically.

Avoid secrets in tags, names, descriptions, and output names. Metadata spreads into consoles, logs, inventory tools, billing exports, and search indexes. A secret in metadata is hard to contain.

## Common First Mistakes

**Thinking sensitive means encrypted storage.** The sensitive flag redacts normal display. Backend encryption and access control are separate requirements.

**Outputting passwords for convenience.** A sensitive output can still be retrieved by commands and automation. Prefer secret-manager delivery for application credentials.

**Committing real tfvars secrets.** A value file is easy to review, but real secrets need an approved storage path and should not land in ordinary repository history.

**Ignoring plan files.** Saved plan artifacts can contain enough information to be sensitive. Treat them with the same care as state.

**Putting secrets in tags.** Tags and names are metadata. They are widely visible and often copied into logs, bills, inventories, and dashboards.

## Putting It All Together

The values story is complete when each value has a clear direction and a clear protection level.

For ordinary environment choices:

- Variables bring values in.
- Tfvars files, command flags, or CI settings supply those variables.
- Locals derive names and tags inside the module.
- Outputs expose selected IDs and addresses after apply.

For sensitive values:

- Mark sensitive variables and outputs so normal display is redacted.
- Avoid exposing secrets through outputs unless a real consumer requires it.
- Protect state, plan files, and backend access because sensitive values can still be retained.
- Prefer AWS Secrets Manager, RDS-managed secrets, CI secret stores, or other dedicated systems for long-lived credentials.

The orders module can safely parameterize VPC CIDRs, environments, instance types, allowed CIDRs, tags, names, and infrastructure IDs. Database passwords need a stricter path. Terraform can participate in that path, but the secret boundary has to include the systems that store, rotate, log, and read the value after the apply is done.

---

**References**

- [Manage sensitive data in your configuration](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - Terraform guide to sensitive values, ephemeral values, write-only arguments, and state handling.
- [Use input variables to add module arguments](https://developer.hashicorp.com/terraform/language/values/variables) - Terraform guide to sensitive input variables and variable assignment methods.
- [Output block reference](https://developer.hashicorp.com/terraform/language/block/output) - Language reference for sensitive outputs, ephemeral child module outputs, and output validation.
- [terraform output command reference](https://developer.hashicorp.com/terraform/cli/commands/output) - CLI reference explaining how output commands display sensitive values in different modes.
- [Securing sensitive data by using AWS Secrets Manager and HashiCorp Terraform](https://docs.aws.amazon.com/prescriptive-guidance/latest/secure-sensitive-data-secrets-manager-terraform/introduction.html) - AWS Prescriptive Guidance for secret management patterns with Terraform and Secrets Manager.
- [Password management with Amazon RDS and AWS Secrets Manager](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html) - Amazon RDS documentation for managing master user passwords with Secrets Manager.
