---
title: "Define the Canary Policy"
sectionSlug: traffic-weights
order: 1
---

The current policy sends too much checkout traffic to a risky discount change and does not define enough stop rules. A canary needs a small first move and specific conditions for continuing.

Your task:

1. **Set the first traffic slice** to one percent for this checkout-risk release.
2. **Use a ten minute watch window** before promotion.
3. **Require metrics split by release** so aggregate service graphs cannot hide the canary.
4. **Add at least four structured stop rules** using `signal`, `comparison`, and `action`. Cover `5xx_rate` and `p95_latency` when canary is above stable, `checkout_success` when canary is below stable, and `new_error_pattern` when it is present only in canary. Every rule must stop the rollout.

The grader checks the structured canary policy.
