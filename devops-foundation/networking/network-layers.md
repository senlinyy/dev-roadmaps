---
title: "Network Layers"
description: "Trace one browser request through DNS, IP routing, firewalls, TLS, Nginx, and the application by learning how network layers divide the work."
overview: "Understand how one request travels through the network stack so DNS, subnets, firewalls, TLS, reverse proxies, and app errors land in the right debugging bucket."
tags: ["tcp/ip", "osi", "tcpdump", "encapsulation"]
order: 1
id: article-devops-foundation-networking-network-layers
---

## Table of Contents

1. [What Network Layers Are](#what-network-layers-are)
2. [A Browser Request Through the Layers](#a-browser-request-through-the-layers)
3. [Encapsulation: How Data Gets Wrapped](#encapsulation-how-data-gets-wrapped)
4. [TCP/IP Layers in One Browser Request](#tcpip-layers-in-one-browser-request)
5. [The OSI Names People Use During Incidents](#the-osi-names-people-use-during-incidents)
6. [Watching Layers with Real Tools](#watching-layers-with-real-tools)
7. [Debugging by Layer](#debugging-by-layer)
8. [References](#references)

## What Network Layers Are
<!-- section-summary: A layer is one part of the networking job with its own responsibility, vocabulary, tools, and failure modes. -->

Networking is easier to learn when you slow one request down and give each part of the trip a name. A **network layer** is one responsibility in that trip. One layer knows how to format an HTTP request. Another knows how to open a reliable TCP connection. Another knows how to route an IP packet. Another knows how to send bits across Wi-Fi or Ethernet.

Each layer receives data from the layer above it, adds the information it needs, and hands the result to the layer below it. Your application code can send JSON without caring whether the user is on fiber, office Wi-Fi, hotel Wi-Fi, or mobile data. A router can forward an IP packet without knowing whether the payload is an image, a login form, or a DNS lookup. A firewall can allow TCP port `443` without reading every line of your application code.

That separation exists because no single part of the network can know everything. The browser cares about the URL and HTTP headers. TCP cares about ports, acknowledgments, and retransmits. IP cares about source and destination addresses. Ethernet and Wi-Fi care about the next local hop. Each responsibility stays small enough that teams can replace one part of the path without redesigning every other part.

Under the hood, the operating system and network devices pass the same payload through different checks. The browser hands bytes to the kernel. The kernel adds TCP and IP details. The network card sends a local frame to the next hop. A router removes the local frame, keeps the IP packet, and creates a fresh local frame for the next link. The HTTP request survives that journey because the lower layers only need their own headers.

This is useful during incidents because each layer leaves different evidence. A DNS problem gives you names that fail to resolve. A subnet problem gives you routes that point to the wrong place. A firewall problem gives you connections that time out or get refused. A TLS problem gives you certificate or handshake errors. A reverse proxy problem gives you `502` or `504` responses. Those symptoms come from different layers, so they need different checks.

The history matters a little here. The internet grew out of research networks that had to connect very different physical systems. One path might cross copper, satellite, radio, and fiber. The design that won was the one that let the upper layers keep working while the lower transport changed. That is why the request to `https://app.example.com/dashboard` can move through many networks without the browser caring which cable or radio link carried each hop.

## A Browser Request Through the Layers
<!-- section-summary: A browser request uses separate networking jobs from name lookup to proxy handoff, and each job leaves different debugging evidence. -->

Now put the layers into a normal web request. When someone opens `https://app.example.com/dashboard`, the browser turns one page load into several smaller jobs. It needs a name lookup, an IP route, an allowed TCP port, an encrypted connection, an HTTP request, and usually a proxy handoff before application code handles anything.

The browser first asks DNS to translate `app.example.com` into something like `203.0.113.25`. The operating system then decides whether that IP is local or remote by checking the subnet and route table. The packet moves toward the server, where cloud firewalls and host firewalls decide whether port `443` is allowed. If the packet reaches the listener, the browser performs a TLS handshake, sends HTTP through the encrypted connection, and lets Nginx forward the request to the app on an internal port such as `127.0.0.1:3000`.

The same page load can be drawn as a layer-by-layer path:

```mermaid
flowchart LR
    Browser["Browser"]
    DNS["DNS"]
    IP["IP and subnet routing"]
    Firewall["Firewall rules"]
    TLS["TLS handshake"]
    Nginx["Nginx reverse proxy"]
    App["Application"]

    Browser --> DNS --> IP --> Firewall --> TLS --> Nginx --> App
```

This map is useful because a failure usually leaves evidence in one job: a DNS error, a blocked port, a TLS certificate warning, a `502` from Nginx, or an app error. The map helps you choose the next check instead of guessing at the whole stack at once.

## Encapsulation: How Data Gets Wrapped
<!-- section-summary: Encapsulation means every layer wraps the data with its own header, and the receiver unwraps those headers in reverse order. -->

Packet captures can feel strange the first time because one page request shows several sets of names, addresses, and ports. The browser asked for `/dashboard`, yet the capture also shows TCP ports, IP addresses, and MAC addresses. Those extra fields appear because each layer adds its own delivery note around the data.

That wrapping is called **encapsulation**. Each layer adds a header before passing the data down to the next layer. A header is metadata for that layer. It says where the data should go next, which process should receive it, or how the receiver should put bytes back in order. The destination machine removes those headers in reverse order until the application sees the HTTP message.

For the browser request, the inner data is the HTTP message:

```
GET /dashboard HTTP/1.1
Host: app.example.com
Accept: text/html
```

TCP wraps that message with ports, such as source port `53142` and destination port `443`. IP wraps the TCP segment with source and destination IP addresses. Ethernet or Wi-Fi wraps the IP packet with local MAC addresses for the next hop. The result is a frame that can move across the local link.

| Wrapper | Main fields | Question it answers |
| --- | --- | --- |
| HTTP message | Method, path, headers, body | What does the application want? |
| TCP segment | Source port, destination port, sequence data | Which process should receive it, and in what order? |
| IP packet | Source IP, destination IP, TTL | Which host or network should receive it? |
| Ethernet frame | Source MAC, destination MAC | Which device receives the next local hop? |

This wrapping explains why the browser can connect to `app.example.com`, while Nginx can proxy to `127.0.0.1:3000`, while the application still sees the original `Host` header. Different layers keep different pieces of the story.

Headers also explain why a packet capture can show many addresses and ports for one page load. The TCP header might show source port `53142` and destination port `443`. The IP header might show source IP `10.0.0.42` and destination IP `203.0.113.25`. The Ethernet header might show your laptop's MAC address and the router's MAC address. None of those fields disagree with each other. They answer different delivery questions at different points in the path.

It also explains why packet captures look busy. A single HTTP request carries HTTP inside TCP, inside IP, inside a local link frame. Once you know what each wrapper is for, the output from tools like `tcpdump` reads like evidence instead of noise.

## TCP/IP Layers in One Browser Request
<!-- section-summary: The TCP/IP model groups browser networking into application, transport, internet, and network access work. -->

Suppose the browser sits on "connecting..." for `https://app.example.com/dashboard`. That single symptom does not say whether DNS failed, port `443` was blocked, the route went the wrong way, or the app returned a bad response. The TCP/IP model helps split that one page load into four jobs that can be checked separately.

The first job is the **application layer**. This is where the browser deals with names and web protocol behavior. It asks DNS for the address of `app.example.com`, prepares the TLS handshake for HTTPS, and later sends an HTTP request for `/dashboard`. This layer matters to your app because URLs, headers, cookies, JSON, redirects, and status codes all live here.

Once the browser knows the address, the next job is the **transport layer**. For HTTPS, that usually means TCP. TCP gives the browser and server a conversation over a port. Port `443` usually belongs to a web server or load balancer. Port `3000` might belong to a Node.js process behind Nginx on the same host. TCP also tracks sequence numbers, acknowledgments, and retransmits so the application receives an ordered byte stream.

After TCP has a destination port, the machine still needs a path to the destination address. That is the **internet layer**. After DNS returns `203.0.113.25`, the operating system decides where to send packets for that IP. If the destination is outside the local subnet, the packet goes to the default gateway. Routers along the path inspect the destination IP and forward the packet toward the next hop. They do not need to understand the HTTP route or the JSON body.

The final job on your machine is the **network access layer**. It handles the next local hop over Ethernet, Wi-Fi, or a virtual interface. Your laptop sends the first frame to the router's MAC address. The router removes that local frame, keeps the IP packet, and creates a new frame for the next hop. The IP destination stays meaningful across the path; the MAC destination changes at every hop.

Here is the same idea as a compact table:

| TCP/IP layer | In the browser request | Common tools |
| --- | --- | --- |
| Application | DNS, TLS, HTTP, Nginx proxy behavior, app response | `dig`, `curl`, `openssl`, logs |
| Transport | TCP port `443`, TCP port `3000`, connection state | `ss`, `nc`, `tcpdump` |
| Internet | IP address, subnet, route table, TTL | `ip route`, `ping`, `traceroute` |
| Network access | Interface, MAC address, ARP, local link | `ip link`, `ip neigh`, `tcpdump -e` |

The practical decision is to pick the tool that matches the question. If the question is "what IP did this hostname return," use `dig`. If the question is "which gateway will this host use," use `ip route`. If the question is "is a process listening on port `443`," use `ss`. If the question is "did packets reach the wire," use `tcpdump`. Tool choice is layer choice.

The rest of the networking path zooms into these pieces. DNS explains the name lookup. IP addressing explains the subnet and routing part. Firewalls explain the allow or deny decision. HTTP and TLS explain the encrypted web conversation. Nginx explains the final public front door before the request reaches the app.

## The OSI Names People Use During Incidents
<!-- section-summary: The OSI model gives teams shared names like Layer 3, Layer 4, and Layer 7 during debugging. -->

During an incident, someone might say, "this looks like Layer 4" after a port check times out. They are not asking the team to memorize a chart for its own sake. They are using OSI layer names as shorthand for where the evidence points.

The OSI model has seven layers. Real internet stacks do not map perfectly to it, so treat the OSI names as debugging language rather than a perfect map of kernel code. The layer numbers help teams agree on the next check quickly.

| OSI layer | Name | Request-path example | Failure shape |
| --- | --- | --- | --- |
| 7 | Application | DNS, HTTP, app routes, proxy rules | `NXDOMAIN`, `404`, `502`, bad JSON |
| 6 | Presentation | TLS, encoding, compression | certificate mismatch, TLS alert |
| 5 | Session | Long-lived app sessions and connection reuse | dropped WebSocket, stale pool connection |
| 4 | Transport | TCP ports and connection state | connection refused, timeout, reset |
| 3 | Network | IP addresses and routing | no route, wrong subnet, unreachable host |
| 2 | Data link | MAC addresses, ARP, VLANs | ARP failure, duplicate MAC, VLAN mistake |
| 1 | Physical | cable, radio, NIC, link signal | interface down, no carrier |

Most day-to-day incidents land in a smaller set of buckets. Layer 3 means the IP path has a problem. Layer 4 means the port or TCP connection has a problem. Layer 7 means the application protocol, proxy, or app logic has a problem. TLS sometimes gets called Layer 6, though many teams group it with Layer 7 because it sits beside HTTP in the application stack.

A practical example helps. If `dig app.example.com` fails, the browser cannot even find the IP, so DNS needs attention first. If DNS returns an IP and `traceroute` stops at the first hop, you move to IP routing and subnets. If the route works and `nc -vz app.example.com 443` hangs, you look at firewalls. If port `443` opens and `curl` reports a certificate name mismatch, you inspect TLS. If TLS works and the browser gets `502 Bad Gateway`, you inspect Nginx and the upstream app.

The next decision after naming the OSI layer is to choose proof. "Layer 4" should turn into a port check, listener check, or packet capture. "Layer 7" should turn into `curl`, Nginx logs, response headers, or application logs. Layer names help only when they lead to evidence.

## Watching Layers with Real Tools
<!-- section-summary: `dig`, `ip`, `ss`, `curl`, `openssl`, and `tcpdump` let you collect evidence at different layers instead of guessing. -->

The best networking habit is to turn a vague report into evidence. The user says "the site is down." Each tool asks one smaller question. Does the name resolve? Does the machine know a route? Does the TCP port open? Does TLS present the right certificate? Does HTTP return a useful response?

DNS evidence starts with `dig`:

```bash
dig +short app.example.com
```

Example output:

```console
203.0.113.25
```

This output gives one important fact: the hostname resolves to `203.0.113.25`. If the command returns no answer or a different IP than expected, the investigation stays in DNS before any TCP check.

IP and subnet evidence starts with the route table:

```bash
ip route get 203.0.113.25
```

Example output:

```console
203.0.113.25 via 10.0.0.1 dev eth0 src 10.0.0.42 uid 1000
    cache
```

The route output says the machine will send packets for `203.0.113.25` to gateway `10.0.0.1` through interface `eth0`, using source address `10.0.0.42`. If the gateway or source address is wrong, subnet and route checks come next.

Transport evidence checks whether a port opens:

```bash
nc -vz app.example.com 443
```

Example output:

```console
Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

The success line means TCP port `443` opened. If this times out, a firewall or routing rule may be dropping traffic. If it says connection refused, the destination host replied while no process accepted that port.

TLS evidence comes from `openssl`:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Example output:

```console
subject=CN = app.example.com
issuer=C = US, O = Let's Encrypt, CN = R3
notBefore=Jun 01 00:00:00 2026 GMT
notAfter=Aug 30 23:59:59 2026 GMT
```

This proves which certificate the server presented, who issued it, and whether it is still valid. The `-servername` flag matters because it sends the hostname Nginx or the load balancer uses to choose the certificate.

HTTP and proxy evidence comes from `curl`:

```bash
curl -I https://app.example.com/dashboard
```

Example output:

```console
HTTP/2 200
content-type: text/html; charset=utf-8
server: nginx
```

The headers show that TLS and HTTP completed and that Nginx answered. A `502` here would mean the request reached the proxy, then the app behind it failed or was unavailable.

Packet evidence comes from `tcpdump` when the usual tools disagree:

```bash
sudo tcpdump -i eth0 -n host 203.0.113.25 and port 443 -c 4
```

Example output:

```console
12:01:10.100 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [S], seq 100, length 0
12:01:10.132 IP 203.0.113.25.443 > 10.0.0.42.53142: Flags [S.], seq 200, ack 101, length 0
12:01:10.132 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [.], ack 201, length 0
12:01:10.150 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [P.], length 517
```

The first three lines are the TCP handshake:

- `[S]` is the client SYN.
- `[S.]` is the server SYN-ACK.
- `[.]` is the client ACK.
- `[P.]` carries data, which for HTTPS is encrypted TLS data.

This capture proves that the network path and port are open. If the app still fails, the next evidence comes from TLS, Nginx logs, and application logs.

## Debugging by Layer
<!-- section-summary: Layer-based debugging starts with the earliest failing step and moves forward through DNS, routing, firewall, TLS, proxy, and app checks. -->

A useful networking debug session follows the request until the first proof breaks. Check the name, then the address, then the port, then the encrypted connection, then the proxy, then the app. This order keeps a DNS typo from turning into an application investigation, and it keeps an expired certificate from turning into a firewall change.

| Symptom | Likely layer | First useful check |
| --- | --- | --- |
| Browser says the domain cannot be found | DNS / application layer | `dig app.example.com` |
| DNS works but packets leave through the wrong gateway | Internet layer | `ip route get <ip>` |
| Same subnet hosts cannot find each other | Data link layer | `ip neigh show` |
| TCP connection hangs | Transport or firewall | `nc -vz app.example.com 443` and firewall logs |
| TCP connects but TLS fails | TLS / presentation | `openssl s_client -servername app.example.com` |
| TLS works but response is `502` | Proxy / application | Nginx `error.log` and app health check |
| Proxy works but page returns `500` | Application | Application logs and request ID |

Here is a compact incident walk-through. A user reports that `https://app.example.com/dashboard` hangs. DNS returns `203.0.113.25`, so the name works. `ip route get` shows packets leave through the expected gateway, so the local route is sane. `nc -vz app.example.com 443` times out, so the browser never reaches TLS or HTTP. That points at a firewall, load balancer listener, or network ACL. The application logs can wait because the request has not reached the app.

If `nc` succeeds and `openssl` shows a valid certificate, but `curl -I` returns `HTTP/2 502`, the packet path, firewall, and TLS all work. The failure now sits at the reverse proxy or upstream app. Nginx might be forwarding to the wrong port, or the app process might be down. The evidence moved you forward through the path.

Network layers turn "networking is broken" into a concrete question: which layer stopped doing its job?

## References

- [RFC 1122: Requirements for Internet Hosts](https://datatracker.ietf.org/doc/html/rfc1122) - Defines the host requirements and layered TCP/IP architecture used by internet systems.
- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293.html) - Current TCP specification, including connection setup, sequence numbers, and reliable delivery behavior.
- [tcpdump Manual Page](https://www.tcpdump.org/manpages/tcpdump.1.html) - Official reference for tcpdump capture options, filters, and output.
- [IANA Protocol Numbers](https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml) - Registry of protocol numbers used inside IP packets.
- [Cloudflare Learning Center: What is the OSI Model?](https://www.cloudflare.com/learning/ddos/glossary/open-systems-interconnection-model-osi/) - Beginner-friendly explanation of OSI layer names commonly used during troubleshooting.
