---
title: "Pin Module Sources"
sectionSlug: a-safe-upgrade-workflow
order: 1
---

The platform root module consumes one registry module without a version and one Git module from a moving branch. Pin both dependencies so a normal plan cannot silently adopt new module code.

Your job:

1. **Keep the registry source `terraform-aws-modules/vpc/aws`** and constrain it to compatible `5.x` releases with `~> 5.0`.
2. **Keep the Git source repository** for the observability module.
3. **Pin the Git source to tag `v2.4.1`** through its `ref` query.
4. **Do not add a version argument to the Git module**, because Git sources are pinned in the source URL.

The grader checks each module block and rejects the moving `main` reference.
