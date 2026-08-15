---
title: "Prove the Canary Target Set"
sectionSlug: verifying-the-target-set
order: 1
revision: 2
---

A maintenance play should reach production web hosts except the canary node, while a separate preview should target only the canary. Use host-pattern inspection to prove both sets before previewing `deploy.yml` on `web-canary-01`.
