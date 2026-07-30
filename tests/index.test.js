import {test, describe, beforeEach, afterEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {Settings} from "../src/index.js";

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
});

function fixture(name, data) {
    const fp = path.join(tmpDir, name);
    fs.writeFileSync(fp, JSON.stringify(data));
    return fp;
}

function suppressConsole(t, method) {
    t.mock.method(console, method, () => {});
}

describe("constructor", () => {
    test("throws TypeError when file is omitted", () => {
        assert.throws(() => new Settings(), {name: "TypeError", message: /non-empty string/});
    });

    test("throws TypeError for empty, blank or non-string file", () => {
        assert.throws(() => new Settings(""), TypeError);
        assert.throws(() => new Settings("   "), TypeError);
        assert.throws(() => new Settings(123), TypeError);
        assert.throws(() => new Settings(null), TypeError);
    });

    test("returns empty object when the file is missing", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "absent.json");
        const s = new Settings(fp);
        assert.deepEqual(s.raw(), {});
    });
});

describe("Settings instance", () => {
    test("get returns a deep nested value via dot-notation", () => {
        const fp = fixture("s.json", {example: {a: {b: "Example"}}});
        const s = new Settings(fp);
        assert.equal(s.get("example.a.b"), "Example");
    });

    test("get returns array element via bracket-notation", () => {
        const fp = fixture("s.json", {items: ["first", "second"]});
        const s = new Settings(fp);
        assert.equal(s.get("items[1]"), "second");
    });

    test("get returns defaultValue when key is missing", () => {
        const fp = fixture("s.json", {});
        const s = new Settings(fp);
        assert.equal(s.get("missing.key", "fallback"), "fallback");
    });

    test("set then get round-trips an arbitrary value", () => {
        const fp = fixture("s.json", {});
        const s = new Settings(fp);
        s.set("a.b.c", 42);
        assert.equal(s.get("a.b.c"), 42);
    });

    test("unset removes a previously stored key", () => {
        const fp = fixture("s.json", {removeme: 1});
        const s = new Settings(fp);
        s.unset("removeme");
        assert.equal(s.get("removeme"), undefined);
    });

    test("save persists current state as indented JSON", () => {
        const fp = fixture("s.json", {});
        const s = new Settings(fp);
        s.set("persist", "yes");
        s.save();
        const raw = fs.readFileSync(fp, "utf-8");
        assert.equal(raw, '{\n  "persist": "yes"\n}');
    });

    test("raw returns the underlying object by reference", () => {
        const fp = fixture("s.json", {hello: "world"});
        const s = new Settings(fp);
        const ref = s.raw();
        ref.added = true;
        assert.equal(s.get("added"), true);
    });

    test("all flattens nested objects into dot-notation keys", () => {
        const fp = fixture("s.json", {a: {b: 1, c: {d: 2}}});
        const s = new Settings(fp);
        const flat = s.all();
        assert.equal(flat["a.b"], 1);
        assert.equal(flat["a.c.d"], 2);
    });

    test("all preserves arrays without flattening their elements", () => {
        const fp = fixture("s.json", {tags: ["x", "y"]});
        const s = new Settings(fp);
        const flat = s.all();
        assert.deepEqual(flat.tags, ["x", "y"]);
    });

    test("all keeps dotted keys intact inside nested objects", () => {
        const fp = fixture("s.json", {outer: {"a.b": 1}});
        const s = new Settings(fp);
        assert.equal(s.all()["outer.a.b"], 1);
    });

    test("all preserves empty nested objects as leaves", () => {
        const fp = fixture("s.json", {x: {}, y: {z: 5}});
        const s = new Settings(fp);
        const flat = s.all();
        assert.deepEqual(flat.x, {});
        assert.equal(flat["y.z"], 5);
    });
});

describe("reload", () => {
    test("picks up external changes and returns true on success", () => {
        const fp = fixture("r.json", {key: "v1"});
        const s = new Settings(fp);
        assert.equal(s.get("key"), "v1");
        fs.writeFileSync(fp, JSON.stringify({key: "v2"}));
        assert.equal(s.reload(), true);
        assert.equal(s.get("key"), "v2");
    });

    test("keeps last good data and returns false when the file becomes unreadable", (t) => {
        suppressConsole(t, "error");
        const fp = fixture("r.json", {key: "v1"});
        const s = new Settings(fp);
        fs.writeFileSync(fp, "{not valid json");
        assert.equal(s.reload(), false);
        assert.equal(s.get("key"), "v1");
    });
});

describe("polling", () => {
    test("startPolling refreshes from the file on its interval", (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const fp = fixture("p.json", {key: "v1"});
        const s = new Settings(fp);
        s.startPolling(1);
        try {
            assert.equal(s.get("key"), "v1");
            fs.writeFileSync(fp, JSON.stringify({key: "v2"}));
            t.mock.timers.tick(1000);
            assert.equal(s.get("key"), "v2");
        } finally {
            s.stopPolling();
        }
    });

    test("stopPolling halts further refreshes", (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const fp = fixture("p.json", {key: "v1"});
        const s = new Settings(fp);
        s.startPolling(1);
        s.stopPolling();
        fs.writeFileSync(fp, JSON.stringify({key: "v2"}));
        t.mock.timers.tick(1000);
        assert.equal(s.get("key"), "v1");
    });

    test("startPolling clears the previous timer when called again", (t) => {
        const fp = fixture("p.json", {});
        let nextId = 1;
        t.mock.method(globalThis, "setInterval", () => nextId++);
        const cleared = [];
        t.mock.method(globalThis, "clearInterval", (h) => cleared.push(h));
        const s = new Settings(fp);
        s.startPolling(60);          // setInterval -> 1
        const first = s._timer;
        cleared.length = 0;
        s.startPolling(60);          // must clear the previous timer (1) before setting a new one
        assert.deepEqual(cleared, [first]);
    });
});

describe("put", () => {
    test("merges params into the current on-disk content", () => {
        const fp = fixture("put.json", {existing: 1});
        const s = new Settings(fp);
        s.put({foo: "bar", "nested.key": 42});
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.equal(raw.existing, 1);
        assert.equal(raw.foo, "bar");
        assert.equal(raw.nested.key, 42);
    });

    test("reads fresh from disk and ignores in-memory state", () => {
        const fp = fixture("put.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);              // in-memory only, never saved
        s.put({c: 3});
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.deepEqual(raw, {a: 1, c: 3});   // b is absent -> memory ignored
    });

    test("creates the file from scratch when it does not exist", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "put-new.json");
        new Settings(fp).put({foo: "bar"});
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.equal(raw.foo, "bar");
    });

    test("ignores inherited (prototype-chain) keys", () => {
        const fp = fixture("put-proto.json", {});
        const params = Object.create({inherited: "nope"});
        params.own = "yes";
        new Settings(fp).put(params);
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.equal(raw.own, "yes");
        assert.equal("inherited" in raw, false);
    });
});

describe("reload parse-skip", () => {
    test("does not parse again when the file is unchanged", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        const spy = t.mock.method(JSON, "parse");
        assert.equal(s.reload(), true);
        assert.equal(spy.mock.callCount(), 0);
        assert.equal(s.get("a"), 1);
    });

    test("parses and picks up new data when the file changes", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        fs.writeFileSync(fp, JSON.stringify({a: 2}));
        const spy = t.mock.method(JSON, "parse");
        assert.equal(s.reload(), true);
        assert.equal(spy.mock.callCount(), 1);
        assert.equal(s.get("a"), 2);
    });

    test("keeps last good data and returns false on invalid JSON", (t) => {
        suppressConsole(t, "error");
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        fs.writeFileSync(fp, "{ broken");
        assert.equal(s.reload(), false);
        assert.equal(s.get("a"), 1);
    });

    test("parses again on every reload while the file stays invalid", (t) => {
        suppressConsole(t, "error");
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        fs.writeFileSync(fp, "{ broken");
        assert.equal(s.reload(), false);
        const spy = t.mock.method(JSON, "parse");
        assert.equal(s.reload(), false);
        assert.equal(spy.mock.callCount(), 1);
    });

    test("keeps last good data and returns false when the file disappears", (t) => {
        suppressConsole(t, "error");
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        fs.rmSync(fp);
        assert.equal(s.reload(), false);
        assert.equal(s.get("a"), 1);
    });
});

describe("write checksum", () => {
    test("reload after save does not parse", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        const spy = t.mock.method(JSON, "parse");
        assert.equal(s.reload(), true);
        assert.equal(spy.mock.callCount(), 0);
        assert.equal(s.get("b"), 2);
    });

    test("reload after put parses and picks up the written data", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.put({b: 2});
        assert.equal(s.get("b"), undefined);
        const spy = t.mock.method(JSON, "parse");
        assert.equal(s.reload(), true);
        assert.equal(spy.mock.callCount(), 1);
        assert.equal(s.get("b"), 2);
    });

    test("put does not mutate in-memory settings", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        const before = s.raw();
        s.put({b: 2});
        assert.equal(s.raw(), before);
        assert.deepEqual(s.raw(), {a: 1});
    });

    test("save keeps the file readable by a fresh instance", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        const fresh = new Settings(fp);
        assert.deepEqual(fresh.raw(), {a: 1, b: 2});
    });
});

describe("version", () => {
    test("returns a sha1 hex string even when the file is missing", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "absent.json");
        const s = new Settings(fp);
        assert.match(s.version(), /^[0-9a-f]{40}$/);
    });

    test("two instances holding the same data report the same version", () => {
        const a = new Settings(fixture("a.json", {x: 1, y: 2}));
        const b = new Settings(fixture("b.json", {x: 1, y: 2}));
        assert.equal(a.version(), b.version());
    });

    test("is independent of key insertion order", () => {
        const a = new Settings(fixture("a.json", {}));
        const b = new Settings(fixture("b.json", {}));
        a.set("x", 1);
        a.set("y", 2);
        b.set("y", 2);
        b.set("x", 1);
        assert.equal(a.version(), b.version());
    });

    test("is independent of key order inside nested objects", () => {
        const a = new Settings(fixture("a.json", {n: {x: 1, y: 2}}));
        const b = new Settings(fixture("b.json", {n: {y: 2, x: 1}}));
        assert.equal(a.version(), b.version());
    });

    test("distinguishes swapped values", () => {
        const a = new Settings(fixture("a.json", {min: 1, max: 9}));
        const b = new Settings(fixture("b.json", {min: 9, max: 1}));
        assert.notEqual(a.version(), b.version());
    });

    test("preserves array order", () => {
        const a = new Settings(fixture("a.json", {list: [1, 2, 3]}));
        const b = new Settings(fixture("b.json", {list: [3, 2, 1]}));
        assert.notEqual(a.version(), b.version());
    });

    test("changes after set and returns to the original after unset", () => {
        const s = new Settings(fixture("s.json", {a: 1}));
        const initial = s.version();
        s.set("b", 2);
        assert.notEqual(s.version(), initial);
        s.unset("b");
        assert.equal(s.version(), initial);
    });

    test("does not change after save", () => {
        const s = new Settings(fixture("s.json", {a: 1}));
        const before = s.version();
        s.save();
        assert.equal(s.version(), before);
    });

    test("does not change after put, changes after the following reload", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        const before = s.version();
        s.put({b: 2});
        assert.equal(s.version(), before);
        assert.equal(s.reload(), true);
        assert.notEqual(s.version(), before);
    });

    test("changes after an external edit is reloaded", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        const before = s.version();
        fs.writeFileSync(fp, JSON.stringify({a: 2}));
        assert.equal(s.reload(), true);
        assert.notEqual(s.version(), before);
    });

    test("does not change when only key order in the file changes", () => {
        const fp = fixture("s.json", {x: 1, y: 2});
        const s = new Settings(fp);
        const before = s.version();
        fs.writeFileSync(fp, JSON.stringify({y: 2, x: 1}));
        assert.equal(s.reload(), true);
        assert.equal(s.version(), before);
    });

    test("sees non-JSON-native values exactly as save writes them", () => {
        const s = new Settings(fixture("s.json", {}));
        s.set("d", new Date(0));
        const withDate = s.version();
        s.set("d", "1970-01-01T00:00:00.000Z");
        assert.equal(s.version(), withDate);
    });

    test("drops keys whose value is undefined, matching save", () => {
        const a = new Settings(fixture("a.json", {}));
        const b = new Settings(fixture("b.json", {}));
        a.set("k", 1);
        a.set("gone", undefined);
        b.set("k", 1);
        assert.equal(a.version(), b.version());
    });

    test("throws TypeError on circular data, like save does", () => {
        const s = new Settings(fixture("s.json", {a: 1}));
        const cycle = {};
        cycle.self = cycle;
        s.set("cycle", cycle);
        assert.throws(() => s.version(), TypeError);
    });

    test("reflects direct mutations made through raw()", () => {
        const s = new Settings(fixture("s.json", {a: 1}));
        const before = s.version();
        s.raw().a = 2;
        assert.notEqual(s.version(), before);
    });

    test("does not swallow a literal __proto__ key", () => {
        const withProto = path.join(tmpDir, "proto.json");
        fs.writeFileSync(withProto, '{"__proto__":{"a":1},"z":2}');
        const without = path.join(tmpDir, "plain.json");
        fs.writeFileSync(without, '{"z":2}');
        assert.notEqual(new Settings(withProto).version(), new Settings(without).version());
    });

    test("treats constructor and toString as ordinary keys", () => {
        const a = path.join(tmpDir, "a.json");
        fs.writeFileSync(a, '{"constructor":{"x":1},"toString":"hi"}');
        const b = path.join(tmpDir, "b.json");
        fs.writeFileSync(b, '{"toString":"hi","constructor":{"x":1}}');
        assert.equal(new Settings(a).version(), new Settings(b).version());
        assert.notEqual(new Settings(a).version(), new Settings(fixture("c.json", {})).version());
    });
});

describe("atomic write", () => {
    test("save replaces the file by rename instead of truncating in place", () => {
        const fp = fixture("s.json", {a: 1});
        const before = fs.statSync(fp).ino;
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        assert.notEqual(fs.statSync(fp).ino, before);
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1, b: 2});
    });

    test("put replaces the file by rename instead of truncating in place", () => {
        const fp = fixture("s.json", {a: 1});
        const before = fs.statSync(fp).ino;
        new Settings(fp).put({b: 2});
        assert.notEqual(fs.statSync(fp).ino, before);
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1, b: 2});
    });

    test("preserves the file permission mode on save", () => {
        const fp = fixture("s.json", {a: 1});
        fs.chmodSync(fp, 0o600);
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        assert.equal(fs.statSync(fp).mode & 0o777, 0o600);
    });

    test("preserves the file permission mode on put", () => {
        const fp = fixture("s.json", {a: 1});
        fs.chmodSync(fp, 0o600);
        new Settings(fp).put({b: 2});
        assert.equal(fs.statSync(fp).mode & 0o777, 0o600);
    });

    test("writes through a symlink instead of replacing it", () => {
        const real = fixture("real.json", {a: 1});
        const link = path.join(tmpDir, "link.json");
        fs.symlinkSync(real, link);
        const s = new Settings(link);
        s.set("b", 2);
        s.save();
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
        assert.deepEqual(JSON.parse(fs.readFileSync(real, "utf-8")), {a: 1, b: 2});
    });

    test("leaves no temporary file behind", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        s.put({c: 3});
        assert.deepEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp")), []);
    });

    test("removes the temporary file and rethrows when rename fails", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        t.mock.method(fs, "renameSync", () => {
            throw Object.assign(new Error("boom"), {code: "ENOSPC"});
        });
        assert.throws(() => s.save(), /boom/);
        assert.deepEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp")), []);
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1});
    });

    test("leaves no lock directory behind after save and put", () => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);
        s.save();
        s.put({c: 3});
        assert.deepEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".lock")), []);
    });

    test("locks and creates the file even when it does not exist yet", () => {
        const fp = path.join(tmpDir, "fresh.json");
        new Settings(fp).put({a: 1});
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1});
        assert.deepEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".lock")), []);
    });

    test("releases the lock when the write throws", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        const mock = t.mock.method(fs, "renameSync", () => {
            throw Object.assign(new Error("boom"), {code: "ENOSPC"});
        });
        assert.throws(() => s.save(), /boom/);
        assert.deepEqual(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".lock")), []);
        mock.mock.restore();
        s.save();
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1});
    });

    test("retries a rename that fails with EBUSY and eventually succeeds", (t) => {
        const fp = fixture("s.json", {a: 1});
        const s = new Settings(fp);
        s.set("b", 2);
        const original = fs.renameSync;
        let attempts = 0;
        t.mock.method(fs, "renameSync", (from, to) => {
            attempts++;
            if (attempts < 3) {
                throw Object.assign(new Error("locked"), {code: "EBUSY"});
            }
            return original(from, to);
        });
        s.save();
        assert.equal(attempts, 3);
        assert.deepEqual(JSON.parse(fs.readFileSync(fp, "utf-8")), {a: 1, b: 2});
    });
});
