# Fly and speed hack proxy for Minecraft 1.15

## Usage

```bash
# default domain is *.localhost
node .

# using default address
node . --address localhost:25566

# multiple domains
node . example.com proxy.localhost

# run on different port
node . --port 25566
```

Make sure that all subdomains resolve to your server address.

If `localhost` is specified as a domain, `play.hivemc.com.localhost` would
be used to connect to the HiveMC server.

Different ports are currently not supported unless the server has a SRV DNS record.

If an address is specified it will be used as the default address if none of
the domains match e.g. you are connecting directly via IP address.

## Commands

```
.speed <multiplier>  Set the walking speed
.fly                 Toggle fly on/off
.tp <x> <y> <z>      Teleport (relative with ~)
.wall                Glitch through walls in the head direction
.nofall              Enable or disable no fall damage
.novelocity          Drop player velocity packets
.bright              Enable night vision
.book                Write contents of book.txt to book in main hand
```

Every 14 lines in book.txt will be a page in the book.
