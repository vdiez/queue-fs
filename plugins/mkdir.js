let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('mkdir')) {
        actions.mkdir = function(file, params) {
            return new Promise(function (resolve, reject) {
                if (params && params.hasOwnProperty('target')) {
                    let target = sprintf(params.target, file);
                    fs.ensureDir(path.dirname(target), function (err) {
                        if (err) reject(err);
                        else resolve();
                    });
                }
                else reject("Target path not specified");
            });
        };
    }
    return actions;
};