---
retired: true
title: "Distinguish Saved Configuration From Loaded Code"
sectionSlug: when-is-a-reload-enough-and-when-is-a-restart-required
order: 5
revision: 3
---

## Current situation

The current process is lab-core-1 with lab-1 plugins. A prepared lab-core-2 Dockerfile and new desired message are available.

## The issue

The plan treats a YAML reload as if it replaced plugin classes. Snapshots distinguish authored inputs from loaded process state.

## Your task

Complete the lab-2 manifest. Apply the YAML reload to show its limited effect, then build and boot the new image, smoke-test that process, and promote only its tested digest. Preserve the read-only application and scenario files.

## Success criteria

Evidence contains both JCasC reload and fresh boot, followed by smoke and promotion. Loaded code ends at lab-core-2; a startup migration failure prevents promotion. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
maintenance.yaml is a lab operation list, not Jenkins syntax. Supported operations: backup, build, boot, reload, smoke, promote, restore. Operations run in order; failures block subsequent work until restore, which runs only on failure. Reload changes JCasC data, never loaded plugin binaries. Smoke verifies loaded settings and executes the supplied simulated agent pipeline. Restore uses the matching previous image/config/state backup.

The five-instruction Dockerfile subset is FROM, COPY plugins.txt to /usr/share/jenkins/ref/plugins.txt, RUN jenkins-plugin-cli --plugin-file with that path, COPY jenkins.yaml to /usr/share/jenkins/ref/jenkins.yaml, and ENV CASC_JENKINS_CONFIG pointing there. The lab-* image and plugin versions are explicit fixture labels, not real releases. The catalog models tested dependency pairs rather than the full Jenkins plugin resolver. No container, controller, secret or plugin executes.
:::
