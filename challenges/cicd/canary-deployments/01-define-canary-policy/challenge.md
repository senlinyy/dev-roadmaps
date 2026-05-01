---
title: "Define the Canary Policy"
sectionSlug: choosing-the-first-slice
order: 1
---

The current policy sends too much checkout traffic to a risky discount change and does not define enough stop rules. A canary needs a small first move and specific conditions for continuing.

Your task:

1. **Set the first traffic slice** to one percent for this checkout-risk release.
2. **Use a ten minute watch window** before promotion.
3. **Require metrics split by release** so aggregate service graphs cannot hide the canary.
4. **Add at least four stop rules** that cover errors, checkout success, latency, and new error patterns.

The grader checks the structured canary policy.

