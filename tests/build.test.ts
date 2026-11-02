import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {useTempDir} from "./helpers/temp-dir.ts";

type PackageModule = typeof import("../src/index.ts");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = (file: string): string => path.join(root, "dist", file);
const isBuilt = ["index.mjs", "index.cjs", "index.d.mts", "index.d.cts"].every((file) => existsSync(dist(file)));
const skip = isBuilt ? false : "build output missing, run `npm run build` first";
const dir = useTempDir();

async function loadFormats(): Promise<[string, PackageModule][]> {
    const esm: PackageModule = await import(pathToFileURL(dist("index.mjs")).href);
    const cjs: PackageModule = createRequire(import.meta.url)(dist("index.cjs"));
    return [["esm", esm], ["cjs", cjs]];
}

function exportNames(module: object): string[] {
    return Object.keys(module).filter((key) => key !== "default").sort();
}

describe("build output", () => {
    test("ESM and CJS export the same classes", {skip}, async () => {
        const [[, esm], [, cjs]] = await loadFormats() as [[string, PackageModule], [string, PackageModule]];
        assert.deepEqual(exportNames(esm), ["FileSettingsStore", "Settings", "SettingsValidationError"]);
        assert.deepEqual(exportNames(cjs), exportNames(esm));
    });

    test("both formats change and save settings through a file", {skip}, async () => {
        for (const [format, module] of await loadFormats()) {
            const file = dir.write(`${format}.json`, {a: 1});
            const settings = new module.Settings({store: new module.FileSettingsStore(file)});
            await settings.set("b", 2);
            await settings.save();
            assert.deepEqual(dir.readJson(`${format}.json`), {a: 1, b: 2}, format);
        }
    });
});
