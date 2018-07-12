let queues = {};
let functions = {};
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');
let wamp = require('simple_wamp');

module.exports = config => {
    config = config || {};

    let display = action => action.id || action.action.name || action.action;

    let load_function = action => {
        if (typeof action === "undefined") return;
        if (functions.hasOwnProperty(action)) return functions[action];
        else if (typeof action === "function") return action;
        else {
            try {
                require('./plugins/' + action)(functions, config);
                if (functions.hasOwnProperty(action)) return functions[action];
            }
            catch(e) {winston.error("Error loading plugin " + action + ":", e)}
        }
    };

    let load_templates = actions => {
        let raw_actions = [];
        for (let i = 0; i < actions.length; i++){
            try {
                let unfolded_actions = require('./templates/' + actions[i].action)(actions[i].params, config);
                raw_actions = raw_actions.concat(unfolded_actions);
                winston.info("Detected template action " + actions[i].action);
            }
            catch(e) {
                raw_actions.push(actions[i]);
            }
        }
        return raw_actions;
    };

    return (file, actions) => {
        file.results = {};
        actions = [].concat(actions);
        let promises = [], failed_queues = [];
        actions = load_templates(actions);
        for (let i = 0; i < actions.length; i++) {
            promises.push(new Promise((resolve, reject) => {
                let queue = file.path;
                if (actions[i].hasOwnProperty('queue')) queue = sprintf(actions[i].queue, file);

                let dependencies = [queue];
                let awaits = [];
                if (actions[i].hasOwnProperty('awaits')) dependencies = [].concat(actions[i].awaits);
                for (let j = 0; j < dependencies.length; j++) {
                    dependencies[j] = sprintf(dependencies[j], file);
                    awaits.push(queues[dependencies[j]]);
                }

                let publish = () => {};
                if (actions[i].params && actions[i].params.job_id && actions[i].params.progress) {
                    let wamp_router = actions[i].params.wamp_router || config.default_router;
                    let wamp_realm = actions[i].params.wamp_realm || config.default_realm;
                    if (wamp_router && wamp_realm) {
                        publish = content => wamp(wamp_router, wamp_realm, 'publish', [actions[i].params.topic || 'task_progress', [actions[i].params.job_id, file, content]]);
                    }
                }

                winston.info("Action " + display(actions[i]) + " enqueued on file " + file.path);
                queues[queue] = Promise.all(awaits)
                    .then(results => {
                        if (failed_queues.filter(queue => dependencies.includes(queue)).length) throw {critical_failed: true};
                        let method = load_function(actions[i].action);
                        if (!method) throw actions[i].action + " is not recognized.";

                        let execute = () => new Promise((resolve_execution, reject_execution) => {
                            let timeout;
                            winston.info("Action " + display(actions[i]) + " starting on file " + file.path);
                            publish({description: actions[i].params.description});

                            if (actions[i].timer && actions[i].timer.timeout) {
                                timeout = setTimeout(() => {
                                    winston.info("Timeout for " + display(actions[i]) + " on file " + file.path);
                                    if (actions[i].timer.action) {
                                        let effect = load_function(actions[i].timer.action);
                                        if (effect) effect(file, actions[i].timer.params);
                                    }
                                    if (actions[i].timer.hard) reject_execution("timeout");
                                }, actions[i].timer.timeout);
                            }

                            let requisite = true;
                            if  (actions[i].requisite && typeof actions[i].requisite === "function") requisite = actions[i].requisite(file);
                            Promise.resolve(requisite)
                                .catch(() => {
                                    throw {does_not_apply: true};
                                })
                                .then(result => {
                                    if (!result) throw {does_not_apply: true};
                                    return method(file, actions[i].params);
                                })
                                .then(result => {
                                    if (timeout) clearTimeout(timeout);
                                    resolve_execution(result);
                                })
                                .catch(error => {
                                    if (timeout) clearTimeout(timeout);
                                    reject_execution(error);
                                });
                        })
                        .then(result => {
                            if (actions[i].id) file.results[actions[i].id] = result;
                            let post;
                            if (actions[i].loop_while && typeof actions[i].loop_while === "function") post = actions[i].loop_while(file);
                            return Promise.resolve(post)
                                .then(loop => {
                                    if (loop) setTimeout(execute, 5000);
                                    else {
                                        resolve();
                                        winston.info("Action " + display(actions[i]) + " correctly completed on file " + file.path);
                                        publish({end: 1});
                                        return result;
                                    }
                                });
                        });

                        return execute();
                    })
                    .catch(reason => {
                        publish({fail: reason && reason.toString()});
                        if (reason && reason.does_not_apply) {
                            winston.info("Skipped: " + file.path + " does not fulfil requirements of action " + display(actions[i]));
                            resolve({error: reason, path: file.path});
                        }
                        else if (actions[i].critical || (reason && reason.critical_failed)) {
                            if (actions[i].critical) winston.error("Critical action " + display(actions[i]) + " failed on file " + file.path + ". Error: ", reason);
                            else winston.error("Action " + display(actions[i]) + " failed due to previous critical failure on file " + file.path + ". Error: ", reason);
                            failed_queues.push(queue);
                            reject(reason.toString());
                        }
                        else {
                            winston.error("Action " + display(actions[i]) + " failed on file " + file.path + ". Error: ", reason);
                            resolve({error: reason, path: file.path});
                        }
                        return reason;
                    });
            }));
        }

        return Promise.all(promises).then(() => file);
    }
};
