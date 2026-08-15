---
title: "Build the Export Lifecycle"
sectionSlug: versioning-and-lifecycle
order: 2
---

Complete the S3 lifecycle configuration for devpolaris-receipts-prod. Current objects under receipts/ move to STANDARD_IA after 30 days and expire after 365 days. Noncurrent versions move to STANDARD_IA after 30 days and expire after 90 days. Abort incomplete multipart uploads after 7 days. Keep the rule enabled and scoped only to the receipts prefix.
