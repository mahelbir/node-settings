import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile, {type LockOptions} from "proper-lockfile";
import {retry} from "es-toolkit/function";

import type {SettingsStore, SettingsUpdater} from "./settings-store.ts";

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRIES = 9;
const PERMISSION_BITS = 0o7777;
const LOCK_OPTIONS: LockOptions = {
    realpath: false,
    stale: 2000,
    retries: {retries: 60, factor: 1.5, minTimeout: 10, maxTimeout: 100},
};

export class FileSettingsStore implements SettingsStore {

    readonly #file: string;

    constructor(file: string) {
        if (typeof file !== "string" || !file.trim()) {
            throw new TypeError("File must be a non-empty string path");
        }
        this.#file = path.resolve(file.trim());
    }

    async read(): Promise<unknown> {
        let content: string;
        try {
            content = await fs.readFile(this.#file, "utf-8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw new Error(`Settings file cannot be read: ${this.#file}`, {cause: e});
        }
        if (!content.trim()) {
            return undefined;
        }
        try {
            return JSON.parse(content);
        } catch (e) {
            throw new Error(`Settings file is not valid JSON: ${this.#file}`, {cause: e});
        }
    }

    async update(updater: SettingsUpdater): Promise<void> {
        let compromise: Error | undefined;
        const release = await lockfile.lock(this.#file, {
            ...LOCK_OPTIONS,
            onCompromised: (error) => {
                compromise = error;
            },
        });
        try {
            const data = await updater(await this.read());
            if (compromise) {
                throw compromise;
            }
            await writeFileAtomic(this.#file, JSON.stringify(data, null, 2));
        } finally {
            if (!compromise) {
                await release();
            }
        }
    }

}

async function writeFileAtomic(file: string, content: string): Promise<void> {
    const {target, mode} = await resolveWriteTarget(file);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        if (mode === null) {
            await fs.writeFile(temporary, content);
        } else {
            await fs.writeFile(temporary, content, {mode});
            await fs.chmod(temporary, mode);
        }
        await retry(() => fs.rename(temporary, target), {
            retries: RENAME_RETRIES,
            delay: (attempts) => (attempts + 1) * 10,
            shouldRetry: (error) => RENAME_RETRY_CODES.has((error as NodeJS.ErrnoException).code ?? ""),
        });
    } catch (e) {
        await fs.rm(temporary, {force: true});
        throw e;
    }
}

async function resolveWriteTarget(file: string): Promise<{target: string; mode: number | null}> {
    try {
        const target = await fs.realpath(file);
        return {target, mode: (await fs.stat(target)).mode & PERMISSION_BITS};
    } catch {
        return {target: file, mode: null};
    }
}
