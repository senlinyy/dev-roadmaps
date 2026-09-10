---
title: "Repair ECS authorization without AdministratorAccess"
sectionSlug: repair-ecs-authorization-without-administratoraccess
order: 5
revision: 1
---

## Description

OIDC returns the expected `orders-deploy` identity, but deployment fails while passing the task’s runtime roles. A proposed workaround grants `iam:*` and `ecs:*` on every resource, expanding authority far beyond the failing operation.

As the platform engineer, use the denied operations and supplied resource identities to repair the deployment role’s authorization without merging CI and application privileges.

## Requirements

1. **Role Passing**. Allow only `orders-task` and `orders-execution` to be passed to `ecs-tasks.amazonaws.com`.
2. **Service Scope**. Scope service update and inspection permissions to the supplied `orders/orders` service.
3. **Action-Level Permissions**. Grant the operations deployment needs without broad action wildcards. Use wildcard resources only where the operation requires them.
4. **Role Separation**. Keep application and execution permissions on their existing runtime roles; do not give the application the CI deployment role.

:::expand[Workspace and verification]{kind="note"}

Editable files: `iam/deploy-policy.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
