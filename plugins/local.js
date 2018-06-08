let exec = require('child_process').exec;
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('local')) {
        actions.local = function(file, params) {
            if (!params) throw "Missing command line";
            let parser, target, tmp, source = file.dirname;

            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            if (params.hasOwnProperty('target')) {
                target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            }
            if (params.hasOwnProperty('tmp')) {
                tmp = sprintf(params.tmp, file);
                if (!params.tmp_is_filename) tmp = path.posix.join(tmp, file.filename);
            }

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.job_id && params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
                parser = require('../helpers/stream_parsers')(params.progress, progress);
            }

            return new Promise(function (resolve, reject) {
                let child = exec(sprintf(params.cmd, {
                    source: '"' + source.replace(/"/g, "\\\"") + '"',
                    target: target ? '"' + target.replace(/"/g, "\\\"") + '"' : "",
                    tmp: tmp ? '"' + tmp.replace(/"/g, "\\\"") + '"' : "",
                    dirname: '"' + file.dirname.replace(/"/g, "\\\"") + '"',
                    filename: '"' + file.filename.replace(/"/g, "\\\"") + '"',
                    path: '"' + file.path.replace(/"/g, "\\\"") + '"'
                }), function(err, stdout, stderr) {
                    if (err) reject(err);
                    else resolve(parser && parser.data);
                });

                if (parser) {
                    child.stderr.on('data', data => parser.parse(data));
                    child.stdout.on('data', data => parser.parse(data));
                }
            });
        };
    }
    return actions;
};