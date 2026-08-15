```bash
kubectl config current-context
kubectl get deployment notification-api --context notifications-prod --namespace notifications-prod
kubectl get pods -l app=notification-api --context notifications-prod --namespace notifications-prod
kubectl logs notification-api-76fd8c795b-kz2mw -c api --tail 3 --context notifications-prod --namespace notifications-prod
```

The explicit context and namespace make every incident read reproducible. The Pod list narrows the failing replica before logs reveal the dependency timeout.
