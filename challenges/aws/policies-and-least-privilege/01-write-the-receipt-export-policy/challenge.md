---
title: "Write the Receipt Export Policy"
sectionSlug: write-the-receipt-export-role
order: 1
---

The receipt exporter lists one bucket and writes encrypted objects under `receipts/`. It must not read, delete, or write outside that prefix. Complete the policy with separate bucket and object statements. Require the `aws:kms` server-side encryption header on writes and grant only `kms:Encrypt` plus `kms:GenerateDataKey` on the named key.
