let exec = require('child_process').exec;
let sprintf = require('sprintf-js').sprintf;

function escape_params(params) {
    return {
        source: '"' + params.source.replace(/"/g, "\\\"") + '"',
        target: params.target ? '"' + params.target.replace(/"/g, "\\\"") + '"' : "",
        dirname: '"' + params.dirname.replace(/"/g, "\\\"") + '"',
        filename: '"' + params.filename.replace(/"/g, "\\\"") + '"',
        path: '"' + params.path.replace(/"/g, "\\\"") + '"',
        extension: params.extension.replace(/"/g, "\\\"")
    }
}

module.exports = function(actions) {
    if (!actions.hasOwnProperty('local')) {
        actions.local = function(params) {
            return new Promise(function (resolve, reject) {
                exec(sprintf(params.cmd, escape_params(params)), function(err, stdout, stderr) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};