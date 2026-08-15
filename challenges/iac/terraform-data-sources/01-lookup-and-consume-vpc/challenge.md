---
title: "Look Up and Consume an Existing VPC"
sectionSlug: resources-consuming-lookup-results
order: 1
revision: 2
---

The network team owns the production VPC. Your application stack may read it by tag and create one subnet inside it, but it must not redefine or import the VPC as a managed resource.

Your job:

1. **Declare** `data.aws_vpc.platform` with tag filter `Name = "platform-prod"`.
2. **Create** `aws_subnet.orders` with CIDR `10.42.20.0/24`.
3. **Set** the subnet VPC ID from `data.aws_vpc.platform.id`.
4. **Do** not add an `aws_vpc` resource.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
