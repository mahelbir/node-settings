import {test, describe, beforeEach, afterEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {Settings, setDefaultFile, initSettings, settings, destroySettings} from "../src/index.js";

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

    test("constructor returns empty object when file is missing", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "absent.json");
        const s = new Settings(fp);
        assert.deepEqual(s.raw(), {});
    });
});

describe("Settings.put", () => {
    test("writes the given key-value pairs to disk", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "put.json");
        Settings.put({foo: "bar", "nested.key": 42}, fp);
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.equal(raw.foo, "bar");
        assert.equal(raw.nested.key, 42);
    });

    test("ignores inherited (prototype-chain) keys", (t) => {
        suppressConsole(t, "error");
        const fp = path.join(tmpDir, "put-proto.json");
        const params = Object.create({inherited: "nope"});
        params.own = "yes";
        Settings.put(params, fp);
        const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
        assert.equal(raw.own, "yes");
        assert.equal("inherited" in raw, false);
    });
});

describe("singleton mode", () => {
    test("setDefaultFile + initSettings exposes data via settings()", (t) => {
        suppressConsole(t, "info");
        const fp = fixture("def.json", {key: "value"});
        setDefaultFile(fp);
        const handle = initSettings(60);
        try {
            assert.equal(settings().get("key"), "value");
        } finally {
            clearInterval(handle);
        }
    });

    test("setDefaultFile rejects empty or non-string input", () => {
        assert.throws(() => setDefaultFile(""), TypeError);
        assert.throws(() => setDefaultFile("   "), TypeError);
        assert.throws(() => setDefaultFile(null), TypeError);
    });

    test("setDefaultFile throws a descriptive TypeError for non-string input", () => {
        assert.throws(() => setDefaultFile(123), {name: "TypeError", message: /non-empty string/});
        assert.throws(() => setDefaultFile({}), {name: "TypeError", message: /non-empty string/});
    });

    test("initSettings clears the previous interval when called again", (t) => {
        suppressConsole(t, "info");
        const fp = fixture("def.json", {key: "value"});
        setDefaultFile(fp);
        let nextId = 1;
        t.mock.method(globalThis, "setInterval", () => nextId++);
        const cleared = [];
        t.mock.method(globalThis, "clearInterval", (h) => cleared.push(h));
        const first = initSettings(60);
        cleared.length = 0;
        initSettings(60);
        assert.deepEqual(cleared, [first]);
    });

    test("interval refresh keeps last good data when the file becomes unreadable", (t) => {
        suppressConsole(t, "info");
        suppressConsole(t, "error");
        t.mock.timers.enable({apis: ["setInterval"]});
        const fp = fixture("def.json", {key: "value"});
        setDefaultFile(fp);
        const handle = initSettings(1);
        try {
            assert.equal(settings().get("key"), "value");
            fs.rmSync(fp);
            t.mock.timers.tick(1000);
            assert.equal(settings().get("key"), "value");
        } finally {
            clearInterval(handle);
        }
    });
});

describe("named registry", () => {
    test("named init exposes each file independently via settings(name)", (t) => {
        suppressConsole(t, "info");
        const fa = fixture("a.json", {key: "A"});
        const fb = fixture("b.json", {key: "B"});
        initSettings(60, "a", fa);
        initSettings(60, "b", fb);
        try {
            assert.equal(settings("a").get("key"), "A");
            assert.equal(settings("b").get("key"), "B");
        } finally {
            destroySettings("a");
            destroySettings("b");
        }
    });

    test("settings() targets the same entry as settings('default')", (t) => {
        suppressConsole(t, "info");
        const fp = fixture("def.json", {key: "value"});
        setDefaultFile(fp);
        initSettings(60);
        try {
            assert.notEqual(settings(), null);
            assert.equal(settings(), settings("default"));
            assert.equal(settings("default").get("key"), "value");
        } finally {
            destroySettings();
        }
    });

    test("initSettings throws when name is given without a file", () => {
        assert.throws(() => initSettings(60, "db"), {name: "TypeError", message: /file is required/});
    });

    test("initSettings throws when name is an empty string", () => {
        assert.throws(() => initSettings(60, "   "), {name: "TypeError", message: /non-empty string/});
    });

    test("settings returns null for an unknown name", () => {
        assert.equal(settings("no-such-entry"), null);
    });

    test("named entry refreshes from its own file on its interval", (t) => {
        suppressConsole(t, "info");
        suppressConsole(t, "error");
        t.mock.timers.enable({apis: ["setInterval"]});
        const fp = fixture("r.json", {key: "v1"});
        initSettings(1, "r", fp);
        try {
            assert.equal(settings("r").get("key"), "v1");
            fs.writeFileSync(fp, JSON.stringify({key: "v2"}));
            t.mock.timers.tick(1000);
            assert.equal(settings("r").get("key"), "v2");
        } finally {
            destroySettings("r");
        }
    });

    test("destroySettings stops refresh and removes the entry", (t) => {
        suppressConsole(t, "info");
        suppressConsole(t, "error");
        t.mock.timers.enable({apis: ["setInterval"]});
        const fp = fixture("d.json", {key: "v1"});
        initSettings(1, "d", fp);
        assert.equal(settings("d").get("key"), "v1");
        destroySettings("d");
        assert.equal(settings("d"), null);
        fs.writeFileSync(fp, JSON.stringify({key: "v2"}));
        t.mock.timers.tick(1000);
        assert.equal(settings("d"), null);
    });

    test("re-init of a name clears its previous interval", (t) => {
        suppressConsole(t, "info");
        const fp = fixture("ri.json", {key: "value"});
        let nextId = 100;
        t.mock.method(globalThis, "setInterval", () => nextId++);
        const cleared = [];
        t.mock.method(globalThis, "clearInterval", (h) => cleared.push(h));
        const first = initSettings(60, "ri", fp);
        cleared.length = 0;
        initSettings(60, "ri", fp);
        assert.deepEqual(cleared, [first]);
    });
});
