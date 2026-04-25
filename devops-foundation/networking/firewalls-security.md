---
title: "Firewalls & Security"
description: "Configure iptables rules, understand cloud security groups, and harden SSH access on Linux servers."
overview: "Learn how firewalls filter traffic at every layer, from kernel-level iptables rules to cloud security groups, and apply SSH hardening to keep your servers safe."
tags: ["iptables", "firewall", "ssh", "fail2ban", "security-groups"]
order: 5
---

## Table of Contents

1. [The 90-Second Rule](#the-90-second-rule)
2. [Defense in Depth: Layers of Control](#defense-in-depth-layers-of-control)
3. [iptables: The Linux Packet Filter](#iptables-the-linux-packet-filter)
4. [Cloud Firewalls: Security Groups and NACLs](#cloud-firewalls-security-groups-and-nacls)
5. [SSH Hardening](#ssh-hardening)
6. [Automated Defense with fail2ban](#automated-defense-with-fail2ban)
7. [Firewall Failure Modes](#firewall-failure-modes)

## The 90-Second Rule

You spin up an EC2 instance, install your app, and it works. Congratulations, it is also reachable by every scanner on the internet. Your first SSH brute-force attempt arrives within 90 seconds. That is not an exaggeration. Automated bots sweep entire IP ranges 24/7, probing for open ports, default credentials, and known vulnerabilities. If your instance has a public IP and port 22 is open, something will knock on it before you finish reading this paragraph.

If you have only ever deployed to Heroku or Vercel, this feels alien. Those platforms hide the infrastructure layer from you. There is no SSH port to protect, no network traffic to filter, no firewall to configure. The platform handles all of that. But the moment you provision your own server, whether on AWS, GCP, DigitalOcean, or a bare-metal box, you inherit responsibility for every packet that reaches it. A firewall is the tool that lets you decide which packets get in and which ones get silently discarded.

A firewall is not antivirus software and it is not an intrusion detection system. It is simpler than both. A firewall is a set of rules that inspects each network packet and makes a binary decision: allow it through, or drop it. Think of it like the bouncer at a venue door. The bouncer does not care what you do once you are inside. It only checks whether you are on the list before letting you past the rope.

The rest of this article walks through every layer of firewall you will encounter as a DevOps engineer: kernel-level packet filtering with iptables, cloud-level security groups and NACLs, SSH hardening, and automated defense with fail2ban. By the end, you will know how to lock down a server so that only the traffic you explicitly allow can reach your services.

## Defense in Depth: Layers of Control

A single firewall is not enough. If one layer has a misconfiguration or a bug, the next layer catches what slipped through. This principle is called defense in depth, and it is the reason production systems stack multiple independent controls on top of each other.

Think about it in layers you already interact with. A React app might have client-side form validation, server-side input validation, database constraints, and parameterized queries. No single layer is bulletproof, but an attacker would need to bypass all four to inject bad data. Network security works the same way.

Here are the layers from bottom to top:

**Kernel-level filtering (iptables/nftables).** This is the lowest layer. The Linux kernel inspects every packet that arrives at a network interface and applies rules before the packet ever reaches your application. It runs on the machine itself and is always present, even if no cloud provider is involved. This is the equivalent of Express middleware that runs before any route handler.

**Cloud firewalls (security groups, NACLs).** These operate at the cloud provider's network layer, outside your machine entirely. A security group sits in front of your instance like a gatekeeper. Even if iptables on the instance is wide open, the security group can still block traffic before it arrives. This is like CORS rules in your browser: the request might be valid, but the policy layer rejects it before your code ever sees it.

**Application-level controls (authentication, rate limiting, WAFs).** Your app itself decides who can do what. A web application firewall (WAF) filters HTTP requests for SQL injection patterns, cross-site scripting, and other malicious payloads. Rate limiting prevents abuse. Authentication ensures that only authorized users reach sensitive endpoints.

Each layer is independent. A misconfigured security group does not affect iptables. A bug in your WAF does not weaken SSH hardening. This independence is what makes defense in depth work. You are not stacking identical protections; you are covering different failure modes at different points in the network path.

## iptables: The Linux Packet Filter

Every Linux system ships with Netfilter, the kernel-level packet filtering framework. `iptables` is the user-space tool that configures it. Even if you use higher-level tools like `firewalld` or `ufw`, they all generate iptables rules underneath. Understanding iptables directly means you can debug any Linux firewall, regardless of which frontend someone chose.

### Chains, Rules, and Targets

Picture a building with three doors and a guard at each. The first door is for visitors arriving (`INPUT`), the second for people leaving (`OUTPUT`), the third for deliveries passing through to another building next door (`FORWARD`). Each guard has a clipboard with a numbered list of rules: "if the visitor is wearing red, let them in; if they have a backpack, send them away." The guard reads the list top to bottom and acts on the first rule that matches. If nothing matches, a default rule at the bottom of the clipboard decides what happens. The Linux firewall is exactly this, and the three doors have a name: **chains**.

Most of your work happens at the `INPUT` door, because that is where attackers knock. A web server's `INPUT` clipboard says: "if the packet is heading to port 80 or 443, let it in; if it is heading to port 22, let it in; otherwise, drop it on the floor." The `OUTPUT` door is usually wide open, because servers need to fetch updates, call APIs, and look up DNS. Locked-down environments do tighten `OUTPUT` to prevent a compromised process from phoning home to an attacker, but that is the exception. The `FORWARD` door only matters when the machine is acting as a router. If you ever debug Kubernetes networking, you will spend time in `FORWARD` rules because every pod-to-pod packet passes through there.

When a rule matches, the guard does one of three things, called the **target**:

- `ACCEPT` waves the packet through.
- `DROP` silently throws it in the trash. The sender hears nothing back and eventually times out.
- `REJECT` throws it in the trash but sends back a polite "no" message (an ICMP error).

For anything facing the public internet, `DROP` beats `REJECT`. A `REJECT` confirms to the scanner that something is listening on this IP, just not on this port. A `DROP` makes the scanner waste time waiting for a response that never comes, and gives them no signal at all. Silence is the best answer to a stranger trying door handles.

The "default rule at the bottom of the clipboard" has its own name: the chain's **policy**. If your `INPUT` policy is `ACCEPT`, the guard waves through anything that didn't match a specific rule. That is the "no bouncer" state and it is what you get on a fresh server. You want the policy to be `DROP` so that the only way in is through a rule you explicitly wrote. This is called **default-deny**, and it is the only sane way to run a firewall. The cost is that the rules become harder to write, because forgetting a single rule (say, the one that allows SSH) locks you out of your own server. We will cover that exact failure mode at the end of the article.

### Building a Rule Set

Here is a complete, minimal firewall for a web server that also accepts SSH:

```bash
$ sudo iptables -L -n -v --line-numbers
```

Start by viewing your current rules. On a fresh server, you will see empty chains with ACCEPT policies, meaning everything is allowed. That is the "no bouncer" state. Fix it:

```bash
$ sudo iptables -P INPUT DROP
$ sudo iptables -P FORWARD DROP
$ sudo iptables -P OUTPUT ACCEPT
```

These three commands set the default policy for each chain. INPUT and FORWARD default to DROP (deny everything unless a rule explicitly allows it). OUTPUT defaults to ACCEPT because most servers need unrestricted outbound access to fetch updates, talk to APIs, and resolve DNS.

```bash
$ sudo iptables -A INPUT -i lo -j ACCEPT
```

Rule 1: allow loopback traffic. The loopback interface (`lo`) is how the machine talks to itself. Many services (databases, caches, internal APIs) listen on `127.0.0.1`. Without this rule, your own applications cannot communicate with each other on the same machine.

```bash
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

Rule 2: allow replies to conversations the server already started. Imagine your server calls an API to fetch a JSON payload. The outbound request leaves through `OUTPUT` (which is wide open). The reply has to come back through `INPUT`, but the reply is a brand-new inbound packet from the API's IP, on some random high port your server picked. None of your specific allow rules cover it. Without this rule, your server could shout questions into the internet and never hear the answers.

The kernel solves this with **connection tracking** (`conntrack`), basically a notebook the kernel keeps of every active network conversation: "my server opened a connection to 1.2.3.4 on port 443 from local port 54321 at 10:32; it's still open." When a packet arrives, conntrack checks the notebook. If the packet matches an entry, it gets the state `ESTABLISHED` (a reply to one of our conversations) or `RELATED` (a side-channel message about one of our conversations, like an ICMP "destination unreachable"). This rule says: if the packet is part of a conversation we already started, let it in. This is what "stateful firewall" actually means: the firewall remembers state about open connections, so you don't have to write separate rules for every reply packet.

```bash
$ sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

Rules 3 through 5: allow SSH, HTTP, and HTTPS. Each rule specifies the protocol (`-p tcp`) and destination port (`--dport`). Only these three ports will accept new inbound connections. Everything else hits the default DROP policy.

```bash
$ sudo iptables -A INPUT -j LOG --log-prefix "DROPPED: " --log-level 4
```

Rule 6: log everything that makes it past the allow rules before the default policy drops it. The log entries appear in `/var/log/kern.log` or `/var/log/messages` depending on your distribution. This gives you visibility into what is being blocked, which is essential for debugging and for spotting attack patterns.

Now verify the complete rule set:

```bash
$ sudo iptables -L -n --line-numbers
Chain INPUT (policy DROP)
num  target     prot opt source               destination
1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0
2    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            ctstate RELATED,ESTABLISHED
3    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22
4    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80
5    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:443
6    LOG        all  --  0.0.0.0/0            0.0.0.0/0            LOG flags 0 level 4 prefix "DROPPED: "

Chain FORWARD (policy DROP)
num  target     prot opt source               destination

Chain OUTPUT (policy ACCEPT)
num  target     prot opt source               destination
```

Read this output from top to bottom, because that is exactly how the kernel evaluates it. A packet arriving on the loopback interface matches rule 1 and is accepted immediately. A packet that is part of an existing connection matches rule 2. A new TCP connection to port 22 matches rule 3. Anything that does not match any rule gets logged by rule 6 and then dropped by the chain's default policy.

> The default should always be deny. Every open port is a deliberate, documented decision. If you cannot explain why a port is open, close it.

Finally, save your rules so they persist across reboots:

```bash
$ sudo iptables-save > /etc/iptables/rules.v4
```

On Debian and Ubuntu, the `iptables-persistent` package restores these rules automatically at boot. On RHEL-based systems, use `iptables-save > /etc/sysconfig/iptables` instead. If you skip this step, a reboot wipes your entire firewall back to the default "allow everything" state.

## Cloud Firewalls: Security Groups and NACLs

The classic junior moment: you launch an EC2 instance, install your app, run `curl localhost:3000` from the box and it works perfectly. Then you open the public IP in your browser and it just spins. "It works locally but not in prod." Nine times out of ten, the answer is not your code. It is an AWS Security Group blocking port 3000. The cloud provider runs its own firewall that sits in front of your instance, and `iptables` on the box can't help you, because the packet never reaches the box in the first place.

AWS gives you two of these cloud firewalls, layered on top of each other, and juniors mix them up constantly. Get this distinction in your head once and you will save yourself hours of debugging.

**Security Groups** wrap individual resources: one EC2 instance, one RDS database, one Lambda function inside a VPC. Think of them as a personal bodyguard assigned to that resource. The bodyguard is stateful, meaning it remembers conversations: if you allow inbound port 443, replies to those connections are automatically allowed back out without a separate rule. You only write inbound rules and outbound rules; the bodyguard fills in the return-trip details for you. The default Security Group denies all inbound traffic and allows all outbound traffic, which matches what most apps actually need. If you have set CORS on a web API ("only allow requests from these origins"), Security Groups follow the same allowlist mindset, just at the network layer instead of the HTTP layer. The same idea shows up again in Kubernetes as `NetworkPolicy`, which is essentially a per-pod Security Group: "this pod accepts traffic only from pods with these labels on these ports."

**Network ACLs (NACLs)** wrap entire subnets. Think of them as a checkpoint at the gate of a neighborhood, not the door of a single house. Every packet entering or leaving the subnet passes through the NACL, regardless of which instance it is going to. The catch: NACLs are **stateless**. The checkpoint guard has no memory. If you allow inbound traffic on port 443, you also have to write a separate outbound rule for the reply traffic, which goes out on a random **ephemeral port** in the range 1024-65535 (an ephemeral port is just a temporary port the OS picks for the client side of a TCP connection). Forget that outbound rule and inbound requests arrive but replies get dropped, and your app looks broken in a baffling "requests come in but never finish" way. NACLs also evaluate rules in order by rule number, first match wins, just like iptables.

Here is the practical difference:

| Feature | Security Group | Network ACL |
|---------|---------------|-------------|
| Scope | Instance-level | Subnet-level |
| Statefulness | Stateful (return traffic auto-allowed) | Stateless (must allow both directions) |
| Default | Deny all inbound, allow all outbound | Allow all (default NACL) |
| Rule evaluation | All rules evaluated together | Rules processed in order by number |
| Use case | Per-instance access control | Subnet-wide guardrails |

The combination of Security Groups (instance-level, stateful) and NACLs (subnet-level, stateless) gives you defense in depth at the cloud layer. A compromised instance with a misconfigured Security Group still has the NACL as a backstop. In practice, most teams rely heavily on Security Groups for day-to-day access control and use NACLs as a coarse safety net at the subnet boundary. Layer on top of that whatever your team uses for HTTP-level filtering (Cloudflare WAF, AWS WAF, an Nginx reverse proxy with rate limits) and you are filtering bad traffic at four different points before it reaches your application code.

One more place this layering bites juniors: Docker. When you run `docker run -p 8080:80 nginx`, Docker quietly inserts iptables rules that punch a hole through the host firewall to forward port 8080 to the container. People then add an iptables `DROP` rule for port 8080 and are surprised it does nothing, because Docker's rules are evaluated first. If your container's published port is unexpectedly reachable, check `iptables -L DOCKER -n` before assuming your firewall is broken.

```bash
$ aws ec2 describe-security-groups \
    --group-ids sg-0123456789abcdef0 \
    --query 'SecurityGroups[].IpPermissions[]'

$ aws ec2 describe-network-acls \
    --filters "Name=vpc-id,Values=vpc-abc123" \
    --query 'NetworkAcls[].Entries[]'
```

These AWS CLI commands let you inspect the actual rules in place. When something is not reachable and you cannot figure out why, check both the security group on the instance and the NACL on the subnet. It is almost always one of the two.

One more cloud-firewall trap that does not look like a firewall at all: idle timeouts on managed load balancers. AWS NLB drops idle TCP flows after 350 seconds, ALB after 60 seconds, and most cloud NAT gateways sit somewhere in between. The connection is still open from your application's point of view, but the next packet hits a stale entry on the LB and gets a TCP RST. The fix is to enable TCP keepalives in the application or kernel (`net.ipv4.tcp_keepalive_time`) below the LB's idle timeout, or shorten your client-side connection pool's max idle time.

## SSH Hardening

SSH is the remote access protocol for every Linux server. When you run `ssh user@your-server`, you are opening an encrypted tunnel that gives you a full shell on the remote machine. A default SSH configuration is functional but dangerously permissive: it accepts password logins, allows root to log in directly, and listens on the well-known port 22 where every bot on the internet expects to find it.

Hardening SSH is your first real security task on any new server. It takes ten minutes and eliminates entire categories of attacks. Think of it as locking the front door of a house you just moved into. The house works fine without a lock, but you would not sleep there without one.

Edit `/etc/ssh/sshd_config` and apply these changes:

```bash
# Disable password authentication (key-based only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable root login
PermitRootLogin no

# Change the default port (reduces noise from automated scanners)
Port 2222

# Limit authentication attempts
MaxAuthTries 3

# Disable empty passwords
PermitEmptyPasswords no

# Restrict to specific users
AllowUsers deploy admin

# Use only strong key exchange algorithms
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
```

Each setting addresses a specific attack vector. `PasswordAuthentication no` eliminates brute-force password guessing entirely; attackers cannot try passwords if the server refuses to accept them. `PermitRootLogin no` prevents direct root access, forcing attackers to compromise a regular user account first and then escalate privileges. `AllowUsers` restricts SSH access to named accounts, so even if someone creates a new system user, it cannot SSH in unless explicitly listed.

After saving the file, restart the SSH daemon:

```bash
$ sudo systemctl restart sshd
```

Changing the SSH port from 22 to something non-standard is not real security. It is obscurity. But it reduces log noise from automated scanners by over 99%, which makes real attack attempts visible in your logs instead of buried under thousands of bot login failures. Combine the port change with key-based authentication and fail2ban for meaningful protection.

One critical warning: before you set `PasswordAuthentication no`, make sure your SSH key is already installed on the server and you can log in with it. If you disable passwords before setting up key-based auth, you are locked out. If this is a cloud instance, your only recovery option is detaching the disk, mounting it on another instance, editing the config file, and reattaching it. This brings us to the failure modes section later in this article.

## Automated Defense with fail2ban

Even with strong SSH hardening, your logs will still show failed login attempts from bots that try common usernames like `root`, `admin`, and `ubuntu`. These attempts are harmless if key-based auth is enabled, but the noise makes it hard to spot real threats. `fail2ban` solves this by monitoring log files and automatically banning IP addresses that show malicious behavior.

fail2ban watches for patterns in your logs (repeated failed SSH logins, failed web authentication attempts, and other configurable triggers) and creates temporary iptables rules to block the offending IPs. It is reactive defense: something bad happens, fail2ban notices, and it slams the door shut before more damage can occur.

```bash
$ sudo apt install fail2ban
```

Never edit the main config file (`jail.conf`) directly. It gets overwritten on package updates. Instead, create a local override:

```bash
$ sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
```

Edit `/etc/fail2ban/jail.local` and configure the SSH jail:

```ini
[sshd]
enabled = true
port = 2222
maxretry = 3
bantime = 3600
findtime = 600
```

This configuration watches for SSH login failures on port 2222. If an IP address fails 3 times (`maxretry`) within 10 minutes (`findtime`, in seconds), fail2ban blocks that IP for 1 hour (`bantime`, in seconds) by inserting a DROP rule into iptables.

Start and enable the service:

```bash
$ sudo systemctl enable fail2ban
$ sudo systemctl start fail2ban
```

Check the current status of the SSH jail:

```bash
$ sudo fail2ban-client status sshd
Status for the jail: sshd
|- Filter
|  |- Currently failed:	2
|  |- Total failed:	15
|  `- File list:	/var/log/auth.log
`- Actions
   |- Currently banned:	1
   |- Total banned:	3
   `- Banned IP list:	203.0.113.42
```

The output shows how many login attempts have failed, how many IPs are currently banned, and which specific addresses are blocked. Each banned IP gets a temporary iptables rule that drops all traffic from it for the configured ban duration. After the ban expires, the rule is removed automatically and the IP can try again.

If you accidentally ban your own IP (it happens), you can unban it manually from a different session or from the server console:

```bash
$ sudo fail2ban-client set sshd unbanip 203.0.113.42
```

## Firewall Failure Modes

Firewalls protect you, but they can also lock you out or silently break your services if misconfigured. These are the most common ways things go wrong, and knowing them in advance will save you from panic at 2 AM.

### Locked out of SSH

This is the single most common firewall disaster. You set the default INPUT policy to DROP but forget to add the SSH allow rule first. Or you change the SSH port in `sshd_config` to 2222 but your iptables rule still allows port 22. Either way, your next connection attempt hangs and you are locked out.

Prevention: always add your SSH allow rule before setting the policy to DROP. Run both commands in the same session, in the right order:

```bash
$ sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
$ sudo iptables -P INPUT DROP
```

If you are changing the SSH port, add a rule for the new port before removing the rule for the old one. Keep your current SSH session open while you test the new port from a second terminal. Do not close the working session until you confirm the new connection works.

On cloud instances, if you are completely locked out, most providers offer a serial console or instance console that bypasses the network entirely. In AWS, you can also stop the instance, detach its root volume, mount it on another instance, fix the config, and reattach it.

### Accidentally dropped all traffic

You run `sudo iptables -P INPUT DROP` on a fresh server with no allow rules. Every connection dies instantly, including your SSH session. This is the "pulled the rug out from under yourself" scenario.

If you are working on a remote server and want a safety net, schedule a cron job that flushes all rules after 5 minutes:

```bash
$ echo "sudo iptables -F && sudo iptables -P INPUT ACCEPT" | at now + 5 minutes
```

This gives you a 5-minute window to test your rules. If something goes wrong and you get locked out, the cron job will reset the firewall and restore access. Once you have confirmed everything works, cancel the scheduled job.

### Rule order mistakes

Because iptables evaluates rules top to bottom and stops at the first match, order matters. A common mistake is placing a broad ACCEPT rule before a specific DROP rule: the broad rule matches first and the specific rule never fires.

```bash
$ sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
$ sudo iptables -A INPUT -s 203.0.113.0/24 -p tcp --dport 80 -j DROP
```

This looks like it blocks the `203.0.113.0/24` subnet from port 80, but it does not. Rule 1 accepts all TCP traffic on port 80 regardless of source. The DROP rule never gets evaluated for port 80 traffic. The fix is to reverse the order: put the more specific rule first.

```bash
$ sudo iptables -A INPUT -s 203.0.113.0/24 -p tcp --dport 80 -j DROP
$ sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
```

If you need to insert a rule at a specific position in an existing chain rather than appending it to the end, use `-I` (insert) instead of `-A` (append):

```bash
$ sudo iptables -I INPUT 1 -s 203.0.113.0/24 -p tcp --dport 80 -j DROP
```

This inserts the rule at position 1, pushing all existing rules down by one.

### Conntrack Table Overflow

Stateful filtering needs a slot in the conntrack table for every active flow. The table has a hard ceiling (`net.netfilter.nf_conntrack_max`, often 65,536 or 262,144 by default). On a busy host (NAT gateway, reverse proxy, anything fronting a high-fanout service), bursts of new connections can fill the table and the kernel starts dropping new packets with `nf_conntrack: table full, dropping packet` in `dmesg`. The connection counter and the limit are visible directly:

```bash
$ sudo sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max
net.netfilter.nf_conntrack_count = 245112
net.netfilter.nf_conntrack_max = 262144
```

The fix is either raising `nf_conntrack_max`, lowering `nf_conntrack_tcp_timeout_established` (default is 5 days, which holds entries forever), or marking high-volume non-stateful traffic with `-j CT --notrack` so it bypasses conntrack entirely. Symptoms look exactly like a firewall problem (random new connections fail while existing ones keep working) but no rule was changed.

### Forgot to save rules

You spend 30 minutes building a careful iptables rule set. It works perfectly. You reboot the server for a kernel update, and when it comes back up, the firewall is wide open again. All your rules are gone.

iptables rules live in kernel memory. They do not persist to disk unless you explicitly save them. On Debian and Ubuntu, save with:

```bash
$ sudo iptables-save > /etc/iptables/rules.v4
```

Install the `iptables-persistent` package to restore these rules automatically at boot:

```bash
$ sudo apt install iptables-persistent
```

On RHEL-based systems (CentOS, Rocky, AlmaLinux), the path is different:

```bash
$ sudo iptables-save > /etc/sysconfig/iptables
$ sudo systemctl enable iptables
```

Make saving your rules the last step of every firewall change session. Building rules without saving them is like writing code without committing.

---

**References**

- [iptables(8) - Linux Admin Man Page](https://man7.org/linux/man-pages/man8/iptables.8.html) - Comprehensive reference for iptables rule syntax, chain management, and match extensions.
- [Netfilter Connection Tracking](https://conntrack-tools.netfilter.org/manual.html) - Deep dive into the conntrack system that makes stateful firewalling possible in the Linux kernel.
- [AWS Security Groups Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - Official guide to security group rules, defaults, and best practices for EC2 and VPC resources.
- [AWS Network ACLs Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - How NACLs work at the subnet level and why they complement security groups.
- [OpenSSH sshd_config Manual](https://man.openbsd.org/sshd_config) - The authoritative reference for every SSH daemon configuration directive.
- [fail2ban Documentation](https://www.fail2ban.org/wiki/index.php/Main_Page) - Official wiki covering jail configuration, filter definitions, and action plugins.
