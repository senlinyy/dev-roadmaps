```bash
sudo -l -U deploy
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart app.service' | sudo tee /etc/sudoers.d/app-deploy
sudo chmod 440 /etc/sudoers.d/app-deploy
sudo visudo -cf /etc/sudoers.d/app-deploy
sudo -l -U deploy
stat /etc/sudoers.d/app-deploy
```

The elevated `tee` owns the protected write instead of relying on unprivileged redirection. The validated rule grants one exact service restart as root and nothing else.
