---
title: "Refactor a Single-Stage Build"
sectionSlug: refactoring-into-real-stages
order: 1
---

The polaris-orders pipeline started as one fat `sh` block that does everything. The Blue Ocean view shows a single green stage even when the test suite fails inside it, because the script keeps running until the very end. The team needs to see Build, Test, and Package as separate stages so failures localize.

The current Jenkinsfile is in the editor. Your job:

1. **Replace the single `sh` block** with three named `stage` blocks: `Build`, `Test`, and `Package`.
2. **Inside `Build`**, run `sh 'mvn -B -DskipTests package'`.
3. **Inside `Test`**, run `sh 'mvn -B test'`.
4. **Inside `Package`**, run `sh 'docker build -t polaris-orders:${BUILD_NUMBER} .'`.

Keep the top-level `pipeline { agent any }` and add the `stages { ... }` block. The grader checks the block structure, not formatting.
