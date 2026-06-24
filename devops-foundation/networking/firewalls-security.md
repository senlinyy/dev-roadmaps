---
title: "Firewalls & Security"
description: "Understand cloud and Linux firewall rules, allow the right web traffic, harden SSH access, and debug blocked connections safely."
overview: "Learn how firewalls decide whether the routed request may reach port 443, from security groups and network ACLs to host-level packet filters and SSH protection."
tags: ["iptables", "firewall", "ssh", "fail2ban", "security-groups"]
order: 4
id: article-devops-foundation-networking-firewalls-security
---

## Table of Contents

1. [Where Firewalls Sit in the Request Path](#where-firewalls-sit-in-the-request-path)
2. [What a Firewall Rule Means](#what-a-firewall-rule-means)
3. [Cloud Firewalls: Security Groups and Network ACLs](#cloud-firewalls-security-groups-and-network-acls)
4. [Host Firewalls with iptables](#host-firewalls-with-iptables)
5. [Opening Web Traffic Without Opening Everything](#opening-web-traffic-without-opening-everything)
6. [SSH Hardening for the Admin Path](#ssh-hardening-for-the-admin-path)
7. [fail2ban and Reactive Blocking](#fail2ban-and-reactive-blocking)
8. [Firewall Failure Modes](#firewall-failure-modes)

## Where Firewalls Sit in the Request Path
<!-- section-summary: After DNS and routing find the server, firewall policy decides whether the packet may reach the TLS listener on port 443. -->

The shared request path is `browser -> DNS -> IP/subnet -> firewall -> TLS -> Nginx reverse proxy -> app`. At this point, DNS has returned an IP address, and the route table has sent packets toward the server or load balancer. The next question is simple: is this packet allowed through?

For `https://app.example.com/dashboard`, the browser wants TCP port `443`. A firewall somewhere along the path checks that packet. In cloud infrastructure, the first check may be a security group or network ACL. On a Linux server, the kernel may check iptables or nftables rules. In front of a large application, a load balancer, CDN, or web application firewall may apply another layer of policy.

A firewall is a rule engine for traffic. It reads fields such as source IP, destination IP, protocol, port, interface, and connection state. Then it allows, drops, or rejects the packet. **Allow** means the packet continues. **Drop** means the packet disappears silently. **Reject** means the sender gets an explicit refusal.

The important beginner idea is that a firewall failure can happen before TLS, Nginx, or the app ever gets involved. If TCP port `443` is blocked, the certificate can be perfect and the app can be healthy, but the browser still waits until the connection times out.

## What a Firewall Rule Means
<!-- section-summary: A firewall rule matches packet fields and applies an action, usually as part of an allowlist with default deny. -->

A firewall rule has two parts: a match and an action. The match describes traffic. The action says what to do.

Here is a small rule written in plain language:

```
Allow TCP traffic from anywhere to destination port 443.
```

The same idea as an iptables command looks like this:

```bash
$ sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

The rule says: append a rule to the `INPUT` chain, match TCP packets whose destination port is `443`, and accept them. That is the packet-level version of "allow HTTPS."

Most production firewall policy follows **default deny**. Default deny means traffic is blocked unless a rule explicitly allows it. This is the network version of an allowlist. A public web server usually allows `80` and `443` from the internet, allows SSH only from trusted admin networks, allows loopback traffic, allows replies to existing connections, and drops everything else.

Two fields deserve extra attention:

| Field | Meaning | Example |
| --- | --- | --- |
| Source | Where the packet came from | `203.0.113.0/24`, a VPN CIDR, or anywhere |
| Destination port | Which service the packet wants | `22` for SSH, `80` for HTTP, `443` for HTTPS |

The source matters because not every service should be public. Port `443` for a public app can accept traffic from anywhere. Port `22` for SSH should usually accept traffic only from a VPN, bastion host, office IP range, or emergency admin range.

## Cloud Firewalls: Security Groups and Network ACLs
<!-- section-summary: Cloud firewalls filter traffic before it reaches the host, with security groups attached to resources and NACLs attached to subnets. -->

Cloud providers put firewall layers outside your server. That matters because packets blocked there never reach the Linux host. If `curl localhost:3000` works on the instance but the browser cannot connect to the public IP, the cloud firewall is one of the first places to inspect.

In AWS, the two common layers are **Security Groups** and **Network ACLs**.

A **Security Group** attaches to a resource, such as an EC2 instance, load balancer, or database. It is stateful. Stateful means the firewall remembers accepted connections. If a security group allows inbound TCP `443`, the return traffic for those connections is allowed automatically. This is why most day-to-day AWS firewall work happens in Security Groups.

A typical public load balancer Security Group might look like this:

| Direction | Protocol | Port | Source |
| --- | --- | --- | --- |
| Inbound | TCP | `80` | `0.0.0.0/0` |
| Inbound | TCP | `443` | `0.0.0.0/0` |
| Outbound | TCP | App port `3000` | App server Security Group |

An app server Security Group behind that load balancer should be narrower:

| Direction | Protocol | Port | Source |
| --- | --- | --- | --- |
| Inbound | TCP | `3000` | Load balancer Security Group |
| Inbound | TCP | `22` | Bastion or VPN CIDR |
| Outbound | All | All | As required by the app |

This pattern keeps the app port private. The internet reaches the load balancer. The load balancer reaches the app. Random clients on the internet cannot connect directly to `3000`.

A **Network ACL**, usually shortened to NACL, attaches to a subnet. It is stateless. Stateless means it does not remember the original connection. If a NACL allows inbound `443`, it also needs an outbound rule that allows the response traffic back to the client's ephemeral port. Ephemeral ports are temporary high-numbered ports the client operating system uses for the client side of a TCP connection.

| Feature | Security Group | Network ACL |
| --- | --- | --- |
| Scope | Resource | Subnet |
| State | Stateful | Stateless |
| Rule evaluation | All matching allow rules matter | Ordered rules, first match wins |
| Common use | Precise access to instances and load balancers | Broad subnet guardrails |

The practical debugging rule is direct. If traffic never appears on the host in `tcpdump`, inspect the cloud firewall, route table, and load balancer listener. If traffic appears on the host but the app does not receive it, inspect host firewall rules and the listening process.

AWS CLI output can give the exact policy:

```bash
$ aws ec2 describe-security-groups \
>   --group-ids sg-0123456789abcdef0 \
>   --query 'SecurityGroups[0].IpPermissions'
```

```bash
$ aws ec2 describe-network-acls \
>   --filters Name=vpc-id,Values=vpc-abc123 \
>   --query 'NetworkAcls[].Entries[]'
```

Those commands show what the cloud is enforcing. They are especially useful when console screenshots, Terraform files, and actual deployed state might disagree.

## Host Firewalls with iptables
<!-- section-summary: iptables configures Linux kernel packet filtering through ordered chains and actions. -->

Linux packet filtering happens in the kernel through Netfilter. `iptables` is one tool for configuring Netfilter. Many distributions now use `nftables` underneath, and tools like `ufw` or `firewalld` provide friendlier frontends. The concepts stay the same: packets enter chains, rules match fields, and actions decide what happens.

The most common chains are:

| Chain | Traffic it handles | Common server use |
| --- | --- | --- |
| `INPUT` | Packets coming into this host | Web traffic, SSH, monitoring |
| `OUTPUT` | Packets leaving this host | Updates, API calls, DNS, logs |
| `FORWARD` | Packets routed through this host | Routers, NAT gateways, Kubernetes nodes |

For a basic web server, most rules live in `INPUT`. A safe starting pattern allows loopback traffic, allows replies to existing connections, allows public web traffic, allows restricted SSH, logs unexpected traffic, and drops the rest.

Connection state matters. A server may initiate an outbound request to an API. The response comes back as inbound traffic to a high local port. Without a state rule, a default-deny `INPUT` policy could block the response. The kernel's connection tracking system, called **conntrack**, records active flows so reply packets can be accepted.

A minimal rule set can look like this:

```bash
$ sudo iptables -P INPUT DROP
$ sudo iptables -P FORWARD DROP
$ sudo iptables -P OUTPUT ACCEPT
$ sudo iptables -A INPUT -i lo -j ACCEPT
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
$ sudo iptables -A INPUT -p tcp -s 198.51.100.10 --dport 22 -j ACCEPT
$ sudo iptables -A INPUT -j LOG --log-prefix "iptables dropped: "
```

The SSH rule allows only one admin source IP, `198.51.100.10`. In real production, that source is often a VPN CIDR or bastion host address rather than a single laptop IP.

The current rule order is visible with line numbers:

```bash
$ sudo iptables -L INPUT -n --line-numbers
Chain INPUT (policy DROP)
num  target  prot opt source          destination
1    ACCEPT  all  --  0.0.0.0/0       0.0.0.0/0
2    ACCEPT  all  --  0.0.0.0/0       0.0.0.0/0       ctstate RELATED,ESTABLISHED
3    ACCEPT  tcp  --  0.0.0.0/0       0.0.0.0/0       tcp dpt:80
4    ACCEPT  tcp  --  0.0.0.0/0       0.0.0.0/0       tcp dpt:443
5    ACCEPT  tcp  --  198.51.100.10   0.0.0.0/0       tcp dpt:22
6    LOG     all  --  0.0.0.0/0       0.0.0.0/0       LOG flags 0 level 4 prefix "iptables dropped: "
```

iptables reads the chain from top to bottom and stops at the first match. Rule order is part of the policy, not decoration. A broad allow rule above a narrow deny rule can make the deny rule useless.

## Opening Web Traffic Without Opening Everything
<!-- section-summary: A production web path usually exposes only ports 80 and 443 publicly, while app ports stay private behind the proxy or load balancer. -->

For the shared request path, the browser should reach Nginx on `443`. It should not reach the Node, Django, Rails, or Go app port directly. The app port should listen on `127.0.0.1` if Nginx is on the same host, or on a private subnet address if Nginx or a load balancer sits on another host.

A local process check tells you what is listening:

```bash
$ sudo ss -tlnp
State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port Process
LISTEN  0       511     0.0.0.0:443         0.0.0.0:*         users:(("nginx",pid=1200,fd=7))
LISTEN  0       511     0.0.0.0:80          0.0.0.0:*         users:(("nginx",pid=1200,fd=6))
LISTEN  0       128     127.0.0.1:3000      0.0.0.0:*         users:(("node",pid=2200,fd=18))
LISTEN  0       128     10.0.32.14:22       0.0.0.0:*         users:(("sshd",pid=900,fd=3))
```

This is a good shape for a single-host Nginx deployment. Nginx listens publicly on `80` and `443`. The app listens only on loopback. SSH listens on a private interface or is restricted by firewall source.

A quick outside check confirms the public ports:

```bash
$ nc -vz app.example.com 443
Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!

$ nc -vz app.example.com 3000
nc: connect to app.example.com port 3000 (tcp) failed: Connection timed out
```

That result is healthy. Port `443` is reachable because users need it. Port `3000` is hidden because only Nginx should talk to it.

## SSH Hardening for the Admin Path
<!-- section-summary: SSH is a separate admin path, so it needs key-based access, source restrictions, and a safe rollout process. -->

SSH is not part of the browser request path, but it is part of server security. If attackers can brute-force or steal SSH access, they can change the firewall, Nginx, certificates, or app. A public server should treat SSH as an admin-only path.

**SSH** is the encrypted remote shell protocol used to manage Linux servers. The common port is `22`. The safest day-to-day setup uses SSH keys, disables password login, blocks direct root login, limits users, and restricts source IPs in the firewall or cloud Security Group.

Important `/etc/ssh/sshd_config` settings often look like this:

```sshconfig
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 3
AllowUsers deploy admin
```

After changing SSH config, a safe rollout keeps the current SSH session open while a second terminal tests a new login. If the new login fails, the open session can revert the change. This simple habit prevents a lockout.

The firewall source rule should be narrow:

```bash
$ sudo iptables -A INPUT -p tcp -s 198.51.100.10 --dport 22 -j ACCEPT
```

In cloud infrastructure, the same rule belongs in the Security Group:

```
Inbound: TCP 22 from 198.51.100.10/32
```

Many teams place servers behind a VPN or bastion host so SSH is never open to the public internet. That design reduces scanner noise and gives a central place for logging and access review.

## fail2ban and Reactive Blocking
<!-- section-summary: fail2ban watches logs for repeated failures and adds temporary firewall blocks for abusive sources. -->

**fail2ban** is a local defense tool that watches logs and bans IP addresses after repeated suspicious behavior. For SSH, it reads authentication logs. If one IP fails too many times in a short window, fail2ban adds a temporary firewall rule that blocks that IP.

A minimal SSH jail looks like this in `/etc/fail2ban/jail.local`:

```ini
[sshd]
enabled = true
port = 22
maxretry = 3
findtime = 600
bantime = 3600
```

This means three failed SSH attempts within ten minutes leads to a one-hour ban. The exact values depend on your environment. Public servers often use stricter rules because automated scanners are constant.

Status output shows what fail2ban is doing:

```bash
$ sudo fail2ban-client status sshd
Status for the jail: sshd
|- Filter
|  |- Currently failed: 1
|  `- Total failed: 18
`- Actions
   |- Currently banned: 2
   `- Banned IP list: 203.0.113.40 203.0.113.41
```

fail2ban is not a replacement for SSH keys, MFA-protected bastions, VPNs, or cloud policy. It is a useful reactive layer that turns repeated log evidence into temporary network blocks.

## Firewall Failure Modes
<!-- section-summary: Firewall incidents often come from blocked ports, wrong sources, rule order mistakes, missing state rules, or unsaved host rules. -->

Firewall problems usually show up as one of a few patterns.

**Connection timeout** often means a firewall dropped the packet silently. The browser waits. `nc -vz app.example.com 443` hangs. `tcpdump` on the server shows no SYN packet. That points at cloud Security Groups, NACLs, routing, load balancer listeners, or an upstream firewall.

**Connection refused** means the destination host sent a refusal. The packet reached something, but no process accepted the port, or a reject rule sent back a TCP reset.

```bash
$ nc -vz app.example.com 443
nc: connect to app.example.com port 443 (tcp) failed: Connection refused
```

That is different from a timeout. Refused traffic reached a host. Timed-out traffic may have been dropped before it arrived.

**Wrong source rule** happens when SSH or app traffic is allowed from the office IP, but the engineer is on VPN, home broadband, or a rotated NAT gateway. The rule looks right, but the packet source is different from the expected CIDR. Cloud flow logs and firewall logs reveal the actual source.

**Rule order mistakes** happen in ordered firewalls. A broad accept above a narrow drop means the narrow drop never runs:

```bash
$ sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
$ sudo iptables -A INPUT -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

The fix is to place the narrow rule first:

```bash
$ sudo iptables -I INPUT 1 -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

**Missing conntrack allow rules** break replies. A server can send outbound traffic, but the response packets are dropped on the way back through `INPUT`. The usual iptables rule is:

```bash
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

**Unsaved iptables rules** disappear after reboot. On Debian and Ubuntu, `iptables-persistent` can restore saved rules:

```bash
$ sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
```

A careful firewall change has three checks: the cloud policy allows the intended path, the host firewall allows the intended port, and a packet capture or connection test proves the packet reaches the next layer. After port `443` passes the firewall, the request path moves to TLS.

---

**References**

- [iptables(8) Linux Manual Page](https://man7.org/linux/man-pages/man8/iptables.8.html) - Official Linux manual for iptables rules, chains, targets, and options.
- [nftables Wiki](https://wiki.nftables.org/wiki-nftables/index.php/Main_Page) - Official nftables documentation for modern Linux packet filtering.
- [AWS Security Groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - Official AWS documentation for stateful resource-level firewall rules.
- [AWS Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Official AWS documentation for stateless subnet-level firewall rules.
- [OpenSSH `sshd_config` Manual](https://man.openbsd.org/sshd_config) - Authoritative reference for SSH daemon configuration.
- [fail2ban Documentation](https://www.fail2ban.org/wiki/index.php/Main_Page) - Official project documentation for jails, filters, and actions.
