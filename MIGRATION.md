# Migration

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

## `put` did not change — but its docs did

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

## New in v5

| Method | Description |
|---|---|
| `has(key)` | Whether the key exists; a stored `undefined` counts as present |
| `clear()` | Empty the in-memory settings |
| `merge(key, value)` | Deep-merge into the in-memory value at `key` |
| `patch(params)` | Deep-merge into the file, atomically |

`merge` is to `set` what `patch` is to `put`: same target, merge instead of replace.
