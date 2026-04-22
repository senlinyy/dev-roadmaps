---
title: "Verify a Four-Subnet VPC Plan"
sectionSlug: subnetting-a-vpc-in-practice
order: 3
---

You inherited a VPC plan from a previous engineer. The proposal at `/home/dev/vpc/proposal.txt` carves a `10.0.0.0/16` VPC into four `/20` subnets, two public and two private, across two availability zones. Your job is to confirm that each declared subnet matches the address-range table at `/home/dev/vpc/subnet-ranges.txt` before the change goes to review.

You start in `/home/dev`. Your job:

1. **Count the subnet declarations** by running `wc -l /home/dev/vpc/proposal.txt` so you can sanity-check the file has the expected number of rows.
2. **Show the AZ-b subnets** by running `grep "az-b" /home/dev/vpc/proposal.txt` so the two AZ-b CIDRs are clearly listed.
3. **Cross-check each block's first and last address** by running `cat /home/dev/vpc/subnet-ranges.txt` so the boundary table is on screen alongside the proposal.

The grader requires you to use `wc`, `grep`, and `cat`, and checks that your combined output contains the four CIDRs `10.0.0.0/20`, `10.0.16.0/20`, `10.0.32.0/20`, and `10.0.48.0/20` along with the boundary marker `10.0.63.255`.
