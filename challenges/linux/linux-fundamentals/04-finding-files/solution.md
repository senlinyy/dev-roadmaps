```bash
find /etc -type f -name database.conf
tree -L 2 /opt/orders-api
find /opt/orders-api -type f -name "*.conf"
```

- `find` searches live paths from the chosen starting directory.
- The quoted wildcard is interpreted by `find` instead of being expanded by the shell first.
