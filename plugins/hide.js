let path = require('path');
let endpoint = require('./helpers/endpoint');
let protoclients = require('protoclients');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('hide')) {
        actions.hide = (file, params) => {
            let source_params = {parallel_connections: params.parallel_connections};
            for (let param in params) {
                if (params.hasOwnProperty(param) && param.startsWith('source_')) source_params[param.slice(7)] = params[param];
            }

            let source = endpoint(file, params, 'source'),
                filename = path.posix.basename(source),
                target = path.posix.join(path.dirname(source), "." + filename);

            if (filename.startsWith('.')) return;

            let connection = protoclients({params: source_params, logger: config.logger, protocol: source_params.protocol})
            return connection.stat(target, source_params)
                .catch(() => {})
                .then(stats => {
                    if (stats) {
                        if (params.force) return connection.remove(target, source_params);
                        throw "Target already exists";
                    }
                })
                .then(() => connection.move(source, target, params))
        };
    }
    return actions;
};
