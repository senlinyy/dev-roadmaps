---
title: "IP Addressing & Subnets"
description: "Read IPv4 and IPv6 addresses, calculate CIDR ranges, and plan cloud subnets that route cleanly without overlap."
overview: "Learn how IP addresses, subnet masks, CIDR blocks, private ranges, and route decisions move a request from a resolved DNS answer toward the right server."
tags: ["cidr", "ipv4", "subnetting", "vpc", "ipv6"]
order: 3
id: article-devops-foundation-networking-ip-subnets
---

## Table of Contents

1. [After DNS: The Browser Has an IP](#after-dns-the-browser-has-an-ip)
2. [What an IP Address Represents](#what-an-ip-address-represents)
3. [Subnets and CIDR](#subnets-and-cidr)
4. [Private and Public Address Ranges](#private-and-public-address-ranges)
5. [Planning a VPC Subnet Layout](#planning-a-vpc-subnet-layout)
6. [IPv6 in the Same Request Path](#ipv6-in-the-same-request-path)
7. [Subnet Failure Modes](#subnet-failure-modes)

## After DNS: The Browser Has an IP
<!-- section-summary: After DNS returns an address, the operating system uses subnet and route information to decide the next hop. -->

In the previous step, DNS turned `app.example.com` into an IP address:

```bash
$ dig +short app.example.com
203.0.113.25
```

Now the browser asks the operating system to open a connection to `203.0.113.25` on port `443`. The browser does not choose the network path itself. The operating system looks at the local IP address, subnet mask, and route table to decide where the first packet should go.

On a laptop or server, that decision can look like this:

```bash
$ ip route get 203.0.113.25
203.0.113.25 via 10.0.0.1 dev eth0 src 10.0.0.42 uid 1000
    cache
```

This says the machine will send traffic through gateway `10.0.0.1` on interface `eth0`, using `10.0.0.42` as the source IP. The gateway is the next hop. It might be a home router, a cloud VPC router, a corporate VPN gateway, or a Kubernetes node route.

IP addressing and subnetting are the rules behind that decision. If those rules are wrong, the browser never reaches the firewall, TLS, Nginx, or app. The request can fail before the server knows anything happened.

## What an IP Address Represents
<!-- section-summary: An IP address identifies a host location on a network, while the subnet mask tells which part is the network and which part is the host. -->

An **IP address** is the network address for a device or interface. IPv4 addresses look like `10.0.0.42` or `203.0.113.25`. They contain four numbers from `0` to `255`. Each number is an **octet**, which means 8 bits. Four octets give IPv4 a 32-bit address space.

An IP address has two parts. The **network portion** identifies the network. The **host portion** identifies one address inside that network. A subnet mask tells the machine where that split lives.

For a common home or small-office subnet:

```
Address:      192.168.1.42
Subnet:       192.168.1.0/24
Network part: 192.168.1
Host part:              42
```

The `/24` means the first 24 bits are the network portion. In dotted form, that mask is `255.255.255.0`. Everything from `192.168.1.1` through `192.168.1.254` lives in that subnet. The first address, `192.168.1.0`, represents the network. The last address, `192.168.1.255`, is the broadcast address in traditional IPv4 subnetting.

This matters to routing. If your machine is `192.168.1.42/24` and it wants to reach `192.168.1.50`, the destination is on the same subnet. The machine can use ARP to find the destination MAC address and send a local frame. If it wants to reach `203.0.113.25`, the destination is outside the subnet. The packet goes to the default gateway.

That local-or-remote decision happens constantly. It is one reason a wrong subnet mask creates strange symptoms. The IP can look valid, the gateway can look valid, and the app can still be unreachable because the host classified a destination incorrectly.

## Subnets and CIDR
<!-- section-summary: CIDR notation uses the slash number to show how many address bits belong to the network prefix. -->

**CIDR**, short for Classless Inter-Domain Routing, is the slash notation used to describe network ranges. A CIDR block like `10.0.0.0/16` means "all addresses whose first 16 bits match `10.0`." A block like `10.0.32.0/20` is smaller because the first 20 bits are fixed.

The slash number is called the **prefix length**. A smaller prefix gives a larger network. A larger prefix gives a smaller network.

| CIDR | Total IPv4 addresses | Typical use |
| --- | ---: | --- |
| `/32` | 1 | One exact host address |
| `/28` | 16 | Small cloud subnet, minimum-sized AWS subnet |
| `/24` | 256 | Home network or small server subnet |
| `/20` | 4,096 | Common app-tier or private cloud subnet |
| `/16` | 65,536 | Common VPC-level allocation |
| `/8` | 16,777,216 | Large private address pool |

The math is direct. IPv4 has 32 bits. A `/20` fixes 20 bits and leaves 12 host bits. `2^12` gives 4,096 total addresses. In classic IPv4 subnetting, two are reserved for network and broadcast. In AWS VPC subnets, AWS reserves five addresses in every subnet, so a `/20` has `4,096 - 5 = 4,091` usable addresses for resources.

You can check a CIDR block with Python's standard library:

```bash
$ python3 - <<'PY'
import ipaddress

net = ipaddress.ip_network("10.0.32.0/20")
print("network:", net.network_address)
print("broadcast:", net.broadcast_address)
print("total:", net.num_addresses)
print("first usable:", list(net.hosts())[0])
print("last usable:", list(net.hosts())[-1])
PY
network: 10.0.32.0
broadcast: 10.0.47.255
total: 4096
first usable: 10.0.32.1
last usable: 10.0.47.254
```

That output shows the range `10.0.32.0` through `10.0.47.255`. The next adjacent `/20` starts at `10.0.48.0`. Clean subnet plans use boundaries like this so blocks line up and do not overlap.

## Private and Public Address Ranges
<!-- section-summary: Private ranges are for internal networks, while public ranges can be routed across the internet. -->

An IP address can be **public** or **private**. A public IP can be routed across the internet. A private IP is reserved for internal networks and should stay behind routers, VPNs, VPCs, or NAT gateways.

RFC 1918 defines the main private IPv4 ranges:

| Range | Size | Where you see it |
| --- | ---: | --- |
| `10.0.0.0/8` | 16,777,216 addresses | Cloud VPCs, large companies, Kubernetes clusters |
| `172.16.0.0/12` | 1,048,576 addresses | Docker networks, private cloud networks |
| `192.168.0.0/16` | 65,536 addresses | Home routers and small office networks |

Private ranges let many organizations reuse the same internal addresses. Your laptop can be `192.168.1.42` at home while someone else's laptop also uses `192.168.1.42` in another house. Those addresses do not collide on the public internet because routers do not forward RFC 1918 ranges globally.

NAT, or Network Address Translation, often connects private networks to the internet. A private server might use `10.0.2.15` inside a VPC. When it calls a public API, a NAT gateway sends the request from a public IP and tracks the return traffic. The private address stays internal.

Other reserved ranges deserve attention:

| Range | Meaning | Why it matters |
| --- | --- | --- |
| `100.64.0.0/10` | Shared address space for carrier-grade NAT | Can collide with ISP or managed network usage |
| `169.254.0.0/16` | Link-local addressing | Cloud metadata services use `169.254.169.254` |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | Documentation ranges | Safe for examples, not real production config |

The production rule is important: networks that need to talk to each other need non-overlapping CIDR blocks. VPC peering, VPNs, transit gateways, and on-prem connections all depend on that. If two networks both claim `10.0.0.0/16`, routers cannot know which side owns `10.0.5.10`.

## Planning a VPC Subnet Layout
<!-- section-summary: A good VPC plan divides a large private CIDR into non-overlapping public and private subnets with room to grow. -->

Now connect this back to the request path. A user resolves `app.example.com` to the public address of a load balancer. Behind that load balancer, the app servers usually live on private IPs inside a VPC. The public request enters the cloud edge, then traffic moves through private subnets toward the app.

A common AWS layout starts with a `/16` VPC:

```
VPC: 10.0.0.0/16

Public subnet A:   10.0.0.0/20
Public subnet B:   10.0.16.0/20
Private subnet A:  10.0.32.0/20
Private subnet B:  10.0.48.0/20
```

Public subnets hold internet-facing load balancers or NAT gateways. Private subnets hold app servers, containers, databases, and internal services. The route tables differ. A public subnet has a route to an internet gateway. A private subnet usually routes outbound internet traffic through a NAT gateway and keeps inbound public traffic away from direct instance addresses.

A quick overlap check should live near infrastructure review:

```bash
$ python3 - <<'PY'
import ipaddress

subnets = [
    ipaddress.ip_network("10.0.0.0/20"),
    ipaddress.ip_network("10.0.16.0/20"),
    ipaddress.ip_network("10.0.32.0/20"),
    ipaddress.ip_network("10.0.48.0/20"),
]

for i, left in enumerate(subnets):
    for right in subnets[i + 1:]:
        if left.overlaps(right):
            print("OVERLAP", left, right)
else:
    print("checked", len(subnets), "subnets")
PY
checked 4 subnets
```

That script is small, but it catches a painful class of mistakes before Terraform, CloudFormation, or a cloud console accepts the plan.

Route tables complete the layout. A Linux host shows routes with `ip route`:

```bash
$ ip route
default via 10.0.32.1 dev eth0
10.0.32.0/20 dev eth0 proto kernel scope link src 10.0.32.14
```

The second line says `10.0.32.14` can reach any address in `10.0.32.0/20` directly on `eth0`. The default route sends everything else to gateway `10.0.32.1`. Cloud route tables express the same idea at VPC and subnet level.

## IPv6 in the Same Request Path
<!-- section-summary: IPv6 uses larger addresses and common /64 subnets, but the request path still needs DNS, routing, firewall, TLS, proxy, and app handling. -->

IPv6 addresses look different because they are 128 bits instead of 32. An IPv6 address might look like this:

```
2001:db8:10:20::25
```

The `::` shortens a run of zero groups. The documentation prefix `2001:db8::/32` appears in examples, similar to the IPv4 documentation ranges.

DNS uses AAAA records for IPv6:

```bash
$ dig +short app.example.com AAAA
2001:db8:10:20::25
```

The request path stays familiar. The browser receives an IPv6 address, the operating system checks a route, a firewall allows or denies traffic to port `443`, TLS protects the connection, and Nginx forwards to the app. The main difference is address planning. IPv6 subnets commonly use `/64`, which gives an enormous host space per subnet. Teams spend less time squeezing addresses and more time keeping route tables, firewall policy, and DNS records clear.

A Linux host can show IPv6 addresses and routes:

```bash
$ ip -6 addr show dev eth0
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
    inet6 2001:db8:10:20::14/64 scope global
    inet6 fe80::42:acff:fe11:2/64 scope link

$ ip -6 route get 2001:db8:10:20::25
2001:db8:10:20::25 from :: dev eth0 src 2001:db8:10:20::14 metric 256 pref medium
```

Many production environments run dual stack. That means they publish both A and AAAA records and allow clients to choose IPv4 or IPv6. A dual-stack service needs both address families tested because a broken IPv6 path can affect users even while IPv4 looks healthy from your own machine.

## Subnet Failure Modes
<!-- section-summary: Subnet incidents usually come from overlapping ranges, exhausted address pools, wrong masks, missing routes, or IPv4 and IPv6 policy drift. -->

Subnet problems often look like random application failures because the app never sees the request. A few patterns show up again and again.

**Overlapping CIDRs block network connections between environments.** Two VPCs both use `10.0.0.0/16`, and later the team wants VPC peering. The router cannot decide which side owns `10.0.12.34`, so the peering design fails. The real fix is renumbering one side or building an application-layer bridge that avoids direct routing. Renumbering is slow work, so planning non-overlap early is worth the time.

**Subnet exhaustion stops scaling.** A small app subnet starts as `/27`. It feels roomy on day one. Later, autoscaling, load balancer addresses, ENIs, Pods, or serverless VPC connectors consume the pool. New workloads fail with messages about insufficient IP addresses. Cloud subnets usually cannot be resized in place. Teams add a new subnet and migrate workloads, which is far more disruptive than choosing a larger block at the start.

**Wrong masks send traffic to the wrong place.** A host configured as `10.0.32.14/24` inside a real `10.0.32.0/20` subnet thinks `10.0.40.20` is remote, even though it is actually in the same `/20`. Traffic takes the gateway path instead of the local path. Depending on security rules and routes, that can create timeouts that only affect some destinations.

**Missing routes strand private services.** An app server in a private subnet might have no route to the NAT gateway, so package installs, external API calls, and certificate renewal fail. The inbound browser path can look healthy while outbound dependencies fail from inside the app.

**IPv4 and IPv6 policies drift apart.** The team opens IPv4 port `443` in a security group but forgets the IPv6 rule. Users whose browsers prefer IPv6 see timeouts, while IPv4-only checks pass.

A short triage sequence connects these symptoms to commands:

```bash
$ ip addr show dev eth0
$ ip route get 203.0.113.25
$ ip neigh show
$ ping -c 3 10.0.32.1
$ traceroute 203.0.113.25
```

These commands tell you the local address, the selected route, the local neighbor cache, gateway reachability, and hop-by-hop path. If those checks look good, the request path is ready for the next gate: firewall rules.

---

**References**

- [RFC 4632: Classless Inter-domain Routing](https://datatracker.ietf.org/doc/html/rfc4632) - CIDR architecture and address aggregation.
- [RFC 1918: Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918) - Defines the private IPv4 address ranges used in internal networks.
- [AWS VPC CIDR Blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html) - Official AWS guidance for VPC and subnet CIDR choices, including reserved addresses.
- [Python `ipaddress` Documentation](https://docs.python.org/3/library/ipaddress.html) - Standard library module for validating and calculating IP networks.
- [RFC 8200: Internet Protocol, Version 6](https://datatracker.ietf.org/doc/html/rfc8200) - Core IPv6 protocol specification.
