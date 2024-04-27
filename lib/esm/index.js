import fs from "fs";
import _get from "lodash/get.js";
import _set from "lodash/set.js";
import forOwn from "lodash/forOwn.js";
import isObject from "lodash/isObject.js";
import isArray from "lodash/isArray.js";
var aliveSettings = null;
var defaultFile = "settings.json";
function setDefaultFile(file) {
  defaultFile = file;
}
function initSettings() {
  var seconds = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 10;
  var file = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
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
  constructor() {
    var file = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
    this._file = file || defaultFile;
    try {
      this._settings = JSON.parse(fs.readFileSync(this._file, {
        encoding: 'utf-8'
      }));
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
  get(key) {
    var defaultValue = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    return _get(this._settings, key, defaultValue);
  }
  all() {
    var params = this._settings;
    var getAllKeys = function getAllKeys(obj) {
      var path = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
      var keys = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];
      forOwn(obj, (value, key) => {
        var newPath = path ? "".concat(path, ".").concat(key) : key;
        if (isObject(value) && !isArray(value)) {
          getAllKeys(value, newPath, keys);
        } else {
          keys.push(newPath);
        }
      });
      return keys;
    };
    var keys = getAllKeys(params);
    return keys.reduce((accumulator, key) => {
      accumulator[key] = _get(params, key);
      return accumulator;
    }, {});
  }
  static put(params) {
    var file = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    var settings = new Settings(file);
    for (var key in params) {
      var value = params[key];
      settings.set(key, value);
    }
    settings.save();
  }
}
export { setDefaultFile, initSettings, settings, Settings };
export default settings;