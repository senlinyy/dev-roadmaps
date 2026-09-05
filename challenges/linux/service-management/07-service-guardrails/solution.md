```bash
printf '%s\n' '[Service]' 'MemoryMax=512M' 'CPUQuota=80%' 'LimitNOFILE=8192' | sudo tee /etc/systemd/system/orders.service.d/limits.conf
sudo systemctl daemon-reload
sudo systemctl restart orders
systemctl show orders -p MemoryMax -p CPUQuotaPerSecUSec -p MainPID
bash -c 'pid=$(systemctl show -p MainPID --value orders); cat /proc/$pid/limits'
```

The cgroup settings are visible through systemd properties; the new process separately proves the inherited open-file limit.
