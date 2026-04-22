---
title: "Find the Overlapping CIDR Before Peering Breaks"
sectionSlug: when-subnetting-goes-wrong
order: 4
---

A peering request from team Atlas just landed. Your existing VPCs are listed in `/home/dev/vpc/existing.txt` and Atlas's proposed VPCs are in `/home/dev/vpc/peering-request.txt`. AWS will reject the peering connection if any CIDR overlaps. Three of Atlas's four blocks are safe; one of them collides with a `/16` you already own. You need to identify the offender and write a short report.

You start in `/home/dev`. Your job:

1. **Review both CIDR inventories** in `/home/dev/vpc/existing.txt` and `/home/dev/vpc/peering-request.txt` so you can compare the current estate with Atlas's request.
2. **Identify the Atlas block that overlaps existing address space** and show the evidence that it collides with one of your current VPC ranges.
3. **Write a short report** to `/home/dev/vpc/overlap-report.txt` naming the conflicting Atlas block and the existing CIDR it overlaps.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your combined output contains `10.0.128.0/17`, `10.0.0.0/16`, and the word `OVERLAP`.
