---
title: "Gate Production Deployment"
sectionSlug: manual-approval-without-manual-deploys
order: 3
---

The workflow deploys production automatically after staging, but production should wait on the environment gate and avoid overlapping releases. The deploy itself should stay automated after approval.

Your task:

1. **Attach the production environment** to the production deploy job with the public service URL.
2. **Keep production dependent** on both the build output and the staging gate.
3. **Add production concurrency** so two releases cannot update the same service at the same time.
4. **Preserve the automated deploy step** after the gate opens.

The grader checks the environment object, dependency chain, and concurrency policy.

