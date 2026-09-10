---
title: "Resume a deployment from durable release identity"
sectionSlug: resume-a-deployment-from-durable-release-identity
order: 8
revision: 1
---

## Description

ECS accepted an Orders deployment before CI lost its connection. The approved release record already contains the candidate and previous task-definition ARNs, but the retry path rebuilds and can overwrite a newer service revision.

As the release engineer, make the deployment resumable through the existing DynamoDB coordinator without creating another candidate or losing ownership of unfinished work.

## Requirements

1. **Release Ownership**. Claim the approved desired release through the existing coordinator and reject superseded releases.
2. **State-Aware Resume**. Inspect ECS, reject unexpected current revisions, and reuse the recorded candidate without rebuilding or registering another task definition.
3. **Failure Recovery**. Retain ownership after failure for explicit recovery. Do not expire a claim while deployment work may still continue.
4. **Completion Record**. Record successful completion only after the deployment reaches the required successful state.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/resume.py`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
