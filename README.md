# node-settings

[![npm version](https://img.shields.io/npm/v/@mahelbir/settings.svg)](https://www.npmjs.com/package/@mahelbir/settings)

Lightweight JSON configuration file loader for Node.js (ESM & CommonJS) with deep get/set support and auto-refresh
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

## Quick Start

```javascript
import {Settings} from "@mahelbir/settings";

const config = new Settings("./config.json");

// Deep get & set with dot notation
config.get("database.host");             // "localhost"
config.set("database.port", 5432);
config.save();                           // Persist changes to file
```

## Usage

### Instance Mode

Create a `Settings` instance to read and manipulate a specific JSON file.

```javascript
import {Settings} from "@mahelbir/settings";

const config = new Settings("./config.json");

config.get("app.name");                  // Deep get
config.get("app.debug", false);          // With default value
config.set("app.version", "2.0.0");      // Deep set (in-memory)
config.unset("app.deprecated");          // Remove a key (in-memory)
config.all();                            // Flat key-value map of all settings
config.raw();                            // Raw settings object reference
config.save();                           // Write in-memory state to file
config.reload();                         // Re-read the file now
```

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

### Write-Through (`put`)

Merge key-value pairs into the file. `put` reads the **current** on-disk content fresh (ignoring the
instance's in-memory state) and merges `params` into it. A missing or unreadable/corrupt file is
treated as an empty object and overwritten — the same overwrite behavior as `save`.

```javascript
import {Settings} from "@mahelbir/settings";

new Settings("./config.json").put({"app.version": "2.1.0", "app.updatedAt": Date.now()});
```

## `save()` vs `put()`

- `save()` writes the **entire in-memory** working copy (after `set`/`unset`) to the file.
- `put(params)` reads the **current file** fresh, merges only `params`, and writes — without touching
  or reading the in-memory state. Written values
  surface in memory on the next `reload()` or poll tick.

## API

| Method                           | Description                                                                   |
|----------------------------------|-------------------------------------------------------------------------------|
| `new Settings(file)`             | Create instance and read from `file` (**required**)                           |
| `get(key, default?)`             | Get value by dot-notation key                                                 |
| `set(key, value)`                | Set value by dot-notation key (in-memory)                                     |
| `unset(key)`                     | Remove a key (in-memory)                                                      |
| `save()`                         | Write current in-memory state to file                                         |
| `reload()`                       | Re-read the file now; `true` on success, `false` on failure (keeps last good) |
| `put(params)`                    | Merge `params` into the current on-disk file (fresh read, ignores memory)     |
| `startPolling(intervalSeconds?)` | Start auto-refreshing the instance on an interval (default: 1s)               |
| `stopPolling()`                  | Stop auto-refreshing                                                          |
| `raw()`                          | Return raw internal settings object (mutable reference)                       |
| `all()`                          | Return flat key-value map with dot-notation keys                              |

## License

The MIT License (MIT). Please see [License File](LICENSE) for more information.
