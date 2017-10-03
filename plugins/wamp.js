let wamp_sessions = {};
let wamp_queue = {};
let autobahn = require('autobahn');
let winston = require('winston');

module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('wamp')) {
        actions.wamp = function (file, params) {
            if (params && params.router && params.realm && (params.topic || params.procedure)) {
                return new Promise(function(resolve, reject) {
                    let key = params.router + ":" + params.realm;
                    wamp_queue[key] = Promise.resolve(wamp_queue[key])
                        .then(function() {
                            if (wamp_sessions.hasOwnProperty(key)) return wamp_sessions[key];
                            return new Promise(function(resolve2, reject2){
                                let connect = function() {
                                    let wamp = new autobahn.Connection({url: "ws://" + params.router, realm: params.realm, max_retries: 0});
                                    wamp.onopen = function (session) {
                                        winston.warn("WAMP session established with " + params.router);
                                        wamp_sessions[key] = session;
                                        resolve2();
                                    };
                                    wamp.onclose = function (reason, details) {
                                        if (!wamp_sessions[key]) {
                                            winston.warn("WAMP session could not be established with " + params.router + ". Error: " + reason);
                                            setTimeout(connect, 5000);
                                        }
                                        else winston.warn("WAMP session lost with " + params.router + ". Error: " + reason);
                                        wamp_sessions[key] = undefined;
                                    };
                                    wamp.open();
                                };
                                connect();
                            });
                        })
                        .then(function(){
                            let args = typeof params.args === "function" ? params.args(file) : params.args;
                            let xargs = typeof params.xargs === "function" ? params.xargs(file) : params.xargs;
                            let result = wamp_sessions[key][params.topic ? "publish": "call"](params.topic || params.procedure, args || [], xargs || {});
                            resolve(result);
                            return result;
                        });
                    if (!params.sync) resolve();
                });
            }
            else throw "Missing required arguments"
        }
    }
    return actions;
};