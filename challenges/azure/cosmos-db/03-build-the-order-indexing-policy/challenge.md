---
title: "Build the Order Indexing Policy"
sectionSlug: indexing-and-queries
order: 3
---

Complete the indexing policy for the `orders` container. Keep automatic consistent indexing, include the general `/*` path, and exclude `/largePayload/*`. Add the composite index used by the production query: `/customerId` ascending followed by `/createdAt` descending.

The grader checks the parsed path and composite-index structure rather than JSON formatting.
