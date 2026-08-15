---
title: "Build the Review Workflow"
sectionSlug: build-the-pipeline-gates
order: 1
revision: 2
---

Create a pull-request workflow that installs pinned Ansible dependencies, runs syntax validation, records the production host set, and performs a diff-enabled check-mode preview limited to the canary group. Do not place Vault passwords or SSH private keys in the workflow.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
