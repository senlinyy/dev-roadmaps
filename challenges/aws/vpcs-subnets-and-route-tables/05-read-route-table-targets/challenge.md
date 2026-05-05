---
title: "Read Route Table Targets"
sectionSlug: route-tables-are-the-traffic-directions
order: 5
---

Two subnets can live in the same VPC and still send outbound traffic to different places. Read route tables `rtb-public-orders` and `rtb-private-orders` to see which subnet targets internet gateway `igw-orders-prod` and which one uses NAT gateway `nat-orders-a`.

Your job:

1. **Inspect the public and private route tables**.
2. **Inspect the internet gateway and NAT gateway** named by the route targets.

The grader checks that your output shows the local route, internet gateway route, and NAT gateway route.
