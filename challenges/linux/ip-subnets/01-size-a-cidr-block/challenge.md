---
title: "Size a CIDR Block from the Cheat Sheet"
sectionSlug: cidr-notation-slicing-the-address-space
order: 1
---

The platform team is sizing a new application tier that needs to hold up to **4000 instances** behind autoscaling. Your network planning cheat sheet lives at `/home/dev/network-planning/cidr-cheatsheet.txt` and lists prefix length, mask, total IPs, and usable hosts for every common CIDR. You need to pick the smallest prefix that fits the workload and record the choice in `/home/dev/network-planning/decision.txt`.

You start in `/home/dev`. Your job:

1. **Read the cheat sheet** with `cat /home/dev/network-planning/cheatsheet.txt`-style output so you can see every prefix in one shot.
2. **Pull the candidate row** by running `grep "/20" /home/dev/network-planning/cidr-cheatsheet.txt` to confirm `/20` gives you `4094` usable hosts.
3. **Record the decision** by writing the line `selected /20 4094 usable hosts` into `/home/dev/network-planning/decision.txt` with `echo` and `>`.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your combined output mentions `/20` and `4094` and that `decision.txt` contains the string `selected /20`.
