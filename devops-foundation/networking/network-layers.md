---
title: "Network Layers"
description: "Trace what happens between fetch() and a server response by learning the TCP/IP and OSI layer models, encapsulation, and where things break."
overview: "Understand how data travels across a network by learning the layered models that every protocol, firewall rule, and debugging tool is built around."
tags: ["tcp/ip", "osi", "tcpdump", "encapsulation"]
order: 1
---

## Table of Contents

1. [Why Layers Matter](#why-layers-matter)
2. [The Mental Model: Envelopes Inside Envelopes](#the-mental-model-envelopes-inside-envelopes)
3. [The TCP/IP Model](#the-tcpip-model)
4. [The OSI Model as a Debugging Map](#the-osi-model-as-a-debugging-map)
5. [How Data Travels Down the Stack](#how-data-travels-down-the-stack)
6. [Seeing the Layers with tcpdump](#seeing-the-layers-with-tcpdump)
7. [Where Each Layer Breaks](#where-each-layer-breaks)

## Why Layers Matter

You call `fetch()` in JavaScript, and a few hundred milliseconds later JSON shows up. What actually happens in between? Your browser has to figure out which server to talk to, open a connection, negotiate encryption, package your request into chunks that fit on a wire, slap addressing information onto each chunk, and shove electrical (or optical, or radio) signals down a cable. On the other side, a server does all of that in reverse before your Express route handler ever sees the request.

That is an enormous amount of work, and no single piece of software handles all of it. Instead, networking is split into layers. Each layer has one job and trusts the layers above and below it to handle theirs. Your application code (the `fetch()` call) does not worry about IP addresses. The IP routing logic does not worry about whether it is carrying HTTP or DNS traffic. The Ethernet hardware does not care what the IP address is; it just pushes electrical pulses down the wire.

Why should you, as a developer, care about any of this? Because when something breaks, the fix depends on which layer is broken. A misconfigured firewall is a different problem from a bad Ethernet cable, and both are different from your app returning a 500 error. If you do not know which layer to look at, you waste hours guessing. If you do, you solve the problem in minutes.

## The Mental Model: Envelopes Inside Envelopes

Before diving into specific layers, it helps to have a mental model for how they interact. The concept is called encapsulation, and the best analogy is nested envelopes.

Imagine you write a letter (your application data). You fold the letter and put it in a small envelope, then write the recipient's apartment number on it (this is like adding a port number, so the data reaches the right program on the destination machine). You put that small envelope inside a medium envelope and write the street address on the outside (this is like adding an IP address). Then you put the medium envelope inside a large envelope and write the building's physical mailbox label on it (this is like adding a MAC address, the hardware identifier for the destination's network card). You hand the whole stack to the mail carrier.

Each envelope layer was added by a different "layer" of the mail system, and each one only reads the information on its own envelope. The mail carrier does not open the medium envelope to read the apartment number. The concierge who gets the medium envelope does not open the inner one to read the letter. Each layer peels off its envelope, reads just enough to decide where to send it next, and passes the rest upward.

On a network, this is exactly what happens. Each layer adds a header (and sometimes a trailer) to the data from the layer above, then passes the whole bundle downward. When it arrives at the destination, each layer strips off its header and hands the inner payload up to the next layer. The technical term for adding headers on the way down is **encapsulation**. Stripping them on the way up is **decapsulation**.

```text
┌────────────────────────────────────────────────────────┐
│  Ethernet Header  │  IP Header  │ TCP Header │  Data  │
│  (MAC addresses)  │ (IP addrs)  │  (ports)   │        │
└────────────────────────────────────────────────────────┘
       Layer 2           Layer 3      Layer 4     Layer 7
   "Which device?"   "Which host?" "Which app?" "The actual
                                                  content"
```

This nesting is why a network engineer can swap out the physical cable (fiber instead of copper) without changing anything about your HTTP request. The inner envelopes are untouched. It is the same reason you can switch from HTTP to WebSockets without changing the underlying IP routing. Each layer is independent.

## The TCP/IP Model

Two layer models come up in every networking conversation: TCP/IP and OSI. The TCP/IP model is the one that actually runs the internet, so we will start there. It has four layers, and each one maps to something you can point at in a real system.

### Application Layer

This is where your code lives. When you call `fetch('https://api.example.com/users')`, your browser is speaking HTTP, which is an application-layer protocol. DNS (which turns `api.example.com` into an IP address), SSH (which lets you remote into a server), and SMTP (which sends email) all live here too.

You can think of this layer as the "what are we actually saying?" layer. It defines the structure and meaning of messages. Everything below this layer is just plumbing to get those messages from one machine to another.

### Transport Layer

The transport layer answers two questions: which program on the destination machine should receive this data, and how reliable does the delivery need to be?

The "which program" part is handled by port numbers. A port is just a 16-bit number (0 to 65535) that identifies a specific application on a machine. When your browser connects to a web server, it sends traffic to port 443 (HTTPS) or port 80 (HTTP). The server's operating system looks at the destination port in each incoming packet and delivers it to whichever program registered for that port. It works like apartment numbers in a building: the street address (IP) gets you to the building, and the apartment number (port) gets you to the right door. This is why running two servers on the same port fails with `EADDRINUSE` in Node, or why `docker run -p 3000:3000` complains if something else already grabbed 3000.

The "how reliable" part comes down to choosing between two protocols. The first is TCP (Transmission Control Protocol), and it is what you have been using all along without thinking about it. Every `fetch()`, every `curl https://...`, every SSH session, every Postgres query goes over TCP. Its job is to make a fundamentally unreliable network (where packets get dropped, duplicated, and reordered constantly) look like a clean, ordered byte stream to your application.

Before two computers can have a real conversation, they need to agree they are both ready to talk and that neither side is hallucinating the other's existence. Think of calling a friend on the phone: you say "hey, can you hear me?", they say "yeah, can you hear me?", you say "yep". Now you can actually talk. TCP does the exact same thing in three packets, called SYN, SYN-ACK, and ACK. If any of the three is dropped, the connection never opens, which is why a misconfigured firewall feels like the request "hangs" instead of immediately failing: your machine is still waiting for "yeah, I hear you". Open the Network tab in your browser DevTools and look at the timing breakdown of any request. The "Connecting" or "Initial connection" segment is exactly that handshake.

Once the connection is open, every chunk of data gets a sequence number (basically "this is byte 1 to 1460 of our conversation, this is byte 1461 to 2920") and the other side sends back acknowledgments ("got everything up to byte 2920"). If an acknowledgment never arrives, TCP assumes the chunk got lost and resends it. It also slows down when it sees losses (a behavior called congestion control) and speeds up when the network looks healthy. You never write any of this code yourself; the operating system's TCP implementation handles it underneath your `fetch` or `requests.get`. You only feel it indirectly, as latency in the DevTools waterfall.

UDP (User Datagram Protocol) skips all of that. No handshake, no acknowledgments, no ordering guarantees. Your program hands a packet to the OS and the OS sends it. If it arrives, great. If it does not, your program has to notice and decide what to do. That sounds reckless, but it is perfect for cases where speed matters more than perfection. DNS lookups use UDP because the request and response each fit in a single tiny packet and a retry is faster than negotiating a connection. Video calls and screen sharing (the technology behind Zoom, Google Meet, and the WebRTC APIs in your browser) use UDP because a dropped video frame is fine, but a two-second delay caused by waiting for retransmissions is not. Online games use it for the same reason. Newer web protocols like HTTP/3 and gRPC's QUIC transport are also built on UDP, layering their own reliability and ordering on top so they can avoid TCP's slow start and head-of-line blocking.

### Internet Layer

This layer handles addressing and routing across networks. Every device on a network gets an IP address, and routers (devices whose entire job is forwarding packets toward their destination) use these addresses to decide where to send each packet next. Think of IP addresses as street addresses and routers as postal sorting facilities. Each facility looks at the destination on the envelope, picks which truck (which neighboring router) to send it to, and forgets about it. There is no central planner that knows the whole route from your laptop to a server in Frankfurt. Each hop just makes a local "closer to Frankfurt or further?" decision based on its routing table.

The key protocol here is IP (Internet Protocol), which comes in two versions. IPv4 addresses look like `192.168.1.42` (four numbers separated by dots, each 0-255). IPv6 addresses look like `2001:0db8:85a3::8a2e:0370:7334` (eight groups of hexadecimal digits, with `::` shortening runs of zeroes). IPv4 is still dominant in most environments you will work with, but IPv6 adoption is growing.

Two small fields in the IP header are worth knowing about because they explain a lot of weird behavior. The first is the TTL (Time To Live). It is just a counter, usually starting at 64 or 128, that every router decrements by one before forwarding the packet. If it ever hits zero, the packet is dropped and the router sends back an "expired" message. The original purpose was to prevent packets from looping forever in a misconfigured network, but it also turned out to be a clever debugging trick. The `traceroute` command sends a packet with TTL=1, gets back an expired message from the first router (revealing its IP), then sends one with TTL=2, gets a response from the second router, and so on. That is literally how it maps every hop between you and a destination. You are watching TTL fail, on purpose.

The second is fragmentation. Different networks have different maximum packet sizes (the MTU, or Maximum Transmission Unit, typically 1500 bytes on Ethernet but lower on some VPN tunnels and mobile networks). If a packet is larger than the next link can carry, it has to be split into smaller pieces and reassembled at the destination. Fragmentation is slow and breaks in subtle ways when firewalls drop the resulting fragments. The symptom is usually that small requests work fine but large uploads or responses hang. If you ever see a "PMTU black hole", that is what is happening, and the fix is usually lowering the MTU on the affected interface or VPN.

ICMP (Internet Control Message Protocol) also lives at this layer. It is the protocol behind `ping` and `traceroute`, two tools you will reach for constantly when debugging connectivity issues. ICMP is also how the TTL-expired and "fragmentation needed" messages above get sent back to the sender, which is why aggressively blocking all ICMP at a firewall is a classic mistake: it breaks `ping`, but it also breaks PMTU discovery and silently causes large requests to hang.

### Network Access Layer

This is the bottom of the stack, combining everything about getting bits onto a physical medium and delivering them to the next device on the local network. Ethernet, Wi-Fi, and fiber optics all live here.

The critical concept at this layer is the MAC address (Media Access Control address), a hardware identifier burned into every network card. It looks like `02:42:ac:11:00:02`, six groups of hexadecimal digits. The first half of those bytes identifies the manufacturer of the card (a registered code assigned by the IEEE), and the second half is a serial number. The whole address is supposed to be globally unique. You can see your machine's MAC addresses with `ip link` on Linux or `ifconfig` on macOS.

The surprising thing about MAC addresses is how short their reach is. They only matter for one hop, the trip from your machine to whichever device sits at the other end of the cable or radio link. As soon as the packet enters that next device (your router, a Wi-Fi access point, a switch), the original MAC addresses are thrown away and replaced with new ones for the next hop. By the time your `fetch()` reaches a server in another country, the MAC addresses on the frame have been rewritten dozens of times. The IP address stays constant end-to-end; the MAC address is purely local.

This is also where the difference between a hub and a switch becomes interesting. An old-style Ethernet hub just shouted every incoming frame out of every port: every machine heard every conversation and ignored the ones not addressed to it. A switch is smarter. It learns which MAC address sits behind which physical port and forwards each frame only to the relevant one. You almost never see hubs anymore (they are slow and a security nightmare), but the language has stuck around: people still casually call switches "hubs".

ARP (Address Resolution Protocol) is the glue between the Internet layer and this one. Your operating system has the destination's IP address, but the network card needs a MAC address to actually put a frame on the wire. So the machine effectively shouts into the local network: "Whoever has 192.168.1.1, tell me your MAC address." The device with that IP replies directly, and your machine caches the answer in its ARP table so it does not have to ask again for a few minutes. The shouting works because ARP requests are sent to a special broadcast MAC address that every device on the local segment listens to. You can inspect the cache anytime with `ip neigh show` (covered later in the debugging section). When ARP fails (wrong subnet mask, blocked broadcast, the destination is powered off), nothing on the IP layer above will work either, no matter how perfect the routing table looks.

| OSI Layer | OSI Name | TCP/IP Layer | What lives here |
|-----------|----------|-------------|-----------------|
| 7 | Application | Application | HTTP, DNS, SMTP, SSH |
| 6 | Presentation | Application | TLS encryption, data encoding |
| 5 | Session | Application | Connection management, multiplexing |
| 4 | Transport | Transport | TCP, UDP, port numbers |
| 3 | Network | Internet | IP addressing, routing |
| 2 | Data Link | Network Access | Ethernet frames, MAC addresses, switches |
| 1 | Physical | Network Access | Cables, radio signals, NICs |

The diagram above shows how the two models map to each other. The TCP/IP Application layer absorbs OSI layers 5, 6, and 7 because in practice, modern protocols handle session management and data encoding as part of the application itself (your TLS library, your HTTP/2 implementation). The TCP/IP Network Access layer combines OSI layers 1 and 2 because the physical medium and the local addressing scheme are tightly coupled; swapping Ethernet for Wi-Fi changes both simultaneously.

## The OSI Model as a Debugging Map

You will hear people on incident calls say "that is a Layer 3 problem" or "check Layer 7". They are usually referring to the OSI model, which has seven layers instead of four. The OSI model was designed decades ago as a theoretical framework, and no real protocol stack implements it exactly (TCP/IP won the actual implementation war). But its numbering system became the universal vocabulary for pointing at where in the stack something is happening, the way "500" became shorthand for "the server messed up" even outside HTTP. Treating it as a debugging map (a checklist of where things can break) is more useful than memorizing it as a clean theoretical hierarchy.

Here is the full model. The "When you care" column is the important part: it tells you what kind of problem or tool lives at each layer.

| Layer | Name | What It Does | When You Care |
|-------|------|-------------|---------------|
| 7 | Application | Defines the protocol your app speaks (HTTP, DNS, SSH) | App returns wrong status codes, API errors, SSL certificate mismatches |
| 6 | Presentation | Handles encoding, encryption, compression | TLS handshake failures, character encoding issues |
| 5 | Session | Manages connections between applications | WebSocket drops, session timeouts, connection pooling bugs |
| 4 | Transport | Chooses TCP vs UDP, assigns port numbers, handles reliability | Port blocked by firewall, connection refused, retransmission storms |
| 3 | Network | Routes packets using IP addresses | Cannot reach host, routing loops, subnet misconfiguration |
| 2 | Data Link | Delivers frames on the local network using MAC addresses | ARP failures, VLAN misconfigs, switch port errors, duplicate MAC |
| 1 | Physical | Moves raw bits over a physical medium | Bad cable, loose fiber, failed NIC, link light is off |

In practice, layers 5 and 6 rarely come up as separate concepts. Modern protocols like HTTP/2 and TLS handle presentation and session concerns internally. Most real-world debugging boils down to: is it a Layer 1 cable problem, a Layer 2 local-network problem, a Layer 3 routing problem, a Layer 4 port/connection problem, or a Layer 7 application problem? Those five buckets cover the vast majority of network issues.

> When someone says "it is a Layer 8 problem," they mean the problem is the human operating the system. It is a joke, but it comes up surprisingly often.

## How Data Travels Down the Stack

Let us walk through what actually happens when your browser requests `https://api.example.com/users`. If you have ever opened the Network tab in DevTools and stared at the "Waterfall" column (the colored bars showing DNS, Initial connection, SSL, Waiting, Content Download), this section is the thing those bars are visualizing. Following the data through each layer makes the abstract model concrete.

**Step 1: DNS lookup (Application layer).** Your browser needs an IP address. It asks the operating system's resolver, which sends a DNS query (usually over UDP, port 53) to your configured DNS server. The response comes back: `api.example.com` resolves to `93.184.216.34`.

**Step 2: TCP handshake (Transport layer).** Your browser opens a TCP connection to `93.184.216.34` on port 443. Your machine picks a random high-numbered source port (say, 52314) and sends a SYN packet. The server responds with SYN-ACK. Your machine sends ACK. The three-way handshake is complete, and both sides are ready to exchange data.

**Step 3: TLS handshake (Application layer).** Since this is HTTPS, your browser and the server negotiate encryption before any HTTP data flows. They agree on a cipher suite, the server presents its certificate, and both sides derive session keys. After this, everything is encrypted.

**Step 4: HTTP request (Application layer).** Your browser constructs the HTTP request: `GET /users HTTP/2`, with headers like `Host: api.example.com` and `Accept: application/json`. This is your application data, the "letter" in the mail analogy.

**Step 5: Segmentation (Transport layer).** TCP takes the HTTP request, adds a header with source port 52314 and destination port 443, and wraps it into a segment. If the request were larger than the MSS (Maximum Segment Size, typically around 1460 bytes), TCP would split it into multiple segments, each with its own sequence number.

**Step 6: IP packaging (Internet layer).** The IP layer adds a header with the source address (your machine's IP, say `10.0.0.5`) and the destination address (`93.184.216.34`). It also sets the TTL (Time To Live), a counter that decrements at every router and prevents packets from circling the internet forever. The result is called a packet.

**Step 7: Framing (Network Access layer).** The Ethernet layer adds a header with your machine's MAC address as the source and, critically, the MAC address of your default gateway (your router) as the destination. Not the MAC of `93.184.216.34`, because that server is not on your local network. Your machine only knows how to reach the router; the router handles the next hop. A CRC checksum is appended as a trailer for error detection. The result is called a frame.

**Step 8: Transmission (Physical layer).** The frame is converted to electrical signals (copper), light pulses (fiber), or radio waves (Wi-Fi) and sent over the physical medium to the router.

From here, the router strips the Ethernet frame, reads the IP header, consults its routing table, wraps the packet in a new frame addressed to the next router's MAC address, and forwards it. This hop-by-hop process repeats until the packet reaches the destination server, where every layer is peeled off in reverse order until the HTTP request reaches the web application.

## Seeing the Layers with tcpdump

The layer model is not just theory. You can watch it in action with `tcpdump`, a command-line packet capture tool available on virtually every Linux and macOS system. It lets you see exactly what your network interfaces are sending and receiving, header by header.

The most basic capture grabs packets on a specific interface and prints a one-line summary for each:

```bash
$ sudo tcpdump -i eth0 -c 5
14:23:01.112233 IP 172.17.0.2.443 > 10.0.0.5.52314: Flags [S.], seq 0, ack 1, win 65160, length 0
14:23:01.112456 IP 10.0.0.5.52314 > 172.17.0.2.443: Flags [.], ack 1, win 502, length 0
14:23:01.115678 IP 10.0.0.5.52314 > 172.17.0.2.443: Flags [P.], seq 1:245, ack 1, win 502, length 244
14:23:01.117890 IP 172.17.0.2.443 > 10.0.0.5.52314: Flags [.], ack 245, win 64916, length 0
14:23:01.118123 IP 172.17.0.2.443 > 10.0.0.5.52314: Flags [P.], seq 1:1200, ack 245, win 64916, length 1199
```

Each line shows a timestamp, the protocol, source IP and port, destination IP and port, TCP flags, and payload length. The `[S.]` flag is a SYN-ACK (part of the three-way handshake). `[P.]` means PUSH (actual data being sent). `[.]` is a bare ACK (acknowledgment only).

Adding the `-e` flag reveals the Layer 2 MAC addresses that are normally hidden:

```bash
$ sudo tcpdump -i eth0 -c 5 -e
14:23:01.112233 02:42:ac:11:00:02 > 02:42:ac:11:00:01, ethertype IPv4 (0x0800), length 74: 172.17.0.2.443 > 10.0.0.5.52314: Flags [S.], seq 0, ack 1, win 65160, length 0
14:23:01.112456 02:42:ac:11:00:01 > 02:42:ac:11:00:02, ethertype IPv4 (0x0800), length 66: 10.0.0.5.52314 > 172.17.0.2.443: Flags [.], ack 1, win 502, length 0
```

Now you can see the full picture: the Ethernet framing (MAC addresses, ethertype), the IP addressing, and the TCP port numbers, all in one line. The `02:42:...` values are the MAC addresses of the sender and receiver on the local network segment.

For a deep dive into the actual bytes, use the `-XX` flag to get a hex dump of the entire frame:

```bash
$ sudo tcpdump -i eth0 -c 1 -XX
14:23:01.112233 IP 172.17.0.2.443 > 10.0.0.5.52314: Flags [P.], length 244
        0x0000:  0242 ac11 0001 0242 ac11 0002 0800 4500  .B.....B......E.
        0x0010:  0118 a1b2 4000 4006 1a2b ac11 0002 0a00  ....@.@..+......
        0x0020:  0005 01bb cc5a 0000 0001 0000 0001 5018  .....Z........P.
        0x0030:  fe98 1234 0000 4745 5420 2f75 7365 7273  ...4..GET./users
```

In that hex dump, you are looking at encapsulation in raw form. The first 14 bytes (ending at `0800`) are the Ethernet header with source and destination MAC addresses and the ethertype field (0x0800 means IPv4). The next block starting with `4500` is the IP header. After that comes the TCP header. Finally, `4745 5420 2f75 7365 7273` decodes to the ASCII text `GET /users`, your actual HTTP request payload buried inside all the layer headers.

You can also filter captures by port, host, or protocol to reduce noise:

```bash
$ sudo tcpdump -i eth0 port 443 -c 10
$ sudo tcpdump -i eth0 host 93.184.216.34 -c 10
$ sudo tcpdump -i eth0 icmp -c 5
```

The first captures only HTTPS traffic, the second only traffic to/from a specific host, and the third captures only ICMP packets (which is useful when debugging `ping` or `traceroute` issues).

## Where Each Layer Breaks

Every layer has its own failure modes, and the symptoms look completely different. Knowing which layer you are dealing with lets you skip the layers that are working fine and focus your debugging on the right one.

### Physical layer failures (Layer 1)

These are the most basic and often the most overlooked. A damaged Ethernet cable, a loose fiber connector, or a failed network card will cause complete loss of connectivity. The telltale sign is that the link light on the switch port or NIC is off or amber instead of green. No amount of configuration changes will fix a bad cable.

```bash
$ ip link show eth0
2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc fq_codel state DOWN
```

The `NO-CARRIER` and `state DOWN` tell you the physical link is not established. If you see this, check cables and hardware before looking at anything else.

### Data link failures (Layer 2)

Layer 2 problems show up as devices on the same local network being unable to communicate. The most common cause is ARP failures: your machine knows the IP address of the destination but cannot resolve its MAC address. You can inspect the ARP table to see what your machine has cached:

```bash
$ ip neigh show
192.168.1.1 dev eth0 lladdr 00:1a:2b:3c:4d:5e REACHABLE
192.168.1.50 dev eth0 FAILED
```

A `FAILED` entry means ARP resolution did not work. The destination might be powered off, on a different VLAN (Virtual LAN, a logical partition of a physical switch that isolates groups of ports from each other), or blocked by a misconfigured switch port.

Duplicate MAC addresses on the same network also cause chaos at this layer. Traffic randomly goes to the wrong machine because the switch cannot tell which port the MAC is on. This is rare with physical hardware but can happen in virtualized environments where MAC addresses are generated by software.

### Network layer failures (Layer 3)

This is the "cannot reach host" layer. If `ping` times out or you see `Destination Host Unreachable`, the problem is usually routing. Either your machine does not know how to reach the destination network, or a router along the path is dropping the packets.

```bash
$ ping -c 3 93.184.216.34
PING 93.184.216.34 (93.184.216.34) 56(84) bytes of data.
From 10.0.0.1: icmp_seq=1 Destination Host Unreachable

$ ip route show
default via 10.0.0.1 dev eth0
10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.5

$ traceroute 93.184.216.34
 1  10.0.0.1 (10.0.0.1)  1.234 ms  1.112 ms  1.001 ms
 2  * * *
 3  * * *
```

The `traceroute` output shows that packets reach the first router (`10.0.0.1`) but go nowhere after that. The `* * *` lines mean no response from subsequent hops, which could be a routing misconfiguration upstream, a firewall dropping ICMP, or a dead link between routers. Subnet misconfigurations also live here: if two machines think they are on the same subnet but are actually separated by a router, traffic will never arrive.

### Transport layer failures (Layer 4)

These typically manifest as "Connection refused" or connections that hang indefinitely. "Connection refused" means the destination machine received your SYN packet but has no process listening on that port. A hanging connection usually means a firewall is silently dropping the SYN without sending any response (called a "black hole").

```bash
$ telnet 93.184.216.34 8080
Trying 93.184.216.34...
telnet: connect to address 93.184.216.34: Connection refused

$ telnet 93.184.216.34 443
Trying 93.184.216.34...
Connected to 93.184.216.34.
```

The first attempt fails because nothing is listening on port 8080. The second succeeds because a web server is listening on port 443. If neither attempt responds at all (no "refused," just silence for 30 seconds), suspect a firewall. You can also use `ss` or `netstat` to check which ports are open on the local machine:

```bash
$ ss -tlnp
State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
LISTEN 0       128     0.0.0.0:443          0.0.0.0:*          users:(("nginx",pid=1234,fd=6))
LISTEN 0       128     0.0.0.0:22           0.0.0.0:*          users:(("sshd",pid=567,fd=3))
```

This shows that nginx is listening on port 443 and sshd on port 22. If the service you expect to see is missing from this list, the problem is not the network; the process is not running or is bound to the wrong address.

### Application layer failures (Layer 7)

If you can establish a TCP connection but the application still does not work, you are dealing with a Layer 7 problem. These include HTTP 500 errors, TLS certificate mismatches, authentication failures, malformed requests, and timeouts inside the application itself.

```bash
$ curl -v https://api.example.com/users
* Connected to api.example.com (93.184.216.34) port 443
* SSL certificate problem: certificate has expired
* Closing connection
curl: (60) SSL certificate problem: certificate has expired
```

The connection succeeded at Layer 4 (TCP handshake completed), but the TLS handshake failed at Layer 7 because the certificate expired. The fix is not a network change; it is renewing the certificate.

The layer model gives you a systematic approach: start at the bottom (is the link up?), work your way up (can I reach the host? can I connect to the port?), and by the time you reach Layer 7 you have already ruled out every infrastructure problem below it.

---

**References**

- [RFC 1122: Requirements for Internet Hosts](https://datatracker.ietf.org/doc/html/rfc1122) - The foundational RFC defining the TCP/IP model's four-layer architecture and host requirements.
- [RFC 793: Transmission Control Protocol](https://datatracker.ietf.org/doc/html/rfc793) - The original TCP specification covering the three-way handshake, sequence numbers, and reliable delivery.
- [tcpdump Manual Page](https://www.tcpdump.org/manpages/tcpdump.1.html) - Complete reference for tcpdump flags, filters, and output format.
- [Cloudflare Learning: What is the OSI Model?](https://www.cloudflare.com/learning/ddos/glossary/open-systems-interconnection-model-osi/) - A clear, visual introduction to all seven OSI layers with real-world examples.
- [Julia Evans: Networking Zines](https://jvns.ca/categories/networking/) - Approachable, illustrated explanations of networking concepts from DNS to TCP to packet captures.
