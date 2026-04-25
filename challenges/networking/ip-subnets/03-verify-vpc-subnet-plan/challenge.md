---
title: "Verify a Four-Subnet VPC Plan"
sectionSlug: subnetting-a-vpc-in-practice
order: 3
---

You inherited a VPC plan from a previous engineer. The proposal at `/srv/requests/payments-vpc.plan` carves a `10.0.0.0/16` VPC into four `/20` subnets across two availability zones, and IPAM has already reserved exact CIDRs for each subnet name in `/var/lib/ipam/payments-vpc.allocations`. One proposed subnet drifted from its reservation. Your job is to decide whether the plan can pass review and write the reviewer note.

You start in `/home/dev`. Your job:

1. **Review the proposal and the IPAM reservation export** so you can compare requested CIDRs with reserved CIDRs by subnet name.
2. **Find the subnet whose proposed CIDR does not match its reservation**.
3. **Write `/home/dev/reports/payments-vpc-review.note`** with a `PASS` or `FAIL` verdict and the exact subnet/CIDR mismatch.
4. **Print the review note** so the verdict is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `FAIL`, `subnet-private-az-b`, `10.0.40.0/20`, and `10.0.48.0/20`.
