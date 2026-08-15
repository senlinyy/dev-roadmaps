### tests/bucket.tftest.hcl

```hcl
run "production_bucket_name" {
  command = plan

  variables {
    service_name = "billing"
    environment  = "prod"
  }

  assert {
    condition     = aws_s3_bucket.this.bucket == "dp-billing-prod"
    error_message = "Production bucket names must include service and environment."
  }
}
```

The test protects the module public naming contract with an executable plan assertion.
