---
title: "HTTP & TLS"
description: "Understand TLS handshakes, certificates, HTTP request and response shape, status codes, headers, and curl-based debugging."
overview: "Learn what happens after the firewall allows port 443: the browser verifies the server with TLS, sends an HTTP request, and reads the response from Nginx or the app."
tags: ["http", "tls", "curl", "certificates", "https"]
order: 5
id: article-devops-foundation-networking-http-tls
---

## Table of Contents

1. [After the Firewall: Port 443 Is Open](#after-the-firewall-port-443-is-open)
2. [TLS: Proving and Protecting the Connection](#tls-proving-and-protecting-the-connection)
3. [Certificates and the Chain of Trust](#certificates-and-the-chain-of-trust)
4. [What HTTP Looks Like Inside the Connection](#what-http-looks-like-inside-the-connection)
5. [Methods, Status Codes, and Headers](#methods-status-codes-and-headers)
6. [Inspecting the Whole Request with curl](#inspecting-the-whole-request-with-curl)
7. [HTTP and TLS Failure Modes](#http-and-tls-failure-modes)

## After the Firewall: Port 443 Is Open
<!-- section-summary: Once the firewall allows TCP port 443, the browser can start TLS and then send HTTP through the protected channel. -->

The shared request path is `browser -> DNS -> IP/subnet -> firewall -> TLS -> Nginx reverse proxy -> app`. DNS has returned the IP. Routing has found the next hop. Firewalls have allowed TCP port `443`. Now the browser has a live TCP connection to the server.

At this point, the browser still has not sent the private HTTP request. For `https://app.example.com/dashboard`, the browser first needs a protected channel. That protected channel comes from **TLS**, Transport Layer Security. TLS verifies the server's identity and encrypts the bytes that follow.

A quick outside check can show the path reached the TLS listener:

```bash
$ nc -vz app.example.com 443
Connection to app.example.com (203.0.113.25) 443 port [tcp/https] succeeded!
```

That line only proves the TCP port is reachable. It does not prove the certificate is valid, the hostname matches, the proxy config is correct, or the app is healthy. TLS and HTTP answer those next questions.

## TLS: Proving and Protecting the Connection
<!-- section-summary: TLS verifies the server certificate, agrees on shared encryption keys, and protects the HTTP conversation from observers. -->

**TLS** is the security protocol behind HTTPS. It gives the browser two guarantees. First, it helps prove the server is allowed to speak for the hostname. Second, it encrypts the HTTP data so other machines on the path cannot read cookies, tokens, passwords, request bodies, or responses.

The TLS handshake is the setup conversation before HTTP. In plain language, the browser says which hostname it wants, which TLS versions it supports, and which cryptographic algorithms it can use. The server sends a certificate for the hostname. The browser verifies that certificate. The client and server then agree on shared keys and start sending encrypted data.

The hostname part is important. A single IP address can host many HTTPS sites. The browser includes the target hostname in the ClientHello through **SNI**, Server Name Indication. Nginx or a load balancer uses that hostname to choose the right certificate.

You can inspect the certificate a server presents:

```bash
$ openssl s_client -connect app.example.com:443 -servername app.example.com </dev/null 2>/dev/null \
>   | openssl x509 -noout -subject -issuer -dates
subject=CN = app.example.com
issuer=C = US, O = Let's Encrypt, CN = R3
notBefore=Jun 01 00:00:00 2026 GMT
notAfter=Aug 30 23:59:59 2026 GMT
```

The `-servername app.example.com` flag sends SNI. Without it, a multi-site server may return a default certificate for a different hostname. That can create a false hostname mismatch during testing.

Modern production TLS usually supports TLS 1.2 and TLS 1.3. TLS 1.3 reduces handshake round trips and removes old key exchange patterns that did not provide forward secrecy. **Forward secrecy** means recorded traffic stays protected even if the server's long-term private key leaks later, because each session used fresh temporary key material.

## Certificates and the Chain of Trust
<!-- section-summary: A certificate connects a hostname to a public key, and the client trusts it through a chain ending at a trusted root CA. -->

A **certificate** is a signed document that says a public key belongs to a hostname such as `app.example.com`. The server proves it owns the matching private key during the TLS handshake. The browser checks that the certificate is signed by a trusted Certificate Authority, usually shortened to CA.

The trust path usually has three levels:

1. The server certificate for `app.example.com`.
2. One or more intermediate CA certificates.
3. A root CA certificate already trusted by the operating system or browser.

The server should send the server certificate plus the intermediate certificates. This combined file is often called the **full chain**. Let's Encrypt's `certbot` writes it as `fullchain.pem`. Nginx should serve that file, not only the leaf certificate.

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

Certificate automation is standard production practice. Let's Encrypt certificates expire after 90 days, so renewal should run automatically and monitoring should alert before expiration. A simple expiration check looks like this:

```bash
$ echo | openssl s_client -connect app.example.com:443 -servername app.example.com 2>/dev/null \
>   | openssl x509 -noout -enddate
notAfter=Aug 30 23:59:59 2026 GMT
```

That date belongs in monitoring. An expired certificate takes down the user-facing request path even while DNS, routing, firewall rules, Nginx, and the app are all working.

## What HTTP Looks Like Inside the Connection
<!-- section-summary: HTTP carries the actual application request and response after TLS has created the protected channel. -->

After TLS completes, the browser sends HTTP. **HTTP**, Hypertext Transfer Protocol, is the application protocol your code uses through `fetch`, `axios`, browsers, API clients, and webhooks.

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

## Methods, Status Codes, and Headers
<!-- section-summary: Methods describe client intent, status codes describe server results, and headers carry metadata needed by browsers, proxies, and applications. -->

An HTTP **method** tells the server what the client is trying to do.

| Method | Meaning | Common example |
| --- | --- | --- |
| `GET` | Read a resource | Load `/dashboard` or fetch `/api/users` |
| `POST` | Create a resource or trigger an action | Submit a form or create an order |
| `PUT` | Replace a resource | Replace a profile document |
| `PATCH` | Partially update a resource | Change one profile field |
| `DELETE` | Remove a resource | Delete a saved item |
| `OPTIONS` | Ask which methods and headers are allowed | Browser CORS preflight |
| `HEAD` | Fetch headers without the body | Check metadata or caching |

Status codes tell you what happened. The first digit gives the family.

| Family | Meaning | Examples |
| --- | --- | --- |
| `2xx` | Success | `200 OK`, `201 Created`, `204 No Content` |
| `3xx` | Redirect or cache response | `301 Moved Permanently`, `302 Found`, `304 Not Modified` |
| `4xx` | Client-side problem | `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests` |
| `5xx` | Server-side or upstream problem | `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout` |

For the request path, `502` and `504` are especially useful. A `502 Bad Gateway` from Nginx means Nginx accepted the client request but got an invalid or failed response from the upstream app. A `504 Gateway Timeout` means Nginx waited for the upstream app and did not receive a response in time.

Headers carry metadata. Some headers matter constantly:

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

## Inspecting the Whole Request with curl
<!-- section-summary: curl can measure DNS, TCP, TLS, HTTP status, headers, and body behavior from one command line. -->

`curl` is the workbench for HTTP and TLS debugging. It can show the TLS handshake, request headers, response headers, redirect behavior, status codes, and timing.

Verbose mode shows the conversation:

```bash
$ curl -v https://app.example.com/dashboard
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

Headers only:

```bash
$ curl -I https://app.example.com/dashboard
HTTP/2 200
content-type: text/html; charset=utf-8
cache-control: no-store
server: nginx
```

JSON POST:

```bash
$ curl -X POST https://app.example.com/api/orders \
>   -H "Content-Type: application/json" \
>   -H "Authorization: Bearer token" \
>   -d '{"sku":"book-123","quantity":1}'
```

Timing output breaks one request into phases:

```bash
$ curl -o /dev/null -s \
>   -w "dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s first_byte=%{time_starttransfer}s total=%{time_total}s\n" \
>   https://app.example.com/dashboard
dns=0.012s connect=0.044s tls=0.091s first_byte=0.180s total=0.214s
```

That timing connects directly to the request path. Slow DNS points to resolver work. Slow connect points to routing, firewall, or TCP. Slow TLS points to handshake and certificate negotiation. Slow first byte points to Nginx or the upstream app.

## HTTP and TLS Failure Modes
<!-- section-summary: HTTP and TLS failures usually identify themselves through certificate errors, redirect loops, CORS blocks, content-type mismatches, and upstream status codes. -->

**Expired certificate** is the classic TLS outage. Browsers show a privacy warning. `curl` reports a certificate problem. Node.js may throw `CERT_HAS_EXPIRED`. The fix is renewal, plus monitoring that alerts before the next expiration.

```bash
$ curl https://app.example.com
curl: (60) SSL certificate problem: certificate has expired
```

**Hostname mismatch** happens when the certificate is valid for one name but the client connects to another. A cert for `www.example.com` does not cover `api.example.com` unless the Subject Alternative Name list includes it.

```bash
$ curl https://api.example.com
curl: (60) SSL: no alternative certificate subject name matches target host name 'api.example.com'
```

The certificate check should include SNI and the target name:

```bash
$ openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null \
>   | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
```

**Incomplete certificate chain** happens when the server sends only its own certificate and misses the intermediate CA. Browsers may still work because they cache intermediates. Backend clients, webhooks, and minimal containers often fail. The Nginx fix is to serve `fullchain.pem`.

**Wrong Content-Type** creates app bugs that look like parsing failures. A server returns JSON with `Content-Type: text/html`, or a client sends JSON without `Content-Type: application/json`. The status code might be `200`, but the client parser fails or the server reads the body incorrectly.

**Redirect loops** happen when proxy, app, and CDN rules disagree. One layer redirects HTTP to HTTPS. Another layer thinks the original scheme was HTTP because `X-Forwarded-Proto` is missing. The app redirects back to HTTPS again and again.

```bash
$ curl -L -v https://app.example.com 2>&1 | grep -E '^< (HTTP|location:)'
< HTTP/2 301
< location: https://app.example.com/dashboard
< HTTP/2 301
< location: https://app.example.com/dashboard
```

**CORS errors** are browser-enforced access rules. CORS stands for Cross-Origin Resource Sharing. If JavaScript from `https://app.example.com` calls `https://api.example.com`, the browser checks whether the API response permits that origin. `curl` may work while the browser blocks the response, because CORS protects browser users from scripts running on other origins.

**502 and 504 responses** move the investigation to Nginx and the app. TLS worked. HTTP reached the proxy. The proxy could not get a valid timely response from the upstream service. The next article picks up exactly there.

---

**References**

- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) - Current HTTP semantics specification for methods, status codes, and fields.
- [RFC 8446: TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446) - TLS 1.3 protocol specification.
- [MDN Web Docs: HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) - Practical HTTP reference for web developers.
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/) - Official certificate and ACME documentation.
- [curl Everything](https://everything.curl.dev/) - Official, detailed guide to curl behavior and debugging.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration guidance for servers including Nginx.
