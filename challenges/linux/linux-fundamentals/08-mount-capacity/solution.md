```bash
findmnt /srv/orders-api/uploads
df -h /srv/orders-api/uploads
du -h --max-depth=1 /srv/orders-api/uploads
```

- The longest matching mount point owns the application path.
- `df` identifies filesystem pressure; `du` identifies the directories consuming that filesystem.
