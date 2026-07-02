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

After DNS, routing, and firewalls let the browser reach port `443`, the browser still has two jobs before the page can load. It needs to prove the server really represents `app.example.com`, and then it needs to ask for `/dashboard`.

**TLS**, Transport Layer Security, handles the first job. It verifies the server's identity and encrypts the bytes that follow, so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

**HTTP**, Hypertext Transfer Protocol, handles the second job. It carries methods like `GET` and `POST`, paths like `/dashboard`, headers like `Host`, cookies, JSON bodies, status codes, redirects, and response content. HTTPS is HTTP sent through a TLS-protected connection.

For `https://app.example.com/dashboard`, DNS has returned the IP, routing has found the next hop, and firewall rules have allowed TCP port `443`. At that point, the browser has a live TCP connection to the server, but it still has not sent the private HTTP request. It first completes TLS, then sends HTTP inside the protected channel.

The separation exists because HTTP and TLS answer different questions. TLS asks, "Am I talking to the right server, and can we protect this connection?" HTTP asks, "Which resource does the client want, and what response should the server send?" If TLS fails, the browser never sends cookies or an API token. If TLS succeeds and HTTP fails, the request reached the web layer, and status codes or logs should explain the result.

A quick outside check can show the path reached the TLS listener:

```bash
nc -vz app.example.com 443
```

Example output:

```console
Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

The success line proves the TCP port is reachable. It does not prove the certificate is valid, the hostname matches, the proxy config is correct, or the app is healthy. TLS and HTTP answer those next questions:

- `succeeded` means the TCP connection to port `443` opened.
- Certificate and hostname checks still need `openssl` or `curl`.
- App health still needs an HTTP response, such as `200`, `302`, `401`, `502`, or `504`.

The next practical decision is which tool to use. Use `openssl` when the certificate or handshake is the question. Use `curl` when the HTTP status, headers, redirects, or proxy behavior are the question.

## TLS: Proving and Protecting the Connection
<!-- section-summary: TLS verifies the server certificate, agrees on shared encryption keys, and protects the HTTP conversation from observers. -->

If TLS fails, the browser stops before sending the private HTTP request. That is the safety feature. A login cookie or API token should not leave the browser until the server proves it is allowed to speak for the hostname.

TLS gives the browser two guarantees. First, it helps prove the server is allowed to speak for the hostname. Second, it encrypts the HTTP data so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

The TLS handshake is the setup conversation before HTTP. It exists so the browser and server can agree on encryption keys without sending the future HTTP conversation in the clear. In plain language, the browser says which hostname it wants, which TLS versions it supports, and which cryptographic algorithms it can use. The server sends a certificate for the hostname. The browser verifies that certificate. The client and server then agree on shared keys and start sending encrypted data.

The hostname part is important. A single IP address can host many HTTPS sites. The browser includes the target hostname in the ClientHello through **SNI**, Server Name Indication. Nginx or a load balancer uses that hostname to choose the right certificate.

Under the hood, TLS 1.3 usually finishes the main setup in one round trip after TCP connects. The browser sends a ClientHello with SNI and key-share data. The server sends its certificate and its own key-share data. Both sides calculate shared session keys. The certificate proves identity. The shared keys protect the bytes after the handshake.

You can inspect the certificate a server presents:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Example output:

```console
subject=CN = app.example.com
issuer=C = US, O = Let's Encrypt, CN = R3
notBefore=Jun 01 00:00:00 2026 GMT
notAfter=Aug 30 23:59:59 2026 GMT
```

The output tells you:

- `subject=CN = app.example.com` is the hostname identity on the certificate.
- `issuer=... Let's Encrypt ...` shows which CA issued it.
- `notBefore` and `notAfter` show the validity window.
- `-servername app.example.com` sends SNI. Without SNI, a multi-site server may return a default certificate for a different hostname and create a false hostname mismatch during testing.

Modern production TLS usually supports TLS 1.2 and TLS 1.3. TLS 1.3 reduces handshake round trips and removes old key exchange patterns that did not provide forward secrecy. **Forward secrecy** means recorded traffic stays protected even if the server's long-term private key leaks later, because each session used fresh temporary key material.

The next decision after inspecting the certificate is direct. If the subject or Subject Alternative Name list does not include the hostname, fix the certificate request or the Nginx `server_name` that selected it. If the issuer is unexpected, confirm which certificate file Nginx loaded. If the date is near expiration, fix renewal before users see browser warnings.

## Certificates and the Chain of Trust
<!-- section-summary: A certificate connects a hostname to a public key, and the client trusts it through a chain ending at a trusted root CA. -->

A browser privacy warning usually means the browser could not prove the server is really allowed to answer for the hostname. Maybe the certificate expired. Maybe it was issued for `www.example.com` while the user visited `app.example.com`. Maybe the server forgot to send the intermediate certificate needed to build trust.

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
```

Example output:

```console
notAfter=Aug 30 23:59:59 2026 GMT
```

That date belongs in monitoring. An expired certificate takes down user-facing HTTPS even while DNS, routing, firewall rules, Nginx, and the app are all working. A practical alert should fire days or weeks before `notAfter`, with enough time to fix renewal, reload Nginx, and verify the public certificate.

## What HTTP Looks Like Inside the Connection
<!-- section-summary: HTTP carries the actual application request and response after TLS has created the protected channel. -->

After TLS completes, the browser sends HTTP. **HTTP**, Hypertext Transfer Protocol, is the application protocol your code uses through `fetch`, `axios`, browsers, API clients, and webhooks. HTTP exists so clients and servers can exchange structured requests and responses in a shared format.

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

The next decision after reading status and headers is where to look for evidence. `401` points at authentication. `403` points at authorization or access policy. `404` points at routing or missing resources. `429` points at rate limiting. `502` and `504` point at a proxy-to-upstream problem. The response family narrows the log search.

## Inspecting the Whole Request with curl
<!-- section-summary: curl can measure DNS, TCP, TLS, HTTP status, headers, and body behavior from one command line. -->

A browser hides some useful details behind a friendly error page. `curl` lets you ask the same URL from the command line and see the path in pieces: DNS, TCP, TLS, request headers, response headers, redirects, status codes, and timing.

Verbose mode shows the conversation:

```bash
curl -v https://app.example.com/dashboard
```

Example output:

```console
* Host app.example.com:443 was resolved.
*   Trying 203.0.113.25:443...
* Connected to app.example.com (203.0.113.25) port 443
* SSL connection using TLSv1.3
* Server certificate:
*  subject: CN=app.example.com
> GET /dashboard HTTP/2
> Host: app.example.com
< HTTP/2 200
< content-type: text/html; charset=utf-8
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
```

Example output:

```console
HTTP/2 200
content-type: text/html; charset=utf-8
cache-control: no-store
server: nginx
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
```

Example output:

```console
dns=0.012s connect=0.044s tls=0.091s first_byte=0.180s total=0.214s
```

The timing connects directly to the layers. `dns` measures name lookup. `connect` measures the TCP connection. `tls` measures the TLS setup. `first_byte` measures how long the server took to send the first response byte after the request. It does not prove the whole page loaded quickly, because browser rendering, JavaScript, images, and later API calls are outside this single curl request.

## HTTP and TLS Failure Modes
<!-- section-summary: HTTP and TLS failures usually identify themselves through certificate errors, redirect loops, CORS blocks, content-type mismatches, and upstream status codes. -->

HTTP and TLS failures usually leave a visible clue: a certificate warning, a repeated redirect, a browser CORS message, a parser error, or a proxy status code. The clue tells you whether the browser stopped during trust, HTTP routing, browser policy, or upstream handling.

**Expired certificate** is the classic TLS outage. Browsers show a privacy warning. `curl` reports a certificate problem. Node.js may throw `CERT_HAS_EXPIRED`. The fix is renewal, plus monitoring that alerts before the next expiration.

```bash
curl https://app.example.com
```

Example output:

```console
curl: (60) SSL certificate problem: certificate has expired
```

**Hostname mismatch** happens when the certificate is valid for one name but the client connects to another. A cert for `www.example.com` does not cover `api.example.com` unless the Subject Alternative Name list includes it.

```bash
curl https://api.example.com
```

Example output:

```console
curl: (60) SSL: no alternative certificate subject name matches target host name 'api.example.com'
```

The certificate check should include SNI and the target name:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
```

Example output:

```console
            X509v3 Subject Alternative Name:
                DNS:www.example.com, DNS:app.example.com
```

The Subject Alternative Name list is the main hostname list browsers use. This output does not include `api.example.com`, so a browser should reject the certificate for that hostname. The target name must appear there directly or match a valid wildcard.

**Incomplete certificate chain** happens when the server sends only its own certificate and misses the intermediate CA. Browsers may still work because they cache intermediates. Backend clients, webhooks, and minimal containers often fail. The Nginx fix is to serve `fullchain.pem`.

**Wrong Content-Type** creates app bugs that look like parsing failures. A server returns JSON with `Content-Type: text/html`, or a client sends JSON without `Content-Type: application/json`. The status code might be `200`, but the client parser fails or the server reads the body incorrectly.

**Redirect loops** happen when proxy, app, and CDN rules disagree. One layer redirects HTTP to HTTPS. Another layer thinks the original scheme was HTTP because `X-Forwarded-Proto` is missing. The app redirects back to HTTPS again and again.

```bash
curl -L -v https://app.example.com 2>&1 | grep -E '^< (HTTP|location:)'
```

Example output:

```console
< HTTP/2 301
< location: https://app.example.com/dashboard
< HTTP/2 301
< location: https://app.example.com/dashboard
```

Repeated `301` responses to the same URL show the loop. In this proxy setup, the usual fix is to make Nginx forward the original scheme and make the app trust that proxy header.

**CORS errors** are browser-enforced access rules. CORS stands for Cross-Origin Resource Sharing. If JavaScript from `https://app.example.com` calls `https://api.example.com`, the browser checks whether the API response permits that origin. `curl` may work while the browser blocks the response, because CORS protects browser users from scripts running on other origins.

The browser often sends an `OPTIONS` preflight request before the real request when custom headers or non-simple methods are involved. The API needs to answer with headers such as `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers`. If the preflight fails, the browser blocks the real request and the server may never see the `POST` or `PATCH` the developer expected.

```bash
curl -i -X OPTIONS https://api.example.com/orders \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

Example output:

```console
HTTP/2 204
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET,POST,OPTIONS
access-control-allow-headers: authorization,content-type
```

The important parts are the allowed origin, method, and headers. If `authorization` is missing from `access-control-allow-headers`, a browser request with an `Authorization` header can fail even though a direct `curl` request succeeds.

**502 and 504 responses** move the investigation to Nginx and the app. TLS worked. HTTP reached the proxy. The proxy could not get a valid timely response from the upstream service, so the next evidence comes from proxy config, upstream health checks, and application logs.

## References

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) - Current HTTP semantics specification for methods, status codes, and fields.
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) - TLS 1.3 protocol specification.
- [MDN Web Docs: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) - Practical HTTP reference for web developers.
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/) - Official certificate and ACME documentation.
- [curl Everything](https://everything.curl.dev/) - Official, detailed guide to curl behavior and debugging.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration guidance for servers including Nginx.
