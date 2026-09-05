```bash
cat /etc/logrotate.d/nginx
sudo sed -i.bak -e 's/weekly/daily/' -e 's/rotate 2/rotate 14/' -e 's/0666 root root/0640 www-data adm/' /etc/logrotate.d/nginx
sudo logrotate -d /etc/logrotate.d/nginx
```

You can make the same edits with `sudo vim /etc/logrotate.d/nginx`. Debug mode validates without changing logs or rotation state.
