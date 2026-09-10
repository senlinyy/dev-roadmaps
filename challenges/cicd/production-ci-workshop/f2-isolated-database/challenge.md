---
title: "Isolate integration-test databases"
sectionSlug: isolate-integration-test-databases
order: 2
revision: 1
---

## Description

The Orders integration workflow runs SQL migrations and tests against a shared staging database. Parallel runs collide on the same order ID, and a migration under test can alter the environment used by other teams.

As the CI maintainer, isolate database-backed tests so each run can change its schema and data without affecting staging.

## Requirements

1. **Database Isolation**. Give each integration job a fresh, ephemeral PostgreSQL service instead of the shared staging database.
2. **Readiness**. Wait for PostgreSQL to become ready before attempting migrations or tests.
3. **Migration and Test Execution**. Apply the supplied SQL migration and run the supplied integration assertions against that job’s database.
4. **Failure Safety**. Remove the staging credential dependency and keep SQL errors fatal. A bad migration must fail CI without modifying staging.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/integration.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
