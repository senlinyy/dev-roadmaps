```bash
sudo -u app -- test -r /srv/web/config.env
namei -l /srv/web/config.env
sudo chgrp web /srv/web
sudo chmod 750 /srv/web
sudo -u app -- test -r /srv/web/config.env
```

The file already allowed `web` to read it. The repair changes only `/srv/web`, giving the same group directory traversal while keeping access closed to others.
