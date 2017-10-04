let hostdata = {};
let db;
let winston = require('winston');

module.exports = function(config, callback) {
    config = config || {};
    let transfer;

    return Promise.resolve()
        .then(function() {
            if (config.db_url) return (require('mongodb').MongoClient).connect(config.db_url).then(con => db = con);
            else winston.info("Transfers module disabled");
        })
        .then(function() {
            if (db && config.files_collection) {
                return db.createCollection(config.files_collection)
                    .then(function () {
                        return db.collection(config.files_collection).updateMany({}, {$set: {started: []}});
                    })
                    .then(function () {
                        if (config.takers && config.servers && config.orchestrator_root && config.taker_root) {
                            transfer = (require('./transfer'))({
                                orchestrator_root: config.orchestrator_root,
                                taker_root: config.taker_root,
                                default_username: config.default_username,
                                default_password: config.default_password,
                                boxes_realm: config.boxes_realm,
                                max_retries: config.max_retries || 5,
                                collection: db.collection(config.files_collection)
                            });
                            for (let pool in config.servers) {
                                if (config.servers.hasOwnProperty(pool)) {
                                    transfer.add_servers_pool(pool, config.servers[pool]);
                                }
                            }
                            for (let taker in config.takers) {
                                if (config.takers.hasOwnProperty(taker) && config.takers[taker].priorities && config.takers[taker].paths && config.takers[taker].boxes) {
                                    transfer.add_taker(taker, config.takers[taker]);
                                }
                            }
                        }
                        else winston.warn("Transfers module disabled: Missing mandatory parameters.");
                    })
            }
        })
        .then(function() {
            let enqueue_file = require('./enqueue')(db, config, transfer);
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
                server.on("close", () => winston.warn("HTTP server closed"));
                server.on("error", (err) => winston.error("HTTP server error: " + err));
                server.on("listening", () => winston.info("HTTP server listening."));
            }
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
        .catch((err) => {
            if(typeof callback == 'function') callback(err);
            else throw ("Error initializing queue-fs: " + err);
        });

};