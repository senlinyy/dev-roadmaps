```bash
sudo apt update
mv /etc/apt/sources.list.d/vendor.list /etc/apt/sources.list.d/vendor.list.disabled
sudo apt update
apt-cache policy vendor-agent
```

The first refresh records the signature failure. Renaming the source quarantines it without destroying evidence, so the second refresh succeeds against Ubuntu alone and the vendor package candidate becomes unavailable.
