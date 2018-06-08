let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('read')) {
        actions.read = function(file, params) {
            return new Promise(function (resolve, reject) {
                let source = file.dirname;
                if (params && params.hasOwnProperty('source')) source = params.source;
                source = sprintf(source, file);
                if (!params || !params.source_is_filename) source = path.posix.join(source, file.filename);
                fs.readFile(source, 'utf8', function (err, data) {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
        };
    }
    return actions;
};