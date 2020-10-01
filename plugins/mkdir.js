let path = require('path');
let endpoint = require('./helpers/endpoint');
let connection_limiter = require('./helpers/connection_limiter');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('mkdir')) {
        actions.mkdir = (file, params) => {
            if (!params) throw "Missing parameters";
            let target = endpoint(file, params, 'target');

            return new Promise((resolve_session, reject_session) =>  connection_limiter(params, config.logger)
                .then(({connection, resolve_slot}) => connection.mkdir(params.target_is_filename ? path.posix.dirname(target): target)
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
