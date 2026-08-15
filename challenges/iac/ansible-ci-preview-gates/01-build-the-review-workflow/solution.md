### `.github/workflows/ansible-review.yml`

```yaml
name: Ansible review

on:
  pull_request:
    paths:
      - "ansible/**"
      - ".github/workflows/ansible-review.yml"

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Install Ansible
        run: python -m pip install ansible-core==2.18.7

      - name: Install pinned collections
        run: ansible-galaxy collection install -r requirements.yml

      - name: Validate syntax
        run: ansible-playbook -i inventories/production.ini deploy.yml --syntax-check

      - name: Prove production scope
        run: ansible-playbook -i inventories/production.ini deploy.yml --list-hosts

      - name: Preview the canary
        run: ansible-playbook -i inventories/production.ini deploy.yml --check --diff --limit canary
```

### `requirements.yml`

```yaml
---
collections:
  - name: community.general
    version: 10.7.0
```
