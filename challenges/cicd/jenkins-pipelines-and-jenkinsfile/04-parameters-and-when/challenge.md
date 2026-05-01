---
title: "Gate Deploys with Parameters and `when`"
sectionSlug: parameters-environment-and-when-gating
order: 4
---

The devpolaris-orders pipeline always deploys to staging on every push to `main`, then waits for a manual `Promote` button before production. The team wants two changes:

1. The pipeline should accept a `DEPLOY_ENV` parameter (`staging` or `production`) and a `RUN_INTEGRATION_TESTS` boolean parameter (default `true`).
2. The `Deploy` stage should only run when `DEPLOY_ENV` equals `production` AND the build is on the `main` branch.

The Jenkinsfile already has a `Build` stage and a placeholder `Deploy` stage. Your job:

1. **Add a `parameters` block** at the pipeline level with a `choice` parameter named `DEPLOY_ENV` (choices `['staging', 'production']`) and a `booleanParam` named `RUN_INTEGRATION_TESTS` defaulting to `true`.
2. **Add a `when` block to the existing `Deploy` stage** that combines `branch 'main'` with `expression { params.DEPLOY_ENV == 'production' }`. Wrap them in `allOf { ... }` so both must hold.
3. **Leave the `Build` stage and `Deploy` stage `steps` block** untouched.

The grader checks the parameter shape and the `when` block structure.
