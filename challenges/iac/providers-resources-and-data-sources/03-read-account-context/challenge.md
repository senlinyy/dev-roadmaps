---
title: "Read Account Context"
sectionSlug: state-and-ownership
order: 3
---

The account and region are provider context, not objects this root module owns. Read them as existing facts and wire those facts into locals so later resources can tag and name themselves with the active target.

Your job:

1. **Read the current AWS account identity** with a provider data source.
2. **Read the active AWS region** with a provider data source.
3. **Replace copied context values** in locals with references to those data sources.
4. **Do not keep the starter account ID literal** as the source of truth.

The grader checks the data source declarations and references in HCL.
