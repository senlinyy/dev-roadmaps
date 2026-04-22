---
title: "Diagnose an EC2 Reachability Issue from SG and NACL Exports"
sectionSlug: cloud-firewalls-security-groups-and-nacls
order: 2
---

A teammate cannot reach the new app instance on port 8080 from outside the VPC. They already exported both layers of the AWS firewall to text:

- `/home/dev/cloud-audit/security-group.txt` — output of `aws ec2 describe-security-groups` for the instance's SG.
- `/home/dev/cloud-audit/network-acl.txt` — output of `aws ec2 describe-network-acls` for the subnet's NACL.

Security Groups are stateful (return traffic is auto-allowed), but NACLs are stateless (you must allow ephemeral return traffic explicitly). Your job is to look at both files and figure out which layer is blocking 8080.

You start in `/home/dev`. Your job:

1. **`cd` into `/home/dev/cloud-audit`** so the file names are short.
2. **Search both files for port 8080** with `grep -n "8080" security-group.txt network-acl.txt`. The SG file should have **no** match; the NACL file should show an inbound 8080 rule.
3. **List the SG inbound rules** with `cat security-group.txt` so you can confirm the SG only opens 22 and 443.
4. **List the NACL outbound (egress) rules** with `grep "Egress: true" network-acl.txt` to confirm there is no rule covering ephemeral ports `1024-65535` for return traffic.

The grader requires you to use `cd`, `cat`, and `grep`, finishes in `/home/dev/cloud-audit`, and checks that your combined output mentions `sg-0a1b2c3d`, `FromPort: 22`, `FromPort: 443`, `8080`, and `Egress`.
