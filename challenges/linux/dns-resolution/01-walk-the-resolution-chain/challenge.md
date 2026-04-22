---
title: "Walk the Resolution Chain from a Saved Trace"
sectionSlug: the-resolution-chain
order: 1
---

`dig` is not installed on this host, but a teammate captured the output of `dig +trace api.example.com` into `/home/dev/dns-debug/api-trace.txt` before opening the incident. Each section of the trace shows one hop in the resolution chain: root nameservers, the `.com` TLD servers, the authoritative nameservers for `example.com`, and finally the answer. Your job is to extract each hop so the on-call lead can see the full path in the incident channel.

You start in `/home/dev`. Your job:

1. **Surface the beginning of the trace** in `/home/dev/dns-debug/api-trace.txt` so the root referral is visible.
2. **Pull out the nameserver handoffs** so the root, TLD, and authoritative hops all appear together.
3. **Show the final answer section** so the incident channel can see which IP the trace eventually resolves to.

The grader requires you to use `head`, `grep`, and `tail`, and checks that your combined output mentions a root server (`a.root-servers.net`), a `.com` TLD server (`a.gtld-servers.net`), the authoritative nameserver (`ns1.example.com`), and the final answer IP (`93.184.216.34`).
