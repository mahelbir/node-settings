"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.Settings = void 0;
exports.initSettings = initSettings;
exports.setDefaultFile = setDefaultFile;
exports.settings = settings;
var _fs = _interopRequireDefault(require("fs"));
var _get2 = _interopRequireDefault(require("lodash/get.js"));
var _set2 = _interopRequireDefault(require("lodash/set.js"));
var _forOwn = _interopRequireDefault(require("lodash/forOwn.js"));
var _isObject = _interopRequireDefault(require("lodash/isObject.js"));
var _isArray = _interopRequireDefault(require("lodash/isArray.js"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
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
      this._settings = JSON.parse(_fs.default.readFileSync(this._file, {
        encoding: 'utf-8'
      }));
    } catch (e) {
      console.error("Settings.parse", e);
      this._settings = {};
    }
  }
  save() {
    _fs.default.writeFileSync(this._file, JSON.stringify(this._settings));
  }
  set(key, value) {
    (0, _set2.default)(this._settings, key, value);
  }
  get(key, defaultValue = null) {
    return (0, _get2.default)(this._settings, key, defaultValue);
  }
  all() {
    const params = this._settings;
    const getAllKeys = (obj, path = '', keys = []) => {
      (0, _forOwn.default)(obj, (value, key) => {
        let newPath = path ? `${path}.${key}` : key;
        if ((0, _isObject.default)(value) && !(0, _isArray.default)(value)) {
          getAllKeys(value, newPath, keys);
        } else {
          keys.push(newPath);
        }
      });
      return keys;
    };
    const keys = getAllKeys(params);
    return keys.reduce((accumulator, key) => {
      accumulator[key] = (0, _get2.default)(params, key);
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
exports.Settings = Settings;
var _default = exports.default = settings;