let request = require('request');
let winston = require('winston');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('rest_call')) {
        actions.rest_call = function(file, params) {
            return Promise.resolve(typeof params.request === "function" ? params.request(file) : params.request)
                .then(parameters => new Promise(function (resolve, reject) {
                    if (!parameters.timeout) parameters.timeout = 10000;
                    request(parameters, function(err, response, body) {
                        if (err) {
                            winston.error("REST API Error:", err);
                            reject(err);
                        }
                        else {
                            winston.debug("REST API Result: ", body);
                            if (params.succeed_status && ![].concat(params.succeed_status).includes(response.statusCode)) {
                                winston.error("REST API statusCode " +  response.statusCode + " not included in list of accepted status");
                                reject(response.statusCode);
                            }
                            resolve(body);
                        }
                    });
                    if (params && params.sync === false) resolve();
                }));
        };
    }
    return actions;
};