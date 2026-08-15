---
title: "Initialize and Inspect the Provider Lock"
sectionSlug: terraform-init-and-the-lock-file
order: 2
revision: 2
---

The provider requirement is ready in `/workspace`. Initialize the project, then inspect the dependency lock file to verify Terraform recorded the selected provider source and checksum.

Your job:

1. **Initialize** the working directory.
2. **Read** `.terraform.lock.hcl` and confirm it records `registry.terraform.io/hashicorp/aws` plus a checksum.
3. **Do** not edit the generated lock file by hand.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.
