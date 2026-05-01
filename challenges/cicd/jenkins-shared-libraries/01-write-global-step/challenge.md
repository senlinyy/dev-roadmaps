---
title: "Write a vars/ Global Step"
sectionSlug: the-global-step-in-vars
order: 1
---

The devpolaris-pipeline shared library needs a new global step `buildJavaService` that every Java microservice can call from a one-line Jenkinsfile. The contract is: the caller passes a `Map config` with `service` (string), `mavenGoals` (list of strings, default `['package', 'verify']`), and `agentLabel` (string, default `'linux-jdk21'`). The step renders the full pipeline.

You are editing `vars/buildJavaService.groovy`. Your job:

1. **Define `def call(Map config = [:])`** as the entry point.
2. **Inside `call`**, declare a `pipeline { ... }` block whose `agent` uses `config.agentLabel ?: 'linux-jdk21'`.
3. **Inside `stages`**, create one stage `Build` whose `steps { sh ... }` runs `mvn -B ${(config.mavenGoals ?: ['package', 'verify']).join(' ')}`.
4. **Add a `post.failure` block** at the pipeline level that calls `error "${config.service} failed"`.

The grader checks the block structure: `call` exists with a `pipeline` inside, the agent uses `config.agentLabel`, the stage is named `Build`, the sh references `config.mavenGoals`, and `post.failure` references `config.service`.
