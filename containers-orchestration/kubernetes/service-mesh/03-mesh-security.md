---
title: "Mesh Security"
description: "Use workload identities, encrypted service-to-service connections, and mesh access rules to block unwanted service calls."
overview: "Follow a web -> checkout -> payments flow, then block analytics from payments by making each workload prove its identity and by allowing only the callers payments should trust."
tags: ["kubernetes", "service-mesh", "security", "mtls", "spiffe"]
order: 3
id: article-containers-orchestration-kubernetes-service-mesh-mesh-security
---

## Table of Contents

1. [The Scenario and the Security Chain](#the-scenario-and-the-security-chain)
2. [Give Each Workload Its Own Service Account](#give-each-workload-its-own-service-account)
3. [How Istio Turns Service Accounts Into Identity](#how-istio-turns-service-accounts-into-identity)
4. [Require Strict mTLS With PeerAuthentication](#require-strict-mtls-with-peerauthentication)
5. [Prove Plain Traffic Fails and Meshed Traffic Works](#prove-plain-traffic-fails-and-meshed-traffic-works)
6. [Inspect the Certificate and Source Principal](#inspect-the-certificate-and-source-principal)
7. [Allow Checkout and Block Analytics](#allow-checkout-and-block-analytics)
8. [Rollout Guidance and Common Gotchas](#rollout-guidance-and-common-gotchas)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Scenario and the Security Chain
<!-- section-summary: Mesh security connects identity, encryption, and authorization so the cluster can allow checkout to call payments while blocking analytics. -->

Start with the request path. The **web** service receives browser traffic and calls **checkout** over HTTP. Then **checkout** calls **payments** to finish the order. A fourth service, **analytics**, reads business events and builds reports. Analytics can run in the same cluster and still have no business reason to call payments directly.

Kubernetes networking can route packets from many Pods to many other Pods. If analytics can resolve `payments.store.svc.cluster.local` and open a TCP connection, the network has done its job. The security question is separate: should the payments workload accept that caller, and can payments prove the caller is really checkout?

**Mesh security** means using the proxy layer to give service-to-service calls identity, encryption, and access rules. In the store, checkout should prove its identity when it calls payments, the proxy-to-proxy connection should be encrypted, and payments should allow checkout while rejecting analytics.

This article protects the path in three plain stages. First, each workload gets its own name, so checkout and analytics do not look the same to payments. Second, the proxy-to-proxy connection is encrypted, so the service call has protection on the network. Third, payments gets an allow rule: checkout can call payments, analytics cannot. The Istio names for those stages are workload identity, mTLS, and AuthorizationPolicy, and we will introduce each one only after the basic security question is clear.

![Mesh security chain infographic showing web to checkout to payments allowed through identity, mTLS, and AuthorizationPolicy while analytics is blocked at the payments destination proxy](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/security-chain.png)

*The destination proxy makes the final access decision. Checkout is part of the payment path, while analytics shares the cluster but should not share payment access.*

## Give Each Workload Its Own Service Account
<!-- section-summary: Service accounts give Kubernetes workloads stable non-human names, and Istio uses those names as the starting point for mesh identity. -->

In this article, the service account is the identity seed for the mesh. Dedicated service accounts give `web`, `checkout`, `payments`, and `analytics` separate caller names. The namespace's `default` service account is useful for early demos, and it makes production authorization blurry when several unrelated workloads share the same identity.

For mesh security, give each application its own service account. A **workload identity** is the identity a running workload can prove to another workload, and Istio builds that identity from the Kubernetes service account and namespace. In this scenario, `checkout` and `analytics` need different identities because payments should treat them differently. If both deployments used the `default` service account, the payments proxy would see one shared caller name and your policy would have no clean way to allow checkout while blocking analytics.

Start with the smallest shape. The namespace enables sidecar injection, and each workload gets a separate service account. The snippet below shows the payment path and the caller we want to block; the `web` service should get the same kind of dedicated service account:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout
  namespace: store
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments
  namespace: store
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: analytics
  namespace: store
```

Now connect one Deployment to one of those service accounts. The `serviceAccountName` field is the important security line because it tells Istio which workload identity to issue for that Pod:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: store
spec:
  replicas: 2
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      serviceAccountName: checkout
      containers:
        - name: checkout
          image: ghcr.io/example/store-checkout:1.0
          ports:
            - containerPort: 8080
```

The web, payments, and analytics Deployments repeat the same pattern with their own names, labels, images, and `serviceAccountName` values. The payments Deployment should use `serviceAccountName: payments`, and the analytics Deployment should use `serviceAccountName: analytics`. That separation gives the payments proxy two different caller identities to evaluate later.

Finally, expose the workloads that other services need to call:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkout
  namespace: store
spec:
  selector:
    app: checkout
  ports:
    - name: http
      port: 8080
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: payments
  namespace: store
spec:
  selector:
    app: payments
  ports:
    - name: http
      port: 8080
      targetPort: 8080
```

Apply your application manifests and confirm that the Pods run with the service accounts you expect. This is a small check, but it catches a very common mistake before you start writing policies.

```bash
kubectl apply -f store-workloads.yaml

kubectl get pods -n store \
  -o custom-columns='POD:.metadata.name,SA:.spec.serviceAccountName,CONTAINERS:.spec.containers[*].name'

# POD                            SA          CONTAINERS
# web-6d7f47f65c-zg8kq           web         web,istio-proxy
# checkout-7f65c8f4c8-b8g4q      checkout    checkout,istio-proxy
# payments-6f7f88dd6b-w2b9z      payments    payments,istio-proxy
# analytics-74684cf5d9-pg9q6     analytics   analytics,istio-proxy
```

The `istio-proxy` container in each Pod tells you sidecar injection happened. That container is the **sidecar proxy**, the local Envoy process that will later present certificates, enforce inbound policy, and send outbound traffic through the mesh. The service account column tells you Istio has different Kubernetes identities to work with when it issues workload certificates, so checkout and analytics will not collapse into the same caller from the payments point of view.

## How Istio Turns Service Accounts Into Identity
<!-- section-summary: Istio validates the Pod's service account and issues a signed certificate with a SPIFFE identity for the proxy. -->

A **SPIFFE ID** is a URI that uniquely identifies a workload. In an Istio mesh with the default trust domain, the checkout workload normally gets a name like `spiffe://cluster.local/ns/store/sa/checkout`. The `cluster.local` part is the trust domain, `store` is the namespace, and `checkout` is the service account. That string gives the mesh a stable caller name that does not depend on Pod IPs, node names, or replica counts.

A **trust domain** is the part of the identity system that says which authority is allowed to speak for a set of workload names. If payments trusts the `cluster.local` trust domain, then a checkout certificate under `cluster.local` can prove the checkout identity for this mesh. If another cluster or identity system uses a different trust domain, teams have to configure federation or migration deliberately, because payments should not guess that a similar-looking name from somewhere else is safe.

A **certificate** is the signed document that carries the SPIFFE ID, and a **private key** is the secret key paired with that certificate. The proxy uses the private key during the TLS handshake to prove that it owns the certificate without sending the private key across the network. For the store, the payments proxy should trust a checkout certificate only when the checkout proxy can prove possession of the matching private key. A copied identity string in a header should not be enough to charge an order.

A **certificate authority**, often shortened to CA, signs certificates so other systems can trust them. In a default Istio install, `istiod` includes the CA behavior for workload certificates. When the checkout Pod starts, its proxy receives an identity certificate after Istio validates the workload's Kubernetes service account. The proxy keeps that certificate and private key in its own runtime and refreshes the certificate before it expires, so application code does not need to store long-lived mesh secrets.

The **payments** proxy can trust a certificate signed by the mesh CA. When checkout calls payments, the checkout proxy presents its certificate during the connection setup. The payments proxy checks the signature chain, reads the SPIFFE identity from the certificate, and learns that the caller is `cluster.local/ns/store/sa/checkout`.

In production, some teams integrate Istio with SPIRE or another identity system when they need stronger node attestation, cross-platform workload identity, or federation between trust domains. The beginner path is still the same: a workload gets an identity, a CA signs proof of that identity, and the destination proxy verifies the proof before trusting the caller.

![SPIFFE certificate flow infographic showing a checkout service account, istiod CA, certificate with SPIFFE ID, mTLS handshake, source principal, and payments verification](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/spiffe-certificate-flow.png)

*The service account uses a certificate-backed workload identity, and the destination proxy reads that identity as the source principal during policy checks.*

## Require Strict mTLS With PeerAuthentication
<!-- section-summary: PeerAuthentication controls whether a destination workload accepts plain traffic or requires authenticated encrypted mTLS traffic. -->

**mTLS** means mutual TLS. Standard TLS is what your browser uses for HTTPS: the server proves its identity to the client and the traffic is encrypted. Mutual TLS adds the other side of the proof. The client also presents a certificate, so the destination can identify the caller. In a mesh, the application containers still speak normal HTTP to their local proxies, and the proxies handle the encrypted authenticated connection between Pods.

**PeerAuthentication** is the Istio resource that controls inbound mTLS behavior for workloads. It answers a specific question for the destination proxy: should this workload accept plain traffic, mTLS traffic, or only mTLS traffic? `STRICT` mode means the selected workload accepts only connections where the caller completes the mTLS handshake and presents a valid client certificate. For payments, strict mode is the line that lets checkout prove its identity through the mesh while a plain client from outside the mesh gets stopped before the payments container handles the request.

Start with a workload-scoped policy for **payments** so the first rollout has a small blast radius. This protects the sensitive destination while you verify that the intended callers are already in the mesh.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: payments-strict
  namespace: store
spec:
  selector:
    matchLabels:
      app: payments
  mtls:
    mode: STRICT
```

Apply the policy and ask Istio to analyze the configuration before you start testing traffic. `istioctl analyze` catches many policy and selector mistakes early, especially spelling mistakes in namespaces, labels, or API fields.

```bash
kubectl apply -f payments-strict-peer-authentication.yaml
istioctl analyze -n store
```

After every workload in the namespace has been injected and verified, many teams move to a namespace-wide strict policy. This version protects every workload in `store`, including checkout, payments, web, and analytics.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: store
spec:
  mtls:
    mode: STRICT
```

The workload-scoped policy teaches the behavior with less risk. The namespace-wide policy is the production direction once you know that no intended caller still depends on plain traffic.

## Prove Plain Traffic Fails and Meshed Traffic Works
<!-- section-summary: A plain Pod without an Istio proxy cannot present a mesh certificate, while a meshed workload can call payments through mTLS. -->

Now we can test the difference between a plain client and a meshed client. A **plain client** is a Pod without the Istio sidecar proxy. It can still send HTTP packets to the payments Service address, so Kubernetes networking may look fine, but it has no Envoy proxy to receive an Istio workload certificate, hold the private key, and speak Istio mTLS to the payments proxy. That is why the same cluster can route traffic while payments still rejects the caller.

Create a namespace without injection and run a simple curl Pod there. The `plain-client` Pod should show `1/1` because it has only the curl container and no proxy sidecar.

```bash
kubectl create namespace outside

kubectl run plain-client \
  -n outside \
  --image=curlimages/curl:8.10.1 \
  --restart=Never \
  -- sleep 3600

kubectl get pod plain-client -n outside

# NAME           READY   STATUS    RESTARTS   AGE
# plain-client   1/1     Running   0          18s
```

Send a request from that unmeshed Pod to payments. The exact curl error can vary by proxy version and network timing, but the useful signal is that the application does not receive a normal `200` response.

```bash
kubectl exec plain-client -n outside -- \
  curl -sS -o /dev/null -w "%{http_code}\n" \
  http://payments.store.svc.cluster.local:8080/health

# curl: (56) Recv failure: Connection reset by peer
# 000
```

The network path can still route to the Service IP, but the payments proxy expects an mTLS client certificate. The plain curl Pod presents raw HTTP, so the proxy closes the connection before the payments container handles the request.

Now test from the meshed checkout workload. Checkout still sends ordinary HTTP from the application container's point of view, but its sidecar proxy upgrades the Pod-to-Pod hop into mTLS.

```bash
kubectl exec -n store deploy/checkout -c checkout -- \
  curl -sS -o /dev/null -w "%{http_code}\n" \
  http://payments:8080/health

# 200
```

That `200` proves the intended meshed path works while strict mTLS blocks a plain client. At this point, payments can authenticate meshed callers, but authentication alone still allows both checkout and analytics if analytics has a valid mesh identity. The next step turns identity into an access rule.

## Inspect the Certificate and Source Principal
<!-- section-summary: The proxy certificate shows the SPIFFE ID that Istio later exposes to authorization as the source principal. -->

Before writing the authorization rule, it helps to inspect the actual identity Istio issued. The `istioctl proxy-config secret` command retrieves secret configuration from the Envoy proxy, including the workload certificate used for mTLS.

Pick one checkout Pod and list its active secrets. The short output is a quick way to confirm that Envoy has an active certificate and root certificate.

```bash
CHECKOUT_POD=$(kubectl get pod -n store -l app=checkout \
  -o jsonpath='{.items[0].metadata.name}')

istioctl proxy-config secret "$CHECKOUT_POD" -n store

# RESOURCE NAME     TYPE           STATUS     VALID CERT     SERIAL NUMBER
# default           Cert Chain     ACTIVE     true           12b31c...
# ROOTCA            CA             ACTIVE     true           6f44aa...
```

To read the SPIFFE ID inside the certificate, dump the secret as JSON, decode the certificate chain, and inspect the certificate with OpenSSL. This gives you the same identity string that the destination proxy uses during policy evaluation.

```bash
istioctl proxy-config secret "$CHECKOUT_POD" -n store -o json \
  | jq -r '.dynamicActiveSecrets[] | select(.name == "default") | .secret.tlsCertificate.certificateChain.inlineBytes' \
  | base64 --decode \
  | openssl x509 -noout -text \
  | grep -A1 "Subject Alternative Name"

# X509v3 Subject Alternative Name: critical
#     URI:spiffe://cluster.local/ns/store/sa/checkout
```

The **source principal** is the caller identity Istio derives from the peer certificate during mTLS. In Istio authorization policy, the principal value usually drops the `spiffe://` scheme and uses the form `cluster.local/ns/store/sa/checkout`. That value is the bridge between authentication and authorization: the certificate proves that checkout is the caller, and the policy compares checkout against the allowed list for payments. When analytics calls payments, the source principal changes to `cluster.local/ns/store/sa/analytics`, which gives the payments proxy a clear reason to reject it.

If the JSON query returns `null`, inspect the short `istioctl proxy-config secret` output first and confirm the active secret name. Istio and Envoy output shapes can change across versions, but the underlying check stays the same: find the active workload certificate and confirm the SPIFFE URI matches the service account you meant to use.

## Allow Checkout and Block Analytics
<!-- section-summary: AuthorizationPolicy lets payments allow the checkout source principal and reject analytics with the same mesh identity system. -->

An **AuthorizationPolicy** is an Istio access-control resource. It runs at the destination side of the connection, inside the server-side Envoy proxy. For the payments workload, that means the payments proxy evaluates the caller before the payments container receives the request. This placement gives checkout, analytics, and any other caller the same payments-side rule instead of each caller deciding for itself whether it should be trusted.

The safest service-to-service rule here is **least privilege between services**. Checkout needs to call payments, so checkout gets access. Analytics has no business reason to call payments, so analytics gets blocked. The policy should express that exact dependency instead of trusting every Pod in the namespace.

An **ALLOW policy** is an authorization policy that lists the requests that should pass. Once a workload has at least one matching ALLOW policy, unmatched requests are denied for that selected workload, which creates a **default-deny posture** for payments. Default-deny posture means access starts closed and you add the specific calls the service should accept. In the store, that posture is useful because analytics does not need a special deny rule; analytics simply fails because it is absent from the payments allow list.

Create an allow policy on payments that accepts only checkout's source principal. This policy targets Pods with `app: payments`, uses `action: ALLOW`, and matches the caller principal `cluster.local/ns/store/sa/checkout`.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payments-allow-checkout
  namespace: store
spec:
  selector:
    matchLabels:
      app: payments
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - cluster.local/ns/store/sa/checkout
      to:
        - operation:
            ports:
              - "8080"
            methods:
              - GET
              - POST
```

Apply it, analyze it, and describe a payments Pod so you can see the security configuration Istio thinks applies to that workload. The describe command is a sanity check before you rely on curl results alone.

```bash
kubectl apply -f payments-allow-checkout.yaml
istioctl analyze -n store

PAYMENTS_POD=$(kubectl get pod -n store -l app=payments \
  -o jsonpath='{.items[0].metadata.name}')

istioctl x describe pod -n store "$PAYMENTS_POD"
```

Now test the actual application paths. Web can still call checkout because this policy targets only payments. Checkout can call payments because the caller principal matches the allow rule.

```bash
kubectl exec -n store deploy/web -c web -- \
  curl -sS -o /dev/null -w "%{http_code}\n" \
  http://checkout:8080/cart

# 200

kubectl exec -n store deploy/checkout -c checkout -- \
  curl -sS -o /dev/null -w "%{http_code}\n" \
  http://payments:8080/charge

# 200
```

Analytics has a valid mesh certificate, so it passes mTLS authentication. The payments proxy still denies the request because the source principal is `cluster.local/ns/store/sa/analytics`, and the allow list contains only checkout.

```bash
kubectl exec -n store deploy/analytics -c analytics -- \
  curl -sS -o /dev/null -w "%{http_code}\n" \
  http://payments:8080/charge

# 403
```

That `403` is the result we wanted. The caller is inside the cluster, inside the mesh, and able to route to the payments Service, but the destination proxy blocks it because the service-to-service relationship falls outside the allow rule. This is the boundary we wanted: network reachability stays available, while application access follows the dependency graph.

## Rollout Guidance and Common Gotchas
<!-- section-summary: Production rollouts work best when teams verify identities first, dry-run authorization, apply small policies, and keep rollback commands ready. -->

In production, roll out mesh security in small steps. Start by giving every workload a dedicated service account and checking sidecar injection. Then enable strict mTLS on one sensitive workload, such as payments, before moving to a namespace-wide policy. Watch telemetry and application errors while you do this because strict mTLS immediately exposes callers that have no proxy, stale injection, or unusual startup behavior.

For authorization, **dry-run** the risky rule before enforcing it. Dry-run means Istio evaluates the authorization policy and records what would have matched, while production traffic still follows the currently enforced rules. Istio supports the `istio.io/dry-run: "true"` annotation on authorization policies for that rollout step. In our scenario, dry-run gives you a chance to confirm checkout would be allowed and analytics would be blocked before you make the payments proxy enforce the rule for real traffic.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payments-allow-checkout
  namespace: store
  annotations:
    istio.io/dry-run: "true"
spec:
  selector:
    matchLabels:
      app: payments
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - cluster.local/ns/store/sa/checkout
```

Keep rollback commands ready during the rollout window. Deleting the authorization policy reopens payments to all authenticated mesh callers, and deleting the workload-scoped peer authentication removes strict mTLS from payments. In a real incident, you should pair rollback with a ticket and follow-up review because rollback restores traffic but also removes the protection you were adding.

```bash
kubectl delete authorizationpolicy payments-allow-checkout -n store
kubectl delete peerauthentication payments-strict -n store
```

The most common gotcha is shared service accounts. If checkout and analytics both run as `default`, Istio sees the same workload identity for both, so an allow rule cannot separate them cleanly. Fix the Deployment specs first, restart the Pods, and inspect the new certificate before changing authorization.

Another common gotcha is writing the wrong principal string. The certificate SAN includes `spiffe://cluster.local/ns/store/sa/checkout`, while `AuthorizationPolicy` principals usually use `cluster.local/ns/store/sa/checkout`. If your cluster uses a custom trust domain, inspect the certificate instead of guessing the `cluster.local` part.

Policy placement also trips teams up. Authorization policies apply at the destination workload selected by the policy, so the payments allow rule belongs in the payments namespace and targets the payments labels. If you accidentally put the policy on checkout, you are protecting inbound traffic to checkout, not outbound traffic from checkout.

One practical testing gotcha is that production application images often do not include `curl`. When that happens, run a temporary meshed curl Pod with the same `serviceAccountName` as the caller you want to test, verify the policy result, and delete the test Pod after the rollout check.

Finally, remember that an `ALLOW` policy with rules creates a **default-deny posture** for the selected workload. The posture is powerful because payments starts from "only the listed callers can enter" instead of "everything in the namespace is probably fine." It can still surprise you if payments has health checks, metrics scrapes, or admin calls from a different service account. Add those callers deliberately, test them with `curl`, and keep the allowed list close to the real dependency graph.

## Putting It All Together
<!-- section-summary: The full flow uses service accounts for names, certificates for proof, strict mTLS for authenticated transport, and authorization for least privilege. -->

The security flow now has clear pieces. Kubernetes service accounts give **web**, **checkout**, **payments**, and **analytics** separate names. Istio turns those service accounts into SPIFFE workload identities and signed certificates. `PeerAuthentication` in `STRICT` mode makes payments accept only callers that can complete mTLS with a trusted certificate.

Once mTLS gives payments a verified caller identity, `AuthorizationPolicy` turns that identity into a service-to-service access decision. Checkout's source principal matches the allow rule, so checkout can call payments. Analytics has a different source principal, so payments rejects it with `403`. The cluster network still routes traffic, but the proxy layer enforces the application relationship.

That is the practical shape of mesh security. Pod IPs and broad namespace trust make weak authorization signals. Dedicated workload identities, authenticated encrypted transport, and explicit allow rules give payments a caller list that matches the application design.

![Payments security summary infographic showing strict mTLS, AuthorizationPolicy, checkout allowed, analytics 403, plain client blocked, and rollout steps from service accounts to rollback](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/payments-security-summary.png)

*Payments gets a narrow caller list: checkout can enter, analytics receives `403`, and a plain client cannot complete the mesh-authenticated path.*

## What's Next

Traffic rules and security rules give the mesh real power, and they also create a new operational surface. After teams add routing, mTLS, and authorization, they need to operate the proxy layer: inspect Envoy logs, understand proxy resource overhead, debug failed requests, and handle startup ordering between applications and sidecars.

The next article moves from policy design into day-to-day operations. We will look at what changes when every request path includes a proxy, and how to debug the mesh when the application code appears healthy while traffic still fails.

---

**References**

- [Istio Security Concepts](https://istio.io/latest/docs/concepts/security/) - Explains Istio identity, certificate management, mutual TLS authentication, authorization architecture, policy updates, and the dependency between mTLS and source identity.
- [Istio PeerAuthentication Reference](https://istio.io/latest/docs/reference/config/security/peer_authentication/) - Defines `STRICT`, `PERMISSIVE`, workload selectors, namespace policies, and mTLS mode behavior.
- [Istio Authentication Policy Task](https://istio.io/latest/docs/tasks/security/authentication/authn-policy/) - Shows practical peer authentication examples and cleanup commands for mTLS policy testing.
- [Istio AuthorizationPolicy Reference](https://istio.io/latest/docs/reference/config/security/authorization-policy/) - Documents selectors, actions, rules, principals, service accounts, source fields, and dry-run annotation examples.
- [Istio Security Best Practices](https://istio.io/latest/docs/ops/best-practices/security/) - Covers safer authorization patterns, defense in depth, traffic capture limits, and production security guidance.
- [Istio SPIRE Integration](https://istio.io/latest/docs/ops/integrations/spire/) - Describes how SPIRE can issue cryptographic identities for Istio workloads and why trust domains must match.
- [SPIFFE Concepts](https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/) - Defines SPIFFE IDs, SVIDs, trust domains, workload identity documents, and trust bundles.
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Defines Kubernetes service accounts as namespaced non-human identities for Pods and automation.
- [Istioctl Command Reference](https://istio.io/latest/docs/reference/commands/istioctl/) - Documents `istioctl proxy-config secret` for retrieving Envoy secret configuration.
- [Understand your Mesh with Istioctl Describe](https://istio.io/latest/docs/ops/diagnostic-tools/istioctl-describe/) - Shows how `istioctl x describe pod` verifies mesh membership and strict mTLS configuration.
