---
title: "Audit a Saved iptables Ruleset"
sectionSlug: iptables-the-linux-packet-filter
order: 1
---

The on-call engineer says inbound port 80 is being silently dropped on `polaris-web-02`, and external health checks are failing. The active firewall was saved with `iptables-save > /etc/iptables/rules.v4` ten minutes ago. Your job is to open that file and prove which rule blocks port 80, then sanity-check the chain policies and count how many `ACCEPT` rules are currently in place.

You start in `/home/dev`. Your job:

1. **Read the full ruleset** with `cat /etc/iptables/rules.v4`.
2. **Show the rule that targets port 80** by running `grep "dport 80" /etc/iptables/rules.v4`. The matching line should end in `-j DROP`.
3. **Confirm the default INPUT policy** by grepping for `:INPUT`.
4. **Count how many `ACCEPT` rules exist** with `grep -c "ACCEPT" /etc/iptables/rules.v4`.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `dport 80 -j DROP`, `:INPUT DROP`, `dport 22 -j ACCEPT`, and `dport 443 -j ACCEPT`.
