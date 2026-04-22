---
title: "Pick the Smallest Free Block from IPAM"
sectionSlug: cidr-notation-slicing-the-address-space
order: 1
---

The payments team opened an IPAM request for a new autoscaled tier that needs room for 4000 instances. Their request is already staged in `/srv/requests/payments-tier.request`, and the allocator's current pool of free blocks is exported in `/var/lib/ipam/free-blocks.csv`. Pick the smallest free block that fits and record the allocation decision.

You start in `/home/dev`. Your job:

1. **Review the request and the free-block export** so the required host count and the available CIDRs are both visible.
2. **Identify the smallest free block that still satisfies 4000 hosts** and surface the row that proves it.
3. **Write `/home/dev/reports/payments-tier-allocation.note`** as a short allocation note that includes the selected prefix and usable-host count.
4. **Print the allocation note** so the decision is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `selected /20 4094 usable hosts`.
