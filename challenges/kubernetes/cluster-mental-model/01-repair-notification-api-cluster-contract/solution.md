```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-api
      component: api
  template:
    metadata:
      labels:
        app: notification-api
        component: api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.7.0
          ports:
            - name: http
              containerPort: 3000
          readinessProbe:
            httpGet:
              path: /ready
              port: http
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
```

- Matching selector and template labels let the Deployment own the intended Pods and let a Service reuse the same identity.
- Readiness controls traffic eligibility, requests guide scheduling, and limits cap runtime use.
