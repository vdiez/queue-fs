let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('hide')) {
        actions.hide = function(file, params) {
            return new Promise(function (resolve, reject) {
                if (!path.basename(params.source).startsWith('.')) {
                    let source = file.dirname;
                    if (params.hasOwnProperty('source')) source = params.source;
                    source = sprintf(source, file);
                    if (!params.source_is_filename) source = path.join(source, file.filename);
                    let target = path.join(path.dirname(source), "." + path.basename(source));
                    fs.move(source, target, {overwrite: true}, function (err) {
                        if (err) reject(err);
                        else resolve();
                    });
                }
                else resolve();
            });
        };
    }
    return actions;
};