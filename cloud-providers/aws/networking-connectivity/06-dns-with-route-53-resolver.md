---
title: "DNS with Route 53 Resolver"
description: "Learn how Route 53 Resolver chooses private, public, PrivateLink, and hybrid DNS paths before ordinary network routing begins."
overview: "DNS determines the first network destination but not whether that address is reachable. This article separates records, resolvers, forwarding, and packet connectivity, then explains private hosted zones, interface endpoint private DNS, inbound and outbound Resolver endpoints, query logs, and systematic debugging."
tags: ["aws", "route-53", "dns", "resolver", "hybrid-networking", "vpc"]
order: 6
id: article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver
aliases:
  - dns-with-route-53-resolver
  - route-53-resolver
  - vpc-dns-resolver
---

## Table of Contents

1. [What Does DNS Do Before Networking Begins?](#what-does-dns-do-before-networking-begins)
2. [What Is Route 53 Resolver?](#what-is-route-53-resolver)
3. [How Do VPC DNS Attributes and DHCP Options Differ?](#how-do-vpc-dns-attributes-and-dhcp-options-differ)
4. [How Do Private Hosted Zones Create Private DNS Views?](#how-do-private-hosted-zones-create-private-dns-views)
5. [How Does PrivateLink Private DNS Change the First Destination?](#how-does-privatelink-private-dns-change-the-first-destination)
6. [How Does Hybrid DNS Enter and Leave AWS?](#how-does-hybrid-dns-enter-and-leave-aws)
7. [What Do Resolver Query Logs Show?](#what-do-resolver-query-logs-show)
8. [How Do You Troubleshoot DNS Systematically?](#how-do-you-troubleshoot-dns-systematically)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

AWS DNS becomes easier when four problems remain separate:

| Problem | AWS mechanism |
|---|---|
| Which address should this name mean? | DNS records and hosted zones |
| Which DNS system should answer the question? | Route 53 Resolver |
| How does a question reach another DNS system? | Resolver endpoints and rules |
| Can packets reach the resulting address? | Routes, transit, VPN, security controls, endpoint policies, and firewalls |

The sections below answer these questions in order:

1. **What Does DNS Do Before Networking Begins?**
2. **What Is Route 53 Resolver?**
3. **How Do VPC DNS Attributes and DHCP Options Differ?**
4. **How Do Private Hosted Zones Create Private DNS Views?**
5. **How Does PrivateLink Private DNS Change the First Destination?**
6. **How Does Hybrid DNS Enter and Leave AWS?**
7. **What Do Resolver Query Logs Show?**
8. **How Do You Troubleshoot DNS Systematically?**

## What Does DNS Do Before Networking Begins?
<!-- section-summary: DNS supplies the address for a name, after which routing and security determine whether the application can reach it. -->

Suppose an application wants `https://api.example.com`. It begins with a name, not an address.

```text
Application
  ↓ asks: What is api.example.com?
DNS
  ↓ answers: 10.20.30.40
Application
  ↓ connects to 10.20.30.40:443
ordinary networking
```

DNS's main job ends when it supplies the answer. It does not prove that `10.20.30.40` is reachable.

The packet may still need a VPC route, Transit Gateway, VPN, or another next hop. Security groups, NACLs, firewalls, and application listeners can still reject it.

The durable principle is:

> A DNS name chooses the first network destination. Routing decides how to reach it. Security decides whether traffic may pass.

A successful `dig` therefore does not prove that `curl` can connect. A failed TCP connection does not prove that DNS is wrong. Test each stage.

Several DNS actors participate before AWS-specific behavior appears:

```text
Application
  ↓
OS stub resolver
  ↓
recursive resolver
  ├─ root DNS
  ├─ top-level-domain DNS
  └─ authoritative DNS for the name
```

The **stub resolver** is the small client in the operating system. The **recursive resolver** finds or caches the answer on the client's behalf. The **authoritative server** owns the DNS records for a namespace.

Inside a normal VPC, Amazon Route 53 Resolver serves as the recursive resolver. A Route 53 hosted zone can be one authoritative source that Resolver consults. Resolver and hosted zone are not two names for the same thing.

## What Is Route 53 Resolver?
<!-- section-summary: Route 53 Resolver is the distributed AWS DNS query engine reached through the Amazon-provided VPC DNS addresses. -->

AWS documentation also calls Route 53 Resolver the Amazon DNS server or `AmazonProvidedDNS`. It is built into every Availability Zone.

VPC resources can reach it through addresses including:

- `169.254.169.253` for IPv4 link-local access;
- `fd00:ec2::253` for IPv6 link-local access; and
- the VPC's base IPv4 address plus two.

For VPC `10.0.0.0/16`, the familiar resolver address is `10.0.0.2`:

```text
EC2 10.0.1.25
  ↓ DNS query
10.0.0.2
  ↓
Route 53 Resolver
```

Do not picture `10.0.0.2` as a hidden EC2 instance. It is an AWS-provided entry into a distributed resolver service. AWS transports those queries privately to Resolver rather than treating them as ordinary VPC traffic.

This has an operational consequence: security groups and NACLs cannot block requests to `AmazonProvidedDNS`. Route 53 Resolver DNS Firewall is the AWS mechanism intended to filter DNS queries on that path.

Now separate Resolver from a private hosted zone:

```text
Resolver = librarian that receives and directs the question
Hosted zone = book containing DNS records
```

A private hosted zone for `corp.example.com` may contain:

```text
db.corp.example.com    → 10.50.1.20
api.corp.example.com   → 10.50.2.30
cache.corp.example.com → 10.50.3.40
```

Resolver receives "Where is `db.corp.example.com`?", knows that the querying VPC is associated with that zone, and returns `10.50.1.20`. Resolver processes the query; the hosted zone supplies data.

![The DNS answer path shows how a workload receives private service answers from the VPC resolver before it ever opens a network connection](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/dns-answer-packet-path.png)

*The host first reaches the VPC Resolver, which chooses a DNS authority or forwarding path and returns the address that ordinary networking will use.*

### How Does Resolver Choose Who Answers a Name?
<!-- section-summary: Resolver evaluates matching rules and private namespaces, choosing the most-specific suffix before falling back to public recursion. -->

An EC2 application's normal path begins with the operating-system resolver and the DNS server learned through DHCP:

```text
application
  ↓
OS resolver
  ↓ DNS server from DHCP
AmazonProvidedDNS
  ↓
Route 53 Resolver decision
```

Resolver must decide who owns the queried name. A useful conceptual flow is:

```text
DNS query
  ↓
matching Resolver forwarding rule?
  ├─ yes → outbound endpoint → target DNS servers
  └─ no  → matching private DNS namespace?
           ├─ private hosted zone
           ├─ AWS-managed private namespace
           └─ PrivateLink hidden private zone

if no private answer path applies
  → ordinary public DNS recursion
```

AWS has more detailed precedence rules, but this model captures the important routing decision.

Resolver rules use domain suffixes. If `example.com` and `prod.example.com` rules both match `db.prod.example.com`, the more-specific `prod.example.com` rule wins.

This resembles longest-prefix matching for IP routes. Network routing compares address prefixes from the left. DNS compares namespace suffixes from the right:

```text
IP destination 10.20.30.40
10.20.0.0/16
10.20.30.0/24  ← more specific

DNS name db.prod.example.com
example.com
prod.example.com ← more specific
```

A matching Resolver forwarding rule can take precedence over a private hosted zone for the same namespace. If a VPC has a private zone `example.com` and a forwarding rule `example.com → corporate DNS`, Resolver forwards matching questions instead of answering from that zone.

Resolver rules therefore behave like route tables for DNS questions:

```text
corp.example.com → corporate DNS
ad.example.com   → Active Directory DNS
everything else  → normal Resolver behavior
```

Do not treat a private hosted zone as absolute authority independent of the Resolver decision. Rules, namespace specificity, AWS system DNS, and available private zones together decide where the question goes.

## How Do VPC DNS Attributes and DHCP Options Differ?
<!-- section-summary: VPC attributes enable AWS DNS capabilities, while DHCP options tell each operating system which resolver addresses to use. -->

Two similarly named VPC attributes solve different problems:

| Attribute | Question |
|---|---|
| `enableDnsSupport` | Can resources use the Amazon-provided Resolver? |
| `enableDnsHostnames` | Should AWS assign DNS hostnames to applicable resources? |

With DNS support enabled, requests to `AmazonProvidedDNS` can resolve. DNS hostnames depend on DNS support and control AWS-generated hostname behavior for resources such as EC2 instances where appropriate.

Both attributes matter for features such as interface-endpoint private DNS. The AWS-managed hidden private hosted zones behind that feature require VPC DNS resolution and hostnames to be enabled.

DHCP options answer another question: which DNS server should the operating system ask? An instance can learn:

```text
DNS server = AmazonProvidedDNS
```

or custom addresses such as:

```text
DNS server = 10.100.0.10
DNS server = 10.100.0.11
```

Linux may show `nameserver 10.0.0.2` in `/etc/resolv.conf`, or it may show a local stub such as `127.0.0.53` that ultimately forwards to the DHCP-provided DNS server.

The layers are:

```text
VPC DNS attributes
  → make AWS DNS capabilities available

DHCP options
  → tell the operating system which resolver to query
```

This explains a common failure. The VPC has DNS support and a correct private hosted zone, but EC2 uses corporate DNS directly. If corporate DNS does not forward the private namespace to Route 53 Resolver, the query never reaches the zone.

Creating a private zone does not intercept arbitrary DNS packets. The client must actually ask a Resolver path that can see the zone. AWS supports either `AmazonProvidedDNS` or custom DNS servers in DHCP options and warns that mixing both can produce unexpected behavior.

## How Do Private Hosted Zones Create Private DNS Views?
<!-- section-summary: A private hosted zone serves its records only through associated VPC Resolver contexts and can shadow public DNS for the same namespace. -->

Suppose public DNS says:

```text
api.example.com → 198.51.100.20
```

Inside an AWS VPC, you want:

```text
api.example.com → 10.20.1.50
```

Associate a Route 53 private hosted zone named `example.com` with that VPC and create the private record. Outside the VPC, public DNS returns the public address. Inside the associated VPC, Resolver returns the private address.

This is **split-horizon** or **split-view DNS**: the same name has different answers in different resolver contexts.

A private hosted zone's scope comes from its VPC associations. The word private is not a universal label that makes every AWS client see the zone. Resolver checks which zones are associated with the querying VPC.

A crucial shadowing rule follows. Suppose public DNS contains `www.example.com → 203.0.113.50`. An associated private zone named `example.com` exists but has no `www` record. Resolver does not necessarily fall back to public DNS after the private namespace matches. It can return `NXDOMAIN`.

```text
query www.example.com
  ↓
associated private zone example.com matches
  ↓
www record exists?
  ├─ yes → private answer
  └─ no  → NXDOMAIN, no public fallback
```

This is why a site can work on a public laptop but fail inside a VPC after a private zone is created. The private zone has claimed the namespace but does not contain all records clients expect.

If both `example.com` and `prod.example.com` private zones are associated and the client asks for `db.prod.example.com`, the more-specific `prod.example.com` namespace wins. The same specificity idea governs forwarding rules.

## How Does PrivateLink Private DNS Change the First Destination?
<!-- section-summary: Interface endpoint private DNS creates an AWS-managed private view that maps the normal service hostname to endpoint ENIs. -->

PrivateLink demonstrates why names choose the first network destination.

Without an interface endpoint, a hostname such as `monitoring.us-east-2.amazonaws.com` resolves to ordinary AWS service addresses. The workload may need a public-style path to those service endpoints.

Create an interface endpoint. AWS places endpoint ENIs in selected subnets:

```text
AZ A endpoint ENI: 10.0.1.73
AZ B endpoint ENI: 10.0.2.91
```

AWS also provides endpoint-specific names. Requiring applications to replace the standard service hostname with a `vpce-...` name would couple code to one endpoint deployment.

When **private DNS** is enabled, AWS creates an AWS-managed hidden private hosted zone associated with the VPC. Conceptually, it contains:

```text
monitoring.us-east-2.amazonaws.com
  → 10.0.1.73
  → 10.0.2.91
```

The application and hostname stay unchanged. The Resolver answer changes, and therefore the first network destination changes.

```text
Before private DNS:
normal service hostname → public service address

After private DNS:
normal service hostname → endpoint private ENIs → PrivateLink
```

![The private DNS checklist helps compare resolver settings, hosted zone association, endpoint private DNS, forwarding rules, and query logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/private-dns-checklist.png)

*Interface endpoint private DNS changes the answer, while normal route and security checks still control reachability to the private ENI.*

Correct resolution does not prove connectivity. If the name resolves to `10.0.1.73` but the endpoint security group rejects TCP `443`, DNS has succeeded and the connection still fails.

The same model applies when a company publishes its own endpoint service. After the provider proves ownership of `api.example.com`, consumers can enable private DNS so that the stable service name maps to their endpoint ENIs. Outside the consumer VPC, the same name can still follow its public view.

## How Does Hybrid DNS Enter and Leave AWS?
<!-- section-summary: Inbound endpoints let external resolvers query AWS private DNS, while outbound endpoints let Route 53 Resolver forward selected domains to external DNS servers. -->

Hybrid environments often have two DNS universes. AWS owns names such as `app.aws.example.com`, while a data centre owns `sql.corp.example.com` and `ad.corp.example.com`.

VPN, Direct Connect, and Transit Gateway can provide IP paths between the networks. They do not automatically teach either DNS system about the other's records. DNS integration needs its own endpoints and forwarding rules.

An **inbound Resolver endpoint** lets DNS questions enter Route 53 Resolver from another network.

Suppose an on-premises client asks for `db.aws.example.com`. Corporate DNS does not own that namespace, so it conditionally forwards `aws.example.com` to the inbound endpoint:

```text
on-prem client
  ↓
corporate DNS
  ↓ conditional forward for aws.example.com
VPN or Direct Connect
  ↓
Resolver inbound endpoint private IPs
  ↓
Route 53 Resolver
  ↓
private hosted zone
  ↓
10.30.4.50
```

The inbound endpoint creates actual ENIs and IP addresses in chosen VPC subnets. Its security group must allow expected DNS traffic, commonly UDP and TCP port `53`, from the approved DNS servers.

Do not confuse the inbound endpoint with `10.0.0.2`. `AmazonProvidedDNS` is the built-in entry for VPC resources. The inbound endpoint gives external networks routable addresses to which they can send DNS questions.

An **outbound Resolver endpoint** supports the reverse flow: Route 53 Resolver sends selected questions to another DNS system.

Associate a rule such as:

```text
corp.example.com
  → 10.100.0.10
  → 10.100.0.11
```

Now an EC2 query for `sql.corp.example.com` matches the rule, exits through the outbound endpoint, crosses the existing VPN or Direct Connect path, and reaches corporate DNS.

```text
EC2 → Route 53 Resolver
       ↓ matching suffix rule
     outbound endpoint
       ↓ hybrid network
     corporate DNS
       ↓ answer 10.200.50.30
```

The mnemonic is:

```text
Inbound:  on-premises DNS → AWS DNS
Outbound: AWS DNS → on-premises DNS
```

![The forwarding map shows how inbound endpoints, outbound endpoints, and forwarding rules connect VPC DNS with on-premises DNS](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/resolver-forwarding-map.png)

*Inbound and outbound describe the direction of the DNS question relative to Route 53 Resolver.*

### How Can Hybrid DNS Be Centralized?
<!-- section-summary: Resolver endpoints are regional networking resources, and shared rules can centralize hybrid DNS across many VPCs without replacing local Resolver behavior. -->

Resolver endpoints are conventional networking resources. They involve subnets, IP addresses, ENIs, security groups, and routes to remote DNS servers.

An outbound endpoint does not create AWS-to-corporate connectivity by itself. If its target is `10.200.10.53`, the endpoint must be able to send UDP or TCP `53` to that address through VPN, Direct Connect, Transit Gateway, Cloud WAN, or another existing network path.

Resolver endpoints and behavior are Regional. Endpoint IPs should span multiple Availability Zones for resilience.

In a large environment, creating independent inbound and outbound endpoints in every VPC can duplicate cost and policy:

```text
VPC A ─┐
VPC B ─┼→ Transit Gateway → shared-services VPC
VPC C ─┘                    ├─ inbound Resolver endpoint
                           └─ outbound Resolver endpoint
                                  ↕
                             corporate DNS
```

Resolver rules can be shared across accounts and VPCs, including through AWS Resource Access Manager. This lets an organization centralize hybrid DNS infrastructure and conditional-forwarding policy.

Centralization should not force ordinary VPC DNS through a central appliance unnecessarily. Route 53 Resolver can answer public, private-hosted-zone, and PrivateLink names locally. Centralize the hybrid endpoints and shared forwarding rules where appropriate, while preserving local Resolver paths for names AWS already knows.

Forwarding rules remain most-specific. If `corp.example.com` forwards to production DNS and `dev.corp.example.com` forwards to development DNS, the latter handles `server.dev.corp.example.com`.

AWS also supports Resolver **delegation rules**. Unlike ordinary conditional forwarding, delegation rules follow DNS `NS` delegation semantics. Conditional forwarding remains the clearest starting model, but the distinction matters when an architecture intentionally delegates authority rather than forwarding every suffix match.

## What Do Resolver Query Logs Show?
<!-- section-summary: Query logs record Resolver decisions and answers for configured sources, but cached responses can omit repeated application lookups during the TTL. -->

Route 53 Resolver query logging provides evidence at the DNS decision point. Logs can capture queries originating from configured VPCs, arriving through inbound endpoints, involving outbound resolution, or evaluated by Resolver DNS Firewall. Destinations can include CloudWatch Logs, S3, or Data Firehose.

Useful fields include:

```text
query_name
query_type
rcode
source address
VPC ID
instance
resolver endpoint
response data
```

Examples can show:

```text
query_name = api.example.com
query_type = A
rcode      = NOERROR
answer     = 10.20.1.50
```

or `NXDOMAIN`, meaning the selected DNS authority had no such name, or `SERVFAIL`, meaning resolution failed.

Query logs can identify the Resolver endpoint involved, which helps trace inbound and outbound hybrid flows.

There is a caching nuance. If the Resolver looks up `api.example.com → 10.20.1.50` with TTL `300`, later clients can receive the cached answer during those five minutes. Resolver query logging does not necessarily create an entry for every application lookup because unique lookups are logged while cache-served responses during the TTL may not be.

Therefore:

```text
application performed a DNS lookup
  ≠ a new Resolver query-log record must exist
```

Use host resolver state, application timing, TTL, and Resolver logs together rather than treating a missing repeated log line as proof that no DNS request occurred.

## How Do You Troubleshoot DNS Systematically?
<!-- section-summary: A DNS investigation proves the client's resolver, winning rule or namespace, returned address, and only then the network path to that address. -->

Replace "DNS does not work" with a sequence of smaller questions:

1. Did the application ask the expected name?
2. Which DNS server did its operating system ask?
3. Did the question reach Route 53 Resolver or stay in another resolver/cache?
4. Which private hosted zone, hidden PrivateLink zone, or forwarding rule won?
5. What response code and records came back?
6. Is the answer the intended IPv4 or IPv6 address?
7. Can the application reach that address?

Useful tests include:

| Question | Example | What it reveals |
|---|---|---|
| Which resolver is configured? | `cat /etc/resolv.conf` | DHCP and OS resolver path |
| Does the name resolve? | `dig api.example.com` | Overall result |
| Which IPv4 answer is returned? | `dig A api.example.com` | First IPv4 destination |
| Which IPv6 answer is returned? | `dig AAAA api.example.com` | First IPv6 destination |
| Did AWS Resolver see it? | Resolver query logs | Query reached the logged Resolver path |
| Which private zone applies? | Inspect VPC associations | Private authority and shadowing |
| Which rule applies? | Inspect Resolver rules | Conditional forwarding decision |
| Correct answer but failed connection? | `curl` or `nc` | Move to routing, security, TLS, or application |

On Windows, `ipconfig /all` and `Resolve-DnsName api.example.com` provide similar evidence.

Three classic failures illustrate the method.

**The name resolves publicly despite a private hosted zone.** Verify the zone's VPC association, confirm that the client actually uses `AmazonProvidedDNS` or a correctly forwarding corporate resolver, and check whether a Resolver rule overrides the zone.

**The name works publicly but returns `NXDOMAIN` inside the VPC.** An associated private parent zone may claim the namespace without containing the queried record. Resolver does not fall back to the public record after that private match.

**The name resolves to the expected private address but the connection times out.** DNS succeeded. Check the endpoint or destination security group, client egress, route and return path, NACLs, endpoint and service policies, TCP port, TLS, and the application.

The complete sequence is:

```text
NAME
  ↓
WHICH RESOLVER?
  ↓
WHICH DNS NAMESPACE OR RULE?
  ↓
IP ADDRESS
  ↓
WHICH NETWORK PATH?
  ↓
IS TRAFFIC ALLOWED?
  ↓
SERVICE
```

Think of Route 53 Resolver as the VPC receptionist. It decides that a name belongs to a private zone, PrivateLink's hidden zone, corporate DNS through an outbound endpoint, or ordinary public recursion. It returns an address. At that point, normal networking begins.

## Check Your Answers
<!-- section-summary: Review the resolver, zone, forwarding, private DNS, logging, and network-path boundaries. -->

:::expand[What Does DNS Do Before Networking Begins?]{kind="recap"}
DNS supplies the address for a name, after which routing and security determine whether the application can reach it.

DNS maps a name to the address that becomes the first network destination. It does not prove a route exists, security controls allow traffic, or an application responds at that address.

No. Their ENIs need subnets, routes, security groups, and an existing path such as VPN or Direct Connect to reach remote DNS IPs on UDP or TCP `53`.
:::

:::expand[What Is Route 53 Resolver?]{kind="recap"}
Route 53 Resolver is the distributed AWS DNS query engine reached through the Amazon-provided VPC DNS addresses.

It is the VPC-CIDR-plus-two entry to the distributed Amazon-provided Route 53 Resolver, not an EC2 DNS server. Link-local IPv4 and IPv6 addresses also expose the Resolver.

Resolver evaluates matching rules and private namespaces, choosing the most-specific suffix before falling back to public recursion.

For `db.prod.example.com`, a `prod.example.com` zone or rule is more specific than `example.com`. Resolver uses suffix specificity much like a route table uses the longest address prefix.
:::

:::expand[How Do VPC DNS Attributes and DHCP Options Differ?]{kind="recap"}
VPC attributes enable AWS DNS capabilities, while DHCP options tell each operating system which resolver addresses to use.

`enableDnsSupport` and `enableDnsHostnames` enable AWS DNS capabilities. DHCP options tell each operating system which resolver addresses to ask. A correct zone is invisible when the client queries a DNS server with no route back to it.
:::

:::expand[How Do Private Hosted Zones Create Private DNS Views?]{kind="recap"}
A private hosted zone serves its records only through associated VPC Resolver contexts and can shadow public DNS for the same namespace.

Resolver receives and directs DNS questions. A hosted zone is one source of authoritative record data that Resolver can consult for associated VPCs.

Once the associated private zone matches the namespace, it owns the private view. If the requested record is absent, Resolver can return `NXDOMAIN` without falling back to the public zone.
:::

:::expand[How Does PrivateLink Private DNS Change the First Destination?]{kind="recap"}
Interface endpoint private DNS creates an AWS-managed private view that maps the normal service hostname to endpoint ENIs.

AWS associates a managed hidden private hosted zone with the VPC so that the normal service hostname resolves to interface-endpoint private ENIs. The application name stays the same while its first network destination changes.
:::

:::expand[How Does Hybrid DNS Enter and Leave AWS?]{kind="recap"}
Inbound endpoints let external resolvers query AWS private DNS, while outbound endpoints let Route 53 Resolver forward selected domains to external DNS servers.

Inbound endpoints let DNS clients in external networks send questions into Route 53 Resolver. Outbound endpoints let Resolver forward matching questions from AWS to external DNS servers.

Resolver endpoints are regional networking resources, and shared rules can centralize hybrid DNS across many VPCs without replacing local Resolver behavior.
:::

:::expand[What Do Resolver Query Logs Show?]{kind="recap"}
Query logs record Resolver decisions and answers for configured sources, but cached responses can omit repeated application lookups during the TTL.

The OS stub resolver sends the client's question, the recursive resolver performs or caches the lookup, and an authoritative server or hosted zone owns the relevant DNS data.

Resolver can serve the answer from its cache during the record TTL. Query logs do not necessarily record every cache-served repetition even though the application asked again.
:::

:::expand[How Do You Troubleshoot DNS Systematically?]{kind="recap"}
A DNS investigation proves the client's resolver, winning rule or namespace, returned address, and only then the network path to that address.

Prove the queried name, chosen resolver, matching namespace or rule, response code, and returned address. Once the expected address is returned, stop changing DNS and inspect routing, packet controls, TLS, and service behavior.
:::

## References

- [Understanding Amazon DNS](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html) - Describes AmazonProvidedDNS addresses and VPC Resolver behavior.
- [Network ACLs and AmazonProvidedDNS](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Documents why security groups and NACLs cannot block the Amazon DNS server.
- [Resolver rule domain matching](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-overview-forward-vpc-to-network-domain-name-matches.html) - Explains most-specific forwarding-rule selection.
- [VPC DNS attributes](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-vpc-attribute.html) - Documents DNS support and hostname attributes.
- [Private DNS for AWS service endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/privatelink-access-aws-services.html) - Explains hidden private hosted zones for interface endpoints.
- [DHCP option sets](https://docs.aws.amazon.com/vpc/latest/userguide/DHCPOptionSet.html) - Covers AmazonProvidedDNS and custom domain-name servers.
- [Private hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html) - Describes VPC-scoped private DNS zones.
- [Private hosted zone considerations](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zone-private-considerations.html) - Covers specificity, NXDOMAIN shadowing, and rule precedence.
- [Manage PrivateLink DNS names](https://docs.aws.amazon.com/vpc/latest/privatelink/manage-dns-names.html) - Describes provider DNS verification and consumer private views.
- [Forward network queries into Resolver](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-overview-forward-network-to-vpc.html) - Explains inbound endpoints.
- [Forward outbound queries](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-forwarding-outbound-queries.html) - Explains outbound endpoints, rules, and rule sharing.
- [Resolve queries between VPCs and networks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-overview-DSN-queries-to-vpc.html) - Covers Regional endpoints and resilient endpoint placement.
- [Resolver query logging](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-query-logs.html) - Documents sources, destinations, and caching behavior.
- [Resolver query log fields](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-query-logs-format.html) - Defines response codes, endpoint, source, and answer fields.
