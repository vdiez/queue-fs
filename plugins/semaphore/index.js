let sprintf = require('sprintf-js').sprintf;

let memory_db = {};
let no_db = false;

module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('semaphore')) {
        actions.semaphore = function(params) {
            if (!config || !config.db_semaphore) no_db = true;
            let timeout, timeout_publish, condition;

            if (typeof params.condition === "function") condition = params.condition;
            else {
                try {
                    condition = require("./conditions/" + params.condition);
                }
                catch(e) {}
            }
            if (!condition) throw params.condition + " is not a recognized semaphore.";

            return Promise.resolve(condition(params))
                .then((result) => {
                    if (params.timeout) {
                        timeout = setTimeout(function () {
                            if (params.wamp && params.wamp.session)
                                params.wamp.session.call('update_clips', [], {clip_ids: params.clip_id,event: "timeout",type: params.type || "",origin: params.origin || "",message: sprintf(params.message, params)});
                        }, params.timeout);
                    }
                    if (params.timeout_with_publish) {
                        timeout_publish = setTimeout(function () {
                            if (params.wamp)
                                params.wamp.publish('update_clips', [], {clip_ids: params.clip_id,event: "timeout",type: params.type || "",origin: params.origin || "",message: sprintf(params.message, params)});
                        }, params.timeout_with_publish);
                    }
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
                    if (typeof timeout !== "undefined") clearTimeout(timeout);
                    if (typeof timeout_publish !== "undefined") clearTimeout(timeout_publish);
                    if (typeof params.data === "undefined") params.data = {};
                    if (result && result.value && result.value.info) for (let attr in result.value.info) if (result.value.info.hasOwnProperty(attr)) params.data[attr] = result.value.info[attr];
                    if (result && result.value && result.value.fields) for (let attr in result.value.fields) if (result.value.fields.hasOwnProperty(attr)) params[attr] = result.value.fields[attr];
                });
        };
    }
    return actions;
};