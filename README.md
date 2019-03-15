# Fly and speed hack proxy for Minecraft 1.12 - 1.14

## Usage

```bash
node . localhost

# multiple domains
node . example.com proxy.localhost
```

Make sure that all subdomains resolve to your server address.

If `localhost` is specified as a domain, `play.hivemc.com.localhost` would
be used to connect to the HiveMC server.

Different ports are currently not supported unless the server has a SRV DNS record.
