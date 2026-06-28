---
title: "Your First Terraform Project"
description: "Build a small real Terraform project by publishing a tiny S3 static website, then practice fmt, init, validate, plan, apply, verification, state inspection, destroy, and Git hygiene."
overview: "This hands-on article walks through a real but small Terraform project: an Amazon S3 static website with two HTML files. You will use a sandbox AWS account, write Terraform files for an S3 bucket, website hosting, public read policy, and uploaded objects, review the plan before applying, test the website endpoint, clean everything up, and learn what belongs in Git."
tags: ["terraform", "cli", "plan", "apply", "state"]
order: 8
id: article-iac-terraform-foundations-first-safe-project
aliases:
  - infrastructure-as-code/terraform/foundations/your-first-safe-terraform-project.md
  - infrastructure-as-code/terraform/syntax-building-blocks/your-first-safe-terraform-project.md
---

## Table of Contents

1. [The Tiny Website We Will Build](#the-tiny-website-we-will-build)
2. [Project Boundaries](#project-boundaries)
3. [Confirm the Sandbox Profile and Project Files](#confirm-the-sandbox-profile-and-project-files)
4. [Write the Terraform Requirements](#write-the-terraform-requirements)
5. [Add Variables, Locals, and the AWS Provider](#add-variables-locals-and-the-aws-provider)
6. [Create the S3 Website Resources](#create-the-s3-website-resources)
7. [Add the Website Files](#add-the-website-files)
8. [Format, Initialize, Validate, and Plan](#format-initialize-validate-and-plan)
9. [Apply and Verify the Website](#apply-and-verify-the-website)
10. [Notice State and Clean Up](#notice-state-and-clean-up)
11. [Putting It All Together](#putting-it-all-together)
12. [After This Project](#after-this-project)

This article follows one small project from an empty folder to a cleaned-up AWS account. The project is a tiny public S3 static website for a launch notes page, with two HTML files, one bucket, website hosting settings, a read-only bucket policy, and Terraform outputs that give you the website URL.

That gives you real Terraform work without turning the first project into a giant cloud build. You will touch a real provider, create real AWS resources, read a real plan, and then remove everything at the end. The same loop appears later in bigger projects: write the desired setup, review the plan, apply the approved change, verify the result, and protect state.

This project also ties together the earlier syntax-building-block articles:

| Earlier concept | Where it appears in this project |
| --- | --- |
| HCL | Every `.tf` file uses blocks, labels, arguments, expressions, and references. |
| Provider | `versions.tf` selects the AWS provider, and `providers.tf` configures its region. |
| Resources | `main.tf` declares the bucket, website settings, policy, and uploaded objects. |
| Variables | `variables.tf` declares the region, environment, and unique bucket name. |
| Locals | `locals.tf` keeps shared tags in one place. |
| Outputs | `outputs.tf` prints the bucket name and website URL after apply. |
| Dependencies | References connect the bucket to policy, website configuration, objects, and outputs. |
| State | State records which AWS objects this folder owns after apply. |

## The Tiny Website We Will Build
<!-- section-summary: The project creates a real S3 static website with two public HTML files and a URL you can test. -->

Imagine the DevPolaris team wants a small launch notes page before a new course release. A static page fits that job well: `index.html`, `error.html`, and a place where a browser can fetch those files are enough for this first version.

Amazon S3 can host static website files directly from a bucket. **Static website hosting** means S3 serves files such as HTML, CSS, JavaScript, and images over an S3 website endpoint. The page has no backend code running on a server. A browser requests an object key such as `/index.html`, and S3 returns the file.

This Terraform project will create these pieces. Keep this list in mind while you read the plan, because each planned resource should map back to one row in the table below.

| Piece | What it does |
| --- | --- |
| S3 bucket | Stores the two website files. |
| Website configuration | Tells S3 which file is the home page and which file handles errors. |
| Public access block settings | Allows this one lab bucket to use a public read policy. |
| Bucket policy | Grants `s3:GetObject` so internet users can read the website files. |
| S3 objects | Uploads `index.html` and `error.html` from the local `website/` folder. |
| Outputs | Prints the bucket name and website URL after apply. |

This is a toy project because the website has only two files. It is still real infrastructure because Terraform calls the AWS S3 API, stores resource IDs in state, and creates something you can open in a browser. That difference matters for beginners because real provider behavior teaches habits that a fake local-only resource cannot teach.

![S3 Site Project Map](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/s3-site-project-map.png)

*The project map keeps the lab concrete: one root module, Terraform files, two website files, one storage bucket, and one URL to verify. In the HCL below, that storage bucket is an Amazon S3 bucket.*

For a production company website, teams usually put Amazon CloudFront in front of S3 so visitors get HTTPS, caching, custom domains, and a private bucket behind Origin Access Control. This first lab keeps the shape smaller so you can focus on the Terraform workflow. The boundary is that the bucket publishes only harmless sample HTML and gets destroyed after the lab.

## Project Boundaries
<!-- section-summary: A first cloud project needs a sandbox account, harmless data, narrow public access, a reviewed plan, and a planned destroy. -->

This project needs clear limits before any cloud change happens. The lab uses a sandbox AWS account, a unique throwaway bucket name, two harmless HTML files, and a read-only public policy for objects in that one bucket. The plan should create only the S3 resources named in the configuration.

Public S3 website hosting deserves a careful pause. AWS documents that public website access requires disabling the relevant Block Public Access settings and adding a bucket policy that grants public read access. Public means every internet user can read objects covered by the policy, so this lab stores only sample web pages.

The policy grants only `s3:GetObject` on `${bucket_arn}/*`. That lets visitors read website objects. Uploads, deletes, bucket listing, IAM changes, and access to other buckets stay outside this policy. The resource path stays tied to the bucket Terraform creates, so the policy is narrow enough for a beginner lab.

There is one account-level guardrail to understand before you start. S3 Block Public Access can exist at the account level and the bucket level, and S3 applies the most restrictive combination. If your AWS account or organization blocks public bucket policies centrally, the apply should fail as Terraform tries to attach the policy. That failure is useful evidence that the account has a guardrail in place, and an approved sandbox account is the right place for this lab.

The final boundary is cleanup. The destroy plan should remove the objects, bucket policy, website configuration, public access block settings, and bucket. The project uses a dedicated bucket name, so the destroy review is direct and the lab stays separate from shared application data.

## Confirm the Sandbox Profile and Project Files
<!-- section-summary: Terraform needs a working folder and an already-approved sandbox AWS profile before the lab creates S3 resources. -->

Terraform runs from your terminal or an automation runner. Install it from the official HashiCorp Terraform install instructions for your operating system. Then check that your shell can find the CLI:

```bash
terraform version
```

The output should show a Terraform version that satisfies the `required_version` setting used later in this lab:

```console
Terraform v1.13.5
on darwin_arm64
```

Your operating system line may differ. The important check is that the version is at least `1.6.0`.

Assume your sandbox AWS profile already exists and is approved for temporary S3 lab work. This article is about the Terraform project, so the only AWS identity step here is a quick confirmation before the provider runs:

```bash
export AWS_PROFILE=sandbox
aws sts get-caller-identity
aws configure get region
```

The caller should point at the sandbox account you expect, and the region should be intentional, such as `us-east-1`. A useful caller check looks like this:

```console
{
    "UserId": "AIDAEXAMPLE:user",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/sandbox-learner"
}
```

The important field is `Account`. If it shows a production account, stop before writing any Terraform plan. Use the sandbox profile your team provides, then come back to the project files.

Now create a clean working directory. A dedicated folder keeps this lab separate from any real infrastructure code you may already have.

```bash
mkdir terraform-s3-static-site
cd terraform-s3-static-site
mkdir website
touch versions.tf variables.tf providers.tf locals.tf main.tf outputs.tf terraform.tfvars
touch website/index.html website/error.html
```

This folder is the **root module**. Terraform reads all `.tf` files in the folder together and treats them as one configuration. File names help people navigate the project, while references between blocks tell Terraform how values connect.

Before writing code, check that the folder contains only the lab files. This small habit helps you catch a wrong terminal location before Terraform reads unrelated `.tf` files.

```bash
pwd
find . -maxdepth 2 -type f | sort
```

The file list should show the Terraform files and the two HTML files. Running Terraform from the wrong folder is a common beginner mistake, so this quick check keeps the first project boring in the best way.

The output should look like this:

```console
/path/to/terraform-s3-static-site
./locals.tf
./main.tf
./outputs.tf
./providers.tf
./terraform.tfvars
./variables.tf
./versions.tf
./website/error.html
./website/index.html
```

## Write the Terraform Requirements
<!-- section-summary: versions.tf declares the Terraform CLI version and AWS provider package the project expects. -->

Open `versions.tf` and add the provider requirement. This file answers the first provider question for the project: which Terraform CLI and provider package can run this configuration?

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
```

The `terraform` block tells Terraform which CLI versions and provider packages this project can use. The **AWS provider** is the plugin that teaches Terraform how to call AWS APIs. Terraform Core understands configuration, state, plans, and dependency graphs; the provider understands AWS resources such as S3 buckets and S3 objects.

The version constraint `~> 6.0` means the project accepts compatible AWS provider versions in the `6.x` line. During `terraform init`, Terraform selects an exact provider version and writes it into `.terraform.lock.hcl`. Team projects usually commit that lock file so another machine starts from the same provider selection.

![Provider Version Workflow](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/provider-version-workflow.png)

*The provider workflow is generic Terraform: declare provider requirements, configure the provider target, run init, commit the lock file, and review upgrades deliberately. In this lab, the provider is `hashicorp/aws`.*

This requirement file gives reviewers an early clue about what kind of project they are reading. A project that requires `hashicorp/aws` will call AWS. A project that later adds `cloudflare/cloudflare` or `integrations/github` has expanded its blast radius, and that provider change deserves review.

## Add Variables, Locals, and the AWS Provider
<!-- section-summary: variables.tf defines run-specific values, locals.tf derives shared tags, and providers.tf configures the AWS provider without hardcoded secrets. -->

The bucket name must be unique across all of S3, so the project receives it as an input. Open `variables.tf` and add the values that can change between readers or accounts.

```hcl
variable "aws_region" {
  description = "AWS region for the lab S3 bucket."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Short environment label used in tags."
  type        = string
  default     = "sandbox"

  validation {
    condition     = contains(["sandbox", "dev"], var.environment)
    error_message = "Use sandbox or dev for this lab."
  }
}

variable "site_bucket_name" {
  description = "Globally unique S3 bucket name for the lab static website."
  type        = string
}
```

An **input variable** lets the person running Terraform provide values without editing the resource blocks. `aws_region` is consumed by the provider block. `environment` is consumed by the local tag map. `site_bucket_name` is consumed by the S3 bucket resource.

Now open `locals.tf` and add the local values. This file keeps shared calculated values in one place.

```hcl
locals {
  common_tags = {
    Project     = "first-terraform-project"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
```

The `locals` block names a reusable expression inside the module. `local.common_tags` consumes `var.environment`, then the bucket resource consumes `local.common_tags`. That gives the tag values one source instead of repeating the same map inside each resource.

Open `terraform.tfvars` and choose your own bucket name. This file gives the lab concrete values without hardcoding those values into the resource definitions.

```hcl
site_bucket_name = "devpolaris-first-site-yourname-20260628"
aws_region       = "us-east-1"
environment      = "sandbox"
```

Replace `yourname` with something unique to you. S3 bucket names are global, so a name that works for one person may already belong to someone else. A date, initials, or short team code helps make the lab name unique and easy to recognize during cleanup.

Now open `providers.tf` and configure the AWS provider. The provider needs a region for S3 API calls, while credentials still come from your approved local AWS setup.

```hcl
provider "aws" {
  region = var.aws_region
}
```

Notice where the credentials are absent. The provider block has the region because that is normal project configuration. Access keys, session tokens, and passwords stay in the approved credential flow outside the `.tf` files. That keeps secrets out of Git, plan output, and casual screenshots.

## Create the S3 Website Resources
<!-- section-summary: main.tf declares the bucket, website configuration, public read policy, and uploaded objects as connected Terraform resources. -->

Now the project can describe the website infrastructure. `main.tf` will grow in four steps: the bucket, the public website settings, the public read policy, and the uploaded HTML objects.

Here is the file outline before the details arrive:

```hcl
resource "aws_s3_bucket" "site" {
  # bucket name and tags go here
}

resource "aws_s3_bucket_public_access_block" "site" {
  # bucket-level public access settings go here
}

resource "aws_s3_bucket_website_configuration" "site" {
  # index and error document settings go here
}

resource "aws_s3_bucket_policy" "site_read" {
  # public read policy goes here
}

resource "aws_s3_object" "index" {
  # index.html upload settings go here
}

resource "aws_s3_object" "error" {
  # error.html upload settings go here
}
```

This outline keeps the resource list visible before any one block grows. The file uses a few helper expressions that the next article will teach in more detail. For this project, the job of each helper matters most. `jsonencode(...)` builds a valid JSON policy from HCL values. `path.module` points at this project folder. `filemd5(...)` calculates a hash of a local file so Terraform can notice file content changes during the next plan.

Start with the bucket. This is the storage container for the website files:

```hcl
resource "aws_s3_bucket" "site" {
  bucket = var.site_bucket_name

  tags = local.common_tags
}
```

A **resource** block declares one managed object. This first resource creates the bucket. It consumes `var.site_bucket_name` for the bucket name and `local.common_tags` for the tags, so the earlier variable and local values now have a real AWS object that uses them.

Next, add the public access and website configuration resources. The public access block prepares this lab bucket for a public read policy, and the website configuration tells S3 which files answer normal and error requests:

```hcl
resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}
```

The public access block resource is there because public website hosting needs a bucket policy that the public internet can use. This lab keeps ACL-related public access blocked with `block_public_acls` and `ignore_public_acls`, then allows this bucket to have a public bucket policy with `block_public_policy = false` and `restrict_public_buckets = false`.

The website configuration points at the same bucket and tells S3 which object should answer the root path and which object should answer errors. Both resources read `aws_s3_bucket.site.id`, so Terraform knows the bucket must exist before it configures public access and website hosting.

Now add the bucket policy. This is the part that deserves the slowest review because it grants anonymous internet users read access to objects in the lab bucket:

```hcl
resource "aws_s3_bucket_policy" "site_read" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadWebsiteObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.site.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}
```

The bucket policy uses `jsonencode` so Terraform builds valid JSON from HCL values. `Principal = "*"` means the policy applies to anonymous internet users, `Action = "s3:GetObject"` allows reads, and `Resource = "${aws_s3_bucket.site.arn}/*"` limits those reads to objects in this one bucket. That exact resource path is the part reviewers should slow down and check.

The policy also uses one explicit dependency:

```hcl
depends_on = [aws_s3_bucket_public_access_block.site]
```

That line tells Terraform to configure the bucket-level public access settings before it attaches the public read policy. Most dependencies in this project come from references. This one is about S3 policy timing, so an explicit `depends_on` makes the ordering clear.

Finally, add the two object resources. These resources upload the local HTML files into the bucket:

```hcl
resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.site.id
  key          = "index.html"
  source       = "${path.module}/website/index.html"
  content_type = "text/html"
  etag         = filemd5("${path.module}/website/index.html")
}

resource "aws_s3_object" "error" {
  bucket       = aws_s3_bucket.site.id
  key          = "error.html"
  source       = "${path.module}/website/error.html"
  content_type = "text/html"
  etag         = filemd5("${path.module}/website/error.html")
}
```

The object resources read `aws_s3_bucket.site.id`, so Terraform knows where to upload the files. `source` points at the local file, `content_type = "text/html"` tells browsers to treat the object as HTML, and `etag = filemd5(...)` lets Terraform detect a local file content change during a later plan.

The full dependency path is now visible without needing one giant block. Bucket settings depend on the bucket. The policy depends on the bucket ARN and the public access block. The uploaded objects depend on the bucket ID. The outputs in the next file will read the bucket and website configuration after those resources exist.

Open `outputs.tf` and add the values you want Terraform to print after apply. Outputs should help you verify the deployment instead of searching through the AWS console.

```hcl
output "site_bucket_name" {
  description = "Name of the S3 bucket hosting the lab website."
  value       = aws_s3_bucket.site.bucket
}

output "website_url" {
  description = "HTTP URL for the S3 static website endpoint."
  value       = "http://${aws_s3_bucket_website_configuration.site.website_endpoint}"
}
```

An **output** publishes a useful value after apply. This project prints the bucket name and website URL so you can verify the result without searching through the AWS console. S3 static website endpoints support HTTP, and the production HTTPS pattern usually adds CloudFront in front of the bucket.

## Add the Website Files
<!-- section-summary: The local website files make the project visibly real because Terraform uploads content you can open in a browser. -->

Now give S3 something to serve. Open `website/index.html` and add a tiny page that makes the browser test obvious.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>DevPolaris Launch Notes</title>
  </head>
  <body>
    <main>
      <h1>DevPolaris Launch Notes</h1>
      <p>This tiny page was published with Terraform and Amazon S3 static website hosting.</p>
      <p>The first Terraform project created the bucket, website settings, public read policy, and uploaded objects from code.</p>
    </main>
  </body>
</html>
```

Open `website/error.html` and add the fallback page. The error document gives you a second verification path after the home page works.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Page Not Found</title>
  </head>
  <body>
    <main>
      <h1>Page Not Found</h1>
      <p>The lab website is running, but that object key is missing.</p>
    </main>
  </body>
</html>
```

The `aws_s3_object` resources use `source` to upload these files and `content_type = "text/html"` so browsers treat them as HTML. The `filemd5(...)` call is a Terraform function that calculates a local file hash. The `etag = filemd5(...)` line gives Terraform a value to compare. After a file edit, Terraform can see that the object content needs an update during the next plan.

This part connects the toy project to real infrastructure. A real team might upload a built React site from CI/CD, or use Terraform only for the bucket and let the application pipeline upload files. The first project keeps the upload in Terraform because it lets one folder show the full loop from code to browser.

## Format, Initialize, Validate, and Plan
<!-- section-summary: The first project habit is to format the files, install providers, validate configuration, and review the plan before applying. -->

The first command checks formatting. Start here because formatting changes are easy to review and should not be mixed into a later infrastructure surprise.

![Safe Command Loop](/content-assets/articles/article-iac-terraform-foundations-first-safe-project/safe-command-loop.png)

*The command loop shows the lab workflow: format, initialize, validate, save a plan, review, apply the saved plan, verify, and clean up with a destroy plan. The resource names in the diagram are generic; the S3 plan below should show six S3 resources.*

```bash
terraform fmt
```

`terraform fmt` rewrites the `.tf` files into standard Terraform style. A clean diff before every plan helps reviewers focus on infrastructure intent instead of spacing changes.

The next step initializes the working directory. This is where Terraform installs the provider selected by `versions.tf`.

```bash
terraform init
```

`terraform init` reads `required_providers`, downloads the AWS provider, and writes `.terraform.lock.hcl`. It also creates the local `.terraform/` directory for provider packages and working data. The lock file belongs in Git for team projects, while `.terraform/` stays local.

The useful end of the output should look like this:

```console
Terraform has been successfully initialized!

Terraform has created a lock file .terraform.lock.hcl to record the provider
selections it made above.
```

That tells you the AWS provider was selected and the lock file now records the exact version and checksums for future runs.

Validate the configuration. This catches many local mistakes before Terraform asks AWS about remote resources.

```bash
terraform validate
```

`terraform validate` checks the configuration shape before Terraform tries to change remote infrastructure. It can catch missing arguments, wrong references, invalid block structure, and variable validation problems. A validation failure is a helpful early stop because no S3 API change has happened yet.

Successful validation is intentionally short:

```console
Success! The configuration is valid.
```

That line means the HCL, references, variable types, provider schemas, and local configuration shape passed Terraform's local checks. Infrastructure creation still waits for the reviewed plan and apply.

Now create the plan. Saving it gives you one reviewed file that can be applied exactly.

```bash
terraform plan -out=tfplan
```

`terraform plan` reads the current state, compares it to the configuration, asks providers about existing remote objects, and proposes the actions needed to make the remote system match the files. Saving the plan as `tfplan` lets you apply the exact plan you reviewed.

For the first run, the summary should be all creates:

```console
Plan: 6 to add, 0 to change, 0 to destroy.
```

The `6 to add` should match the six S3 resources in this project. A different count is a signal to slow down and read the detailed plan.

The plan should show creates for these resource addresses. This list gives you a quick checklist before you read the detailed plan body.

- `aws_s3_bucket.site`
- `aws_s3_bucket_public_access_block.site`
- `aws_s3_bucket_website_configuration.site`
- `aws_s3_bucket_policy.site_read`
- `aws_s3_object.index`
- `aws_s3_object.error`

This is the first important review moment. Check that Terraform wants to create one bucket with your lab name, one website configuration, one public read policy for that bucket's objects, and two HTML objects. A surprise destroy, replacement, unknown bucket name, or policy attached to the wrong ARN means you should stop and fix the configuration before applying.

You can inspect the saved plan in human-readable form. This is the version you would normally paste into a review note or read in a deployment job.

```bash
terraform show tfplan
```

In a team workflow, this plan output often appears in a pull request or deployment job. For this lab, reading it yourself builds the habit. The plan is the last quiet moment before Terraform calls AWS to create the resources.

## Apply and Verify the Website
<!-- section-summary: Apply performs the reviewed change, and verification proves the S3 website works from the outside. -->

Apply the saved plan. This command asks Terraform to perform the exact changes that were written into `tfplan`.

```bash
terraform apply tfplan
```

Terraform should create the S3 resources and then print the outputs. The `website_url` output should look like an HTTP S3 website endpoint. The exact hostname depends on the region and AWS endpoint format.

The end of a successful apply should include output values like these:

```console
Apply complete! Resources: 6 added, 0 changed, 0 destroyed.

Outputs:

site_bucket_name = "devpolaris-first-site-yourname-20260628"
website_url = "http://devpolaris-first-site-yourname-20260628.s3-website-us-east-1.amazonaws.com"
```

The output names come from `outputs.tf`. The bucket name proves the output consumed `aws_s3_bucket.site.bucket`, and the URL proves the output consumed `aws_s3_bucket_website_configuration.site.website_endpoint`.

The raw output form is useful for the browser test. It removes quotes and display formatting so the URL can flow into another command.

```bash
terraform output -raw website_url
```

Then test it with `curl`. This checks the public path without relying on the AWS console.

```bash
curl "$(terraform output -raw website_url)"
```

The response should include the `DevPolaris Launch Notes` heading from `index.html`. You can also open the URL in a browser. That browser test proves the whole path works: public internet request, S3 website endpoint, bucket policy, object lookup, and HTML response.

```console
<h1>DevPolaris Launch Notes</h1>
```

Test the error document too. A missing path should return the fallback HTML file from the website configuration.

```bash
curl "$(terraform output -raw website_url)/missing-page"
```

The response should include the `Page Not Found` heading from `error.html`. This verifies that the website configuration points at the error document you uploaded.

```console
<h1>Page Not Found</h1>
```

If the request returns `403 Access Denied`, start with the bucket policy and Block Public Access settings. The policy needs `s3:GetObject` on the object path, and account-level public access blocks can override bucket-level settings. If the request returns `404 Not Found`, check the object keys and the exact case of `index.html` and `error.html` because S3 object keys are case-sensitive.

The live website is intentionally small, but the verification habit is production-shaped. After any apply, real teams check the thing users or systems depend on: a URL responds, a bucket exists, a queue receives messages, a role can assume the expected permissions, or a database endpoint accepts the expected network path.

## Notice State and Clean Up
<!-- section-summary: Terraform writes state for the lab, and destroy removes the lab only after you review the destroy plan. -->

After apply, Terraform writes state for the resources it manages. **State** is Terraform's record that connects resource addresses in your files to real remote objects in AWS. This project may use local state in `terraform.tfstate`, while team projects usually use a remote backend with access control and locking.

For this first project, the main state habit is simple: notice that Terraform created a local state file and treat it as a working artifact. Real state can contain resource IDs, generated values, configuration details, and sometimes sensitive data depending on the providers and resources involved. Later state articles will teach how to inspect, move, import, lock, and store state safely. In this lab, avoid pasting state into chat, screenshots, or commits.

Before cleanup, review the destroy plan. The destroy review matters because deleting the wrong thing is still a real infrastructure change.

```bash
terraform plan -destroy -out=destroy.tfplan
```

Destroy mode should show deletes for the same lab resources. The bucket name should be the unique name from your `terraform.tfvars`. The plan should not mention unrelated resources, because this dedicated folder should manage only the lab website.

```console
Plan: 0 to add, 0 to change, 6 to destroy.
```

Now remove the lab by applying the reviewed destroy plan. This command should clean up the temporary S3 website resources from the sandbox account.

```bash
terraform apply destroy.tfplan
```

Terraform applies the exact destroy actions saved in `destroy.tfplan`. If destroy fails because someone uploaded extra objects outside Terraform, remove those extra objects from the lab bucket and run the destroy plan again.

Remove the saved plan files after cleanup. Plan files are run artifacts, and real plans may contain sensitive provider details.

```bash
rm -f tfplan destroy.tfplan
```

This command usually prints nothing after success. The useful check comes from the file list afterward.

Now check the folder before committing anything. The remaining files tell you what source material a real repository would keep.

```bash
find . -maxdepth 2 -type f | sort
```

A clean lab folder should still contain the project files you wrote and the lock file Terraform created. Plan and state artifacts should be absent from this list:

```console
./.terraform.lock.hcl
./locals.tf
./main.tf
./outputs.tf
./providers.tf
./terraform.tfvars
./variables.tf
./versions.tf
./website/error.html
./website/index.html
```

A real Git repository should commit the `.tf` files, the website files, and `.terraform.lock.hcl`. The local `.terraform/` directory, state files, plan files, crash logs, and secret variable files should stay out of commits. A simple lab `.gitignore` can start like this:

```gitignore
.terraform/
*.tfstate
*.tfstate.*
crash.log
crash.*.log
tfplan
*.tfplan
*.auto.tfvars
*.auto.tfvars.json
terraform.tfvars
```

Some teams commit non-secret `.tfvars` files for shared environments, and some keep all environment values in CI/CD variables or workspace settings. The important beginner habit is to treat variable files as review material before committing them, because the same file type can hold harmless names in one project and secrets in another.

## Putting It All Together
<!-- section-summary: The first Terraform project uses real AWS resources while keeping the workflow small, reviewable, and simple to destroy. -->

You created a real Terraform project for a tiny S3 static website. The project declared the AWS provider, configured a region, accepted a unique bucket name, created a bucket, allowed a narrow public read policy for website objects, uploaded two HTML files, printed a website URL, and verified the result with `curl`.

The important lesson is the workflow around the resources. You formatted the code, initialized the provider, validated the configuration, saved and reviewed a plan, applied the reviewed plan, tested the live result, noticed the state file, reviewed the destroy plan, and cleaned up the lab.

That loop is the foundation for production Terraform work. The next project may create a private artifact bucket, a VPC, a database, or a deployment role. The names and providers change, but the operating habit stays the same: small readable configuration, explicit inputs, no hardcoded secrets, reviewed plans, real verification, careful state handling, and clean destroy for temporary environments.

## After This Project

Next, we will look at expressions and functions. The S3 lab already used `var.site_bucket_name`, `local.common_tags`, string interpolation, `jsonencode`, `path.module`, and `filemd5`. The next article steps away from the lab and slows down on that value work, because larger Terraform projects need readable names, tags, lists, maps, policies, and small environment choices.

---

**References**

- [Tutorial: Configuring a static website on Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/HostingWebsiteOnS3Setup.html) - AWS documents S3 website hosting, index and error documents, public access requirements, HTTP-only website endpoints, and cleanup.
- [Setting permissions for website access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteAccessPermissionsReqd.html) - AWS explains public read bucket policies, Block Public Access behavior, account-level restrictions, and object ownership notes.
- [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) - AWS explains how S3 Block Public Access settings work across access points, buckets, accounts, and organizations.
- [Install Terraform](https://developer.hashicorp.com/terraform/install) - HashiCorp provides current Terraform installation instructions for supported operating systems.
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs) - Terraform Registry source for AWS provider configuration, resources, and version behavior.
- [sts get-caller-identity](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html) - AWS CLI reference for confirming the sandbox account before Terraform runs.
- [aws_s3_bucket](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket), [aws_s3_bucket_website_configuration](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_website_configuration), [aws_s3_bucket_public_access_block](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_public_access_block), [aws_s3_bucket_policy](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_policy), and [aws_s3_object](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_object) - Terraform AWS provider resources used in the lab.
- [Terraform input variables](https://developer.hashicorp.com/terraform/language/values/variables) - HashiCorp explains variable blocks, validation, command-line values, and variable definition files.
- [terraform fmt](https://developer.hashicorp.com/terraform/cli/commands/fmt), [terraform init](https://developer.hashicorp.com/terraform/cli/commands/init), [terraform validate](https://developer.hashicorp.com/terraform/cli/commands/validate), [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan), and [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply) - HashiCorp CLI references for the main workflow commands used in the project.
- [terraform output](https://developer.hashicorp.com/terraform/cli/commands/output) - HashiCorp documents reading applied output values with human-readable, raw, and JSON formats.
