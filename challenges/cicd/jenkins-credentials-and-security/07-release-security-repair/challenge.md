---
retired: true
title: "Repair the Complete Release Trust Chain"
sectionSlug: how-does-the-complete-jenkins-security-chain-fit-together
order: 7
revision: 3
---

## Current situation

Checkout publishes its application and updates one production service. The fixture includes a PR, a unit regression, an unauthorized OIDC subject and a healthy main release.

## The issue

The draft runs validation on privileged capacity, binds too broadly, rebuilds near deployment and relies on permissive cloud trust. No single quoting or branch fix addresses the whole chain.

## Your task

Separate low-authority checks/build from main-only release work. Build once, transfer those bytes, publish with a narrowly scoped registry binding, then verify the workload role and deploy using a separate scoped token-file binding. Repair exact cloud trust and least-privilege permissions; preserve failure reports and cleanup. Preserve the read-only application and scenario files.

## Success criteria

Healthy main publishes and deploys one build. A PR has neither access nor release events. Failed tests never release. An unauthorized workload can reach cloud-role evaluation but cannot deploy production. No exposure or live binding remains. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Credentials are dummy references. withCredentials supports one string or file binding per block. The supplied publisher uses ./scripts/publish.sh with a bound environment token, or a quoted file-variable argument for file bindings. dir models the temporary-file visibility boundary around publisher operations, not a general shell working directory. aws sts get-caller-identity evaluates the authored issuer/audience/job and the two role-policy files; no token is signed and no AWS API is called. Only explicit single-statement trust and ecs:UpdateService policies are modeled.
:::
