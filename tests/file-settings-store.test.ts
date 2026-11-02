import {describe, test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {delay} from "es-toolkit/promise";

import {FileSettingsStore} from "../src/index.ts";
import {useTempDir} from "./helpers/temp-dir.ts";

const dir = useTempDir();
const isRoot = process.getuid?.() === 0;

function renameError(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), {code});
}

describe("FileSettingsStore constructor", () => {
    test("rejects a missing, empty, blank or non-string path", () => {
        for (const file of [undefined, "", "   ", 123, null]) {
            assert.throws(() => new FileSettingsStore(file as never), TypeError);
        }
    });
});

describe("FileSettingsStore.read", () => {
    test("returns the parsed file content", async () => {
        const store = new FileSettingsStore(dir.write("s.json", {a: {b: 1}}));
        assert.deepEqual(await store.read(), {a: {b: 1}});
    });

    test("returns undefined when the file does not exist", async () => {
        const store = new FileSettingsStore(dir.path("absent.json"));
        assert.equal(await store.read(), undefined);
    });

    test("returns undefined for an empty or whitespace-only file", async () => {
        for (const content of ["", "  \n\t "]) {
            const store = new FileSettingsStore(dir.write("s.json", content));
            assert.equal(await store.read(), undefined);
        }
    });

    test("returns a non-object JSON root as it is", async () => {
        const cases: [string, unknown][] = [["null", null], ["[1, 2]", [1, 2]], ["42", 42]];
        for (const [content, expected] of cases) {
            const store = new FileSettingsStore(dir.write("s.json", content));
            assert.deepEqual(await store.read(), expected);
        }
    });

    test("rejects with the parse error as the cause on invalid JSON", async () => {
        const store = new FileSettingsStore(dir.write("s.json", '{"a": 1,'));
        await assert.rejects(store.read(), (e: Error) => e.cause instanceof SyntaxError);
    });

    test("rejects when the file may not be read", {skip: isRoot}, async () => {
        const file = dir.write("s.json", {a: 1});
        fs.chmodSync(file, 0o000);
        await assert.rejects(new FileSettingsStore(file).read(), (e: Error) => (e.cause as NodeJS.ErrnoException)?.code === "EACCES");
    });

    test("returns a fresh object on every call", async () => {
        const store = new FileSettingsStore(dir.write("s.json", {a: 1}));
        const first = await store.read() as Record<string, unknown>;
        first.a = 999;
        assert.deepEqual(await store.read(), {a: 1});
    });

    test("resolves a relative path against the working directory at construction", async () => {
        const file = dir.write("rel.json", {a: 1});
        const cwd = process.cwd();
        process.chdir(dir.path("."));
        try {
            const store = new FileSettingsStore("rel.json");
            process.chdir(cwd);
            assert.deepEqual(await store.read(), {a: 1});
            assert.ok(fs.existsSync(file));
        } finally {
            process.chdir(cwd);
        }
    });
});

describe("FileSettingsStore.update", () => {
    test("passes the current data to the updater and writes its result as indented JSON", async () => {
        const store = new FileSettingsStore(dir.write("s.json", {a: 1}));
        let received: unknown;
        await store.update(async (current) => {
            received = current;
            return {a: 1, b: 2};
        });
        assert.deepEqual(received, {a: 1});
        assert.equal(dir.readText("s.json"), '{\n  "a": 1,\n  "b": 2\n}');
    });

    test("passes undefined and creates the file when it does not exist", async () => {
        const store = new FileSettingsStore(dir.path("fresh.json"));
        let received: unknown = "unset";
        await store.update(async (current) => {
            received = current;
            return {a: 1};
        });
        assert.equal(received, undefined);
        assert.deepEqual(dir.readJson("fresh.json"), {a: 1});
        assert.deepEqual(dir.list(), ["fresh.json"]);
    });

    test("treats an empty file as no data", async () => {
        const store = new FileSettingsStore(dir.write("s.json", ""));
        let received: unknown = "unset";
        await store.update(async (current) => {
            received = current;
            return {a: 1};
        });
        assert.equal(received, undefined);
        assert.deepEqual(dir.readJson("s.json"), {a: 1});
    });

    test("rejects without calling the updater and leaves an invalid file untouched", async () => {
        const store = new FileSettingsStore(dir.write("s.json", '{"a": 1,'));
        let isCalled = false;
        await assert.rejects(store.update(async () => {
            isCalled = true;
            return {};
        }), (e: Error) => e.cause instanceof SyntaxError);
        assert.equal(isCalled, false);
        assert.equal(dir.readText("s.json"), '{"a": 1,');
        assert.deepEqual(dir.list(), ["s.json"]);
    });

    test("rejects and leaves the file untouched when it may not be read", {skip: isRoot}, async () => {
        const file = dir.write("s.json", {a: 1});
        fs.chmodSync(file, 0o000);
        await assert.rejects(new FileSettingsStore(file).update(async () => ({b: 2})), (e: Error) => (e.cause as NodeJS.ErrnoException)?.code === "EACCES");
        fs.chmodSync(file, 0o600);
        assert.deepEqual(dir.readJson("s.json"), {a: 1});
    });

    test("writes nothing and releases the lock when the updater throws", async () => {
        const store = new FileSettingsStore(dir.write("s.json", {a: 1}));
        await assert.rejects(store.update(async () => {
            throw new Error("rejected");
        }), /rejected/);
        assert.deepEqual(dir.readJson("s.json"), {a: 1});
        assert.deepEqual(dir.list(), ["s.json"]);
        await store.update(async () => ({a: 2}));
        assert.deepEqual(dir.readJson("s.json"), {a: 2});
    });

    test("replaces the file by rename instead of truncating it in place", async () => {
        const file = dir.write("s.json", {a: 1});
        const before = fs.statSync(file).ino;
        await new FileSettingsStore(file).update(async () => ({a: 2}));
        assert.notEqual(fs.statSync(file).ino, before);
    });

    test("preserves the file permission mode", async () => {
        const file = dir.write("s.json", {a: 1});
        fs.chmodSync(file, 0o600);
        await new FileSettingsStore(file).update(async () => ({a: 2}));
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    });

    test("creates the temporary file with the target's permission mode", async (t) => {
        const file = dir.write("s.json", {a: 1});
        fs.chmodSync(file, 0o600);
        const original = fsp.chmod;
        const modes: number[] = [];
        t.mock.method(fsp, "chmod", async (target: string, mode: number) => {
            modes.push(fs.statSync(target).mode & 0o777);
            return original(target, mode);
        });
        await new FileSettingsStore(file).update(async () => ({a: 2}));
        assert.deepEqual(modes, [0o600]);
    });

    test("writes through a symlink instead of replacing it", async () => {
        const real = dir.write("real.json", {a: 1});
        const link = dir.path("link.json");
        fs.symlinkSync(real, link);
        await new FileSettingsStore(link).update(async () => ({a: 2}));
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
        assert.deepEqual(dir.readJson("real.json"), {a: 2});
    });

    test("removes the temporary file, releases the lock and rethrows when rename fails", async (t) => {
        const store = new FileSettingsStore(dir.write("s.json", {a: 1}));
        t.mock.method(fsp, "rename", async () => {
            throw renameError("ENOSPC");
        });
        await assert.rejects(store.update(async () => ({a: 2})), {code: "ENOSPC"});
        assert.deepEqual(dir.list(), ["s.json"]);
        assert.deepEqual(dir.readJson("s.json"), {a: 1});
    });

    test("retries a rename that fails with EBUSY until it succeeds", async (t) => {
        const store = new FileSettingsStore(dir.write("s.json", {a: 1}));
        const original = fsp.rename;
        let attempts = 0;
        t.mock.method(fsp, "rename", async (from: string, to: string) => {
            attempts++;
            if (attempts < 3) {
                throw renameError("EBUSY");
            }
            return original(from, to);
        });
        await store.update(async () => ({a: 2}));
        assert.equal(attempts, 3);
        assert.deepEqual(dir.readJson("s.json"), {a: 2});
    });

    test("rejects instead of writing when the lock is lost while the updater runs", async () => {
        const file = dir.write("s.json", {a: 1});
        const store = new FileSettingsStore(file);
        await assert.rejects(store.update(async () => {
            fs.rmSync(`${file}.lock`, {recursive: true, force: true});
            await delay(2500);
            return {a: 2};
        }), {code: "ECOMPROMISED"});
        assert.deepEqual(dir.readJson("s.json"), {a: 1});
        await store.update(async () => ({a: 3}));
        assert.deepEqual(dir.readJson("s.json"), {a: 3});
    });

    test("serializes concurrent updates on the same file", async () => {
        const file = dir.write("s.json", {});
        const first = new FileSettingsStore(file);
        const second = new FileSettingsStore(file);
        await Promise.all([
            first.update(async (current) => {
                await delay(50);
                return {...current as object, a: 1};
            }),
            delay(10).then(() => second.update(async (current) => ({...current as object, b: 2}))),
        ]);
        assert.deepEqual(dir.readJson("s.json"), {a: 1, b: 2});
        assert.deepEqual(dir.list(), ["s.json"]);
    });
});
