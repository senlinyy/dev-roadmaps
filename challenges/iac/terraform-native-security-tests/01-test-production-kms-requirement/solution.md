```hcl
run "prod_requires_kms_key" {
  command = plan

  variables {
    environment  = "prod"
    service_name = "billing"
    kms_key_id   = null
  }

  expect_failures = [
    var.kms_key_id,
  ]
}
```

The test succeeds only when the production input is rejected by the KMS key validation. That makes weakening or removing the security rule a visible test regression.
