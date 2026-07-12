---
title: "HTTP & TLS"
description: "Understand TLS handshakes, certificates, HTTP request and response shape, status codes, headers, and curl-based debugging."
overview: "Learn what happens after the firewall allows port 443: the browser verifies the server with TLS, sends an HTTP request, and reads the response from Nginx or the app."
tags: ["http", "tls", "curl", "certificates", "https"]
order: 5
id: article-devops-foundation-networking-http-tls
---

## Table of Contents

1. [What HTTP and TLS Do](#what-http-and-tls-do)
2. [TLS: Proving and Protecting the Connection](#tls-proving-and-protecting-the-connection)
3. [Certificates and the Chain of Trust](#certificates-and-the-chain-of-trust)
4. [What HTTP Looks Like Inside the Connection](#what-http-looks-like-inside-the-connection)
5. [Methods, Status Codes, and Headers](#methods-status-codes-and-headers)
6. [Inspecting the Whole Request with curl](#inspecting-the-whole-request-with-curl)
7. [HTTP and TLS Failure Modes](#http-and-tls-failure-modes)
8. [References](#references)

## What HTTP and TLS Do
<!-- section-summary: HTTP carries web requests and responses, while TLS protects that HTTP conversation over HTTPS. -->

DNS found an address. Routing chose a path. Firewalls allowed port `443`. At that point, the browser has reached the web front door, but it still should not send cookies, passwords, or API tokens yet. It first needs proof that the server is really allowed to represent `app.example.com`.

**TLS**, Transport Layer Security, handles that trust and privacy step. It verifies the server's identity and encrypts the bytes that follow, so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

After TLS succeeds, **HTTP**, Hypertext Transfer Protocol, carries the actual web request and response. HTTP includes methods like `GET` and `POST`, paths like `/dashboard`, headers like `Host`, cookies, JSON bodies, status codes, redirects, and response content. HTTPS is HTTP sent through a TLS-protected connection.

For `https://app.example.com/dashboard`, DNS has returned the IP, routing has found the next hop, and firewall rules have allowed TCP port `443`. At that point, the browser has a live TCP connection to the server, but it still has not sent the private HTTP request. It first completes TLS, then sends HTTP inside the protected channel.

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

## TLS: Proving and Protecting the Connection
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

## Certificates and the Chain of Trust
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

## What HTTP Looks Like Inside the Connection
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

## Methods, Status Codes, and Headers
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

## Inspecting the Whole Request with curl
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

## HTTP and TLS Failure Modes
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

![HTTP and TLS summary infographic showing connection, certificate trust, HTTP messages, headers, curl inspection, and failure modes](/content-assets/articles/article-devops-foundation-networking-http-tls/http-tls-summary.png)

_The summary image gathers the HTTP and TLS clues operators compare when a secure web request fails._

## References

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) - Current HTTP semantics specification for methods, status codes, and fields.
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) - TLS 1.3 protocol specification.
- [MDN Web Docs: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) - Practical HTTP reference for web developers.
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/) - Official certificate and ACME documentation.
- [curl Everything](https://everything.curl.dev/) - Official, detailed guide to curl behavior and debugging.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration guidance for servers including Nginx.
