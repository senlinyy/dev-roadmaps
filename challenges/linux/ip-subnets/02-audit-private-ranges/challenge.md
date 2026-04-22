---
title: "Audit Proposed CIDRs Against RFC 1918"
sectionSlug: private-vs-public-ranges
order: 2
---

A teammate dropped four candidate CIDR blocks for a new VPC into `/home/dev/vpc/proposed-cidrs.txt`. Before you accept the proposal you need to confirm every block falls inside an RFC 1918 private range. The reference list of allowed prefixes is at `/home/dev/vpc/rfc1918.txt`. Exactly one of the proposed blocks is from a public range and must be flagged.

You start in `/home/dev`. Your job:

1. **List the proposal** with `cat /home/dev/vpc/proposed-cidrs.txt` so every candidate block is on screen.
2. **List the allowed prefixes** by running `cat /home/dev/vpc/rfc1918.txt` so you know which leading octets are private.
3. **Filter out everything that starts with a private prefix** by running `grep -v "^10\." /home/dev/vpc/proposed-cidrs.txt | grep -v "^172\." | grep -v "^192.168"` so the only line that survives is the public block.

The grader requires you to use `cat` and `grep`, and checks that your combined output contains the bad block `11.0.0.0/16` along with the private prefixes `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`.
