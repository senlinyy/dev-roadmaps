---
title: "Output Values"
description: "Expose important information from your Terraform configuration so operators and scripts can use it."
overview: "Output values are the data a Terraform root module publishes after planning and applying. This article shows where outputs are declared, how they consume resource attributes, how humans and scripts read them, and how output changes appear in plans."
tags: ["outputs", "output values", "terraform", "hcl"]
order: 7
id: article-iac-terraform-values-outputs
aliases:
  - infrastructure-as-code/terraform/values/outputs.md
---

## Table of Contents

1. [The Value Someone Needs After Apply](#the-value-someone-needs-after-apply)
2. [Declaring Outputs](#declaring-outputs)
3. [Outputs Consuming Resources and Locals](#outputs-consuming-resources-and-locals)
4. [Humans and Scripts Using Outputs](#humans-and-scripts-using-outputs)
5. [Output Changes in Plans](#output-changes-in-plans)
6. [Sensitive Outputs and State](#sensitive-outputs-and-state)
7. [Putting It All Together](#putting-it-all-together)

## The Value Someone Needs After Apply
<!-- section-summary: Outputs publish useful results so people and scripts can use Terraform-managed values without guessing. -->

After Terraform creates the orders export bucket, someone needs the bucket name. A deployment script might upload generated reports there. An operator might verify it in the cloud console. A smoke test might fetch a website URL.

An **output value** is a named result a Terraform configuration publishes. The **root module** is the folder where you run Terraform, and its outputs can appear in CLI output and be read with `terraform output`.

Outputs solve a simple problem. Many useful infrastructure values are generated, assembled, or returned by providers. Instead of copying those values into chat or a wiki, Terraform can publish them from the same configuration that manages the resource.

Good outputs have an audience. If no human, script, deployment job, or verification step uses the value, the output may only add noise.

Later, reusable modules use outputs as contracts too, but the first habit is simpler: publish only the values someone actually needs after the run.

Root module outputs have a second job: they help operations after apply. A smoke test can read an endpoint, a deployment step can read a bucket name, and an operator can verify a URL. Those workflows should consume outputs instead of copying values from plan logs or cloud consoles.

## Declaring Outputs
<!-- section-summary: An output block gives a result a public name, description, value expression, and optional sensitivity setting. -->

Outputs usually live in `outputs.tf`, and Terraform's [output values documentation](https://developer.hashicorp.com/terraform/language/values/outputs) explains the full block behavior. One useful first value is the bucket name a deployment job or operator needs:

![Output Boundary](/content-assets/articles/article-iac-terraform-values-outputs/output-boundary.png)

*The boundary view shows outputs as the values Terraform intentionally publishes for people and scripts.*

```hcl
output "exports_bucket_name" {
  description = "Name of the S3 bucket that stores order export files."
  value       = aws_s3_bucket.orders_exports.bucket
}
```

The output label is the public name. The `value` expression can read resources, variables, locals, and functions. The description should explain why the configuration exposes the value.

The same file can publish a second value for IAM wiring:

```hcl
output "exports_bucket_arn" {
  description = "ARN of the order exports bucket for IAM policy wiring."
  value       = aws_s3_bucket.orders_exports.arn
}
```

The official output reference also includes optional settings such as `sensitive` and `depends_on`. The `depends_on` setting is an explicit dependency control, and the next article covers dependency design. Most beginner outputs only need `description` and `value`. Extra settings belong in the block only for a clear reason.

Output names should be stable and boring because scripts and operational notes may depend on them. `exports_bucket_arn` communicates more than a vague name such as `bucket`. The description should say what the value is for, especially for configurations that expose several similar IDs or ARNs.

## Outputs Consuming Resources and Locals
<!-- section-summary: Outputs should show a clear path from declared values and managed resources to the published result. -->

Here is the resource and local setup that feeds the outputs:

```hcl
locals {
  name_prefix = "devpolaris-${var.service_name}-${var.environment}"
}

resource "aws_s3_bucket" "orders_exports" {
  bucket = "${local.name_prefix}-exports"
}
```

The output can consume the resource attribute:

```hcl
output "exports_bucket_name" {
  description = "Name of the S3 bucket that stores order export files."
  value       = aws_s3_bucket.orders_exports.bucket
}
```

It can also publish a shaped value for a real consumer:

```hcl
output "exports_upload_command" {
  description = "Example AWS CLI command for uploading generated order exports."
  value       = "aws s3 cp ./exports s3://${aws_s3_bucket.orders_exports.bucket}/ --recursive"
}
```

The generated command copies the local `./exports` directory to the Terraform-managed bucket. The `s3://.../` part is the destination URI, and `--recursive` means upload the directory contents instead of a single file. This is useful for a training workflow; production projects usually expose the bucket name or URI and let scripts own the command.

Shaped outputs need care. A command output can help a training project or operator workflow, but production projects usually expose stable IDs, ARNs, names, endpoints, and URLs rather than long procedural strings.

Outputs can publish structured values too:

```hcl
output "orders_storage" {
  description = "Storage identifiers used by orders API deployment and IAM wiring."
  value = {
    bucket_name = aws_s3_bucket.orders_exports.bucket
    bucket_arn  = aws_s3_bucket.orders_exports.arn
    upload_uri  = "s3://${aws_s3_bucket.orders_exports.bucket}/daily/"
  }
}
```

Structured outputs are useful for values that belong together. They can also make scripts slightly more complex, so choose the shape based on the consumer. A shell script often prefers a single raw string.

## Humans and Scripts Using Outputs
<!-- section-summary: Outputs are consumed through terraform output and automation commands. -->

After apply, a human can read outputs:

```bash
terraform output
terraform output exports_bucket_name
```

The first command lists every root output in a human-readable form. The second command reads only the named output, usually as a quoted value such as `"devpolaris-orders-api-prod-exports"`.

The output might look like this:

```console
exports_bucket_arn = "arn:aws:s3:::devpolaris-orders-api-prod-exports"
exports_bucket_name = "devpolaris-orders-api-prod-exports"
```

Those lines are the values from the output blocks after Terraform has applied and recorded the resource attributes in state.

A script can ask for JSON:

```bash
terraform output -json > terraform-outputs.json
```

The JSON form writes structured output metadata to `terraform-outputs.json`. Each output includes `sensitive`, `type`, and `value`, so scripts can read the value field directly instead of scraping terminal formatting.

The saved JSON file would contain entries shaped like this:

```json
{
  "exports_bucket_name": {
    "sensitive": false,
    "type": "string",
    "value": "devpolaris-orders-api-prod-exports"
  },
  "orders_storage": {
    "sensitive": false,
    "type": [
      "object",
      {
        "bucket_arn": "string",
        "bucket_name": "string",
        "upload_uri": "string"
      }
    ],
    "value": {
      "bucket_arn": "arn:aws:s3:::devpolaris-orders-api-prod-exports",
      "bucket_name": "devpolaris-orders-api-prod-exports",
      "upload_uri": "s3://devpolaris-orders-api-prod-exports/daily/"
    }
  }
}
```

Automation can then read the value with a JSON tool:

```bash
bucket_name="$(terraform output -raw exports_bucket_name)"
aws s3 cp ./exports "s3://${bucket_name}/" --recursive
```

The `-raw` flag returns the string value without JSON quotes, which makes it safe to place in a shell variable. The `aws s3 cp` command then uses the Terraform-managed bucket name instead of a hardcoded bucket. That keeps automation connected to the infrastructure code.

For one local file, the upload output would look similar to this:

```console
upload: exports/orders-2026-06-28.csv to s3://devpolaris-orders-api-prod-exports/orders-2026-06-28.csv
```

Later module articles will use outputs as contracts between reusable folders. The same idea applies there, but this early article only needs the root-module habit: publish the values a human, script, or next deployment step actually needs.

Automation usually uses `terraform output -raw` for a single string and `terraform output -json` for structured values:

```bash
bucket_arn="$(terraform output -raw exports_bucket_arn)"
terraform output -json orders_storage > orders-storage.json
```

The JSON form preserves types, which matters for lists, maps, booleans, and numbers. Scraping the human display output is fragile because it is designed for people, not scripts.

Later state and module articles show how other Terraform configurations can consume selected outputs. For now, output use stays close to the root run: a human reads the CLI output, a script reads `terraform output`, and the team avoids copying provider values into notes by hand.

## Output Changes in Plans
<!-- section-summary: Terraform plans show output additions, removals, and value changes so published values can be reviewed. -->

Changed outputs appear in plans. A new output might show:

```console
Changes to Outputs:
  + exports_bucket_name = "devpolaris-orders-api-prod-exports"
```

If a resource name changes, the output may change too:

```console
Changes to Outputs:
  ~ exports_bucket_name = "devpolaris-orders-api-dev-exports" -> "devpolaris-orders-api-prod-exports"
```

Output changes deserve review because downstream users may rely on them. A renamed output can break scripts. A changed ARN can alter a deployment step. A removed output can break an operator runbook.

For shared Terraform projects, output names are part of the interface. New outputs are straightforward with a known consumer. Renames and removals need a migration note.

Plan review should also check sensitive output changes. Terraform may hide the value and still show that the output changed. If a sensitive output feeds a downstream process, the team needs to know whether rotation, redeploy, or script updates are required.

If an output change follows a resource replacement, reviewers examine both parts together. A new bucket ARN, database endpoint, or load balancer DNS name can affect IAM policies, deployment scripts, DNS records, monitoring checks, and application configuration.

## Sensitive Outputs and State
<!-- section-summary: Sensitive outputs hide display in normal CLI output but still require protected state and careful downstream handling. -->

Some outputs contain sensitive values. Terraform supports `sensitive = true`:

![Sensitive Output Flow](/content-assets/articles/article-iac-terraform-values-outputs/sensitive-output-flow.png)

*The sensitive output flow shows display redaction, state access, and automation handling as one review path.*

```hcl
output "database_password" {
  description = "Initial database password for lab use."
  value       = random_password.database.result
  sensitive   = true
}
```

Terraform hides sensitive outputs in normal output display. A user can still retrieve the value intentionally with commands such as `terraform output -raw database_password` if they have access to the state. That is why state access must be protected.

Secret outputs need a real workflow reason. Production databases usually use managed password features, secret managers, or provider-supported references that keep secret material out of Terraform outputs. A sensitive output also requires CI log, shell history, and downstream script review.

Sensitive marking helps display behavior. Terraform state still needs the same protection as any other secret-bearing system.

Sensitive outputs also affect automation. A script with state access can intentionally read the value:

```bash
terraform output -raw database_password
```

That command can place the secret into shell history, process logs, or CI logs if the workflow is careless. Production workflows avoid this pattern unless the pipeline has a clear secret-handling design. In many systems, Terraform should output a secret reference, such as a secret ARN or name, and the application should read the secret value from the secret manager at runtime.

## Putting It All Together
<!-- section-summary: Outputs publish the values a Terraform configuration intentionally shares after creating or reading infrastructure. -->

Outputs are the values a Terraform configuration chooses to share. They can help humans verify a run, help scripts deploy artifacts, and help runbooks consume stable infrastructure facts.

![Outputs Summary](/content-assets/articles/article-iac-terraform-values-outputs/outputs-summary.png)

*The summary board gathers the output habits that keep published values useful and safe.*

The orders bucket example showed the full connection. Variables and locals shaped the bucket name. The resource managed the bucket. Outputs published the bucket name and ARN. Humans and scripts consumed those outputs through clear commands.

Outputs should stay intentional. Useful outputs have a real consumer, clear descriptions, visible plan review, and the same care for sensitive values as any other secret-bearing path.

---

**References**

- [Terraform output values](https://developer.hashicorp.com/terraform/language/values/outputs) - HashiCorp explains output block syntax, descriptions, `sensitive`, `depends_on`, and how outputs behave in root and child modules.
- [terraform output](https://developer.hashicorp.com/terraform/cli/commands/output) - HashiCorp documents human-readable output, `-raw`, and `-json`.
- [Terraform state](https://developer.hashicorp.com/terraform/language/state) - HashiCorp explains why Terraform stores resource and output data in state.
- [Manage sensitive data](https://developer.hashicorp.com/terraform/language/manage-sensitive-data) - HashiCorp documents sensitive values, state exposure, and secret-handling guidance.
- [References to values](https://developer.hashicorp.com/terraform/language/expressions/references) - HashiCorp documents how outputs can read resources, locals, variables, and other values.
- [AWS provider aws_s3_bucket](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) - Terraform Registry documents the S3 bucket attributes used in the examples.
