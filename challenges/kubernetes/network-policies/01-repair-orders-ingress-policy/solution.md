```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-web-to-orders-api
  namespace: orders
  labels:
    app.kubernetes.io/part-of: orders
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: checkout
          podSelector:
            matchLabels:
              app.kubernetes.io/name: checkout-web
      ports:
        - protocol: TCP
          port: 8080
```

- Both source selectors share one peer item, so the caller must be a checkout web Pod in the checkout namespace.
- Port `8080` is the destination Pod port evaluated by the policy.
