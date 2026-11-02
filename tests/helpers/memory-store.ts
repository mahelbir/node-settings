import {Mutex} from "es-toolkit/promise";

import type {SettingsStore, SettingsUpdater} from "../../src/index.ts";

export class MemoryStore implements SettingsStore {

    readCount = 0;
    updateCount = 0;
    #content: string | undefined;
    #gate: Promise<void> | null = null;
    readonly #mutex = new Mutex();

    constructor(initial?: unknown) {
        this.replace(initial);
    }

    async read(): Promise<unknown> {
        this.readCount++;
        await this.#gate;
        return this.#content === undefined ? undefined : JSON.parse(this.#content);
    }

    async update(updater: SettingsUpdater): Promise<void> {
        await this.#mutex.acquire();
        try {
            this.updateCount++;
            const next = await updater(await this.read());
            this.#content = JSON.stringify(next);
        } finally {
            this.#mutex.release();
        }
    }

    peek(): unknown {
        return this.#content === undefined ? undefined : JSON.parse(this.#content);
    }

    peekRaw(): string | undefined {
        return this.#content;
    }

    replace(value: unknown): void {
        this.#content = value === undefined ? undefined : JSON.stringify(value);
    }

    writeRaw(content: string): void {
        this.#content = content;
    }

    holdReads(): () => void {
        let release = (): void => {};
        this.#gate = new Promise((resolve) => {
            release = (): void => {
                this.#gate = null;
                resolve();
            };
        });
        return release;
    }

}

export function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
