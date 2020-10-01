let endpoint = require('./helpers/endpoint');
let connection_limiter = require('./helpers/connection_limiter');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('stat')) {
        actions.stat = (file, params) => {
            let origin_params = {parallel_connections: params.parallel_connections};
            for (let param in params) {
                if (params.hasOwnProperty(param) && param.startsWith('origin_')) origin_params[param.slice(7)] = params[param];
            }

            let source = endpoint(file, params, 'source');

            return new Promise((resolve_session, reject_session) => connection_limiter(origin_params, config.logger)
                .then(({connection, resolve_slot}) => connection.stat(source)
                    .catch(err => reject_session(err))
                    .then(stats => {
                        resolve_session(stats);
                        resolve_slot();
                    })
                ));
        };
    }
    return actions;
};
