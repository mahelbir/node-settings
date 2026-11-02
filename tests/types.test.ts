import {test} from "node:test";
import assert from "node:assert/strict";
import {z} from "zod";

import {Settings, type SettingsData, type SettingsPath, type SettingsPathValue} from "../src/index.ts";
import {MemoryStore} from "./helpers/memory-store.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

function assertType<T extends true>(): T | void {}

interface AppSettings {
    app: {name: string; port: number};
    tags: string[];
    owner?: {email: string};
}

test("a schema types every path, value and the raw data", async () => {
    const schema = z.object({
        name: z.string(),
        port: z.number().default(3000),
        flags: z.object({isBeta: z.boolean().default(false)}).default({isBeta: false}),
    });
    const settings = new Settings({store: new MemoryStore({name: "app"}), schema});

    const name = await settings.get("name");
    const isBeta = await settings.get("flags.isBeta");
    const port = await settings.get("port", 8080);
    const raw = await settings.getRaw();
    assertType<Equal<typeof name, string>>();
    assertType<Equal<typeof isBeta, boolean>>();
    assertType<Equal<typeof port, number>>();
    assertType<Equal<typeof raw, {name: string; port: number; flags: {isBeta: boolean}}>>();

    await settings.set("port", 4000);
    await settings.merge("flags", {});
    await settings.put({"flags.isBeta": true});
    await settings.patch({flags: {}});
    assert.deepEqual(await settings.getRaw(), {name: "app", port: 4000, flags: {isBeta: false}});
});

test("an explicit type argument types paths of an interface", async () => {
    const settings = new Settings<AppSettings>({store: new MemoryStore({app: {name: "a", port: 1}, tags: ["x"]})});

    const port = await settings.get("app.port");
    const tag = await settings.get("tags.0");
    const email = await settings.get("owner.email");
    const fallback = await settings.get("owner.email", "none");
    assertType<Equal<typeof port, number>>();
    assertType<Equal<typeof tag, string | undefined>>();
    assertType<Equal<typeof email, string | undefined>>();
    assertType<Equal<typeof fallback, string>>();

    await settings.set("app.port", 2);
    await settings.delete("owner");
    assert.equal(await settings.get("app.port"), 2);
    assert.equal(tag, "x");
});

test("nullable parents and record keys type their values as possibly missing", async () => {
    const schema = z.object({
        owner: z.object({email: z.string()}).nullable(),
        limits: z.record(z.string(), z.number()),
    });
    const settings = new Settings({store: new MemoryStore({owner: null, limits: {a: 1}}), schema});

    const email = await settings.get("owner.email");
    const limit = await settings.get("limits.missing");
    assertType<Equal<typeof email, string | undefined>>();
    assertType<Equal<typeof limit, number | undefined>>();
    assert.equal(email, undefined);
    assert.equal(limit, undefined);
});

test("only paths inside the type are settings paths", () => {
    type Paths = SettingsPath<AppSettings>;
    assertType<Equal<"app.port" extends Paths ? true : false, true>>();
    assertType<Equal<"tags.0" extends Paths ? true : false, true>>();
    assertType<Equal<"app.missing" extends Paths ? true : false, false>>();
    assertType<Equal<"tags.first" extends Paths ? true : false, false>>();
    assertType<Equal<SettingsPathValue<AppSettings, "app.port">, number>>();
});

test("without a schema any path is accepted and values are unknown", async () => {
    const settings = new Settings({store: new MemoryStore({a: {b: 1}})});

    const value = await settings.get("a.b");
    const raw = await settings.getRaw();
    assertType<Equal<typeof value, unknown>>();
    assertType<Equal<typeof raw, SettingsData>>();

    await settings.set("any.deep.path", 1);
    await settings.set(["array", "path"], 2);
    assert.equal(value, 1);
});
