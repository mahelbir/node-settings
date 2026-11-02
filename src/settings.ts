import type {StandardSchemaV1} from "@standard-schema/spec";
import cloneDeep from "es-toolkit/compat/cloneDeep";
import forOwn from "es-toolkit/compat/forOwn";
import _get from "es-toolkit/compat/get";
import _has from "es-toolkit/compat/has";
import _set from "es-toolkit/compat/set";
import _unset from "es-toolkit/compat/unset";
import {Mutex} from "es-toolkit/promise";

import {assertSafePath, dataVersion, flatten, type KeyPath, mergeAt, toSettingsData} from "./helper.ts";
import type {SettingsDeepPartial, SettingsEntries, SettingsPartialEntries, SettingsPath, SettingsPathValue} from "./settings-path.ts";
import type {SettingsData, SettingsStore} from "./settings-store.ts";
import {SettingsValidationError} from "./errors.ts";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type SettingsErrorHandler = (error: unknown) => void;

export interface SettingsOptions<TData extends object = SettingsData> {
    store: SettingsStore;
    schema?: StandardSchemaV1<unknown, TData>;
    onError?: SettingsErrorHandler | null | false;
}

export class Settings<TData extends object = SettingsData> {

    readonly #store: SettingsStore;
    readonly #schema: StandardSchemaV1<unknown, TData> | undefined;
    readonly #onError: SettingsErrorHandler | null;
    readonly #mutex = new Mutex();
    #data: SettingsData = {};
    #loadedVersion: string | null = null;
    #hasStoredData = false;
    #isLoaded = false;
    #initialLoad: Promise<void> | null = null;
    #timer: NodeJS.Timeout | null = null;
    #isPollRunning = false;

    constructor(options: SettingsOptions<TData>) {
        const store = options?.store;
        if (typeof store?.read !== "function" || typeof store.update !== "function") {
            throw new TypeError("Settings requires a store with read() and update() methods");
        }
        if (options.schema !== undefined && typeof options.schema?.["~standard"]?.validate !== "function") {
            throw new TypeError("Settings schema must implement the Standard Schema interface");
        }
        this.#store = store;
        this.#schema = options.schema;
        this.#onError = options.onError === undefined ? logPollingError : options.onError || null;
    }

    get<P extends SettingsPath<TData>>(path: P): Promise<SettingsPathValue<TData, P>>;
    get<P extends SettingsPath<TData>, D>(path: P, defaultValue: D): Promise<Exclude<SettingsPathValue<TData, P>, undefined> | D>;
    get(path: readonly string[], defaultValue?: unknown): Promise<unknown>;
    async get(path: KeyPath, defaultValue?: unknown): Promise<unknown> {
        await this.#ensureLoaded();
        return _get(this.#data, path, defaultValue);
    }

    async has(path: KeyPath): Promise<boolean> {
        await this.#ensureLoaded();
        return _has(this.#data, path);
    }

    set<P extends SettingsPath<TData>>(path: P, value: SettingsPathValue<TData, P>): Promise<void>;
    set(path: readonly string[], value: unknown): Promise<void>;
    async set(path: KeyPath, value: unknown): Promise<void> {
        assertSafePath(path);
        await this.#mutate((data) => {
            _set(data, path, value);
        });
    }

    merge<P extends SettingsPath<TData>>(path: P, value: SettingsDeepPartial<SettingsPathValue<TData, P>>): Promise<void>;
    merge(path: readonly string[], value: unknown): Promise<void>;
    async merge(path: KeyPath, value: unknown): Promise<void> {
        await this.#mutate((data) => mergeAt(data, path, value));
    }

    delete(path: SettingsPath<TData> | readonly string[]): Promise<void>;
    async delete(path: KeyPath): Promise<void> {
        assertSafePath(path);
        await this.#mutate((data) => {
            _unset(data, path);
        });
    }

    async clear(): Promise<void> {
        await this.#mutate(() => ({}));
    }

    async getRaw(): Promise<TData> {
        await this.#ensureLoaded();
        return this.#data as TData;
    }

    async getFlat(): Promise<Record<string, unknown>> {
        await this.#ensureLoaded();
        return flatten(this.#data);
    }

    async save(): Promise<void> {
        await this.#ensureLoaded();
        await this.#exclusive(async () => {
            const data = await this.#conform(this.#data);
            await this.#store.update(async (current) => {
                toSettingsData(current);
                return data;
            });
            this.#data = data;
            this.#loadedVersion = dataVersion(data);
            this.#hasStoredData = true;
        });
    }

    async put(params: SettingsEntries<TData>): Promise<void> {
        await this.#writeThrough((data) => {
            forOwn(params, (value, key) => {
                assertSafePath(key);
                _set(data, key, value);
            });
        });
    }

    async patch(params: SettingsPartialEntries<TData>): Promise<void> {
        await this.#writeThrough((data) => {
            forOwn(params, (value, key) => mergeAt(data, key, value));
        });
    }

    async getVersion(): Promise<string> {
        await this.#ensureLoaded();
        return dataVersion(this.#data);
    }

    async getStoreVersion(): Promise<string | null> {
        const stored = await this.#store.read();
        return stored === undefined ? null : dataVersion(toSettingsData(stored));
    }

    async reload(): Promise<void> {
        await this.#exclusive(async () => {
            const stored = await this.#store.read();
            if (stored === undefined && this.#hasStoredData) {
                throw new Error("Settings store holds no data, keeping the last loaded settings");
            }
            const data = toSettingsData(stored);
            const version = dataVersion(data);
            if (version === this.#loadedVersion) {
                return;
            }
            this.#data = await this.#conform(data);
            this.#loadedVersion = version;
            this.#hasStoredData = stored !== undefined;
            this.#isLoaded = true;
        });
    }

    startPolling(intervalSeconds: number = 1): void {
        if (typeof intervalSeconds !== "number" || !(intervalSeconds > 0 && intervalSeconds * 1000 <= MAX_TIMER_DELAY_MS)) {
            throw new RangeError(`Polling interval must be a positive number of seconds up to ${MAX_TIMER_DELAY_MS / 1000}`);
        }
        this.stopPolling();
        this.#timer = setInterval(() => void this.#poll(), intervalSeconds * 1000);
    }

    stopPolling(): void {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
    }

    async #poll(): Promise<void> {
        if (this.#isPollRunning) {
            return;
        }
        this.#isPollRunning = true;
        try {
            await this.reload();
        } catch (error) {
            this.#report(error);
        } finally {
            this.#isPollRunning = false;
        }
    }

    #report(error: unknown): void {
        try {
            this.#onError?.(error);
        } catch (handlerError) {
            logPollingError(new AggregateError([error, handlerError], "Settings onError handler threw while reporting a polling failure"));
        }
    }

    async #mutate(apply: (data: SettingsData) => SettingsData | void): Promise<void> {
        await this.#ensureLoaded();
        await this.#exclusive(async () => {
            const draft = this.#schema ? cloneDeep(this.#data) : this.#data;
            this.#data = await this.#conform(apply(draft) ?? draft);
            this.#loadedVersion = null;
        });
    }

    async #writeThrough(apply: (data: SettingsData) => void): Promise<void> {
        await this.#store.update(async (current) => {
            const data = toSettingsData(current);
            apply(data);
            return this.#conform(data);
        });
    }

    async #conform(data: SettingsData): Promise<SettingsData> {
        if (!this.#schema) {
            return data;
        }
        const result = await this.#schema["~standard"].validate(data);
        if (result.issues) {
            throw new SettingsValidationError(result.issues);
        }
        return toSettingsData(result.value);
    }

    #ensureLoaded(): Promise<void> {
        if (this.#isLoaded) {
            return Promise.resolve();
        }
        this.#initialLoad ??= this.reload().finally(() => {
            this.#initialLoad = null;
        });
        return this.#initialLoad;
    }

    async #exclusive<T>(task: () => Promise<T>): Promise<T> {
        await this.#mutex.acquire();
        try {
            return await task();
        } finally {
            this.#mutex.release();
        }
    }

}

function logPollingError(error: unknown): void {
    console.error("Settings polling failed to reload", error);
}
