$ grep Type= /etc/systemd/system/*.service
$ cat /var/run/api.status

The grep shows api.service uses `Type=notify`, worker.service uses `Type=simple`, and db-migrate.service uses `Type=oneshot`. The status file confirms the API sends `READY=1` via sd_notify.
