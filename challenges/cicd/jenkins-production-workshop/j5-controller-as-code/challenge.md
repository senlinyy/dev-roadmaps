---
title: "Recreate a secured Jenkins controller"
sectionSlug: recreate-a-secured-jenkins-controller
order: 5
revision: 1
---

## Description

The Jenkins controller was configured manually, and its backup omits the plugin inventory and agent settings. A fresh image starts without authentication or the configuration needed to run the existing pipeline.

As the Jenkins maintainer, make controller provisioning reproducible while protecting administrator credentials and keeping builds on an independently provisioned agent.

## Requirements

1. **Pinned Installation**. Specify a pinned controller image and explicit plugin versions as reviewable build inputs.
2. **Configuration as Code**. Supply JCasC with authentication enabled and administrative access restricted to the named administrator.
3. **Secret Handling**. Externalize administrator and SSH secrets instead of embedding their values in the image or configuration.
4. **Agent and Controller Separation**. Keep controller executors at zero and configure the Node 22 agent with a verified SSH host key. Use the representative Jenkinsfile to verify the restored setup.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Dockerfile`, `plugins.lock`, `jenkins.yaml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
