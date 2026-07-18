```yaml
name: ansible-orders-production

on:
  pull_request:
    paths:
      - "ansible/**"

permissions:
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --check --diff

  deploy-canary:
    needs: preview
    environment: production
    concurrency: orders-production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: ansible-playbook -i inventories/prod orders.yml --limit orders-web-01
```

The preview records the proposed canary change without applying it. The deployment job reuses the exact host boundary only after the protected environment gate, and concurrency prevents overlapping production runs.
