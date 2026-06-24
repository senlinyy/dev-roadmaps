---
title: "DNS Resolution"
description: "Trace how a browser turns a hostname into an IP address, debug DNS with dig, and plan TTL changes before production cutovers."
overview: "Understand how DNS maps names to addresses, how recursive resolvers find authoritative answers, and why TTL planning matters before traffic can move to a new server."
tags: ["dns", "dig", "cname", "ttl", "nameserver"]
order: 2
id: article-devops-foundation-networking-dns-resolution
---

## Table of Contents

1. [Where DNS Fits in the Request Path](#where-dns-fits-in-the-request-path)
2. [What DNS Does](#what-dns-does)
3. [The Resolution Chain](#the-resolution-chain)
4. [Records You Will Touch in Real Work](#records-you-will-touch-in-real-work)
5. [Debugging DNS with dig](#debugging-dns-with-dig)
6. [TTL and Safe Cutovers](#ttl-and-safe-cutovers)
7. [DNS Failure Modes](#dns-failure-modes)

## Where DNS Fits in the Request Path
<!-- section-summary: DNS is the first lookup in the browser path because the browser needs an IP address before it can open a TCP or TLS connection. -->

The shared request path for this networking section is `browser -> DNS -> IP/subnet -> firewall -> TLS -> Nginx reverse proxy -> app`. DNS is the first real network question in that path. The browser has a name, `app.example.com`, but the network needs an address, such as `203.0.113.25`.

The browser cannot send a TCP SYN packet to a name. It needs a destination IP first. DNS provides that answer. Once DNS returns the IP address, the operating system can look at subnets and routes, the firewall can decide whether port `443` is allowed, TLS can protect the connection, and Nginx can forward the request to the app.

Here is a small version of the flow:

```bash
$ dig +short app.example.com
203.0.113.25
```

That one line unlocks the next step. Now the machine can ask, "How do I reach `203.0.113.25`?" That routing question belongs to the IP and subnet article. This article stays with the name lookup and the traps around it.

## What DNS Does
<!-- section-summary: DNS maps human names to machine addresses through delegated, cacheable records. -->

**DNS**, the Domain Name System, is the internet's naming system. It maps domain names like `app.example.com` to records. The most common record gives an IP address, but DNS also stores mail routing, text verification, service discovery, and delegation information.

The beginner definition is simple: DNS is a distributed lookup system for names. A domain name is for people and software configuration. An IP address is for packet routing. DNS connects those two worlds.

Before DNS, early internet hosts shared one file called `HOSTS.TXT`. That file listed every known host and its address. A central team maintained it, and everyone copied it. That worked for a small research network. It did not work for a growing internet. DNS replaced the single file with delegation. The root zone delegates `.com`. The `.com` servers delegate `example.com`. The `example.com` authoritative nameservers answer for their own records.

You still see a tiny local version of the old approach in `/etc/hosts`:

```bash
$ grep app.example.com /etc/hosts
203.0.113.25 app.example.com
```

That file can override DNS on one machine. Teams sometimes use it for local testing, but production services need DNS because every user, server, CI runner, and load balancer needs the same public lookup path.

## The Resolution Chain
<!-- section-summary: A recursive resolver follows referrals from root to TLD to authoritative nameservers, then caches the answer for later clients. -->

When the browser needs `app.example.com`, it usually asks the operating system resolver. That local resolver is called a **stub resolver**. A stub resolver is small. It does not walk the whole DNS tree by itself. It forwards the question to a **recursive resolver**, often run by your ISP, your company, Cloudflare at `1.1.1.1`, Google at `8.8.8.8`, or CoreDNS inside Kubernetes.

The recursive resolver does the walking. If it does not already have a cached answer, it asks the DNS hierarchy in stages:

1. It asks a root nameserver where to find `.com`.
2. It asks a `.com` TLD nameserver where to find `example.com`.
3. It asks the authoritative nameserver for `example.com` what `app.example.com` points to.
4. It returns the final answer to the client and stores it in cache.

The **authoritative nameserver** is the server that owns the answer for a zone. If your team hosts DNS in Cloudflare, Route 53, Azure DNS, or Google Cloud DNS, that provider's authoritative nameservers answer for your domain.

The chain looks like this in `dig +trace`:

```bash
$ dig +trace app.example.com

.                       518400  IN  NS  a.root-servers.net.
com.                    172800  IN  NS  a.gtld-servers.net.
example.com.            172800  IN  NS  ns1.dns-provider.example.
app.example.com.        300     IN  A   203.0.113.25
```

The exact servers will differ, but the shape stays the same. Root sends the resolver to the TLD. The TLD sends it to the domain's authoritative nameserver. The authoritative nameserver gives the record.

In production, this chain matters during incidents. If the authoritative server has the right record but a public resolver still returns the old value, the issue is probably cache. If the TLD points at the wrong nameserver, the resolver will never reach the place where you changed the record. `dig +trace` shows that difference.

## Records You Will Touch in Real Work
<!-- section-summary: DNS records describe addresses, aliases, mail routing, verification text, and nameserver delegation. -->

DNS records are typed. The type tells the resolver what kind of answer it should expect. A web application usually needs a small set of record types.

An **A record** maps a name to an IPv4 address:

```
app.example.com.    300    IN    A    203.0.113.25
```

This says `app.example.com` resolves to `203.0.113.25`, and resolvers may cache that answer for `300` seconds.

An **AAAA record** maps a name to an IPv6 address:

```
app.example.com.    300    IN    AAAA    2001:db8:10::25
```

Modern load balancers and CDNs often support both A and AAAA records. That setup is called dual stack because clients can use IPv4 or IPv6.

A **CNAME record** makes one name an alias for another name:

```
www.example.com.    300    IN    CNAME    app.example.com.
```

This is useful when `www.example.com` and `app.example.com` should land at the same place. The resolver follows the alias and then resolves the target. A CNAME cannot sit at the zone apex, such as `example.com`, because the apex must also hold records like `SOA` and `NS`. DNS providers often offer ALIAS, ANAME, or CNAME flattening features for that case.

An **MX record** tells other mail servers where to deliver mail for a domain. A **TXT record** stores text, often for domain verification, SPF, DKIM, and DMARC email security. An **NS record** delegates a zone to nameservers.

| Type | Small example | Common production use |
| --- | --- | --- |
| `A` | `app -> 203.0.113.25` | IPv4 web app, load balancer, public server |
| `AAAA` | `app -> 2001:db8:10::25` | IPv6 web app or CDN |
| `CNAME` | `www -> app.example.com` | Alias one hostname to another |
| `MX` | `example.com -> mail.example.com` | Receiving email |
| `TXT` | `example.com -> "v=spf1 ..."` | Email security and ownership checks |
| `NS` | `example.com -> ns1.provider.example` | Delegating a zone to DNS hosting |

The important production habit is to know which record owns the traffic switch. If `app.example.com` is a CNAME to `alb-123.us-east-1.elb.amazonaws.com`, changing an A record somewhere else will not move traffic. The resolver follows the CNAME target, so the target is the thing that must point at the current load balancer.

## Debugging DNS with dig
<!-- section-summary: `dig` shows the resolver, status, answer, record type, and TTL so DNS debugging can use direct evidence. -->

`dig` is the standard command-line tool for DNS debugging. It shows which resolver answered, which status came back, and which records were returned.

A normal lookup looks like this:

```bash
$ dig app.example.com

;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 41821
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; QUESTION SECTION:
;app.example.com.              IN      A

;; ANSWER SECTION:
app.example.com.       300     IN      A       203.0.113.25

;; Query time: 18 msec
;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)
```

The status is `NOERROR`, so the resolver found an answer. The answer section shows the name, the TTL, the class, the type, and the value. The server line shows which resolver answered. On many Linux systems, `127.0.0.53` is `systemd-resolved`, a local stub that forwards to the real recursive resolver.

For a short answer:

```bash
$ dig +short app.example.com
203.0.113.25
```

For a specific resolver:

```bash
$ dig @1.1.1.1 +short app.example.com
203.0.113.25

$ dig @8.8.8.8 +short app.example.com
203.0.113.25
```

That comparison is helpful after a DNS change. If one resolver returns the new IP and another returns the old IP, the record may be correct at the authoritative server while caches around the internet still age out.

For authoritative nameserver checks:

```bash
$ dig NS example.com +short
ns1.dns-provider.example.
ns2.dns-provider.example.

$ dig @ns1.dns-provider.example app.example.com A
```

That second command asks the authoritative server directly. It bypasses public recursive resolver cache. If the authoritative server returns the right value, your DNS provider has the record. If recursive resolvers still disagree, cache or delegation is the next place to inspect.

## TTL and Safe Cutovers
<!-- section-summary: TTL controls how long resolvers keep an answer, so traffic migrations need TTL planning before the record changes. -->

**TTL**, or Time To Live, is the number of seconds a resolver may cache a DNS answer. A TTL of `300` means the resolver can reuse the answer for five minutes. A TTL of `3600` means one hour.

TTL makes DNS fast. Without caching, every browser request could force recursive resolvers to walk root, TLD, and authoritative servers again. Caching reduces latency for users and reduces load on authoritative DNS providers.

TTL also creates the classic migration trap. Suppose `app.example.com` currently points to the old load balancer:

```
app.example.com.    3600    IN    A    198.51.100.10
```

At noon you change it to the new load balancer:

```
app.example.com.    3600    IN    A    203.0.113.25
```

A resolver that cached the old answer at 11:55 can keep serving `198.51.100.10` until 12:55. Another resolver that had no cache at noon gets the new answer immediately. Users appear split between old and new infrastructure, and both groups are seeing valid DNS behavior.

A safer cutover uses three phases:

1. Lower the TTL in advance, often to `60` or `300` seconds.
2. Wait at least one old TTL period so caches worldwide learn the shorter TTL.
3. Change the record, verify multiple resolvers, then raise the TTL after the new path is stable.

The verification can be a simple resolver loop:

```bash
$ for resolver in 1.1.1.1 8.8.8.8 9.9.9.9; do
>   printf "%s " "$resolver"
>   dig @"$resolver" +short app.example.com
> done
1.1.1.1 203.0.113.25
8.8.8.8 203.0.113.25
9.9.9.9 203.0.113.25
```

That check does not prove every resolver in the world has changed, but it gives practical evidence from major public resolvers. For high-risk migrations, teams also check regional monitoring, CDN edge behavior, and application logs to confirm traffic has moved.

## DNS Failure Modes
<!-- section-summary: DNS failures usually show up as missing names, server-side resolution errors, timeouts, stale answers, or split answers. -->

DNS failures can look like application failures because the browser only shows "site cannot be reached." The error status tells you where to look.

**NXDOMAIN** means the name does not exist according to the authoritative DNS path. Common causes include typos, missing records, wrong zones, and expired domains.

```bash
$ dig missing.example.com
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 50110
```

If `app.staging.example.com` returns `NXDOMAIN`, check the zone where the record was created. Teams often add the record to `example.com` while the real delegated zone is `staging.example.com`, or the reverse.

**SERVFAIL** means the resolver tried to answer but something in the lookup failed. DNSSEC validation errors, broken authoritative nameservers, and delegation mistakes often show up this way.

```bash
$ dig app.example.com
;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 38321
```

The next check is usually `dig +trace app.example.com` and a direct query to the authoritative nameserver.

**Timeout** means the query did not receive a response. That may be a network or firewall problem rather than a DNS record problem.

```bash
$ dig @8.8.8.8 app.example.com
;; connection timed out; no servers could be reached
```

If public resolver queries time out from one host but work from another, inspect local firewall rules, corporate DNS policy, VPN routes, and `/etc/resolv.conf`.

**Stale cache** returns a valid answer that is no longer the answer you wanted. The status is still `NOERROR`. The IP is simply old. TTL planning is the fix before a migration; patience and old-infrastructure health are the fix during a migration already in progress.

**Split-horizon DNS** returns different answers depending on which resolver asks. Companies use this deliberately when `app.example.com` should resolve to a private IP inside the office or VPC and a public IP outside. It creates confusion when a laptop on VPN sees one answer and a production server sees another.

```bash
$ dig @10.0.0.10 +short app.example.com
10.20.5.15

$ dig @1.1.1.1 +short app.example.com
203.0.113.25
```

Both answers can be correct. The question is which resolver the failing client used. Once DNS gives the right IP for the client, the request path moves to the IP and subnet layer.

---

**References**

- [RFC 1034: Domain Names - Concepts and Facilities](https://datatracker.ietf.org/doc/html/rfc1034) - Foundational DNS architecture, naming hierarchy, and resolver behavior.
- [RFC 1035: Domain Names - Implementation and Specification](https://datatracker.ietf.org/doc/html/rfc1035) - DNS message format, record types, and protocol details.
- [BIND 9 `dig` Documentation](https://bind9.readthedocs.io/en/latest/manpages.html#dig-query-dns-lookup-utility) - Official `dig` reference from the BIND project.
- [Cloudflare Learning Center: What is DNS?](https://www.cloudflare.com/learning/dns/what-is-dns/) - Beginner-friendly walkthrough of DNS resolution and record types.
- [AWS Route 53 DNS Best Practices](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/best-practices-dns.html) - Official guidance for hosted zones, DNS changes, TTLs, and resilient DNS design.
