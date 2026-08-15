```bash
terraform init -migrate-state
terraform plan
```

The backend migration changes Terraform operational memory, not the managed infrastructure.
