```bash
sudo chgrp developers /srv/project
sudo chmod 2775 /srv/project
touch /srv/project/proof.txt
stat /srv/project /srv/project/proof.txt
```

Mode `2775` adds setgid while preserving collaborative write access. The proof file is owned by `dev` but inherits the `developers` group, and the configured `0002` umask creates it as `0664`.
