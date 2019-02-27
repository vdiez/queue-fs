let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = actions => {
    if (!actions.hasOwnProperty('mkdir')) {
        actions.mkdir = (file, params) => {
            if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
            let target = sprintf(params.target, file);
            if (params.target_is_filename) return fs.ensureDir(path.dirname(target));
            return fs.ensureDir(target);
        };
    }
    return actions;
};