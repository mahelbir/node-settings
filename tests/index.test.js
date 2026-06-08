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

    test("save persists current state as minified JSON", () => {
        const fp = fixture("s.json", {});
        const s = new Settings(fp);
        s.set("persist", "yes");
        s.save();
        const raw = fs.readFileSync(fp, "utf-8");
        assert.equal(raw, '{"persist":"yes"}');
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
