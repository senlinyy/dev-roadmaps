```bash
df -h /; df -i /
systemctl status api; systemctl show api; journalctl -u api
stat /srv/api/config.json; sudo -u api /srv/api/check-config.sh
sudo chown root:api /srv/api/config.json; sudo chmod 640 /srv/api/config.json
sudo sed -i 's/9090/8080/' /srv/api/config.json; sudo -u api /srv/api/check-config.sh
sudo systemctl restart api && systemctl status api
```
