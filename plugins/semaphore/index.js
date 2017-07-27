let config = require('../../config');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('semaphore')) {
        actions.semaphore = function(params) {
            let timeout;
            return Promise.resolve(require("./conditions/" + params.condition)(params))
                .then((result) => {
                    if (params.timeout) {
                        timeout = setTimeout(function () {
                            if (params.wamp.session)
                                params.wamp.session.call('update_clips', [], {
                                    clip_ids: params.clip_id,
                                    event: "timeout",
                                    type: params.type || "",
                                    origin: params.origin || "",
                                    message: sprintf(params.message, params)
                                });
                        }, params.timeout);
                    }
                    if (!result.update) {
                        return new Promise(function(resolve, reject) {
                            let poll = function() {
                                params.db.collection(config.db_semaphore).findOne(result.query)
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
                    else return params.db.collection(config.db_semaphore).findOneAndUpdate(result.query, {$set: result.update}, {upsert: true, returnOriginal: false});
                })
                .then((result) => {
                    if (typeof timeout !== "undefined") clearTimeout(timeout);
                    if (typeof params.data === "undefined") params.data = {};
                    if (result && result.value && result.value.info) for (let attr in result.value.info) if (result.value.info.hasOwnProperty(attr)) params.data[attr] = result.value.info[attr];
                    if (result && result.value && result.value.fields) for (let attr in result.value.fields) if (result.value.fields.hasOwnProperty(attr)) params[attr] = result.value.fields[attr];
                });
        };
    }
    return actions;
};