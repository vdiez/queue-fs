let winston = require('winston');
let mongodb = require('mongodb');
let wamp = require('simple_wamp');
let db;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('semaphore')) {
        actions.semaphore = (file, params) => {
            return new Promise((resolve, reject) => {
                if (db) return resolve();
                mongodb.MongoClient.connect(new mongodb.Server(config.db_host, config.db_port), (err, client) => {
                    if (err) return reject('MongoDB error while connecting: ', err);
                    db = client.db(config.db_name);
                    db.on('close', () => {
                        db = false;
                        winston.error('MongoDB disconnected');
                    });
                    resolve();
                });
            })
            .then(() => new Promise((resolve, reject) => {
                if (!params) throw "Missing parameters";
                let notification;
                let wamp_router = params.wamp_router || config.default_router;
                let wamp_realm = params.wamp_realm || config.default_realm;

                let poll = () => {
                    return db.collection(config.db_files).findOne(params.condition.query)
                        .then(result => {
                            if (result) {
                                if (params.job_id && wamp_router && wamp_realm && notification) {
                                    wamp(wamp_router, wamp_realm, 'call', [params.job_id, ["resume"]], true, false)
                                        .catch(err => winston.error("Semaphore could not notify dispatcher for file " + file.filename + ". Error: " + JSON.stringify(err)))
                                        .then(() => resolve());
                                }
                                else resolve();
                            }
                            else {
                                winston.debug('Semaphore module: ' + file.filename + " waiting for " + (params.condition.name || params.condition) + " condition to fulfil");
                                if (params.job_id && wamp_router && wamp_realm && !notification) wamp(wamp_router, wamp_realm, 'call', [params.job_id, ["pause"]], true, false)
                                    .then(() => {
                                        setTimeout(poll, 5000);
                                        notification = true;
                                    })
                                    .catch(err => {
                                        winston.error("Semaphore could not notify dispatcher for file " + file.filename + ". Error: " + JSON.stringify(err));
                                        notification = false;
                                    });
                                else setTimeout(poll, 5000);
                            }
                        })
                        .catch(err => {
                            setTimeout(poll, 5000);
                            winston.debug('Semaphore module: ' + file.filename + " still waiting for " + (params.condition.name || params.condition) + " condition to fulfil. Error: ", err);
                        });
                };
                poll();
            }))
        };
    }
    return actions;
};