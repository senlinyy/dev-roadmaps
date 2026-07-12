```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout-web
  namespace: checkout
spec:
  ingressClassName: public
  tls:
    - hosts:
        - shop.devpolaris.example
      secretName: shop-devpolaris-example-tls
  rules:
    - host: shop.devpolaris.example
      http:
        paths:
          - path: /checkout
            pathType: Prefix
            backend:
              service:
                name: checkout-web
                port:
                  name: http
```

- `Prefix` covers `/checkout` and child paths while preserving path segment boundaries.
- The named port keeps the edge route tied to the Service contract, and the TLS host uses the certificate Secret in the same namespace.
