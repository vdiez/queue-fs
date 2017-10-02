let ssh = require('../helpers/ssh');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let queue_counter = {};

module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = function(file, params) {
            let target, source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.join(source, file.filename);
            if (params.hasOwnProperty('target')) {
                target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.join(target, file.filename);
            }

            if (!queue_counter.hasOwnProperty(params.host)) queue_counter[params.host] = 0;
            return ssh({
                id: (params.host + queue_counter[params.host]++ % params.parallel_connections),
                username: params.username || config.default_username,
                password: params.password || config.default_password,
                parallel_connections: params.parallel_connections || config.parallel_connections || 5,
                cmd: sprintf(params.cmd, {
                    source: '"' + source.replace(/"/g, "\\\"") + '"',
                    target: target ? '"' + target.replace(/"/g, "\\\"") + '"' : "",
                    dirname: '"' + file.dirname.replace(/"/g, "\\\"") + '"',
                    filename: '"' + file.filename.replace(/"/g, "\\\"") + '"',
                    path: '"' + file.path.replace(/"/g, "\\\"") + '"'
                })
            });
        };
    }
    return actions;
};