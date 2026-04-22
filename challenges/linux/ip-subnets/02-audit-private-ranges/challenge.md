---
title: "Audit Proposed CIDRs Against RFC 1918"
sectionSlug: private-vs-public-ranges
order: 2
---

A teammate dropped four candidate CIDR blocks for a new VPC into `/home/dev/vpc/proposed-cidrs.txt`. Before you accept the proposal you need to confirm every block falls inside an RFC 1918 private range. The reference list of allowed prefixes is at `/home/dev/vpc/rfc1918.txt`. Exactly one of the proposed blocks is from a public range and must be flagged.

You start in `/home/dev`. Your job:

1. **Inspect the proposed CIDRs** in `/home/dev/vpc/proposed-cidrs.txt` so every candidate block is visible before you review it.
2. **Inspect the RFC 1918 reference** at `/home/dev/vpc/rfc1918.txt` so the allowed private ranges are on screen.
3. **Narrow the proposal down to the one block that does not belong to a private range** and print that offending CIDR.

The grader requires you to use `cat` and `grep`, and checks that your combined output contains the bad block `11.0.0.0/16` along with the private prefixes `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`.
