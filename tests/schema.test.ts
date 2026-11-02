import {describe, test} from "node:test";
import assert from "node:assert/strict";
import type {StandardSchemaV1} from "@standard-schema/spec";
import {z} from "zod";

import {Settings, type SettingsData, SettingsValidationError} from "../src/index.ts";
import {flush, MemoryStore} from "./helpers/memory-store.ts";

const schema = z.object({
    name: z.string(),
    port: z.number().int().positive().default(3000),
    flags: z.object({isBeta: z.boolean().default(false)}).default({isBeta: false}),
});

const defaultsOnly = z.object({
    port: z.number().default(3000),
    flags: z.object({isBeta: z.boolean().default(false)}).default({isBeta: false}),
});

function create(initial?: unknown, options: {onError?: (error: unknown) => void} = {}): {settings: Settings; store: MemoryStore} {
    const store = new MemoryStore(initial);
    return {settings: new Settings<SettingsData>({store, schema, ...options}), store};
}

function counting<T extends StandardSchemaV1>(inner: T): {schema: T; calls: () => number} {
    let count = 0;
    const wrapped = {
        "~standard": {
            ...inner["~standard"],
            validate: (value: unknown) => {
                count++;
                return inner["~standard"].validate(value);
            },
        },
    } as T;
    return {schema: wrapped, calls: () => count};
}

function isValidationError(path: string): (error: unknown) => boolean {
    return (error) => error instanceof SettingsValidationError
        && error.issues.some((issue) => issue.path?.map((segment) => typeof segment === "object" ? segment.key : segment).join(".") === path);
}

describe("SettingsValidationError", () => {
    test("is an Error named after its class that carries the issues", () => {
        const issues = [{message: "Expected number", path: ["port"]}, {message: "Required"}];
        const error = new SettingsValidationError(issues);
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SettingsValidationError");
        assert.deepEqual(error.issues, issues);
        assert.match(error.message, /Expected number/);
        assert.match(error.message, /Required/);
    });
});

describe("schema option", () => {
    test("rejects a schema without a Standard Schema validate function", () => {
        const store = new MemoryStore({});
        for (const invalid of [{}, {"~standard": {}}, "schema", 42]) {
            assert.throws(() => new Settings({store, schema: invalid as never}), TypeError);
        }
    });
});

describe("loading with a schema", () => {
    test("keeps the schema output, defaults included", async () => {
        const {settings} = create({name: "app"});
        assert.deepEqual(await settings.getRaw(), {name: "app", port: 3000, flags: {isBeta: false}});
    });

    test("fills the defaults when the store holds no data", async () => {
        const store = new MemoryStore();
        const settings = new Settings({store, schema: defaultsOnly});
        assert.deepEqual(await settings.getRaw(), {port: 3000, flags: {isBeta: false}});
    });

    test("rejects the first load with the issues when the stored data does not match", async () => {
        const {settings} = create({name: "app", port: "eighty"});
        await assert.rejects(settings.get("name"), isValidationError("port"));
    });

    test("rejects the first load when required data is missing from an empty store", async () => {
        const {settings} = create();
        await assert.rejects(settings.getRaw(), isValidationError("name"));
    });

    test("reload rejects and keeps the last good data when the new data does not match", async () => {
        const {settings, store} = create({name: "app"});
        await settings.getRaw();
        store.replace({name: 42});
        await assert.rejects(settings.reload(), isValidationError("name"));
        assert.equal(await settings.get("name"), "app");
    });

    test("keeps rejecting on every reload while the stored data does not match", async () => {
        const {settings, store} = create({name: "app"});
        await settings.getRaw();
        store.replace({name: 42});
        await assert.rejects(settings.reload(), isValidationError("name"));
        await assert.rejects(settings.reload(), isValidationError("name"));
        assert.equal(await settings.get("name"), "app");
    });

    test("polling passes a validation failure to onError", async (t) => {
        t.mock.timers.enable({apis: ["setInterval"]});
        const errors: unknown[] = [];
        const {settings, store} = create({name: "app"}, {onError: (error) => errors.push(error)});
        await settings.getRaw();
        settings.startPolling(1);
        try {
            store.replace({name: 42});
            t.mock.timers.tick(1000);
            await flush();
            assert.equal(errors.length, 1);
            assert.ok(isValidationError("name")(errors[0]));
        } finally {
            settings.stopPolling();
        }
    });

    test("does not validate again when a reload finds the store unchanged", async () => {
        const {schema: tracked, calls} = counting(schema);
        const settings = new Settings({store: new MemoryStore({name: "app"}), schema: tracked});
        await settings.getRaw();
        await settings.reload();
        await settings.reload();
        assert.equal(calls(), 1);
    });

    test("supports a schema that validates asynchronously", async () => {
        const asyncSchema: StandardSchemaV1<unknown, {name: string}> = {
            "~standard": {
                version: 1,
                vendor: "test",
                validate: async (value) => {
                    await flush();
                    const name = (value as {name?: unknown}).name;
                    return typeof name === "string" ? {value: {name}} : {issues: [{message: "name must be a string", path: ["name"]}]};
                },
            },
        };
        const good = new Settings({store: new MemoryStore({name: "app", extra: 1}), schema: asyncSchema});
        assert.deepEqual(await good.getRaw(), {name: "app"});
        const bad = new Settings({store: new MemoryStore({name: 1}), schema: asyncSchema});
        await assert.rejects(bad.getRaw(), isValidationError("name"));
    });
});

describe("in-memory changes with a schema", () => {
    test("reject a change that breaks the schema and keep the data unchanged", async () => {
        const changes: [string, (settings: Settings) => Promise<void>, string][] = [
            ["set", (s) => s.set("port", "eighty"), "port"],
            ["merge", (s) => s.merge("flags", {isBeta: "yes"}), "flags.isBeta"],
            ["delete", (s) => s.delete("name"), "name"],
            ["clear", (s) => s.clear(), "name"],
        ];
        for (const [label, change, path] of changes) {
            const {settings} = create({name: "app", port: 80});
            const before = structuredClone(await settings.getRaw());
            await assert.rejects(change(settings), isValidationError(path), label);
            assert.deepEqual(await settings.getRaw(), before, label);
        }
    });

    test("keep the schema output after a valid change", async () => {
        const {settings} = create({name: "app"});
        await settings.delete("port");
        assert.deepEqual(await settings.getRaw(), {name: "app", port: 3000, flags: {isBeta: false}});
    });

    test("clear falls back to the schema defaults", async () => {
        const settings = new Settings({store: new MemoryStore({port: 80}), schema: defaultsOnly});
        await settings.clear();
        assert.deepEqual(await settings.getRaw(), {port: 3000, flags: {isBeta: false}});
    });
});

describe("writes with a schema", () => {
    test("put and patch reject a result that breaks the schema and leave the store untouched", async () => {
        const writes: [string, (settings: Settings) => Promise<void>, string][] = [
            ["put", (s) => s.put({port: -1}), "port"],
            ["patch", (s) => s.patch({flags: {isBeta: 1}}), "flags.isBeta"],
        ];
        for (const [label, write, path] of writes) {
            const {settings, store} = create({name: "app", port: 80});
            await assert.rejects(write(settings), isValidationError(path), label);
            assert.deepEqual(store.peek(), {name: "app", port: 80}, label);
        }
    });

    test("put and patch write the schema output", async () => {
        const {settings, store} = create({name: "app"});
        await settings.patch({port: 8080});
        assert.deepEqual(store.peek(), {name: "app", port: 8080, flags: {isBeta: false}});
    });

    test("save writes the schema defaults into an empty store", async () => {
        const store = new MemoryStore();
        const settings = new Settings({store, schema: defaultsOnly});
        await settings.save();
        assert.deepEqual(store.peek(), {port: 3000, flags: {isBeta: false}});
        assert.equal(await settings.getStoreVersion(), await settings.getVersion());
    });
});
