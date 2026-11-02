# node-settings

[![npm version](https://img.shields.io/npm/v/@mahelbir/settings.svg)](https://www.npmjs.com/package/@mahelbir/settings)
[![license](https://img.shields.io/npm/l/@mahelbir/settings.svg)](LICENSE)

Settings manager for Node.js with deep get/set, a pluggable store, optional schema validation and
auto-refresh.

## Installation

```bash
npm i @mahelbir/settings
```

Requires Node.js 18 or later. Ships ESM and CommonJS builds with type declarations:

```javascript
import {Settings, FileSettingsStore} from "@mahelbir/settings";           // ESM
const {Settings, FileSettingsStore} = require("@mahelbir/settings");    // CommonJS
```

## Usage

```javascript
import {Settings, FileSettingsStore} from "@mahelbir/settings";

const config = new Settings({store: new FileSettingsStore("./config.json")});

await config.get("app.name");                  // Deep get
await config.get("app.debug", false);          // With default value
await config.set("app.version", "2.0.0");      // Replace the value at a key
await config.delete("app.deprecated");         // Remove a key
await config.save();                           // Write the in-memory data to the store
```

Every method except `startPolling` and `stopPolling` returns a promise. The first call loads the
store into memory; after that, reads come from memory. `set`, `merge`, `delete` and `clear` change
only the in-memory copy, and `save` writes it to the store. The full method list is in the
[API](#api) table.

Stored data goes through JSON: a `Date` is stored as an ISO string, and a key whose value is
`undefined` is dropped.

## Stores

A store is where the settings live. `Settings` reads it to load and reload, and writes it on `save`,
`put` and `patch`.

### `FileSettingsStore`

Keeps the settings in a JSON file. The path is resolved against the working directory when the store
is created.

- A missing or empty file reads as no data, so the settings start empty. Once settings were loaded from
  the file, a reload that finds it missing or empty fails and keeps the last good data, so an editor
  rewriting the file never wipes the settings.
- Every write goes to a temporary file that is then renamed over the target, so a reader never sees a
  half-written file. The file keeps its permission mode, and a symlink stays a symlink.
- Writes take a cross-process lock on the file.
- `save`, `put` and `patch` write into a missing or empty file. A file that cannot be read, or does not
  hold a plain JSON object, is never overwritten; the write rejects and the file stays as it was.

### Custom stores

Any object with these two methods is a store. Implement the `SettingsStore` type to keep the settings
in a database or another service.

| Method            | Must                                                                                                                                                                             |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `read()`          | Resolve the stored data, a fresh copy on every call. Resolve `undefined` when nothing is stored. Reject when the data cannot be read or parsed.                                  |
| `update(updater)` | Under a lock or transaction: read the current data, `await updater(current)`, write the result. If reading fails or `updater` rejects, write nothing and reject with that error. |

`updater` may change the data it receives. `Settings` runs every check inside `updater`, so a store
validates nothing.

## Auto-refresh (polling)

Keep an instance in sync with the store in long-running processes where something else may change the
settings. Polling reloads on an interval; a failed reload keeps the last good data.

```javascript
const config = new Settings({
    store: new FileSettingsStore("./config.json"),
    onError: (error) => logger.warn(error),      // default: console.error, null or false: silent
});
config.startPolling(5);                          // reload every 5s (default: 1s)

await config.get("feature.enabled");             // the latest successful reload

config.stopPolling();                            // stop refreshing when you're done
```

A tick is skipped while the previous reload is still running. A reload that finds the store
unchanged keeps the loaded object as it is.

Share one polling instance across your app by exporting it from a module. Node's module cache makes it
a singleton:

```javascript
// config.js
import {Settings, FileSettingsStore} from "@mahelbir/settings";

const config = new Settings({store: new FileSettingsStore("./config.json")});
config.startPolling(5);
export default config;

// anywhere else
import config from "./config.js";

await config.get("feature.enabled");
```

> The polling timer keeps the process alive. Call `stopPolling()` to let the process exit.

## Write-through (`put` / `patch`)

`put` and `patch` skip the in-memory copy. They hand the change to the store's `update`, which reads
the current data, applies `params` and writes the result under the store's lock. Two processes writing
different keys this way do not overwrite each other. The change shows up in memory on the next
`reload()` or poll tick.

`save` writes the whole in-memory copy, so a change another process made since the last reload is
lost. When several processes write, use `put` and `patch`.

## Replace vs merge

```javascript
// stored: {"app": {"name": "demo", "version": "1.0"}}
await config.put({app: {version: "2.0"}});     // {"app": {"version": "2.0"}}
await config.patch({app: {version: "2.0"}});   // {"app": {"name": "demo", "version": "2.0"}}
```

| Method                     | Target        | Object value at an existing key |
|----------------------------|---------------|---------------------------------|
| `set("job", {count: 9})`   | in-memory     | **replaces** the subtree        |
| `merge("job", {count: 9})` | in-memory     | **merges** into the subtree     |
| `put({job: {count: 9}})`   | store (fresh) | **replaces** the subtree        |
| `patch({job: {count: 9}})` | store (fresh) | **merges** into the subtree     |

`merge` and `patch` deep-merge plain objects and replace everything else: arrays, `null`, primitives
and class instances. Keys can be dot paths. At a leaf there is nothing to merge, so each pair gives
the same result there. `merge` deep-clones what it stores, so changing the argument later does not
change the settings. Without a schema, `set` keeps a reference to the value you pass.

## Schema validation

Pass any [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType and others) to validate
the settings and type every path:

```javascript
import {z} from "zod";

const config = new Settings({
    store: new FileSettingsStore("./config.json"),
    schema: z.object({
        name: z.string(),
        port: z.number().default(3000),
    }),
});

const port = await config.get("port");           // typed as number
```

- Loading validates the stored data and keeps the schema output, so defaults are filled in. An empty
  store loads as the defaults.
- Stored data that does not match makes loading reject with a `SettingsValidationError`. A later
  reload fails the same way and keeps the last good data.
- `set`, `merge`, `delete`, `clear`, `save`, `put` and `patch` validate the result first. A result
  that does not match rejects with a `SettingsValidationError` and changes nothing.
- The schema output is what gets stored and validated again on the next load, so after a JSON round
  trip it must still be valid input for the same schema. Avoid transforms: a string turned into a
  number or a `Date` fails the next validation. A schema that strips unknown keys drops them from the
  store too.

`SettingsValidationError` has an `issues` array in the Standard Schema format. When both the ESM and
the CommonJS build may be loaded in one process, check `error.name === "SettingsValidationError"`;
`instanceof` only matches the build you imported.

Without a schema, pass the type yourself to get typed paths: `new Settings<AppSettings>({store})`.

## API

| Method                                     | Description                                                                                                 |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| `new Settings({store, schema?, onError?})` | Create an instance                                                                                          |
| `get(key, default?)`                       | Get value by dot-notation key                                                                               |
| `has(key)`                                 | Whether the key exists; a stored `undefined` counts as present                                              |
| `set(key, value)`                          | Replace the value at a key                                                                                  |
| `merge(key, value)`                        | Deep-merge into the value at a key                                                                          |
| `delete(key)`                              | Remove a key                                                                                                |
| `clear()`                                  | Empty all settings (or reset them to the schema defaults)                                                   |
| `save()`                                   | Write the in-memory data to the store                                                                       |
| `reload()`                                 | Read the store again now; rejects on failure and keeps the last good data                                   |
| `put(params)`                              | Replace the value at each key, straight in the store                                                        |
| `patch(params)`                            | Deep-merge into the value at each key, straight in the store                                                |
| `startPolling(intervalSeconds?)`           | Reload on an interval (default: 1s)                                                                         |
| `stopPolling()`                            | Stop reloading                                                                                              |
| `getRaw()`                                 | The internal settings object (mutable reference)                                                            |
| `getFlat()`                                | Flat key-value map with dot-notation keys                                                                   |
| `getVersion()`                             | SHA-1 of the in-memory data; ignores key order and formatting                                               |
| `getStoreVersion()`                        | SHA-1 of the data in the store right now, computed the same way; `null` when empty, rejects when unreadable |

`getVersion()` and `getStoreVersion()` are equal while memory and store hold the same data, so
comparing them tells you whether there is anything to save or reload. With a schema that fills
defaults or strips keys, they differ after a load until the next save.

## Upgrading

The [migration guide](MIGRATION.md) lists the breaking changes of each major version, with
before-and-after code.

## Support

If this project helps you, please consider giving it a [Star ⭐️](https://github.com/mahelbir/node-settings) on GitHub.
This will encourage us to continue developing and maintaining this project.
