---
title: "Firewalls & Security"
description: "Understand cloud and Linux firewall rules, allow the right web traffic, harden SSH access, and debug blocked connections safely."
overview: "Learn how firewalls decide whether the routed request may reach port 443, from security groups and network ACLs to host-level packet filters and SSH protection."
tags: ["iptables", "firewall", "ssh", "fail2ban", "security-groups"]
order: 4
id: article-devops-foundation-networking-firewalls-security
---

## Table of Contents

1. [What Firewalls Do](#what-firewalls-do)
2. [What a Firewall Rule Means](#what-a-firewall-rule-means)
3. [Cloud Firewalls: Security Groups and Network ACLs](#cloud-firewalls-security-groups-and-network-acls)
4. [Host Firewalls with iptables](#host-firewalls-with-iptables)
5. [Opening Web Traffic Without Opening Everything](#opening-web-traffic-without-opening-everything)
6. [SSH Hardening for the Admin Path](#ssh-hardening-for-the-admin-path)
7. [fail2ban and Reactive Blocking](#fail2ban-and-reactive-blocking)
8. [Firewall Failure Modes](#firewall-failure-modes)
9. [References](#references)

## What Firewalls Do
<!-- section-summary: Firewalls read packet fields and connection state, then decide whether traffic may continue toward a service. -->

A public web server has to accept some traffic and hide other traffic. Users need TCP `443` for HTTPS. Admins may need SSH on `22`, but only from a VPN or bastion. The database port should not be reachable from the internet at all. A firewall is the layer that enforces those different audiences before traffic reaches the service.

A **firewall** checks packet details such as source IP, destination IP, protocol, port, interface, and connection state. A rule matches some of those details and then applies an action.

**Allow** means the packet continues. **Drop** means the packet disappears silently. **Reject** means the sender gets an explicit refusal.

Those three actions feel different to the person debugging. An allowed packet can reach the next service. A dropped packet often creates a timeout because the client hears nothing back. A rejected packet fails quickly because the client receives a refusal. Learning that difference helps you tell apart "nothing answered" and "something answered no."

Firewall rules protect services by deciding which traffic may reach them. A public website usually allows TCP `80` and `443` from the internet. An SSH service usually allows TCP `22` only from a VPN, bastion host, or known admin address range. A database usually accepts traffic only from application servers or private network ranges.

For `https://app.example.com/dashboard`, DNS has already returned an IP address, and routing has sent packets toward the server or load balancer. The browser wants TCP port `443`. A firewall somewhere along the path checks that packet. In cloud infrastructure, the first check may be a security group or network ACL. On a Linux server, the kernel may check iptables or nftables rules. In front of a large application, a load balancer, CDN, or web application firewall may apply another layer of policy.

Under the hood, most firewall decisions happen before the application reads the request. A packet arrives at an interface. The kernel or cloud network layer checks the packet fields and, for stateful firewalls, checks whether the packet belongs to an existing connection. Only allowed packets continue toward the listening process.

The important beginner idea is that a firewall failure can happen before TLS, Nginx, or the app ever gets involved. If TCP port `443` is blocked, the certificate can be perfect and the app can be healthy, while the browser still waits until the connection times out.

## What a Firewall Rule Means
<!-- section-summary: A firewall rule matches packet fields and applies an action, usually as part of an allowlist with default deny. -->

A firewall sees packets and connection state. It does not know that a user clicked a dashboard button. A packet has details such as source address, destination address, protocol, and port. The firewall compares those details with its rules before the packet reaches the service.

For HTTPS, the first TCP packet might look like this in plain language:

```
source IP: 198.51.100.50
source port: 53142
destination IP: 10.0.32.14
destination port: 443
protocol: TCP
flags: SYN
```

The source port `53142` is an **ephemeral port**. The client operating system chooses it temporarily for this connection. The destination port `443` identifies the service the client wants. Replies travel back from server port `443` to client port `53142`.

A firewall rule has two parts: a match and an action. The match describes traffic. The action says what to do.

Here is a small rule written in plain language:

```
Allow TCP traffic from anywhere to destination port 443.
```

The same idea as an iptables command looks like this:

```bash
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

The important pieces are:

- `-A INPUT` appends the rule to inbound traffic for this host.
- `-p tcp --dport 443` matches HTTPS traffic.
- `-j ACCEPT` lets matching packets continue through the stack.

That is the packet-level version of "allow HTTPS."

Most production firewall policy follows **default deny**. Default deny means traffic is blocked unless a rule explicitly allows it. This is the network version of an allowlist. A public web server usually allows `80` and `443` from the internet, allows SSH only from trusted admin networks, allows loopback traffic, allows replies to existing connections, and drops everything else.

Four fields deserve extra attention:

| Field | Meaning | Example |
| --- | --- | --- |
| Source | Where the packet came from | `203.0.113.0/24`, a VPN CIDR, or anywhere |
| Destination | Which local address or subnet the packet targets | `10.0.32.14`, a load balancer subnet, or a private interface |
| Protocol | Which transport protocol is in use | TCP for HTTPS, UDP for many DNS queries |
| Destination port | Which service the packet wants | `22` for SSH, `80` for HTTP, `443` for HTTPS |

The source matters because not every service should be public. Port `443` for a public app can accept traffic from anywhere. Port `22` for SSH should usually accept traffic only from a VPN, bastion host, office IP range, or emergency admin range.

The practical next decision is to make the rule as narrow as the service allows. Public HTTPS can use source `0.0.0.0/0` and `::/0` if the site is internet-facing. SSH should usually use a VPN CIDR, bastion Security Group, or small admin range. App and database ports should usually accept traffic only from the load balancer or app tier that needs them.

## Cloud Firewalls: Security Groups and Network ACLs
<!-- section-summary: Cloud firewalls filter traffic before it reaches the host, with security groups attached to resources and NACLs attached to subnets. -->

Cloud providers put firewall layers outside your server. That matters because packets blocked there never reach the Linux host. If `curl localhost:3000` works on the instance but the browser cannot connect to the public IP, the cloud firewall is one of the first places to inspect.

In AWS, the two common layers are **Security Groups** and **Network ACLs**.

A **Security Group** attaches to a resource, such as an EC2 instance, load balancer, or database. It is stateful. Stateful means the firewall remembers accepted connections. If a security group allows inbound TCP `443`, the return traffic for those connections is allowed automatically. This is why most day-to-day AWS firewall work happens in Security Groups.

Stateful behavior fits how TCP actually works. The client sends a SYN from an ephemeral port to server port `443`. The server replies from `443` back to that ephemeral port. A stateful firewall recognizes that reply as part of the accepted connection, so you do not need a separate inbound rule for every client ephemeral port.

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

This is the main reasoning difference. Use Security Groups for precise resource access, such as "only the load balancer can reach app port `3000`." Use NACLs as broad subnet guardrails, such as blocking a known bad range or enforcing coarse inbound and outbound boundaries. NACLs are ordered and stateless, so small mistakes can block return traffic even when the Security Group looks correct.

| Feature | Security Group | Network ACL |
| --- | --- | --- |
| Scope | Resource | Subnet |
| State | Stateful | Stateless |
| Rule evaluation | All matching allow rules matter | Ordered rules, first match wins |
| Common use | Precise access to instances and load balancers | Broad subnet guardrails |

The practical debugging rule is direct. If traffic never appears on the host in `tcpdump`, inspect the cloud firewall, route table, and load balancer listener. If traffic appears on the host but the app does not receive it, inspect host firewall rules and the listening process.

AWS CLI output can give the exact policy:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-0123456789abcdef0 \
  --query 'SecurityGroups[0].IpPermissions'
```

Example output:

```console
[
  {
    "IpProtocol": "tcp",
    "FromPort": 443,
    "ToPort": 443,
    "IpRanges": [
      {
        "CidrIp": "0.0.0.0/0"
      }
    ]
  }
]
```

```bash
aws ec2 describe-network-acls \
  --filters Name=vpc-id,Values=vpc-abc123 \
  --query 'NetworkAcls[].Entries[]'
```

Example output:

```console
[
  {
    "RuleNumber": 100,
    "Protocol": "6",
    "RuleAction": "allow",
    "Egress": false,
    "CidrBlock": "0.0.0.0/0",
    "PortRange": {
      "From": 443,
      "To": 443
    }
  }
]
```

The Security Group output shows public TCP `443` is allowed. The Network ACL output shows rule `100` allows inbound TCP `443` for the subnet. Those commands are especially useful when console screenshots, Terraform files, and actual deployed state might disagree. For a public web app, the key checks are whether the load balancer allows public `80` and `443`, whether the app server allows traffic from the load balancer, and whether any subnet-level rule blocks return traffic.

For NACL debugging, also check the matching egress rule. A client may connect from port `53142`, so the subnet needs to allow the response back to the client's ephemeral port range. If inbound `443` is allowed but outbound ephemeral traffic is denied, the SYN can arrive while the SYN-ACK cannot leave.

## Host Firewalls with iptables
<!-- section-summary: iptables configures Linux kernel packet filtering through ordered chains and actions. -->

Cloud rules can allow TCP `443` to a VM, and the Linux server can still need one final gate. Maybe the cloud Security Group allows web traffic broadly, while the host should allow SSH only from a bastion and keep a metrics port private. That final gate is the host firewall.

Linux packet filtering happens in the kernel through Netfilter. `iptables` is one tool for configuring Netfilter. Many distributions now use `nftables` underneath, and tools like `ufw` or `firewalld` provide friendlier frontends. The same basic idea still applies: packets enter ordered rule lists, rules match packet fields, and actions decide what happens.

A **chain** is an ordered list of rules for one traffic direction or stage. For a web server, the chain you inspect most often is `INPUT`, because it handles packets coming into the host.

The most common chains are:

| Chain | Traffic it handles | Common server use |
| --- | --- | --- |
| `INPUT` | Packets coming into this host | Web traffic, SSH, monitoring |
| `OUTPUT` | Packets leaving this host | Updates, API calls, DNS, logs |
| `FORWARD` | Packets routed through this host | Routers, NAT gateways, Kubernetes nodes |

For a basic web server, most rules live in `INPUT`. A safe starting pattern allows loopback traffic, allows replies to existing connections, allows public web traffic, allows restricted SSH, logs unexpected traffic, and drops the rest.

Connection state matters. A server may initiate an outbound request to an API. The response comes back as inbound traffic to a high local port. Without a state rule, a default-deny `INPUT` policy could block the response. The kernel's connection tracking system, called **conntrack**, records active flows so reply packets can be accepted.

Conntrack is the local version of stateful firewall memory. It records tuples such as source IP, source port, destination IP, destination port, and protocol. When the reply packet comes back, the kernel can recognize it as `ESTABLISHED` and let it through. This is why the `ESTABLISHED,RELATED` rule usually appears near the top of a default-deny host firewall.

A minimal rule set can look like this:

```bash
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp -s 198.51.100.10 --dport 22 -j ACCEPT
sudo iptables -A INPUT -j LOG --log-prefix "iptables dropped: "
```

The important lines are:

- `-P INPUT DROP` makes inbound traffic default to deny.
- `-i lo -j ACCEPT` keeps local loopback traffic working, which matters for apps talking to services on `127.0.0.1`.
- `--ctstate ESTABLISHED,RELATED` allows replies for connections the server already accepted or started.
- `--dport 80` and `--dport 443` expose the public web ports.
- `-s 198.51.100.10 --dport 22` allows SSH only from one admin source. In real production, that source is often a VPN CIDR or bastion host address rather than a single laptop IP.
- The final `LOG` rule records unexpected traffic before the default policy drops it.

The current rule order is visible with line numbers:

```bash
sudo iptables -L INPUT -n --line-numbers
```

Example output:

```console
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

The next decision after viewing the chain is placement. A new emergency block belongs above any broad allow it needs to override. A new allow for a service belongs above the final log or drop rule. After changing order, test from the real client source because local `curl localhost` skips many inbound firewall paths.

On Ubuntu, many teams use UFW as a friendlier frontend. UFW still configures Linux firewall policy underneath, but the status output is easier to read:

```bash
sudo ufw status numbered
```

Example output:

```console
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    198.51.100.10
[ 2] 80/tcp                     ALLOW IN    Anywhere
[ 3] 443/tcp                    ALLOW IN    Anywhere
```

This says SSH is allowed only from `198.51.100.10`, while web ports `80` and `443` are allowed from anywhere. The words `ALLOW IN` mean inbound packets that match those rows can continue.

## Opening Web Traffic Without Opening Everything
<!-- section-summary: A production web path usually exposes only ports 80 and 443 publicly, while app ports stay private behind the proxy or load balancer. -->

For a public web app, the browser should reach Nginx on `443`. It should not reach the Node, Django, Rails, or Go app port directly. The app port should listen on `127.0.0.1` if Nginx is on the same host, or on a private subnet address if Nginx or a load balancer sits on another host.

A local process check tells you what is listening:

```bash
sudo ss -tlnp
```

Example output:

```console
State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port Process
LISTEN  0       511     0.0.0.0:443         0.0.0.0:*         users:(("nginx",pid=1200,fd=7))
LISTEN  0       511     0.0.0.0:80          0.0.0.0:*         users:(("nginx",pid=1200,fd=6))
LISTEN  0       128     127.0.0.1:3000      0.0.0.0:*         users:(("node",pid=2200,fd=18))
LISTEN  0       128     10.0.32.14:22       0.0.0.0:*         users:(("sshd",pid=900,fd=3))
```

This is a good shape for a single-host Nginx deployment:

- `0.0.0.0:443` and `0.0.0.0:80` mean Nginx accepts public web traffic on all IPv4 interfaces.
- `127.0.0.1:3000` means the app accepts traffic only from the same host, so browsers cannot bypass Nginx.
- `10.0.32.14:22` means SSH is bound to a private interface, and firewall source rules can narrow it further.

A quick outside check confirms the public ports:

```bash
nc -vz app.example.com 443
```

Example output:

```console
Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

Now test the private app port from outside:

```bash
nc -vz app.example.com 3000
```

Example output:

```console
nc: connect to app.example.com port 3000 (tcp) failed: Connection timed out
```

That result is healthy:

- Port `443` succeeds because users need to reach the HTTPS listener.
- Port `3000` times out because only Nginx should talk to the app process directly.
- A successful public connection to `3000` would mean the app port is exposed too widely.

## SSH Hardening for the Admin Path
<!-- section-summary: SSH is a separate admin path, so it needs key-based access, source restrictions, and a safe rollout process. -->

The web path and the admin path should feel different. Anyone on the internet may need HTTPS, but only trusted operators should reach SSH. If attackers brute-force or steal SSH access, they can change the firewall, Nginx, certificates, or app.

**SSH** is the encrypted remote shell protocol used to manage Linux servers. The common port is `22`. A safer day-to-day setup uses SSH keys, disables password login, blocks direct root login, limits users, and restricts source IPs in the firewall or cloud Security Group.

Important `/etc/ssh/sshd_config` settings often look like this:

```sshconfig
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
PermitEmptyPasswords no
MaxAuthTries 3
AllowUsers deploy admin
```

Those settings do a few practical things:

- `PasswordAuthentication no` forces key-based login.
- `PermitRootLogin no` requires admins to use named accounts instead of direct root login.
- `MaxAuthTries 3` limits repeated guesses in one connection.
- `AllowUsers deploy admin` narrows which accounts can log in over SSH.

After changing SSH config, a safe rollout keeps the current SSH session open while a second terminal tests a new login. If the new login fails, the open session can revert the change. This simple habit prevents a lockout.

The firewall source rule should be narrow:

```bash
sudo iptables -A INPUT -p tcp -s 198.51.100.10 --dport 22 -j ACCEPT
```

That command is narrow on purpose:

- `sudo iptables -A INPUT` appends the rule to the inbound chain on the host.
- `-p tcp` limits the rule to TCP traffic, which SSH uses.
- `-s 198.51.100.10` allows only the trusted admin source address.
- `--dport 22` limits the match to the SSH port.
- `-j ACCEPT` allows matching packets through the host firewall.

In cloud infrastructure, the same rule belongs in the Security Group:

```
Inbound: TCP 22 from 198.51.100.10/32
```

The Security Group rule carries the same meaning at the cloud edge:

- `Inbound` means the rule applies to packets entering the instance or load balancer.
- `TCP 22` means SSH traffic only, rather than every protocol and port.
- `198.51.100.10/32` means exactly one IPv4 address. A wider CIDR such as `0.0.0.0/0` would expose SSH to the whole internet.

Many teams place servers behind a VPN or bastion host so SSH is never open to the public internet. That design reduces scanner noise and gives a central place for logging and access review. The next decision is usually whether SSH should be reachable from the internet at all. For a small learning VM, a narrow `/32` admin source may be enough. For a team environment, a VPN, bastion, or cloud session manager usually gives stronger control and better audit trails.

## fail2ban and Reactive Blocking
<!-- section-summary: fail2ban watches logs for repeated failures and adds temporary firewall blocks for abusive sources. -->

Even with SSH locked down, public servers see constant login attempts from scanners. The important signal is repetition: the same source fails again and again in a short time. **fail2ban** watches logs for that pattern and adds a temporary firewall block for the abusive source.

For SSH, fail2ban reads authentication logs. If one IP fails too many times in a short window, it adds a temporary firewall rule that blocks that IP.

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

The three timing values control how aggressive the jail is:

- `maxretry = 3` allows three failed matches before fail2ban takes action.
- `findtime = 600` counts those failures inside a 600-second window, so slow occasional mistakes do not trigger the same way as rapid guessing.
- `bantime = 3600` blocks the source for 3,600 seconds after the threshold is crossed.

Status output shows what fail2ban is doing:

```bash
sudo fail2ban-client status sshd
```

Example output:

```console
Status for the jail: sshd
|- Filter
|  |- Currently failed: 1
|  `- Total failed: 18
`- Actions
   |- Currently banned: 2
   `- Banned IP list: 203.0.113.40 203.0.113.41
```

The status output gives quick evidence:

- `Currently failed` shows active failures that have not crossed the ban threshold yet.
- `Total failed` shows how noisy the SSH login path has been.
- `Currently banned` and `Banned IP list` show which sources are blocked right now.

fail2ban is not a replacement for SSH keys, MFA-protected bastions, VPNs, or cloud policy. It is a useful reactive layer that turns repeated log evidence into temporary network blocks.

## Firewall Failure Modes
<!-- section-summary: Firewall incidents often come from blocked ports, wrong sources, rule order mistakes, missing state rules, or unsaved host rules. -->

A firewall incident often arrives as a short report: "the site times out," "SSH stopped working," or "the app can call out, but replies never come back." Those symptoms usually fit one of a few patterns.

**Connection timeout** often means a firewall dropped the packet silently. The browser waits. `nc -vz app.example.com 443` hangs. `tcpdump` on the server shows no SYN packet. That points at cloud Security Groups, NACLs, routing, load balancer listeners, or an upstream firewall.

**Connection refused** means the destination host sent a refusal. The packet reached something, but no process accepted the port, or a reject rule sent back a TCP reset.

```bash
nc -vz app.example.com 443
```

Example output:

```console
nc: connect to app.example.com port 443 (tcp) failed: Connection refused
```

That is different from a timeout. Refused traffic reached a host. Timed-out traffic may have been dropped before it arrived. The next useful checks are the listener list with `ss -tlnp` and the firewall rules for port `443`.

**Wrong source rule** happens when SSH or app traffic is allowed from the office IP, but the engineer is on VPN, home broadband, or a rotated NAT gateway. The rule looks right, but the packet source is different from the expected CIDR. Cloud flow logs and firewall logs reveal the actual source.

**Rule order mistakes** happen in ordered firewalls. A broad accept above a narrow drop means the narrow drop never runs:

```bash
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

In that order, the broad accept catches the traffic first. The narrow drop never gets a chance to run. The fix is to place the narrow rule first:

```bash
sudo iptables -I INPUT 1 -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

**Missing conntrack allow rules** break replies. A server can send outbound traffic, but the response packets are dropped on the way back through `INPUT`. The usual iptables rule is:

```bash
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

The conntrack rule allows return traffic that belongs to a connection the host already knows about:

- `-A INPUT` adds the rule to inbound host traffic.
- `-m conntrack` loads connection-tracking matching.
- `--ctstate ESTABLISHED,RELATED` matches reply packets for existing connections and closely related flows.
- `-j ACCEPT` lets those packets through, so outbound connections can receive responses.

**Unsaved iptables rules** disappear after reboot. On Debian and Ubuntu, `iptables-persistent` can restore saved rules:

```bash
sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
```

The persistence command stores the current IPv4 firewall rules for boot-time restore:

- `iptables-save` prints the active IPv4 rules in restore format.
- `tee /etc/iptables/rules.v4` writes that rule set to the file read by `iptables-persistent`.
- `>/dev/null` hides the duplicate terminal output from `tee`; the important result is the saved file.
- After saving, a reboot test or `sudo iptables-restore < /etc/iptables/rules.v4` in a safe maintenance window proves the rules can reload.

A careful firewall change has three checks: the cloud policy allows the intended path, the host firewall allows the intended port, and a packet capture or connection test proves the packet reaches the next layer. After port `443` passes the firewall, the browser can move to TLS.

When you need proof that packets reach the host, capture the SYN packets on the server:

```bash
sudo tcpdump -i eth0 -n tcp port 443 -c 3
```

Example output:

```console
12:22:10.100 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
12:22:11.120 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
12:22:13.160 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
```

Repeated `[S]` packets without a reply mean the client is trying to open TCP, but the server is not sending the SYN-ACK back. That points to a local firewall drop, a missing listener, an asymmetric route, or a capture taken on the wrong interface. If no SYN packets appear at all, inspect cloud firewalls, NACLs, load balancer listeners, and routes before blaming the host firewall.

## References

- [iptables(8) Linux Manual Page](https://man7.org/linux/man-pages/man8/iptables.8.html) - Official Linux manual for iptables rules, chains, targets, and options.
- [nftables Wiki](https://wiki.nftables.org/wiki-nftables/index.php/Main_Page) - Official nftables documentation for modern Linux packet filtering.
- [AWS Security Groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - Official AWS documentation for stateful resource-level firewall rules.
- [AWS Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Official AWS documentation for stateless subnet-level firewall rules.
- [OpenSSH `sshd_config` Manual](https://man.openbsd.org/sshd_config) - Authoritative reference for SSH daemon configuration.
- [fail2ban Documentation](https://fail2ban.readthedocs.io/en/latest/) - Current fail2ban documentation for jails, filters, and actions.
