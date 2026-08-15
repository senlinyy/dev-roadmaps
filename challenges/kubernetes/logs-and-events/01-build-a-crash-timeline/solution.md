```bash
kubectl get pods -l app=orders-api --namespace orders
kubectl describe pod orders-api-5d89b7f8cd-b9t4n --namespace orders
kubectl logs orders-api-5d89b7f8cd-b9t4n -c api --previous --namespace orders
```

The Pod list identifies the restarting replica, the description supplies the BackOff decision, and previous logs reveal that the terminated process rejected an empty `DB_URL`.
