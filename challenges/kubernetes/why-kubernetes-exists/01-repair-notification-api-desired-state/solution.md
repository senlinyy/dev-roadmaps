```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  replicas: 4
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: notification-api
          image: ghcr.io/devpolaris/notification-api:1.4.2
```

- `spec.replicas` records the desired number of application copies.
- Matching selector and template labels give the Deployment ownership of its Pods.
- The Pod template records the container identity and approved image used for replacements.
