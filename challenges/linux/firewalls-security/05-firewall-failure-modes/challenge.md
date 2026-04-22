---
title: "Find the iptables Rule-Order Bug Letting Abuse Through"
sectionSlug: firewall-failure-modes
order: 5
---

The abuse desk reports that requests from `203.0.113.0/24` are still hitting the web server even though "we already added the DROP rule yesterday." A snapshot of the active firewall is at `/etc/iptables/rules.v4`, and the last hour of access logs from that subnet is at `/var/log/iptables-recent.log` — proof the traffic is still arriving.

iptables evaluates rules top to bottom and stops at the first match. A broad `ACCEPT` rule placed *above* a specific `DROP` rule means the `DROP` is dead code. Your job is to find that exact ordering bug.

You start in `/home/dev`. Your job:

1. **Read the active ruleset** with `cat /etc/iptables/rules.v4`.
2. **Show every rule that touches port 80 with line numbers** by running `grep -n "dport 80" /etc/iptables/rules.v4`. The `ACCEPT` line should print with a *lower* line number than the `DROP` line — that is the bug.
3. **Confirm the abusive subnet is still reaching the server** with `grep "203.0.113" /var/log/iptables-recent.log`.
4. **Show the line that should be the fix target** with `grep "203.0.113.0/24" /etc/iptables/rules.v4`.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `dport 80 -j ACCEPT`, `203.0.113.0/24`, `dport 80 -j DROP`, and `203.0.113.99`.
