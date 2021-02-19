let endpoint = require('./helpers/endpoint');
let protoclients = require('protoclients');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('tag')) {
        actions.tag = (file, params) => {
            let source_params = {parallel_connections: params.parallel_connections};
            for (let param in params) {
                if (params.hasOwnProperty(param) && param.startsWith('source_')) source_params[param.slice(7)] = params[param];
            }

            let source = endpoint(file, params, 'source');

            let connection = protoclients({params: source_params, logger: config.logger, protocol: source_params.protocol})
            return connection.tag(source, params.tags, source_params)
        };
    }
    return actions;
};
