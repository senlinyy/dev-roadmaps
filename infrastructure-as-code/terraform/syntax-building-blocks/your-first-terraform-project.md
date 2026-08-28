---
title: "Your First Terraform Project"
description: "Build a small real Terraform project by publishing a tiny S3 static website, then practice fmt, init, validate, plan, apply, verification, state inspection, destroy, and Git hygiene."
overview: "This hands-on article walks through a real but small Terraform project: an Amazon S3 static website with two HTML files. You will use a sandbox AWS account, write Terraform files for an S3 bucket, website hosting, public read policy, and uploaded objects, review the plan before applying, test the website endpoint, clean everything up, and learn what belongs in Git."
tags: ["terraform", "cli", "plan", "apply", "state"]
order: 9
id: article-iac-terraform-foundations-first-safe-project
aliases:
  - infrastructure-as-code/terraform/foundations/your-first-safe-terraform-project.md
  - infrastructure-as-code/terraform/syntax-building-blocks/your-first-safe-terraform-project.md
---

## Table of Contents

1. [What Are We Building and What Will Terraform Own?](#what-are-we-building-and-what-will-terraform-own)
2. [How Do You Prepare a Safe AWS Root Module?](#how-do-you-prepare-a-safe-aws-root-module)
3. [How Do Requirements, Inputs, Locals, and the Provider Fit Together?](#how-do-requirements-inputs-locals-and-the-provider-fit-together)
4. [How Do the S3 Website Resources Form a Dependency Graph?](#how-do-the-s3-website-resources-form-a-dependency-graph)
5. [How Do Local Files and Outputs Complete the Desired State?](#how-do-local-files-and-outputs-complete-the-desired-state)
6. [How Do You Format, Initialize, Plan, Apply, and Verify?](#how-do-you-format-initialize-plan-apply-and-verify)
7. [How Do State, Change Detection, and Destroy Complete the Loop?](#how-do-state-change-detection-and-destroy-complete-the-loop)
8. [Which Terraform Principles Should You Take Forward?](#which-terraform-principles-should-you-take-forward)
9. [Check Your Answers](#check-your-answers)

Terraform is not primarily a scripting language. A script says “create a bucket, change its permissions, then upload a file.” Terraform describes a bucket, permissions, and files that should exist, then calculates how to make reality match that declaration.

Terraform continually connects four ideas:

| Idea | Meaning |
| --- | --- |
| Configuration | What you declare should exist |
| State | Terraform's record of managed identities and attributes |
| Real infrastructure | What currently exists in AWS |
| Plan and apply | The calculated difference and its execution |

A compact equation is:

```text
desired configuration
        -
current state and infrastructure
        =
proposed plan
```

The desired result is a tiny S3 website:

```text
Browser
   │ HTTP
   ▼
S3 website endpoint
   ├── index.html
   └── error.html
```

Keep these questions in view as you work through the lesson:

1. **What Are We Building and What Will Terraform Own?**
2. **How Do You Prepare a Safe AWS Root Module?**
3. **How Do Requirements, Inputs, Locals, and the Provider Fit Together?**
4. **How Do the S3 Website Resources Form a Dependency Graph?**
5. **How Do Local Files and Outputs Complete the Desired State?**
6. **How Do You Format, Initialize, Plan, Apply, and Verify?**
7. **How Do State, Change Detection, and Destroy Complete the Loop?**
8. **Which Terraform Principles Should You Take Forward?**

## What Are We Building and What Will Terraform Own?

Terraform will manage separate AWS concepts:

```text
aws_s3_bucket
├── aws_s3_bucket_website_configuration
├── aws_s3_bucket_public_access_block
├── aws_s3_bucket_policy
├── aws_s3_object.index
└── aws_s3_object.error
```

The provider models these objects separately because AWS exposes bucket storage, website configuration, public-access controls, policy, and objects as distinct APIs. The separate `aws_s3_bucket_website_configuration` resource is the current provider shape for website settings.

![The project maps one root module to the S3 objects and website endpoint it manages](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/s3-site-project-map.png)

This is intentionally a sandbox design. Native S3 website endpoints require publicly readable content and use HTTP rather than HTTPS. A production website that requires HTTPS should use an architecture such as CloudFront or Amplify. Store only harmless sample HTML here and destroy it when the exercise is complete.

The project directory is a Terraform **root module**. Every `.tf` file in it is combined into one configuration; Terraform does not execute `versions.tf`, then `providers.tf`, then `main.tf`. The filenames organize source for people.

```text
first-terraform-project/
├── versions.tf
├── variables.tf
├── locals.tf
├── providers.tf
├── main.tf
├── outputs.tf
├── terraform.tfvars.example
├── .gitignore
└── site/
    ├── index.html
    └── error.html
```

The state boundary is equally important. Terraform does not automatically manage the entire AWS account. It manages objects represented by this configuration and its state bindings. Other buckets, servers, or databases in the account remain outside this project's ownership unless explicitly brought into it.

## How Do You Prepare a Safe AWS Root Module?

Two independent prerequisites must work:

```text
Terraform CLI + AWS credentials
```

Check the installed tools:

```bash
terraform version
aws --version
```

If the sandbox provides a named profile, verify the identity before writing infrastructure:

```bash
aws sts get-caller-identity --profile sandbox
```

The response identifies the AWS user or role and account:

```json
{
  "UserId": "...",
  "Account": "123456789012",
  "Arn": "arn:aws:..."
}
```

An AWS account, IAM identity, and local CLI profile are different things. The profile selects local authentication and configuration information; it is not an AWS resource. If the sandbox supplies credentials through environment variables, a named profile may be unnecessary. Never place access keys in Terraform source.

Choose a globally unique throwaway bucket name and confirm that public S3 policy changes are permitted only in the intended training account. AWS can enforce Block Public Access at organization, account, and bucket levels, and the most restrictive applicable setting wins. A centrally enforced restriction can correctly reject this lab's public policy even if the HCL is valid.

Create the directory structure before initializing. Website source files are ordinary local inputs, not Terraform configuration. Terraform will later read and upload them. Keep the project isolated from shared S3 data so plan and destroy reviews have an unambiguous boundary.

The root-module boundary also explains the file layout. `versions.tf`, `variables.tf`, `locals.tf`, `providers.tf`, `main.tf`, and `outputs.tf` are one module even though their names suggest different concerns. Terraform loads the declarations together and builds references among them. You could combine them into one file without changing the model; the split helps people navigate the project.

The `site` directory is different. Its HTML files are source artifacts read by functions and provider resource arguments, not `.tf` declarations. Editing an HTML file changes an input to the object resource through `filemd5`; it does not add a new Terraform block.

Before any apply, write down the ownership boundary in plain language: this state may create, update, and destroy only the named sandbox bucket, its website settings, its policy and access controls, and its two objects. It should not import or reference shared production buckets. This statement gives the plan review a concrete acceptance rule.

The public boundary should be equally narrow. Anonymous users receive `s3:GetObject` only for object ARNs inside this one bucket. They receive no write action and no authority over bucket configuration. The content contains no secrets or private data. If the organization-level guardrail blocks the policy, do not weaken the central control; use an approved sandbox whose policy permits the exercise or stop before apply.

Credentials and configuration remain separate. Terraform may select the `sandbox` profile, but the keys behind that profile live in standard AWS credential storage or injected environment variables. The root module records a region and optional profile choice, not raw secrets. Verifying caller identity proves which account and principal the provider will use before the plan can affect AWS.

## How Do Requirements, Inputs, Locals, and the Provider Fit Together?

Create `versions.tf`:

```hcl
terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

`required_version` constrains the Terraform CLI itself. `required_providers.aws.version` constrains the AWS plugin. Terraform Core and providers have independent release cycles. The broader constraints keep the exercise from depending on one patch release; use a sandbox-required older provider constraint when the training environment specifies one.

The source address `hashicorp/aws` identifies a Terraform Registry namespace and provider. Terraform Core does not contain S3 API behavior. It loads the provider plugin, gives it planned resource operations, and the plugin calls AWS.

```text
Terraform Core -> AWS provider -> AWS APIs
```

Create `variables.tf`:

```hcl
variable "aws_region" {
  description = "AWS region in which to create the website"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Optional AWS CLI profile to use"
  type        = string
  default     = null
  nullable    = true
}

variable "bucket_name" {
  description = "Globally unique name for the S3 bucket"
  type        = string
}
```

Variables are inputs from outside the root module. The region has an ordinary default, the profile may intentionally be absent, and the globally unique bucket name must be supplied. Bucket naming is a deployment choice rather than fixed infrastructure logic.

Create `locals.tf`:

```hcl
locals {
  site_dir = "${path.module}/site"

  common_tags = {
    Project   = "first-terraform-project"
    ManagedBy = "Terraform"
  }
}
```

Locals are reusable values defined or derived inside the module. `path.module` is the directory containing this module, so `local.site_dir` points to the `site` subdirectory regardless of the shell's current path. Locals calculate no remote object.

Create `providers.tf`:

```hcl
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}
```

The requirement says which provider software is needed. The provider block says how this instance should operate: region and optional local profile. Authentication should still come from the standard AWS credential mechanisms rather than embedded keys.

For a profile-based sandbox, a local `terraform.tfvars` can contain:

```hcl
aws_region  = "us-east-1"
aws_profile = "sandbox"
bucket_name = "your-globally-unique-bucket-name"
```

If credentials are injected automatically, omit `aws_profile` and let its value remain `null`. Commit an illustrative `terraform.tfvars.example`, not credentials:

```hcl
aws_region  = "us-east-1"
aws_profile = "sandbox"
bucket_name = "replace-with-a-globally-unique-name"
```

The value flow is now clear: external choices enter through variables, locals define internal paths and tags, and the provider uses the selected AWS context.

## How Do the S3 Website Resources Form a Dependency Graph?

Begin `main.tf` with the bucket:

```hcl
resource "aws_s3_bucket" "website" {
  bucket = var.bucket_name
  tags   = local.common_tags
}
```

`aws_s3_bucket` is the provider-defined type and `website` is Terraform's local label. Together, `aws_s3_bucket.website` form the logical resource address. That is different from the AWS-visible bucket name supplied through `var.bucket_name`. State will bind the logical address to the real bucket identity.

Configure website behavior:

```hcl
resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}
```

`aws_s3_bucket.website.id` supplies data and an implicit dependency. Terraform knows the bucket must produce its ID before website configuration can use it. The source does not need an imperative “create bucket first” step.

Allow the educational site to use a public bucket policy while still blocking ACL-based public access:

```hcl
resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}
```

The four settings are independent. Public ACLs remain blocked and ignored; public policy is allowed for this bucket.

Build the policy as structured provider data:

```hcl
data "aws_iam_policy_document" "public_read" {
  statement {
    sid    = "PublicReadGetObject"
    effect = "Allow"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = [
      "s3:GetObject",
    ]

    resources = [
      "${aws_s3_bucket.website.arn}/*",
    ]
  }
}
```

The policy permits anyone to read objects beneath this bucket ARN. It does not grant anonymous upload, deletion, bucket listing, IAM operations, or access to other buckets.

Attach the generated JSON:

```hcl
resource "aws_s3_bucket_policy" "public_read" {
  bucket = aws_s3_bucket.website.id
  policy = data.aws_iam_policy_document.public_read.json

  depends_on = [
    aws_s3_bucket_public_access_block.website
  ]
}
```

References already connect the policy to the bucket and policy-document data source. The explicit `depends_on` models a hidden operational prerequisite: public-access settings should be applied before installing the public policy, but the policy consumes no attribute from that access-block resource.

Prefer implicit dependencies when a real value flows. Use `depends_on` only when behavior creates a prerequisite that references cannot reveal. It adds a graph edge; it is not an arbitrary sleep.

The graph now branches from the bucket into website configuration, access settings, policy data, and later uploaded objects. Independent branches can proceed when their own inputs are ready. A stricter account or organization Block Public Access policy may still reject the bucket policy with `AccessDenied`; Terraform has only the authority of the authenticated identity and the platform policies around it.

## How Do Local Files and Outputs Complete the Desired State?

Create `site/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My First Terraform Site</title>
</head>
<body>
  <h1>Hello from Terraform</h1>
  <p>This page was uploaded to Amazon S3 by Terraform.</p>
</body>
</html>
```

Create `site/error.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Not Found</title>
</head>
<body>
  <h1>Page not found</h1>
</body>
</html>
```

These files are not HCL. They are inputs Terraform will upload through two managed object resources:

```hcl
resource "aws_s3_object" "index" {
  bucket = aws_s3_bucket.website.id
  key    = "index.html"

  source       = "${local.site_dir}/index.html"
  etag         = filemd5("${local.site_dir}/index.html")
  content_type = "text/html"
}

resource "aws_s3_object" "error" {
  bucket = aws_s3_bucket.website.id
  key    = "error.html"

  source       = "${local.site_dir}/error.html"
  etag         = filemd5("${local.site_dir}/error.html")
  content_type = "text/html"
}
```

Each bucket reference connects the object to its container. `source` selects the local file, `content_type` identifies HTML, and `filemd5` turns file content into a value Terraform can compare. When the file changes, the hash changes, allowing Terraform to plan an object update.

Create `outputs.tf`:

```hcl
output "bucket_name" {
  description = "Name of the S3 website bucket"
  value       = aws_s3_bucket.website.bucket
}

output "website_url" {
  description = "S3 static website URL"
  value       = "http://${aws_s3_bucket_website_configuration.website.website_endpoint}/"
}
```

Variables cross into the module; outputs deliberately cross back out. The endpoint may remain unknown in the plan until AWS creates the website configuration.

At this point, `main.tf` contains only declarations and relationships:

```hcl
resource "aws_s3_bucket" "website" {
  bucket = var.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

data "aws_iam_policy_document" "public_read" {
  statement {
    sid    = "PublicReadGetObject"
    effect = "Allow"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.website.arn}/*"]
  }
}

resource "aws_s3_bucket_policy" "public_read" {
  bucket = aws_s3_bucket.website.id
  policy = data.aws_iam_policy_document.public_read.json

  depends_on = [
    aws_s3_bucket_public_access_block.website
  ]
}

resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.website.id
  key          = "index.html"
  source       = "${local.site_dir}/index.html"
  etag         = filemd5("${local.site_dir}/index.html")
  content_type = "text/html"
}

resource "aws_s3_object" "error" {
  bucket       = aws_s3_bucket.website.id
  key          = "error.html"
  source       = "${local.site_dir}/error.html"
  etag         = filemd5("${local.site_dir}/error.html")
  content_type = "text/html"
}
```

There is no “create, wait, upload, wait, change permissions” script. Facts and references form a graph, and Terraform derives a valid schedule.

## How Do You Format, Initialize, Plan, Apply, and Verify?

Format the source first:

```bash
terraform fmt -recursive
```

`fmt` makes no AWS call. It rewrites HCL into canonical formatting, reducing irrelevant differences in reviews.

Initialize the working directory:

```bash
terraform init
```

Initialization reads provider requirements, downloads plugins, and creates working artifacts such as:

```text
.terraform/
.terraform.lock.hcl
```

The `.terraform/` directory contains downloaded local working data and should not be committed. The lock file records exact selected provider versions and checksums and should normally be committed for reproducible provider installation.

![The provider constraint guides selection while the lock file preserves the exact installed choice](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/provider-version-workflow.png)

Validate the initialized configuration:

```bash
terraform validate
```

A successful result means Terraform can parse the configuration and its references, argument types, and provider schemas are internally consistent. It does not prove the bucket name is available, credentials are authorized, or organization policy permits public S3 access. Validation does not test every remote API condition.

Create a plan:

```bash
terraform plan
```

Terraform compares configuration with prior state and refreshed AWS objects, then proposes the changes needed for convergence. A summary might show:

```text
Plan: 6 to add, 0 to change, 0 to destroy.
```

Read the details, not only the success color. `+` means create, `~` update in place, `-` destroy, and delete/create markers indicate replacement. Confirm that every planned object belongs to this small website and that no unexpected destruction appears.

For a stronger review-to-apply link, save the exact plan:

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

Without a saved plan, a later `terraform apply` generates a fresh plan. Applying the saved file executes the operations that were reviewed, which is especially valuable in automation.

If applying without a saved plan:

```bash
terraform apply
```

Terraform displays the plan and requests confirmation. Enter `yes` only after reviewing it. Core then coordinates provider calls, AWS creates the objects, and Terraform records returned identities and attributes in state.

```text
.tf configuration
       │
       ▼
Terraform Core
       │ plan
       ▼
AWS provider
       │ API operations
       ▼
AWS resources
```

Read the applied outputs:

```bash
terraform output
terraform output -raw website_url
```

Test the home page:

```bash
curl "$(terraform output -raw website_url)"
```

The response should contain `Hello from Terraform`. Append a missing path to confirm S3 uses `error.html`. Remember that the native website endpoint is HTTP-only.

![The safe command loop separates formatting, initialization, validation, planning, apply, and verification](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/safe-command-loop.png)

Run `terraform plan` again. Ideally Terraform reports that infrastructure matches configuration and no changes are required. This is convergence: Terraform is comparing desired and current state, not replaying a creation script.

Each command has a different boundary. `fmt` needs only source files. `init` contacts registries or configured sources to install dependencies but does not create the declared S3 resources. `validate` checks the initialized configuration and provider schema locally. `plan` reads state and may refresh AWS information, while normal planning stops before executing the proposed mutations. `apply` is the step authorized to perform the planned transition.

That separation supports debugging. If formatting changes, inspect source style. If initialization fails, inspect Core constraints, provider source, network access, and lock selections. If validation fails, inspect HCL, types, and references. If plan fails with AWS authentication or lookup errors, inspect provider context and permissions. If apply rejects the bucket policy, check account and organization public-access controls rather than assuming an HCL parser problem.

The lock file deserves deliberate handling. `~> 6.0` describes an allowed range, while `.terraform.lock.hcl` records the selected provider package and checksums from initialization. Another team member can initialize against the same locked selection. Re-run and review dependency upgrades intentionally rather than letting every workstation choose a different newest compatible build.

Plan symbols communicate lifecycle consequences. A create adds an object to the managed graph. An update preserves identity while changing supported properties. A destroy removes an object no longer desired. A replacement changes remote identity and may have availability consequences. Even in this simple lab, read resource addresses and affected arguments rather than trusting only the summary count.

Saving `tfplan` strengthens the review boundary but creates another sensitive artifact. Saved plans can contain infrastructure values and should stay out of Git. The subsequent `terraform apply tfplan` executes that exact saved proposal; it does not accept new variable overrides or silently regenerate the reviewed set of operations.

Verification is independent evidence. A successful apply means providers reported operations complete, not that the website serves the intended content. Read `website_url`, fetch it, check the heading, and request a missing path to test the configured error document. The post-apply plan then checks the reconciliation view: configuration, state, and refreshed remote objects should agree.

## How Do State, Change Detection, and Destroy Complete the Loop?

Edit `site/index.html` and change the heading:

```html
<h1>Terraform detected this change</h1>
```

Run:

```bash
terraform plan
```

`filemd5` now returns a different hash. The desired object ETag no longer matches the recorded/current value, so Terraform can propose updating only the affected S3 object. Apply and reload the page. This demonstrates the loop:

```text
change desired input
       │
       ▼
calculate delta
       │
       ▼
update only required infrastructure
```

With the default local backend, apply creates `terraform.tfstate`. State is more than a disposable cache. It maps Terraform's logical address to the real remote identity:

```text
aws_s3_bucket.website
          │ state binding
          ▼
real AWS bucket
```

Without that binding, Terraform could not reliably decide whether it already manages the bucket or should create another object.

Inspect managed addresses:

```bash
terraform state list
```

Expected resource addresses include:

```text
aws_s3_bucket.website
aws_s3_bucket_policy.public_read
aws_s3_bucket_public_access_block.website
aws_s3_bucket_website_configuration.website
aws_s3_object.error
aws_s3_object.index
```

The IAM policy document is a data source, not a remotely created S3 resource. Inspect a particular resource or the interpreted state with:

```bash
terraform state show aws_s3_bucket.website
terraform show
```

Do not edit the state file manually. Terraform provides deliberate state commands for later operations.

State can contain infrastructure details and sensitive values, so keep it out of Git. A learning project can use local state; teams normally use a protected remote backend. A `.gitignore` can include:

```gitignore
.terraform/

*.tfstate
*.tfstate.*

*.tfplan

crash.log
crash.*.log

*.tfvars
!*.tfvars.example
```

Commit `.tf` source, harmless website files, the example values file, and `.terraform.lock.hcl`. Do not commit downloaded providers, local state, saved plans, credential-bearing values, or access keys.

Review cleanup before performing it:

```bash
terraform plan -destroy
terraform destroy
```

Destroy is equivalent to planning an empty desired set for all objects managed by this configuration. Dependencies reverse where necessary: uploaded objects and policies must be removed before the bucket. Review the plan and confirm that only the lab resources are targeted.

Destroy changes reality and state; it does not delete HCL. The configuration still declares a website. A subsequent plan therefore proposes recreating it. Keep configuration, state, and reality as separate layers.

State inspection makes the identity model concrete. `aws_s3_bucket.website` is the stable Terraform address chosen in source; the bucket name is a remote identity or property chosen through input. Object resources have separate addresses even though they live inside the same bucket. Terraform can therefore update `aws_s3_object.index` without treating the entire website as one indivisible object.

The data source has a state representation too, but it does not have the same managed lifecycle as the S3 resources. `aws_iam_policy_document.public_read` calculates or returns JSON for another resource to consume. Destroy targets the remote objects this configuration owns; it does not “delete” a policy-document object from AWS because no such remote object was created by the data block.

Hash-based change detection illustrates desired state beyond HCL. The HTML content lives in an external local file, yet `filemd5` includes its content-derived value in resource configuration. When the content changes, the object declaration's desired ETag changes. The next plan can identify the precise managed object whose desired representation no longer matches.

Protecting state means protecting its entire lifecycle: the local file, backups, remote backend if introduced, access permissions, transport, and automation logs. State may include generated endpoints, policy JSON, identifiers, and potentially secret values in other projects. `.gitignore` prevents an easy accidental commit but is not access control for an already shared file.

Destroy review should follow dependency direction in reverse. Objects must leave before the bucket can be empty; the bucket policy and website configuration must stop referring to the bucket; then AWS can remove the bucket itself. Terraform derives that order from the same references used during creation. A failed partial destroy can be planned again because state records what remains managed.

After cleanup, keep the source and lock file if the project is instructional. Remove or ignore local plan files and state according to the lab policy. Running plan again with intact configuration correctly proposes creation, proving that desired configuration is not an execution history. Terraform always reconciles the current three layers rather than remembering that “the script already ran.”

## Which Terraform Principles Should You Take Forward?

The project forms one complete reasoning chain:

```text
variables enter the root module
        │
locals derive internal paths and tags
        │
provider configuration selects AWS context
        │
resources declare desired AWS objects
        │
references build the dependency graph
        │
init installs and locks providers
        │
validate checks configuration structure
        │
plan compares configuration, state, and reality
        │
apply asks the provider to execute the transition
        │
state records resulting identities and attributes
        │
a second plan converges to no changes
```

Each HCL construct has a first-principles role:

| Construct | Meaning |
| --- | --- |
| `terraform {}` | Rules and requirements for running Terraform |
| `required_providers` | Provider plugin dependencies |
| `provider "aws"` | Context for communicating with AWS |
| `variable` | Input from outside the module |
| `locals` | Internal calculated or reusable values |
| `resource` | A remote object Terraform should manage |
| `data` | Information Terraform reads or computes rather than owns |
| `output` | A value deliberately exposed from the module |
| Resource reference | Value flow and usually an implicit dependency |
| `depends_on` | A hidden behavioral dependency |
| State | Binding between Terraform identity and remote identity |
| Plan | Proposed transition from current to desired state |
| Apply | Execution of that transition |

Configuration declares desired state rather than issuing `CreateBucket` directly. The provider translates generic Terraform operations into AWS APIs. Resource addresses give objects stable logical identity. References carry values and form a graph. State binds those addresses to actual objects. Plan is the reconciliation step, and apply performs the approved transition.

Repeated execution is central. After apply, another plan should normally find no work. Change one source input and Terraform calculates the smallest necessary delta. Destroy removes managed reality but leaves the desired declaration available for recreation.

The next projects should deepen one idea at a time: multiple instances with `count` or `for_each`, reusable modules, a remote backend, importing existing infrastructure, a private S3 plus CloudFront HTTPS architecture, networking, compute, and eventually saved-plan CI/CD workflows.

The durable mental model is: Terraform remembers what it manages, compares that record and remote reality with configuration, creates a dependency-aware plan, and uses providers to move reality toward the declared goal.

The website itself is incidental to those lessons. The bucket demonstrates logical and remote identity. Website configuration demonstrates a resource consuming a provider-generated attribute. The public-access block and policy demonstrate a hidden behavioral dependency. The object resources demonstrate local files and hashes becoming desired configuration. Outputs demonstrate a public module return value.

The command loop gives those language constructs an operating discipline. Format makes reviews consistent. Initialization resolves plugins. Validation checks configuration structure. Plan calculates consequences. Apply performs approved changes. External verification tests the delivered behavior. A second plan checks convergence, and destroy exercises the dependency graph in reverse.

As projects grow, preserve these boundaries. Add multiple instances without losing stable addresses. Wrap related resources in modules with focused inputs and outputs. Move state to a protected shared backend before team use. Import existing infrastructure only when this configuration should own its lifecycle. Replace the public S3 website architecture with private S3 and CloudFront when HTTPS and production controls are required.

Do not measure the next exercise only by resource count. A small project that introduces one new concept and retains safe planning, verification, and cleanup teaches more than a large collection of copied blocks. The reconciliation model remains the same whether the graph contains six S3 objects or thousands of cloud resources.

Keep one final checklist for every run: confirm the account, select non-secret inputs, format and initialize, validate, inspect the full plan, apply only the reviewed transition, verify the service externally, inspect state ownership, and clean up temporary infrastructure. None of those steps substitutes for another. Together they connect readable source to controlled cloud change.

When a result surprises you, return to the same model. Check what configuration declares, what state says Terraform owns, what AWS currently reports, and what the plan proposes between them. Then trace references through the graph and confirm provider authority. That method scales beyond this lab and is more reliable than treating Terraform as a sequence of commands to retry until they pass.

It also keeps each change reversible, attributable, and reviewable. That is the real achievement of the first project.

The S3 page is temporary; the reconciliation discipline is reusable across every later Terraform system.

Preserve that discipline as the infrastructure grows.

It is the foundation of safe Terraform operations.

Carry it forward.

Always.

The habit matters long after this particular sandbox is gone.

Before treating the project as complete, repeat the full lifecycle from a clean shell: format and validate the configuration, initialize providers, review the saved plan, apply that exact plan, inspect outputs and state, run a no-change plan, and finally destroy only the lab resources when intended. This sequence proves not only that creation works, but that Terraform can recognize convergence and remove what it owns. Keep generated state and provider files out of accidental source control according to the repository rules, while committing the dependency lock file when the workflow expects reproducible provider selection.

Keep the lab boundary visible: use an isolated account or project, recognizable names and tags, and a cost and cleanup check. Terraform should own only the objects declared in this root state. Existing shared infrastructure should be read through supported data sources or imported deliberately, never assumed to be safe because a provider can discover it.

## Check Your Answers

:::expand[What Are We Building and What Will Terraform Own?]{kind="recap"}
The sandbox module manages one S3 bucket, website configuration, access controls, policy, and two objects. It owns only the resources represented by its configuration and state, not the whole AWS account.
:::

:::expand[How Do You Prepare a Safe AWS Root Module?]{kind="recap"}
Verify Terraform, AWS CLI, the exact sandbox identity, public-access guardrails, and an isolated throwaway project. Profiles select credentials but are not AWS resources, and keys never belong in HCL.
:::

:::expand[How Do Requirements, Inputs, Locals, and the Provider Fit Together?]{kind="recap"}
Requirements select compatible Core and provider software, variables receive deployment choices, locals define internal values, and the provider block selects the AWS operating context.
:::

:::expand[How Do the S3 Website Resources Form a Dependency Graph?]{kind="recap"}
Bucket references create implicit edges into website settings, policies, and objects. `depends_on` adds only the hidden requirement that public-access settings precede the public policy.
:::

:::expand[How Do Local Files and Outputs Complete the Desired State?]{kind="recap"}
S3 object resources upload the two local HTML files, and `filemd5` makes content changes visible. Outputs expose the bucket name and HTTP website endpoint.
:::

:::expand[How Do You Format, Initialize, Plan, Apply, and Verify?]{kind="recap"}
Format source, initialize and lock providers, validate structure, review and optionally save the plan, apply the reviewed transition, test outputs, and confirm convergence with another plan.
:::

:::expand[How Do State, Change Detection, and Destroy Complete the Loop?]{kind="recap"}
State binds Terraform addresses to AWS objects and must be protected. File hashes drive targeted updates, while destroy plans an empty managed set without erasing configuration.
:::

:::expand[Which Terraform Principles Should You Take Forward?]{kind="recap"}
Terraform is a reconciliation engine: configuration states the goal, references form a graph, state records identity, plans calculate differences, and providers execute approved changes repeatedly.
:::

### References

- [S3 bucket resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket)
- [S3 website endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)
- [AWS CLI `get-caller-identity`](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html)
- [Provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements)
- [Terraform installation](https://developer.hashicorp.com/terraform/install)
- [Provider block reference](https://developer.hashicorp.com/terraform/language/block/provider)
- [S3 public access block resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block)
- [S3 bucket policy resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy)
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [S3 object resource](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_object)
- [`terraform init`](https://developer.hashicorp.com/terraform/cli/commands/init)
- [`terraform validate`](https://developer.hashicorp.com/terraform/cli/commands/validate)
- [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [`terraform apply`](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [`terraform destroy`](https://developer.hashicorp.com/terraform/cli/commands/destroy)
