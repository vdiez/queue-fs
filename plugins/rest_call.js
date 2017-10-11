let request = require('request');
let winston = require('winston');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('rest_call')) {
        actions.rest_call = function(file, params) {
            return new Promise(function (resolve, reject) {
                request(typeof params.request === "function" ? params.request(file) : params.request, function(err, response, body) {
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

            });
        };
    }
    return actions;
};