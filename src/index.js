import fs from "fs";
import path from "path";
import _get from "es-toolkit/compat/get";
import _has from "es-toolkit/compat/has";
import _set from "es-toolkit/compat/set";
import _unset from "es-toolkit/compat/unset";
import forOwn from "es-toolkit/compat/forOwn";
import isObject from "es-toolkit/compat/isObject";
import isEmpty from "es-toolkit/compat/isEmpty";
import {assertSafePath, checksum, mergeValue, sortDeep, withFileLock, writeFileAtomic} from "./helper.js";


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

    get(key, defaultValue = undefined) {
        return _get(this._settings, key, defaultValue);
    }

    has(key) {
        return _has(this._settings, key);
    }

    set(key, value) {
        assertSafePath(key);
        _set(this._settings, key, value);
        this._markDirty();
    }

    merge(key, value) {
        this._mergeInto(this._settings, key, value);
        this._markDirty();
    }

    delete(key) {
        assertSafePath(key);
        _unset(this._settings, key);
        this._markDirty();
    }

    clear() {
        this._settings = {};
        this._markDirty();
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

    reload() {
        const {isOk, buffer, fileChecksum} = this._readFile();
        if (!isOk) {
            return false;
        }
        if (fileChecksum === this._loadedFileChecksum) {
            return true;
        }
        const parsed = this._parseBuffer(buffer);
        if (!parsed.isOk) {
            return false;
        }
        this._settings = parsed.data;
        this._loadedFileChecksum = fileChecksum;
        return true;
    }

    save() {
        withFileLock(this._file, () => {
            this._loadedFileChecksum = this._writeFile(this._settings);
        });
    }

    put(params) {
        this._writeThrough((data) => forOwn(params, (value, key) => {
            assertSafePath(key);
            _set(data, key, value);
        }));
    }

    patch(params) {
        this._writeThrough((data) => forOwn(params, (value, key) => this._mergeInto(data, key, value)));
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

    version() {
        return checksum(JSON.stringify(sortDeep(JSON.parse(JSON.stringify(this._settings)))));
    }

    fileChecksum() {
        return this._readFile().fileChecksum;
    }

    _markDirty() {
        this._loadedFileChecksum = null;
    }

    _readFile() {
        try {
            const buffer = fs.readFileSync(this._file);
            return {isOk: true, buffer, fileChecksum: checksum(buffer)};
        } catch (e) {
            console.error("Settings.read", e);
            return {isOk: false, buffer: null, fileChecksum: null};
        }
    }

    _parseBuffer(buffer) {
        try {
            return {isOk: true, data: JSON.parse(buffer.toString("utf-8"))};
        } catch (e) {
            console.error("Settings.parse", e);
            return {isOk: false, data: {}};
        }
    }

    _writeFile(data) {
        const json = JSON.stringify(data, null, 2);
        writeFileAtomic(this._file, json);
        return checksum(json);
    }

    _writeThrough(apply) {
        withFileLock(this._file, () => {
            const {isOk, buffer} = this._readFile();
            const data = isOk ? this._parseBuffer(buffer).data : {};
            apply(data);
            this._writeFile(data);
        });
    }

    _mergeInto(target, key, value) {
        assertSafePath(key);
        _set(target, key, mergeValue(_get(target, key), value));
    }

}
