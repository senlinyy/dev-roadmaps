---
title: "Wire @Library into a Jenkinsfile"
sectionSlug: configuring-and-loading-libraries
order: 2
---

The polaris-orders repo has a long inline Jenkinsfile with three stages. The platform team has shipped a `polaris-pipeline` shared library at the org level that defines a `buildJavaService` global step. The team wants the orders Jenkinsfile reduced to three lines: load the library at a pinned version, then call the global step with the right config.

The current full Jenkinsfile is in the editor. Your job:

1. **Load the library** by adding `@Library('polaris-pipeline@v1.4.2') _` at the very top of the file.
2. **Replace the entire `pipeline { ... }` block** with a single call to `buildJavaService(...)`. Pass `service: 'orders'`, `mavenGoals: ['package', 'verify', 'integration-test']`, and `agentLabel: 'linux-jdk21'`.

The grader checks that `@Library` is present with the right pin, the inline `pipeline` block is gone, and `buildJavaService` is called with the three Map keys.
