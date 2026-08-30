```bash
apt-cache policy database-agent
sudo apt-mark hold database-agent
sudo apt upgrade
apt-mark showhold
```

The hold keeps `database-agent` at `5.8.2`, while the general upgrade moves `curl` to `8.5.0-2ubuntu10.6`. Listing holds makes the exception visible to the next operator.
