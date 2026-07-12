---
title: "DNS Resolution"
description: "Trace how a browser turns a hostname into an IP address, debug DNS with dig, and plan TTL changes before production cutovers."
overview: "Understand how DNS maps names to addresses, how recursive resolvers find authoritative answers, and why TTL planning matters before traffic can move to a new server."
tags: ["dns", "dig", "cname", "ttl", "nameserver"]
order: 2
id: article-devops-foundation-networking-dns-resolution
---

## Table of Contents

1. [What DNS Resolution Does](#what-dns-resolution-does)
2. [Why DNS Is Distributed](#why-dns-is-distributed)
3. [The Resolution Chain](#the-resolution-chain)
4. [DNS Records Used in Real Work](#dns-records-used-in-real-work)
5. [Debugging DNS with dig](#debugging-dns-with-dig)
6. [TTL and Safe Cutovers](#ttl-and-safe-cutovers)
7. [DNS Failure Modes](#dns-failure-modes)
8. [References](#references)

## What DNS Resolution Does
<!-- section-summary: DNS resolution turns a human-friendly hostname into the address records machines need for routing. -->

You type `https://app.example.com/dashboard` because a name is easy to remember. Your computer cannot send a packet to a name, though. Before the browser can open a TCP connection, it needs an address such as `203.0.113.25` for IPv4 or `2001:db8:10::25` for IPv6.

**DNS resolution** is that lookup. It answers the first practical question in a web request: which address should this machine try for this hostname right now? Once the address comes back, the operating system can decide the route, the firewall can allow or deny port `443`, TLS can protect the connection, and Nginx can forward the request to the app.

For a browser request to `https://app.example.com/dashboard`, DNS connects the name in the URL to the destination address the network stack can use. The browser can display `app.example.com` to a person. The operating system routes packets toward an address.

Here is the quickest version of that lookup:

```bash
dig +short app.example.com

# Example output:
# 203.0.113.25
```

The output matters because:

- `app.example.com` is the human-friendly name from the URL.
- `203.0.113.25` is the destination address the operating system can route toward.
- The missing details are intentional here: `+short` hides resolver, TTL, and authority information so the lookup can answer one simple question quickly.

The lookup unlocks the next step. The machine can now ask, "How do I reach `203.0.113.25`?" That routing question belongs to IP addressing, subnets, and route tables. DNS stays with name lookup, record ownership, caching, and the traps around stale or wrong answers.

## Why DNS Is Distributed
<!-- section-summary: DNS maps human names to machine addresses through delegated, cacheable records. -->

Picture a tiny lab where every machine has one local file that says which names point to which addresses. That can work for a few hosts. It breaks down once many teams create services, change load balancers, move domains between providers, and need users across the world to get the right answer without editing every laptop and server.

You still see that tiny version on Linux in `/etc/hosts`:

```console
203.0.113.25 app.example.com
```

That line can override DNS on one machine. Teams sometimes use it for local testing, but it is a poor production system. Every laptop, server, CI runner, and load balancer would need the same file at the same time. One stale copy could keep sending traffic to an old address long after the real service moved.

**DNS**, the Domain Name System, solves that coordination problem by splitting ownership across a name tree. A domain owner manages its own part of that tree. That ownership handoff is called **delegation**. The root zone knows where `.com` lives. The `.com` nameservers know where `example.com` lives. The `example.com` nameservers know the records for names such as `app.example.com`.

DNS also solves the repeated-lookup problem with **caching**. A resolver can reuse an answer for a short time, controlled by the record's TTL. Caching keeps lookups fast and reduces load on the authoritative nameservers, while delegation keeps ownership close to the team that runs the domain.

Under the hood, DNS works through referrals. A resolver does not ask one giant database for every app server on the internet. It follows the name tree until it reaches the nameserver responsible for the zone. During a production change, keep two questions separate: did the right zone contain the right record, and are resolvers still serving an old cached answer?

## The Resolution Chain
<!-- section-summary: A recursive resolver follows referrals from root to TLD to authoritative nameservers, then caches the answer for later clients. -->

Follow one laptop opening `https://app.example.com/dashboard`. The browser asks the operating system for an address. On Linux, that small local lookup component is often a **stub resolver**. It checks local rules, cache, `/etc/hosts`, and resolver settings, then sends the question onward because it does not walk the whole DNS tree by itself.

The next server is a **recursive resolver**. Your ISP, company network, Cloudflare at `1.1.1.1`, Google at `8.8.8.8`, or CoreDNS inside Kubernetes might provide it. The recursive resolver works on behalf of the laptop. If it already has a fresh cached answer, it returns that answer immediately.

If the recursive resolver has no fresh cached answer, it follows referrals in stages:

1. It asks a root nameserver where to find `.com`.
2. It asks a `.com` TLD nameserver where to find `example.com`.
3. It asks the authoritative nameserver for `example.com` what `app.example.com` points to.
4. It returns the final answer to the client and stores it in cache.

The **root nameserver** points the resolver toward the right top-level domain. The **TLD nameserver** for `.com` points the resolver toward the nameservers for `example.com`. The **authoritative nameserver** for `example.com` owns the final answer for that zone. If your team hosts DNS in Cloudflare, Route 53, Azure DNS, or Google Cloud DNS, that provider's authoritative nameservers answer from the records your team configured.

The chain looks like this in `dig +trace`:

```bash
dig +trace app.example.com

# Example output:
# .                       518400  IN  NS  a.root-servers.net.
# com.                    172800  IN  NS  a.gtld-servers.net.
# example.com.            172800  IN  NS  ns1.dns-provider.example.
# app.example.com.        300     IN  A   203.0.113.25
```

The exact servers differ by domain, and the shape stays the same:

- The root zone points the resolver toward the `.com` nameservers.
- The `.com` nameservers point the resolver toward the `example.com` nameservers.
- The `example.com` authoritative nameserver returns the final A record for `app.example.com`.

In production, this chain matters during incidents. If the authoritative server has the right record but a public resolver still returns the old value, the issue is probably cache. If the TLD points at the wrong nameserver, the resolver will never reach the place where you changed the record. `dig +trace` shows that difference.

The next decision depends on where the chain breaks. A wrong final A record means you edit the zone data at the DNS provider. A wrong NS referral means you fix registrar or parent-zone delegation. A correct authoritative answer with stale recursive answers means you wait for TTLs, keep the old target healthy, and monitor traffic on both paths.

![DNS resolution chain infographic showing browser cache, OS resolver, recursive resolver, root, TLD, authoritative nameserver, and final address](/content-assets/articles/article-devops-foundation-networking-dns-resolution/dns-resolution-chain.png)

_The image follows one lookup through the resolver chain so DNS delegation and caching have a visible path._

## DNS Records Used in Real Work
<!-- section-summary: DNS records describe addresses, aliases, mail routing, verification text, and nameserver delegation. -->

Now say the team is launching `app.example.com`. One name needs to send users to the web app. The `www` name should land in the same place. Email should still work for the domain. A SaaS vendor may ask for a text value that proves the team owns the domain. The authoritative nameserver handles those different needs with different record types.

The first need is web traffic over IPv4. An **A record** maps a name to an IPv4 address. It is the common answer a browser can use before opening a TCP connection:

```
app.example.com.    300    IN    A    203.0.113.25
```

This says `app.example.com` resolves to `203.0.113.25`, and resolvers may cache that answer for `300` seconds.

The record fields move from name to cache time to answer type:

- `app.example.com.` is the **owner name**. It names the DNS record being answered, and the trailing dot means the name is fully qualified.
- `300` is the **TTL** in seconds. Recursive resolvers may keep this answer for up to five minutes before asking again.
- `IN` is the DNS **class**. Almost all public internet DNS records use `IN`, which means internet.
- `A` is the **type**. It tells the resolver to expect an IPv4 address in the answer.
- `203.0.113.25` is the **value**. That is the IPv4 destination clients will try after resolution.

If the service supports IPv6, the same name also needs an **AAAA record**. It gives IPv6-capable clients an IPv6 destination for the same hostname:

```
app.example.com.    300    IN    AAAA    2001:db8:10::25
```

Modern load balancers and CDNs often support both A and AAAA records. That setup is called dual stack because clients can use IPv4 or IPv6.

The fields mean the same thing, with one important change:

- `app.example.com.` is still the owner name, so IPv4 and IPv6 clients ask about the same hostname.
- `300` keeps the IPv6 answer cacheable for five minutes.
- `IN` keeps the record in the normal internet DNS class.
- `AAAA` is the type for an IPv6 address.
- `2001:db8:10::25` is the IPv6 value returned to IPv6-capable clients.

The next need is a friendly alias. If `www.example.com` should follow the same app target, a **CNAME record** can make `www` point at another name:

```
www.example.com.    300    IN    CNAME    app.example.com.
```

The resolver follows the alias and then resolves the target. A CNAME cannot sit at the zone apex, such as `example.com`, because the apex must also hold records like `SOA` and `NS`. DNS providers often offer ALIAS, ANAME, or CNAME flattening features for that case.

The CNAME fields explain why the alias follows another name:

- `www.example.com.` is the owner name people type or link to.
- `300` controls how long resolvers may cache the alias answer.
- `IN` keeps the record in the internet class.
- `CNAME` is the type, so the value must be another DNS name.
- `app.example.com.` is the value. The resolver now asks for records on that target name.

If the same domain receives email, an **MX record** tells other mail servers where to deliver it. The web app can move to a new load balancer without changing mail delivery because MX records answer a different question.

```
example.com.        300    IN    MX    10 mail.example.com.
```

The MX fields add one mail-specific value:

- `example.com.` is the owner name, so the record describes mail delivery for the whole domain.
- `300` lets mail senders cache the mail route briefly.
- `IN` means the record lives in the internet DNS class.
- `MX` is the type, so the value describes a mail exchanger.
- `10 mail.example.com.` is the value. `10` is the priority, and `mail.example.com.` is the mail server name.

A **TXT record** stores text, often for domain verification, SPF, DKIM, and DMARC email security. TXT records do not route web traffic. They give other systems proof or policy text they know how to read.

```
example.com.        300    IN    TXT   "v=spf1 include:_spf.mail.example -all"
```

The TXT fields show why text records are checked by other systems:

- `example.com.` is the owner name where the policy is published.
- `300` controls how long resolvers may cache the text.
- `IN` is the normal DNS class for internet records.
- `TXT` is the type, so the answer is text instead of an address.
- `"v=spf1 include:_spf.mail.example -all"` is the value read by mail systems that validate SPF policy.

An **NS record** handles delegation. At the parent level, the NS records tell resolvers where to go next. Inside the zone, NS records describe which nameservers are authoritative for that zone. This is why a registrar nameserver screen matters so much: if the parent zone points to old nameservers, edits in the new DNS provider may never be seen by public resolvers.

```
example.com.        300    IN    NS    ns1.provider.example.
```

The NS fields describe who can answer for the zone:

- `example.com.` is the owner name of the zone being delegated.
- `300` lets resolvers cache the delegation answer for a short period.
- `IN` keeps the record in the internet class.
- `NS` is the type, so the value must name an authoritative nameserver.
- `ns1.provider.example.` is the value, which points resolvers to the provider nameserver.

| Type | Small example | Common production use |
| --- | --- | --- |
| `A` | `app -> 203.0.113.25` | IPv4 web app, load balancer, public server |
| `AAAA` | `app -> 2001:db8:10::25` | IPv6 web app or CDN |
| `CNAME` | `www -> app.example.com` | Alias one hostname to another |
| `MX` | `example.com -> mail.example.com` | Receiving email |
| `TXT` | `example.com -> "v=spf1 ..."` | Email security and ownership checks |
| `NS` | `example.com -> ns1.provider.example` | Delegating a zone to DNS hosting |

The important production habit is to know which record owns the traffic switch. If `app.example.com` is a CNAME to `alb-123.us-east-1.elb.amazonaws.com`, changing an A record somewhere else will not move traffic. The resolver follows the CNAME target, so the target is the thing that must point at the current load balancer.

For a production change, write down the exact owner before editing anything: hostname, record type, current value, new value, TTL, and provider. That small inventory prevents changes to a parked record, an unused `www` name, or a private DNS zone that the failing public client never uses.

## Debugging DNS with dig
<!-- section-summary: `dig` shows the resolver, status, answer, record type, and TTL so DNS debugging can use direct evidence. -->

A real DNS incident often starts with a mismatch. The browser still reaches the old load balancer. A teammate on another network sees the new one. The DNS provider screen shows the right record, while a client resolver returns stale data. `dig` turns that report into concrete facts: which resolver answered, which status came back, which records were returned, and how long the answer may stay cached.

A normal lookup looks like this:

```bash
dig app.example.com

# Example output:
# ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 41821
# ;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
#
# ;; QUESTION SECTION:
# ;app.example.com.              IN      A
#
# ;; ANSWER SECTION:
# app.example.com.       300     IN      A       203.0.113.25
#
# ;; Query time: 18 msec
# ;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)
```

Important fields in that output:

- `status: NOERROR` means the resolver found an answer.
- `ANSWER: 1` means the response contains one answer record.
- `300 IN A 203.0.113.25` means the IPv4 answer is `203.0.113.25` and the remaining TTL is 300 seconds.
- `SERVER: 127.0.0.53` means the local stub resolver answered the command. On many Linux systems, that is `systemd-resolved`, which forwards to the real recursive resolver.

The `rd` and `ra` flags also tell a useful story. `rd` means recursion desired, so the client asked a resolver to do recursive work. `ra` means recursion available, so the resolver can do that work. An authoritative-only nameserver may answer its own zone, but it usually should not provide open recursion for the whole internet.

For a short answer:

```bash
dig +short app.example.com

# Example output:
# 203.0.113.25
```

Use this form when a script or runbook only needs the resolved address. Use the full `dig` output when the TTL, resolver, or DNS status matters.

For a specific resolver:

```bash
for resolver in 1.1.1.1 8.8.8.8; do
  printf "%s " "$resolver"
  dig @"$resolver" +short app.example.com
done

# Example output:
# 1.1.1.1 203.0.113.25
# 8.8.8.8 203.0.113.25
```

That comparison is helpful after a DNS change:

- Matching answers from several public resolvers suggest the new answer has reached common caches.
- A mix of old and new answers usually means the authoritative record changed, while recursive resolver caches are still aging out.
- A public resolver answer can differ from a VPN or office resolver if the company uses split-horizon DNS.

When answers differ, pause before editing records. First identify which resolver the failing client used. A laptop on VPN, a production VM, a Kubernetes Pod, and a public phone network can all ask different recursive resolvers and receive different valid answers.

For authoritative nameserver checks:

```bash
dig NS example.com +short

# Example output:
# ns1.dns-provider.example.
# ns2.dns-provider.example.
```

Then ask one authoritative server directly:

```bash
dig @ns1.dns-provider.example app.example.com A

# Example output:
# ;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 39201
# ;; flags: qr aa rd; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
#
# ;; ANSWER SECTION:
# app.example.com.       300     IN      A       203.0.113.25
```

The first output lists the nameservers delegated for `example.com`. The second output has the `aa` flag, which means authoritative answer. It also shows the A record directly from the nameserver that owns the zone. If the authoritative server returns the right value while recursive resolvers still disagree, cache or delegation is the next place to inspect.

## TTL and Safe Cutovers
<!-- section-summary: TTL controls how long resolvers keep an answer, so traffic migrations need TTL planning before the record changes. -->

The next beginner trap shows up during migrations. You change a DNS record, refresh your browser, and still land on the old server. That can be correct DNS behavior because resolvers cache answers.

**TTL**, or Time To Live, is the number of seconds a resolver may cache a DNS answer. A TTL of `300` means the resolver can reuse the answer for five minutes. A TTL of `3600` means one hour.

TTL makes DNS fast. Without caching, every browser request could force recursive resolvers to walk root, TLD, and authoritative servers again. Caching reduces latency for users and reduces load on authoritative DNS providers.

TTL also creates the classic migration trap. Suppose `app.example.com` currently points to the old load balancer:

```
app.example.com.    3600    IN    A    198.51.100.10
```

At noon, the team changes it to the new load balancer:

```
app.example.com.    3600    IN    A    203.0.113.25
```

A resolver that cached the old answer at 11:55 can keep serving `198.51.100.10` until 12:55. Another resolver that had no cache at noon gets the new answer immediately. Users appear split between old and new infrastructure, and both groups are seeing valid DNS behavior.

A safer production cutover uses three phases:

1. Lower the TTL in advance, often to `60` or `300` seconds.
2. Wait at least one old TTL period so caches worldwide learn the shorter TTL.
3. Change the record, verify multiple resolvers, then raise the TTL after the new path is stable.

The verification can be a simple resolver loop:

```bash
for resolver in 1.1.1.1 8.8.8.8 9.9.9.9; do
  printf "%s " "$resolver"
  dig @"$resolver" +short app.example.com
done

# Example output:
# 1.1.1.1 203.0.113.25
# 8.8.8.8 203.0.113.25
# 9.9.9.9 203.0.113.25
```

That check proves three public resolvers return the new address. It cannot prove every resolver in the world has changed. For high-risk migrations, teams also check regional monitoring, CDN edge behavior, and application logs to confirm traffic has moved.

After a TTL change, think about rollback and old-target health together. If the old load balancer still receives traffic, keep it running until logs show old resolver traffic has faded. If the new address causes errors, a low TTL lets many clients pick up a rollback quickly, while some cached clients may still need time.

![TTL migration timeline infographic showing old record, lower TTL, wait window, record cutover, resolver verification, and TTL raise](/content-assets/articles/article-devops-foundation-networking-dns-resolution/ttl-migration-timeline.png)

_The image shows why safe DNS cutovers start before the record changes._

## DNS Failure Modes
<!-- section-summary: DNS failures usually show up as missing names, server-side resolution errors, timeouts, stale answers, or split answers. -->

The browser error "site cannot be reached" hides a lot of detail. The app may be healthy, the firewall may be open, and Nginx may be ready, while the browser never gets an address. DNS status is the first clue because it tells you whether the name is missing, the lookup path broke, or the resolver did not answer.

**NXDOMAIN** means the authoritative DNS path says the name does not exist. Common causes include typos, missing records, records created in the wrong zone, and expired domains.

```bash
dig missing.example.com

# Example output:
# ;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 50110
```

The important word is `NXDOMAIN`. It means the DNS path reached authority for the zone, and that authority says the name does not exist. If `app.staging.example.com` returns `NXDOMAIN`, check the zone where the record was created. Teams often add the record to `example.com` while the real delegated zone is `staging.example.com`, or the reverse.

**SERVFAIL** means the resolver tried to answer and something in the lookup failed. DNSSEC validation errors, broken authoritative nameservers, and delegation mistakes often show up this way.

```bash
dig app.example.com

# Example output:
# ;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 38321
```

`SERVFAIL` means the resolver could not complete the lookup successfully. The next check is usually `dig +trace app.example.com` and a direct query to the authoritative nameserver.

**Timeout** means the query did not receive a response. That may be a network or firewall problem rather than a DNS record problem.

```bash
dig @8.8.8.8 app.example.com

# Example output:
# ;; connection timed out; no servers could be reached
```

This output means the command did not receive a DNS response from that resolver. If public resolver queries time out from one host while the same query works from another host, inspect local firewall rules, corporate DNS policy, VPN routes, and `/etc/resolv.conf`.

**Stale cache** returns a valid answer that is older than the answer you wanted. The status is still `NOERROR`. The IP is simply old. TTL planning helps before a migration. During a migration already in progress, keep the old infrastructure healthy while caches expire.

**Split-horizon DNS** returns different answers depending on which resolver asks. Companies use this deliberately when `app.example.com` should resolve to a private IP inside the office or VPC and a public IP outside. This is also called private DNS in many cloud environments. It helps internal clients stay on private network paths while public users get the public load balancer address.

```bash
dig @10.0.0.10 +short app.example.com

# Example output:
# 10.20.5.15
```

Now compare that with a public resolver:

```bash
dig @1.1.1.1 +short app.example.com

# Example output:
# 203.0.113.25
```

Both answers can be correct. The private resolver returns an internal address. The public resolver returns a public address. The question is which resolver the failing client used. If a production server should use the private address, check its resolver config, VPC DNS settings, and private hosted zone association. If an external user receives the private address, the public zone may contain an internal value by mistake. Once DNS gives the right IP for the client, the next check belongs to the IP and subnet layer.

![DNS resolution summary infographic showing records, delegation, caching, dig checks, TTLs, cutovers, and failure modes](/content-assets/articles/article-devops-foundation-networking-dns-resolution/dns-resolution-summary.png)

_The summary image collects the DNS ideas operators use when a hostname points to the wrong place._

## References

- [RFC 1034: Domain Names - Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034) - Foundational DNS architecture, naming hierarchy, and resolver behavior.
- [RFC 1035: Domain Names - Implementation and Specification](https://datatracker.ietf.org/doc/html/rfc1035) - DNS message format, record types, and protocol details.
- [BIND 9 `dig` Documentation](https://bind9.readthedocs.io/en/latest/manpages.html#dig-query-dns-lookup-utility) - Official `dig` reference from the BIND project.
- [Cloudflare Learning Center: What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/) - Beginner-friendly walkthrough of DNS resolution and record types.
- [AWS Route 53 DNS Best Practices](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/best-practices-dns.html) - Official guidance for hosted zones, DNS changes, TTLs, and resilient DNS design.
