---
title: "Mesh Security"
description: "Use workload identities, encrypted service-to-service connections, and mesh access rules to block unwanted service calls."
overview: "Mesh security protects service-to-service calls by giving workloads identity, encrypting traffic with mTLS, and allowing sensitive services to accept only approved callers."
tags: ["kubernetes", "service-mesh", "security", "mtls", "spiffe"]
order: 3
id: article-containers-orchestration-kubernetes-service-mesh-mesh-security
---
## Table of Contents

1. [A Normal Payment Call](#a-normal-payment-call)
2. [Each Workload Has Its Own Service Account](#each-workload-has-its-own-service-account)
3. [How Istio Turns Service Accounts Into Identity](#how-istio-turns-service-accounts-into-identity)
4. [Require Strict mTLS With PeerAuthentication](#require-strict-mtls-with-peerauthentication)
5. [Prove Plain Traffic Fails and Meshed Traffic Works](#prove-plain-traffic-fails-and-meshed-traffic-works)
6. [Inspect the Certificate and Source Principal](#inspect-the-certificate-and-source-principal)
7. [Allow Checkout and Block Analytics](#allow-checkout-and-block-analytics)
8. [Rollout Guidance and Common Gotchas](#rollout-guidance-and-common-gotchas)
9. [Putting It All Together](#putting-it-all-together)
10. [References](#references)

## A Normal Payment Call
<!-- section-summary: Mesh security uses workload identity, encrypted transport, and authorization policies to control service-to-service calls. -->

**Mesh security** protects service-to-service communication by giving workloads cryptographic identity, encrypting traffic with mutual TLS, and allowing only approved callers into sensitive services. Kubernetes can route a request to the right Service, but the payment service also needs to know who is calling and whether that caller is trusted.

In the store, `web` calls `checkout`, and `checkout` calls `payments`. The payment service should trust `checkout`, but it should reject a random analytics job even if that job knows the `payments` Service name. Basic Kubernetes networking can route the packet. Mesh security answers who is calling and whether that caller is allowed.

The practical sequence is identity first, mTLS second, authorization third.

![Mesh security chain infographic showing web to checkout to payments allowed through identity, mTLS, and AuthorizationPolicy while analytics is blocked at the payments destination proxy](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/security-chain.png)

*The security chain protects payments by checking workload identity at the proxy before the request reaches the app.*

## Each Workload Has Its Own Service Account
<!-- section-summary: Service accounts give each workload a stable Kubernetes identity that the mesh can turn into a caller identity. -->

A mesh authorization rule is only useful if each workload has a clear identity. In Kubernetes, that identity usually starts with a **ServiceAccount**. The checkout Deployment should run as `checkout`, the payments Deployment should run as `payments`, and an analytics job should have a separate `analytics` identity.

That separation gives the mesh something concrete to check later. A policy can allow `checkout` to call `payments` without also allowing every other workload in the namespace.

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

What this gives the mesh:

- `checkout` has its own workload identity.
- `payments` has its own workload identity.
- `analytics` can be blocked separately from checkout.

Use those service accounts in Deployments:

```yaml
spec:
  template:
    spec:
      serviceAccountName: checkout
```

The `serviceAccountName` field ties the Pod to the intended identity. After the Pod receives a sidecar, the mesh can turn that Kubernetes identity into the caller identity used during mTLS and authorization checks.

## How Istio Turns Service Accounts Into Identity
<!-- section-summary: Istio issues workload certificates whose SPIFFE identity includes trust domain, namespace, and service account. -->

Istio uses workload certificates so proxies can authenticate each other. The identity usually follows a SPIFFE-style format:

```text
spiffe://cluster.local/ns/store/sa/checkout
```

Read that identity as:

- `cluster.local` is the trust domain.
- `store` is the namespace.
- `checkout` is the service account.

![SPIFFE certificate flow infographic showing a checkout service account, istiod CA, certificate with SPIFFE ID, mTLS handshake, source principal, and payments verification](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/spiffe-certificate-flow.png)

*The certificate flow turns a Kubernetes service account into the identity the destination proxy can verify.*

## Require Strict mTLS With PeerAuthentication
<!-- section-summary: Strict mTLS requires meshed callers to present valid workload certificates before reaching the destination workload. -->

**mTLS** means both sides authenticate during TLS: the client proxy proves its identity, and the server proxy proves its identity. `PeerAuthentication` controls whether a workload or namespace accepts plaintext or requires mTLS.

Require strict mTLS for the store namespace:

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: store-strict-mtls
  namespace: store
spec:
  mtls:
    mode: STRICT
```

What this policy does:

- Workloads in `store` require mesh mTLS for inbound traffic.
- Plain clients without a mesh certificate cannot complete the same path.
- Authorization policies can rely on source identity after mTLS is active.

Apply and inspect:

```bash
$ kubectl -n store apply -f peer-authentication.yaml
peerauthentication.security.istio.io/store-strict-mtls created

$ istioctl x describe pod -n store deploy/payments
Pod: payments-6dc9c8c7f9-j2m4x
   Pod Ports: 8080 (http)
   mTLS: STRICT
```

The `mTLS: STRICT` line confirms Istio sees strict mTLS for the payments Pod.

## Prove Plain Traffic Fails and Meshed Traffic Works
<!-- section-summary: A security rollout should prove the allowed meshed call and the blocked plain call before moving on to authorization rules. -->

Test one allowed meshed call from checkout:

```bash
$ kubectl -n store exec deploy/checkout -c checkout -- curl -sS http://payments:8080/readyz
{"status":"ok"}
```

What this proves:

- Checkout can still reach payments through the mesh.
- Service discovery and routing still work.
- The request can pass strict mTLS because checkout has a sidecar identity.

Now test from a non-meshed debug Pod if your cluster policy allows creating one:

```bash
$ kubectl -n store run plain-curl --rm -it --image=curlimages/curl --restart=Never -- curl -sS http://payments:8080/readyz
curl: (56) Recv failure: Connection reset by peer
```

What this result means:

- The plain client did not complete the mTLS-protected path.
- Strict mTLS is affecting traffic as intended.
- If the plain call succeeds, check namespace labels, sidecar injection, and PeerAuthentication scope.

## Inspect the Certificate and Source Principal
<!-- section-summary: Certificate and principal inspection confirms which identity Envoy presents during mTLS. -->

Use `istioctl proxy-config secret` to inspect Envoy certificate material at a high level:

```bash
$ istioctl proxy-config secret deploy/checkout -n store
RESOURCE NAME     TYPE           STATUS     VALID CERT     SERIAL NUMBER
default           Cert Chain     ACTIVE     true           3a:52:9f
ROOTCA            CA             ACTIVE     true           7b:11:de
```

What this output tells you:

- The checkout proxy has active workload certificate material.
- The root CA is present.
- Certificate health is ready for mTLS handshakes.

For authorization debugging, source principal is the important identity. Istio access logs and policy decisions will refer to identities such as `cluster.local/ns/store/sa/checkout`.

## Allow Checkout and Block Analytics
<!-- section-summary: AuthorizationPolicy lets the destination proxy allow specific authenticated callers and reject everything else. -->

Now protect payments with an AuthorizationPolicy. Allow only checkout to call it:

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
```

What this policy means:

- It applies to workloads labeled `app: payments`.
- It allows requests from the checkout service account principal.
- Other callers are denied because at least one ALLOW policy selects payments.

Test both paths:

```bash
$ kubectl -n store exec deploy/checkout -c checkout -- curl -sS -o /dev/null -w "%{http_code}\n" http://payments:8080/charge
200

$ kubectl -n store exec deploy/analytics -c analytics -- curl -sS -o /dev/null -w "%{http_code}\n" http://payments:8080/charge
403
```

What these results prove:

- Checkout is allowed.
- Analytics is blocked.
- The policy is enforcing caller identity at the destination proxy.

## Rollout Guidance and Common Gotchas
<!-- section-summary: Mesh security should roll out with service accounts, permissive observation, strict mTLS, authorization tests, and rollback notes. -->

Roll out mesh security in stages:

| Stage | Evidence |
|---|---|
| Service accounts | Each workload has a dedicated identity |
| Sidecars | Pods show `2/2` ready and proxy sync |
| mTLS observation | Traffic works before strict enforcement |
| Strict mTLS | Plain traffic fails, meshed traffic works |
| Authorization | Allowed and denied callers produce expected status codes |
| Rollback | Policies can be removed or relaxed with a named command |

Common gotchas:

| Symptom | Check |
|---|---|
| All callers get `403` | Principal string matches namespace and service account |
| Plain traffic still works | PeerAuthentication scope and sidecar injection |
| Policy affects wrong workload | Selector labels match only payments |
| Job cannot call payments | Job has its own service account and sidecar if needed |

## Putting It All Together
<!-- section-summary: Mesh security gives sensitive services a caller list based on workload identity, authenticated transport, and destination-side authorization. -->

The secure store path is now clear. Workloads use dedicated service accounts. Istio turns those accounts into certificate-backed identities. Strict mTLS authenticates and encrypts service calls. AuthorizationPolicy lets payments allow checkout and block analytics.

![Payments security summary infographic showing strict mTLS, AuthorizationPolicy, checkout allowed, analytics 403, plain client blocked, and rollout steps from service accounts to rollback](/content-assets/articles/article-containers-orchestration-kubernetes-service-mesh-mesh-security/payments-security-summary.png)

*Payments gets a narrow caller list: checkout can enter, analytics receives `403`, and a plain client cannot complete the mesh-authenticated path.*

## References

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
