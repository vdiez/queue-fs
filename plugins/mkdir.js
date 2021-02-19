let path = require('path');
let endpoint = require('./helpers/endpoint');
let protoclients = require('protoclients');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('mkdir')) {
        actions.mkdir = (file, params) => {
            if (!params) throw "Missing parameters";
            let target = endpoint(file, params, 'target');

            let connection = protoclients({params: params, logger: config.logger, protocol: params.protocol})
            return connection.mkdir(params.target_is_filename ? path.posix.dirname(target): target, params);
        };
    }
    return actions;
};
