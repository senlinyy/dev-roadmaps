```bash
gcloud config set project dp-orders-prod
gcloud storage buckets create gs://devpolaris-orders-exports-prod --location us-central1 --labels team=orders env=prod purpose=exports
gcloud storage buckets list --project dp-orders-prod
```
