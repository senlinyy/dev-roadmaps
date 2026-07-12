---
title: "IP Addressing & Subnets"
description: "Read IPv4 and IPv6 addresses, calculate CIDR ranges, and plan cloud subnets that route cleanly without overlap."
overview: "Learn how IP addresses, subnet masks, CIDR blocks, private ranges, and route decisions move a request from a resolved DNS answer toward the right server."
tags: ["cidr", "ipv4", "subnetting", "vpc", "ipv6"]
order: 3
id: article-devops-foundation-networking-ip-subnets
---

## Table of Contents

1. [What IP Addresses, Subnets, and Routes Do](#what-ip-addresses-subnets-and-routes-do)
2. [What an IP Address Represents](#what-an-ip-address-represents)
3. [Subnets and CIDR](#subnets-and-cidr)
4. [Private and Public Address Ranges](#private-and-public-address-ranges)
5. [Planning a VPC Subnet Layout](#planning-a-vpc-subnet-layout)
6. [IPv6 for the Same Service](#ipv6-for-the-same-service)
7. [Subnet Failure Modes](#subnet-failure-modes)
8. [References](#references)

## What IP Addresses, Subnets, and Routes Do
<!-- section-summary: IP addresses identify packet endpoints, subnets group nearby addresses, and routes choose the next hop. -->

DNS gives the browser an address such as `203.0.113.25`. That answer is only the start of the trip. The laptop or server still has to decide where the first packet should leave, which source address it should use, and which gateway should receive it.

The browser does not choose the Wi-Fi adapter, Ethernet adapter, VPN tunnel, source address, or gateway. The operating system makes that decision before any firewall, TLS, Nginx, or app code sees the request.

The first piece is the **IP address**. The packet needs a destination address from DNS, and it also needs a source address so replies can come back. The source address usually comes from the network interface the operating system selects.

The second piece is the **subnet**. A subnet tells the machine which addresses are local neighbors. If the destination sits inside the local subnet, the machine can send directly on the local network. If the destination is outside that subnet, the machine sends the packet to a gateway.

The third piece is the **route**. A route tells the operating system where traffic should go next: directly on the local network, through a default gateway, over a VPN, or through a cloud VPC router. These three pieces answer the routing question that comes after DNS.

For `https://app.example.com/dashboard`, the name lookup might return this address:

```bash
dig +short app.example.com

# Example output:
# 203.0.113.25
```

The `dig` output gives the destination IP. It does not choose the source IP, gateway, network interface, or route. Those choices come from the machine's local addressing and routing state. When the browser asks the operating system to open a connection to `203.0.113.25` on port `443`, the system checks that state before any firewall, TLS, Nginx, or application code sees the traffic.

On a laptop or server, that decision can look like this:

```bash
ip route get 203.0.113.25

# Example output:
# 203.0.113.25 via 10.0.0.1 dev eth0 src 10.0.0.42 uid 1000
#     cache
```

The route output tells you:

- `via 10.0.0.1` is the gateway, or next hop.
- `dev eth0` is the network interface that will send the packet.
- `src 10.0.0.42` is the local source address the machine will put on the packet.
- The gateway might be a home router, a cloud VPC router, a corporate VPN gateway, or a Kubernetes node route.

That output is one of the most useful next-step clues in networking. If the source address is wrong, the reply may return to the wrong network. If the gateway is wrong, packets may leave through a VPN or private route that cannot reach the destination. If the interface is wrong, the host may be using Wi-Fi, Ethernet, or a tunnel in a way the operator did not expect.

IP addressing and subnetting are the rules behind that decision. If those rules are wrong, the browser never reaches the firewall, TLS, Nginx, or app. The request can fail before the server knows anything happened, which is why route output is often the first useful clue after DNS.

## What an IP Address Represents
<!-- section-summary: An IP address identifies a host location on a network, while the subnet mask tells which part is the network and which part is the host. -->

A machine can have more than one network door. A laptop may have Wi-Fi, Ethernet, a VPN tunnel, and loopback. A cloud server may have a primary network interface, a private interface, and a container bridge. Each of those doors can have its own address, and each address can send traffic from a different place in the network.

An **IP address** belongs to a network interface, not only to the machine as a whole. That detail explains why a server can show several addresses at once. One address may receive private app traffic, another may handle admin traffic, and `127.0.0.1` stays inside the host for local processes.

IPv4 addresses look like `10.0.0.42` or `203.0.113.25`. They contain four numbers from `0` to `255`. Each number is an **octet**, which means 8 bits. Four octets give IPv4 a 32-bit address space.

For routing, an IP address gets split into two useful parts. The **network portion** identifies the local network. The **host portion** identifies one address inside that network. A subnet mask tells the machine where that split lives, so the host can decide whether another address is nearby or somewhere beyond a gateway.

For a common home or small-office subnet:

```
Address:      192.168.1.42
Subnet:       192.168.1.0/24
Network part: 192.168.1
Host part:              42
```

The `/24` means the first 24 bits are the network portion. In dotted form, that mask is `255.255.255.0`. Everything from `192.168.1.1` through `192.168.1.254` lives in that subnet. The first address, `192.168.1.0`, represents the network. The last address, `192.168.1.255`, is the broadcast address in traditional IPv4 subnetting.

This matters to routing. If your machine is `192.168.1.42/24` and it wants to reach `192.168.1.50`, the destination is on the same subnet. The machine can use ARP to find the destination MAC address and send a local frame. If it wants to reach `203.0.113.25`, the destination is outside the subnet. The packet goes to the default gateway.

Under the hood, the host performs a bit comparison. It applies the subnet mask to its own address and to the destination address. If the network portions match, the destination is local. If they differ, the destination needs a route through a gateway. The host performs this decision before TCP, TLS, Nginx, or the app sees anything.

The local-or-remote decision happens constantly. A wrong subnet mask can create strange symptoms: the IP can look valid, the gateway can look valid, and the app can still be unreachable because the host classified a destination incorrectly.

## Subnets and CIDR
<!-- section-summary: CIDR notation uses the slash number to show how many address bits belong to the network prefix. -->

Cloud networks and office networks rarely route one address at a time. A route table needs to say things like "send this whole group of app-server addresses to the private subnet" or "send every unknown public address to the internet gateway." Subnets give those groups a clear range.

**CIDR**, short for Classless Inter-Domain Routing, is the slash notation used to describe those ranges. A CIDR block like `10.0.0.0/16` covers every address whose first 16 bits match `10.0`. A block like `10.0.32.0/20` is smaller because the first 20 bits are fixed.

The slash number is the **prefix length**. A smaller prefix gives a larger network. A larger prefix gives a smaller network. The prefix exists so routers can store destinations as ranges instead of one row for every single host address.

| CIDR | Total IPv4 addresses | Typical use |
| --- | ---: | --- |
| `/32` | 1 | One exact host address |
| `/28` | 16 | Small AWS subnet where the service using it does not require a larger block |
| `/24` | 256 | Home network or small server subnet |
| `/20` | 4,096 | Common app-tier or private cloud subnet |
| `/16` | 65,536 | Common VPC-level allocation |
| `/8` | 16,777,216 | Large private address pool |

The math is direct. IPv4 has 32 bits. A `/20` fixes 20 bits and leaves 12 host bits. `2^12` gives 4,096 total addresses. In classic IPv4 subnetting, two are reserved for network and broadcast. In AWS VPC subnets, AWS reserves five addresses in every subnet, so a `/20` has `4,096 - 5 = 4,091` usable addresses for resources.

CIDR boundaries matter because prefixes are binary ranges. `10.0.32.0/20` is valid because the third octet starts on a 16-address boundary: `32`, `48`, `64`, and so on. A plan that uses clean boundaries is easier for humans to review and easier for route tables to summarize.

You can check a CIDR block with Python's standard library:

```bash
python3 - <<'PY'
import ipaddress

net = ipaddress.ip_network("10.0.32.0/20")
print("network:", net.network_address)
print("broadcast:", net.broadcast_address)
print("total:", net.num_addresses)
print("first usable:", list(net.hosts())[0])
print("last usable:", list(net.hosts())[-1])
PY

# Example output:
# network: 10.0.32.0
# broadcast: 10.0.47.255
# total: 4096
# first usable: 10.0.32.1
# last usable: 10.0.47.254
```

The output shows the range `10.0.32.0` through `10.0.47.255`. The next adjacent `/20` starts at `10.0.48.0`. Clean subnet plans use boundaries like this so blocks line up and do not overlap.

The fields map to real design choices:

- `network` is the first address in the block.
- `broadcast` is the last address in traditional IPv4 subnetting.
- `total` tells you how much address room the subnet has before provider reservations.
- `first usable` and `last usable` show the host range for ordinary IPv4 networks.

The next design decision is size. A subnet for a few bastion hosts can be small. A subnet for autoscaling app workers, Kubernetes nodes, load balancer addresses, or serverless VPC connectors needs room for growth and provider reservations. Address room is much easier to plan while the network is still empty than after workloads depend on the subnet.

![CIDR boundary infographic showing an IP address split into network bits and host bits with a slash prefix](/content-assets/articles/article-devops-foundation-networking-ip-subnets/cidr-boundary.png)

_The image makes the slash prefix visible by separating the network part from the host part of an address._

## Private and Public Address Ranges
<!-- section-summary: Private ranges are for internal networks, while public ranges can be routed across the internet. -->

Two homes can both have a laptop at `192.168.1.42`. They do not collide because that address is private. It only has meaning inside each home network. The public internet never has to decide which house owns `192.168.1.42`, because that address should stay inside local networks.

A **public IP address** can be routed across the internet. A **private IP address** is reserved for internal networks and should stay behind routers, VPNs, VPCs, or NAT gateways.

RFC 1918 defines the main private IPv4 ranges:

| Range | Size | Where you see it |
| --- | ---: | --- |
| `10.0.0.0/8` | 16,777,216 addresses | Cloud VPCs, large companies, Kubernetes clusters |
| `172.16.0.0/12` | 1,048,576 addresses | Docker networks, private cloud networks |
| `192.168.0.0/16` | 65,536 addresses | Home routers and small office networks |

Private ranges let many organizations reuse the same internal addresses. Your laptop can be `192.168.1.42` at home while someone else's laptop also uses `192.168.1.42` in another house. Those addresses do not collide on the public internet because routers do not forward RFC 1918 ranges globally.

NAT, or Network Address Translation, often connects private networks to the internet. NAT exists because private addresses are reused in many places and cannot be routed on the public internet. A private server might use `10.0.2.15` inside a VPC. When it calls a public API, a NAT gateway sends the request from a public IP and tracks the return traffic. The private address stays internal.

The packet changes at the NAT boundary. Inside the VPC, the source might be `10.0.2.15:53142`. On the internet side, the source might be `198.51.100.20:62010`. The NAT device remembers that mapping so the response can return to the right private server. If a private instance can reach other private hosts but cannot download packages or renew certificates, the NAT route and NAT gateway health are practical checks.

Other reserved ranges deserve attention:

| Range | Meaning | Why it matters |
| --- | --- | --- |
| `100.64.0.0/10` | Shared address space for carrier-grade NAT | Can collide with ISP or managed network usage |
| `169.254.0.0/16` | Link-local addressing | Cloud metadata services use `169.254.169.254` |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | Documentation ranges | Safe for examples, not real production config |

The production rule is important: networks that need to talk to each other need non-overlapping CIDR blocks. VPC peering, VPNs, transit gateways, and on-prem connections all depend on that. If two networks both claim `10.0.0.0/16`, routers cannot know which side owns `10.0.5.10`.

## Planning a VPC Subnet Layout
<!-- section-summary: A good VPC plan divides a large private CIDR into non-overlapping public and private subnets with room to grow. -->

A real cloud network usually uses both public and private addresses. A user resolves `app.example.com` to the public address of a load balancer. Behind that load balancer, the app servers usually live on private IPs inside a VPC. Public traffic enters the cloud edge, then internal traffic moves through private subnets toward the app.

That layout gives each subnet a job. Public subnets hold resources that need an internet-facing route, such as load balancer nodes or NAT gateways. Private subnets hold app servers, containers, workers, and databases that should receive traffic through controlled internal paths.

Service requirements can set a larger minimum than the VPC platform itself. An AWS Application Load Balancer needs one subnet in each enabled Availability Zone, and each of those subnets must use at least a `/27` block with at least eight free IP addresses. A `/28` is a valid AWS subnet size, but it is too small for an ALB subnet. Those free addresses let AWS replace and scale load balancer nodes without exhausting the subnet.

A common AWS layout starts with a `/16` VPC:

```
VPC: 10.0.0.0/16

Public subnet A:   10.0.0.0/20
Public subnet B:   10.0.16.0/20
Private subnet A:  10.0.32.0/20
Private subnet B:  10.0.48.0/20
```

Each line reserves a separate address range for a different job:

- `VPC: 10.0.0.0/16` gives the cloud network `65,536` possible IPv4 addresses before provider reservations. The `/16` is large enough to split into smaller subnets across zones and environments.
- `Public subnet A: 10.0.0.0/20` reserves the first public subnet, often in one availability zone. Internet-facing load balancer nodes or NAT gateways can live here.
- `Public subnet B: 10.0.16.0/20` reserves the second public subnet in another zone. The gap from `10.0.0.0/20` to `10.0.16.0/20` keeps the ranges separate.
- `Private subnet A: 10.0.32.0/20` reserves private addresses for app servers, containers, workers, or internal services in one zone.
- `Private subnet B: 10.0.48.0/20` gives the private tier a second zone, so one zone failure does not remove every private app address.

The address plan is only half the design. The route tables make the subnets act public or private. A public subnet has a route to an internet gateway. A private subnet usually routes outbound internet traffic through a NAT gateway and keeps inbound public traffic away from direct instance addresses.

The route difference is what makes "public" and "private" meaningful:

- Public subnet route tables usually include a local VPC route plus `0.0.0.0/0 -> internet gateway`, so resources with public entry points can receive and send internet traffic.
- Private subnet route tables usually include a local VPC route plus `0.0.0.0/0 -> NAT gateway`, so app servers can download packages or call external APIs without accepting direct inbound internet connections.
- Database subnets often skip any internet default route. They use only local VPC routes, private endpoints, or controlled internal routes.

Route tables choose the most specific matching route. This is called **longest prefix match**. A route for `10.0.32.0/20` is more specific than a route for `10.0.0.0/16`, and both are more specific than the default route `0.0.0.0/0`. The host or VPC router picks the route with the longest matching prefix, then sends the packet to that route's target.

A quick overlap check should live near infrastructure review:

```bash
python3 - <<'PY'
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

# Example output:
# checked 4 subnets
```

The output means the four CIDR blocks do not overlap each other. If the script printed `OVERLAP`, the two listed ranges would compete for the same addresses, and routing between those networks would be unsafe.

Route tables complete the layout. A Linux host shows its local view with `ip route`:

```bash
ip route

# Example output:
# default via 10.0.32.1 dev eth0
# 10.0.32.0/20 dev eth0 proto kernel scope link src 10.0.32.14
```

The route table has two important ideas:

- `10.0.32.0/20 dev eth0` says `10.0.32.14` can reach addresses inside that subnet directly on `eth0`.
- `default via 10.0.32.1` sends everything else to gateway `10.0.32.1`.

Cloud route tables express the same idea at VPC and subnet level. If a private subnet misses the default route to a NAT gateway, app servers may still receive load balancer traffic while outbound package installs, webhooks, and certificate renewal fail. If a public subnet misses the route to an internet gateway, public IP addresses alone will not make the subnet reachable.

![VPC subnet plan infographic showing a larger VPC CIDR split into public and private subnets across two zones](/content-assets/articles/article-devops-foundation-networking-ip-subnets/vpc-subnet-plan.png)

_The image shows why subnet planning reserves separate address ranges for public entry points and private workloads._

## IPv6 for the Same Service
<!-- section-summary: IPv6 uses larger addresses and common /64 subnets, while the service still needs DNS, routing, firewall, TLS, proxy, and app handling. -->

Many services need to work for clients on both IPv4 and IPv6 networks. The service name can stay the same, but DNS, firewall rules, route tables, certificates, and proxy listeners may need entries for both address families. The familiar idea still applies: an address identifies an endpoint, and a prefix describes a network range.

IPv6 addresses look different because they are 128 bits instead of 32. IPv6 exists because IPv4 address space is small for the modern internet. It also gives networks enough room to assign large subnets without tight address conservation. An IPv6 address might look like this:

```
2001:db8:10:20::25
```

The `::` shortens a run of zero groups. The documentation prefix `2001:db8::/32` appears in examples, similar to the IPv4 documentation ranges.

DNS uses AAAA records for IPv6:

```bash
dig +short app.example.com AAAA

# Example output:
# 2001:db8:10:20::25
```

That answer is the IPv6 version of an A record. If a browser receives both A and AAAA answers, it may try IPv6 first depending on the client and network.

The service flow stays familiar. The browser receives an IPv6 address, the operating system checks a route, a firewall allows or denies traffic to port `443`, TLS protects the connection, and Nginx forwards to the app. The main difference is address planning. IPv6 subnets commonly use `/64`, which gives an enormous host space per subnet. Teams spend less time squeezing addresses and more time keeping route tables, firewall policy, and DNS records clear.

IPv6 has no broadcast address in the IPv4 sense. Neighbor Discovery handles local neighbor discovery with ICMPv6. That means IPv6 firewall policy must allow the required ICMPv6 behavior, or local network discovery and path MTU discovery can break in confusing ways.

A Linux host can show IPv6 addresses and routes:

```bash
ip -6 addr show dev eth0

# Example output:
# 2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
#     inet6 2001:db8:10:20::14/64 scope global
#     inet6 fe80::42:acff:fe11:2/64 scope link
```

Now ask how the host would reach one IPv6 destination:

```bash
ip -6 route get 2001:db8:10:20::25

# Example output:
# 2001:db8:10:20::25 from :: dev eth0 src 2001:db8:10:20::14 metric 256 pref medium
```

The address output shows `2001:db8:10:20::14/64` as the host's global IPv6 address. The route output says the host would send traffic for `2001:db8:10:20::25` through `eth0` and use `2001:db8:10:20::14` as the source address.

Many production environments run dual stack. That means they publish both A and AAAA records and allow clients to choose IPv4 or IPv6. A dual-stack service needs both address families tested because a broken IPv6 path can affect users even while IPv4 looks healthy from your own machine. When you publish an AAAA record, also verify IPv6 routes, firewall rules, load balancer listeners, TLS, and application logs from an IPv6-capable client.

## Subnet Failure Modes
<!-- section-summary: Subnet incidents usually come from overlapping ranges, exhausted address pools, wrong masks, missing routes, or IPv4 and IPv6 policy drift. -->

Subnet problems can make an app look flaky even while the app process is fine. A request may leave through the wrong gateway, a new instance may fail to get an address, or a private server may lose outbound internet access. These problems sit underneath HTTP, so operators check them before blaming the web layer.

**Overlapping CIDRs block network connections between environments.** Two VPCs both use `10.0.0.0/16`, and later the team wants VPC peering. The router cannot decide which side owns `10.0.12.34`, so the peering design fails. The real fix is renumbering one side or building an application-layer bridge that avoids direct routing. Renumbering is slow work, so planning non-overlap early is worth the time.

**Subnet exhaustion stops scaling.** A small app subnet starts as `/27`. It has enough room on day one. Later, autoscaling, load balancer addresses, ENIs, Pods, or serverless VPC connectors consume the pool. New workloads fail with messages about insufficient IP addresses. Cloud subnets usually cannot be resized in place. Teams add a new subnet and migrate workloads, which is far more disruptive than choosing a larger block at the start.

**Wrong masks send traffic to the wrong place.** A host configured as `10.0.32.14/24` inside a real `10.0.32.0/20` subnet thinks `10.0.40.20` is remote, even though it is actually in the same `/20`. Traffic takes the gateway path instead of the local path. Depending on security rules and routes, that can create timeouts that only affect some destinations.

**Missing routes strand private services.** An app server in a private subnet might have no route to the NAT gateway, so package installs, external API calls, and certificate renewal fail. The inbound browser path can look healthy while outbound dependencies fail from inside the app.

**IPv4 and IPv6 policies drift apart.** The team opens IPv4 port `443` in a security group but forgets the IPv6 rule. Users whose browsers prefer IPv6 see timeouts, while IPv4-only checks pass.

A short triage sequence connects these symptoms to commands:

```bash
ip addr show dev eth0

# Example output:
# 2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
#     inet 10.0.32.14/20 brd 10.0.47.255 scope global eth0
```

The `inet` line tells you the host address is `10.0.32.14` and the prefix is `/20`. That means the local subnet runs from `10.0.32.0` through `10.0.47.255`.

```bash
ip route get 203.0.113.25

# Example output:
# 203.0.113.25 via 10.0.32.1 dev eth0 src 10.0.32.14 uid 1000
#     cache
```

This says the host will send traffic for `203.0.113.25` to gateway `10.0.32.1` through `eth0`. If that gateway is missing or unexpected, the problem is still in local routing.

```bash
ip neigh show

# Example output:
# 10.0.32.1 dev eth0 lladdr 02:11:22:33:44:55 REACHABLE
```

This means the host has a neighbor-table entry for the gateway. If the entry is missing, stale, or failed, same-link discovery needs attention before higher layers.

```bash
ping -c 3 10.0.32.1
traceroute 203.0.113.25
```

These commands tell you the local address, the selected route, the local neighbor cache, gateway reachability, and hop-by-hop path:

- `ip addr show dev eth0` confirms the host's assigned address and prefix length.
- `ip route get 203.0.113.25` shows the selected route for the destination.
- `ip neigh show` shows the local ARP or neighbor cache for same-link peers.
- `ping -c 3 10.0.32.1` checks whether the gateway responds.
- `traceroute 203.0.113.25` shows where packets stop across multiple hops.

If those checks look good, traffic is ready for the next gate: firewall rules.

![IP subnets summary infographic showing addresses, CIDR, private ranges, VPC planning, IPv6, routes, and failure modes](/content-assets/articles/article-devops-foundation-networking-ip-subnets/ip-subnets-summary.png)

_The summary image collects the subnet and routing checks used when traffic lands in the wrong place._

## References

- [RFC 4632: Classless Inter-domain Routing](https://datatracker.ietf.org/doc/html/rfc4632) - CIDR architecture and address aggregation.
- [RFC 1918: Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918) - Defines the private IPv4 address ranges used in internal networks.
- [AWS VPC CIDR Blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html) - Official AWS guidance for VPC and subnet CIDR choices, including reserved addresses.
- [Application Load Balancer subnets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html#subnets-load-balancer) - Documents the `/27` minimum and eight-free-address capacity requirement for each enabled Availability Zone.
- [Python `ipaddress` Documentation](https://docs.python.org/3/library/ipaddress.html) - Standard library module for validating and calculating IP networks.
- [RFC 8200: Internet Protocol, Version 6](https://datatracker.ietf.org/doc/html/rfc8200) - Core IPv6 protocol specification.
