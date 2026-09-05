```bash
id
namei -l /srv/app/releases/42/config.env
getfacl /srv/app/releases/42/config.env
sudo -u app -- test -r /srv/app/releases/42/config.env
sudo chmod 750 /srv/app
sudo -u app -- test -r /srv/app/releases/42/config.env
touch /srv/app/releases/42/deploy-proof
```

`/srv/app` was the first component without group traversal. Changing only that directory to `0750` restores service access without widening the release tree or protected configuration. The proof file inherits group `app` from the setgid release directory.
