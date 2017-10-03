let exec = require('child_process').exec;
let path = require('path');
let sprintf = require('sprintf-js').sprintf;


module.exports = function(actions) {
    if (!actions.hasOwnProperty('local')) {
        actions.local = function(file, params) {
            if (!params) throw "Missing command line";
            let target, source = file.dirname;

            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.join(source, file.filename);
            if (params.hasOwnProperty('target')) {
                target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.join(target, file.filename);
            }
            return new Promise(function (resolve, reject) {
                exec(sprintf(params.cmd, {
                    source: '"' + source.replace(/"/g, "\\\"") + '"',
                    target: target ? '"' + target.replace(/"/g, "\\\"") + '"' : "",
                    dirname: '"' + file.dirname.replace(/"/g, "\\\"") + '"',
                    filename: '"' + file.filename.replace(/"/g, "\\\"") + '"',
                    path: '"' + file.path.replace(/"/g, "\\\"") + '"'
                }), function(err, stdout, stderr) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};