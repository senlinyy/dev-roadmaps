---
title: "Web Servers & Reverse Proxies"
description: "Configure Nginx as the public front door for an app, including virtual hosts, TLS termination, proxy headers, static files, and load balancing."
overview: "Learn how Nginx receives the HTTPS request, serves or forwards it, preserves client context, and passes traffic to the application safely."
tags: ["nginx", "reverse-proxy", "virtual-host", "tls", "load-balancing"]
order: 6
id: article-devops-foundation-networking-nginx-reverse-proxy
---

## Table of Contents

1. [Web Server, App Server, and Reverse Proxy](#web-server-app-server-and-reverse-proxy)
2. [Nginx in a Browser Request](#nginx-in-a-browser-request)
3. [Installing Nginx and Finding the Config](#installing-nginx-and-finding-the-config)
4. [Server Blocks and Location Blocks](#server-blocks-and-location-blocks)
5. [Serving Static Files](#serving-static-files)
6. [Reverse Proxying to the App](#reverse-proxying-to-the-app)
7. [TLS Termination with Let's Encrypt](#tls-termination-with-lets-encrypt)
8. [Load Balancing and Health Behavior](#load-balancing-and-health-behavior)
9. [Nginx Failure Modes](#nginx-failure-modes)
10. [References](#references)

## Web Server, App Server, and Reverse Proxy
<!-- section-summary: A web server handles public HTTP infrastructure work, while the app server focuses on application logic. -->

The first deployment often exposes the app process directly: Node, Django, Rails, FastAPI, Go, or Java listens on a public port and answers browser traffic itself. That can work for a small test, then the rough edges appear. TLS certificates need renewal. Static files need caching. Slow clients can tie up app workers. Redirects, access logs, compression, and large uploads all land inside the app runtime.

Production teams usually put a **web server** in front of that app process. Nginx is a web server. Apache httpd, Caddy, and Envoy can play similar roles. The web server handles repeatable HTTP infrastructure work: connections, static files, TLS, logging, compression, redirects, buffering, and proxying.

The **app server** stays focused on product behavior. It talks to databases, checks authentication, renders pages, or returns JSON.

A **reverse proxy** is the web server role where Nginx sits in front of one or more app servers and forwards client requests inward. The client believes it is talking to `app.example.com`. Nginx receives that request and proxies it to an internal app address.

This split exists because public web traffic includes a lot of repeatable infrastructure work. Nginx can handle TLS certificates, HTTP redirects, static assets, access logs, buffering, and slow clients with a small, stable config. The app server can spend its time on routes, database calls, authentication, and business behavior.

On a single server, the layout often looks like this:

```
Browser HTTPS -> Nginx :443 -> Node app http://127.0.0.1:3000
```

In a cloud deployment, it may look like this:

```
Browser HTTPS -> Load balancer :443 -> Nginx or app target -> app containers
```

The benefit is separation. Nginx handles public web mechanics. The app handles product behavior. Your app does not need to implement TLS renewal, static asset caching, gzip, slow-client buffering, virtual hosts, or access logs from scratch.

Nginx also has a useful architecture for this job. It runs a master process and worker processes. Workers use an event loop to handle many connections without one thread per client. That design lets Nginx absorb slow clients and keep app servers focused on complete requests.

The production symptom usually points at the side that needs attention. If static files return `403`, inspect Nginx paths and file permissions. If `/api/health` returns `502`, inspect the app process and `proxy_pass`. If login redirects loop, inspect forwarded headers and app trust-proxy settings.

## Nginx in a Browser Request
<!-- section-summary: Nginx receives the request after DNS, routing, firewall policy, and TLS have brought the browser to the server. -->

Before Nginx sees a request, several network checks have already happened. The browser resolved `app.example.com`, routed to the right IP, passed firewall rules, and completed TLS on port `443`. Nginx receives the request after those steps and decides which site or upstream should handle it.

For the user, the URL still looks simple:

```
https://app.example.com/dashboard
```

Nginx receives the public HTTPS request. It chooses the right site based on the hostname. It may serve a static file directly. It may redirect HTTP to HTTPS. It may forward `/api/*` requests to an app process running on `127.0.0.1:3000` or a private VPC address. It writes access logs and error logs so the team can debug what happened.

Under the hood, Nginx selects a `server` block from the local address, port, SNI hostname during TLS, and HTTP `Host` header. Then it selects a `location` block from the request path. That two-step matching is why a request can reach Nginx and still land in the wrong app if `server_name` or `location` rules are too broad.

This is the final handoff in the networking section. Everything before Nginx gets the request to the front door. Nginx decides which internal door the request should use.

## Installing Nginx and Finding the Config
<!-- section-summary: Nginx installs as a system service with predictable config and log paths on common Linux distributions. -->

Installing Nginx turns the proxy role into a real service on the VM. Before writing a server block for `app.example.com`, confirm that the package is installed, the systemd service can start, and the config paths match the distribution. On Ubuntu and Debian, Nginx uses a main config file plus enabled site files. Logs live under `/var/log/nginx`, so a broken proxy has a predictable place to leave evidence.

On Ubuntu or Debian, Nginx installation is usually:

```bash
sudo apt update
sudo apt install nginx -y
```

Example output:

```console
Reading package lists... Done
Setting up nginx (1.24.0-2ubuntu1) ...
Created systemd service link for nginx.service.
```

The service is managed by systemd:

```bash
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl status nginx
```

Example output:

```console
● nginx.service - A high performance web server and a reverse proxy server
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)
     Active: active (running) since Wed 2026-06-24 10:21:00 UTC
   Main PID: 1200 (nginx)
      Tasks: 3
```

The `Active: active (running)` line shows the service is up, and `Main PID: 1200 (nginx)` shows the master process is running. The default page confirms Nginx is listening:

```bash
curl -I http://localhost
```

Example output:

```console
HTTP/1.1 200 OK
Server: nginx
```

The most useful paths are:

| Path | Purpose |
| --- | --- |
| `/etc/nginx/nginx.conf` | Main Nginx configuration |
| `/etc/nginx/sites-available/` | Debian/Ubuntu site configs that exist but may not be enabled |
| `/etc/nginx/sites-enabled/` | Symlinks to enabled site configs |
| `/etc/nginx/conf.d/` | Drop-in config files loaded by many distributions |
| `/var/log/nginx/access.log` | One line per handled request |
| `/var/log/nginx/error.log` | Startup errors, proxy errors, TLS errors, and warnings |

Every config change should pass the syntax test before reload:

```bash
sudo nginx -t
```

Example output:

```console
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

After the test succeeds, reload the service:

```bash
sudo systemctl reload nginx
```

The safe rollout sequence is:

- `nginx -t` checks syntax and included files.
- The `syntax is ok` and `test is successful` lines mean Nginx accepted the config.
- `systemctl reload nginx` applies the new config without dropping existing connections.

A syntax test protects the running service from a typo.

The next decision after a successful reload is verification from both sides. `curl http://localhost` proves the local listener works. `curl -I https://app.example.com` proves DNS, firewall rules, TLS, and the public server block work together. If the local check passes and the public check fails, the problem sits earlier in the network path or in TLS/server-name selection.

## Server Blocks and Location Blocks
<!-- section-summary: A server block selects the hostname and port, while location blocks choose behavior for specific URL paths. -->

Two requests can land on the same Nginx process and need different handling. `https://app.example.com/api/users` should go to the app. `https://app.example.com/assets/main.js` should come from disk. If the same machine also hosts `admin.example.com`, that hostname may need a completely different site config.

Nginx uses a **server block** to answer "which site is this request for?" It usually matches the local port and `server_name`, which comes from the requested hostname.

Inside that site, Nginx uses a **location block** to answer "what should this site do with this path?" That is how one domain can split traffic between static files, health checks, APIs, WebSockets, and app pages.

A small site config shows the shape:

```nginx
server {
    listen 80;
    server_name app.example.com;

    location = /health {
        return 200 "ok\n";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        root /var/www/app;
        try_files $uri $uri/ /index.html;
    }
}
```

The `server_name` matches the `Host` header from the HTTP request. The exact `/health` location returns a simple response for health checks. The `/api/` location forwards dynamic API requests to the app. The `/` location serves static files and falls back to `index.html`, which is common for single-page apps.

The important lines split the request by hostname, port, and path:

- `listen 80` tells Nginx to accept plain HTTP on port `80` for this server block.
- `server_name app.example.com` selects the block for requests whose `Host` header is `app.example.com`.
- `location = /health` is an exact match, so only `/health` uses this small health response.
- `return 200 "ok\n"` sends a direct response from Nginx without involving the app.
- `location /api/` catches paths under `/api/`, such as `/api/users`.
- `proxy_pass http://127.0.0.1:3000` forwards those API requests to the app process on the same host.
- `location /` catches the remaining paths for this site.
- `root /var/www/app` maps those paths to files under the built frontend directory.
- `try_files $uri $uri/ /index.html` checks the requested file, then a directory, then returns the SPA fallback file.

Location matching has an order that matters. Exact matches such as `location = /health` are checked before ordinary prefix matches. A longer prefix such as `/api/` is more specific than `/`. That is why `/api/users` goes to the app while `/dashboard` falls through to the static app route.

This routing happens after TLS and HTTP parsing. If `curl -I https://app.example.com/dashboard` returns a response with `server: nginx`, the request has reached this part of the path. The next decision is to test the exact path that fails. A passing `/health` route proves Nginx can answer, while a failing `/api/users` route may still point at proxy or upstream behavior.

## Serving Static Files
<!-- section-summary: Static file serving lets Nginx return built assets directly without sending every request to the app process. -->

A frontend build can contain thousands of files that do not need application logic on every request: HTML, CSS, JavaScript bundles, images, fonts, and downloadable assets. Sending all of that through the app process wastes CPU and memory that the app could use for dynamic work. Nginx can return those files directly from disk and leave the app process focused on API requests, auth decisions, background state, and database-backed pages.

A simple static site config looks like this:

```nginx
server {
    listen 80;
    server_name app.example.com;

    root /var/www/app;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The `root` directive maps URL paths to files under `/var/www/app`. A request for `/assets/main.js` maps to `/var/www/app/assets/main.js`. The `try_files` directive checks the requested path first, then a directory path, then falls back to `/index.html`.

The static block keeps the file-serving path explicit:

- `listen 80` opens the HTTP listener for the site.
- `server_name app.example.com` ties this static site to one hostname.
- `root /var/www/app` sets the document root used by locations that do not override it.
- `index index.html` chooses the default file for a directory request.
- `location /` applies the rule to every path under the site.
- `try_files $uri $uri/ /index.html` serves real files first and uses `index.html` for client-side routes.

Under the hood, Nginx builds a filesystem path from the configured root and the request URI. If that path exists and permissions allow the Nginx worker user to read it, Nginx can return it directly. If the path is missing, `try_files` moves to the next candidate.

That fallback matters for React, Vue, and other client-side routers. A user can refresh `/dashboard/settings`. Nginx does not have a real file at `/var/www/app/dashboard/settings`, so it serves `index.html`. The browser app starts and renders the right route.

File permissions need attention:

```bash
sudo mkdir -p /var/www/app
sudo cp -r dist/* /var/www/app/
sudo chown -R www-data:www-data /var/www/app
sudo find /var/www/app -type d -exec chmod 755 {} \;
sudo find /var/www/app -type f -exec chmod 644 {} \;
```

The permissions are doing practical work:

- `mkdir -p` creates the document root if it is missing.
- `cp -r dist/*` copies the built app files.
- `chown -R www-data:www-data` gives the Nginx user ownership on Debian and Ubuntu.
- Directory mode `755` lets Nginx enter directories.
- File mode `644` lets Nginx read files.

If Nginx cannot read files, users see `403 Forbidden` even though the files are present. The error log will usually say `permission denied`. The next decision is whether the file is missing or unreadable: `404` usually points at the path, while `403` usually points at permissions or directory execute bits.

## Reverse Proxying to the App
<!-- section-summary: proxy_pass forwards requests to an internal app while headers preserve the original client and scheme. -->

Now put Nginx on the public side and keep the app private. The browser reaches `app.example.com` on port `80` or `443`. The app listens only on `127.0.0.1:3000`, so outside clients cannot bypass Nginx and hit the app port directly.

The bridge between those two sides is `proxy_pass`. It tells Nginx where to send matching requests after Nginx has accepted the public HTTP request.

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Build that config one line at a time:

- `listen 80` opens the public HTTP listener for this server block.
- `server_name app.example.com` selects this block for the requested hostname.
- `location /` applies the proxy behavior to every path unless a more specific location overrides it.
- `proxy_pass http://127.0.0.1:3000` sends the request to the app on the same host.

The `proxy_set_header` lines preserve information the app needs:

| Header | Why it matters |
| --- | --- |
| `Host` | The app sees `app.example.com`, not `127.0.0.1:3000` |
| `X-Real-IP` | The app can log the direct client IP seen by Nginx |
| `X-Forwarded-For` | The app can track the chain of client and proxy IPs |
| `X-Forwarded-Proto` | The app knows the original request scheme was HTTP or HTTPS |

Without these headers, every request may look like it came from Nginx. Rate limiting, audit logs, absolute URL generation, and HTTPS redirects can all break.

The app also needs to know which proxy headers it can trust. Many frameworks ignore `X-Forwarded-*` by default because clients can spoof those headers if the app is exposed directly. In production, restrict direct access to the app port and enable the framework's trusted proxy setting only for the Nginx or load balancer path.

The trailing slash on `proxy_pass` is one of the most common Nginx surprises:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
}
```

With no trailing slash after the upstream host, `/api/users` forwards as `/api/users`.

The first form preserves the full original URI:

- `location /api/` matches the `/api/` prefix.
- `proxy_pass http://127.0.0.1:3000` has no URI part after the host and port.
- Nginx forwards `/api/users` to the upstream as `/api/users`.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000/;
}
```

With the trailing slash, `/api/users` forwards as `/users`. The matching location prefix is replaced. If the backend routes include `/api/users`, the first form fits. If the backend routes include only `/users`, the second form fits.

The second form rewrites the matched prefix:

- `location /api/` still matches the same public prefix.
- `proxy_pass http://127.0.0.1:3000/` includes a URI part, the trailing `/`.
- Nginx replaces the matched `/api/` prefix with `/`, so `/api/users` reaches the app as `/users`.

A common production split uses Nginx for static assets and the app for API routes:

```nginx
server {
    listen 80;
    server_name app.example.com;

    location /assets/ {
        root /var/www/app;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        root /var/www/app;
        try_files $uri $uri/ /index.html;
    }
}
```

That keeps static asset load away from the app and sends only dynamic API work to the app process.

The split config gives each path a clear owner:

- `location /assets/` handles bundled frontend files directly from disk.
- `root /var/www/app` maps `/assets/main.js` to `/var/www/app/assets/main.js`.
- `expires 30d` sets a browser cache lifetime for assets that should have hashed filenames.
- `add_header Cache-Control "public, immutable"` tells browsers and caches that the asset can be reused without revalidation during that lifetime.
- `location /api/` sends dynamic API paths to the Node, Python, Go, or other app server.
- The proxy headers preserve the original hostname, client address chain, and request scheme.
- `location /` serves the frontend shell and uses `try_files` so deep client-side routes refresh correctly.

The next decision after writing a proxy block is to test from Nginx's point of view and from the public hostname. Local `curl http://127.0.0.1:3000/health` proves the upstream app answers on the host. Public `curl -I https://app.example.com/api/health` proves Nginx path matching, proxy headers, firewall rules, and TLS work together.

## TLS Termination with Let's Encrypt
<!-- section-summary: TLS termination lets Nginx handle public HTTPS while the app receives internal HTTP. -->

After the proxy works over HTTP, the public site still needs HTTPS. Nginx is the right place to handle the certificate because it already owns the public listener and hostname selection.

**TLS termination** means the encrypted browser connection ends at Nginx. Nginx decrypts the request, reads the HTTP message, and forwards plain HTTP to the app over a trusted internal hop such as `127.0.0.1`. Teams use TLS termination because it centralizes certificate files, renewal, redirects, and TLS settings in the web server.

If the app sits on another host or crosses an untrusted network, many teams use TLS again between Nginx and the upstream app. On a single VM, plain HTTP over loopback is common because the traffic never leaves the host.

Let's Encrypt and Certbot are a common setup:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d app.example.com
```

Example output:

```console
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/app.example.com/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/app.example.com/privkey.pem
Deploying certificate
Successfully deployed certificate for app.example.com to /etc/nginx/sites-enabled/app
```

The two commands do different jobs:

- `apt install` adds Certbot and the Nginx plugin.
- `certbot --nginx -d app.example.com` proves domain control, requests the certificate, updates Nginx config, and installs a renewal timer.

The resulting config usually has one HTTP redirect block and one HTTPS block:

```nginx
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `fullchain.pem` file includes the server certificate and intermediate certificates. The `privkey.pem` file is the private key and must stay protected. Nginx's master process reads the certificate files, then worker processes handle connections.

The TLS config has two jobs: redirect plain HTTP and serve HTTPS correctly:

- The first `server` block listens on `80`, matches `app.example.com`, and returns a permanent redirect to the same host and path over HTTPS.
- `return 301 https://$host$request_uri` preserves the requested hostname and path during the redirect.
- The second `server` block listens on `443` with `ssl` and `http2`, so it can accept encrypted HTTP/2-capable connections.
- `ssl_certificate` points at the public certificate chain sent to clients.
- `ssl_certificate_key` points at the private key used by Nginx during the TLS handshake.
- `ssl_protocols TLSv1.2 TLSv1.3` disables older TLS protocol versions.
- `proxy_pass http://127.0.0.1:3000` keeps the app on internal HTTP behind Nginx.
- `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` preserve the public request details for logs, redirects, rate limits, and absolute URL generation.

SNI connects TLS termination back to server-block matching. When a client asks for `app.example.com`, Nginx uses the SNI hostname to choose which certificate to present. If the wrong default server block catches the request, the browser may receive a certificate for another domain before HTTP routing even starts.

Renewal checks should be routine:

```bash
sudo certbot certificates
```

Example output:

```console
Certificate Name: app.example.com
    Domains: app.example.com
    Expiry Date: 2026-08-30 23:59:59+00:00 (VALID: 58 days)
    Certificate Path: /etc/letsencrypt/live/app.example.com/fullchain.pem
```

Now test renewal without replacing the live certificate:

```bash
sudo certbot renew --dry-run
```

Example output:

```console
Congratulations, all simulated renewals succeeded:
  /etc/letsencrypt/live/app.example.com/fullchain.pem (success)
```

The first output lists the installed certificate and expiration date. The dry run proves renewal can complete before the certificate is close to expiration. External monitoring should still watch the public certificate date because local automation can fail silently. The next decision is alert timing: alert early enough to renew, reload Nginx, and test the certificate from outside the server.

## Load Balancing and Health Behavior
<!-- section-summary: Nginx can send requests to multiple app backends and temporarily avoid backends that fail. -->

Once one app process works, the next production step is often multiple app processes. Several processes give the service more capacity and make restarts less disruptive, but Nginx needs one shared name for that group so the public route can stay stable. The `upstream` block creates that backend group.

Load balancing exists because one backend should not carry all requests forever. It also lets you restart one process while other processes keep serving. Nginx still needs a way to notice repeated backend failures, which is where `max_fails` and `fail_timeout` help.

```nginx
upstream app_backend {
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3003 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://app_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

By default, Nginx uses round-robin routing. The first request goes to the first backend, the next to the second, and so on. `max_fails=3 fail_timeout=30s` tells Nginx to pause a backend for a short period if it fails repeatedly.

The upstream block names the backend pool and sets failure behavior:

- `upstream app_backend` creates a reusable group name for the app servers.
- Each `server 127.0.0.1:3001` line adds one backend endpoint to the pool.
- `max_fails=3` marks a backend unhealthy after three failed attempts during the failure window.
- `fail_timeout=30s` defines that window and the short pause before Nginx tries the backend again.
- `proxy_pass http://app_backend` sends matching requests to the named backend group.
- The proxy headers keep the app aware of the public hostname and request scheme even while traffic is load balanced.

Open source Nginx mainly uses passive health behavior for proxied HTTP backends. That means Nginx reacts to failures it sees during real requests. A separate load balancer or Nginx Plus can run active health checks that probe backends before user traffic arrives. The practical decision is whether passive failure handling is enough for the service or whether a platform load balancer should own active health checks.

Other balancing methods exist:

```nginx
upstream app_backend {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}
```

`least_conn` sends new requests to the backend with fewer active connections. This helps when requests have uneven durations.

The method change is small and important:

- `least_conn` changes the balancing algorithm for this upstream group.
- The `server` lines still list the backend endpoints that can receive traffic.
- New requests prefer the backend with fewer active connections, which helps with long downloads, slow API calls, or mixed request lengths.

One app design detail matters here: session storage. If login sessions live only in memory inside one app process, round-robin routing can make users appear logged out when the next request lands on a different process. Production apps behind load balancers usually store sessions in Redis, a database, signed cookies, or another shared place so any backend can handle any request.

The next decision after adding an upstream group is observability. Access logs should include upstream address and timing so a slow or failing backend can be identified. Without that, every `502` looks the same from the outside.

## Nginx Failure Modes
<!-- section-summary: Nginx failures usually show up as syntax errors, port conflicts, upstream 502 or 504 responses, missing proxy headers, buffering, or WebSocket upgrade problems. -->

Nginx failures are easier to debug if you gather the evidence in the same order each time. First check whether the configuration parses. Then confirm the service can bind to its ports. After that, use access logs, error logs, and upstream status to separate client problems, proxy problems, and application problems.

**Config syntax error** prevents reload:

```bash
sudo nginx -t
```

Example output:

```console
nginx: [emerg] unknown directive "proxypass" in /etc/nginx/sites-enabled/app:18
nginx: configuration file /etc/nginx/nginx.conf test failed
```

The error names the file and line. In this case, `proxypass` should be `proxy_pass`. Because the test failed, a reload should wait until the config is fixed.

**Port already in use** means another process owns `80` or `443`:

```bash
sudo ss -tlnp | grep -E ':80|:443'
```

Example output:

```console
LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=1400,fd=4))
```

The output shows Apache owns port `80`. Nginx cannot bind a port already held by Apache, another Nginx instance, a dev server, or a container port mapping.

**502 Bad Gateway** means Nginx could not get a valid response from the upstream app. The app may be down, listening on another port, crashing mid-response, or bound to the wrong interface.

```bash
curl -v http://127.0.0.1:3000/health
```

Example output:

```console
*   Trying 127.0.0.1:3000...
* connect to 127.0.0.1 port 3000 failed: Connection refused
curl: (7) Failed to connect to 127.0.0.1 port 3000
```

Now check the Nginx error log for the proxy-side evidence:

```bash
sudo tail -50 /var/log/nginx/error.log
```

Example output:

```console
2026/06/24 10:45:12 [error] 1201#1201: *18 connect() failed (111: Connection refused) while connecting to upstream, client: 198.51.100.50, server: app.example.com, request: "GET /api/health HTTP/2.0", upstream: "http://127.0.0.1:3000/api/health"
```

The local curl checks the backend from the same host as Nginx. The error log usually shows `connect() failed`, `upstream prematurely closed connection`, or another upstream clue. If local curl fails, fix the app process or its listen address before changing public DNS or firewall rules.

**504 Gateway Timeout** means the upstream accepted the connection but did not respond before Nginx's timeout.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_connect_timeout 10s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

Longer timeouts can help a known long request, but the app logs and database timings should explain why the request took that long.

The timeout lines describe which part of the upstream conversation waited too long:

- `proxy_connect_timeout 10s` limits how long Nginx waits to establish the connection to the app.
- `proxy_send_timeout 60s` limits stalls while Nginx sends the request to the app.
- `proxy_read_timeout 60s` limits how long Nginx waits for the app to send response data.
- Raising these values should match a known endpoint behavior, such as a report export, and app logs should confirm the request is still making progress.

**Redirect loop** often means the app does not know the original request used HTTPS. The fix is usually `X-Forwarded-Proto` plus framework trust-proxy settings. For Express, that often means:

```js
app.set("trust proxy", true);
```

Then the app can treat `X-Forwarded-Proto: https` as the original scheme from Nginx.

That one line changes how Express reads proxy headers:

- `"trust proxy"` tells Express to trust headers from the proxy path in front of it.
- `true` trusts the configured deployment path, so direct public access to the app port should stay blocked by firewall rules.
- With the Nginx `X-Forwarded-Proto` header in place, Express can generate HTTPS redirects and secure-cookie behavior from the original public scheme.

**WebSocket upgrade failure** happens when Nginx proxies a WebSocket endpoint without forwarding upgrade headers:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400s;
}
```

WebSockets start as HTTP and then upgrade the connection. The `Upgrade` and `Connection` headers tell the upstream app that the client wants to switch protocols. Without those headers, the app may treat the request like normal HTTP, and the browser console may show failed WebSocket handshakes, reconnect loops, or unexpected `400` responses.

The WebSocket config keeps the upgraded connection open:

- `location /socket.io/` targets the path used by the WebSocket endpoint.
- `proxy_http_version 1.1` uses an HTTP version that supports the upgrade flow used here.
- `proxy_set_header Upgrade $http_upgrade` forwards the client's upgrade request.
- `proxy_set_header Connection "upgrade"` tells the upstream to switch protocols.
- `proxy_read_timeout 86400s` allows long-lived idle WebSocket connections instead of closing them after a short HTTP timeout.

**Streaming response buffering** happens when Server-Sent Events, log streams, or AI token streams arrive at the client all at once. Nginx buffers upstream responses by default. Streaming routes often need:

```nginx
location /events {
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;
    proxy_cache off;
}
```

The streaming route disables features that delay chunks:

- `location /events` targets the streaming endpoint.
- `proxy_pass http://127.0.0.1:3000` still sends the request to the internal app.
- `proxy_buffering off` asks Nginx to pass upstream chunks through promptly.
- `proxy_cache off` prevents a cache layer from storing or replaying a live stream response.

A fast diagnostic set covers most Nginx incidents:

```bash
sudo systemctl status nginx
sudo nginx -t
sudo tail -50 /var/log/nginx/error.log
sudo tail -20 /var/log/nginx/access.log
sudo ss -tlnp | grep -E ':80|:443|:3000'
curl -v http://127.0.0.1:3000/health
curl -I https://app.example.com/dashboard
```

Example output:

```console
HTTP/2 200
server: nginx
content-type: text/html; charset=utf-8
```

Those commands walk the final part of the path:

- `systemctl status nginx` checks whether the service is running.
- `nginx -t` checks whether the current config is valid.
- `error.log` shows startup, TLS, and upstream failures.
- `access.log` shows requests Nginx actually handled.
- `ss -tlnp` confirms which processes own ports `80`, `443`, and `3000`.
- Local `curl` checks the upstream app from Nginx's point of view.
- Public `curl -I` checks the user-facing hostname.

If they all pass, the browser request has crossed DNS, routing, firewalls, TLS, Nginx, and reached the app path successfully.

## References

- [Nginx Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html) - Official Nginx introduction covering processes, config structure, and request handling.
- [Nginx Admin Guide](https://docs.nginx.com/nginx/admin-guide/) - Official administration guide for reverse proxying, load balancing, and TLS.
- [Nginx `proxy_pass` Documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) - Authoritative reference for proxy behavior and URI rewriting.
- [Certbot Documentation](https://eff-certbot.readthedocs.io/) - Official Certbot documentation for Let's Encrypt certificate issuance and renewal.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration recommendations for Nginx and other servers.
