---
title: "Configure Branch-Filtered Triggers"
sectionSlug: a-real-scenario-pr-vs-push-events
order: 2
---

Your team wants to reduce CI costs. Right now, the workflow runs on every push to every branch, which burns through runner minutes on experimental branches that nobody reviews.

Your task:

1. **Configure the workflow** so that it only runs when code is pushed to the production-ready branch, or when a Pull Request targets that branch.
2. **Use branch filters** under each event to restrict execution.

The grader validates that both event types exist in the `on` block with branch filter arrays, and that the main branch is included.
