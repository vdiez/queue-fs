let memory_db = {};
let winston = require('winston');
let mongodb = require('mongodb');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('semaphore')) {
        let db = false;

        let connect = function() {
            return new Promise(function(resolve, reject) {
                if (!config.db_host) {
                    resolve();
                    winston.info('Semaphore module using memory: Non persistent results');
                }
                if (db) resolve();
                config.db_semaphore = config.db_semaphore || "semaphore";


                mongodb.MongoClient.connect(new mongodb.Server(config.db_host, config.db_port), function (err, client) {
                    if (err) {
                        db = false;
                        resolve();
                        winston.error('MongoDB error while connecting: ', err);
                    }
                    db = client.db(config.db_name);
                    db.on('close', () => {
                        db = false;
                        winston.error('MongoDB disconnected');
                    });
                    resolve();
                });
            });
        };

        actions.semaphore = function(file, params) {
            let condition;

            if (typeof params.condition === "function") condition = params.condition;
            else {
                try {
                    condition = require("./conditions/" + params.condition);
                }
                catch(e) {}
            }
            if (!condition) throw params.condition + " is not a recognized semaphore.";

            return connect()
                .then(() => Promise.resolve(condition(file)))
                .then((result) => {
                    if (!result.query) throw "Semaphore condition missing query property.";
                    if (!result.update) {
                        return new Promise(function(resolve, reject) {
                            let poll = function() {
                                let check;
                                if (db) check = db.collection(config.db_semaphore).findOne(result.query);
                                else check = memory_db[JSON.stringify(result.query)];
                                Promise.resolve(check)
                                    .then((result) => {
                                        if (result) resolve({value: result});
                                        else {
                                            setTimeout(poll, 5000);
                                            winston.debug('Semaphore module: ' + file.filename + " still waiting for " + (params.condition.name || params.condition) + " condition to fulfil");
                                        }
                                    })
                                    .catch(() => {
                                        setTimeout(poll, 5000);
                                        winston.debug('Semaphore module: ' + file.filename + " still waiting for " + (params.condition.name || params.condition) + " condition to fulfil");
                                    });
                            };
                            poll();
                        });
                    }
                    else {
                        if (db) return db.collection(config.db_semaphore).findOneAndUpdate(result.query, {$set: result.update}, {upsert: true, returnOriginal: false});
                        else {
                            memory_db[JSON.stringify(result.query)] = result.update;
                            return {value: result.update};
                        }
                    }
                })
                .then((result) => {
                    if (result && result.value && result.value.info) {
                        if (typeof file.data === "undefined") file.data = {};
                        for (let attr in result.value.info) if (result.value.info.hasOwnProperty(attr)) file.data[attr] = result.value.info[attr];
                    }
                    if (result && result.value && result.value.fields) for (let attr in result.value.fields) if (result.value.fields.hasOwnProperty(attr)) file[attr] = result.value.fields[attr];
                });
        };
    }
    return actions;
};