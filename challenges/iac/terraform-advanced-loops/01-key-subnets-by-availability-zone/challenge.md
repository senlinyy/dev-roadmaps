---
title: "Key Subnets by Availability Zone"
sectionSlug: for_each-for-named-items
order: 1
---

The orders network currently creates web subnets from list positions. Removing the middle availability zone would shift later resource addresses and propose unrelated replacements. Refactor the subnet collection so the availability-zone keys become stable Terraform identities.

Your job:

1. **Replace the list input** with a map of objects keyed by `use1a`, `use1b`, and `use1c`, each carrying its availability zone and subnet number.
2. **Replace index-based repetition** on `aws_subnet.web` with keyed iteration over that map.
3. **Build each subnet** from the current map value and tag it as `web-${each.key}`.
4. **Remove all count-based addressing** from the file.

The grader checks the HCL relationships and confirms the old index-based loop is gone.
