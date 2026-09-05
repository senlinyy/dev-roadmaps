---
title: "Localize the Checkout Outage"
order: 1
---

Checkout is unreachable at `https://checkout.example.com/health`. Build a layer-by-layer evidence chain before anyone edits the host.

1. Inspect the configured DNS answer for the hostname.
2. Inspect the selected route to the returned address.
3. Confirm whether a process owns port 443.
4. Inspect the numbered INPUT policy and counters.
5. Reproduce the HTTPS failure with a verbose request.
6. Leave every layer unchanged for handoff.
