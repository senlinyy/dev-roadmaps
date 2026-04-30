---
title: "Find the Leaked Secret in Build Logs"
sectionSlug: how-masking-actually-works-and-where-it-fails
order: 2
---

A security audit ran a regex sweep over `/var/log/jenkins/builds/orders-api-12483.log` and flagged it. The build used `withCredentials` to bind a deploy token, so masking should have replaced the secret with `********`. Something leaked anyway.

Your job:

1. **Cat the build log** at `/var/log/jenkins/builds/orders-api-12483.log` to see what the masker did and did not catch.
2. **Find the line where the deploy token leaked** in the clear. The token starts with `dpop_`. Use `grep` to surface only the leaking line.
3. **Confirm the bound credential ID** by grepping the same log for the `withCredentials` startup line so a reviewer can see which credential was supposed to be masked.

The grader requires that you used `cat` and `grep`, and that the final stdout shows both the leaking line and the credential id reference.
