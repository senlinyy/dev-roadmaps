```bash
findmnt -T /var/lib/app
df -hT /var/lib/app
cat /etc/fstab
sudo findmnt --verify
journalctl -k -b
```

The verifier checks authored local-device entries only. It does not mount storage, test a reboot, or repair filesystem corruption.
