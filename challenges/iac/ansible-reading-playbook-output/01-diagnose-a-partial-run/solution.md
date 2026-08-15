```bash
ansible-playbook -i inventory.ini deploy.yml --check --diff
ansible-playbook -i inventory.ini deploy.yml --check --diff --limit web-01
```
