---
title: "Refactor a Small Chart Contract"
sectionSlug: clean-up-a-sprawling-package
order: 1
---

The orders chart duplicated names and labels across templates while exposing unrelated feature toggles in `values.yaml`. Refactor the package so users control only the release inputs that genuinely vary, while templates share one namespaced label helper.

Your job:

1. **Keep `values.yaml` focused** on `replicaCount`, image repository and tag, and Service port. Do not add environment-specific names, label maps, or feature flags.
2. **Define helper `orders-api.selectorLabels`** with application name `orders-api` and instance label from `.Release.Name`.
3. **Use that helper in the Deployment selector and Pod template labels** rather than duplicating literal label blocks.
4. **Use the same helper in the Service selector** and read caller port from `.Values.service.port`.
5. **Wire the Deployment image and replica count** from the small values contract.

The grader checks all three files, requires the shared helper at every ownership boundary, and rejects common value and label duplication patterns.
