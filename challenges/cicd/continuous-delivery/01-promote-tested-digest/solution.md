```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      image_digest:
        description: Tested booking API image digest
        required: true
        type: string

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh staging registry.example.com/booking-api@${{ inputs.image_digest }}

  deploy-production:
    needs: deploy-staging
    environment: production
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh production registry.example.com/booking-api@${{ inputs.image_digest }}
```

Both environments consume the same content-addressed image. Production begins only after staging succeeds and the protected environment authorizes promotion.
