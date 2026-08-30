```bash
readlink /opt/orders-api/current
ln -sfn /opt/orders-api/releases/20260830 /opt/orders-api/current
readlink -f /opt/orders-api/current
```

- The symbolic link changes one directory entry; it does not copy release files.
- Canonical resolution follows the link to the active release directory.
