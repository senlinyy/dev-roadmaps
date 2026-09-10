---
retired: true
title: "Repair the Whole Plugin Dependency Set"
sectionSlug: why-do-plugins-and-configuration-form-one-dependency-graph
order: 4
revision: 3
---

## Current situation

The candidate combines a newer Git plugin with an older Git client and core. The fixed catalog records tested dependency pairs and minimum core levels.

## The issue

The plugin graph cannot load even though each file is valid text. Editing an application pipeline cannot repair this lower-layer mismatch.

## Your task

Repair Dockerfile and plugins.txt as one tested set using lab-core-2 and all lab-2 plugins. Preserve JCasC. Replace the reload-only plan with candidate build, fresh boot, representative smoke, and promotion. Preserve the read-only application and scenario files.

## Success criteria

Plugin resolution, JCasC and Node smoke succeed before promotion. If both Node agents are offline, the smoke fails and the candidate is not promoted. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
maintenance.yaml is a lab operation list, not Jenkins syntax. Supported operations: backup, build, boot, reload, smoke, promote, restore. Operations run in order; failures block subsequent work until restore, which runs only on failure. Reload changes JCasC data, never loaded plugin binaries. Smoke verifies loaded settings and executes the supplied simulated agent pipeline. Restore uses the matching previous image/config/state backup.

The five-instruction Dockerfile subset is FROM, COPY plugins.txt to /usr/share/jenkins/ref/plugins.txt, RUN jenkins-plugin-cli --plugin-file with that path, COPY jenkins.yaml to /usr/share/jenkins/ref/jenkins.yaml, and ENV CASC_JENKINS_CONFIG pointing there. The lab-* image and plugin versions are explicit fixture labels, not real releases. The catalog models tested dependency pairs rather than the full Jenkins plugin resolver. No container, controller, secret or plugin executes.
:::
