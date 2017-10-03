let queues = {};
let functions = {};
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');

module.exports = function(db, config, transfer) {
    config = config || {};

    function load_function(action) {
        if (typeof action === "undefined") return;
        if (functions.hasOwnProperty(action)) return functions[action];
        else if (typeof action === "function") return action;
        else {
            try {
                require('./plugins/' + action)(functions, db, config);
                if (functions.hasOwnProperty(action)) return functions[action];
            }
            catch(e) {}
        }
    }

    return function(file, actions) {
        actions = [].concat(actions);
        let promises = [], failed_queues = [];

        for (let i = 0; i < actions.length; i++) {
            promises.push(new Promise(function(resolve, reject) {
                let queue = file.path;
                if (actions[i].hasOwnProperty('queue')) queue = sprintf(actions[i].queue, file);

                let dependencies = [queue];
                let awaits = [];
                if (actions[i].hasOwnProperty('awaits')) dependencies = [].concat(actions[i].awaits);
                for (let j = 0; j < dependencies.length; j++) {
                    dependencies[j] = sprintf(dependencies[j], file);
                    awaits.push(queues[dependencies[j]]);
                }

                winston.info("Action " + (actions[i].action.name || actions[i].action) + " enqueued on file " + file.path);
                queues[queue] = Promise.all(awaits)
                    .then(function(results) {
                        if (failed_queues.filter(queue => dependencies.includes(queue)).length) throw {critical_failed: true};
                        let method = load_function(actions[i].action);
                        if (!method) throw actions[i].action + " is not recognized.";

                        if  (actions[i].requisite && typeof actions[i].requisite === "function" && !actions[i].requisite(file)) return 0;
                        return new Promise(function(resolve_execution, reject_execution) {
                            let timeout;

                            if (actions[i].timer && actions[i].timer.timeout) {
                                timeout = setTimeout(function () {
                                    winston.info("Timeout for " + (actions[i].action.name || actions[i].action) + " on file " + file.path);
                                    if (actions[i].timer.action) {
                                        let effect = load_function(actions[i].timer.action);
                                        if (effect) effect(file, actions[i].timer.params);
                                    }
                                    if (actions[i].timer.hard) reject_execution("timeout");
                                }, actions[i].timer.timeout);
                            }

                            winston.info("Action " + (actions[i].action.name || actions[i].action) + " starting on file " + file.path);
                            method(file, actions[i].params)
                                .then(result => {
                                    if (timeout) clearTimeout(timeout);
                                    resolve_execution(result);
                                })
                                .catch(error => {
                                    if (timeout) clearTimeout(timeout);
                                    reject_execution(error);
                                });
                        });
                    })
                    .then(function(result) {
                        resolve();
                        winston.info("Action " + (actions[i].action.name || actions[i].action) + " correctly completed on file " + file.path);
                        return result;
                    })
                    .catch(function(reason) {
                        if (actions[i].critical || (reason && reason.critical_failed)) {
                            if (actions[i].critical) winston.error("Critical action " + (actions[i].action.name || actions[i].action) + " failed on file " + file.path + ". Error: " + reason);
                            else winston.error("Action " + (actions[i].action.name || actions[i].action) + " failed due to previous critical failure on file " + file.path + ". Error: " + reason);
                            failed_queues.push(queue);
                            reject(reason);
                        }
                        else {
                            winston.error("Action " + (actions[i].action.name || actions[i].action) + " failed on file " + file.path + ". Error: " + reason);
                            resolve({error: reason, path: file.path});
                        }
                        return reason;
                    });
            }));
        }

        return Promise.all(promises)
            .then(() => {
                if (typeof transfer !== "undefined") transfer.add_transfer(file);
            });
    }
};
