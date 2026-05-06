---
title: "Inspect NSG Rule Evidence"
sectionSlug: evidence-you-can-inspect
order: 2
---

The API subnet uses network security group `nsg-orders-api` in `rg-devpolaris-network-prod`. Reviewers need to know which rule allows Application Gateway traffic and which rule keeps direct Internet traffic out.

Your job:

1. **Inspect** the NSG rule list for `nsg-orders-api`.
2. **Confirm** the allow rule for Application Gateway to API traffic.
3. **Confirm** the deny rule that blocks direct Internet traffic to the API.

The grader checks that you gathered NSG rule evidence from Azure.
