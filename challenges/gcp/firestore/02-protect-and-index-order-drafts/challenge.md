---
title: "Protect and Index Order Drafts"
sectionSlug: a-practical-baseline
order: 2
---

Complete the Firestore project. In `firestore.rules`, authenticated users may read or write only documents under `/users/{userId}/drafts/{draftId}` when `request.auth.uid == userId`; all other documents must remain denied. In `firestore.indexes.json`, add one collection-group index for `drafts` with `status` ascending and `updatedAt` descending.

The grader checks both the security boundary and the composite index.
