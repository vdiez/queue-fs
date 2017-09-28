let memory_db = {};
let no_db = false;

module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('semaphore')) {
        actions.semaphore = function(file, params) {
            if (!config || !config.db_semaphore) no_db = true;
            let condition;

            if (typeof params.condition === "function") condition = params.condition;
            else {
                try {
                    condition = require("./conditions/" + params.condition);
                }
                catch(e) {}
            }
            if (!condition) throw params.condition + " is not a recognized semaphore.";

            return Promise.resolve(condition(file))
                .then((result) => {
                    if (!result.query) throw "Semaphore condition missing query property.";
                    if (!result.update) {
                        return new Promise(function(resolve, reject) {
                            let poll = function() {
                                let check;
                                if (no_db) check = memory_db[JSON.stringify(result.query)];
                                else check = db.collection(config.db_semaphore).findOne(result.query);
                                Promise.resolve(check)
                                    .then((result) => {
                                        if (result) resolve({value: result});
                                        else setTimeout(poll, 5000);
                                    })
                                    .catch(() => {
                                        setTimeout(poll, 5000);
                                    });
                            };
                            poll();
                        });
                    }
                    else {
                        if (no_db) {
                            memory_db[JSON.stringify(result.query)] = result.update;
                            return {value: result.update};
                        }
                        else return db.collection(config.db_semaphore).findOneAndUpdate(result.query, {$set: result.update}, {upsert: true, returnOriginal: false});
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