import fs from "fs";
import path from "path";
import _get from "es-toolkit/compat/get";
import _set from "es-toolkit/compat/set";
import _unset from "es-toolkit/compat/unset";
import forOwn from "es-toolkit/compat/forOwn";
import isObject from "es-toolkit/compat/isObject";
import isEmpty from "es-toolkit/compat/isEmpty";
import {checksum, sortDeep} from "./helper.js";


export class Settings {

    constructor(file) {
        if (typeof file !== "string" || !file.trim()) {
            throw new TypeError("File must be a non-empty string path");
        }
        this._file = path.resolve(file.trim());
        this._settings = {};
        this._loadedFileChecksum = null;
        this._timer = null;
        this.reload();
    }

    _readFile() {
        try {
            const buffer = fs.readFileSync(this._file);
            return {ok: true, buffer, fileChecksum: checksum(buffer)};
        } catch (e) {
            console.error("Settings.read", e);
            return {ok: false, buffer: null, fileChecksum: null};
        }
    }

    _parseBuffer(buffer) {
        try {
            return {ok: true, data: JSON.parse(buffer.toString("utf-8"))};
        } catch (e) {
            console.error("Settings.parse", e);
            return {ok: false, data: {}};
        }
    }

    _writeFile(data) {
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync(this._file, json);
        return checksum(json);
    }

    reload() {
        const {ok, buffer, fileChecksum} = this._readFile();
        if (!ok) {
            return false;
        }
        if (fileChecksum === this._loadedFileChecksum) {
            return true;
        }
        const parsed = this._parseBuffer(buffer);
        if (!parsed.ok) {
            return false;
        }
        this._settings = parsed.data;
        this._loadedFileChecksum = fileChecksum;
        return true;
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
        const {ok, buffer} = this._readFile();
        const data = ok ? this._parseBuffer(buffer).data : {};
        forOwn(params, (value, key) => {
            _set(data, key, value);
        });
        this._writeFile(data);
    }

    save() {
        this._loadedFileChecksum = this._writeFile(this._settings);
    }

    version() {
        return checksum(JSON.stringify(sortDeep(JSON.parse(JSON.stringify(this._settings)))));
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