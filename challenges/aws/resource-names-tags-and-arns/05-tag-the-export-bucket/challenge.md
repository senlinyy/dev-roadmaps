---
title: "Tag The Export Bucket"
sectionSlug: tags-turn-resources-into-team-inventory
order: 5
---

The export bucket already exists, but a later cleanup review should not have to guess who owns it. Add inventory tags that connect the bucket to the service, environment, and owner team.

Your job:

1. **Tag the bucket** `devpolaris-orders-exports-prod` with `service=devpolaris-orders-api`, `env=prod`, and `owner=orders`.
2. **Read the bucket tags back** after you write them.
3. **Leave the tag output visible** so the review evidence is clear.

The grader checks the simulated bucket tags and the terminal output.
