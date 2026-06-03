import fs from "fs";
import path from "path";

import _get from "lodash/get.js";
import _set from "lodash/set.js";
import _unset from "lodash/unset.js";
import forOwn from "lodash/forOwn.js";
import isObject from "lodash/isObject.js";
import isArray from "lodash/isArray.js";
import isEmpty from "lodash/isEmpty.js";


let instance = null;
let refreshTimer = null;
let defaultFile = path.resolve("./settings.json");


export function setDefaultFile(file) {
    if (typeof file !== "string" || !file.trim()) {
        throw new TypeError("Settings.setDefaultFile: file must be a non-empty string path");
    }
    defaultFile = path.resolve(file.trim());
}

export function initSettings(intervalSeconds = 1) {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    instance = new Settings();
    console.info(`Settings initialized`, defaultFile, `(refresh: ${intervalSeconds}s)`);
    refreshTimer = setInterval(() => {
        const next = new Settings();
        if (next._loaded) {
            instance = next;
        }
    }, intervalSeconds * 1000);
    return refreshTimer;
}

export function settings() {
    return instance;
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
                if (isObject(value) && !isArray(value) && !isEmpty(value)) {
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