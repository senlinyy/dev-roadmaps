```bash
namei -l /srv/myapp/data/cache.db
sudo chown myapp:myapp /srv/myapp/data/cache.db
sudo -u myapp -- test -w /srv/myapp/data/cache.db
ls -l /srv/myapp/data/cache.db
```

The parent path was already traversable by `myapp`. Assigning the database to `myapp:myapp` lets the service use the existing owner-write bit without widening access for unrelated users.
