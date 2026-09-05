```bash
id
ls -l /srv/web/config.env
stat /srv/web/config.env
```

The `dev` process has the `web` supplementary group. The file is owned by `root:web` with mode `0640`, so the matching group class grants read access without granting write access.
