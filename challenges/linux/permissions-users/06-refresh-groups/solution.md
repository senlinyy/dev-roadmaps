```bash
id
test -r /var/run/docker.sock
newgrp docker
id
test -r /var/run/docker.sock
```

The account record already listed `docker`, but the original session did not. Refreshing the group context adds `docker` to the active process credentials, so the existing group-read bit becomes effective.
