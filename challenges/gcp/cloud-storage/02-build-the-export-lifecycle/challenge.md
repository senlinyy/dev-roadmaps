---
title: "Build the Export Lifecycle"
sectionSlug: lifecycle-versioning-soft-delete-and-retention
order: 2
---

Complete the Cloud Storage lifecycle configuration for daily order exports. Apply both rules only to objects under `exports/daily/`: move live objects to `NEARLINE` after 30 days and delete live objects after 365 days. Keep the two actions separate and do not target archived object versions.

The grader parses the rule actions and conditions and rejects additional lifecycle rules.
