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
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 3000
```

- The selector aligns the Service with the current orders API Pod identity.
- Port `80` is the caller contract, while `targetPort: 3000` reaches the application listener.
