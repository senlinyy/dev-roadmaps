---
title: "Query One Checkout Failure"
sectionSlug: finding-one-checkout-failure
order: 3
---

Complete `checkout-failure.kql` so the investigation reads `ContainerAppConsoleLogs_CL`, limits the window from `2026-05-07T09:35:00Z` through `2026-05-07T09:50:00Z`, filters `OperationId` to `checkout-5001`, projects `TimeGenerated`, `OperationId`, `ResultCode`, `SeverityLevel`, `Message`, and `_ResourceId`, then orders the timeline ascending.

The grader checks the query stages while allowing normal whitespace and line breaks.
