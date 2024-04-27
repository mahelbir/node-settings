import fs from "fs";

import _get from "lodash/get.js";
import _set from "lodash/set.js";
import forOwn from "lodash/forOwn.js";
import isObject from "lodash/isObject.js";
import isArray from "lodash/isArray.js";


let aliveSettings = null;

let defaultFile = "settings.json";

function setDefaultFile(file) {
    defaultFile = file;
}

function initSettings(seconds = 10, file = null) {
    file && setDefaultFile(file);
    aliveSettings = new Settings();
    console.info("Settings initialized,", defaultFile);
    setInterval(() => {
        aliveSettings = new Settings();
    }, seconds * 1000);
}

function settings() {
    return aliveSettings;
}

class Settings {
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

    set(key, value) {
        _set(this._settings, key, value);
    }

    get(key, defaultValue = null) {
        return _get(this._settings, key, defaultValue);
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

export {
    setDefaultFile,
    initSettings,
    settings,
    Settings
}

export default settings;