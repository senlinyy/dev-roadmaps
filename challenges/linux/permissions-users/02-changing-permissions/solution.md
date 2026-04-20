```bash
chmod u+x /opt/app/start.sh
chmod 600 /opt/app/secrets.env
chmod 755 /opt/app/logs
ls -l /opt/app
```

`u+x` adds execute for the owner. `600` means owner can read and write, nobody else has access. `755` means owner has full access, group and others can read and traverse.
