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

Picture a small production server that runs a website, an admin SSH service, and a database client. Browsers need to reach HTTPS on TCP `443`. Operators may need SSH on `22`, but only from a VPN or bastion. The database port should never accept random internet traffic. Before any of those services gets a chance to answer, the server needs a gatekeeper that decides which packets deserve to continue.

A **firewall** is that gatekeeper. It checks packet details such as source IP, destination IP, protocol, port, interface, and connection state. A firewall rule says, in plain terms, "traffic with these details may pass" or "traffic with these details must stop."

For a web server, one rule might allow TCP `443` from the internet so browsers can load the site. Another rule might allow TCP `22` only from `198.51.100.10`, the office VPN exit address. A third rule might block every other inbound packet. That simple shape lets the public use the public service while keeping the admin path and private ports out of reach.

**Allow** means the packet continues. **Drop** means the packet disappears silently. **Reject** means the sender gets an explicit refusal.

Those three actions create different symptoms during debugging. An allowed packet can reach the next service. A dropped packet often creates a timeout because the client hears nothing back. A rejected packet fails quickly because the client receives a refusal. That difference helps you separate "nothing answered" from "something answered no."

Now follow one browser request. For `https://app.example.com/dashboard`, DNS has already returned an IP address, and routing has sent packets toward the server or load balancer. The browser is trying to open TCP port `443`. A firewall somewhere along the path checks that packet before Nginx, TLS, or the app can do anything with it. In cloud infrastructure, the first check may be a security group or network ACL. On a Linux server, the kernel may check iptables or nftables rules. In front of a large application, a load balancer, CDN, or web application firewall may add another layer of policy.

Under the hood, most firewall decisions happen before the application reads the request. A packet arrives at an interface. The kernel or cloud network layer checks the packet fields and, for stateful firewalls, checks whether the packet belongs to an existing connection. Only allowed packets continue toward the listening process.

The beginner trap is blaming the app too early. If TCP port `443` is blocked, the certificate can be correct, Nginx can be configured, and the app can be healthy while the browser still waits until the connection times out. A good network check asks whether the packet reached the service before debugging the service itself.

## What a Firewall Rule Means
<!-- section-summary: A firewall rule matches packet fields and applies an action, usually as part of an allowlist with default deny. -->

Suppose the HTTPS request still times out. Before you change Nginx or restart the app, slow the request down to one packet. A firewall does not know that someone clicked a dashboard button. It sees packet details: where the packet came from, where it wants to go, which protocol it uses, and which port it targets.

For HTTPS, the first TCP packet might look like this in plain language:

```
source IP: 198.51.100.50
source port: 53142
destination IP: 10.0.32.14
destination port: 443
protocol: TCP
flags: SYN
```

The source port `53142` is an **ephemeral port**. The client operating system chooses it temporarily for this connection. The destination port `443` identifies the service the client wants. Replies travel back from server port `443` to client port `53142`, which is why return traffic matters as much as the first inbound packet.

A **firewall rule** has two parts: a match and an action. The match describes traffic. The action says what to do. For a beginner, the most useful way to read a rule is to translate it into a sentence before worrying about the exact command syntax.

Here is a small rule written in plain language:

```
Allow TCP traffic from anywhere to destination port 443.
```

The same idea as an iptables command looks like this:

```bash
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

The command gives the firewall the same instruction in Linux syntax:

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

The source field deserves special care because many outages and incidents start there. Port `443` for a public app can accept traffic from anywhere. Port `22` for SSH should usually accept traffic only from a VPN, bastion host, office IP range, or emergency admin range. A database port should usually accept traffic only from the app tier, never from `0.0.0.0/0`.

The practical rule-writing habit is to make each rule as narrow as the service allows. Public HTTPS can use source `0.0.0.0/0` and `::/0` if the site is internet-facing. SSH should usually use a VPN CIDR, bastion Security Group, or small admin range. App and database ports should usually accept traffic only from the load balancer or app tier that needs them.

## Cloud Firewalls: Security Groups and Network ACLs
<!-- section-summary: Cloud firewalls filter traffic before it reaches the host, with security groups attached to resources and NACLs attached to subnets. -->

Now move the same idea from one Linux host to a cloud network. You can have an app working perfectly on the instance, then still fail from the browser because the cloud stopped the packet before Linux ever saw it. If `curl localhost:3000` works on the instance but the browser cannot connect to the public IP, the cloud firewall is one of the first places to inspect.

In AWS, the two common layers are **Security Groups** and **Network ACLs**.

A **Security Group** attaches to a resource, such as an EC2 instance, load balancer, or database. It is stateful, which means it remembers accepted connections. If a security group allows inbound TCP `443`, the return traffic for those connections is allowed automatically. That is why most day-to-day AWS firewall work happens in Security Groups.

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

Those two tables describe a handoff. The internet can reach the load balancer on web ports. The load balancer can reach the app on port `3000`. Random clients on the internet cannot connect directly to `3000`. Teams expose the public front door while keeping internal app ports private.

A **Network ACL**, usually shortened to NACL, attaches to a subnet. It is stateless, which means it does not remember the original connection. If a NACL allows inbound `443`, it also needs an outbound rule that allows the response traffic back to the client's ephemeral port. Ephemeral ports are temporary high-numbered ports the client operating system uses for the client side of a TCP connection.

That state difference changes how you debug. Use Security Groups for precise resource access, such as "only the load balancer can reach app port `3000`." Use NACLs as broad subnet guardrails, such as blocking a known bad range or enforcing coarse inbound and outbound boundaries. NACLs are ordered and stateless, so small mistakes can block return traffic even while the Security Group looks correct.

| Feature | Security Group | Network ACL |
| --- | --- | --- |
| Scope | Resource | Subnet |
| State | Stateful | Stateless |
| Rule evaluation | All matching allow rules matter | Ordered rules, first match wins |
| Common use | Precise access to instances and load balancers | Broad subnet guardrails |

The practical debugging path is direct. If traffic never appears on the host in `tcpdump`, inspect the cloud firewall, route table, and load balancer listener. If traffic appears on the host but the app does not receive it, inspect host firewall rules and the listening process.

AWS CLI output can give the exact policy:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-0123456789abcdef0 \
  --query 'SecurityGroups[0].IpPermissions'

# Example output:
# [
#   {
#     "IpProtocol": "tcp",
#     "FromPort": 443,
#     "ToPort": 443,
#     "IpRanges": [
#       {
#         "CidrIp": "0.0.0.0/0"
#       }
#     ]
#   }
# ]
```

```bash
aws ec2 describe-network-acls \
  --filters Name=vpc-id,Values=vpc-abc123 \
  --query 'NetworkAcls[].Entries[]'

# Example output:
# [
#   {
#     "RuleNumber": 100,
#     "Protocol": "6",
#     "RuleAction": "allow",
#     "Egress": false,
#     "CidrBlock": "0.0.0.0/0",
#     "PortRange": {
#       "From": 443,
#       "To": 443
#     }
#   }
# ]
```

The Security Group output shows public TCP `443` is allowed. The Network ACL output shows rule `100` allows inbound TCP `443` for the subnet. The NACL fields are terse, so translate them before making a firewall decision:

- `RuleNumber: 100` is the order for this subnet rule. Lower rule numbers run earlier.
- `Protocol: "6"` means TCP. In AWS NACL output, protocols can appear as protocol numbers.
- `RuleAction: "allow"` means matching packets pass this rule.
- `Egress: false` means the rule applies to inbound traffic entering the subnet.
- `CidrBlock: "0.0.0.0/0"` means the source can be anywhere on IPv4.
- `PortRange` from `443` to `443` means HTTPS traffic only.

Those commands are especially useful during real incidents because console screenshots, Terraform files, and actual deployed state can disagree. For a public web app, the key checks are whether the load balancer allows public `80` and `443`, whether the app server allows traffic from the load balancer, and whether any subnet-level rule blocks return traffic.

For NACL debugging, also check the matching egress rule. A client may connect from port `53142`, so the subnet needs to allow the response back to the client's ephemeral port range. If inbound `443` is allowed but outbound ephemeral traffic is denied, the SYN can arrive while the SYN-ACK cannot leave.

![Security group versus network ACL infographic comparing stateful instance rules with stateless subnet rules](/content-assets/articles/article-devops-foundation-networking-firewalls-security/security-group-vs-nacl.png)

_The image shows why cloud firewall behavior depends on where the rule is attached and whether return traffic is remembered._

## Host Firewalls with iptables
<!-- section-summary: iptables configures Linux kernel packet filtering through ordered chains and actions. -->

After the cloud allows the packet, Linux can still stop it. Maybe the cloud Security Group allows web traffic broadly, while the host should allow SSH only from a bastion and keep a metrics port private. The host firewall gives you that last local gate on the server itself.

Linux packet filtering happens in the kernel through Netfilter. `iptables` is one tool for configuring Netfilter. Many distributions now use `nftables` underneath, and tools like `ufw` or `firewalld` provide friendlier frontends. The names differ, but the core habit stays the same: inspect the traffic direction, match the packet fields, then choose the action.

A **chain** is an ordered list of rules for one traffic direction or stage. For a web server, the chain you inspect most often is `INPUT`, because it handles packets coming into the host. If a browser cannot reach Nginx on `443`, the `INPUT` chain is where the host-level decision usually appears.

The most common chains are:

| Chain | Traffic it handles | Common server use |
| --- | --- | --- |
| `INPUT` | Packets coming into this host | Web traffic, SSH, monitoring |
| `OUTPUT` | Packets leaving this host | Updates, API calls, DNS, logs |
| `FORWARD` | Packets routed through this host | Routers, NAT gateways, Kubernetes nodes |

For a basic web server, most rules live in `INPUT`. A safe starting pattern allows loopback traffic, allows replies to existing connections, allows public web traffic, allows restricted SSH, logs unexpected traffic, and drops the rest.

Connection state matters. A server may initiate an outbound request to an API. The response comes back as inbound traffic to a high local port. Without a state rule, a default-deny `INPUT` policy could block the response. The kernel's connection tracking system, called **conntrack**, records active flows so reply packets can be accepted.

Conntrack is the local version of stateful firewall memory. It records tuples such as source IP, source port, destination IP, destination port, and protocol. When the reply packet comes back, the kernel can recognize it as `ESTABLISHED` and let it through. That is why the `ESTABLISHED,RELATED` rule usually appears near the top of a default-deny host firewall.

Default deny is powerful and risky. On a remote server, a pasted `DROP` policy can cut off your own SSH session before the allow rule is in place. Keep one SSH session open, test a second login from the same source, and know the rollback command before changing the default policy. If the server is in a cloud account, make sure you have console recovery, a serial console, a rescue image, or a teammate with out-of-band access. A safe rollout treats the firewall change like a lock change while you are still inside the building.

One simple rollback is a short scheduled flush before you apply risky rules:

```bash
sudo sh -c 'sleep 120; iptables -F; iptables -P INPUT ACCEPT; iptables -P FORWARD ACCEPT' &
```

That command starts a two-minute rollback in the background:

- `sleep 120` gives you time to apply and test the new policy.
- `iptables -F` clears the active rules if you lose access.
- `iptables -P INPUT ACCEPT` and `iptables -P FORWARD ACCEPT` reopen the default policies.
- After a successful second SSH login and web test, cancel the background job or replace this temporary approach with your team's normal change process.

If the second SSH login works, cancel the pending rollback from the original session:

```bash
jobs
kill %1

# Example output:
# [1]+  Running                 sudo sh -c 'sleep 120; iptables -F; iptables -P INPUT ACCEPT; iptables -P FORWARD ACCEPT' &
# [1]+  Terminated              sudo sh -c 'sleep 120; iptables -F; iptables -P INPUT ACCEPT; iptables -P FORWARD ACCEPT'
```

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

The rule set works because the broad safety decisions come first:

- `-P INPUT DROP` makes inbound traffic default to deny.
- `-i lo -j ACCEPT` keeps local loopback traffic working, which matters for apps talking to services on `127.0.0.1`.
- `--ctstate ESTABLISHED,RELATED` allows replies for connections the server already accepted or started.
- `--dport 80` and `--dport 443` expose the public web ports.
- `-s 198.51.100.10 --dport 22` allows SSH only from one admin source. In real production, that source is often a VPN CIDR or bastion host address rather than a single laptop IP.
- The final `LOG` rule records unexpected traffic before the default policy drops it.

The current rule order is visible with line numbers:

```bash
sudo iptables -L INPUT -n --line-numbers

# Example output:
# Chain INPUT (policy DROP)
# num  target  prot opt source          destination
# 1    ACCEPT  all  --  0.0.0.0/0       0.0.0.0/0
# 2    ACCEPT  all  --  0.0.0.0/0       0.0.0.0/0       ctstate RELATED,ESTABLISHED
# 3    ACCEPT  tcp  --  0.0.0.0/0       0.0.0.0/0       tcp dpt:80
# 4    ACCEPT  tcp  --  0.0.0.0/0       0.0.0.0/0       tcp dpt:443
# 5    ACCEPT  tcp  --  198.51.100.10   0.0.0.0/0       tcp dpt:22
# 6    LOG     all  --  0.0.0.0/0       0.0.0.0/0       LOG flags 0 level 4 prefix "iptables dropped: "
```

iptables reads the chain from top to bottom and stops at the first match. Rule order is part of the policy. A broad allow rule above a narrow deny rule can make the deny rule useless because traffic has already matched and moved on.

After you view the chain, decide where the new rule belongs. A new emergency block belongs above any broad allow it needs to override. A new allow for a service belongs above the final log or drop rule. After changing order, test from the real client source because local `curl localhost` skips many inbound firewall paths.

On Ubuntu, many teams use UFW as a friendlier frontend. UFW still configures Linux firewall policy underneath, but the status output is easier to read:

```bash
sudo ufw status numbered

# Example output:
# Status: active
#
#      To                         Action      From
#      --                         ------      ----
# [ 1] 22/tcp                     ALLOW IN    198.51.100.10
# [ 2] 80/tcp                     ALLOW IN    Anywhere
# [ 3] 443/tcp                    ALLOW IN    Anywhere
```

This says SSH is allowed only from `198.51.100.10`, while web ports `80` and `443` are allowed from anywhere. The words `ALLOW IN` mean inbound packets that match those rows can continue. If a reader is still learning iptables, UFW output can be the easier way to confirm the policy intent before checking the lower-level rules.

![iptables rule evaluation infographic showing packets moving through ordered allow and drop rules](/content-assets/articles/article-devops-foundation-networking-firewalls-security/iptables-rule-evaluation.png)

_The image makes ordered rule evaluation visible, which is the key to debugging host firewall surprises._

## Opening Web Traffic Without Opening Everything
<!-- section-summary: A production web path usually exposes only ports 80 and 443 publicly, while app ports stay private behind the proxy or load balancer. -->

Now connect the firewall work to the web-server layout. For a public web app, the browser should reach Nginx on `443`. The browser should not reach the Node, Django, Rails, or Go app port directly. The app port should listen on `127.0.0.1` if Nginx is on the same host, or on a private subnet address if Nginx or a load balancer sits on another host.

A local process check tells you which services are listening and which address each one is bound to:

```bash
sudo ss -tlnp

# Example output:
# State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port Process
# LISTEN  0       511     0.0.0.0:443         0.0.0.0:*         users:(("nginx",pid=1200,fd=7))
# LISTEN  0       511     0.0.0.0:80          0.0.0.0:*         users:(("nginx",pid=1200,fd=6))
# LISTEN  0       128     127.0.0.1:3000      0.0.0.0:*         users:(("node",pid=2200,fd=18))
# LISTEN  0       128     10.0.32.14:22       0.0.0.0:*         users:(("sshd",pid=900,fd=3))
```

This output shows a healthy single-host Nginx deployment:

- `0.0.0.0:443` and `0.0.0.0:80` mean Nginx accepts public web traffic on all IPv4 interfaces.
- `127.0.0.1:3000` means the app accepts traffic only from the same host, so browsers cannot bypass Nginx.
- `10.0.32.14:22` means SSH is bound to a private interface, and firewall source rules can narrow it further.

A quick outside check confirms the public ports:

```bash
nc -vz app.example.com 443

# Example output:
# Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

Now test the private app port from outside:

```bash
nc -vz app.example.com 3000

# Example output:
# nc: connect to app.example.com port 3000 (tcp) failed: Connection timed out
```

That timeout is healthy for the private app port:

- Port `443` succeeds because users need to reach the HTTPS listener.
- Port `3000` times out because only Nginx should talk to the app process directly.
- A successful public connection to `3000` would mean the app port is exposed too widely.

![Defense in depth layers infographic showing load balancer, cloud firewall, host firewall, SSH restriction, fail2ban, and logging](/content-assets/articles/article-devops-foundation-networking-firewalls-security/defense-in-depth-layers.png)

_The image shows web access as layered protection instead of one giant allow rule._

## SSH Hardening for the Admin Path
<!-- section-summary: SSH is a separate admin path, so it needs key-based access, source restrictions, and a safe rollout process. -->

The web path and the admin path need different exposure. Anyone on the internet may need HTTPS, but only trusted operators should reach SSH. If attackers brute-force or steal SSH access, they can change the firewall, Nginx, certificates, or app.

**SSH** is the encrypted remote shell protocol used to manage Linux servers. The common port is `22`. A safer day-to-day setup uses SSH keys, disables password login, blocks direct root login, limits users, and restricts source IPs in the firewall or cloud Security Group. The goal is simple: make the admin door small, named, logged, and hard to guess.

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

SSH hardening has one special danger: you can lock yourself out. After changing SSH config, keep the current SSH session open while a second terminal tests a new login. If the new login fails, the open session can revert the change. This simple habit turns a risky config edit into a controlled rollout.

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

For SSH, fail2ban reads authentication logs. If one IP fails too many times in a short window, it adds a temporary firewall rule that blocks that IP. Think of it as a guard that reacts to evidence after the server sees bad behavior. The locked door still comes from SSH keys, source restrictions, and bastions; fail2ban helps quiet repeated knocking.

A minimal SSH jail looks like this in `/etc/fail2ban/jail.local`:

```ini
[sshd]
enabled = true
port = 22
maxretry = 3
findtime = 600
bantime = 3600
```

This means three failed SSH attempts within ten minutes leads to a one-hour ban. The exact values depend on the environment. Public servers often use stricter rules because automated scanners are constant. Internal systems may choose a softer threshold so a real operator typo does not trigger noisy support work.

The three timing values control how aggressive the jail is:

- `maxretry = 3` allows three failed matches before fail2ban takes action.
- `findtime = 600` counts those failures inside a 600-second window, so slow occasional mistakes do not trigger the same way as rapid guessing.
- `bantime = 3600` blocks the source for 3,600 seconds after the threshold is crossed.

Status output shows what fail2ban is doing:

```bash
sudo fail2ban-client status sshd

# Example output:
# Status for the jail: sshd
# |- Filter
# |  |- Currently failed: 1
# |  `- Total failed: 18
# `- Actions
#    |- Currently banned: 2
#    `- Banned IP list: 203.0.113.40 203.0.113.41
```

The status output gives quick evidence:

- `Currently failed` shows active failures that have not crossed the ban threshold yet.
- `Total failed` shows how noisy the SSH login path has been.
- `Currently banned` and `Banned IP list` show which sources are blocked right now.

fail2ban works best as a reactive layer alongside SSH keys, MFA-protected bastions, VPNs, and cloud policy. It turns repeated log evidence into temporary network blocks.

![fail2ban lifecycle infographic showing log matches, repeated failures, temporary ban, unban time, and operator review](/content-assets/articles/article-devops-foundation-networking-firewalls-security/fail2ban-lifecycle.png)

_The image shows how reactive blocking follows log evidence and should stay temporary and reviewable._

## Firewall Failure Modes
<!-- section-summary: Firewall incidents often come from blocked ports, wrong sources, rule order mistakes, missing state rules, or unsaved host rules. -->

A firewall incident usually arrives as a short, frustrating report: "the checkout page cannot load over HTTPS." Work one request through the path instead of jumping between random rules. The first question is what the client sees, because timeout and refused tell different stories.

If your test from outside times out, a firewall or route may be dropping the packet silently. The browser waits. `nc -vz app.example.com 443` hangs. A server-side packet capture shows whether the SYN packet reached the host:

```bash
sudo tcpdump -i eth0 -n tcp port 443 -c 3

# Example output:
# 12:22:10.100 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
# 12:22:11.120 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
# 12:22:13.160 IP 198.51.100.50.53142 > 10.0.32.14.443: Flags [S], seq 100, length 0
```

Repeated `[S]` packets without a reply mean the client is trying to open TCP, but the server is not sending the SYN-ACK back. That points to a local firewall drop, a missing listener, an asymmetric route, or a capture taken on the wrong interface. If no SYN packets appear at all, inspect cloud firewalls, NACLs, load balancer listeners, and routes before blaming the host firewall.

If your test returns **Connection refused**, the packet reached something and got a rejection. That usually means no process is listening on the port, or a reject rule sent back a TCP reset.

```bash
nc -vz app.example.com 443

# Example output:
# nc: connect to app.example.com port 443 (tcp) failed: Connection refused
```

That output tells a different story from a timeout. Refused traffic reached a host. Timed-out traffic may have been dropped before it arrived. The next useful checks are the listener list with `ss -tlnp` and the firewall rules for port `443`.

If the listener exists and the cloud rule looks correct, check the **source address** the firewall actually sees. SSH or app traffic may be allowed from the office IP, while your laptop is on VPN, home broadband, or a rotated NAT gateway. The rule can look right in the console while the packet source uses a different CIDR. Cloud flow logs, Nginx access logs, and firewall logs reveal the real source.

Next, inspect **rule order**. Ordered firewalls stop at the first matching rule. A broad accept above a narrow drop means the narrow drop never runs:

```bash
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

In that order, the broad accept catches the traffic first. The narrow drop never gets a chance to run. The fix is to place the narrow rule first:

```bash
sudo iptables -I INPUT 1 -s 203.0.113.0/24 -p tcp --dport 443 -j DROP
```

Then check **conntrack** if the request reaches the service but reply traffic behaves strangely. A server can send outbound traffic, but the response packets are dropped on the way back through `INPUT`. The usual iptables rule is:

```bash
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

The conntrack rule allows return traffic that belongs to a connection the host already knows about:

- `-A INPUT` adds the rule to inbound host traffic.
- `-m conntrack` loads connection-tracking matching.
- `--ctstate ESTABLISHED,RELATED` matches reply packets for existing connections and closely related flows.
- `-j ACCEPT` lets those packets through, so outbound connections can receive responses.

Finally, confirm the rule still exists after a reboot or replacement instance. **Unsaved iptables rules** disappear after reboot. This surprises many beginners because the command changed the live firewall, then the server restarted and returned to the previous boot-time policy. On Debian and Ubuntu, `iptables-persistent` can restore saved rules:

```bash
sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
```

The persistence command stores the current IPv4 firewall rules for boot-time restore:

- `iptables-save` prints the active IPv4 rules in restore format.
- `tee /etc/iptables/rules.v4` writes that rule set to the file read by `iptables-persistent`.
- `>/dev/null` hides the duplicate terminal output from `tee`; the important result is the saved file.
- After saving, a reboot test or `sudo iptables-restore < /etc/iptables/rules.v4` in a safe maintenance window proves the rules can reload.

A careful firewall debug path has four checks: the cloud policy allows the intended source and port, the host firewall rule order allows the packet, conntrack allows replies, and a capture or connection test proves the packet reaches the next layer. After port `443` passes the firewall, your browser can move to TLS and Nginx.

![Firewalls and security summary infographic showing rules, cloud firewalls, iptables, web ports, SSH hardening, fail2ban, and failure modes](/content-assets/articles/article-devops-foundation-networking-firewalls-security/firewalls-security-summary.png)

_The summary image gathers firewall controls into one review map for production access._

## References

- [iptables(8) Linux Manual Page](https://man7.org/linux/man-pages/man8/iptables.8.html) - Official Linux manual for iptables rules, chains, targets, and options.
- [nftables Wiki](https://wiki.nftables.org/wiki-nftables/index.php/Main_Page) - Official nftables documentation for modern Linux packet filtering.
- [AWS Security Groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - Official AWS documentation for stateful resource-level firewall rules.
- [AWS Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Official AWS documentation for stateless subnet-level firewall rules.
- [OpenSSH `sshd_config` Manual](https://man.openbsd.org/sshd_config) - Authoritative reference for SSH daemon configuration.
- [fail2ban Documentation](https://fail2ban.readthedocs.io/en/latest/) - Current fail2ban documentation for jails, filters, and actions.
