`checkout-destination-rule.yaml`

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: checkout
  namespace: store
spec:
  host: checkout.store.svc.cluster.local
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

`checkout-virtual-service.yaml`

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout
  namespace: store
spec:
  hosts:
    - checkout.store.svc.cluster.local
  http:
    - route:
        - destination:
            host: checkout.store.svc.cluster.local
            subset: v1
          weight: 95
        - destination:
            host: checkout.store.svc.cluster.local
            subset: v2
          weight: 5
```

- The Service hostname stays stable while proxies split traffic by subset.
