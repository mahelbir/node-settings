# NODE-SETTINGS

A lightweight JSON configuration file loader for Node.js with deep get/set support and auto-refresh capability.

## Installation

```bash
npm install @mahelbir/settings
```

## Quick Start

```javascript
import { Settings } from "@mahelbir/settings";

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
import { Settings } from "@mahelbir/settings";

const config = new Settings("./config.json");

config.get("app.name");                  // Deep get
config.get("app.debug", false);          // With default value
config.set("app.version", "2.0.0");      // Deep set
config.unset("app.deprecated");          // Remove a key
config.all();                            // Flat key-value map of all settings
config.memory();                         // Raw settings object reference
config.save();                           // Write changes to file
```

### Singleton Mode (Auto-Refresh)

Keep settings in sync with the file on disk. Ideal for long-running processes where config may be updated externally.

```javascript
import settings, { initSettings } from "@mahelbir/settings";

// Re-reads the file every 10 seconds (default)
initSettings(10, "./config.json");

// Access current settings anywhere
settings().get("feature.enabled");
```

### Static Write

Write key-value pairs to a config file without creating an instance.

```javascript
import { Settings } from "@mahelbir/settings";

Settings.put({ "app.version": "2.1.0", "app.updatedAt": Date.now() }, "./config.json");
```

## API

| Method                          | Description                                                 |
|---------------------------------|-------------------------------------------------------------|
| `new Settings(file?)`           | Create instance, reads from file (default: `settings.json`) |
| `get(key, default?)`            | Get value by dot-notation key                               |
| `set(key, value)`               | Set value by dot-notation key                               |
| `unset(key)`                    | Remove a key                                                |
| `save()`                        | Write current state to file                                 |
| `memory()`                      | Return raw internal settings object (mutable)               |
| `all()`                         | Return flat key-value map with dot-notation keys            |
| `Settings.put(params, file?)`   | Static: write key-value pairs to file                       |
| `initSettings(seconds?, file?)` | Start auto-refreshing singleton                             |
| `settings()`                    | Get current singleton instance                              |
| `setDefaultFile(file)`          | Change default file path                                    |

## License

The MIT License (MIT). Please see [License File](LICENSE) for more information.