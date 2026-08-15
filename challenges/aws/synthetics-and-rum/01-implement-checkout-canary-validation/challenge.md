---
title: "Implement Checkout Canary Validation"
sectionSlug: designing-canaries-for-real-journeys
order: 1
---

Implement the response validator used by a CloudWatch Synthetics checkout canary. It receives a status code, headers, and JSON body after the HTTP call. Accept only a 200 response whose content type is JSON, whose body contains a nonempty checkoutId, and whose status is ready. Return a small observation object containing the checkout ID and elapsed milliseconds. Reject every failed contract with a useful error. The provided tests model the deterministic validation layer only, so they run in Node.js without AWS credentials or the Synthetics runtime.
