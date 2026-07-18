---
title: "Route Stages by Agent Capability"
sectionSlug: labels-and-agent-selection
order: 2
---

The checkout pipeline currently runs every stage on any available agent, which gives Maven workers unnecessary Docker access. Route each stage to the least-privileged pool that provides its required tools.

Your job:

1. **Stop reserving one agent for the whole pipeline** so each stage can choose its own capability pool.
2. **Route the Test stage** to agents labeled `linux && maven`.
3. **Route the Build Image stage** to agents labeled `linux && docker`.
4. **Keep both existing commands** inside their matching stages.

The grader checks the pipeline and stage agent hierarchy, label expressions, and commands.
