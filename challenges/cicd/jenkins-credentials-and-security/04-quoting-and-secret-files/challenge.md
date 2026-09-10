---
retired: true
title: "Keep Secret Material Out of Metadata and Artifacts"
sectionSlug: what-do-quoting-files-agents-and-masking-protect-or-expose
order: 4
revision: 3
---

## Current situation

The release publisher uses a dummy secret-file credential. Its config path should exist only during the trusted publishing block.

## The issue

The current workflow binds inside a browsable subdirectory, interpolates the sensitive path into Groovy metadata, and archives broadly. Masking the console does not repair those exposure paths.

## Your task

Validate and build before the release allocation, then transfer the application. Bind registry-file as PUBLISH_CONFIG before entering release, use shell-side expansion for the publisher's file argument, and archive only dist/app.json after leaving the credential scope. Keep PRs outside the release path. Preserve the read-only application and scenario files.

## Success criteria

Main publishes and archives the application without metadata/workspace exposure; the file binding is removed. A PR runs checks without any credential or publication. Failed tests never reach the publisher. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Credentials are dummy references. withCredentials supports one string or file binding per block. The supplied publisher uses ./scripts/publish.sh with a bound environment token, or a quoted file-variable argument for file bindings. dir models the temporary-file visibility boundary around publisher operations, not a general shell working directory. aws sts get-caller-identity evaluates the authored issuer/audience/job and the two role-policy files; no token is signed and no AWS API is called. Only explicit single-statement trust and ecs:UpdateService policies are modeled.
:::
