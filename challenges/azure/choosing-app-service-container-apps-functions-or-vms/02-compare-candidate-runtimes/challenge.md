---
title: "Compare Candidate Runtimes"
sectionSlug: workload-symptoms-to-azure-choices
order: 2
description: "Inspect the current production compute resources and use their evidence to compare fit."
---

The team is reviewing four production resources before simplifying its compute choices. Use Azure CLI evidence from `rg-devpolaris-orders-prod`:

- `app-devpolaris-orders-api-prod` is the web app candidate.
- `ca-devpolaris-orders-api-prod` is the container candidate.
- `func-devpolaris-orders-jobs-prod` is the event job candidate.
- `vm-devpolaris-orders-legacy-01` is the legacy machine candidate.

Collect enough evidence to explain which one is an always-on API home, which one uses container revisions, which one reacts to events, and which one is a managed machine.
