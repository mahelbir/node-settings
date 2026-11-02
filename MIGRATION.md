# Migration

## v5 → v6

v6 is a rewrite in TypeScript. The settings now live in a store, so the same API works on a file or on
anything you write a store for. Behavior that is not listed here did not change.

### 1. The constructor takes a store

```javascript
const config = new Settings("./config.json");                                      // v5
const config = new Settings({store: new FileSettingsStore("./config.json")});      // v6
```

The store is read on the first call, not in the constructor.

### 2. Every method returns a promise

Add `await` to every call except `startPolling` and `stopPolling`:

```javascript
config.set("app.version", "2.0.0");          // v5
await config.set("app.version", "2.0.0");    // v6
```

### 3. Renamed methods

| v5               | v6                  | Change                                                                                   |
|------------------|---------------------|------------------------------------------------------------------------------------------|
| `raw()`          | `getRaw()`          | rename only                                                                              |
| `all()`          | `getFlat()`         | rename only                                                                              |
| `version()`      | `getVersion()`      | rename only                                                                              |
| `fileChecksum()` | `getStoreVersion()` | hashes the stored data instead of the file bytes                                         |

`getStoreVersion()` hashes the data the way `getVersion()` hashes memory, so it ignores key order and
formatting and matches `getVersion()` while memory and store hold the same data. It returns `null`
only when the store holds no data, and rejects when the data is not valid JSON or not a plain object.

### 4. `reload()` rejects instead of returning `false`

```javascript
if (!config.reload()) { /* failed */ }        // v5
await config.reload();                        // v6: rejects on failure, keeps the last good data
```

Polling passes reload failures to the new `onError` option, which defaults to `console.error`. Pass
`null` or `false` to silence it.

### 5. Missing, empty and broken data

| Situation                                  | v5                                  | v6                                   |
|--------------------------------------------|-------------------------------------|--------------------------------------|
| Missing file at first load                 | empty settings, error logged        | empty settings, nothing logged       |
| Empty file at first load                   | treated as invalid JSON             | treated as no data: empty settings   |
| Invalid JSON at first load                 | empty settings, error logged        | the first call rejects               |
| Array, number or `null` root at first load | loaded as it is                     | the first call rejects               |
| File missing or empty on a later reload    | reload fails, last good data kept   | same, and `reload()` rejects         |
| Invalid JSON on a later reload             | reload fails, last good data kept   | same, and `reload()` rejects         |

An instance that has never loaded stored data reloads a missing or empty file quietly, so polling
before the file exists logs nothing. `save`, `put` and `patch` now write into an empty file instead of
refusing it.

### 6. `startPolling` checks its interval

An interval that is not a positive number, or that is too large for a timer (above 2,147,483
seconds), throws a `RangeError`.

## New in v6

| Feature                   | Description                                                                          |
|---------------------------|--------------------------------------------------------------------------------------|
| `FileSettingsStore`       | The v5 file behavior: atomic writes, cross-process lock, refuses to overwrite a broken file |
| `SettingsStore` type      | Write a store for a database or another service                                       |
| `schema` option           | Validate with any Standard Schema; defaults filled in, paths typed                    |
| `SettingsValidationError` | Rejected when data does not match the schema; carries the `issues`                    |
| `onError` option          | Receives polling failures                                                              |
| Typed paths               | `get`, `set`, `merge`, `put` and `patch` are typed from the schema or a type argument |

## v4 → v5

These behaviors changed. Everything else keeps working untouched.

### 1. `unset` is now `delete`

```javascript
config.unset("app.deprecated");    // v4
config.delete("app.deprecated");   // v5
```

A plain rename — same behavior, same dot-notation paths.

### 2. Unsafe key segments throw

`set`, `merge`, `delete`, `put` and `patch` now throw a `TypeError` when any segment of a key is
`__proto__`, `constructor` or `prototype`, in dot, bracket or array path form. This closes a
prototype pollution hole: in v4, `put({"constructor.prototype.pwned": true})` silently altered
`Object.prototype` for the whole process.

```javascript
config.set("constructor.prototype.x", 1);   // v5: TypeError
config.set("constructorName", "ok");        // fine — only whole segments are rejected
```

Nothing is written when a key is rejected. If a legitimate config really uses one of those three
words as a whole key, there is no escape hatch — rename the key.

### 3. `reload()` really re-reads

An unsaved change made with `set`, `merge`, `delete` or `clear` is now discarded by the next
`reload()` or poll tick; v4 silently kept it and skipped the read.

### `put` did not change — but its docs did

The v4 README claimed `put` merges into the existing content. **It never did.** The code assigned the
value at each path, so an object value replaced the whole subtree:

```javascript
// config.json = {"job": {"count": 1, "status": true}}
config.put({job: {count: 9}});
// v4 and v5 alike: {"job": {"count": 9}}   <- status is gone
```

v5 documents `put` honestly as **replace**, and adds `patch` for the merge the old docs promised:

```javascript
config.patch({job: {count: 9}});
// {"job": {"count": 9, "status": true}}
```

**Switch to `patch` if** you pass a plain object to `put` and expect the other keys under that path
to survive. Every other use of `put` is unaffected:

| Call | Action needed |
|---|---|
| `put({"app.version": "2.0"})` — dot-path to a leaf | none |
| `put({list: [1, 2]})` — array value | none |
| `put({count: 5})` — primitive value | none |
| `put({app: {…}})` — plain object value | **check it** |

### New in v5

| Method | Description |
|---|---|
| `has(key)` | Whether the key exists; a stored `undefined` counts as present |
| `clear()` | Empty the in-memory settings |
| `merge(key, value)` | Deep-merge into the in-memory value at `key` |
| `patch(params)` | Deep-merge into the file, atomically |

`merge` is to `set` what `patch` is to `put`: same target, merge instead of replace.
