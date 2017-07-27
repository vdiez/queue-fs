let Client = require('ssh2').Client;
let config = require('../config');
let sprintf = require('sprintf-js').sprintf;
let connections = {};
let servers = {};
let debug = false;
let queue_counter = 0;

function escape_params(params) {
    return {
        source: '"' + params.source.replace(/"/g, "\\\"") + '"',
        target: '"' + params.target.replace(/"/g, "\\\"") + '"',
        dirname: '"' + params.dirname.replace(/"/g, "\\\"") + '"',
        filename: '"' + params.filename.replace(/"/g, "\\\"") + '"',
        path: '"' + params.path.replace(/"/g, "\\\"") + '"',
        extension: '"' + params.extension.replace(/"/g, "\\\"") + '"'
    }
}
module.exports = function(actions) {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = function(params) {
            let command = sprintf(params.cmd, escape_params(params));
            let id = (params.host + queue_counter++ % config.parallel_connections);

            return new Promise(function(resolve, reject) {
                connections[id] = Promise.resolve(connections[id])
                    .then(function() {
                        if (servers[id]) return servers[id];
                        else {
                            return new Promise(function(resolve, reject){
                                let client = new Client();
                                client
                                    .on('ready', function () {
                                        servers[id] = client;
                                        resolve(client);
                                    })
                                    .on('error', function (error) {
                                        servers[id] = null;
                                        reject("Connection error: " + error);
                                    })
                                    .on('end', function () {
                                        servers[id] = null;
                                        reject("Connection ended");
                                    })
                                    .on('close', function (error) {
                                        servers[id] = null;
                                        reject("Connection lost");
                                    })
                                    .connect({host: params.host, username: config.username, password: config.password, readyTimeout: 60000});
                            });
                        }
                    })
                    .then(function(con) {
                        return new Promise(function(resolve2, reject2) {
                            con.exec(command, {pty: true}, function(err, stream){
                                if (err) {
                                    reject(err);
                                    reject2(err);
                                }
                                else {
                                    stream.on('close', function (code, signal) {
                                        if (code !== 0) {
                                            console.log("EXIT " + id + ". Code: " + code + ". Signal: " + signal);
                                            reject(code, signal);
                                            reject2(code, signal);
                                        }
                                        else {
                                            resolve();
                                            resolve2();
                                        }
                                    }).on('data', function (data) {
                                        if (debug) console.log("STOUT " + id + ": " + data);
                                        if (data.indexOf('sudo') >= 0 && data.indexOf('password') >= 0) {
                                            stream.write(config.password + '\n');
                                        }
                                    }).stderr.on('data', function (data) {
                                        console.log("STDERR " + id + ": " + data);
                                    });
                                }
                            })
                        });
                    })
                    .catch(function(err) {
                        console.log("Failed command " + command + " on host " + params.host + ". Error: " + err);
                    });
            });
        };
    }
    return actions;
};