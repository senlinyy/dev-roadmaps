---
title: "Fill in the Pipeline Skeleton"
sectionSlug: anatomy-of-a-declarative-pipeline
order: 2
---

A new repo has a Jenkinsfile that is missing the structural blocks needed for a declarative pipeline. The build runs but Jenkins reports `WorkflowScript: 1: Missing required section "agent"`. Your job:

1. **Pin the build to a labeled agent** by adding `agent { label 'linux-jdk21' }` directly under `pipeline`.
2. **Add an `environment` block** at the pipeline level that exports `MAVEN_OPTS = "-Xmx1g"`.
3. **Add an `options` block** with `timeout(time: 30, unit: 'MINUTES')` and `disableConcurrentBuilds()` so a stuck build cannot block the queue.
4. **Leave the existing `Verify` stage in place.** The grader checks the new blocks plus that the existing stage still runs `sh 'mvn -B verify'`.

The grader checks block structure. It does not care about formatting or order, but every named block must exist with the right contents.
