---
title: "Azure Public Entry Points"
description: "Connect a public Azure hostname to the right entry service, prove DNS and TLS, route to healthy backends, and diagnose public traffic failures."
overview: "A public Azure endpoint is a chain, not one setting. This article follows one orders API through public DNS, custom domain validation, TLS termination, Front Door, Application Gateway, Load Balancer, backend health, and 502 or 503 diagnosis."
tags: ["dns", "tls", "front-door", "application-gateway", "load-balancing"]
order: 3
id: article-cloud-providers-azure-networking-connectivity-load-balancers-application-gateway-and-front-door
aliases:
  - load-balancers-application-gateway-and-front-door
  - dns-custom-domains-and-tls-entry-points
  - article-cloud-providers-azure-networking-connectivity-dns-custom-domains-and-tls-entry-points
  - cloud-providers/azure/networking-connectivity/dns-custom-domains-and-tls-entry-points.md
---

## Table of Contents

1. [The Public Door Is Only The Start](#the-public-door-is-only-the-start)
2. [The Public Name Is Part Of The System](#the-public-name-is-part-of-the-system)
3. [A, CNAME, TXT, And TTL In Plain English](#a-cname-txt-and-ttl-in-plain-english)
4. [Domain Validation Proves Who Controls The Name](#domain-validation-proves-who-controls-the-name)
5. [Three Azure Entry Points, Three Different Jobs](#three-azure-entry-points-three-different-jobs)
6. [The Orders API Public Entry Record](#the-orders-api-public-entry-record)
7. [Health Probes Decide Who Gets Traffic](#health-probes-decide-who-gets-traffic)
8. [TLS Termination Without Mystery](#tls-termination-without-mystery)
9. [Evidence You Should Check Before A Cutover](#evidence-you-should-check-before-a-cutover)
10. [HTTP 502 And 503 Follow A Path](#http-502-and-503-follow-a-path)
11. [Failure Modes And Fix Directions](#failure-modes-and-fix-directions)
12. [The Public Entry Tradeoff](#the-public-entry-tradeoff)

## The Public Door Is Only The Start

A public URL can look like the whole system.
Someone types `https://orders.devpolaris.com/orders`, the browser spins
for a moment, and the page either works or fails. From the user's side,
that public name feels like one thing.

Inside Azure, it is a chain. DNS has to send the browser to the right
public entry point. The entry point has to prove it is allowed to answer
for the hostname. TLS has to protect the client connection. A route has
to choose the correct backend group. A health probe has to decide which
backend copies are safe. The backend then has to answer the real request.

This article is about that public entry chain. We are not reteaching
virtual networks, network security groups, private endpoints, or private
DNS here. Those matter when the backend sits behind the entry point, but
the public-entry problem starts at a different question:

> When a browser asks for this public hostname, which Azure component
> receives the request first, and what evidence proves the next hop is
> healthy and trusted?

We will follow one running example. The DevPolaris team runs an orders
API for checkout traffic. The public hostname is
`orders.devpolaris.com`. The backend service is
`devpolaris-orders-api`. It exposes `GET /health` for health checks and
`POST /orders` for real checkout traffic.

The team wants four things from the public entry design:

| Need | What can break if it is vague |
|------|-------------------------------|
| A stable public name | Users reach an old edge, a staging service, or no service at all |
| A trusted HTTPS connection | The browser rejects the certificate before app code runs |
| A suitable Azure entry point | The team chooses a layer 4 service for a layer 7 routing problem, or adds a global edge when a regional gateway was enough |
| Backend health evidence | The public entry sends traffic to a broken revision or has no healthy target |

The first lesson is that a load balancer, gateway, or edge service does
not make an unhealthy app healthy. It only decides whether the app should
receive traffic. If every backend is unhealthy, the public entry may
still be alive while users see `502 Bad Gateway` or
`503 Service Unavailable`.

The second lesson is that DNS is not a decoration at the end of the
deployment. DNS is part of the system. A correct backend and a correct
gateway are not enough if the public name points somewhere else.

## The Public Name Is Part Of The System

The public name is the first piece of the request path that your users
recognize, but it is also operational evidence. If the name resolves to
the wrong target, every later check starts from the wrong place.

DNS means Domain Name System. It answers name lookup questions such as
"where does `orders.devpolaris.com` point?" Azure DNS can host public DNS
zones and records, but creating a zone in Azure does not automatically
buy the domain or move the public internet to that zone. The domain
registrar still controls which name servers are authoritative for the
domain.

For `devpolaris.com`, a production note might look like this:

```text
Domain: devpolaris.com
Registrar: external registrar
Public DNS hosting: Azure DNS
Azure DNS zone: devpolaris.com
Public app hostname: orders.devpolaris.com
Public entry target: fd-devpolaris-prod.azurefd.net
Backend service: devpolaris-orders-api
```

The word "authoritative" matters. Authoritative name servers are the
servers allowed to give final public answers for the domain. If the
registrar still delegates `devpolaris.com` to an old DNS provider, then
editing the Azure DNS zone can look correct in the portal while public
users keep seeing the old answer.

A quick delegation check makes that visible:

```bash
$ dig NS devpolaris.com +short
ns1-08.azure-dns.com.
ns2-08.azure-dns.net.
ns3-08.azure-dns.org.
ns4-08.azure-dns.info.
```

That output says public DNS is currently delegated to Azure DNS name
servers. If the output showed a different provider, we would need to edit
the active provider or change registrar delegation before blaming Front
Door, Application Gateway, or the backend app.

Once delegation is right, the next question is the record for the public
app name:

```bash
$ nslookup orders.devpolaris.com
Server:         1.1.1.1
Address:        1.1.1.1#53

Non-authoritative answer:
orders.devpolaris.com canonical name = fd-devpolaris-prod.azurefd.net.
Name:   fd-devpolaris-prod.azurefd.net
Address: 192.0.2.42
Name:   fd-devpolaris-prod.azurefd.net
Address: 192.0.2.43
```

The `canonical name` line is the useful clue. It says
`orders.devpolaris.com` points to the Front Door hostname. The final
addresses are documentation example addresses here, but in a real check
they should be the addresses returned by the expected Azure entry
service.

Notice what DNS does not prove. It does not prove that the certificate is
attached. It does not prove that the Front Door route points to the
orders origin. It does not prove that `/health` is passing. DNS only
proves where the browser starts.

That separation keeps debugging calm. If DNS points to the wrong place,
fix DNS. If DNS points to the right entry but HTTPS fails, move to TLS.
If HTTPS works but the entry returns `502`, move inward to route, probe,
origin, and backend evidence.

## A, CNAME, TXT, And TTL In Plain English

Most public web entry work begins with four DNS ideas: A records, CNAME
records, TXT records, and TTL. You do not need every DNS record type on
day one. You need to know which small record is responsible for which
part of the public path.

An A record maps a name to an IPv4 address. If an Azure public IP address
fronts an Application Gateway, an A record can point
`orders.devpolaris.com` to that address.

A CNAME record maps one DNS name to another DNS name. If Front Door gives
the team `fd-devpolaris-prod.azurefd.net`, then
`orders.devpolaris.com` can be a CNAME to that provider hostname.

A TXT record stores text under a DNS name. Cloud services and certificate
systems often use TXT records for domain validation. Azure can give you a
token and ask you to publish it. If Azure can read that token from public
DNS, it has evidence that you control the domain.

TTL means time to live. It tells recursive DNS resolvers how long they
can cache the answer. A TTL of `300` means five minutes. A TTL of `3600`
means one hour. Lower TTLs make planned changes visible sooner. Higher
TTLs reduce repeated DNS lookups, but old answers can stick around longer
during a migration.

Here is the simple record set for the orders API:

```text
Zone: devpolaris.com

orders      300   IN   CNAME   fd-devpolaris-prod.azurefd.net.
_dnsauth.orders 300 IN TXT     "afd-validation=4f9c3b7b8e2f4a5c9d1e"
```

The first record sends users toward the public edge. The second record
helps Azure validate that DevPolaris controls the custom hostname.

An Application Gateway design often looks different because the gateway
has a frontend public IP address:

```text
Zone: devpolaris.com

orders      300   IN   A       203.0.113.25
```

Those record shapes are not interchangeable just because both are public
entries. The DNS record should follow the service instructions for the
entry point you selected.

There is one DNS rule that surprises many engineers the first time they
try to put a service at the root domain. A CNAME cannot coexist with
other records at the same name. At the zone apex, represented as `@`,
the zone already has NS and SOA records. That is why
`devpolaris.com` cannot simply be a CNAME in a normal DNS zone. A
subdomain such as `orders.devpolaris.com` is usually easier.

Before a cutover, the TTL deserves planning. If the old record had a TTL
of one hour, many resolvers can legally keep the old answer for one hour.
Lowering the TTL after users already cached the old answer does not call
that answer back. A careful migration lowers the TTL first, waits for the
old TTL to pass, then changes the target.

The evidence is small but powerful:

```bash
$ dig orders.devpolaris.com CNAME +ttlunits
orders.devpolaris.com. 5m IN CNAME fd-devpolaris-prod.azurefd.net.

$ dig TXT _dnsauth.orders.devpolaris.com +short
"afd-validation=4f9c3b7b8e2f4a5c9d1e"
```

The CNAME output proves the current target and TTL. The TXT output proves
the validation token is visible from public DNS. Neither one proves that
the backend will answer an order request.

## Domain Validation Proves Who Controls The Name

Azure should not let any subscription claim
`orders.devpolaris.com` just because somebody typed the hostname into a
form. The service needs proof that the operator can edit DNS for the
domain or already controls a matching certificate.

That proof is domain validation. With Azure Front Door Standard or
Premium, a non-Azure validated domain commonly uses a DNS TXT record in
the `_dnsauth.<subdomain>` form. The portal or API shows the exact name
and token. If the zone is hosted in Azure DNS, Azure can help create the
record. If DNS is hosted elsewhere, you publish the prompted record in
that provider.

A realistic validation prompt might look like this:

```text
Custom domain: orders.devpolaris.com
Validation record name: _dnsauth.orders
Record type: TXT
Record value: afd-validation=4f9c3b7b8e2f4a5c9d1e
TTL: 300
Full DNS name: _dnsauth.orders.devpolaris.com
```

The name is as important as the value. Publishing the right token at
`_dnsauth.devpolaris.com` does not prove control of
`orders.devpolaris.com` if Azure asked for
`_dnsauth.orders.devpolaris.com`. Validation is exact. Close is still
wrong.

When validation is healthy, Azure evidence and public DNS evidence agree:

```text
Azure Front Door custom domain

Host name: orders.devpolaris.com
Validation state: Approved
Endpoint association: fd-devpolaris-prod
Route association: route-orders-api
HTTPS: Enabled
Certificate type: Azure managed
```

If the state stays pending, do not start by changing backend pools. The
backend has not received traffic yet. Check public DNS first:

```bash
$ dig TXT _dnsauth.orders.devpolaris.com +short
"afd-validation=4f9c3b7b8e2f4a5c9d1e"
```

If the answer is missing, edit the delegated public zone. If the answer
exists but Azure still shows pending, compare the hostname, token, domain
type, and whether an old validation token is being reused from a previous
attempt.

Bring-your-own certificate designs can change the validation story for
some Front Door scenarios, because a certificate whose common name or
subject alternative name matches the custom domain can prove ownership.
That does not remove the need to manage DNS. It only changes which piece
of evidence Azure accepts for domain ownership.

The practical habit is simple: attach the custom domain before the
production traffic move, and collect both kinds of evidence. One check
shows the validation token or certificate proof. The other check shows
the final CNAME or A record that users will follow.

## Three Azure Entry Points, Three Different Jobs

Azure Load Balancer, Azure Application Gateway, and Azure Front Door are
all traffic-entry services, but they are not different names for the same
thing. They sit in different places and understand different parts of the
request.

Azure Load Balancer is a layer 4 service. Layer 4 means it works with
transport connections such as TCP and UDP. It can distribute flows by IP,
port, and protocol to backend virtual machines or virtual machine scale
sets. It does not read HTTP hostnames, paths, or methods.

Application Gateway is a regional layer 7 web traffic load balancer.
Layer 7 means it understands HTTP. It can use listeners, hostnames, path
rules, backend pools, backend settings, and probes to route web traffic
inside one region. It is often placed in a virtual network near private
regional backends, but the key idea here is its regional HTTP routing
job.

Front Door is a global HTTP and HTTPS entry point. Clients reach the
Microsoft edge first, then Front Door routes the request to an origin.
An origin might be an App Service app, a Container Apps endpoint, an
Application Gateway, a storage endpoint, or another reachable HTTP
service. Front Door is useful when the public app needs a global edge,
origin health checks, custom domain routing, and HTTP delivery features.

The comparison becomes easier if we ask what each service can see:

| Question | Azure Load Balancer | Application Gateway | Front Door |
|----------|---------------------|---------------------|------------|
| Where does it sit first in your mental model? | Network flow entry | Regional web gateway | Global web edge |
| Which layer does it operate at? | Layer 4 | Layer 7 | Layer 7 |
| What traffic does it fit best? | TCP or UDP flows | HTTP and HTTPS in a region | Public HTTP and HTTPS across origins |
| What can it route by? | Frontend IP, port, protocol, rules | Hostname, path, listener, backend settings | Hostname, route, path, origin group, rules |
| What health object matters? | Probe and backend pool | Probe and backend health | Origin group health probe |
| TLS job | Does not terminate HTTP TLS for routing | Listener TLS and optional backend TLS | Edge TLS and optional origin TLS |

For the orders API, the first public version is HTTP over HTTPS. The team
wants `orders.devpolaris.com`, managed browser certificates, origin
health checks, and a possible future second region. That points toward
Front Door as the first public entry.

Application Gateway can still appear in a later design. If the team
wants a regional gateway in front of private backends, Front Door can
route to Application Gateway as an origin. The gateway then owns regional
listener rules, backend pool membership, and backend health inside that
region.

Azure Load Balancer might still support lower-level VM traffic behind a
different service. It is not the right first choice if the main decision
is "send `/orders` to one HTTP backend and `/admin` to another," because
that decision needs HTTP awareness.

The most common beginner mistake is choosing by product familiarity
instead of traffic job. "We need a load balancer" is too vague. Ask
whether the entry point needs to understand HTTP, whether it needs global
edge routing, whether it needs to sit in a region, and what backend
health evidence the team will inspect during an outage.

## The Orders API Public Entry Record

Now write the public path down like an operations record. This is the
kind of small document that makes incidents shorter because the team can
compare real evidence to the intended design.

```text
Workload: devpolaris-orders-api
Public URL: https://orders.devpolaris.com/orders
Primary public entry: Azure Front Door Standard
Front Door endpoint: fd-devpolaris-prod.azurefd.net
Custom domain: orders.devpolaris.com
DNS record: CNAME orders to fd-devpolaris-prod.azurefd.net
Domain validation: TXT _dnsauth.orders
Client protocol: HTTPS
Origin protocol: HTTPS
Origin hostname: ca-orders-prod.eastus2.azurecontainerapps.io
Origin host header: ca-orders-prod.eastus2.azurecontainerapps.io
Health path: /health
Expected health response: HTTP 200
```

Notice the separate hostnames. The public hostname is what users type.
The Front Door endpoint is the provider hostname DNS points to. The
origin hostname is what Front Door connects to when it retrieves the API
response.

Those hostnames can overlap in some designs, but treating them as
separate evidence keeps the TLS story clean. The browser-facing
certificate must match `orders.devpolaris.com`. The origin-facing
certificate must match whatever hostname Front Door uses for the HTTPS
origin connection.

A healthy request path has several small confirmations:

```text
Browser request
  URL: https://orders.devpolaris.com/orders
  DNS: orders.devpolaris.com CNAME fd-devpolaris-prod.azurefd.net
  Public entry: Azure Front Door profile fd-devpolaris-prod
  Public certificate: valid for orders.devpolaris.com
  Route: route-orders-api
  Origin group: og-orders-prod
  Origin: ca-orders-prod.eastus2.azurecontainerapps.io
  Origin health: healthy
  Backend response: HTTP 201 Created
```

The same path as a log line might look like this:

```text
2026-05-05T10:21:44Z edge=afd-eus route=route-orders-api
host=orders.devpolaris.com method=POST path=/orders status=201
origin=ca-orders-prod.eastus2.azurecontainerapps.io
originStatus=201 originLatencyMs=84 originHealth=healthy
```

That line is more useful than "Front Door is up." It tells us the route
matched, the origin was selected, the origin returned success, and the
health state was healthy at the time of the request.

An Application Gateway record uses different Azure names:

```text
Workload: devpolaris-orders-api
Public URL: https://orders.devpolaris.com/orders
Entry service: Azure Application Gateway
DNS record: A orders to 203.0.113.25
Listener: https-orders
Listener host name: orders.devpolaris.com
Frontend certificate: cert-orders-devpolaris-com
Rule: rule-orders-api
Backend pool: pool-orders-api
Backend setting: https-orders-api
Probe: probe-orders-health
Probe path: /health
```

The structure is the same: public name, TLS, route, backend target,
health. The product vocabulary changes.

## Health Probes Decide Who Gets Traffic

A health probe is a repeated check from the entry service to a backend.
The entry service uses the result to decide whether that backend should
receive new traffic.

For HTTP apps, a good probe path is cheap, stable, and honest. Cheap
means it does not create orders, send email, or perform expensive work.
Stable means the route stays available across deployments. Honest means
it fails when the app cannot serve real traffic.

For the orders API, the probe calls `/health`:

```text
GET /health
HTTP/1.1 200 OK
content-type: application/json

{"service":"devpolaris-orders-api","revision":"orders-api-20260505-1014","database":"ok"}
```

That response tells the entry layer that this backend can serve. If the
database dependency is required for checkout and the app cannot reach it,
the health endpoint should not keep returning `200` as if everything is
fine.

Probe configuration is where small mismatches create large outages. A
team points the probe at `/`, but the app redirects `/` to `/docs`. The
entry service expected `200`, received `302`, and marks the backend
unhealthy. Or the probe uses HTTP while the backend only listens on
HTTPS. Or the probe sends a host header the app does not recognize.

Here is realistic Application Gateway backend health evidence:

```json
{
  "backendAddressPools": [
    {
      "name": "pool-orders-api",
      "backendHttpSettingsCollection": [
        {
          "name": "https-orders-api",
          "servers": [
            {
              "address": "10.12.4.18",
              "health": "Unhealthy",
              "healthProbeLog": "Received invalid status code: 404"
            },
            {
              "address": "10.12.4.19",
              "health": "Healthy",
              "healthProbeLog": "Probe completed successfully"
            }
          ]
        }
      ]
    }
  ]
}
```

The important line is not the resource ID. It is the reason:
`Received invalid status code: 404`. That points toward the probe path,
backend route, or host header. If the expected path is `/health`, the
next evidence should come from backend access logs showing whether the
gateway actually requested `/health`.

Front Door uses origin groups and origins:

```text
Front Door origin group: og-orders-prod
Origin: ca-orders-prod.eastus2.azurecontainerapps.io
Probe path: /health
Probe protocol: HTTPS
Successful samples: 4 of 4
Current decision: Healthy
```

If the origin starts returning `500` from `/health`, the decision changes:

```text
Front Door origin group: og-orders-prod
Origin: ca-orders-prod.eastus2.azurecontainerapps.io
Probe path: /health
Probe protocol: HTTPS
Successful samples: 0 of 4
Latest probe response: 500
Current decision: Unhealthy
Traffic action: remove origin from healthy rotation
```

Azure Load Balancer uses probes too, but the mental model is lower in the
stack. A Standard Load Balancer probe can check TCP, HTTP, or HTTPS
depending on configuration. The backend instances must allow the Azure
Load Balancer probe source through their network and local firewall
rules. If the probe cannot reach an instance, the load balancer stops
sending new inbound connections to that unhealthy instance.

```text
Load Balancer: lb-orders-vm-prod
Frontend: 203.0.113.40:443
Backend pool: vmss-orders-api
Probe: tcp-443
Backend instance: vmss-orders-api_3
Probe result: Down
Observed failure: TCP connect timed out
Traffic action: do not send new inbound flows to this instance
```

The health-check habit is the same across the services: do not stop at
the public symptom. Find the health decision made by the entry service,
then fix the reason behind that decision.

## TLS Termination Without Mystery

TLS is the encryption and identity layer behind HTTPS. When a browser
connects to `orders.devpolaris.com`, the server side of that TLS
conversation must present a certificate that includes
`orders.devpolaris.com` in its subject alternative names.

TLS termination means the encrypted connection ends at a component. That
component decrypts the request and can read HTTP details such as host,
path, and headers. A layer 7 entry service often has to terminate TLS so
it can make HTTP routing decisions.

For the orders API with Front Door, there are two TLS conversations:

```text
Browser
  HTTPS for orders.devpolaris.com
  Azure Front Door
  HTTPS for ca-orders-prod.eastus2.azurecontainerapps.io
  devpolaris-orders-api origin
```

The public certificate and the origin certificate are not the same job.
The public certificate proves `orders.devpolaris.com` to the browser.
The origin certificate proves the origin hostname to Front Door.

You can inspect the certificate a browser would see:

```bash
$ openssl s_client \
  -servername orders.devpolaris.com \
  -connect orders.devpolaris.com:443 </dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName
subject=CN=orders.devpolaris.com
issuer=C=US, O=DigiCert Inc, CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1
X509v3 Subject Alternative Name:
    DNS:orders.devpolaris.com
```

The `-servername` value matters because modern HTTPS uses Server Name
Indication. SNI lets one endpoint present different certificates for
different hostnames. If you omit it, the test may show a default
certificate and create a false trail.

The line to read is `Subject Alternative Name`. If
`orders.devpolaris.com` is missing, DNS will not fix the browser warning.
The fix is to issue or attach a certificate that includes the hostname
and bind it to the entry service that receives the browser connection.

Origin TLS has its own evidence. This failure can happen even when the
browser certificate is perfect:

```text
Client symptom: HTTP 502
Entry point: Azure Front Door
Route: route-orders-api
Origin hostname: ca-orders-prod.eastus2.azurecontainerapps.io
Origin host header: orders.devpolaris.com
Origin TLS result: certificate name mismatch
Backend certificate SAN: DNS:ca-orders-staging.eastus2.azurecontainerapps.io
```

The browser reached Front Door safely. Front Door then tried to reach the
origin over HTTPS and rejected the certificate because the hostname and
certificate did not match. The fix direction is to align the origin
hostname, origin host header, backend custom domain, and backend
certificate. Turning off verification hides the trust problem instead of
solving it.

Application Gateway has the same shape with regional vocabulary. The
listener certificate handles the browser-to-gateway connection. If the
gateway forwards to the backend over HTTPS, the backend certificate and
host name must also make sense for the gateway-to-backend connection.

For a small direct App Service or Container Apps deployment, the platform
ingress may terminate the browser TLS connection itself. That can be a
good learning path. The tradeoff is that shared edge routing, regional
gateway controls, and centralized public-entry policy may be harder to
manage later.

## Evidence You Should Check Before A Cutover

A cutover is the moment real users start following the new public path.
For `orders.devpolaris.com`, that might mean changing DNS from an old
host to Azure Front Door, or changing an A record from an old public IP
to an Application Gateway public IP.

Good cutovers feel boring because the team gathered evidence before the
record changed. The checklist should prove each layer separately.

Start with delegation:

```bash
$ dig NS devpolaris.com +short
ns1-08.azure-dns.com.
ns2-08.azure-dns.net.
ns3-08.azure-dns.org.
ns4-08.azure-dns.info.
```

Then check the planned app record:

```bash
$ dig orders.devpolaris.com CNAME +short
fd-devpolaris-prod.azurefd.net.

$ dig orders.devpolaris.com CNAME +ttlunits
orders.devpolaris.com. 5m IN CNAME fd-devpolaris-prod.azurefd.net.
```

The first command proves the target. The second shows the TTL. If the TTL
is still one hour and the cutover is in five minutes, the team should
expect some users to keep old answers after the change.

Next, verify domain validation and HTTPS state in the entry service:

```text
Front Door custom domain: orders.devpolaris.com
Validation state: Approved
Endpoint association: fd-devpolaris-prod
Routes: route-orders-api
HTTPS state: Enabled
Certificate type: Azure managed
Certificate subject: orders.devpolaris.com
Minimum TLS policy: TLS 1.2 or newer
```

Then verify the browser-facing certificate from the public hostname:

```bash
$ curl -I https://orders.devpolaris.com/health
HTTP/2 200
date: Tue, 05 May 2026 10:15:42 GMT
content-type: application/json
x-azure-ref: 20260505T101542Z-17b4f7c9f4
cache-control: no-store
```

This proves more than DNS. It proves that the HTTPS handshake worked, the
entry accepted the hostname, the route reached something, and `/health`
returned `200`. It still does not prove every checkout workflow, but it
is strong public-entry evidence.

Finally, check backend health from the entry service's point of view:

```text
Entry service: Azure Front Door
Route: route-orders-api
Origin group: og-orders-prod
Origin: ca-orders-prod.eastus2.azurecontainerapps.io
Probe path: /health
Probe protocol: HTTPS
Origin health: Healthy
Last probe status: 200
```

If Application Gateway owns the regional entry, gather the equivalent
gateway evidence:

```text
Entry service: Azure Application Gateway
Listener: https-orders
Rule: rule-orders-api
Backend pool: pool-orders-api
Backend setting: https-orders-api
Probe: probe-orders-health
Backend health: Healthy
Last probe status: 200
```

The safest release review keeps all of this in one place:

```text
Public entry cutover evidence

1. Domain delegation points to the active public DNS provider.
2. The app record points to the intended Azure entry.
3. TTL was lowered before the migration window.
4. Custom domain validation is approved.
5. The browser-facing certificate matches orders.devpolaris.com.
6. The entry route sends /orders and /health to the intended backend.
7. The entry service reports healthy backend or origin status.
8. curl to https://orders.devpolaris.com/health returns HTTP 200.
9. App logs show the public health request at the expected revision.
10. Rollback target and old DNS TTL are known before traffic moves.
```

The point is not ceremony. The point is that each layer has one clear
answer before the team changes where customers go.

## HTTP 502 And 503 Follow A Path

HTTP `502 Bad Gateway` and `503 Service Unavailable` are not precise root
causes by themselves. They are symptoms from a component acting as a
gateway or entry point. The public entry accepted the client connection,
but something behind it was missing, unhealthy, unreachable, or invalid.

Start with the client symptom:

```bash
$ curl -i https://orders.devpolaris.com/orders
HTTP/2 502
content-type: text/html
x-azure-ref: 20260505T111806Z-17b4f7c9f4

Bad Gateway
```

This tells us the public HTTPS path reached an Azure edge, but it does
not tell us why the origin failed. Walk inward:

```text
1. DNS answer: orders.devpolaris.com points to fd-devpolaris-prod.azurefd.net.
2. Public TLS: certificate includes orders.devpolaris.com.
3. Entry route: route-orders-api matched host orders.devpolaris.com and path /orders.
4. Origin group: og-orders-prod selected ca-orders-prod.eastus2.azurecontainerapps.io.
5. Origin health: Unhealthy.
6. Latest probe: /health returned 503.
7. App revision: active revision cannot reach the database.
```

Now the fix direction is visible. Do not change the CNAME. Do not rotate
the public certificate. The first bad evidence is backend health, and the
app revision explains why health is bad.

The app evidence might look like this:

```text
Revision: orders-api-20260505-1102
Traffic weight: 100
Running state: Running
Health endpoint: HTTP 503
Application log:
  2026-05-05T11:18:02Z startup dependency check failed
  dependency=orders-sql-prod error="login failed for managed identity"
```

The public entry did its job by refusing to treat this backend as healthy.
The fix belongs in the app dependency, identity, or rollback decision.

A different `502` can come from TLS between the entry service and the
backend:

```text
Client symptom: HTTP 502
DNS: correct
Public TLS: valid
Route: route-orders-api matched
Origin health: failed
Probe failure: TLS certificate name mismatch
Origin hostname: ca-orders-prod.eastus2.azurecontainerapps.io
Certificate SAN returned by origin: DNS:ca-orders-staging.eastus2.azurecontainerapps.io
```

This time the app might be healthy when called directly by its platform
hostname, but the entry service cannot trust the HTTPS origin connection.
The fix direction is certificate and hostname alignment on the origin
leg.

A `503` often means no healthy backend was available or the origin itself
returned service unavailable:

```text
Client symptom: HTTP 503
Entry route: route-orders-api matched
Origin group: og-orders-prod
Healthy origins: 0
Origin ca-orders-prod.eastus2.azurecontainerapps.io: unhealthy, latest probe 503
Origin ca-orders-dr.westeurope.azurecontainerapps.io: disabled for maintenance
Traffic decision: no healthy origin available
```

The entry point is reachable. The public name is correct. The outage is
behind the edge. The fastest safe move is usually to restore at least one
healthy origin, correct the probe, or re-enable the disaster recovery
origin after verifying it can serve.

Application Gateway has its own common `502` path. If an NSG, custom DNS
setting, route table, empty backend pool, unhealthy backend, timeout, or
upstream TLS mismatch prevents the gateway from reaching a valid backend,
the client can see a bad gateway response. You do not need to memorize
every possible cause. You need to check backend health and read the first
bad reason.

## Failure Modes And Fix Directions

Public-entry troubleshooting works best when each symptom is tied to the
layer that owns it. Similar browser failures can come from different
places.

| Symptom | First layer to inspect | Evidence | Fix direction |
|---------|------------------------|----------|---------------|
| `orders.devpolaris.com` resolves to an old host | DNS | `dig` or `nslookup` answer and active name servers | Edit the delegated public zone or fix registrar delegation |
| Some users reach old entry and others reach new entry | DNS cache | Previous TTL and resolver answers from different networks | Wait for old TTLs and lower TTL earlier next time |
| Custom domain stays pending | Domain validation | TXT record name, token, and Azure validation state | Publish the exact prompted TXT record in public DNS |
| Browser warns about certificate name | Public TLS | Certificate subject alternative names from `openssl` | Attach a certificate that includes the public hostname |
| HTTPS works on Azure default hostname but not the custom hostname | Custom domain binding | Entry service custom domain list and certificate state | Add the custom domain and bind HTTPS on the browser-facing entry |
| `404` comes from the gateway rather than the app | Entry route | Front Door route, Application Gateway listener, host, path rule | Point the matching rule at the intended origin group or backend pool |
| `502` after route match | Backend connection | Origin health, backend health, timeout, TLS reason | Fix origin reachability, backend port, host header, certificate, or app response |
| `503` with no healthy origin | Backend health | Probe status and healthy backend count | Restore a healthy backend, correct the probe, or fail over |
| Traffic reaches staging | Wrong target | Origin hostname, backend pool membership, response headers | Replace staging target with production resource ID or hostname |
| Probe fails but manual laptop check works | Different path from entry to backend | Probe path, host header, protocol, port, and backend logs | Make the probe match the backend contract from the entry service's point of view |

The wrong DNS provider is a classic cutover failure. The team edits the
Azure DNS zone, but public delegation still points to a legacy provider:

```bash
$ dig NS devpolaris.com +short
ns1.old-dns-provider.example.
ns2.old-dns-provider.example.
```

If this is the public answer, Azure DNS changes will not affect users.
Fix delegation at the registrar or edit the active provider.

A missing validation record is smaller but just as blocking:

```bash
$ dig TXT _dnsauth.orders.devpolaris.com +short

$ dig TXT _dnsauth.devpolaris.com +short
"afd-validation=4f9c3b7b8e2f4a5c9d1e"
```

The token exists, but it is under the wrong name. Move it to
`_dnsauth.orders.devpolaris.com`, then wait for public DNS and the Azure
validation state to agree.

A certificate mismatch has a different shape:

```text
curl: (60) SSL: no alternative certificate subject name matches target host name 'orders.devpolaris.com'
```

Do not solve this by turning off certificate verification. That only
removes the alarm. Attach the right certificate to the browser-facing
entry service.

A wrong backend target can be dangerous because it looks successful:

```text
2026-05-05T12:04:18Z edge=afd-eus route=route-orders-api
host=orders.devpolaris.com path=/orders status=201
origin=ca-orders-staging.eastus2.azurecontainerapps.io
responseHeader.x-environment=staging
```

The public entry worked, but it sent production traffic to staging. Fix
the origin group or backend pool using exact resource IDs or hostnames.
Friendly names that differ by one word are not enough evidence.

The recurring discipline is this: do not change five layers after one
browser error. Walk the path, find the first bad piece of evidence, and
make the smallest fix at that layer.

## The Public Entry Tradeoff

There is no single Azure public-entry shape that is always right. The
right shape is the smallest one that matches the traffic job while still
giving the team useful evidence during failures.

Direct platform ingress can be enough for a small app. App Service and
Container Apps can attach custom domains and certificates directly. DNS
points to the platform endpoint. The platform receives the public
connection. The team has fewer moving parts to learn at first.

The tradeoff is that each app owns more of its public entry story. If the
organization later wants shared edge rules, global routing, centralized
WAF policy, canary routing at the edge, private origin access, or several
services under one public hostname, direct bindings can become scattered.

Front Door gives a global HTTP edge. It is a strong fit when users are
spread across regions, when the team wants one public entry in front of
several HTTP origins, or when origin health and failover should happen at
the edge. The tradeoff is another layer of routing, certificate, and
origin evidence to operate.

Application Gateway gives a regional HTTP gateway. It is a strong fit
when the traffic decision belongs near a regional virtual network, when
private backends need a regional entry, or when listener, path, and
backend-pool rules belong in the regional network design. The tradeoff is
more regional networking detail.

Azure Load Balancer gives layer 4 flow distribution. It is a strong fit
for TCP or UDP workloads, VM scale sets, and network-level balancing. The
tradeoff is that it does not understand HTTP hostnames or paths, so it
cannot replace a layer 7 gateway when the routing question is about web
requests.

For `orders.devpolaris.com`, a good first production decision might be:

```text
Public app type: HTTPS API
Public name: orders.devpolaris.com
Users: internet clients in several regions
First entry: Azure Front Door
Origin: devpolaris-orders-api
Regional gateway: add Application Gateway later only if regional private backend control is needed
Layer 4 load balancer: not part of the first public HTTP path
Health contract: GET /health returns 200 only when checkout dependencies are ready
TLS contract: browser certificate matches orders.devpolaris.com, origin certificate matches origin hostname
First outage checks: DNS, public TLS, route match, origin health, origin TLS, app revision logs
```

That decision is not magic. It is just explicit. When checkout fails, the
team knows which component receives the request first, which DNS record
points there, which certificate the browser should see, which route owns
the request, which health probe makes the traffic decision, and which
backend evidence proves the fix.

Public entry points look simple from the address bar. They are reliable
only when the name, certificate, route, health probe, and backend all
agree.

---

**References**

- [Overview of DNS zones and records](https://learn.microsoft.com/en-us/azure/dns/dns-zones-records) - Used for Azure DNS zones, record sets, supported A/CNAME/TXT records, CNAME limits, and TTL behavior.
- [Configure a custom domain on Azure Front Door](https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/how-to-add-custom-domain) - Used for Front Door custom domain validation, `_dnsauth` TXT records, endpoint association, and CNAME cutover behavior.
- [Configure HTTPS on an Azure Front Door custom domain](https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/how-to-configure-https-custom-domain) - Used for Front Door managed certificates, bring-your-own certificates, Key Vault access, and certificate name matching.
- [Azure Front Door overview](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-overview) and [Origins and origin groups in Azure Front Door](https://learn.microsoft.com/en-us/azure/frontdoor/origin) - Used for Front Door as a global HTTP entry, origins, origin groups, and health probe behavior.
- [What is Azure Application Gateway?](https://learn.microsoft.com/en-us/azure/application-gateway/overview) and [Troubleshoot Bad Gateway errors in Application Gateway](https://learn.microsoft.com/en-us/troubleshoot/azure/application-gateway/application-gateway-troubleshooting-502) - Used for Application Gateway as a regional layer 7 service, listener/backend concepts, backend health, and common 502 causes.
- [Azure Load Balancer health probes](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview) - Used for Load Balancer probe behavior, layer 4 backend health decisions, and probe source considerations.
