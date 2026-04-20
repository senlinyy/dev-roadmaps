```bash
id
ls -l /opt/project
chown dev:devs /opt/project/app.py
chgrp devs /opt/project/README.md
ls -l /opt/project
```

`id` shows your UID, GID, and group memberships. `chown user:group file` changes both owner and group. `chgrp group file` changes only the group. The colon syntax in chown is the standard way to set both at once.
