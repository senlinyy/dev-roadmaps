---
title: "Trace a Query from Stub Resolver to Authoritative Answer"
sectionSlug: the-resolution-chain
order: 1
---

One customer laptop can resolve `api.example.com`, but another is timing out before it ever reaches the app. Before blaming the authoritative zone, you want to trace the query path from the machine's local stub resolver to the recursive resolver and then down to the authoritative server. The local resolver config is in `/etc/resolv.conf`, the forwarder log is in `/var/log/dns/resolved-forwarder.log`, and the captured recursive walk is in `/var/log/dns/api.example.com.trace`.

You start in `/home/dev`. Your job:

1. **Inspect the local resolver configuration** so you can identify the stub resolver this host queries first.
2. **Inspect the forwarder log** so you can identify which recursive resolver the stub forwarded the query to.
3. **Inspect the recursive trace** so you can identify the authoritative nameserver and the final answer IP.
4. **Write `/home/dev/reports/api-resolution-chain.note`** with the stub resolver, recursive resolver, authoritative nameserver, and final answer.
5. **Print the completed note** so the full chain is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `stub 127.0.0.53`, `recursive 1.1.1.1`, `authoritative ns1.example.com`, and `answer 93.184.216.34`.
