---
title: "Separate Pipeline Trust Boundaries"
sectionSlug: pipeline-permissions-and-runner-boundaries
order: 1
---

A single workflow job currently gives pull-request code an OIDC token and package write access. Split validation from release so stronger credentials exist only after trusted tests pass.

Your job:

1. **Keep the `test` job read-only** with `contents: read` and no OIDC or package write permission.
2. **Run checkout, dependency review, and tests** in the test job.
3. **Create a `publish` job that depends on `test`**, runs only on `main`, and targets `production`.
4. **Grant OIDC and package write permission only to publish**.

The grader checks both permission boundaries, the validation steps, and the protected publish gate.
