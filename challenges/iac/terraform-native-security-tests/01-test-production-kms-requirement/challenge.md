---
title: "Test the Production KMS Requirement"
sectionSlug: the-module-contract-test
order: 1
---

The log bucket module rejects production input when `kms_key_id` is null, but that security contract has no regression test. Add a native Terraform test that proves the validation continues to fail safely.

Your job:

1. **Create a plan test run** named `prod_requires_kms_key` in `tests/log_bucket.tftest.hcl`.
2. **Supply production-like inputs** with service name `billing`, environment `prod`, and a null KMS key.
3. **Declare the expected validation failure** against `var.kms_key_id`.
4. **Leave the read-only module contract unchanged**.

The grader checks the native test file and its expected failure contract, not a real provider run.
