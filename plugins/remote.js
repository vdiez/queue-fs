let ssh = require('../helpers/ssh');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let queue_counter = {};
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = function(file, params) {
            if (!params) throw "Missing command line";
            let parser, target, source = file.dirname;

            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            if (params.hasOwnProperty('target')) {
                target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            }

            if (!queue_counter.hasOwnProperty(params.host)) queue_counter[params.host] = 0;

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.job_id && params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [params.job_id, file, progress]]);
                parser = require('../helpers/stream_parsers')(params.progress, progress);
            }
            return ssh({
                id: (params.host + queue_counter[params.host]++ % (config.parallel_connections || 5)),
                host: params.host,
                username: params.username || config.default_username,
                password: params.password || config.default_password,
                cmd: sprintf(params.cmd, {
                    source: '"' + source.replace(/"/g, "\\\"") + '"',
                    target: target ? '"' + target.replace(/"/g, "\\\"") + '"' : "",
                    dirname: '"' + file.dirname.replace(/"/g, "\\\"") + '"',
                    filename: '"' + file.filename.replace(/"/g, "\\\"") + '"',
                    path: '"' + file.path.replace(/"/g, "\\\"") + '"'
                }),
                parser: parser && parser.parse
            });
        };
    }
    return actions;
};
