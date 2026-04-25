---
title: "Audit a Saved iptables Ruleset"
sectionSlug: iptables-the-linux-packet-filter
order: 1
---

The on-call engineer says inbound port 80 is being silently dropped on `polaris-web-02`, and external health checks are failing. The active firewall was saved with `iptables-save > /etc/iptables/rules.v4` ten minutes ago. Your job is to open that file and prove which rule blocks port 80, then sanity-check the chain policies and count how many `ACCEPT` rules are currently in place.

You start in `/home/dev`. Your job:

1. **Inspect the saved ruleset** at `/etc/iptables/rules.v4` so you can see the active policy and the rule order.
2. **Find the rule that handles inbound web traffic on port 80** and show the full line that proves whether it is accepted or dropped.
3. **Confirm the default INPUT policy** from the chain declaration so you know the baseline posture before any explicit rules match.
4. **Count how many `ACCEPT` rules are currently present** so the audit note includes the allow-list size.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `dport 80 -j DROP`, `:INPUT DROP`, `dport 22 -j ACCEPT`, and `dport 443 -j ACCEPT`.
