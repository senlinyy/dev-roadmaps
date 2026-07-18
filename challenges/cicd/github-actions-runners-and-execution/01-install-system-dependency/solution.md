```yaml
name: CI
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Install System Dependencies
        run: sudo apt-get update && sudo apt-get install -y libpq-dev
      - run: pip install -r requirements.txt
      - run: python -m pytest
```

GitHub-hosted runners are ephemeral VMs with many tools, but they do not guarantee every system library. Installing `libpq-dev` before pip gives the `psycopg2` build access to `pg_config` and the required C headers.
