---
retired: true
title: "Validate an Upgrade and Its Recovery Path"
sectionSlug: how-do-rebuild-and-boot-tests-reveal-controller-failures
order: 6
revision: 3
---

## Current situation

Checkout is upgrading its core and plugin family. Startup can migrate persistent state, so the old image/configuration/state combination must remain recoverable.

## The issue

The plan restarts without a backup and promotes without representative testing. Reusing an old image alone would not prove recovery.

## Your task

Prepare the lab-core-2/lab-2 candidate. Back up the previous image/config/state, build and boot, smoke-test, and promote only when healthy. Add conditional restore after that path; it executes only when an earlier operation failed. Preserve the read-only application and scenario files.

## Success criteria

The healthy candidate is promoted without restoration. The migration-failure case restores the matching old image and state, leaves the controller running, and records no promotion. Removing backup or smoke cannot pass. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
maintenance.yaml is a lab operation list, not Jenkins syntax. Supported operations: backup, build, boot, reload, smoke, promote, restore. Operations run in order; failures block subsequent work until restore, which runs only on failure. Reload changes JCasC data, never loaded plugin binaries. Smoke verifies loaded settings and executes the supplied simulated agent pipeline. Restore uses the matching previous image/config/state backup.

The five-instruction Dockerfile subset is FROM, COPY plugins.txt to /usr/share/jenkins/ref/plugins.txt, RUN jenkins-plugin-cli --plugin-file with that path, COPY jenkins.yaml to /usr/share/jenkins/ref/jenkins.yaml, and ENV CASC_JENKINS_CONFIG pointing there. The lab-* image and plugin versions are explicit fixture labels, not real releases. The catalog models tested dependency pairs rather than the full Jenkins plugin resolver. No container, controller, secret or plugin executes.
:::
