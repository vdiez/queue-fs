let fs = require('fs-extra');
let sprintf = require('sprintf-js').sprintf;
let autobahn = require('autobahn');
let moment = require('moment');
let winston = require('winston');
let servers = {};
let pool_queue = {};
let transfer_agents = {};

let next = function(pool){
    if (!servers[pool].length) return winston.error("Pool of servers '" + pool + "' does not have any server configured");
    let server = servers[pool].reduce((min, x, i, arr) => (min < 0 || x < (arr[min].counter || 0)) && !servers[pool][i].failed ? i : min, -1);
    if (server < 0 || servers[pool][server].counter >= (servers[pool][server].concurrency || 5)) {
        winston.warn("Pool of servers '" + pool + "' does not have any available server at the moment. Retrying in 10 seconds...");
        return setTimeout(() => next(pool), 10000);
    }
    else {
        let next_transfer = pool_queue[pool].shift();
        if (typeof next_transfer === 'function') next_transfer(server);
    }
};

module.exports = function(config) {
    function Transfer(name, taker) {
        this.name = name;
        this.taker = taker;
        this.current_box = 0;
        this.queues = new Array(taker.paths.length).fill(1).map((_, idx) => idx);
        this.wamp = new Array(taker.boxes.length).fill(1);
        this.arbiter = 0;
        this.failures = new Array(taker.paths.length).fill(0);
        this.empty_queue = false;
        this.queues.forEach(() => this.go());
    }

    Transfer.prototype.go = function () {
        let self = this;
        self.arbiter = Promise.resolve(self.arbiter)
            .then(function() {
                return new Promise(function(resolve, reject) {
                    return Promise.race(self.queues)
                        .then(function(path){
                            self.queues[path] = Promise.resolve(self.queues[path])
                                .then(function(){
                                    return self.transfer(path);
                                })
                                .then(() => {})
                                .catch(() => {})
                                .then(function() {
                                    (self.failures[path] > config.max_retries) || self.empty_queue ? setTimeout(function() {self.go() }, 10000) : self.go();
                                    return path;
                                });
                            resolve();
                        })
                });
            })
    };

    Transfer.prototype.get_next_transfer = function (filter, priority = 0) {
        let self = this;
        let query = self.taker.priorities[priority];
        query.done = {$ne: self.name};
        query.started = {$ne: self.name};
        if (filter) {
            for (let field in filter) {
                if (filter.hasOwnProperty(field)) query[field] = filter[field];
            }
        }
        return config.collection.findOneAndUpdate(query, {$addToSet: {started: self.name}})
            .then(function(result) {
                if (result.value) {
                    self.empty_queue = false;
                    return result.value;
                }
                else {
                    if (++priority < self.taker.priorities.length) return self.get_next_transfer(filter, priority);
                    throw {empty_queue: true};
                }
            })
    };

    Transfer.prototype.transfer = function (path) {
        let self = this;
        let box = self.current_box;
        let current_transfer;
        const pool = self.taker.paths[path].server_pool;
        return self.get_next_transfer(self.taker.paths[path].filter)
            .then(function(transfer) {
                current_transfer = transfer;
                winston.info("Next transfer to " + self.name + (box + 1) + " is file " + current_transfer.filename);
                transfer.source = sprintf(config.orchestrator_root, transfer);
                transfer.target = sprintf(config.taker_root, transfer);
                return new Promise(function(resolve, reject) {
                    fs.stat(transfer.source, function (err, stats) {
                        if (err) reject({exists: false});
                        else resolve();
                    });
                });
            })
            .then(function() {
                if (!self.wamp[box].session) {
                    let connection = new autobahn.Connection({url: "ws://" + self.taker.boxes[box].ip, realm: config.boxes_realm, max_retries: 0});
                    let wamp = {connection: connection,session: undefined};
                    if (!config.boxes_realm || self.taker.boxes[box].passive) return wamp;

                    return new Promise(function(resolve, reject) {
                        connection.onopen = function (session) {
                            winston.debug("Connected to " + self.name + (box + 1));
                            wamp.session = session;
                            resolve(wamp);
                        };
                        connection.onclose = function (reason, details) {
                            winston.debug("Connection lost to " + self.name + (box + 1) + ". Reason: " + reason);
                            wamp.session = undefined;
                            resolve(wamp);
                        };
                        connection.open();
                    });
                }
                return self.wamp[box];
            })
            .then(function(wamp) {
                if (!self.taker.boxes[box].passive) {
                    self.wamp[box] = wamp;
                    if (!self.wamp[box].session) throw {disconnected: true};
                    return self.wamp[box].session.call('check_file', [], current_transfer)
                }
            })
            .then(function(file) {
                if (file) {
                    winston.info("Skipping lftp transfer to " + self.name + (box + 1) + ". File " + current_transfer.filename + " already exists");
                    return;
                }
                winston.debug("Enqueuing transfer to " + self.name + (box + 1) + " of file " + current_transfer.filename);
                return new Promise((resolve, reject) => {
                    pool_queue[pool].push((server) => {
                        winston.info("Starting transfer to " + self.name + (box + 1) + " of file " + current_transfer.filename);
                        if (typeof servers[pool][server].counter === "undefined") servers[pool][server].counter = 0;
                        servers[pool][server].counter++;

                        require('./protocols/' + servers[pool][server].protocol)({
                            box:self.taker.boxes[box],
                            box_idx: box,
                            route: self.taker.paths[path],
                            route_idx: path,
                            server: servers[pool][server],
                            transfer: current_transfer,
                            config: config
                        })
                            .then(val => {resolve(val); servers[pool][server].failed = false;})
                            .catch(err => {reject(err); servers[pool][server].failed = true; setTimeout(() => servers[pool][server].failed = false, 1000);})
                            .then(() => {servers[pool][server].counter--; next(pool);});
                    });
                    next(pool);
                });
            })
            .then(function(result) {
                if (result) winston.info(result);
                if (!self.taker.boxes[box].passive) {
                    let syncs = [];
                    let parameters = {type: "scp"};
                    for (let i = 0; i < self.taker.boxes.length; i++) {
                        if (i === box) continue;
                        parameters.host = self.taker.boxes[i].ip;
                        parameters.username = self.taker.boxes[i].username || config.default_username;
                        parameters.password = self.taker.boxes[i].password || config.default_password;
                        if (self.wamp[box].session) syncs.push(self.wamp[box].session.call('copy_file', [parameters, current_transfer.target]));
                    }
                    Promise.all(syncs)
                        .then(function (results) {
                            for (let i = 0; i < results.length; i++) {
                                if (results[i].error) winston.error("Could not sync " + self.name + (box + 1) + " with neighbour boxes. Error: " + JSON.stringify(results[i].message))
                            }
                        })
                        .catch(function (err) {
                            winston.error("Error syncing " + self.name + (box + 1) + " with neighbours: ", err);
                        });
                }
                self.failures[path] = 0;
                winston.info(current_transfer.filename + " completed correctly to box " + self.name + (box + 1));
                return config.collection.findOneAndUpdate({_id: current_transfer._id}, {$pull: {started: self.name}, $addToSet: {done: self.name}});
            })
            .catch(function(err) {
                if (err && err.empty_queue) self.empty_queue = true;
                if (err && err.exists === false) {
                    winston.error("Cancelled transfer to box " + self.name + (box + 1) + " of missing file: " + current_transfer.filename);
                    return config.collection.findOneAndUpdate({_id: current_transfer._id}, {$pull: {started: self.name}, $addToSet: {done: self.name}})
                        .catch(function(err) {winston.error("Error saving status of file " + current_transfer.filename + " to box " + self.name + (box + 1) + ": " + err)});
                }
                else {
                    self.failures[path]++;
                    if (self.failures[path] > config.max_retries) {
                        self.current_box++;
                        if (self.current_box === self.taker.boxes.length) self.current_box = 0;
                        else self.failures[path] = 0;
                    }
                    if (err && err.disconnected) winston.error("Box " + self.name + (box + 1) + " is not connected.");
                    else winston.error("Transfer of " + current_transfer.source + " to box " + self.name + (box + 1) + " failed with: ", err);
                    return config.collection.findOneAndUpdate({_id: current_transfer._id}, {$pull: {started: self.name}})
                        .catch(function(err) {winston.error("Error saving status of file " + current_transfer.filename + " to box " + self.name + (box + 1) + ": ", err)});
                }
            });
    };

    function add_taker(name, taker) {
        if (!transfer_agents.hasOwnProperty(name)) transfer_agents[name] = new Transfer(name, taker);
        else return "Taker " + name + " already exists";
    }

    function add_servers_pool(name, servers_array) {
        if (!servers.hasOwnProperty(name)) {
            if (servers_array.constructor !== Array) servers_array = [];
            servers[name] = servers_array;
            pool_queue[name] = [];
        }
        else return "Server pool " + name + " already exists.";
    }

    function add_server(pool, server) {
        add_servers_pool(pool, []);
        for (let srvr in servers[pool]) if (servers[pool].hasOwnProperty(srvr) && servers[pool][srvr].ip === server.ip) return "Server with IP " + server.ip + " already exists in pool " + pool + ".";
        servers[pool].push(server);
    }

    function add_transfer(file) {
        if (!file.clip_id || !file.type || !file.filename) {
            winston.error("File not queued for transfer: Missing mandatory fields. Data received: ", file);
            return;
        }
        return config.collection.insertOne({clip_id: file.clip_id, type: file.type, filename: file.filename, created: moment(file.stat && file.stat.ctime).format('YYYYMMDDHHmmssSSS')})
    }


    return {
        add_taker: add_taker,
        add_servers_pool: add_servers_pool,
        add_server: add_server,
        add_transfer: add_transfer
    };
};
