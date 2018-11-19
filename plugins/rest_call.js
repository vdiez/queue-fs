let request = require('request');
let winston = require('winston');

module.exports = actions => {
    if (!actions.hasOwnProperty('rest_call')) {
        actions.rest_call = (file, params) => {
            if (!params || !params.request) throw "Missing parameters";
            if (!params.request.timeout) params.request.timeout = 10000;
            return new Promise((resolve, reject) => {
                request(params.request, (err, response, body) => {
                    if (err) {
                        winston.error("REST API Error:", err);
                        reject(err);
                    }
                    else {
                        winston.debug("REST API Result: ", body);
                        if (params.succeed_status) {
                            if (![].concat(params.succeed_status).includes(response.statusCode)) {
                                winston.error("REST API statusCode " + response.statusCode + " not included in list of accepted status");
                                reject(response.statusCode);
                            }
                            else resolve(body);
                        }
                        else if (params.check_response && typeof params.check_response === "function") params.check_response(response, body, resolve, reject);
                        else resolve(body);
                    }
                });
                if (params.sync === false) resolve();
            });
        }
    }
    return actions;
};