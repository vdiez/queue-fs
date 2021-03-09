let queues = {};
let functions = {};
let sprintf = require('sprintf-js').sprintf;
let wamp = require('simple_wamp');
let path = require('path');

module.exports = config => {
    config = config || {};
    config.controllers = config.controllers || {};
    if (!config.logger) config.logger = {};
    if (typeof config.logger.info !== "function") config.logger.info = () => {};
    if (typeof config.logger.warn !== "function") config.logger.warn = () => {};
    if (typeof config.logger.error !== "function") config.logger.error = () => {};
    if (typeof config.logger.debug !== "function") config.logger.debug = () => {};
    if (typeof config.logger.verbose !== "function") config.logger.verbose = () => {};

    let display = action => action.id || (action.action && action.action.name) || action.action;

    let load_function = action => {
        if (typeof action === "undefined") return;
        if (functions.hasOwnProperty(action)) return functions[action];
        else if (typeof action === "function") return action;
        else {
            try {
                require('./plugins/' + action)(functions, config);
                if (functions.hasOwnProperty(action)) return functions[action];
            }
            catch(e) {config.logger.error("Error loading plugin " + action + ":", e)}
        }
    };

    return (original_file, actions) => {
        original_file = original_file || {};
        original_file.results = {};
        actions = [].concat(actions);
        let promises = [], failed_queues = [];
        for (let i = 0; i < actions.length; i++) {
            promises.push(new Promise((resolve, reject) => {
                let file = actions[i].file || original_file;
                if (!file.path) {
                    if (file.dirname && file.filename) file.path = path.posix.join(file.dirname, file.filename);
                    else file.path = "NO_FILE";
                }

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
                config.logger.info("Action " + display(actions[i]) + " enqueued on file " + file.path);
                queues[queue] = Promise.all(awaits)
                    .then(results => {
                        if (failed_queues.filter(queue => dependencies.includes(queue)).length) throw {critical_failed: true};
                        let method = load_function(actions[i].action);
                        if (!method) throw actions[i].action + " is not recognized.";

                        return new Promise((resolve_execution, reject_execution) => {
                            let execute = (() => {
                                let timeout;
                                config.logger.info("Action " + display(actions[i]) + " starting on file " + file.path);

                                if (actions[i].timer && actions[i].timer.timeout) {
                                    timeout = setTimeout(() => {
                                        config.logger.info("Timeout for " + display(actions[i]) + " on file " + file.path);
                                        if (actions[i].timer.action) {
                                            let effect = load_function(actions[i].timer.action);
                                            if (effect) effect(file, actions[i].timer);
                                        }
                                        if (actions[i].timer.hard) {
                                            reject_execution("timeout");
                                            if (actions[i].job_id && config.controllers[actions[i].job_id] && config.controllers[actions[i].job_id].control) config.controllers[actions[i].job_id].control("stop");
                                        }
                                    }, actions[i].timer.timeout);
                                }

                                Promise.resolve()
                                    .then(() => {
                                        if (actions[i].hasOwnProperty('requisite')) {
                                            if(typeof actions[i].requisite === "function") return actions[i].requisite(file);
                                            return actions[i].requisite;
                                        }
                                        return true;
                                    })
                                    .catch(() => {})
                                    .then(result => {
                                        if (!result) throw {does_not_apply: true};
                                        return Promise.resolve(typeof actions[i].params === "function" ? actions[i].params(file) : actions[i].params);
                                    })
                                    .then(params => {
                                        Object.assign(actions[i], params);
                                        if (actions[i].job_id) {
                                            let wamp_router = actions[i].wamp_router || config.default_router;
                                            if (wamp_router && actions[i].progress) {
                                                let router = wamp({router: wamp_router, logger: config.logger});
                                                publish = content => {
                                                    content.current_step = i + 1;
                                                    content.total_steps = actions.length;
                                                    router.run('publish', [actions[i].progress_topic || 'task_progress', [actions[i].job_id, content]]);
                                                };
                                                actions[i].publish = publish;
                                            }
                                        }
                                        return method(file, actions[i]);
                                    })
                                    .then(result => {
                                        if (actions[i].loop_while && typeof actions[i].loop_while === "function") {
                                            return new Promise((resolve_loop, reject_loop) => {
                                                let loop = () => {
                                                    Promise.resolve()
                                                        .then(() => actions[i].loop_while(file))
                                                        .then(loop_result => {
                                                            if (!loop_result) resolve_loop(result);
                                                            else if (loop_result === "loop_all") reject_loop({loop: true})
                                                            else setTimeout(loop, 5000);
                                                        })
                                                        .catch(err => reject_loop(err));
                                                }

                                                loop();
                                            });
                                        }
                                        return result;
                                    })
                                    .then(result => {
                                        if (actions[i].id) original_file.results[actions[i].id] = result;
                                        if (timeout) clearTimeout(timeout);
                                        config.logger.info("Action " + display(actions[i]) + " correctly completed on file " + file.path);
                                        resolve_execution(result);
                                    })
                                    .catch(error => {
                                        if (timeout) clearTimeout(timeout);
                                        if (error.loop) setTimeout(execute, 5000);
                                        else reject_execution(error);
                                    });
                            });
                            execute();
                        });
                    })
                    .catch(reason => {
                        if (reason && reason.does_not_apply) {
                            config.logger.info("Skipped: " + file.path + " does not fulfil requirements of action " + display(actions[i]));
                            return {error: reason, path: file.path};
                        }
                        else if (actions[i].critical || (reason && reason.critical_failed)) {
                            if (actions[i].critical) config.logger.error("Critical action " + display(actions[i]) + " failed on file " + file.path + ". Error: ", reason);
                            else config.logger.error("Action " + display(actions[i]) + " failed due to previous critical failure on file " + file.path + ". Error: ", reason);
                            failed_queues.push(queue);
                            //reject(typeof reason === 'object' ? require('util').inspect(reason, {showHidden: false, depth: null}) : reason);
                            reject(reason);
                        }
                        else {
                            config.logger.error("Action " + display(actions[i]) + " failed on file " + file.path + ". Error: ", reason);
                            return {error: reason, path: file.path};
                        }
                        return reason;
                    })
                    .then(resolve);
            }));
        }

        return Promise.all(promises).then(() => original_file);
    }
};
