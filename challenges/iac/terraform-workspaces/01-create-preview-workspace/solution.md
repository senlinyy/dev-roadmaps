```bash
terraform workspace list
terraform workspace new preview-pr-482
terraform workspace show
```

The new workspace has a separate state instance, but the exercise still treats directories and accounts as the stronger production isolation boundary.
