---
title: "Compose a Flat Root Module"
sectionSlug: flat-root-wiring
order: 1
revision: 2
---

Production needs network, application, and monitoring capabilities. Keep discovery and composition in the root, then pass only stable outputs between three focused child modules.

Your job:

1. **Call** `network` from `../../modules/network` with CIDR `10.42.0.0/16`.
2. **Pass** `module.network.private_subnet_ids` and `module.network.vpc_id` into module `service`.
3. **Pass** `module.service.endpoint` into module `monitoring`.
4. **Keep** all three module calls as siblings in the root.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
