import {describe, test} from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

import {FileSettingsStore, Settings, type SettingsOptions} from "../src/index.ts";
import {flush, MemoryStore} from "./helpers/memory-store.ts";
import {useTempDir} from "./helpers/temp-dir.ts";

const dir = useTempDir();

function create(initial?: unknown, options: Omit<SettingsOptions, "store"> = {}): {settings: Settings; store: MemoryStore} {
    const store = new MemoryStore(initial);
    return {settings: new Settings({store, ...options}), store};
}

describe("constructor", () => {
    test("rejects missing options or a store without read and update", () => {
        const invalid = [undefined, {}, {store: null}, {store: {read: async () => ({})}}, {store: {update: async () => {}}}];
        for (const options of invalid) {
            assert.throws(() => new Settings(options as never), TypeError);
        }
    });

    test("does not touch the store until first used", () => {
        const {store} = create({a: 1});
        assert.equal(store.readCount, 0);
    });
});

describe("loading", () => {
    test("loads the store data on first use", async () => {
        const {settings, store} = create({a: 1});
        assert.equal(await settings.get("a"), 1);
        assert.equal(store.readCount, 1);
    });

    test("starts empty when the store holds no data", async () => {
        const {settings} = create();
        assert.deepEqual(await settings.getRaw(), {});
    });

    test("rejects when the stored data cannot be parsed, then retries on the next call", async () => {
        const {settings, store} = create();
        store.writeRaw("{broken");
        await assert.rejects(settings.get("a"), SyntaxError);
        store.replace({a: 1});
        assert.equal(await settings.get("a"), 1);
    });

    test("rejects when the stored data is not a plain object", async () => {
        for (const value of [null, [1, 2], 42, "text"]) {
            const {settings} = create(value);
            await assert.rejects(settings.get("a"), TypeError);
        }
    });

    test("reads the store once for concurrent first calls", async () => {
        const {settings, store} = create({a: 1});
        await Promise.all([settings.get("a"), settings.has("a"), settings.getRaw()]);
        assert.equal(store.readCount, 1);
    });
});

describe("get and has", () => {
    test("get returns a deep value by dot path", async () => {
        const {settings} = create({example: {a: {b: "Example"}}});
        assert.equal(await settings.get("example.a.b"), "Example");
    });

    test("get returns an array element by bracket path", async () => {
        const {settings} = create({items: ["first", "second"]});
        assert.equal(await settings.get("items[1]"), "second");
    });

    test("get returns the default value when the key is missing", async () => {
        const {settings} = create({});
        assert.equal(await settings.get("missing.key", "fallback"), "fallback");
    });

    test("has reports whether a deep key exists", async () => {
        const {settings} = create({a: {b: 1}, list: [1]});
        assert.equal(await settings.has("a.b"), true);
        assert.equal(await settings.has("list[0]"), true);
        assert.equal(await settings.has("a.c"), false);
        assert.equal(await settings.has("missing.deep.key"), false);
    });

    test("getRaw returns the underlying object by reference", async () => {
        const {settings} = create({hello: "world"});
        const raw = await settings.getRaw();
        raw.added = true;
        assert.equal(await settings.get("added"), true);
    });
});

describe("in-memory changes", () => {
    test("set then get round-trips a value at a deep path", async () => {
        const {settings} = create({});
        await settings.set("a.b.c", 42);
        assert.equal(await settings.get("a.b.c"), 42);
    });

    test("set loads the store first and keeps its data", async () => {
        const {settings} = create({a: 1});
        await settings.set("b", 2);
        assert.deepEqual(await settings.getRaw(), {a: 1, b: 2});
    });

    test("set replaces the whole subtree", async () => {
        const {settings} = create({group: {a: 0, b: 2}});
        await settings.set("group", {a: 1});
        assert.deepEqual(await settings.getRaw(), {group: {a: 1}});
    });

    test("has counts a stored undefined as present", async () => {
        const {settings} = create({});
        await settings.set("blank", undefined);
        assert.equal(await settings.has("blank"), true);
        assert.equal(await settings.get("blank"), undefined);
        assert.equal(await settings.has("absent"), false);
    });

    test("delete removes a key", async () => {
        const {settings} = create({gone: 1, kept: 2});
        await settings.delete("gone");
        assert.equal(await settings.has("gone"), false);
        assert.deepEqual(await settings.getRaw(), {kept: 2});
    });

    test("clear empties the settings", async () => {
        const {settings} = create({a: {b: 1}, c: 2});
        await settings.clear();
        assert.deepEqual(await settings.getRaw(), {});
    });

    test("in-memory changes never reach the store", async () => {
        const {settings, store} = create({a: 1, group: {x: 1}});
        await settings.set("b", 2);
        await settings.merge("group", {y: 2});
        await settings.delete("a");
        await settings.clear();
        assert.deepEqual(store.peek(), {a: 1, group: {x: 1}});
        assert.equal(store.updateCount, 0);
    });

    test("set keeps a reference to the caller's value", async () => {
        const {settings} = create({});
        const list = [1, 2];
        await settings.set("list", list);
        list.push(999);
        assert.deepEqual(await settings.get("list"), [1, 2, 999]);
    });
});

describe("getFlat", () => {
    test("flattens nested objects into dot-path keys", async () => {
        const {settings} = create({a: {b: 1, c: {d: 2}}});
        assert.deepEqual(await settings.getFlat(), {"a.b": 1, "a.c.d": 2});
    });

    test("keeps arrays, empty objects and dotted keys as leaves", async () => {
        const {settings} = create({tags: ["x", "y"], x: {}, outer: {"a.b": 1}});
        assert.deepEqual(await settings.getFlat(), {"tags": ["x", "y"], "x": {}, "outer.a.b": 1});
    });

    test("keeps a literal __proto__ key as an own entry", async () => {
        const {settings} = create(JSON.parse('{"__proto__": [1], "z": 2}'));
        const flat = await settings.getFlat();
        assert.equal(Object.getPrototypeOf(flat), Object.prototype);
        assert.deepEqual(Object.entries(flat), [["__proto__", [1]], ["z", 2]]);
    });
});

describe("merge", () => {
    test("merges a plain object into the existing subtree", async () => {
        const {settings} = create({group: {a: 0, b: 2}});
        await settings.merge("group", {a: 1});
        assert.deepEqual(await settings.getRaw(), {group: {a: 1, b: 2}});
    });

    test("merges at a dot path", async () => {
        const {settings} = create({group: {inner: {a: 0, b: 2}}});
        await settings.merge("group.inner", {a: 1});
        assert.deepEqual(await settings.getRaw(), {group: {inner: {a: 1, b: 2}}});
    });

    test("recurses beyond one level", async () => {
        const {settings} = create({group: {a: {c: 2}}});
        await settings.merge("group", {a: {b: 1}});
        assert.deepEqual(await settings.getRaw(), {group: {a: {b: 1, c: 2}}});
    });

    test("replaces arrays, null and primitives", async () => {
        const {settings} = create({list: [1, 2], group: {a: 1}, other: {b: 1}});
        await settings.merge("list", [3]);
        await settings.merge("group", null);
        await settings.merge("other", "plain");
        assert.deepEqual(await settings.getRaw(), {list: [3], group: null, other: "plain"});
    });

    test("replaces a plain object with a class instance instead of merging into it", async () => {
        const {settings} = create({when: {a: 1}});
        await settings.merge("when", new Date("2020-01-02T03:04:05.000Z"));
        assert.equal((await settings.get("when") as Date).toISOString(), "2020-01-02T03:04:05.000Z");
    });

    test("creates a missing target as it is", async () => {
        const {settings} = create({other: 1});
        await settings.merge("group.a", {b: 1});
        assert.deepEqual(await settings.getRaw(), {other: 1, group: {a: {b: 1}}});
    });

    test("does not alias the caller's object, array or class instance", async () => {
        const {settings} = create({});
        const value = {nested: {x: 1}, list: [1, 2]};
        const when = new Date("2020-01-02T03:04:05.000Z");
        await settings.merge("group", value);
        await settings.merge("when", when);
        value.nested.x = 999;
        value.list.push(999);
        when.setFullYear(1999);
        assert.deepEqual(await settings.get("group"), {nested: {x: 1}, list: [1, 2]});
        assert.equal((await settings.get("when") as Date).toISOString(), "2020-01-02T03:04:05.000Z");
    });

    test("rejects a circular value with a TypeError", async () => {
        const {settings} = create({});
        const value: Record<string, unknown> = {};
        value.self = value;
        await assert.rejects(settings.merge("x", value), TypeError);
    });

    test("accepts a value shared twice without a cycle", async () => {
        const {settings} = create({});
        const shared = {n: 1};
        await settings.merge("group", {a: shared, b: shared});
        assert.deepEqual(await settings.get("group"), {a: {n: 1}, b: {n: 1}});
    });
});

describe("reload", () => {
    test("picks up a change made in the store", async () => {
        const {settings, store} = create({key: "v1"});
        assert.equal(await settings.get("key"), "v1");
        store.replace({key: "v2"});
        await settings.reload();
        assert.equal(await settings.get("key"), "v2");
    });

    test("rejects and keeps the last good data when the store data cannot be parsed", async () => {
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        store.writeRaw("{broken");
        await assert.rejects(settings.reload(), SyntaxError);
        assert.equal(await settings.get("key"), "v1");
    });

    test("rejects and keeps the last good data when the store data is not a plain object", async () => {
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        store.replace([1, 2]);
        await assert.rejects(settings.reload(), TypeError);
        assert.equal(await settings.get("key"), "v1");
    });

    test("rejects and keeps the last good data when the loaded data disappears from the store", async () => {
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        store.replace(undefined);
        await assert.rejects(settings.reload(), /no data/);
        assert.equal(await settings.get("key"), "v1");
        store.replace({key: "v2"});
        await settings.reload();
        assert.equal(await settings.get("key"), "v2");
    });

    test("rejects when saved data disappears from a store that started empty", async () => {
        const {settings, store} = create();
        await settings.set("key", "v1");
        await settings.save();
        store.replace(undefined);
        await assert.rejects(settings.reload(), /no data/);
        assert.equal(await settings.get("key"), "v1");
    });

    test("stays empty without an error while a store that never held data stays empty", async () => {
        const {settings, store} = create();
        await settings.getRaw();
        await settings.reload();
        assert.deepEqual(await settings.getRaw(), {});
        store.replace({key: "v1"});
        await settings.reload();
        assert.equal(await settings.get("key"), "v1");
    });

    test("keeps the loaded object when the store data is unchanged", async () => {
        const {settings} = create({a: 1});
        const before = await settings.getRaw();
        await settings.reload();
        assert.equal(await settings.getRaw(), before);
    });

    test("keeps the loaded object when only the key order in the store changes", async () => {
        const {settings, store} = create({x: 1, y: {a: 1, b: 2}});
        const before = await settings.getRaw();
        store.replace({y: {b: 2, a: 1}, x: 1});
        await settings.reload();
        assert.equal(await settings.getRaw(), before);
    });

    test("applies a change made during a reload after that reload", async () => {
        const {settings, store} = create({a: 1});
        await settings.get("a");
        const release = store.holdReads();
        const reloading = settings.reload();
        await flush();
        const setting = settings.set("b", 2);
        store.replace({a: 2});
        release();
        await Promise.all([reloading, setting]);
        assert.deepEqual(await settings.getRaw(), {a: 2, b: 2});
    });

    test("discards unsaved in-memory changes", async () => {
        const changes: [string, (settings: Settings) => Promise<void>][] = [
            ["set", (s) => s.set("a", 999)],
            ["merge", (s) => s.merge("group", {b: 2})],
            ["delete", (s) => s.delete("a")],
            ["clear", (s) => s.clear()],
        ];
        for (const [name, change] of changes) {
            const {settings} = create({a: 1, group: {a: 1}});
            await change(settings);
            await settings.reload();
            assert.deepEqual(await settings.getRaw(), {a: 1, group: {a: 1}}, name);
        }
    });
});

describe("save", () => {
    test("writes the in-memory data to the store", async () => {
        const {settings, store} = create({a: 1});
        await settings.set("b", 2);
        await settings.save();
        assert.deepEqual(store.peek(), {a: 1, b: 2});
    });

    test("loads before writing on an instance that has not been used yet", async () => {
        const {settings, store} = create({a: 1});
        await settings.save();
        assert.deepEqual(store.peek(), {a: 1});
    });

    test("writes into a store that holds no data", async () => {
        const {settings, store} = create();
        await settings.set("a", 1);
        await settings.save();
        assert.deepEqual(store.peek(), {a: 1});
    });

    test("rejects and leaves the store untouched when its data is not a plain object", async () => {
        const {settings, store} = create({a: 1});
        await settings.get("a");
        store.replace([1, 2]);
        await assert.rejects(settings.save(), TypeError);
        assert.deepEqual(store.peek(), [1, 2]);
    });

    test("rejects and leaves the store untouched when its data cannot be parsed", async () => {
        const {settings, store} = create({a: 1});
        await settings.get("a");
        store.writeRaw("{broken");
        await assert.rejects(settings.save(), SyntaxError);
        assert.equal(store.peekRaw(), "{broken");
    });

    test("a reload right after save keeps the saved object", async () => {
        const {settings} = create({a: 1});
        await settings.set("b", 2);
        await settings.save();
        const before = await settings.getRaw();
        await settings.reload();
        assert.equal(await settings.getRaw(), before);
    });

    test("another instance on the same store reads what was saved", async () => {
        const {settings, store} = create({a: 1});
        await settings.set("b", 2);
        await settings.save();
        assert.deepEqual(await new Settings({store}).getRaw(), {a: 1, b: 2});
    });
});

describe("put and patch", () => {
    test("put assigns each key in the current store data", async () => {
        const {settings, store} = create({existing: 1, group: {a: 0, b: 2}});
        await settings.put({"foo": "bar", "nested.key": 42, "group": {a: 1}});
        assert.deepEqual(store.peek(), {existing: 1, foo: "bar", nested: {key: 42}, group: {a: 1}});
    });

    test("patch merges plain objects and replaces everything else", async () => {
        const {settings, store} = create({group: {a: {c: 2}, b: 2}, inner: {x: {a: 0, b: 2}}, list: [1, 2], other: {b: 1}, when: {a: 1}});
        await settings.patch({
            "group": {a: {b: 1}},
            "inner.x": {a: 1},
            "list": [3],
            "other": null,
            "when": new Date("2020-01-02T03:04:05.000Z"),
            "fresh": {a: {b: 1}},
        });
        assert.deepEqual(store.peek(), {
            group: {a: {b: 1, c: 2}, b: 2},
            inner: {x: {a: 1, b: 2}},
            list: [3],
            other: null,
            when: "2020-01-02T03:04:05.000Z",
            fresh: {a: {b: 1}},
        });
    });

    test("read the store fresh and ignore unsaved in-memory changes", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings, store} = create({a: 1});
            await settings.set("b", 2);
            await settings[write]({c: 3});
            assert.deepEqual(store.peek(), {a: 1, c: 3}, write);
        }
    });

    test("write into a store that holds no data", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings, store} = create();
            await settings[write]({foo: {bar: 1}});
            assert.deepEqual(store.peek(), {foo: {bar: 1}}, write);
        }
    });

    test("ignore inherited keys of the params", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings, store} = create({});
            const params = Object.create({inherited: "nope"});
            params.own = "yes";
            await settings[write](params);
            assert.deepEqual(store.peek(), {own: "yes"}, write);
        }
    });

    test("leave the in-memory data alone until the next reload", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings} = create({a: 1});
            const before = await settings.getRaw();
            await settings[write]({b: {c: 2}});
            assert.equal(await settings.getRaw(), before, write);
            assert.deepEqual(before, {a: 1}, write);
            await settings.reload();
            assert.deepEqual(await settings.getRaw(), {a: 1, b: {c: 2}}, write);
        }
    });

    test("patch neither aliases nor mutates the caller's params", async () => {
        const {settings, store} = create({group: {a: 0, b: 2}});
        const params = {group: {a: 1}};
        await settings.patch(params);
        assert.deepEqual(params, {group: {a: 1}});
        params.group.a = 999;
        assert.deepEqual(store.peek(), {group: {a: 1, b: 2}});
    });

    test("reject and leave the store untouched when its data is not a plain object", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings, store} = create([1, 2]);
            await assert.rejects(settings[write]({b: 2}), TypeError, write);
            assert.deepEqual(store.peek(), [1, 2], write);
        }
    });

    test("reject and leave the store untouched when its data cannot be parsed", async () => {
        for (const write of ["put", "patch"] as const) {
            const {settings, store} = create();
            store.writeRaw("{broken");
            await assert.rejects(settings[write]({b: 2}), SyntaxError, write);
            assert.equal(store.peekRaw(), "{broken", write);
        }
    });
});

describe("unsafe keys in the store", () => {
    test("put and patch reject a polluting key and leave the store untouched", async () => {
        for (const write of ["put", "patch"] as const) {
            for (const key of ["__proto__.x", "constructor.prototype.x", "a.constructor.prototype.x"]) {
                const {settings, store} = create({a: 1});
                await assert.rejects(settings[write]({b: 2, [key]: 1}), TypeError, `${write} ${key}`);
                assert.deepEqual(store.peek(), {a: 1}, `${write} ${key}`);
                assert.equal(({} as Record<string, unknown>).x, undefined);
            }
        }
    });

    test("patch rejects an unsafe key nested inside a value", async () => {
        const {settings, store} = create({});
        await assert.rejects(settings.patch(JSON.parse('{"group": {"__proto__": {"x": 1}}}')), TypeError);
        assert.deepEqual(store.peek(), {});
        assert.equal(({} as Record<string, unknown>).x, undefined);
    });

    test("patch rejects a circular value with a TypeError", async () => {
        const {settings} = create({});
        const value: Record<string, unknown> = {};
        value.self = value;
        await assert.rejects(settings.patch({x: value}), TypeError);
    });

    test("put and patch accept keys that only contain an unsafe word", async () => {
        const {settings, store} = create({});
        await settings.put({myConstructor: "fine"});
        await settings.patch({deep: {__proto__x: 2}});
        assert.deepEqual(store.peek(), {myConstructor: "fine", deep: {__proto__x: 2}});
    });
});

describe("getVersion", () => {
    test("returns a sha1 hex digest for empty settings", async () => {
        const {settings} = create();
        assert.match(await settings.getVersion(), /^[0-9a-f]{40}$/);
    });

    test("depends on the data, not on key order", async () => {
        const versionOf = (data: unknown): Promise<string> => create(data).settings.getVersion();
        assert.equal(await versionOf({x: 1, y: 2}), await versionOf({y: 2, x: 1}));
        assert.equal(await versionOf({n: {x: 1, y: 2}}), await versionOf({n: {y: 2, x: 1}}));
        assert.notEqual(await versionOf({min: 1, max: 9}), await versionOf({min: 9, max: 1}));
        assert.notEqual(await versionOf({list: [1, 2, 3]}), await versionOf({list: [3, 2, 1]}));
    });

    test("changes after set and returns to the original after delete", async () => {
        const {settings} = create({a: 1});
        const initial = await settings.getVersion();
        await settings.set("b", 2);
        assert.notEqual(await settings.getVersion(), initial);
        await settings.delete("b");
        assert.equal(await settings.getVersion(), initial);
    });

    test("does not change after save or put, changes after the reload that follows put", async () => {
        const {settings} = create({a: 1});
        const before = await settings.getVersion();
        await settings.save();
        await settings.put({b: 2});
        assert.equal(await settings.getVersion(), before);
        await settings.reload();
        assert.notEqual(await settings.getVersion(), before);
    });

    test("sees values the way the store will see them", async () => {
        const {settings} = create({});
        await settings.set("d", new Date(0));
        await settings.set("gone", undefined);
        const withDate = await settings.getVersion();
        await settings.set("d", "1970-01-01T00:00:00.000Z");
        await settings.delete("gone");
        assert.equal(await settings.getVersion(), withDate);
    });

    test("rejects with a TypeError on circular data", async () => {
        const {settings} = create({});
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        await settings.set("cycle", cycle);
        await assert.rejects(settings.getVersion(), TypeError);
    });

    test("reflects direct changes made through getRaw", async () => {
        const {settings} = create({a: 1});
        const before = await settings.getVersion();
        (await settings.getRaw()).a = 2;
        assert.notEqual(await settings.getVersion(), before);
    });

    test("keeps a literal __proto__ key and treats constructor and toString as plain keys", async () => {
        const withProto = create(JSON.parse('{"__proto__": {"a": 1}, "z": 2}')).settings;
        const without = create({z: 2}).settings;
        assert.notEqual(await withProto.getVersion(), await without.getVersion());
        const a = create(JSON.parse('{"constructor": {"x": 1}, "toString": "hi"}')).settings;
        const b = create(JSON.parse('{"toString": "hi", "constructor": {"x": 1}}')).settings;
        assert.equal(await a.getVersion(), await b.getVersion());
        assert.notEqual(await a.getVersion(), await create({}).settings.getVersion());
    });
});

describe("getStoreVersion", () => {
    test("returns null when the store holds no data", async () => {
        const {settings} = create();
        assert.equal(await settings.getStoreVersion(), null);
    });

    test("equals getVersion while memory and store hold the same data", async () => {
        const {settings, store} = create({x: 1, y: 2});
        await settings.get("x");
        store.replace({y: 2, x: 1});
        assert.equal(await settings.getStoreVersion(), await settings.getVersion());
    });

    test("reflects a store change at once without touching memory", async () => {
        const {settings, store} = create({a: 1});
        await settings.get("a");
        const before = await settings.getStoreVersion();
        store.replace({a: 2});
        assert.notEqual(await settings.getStoreVersion(), before);
        assert.equal(await settings.get("a"), 1);
    });

    test("ignores in-memory changes until they are saved", async () => {
        const {settings} = create({a: 1});
        const before = await settings.getStoreVersion();
        await settings.set("b", 2);
        assert.equal(await settings.getStoreVersion(), before);
        assert.notEqual(await settings.getVersion(), before);
        await settings.save();
        assert.equal(await settings.getStoreVersion(), await settings.getVersion());
    });

    test("rejects when the store data cannot be parsed or is not a plain object", async () => {
        const {settings, store} = create();
        store.writeRaw("{broken");
        await assert.rejects(settings.getStoreVersion(), SyntaxError);
        store.replace([1]);
        await assert.rejects(settings.getStoreVersion(), TypeError);
    });
});

describe("polling", () => {
    test("reloads from the store on its interval", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        settings.startPolling(2);
        try {
            store.replace({key: "v2"});
            t.mock.timers.tick(1999);
            await flush();
            assert.equal(await settings.get("key"), "v1");
            t.mock.timers.tick(1);
            await flush();
            assert.equal(await settings.get("key"), "v2");
        } finally {
            settings.stopPolling();
        }
    });

    test("polls every second by default", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        settings.startPolling();
        try {
            store.replace({key: "v2"});
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(await settings.get("key"), "v2");
        } finally {
            settings.stopPolling();
        }
    });

    test("stopPolling halts further reloads", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        settings.startPolling(1);
        settings.stopPolling();
        store.replace({key: "v2"});
        t.mock.timers.tick(1000);
        await flush();
        assert.equal(await settings.get("key"), "v1");
    });

    test("starting again replaces the previous timer", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings, store} = create({a: 1});
        await settings.get("a");
        settings.startPolling(1);
        settings.startPolling(1);
        try {
            const before = store.readCount;
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(store.readCount, before + 1);
        } finally {
            settings.stopPolling();
        }
    });

    test("skips a tick while the previous reload is still running", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings, store} = create({a: 1});
        await settings.get("a");
        settings.startPolling(1);
        try {
            const before = store.readCount;
            const release = store.holdReads();
            t.mock.timers.tick(1000);
            await flush();
            t.mock.timers.tick(1000);
            await flush();
            release();
            await flush();
            assert.equal(store.readCount, before + 1);
        } finally {
            settings.stopPolling();
        }
    });

    test("puts the store data back after an in-memory change", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings} = create({a: 1});
        settings.startPolling(1);
        try {
            await settings.clear();
            t.mock.timers.tick(1000);
            await flush();
            assert.deepEqual(await settings.getRaw(), {a: 1});
        } finally {
            settings.stopPolling();
        }
    });

    test("passes a failed reload to onError and keeps polling", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const errors: unknown[] = [];
        const {settings, store} = create({key: "v1"}, {onError: (error) => errors.push(error)});
        await settings.get("key");
        settings.startPolling(1);
        try {
            store.writeRaw("{broken");
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(errors.length, 1);
            assert.ok(errors[0] instanceof SyntaxError);
            assert.equal(await settings.get("key"), "v1");
            store.replace({key: "v2"});
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(await settings.get("key"), "v2");
            assert.equal(errors.length, 1);
        } finally {
            settings.stopPolling();
        }
    });

    test("reports nothing while a store that never held data stays empty", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const errors: unknown[] = [];
        const {settings} = create(undefined, {onError: (error) => errors.push(error)});
        await settings.getRaw();
        settings.startPolling(1);
        try {
            t.mock.timers.tick(1000);
            await flush();
            t.mock.timers.tick(1000);
            await flush();
            assert.deepEqual(errors, []);
        } finally {
            settings.stopPolling();
        }
    });

    test("logs a failed reload to console.error by default", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const logged = t.mock.method(console, "error", () => {});
        const {settings, store} = create({key: "v1"});
        await settings.get("key");
        settings.startPolling(1);
        try {
            store.writeRaw("{broken");
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(logged.mock.callCount(), 1);
            assert.ok(logged.mock.calls[0]?.arguments.some((argument) => argument instanceof SyntaxError));
        } finally {
            settings.stopPolling();
        }
    });

    test("logs both errors to console.error when onError itself throws", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const logged = t.mock.method(console, "error", () => {});
        const handlerError = new Error("handler broke");
        const {settings, store} = create({key: "v1"}, {
            onError: () => {
                throw handlerError;
            },
        });
        await settings.get("key");
        settings.startPolling(1);
        try {
            store.writeRaw("{broken");
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(logged.mock.callCount(), 1);
            const reported = logged.mock.calls[0]?.arguments.find((argument) => argument instanceof AggregateError) as AggregateError;
            assert.ok(reported.errors[0] instanceof SyntaxError);
            assert.equal(reported.errors[1], handlerError);
        } finally {
            settings.stopPolling();
        }
    });

    test("stays silent when onError is null or false", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const logged = t.mock.method(console, "error", () => {});
        for (const onError of [null, false] as const) {
            const {settings, store} = create({key: "v1"}, {onError});
            await settings.get("key");
            settings.startPolling(1);
            try {
                store.writeRaw("{broken");
                t.mock.timers.tick(1000);
                await flush();
            } finally {
                settings.stopPolling();
            }
        }
        assert.equal(logged.mock.callCount(), 0);
    });

    test("rejects an interval that is not a positive number a timer can hold", (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const {settings} = create({});
        for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_484, "5" as never]) {
            assert.throws(() => settings.startPolling(interval), RangeError);
        }
    });
});

describe("unsafe keys in memory", () => {
    const pollutingPaths = ["__proto__.x", "constructor.prototype.x", "a.constructor.prototype.x", 'a["constructor"]["prototype"].x'];

    test("set and merge reject a polluting path and leave the prototype clean", async () => {
        const {settings} = create({});
        for (const path of pollutingPaths) {
            await assert.rejects(settings.set(path, 1), TypeError);
            await assert.rejects(settings.merge(path, 1), TypeError);
            assert.equal(({} as Record<string, unknown>).x, undefined);
        }
    });

    test("set rejects unsafe segments given as an array path", async () => {
        const {settings} = create({});
        await assert.rejects(settings.set(["constructor", "prototype", "x"], 1), TypeError);
        assert.equal(({} as Record<string, unknown>).x, undefined);
    });

    test("delete rejects a polluting path and leaves the prototype intact", async () => {
        const {settings} = create({});
        await assert.rejects(settings.delete("constructor.prototype.toString"), TypeError);
        assert.equal(typeof {}.toString, "function");
    });

    test("merge rejects an unsafe key nested inside the value", async () => {
        const {settings} = create({});
        const value = JSON.parse('{"__proto__": {"x": 1}}');
        await assert.rejects(settings.merge("group", value), TypeError);
        assert.equal(({} as Record<string, unknown>).x, undefined);
    });

    test("allows keys that only contain an unsafe word", async () => {
        const {settings} = create({});
        await settings.set("constructorName", "ok");
        await settings.merge("group", {prototypes: {first: 1}, __proto__x: 2});
        assert.deepEqual(await settings.getRaw(), {constructorName: "ok", group: {prototypes: {first: 1}, __proto__x: 2}});
    });
});

describe("with FileSettingsStore", () => {
    test("keeps the last good data while the file is truncated or briefly missing", async () => {
        const file = dir.write("s.json", {a: 1});
        const settings = new Settings({store: new FileSettingsStore(file)});
        await settings.get("a");
        fs.writeFileSync(file, "");
        await assert.rejects(settings.reload(), /no data/);
        fs.rmSync(file);
        await assert.rejects(settings.reload(), /no data/);
        assert.equal(await settings.get("a"), 1);
    });
});
