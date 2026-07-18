```yaml
apiVersion: v1
kind: Service
metadata:
  name: public-gateway
  namespace: platform
  labels:
    app.kubernetes.io/part-of: platform-edge
    app.kubernetes.io/managed-by: platform-team
  annotations:
    devpolaris.io/owner: edge-team
spec:
  externalTrafficPolicy: Cluster
  type: LoadBalancer
  selector:
    app.kubernetes.io/name: public-gateway
  ports:
    - name: https
      protocol: TCP
      port: 443
      targetPort: https
```

- `LoadBalancer` asks the configured infrastructure controller to publish an external address.
- The selector keeps public traffic on the gateway Pods, while private application Services can remain ClusterIP.
