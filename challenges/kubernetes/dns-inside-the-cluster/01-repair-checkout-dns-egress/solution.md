```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: checkout
  labels:
    app.kubernetes.io/part-of: checkout
    app.kubernetes.io/managed-by: platform-team
  annotations:
    devpolaris.io/change-ticket: NET-1842
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: checkout-web
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

- Both selectors narrow the destination to DNS Pods in `kube-system`.
- UDP handles normal DNS queries, while TCP remains available when DNS requires it.
