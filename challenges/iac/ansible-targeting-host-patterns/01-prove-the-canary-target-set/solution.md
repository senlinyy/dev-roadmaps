```bash
ansible 'web:&production:!canary' --list-hosts
ansible canary --list-hosts
ansible-playbook -i inventory.ini deploy.yml --check --limit web-canary-01
```
