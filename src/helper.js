import crypto from "crypto";


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
