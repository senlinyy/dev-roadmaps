---
title: "Diagnose a Partial Run"
sectionSlug: a-production-debugging-walkthrough
order: 1
revision: 2
---

Run the deployment preview against the production web group and use its task output and recap to identify the unreachable host and the task that fails on reachable hosts. Then narrow a second preview to `web-01` so the evidence is isolated from the SSH failure.
