let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('symlink')) {
        actions.symlink = function(file, params) {
            return new Promise(function (resolve, reject) {
                let source = file.dirname;
                if (params && params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params || !params.source_is_filename) source = path.join(source, file.filename);
                if (params.hasOwnProperty('target')) {
                    let target = sprintf(params.target, file);
                    if (!params.target_is_filename) target = path.join(target, file.filename);
                    fs.ensureSymlink(source, target, function (err) {
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