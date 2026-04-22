---
title: "Reject the Public CIDR in a VPC Request"
sectionSlug: private-vs-public-ranges
order: 2
---

A teammate staged four candidate CIDR blocks for a new VPC in `/srv/requests/marketing-vpc.cidrs`. One of them is not private address space at all, which means approving it would create a publicly routable internal network. Use your RFC 1918 knowledge from the article to identify the bad block and record the rejection.

You start in `/home/dev`. Your job:

1. **Review the candidate CIDRs** in `/srv/requests/marketing-vpc.cidrs`.
2. **Identify the one block that falls outside RFC 1918 private space**.
3. **Write `/home/dev/reports/marketing-vpc-review.note`** naming the rejected CIDR and why it must be refused.
4. **Print the review note** so the rejection is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note rejects `11.0.0.0/16` as a `public range`.
