```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: notification-api
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.8.0
```

- `topology.kubernetes.io/zone` groups candidate nodes by zone.
- `ScheduleAnyway` makes balanced placement a preference when a temporary shortage prevents perfect spreading.
