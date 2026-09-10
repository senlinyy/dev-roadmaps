---
title: "Separate untrusted multibranch builds from release authority"
sectionSlug: separate-untrusted-multibranch-builds-from-release-authority
order: 7
revision: 1
---

## Description

Contributor-controlled Jenkinsfiles can request the same agent labels used for production deployment. Naming conventions do not prevent untrusted Pipeline code from reaching release agents and their credentials.

As the platform engineer, separate the CI and release control planes so production authority does not depend on contributors choosing the right labels.

## Requirements

1. **Control-Plane Separation**. Configure separate CI and release controllers and agent identities so untrusted jobs cannot schedule release agents or read release credentials.
2. **Storage and Host Isolation**. Keep controller storage separate and do not share `JENKINS_HOME` or a host Docker socket between the two sides.
3. **Trusted Release Code**. Define the release job from protected automation SCM rather than a contributor’s Jenkinsfile or archived scripts.
4. **Artifact Boundary**. Accept only verified artifact identities across the CI-to-release boundary; do not transfer arbitrary executable release logic from CI.

:::expand[Workspace and verification]{kind="note"}

Editable files: `compose.yaml`, `release/Jenkinsfile`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
