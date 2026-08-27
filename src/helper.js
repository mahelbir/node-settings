import fs from "fs";
import crypto from "crypto";
import lockfile from "proper-lockfile";
import isPlainObject from "es-toolkit/compat/isPlainObject";
import mergeWith from "es-toolkit/compat/mergeWith";


const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_LIMIT = 10;
const LOCK_OPTIONS = {realpath: false, stale: 2000};
const LOCK_WAIT_MS = 5000;

function sleepSync(milliseconds) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function renameSyncWithRetry(source, target) {
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(source, target);
            return;
        } catch (e) {
            if (attempt >= RENAME_RETRY_LIMIT || !RENAME_RETRY_CODES.has(e.code)) {
                throw e;
            }
            sleepSync(attempt * 10);
        }
    }
}

export function withFileLock(file, action) {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (; ;) {
        let release;
        try {
            release = lockfile.lockSync(file, LOCK_OPTIONS);
        } catch (e) {
            if (e.code !== "ELOCKED" || Date.now() >= deadline) {
                throw e;
            }
            sleepSync(1);
            continue;
        }
        try {
            return action();
        } finally {
            release();
        }
    }
}

export function writeFileAtomic(file, content) {
    let target = file;
    let mode = null;
    try {
        target = fs.realpathSync(file);
        mode = fs.statSync(target).mode;
    } catch {
        target = file;
    }
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(temporary, content);
        if (mode !== null) {
            fs.chmodSync(temporary, mode);
        }
        renameSyncWithRetry(temporary, target);
    } catch (e) {
        fs.rmSync(temporary, {force: true});
        throw e;
    }
}

function replaceUnlessPlainObject(previous, value) {
    return isPlainObject(value) ? undefined : value;
}

export function mergeValue(previous, value) {
    if (!isPlainObject(value)) {
        return value;
    }
    return mergeWith(isPlainObject(previous) ? previous : {}, value, replaceUnlessPlainObject);
}

export function checksum(input) {
    return crypto.createHash("sha1").update(input).digest("hex");
}

export function sortDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortDeep);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
    }
    return value;
}
