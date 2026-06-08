import fs from "fs";
import path from "path";
import _get from "es-toolkit/compat/get";
import _set from "es-toolkit/compat/set";
import _unset from "es-toolkit/compat/unset";
import forOwn from "es-toolkit/compat/forOwn";
import isObject from "es-toolkit/compat/isObject";
import isEmpty from "es-toolkit/compat/isEmpty";


const DEFAULT_NAME = "default";
const instances = new Map();
const timers = new Map();
let defaultFile = path.resolve("./settings.json");

function load(name, file, guardLoaded) {
    const next = new Settings(file);
    if (!guardLoaded || next._loaded) {
        instances.set(name, next);
    }
}

export function setDefaultFile(file) {
    if (typeof file !== "string" || !file.trim()) {
        throw new TypeError("File must be a non-empty string path");
    }
    defaultFile = path.resolve(file.trim());
}

export function initSettings(intervalSeconds = 1, name = null, file = null) {
    let targetName = DEFAULT_NAME;
    let targetFile = null;
    if (name != null) {
        if (typeof name !== "string" || !name.trim()) {
            throw new TypeError("name must be a non-empty string");
        }
        if (typeof file !== "string" || !file.trim()) {
            throw new TypeError("file is required when name is provided");
        }
        targetName = name.trim();
        targetFile = file.trim();
    }
    if (timers.has(targetName)) {
        clearInterval(timers.get(targetName));
    }
    load(targetName, targetFile, false);
    console.info(`Settings initialized`, targetName, targetFile || defaultFile, `(refresh: ${intervalSeconds}s)`);
    const timer = setInterval(() => {
        load(targetName, targetFile, true);
    }, intervalSeconds * 1000);
    timers.set(targetName, timer);
    return timer;
}

export function destroySettings(name = DEFAULT_NAME) {
    if (timers.has(name)) {
        clearInterval(timers.get(name));
        timers.delete(name);
    }
    instances.delete(name);
}

export function settings(name = DEFAULT_NAME) {
    return instances.get(name) ?? null;
}

export class Settings {

    constructor(file = null) {
        this._file = file || defaultFile;
        try {
            this._settings = JSON.parse(fs.readFileSync(this._file, {encoding: 'utf-8'}));
            this._loaded = true;
        } catch (e) {
            console.error("Settings.parse", e);
            this._settings = {};
            this._loaded = false;
        }
    }

    save() {
        fs.writeFileSync(this._file, JSON.stringify(this._settings));
    }

    get(key, defaultValue = undefined) {
        return _get(this._settings, key, defaultValue);
    }

    set(key, value) {
        _set(this._settings, key, value);
    }

    unset(key) {
        _unset(this._settings, key);
    }

    raw() {
        return this._settings;
    }

    all() {
        const result = {};
        const flatten = (obj, prefix = '') => {
            forOwn(obj, (value, key) => {
                const newPath = prefix ? `${prefix}.${key}` : key;
                if (isObject(value) && !Array.isArray(value) && !isEmpty(value)) {
                    flatten(value, newPath);
                } else {
                    result[newPath] = value;
                }
            });
        };
        flatten(this._settings);
        return result;
    }

    static put(params, file = null) {
        const settings = new Settings(file);
        forOwn(params, (value, key) => {
            settings.set(key, value);
        });
        settings.save();
    }

}

export default Settings;