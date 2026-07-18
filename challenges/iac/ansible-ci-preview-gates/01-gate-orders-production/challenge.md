---
title: "Gate the Orders Production Rollout"
sectionSlug: build-the-pipeline-gates
order: 1
---

The orders playbook is ready for CI, but production changes need review evidence before any host is changed. Complete the GitHub Actions workflow so pull requests preview only `orders-web-01`, while the canary apply stays behind the `production` environment and cannot overlap another orders deployment.

Your job:

1. **Keep the workflow token read-only** and create a preview job for the production inventory and `orders.yml`.
2. **Run the preview against `orders-web-01`** with both Ansible check mode and diff mode.
3. **Make the canary job depend on preview** and protect it with the `production` environment and `orders-production` concurrency key.
4. **Apply only to `orders-web-01`** in the protected job, without check mode or diff mode.

The grader checks the workflow structure, exact target boundary, preview flags, and protected apply sequence.
