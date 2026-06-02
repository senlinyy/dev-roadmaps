---
title: "Mesh Security"
description: "Prove workload identity and authorize service-to-service calls using mTLS and mesh policies."
overview: "IP-based firewalls break down when Pod IPs constantly change. This article explains how to enforce mTLS and authorization policies using CLI verification."
tags: ["kubernetes", "service-mesh", "security", "mtls", "spiffe"]
order: 3
id: article-containers-orchestration-kubernetes-service-mesh-mesh-security
---

In a service mesh, security is enforced by giving every workload a cryptographic identity instead of relying on ephemeral Pod IP addresses. Because Pod IPs change every time a container restarts, scales across physical hardware, or gets recreated by a deployment rollout, a traditional IP-based firewall cannot reliably prove which application is making a request. A service mesh solves this by provisioning a unique TLS certificate to every sidecar proxy, requiring the calling application to present that certificate, encrypting the connection in transit, and verifying authorization policies before any traffic reaches the application container.

## Table of Contents

- [Workload Identity](#workload-identity)
- [Enforcing Strict mTLS](#enforcing-strict-mtls)
- [Testing Unencrypted Traffic](#testing-unencrypted-traffic)
- [Testing Encrypted Traffic](#testing-encrypted-traffic)
- [Inspecting the Proxy Certificate](#inspecting-the-proxy-certificate)
- [Authorizing One Caller](#authorizing-one-caller)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## Workload Identity

At its core, workload identity is the name a running workload can prove cryptographically. Instead of trusting a changing Pod IP address, the destination proxy checks a signed certificate that says which Kubernetes Service Account the caller is running under.

Example: when your frontend web server tries to call the backend checkout service, the frontend's proxy presents a certificate. This certificate contains a standardized identity string, known as a SPIFFE ID, that looks like `spiffe://cluster.local/ns/default/sa/frontend`. The backend proxy reads this string, verifies the signature against the cluster's root certificate authority, and then decides whether to allow the connection.

Under the hood, the mesh control plane acts as a Certificate Authority. When a new Pod starts, its injected Envoy proxy generates a private key in memory and sends a Certificate Signing Request to the control plane. The control plane validates the Pod's Kubernetes Service Account token, signs the request, and returns a short-lived certificate. This happens entirely in memory within the proxy container, meaning the private key is never written to a physical disk or sent across the network. Because the certificates are short-lived, often expiring in hours, stolen certificates become useless quickly without the underlying Kubernetes identity to renew them.

## Enforcing Strict mTLS

You can loosely think of strict mTLS like disabling the unencrypted HTTP port on a web server and forcing all traffic over HTTPS, except that the client must also provide a valid certificate to prove who they are. By default, Istio and many other service meshes operate in a permissive mode. Permissive mode allows a proxy to accept both plain-text traffic and encrypted mTLS traffic. This is useful when you are slowly migrating existing applications into the mesh, but it does not prevent a compromised, unmeshed Pod from calling a secure service.

To lock down the cluster, you must require strict mTLS. You enforce this by applying a `PeerAuthentication` policy. This is a configuration object that tells the mesh proxies to reject any traffic that is not encrypted and authenticated.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default-strict
  namespace: default
spec:
  mtls:
    mode: STRICT
```

When you apply this configuration with `kubectl apply`, the control plane translates the policy into low-level Envoy proxy configuration and pushes it to every proxy in the `default` namespace over a gRPC stream.

```bash
kubectl apply -f peer-auth.yaml
```

The proxies immediately begin dropping incoming TCP connections that do not complete the TLS handshake.

## Testing Unencrypted Traffic

To see this enforcement in action, you can test a connection from a Pod that does not have a proxy. When a Pod lacks a proxy, it cannot automatically acquire a certificate or perform the complex mTLS handshake required by the destination.

Because the previous article enabled sidecar injection in the `default` namespace, this test must run somewhere else. Create a namespace without injection and verify that the test Pod has only one container before it calls the meshed checkout service.

```bash
kubectl create namespace plain-client
kubectl run test-client \
  --namespace plain-client \
  --image=curlimages/curl \
  --restart=Never \
  -- sleep 3600

kubectl get pod test-client --namespace plain-client
```

```text
NAME          READY   STATUS    RESTARTS   AGE
test-client   1/1     Running   0          12s
```

Now execute `curl` from that unmeshed Pod. Use the fully qualified Service name so the Pod in `plain-client` reaches the checkout Service in the `default` namespace.

```bash
kubectl exec test-client --namespace plain-client -- \
  curl -s -v http://checkout-service.default.svc.cluster.local:8080/health
```

```text
*   Trying 10.96.105.14:8080...
* Connected to checkout-service (10.96.105.14) port 8080
> GET /health HTTP/1.1
> Host: checkout-service:8080
> User-Agent: curl/8.4.0
> Accept: */*
>
* Recv failure: Connection reset by peer
* Closing connection
curl: (56) Recv failure: Connection reset by peer
```

The output shows a TCP connection reset. The underlying network path allows the packet to reach the destination Pod, but the destination Envoy proxy is expecting an mTLS handshake. Because it receives raw HTTP instead of a TLS Client Hello message with a client certificate, the proxy terminates the connection. The application container behind the proxy never sees the request.

## Testing Encrypted Traffic

When both the caller and the destination are part of the mesh, the proxies handle the cryptography transparently. The application containers still send plain-text HTTP to their local network interfaces, but the sidecar proxies intercept, encrypt, and authenticate the traffic before it ever leaves the virtual machine.

You can verify this by executing a command inside a meshed frontend Pod to call the same checkout service.

```bash
kubectl exec -it deploy/frontend -c frontend -- curl -s -v http://checkout-service:8080/health
```

```text
*   Trying 10.96.105.14:8080...
* Connected to checkout-service (10.96.105.14) port 8080
> GET /health HTTP/1.1
> Host: checkout-service:8080
> User-Agent: curl/8.4.0
> Accept: */*
>
< HTTP/1.1 200 OK
< content-type: application/json
< content-length: 15
< x-envoy-upstream-service-time: 2
<
{"status":"ok"}
```

Even though the `curl` command explicitly requests `http://` and shows a plain HTTP 1.1 exchange from the application's point of view, the traffic between proxies is encrypted. The frontend proxy intercepts the outbound request, initiates a TLS session with the checkout proxy, presents its certificate, and forwards the HTTP request through the encrypted channel. The checkout proxy decrypts the payload and forwards it to the checkout container through the local Pod network. The `x-envoy-upstream-service-time` header is a useful clue that Envoy was in the request path, but it is not by itself proof of mTLS. The stronger proof is the active certificate and identity that the proxy uses during the handshake.

## Inspecting the Proxy Certificate

To prove that this identity system is real, you can inspect the actual certificate the proxy holds in memory. You can use the `istioctl proxy-config secret` command to dump the Envoy proxy's active TLS configurations. By piping that output into `openssl`, you can read the cryptographic details of the certificate the frontend proxy uses to authenticate itself.

```bash
istioctl proxy-config secret deploy/frontend -o json \
  | jq -r '.dynamicActiveSecrets[0].secret.tlsCertificate.certificateChain.inlineBytes' \
  | base64 --decode \
  | openssl x509 -text -noout \
  | grep -A 1 "Subject Alternative Name"
```

```text
            X509v3 Subject Alternative Name: critical
                URI:spiffe://cluster.local/ns/default/sa/frontend
```

The output reveals the Subject Alternative Name (SAN) extension of the X.509 certificate. This is the exact field the destination proxy checks during the TLS handshake. It contains a standard SPIFFE (Secure Production Identity Framework for Everyone) URI.

Notice that the identity is bound to `sa/frontend`, which is the Kubernetes Service Account. The mesh control plane generated this certificate after validating the Kubernetes Service Account token mounted inside the Pod. When the frontend proxy connects to the checkout proxy, the checkout proxy reads this SPIFFE URI and validates the certificate chain against the mesh root CA. That gives the mesh a cryptographic caller identity that is stronger than a Pod IP address.

## Authorizing One Caller

Authentication proves who made the call. Authorization decides whether that caller is allowed to do the requested action. mTLS gives the mesh an identity to check, but it does not by itself express the rule “frontend may call checkout.”

Istio uses `AuthorizationPolicy` objects for that second decision. This example allows only the `frontend` Service Account in the `default` namespace to call Pods labeled `app: checkout`.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: checkout-allow-frontend
  namespace: default
spec:
  selector:
    matchLabels:
      app: checkout
  action: ALLOW
  rules:
    - from:
        - source:
            serviceAccounts:
              - default/frontend
```

When an `ALLOW` policy applies to a workload, requests that do not match an allow rule are denied. This is the part that turns the certificate identity into an access rule. The checkout proxy can now read the caller identity from the mTLS certificate and compare it with the allowed Service Account before the request reaches the checkout container.

## Putting It All Together

IP-based security rules are too fragile for ephemeral container environments where addresses constantly shift. By relying on workload identity and mTLS, a service mesh moves the security boundary from the physical network to the application itself.

- The mesh control plane acts as a Certificate Authority, automatically issuing short-lived certificates to every proxy based on the Pod's Kubernetes Service Account.
- A `PeerAuthentication` policy forces proxies to reject plain-text connections for the workloads it covers.
- Requests from unmeshed Pods fail when strict mTLS is required because they cannot complete the TLS handshake.
- Requests between meshed Pods are transparently encrypted and authenticated, allowing developers to write plain HTTP code while the proxies handle the cryptography.
- The identity is embedded directly in the certificate's Subject Alternative Name as a SPIFFE URI, providing cryptographically verifiable proof of origin.
- An `AuthorizationPolicy` turns that identity into an access decision.

## What's Next

Security and traffic control are powerful, but what happens when the proxy itself fails?

![Mesh security summary showing service account identity, certificates, mTLS, peer policy, authorization policy, and allowed callers.](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/mesh-security-summary.png)

*The security model has two steps: mTLS proves the caller's workload identity, then authorization policy decides whether that caller is allowed through.*

---

**References**

- [Istio Security Concepts](https://istio.io/latest/docs/concepts/security/) - Explains Istio identity, mTLS, authentication, and authorization.
- [Istio PeerAuthentication](https://istio.io/latest/docs/reference/config/security/peer_authentication/) - Defines mTLS modes for incoming connections.
- [Istio AuthorizationPolicy](https://istio.io/latest/docs/reference/config/security/authorization-policy/) - Defines workload access-control rules.
- [Istio Sidecar Injection](https://istio.io/latest/docs/setup/additional-setup/sidecar-injection/) - Explains namespace and pod-level sidecar injection behavior.
