```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: orders-api
  namespace: orders
spec:
  parentRefs:
    - name: public-api
      namespace: platform-networking
      sectionName: https
  hostnames:
    - api.devpolaris.local
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /orders
      backendRefs:
        - name: orders-api
          port: 80
```

- `sectionName: https` attaches the Route to the precise listener owned by the platform team.
- The backend uses the Service port, while the Service remains responsible for forwarding to ready Pods.
