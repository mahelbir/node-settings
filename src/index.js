import fs from "fs";
import path from "path";
import _get from "es-toolkit/compat/get";
import _set from "es-toolkit/compat/set";
import _unset from "es-toolkit/compat/unset";
import forOwn from "es-toolkit/compat/forOwn";
import isObject from "es-toolkit/compat/isObject";
import isEmpty from "es-toolkit/compat/isEmpty";


export class Settings {

    constructor(file) {
        if (typeof file !== "string" || !file.trim()) {
            throw new TypeError("File must be a non-empty string path");
        }
        this._file = path.resolve(file.trim());
        this._settings = {};
        this._timer = null;
        this.reload();
    }

    _readFile() {
        try {
            return {ok: true, data: JSON.parse(fs.readFileSync(this._file, {encoding: "utf-8"}))};
        } catch (e) {
            console.error("Settings.parse", e);
            return {ok: false, data: {}};
        }
    }

    _writeFile(data) {
        fs.writeFileSync(this._file, JSON.stringify(data));
    }

    reload() {
        const {ok, data} = this._readFile();
        if (ok) {
            this._settings = data;
        }
        return ok;
    }

    startPolling(intervalSeconds = 1) {
        this.stopPolling();
        this._timer = setInterval(() => this.reload(), intervalSeconds * 1000);
    }

    stopPolling() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
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

    put(params) {
        const {data} = this._readFile();
        forOwn(params, (value, key) => {
            _set(data, key, value);
        });
        this._writeFile(data);
    }

    save() {
        this._writeFile(this._settings);
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

}