---
title: "Find the Overlapping CIDR Before Peering Breaks"
sectionSlug: when-subnetting-goes-wrong
order: 4
---

A peering request from team Atlas just landed. Your existing VPCs are listed in `/etc/polaris/vpc-owned.cidrs` and Atlas's proposed VPCs are in `/srv/requests/atlas-peering.cidrs`. AWS will reject the peering connection if any CIDR overlaps. Three of Atlas's four blocks are safe; one of them collides with a `/16` you already own. You need to identify the offender and write a short report.

You start in `/home/dev`. Your job:

1. **Review both CIDR inventories** in `/etc/polaris/vpc-owned.cidrs` and `/srv/requests/atlas-peering.cidrs` so you can compare the current estate with Atlas's request.
2. **Identify the Atlas block that overlaps existing address space** and show the evidence that it collides with one of your current VPC ranges.
3. **Write a short report** to `/home/dev/reports/atlas-overlap.note` naming the conflicting Atlas block and the existing CIDR it overlaps.
4. **Print the overlap note** so the rejection is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note names `10.0.128.0/17`, `10.0.0.0/16`, and the word `OVERLAP`.
