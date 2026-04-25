---
title: "Find the Remaining Cloud Firewall Blocker"
sectionSlug: cloud-firewalls-security-groups-and-nacls
order: 2
---

A teammate still cannot reach the new app instance on port 8080 even though the Security Group was updated earlier today. They already exported both layers of the AWS firewall to text:

- `/var/log/aws/security-group.describe`, output of `aws ec2 describe-security-groups` for the instance's SG.
- `/var/log/aws/network-acl.describe`, output of `aws ec2 describe-network-acls` for the subnet's NACL.

Security Groups are stateful (return traffic is auto-allowed), but NACLs are stateless (you must allow ephemeral return traffic explicitly). Your job is to look at both files, identify the *remaining* blocker, and write the handoff note for the cloud team.

You start in `/home/dev`. Your job:

1. **Move into `/var/log/aws`** so you can compare the two AWS exports with shorter paths.
2. **Confirm whether the Security Group already allows inbound 8080**.
3. **Inspect the NACL's return path rules** and decide whether responses from a new inbound connection can get back out.
4. **Write `/home/dev/reports/reachability.note`** naming the remaining blocking layer and the missing rule.
5. **Print the completed handoff note** so the diagnosis is visible in the terminal history.

The grader requires you to use `cd`, `cat`, `grep`, and `echo`, finishes in `/var/log/aws`, and checks that your note names the `NACL`, port `8080`, and the missing ephemeral range `1024-65535`.
