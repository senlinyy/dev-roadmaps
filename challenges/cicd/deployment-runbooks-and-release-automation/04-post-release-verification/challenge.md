---
title: "Record Post-Release Verification"
sectionSlug: post-flight-verification
order: 4
---

The release completed, but the final record only says "looks good." Verification ran from `2026-04-30T21:00:00Z` to `2026-04-30T21:15:00Z`. The snapshot showed 5xx rate `0.03%`, checkout success `99.5%`, p95 latency `190 ms`, no payment-provider increase, and no new error pattern. Maya confirmed task definition `orders-api:42` at 100 percent traffic when the window ended.

Your task:

1. **Record the stated verification window** for the post-release check.
2. **Add the observed metrics** from the snapshot for 5xx rate, checkout success, p95 latency, payment provider errors, and new error patterns.
3. **Record the confirmed final state** with task definition, traffic, verifier, and timestamp.

The grader checks the verification snapshot and final state.
