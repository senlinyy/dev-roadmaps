---
title: "Scope Jenkins deployment authority to a trusted agent"
sectionSlug: scope-jenkins-deployment-authority-to-a-trusted-agent
order: 3
revision: 1
---

## Description

The Jenkins release job binds a globally shared AWS access key and prints its environment. Ordinary builds can obtain the same long-lived credential, even though a dedicated EC2 deployment agent already has the `orders-jenkins-agent` instance role.

As the platform engineer, move deployment to temporary workload credentials and keep that authority outside application build jobs.

## Requirements

1. **Static Credential Removal**. Remove the shared AWS key binding and environment dumps; masking alone is not credential isolation.
2. **Role Trust**. Configure trust so only the named EC2 instance role can assume `orders-deploy`.
3. **Agent Authorization**. Scope the agent policy to assuming the deployment role and keep application builds away from the privileged deployment agent.
4. **Credential Lifetime**. Use temporary credentials only around deployment and never print or archive them.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Jenkinsfile`, `iam/trust.json`, `iam/agent-policy.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
