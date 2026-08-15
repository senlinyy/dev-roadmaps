```bash
ansible-playbook -i inventory.ini deploy.yml --syntax-check
ansible-playbook -i inventory.ini deploy.yml --list-hosts
ansible-playbook -i inventory.ini deploy.yml --check --diff --limit web-canary-01
```
