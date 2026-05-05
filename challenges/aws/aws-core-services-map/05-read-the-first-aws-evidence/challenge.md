---
title: "Read The First AWS Evidence"
sectionSlug: debugging-with-the-map
order: 5
---

An export job is failing, and someone is about to blame the application code. First, check the AWS context and whether the expected export bucket is visible in this account.

Your job:

1. **Check the current AWS identity** so the account is visible.
2. **Check the configured Region** before reading resource evidence.
3. **List S3 buckets** and look for `devpolaris-orders-exports-prod`.

The grader checks that your terminal output contains the first useful AWS evidence.
