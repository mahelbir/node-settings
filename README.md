# node-settings

[![npm version](https://img.shields.io/npm/v/@mahelbir/settings.svg)](https://www.npmjs.com/package/@mahelbir/settings)

Lightweight JSON configuration file loader for Node.js with deep get/set support and auto-refresh capability.

## Installation

```bash
npm i @mahelbir/settings
```

## Quick Start

```javascript
import {Settings} from "@mahelbir/settings";

const config = new Settings();

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
config.set("app.version", "2.0.0");      // Deep set
config.unset("app.deprecated");          // Remove a key
config.all();                            // Flat key-value map of all settings
config.raw();                            // Raw settings object reference
config.save();                           // Write changes to file
```

### Singleton Mode (Auto-Refresh)

Keep settings in sync with the file on disk. Ideal for long-running processes where config may be updated externally.

```javascript
import {initSettings, settings, setDefaultFile} from "@mahelbir/settings";

// Set the file path first (optional; defaults to ./settings.json)
setDefaultFile("./config.json");

// Re-reads the file every 3 seconds (default: 1s)
initSettings(3);

// Access current settings anywhere
settings().get("feature.enabled");
```

### Named Registry (Multiple Files)

Manage several independent config files at once. Pass a `name` and `file` to `initSettings`, then read each by name with
`settings(name)`. Each entry refreshes on its own interval.

```javascript
import {initSettings, settings, destroySettings} from "@mahelbir/settings";

initSettings(3, "db", "./db.json");          // when name is given, file is required
initSettings(5, "features", "./features.json");

settings("db").get("host");
settings("features").get("beta.enabled");

destroySettings("db");                       // stop one entry's refresh and drop it
```

The no-name call (`initSettings(3)`) and `settings()` map to a reserved `"default"` entry, so `settings()` equals
`settings("default")`. Re-initializing a name replaces its timer; `destroySettings(name)` clears it. `settings()`
returns `null` for an unknown name.

### Static Write

Write key-value pairs to a config file without creating an instance.

```javascript
import {Settings} from "@mahelbir/settings";

Settings.put({"app.version": "2.1.0", "app.updatedAt": Date.now()}, "./config.json");
```

## API

| Method                                         | Description                                                                                                   |
|------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `new Settings(file?)`                          | Create instance, reads from file (default: `settings.json`)                                                   |
| `get(key, default?)`                           | Get value by dot-notation key                                                                                 |
| `set(key, value)`                              | Set value by dot-notation key                                                                                 |
| `unset(key)`                                   | Remove a key                                                                                                  |
| `save()`                                       | Write current state to file                                                                                   |
| `raw()`                                        | Return raw internal settings object (mutable)                                                                 |
| `all()`                                        | Return flat key-value map with dot-notation keys                                                              |
| `Settings.put(params, file?)`                  | Static: write key-value pairs to file                                                                         |
| `initSettings(intervalSeconds?, name?, file?)` | Start an auto-refreshing entry; with `name`, `file` is required, else uses `"default"` (interval default: 1s) |
| `settings(name?)`                              | Get an entry by name (default: `"default"`); `null` if absent                                                 |
| `destroySettings(name?)`                       | Stop an entry's refresh and remove it (default: `"default"`)                                                  |
| `setDefaultFile(file)`                         | Change default file path                                                                                      |

## License

The MIT License (MIT). Please see [License File](LICENSE) for more information.