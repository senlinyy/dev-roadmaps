---
title: "Promote the Tested Digest"
sectionSlug: build-once-promote-the-same-artifact
order: 1
---

The release workflow rebuilds the booking API separately for staging and production. Replace that drift-prone design with one digest supplied by the release process.

Your job:

1. **Accept a required `image_digest` workflow input** for manual releases.
2. **Deploy `registry.example.com/booking-api@${{ inputs.image_digest }}`** to staging.
3. **Make production depend on staging** and target the protected `production` environment.
4. **Deploy the same digest to production**, with no checkout, build, or tag-based image reference.

The grader checks the input contract, both immutable references, the promotion dependency, and the absence of rebuild commands.
