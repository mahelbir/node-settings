import fs from "fs";
import path from "path";

import _get from "lodash/get.js";
import _set from "lodash/set.js";
import _unset from "lodash/unset.js";
import forOwn from "lodash/forOwn.js";
import isObject from "lodash/isObject.js";
import isArray from "lodash/isArray.js";


let instance = null;
let defaultFile = path.resolve("./settings.json");


export function setDefaultFile(file) {
    file = file?.trim();
    if (!file || typeof file !== "string") {
        throw new TypeError("Settings.setDefaultFile: file must be a non-empty string path");
    }
    defaultFile = path.resolve(file);
}

export function initSettings(intervalSeconds = 1) {
    instance = new Settings();
    console.info(`Settings initialized`, defaultFile, `(refresh: ${intervalSeconds}s)`);
    return setInterval(() => {
        instance = new Settings();
    }, intervalSeconds * 1000);
}

export function settings() {
    return instance;
}

export class Settings {

    constructor(file = null) {
        this._file = file || defaultFile;
        try {
            this._settings = JSON.parse(fs.readFileSync(this._file, {encoding: 'utf-8'}));
        } catch (e) {
            console.error("Settings.parse", e);
            this._settings = {};
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
        const params = this._settings;
        const getAllKeys = (obj, path = '', keys = []) => {
            forOwn(obj, (value, key) => {
                let newPath = path ? `${path}.${key}` : key;
                if (isObject(value) && !isArray(value)) {
                    getAllKeys(value, newPath, keys);
                } else {
                    keys.push(newPath);
                }
            });
            return keys;
        }
        const keys = getAllKeys(params);
        return keys.reduce((accumulator, key) => {
            accumulator[key] = _get(params, key);
            return accumulator;
        }, {});
    }

    static put(params, file = null) {
        const settings = new Settings(file);
        for (const key in params) {
            const value = params[key];
            settings.set(key, value);
        }
        settings.save();
    }

}

export default Settings;