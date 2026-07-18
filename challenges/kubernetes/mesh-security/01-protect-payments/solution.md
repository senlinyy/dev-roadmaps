`peer-authentication.yaml`

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

`payments-authorization-policy.yaml`

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

- Strict mTLS supplies workload identity before authorization evaluates the source principal.
