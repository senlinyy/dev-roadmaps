---
title: "Network Layers"
description: "Trace one browser request through DNS, IP routing, firewalls, TLS, Nginx, and the application by learning how network layers divide the work."
overview: "Understand how one request travels through the network stack so DNS, subnets, firewalls, TLS, reverse proxies, and app errors land in the right debugging bucket."
tags: ["tcp/ip", "osi", "tcpdump", "encapsulation"]
order: 1
id: article-devops-foundation-networking-network-layers
---

## Table of Contents

1. [Why Do Network Layers Help You Reason About Communication?](#why-do-network-layers-help-you-reason-about-communication)
2. [What Happens When a Browser Starts a Request?](#what-happens-when-a-browser-starts-a-request)
3. [How Does Encapsulation Wrap Data for Each Scope?](#how-does-encapsulation-wrap-data-for-each-scope)
4. [How Do the TCP/IP Layers Share One Browser Request?](#how-do-the-tcpip-layers-share-one-browser-request)
5. [How Do OSI Layer Names Help During Incidents?](#how-do-osi-layer-names-help-during-incidents)
6. [Which Tools Reveal Each Network Layer?](#which-tools-reveal-each-network-layer)
7. [How Do Security and Load Balancing Map to Layers?](#how-do-security-and-load-balancing-map-to-layers)
8. [How Do You Debug a Request by Layer?](#how-do-you-debug-a-request-by-layer)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Someone types `https://app.example.com/dashboard`, and the browser sits on "connecting..." for a few seconds. The user asked for one page, but several smaller jobs have to succeed before the app ever receives the request.

A **network layer** is one of those jobs. One layer prepares the HTTP request for `/dashboard`. Another opens a reliable TCP connection to port `443`. Another chooses where an IP packet should go next. Another sends bits across Wi-Fi, Ethernet, or a virtual network interface. Layers are a way to keep those responsibilities separate enough that you can debug them one at a time.

For example, your application code can send JSON without caring whether the user is on office Wi-Fi, a cloud VM, or a mobile network. A router can forward an IP packet without knowing whether the payload is an image, a login form, or a DNS lookup. A firewall can allow TCP port `443` without reading every line of application code. Each part needs only the information for its own job.

Keep these questions in view as you work through the lesson:

1. **Why Do Network Layers Help You Reason About Communication?**
2. **What Happens When a Browser Starts a Request?**
3. **How Does Encapsulation Wrap Data for Each Scope?**
4. **How Do the TCP/IP Layers Share One Browser Request?**
5. **How Do OSI Layer Names Help During Incidents?**
6. **Which Tools Reveal Each Network Layer?**
7. **How Do Security and Load Balancing Map to Layers?**
8. **How Do You Debug a Request by Layer?**

## Why Do Network Layers Help You Reason About Communication?
<!-- section-summary: A layer is one part of the networking job with its own responsibility, vocabulary, tools, and failure modes. -->

Each layer receives data from the layer above it, adds the information it needs, and hands the result to the layer below it. The browser hands bytes to the operating system. The operating system adds TCP and IP details. The network card sends a local frame to the next hop. A router removes the local frame, keeps the IP packet, and creates a fresh local frame for the next link.

That separation exists because no single part of the network can know everything. The browser cares about the URL and HTTP headers. TCP cares about ports, acknowledgments, and retransmits. IP cares about source and destination addresses. Ethernet and Wi-Fi care about the next local hop. Each responsibility stays small enough that teams can replace one part of the path without redesigning every other part.

The HTTP request survives that journey because the lower layers only add and remove their own headers. They do not rewrite the application message unless a proxy or application-layer device is explicitly doing that work.

During incidents, the layer idea gives you a calm way to sort evidence. A DNS problem gives you names that fail to resolve. A subnet problem gives you routes that point to the wrong place. A firewall problem gives you connections that time out or get refused. A TLS problem gives you certificate or handshake errors. A reverse proxy problem gives you `502` or `504` responses. The symptom tells you which job to inspect first.

The history matters a little here. The internet grew out of research networks that had to connect very different physical systems. One path might cross copper, satellite, radio, and fiber. The design that won was the one that let the upper layers keep working while the lower transport changed. That is why the request to `https://app.example.com/dashboard` can move through many networks without the browser caring which cable or radio link carried each hop.

## What Happens When a Browser Starts a Request?
<!-- section-summary: A browser request uses separate networking jobs from name lookup to proxy handoff, and each job leaves different debugging evidence. -->

Now follow the same page load from the user's chair. They type `https://app.example.com/dashboard` and expect the dashboard to appear. The browser cannot jump straight to React, Rails, Django, or whatever app sits behind the domain. It first needs a name lookup, an IP route, an allowed TCP port, an encrypted connection, an HTTP request, and usually a proxy handoff.

The browser first asks DNS to translate `app.example.com` into something like `203.0.113.25`. The operating system then decides whether that IP is local or remote by checking the subnet and route table. The packet moves toward the server, where cloud firewalls and host firewalls decide whether port `443` is allowed. If the packet reaches the listener, the browser performs a TLS handshake, sends HTTP through the encrypted connection, and lets Nginx forward the request to the app on an internal port such as `127.0.0.1:3000`.

The same page load can be drawn as a layer-by-layer path:

![Browser request through layers infographic showing browser, DNS lookup, IP route, firewall, TLS handshake, Nginx proxy, app, and the evidence each layer leaves](/content-assets/articles/article-devops-foundation-networking-network-layers/browser-request-through-layers.png)

_The image shows a browser request as a chain of smaller network jobs, each with its own evidence to inspect._

Use the map as an investigation order. If DNS fails, the browser never gets an address. If routing fails, packets never reach the server network. If the firewall blocks port `443`, TLS never starts. If TLS fails, the browser protects the user by refusing to send private HTTP data. If Nginx returns `502`, the public front door worked and the upstream app path needs attention.

## How Does Encapsulation Wrap Data for Each Scope?
<!-- section-summary: Encapsulation means every layer wraps the data with its own header, and the receiver unwraps those headers in reverse order. -->

The first time you open a packet capture for a simple page load, it can feel overloaded. You asked for `/dashboard`, yet the capture shows source ports, destination ports, IP addresses, MAC addresses, flags, and sequence numbers. Those extra fields are not random noise. They are the delivery notes added by each layer.

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

This wrapping explains a common production path. The browser connects to `app.example.com` on public port `443`. Nginx receives that encrypted web request, then proxies to `127.0.0.1:3000` inside the same host. The application can still see the original `Host` header because HTTP kept that information inside its own message.

Headers also explain why a packet capture can show many addresses and ports for one page load. The TCP header might show source port `53142` and destination port `443`. The IP header might show source IP `10.0.0.42` and destination IP `203.0.113.25`. The Ethernet header might show your laptop's MAC address and the router's MAC address. None of those fields disagree with each other. They answer different delivery questions at different points in the path.

It also explains why packet captures look busy. A single HTTP request carries HTTP inside TCP, inside IP, inside a local link frame. Once you know what each wrapper is for, the output from tools like `tcpdump` reads like evidence instead of noise.

![Encapsulation cross section infographic showing application data wrapped by transport, network, and link headers](/content-assets/articles/article-devops-foundation-networking-network-layers/encapsulation-cross-section.png)

_The image shows encapsulation as layers of headers added before a packet crosses the network._

## How Do the TCP/IP Layers Share One Browser Request?
<!-- section-summary: The TCP/IP model groups browser networking into application, transport, internet, and network access work. -->

Suppose the browser sits on "connecting..." for `https://app.example.com/dashboard`. That single symptom does not tell you whether DNS failed, port `443` was blocked, the route went the wrong way, or the app returned a bad response. The TCP/IP model splits that one page load into four jobs you can check separately.

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

The practical decision is to pick the tool that matches the question. To ask "what IP did this hostname return," use `dig`. To ask "which gateway will this host use," use `ip route`. To ask "is a process listening on port `443`," use `ss`. To ask "did packets reach the wire," use `tcpdump`. Tool choice is layer choice.

The rest of the networking path zooms into these pieces. DNS explains the name lookup. IP addressing explains the subnet and routing part. Firewalls explain the allow or deny decision. HTTP and TLS explain the encrypted web conversation. Nginx explains the final public front door before the request reaches the app.

## How Do OSI Layer Names Help During Incidents?
<!-- section-summary: The OSI model gives teams shared names like Layer 3, Layer 4, and Layer 7 during debugging. -->

During an incident, someone might describe a timeout as a Layer 4 clue. That sentence is shorthand. It means the name probably resolved and the route may exist. The TCP connection to the port is still failing.

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

A practical example helps. If `dig app.example.com` fails, the browser cannot even find the IP, so DNS needs attention first. If DNS returns an IP and `ip route get` selects an unexpected gateway, move to IP routing and subnets. Asterisks in `traceroute` mean its probes did not receive replies before the timeout. Routers can filter or rate-limit those replies while forwarding normal application traffic, so combine traceroute with the selected route, a TCP connection test, packet captures, and firewall evidence. If port `443` opens and `curl` reports a certificate name mismatch, inspect TLS. If TLS works and the browser gets `502 Bad Gateway`, inspect Nginx and the upstream app.

The next decision after naming the OSI layer is to choose proof. "Layer 4" should turn into a port check, listener check, or packet capture. "Layer 7" should turn into `curl`, Nginx logs, response headers, or application logs. Layer names help only when they lead to evidence.

## Which Tools Reveal Each Network Layer?
<!-- section-summary: `dig`, `ip`, `ss`, `curl`, `openssl`, and `tcpdump` let you collect evidence at different layers instead of guessing. -->

A user says "the site is down." That report is real, but it is too large to debug directly. A good networking habit is to turn it into smaller questions: does the name resolve, does the machine know a route, does the TCP port open, does TLS present the right certificate, and does HTTP return a useful response?

DNS evidence starts with `dig`:

```bash
dig +short app.example.com

# Example output:
# 203.0.113.25
```

This output gives one important fact: the hostname resolves to `203.0.113.25`. If the command returns no answer or a different IP than expected, the investigation stays in DNS before any TCP check.

IP and subnet evidence starts with the route table:

```bash
ip route get 203.0.113.25

# Example output:
# 203.0.113.25 via 10.0.0.1 dev eth0 src 10.0.0.42 uid 1000
#     cache
```

The route output says the machine will send packets for `203.0.113.25` to gateway `10.0.0.1` through interface `eth0`, using source address `10.0.0.42`. If the gateway or source address is wrong, subnet and route checks come next.

Transport evidence checks whether a port opens:

```bash
nc -vz app.example.com 443

# Example output:
# Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

The success line means TCP port `443` opened. A timeout points toward a firewall, route, load balancer, or network ACL dropping traffic. A connection refused message means the destination host replied, and no process accepted that port.

TLS evidence comes from `openssl`:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates

# Example output:
# subject=CN = app.example.com
# issuer=C = US, O = Let's Encrypt, CN = R3
# notBefore=Jun 01 00:00:00 2026 GMT
# notAfter=Aug 30 23:59:59 2026 GMT
```

This proves which certificate the server presented, who issued it, and whether it is still valid. The `-servername` flag matters because it sends the hostname Nginx or the load balancer uses to choose the certificate.

HTTP and proxy evidence comes from `curl`:

```bash
curl -I https://app.example.com/dashboard

# Example output:
# HTTP/2 200
# content-type: text/html; charset=utf-8
# server: nginx
```

The headers show that TLS and HTTP completed and that Nginx answered. A `502` here would mean the request reached the proxy, then the app behind it failed or was unavailable.

Packet evidence comes from `tcpdump` when the usual tools disagree:

```bash
sudo tcpdump -i eth0 -n host 203.0.113.25 and port 443 -c 4

# Example output:
# 12:01:10.100 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [S], seq 100, length 0
# 12:01:10.132 IP 203.0.113.25.443 > 10.0.0.42.53142: Flags [S.], seq 200, ack 101, length 0
# 12:01:10.132 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [.], ack 201, length 0
# 12:01:10.150 IP 10.0.0.42.53142 > 203.0.113.25.443: Flags [P.], length 517
```

The first three lines are the TCP handshake:

- `[S]` is the client SYN.
- `[S.]` is the server SYN-ACK.
- `[.]` is the client ACK.
- `[P.]` carries data, which for HTTPS is encrypted TLS data.

This capture proves that the network path and port are open. If the app still fails, the next evidence comes from TLS, Nginx logs, and application logs.

![MAC hop rewrite infographic showing IP addresses staying end to end while MAC addresses change at each local hop](/content-assets/articles/article-devops-foundation-networking-network-layers/mac-hop-rewrite.png)

_The image shows why packet captures may show changing MAC addresses even when the IP destination stays the same._

## How Do Security and Load Balancing Map to Layers?

Controls observe the layer whose information they can see. A network rule can match addresses and protocol. A transport rule can match TCP or UDP ports and connection state. An application-aware proxy can inspect HTTP hostnames, paths, methods, and headers when it terminates or can otherwise see that protocol. TLS hides application bytes from intermediate devices that do not terminate the connection.

A layer-4 load balancer forwards connections using address and port information. A layer-7 load balancer understands an application protocol and can route HTTP requests by host or path. Neither label proves health-check depth, source-address behavior, encryption policy, or retry semantics; inspect the actual product and configuration.

Segmentation reduces reachability, encryption protects bytes in transit, and application authorization decides what an authenticated caller may do. These controls complement one another because an allowed packet is not automatically an allowed business action.

## How Do You Debug a Request by Layer?
<!-- section-summary: Layer-based debugging starts with the earliest failing step and moves forward through DNS, routing, firewall, TLS, proxy, and app checks. -->

A useful networking debug session follows the request until the first proof breaks. The evidence order is name, address, port, encrypted connection, proxy, and app. This order keeps a DNS typo out of an application investigation, and it keeps an expired certificate out of a firewall change.

| Symptom | Likely layer | First useful check |
| --- | --- | --- |
| Browser says the domain cannot be found | DNS / application layer | `dig app.example.com` |
| DNS works but packets leave through the wrong gateway | Internet layer | `ip route get <ip>` |
| Same subnet hosts cannot find each other | Data link layer | `ip neigh show` |
| TCP connection hangs | Transport or firewall | `nc -vz app.example.com 443` and firewall logs |
| TCP connects but TLS fails | TLS / presentation | `openssl s_client -servername app.example.com` |
| TLS works but response is `502` | Proxy / application | Nginx `error.log` and app health check |
| Proxy works but page returns `500` | Application | Application logs and request ID |

Here is a compact incident walk-through. A user reports that `https://app.example.com/dashboard` hangs. DNS returns `203.0.113.25`, so the name works. `ip route get` shows packets leave through the expected gateway, so the local route is sane. `nc -vz app.example.com 443` times out, so the browser never reaches TLS or HTTP. That points at a firewall, load balancer listener, or network ACL. Application logs can wait because the request has not reached the app.

If `nc` succeeds and `openssl` shows a valid certificate, but `curl -I` returns `HTTP/2 502`, the packet path, firewall, and TLS all work. The failure now sits at the reverse proxy or upstream app. Nginx might be forwarding to the wrong port, or the app process might be down. The evidence moved you forward through the path.

Network layers turn "networking is broken" into a concrete question: which layer stopped doing its job?

### What Scope Does Each Layer Own?

The physical layer carries signals over copper, fiber, radio, or a virtual medium. Link-layer technologies such as Ethernet move frames on a local segment and use link-local identifiers such as MAC addresses. The network layer moves packets between IP networks. The transport layer creates process-to-process communication with ports and protocol behavior. The application layer defines messages such as DNS questions and HTTP requests.

These layers are contracts, not separate physical boxes. One operating system implements several of them, a switch focuses mainly on local frame forwarding, a router forwards IP packets between networks, a firewall applies policy using selected headers and state, and a reverse proxy terminates transport and understands an application protocol. Tunnels wrap one packet inside another, so an observer may see both an inner and outer layer stack.

IP provides best-effort packet delivery. It does not promise arrival, ordering, uniqueness, or a connection. TCP builds a reliable ordered byte stream over IP using sequence numbers, acknowledgements, retransmission, flow control, and congestion control. UDP sends independent datagrams with much less transport machinery and leaves reliability or ordering to the application when needed.

Ports identify transport endpoints on a host. An IP address reaches the network interface or namespace; a TCP or UDP port helps the kernel deliver traffic to a socket owned by a process. A firewall allowing port `443` does not start a listener, and a listening socket does not guarantee that routing or policy lets a client reach it.

TLS sits between transport and protected application data in the practical web stack. It authenticates an endpoint and protects bytes, while HTTP defines requests and responses. Layer names differ between the four-layer TCP/IP model and seven-layer OSI vocabulary, but the incident question is the same: which contract failed?

### How Does Encapsulation Preserve Several Addresses at Once?

Suppose a laptop sends an HTTPS request through a home router to a remote server. The application creates HTTP data. TLS protects it. TCP adds source and destination ports. IP adds source and destination IP addresses. Ethernet or Wi-Fi adds local source and destination link addresses for the next hop.

The first frame's destination MAC is normally the local router, not the remote server. The IP destination remains the remote server. At the router, the incoming link frame is removed; the router examines the IP packet, decrements its hop limit, selects the next route, and places the packet in a new link frame for the next local segment. Link addresses change hop by hop while the end-to-end IP addresses normally remain, except when translation changes them.

This produces at least four useful identifiers on one local observation: source MAC, next-hop MAC, source IP, and destination IP, plus source and destination transport ports. A packet capture is confusing only when those scopes are mixed. Ask whether an address identifies the local hop, the routed endpoint, or the application socket.

NAT deliberately changes an IP address and often a port at a boundary while tracking the mapping for return traffic. Routing chooses a next hop; NAT rewrites identifiers. DNS maps names to data; it does not route packets. Keeping those mechanisms separate prevents fixes such as changing DNS for a missing return route.

### What Happens During One Browser Request?

The browser or operating system first resolves the hostname. The host chooses an address family and destination address, then the kernel performs a route lookup and selects a source address and interface. For an on-link next hop, neighbor resolution obtains a link-layer address. For a remote destination, that next hop is usually a router.

For an ordinary HTTPS request over TCP, the client and server complete the TCP handshake. The client begins TLS with capabilities, SNI, and application-protocol options. The server selects parameters, presents a certificate chain, proves key possession, and both sides derive session keys. Only after that protected channel exists does the browser send the HTTP request.

The destination may be a load balancer or reverse proxy rather than the application process. That intermediary can terminate TLS, select a backend by hostname or path, open another transport connection, and send another HTTP request upstream. The response follows the chain back. One user request can therefore contain several TCP connections, TLS boundaries, source addresses, and logs.

HTTP/3 changes the lower transport by using QUIC over UDP, but name resolution, routing, endpoint identity, application messages, and intermediary behavior still need investigation. A model should guide observation without assuming every modern request uses the same wire sequence.

### Which Device and Tool Answers Which Question?

`ip link` shows interfaces and link state. `ip addr` shows addresses and prefixes. `ip route get DEST` shows the kernel's selected route and source. `ip neigh` shows local neighbor resolution. These establish whether the host can construct the next-hop delivery.

`dig` or another DNS client asks name-resolution questions. `ss -lntup` shows local listening sockets and process ownership. `nc` or `curl` can test transport reachability with clearer application intent. `openssl s_client` exposes TLS handshake and certificate information. `curl -v` connects TLS and HTTP evidence.

`tcpdump` captures packets at an interface. Wireshark can decode them into protocol fields and conversations. A capture proves what crossed the chosen observation point; it does not prove what happened before the packet reached that point or after it left. Capturing on the wrong interface, namespace, host, address family, or side of NAT can produce a correct but incomplete trace.

```bash
sudo tcpdump -ni any 'host 203.0.113.25 and (tcp port 443 or udp port 443)'
```

No packets can mean the application never attempted the request, DNS selected another address, routing chose another namespace or interface, or the capture filter is wrong. Outbound SYN packets without replies suggest a path, return, or silent-filtering problem. An immediate RST suggests an active rejection or absent listener. A completed transport handshake followed by a TLS alert moves the investigation upward.

Traceroute-like tools reveal hop-limit responses from parts of a route, not a guaranteed map of the exact application path. Some routers do not reply, paths can be asymmetric, and filtering can affect probes differently from application traffic. Use them as one routing clue.

### How Do Error Signatures Narrow the Layer?

“Name or service not known” begins with DNS and resolver configuration. “Network unreachable” or “no route to host” begins with local address and routing evidence. A timeout can span link, route, firewall, transport, TLS, proxy, or application waiting, so identify the last visible packet or completed phase.

“Connection refused” normally means an IP path reached an endpoint that rejected the transport connection or had no matching listener. Confirm the destination address and port, then inspect `ss` on the endpoint. A TLS hostname or trust error proves transport worked far enough to exchange handshake data. An HTTP status proves an HTTP-speaking component responded, although it may be a proxy rather than the final app.

Packet loss and retransmission can hurt TCP without producing an obvious application error. MTU problems can allow small packets and fail larger exchanges, especially across tunnels. Link counters, path MTU evidence, retransmissions, and captures help after ordinary name-route-listener checks establish the route.

Local testing needs scope. `curl localhost` bypasses external routing and firewall paths and may select a different listener than the public address. A successful local request proves the process and local stack can communicate through that endpoint; it does not prove remote reachability. Conversely, a failed public request with a successful private-address request narrows the boundary.

### How Do Attacks and Visibility Follow Layers?

Link-layer attacks target local-segment assumptions, such as forged neighbor information. Network-layer attacks can spoof or flood addresses and exploit routing. Transport attacks can exhaust connection state or send crafted segments. Application attacks use valid connections to send harmful protocol content. Defenses need visibility at the attacked contract.

Encryption limits intermediary application visibility by design. A network firewall can still see outer addresses, protocol, ports, sizes, and timing, but not protected HTTP paths or headers. A TLS-terminating proxy sees plaintext at that boundary and must protect keys, logs, and forwarding trust. Decrypting at one point creates a new security boundary for the next hop.

Load balancers also own bounded evidence. A layer-4 balancer can report connection outcomes without understanding an HTTP route. A layer-7 proxy can produce HTTP statuses and request logs, but an upstream failure may be summarized as its own `502` or `504`. Correlate the request across layers rather than assuming the user-facing code came from the application.

### How Does a Layered Runbook Stay Practical?

Start from the requested name and client. Confirm resolver and returned addresses. Ask the kernel for the route to the chosen address. Confirm local interface, next hop, and return-path design. Test the exact protocol and port. Check policy and listener. Inspect TLS with the intended hostname. Inspect HTTP headers and status. Then move through proxy and application evidence.

Do not force every symptom through all seven OSI labels. The layers are a navigation tool. If `dig` fails, do not begin with application code. If TCP connects and the certificate is wrong, do not change a subnet. If HTTP returns a deliberate `403`, routing already carried the request to an application-aware policy point.

The stack is also imperfect in practice. VPNs and overlays tunnel packets; proxies create new connections; containers introduce namespaces and virtual links; service meshes add sidecars; NAT rewrites addresses; QUIC combines concerns usually associated with transport and TLS. Preserve the first-principles questions—name, local link, route, transport endpoint, protected identity, application message, and controlling component—even when implementation boundaries move.

### How Do TCP Connection States Support Diagnosis?

TCP begins by exchanging synchronization and acknowledgement information so both endpoints agree on sequence spaces. A listening server socket waits for new connections. After establishment, each side tracks ordered bytes, acknowledgements, flow control, retransmission, and shutdown. `ss -nt` exposes states such as `SYN-SENT`, `SYN-RECV`, `ESTAB`, `FIN-WAIT`, `CLOSE-WAIT`, and `TIME-WAIT`.

Many connections stuck in `SYN-SENT` suggest that the client's connection attempts are not completing. `SYN-RECV` accumulation can reflect heavy or abusive connection arrival or incomplete handshakes. `CLOSE-WAIT` means the peer closed and the local application has not closed its side. `TIME-WAIT` is a normal temporary state that protects connection identity after active close; a large count needs workload and port-range context rather than blind deletion.

TCP retransmits when acknowledgements do not arrive and reduces sending behavior under congestion. Packet loss, reordering, overloaded endpoints, and path problems can therefore appear as latency without a clean connection error. A capture can show repeated sequence ranges and acknowledgement behavior, while kernel socket statistics and interface counters give aggregate evidence.

UDP has no transport handshake or built-in connection state of the same kind. A sent datagram does not prove a listener received it, and absence of a reply is ambiguous. Applications such as DNS and QUIC add their own timeout, retry, connection, and security behavior above UDP.

### How Do MTU and Fragmentation Cross Layers?

Each link has a maximum transmission unit. A route containing a smaller MTU than the sender expects can require IPv4 fragmentation or an error that lets the sender reduce packet size; IPv6 routers do not fragment packets in transit, so endpoints rely on path MTU discovery. Tunnels add headers and reduce the space available for the inner packet.

If required control messages are blocked, small probes can work while larger TLS or application transfers stall. Diagnose this after ordinary DNS, route, firewall, and listener checks. Compare interface and route MTU, capture oversized attempts and control messages, and test with protocol-appropriate tools. Lowering every MTU without locating the path can hide the actual broken boundary.

This scenario shows why layer separation is not isolation. A link or tunnel size affects IP packet delivery, which affects TCP retransmission, which can make a TLS handshake or HTTP body time out. The user sees an application symptom whose cause sits lower.

### How Do Namespaces and Virtual Links Change Observation?

Containers can have their own network namespace with interfaces, addresses, routes, neighbors, firewall hooks, and sockets. A host's `ss` or `ip route` may not show the same view as the application container. Virtual Ethernet pairs connect namespaces, bridges connect virtual links, and overlay networks tunnel container packets across hosts.

Observe from the namespace that owns the failing process and from each translation or proxy boundary. A socket listening on container loopback is not reachable through the container interface. A port published by a runtime can create host NAT or proxy behavior not visible in the application's simple listener. A service mesh sidecar can terminate and recreate connections beside the application.

Packet capture location matters correspondingly. Capturing on the host's external interface can show encrypted tunnel packets but not inner service addresses. Capturing inside the container can show the inner request but not outer NAT. Both traces can be correct descriptions of different layers.

### What Does a Compact Evidence Matrix Look Like?

For a name question, record resolver, query type, status, answer, and TTL. For a local-network question, record link state, interface, neighbor, and frame evidence. For a routing question, record destination, selected prefix, next hop, source, and return path. For a transport question, record protocol, endpoints, listener, connection state, and packets.

For TLS, record SNI, certificate identity and chain, validity, negotiated version, ALPN, and alert. For HTTP, record method, host, path, status, headers, time, and response owner. For a proxy, record the client-facing and upstream connections separately. This matrix keeps “the network is broken” from hiding which contract was tested.

Tools should not be treated as layers themselves. `curl` can exercise DNS, route, TCP, TLS, and HTTP in one command, but its error tells you where that composite attempt stopped. `tcpdump` can display several protocols, but only at one capture point. `ping` exercises ICMP behavior, not an application's TCP listener or authorization. Choose the evidence that directly represents the disputed boundary.

### How Do the Main Network Devices Change a Request?

A switch forwards frames within a link-layer domain based on learned link addresses. A router removes the incoming frame, makes an IP forwarding decision, and creates a new frame for the next link. A stateful firewall may track the transport conversation and permit return packets for an allowed flow. A NAT gateway rewrites addresses or ports and maintains translation state.

A layer-4 load balancer selects a backend connection using transport-visible data. A reverse proxy terminates the client connection, understands HTTP, and creates a new upstream connection. A DNS server answers name questions before those packet paths begin. One product can implement several roles, but the roles still answer different questions.

This distinction helps with source identity. An application behind a proxy may see the proxy's source address unless trusted forwarding metadata preserves the client context. A server behind NAT may reply through the translation state rather than directly to the client's visible address. Packet captures on opposite sides of a boundary can show different but related endpoint tuples.

### What Are the Limits of Layer-Based Reasoning?

The model does not imply that failures remain inside one neat box. Congestion at a link triggers TCP behavior; slow transport can expire a TLS or HTTP deadline; an application retry increases network load; DNS caching changes which route is used. The layers organize causal boundaries while the incident can propagate across them.

Nor does a lower-layer success prove permanent availability. One TCP handshake does not guarantee the next, one TLS handshake does not prove application health, and one HTTP `200` does not prove every dependency. State the sample time and endpoint, repeat when needed, and connect technical evidence to the user operation.

The sentence to remember is that each layer adds a contract with limited guarantees. You can debug faster by proving those guarantees in order, identify the component that owns the first broken contract, and avoid changing layers that already supplied the expected evidence.

One compact walkthrough makes the method concrete. If `dig` returns `203.0.113.25`, name resolution supplied an address. If `ip route get` selects the expected gateway and source, the local routing decision is present. If a capture shows SYN leaving and no reply, investigate forward path, filtering, endpoint, and return path. If SYN, SYN-ACK, and ACK complete, transport connected. If the server then sends a TLS alert, inspect SNI, certificate, versions, and policy. If TLS completes and HTTP returns `502`, inspect the proxy's upstream connection and logs.

At no point does the later failure invalidate the earlier evidence. DNS can be correct while routing fails; routing can be correct while a firewall drops; transport can work while TLS identity fails; TLS can work while application authorization denies. This monotonic evidence chain prevents circular debugging.

The response path deserves the same care. Switch learning, router tables, stateful policy, NAT mappings, load-balancer connection ownership, and proxy upstream behavior can differ in reverse. An asymmetric route is not automatically wrong, but every stateful and translated boundary must support it. Observe both directions at the first suspected gap.

## Check Your Answers

:::expand[Why Do Network Layers Help You Reason About Communication?]{kind="recap"}
Layers give each communication contract a scope, vocabulary, evidence source, and bounded failure question.
:::

:::expand[What Happens When a Browser Starts a Request?]{kind="recap"}
The client resolves a name, selects a route, creates transport, authenticates TLS, and exchanges an application request.
:::

:::expand[How Does Encapsulation Wrap Data for Each Scope?]{kind="recap"}
Each layer adds information for its scope, with link headers changing per hop while routed and application intent continue.
:::

:::expand[How Do the TCP/IP Layers Share One Browser Request?]{kind="recap"}
Link delivery, IP routing, TCP or QUIC transport, TLS protection, and HTTP meaning cooperate without providing each other's guarantees.
:::

:::expand[How Do OSI Layer Names Help During Incidents?]{kind="recap"}
OSI vocabulary helps teams locate a fault, but observed protocol boundaries matter more than memorizing seven labels.
:::

:::expand[Which Tools Reveal Each Network Layer?]{kind="recap"}
Use DNS, interface, route, socket, TLS, HTTP, and packet tools at the exact endpoint and namespace under investigation.
:::

:::expand[How Do Security and Load Balancing Map to Layers?]{kind="recap"}
Controls and balancers can decide only from the identifiers and plaintext visible at their termination boundary.
:::

:::expand[How Do You Debug a Request by Layer?]{kind="recap"}
Find the last proven contract, interpret its evidence owner, and test the next boundary without changing unrelated layers.
:::

![Network layers summary infographic showing DNS, IP routing, firewall checks, TLS, HTTP, captures, and layer-based debugging](/content-assets/articles/article-devops-foundation-networking-network-layers/network-layers-summary.png)

_The summary image turns layer-by-layer debugging into a compact incident checklist._

## References

- [RFC 1122: Requirements for Internet Hosts](https://datatracker.ietf.org/doc/html/rfc1122) - Defines the host requirements and layered TCP/IP architecture used by internet systems.
- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293.html) - Current TCP specification, including connection setup, sequence numbers, and reliable delivery behavior.
- [tcpdump Manual Page](https://www.tcpdump.org/manpages/tcpdump.1.html) - Official reference for tcpdump capture options, filters, and output.
- [IANA Protocol Numbers](https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml) - Registry of protocol numbers used inside IP packets.
- [Linux traceroute manual](https://man7.org/linux/man-pages/man8/traceroute.8.html) - Documents probe timeouts, asterisk output, and ICMP response throttling.
- [Cloudflare Learning Center: What is the OSI Model?](https://www.cloudflare.com/learning/ddos/glossary/open-systems-interconnection-model-osi/) - Beginner-friendly explanation of OSI layer names commonly used during troubleshooting.
