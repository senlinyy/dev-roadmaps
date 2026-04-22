---
title: "Find the iptables Rule-Order Bug Letting Abuse Through"
sectionSlug: firewall-failure-modes
order: 5
---

The abuse desk reports that requests from `203.0.113.0/24` are still hitting the web server even though "we already added the DROP rule yesterday." A snapshot of the active firewall is at `/etc/iptables/rules.v4`, and the last hour of access logs from that subnet is at `/var/log/iptables-recent.log` — proof the traffic is still arriving.

iptables evaluates rules top to bottom and stops at the first match. A broad `ACCEPT` rule placed *above* a specific `DROP` rule means the `DROP` is dead code. Your job is to find that exact ordering bug.

You start in `/home/dev`. Your job:

1. **Inspect the active ruleset** at `/etc/iptables/rules.v4` so you can reason about match order instead of just the rule text.
2. **Surface every port-80 rule with line numbers** and determine which one wins when traffic arrives from the abusive subnet.
3. **Confirm the abusive subnet still appears in the recent traffic snapshot** at `/var/log/iptables-recent.log`.
4. **Surface the subnet-specific drop rule that should be moved earlier** so the remediation target is explicit.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `dport 80 -j ACCEPT`, `203.0.113.0/24`, `dport 80 -j DROP`, and `203.0.113.99`.
