let wamp = require('simple_wamp');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('wamp')) {
        actions.wamp = (file, params) => {
            if (!params) throw "Missing required arguments";
            let router = params.router || config.default_router;
            if (router  && params.method && (params.topic || params.procedure)) {
                if (params.method === "call" || params.method === "publish") {
                    let args = typeof params.args === "function" ? params.args(file) : params.args;
                    let xargs = typeof params.xargs === "function" ? params.xargs(file) : params.xargs;
                    return wamp({router: router, logger: config.logger}).run(params.method, [params.topic || params.procedure, args || [], xargs || {}]);
                }
                else return wamp({router: router, logger: config.logger}).run(params.method, [params.topic || params.procedure, params.handler || params.endpoint]);
            }
            else throw "Missing required arguments";
        };
    }
    return actions;
};