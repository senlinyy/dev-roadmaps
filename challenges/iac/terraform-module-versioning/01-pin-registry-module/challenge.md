---
title: "Pin a Registry Module Release Range"
sectionSlug: a-safe-upgrade-workflow
order: 1
revision: 2
---

The production VPC currently follows every new module release. Bound the dependency to compatible 5.x releases so upgrades are intentional and reviewed through a fresh initialization and plan.

Your job:

1. **Use** module source `terraform-aws-modules/vpc/aws`.
2. **Set** module version to `~> 5.8`.
3. **Pass** name `orders-prod` and CIDR `10.42.0.0/16`.
4. **Do** not use an unpinned Git URL or a floating branch.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
