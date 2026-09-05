```bash
vim health-check.sh
./health-check.sh orders /etc/orders.conf /run/orders.pid
./health-check.sh payments /etc/payments.conf /run/payments.pid
```

`health-check.sh` should contain:

```bash
#!/usr/bin/env bash
service="$1"
config_path="$2"
pid_path="$3"

if [[ -f "$config_path" ]] && [[ -f "$pid_path" ]]; then
  printf "%s: healthy\n" "$service"
  exit 0
else
  printf "%s: unhealthy\n" "$service"
  exit 1
fi
```

The message and exit status now describe the same observed state, so people and automation receive consistent evidence.
