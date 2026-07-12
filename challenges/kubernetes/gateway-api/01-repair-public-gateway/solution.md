```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public-api
  namespace: platform-networking
spec:
  gatewayClassName: shared-public
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: api.devpolaris.local
      tls:
        mode: Terminate
        certificateRefs:
          - name: devpolaris-api-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              shared-gateway: public-api
```

- The named listener gives Routes a precise attachment target and keeps TLS with the platform-owned hostname.
- The namespace selector limits route attachment to teams explicitly onboarded to this shared edge.
