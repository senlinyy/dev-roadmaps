1. Replace the literal token with an Ansible variable reference.
2. `no_log` belongs on the task, not inside the uri arguments.
3. Register the protected result so later tasks can inspect only safe fields.
