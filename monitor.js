let express = require('express');
let os = require('os');
let sprintf = require('sprintf-js').sprintf;
let path = require('path');
let winston = require('winston');

module.exports = function(db, hostdata, actions, files_collection, watched_partitions) {
    let router = express.Router();
    let hostname = os.hostname();

    router.post('/', function(req, res) {
        let data = req.body;
        for (let i = 0; i < data.length; i++) {
            let host = data[i]['host'];
            let plugin = data[i]['plugin'];
            let plugin_instance = data[i]['plugin_instance'] || "";
            let type = data[i]['type'] || "";
            let type_instance = data[i]['type_instance'] || "";
            if (!hostdata[host]) hostdata[host] = {};
            if (!hostdata[host][plugin]) hostdata[host][plugin] = {};
            if (!hostdata[host][plugin][plugin_instance]) hostdata[host][plugin][plugin_instance] = {};
            if (!hostdata[host][plugin][plugin_instance][type]) hostdata[host][plugin][plugin_instance][type] = {};
            if (!hostdata[host][plugin][plugin_instance][type][type_instance]) hostdata[host][plugin][plugin_instance][type][type_instance] = {};
            for ( let x = 0; x < data[i]['values'].length; x++) hostdata[host][plugin][plugin_instance][type][type_instance][data[i]['dsnames'][x]] = data[i]['values'][x];
        }
        res.end();
    });

    hostdata.get_status = function() {
        let value, tmp, tmp2, prop, prop2;
        let status_data = {};
        if (hostdata.hasOwnProperty(hostname)) {
            if (hostdata[hostname].hasOwnProperty('sensors')) {
                for (prop in hostdata[hostname]['sensors']) {
                    if (hostdata[hostname]['sensors'].hasOwnProperty(prop)) {
                        if (prop.startsWith("coretemp")) {
                            value = undefined;
                            if (hostdata[hostname]['sensors'][prop].hasOwnProperty("temperature")) {
                                for (prop2 in hostdata[hostname]['sensors'][prop]["temperature"]) {
                                    if (hostdata[hostname]['sensors'][prop]["temperature"].hasOwnProperty(prop2)
                                        && hostdata[hostname]['sensors'][prop]["temperature"][prop2].hasOwnProperty("value")) {
                                        tmp = hostdata[hostname]['sensors'][prop]["temperature"][prop2].value;
                                        if (!value || value < tmp) value = tmp;
                                    }
                                }
                                status_data.cpu_temp = Math.round(value);
                            }
                        }
                        if (prop.startsWith("i350")) {
                            value = undefined;
                            if (hostdata[hostname]['sensors'][prop].hasOwnProperty("temperature")) {
                                for (prop2 in hostdata[hostname]['sensors'][prop]["temperature"]) {
                                    if (hostdata[hostname]['sensors'][prop]["temperature"].hasOwnProperty(prop2)
                                        && hostdata[hostname]['sensors'][prop]["temperature"][prop2].hasOwnProperty("value")) {
                                        tmp = hostdata[hostname]['sensors'][prop]["temperature"][prop2].value;
                                        if (!value || value < tmp) value = tmp;
                                    }
                                }
                                if (value) {
                                    status_data.mb_temp = Math.round((value - 32) * 5 / 9);
                                }
                            }
                        }
                    }
                }
            }
            if (hostdata[hostname].hasOwnProperty('df')) {
                value = undefined;
                for (prop in hostdata[hostname]['df']) {
                    if (hostdata[hostname]['df'].hasOwnProperty(prop)
                        && watched_partitions.hasOwnProperty(prop)
                        && hostdata[hostname]['df'][prop].hasOwnProperty("df_complex")
                        && hostdata[hostname]['df'][prop]["df_complex"].hasOwnProperty("used")
                        && hostdata[hostname]['df'][prop]["df_complex"]["used"].hasOwnProperty("value")
                        && hostdata[hostname]['df'][prop]["df_complex"].hasOwnProperty("free")
                        && hostdata[hostname]['df'][prop]["df_complex"]["free"].hasOwnProperty("value")) {
                        tmp = hostdata[hostname]['df'][prop]["df_complex"]["used"].value;
                        tmp2 = hostdata[hostname]['df'][prop]["df_complex"]["free"].value;
                        tmp = Math.round(tmp * 100 / (tmp + tmp2));
                        if (!value || value < tmp) value = tmp;
                    }

                }
                status_data.hd = value;
            }
            if (hostdata[hostname].hasOwnProperty('load') &&
                hostdata[hostname]['load'].hasOwnProperty("") &&
                hostdata[hostname]['load'][""].hasOwnProperty("load") &&
                hostdata[hostname]['load'][""]["load"].hasOwnProperty("") &&
                hostdata[hostname]['load'][""]["load"][""].hasOwnProperty("shortterm")) {
                status_data.cpu_load = Math.round(hostdata[hostname]['load'][""]["load"][""]["shortterm"] * 100/12);
            }
            if (hostdata[hostname].hasOwnProperty('memory') &&
                hostdata[hostname]['memory'].hasOwnProperty("") &&
                hostdata[hostname]['memory'][""].hasOwnProperty("memory") &&
                hostdata[hostname]['memory'][""]["memory"].hasOwnProperty("free") &&
                hostdata[hostname]['memory'][""]["memory"].hasOwnProperty("used") &&
                hostdata[hostname]['memory'][""]["memory"]["free"].hasOwnProperty("value") &&
                hostdata[hostname]['memory'][""]["memory"]["used"].hasOwnProperty("value")) {
                status_data.ram = Math.round(hostdata[hostname]['memory'][""]["memory"]["used"].value * 100/
                    (hostdata[hostname]['memory'][""]["memory"]["used"].value + hostdata[hostname]['memory'][""]["memory"]["free"].value));
            }
        }
        return status_data;
    };

    let cleaner_queues = {};

    function clean_file(partition, file) {
        let action_file = {
            dirname: sprintf(partition.files_dirname, file),
            queue: partition.root,
            filename: file.filename,
            path: path.join(sprintf(partition.files_dirname, file), file.filename)
        };
        return actions(action_file, partition)
            .then(function () {
                return db.collection(files_collection).deleteOne({_id: file._id});
            });
    }

    function clean_partition(partition) {
        return db.collection(files_collection).find({done: {$exists: true, $ne: []}, started: {$exists: true, $eq: []}}).sort({created: 1}).limit(partition.action_step || 5).toArray()
            .then(function (files) {
                cleaner_queues[partition.root] = [];
                for (let i = 0; i < files.length; i++) cleaner_queues[partition.root].push(clean_file(partition, files[i]));
                return Promise.all(cleaner_queues[partition.root]);
            })
            .then(function () {
                delete cleaner_queues[partition.root];
            })
            .catch(function (err) {
                delete cleaner_queues[partition.root];
                winston.error("Error automatic cleanup: ", err);
            });
    }

    if (db && files_collection && watched_partitions) {
        setInterval(function () {
            try {
                for (let partition in watched_partitions) {
                    if (watched_partitions.hasOwnProperty(partition) && hostdata.hasOwnProperty(hostname)
                        && hostdata[hostname]['df'][partition]['df_complex']["used"]
                        && hostdata[hostname]['df'][partition]['df_complex']["free"]) {
                        let used = hostdata[hostname]['df'][partition]["df_complex"]["used"].value;
                        let free = hostdata[hostname]['df'][partition]["df_complex"]["free"].value;
                        let percentage = Math.round(used * 100 / (used + free));

                        if (percentage > watched_partitions[partition].threshold) {
                            if (!cleaner_queues.hasOwnProperty(watched_partitions[partition].root)) clean_partition(watched_partitions[partition]);
                        }
                    }
                }
            }
            catch (e) {winston.error("Error automatic cleaner: ", e);}
        }, 10000);
    }

    router.get('/', function(req, res) {
        res.send(hostdata);
    });

    return router;
};