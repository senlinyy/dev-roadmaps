---
title: "Web Servers & Reverse Proxies"
description: "Configure Nginx as the public front door for an app, including virtual hosts, TLS termination, proxy headers, static files, and load balancing."
overview: "Learn how Nginx receives the HTTPS request, serves or forwards it, preserves client context, and passes traffic to the application safely."
tags: ["nginx", "reverse-proxy", "virtual-host", "tls", "load-balancing"]
order: 6
id: article-devops-foundation-networking-nginx-reverse-proxy
---

## Table of Contents

1. [Nginx at the End of the Network Path](#nginx-at-the-end-of-the-network-path)
2. [Web Server, App Server, and Reverse Proxy](#web-server-app-server-and-reverse-proxy)
3. [Installing Nginx and Finding the Config](#installing-nginx-and-finding-the-config)
4. [Server Blocks and Location Blocks](#server-blocks-and-location-blocks)
5. [Serving Static Files](#serving-static-files)
6. [Reverse Proxying to the App](#reverse-proxying-to-the-app)
7. [TLS Termination with Let's Encrypt](#tls-termination-with-lets-encrypt)
8. [Load Balancing and Health Behavior](#load-balancing-and-health-behavior)
9. [Nginx Failure Modes](#nginx-failure-modes)

## Nginx at the End of the Network Path
<!-- section-summary: Nginx receives the request after DNS, routing, firewall policy, and TLS have brought the browser to the server. -->

The shared request path is `browser -> DNS -> IP/subnet -> firewall -> TLS -> Nginx reverse proxy -> app`. At this point, the browser resolved `app.example.com`, routed to the right IP, passed firewall rules, and completed TLS on port `443`. Now the HTTP request reaches Nginx.

For the user, the URL is still simple:

```
https://app.example.com/dashboard
```

For the server, Nginx has a few jobs to perform. It receives the public HTTPS request. It chooses the right site based on the hostname. It may serve a static file directly. It may redirect HTTP to HTTPS. It may forward `/api/*` requests to an app process running on `127.0.0.1:3000` or a private VPC address. It writes access logs and error logs so the team can debug what happened.

This is the final handoff in the networking section. Everything before Nginx gets the request to the front door. Nginx decides which internal door the request should use.

## Web Server, App Server, and Reverse Proxy
<!-- section-summary: A web server handles public HTTP infrastructure work, while the app server focuses on application logic. -->

A **web server** is infrastructure software that handles HTTP connections, static files, TLS, logging, compression, redirects, buffering, and proxying. Nginx is a web server. Apache httpd, Caddy, and Envoy can play similar roles.

An **app server** is your application process. It might be Node.js, Django, Rails, FastAPI, Go, Java, or another runtime. It knows business logic. It talks to databases. It renders pages or returns JSON.

A **reverse proxy** sits in front of one or more app servers and forwards client requests inward. The client believes it is talking to `app.example.com`. Nginx receives that request and proxies it to an internal app address.

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

## Installing Nginx and Finding the Config
<!-- section-summary: Nginx installs as a system service with predictable config and log paths on common Linux distributions. -->

On Ubuntu or Debian, Nginx installation is usually:

```bash
$ sudo apt update
$ sudo apt install nginx -y
```

The service is managed by systemd:

```bash
$ sudo systemctl enable nginx
$ sudo systemctl start nginx
$ sudo systemctl status nginx
```

Successful status output shows the service active and the worker processes running:

```
● nginx.service - A high performance web server and a reverse proxy server
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)
     Active: active (running) since Wed 2026-06-24 10:21:00 UTC
   Main PID: 1200 (nginx)
      Tasks: 3
```

The default page confirms Nginx is listening:

```bash
$ curl -I http://localhost
HTTP/1.1 200 OK
Server: nginx
```

The paths you will use most often are:

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
$ sudo nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful

$ sudo systemctl reload nginx
```

Reloading applies the new config without dropping existing connections. A syntax test protects the running service from a typo.

## Server Blocks and Location Blocks
<!-- section-summary: A server block selects the hostname and port, while location blocks choose behavior for specific request paths. -->

Nginx configuration is nested. The top-level config controls processes. The `events` block controls connection handling. The `http` block contains web behavior. Inside `http`, each `server` block defines one virtual host, and each `location` block defines behavior for a path.

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

This routing happens after TLS and HTTP parsing. If `curl -I https://app.example.com/dashboard` returns a response with `server: nginx`, the request has reached this part of the path.

## Serving Static Files
<!-- section-summary: Static file serving lets Nginx return built assets directly without sending every request to the app process. -->

Static files are files that can be returned directly from disk: HTML, CSS, JavaScript bundles, images, fonts, and downloadable assets. Nginx is very good at serving them.

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

That fallback matters for React, Vue, and other client-side routers. A user can refresh `/dashboard/settings`. Nginx does not have a real file at `/var/www/app/dashboard/settings`, so it serves `index.html`. The browser app starts and renders the right route.

File permissions need attention:

```bash
$ sudo mkdir -p /var/www/app
$ sudo cp -r dist/* /var/www/app/
$ sudo chown -R www-data:www-data /var/www/app
$ sudo find /var/www/app -type d -exec chmod 755 {} \;
$ sudo find /var/www/app -type f -exec chmod 644 {} \;
```

If Nginx cannot read files, users see `403 Forbidden` even though the files are present. The error log will usually say `permission denied`.

## Reverse Proxying to the App
<!-- section-summary: proxy_pass forwards requests to an internal app while headers preserve the original client and scheme. -->

The reverse proxy path is the most important Nginx pattern for application deployments. Nginx receives the browser request and forwards it to an internal app server.

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

The `proxy_pass` line sends the request to the app. The `proxy_set_header` lines preserve information the app needs:

| Header | Why it matters |
| --- | --- |
| `Host` | The app sees `app.example.com`, not `127.0.0.1:3000` |
| `X-Real-IP` | The app can log the direct client IP seen by Nginx |
| `X-Forwarded-For` | The app can track the chain of client and proxy IPs |
| `X-Forwarded-Proto` | The app knows the original request scheme was HTTP or HTTPS |

Without these headers, every request may look like it came from Nginx. Rate limiting, audit logs, absolute URL generation, and HTTPS redirects can all break.

The trailing slash on `proxy_pass` is one of the most common Nginx surprises:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
}
```

With no trailing slash after the upstream host, `/api/users` forwards as `/api/users`.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000/;
}
```

With the trailing slash, `/api/users` forwards as `/users`. The matching location prefix is replaced. If the backend routes include `/api/users`, the first form fits. If the backend routes include only `/users`, the second form fits.

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

## TLS Termination with Let's Encrypt
<!-- section-summary: TLS termination lets Nginx handle public HTTPS while the app receives internal HTTP. -->

**TLS termination** means the encrypted browser connection ends at Nginx. Nginx decrypts the request, reads the HTTP message, and forwards plain HTTP to the app over a trusted internal hop such as `127.0.0.1`.

Let's Encrypt and Certbot are a common setup:

```bash
$ sudo apt install certbot python3-certbot-nginx -y
$ sudo certbot --nginx -d app.example.com
```

Certbot verifies domain control, issues the certificate, updates Nginx config, and installs a renewal timer. The resulting config usually has one HTTP redirect block and one HTTPS block:

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

Renewal checks should be routine:

```bash
$ sudo certbot certificates
$ sudo certbot renew --dry-run
```

A dry run proves renewal can complete before the certificate is close to expiration. External monitoring should still watch the public certificate date because local automation can fail silently.

## Load Balancing and Health Behavior
<!-- section-summary: Nginx can send requests to multiple app backends and temporarily avoid backends that fail. -->

Once one app process works, the next production step is often multiple app processes. Nginx defines a backend group with `upstream`.

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

Other balancing methods exist:

```nginx
upstream app_backend {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}
```

`least_conn` sends new requests to the backend with fewer active connections. This helps when requests have uneven durations.

One app design detail matters here: session storage. If login sessions live only in memory inside one app process, round-robin routing can make users appear logged out when the next request lands on a different process. Production apps behind load balancers usually store sessions in Redis, a database, signed cookies, or another shared place so any backend can handle any request.

## Nginx Failure Modes
<!-- section-summary: Nginx failures usually show up as syntax errors, port conflicts, upstream 502 or 504 responses, missing proxy headers, buffering, or WebSocket upgrade problems. -->

Nginx errors are usually precise if you check the right log.

**Config syntax error** prevents reload:

```bash
$ sudo nginx -t
nginx: [emerg] unknown directive "proxypass" in /etc/nginx/sites-enabled/app:18
nginx: configuration file /etc/nginx/nginx.conf test failed
```

The error names the file and line. In this case, `proxypass` should be `proxy_pass`.

**Port already in use** means another process owns `80` or `443`:

```bash
$ sudo ss -tlnp | grep -E ':80|:443'
LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=1400,fd=4))
```

Nginx cannot bind a port already held by Apache, another Nginx instance, a dev server, or a container port mapping.

**502 Bad Gateway** means Nginx could not get a valid response from the upstream app. The app may be down, listening on another port, crashing mid-response, or bound to the wrong interface.

```bash
$ curl -v http://127.0.0.1:3000/health
$ sudo tail -50 /var/log/nginx/error.log
```

The local curl checks the backend from the same host as Nginx. The error log usually shows `connect() failed`, `upstream prematurely closed connection`, or another upstream clue.

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

**Redirect loop** often means the app does not know the original request used HTTPS. The fix is usually `X-Forwarded-Proto` plus framework trust-proxy settings. For Express, that often means:

```js
app.set("trust proxy", true);
```

Then the app can treat `X-Forwarded-Proto: https` as the original scheme from Nginx.

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

**Streaming response buffering** happens when Server-Sent Events, log streams, or AI token streams arrive at the client all at once. Nginx buffers upstream responses by default. Streaming routes often need:

```nginx
location /events {
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;
    proxy_cache off;
}
```

A fast diagnostic set covers most Nginx incidents:

```bash
$ sudo systemctl status nginx
$ sudo nginx -t
$ sudo tail -50 /var/log/nginx/error.log
$ sudo tail -20 /var/log/nginx/access.log
$ sudo ss -tlnp | grep -E ':80|:443|:3000'
$ curl -v http://127.0.0.1:3000/health
$ curl -I https://app.example.com/dashboard
```

Those commands walk the final part of the path: Nginx service health, config validity, proxy errors, open ports, upstream app health, and public response. If they all pass, the browser request has crossed DNS, routing, firewalls, TLS, Nginx, and reached the app path successfully.

---

**References**

- [Nginx Beginner's Guide](https://nginx.org/en/docs/beginners_guide.html) - Official Nginx introduction covering processes, config structure, and request handling.
- [Nginx Admin Guide](https://docs.nginx.com/nginx/admin-guide/) - Official administration guide for reverse proxying, load balancing, and TLS.
- [Nginx `proxy_pass` Documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) - Authoritative reference for proxy behavior and URI rewriting.
- [Certbot Documentation](https://eff-certbot.readthedocs.io/) - Official Certbot documentation for Let's Encrypt certificate issuance and renewal.
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/) - Maintained TLS configuration recommendations for Nginx and other servers.
