let request = require('got');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('rest_call')) {
        actions.rest_call = (file, params) => {
            if (!params || !params.request) throw "Missing parameters";
            if (!params.request.timeout) params.request.timeout = 10000;
            if (!params.request.retry) params.request.retry = 0;
            return new Promise((resolve, reject) => {
                request(params.request)
                    .then(response => {
                        config.logger.debug("REST API Result: ", response.statusCode, response.body);
                        if (params.succeed_status) {
                            if (![].concat(params.succeed_status).includes(response.statusCode)) {
                                config.logger.error("REST API statusCode " + response.statusCode + " not included in list of accepted status");
                                reject(response.statusCode);
                            }
                            else resolve(response.body);
                        }
                        else if (params.check_response && typeof params.check_response === "function") params.check_response(response, resolve, reject);
                        else resolve(response.body);
                    })
                    .catch(err => reject(err));
                if (params.sync === false) resolve();
            });
        }
    }
    return actions;
};