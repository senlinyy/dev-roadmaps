---
title: "Inspect VPC And Subnets"
sectionSlug: subnets-put-resources-in-availability-zones
order: 4
---

Before debugging a route, make sure you understand network space `10.40.0.0/16` in VPC `vpc-orders-prod` and where subnets `subnet-public-a`, `subnet-private-a`, and `subnet-private-b` live. The VPC gives the address range; the subnets place smaller ranges into Availability Zones.

Your job:

1. **Inspect VPC `vpc-orders-prod`** for its CIDR block.
2. **Inspect the listed subnets** for Availability Zone, CIDR, and public IP behavior.

The grader checks that your output shows the VPC range and the public/private subnet placement.
