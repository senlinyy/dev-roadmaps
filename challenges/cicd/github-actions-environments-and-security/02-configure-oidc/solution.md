```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-deploy-role
          aws-region: us-east-1
      - run: aws s3 sync ./build s3://my-production-bucket
```

The `id-token: write` permission tells GitHub to generate a short-lived JWT for the job. The `configure-aws-credentials` action sends this JWT to AWS STS, which verifies it against the IAM trust policy and returns temporary credentials. No static AWS keys are stored anywhere.
