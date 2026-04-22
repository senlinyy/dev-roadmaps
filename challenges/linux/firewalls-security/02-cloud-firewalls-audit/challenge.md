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

1. **Move into `/home/dev/cloud-audit`** so you can compare the two AWS exports with shorter paths.
2. **Compare both firewall layers for port 8080** and determine which one is actually responsible for the failed reachability.
3. **Inspect the security group's inbound rules** so you can confirm exactly which public ports it allows.
4. **Inspect the NACL's egress rules** and decide whether return traffic has room to come back on ephemeral ports.

The grader requires you to use `cd`, `cat`, and `grep`, finishes in `/home/dev/cloud-audit`, and checks that your combined output mentions `sg-0a1b2c3d`, `FromPort: 22`, `FromPort: 443`, `8080`, and `Egress`.
