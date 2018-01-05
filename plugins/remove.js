let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('remove')) {
        actions.remove = function(file, params) {
            return new Promise(function (resolve, reject) {
                let source = file.dirname;
                if (params && params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params || !params.source_is_filename) source = path.posix.join(source, file.filename);
                fs.remove(source, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};