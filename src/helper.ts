import crypto from "node:crypto";
import cloneDeep from "es-toolkit/compat/cloneDeep";
import forOwn from "es-toolkit/compat/forOwn";
import _get from "es-toolkit/compat/get";
import isEmpty from "es-toolkit/compat/isEmpty";
import isObject from "es-toolkit/compat/isObject";
import isPlainObject from "es-toolkit/compat/isPlainObject";
import mergeWith from "es-toolkit/compat/mergeWith";
import _set from "es-toolkit/compat/set";
import toPath from "es-toolkit/compat/toPath";

import type {SettingsData} from "./settings-store.ts";

export type KeyPath = string | readonly string[];

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function toSettingsData(value: unknown): SettingsData {
    if (value === undefined) {
        return {};
    }
    if (!isPlainObject(value)) {
        throw new TypeError("Stored settings must be a plain object");
    }
    return value as SettingsData;
}

export function assertSafePath(path: KeyPath): void {
    for (const key of toPath(path)) {
        assertSafeKey(key);
    }
}

export function mergeAt(target: SettingsData, path: KeyPath, value: unknown): void {
    assertSafePath(path);
    _set(target, path, mergeValue(_get(target, path), value));
}

export function flatten(data: SettingsData): Record<string, unknown> {
    const entries: [string, unknown][] = [];
    const visit = (value: unknown, prefix: string): void => {
        forOwn(value, (child, key) => {
            const path = prefix ? `${prefix}.${key}` : key;
            if (isObject(child) && !Array.isArray(child) && !isEmpty(child)) {
                visit(child, path);
            } else {
                entries.push([path, child]);
            }
        });
    };
    visit(data, "");
    return Object.fromEntries(entries);
}

export function dataVersion(data: unknown): string {
    return crypto.createHash("sha1").update(JSON.stringify(sortDeep(JSON.parse(JSON.stringify(data))))).digest("hex");
}

function sortDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortDeep);
    }
    if (value !== null && typeof value === "object") {
        const object = value as SettingsData;
        return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortDeep(object[key])]));
    }
    return value;
}

function assertSafeKey(key: string): void {
    if (UNSAFE_KEYS.has(key)) {
        throw new TypeError(`Unsafe key segment "${key}" is not allowed`);
    }
}

function assertSafeValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): void {
    if (!isPlainObject(value)) {
        return;
    }
    const object = value as SettingsData;
    if (ancestors.has(object)) {
        throw new TypeError("Circular reference is not allowed in a merged value");
    }
    ancestors.add(object);
    for (const key of Object.keys(object)) {
        assertSafeKey(key);
        assertSafeValue(object[key], ancestors);
    }
    ancestors.delete(object);
}

function mergeValue(previous: unknown, value: unknown): unknown {
    assertSafeValue(value);
    if (!isPlainObject(value)) {
        return cloneDeep(value);
    }
    return mergeWith(isPlainObject(previous) ? previous : {}, value, replaceUnlessPlainObject);
}

function replaceUnlessPlainObject(...[, value]: unknown[]): unknown {
    return isPlainObject(value) ? undefined : cloneDeep(value);
}
