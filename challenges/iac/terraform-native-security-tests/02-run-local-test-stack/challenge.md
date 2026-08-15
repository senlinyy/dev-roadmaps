---
title: "Run the Local Terraform Test Stack"
sectionSlug: local-checks-before-anything-else
order: 2
revision: 2
---

The module and its native test are complete in `/workspace`. Run the local checks in increasing cost order and finish by proving the test suite passes.

Your job:

1. **Check** formatting without rewriting files.
2. **Initialize** the module.
3. **Validate** its configuration.
4. **Run** the native Terraform tests and confirm one pass with zero failures.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.
