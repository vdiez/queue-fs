let queues = {};
let servers = {};
let arbiter = {};
let pending = {};
let protoclients = require('../../../protoclients');
let parallel_connections;

module.exports = (params, logger) => {
    if (!parallel_connections && !params.parallel_connections) parallel_connections = 10;
    if (params.parallel_connections) {
        parallel_connections = parseInt(params.parallel_connections, 10);
        if (!parallel_connections && (isNaN(parallel_connections) || parallel_connections < 1)) parallel_connections = 10;
    }

    let id = protoclients.get_class(params.protocol).generate_id(params);

    if (!arbiter.hasOwnProperty(id)) {
        arbiter[id] = 0;
        pending[id] = 0;
        queues[id] = new Array(parallel_connections).fill(1).map((_, idx) => idx);
        servers[id] = new Array(parallel_connections).fill(null);
    }

    for (let i = queues[id].length; i < parallel_connections; i++) {//if parallel_connections have been increased
        queues[id].push(i);
        servers[id].push(null);
    }

    while (queues[id].length > parallel_connections) {//if parallel_connections have been reduced
        servers[id].pop();
        queues[id].pop();
    }

    pending[id]++;

    return new Promise(resolve => {
        arbiter[id] = Promise.resolve(arbiter[id])
            .then(() => {
                return new Promise(resolve_arbiter => {
                    return Promise.race(queues[id])
                        .then(queue => {
                            queues[id][queue] = Promise.resolve(queues[id][queue])
                                .then(() => {
                                    if (!servers[id][queue]) servers[id][queue] = new protoclients.get({logger: logger, protocol: params.protocol, params});
                                    return new Promise(resolve_slot => resolve({connection: servers[id][queue], resolve_slot}))
                                })
                                .then(() => {
                                    resolve();
                                    pending[id]--;
                                    if (queue >= parallel_connections) servers[id][queue].disconnect();
                                    return queue;
                                });
                            resolve_arbiter();
                        })
                });
            })
    });
};

module.exports.are_equal = (params1, params2) => protoclients.get_class(params1.protocol).generate_id(params1) === protoclients.get_class(params2.protocol).generate_id(params2)
