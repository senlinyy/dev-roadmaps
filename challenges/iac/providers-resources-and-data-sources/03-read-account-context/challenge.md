---
title: "Read Account Context"
sectionSlug: data-sources-read-existing-information
order: 3
---

Add AWS data sources in `data.tf` and wire their values through `locals.tf`.

Requirements:

1. **Caller identity data source:** `data "aws_caller_identity" "current" {}`.
2. **Region data source:** `data "aws_region" "current" {}`.
3. **Account value:** use `data.aws_caller_identity.current.account_id`.
4. **Region value:** use `data.aws_region.current.name`.
5. **Do not use** hardcoded account ID `123456789012`.
