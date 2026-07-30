import crypto from "crypto";


export function checksum(input) {
    return crypto.createHash("sha1").update(input).digest("hex");
}
