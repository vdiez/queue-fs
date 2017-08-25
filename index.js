let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let moment = require('moment');
let VERBOSE_LEVEL = 0;

function ERROR(args) {VERBOSE_LEVEL >= 1 && console.log.apply(console, [moment().format()].concat(args));}
function WARN(args) {VERBOSE_LEVEL >= 2 && console.log.apply(console, [moment().format()].concat(args));}
function DEBUG(args) {VERBOSE_LEVEL >= 3 && console.log.apply(console, [moment().format()].concat(args));}

let queue = {};
let functions = {};
let hostdata = {};
let db;

module.exports = function(config, callback) {
    config = config || {};
    VERBOSE_LEVEL = config.verbosity || 0;

    let enqueue_file = function(file, actions, description) {
        actions = [].concat(actions);
        let promises = [];
        let configuration;

        for (let i = 0; i < actions.length; i++) {
            let method = undefined;
            if (functions.hasOwnProperty(actions[i].action)) method = functions[actions[i].action];
            else if (typeof actions[i].action === "function") method = actions[i].action;
            else {
                try {
                    require('./plugins/' + actions[i].action)(functions, db, config);
                    if (functions.hasOwnProperty(actions[i].action)) method = functions[actions[i].action];
                }
                catch(e) {}
            }
            if (!method) {
                ERROR(actions[i].action + " is not recognized.");
                continue;
            }

            let requisite = actions[i].requisite;
            let critical = actions[i].critical;

            // Avoid reusing same params all time -> corrupted params object
            let params = {};
            if (actions[i].hasOwnProperty('params')) try {params = JSON.parse(JSON.stringify(actions[i].params));} catch(e) {params = {};}

            for (let attr in file) if (file.hasOwnProperty(attr)) params[attr] = file[attr];

            if (!params.hasOwnProperty('source')) params.source = params.dirname;
            if (!params.source_is_filename) params.source = path.join(params.source, params.filename);

            if (params.hasOwnProperty('target')) {
                try {configuration = JSON.parse(fs.readFileSync('priorities.json'));} catch(e) {configuration = {};}
                if (configuration.hasOwnProperty(params.target)) {
                    let assigned = false;
                    for (let priority in configuration[params.target]) {
                        if (configuration[params.target].hasOwnProperty(priority)) {
                            let matches = [].concat(configuration[params.target][priority]);
                            for (let j = 0; j < matches.length; j++) {
                                if (params.path.toLowerCase().includes(matches[j].toLowerCase()) || matches[j] == "*") {
                                    params.target = path.join(params.target, priority);
                                    assigned = true;
                                    break;
                                }
                            }
                            if (assigned) break;
                        }
                    }
                }
                if (!params.target_is_filename) params.target = path.join(params.target, params.filename);
            }

            params.description = description;
            if (!params.description) {
                if (typeof actions[i].action === "function") params.description = actions[i].action.name;
                else params.description = actions[i].action;
                params.description += " " + params.source + (params.target ? " to " + params.target : "");
            }

            if (params.hasOwnProperty('queue')) params.queue = sprintf(params.queue, params);
            else params.queue = params.path;

            if (params.hasOwnProperty('awaits')) {
                let awaits = [].concat(params.awaits);
                let queues = [];
                for (let j = 0; j < awaits.length; j++) queues.push(queue[sprintf(awaits[j], params)]);
                params.awaits = Promise.all(queues);
            }
            else params.awaits = queue[params.queue];

            promises.push(new Promise(function(resolve, reject) {
                queue[params.queue] = Promise.resolve(params.awaits)
                    .then(function(inherits) {
                        if (inherits) {
                            for (let attr in inherits) if (inherits.hasOwnProperty(attr)) params[attr] = inherits[attr];
                            if (inherits.critical_failed) {
                                critical = true;
                                throw "Previous critical action failed";
                            }
                        }
                        if (params.hasOwnProperty('target')) params.target = sprintf(params.target, params);
                        params.source = sprintf(params.source, params);
                        DEBUG("Starting " + params.description);
                        return !requisite || requisite(params) ? method(params) : 0;
                    })
                    .then(function(result) {
                        DEBUG("Completed " + params.description);
                        resolve();
                        if (params.post) {
                            let fields = [].concat(params.post);
                            let inheritance = {};
                            for (let i = 0; i < fields.length; i++) {
                                if (params.hasOwnProperty(fields[i])) inheritance[fields[i]] = params[fields[i]];
                            }
                            return inheritance;
                        }
                    })
                    .catch(function(reason) {
                        WARN("Failed " + params.description + ". Error: " + reason);
                        let inheritance = {};
                        if (critical) {
                            if (i < actions.length-1) inheritance.critical_failed = true;
                            reject(reason);
                        }
                        else resolve({error: reason, path: params.path});

                        if (params.post) {
                            let fields = [].concat(params.post);
                            for (let i = 0; i < fields.length; i++) {
                                if (params.hasOwnProperty(fields[i])) inheritance[fields[i]] = params[fields[i]];
                            }
                        }
                        return inheritance;
                    });
            }));
        }

        return Promise.all(promises)
            .then(() => {
                if (typeof transfer !== "undefined") transfer.add_transfer(file);
            });
    };

    let db_promise;
    let transfer;

    if (config.db_url) {
        db_promise = (require('mongodb').MongoClient).connect(config.db_url)
            .then(function (con) {
                if (con && config.files_collection) {
                    db = con;
                    return db.createCollection(config.files_collection)
                        .then(function () {
                            return db.collection(config.files_collection).updateMany({}, {$set: {started: []}});
                        })
                        .then(function() {
                            if (config.takers && config.servers && config.orchestrator_root && config.taker_root) {
                                transfer = (require('./transfer'))(db.collection(config.files_collection));
                                for (let pool in config.servers) {
                                    if (config.servers.hasOwnProperty(pool)) {
                                        transfer.add_servers_pool(pool, config.servers[pool]);
                                    }
                                }
                                for (let taker in config.takers) {
                                    if (config.takers.hasOwnProperty(taker) && config.takers[taker].priorities && config.takers[taker].paths && config.takers[taker].boxes) {
                                        transfer.add_taker(config.takers[taker], {
                                            name: taker,
                                            orchestrator_root: config.orchestrator_root,
                                            taker_root: config.taker_root,
                                            default_user: config.username,
                                            default_password: config.password,
                                            boxes_realm: config.boxes_realm,
                                            max_retries: config.max_retries || 5
                                        });
                                    }
                                }
                            }
                            else console.log("Transfers module disabled: Missing mandatory parameters.");
                        })
                }
            })
    }
    else console.log("Transfers module disabled");

    return Promise.resolve(db_promise)
        .then(function() {
            if (config.monitoring_http_port) {
                let express = require('express');
                let bodyParser = require('body-parser');
                let http = require('http');
                let app = express();
                app.use(bodyParser.json());
                app.use(bodyParser.urlencoded({extended: false}));
                let monitor = require('./monitor')(db, hostdata, enqueue_file, config.files_collection, config.watched_partitions);
                app.use('/monitor', monitor);
                let server = http.createServer(app);
                server.listen(config.monitoring_http_port);
                server.on("close", () => console.log("HTTP server closed"));
                server.on("error", (err) => console.log("HTTP server error: " + err));
                server.on("listening", () => console.log("HTTP server listening."));
            }
        })
        .then(function() {
            let return_object = {
                get_status: () => hostdata,
                add: enqueue_file,
                get_transfers_module: () => {
                    if (typeof transfer === "undefined") throw "Transfers module disabled";
                    return transfer;
                }

            };

            if(typeof callback == 'function') callback(undefined, return_object);
            else return return_object;
        })
        .catch((err) => console.log("Error initializing queue-fs: " + err));

};