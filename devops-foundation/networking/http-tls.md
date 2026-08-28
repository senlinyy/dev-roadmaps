---
title: "HTTP & TLS"
description: "Understand TLS handshakes, certificates, HTTP request and response shape, status codes, headers, and curl-based debugging."
overview: "Learn what happens after the firewall allows port 443: the browser verifies the server with TLS, sends an HTTP request, and reads the response from Nginx or the app."
tags: ["http", "tls", "curl", "certificates", "https"]
order: 5
id: article-devops-foundation-networking-http-tls
---

## Table of Contents

1. [What Do HTTP and TLS Each Provide?](#what-do-http-and-tls-each-provide)
2. [How Does TLS Establish a Protected Connection?](#how-does-tls-establish-a-protected-connection)
3. [How Does a Certificate Chain Establish Server Identity?](#how-does-a-certificate-chain-establish-server-identity)
4. [What Does HTTP Look Like Inside the Connection?](#what-does-http-look-like-inside-the-connection)
5. [How Do Methods, Status Codes, Headers, and Cookies Carry Meaning?](#how-do-methods-status-codes-headers-and-cookies-carry-meaning)
6. [How Do You Inspect the Complete Request with curl and OpenSSL?](#how-do-you-inspect-the-complete-request-with-curl-and-openssl)
7. [How Does One Complete HTTPS Request Cross Every Boundary?](#how-does-one-complete-https-request-cross-every-boundary)
8. [How Do You Diagnose HTTP and TLS Failure Modes?](#how-do-you-diagnose-http-and-tls-failure-modes)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

DNS found an address. Routing chose a path. Firewalls allowed port `443`. At that point, the browser has reached the web front door, but it still should not send cookies, passwords, or API tokens yet. It first needs proof that the server is really allowed to represent `app.example.com`.

**TLS**, Transport Layer Security, handles that trust and privacy step. It verifies the server's identity and encrypts the bytes that follow, so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

After TLS succeeds, **HTTP**, Hypertext Transfer Protocol, carries the actual web request and response. HTTP includes methods like `GET` and `POST`, paths like `/dashboard`, headers like `Host`, cookies, JSON bodies, status codes, redirects, and response content. HTTPS is HTTP sent through a TLS-protected connection.

For `https://app.example.com/dashboard`, DNS has returned the IP, routing has found the next hop, and firewall rules have allowed TCP port `443`. At that point, the browser has a live TCP connection to the server, but it still has not sent the private HTTP request. It first completes TLS, then sends HTTP inside the protected channel.

Keep these questions in view as you work through the lesson:

1. **What Do HTTP and TLS Each Provide?**
2. **How Does TLS Establish a Protected Connection?**
3. **How Does a Certificate Chain Establish Server Identity?**
4. **What Does HTTP Look Like Inside the Connection?**
5. **How Do Methods, Status Codes, Headers, and Cookies Carry Meaning?**
6. **How Do You Inspect the Complete Request with `curl` and OpenSSL?**
7. **How Does One Complete HTTPS Request Cross Every Boundary?**
8. **How Do You Diagnose HTTP and TLS Failure Modes?**

## What Do HTTP and TLS Each Provide?
<!-- section-summary: HTTP carries web requests and responses, while TLS protects that HTTP conversation over HTTPS. -->

HTTP and TLS answer different questions. TLS asks, "Am I talking to the right server, and can we protect this connection?" HTTP asks, "Which resource does the client want, and what response should the server send?" If TLS fails, the browser never sends cookies or an API token. If TLS succeeds and HTTP fails, the request reached the web layer, and status codes or logs should explain the result.

A quick outside check can show the path reached the TLS listener:

```bash
nc -vz app.example.com 443

# Example output:
# Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

The success line proves the TCP port is reachable. It does not prove the certificate is valid, the hostname matches, the proxy config is correct, or the app is healthy. TLS and HTTP answer those next questions:

- `succeeded` means the TCP connection to port `443` opened.
- Certificate and hostname checks still need `openssl` or `curl`.
- App health still needs an HTTP response, such as `200`, `302`, `401`, `502`, or `504`.

The next practical decision is which tool to use. Use `openssl` when the certificate or handshake is the question. Use `curl` when the HTTP status, headers, redirects, or proxy behavior are the question.

## How Does TLS Establish a Protected Connection?
<!-- section-summary: TLS verifies the server certificate, agrees on shared encryption keys, and protects the HTTP conversation from observers. -->

If TLS fails, the browser stops before sending the private HTTP request. That is the safety feature. A login cookie or API token should stay in the browser until the server proves it is allowed to speak for the hostname.

TLS gives the browser two guarantees. First, it helps prove the server is allowed to speak for the hostname. Second, it encrypts the HTTP data so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

The TLS handshake is the setup conversation before HTTP. In plain language, the browser says which hostname it wants, which TLS versions it supports, and which cryptographic algorithms it can use. The server sends a certificate for the hostname. The browser verifies that certificate. The client and server then agree on shared keys and start sending encrypted data.

The hostname part is important. A single IP address can host many HTTPS sites. The browser includes the target hostname in the ClientHello through **SNI**, Server Name Indication. Nginx or a load balancer uses that hostname to choose the right certificate.

Under the hood, TLS 1.3 usually finishes the main setup in one round trip after TCP connects. The browser sends a ClientHello with SNI and key-share data. The server sends its certificate and its own key-share data. Both sides calculate shared session keys. The certificate proves identity. The shared keys protect the bytes after the handshake.

You can inspect the certificate a server presents:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

# Example output:
# subject=CN = app.example.com
# issuer=C = US, O = Let's Encrypt, CN = R3
# notBefore=Jun 01 00:00:00 2026 GMT
# notAfter=Aug 30 23:59:59 2026 GMT
```

The output tells you:

- `subject=CN = app.example.com` is the hostname identity on the certificate.
- `issuer=... Let's Encrypt ...` shows which CA issued it.
- `notBefore` and `notAfter` show the validity window.
- `-servername app.example.com` sends SNI. Without SNI, a multi-site server may return a default certificate for a different hostname and create a false hostname mismatch during testing.

Modern production TLS usually supports TLS 1.2 and TLS 1.3. TLS 1.3 reduces handshake round trips and removes old key exchange patterns that did not provide forward secrecy. **Forward secrecy** means recorded traffic stays protected even if the server's long-term private key leaks later, because each session used fresh temporary key material.

The next decision after inspecting the certificate is direct. If the subject or Subject Alternative Name list does not include the hostname, fix the certificate request or the Nginx `server_name` that selected it. If the issuer is unexpected, confirm which certificate file Nginx loaded. If the date is near expiration, fix renewal before users see browser warnings.

![TLS handshake map infographic showing client hello, certificate, key agreement, encrypted HTTP, and trust validation](/content-assets/articles/article-devops-foundation-networking-http-tls/tls-handshake-map.png)

_The image shows TLS as a short trust and encryption exchange before HTTP data moves._

## How Does a Certificate Chain Establish Server Identity?
<!-- section-summary: A certificate connects a hostname to a public key, and the client trusts it through a chain ending at a trusted root CA. -->

A browser privacy warning means the browser could not prove the server is allowed to answer for the hostname. Maybe the certificate expired. Maybe it was issued for `www.example.com` while the user visited `app.example.com`. Maybe the server forgot to send the intermediate certificate needed to build trust.

A **certificate** is a signed document that says a public key belongs to a hostname such as `app.example.com`. During the TLS handshake, the server proves it owns the matching private key. The browser then checks whether the certificate is valid for the hostname and whether it can trust who signed it.

That trust comes from a Certificate Authority, usually shortened to CA. Operating systems and browsers ship with trusted root CA certificates. A public CA such as Let's Encrypt can issue a server certificate after it verifies domain control. The browser trusts the server certificate when it can build a chain from the server certificate through intermediates to a trusted root.

The trust path usually has three levels:

1. The server certificate for `app.example.com`.
2. One or more intermediate CA certificates.
3. A root CA certificate already trusted by the operating system or browser.

The server should send the server certificate plus the intermediate certificates. This combined file is often called the **full chain**. Let's Encrypt's `certbot` writes it as `fullchain.pem`. Nginx should serve that file, because many clients need the intermediate certificates to build the trust path.

An Nginx TLS config usually points at the full chain and private key:

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
}
```

The important lines are:

- `listen 443 ssl http2` tells Nginx to accept HTTPS traffic on port `443`.
- `server_name app.example.com` selects this block for the requested hostname.
- `ssl_certificate` should point to the full chain, not only the leaf certificate.
- `ssl_certificate_key` points to the private key, which must stay readable only by the right system users.

Certificate automation is standard production practice. Let's Encrypt certificates expire after 90 days, so renewal should run automatically and monitoring should alert before expiration. A simple expiration check looks like this:

```bash
echo | openssl s_client -connect app.example.com:443 -servername app.example.com 2>/dev/null \
  | openssl x509 -noout -enddate

# Example output:
# notAfter=Aug 30 23:59:59 2026 GMT
```

That date belongs in monitoring. An expired certificate takes down user-facing HTTPS even while DNS, routing, firewall rules, Nginx, and the app are all working. A practical alert should fire days or weeks before `notAfter`, with enough time to fix renewal, reload Nginx, and verify the public certificate.

## What Does HTTP Look Like Inside the Connection?
<!-- section-summary: HTTP carries the actual application request and response after TLS has created the protected channel. -->

After TLS completes, the browser can finally send the request the user cared about. **HTTP**, Hypertext Transfer Protocol, is the application protocol your code uses through `fetch`, `axios`, browsers, API clients, and webhooks. It gives clients and servers a shared request and response format.

In HTTP/1.1 form, a request has a request line, headers, a blank line, and an optional body:

```
GET /dashboard HTTP/1.1
Host: app.example.com
Accept: text/html
Cookie: session=abc123
```

For a JSON API call, the browser or client might send:

```
POST /api/orders HTTP/1.1
Host: app.example.com
Content-Type: application/json
Authorization: Bearer eyJ...

{"sku":"book-123","quantity":1}
```

The server response has a status line, headers, a blank line, and an optional body:

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"ok":true,"orderId":"ord_123"}
```

HTTP/2 and HTTP/3 encode messages differently on the wire, but the concepts remain: method, path, headers, status, and body. Your application framework still exposes the request as method, URL, headers, and body. Nginx still logs the method, path, status, upstream, and timing.

This is where the reverse proxy enters the path. The browser thinks it is talking to `app.example.com`. Nginx terminates TLS, reads the HTTP request, then decides whether to serve a file, redirect the client, or proxy the request to the app.

The production symptom tells you which part to inspect. If the method or path is wrong, check the client code, form action, or proxy rewrite rule. If headers are missing, check Nginx `proxy_set_header` and framework middleware. If the body cannot be parsed, check `Content-Type`, body size limits, and JSON parser errors.

![HTTP wire anatomy infographic showing request line, headers, blank line, body, status line, response headers, and response body](/content-assets/articles/article-devops-foundation-networking-http-tls/http-wire-anatomy.png)

_The image separates the HTTP message pieces that logs, frameworks, and proxies expose during debugging._

## How Do Methods, Status Codes, Headers, and Cookies Carry Meaning?
<!-- section-summary: Methods describe client intent, status codes describe server results, and headers carry metadata needed by browsers, proxies, and applications. -->

Suppose a form submission fails. The browser shows an error, and the app logs show a request to `/api/orders`. The useful evidence is in the HTTP message: which action the client tried, what result the server returned, and which metadata traveled with the request.

The first clue is the HTTP **method**. The method tells the server what the client is trying to do. A `GET` should read data. A `POST` usually submits data or triggers server-side work. Browsers, caches, proxies, and frameworks use the method when deciding how to handle the request.

| Method | Meaning | Common example |
| --- | --- | --- |
| `GET` | Read a resource | Load `/dashboard` or fetch `/api/users` |
| `POST` | Create a resource or trigger an action | Submit a form or create an order |
| `PUT` | Replace a resource | Replace a profile document |
| `PATCH` | Partially update a resource | Change one profile field |
| `DELETE` | Remove a resource | Delete a saved item |
| `OPTIONS` | Ask which methods and headers are allowed | Browser CORS preflight |
| `HEAD` | Fetch headers without the body | Check metadata or caching |

The second clue is the **status code**. The status code tells you how the server handled the request. It lets clients, proxies, and humans understand the result without parsing every response body. The first digit gives the family.

| Family | Meaning | Examples |
| --- | --- | --- |
| `2xx` | Success | `200 OK`, `201 Created`, `204 No Content` |
| `3xx` | Redirect or cache response | `301 Moved Permanently`, `302 Found`, `304 Not Modified` |
| `4xx` | Client-side problem | `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests` |
| `5xx` | Server-side or upstream problem | `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout` |

For web debugging, `502` and `504` are especially useful. A `502 Bad Gateway` from Nginx means Nginx accepted the client request but got an invalid or failed response from the upstream app. A `504 Gateway Timeout` means Nginx waited for the upstream app and did not receive a response in time.

The third clue is the set of **headers**. Headers carry metadata that the method, path, and body cannot hold cleanly: identity, content type, caching policy, redirects, cookies, request IDs, and proxy context. Some headers matter constantly:

| Header | Why it matters |
| --- | --- |
| `Host` | Selects the virtual host at Nginx and identifies the requested domain |
| `Content-Type` | Tells the receiver how to parse the body |
| `Authorization` | Carries tokens or credentials |
| `Cookie` / `Set-Cookie` | Carries browser session state |
| `Cache-Control` | Controls browser and proxy caching |
| `Location` | Sends the client to another URL during redirects |
| `X-Request-ID` | Lets logs connect one request across proxy and app |
| `X-Forwarded-For` | Preserves original client IP through proxies |
| `X-Forwarded-Proto` | Tells the app whether the client used HTTP or HTTPS |

Those last two headers connect directly to the Nginx article. When Nginx proxies to the app on `localhost:3000`, the app would otherwise see Nginx as the client. Forwarded headers preserve the original request context.

Now put the three clues into one failed request. A customer presses **Place order** and sees `Payment could not be started`. The browser Network tab shows:

```console
POST https://app.example.com/api/orders
Status: 415 Unsupported Media Type
Response header: content-type: application/json
Request header: content-type: text/plain;charset=UTF-8
```

The status proves the request reached the HTTP layer and the server rejected how the body was labeled. The request header proves the client sent the body as plain text, so the next check is the frontend submit code or API client helper that builds the request. The Nginx access log should show the same `POST /api/orders 415`, which confirms the proxy passed the request through:

```console
198.51.100.50 - - [24/Jun/2026:10:42:31 +0000] "POST /api/orders HTTP/2.0" 415 82 "-" "Mozilla/5.0"
```

If the app log says `expected application/json`, fix the client header or the form encoding. Do not blame TLS, DNS, or the firewall yet, because the server already received the request and returned a precise HTTP response.

After the status and headers are clear, choose the next log source. `401` points at authentication. `403` points at authorization or access policy. `404` points at routing or missing resources. `429` points at rate limiting. `502` and `504` point at a proxy-to-upstream problem. The response family narrows the log search.

## How Do You Inspect the Complete Request with `curl` and OpenSSL?
<!-- section-summary: curl can measure DNS, TCP, TLS, HTTP status, headers, and body behavior from one command line. -->

A browser hides useful details behind a friendly error page. `curl` lets you ask the same URL from the command line and see the path in pieces: DNS, TCP, TLS, request headers, response headers, redirects, status codes, and timing.

Verbose mode shows the conversation:

```bash
curl -v https://app.example.com/dashboard

# Example output:
# * Host app.example.com:443 was resolved.
# *   Trying 203.0.113.25:443...
# * Connected to app.example.com (203.0.113.25) port 443
# * SSL connection using TLSv1.3
# * Server certificate:
# *  subject: CN=app.example.com
# > GET /dashboard HTTP/2
# > Host: app.example.com
# < HTTP/2 200
# < content-type: text/html; charset=utf-8
```

Lines starting with `*` are curl's connection notes. Lines starting with `>` are request data sent by the client. Lines starting with `<` are response data from the server.

In this example:

- `Host ... was resolved` means DNS returned an address.
- `Connected ... port 443` means TCP and firewall checks passed.
- `SSL connection using TLSv1.3` means TLS succeeded.
- `< HTTP/2 200` means the server returned a successful HTTP response.

Headers only:

```bash
curl -I https://app.example.com/dashboard

# Example output:
# HTTP/2 200
# content-type: text/html; charset=utf-8
# cache-control: no-store
# server: nginx
```

`-I` requests headers only. This is useful when the body is large or the status and headers are enough to prove what layer answered.

JSON POST:

```bash
curl -X POST https://app.example.com/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{"sku":"book-123","quantity":1}'
```

That command shows the pieces an API client controls: method, URL, headers, and body. If the server returns `415 Unsupported Media Type`, check `Content-Type`. If it returns `401`, check the `Authorization` header.

Timing output breaks one request into phases:

```bash
curl -o /dev/null -s \
  -w "dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s first_byte=%{time_starttransfer}s total=%{time_total}s\n" \
  https://app.example.com/dashboard

# Example output:
# dns=0.012s connect=0.044s tls=0.091s first_byte=0.180s total=0.214s
```

The timing connects directly to the layers. `dns` measures name lookup. `connect` measures the TCP connection. `tls` measures the TLS setup. `first_byte` measures how long the server took to send the first response byte after the request. It does not prove the whole page loaded quickly, because browser rendering, JavaScript, images, and later API calls are outside this single curl request.

![Curl timing waterfall infographic showing DNS lookup, TCP connect, TLS handshake, server processing, first byte, and total time](/content-assets/articles/article-devops-foundation-networking-http-tls/curl-timing-waterfall.png)

_The image turns curl timing output into a request waterfall that points at the slow layer._

## How Does One Complete HTTPS Request Cross Every Boundary?

A complete request begins before HTTP. The client resolves the hostname, chooses a route, opens a transport connection, negotiates TLS, and only then exchanges an HTTP request and response. For HTTP/3, QUIC combines transport and TLS over UDP, but the same questions remain: which address, which authenticated name, which application protocol, and which request result?

The TLS ClientHello carries capabilities and usually the requested server name through SNI so a shared endpoint can select the right certificate. ALPN lets client and server choose an application protocol such as HTTP/2. The server sends its certificate chain and proves possession of the corresponding private key; both sides derive symmetric session keys, which protect the high-volume application bytes efficiently.

After the handshake, the client sends a method, target, version, and headers. A reverse proxy may terminate TLS, add forwarding context, and create another connection to the upstream. That second hop has its own identity and encryption decision. The upstream response crosses the same boundaries in reverse, and every layer can contribute its own status, timeout, or log evidence.

## How Do You Diagnose HTTP and TLS Failure Modes?
<!-- section-summary: HTTP and TLS failures usually identify themselves through certificate errors, redirect loops, CORS blocks, content-type mismatches, and upstream status codes. -->

HTTP and TLS failures usually leave a visible clue: a certificate warning, a repeated redirect, a browser CORS message, a parser error, or a proxy status code. The clue tells you whether the browser stopped during trust, HTTP routing, browser policy, or upstream handling.

**Expired certificate** is the classic TLS outage. Your browser shows a privacy warning before the HTTP request is trusted. `curl` reports a certificate problem, and Node.js may throw `CERT_HAS_EXPIRED`. That proves the failure happened during certificate validation, before app routing or controller code. Renew the certificate, reload Nginx if needed, and add monitoring that alerts before the next expiration. Do not blame the application route yet, because the browser never got far enough to send a trusted HTTP request.

```bash
curl https://app.example.com

# Example output:
# curl: (60) SSL certificate problem: certificate has expired
```

**Hostname mismatch** happens when the certificate is valid for one name while your client connects to another. The browser warning usually names the requested host. `curl` prints the mismatch directly. That proves the certificate chain may be valid, but the hostname does not match the name your user typed. Fix the certificate SAN list, the DNS name, or the Nginx `server_name` that selected the wrong certificate. Do not blame the API service yet, because the client rejected the connection during TLS identity checks.

```bash
curl https://api.example.com

# Example output:
# curl: (60) SSL: no alternative certificate subject name matches target host name 'api.example.com'
```

The certificate check should include SNI and the target name:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"

# Example output:
#             X509v3 Subject Alternative Name:
#                 DNS:www.example.com, DNS:app.example.com
```

The Subject Alternative Name list is the main hostname list browsers use. This output does not include `api.example.com`, so a browser should reject the certificate for that hostname. The target name must appear there directly or match a valid wildcard.

**Incomplete certificate chain** happens when the server sends only its own certificate and misses the intermediate CA. Your laptop browser may still work because it has cached intermediates. A webhook provider, backend service, or minimal container may fail with a trust error. That proves the server is not sending enough certificate chain data for every client to build trust. In Nginx, serve `fullchain.pem` rather than only the leaf certificate, then test from a clean container or an external SSL checker. Do not blame the client library first when several independent clients fail on trust.

One quick proof is to count how many certificates the server sends:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com -showcerts </dev/null 2>/dev/null \
  | grep -c "BEGIN CERTIFICATE"

# Example output:
# 1
```

One certificate usually means the server sent only the leaf certificate. A normal public chain often sends the leaf plus one or more intermediates. The Nginx certificate path should point at the full chain file.

**Wrong Content-Type** creates app bugs that look like parsing failures. Your browser may show a JavaScript error such as `Unexpected token < in JSON`, or the API may return `415 Unsupported Media Type`. The headers prove how each side labeled the body. Fix the client `Content-Type`, the server response header, or the route that returns an HTML error page to a JSON caller. Do not blame TLS or load balancing when the status and headers already show an HTTP body-format problem.

**Redirect loops** happen when proxy, app, and CDN rules disagree. Your browser may say the page redirected too many times. `curl -L -v` proves the loop by showing repeated `301` or `302` responses to the same URL. Fix the redirect owner, usually the missing `X-Forwarded-Proto` header or the app's proxy-trust setting behind Nginx. Do not blame cookies first unless the loop changes only after login, because a plain anonymous request can already prove a scheme redirect loop.

```bash
curl -L -v https://app.example.com 2>&1 | grep -E '^< (HTTP|location:)'

# Example output:
# < HTTP/2 301
# < location: https://app.example.com/dashboard
# < HTTP/2 301
# < location: https://app.example.com/dashboard
```

Repeated `301` responses to the same URL show the loop. In this proxy setup, the usual fix is to make Nginx forward the original scheme and make the app trust that proxy header.

**CORS errors** are browser-enforced access rules. CORS stands for Cross-Origin Resource Sharing. If JavaScript from `https://app.example.com` calls `https://api.example.com`, the browser checks whether the API response permits that origin. Your terminal `curl` may work while the browser blocks the response, because CORS protects browser users from scripts running on other origins. The browser console and the `OPTIONS` preflight response prove whether the access-control headers are missing or too narrow. Fix the API CORS policy for the exact origin, method, and headers your page uses. Do not blame the network path when the API answers curl and the browser alone blocks script access.

The browser often sends an `OPTIONS` preflight request before the real request when custom headers or non-simple methods are involved. The API needs to answer with headers such as `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers`. If the preflight fails, the browser blocks the real request and the server may never see the `POST` or `PATCH` the developer expected.

```bash
curl -i -X OPTIONS https://api.example.com/orders \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

# Example output:
# HTTP/2 204
# access-control-allow-origin: https://app.example.com
# access-control-allow-methods: GET,POST,OPTIONS
# access-control-allow-headers: authorization,content-type
```

The important parts are the allowed origin, method, and headers. If `authorization` is missing from `access-control-allow-headers`, a browser request with an `Authorization` header can fail even though a direct `curl` request succeeds.

**502 and 504 responses** move the investigation to Nginx and the app. TLS worked. HTTP reached the proxy. The proxy could not get a valid timely response from the upstream service, so the next evidence comes from proxy config, upstream health checks, and application logs.

Prove that handoff with the public URL first:

```bash
curl -I https://app.example.com/api/health

# Example output:
# HTTP/2 502
# server: nginx
```

This output proves the browser path reached Nginx over HTTPS. The next question is what happened between Nginx and the app. Check the Nginx error log:

```bash
sudo tail -20 /var/log/nginx/error.log

# Example output:
# connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://127.0.0.1:3000/api/health"
```

That line points at the upstream app, not DNS, TLS, or the client browser. The next checks are whether the app process is running, whether it listens on `127.0.0.1:3000`, and whether the `proxy_pass` address matches the real listener.

A `504` can show up in the browser after a successful HTTPS handoff. It tells you Nginx reached the upstream path and waited too long for the app to answer. A common example is a slow report endpoint, a stuck database query, or an app worker that accepted the connection and did not send response headers before the proxy timeout.

```bash
curl -I https://app.example.com/api/reports?range=30d

# Example output:
# HTTP/2 504
# server: nginx
```

The public response still proves that DNS, TCP, TLS, and Nginx are alive. The missing piece is the upstream response time. The Nginx error log usually says that directly:

```bash
sudo tail -20 /var/log/nginx/error.log

# Example output:
# upstream timed out (110: Connection timed out) while reading response header from upstream, upstream: "http://127.0.0.1:3000/api/reports?range=30d"
```

Read that message in pieces:

- `upstream timed out` means Nginx waited until its proxy timeout expired.
- `while reading response header` means Nginx expected the app to send the first HTTP response line and headers, but they did not arrive in time.
- The `upstream` URL shows the internal app endpoint Nginx called.
- The next checks are application logs for the same timestamp, slow database queries, blocked workers, dependency calls, and any proxy timeout that is shorter than the real request is allowed to take.

The practical difference is simple: a `502` often means Nginx could not get a usable upstream response at all, such as a refused connection or crashed app. A `504` means Nginx waited for the upstream response and gave up. Do not increase timeouts as the first fix. First prove why the app is slow, then decide whether the request should be faster, moved to background work, cached, or given a longer timeout.

### Why Does TLS Use Both Asymmetric and Symmetric Cryptography?

Asymmetric cryptography lets the endpoint prove possession of a private key without sending that private key to the client. It also supports signatures that a client can verify through a certificate chain. Symmetric cryptography is much faster for protecting the large stream of application bytes. A TLS handshake combines these strengths: authenticate and agree on fresh secrets, then use derived symmetric keys for the session.

Modern TLS commonly uses ephemeral key agreement, so the session keys are not simply the server's long-term private key. If the certificate key is compromised later, previously recorded sessions that used appropriate ephemeral exchange are not automatically decrypted. The certificate private key still matters enormously because possession allows the endpoint to authenticate as that name until the certificate or trust path is rejected.

Confidentiality keeps passive observers from reading application data. Integrity detects modification. Authentication establishes which endpoint possesses the key associated with the certificate identity. TLS does not decide whether the authenticated user may delete an invoice, whether the application is safe, or whether the endpoint will store the data securely after decryption.

### How Does a Client Validate a Certificate?

The client checks that the requested hostname is covered by the certificate's subject alternative names, the current time lies within its validity window, the signature chain reaches a trusted root, and policy accepts the algorithms and usage. A wildcard such as `*.example.com` covers one label in the ordinary case; it does not mean every depth beneath the domain.

Servers usually send the leaf certificate and required intermediate certificates. The client normally already has trust anchors. A missing intermediate can fail on a clean client even when a browser with a cached intermediate appears to work. Sending the root is unnecessary and does not make an untrusted root trusted.

Revocation mechanisms and certificate transparency provide additional ecosystem signals. Revocation checks can report that an issued certificate should no longer be accepted, though client behavior and availability tradeoffs vary. Certificate transparency logs make public issuance observable. Neither replaces hostname validation or private-key protection.

A private certificate authority can establish trust inside an organization only after its root is distributed to the intended client trust stores. A certificate being internally signed does not make public browsers trust it. Conversely, adding a root to a trust store grants broad authority to that root, so distribution and key protection are security-sensitive operations.

SNI and hostname verification solve different moments. SNI in the ClientHello tells a shared server which name the client wants so it can select a certificate before HTTP begins. Verification then checks whether the returned certificate covers that name. When testing an IP directly, preserve the intended hostname with `curl --resolve` or an appropriate OpenSSL server name rather than changing the identity being tested.

```bash
curl --resolve app.example.com:443:203.0.113.25 https://app.example.com/health -v
openssl s_client -connect 203.0.113.25:443 -servername app.example.com -showcerts
```

The first command overrides address resolution while retaining URL hostname, SNI, HTTP Host, and certificate verification. The second exposes the certificate chain, handshake, selected protocol, and verification result. `-k` suppresses verification and can isolate a trust problem, but it must not become the production fix.

### How Do HTTP Versions Change Transport Without Changing Meaning?

HTTP/1.1 represents requests and responses as textual start lines, headers, and an optional body over a connection. Persistent connections allow more than one exchange without a new TCP and TLS handshake. HTTP/2 uses binary framing and multiplexes streams over one connection while preserving HTTP concepts such as method, status, and headers. HTTP/3 carries HTTP over QUIC on UDP and integrates modern TLS protection into the transport.

Those versions change framing, head-of-line behavior, and connection management; they do not change the basic application contract. A `GET` still requests a representation, a `POST` still submits according to application semantics, and a `404` still reports that the selected resource was not found. ALPN lets the peers choose a supported application protocol during secure connection setup.

Connection reuse means DNS and TLS changes can take time to affect already-open clients. A client may not perform another lookup or handshake for every request. During a cutover, inspect new connection behavior and existing connection lifetime rather than assuming each HTTP request starts from zero.

### What Do Method Safety and Idempotence Mean?

A safe method is intended not to request a state change, while an idempotent method is intended to have the same desired effect when repeated. `GET` and `HEAD` are safe and idempotent by definition. `PUT` and `DELETE` are idempotent in their intended semantics even though the first attempt can change state. `POST` is not generally idempotent.

These are protocol intentions, not magic enforcement. An application can incorrectly make a `GET` mutate state. A network retry of a non-idempotent operation can duplicate work unless the application uses an idempotency key or another deduplication contract. Proxies, clients, and operators should reason about the method and application behavior before retrying.

Status codes group outcomes. `1xx` is informational, `2xx` successful, `3xx` redirection, `4xx` a client-side request problem in protocol terms, and `5xx` a server-side failure. The exact code narrows the owner: `401` asks for authentication, `403` refuses the authenticated or understood request, `404` does not find the resource, `429` reports rate limiting, `502` describes a bad gateway response, `503` unavailability, and `504` an upstream timeout.

A reverse proxy's status is its observation. A `502` from Nginx does not prove the application returned `502`; the proxy may have failed to connect or parse an upstream response. Correlate proxy access and error logs with application logs and request IDs.

### How Do Headers and Cookies Create Application State?

Headers carry metadata around the message. `Host` or the HTTP/2 authority selects the virtual service. `Content-Type` describes the body's media type. `Content-Length` or protocol framing defines body boundaries. `Authorization` carries credentials according to a scheme. `Cache-Control`, `ETag`, and conditional headers coordinate caching and validation. Forwarding headers can preserve original client context across trusted proxies.

Cookies are name-value state that a server asks a user agent to return for matching scope. `Secure` restricts sending to secure contexts, `HttpOnly` hides the cookie from ordinary script access, and `SameSite` changes cross-site sending behavior. Domain, path, and lifetime define scope. These attributes reduce particular risks; they do not make a weak or leaked session identifier safe.

Security response headers express browser policy. HSTS tells supporting clients to use HTTPS for the host for a period after receiving the policy securely. Content Security Policy constrains content sources and execution. Frame and content-type policies reduce other browser attacks. Each header has deployment consequences, so test it rather than copying an aggressive value blindly.

Proxies must treat client-supplied forwarding headers as untrusted unless a known upstream proxy overwrites or validates them. If an application trusts arbitrary `X-Forwarded-For`, a direct client can claim another address. Define the trusted proxy chain and reconstruct client identity only from that boundary.

### Where Can TLS Terminate?

TLS can terminate at a load balancer, reverse proxy, sidecar, or application. Termination means that component decrypts the connection and owns the presented certificate and private key. It can then inspect HTTP and route by application data. The next hop may be plaintext on a controlled network or protected by another TLS connection.

Re-encryption creates two security sessions. The proxy authenticates to the client on the outer connection, then acts as a client to the upstream on the inner connection. Upstream verification, names, trust roots, and certificates require their own configuration. Calling the public endpoint “HTTPS” does not prove the proxy-to-application hop is encrypted or authenticated.

Mutual TLS adds a client certificate so both endpoints authenticate with certificate identities. It is useful for controlled service-to-service or administrative relationships, but certificate issuance, rotation, revocation, mapping to application identity, and authorization still need design. mTLS authenticates a credential; it does not decide every allowed business action.

### How Do You Read a Request as a Timeline?

Begin with the exact name, client location, time, method, and expected response. Resolve `A` and `AAAA`, determine which address the client selected, and test route and transport reachability. A DNS success with a TCP timeout points below HTTP. A connection refusal means the destination actively rejected or had no listener at that address and port.

Next inspect TLS with the original hostname. Verify SNI selection, certificate names, dates, chain, trusted root, protocol version, and ALPN. A certificate error occurs before the server processes the HTTP request. A TLS alert can reflect no shared protocol or cipher, client-certificate policy, SNI configuration, or server-side handshake failure.

Then inspect HTTP without discarding headers:

```bash
curl -v --connect-timeout 5 --max-time 20 \
  -H 'X-Request-ID: debug-20260825-1' \
  https://app.example.com/api/items
```

`-v` shows connection choices, handshake summary, request headers, and response headers. Time limits separate a bounded diagnostic from a hanging terminal. A request ID can connect edge, proxy, and application logs when the systems preserve it.

Redirects require another request and can cross scheme or hostname boundaries. Inspect `Location` before using `-L`, then follow intentionally. A redirect loop often comes from disagreement about the original scheme or host across a proxy. A successful TLS handshake followed by `404` proves the secure connection worked; the route or application resource is now the active layer.

Sessions, authentication, and authorization occur after transport trust. A `401` or login redirect can be correct HTTP over perfect TLS. A `403` can come from application policy or an intermediary. Test with the same credentials, cookies, method, and body as the failing client, while keeping secrets out of shared shell history and logs.

### How Do Failure Signatures Map to the Stack?

Name-resolution errors precede connection setup. Timeouts can occur during routing, firewall handling, TCP, TLS, proxy-to-upstream connection, or application processing, so identify the last successful phase and the component that emitted the message. “Connection refused” differs from silence; certificate hostname mismatch differs from an expired certificate; `502` differs from `504`.

Cipher and version settings define compatibility and security. Prefer maintained defaults and current protocol policy rather than inventing a custom list without evidence. Old clients may fail after a secure deprecation; weakening every endpoint restores compatibility by changing risk. Measure affected clients and isolate legacy requirements when they truly exist.

The endpoint trust model includes DNS, routing, certificate authority, key possession, hostname validation, and application identity. Each layer proves a bounded fact. The reliable debugging habit is to state which fact has been established, then test the next boundary without skipping ahead.

### How Do Timeouts Identify the Waiting Boundary?

A client can have separate limits for DNS, connection establishment, TLS handshake, first response byte, idle transfer, and total request time. A reverse proxy adds connect, send, read, and response buffering timeouts for the upstream. The application and its dependencies add their own deadlines. One message saying “timeout” is incomplete until the waiting component and phase are named.

Set an overall deadline so work does not continue after the caller has given up, and choose inner deadlines that leave time to return a controlled error. Retrying a timed-out request consumes more capacity and may duplicate a non-idempotent operation. A retry policy needs a bounded attempt count, backoff, jitter, and knowledge of whether the operation is safe to repeat.

A `504` normally means a gateway did not receive a timely upstream response. A client-side timeout can occur before the gateway's limit and leave no `504` response at all. Application logs may show the work completing after the client disconnected. Correlate timestamps and request IDs across all three perspectives.

### How Do Caching and Conditional Requests Affect HTTP?

Responses can describe whether and how intermediaries or browsers cache them. `Cache-Control` directives express freshness and storage policy. An `ETag` or modification time can act as a validator. A client sends a conditional request such as `If-None-Match`, and the server can return `304 Not Modified` without the full representation when the validator still matches.

Caching changes which component answered. A fresh CDN or browser response may not reach the origin. A stale or incorrectly keyed response can appear as an application bug. Include host, path, query, selected headers, authentication context, and cache status in the investigation. Do not cache private or user-specific content under a key that can serve it to another identity.

TLS sessions can also resume, reducing handshake work while creating a different observation path than a full handshake. When validating a certificate or protocol change, force or identify a new connection and test from a clean client context. Existing long-lived or resumed sessions can temporarily preserve earlier behavior.

### How Do Authentication and Authorization Stay Outside TLS?

TLS server authentication proves that the endpoint controls a key for a trusted certificate name. Application authentication then establishes a user, service, or session identity through credentials such as a cookie, bearer token, or client certificate mapping. Authorization evaluates whether that identity may perform the requested action on the selected resource.

An encrypted `403` is still a denial. A valid certificate does not make an API token valid. A client certificate accepted by mTLS may map to a service identity that still lacks application permission. Keep transport trust, caller identity, and business authorization as separate log and policy decisions.

Credentials in headers and cookies require careful tooling. Verbose traces, shell history, proxy logs, and error reports can expose them. Reproduce with a bounded test credential, redact captured output, and configure logs to preserve request correlation without recording secrets or sensitive bodies.

### What Does Secure Protocol Configuration Need to Balance?

Protocol versions and cipher suites determine which cryptographic combinations peers can negotiate. Maintained platform defaults usually track current security and compatibility better than a long copied list. Disable obsolete protocols according to policy, observe which clients fail, and avoid restoring broad weakness to serve one unknown legacy client.

Certificate automation must include key generation or storage, issuance challenge, installation, full-chain configuration, renewal before expiry, safe reload, and external verification. A renewal job reporting success does not prove the active listener presents the new certificate. Query the endpoint after reload and alert on remaining lifetime.

Private keys should be readable only by the termination component and its controlled deployment path. Backups and copies expand the compromise surface. If TLS terminates at several components, each has its own key, certificate, trust, protocol, and renewal responsibility. Inventory the actual termination points rather than assuming the public DNS name has one certificate location.

### What Does a Minimal Raw HTTP Exchange Show?

An HTTP/1.1 request can be understood from a small wire-shaped example:

```http
GET /health HTTP/1.1
Host: app.example.com
Accept: application/json
Connection: close
```

The blank line ends the headers. A response begins with a status line, followed by response headers, another blank line, and an optional body:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 15
Cache-Control: no-store

{"status":"ok"}
```

This shape clarifies ownership. TLS protects these bytes but does not choose `200`. TCP carries the bytes but does not interpret `Host`. Nginx may generate or proxy the response, and the application may generate the body. Headers describe how the message should be interpreted and handled.

Request bodies need correct framing and media type. A server expecting JSON can reject form data even though the connection is perfect. Proxies can impose body-size limits before the application reads anything. A `413`, parsing error, or missing `Content-Type` belongs to HTTP and application policy, not certificate trust.

The final production check should observe from outside the termination boundary, use the public hostname, inspect the active chain, and make a representative authenticated or unauthenticated request without leaking credentials. Internal localhost success and a renewal file on disk are useful intermediate evidence, not proof of the complete client path.

HTTP message boundaries also matter when requests cross intermediaries. A proxy and upstream must agree on framing so one request cannot be interpreted as parts of two requests or vice versa. Maintained servers reject ambiguous combinations and normalize protocol behavior. Operators should avoid configurations that blindly pass conflicting framing headers and should keep proxies patched.

Connection and request logs should record enough context to assign ownership without recording secrets: timestamp, request ID, method, normalized route, status, response size, duration, upstream address and status, TLS protocol, and selected hostname where useful. High-cardinality or personal data requires retention and access policy. Logs are evidence, not permission to copy every header and body.

Finally, distinguish browser policy from transport. Mixed-content blocking, CORS, cookie scope, and content-security policy can prevent a browser action even when curl shows valid TLS and a successful HTTP response. Use browser evidence for browser enforcement, server evidence for the received request, and protocol tools for the connection. One successful tool proves only the boundary it exercised.

Preserve the exact URL, method, hostname, client location, and time in incident notes because each can select a different route, certificate, virtual host, cache entry, or authorization rule.

## Check Your Answers

:::expand[What Do HTTP and TLS Each Provide?]{kind="recap"}
HTTP defines application messages; TLS authenticates a connection endpoint and protects those bytes in transit.
:::

:::expand[How Does TLS Establish a Protected Connection?]{kind="recap"}
The handshake negotiates protocol, authenticates key possession, and derives efficient symmetric session keys.
:::

:::expand[How Does a Certificate Chain Establish Server Identity?]{kind="recap"}
The client checks hostname, validity, usage, signatures, intermediates, and a locally trusted root.
:::

:::expand[What Does HTTP Look Like Inside the Connection?]{kind="recap"}
HTTP versions frame methods, targets, headers, bodies, statuses, and responses differently while retaining common semantics.
:::

:::expand[How Do Methods, Status Codes, Headers, and Cookies Carry Meaning?]{kind="recap"}
Methods express intent, statuses express outcomes, headers carry metadata and policy, and cookies preserve scoped client state.
:::

:::expand[How Do You Inspect the Complete Request with `curl` and OpenSSL?]{kind="recap"}
Preserve the hostname and inspect resolution, connection, SNI, certificate chain, negotiated protocol, headers, timing, and body.
:::

:::expand[How Does One Complete HTTPS Request Cross Every Boundary?]{kind="recap"}
A request crosses DNS, routing, transport, TLS, proxy, upstream, application, and response paths with separate evidence at each.
:::

:::expand[How Do You Diagnose HTTP and TLS Failure Modes?]{kind="recap"}
Find the last successful phase, interpret the exact error owner, and test the next boundary with the original request identity.
:::

![HTTP and TLS summary infographic showing connection, certificate trust, HTTP messages, headers, curl inspection, and failure modes](/content-assets/articles/article-devops-foundation-networking-http-tls/http-tls-summary.png)

_The summary image gathers the HTTP and TLS clues operators compare when a secure web request fails._

## References

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) - Current HTTP semantics specification for methods, status codes, and fields.
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) - TLS 1.3 protocol specification.
- [MDN Web Docs: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) - Practical HTTP reference for web developers.
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/) - Official certificate and ACME documentation.
- [curl Everything](https://everything.curl.dev/) - Official, detailed guide to curl behavior and debugging.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration guidance for servers including Nginx.
