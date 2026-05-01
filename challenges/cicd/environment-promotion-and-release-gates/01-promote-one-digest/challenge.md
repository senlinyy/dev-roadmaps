---
title: "Promote One Image Digest"
sectionSlug: build-once-promote-one-image-digest
order: 1
---

The deployment workflow rebuilds before production, which breaks the build once, promote once rule. Production must receive the exact digest that staging already tested.

Your task:

1. **Expose the immutable image digest** from the build job as a job output.
2. **Deploy staging** with that digest instead of a movable tag.
3. **Deploy production** with the same digest without rebuilding the application.
4. **Keep production dependent** on both the build and staging jobs so the digest is available and staging remains the gate.

The grader checks the workflow structure and the deploy commands that consume the build digest.

