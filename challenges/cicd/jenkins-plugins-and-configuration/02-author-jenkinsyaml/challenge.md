---
retired: true
title: "Apply Safe Controller Configuration"
sectionSlug: how-do-jenkinsyaml-define-controller-configuration
order: 2
revision: 3
---

## Current situation

The controller image and plugin set are prepared. JCasC defines a local smoke administrator and controller URL, but several settings have drifted.

## The issue

Built-in executors, public signup, anonymous reads and a literal password violate the intended setup.

## Your task

Repair jenkins.yaml: zero built-in executors, EXCLUSIVE mode, message Checkout controller managed by code, disabled signup and anonymous access, jenkins-admin using JENKINS_ADMIN_PASSWORD, and https://jenkins.example.com/. Build, boot, smoke and promote the matching candidate. Preserve the read-only application and scenario files.

## Success criteria

Smoke checks loaded settings and the Node job, not only YAML syntax. Missing secrets prevent boot and promotion. The one-admin realm is an isolated training fixture, not an organization-wide authorization design. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
maintenance.yaml is a lab operation list, not Jenkins syntax. Supported operations: backup, build, boot, reload, smoke, promote, restore. Operations run in order; failures block subsequent work until restore, which runs only on failure. Reload changes JCasC data, never loaded plugin binaries. Smoke verifies loaded settings and executes the supplied simulated agent pipeline. Restore uses the matching previous image/config/state backup.

The five-instruction Dockerfile subset is FROM, COPY plugins.txt to /usr/share/jenkins/ref/plugins.txt, RUN jenkins-plugin-cli --plugin-file with that path, COPY jenkins.yaml to /usr/share/jenkins/ref/jenkins.yaml, and ENV CASC_JENKINS_CONFIG pointing there. The lab-* image and plugin versions are explicit fixture labels, not real releases. The catalog models tested dependency pairs rather than the full Jenkins plugin resolver. No container, controller, secret or plugin executes.
:::
