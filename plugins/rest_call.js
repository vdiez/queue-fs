let request = require('request');
let winston = require('winston');

module.exports = actions => {
    if (!actions.hasOwnProperty('rest_call')) {
        actions.rest_call = (file, params) => Promise.resolve(typeof params === "function" ? params(file) : params)
            .then(params => new Promise((resolve, reject) => {
                if (!params || !params.request) throw "Missing parameters";
                if (!params.request.timeout) parameters.timeout = 10000;
                request(params.request, (err, response, body) => {
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
                if (params.sync === false) resolve();
            }));
    }
    return actions;
};