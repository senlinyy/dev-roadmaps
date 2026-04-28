---
title: "IP Addressing & Subnets"
description: "Calculate subnets with CIDR notation, understand private vs public ranges, and plan network address spaces for cloud VPCs."
overview: "Learn how IP addresses and subnets work so you can confidently design VPC layouts, avoid overlapping ranges, and understand every CIDR block you encounter in cloud infrastructure."
tags: ["cidr", "ipv4", "subnetting", "vpc", "ipv6"]
order: 2
id: article-devops-foundation-networking-ip-subnets
---

## Table of Contents

1. [The Problem: Why Addresses Need Structure](#the-problem-why-addresses-need-structure)
2. [IPv4 Addresses: The Parts You Need to Know](#ipv4-addresses-the-parts-you-need-to-know)
3. [CIDR Notation: Slicing the Address Space](#cidr-notation-slicing-the-address-space)
4. [Private vs Public Ranges](#private-vs-public-ranges)
5. [Subnetting a VPC in Practice](#subnetting-a-vpc-in-practice)
6. [IPv6: What Changes](#ipv6-what-changes)
7. [When Subnetting Goes Wrong](#when-subnetting-goes-wrong)

## The Problem: Why Addresses Need Structure

You just created an AWS VPC, and the console asks you for a "CIDR block." The placeholder says something like `10.0.0.0/16`. You have no idea what that means, so you accept the default, click through, and move on. A week later you try to peer that VPC with another one your team set up, and AWS refuses because the address ranges overlap. Now you have to tear down and rebuild.

This is the kind of problem subnetting solves. Every device on a network needs an address, and those addresses need to be organized so that traffic can be routed efficiently and networks can be segmented for security. Think of it like postal addresses: street names and house numbers exist so a letter does not have to visit every house in the country to find the right one. Without structure, routing would be chaos.

If you have used npm, you already understand naming and namespaces. An npm package has a unique name so the registry can find it. An IP address works the same way: it is a unique identifier for a device on a network. But addresses go further. They encode *where* a device lives on the network, not just *who* it is. A subnet is the neighborhood; the address is the house. Learning to read and plan these neighborhoods is one of the first skills you need when working with cloud infrastructure.

## IPv4 Addresses: The Parts You Need to Know

You have seen IPv4 addresses everywhere already, even if you never thought of them as a topic. Your home wifi probably handed your laptop something like `192.168.1.42`. The EC2 instance you launched in AWS got an internal address like `10.0.1.137`. A Docker container you started yesterday landed on `172.17.0.2`. They all share the exact same shape: four numbers from 0 to 255, separated by dots. Each of those four numbers is called an octet (because under the hood it is 8 bits), and the whole address is really just a 32-bit binary number with an invisible line drawn somewhere in the middle. Everything to the left of that line identifies the network (think "the neighborhood"), and everything to the right identifies one specific device on that network, called a "host".

Why 32 bits? When IPv4 was finalized in 1981, the entire ARPANET had a few hundred hosts, and 4.3 billion addresses looked absurdly generous. Nobody planned for every phone, fridge, and EC2 instance on the planet to want one. By the early 1990s the math had stopped working, and the IETF spent the rest of the decade building escape hatches (CIDR, NAT, RFC 1918) before IPv6 was finally usable. Most of the awkwardness in this article exists because we are still living with that 1981 sizing decision.

Where exactly is that line drawn? That is what a subnet mask tells you. The mask is another address-shaped number whose only job is to mark which bits belong to the network and which belong to the host. The classic mask `255.255.255.0` says "the first three numbers are the network, the last number is the host". If you write it out in binary the pattern becomes obvious:

```text
11111111.11111111.11111111.00000000
^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^
   network (24 bits)      host (8 bits)
```

The 1s mark network bits, the 0s mark host bits, and the spot where 1s stop and 0s begin is the boundary. You do not need to memorize binary conversions to get this. The mask is just a way of saying "this many bits on the left are fixed, the rest are yours".

With 8 host bits you get 256 possible addresses (2^8 = 256), but two of them are off limits. The very first address (`.0`) is the network address itself, like the name of the street rather than any one house on it. The very last address (`.255`) is the broadcast address, which you use to shout one message to every house on the street at once. That leaves 254 actual usable addresses for laptops, servers, containers, and so on. This is exactly why a home wifi network like `192.168.1.0/24` holds 254 devices, not 256.

You might still see references to "classful" networking with Class A, B, and C. That system was replaced in 1993 because it wasted enormous chunks of address space. The original scheme only let you split the 32 bits at fixed boundaries: a Class A took the first 8 bits as the network (16 million hosts), a Class B took 16 (65 thousand hosts), a Class C took 24 (254 hosts). If your organization needed 500 addresses, a Class C was too small and a Class B handed you 65,000 you would never use. There was no way to split a Class B across two organizations either. Every "right size" allocation had to round up to the next power of 256, and the IANA was burning through the address pool fast as a result. CIDR fixed this by letting the boundary land on any bit, so you can ask for exactly what you need. The classful terms still show up in older docs and certification exams, but real networks today use CIDR exclusively, which is the next section.

## CIDR Notation: Slicing the Address Space

Most people meet `192.168.1.0/24` for the first time on their home router admin page and squint at that slash. The slash number is shorthand for "how much of the address is the neighborhood, and how much is the house number". A `/24` means the first three numbers (`192.168.1`) identify the network, like a street name, and the last number (`.0` through `.255`) is the house on that street. So `/24` gives you 256 houses on one street.

A `/16` keeps only the first two numbers fixed, which is a much bigger network: 65,536 houses, like an entire small town. AWS VPCs default to `/16` for exactly this reason: room to grow without renumbering later. Docker's default bridge network uses `/16` (`172.17.0.0/16`) so you can spin up tens of thousands of containers on one host without running out of addresses. Kubernetes pod CIDRs are typically `/16` or larger because every pod on every node needs its own address, and a busy cluster can have thousands of pods.

Now you know what the notation hides. The official name is CIDR (Classless Inter-Domain Routing), the number after the slash is called the prefix length, and you read it as "how many bits from the left are locked to the network part". Bigger prefix means more bits locked, which means fewer addresses left for hosts. Every single bit you add to the prefix cuts the address space in half. Going from `/16` to `/17` drops you from 65,536 houses to 32,768. Going from `/24` to `/25` drops you from 256 to 128.

Here is the reference table you will reach for constantly:

| CIDR | Subnet Mask | Total Addresses | Usable Hosts |
|------|-------------|-----------------|--------------|
| `/32` | `255.255.255.255` | 1 | 1 |
| `/28` | `255.255.255.240` | 16 | 14 |
| `/24` | `255.255.255.0` | 256 | 254 |
| `/20` | `255.255.240.0` | 4,096 | 4,094 |
| `/16` | `255.255.0.0` | 65,536 | 65,534 |
| `/8` | `255.0.0.0` | 16,777,216 | 16,777,214 |

A quick trick for the math: take 32, subtract the prefix length, and raise 2 to that power. So `/20` gives you `2^(32-20) = 2^12 = 4,096` total addresses. Subtract 2 for the network and broadcast addresses, and you get 4,094 usable hosts. AWS actually reserves 5 addresses per subnet (network, broadcast, plus three for the VPC router, DNS, and a future-use address), so the real usable count in an AWS subnet is `2^(32 - prefix) - 5`.

You can verify subnet boundaries with `ipcalc` if it is installed on your system:

```bash
$ ipcalc 10.0.0.0/16
Address:   10.0.0.0             00001010.00000000. 00000000.00000000
Netmask:   255.255.0.0 = 16     11111111.11111111. 00000000.00000000
Wildcard:  0.0.255.255          00000000.00000000. 11111111.11111111
=>
Network:   10.0.0.0/16          00001010.00000000. 00000000.00000000
HostMin:   10.0.0.1             00001010.00000000. 00000000.00000001
HostMax:   10.0.255.254         00001010.00000000. 11111111.11111110
Broadcast: 10.0.255.255         00001010.00000000. 11111111.11111111
Hosts/Net: 65534                 Class A, Private Internet
```

The binary column makes the network/host boundary visible. The dotted line in the binary output shows exactly where the `/16` prefix ends and the host bits begin.

## Private vs Public Ranges

Not all IP addresses are created equal. Some are routable on the public internet, and some are explicitly reserved for private use. If you have ever connected to a home Wi-Fi network and checked your IP, it probably started with `192.168`. That is a private address. Your router handles the translation between your private address and the single public IP your ISP assigned you, using a process called NAT (Network Address Translation).

Private ranges exist for two reasons that compound each other. First, IPv4 ran out of public addresses, so ISPs could not give every device on Earth a globally unique one; reserving a few large blocks for "internal use, never routed on the public internet" let billions of home devices share a handful of public IPs through NAT. Second, those reserved blocks needed to be the same everywhere so that a router on the public internet could refuse to forward them on sight, which prevents your home `192.168.1.42` from ever colliding with someone else's `192.168.1.42` across the wire. The blocks were not designed for cloud VPCs, but they turned out to be exactly what AWS, GCP, and Azure needed: a pool of addresses you could carve up freely without coordinating with anyone.

RFC 1918 defines three private address blocks. Every home network, corporate LAN, cloud VPC, and Docker container network uses addresses from one of these ranges.

**`10.0.0.0/8`** gives you 16.7 million addresses. This is the go-to range for large cloud deployments. AWS, GCP, and Azure all default to this range when you create a VPC. If you are designing a multi-VPC architecture, start here because you have plenty of room to carve out non-overlapping subnets.

**`172.16.0.0/12`** (covering `172.16.0.0` through `172.31.255.255`) provides about 1 million addresses. Docker uses `172.17.0.0/16` by default for its bridge network. If you have ever run `docker inspect` on a container and wondered where `172.17.0.2` came from, now you know.

**`192.168.0.0/16`** provides 65,536 addresses. Home routers almost universally use `192.168.0.0/24` or `192.168.1.0/24`. This range is fine for small setups but too small for serious cloud architecture.

A few other reserved ranges trip up audits because they look like normal IPs but cannot be used as private VPC space:

- **`100.64.0.0/10`** is RFC 6598 "shared address space", carved out for carrier-grade NAT (CGNAT). ISPs use it between their NAT gateways and customer routers. AWS also uses it for some EKS pod networks. Do not allocate it to your own VPC; you will collide with the carrier or the cluster.
- **`169.254.0.0/16`** is RFC 3927 link-local. Hosts auto-assign from it when DHCP fails, and cloud providers reserve specific addresses inside it for instance metadata (`169.254.169.254` is the AWS, GCP, and Azure metadata endpoint). Never route or allocate from this range.
- **`192.0.2.0/24`**, **`198.51.100.0/24`**, and **`203.0.113.0/24`** are RFC 5737 documentation ranges (TEST-NET-1/2/3). They exist for examples and tutorials and must never appear in real config; if you see them in a production route table, someone copy-pasted from a docs page without changing the values.

The critical rule with private ranges: when two networks need to talk to each other (VPC peering, VPN tunnels, on-premises to cloud connections), their CIDR blocks must not overlap. If VPC-A uses `10.0.0.0/16` and VPC-B also uses `10.0.0.0/16`, peering is impossible because the router cannot tell which network owns a given address. Plan your allocations before you build. Changing a VPC's CIDR block after deployment ranges from painful to impossible depending on your cloud provider.

> Plan your CIDR allocations on paper before you create the first VPC. Renumbering later is the worst kind of infrastructure work.

## Subnetting a VPC in Practice

Here is a real scenario. You are setting up an AWS VPC for a web application. You need public subnets (for load balancers that face the internet) and private subnets (for application servers and databases that should not be directly reachable). AWS also requires subnets in at least two availability zones for high availability.

Start with a `/16` VPC, which gives you 65,536 addresses. Then carve it into four `/20` subnets, each with 4,094 usable hosts:

```text
VPC:                10.0.0.0/16

Public subnet AZ-a:   10.0.0.0/20   (4,094 hosts)
Public subnet AZ-b:   10.0.16.0/20  (4,094 hosts)
Private subnet AZ-a:  10.0.32.0/20  (4,094 hosts)
Private subnet AZ-b:  10.0.48.0/20  (4,094 hosts)
```

You can verify these subnets do not overlap using Python's built-in `ipaddress` module. This is worth doing every time you plan a VPC layout, because a mistake here is hard to fix later and easy to catch early:

```bash
$ python3 -c "
import ipaddress
subnets = ['10.0.0.0/20', '10.0.16.0/20', '10.0.32.0/20', '10.0.48.0/20']
for cidr in subnets:
    net = ipaddress.ip_network(cidr)
    print(f'{cidr}: {net.network_address} - {net.broadcast_address} ({net.num_addresses} addresses)')
"
```

```text
10.0.0.0/20: 10.0.0.0 - 10.0.15.255 (4096 addresses)
10.0.16.0/20: 10.0.16.0 - 10.0.31.255 (4096 addresses)
10.0.32.0/20: 10.0.32.0 - 10.0.47.255 (4096 addresses)
10.0.48.0/20: 10.0.48.0 - 10.0.63.255 (4096 addresses)
```

Notice how each subnet's broadcast address is one less than the next subnet's network address. `10.0.15.255` is followed by `10.0.16.0`. No gaps, no overlaps. That is a clean allocation.

You still have the range from `10.0.64.0` through `10.0.255.255` completely unallocated, giving you room for future subnets without touching anything that already exists. This is intentional. Good subnet planning always leaves room for growth. If you carve your `/16` into the maximum number of `/20` subnets from day one, you have no room to add a new availability zone, a separate subnet for a Redis cluster, or an isolated management network.

```python
import ipaddress

vpc = ipaddress.ip_network('10.0.0.0/16')
allocated = [ipaddress.ip_network(s) for s in [
    '10.0.0.0/20', '10.0.16.0/20', '10.0.32.0/20', '10.0.48.0/20'
]]

used = sum(s.num_addresses for s in allocated)
print(f"VPC total: {vpc.num_addresses}")
print(f"Allocated: {used}")
print(f"Remaining: {vpc.num_addresses - used}")
```

```text
VPC total: 65536
Allocated: 16384
Remaining: 49152
```

That is 75% of the address space still available for future needs.

Two practical constraints shape how small or large a subnet you should pick. AWS rejects anything smaller than `/28` (16 addresses, 11 usable after the 5 reserved), so a `/29` or `/30` you might draw on paper for a tiny tier is illegal in a VPC. At the other end, route tables on routers and cloud gateways have entry limits (AWS VPC route tables default to 50 routes), so carving a single `/16` into hundreds of tiny `/24`s is usually worse than carving it into a handful of `/20`s and letting hosts inside each subnet find each other locally. When you do hit a route-table limit, the answer is **route summarization** (also called supernetting): advertising one short prefix that covers many adjacent subnets, so the upstream router needs one entry instead of many. This is why per-region `/16`s aggregate cleanly into a `/12` at the inter-region boundary, and why allocating subnets in adjacent, power-of-two-aligned blocks pays off later.

## IPv6: What Changes

The first time you see an IPv6 address, your eyes glaze over. Where IPv4 gave you four short numbers like `192.168.1.10`, IPv6 throws something like `2001:0db8:85a3:0000:0000:8a2e:0370:7334` at you. That is eight groups of four hexadecimal digits separated by colons, and yes, it is intentionally that long. The reason is space. IPv4 is only 32 bits and the global pool of public addresses ran out years ago. IPv6 is 128 bits and effectively never will. To keep these monsters readable, two shorthand rules apply: you can drop leading zeros inside each group, and you can collapse one run of consecutive all-zero groups into `::`. The address above shrinks to `2001:db8:85a3::8a2e:370:7334`, which is still a mouthful but at least fits in a config file without scrolling sideways.

The address space is enormous: 3.4 x 10^38 addresses. To put that in perspective, you could assign a unique IPv6 address to every grain of sand on Earth and still not make a dent. This abundance changes the game in a practical way: NAT mostly disappears. Every device can get a globally unique, publicly routable address, the same way every npm package gets a unique name on the registry. If you have ever debugged a NAT issue where an application could not figure out its own external IP, or fought with a home router's port forwarding page, you understand why this matters.

Subnetting in IPv6 is simpler because the standard allocation for a single network segment is a `/64`. That means every subnet gets 2^64 addresses, which is more addresses per subnet than the entire IPv4 address space. You do not agonize over whether a `/24` or a `/20` fits your growth projections. You get a `/64` and move on.

```bash
$ ip -6 addr show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
    inet6 2001:db8:1::100/64 scope global dynamic
       valid_lft 86400sec preferred_lft 14400sec
    inet6 fe80::1a2b:3c4d:5e6f:7890/64 scope link
       valid_lft forever preferred_lft forever
```

Each interface shows its IPv6 addresses. The `scope global` address is routable on the internet. The `scope link` address starting with `fe80::` is a link-local address that works only on the local network segment, automatically assigned to every IPv6-enabled interface. Think of `fe80::` addresses like `localhost` for the physical wire you are plugged into.

In practice, most cloud infrastructure today runs dual-stack, meaning both IPv4 and IPv6 simultaneously. AWS VPCs, GCP networks, and Azure VNets all support dual-stack on load balancers, EC2 instances, and DNS. You can verify IPv6 connectivity with a quick DNS lookup:

```bash
$ dig google.com AAAA +short
2607:f8b0:4004:800::200e
```

The `AAAA` record type is the IPv6 equivalent of an `A` record. If you are designing infrastructure today, enable dual-stack from the start. Adding IPv6 to an existing IPv4-only setup is doable, but retrofitting always takes longer and introduces risk you could have avoided.

## When Subnetting Goes Wrong

Subnetting mistakes are quiet. Nothing crashes immediately. Traffic just stops flowing in ways that are hard to diagnose. Here are the three most common failures.

**Overlapping CIDRs break peering and routing.** You create two VPCs, both using `10.0.0.0/16`, and later try to peer them. The peering request fails because the router has no way to decide which VPC a packet destined for `10.0.50.12` should go to. The same problem hits VPN tunnels between your cloud environment and an on-premises network. The fix is planning non-overlapping ranges from day one. If you inherit overlapping networks, the only solution is renumbering one side, which means migrating every resource to new subnets. There is no shortcut.

**Subnet exhaustion locks you out of scaling.** You create a small subnet, say a `/24` with 254 usable hosts, for your application tier. Things grow. You add autoscaling. One day, new instances fail to launch with a cryptic "insufficient IP addresses" error. Every IP in the subnet is allocated. You cannot resize a subnet after creation in most cloud providers. The fix is creating a new, larger subnet, migrating workloads, and deleting the old one. You can avoid this entirely by using `/20` subnets (4,094 hosts) instead of `/24` for any tier that might scale. The extra addresses cost nothing.

**Wrong mask means unreachable hosts.** You configure a server with IP `10.0.1.50` and subnet mask `255.255.255.0` (`/24`), but the actual subnet is `10.0.0.0/20`. The server thinks its network only covers `10.0.1.0` through `10.0.1.255`. When it tries to reach `10.0.2.100` (which is in the same `/20` subnet), it sends the packet to the default gateway instead of delivering it directly. Depending on your routing setup, this might work slowly, work intermittently, or not work at all. The error looks like random connectivity failures, not a clear misconfiguration. Always verify that the mask on every host matches the actual subnet definition.

You can catch most of these problems before they bite by building a quick validation script:

```python
import ipaddress

networks = [
    ipaddress.ip_network('10.0.0.0/20'),
    ipaddress.ip_network('10.0.16.0/20'),
    ipaddress.ip_network('10.0.0.0/24'),  # overlaps with the first!
]

for i, a in enumerate(networks):
    for j, b in enumerate(networks):
        if i < j and a.overlaps(b):
            print(f"OVERLAP: {a} and {b}")
```

```text
OVERLAP: 10.0.0.0/20 and 10.0.0.0/24
```

Python's `ipaddress` module catches overlaps instantly. Run a script like this as part of your infrastructure-as-code review process, and you will never deploy conflicting subnets.

---

**References**

- [RFC 4632 - CIDR](https://datatracker.ietf.org/doc/html/rfc4632) - The specification that replaced classful networking with prefix-based routing, the foundation of every modern subnet design.
- [RFC 1918 - Private Address Space](https://datatracker.ietf.org/doc/html/rfc1918) - Defines the three private IPv4 ranges (10.x, 172.16.x, 192.168.x) used in every VPC and home network.
- [AWS VPC CIDR Blocks Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html) - Official guide to choosing and managing CIDR blocks for AWS VPCs, including the 5-address reservation rule.
- [Python ipaddress Module](https://docs.python.org/3/library/ipaddress.html) - Standard library documentation for the module used throughout this article to validate and inspect networks.
- [RFC 8200 - IPv6 Specification](https://datatracker.ietf.org/doc/html/rfc8200) - The core IPv6 protocol specification covering address format, header structure, and extension headers.
