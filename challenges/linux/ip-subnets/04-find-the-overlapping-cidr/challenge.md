---
title: "Find the Overlapping CIDR Before Peering Breaks"
sectionSlug: when-subnetting-goes-wrong
order: 4
---

A peering request from team Atlas just landed. Your existing VPCs are listed in `/home/dev/vpc/existing.txt` and Atlas's proposed VPCs are in `/home/dev/vpc/peering-request.txt`. AWS will reject the peering connection if any CIDR overlaps. Three of Atlas's four blocks are safe; one of them collides with a `/16` you already own. You need to identify the offender and write a short report.

You start in `/home/dev`. Your job:

1. **Show both inventories side by side** by running `cat /home/dev/vpc/existing.txt` and then `cat /home/dev/vpc/peering-request.txt` so every CIDR from both sides is visible.
2. **Pull the colliding prefix** by running `grep "10.0" /home/dev/vpc/peering-request.txt` and confirm the line `10.0.128.0/17` is the one that overlaps with the existing `10.0.0.0/16`.
3. **Write the report** by running `echo "OVERLAP 10.0.128.0/17 conflicts with 10.0.0.0/16" > /home/dev/vpc/overlap-report.txt` and then `cat /home/dev/vpc/overlap-report.txt` to confirm.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your combined output contains `10.0.128.0/17`, `10.0.0.0/16`, and the word `OVERLAP`.
