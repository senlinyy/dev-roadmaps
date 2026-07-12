```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: orders
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: orders-api
    app.kubernetes.io/component: api
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

- The two selector labels identify the intended orders API Pods in the same namespace.
- Callers use port `80`, while the named target port keeps the Service independent of the container's numeric port.
