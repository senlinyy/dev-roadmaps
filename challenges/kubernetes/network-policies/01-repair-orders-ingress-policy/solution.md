```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-checkout-web-to-orders-api
  namespace: orders
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

- Both source selectors share one peer item, so the caller must match the supplied checkout web Deployment and checkout Namespace together.
- Port `8080` is the destination Pod port declared by the supplied orders API workload.
