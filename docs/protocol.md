# Bridge protocol

The bridge listens only on a configured loopback address and accepts one NDJSON JSON-RPC request per connection. Every request includes the random session token written to `.mchd/token`.

```json
{"jsonrpc":"2.0","id":"uuid","token":"secret","method":"runtime.status","params":{}}
```

```json
{"jsonrpc":"2.0","id":"uuid","result":{"ready":true}}
```

Client operations are scheduled on Minecraft's client thread. Integrated-server mutations are then scheduled on the server thread. A response is emitted only after the requested operation and its synchronization barrier complete.

The stable method families are:

- `runtime.*`: status and shutdown
- `world.*`: list, create, open, and configure worlds
- `command.*`: execute integrated-server commands
- `player.*`: inspect, configure, and control the local player
- `entity.*`: query, spawn, configure, and remove entities
- `gui.*`: inspect, open, click, type, and send keys
- `screenshot.*`: capture named framebuffer images
- `wait.*`: deterministic tick and condition barriers

The protocol is intentionally independent of mappings, loaders, and Minecraft versions. Bridge adapters translate these calls into version-specific game APIs.
