let ssh = require('../helpers/ssh');
let sprintf = require('sprintf-js').sprintf;
let queue_counter = {};

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
module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = function(params) {
            params.username = params.username || config.default_username;
            params.password = params.password || config.default_password;
            params.parallel_connections = params.parallel_connections || config.parallel_connections || 5;
            params.cmd = sprintf(params.cmd, escape_params(params));
            if (!queue_counter.hasOwnProperty(params.host)) queue_counter[params.host] = 0;
            params.id = (params.host + queue_counter[params.host]++ % params.parallel_connections);
            return ssh(params);
        };
    }
    return actions;
};