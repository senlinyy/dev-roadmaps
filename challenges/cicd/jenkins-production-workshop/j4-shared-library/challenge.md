---
title: "Version a Shared Library used by two services"
sectionSlug: version-a-shared-library-used-by-two-services
order: 4
revision: 1
---

## Description

Orders and Billing maintain copied Jenkinsfiles that both run checks and create compiled archives, but use different artifact names. An experimental shared library hardcodes Orders-specific paths and asks consumers to follow a moving `main` branch.

As the platform engineer, build a small, reviewable Shared Library interface and migrate both services without coupling them to one application’s paths.

## Requirements

1. **Shared Interface**. Implement the common checks and packaging flow while accepting each consumer’s artifact identity explicitly.
2. **Input Safety**. Validate caller-supplied artifact names. Keep fixed commands in trusted library code so inputs cannot inject shell commands or replace the build recipe.
3. **Versioned Consumers**. Migrate both Jenkinsfiles to a reviewed library version while retaining their distinct artifact names.
4. **Library Verification**. Provide a smoke-test Jenkinsfile that exercises the interface before an organization-wide library upgrade.

:::expand[Workspace and verification]{kind="note"}

Editable files: `vars/nodePackage.groovy`, `orders/Jenkinsfile`, `billing/Jenkinsfile`, `test/Jenkinsfile`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
