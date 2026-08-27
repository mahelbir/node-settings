# node-settings

[![npm version](https://img.shields.io/npm/v/@mahelbir/settings.svg)](https://www.npmjs.com/package/@mahelbir/settings)
[![license](https://img.shields.io/npm/l/@mahelbir/settings.svg)](LICENSE)

Lightweight JSON configuration file loader with deep get/set support and auto-refresh
capability.

## Installation

```bash
npm i @mahelbir/settings
```

Ships dual **ESM** and **CommonJS** builds — import it whichever way your
project uses:

```javascript
import {Settings} from "@mahelbir/settings";           // ESM
const {Settings} = require("@mahelbir/settings");  // CommonJS
```

## Usage

### Instance Mode

Create a `Settings` instance to read and manipulate a specific JSON file.

```javascript
import {Settings} from "@mahelbir/settings";

const config = new Settings("./config.json");

config.get("app.name");                  // Deep get
config.get("app.debug", false);          // With default value
config.set("app.version", "2.0.0");      // Replace the value at a key
config.delete("app.deprecated");         // Remove a key
config.save();                           // Write in-memory state to file
```

Reads and writes hit the in-memory copy; `save()` is what reaches the file. The full method list is
in the [API](#api) table.

### Auto-Refresh (Polling)

Keep an instance in sync with the file on disk. Ideal for long-running processes where config may be
updated externally. Polling re-reads the file on an interval; a failed read keeps the last good data.

```javascript
import {Settings} from "@mahelbir/settings";

const config = new Settings("./config.json");
config.startPolling(5);                  // re-read every 5s (default: 1s)

config.get("feature.enabled");           // always reflects the latest successful read

config.stopPolling();                    // stop refreshing when you're done
```

Share a single polling instance across your app by exporting it from a module — Node's module cache
makes it a singleton (CommonJS `require` works the same):

```javascript
// config.js
import {Settings} from "@mahelbir/settings";

const config = new Settings("./config.json");
config.startPolling(5);
export default config;

// anywhere else
import config from "./config.js";

config.get("feature.enabled");
```

> The polling timer keeps the process alive. Call `stopPolling()` to let the process exit.

### Write-Through (`put` / `patch`)

`put` and `patch` skip the in-memory copy: they read the **current** on-disk content fresh, apply
`params`, and write atomically under a cross-process lock — so two processes writing different keys
don't overwrite each other. A missing or corrupt file is treated as an empty object. What they write
surfaces in memory on the next `reload()` or poll tick.

## Replace vs merge

```javascript
// config.json = {"app": {"name": "demo", "version": "1.0"}}
config.put({app: {version: "2.0"}});     // {"app": {"version": "2.0"}}
config.patch({app: {version: "2.0"}});   // {"app": {"name": "demo", "version": "2.0"}}
```

| Method                     | Target       | Object value at an existing key |
|----------------------------|--------------|---------------------------------|
| `set("job", {count: 9})`   | in-memory    | **replaces** the subtree        |
| `merge("job", {count: 9})` | in-memory    | **merges** into the subtree     |
| `put({job: {count: 9}})`   | file (fresh) | **replaces** the subtree        |
| `patch({job: {count: 9}})` | file (fresh) | **merges** into the subtree     |

`merge` and `patch` deep-merge plain objects and replace everything else — arrays, `null`, primitives
and class instances. Keys can be dot paths; at a leaf there is nothing to merge, so each pair agrees
there and they differ only on plain object values.

## API

All methods below the constructor work on the in-memory copy, except `put` and `patch`, which go
straight to the file.

| Method                           | Description                                                                   |
|----------------------------------|-------------------------------------------------------------------------------|
| `new Settings(file)`             | Create instance and read from `file` (**required**)                           |
| `get(key, default?)`             | Get value by dot-notation key                                                 |
| `has(key)`                       | Whether the key exists; a stored `undefined` counts as present                |
| `set(key, value)`                | Replace the value at a key                                                    |
| `merge(key, value)`              | Deep-merge into the value at a key                                            |
| `delete(key)`                    | Remove a key                                                                  |
| `clear()`                        | Empty all settings                                                            |
| `save()`                         | Write current in-memory state to file                                         |
| `reload()`                       | Re-read the file now; `true` on success, `false` on failure (keeps last good) |
| `put(params)`                    | Replace the value at each key, straight in the file (fresh read, atomic)      |
| `patch(params)`                  | Deep-merge into the value at each key, straight in the file (fresh read, atomic) |
| `startPolling(intervalSeconds?)` | Start auto-refreshing the instance on an interval (default: 1s)               |
| `stopPolling()`                  | Stop auto-refreshing                                                          |
| `raw()`                          | Return raw internal settings object (mutable reference)                       |
| `all()`                          | Return flat key-value map with dot-notation keys                              |
| `version()`                      | SHA-1 checksum of the current in-memory data                                  |
| `fileChecksum()`                 | SHA-1 of the file's bytes on disk right now; `null` if unreadable             |

## Upgrading

Coming from v4? See [migration guide](MIGRATION.md).

## Support

If this project helps you, please consider giving it a [Star ⭐️](https://github.com/mahelbir/node-settings) on GitHub.
This will encourage us to continue developing and maintaining this project.
