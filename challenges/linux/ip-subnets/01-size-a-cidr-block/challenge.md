---
title: "Size a CIDR Block from the Cheat Sheet"
sectionSlug: cidr-notation-slicing-the-address-space
order: 1
---

The platform team is sizing a new application tier that needs to hold up to **4000 instances** behind autoscaling. Your network planning cheat sheet lives at `/home/dev/network-planning/cidr-cheatsheet.txt` and lists prefix length, mask, total IPs, and usable hosts for every common CIDR. You need to pick the smallest prefix that fits the workload and record the choice in `/home/dev/network-planning/decision.txt`.

You start in `/home/dev`. Your job:

1. **Inspect the planning cheat sheet** at `/home/dev/network-planning/cidr-cheatsheet.txt` so you can compare prefixes by usable host count.
2. **Identify the smallest prefix that still fits 4000 instances** and surface the row that proves your choice.
3. **Record the decision** in `/home/dev/network-planning/decision.txt` as a short note that includes the selected prefix and usable-host count.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your combined output mentions `/20` and `4094` and that `decision.txt` contains the string `selected /20`.
