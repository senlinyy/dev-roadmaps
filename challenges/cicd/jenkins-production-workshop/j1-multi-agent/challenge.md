---
title: "Repair artifacts and evidence across Jenkins agents"
sectionSlug: repair-artifacts-and-evidence-across-jenkins-agents
order: 1
revision: 1
---

## Description

Orders validation runs on the `node22` Jenkins agent, while package inspection runs on `package-tools`. The inspection agent has an empty workspace, and failed tests leave no retained JUnit result, making both artifact delivery and failure investigation unreliable.

As the Jenkins maintainer, repair the pipeline’s workspace handling and evidence collection across agents.

## Requirements

1. **Clean Workspaces**. Materialize the required repository files on each agent without relying on leftovers from earlier builds.
2. **Artifact Transfer**. Transfer the producer’s compiled package deliberately so the inspection agent receives the same archive without recompiling.
3. **Failure Evidence**. Publish JUnit results when tests fail and preserve the diagnostic evidence needed to investigate the run.
4. **Execution Gates**. Keep execution bounded and prevent the package consumer from proceeding after failed validation.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Jenkinsfile`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
