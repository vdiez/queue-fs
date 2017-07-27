let fs = require('fs-extra');
let path = require('path');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('mkdir')) {
        actions.mkdir = function(params) {
            return new Promise(function (resolve, reject) {
                fs.ensureDir(path.dirname(params.source), function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};