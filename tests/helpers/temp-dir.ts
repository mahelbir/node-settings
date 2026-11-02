import {afterEach, beforeEach} from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempDir {
    path(name: string): string;
    write(name: string, content: unknown): string;
    readText(name: string): string;
    readJson(name: string): unknown;
    list(): string[];
}

export function useTempDir(): TempDir {
    let root = "";
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "settings-test-"));
    });
    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true});
    });
    const resolve = (name: string): string => path.join(root, name);
    return {
        path: resolve,
        write(name, content) {
            const file = resolve(name);
            fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
            return file;
        },
        readText: (name) => fs.readFileSync(resolve(name), "utf-8"),
        readJson: (name) => JSON.parse(fs.readFileSync(resolve(name), "utf-8")),
        list: () => fs.readdirSync(root).sort(),
    };
}
