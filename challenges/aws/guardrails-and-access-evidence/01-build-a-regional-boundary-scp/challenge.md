---
title: "Build a Regional Boundary SCP"
sectionSlug: common-guardrails
order: 1
---

The production OU permits regional workloads only in `eu-west-1` and `eu-west-2`. Complete the SCP that denies API calls in every other Region while exempting the listed global services. Preserve the explicit deny model. Do not add an allow statement because an SCP sets a permissions ceiling rather than granting permissions.
