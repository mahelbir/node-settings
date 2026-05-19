import {test, describe, beforeEach, afterEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {Settings, setDefaultFile, initSettings, settings} from "../src/index.js";

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
});
