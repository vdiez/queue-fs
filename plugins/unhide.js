let path = require('path');
let endpoint = require('./helpers/endpoint');
let connection_limiter = require('./helpers/connection_limiter');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('unhide')) {
        actions.unhide = (file, params) => {
            let origin_params = {parallel_connections: params.parallel_connections};
            for (let param in params) {
                if (params.hasOwnProperty(param) && param.startsWith('origin_')) origin_params[param.slice(7)] = params[param];
            }

            let source = endpoint(file, params, 'source'),
                filename = path.posix.basename(source),
                target = path.posix.join(path.dirname(source), filename.replace(/^\.*/, ''));

            if (!filename.startsWith('.')) return;

            return new Promise((resolve_session, reject_session) => connection_limiter(origin_params, config.logger)
                .then(({connection, resolve_slot}) => connection.stat(target).catch(() => {})
                .then(stats => {
                    if (stats) {
                        if (params.force) return connection.remove(target);
                        throw "Target already exists";
                    }
                })
                .then(() => connection.move(source, target))
                .catch(err => reject_session(err))
                .then(() => {
                    resolve_session();
                    resolve_slot();
                })))
        };
    }
    return actions;
};
