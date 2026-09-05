```bash
journalctl -u api
apt-cache policy api-agent
sudo apt install api-agent=2.4.1
sudo apt-mark hold api-agent
sudo systemctl restart api
apt-mark showhold; systemctl status api
```
