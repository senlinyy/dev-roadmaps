```yaml
name: Secure release
on: [pull_request, push]

jobs:
  test:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
      - run: npm test

  publish:
    needs: test
    if: github.ref == 'refs/heads/main'
    environment: production
    permissions:
      contents: read
      id-token: write
      packages: write
    runs-on: ubuntu-latest
    steps:
      - run: ./publish-signed-image.sh
```

Untrusted validation cannot mint cloud credentials or publish packages. Stronger permissions appear only in the protected downstream job.
