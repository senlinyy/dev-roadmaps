---
retired: true
title: "Reconstruct a Controller From Reviewed Inputs"
sectionSlug: why-does-manual-controller-configuration-become-risky
order: 3
revision: 3
---

## Current situation

The controller's manual history is no longer trustworthy. Dockerfile, plugins.txt, JCasC and a maintenance plan are editable; a fixed smoke Jenkinsfile exercises a simulated Node allocation.

## The issue

The image omits configuration, plugins float outside the tested set, and promotion has no boot or smoke evidence.

## Your task

Reconstruct the image with the exact catalog-tested lab-core-2 and lab-2 plugin set. Install plugins, copy JCasC, wire CASC_JENKINS_CONFIG, preserve external administrator-secret references, then build, boot, smoke-test and promote. Preserve the read-only application and scenario files.

## Success criteria

The exact candidate passes controller and agent smoke before promotion. Missing runtime secrets prevent startup and promotion. The lab-* versions are simulation labels, not installable releases. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
maintenance.yaml is a lab operation list, not Jenkins syntax. Supported operations: backup, build, boot, reload, smoke, promote, restore. Operations run in order; failures block subsequent work until restore, which runs only on failure. Reload changes JCasC data, never loaded plugin binaries. Smoke verifies loaded settings and executes the supplied simulated agent pipeline. Restore uses the matching previous image/config/state backup.

The five-instruction Dockerfile subset is FROM, COPY plugins.txt to /usr/share/jenkins/ref/plugins.txt, RUN jenkins-plugin-cli --plugin-file with that path, COPY jenkins.yaml to /usr/share/jenkins/ref/jenkins.yaml, and ENV CASC_JENKINS_CONFIG pointing there. The lab-* image and plugin versions are explicit fixture labels, not real releases. The catalog models tested dependency pairs rather than the full Jenkins plugin resolver. No container, controller, secret or plugin executes.
:::
