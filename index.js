const { Connection, PacketWriter, State } = require("mcproto")
const { createServer } = require("net")
const path = require("path")
const fs = require("fs")

const profilesFilePath = path.join(require("minecraft-folder-path"), "launcher_profiles.json")
const launcherProfiles = JSON.parse(fs.readFileSync(profilesFilePath, "utf-8"))
const profiles = new Map

for (const account of Object.values(launcherProfiles.authenticationDatabase)) {
    for (const [id, { displayName }] of Object.entries(account.profiles)) {
        profiles.set(displayName, { id, accessToken: account.accessToken })
    }
}

let opt = null, opts = {}, args = []
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) opt = arg.slice(2)
    else if (opt) opts[opt] = arg, opt = null
    else args.push(arg)
}

let defaultHost, defaultPort
if (opts.address) {
    [defaultHost, defaultPort] = opts.address.split(":")
    defaultPort = defaultPort && parseInt(defaultPort)
}

const domains = args.map(addr => addr.startsWith(".") ? addr : "." + addr)
if (domains.length == 0) domains.push(".localhost")

console.log("Domains: " + domains.map(h => "*" + h).join(", "))
if (defaultHost) {
    console.log(`Default address: ${defaultHost}${defaultPort ? `:${defaultPort}` : ""}`)
}

function extractHost(host) {
    for (const addr of domains) if (host.endsWith(addr)) {
        return host.slice(0, -addr.length)
    }
}

createServer(async socket => {
    const client = new Connection(socket, { isServer: true, keepAlive: false })
    client.onError = console.log

    const handshake = await client.nextPacket()
    handshake.readVarInt()
    let host = extractHost(handshake.readString().split("\0")[0]), port
    if (!host) {
        if (!defaultHost) return client.disconnect()
        host = defaultHost
        port = defaultPort
    }

    let profile, username
    if (client.state == State.Login) {
        username = (await client.nextPacket()).readString()
        profile = profiles.get(username)
    }
    client.pause()

    Connection.connect(host, port, profile && {
        accessToken: profile.accessToken,
        profile: profile.id,
        keepAlive: false
    }).then(async conn => {
        conn.onError = console.log
        client.onClose = () => conn.disconnect()
        conn.onClose = () => client.disconnect()

        conn.send(new PacketWriter(0x0).writeVarInt(client.protocol)
            .writeString(host).writeUInt16(conn.socket.remotePort)
            .writeVarInt(client.state))

        client.resume()
        if (client.state == State.Login) {
            conn.send(new PacketWriter(0x0).writeString(username))
            client.send(await conn.nextPacketWithId(0x2))
        } else {
            conn.onPacket = packet => client.send(packet)
            client.onPacket = packet => conn.send(packet)
            return
        }

        function sendChat(text) {
            client.send(new PacketWriter(ids.chatMessageC)
                .writeJSON(text).writeVarInt(0))
        }

        const ids = getPacketIdsForProtocol(client.protocol)
        const teleportIds = new Set
        let eid, flyingEnabled = false, flying = false, speed = 1
        let x = 0, y = 0, z = 0, yaw = 0, pitch = 0
        let invulnerable = false, creativeMode = false
        let noFall = false

        conn.onPacket = packet => {
            if (client.state != State.Play) return client.send(packet)
            if (packet.id == ids.joinGame) {
                eid = packet.readInt32()
            } else if (packet.id == ids.playerPosLookC) {
                const nx = packet.readDouble(), ny = packet.readDouble(), nz = packet.readDouble()
                const nyaw = packet.readFloat(), npitch = packet.readFloat()
                const flags = packet.readUInt8()
                x     = flags & 0b00001 ? x + nx : nx
                y     = flags & 0b00010 ? y + ny : ny
                z     = flags & 0b00100 ? z + nz : nz
                yaw   = flags & 0b01000 ? yaw + nyaw : nyaw
                pitch = flags & 0b10000 ? pitch + npitch : npitch
            } else if (packet.id == ids.playerAbilitiesC) {
                const flags = packet.readUInt8()
                if (flags & 4) flyingEnabled = true
                flying = (flags & 2) > 0
                invulnerable = (flags & 1) > 0
                creativeMode = (flags & 8) > 0
            }
            client.send(packet)
            if (packet.id == ids.playerAbilitiesC || packet.id == ids.entityProperties) updateAbilitiesSpeed()
        }

        function updateAbilitiesSpeed() {
            client.send(new PacketWriter(ids.entityProperties)
                .writeVarInt(eid).writeInt32(1)
                .writeString("generic.movementSpeed")
                .writeDouble(.1 * speed).writeVarInt(0))
            let flags = 0
            if (invulnerable) flags += 1
            if (flying) flags += 2
            if (flyingEnabled) flags += 4
            if (creativeMode) flags += 8
            client.send(new PacketWriter(ids.playerAbilitiesC)
                .writeUInt8(flags).writeFloat(.1 * speed).writeFloat(0))
        }

        function runCommand(command, args) {
            switch (command) {
                case "help": {
                    sendChat({
                        text: "Available commands: .speed, .fly, .tp, .wall, .nofall\n", extra: [
                            "More info: ",
                            { text: "mc-hack-proxy", clickEvent: {
                                action: "open_url", value: "https://gitlab.com/janispritzkau/mc-hack-proxy"
                            }, color: "white" }
                        ],
                        color: "gray"
                    })
                    break
                }
                case "fly": {
                    flyingEnabled = !flyingEnabled
                    updateAbilitiesSpeed()
                    sendChat({ text: "Flying is " + (flyingEnabled ? "enabled" : "disabled"), color: "gray" })
                    break
                }
                case "nofall": {
                    noFall = !noFall
                    sendChat({ text: "No fall damage " + (noFall ? "enabled" : "disabled"), color: "gray" })
                    break
                }
                case "speed": {
                    speed = parseFloat(args[0])
                    updateAbilitiesSpeed()
                    sendChat({ text: "Speed is set to " + speed, color: "gray" })
                    break
                }
                case "wall": {
                    const ox = x, oy = y, oz = z, f = Math.PI / 180
                    const dx = -Math.cos(pitch * f) * Math.sin(yaw * f)
                    const dy = Math.round(-Math.sin(pitch * f))
                    const dz = Math.cos(pitch * f) * Math.cos(yaw * f)
                    let d = 0, i = 0, interval = setInterval(() => {
                        if ((i = i + 1) > 15) return clearInterval(interval)
                        teleportIds.add(12345)
                        client.send(new PacketWriter(ids.playerPosLookC)
                            .writeDouble(ox + dx * d).writeDouble(oy + dy * d).writeDouble(oz + dz * d)
                            .writeFloat(0).writeFloat(0).writeUInt8(0b11000).writeVarInt(12345))
                        d += 0.2
                    }, 20)
                    break
                }
                case "tp": {
                    const pos = [x, y, z]
                    const n = (args.length == 4 && parseInt(args[3])) || 1
                    const [nx, ny, nz] = args.map((v, i) => {
                        return v.startsWith("~") ? pos[i] + (parseFloat(v.slice(1)) || 0) / n : v || 0
                    })
                    const dx = nx - x, dy = ny - y, dz = nz - z
                    ;(async () => {
                        for (let i = 1; i <= n; i++) {
                    teleportIds.add(12345)
                    client.send(new PacketWriter(ids.playerPosLookC)
                                .writeDouble(pos[0] + dx * i).writeDouble(pos[1] + dy * i).writeDouble(pos[2] + dz * i)
                        .writeFloat(yaw).writeFloat(pitch).writeUInt8(0).writeVarInt(12345))
                            await new Promise(res => setTimeout(res, 100))
                        }
                    })()
                    break
                }
                default: {
                    sendChat({ text: "Unknown command", color: "red" })
                }
            }
        }

        client.onPacket = packet => {
            if (client.state != State.Play) return conn.send(packet)

            if (packet.id == ids.chatMessageS) {
                const text = packet.readString()
                if (text.startsWith(".")) {
                    const args = text.slice(1).split(" ")
                    return runCommand(args[0], args.slice(1))
                }
            } else if (packet.id == ids.playerAbilitiesS) {
                flying = (packet.readUInt8() & 2) > 0
                return
            } else if (packet.id == ids.playerPosLookS || packet.id == ids.playerPosS) {
                x = packet.readDouble(), y = packet.readDouble(), z = packet.readDouble()
                if (packet.id == ids.playerPosLookS) {
                    yaw = packet.readFloat(), pitch = packet.readFloat()
                }
                if (noFall) {
                    const p = new PacketWriter(packet.id)
                    p.buffer = packet.buffer
                    p.offset = packet.offset
                    p.writeBool(true)
                    return conn.send(p)
                }
            } else if (packet.id == ids.teleportConfirm) {
                if (teleportIds.delete(packet.readVarInt())) return
            }
            conn.send(packet)
        }

        sendChat({ text: "Connected via hacked proxy.\nType .help for a list of commands.", color: "gray" })
    }).catch(console.log)
}).listen(parseInt(opts.port) || 25565, "127.0.0.1")

function getPacketIdsForProtocol(v) {
    return {
        joinGame: v < 389 ? v < 345 ? 0x23 : 0x24 : 0x25,
        teleportConfirm: 0x0,
        chatMessageS: v < 465 ? v < 345 ? v < 343 ? 0x2 : 0x1 : 0x2 : 0x3,
        chatMessageC: v < 343 ? 0xf : 0xe,
        playerAbilitiesC: v < 451 ? v < 389 ? v < 345 ? 0x2c : 0x2d : 0x2e : 0x2f,
        playerAbilitiesS: v < 465 ? v < 389 ? v < 386 ? v < 343 ? 0x13 : 0x12 : 0x15 : 0x17 : 0x19,
        entityProperties: v < 465 ?  v < 451 ? v < 440 ? v < 389 ? 0x51 : 0x52 : 0x53 : 0x54 : 0x53,
        playerPosLookC: v < 451 ? v < 389 ? v < 345 ? 0x2f : 0x31 : 0x32 : 0x33,
        playerPosS: v < 465 ? v < 389 ? v < 386 ? v < 343 ? 0xc : 0xb : 0xe : 0x10 : 0x12,
        playerPosLookS: v < 465 ? v < 389 ? v < 386 ? v < 343 ? 0xd : 0xc : 0xf : 0x11 : 0x13,
    }
}
