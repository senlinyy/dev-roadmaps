---
retired: true
title: "Authorize a Specific Workload, Not Every Jenkins Token"
sectionSlug: how-do-oidc-claims-and-cloud-policies-replace-static-keys
order: 6
revision: 3
---

## Current situation

Checkout has a dummy OIDC token-file binding and a candidate AWS role. role-trust.json decides which workload may assume it; role-policy.json decides which service it may update.

## The issue

The candidate trusts every subject and grants all actions on all resources. Merely replacing a stored key with a token would preserve excessive authority.

## Your task

Repair both role documents: exact Jenkins issuer, sts.amazonaws.com audience, the supplied main-job URL subject, and only ecs:UpdateService on the checkout service ARN. Use AWS_ROLE_ARN and a scoped AWS_WEB_IDENTITY_TOKEN_FILE binding, verify caller identity, then deploy the tested package on trusted main capacity. Preserve the read-only application and scenario files.

## Success criteria

The authorized main job deploys production once. Other-job and wrong-audience cases reach role evaluation and are denied without production deployment. PRs never bind the token. All temporary bindings are removed. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Credentials are dummy references. withCredentials supports one string or file binding per block. The supplied publisher uses ./scripts/publish.sh with a bound environment token, or a quoted file-variable argument for file bindings. dir models the temporary-file visibility boundary around publisher operations, not a general shell working directory. aws sts get-caller-identity evaluates the authored issuer/audience/job and the two role-policy files; no token is signed and no AWS API is called. Only explicit single-statement trust and ecs:UpdateService policies are modeled.
:::
