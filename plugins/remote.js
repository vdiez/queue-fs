let Client = require('ssh2').Client;
let sprintf = require('sprintf-js').sprintf;
let connections = {};
let servers = {};
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
module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = function(params) {
            let command = sprintf(params.cmd, escape_params(params));
            let id = (params.host + queue_counter++ % (config && config.parallel_connections || 5));

            return new Promise(function(resolve, reject) {
                connections[id] = Promise.resolve(connections[id])
                    .then(function() {
                        if (servers[id]) return servers[id];
                        else {
                            return new Promise(function(resolve2, reject2){
                                let client = new Client();
                                client
                                    .on('ready', function () {
                                        servers[id] = client;
                                        resolve2(client);
                                    })
                                    .on('error', function (error) {
                                        servers[id] = null;
                                        reject2("Connection error: " + error);
                                    })
                                    .on('end', function () {
                                        servers[id] = null;
                                        reject2("Connection ended");
                                    })
                                    .on('close', function (error) {
                                        servers[id] = null;
                                        reject2("Connection lost");
                                    })
                                    .connect({host: params.host, username: params.username || config && config.username, password: params.password || config && config.password, readyTimeout: 60000});
                            });
                        }
                    })
                    .then(function(con) {
                        return new Promise(function(resolve2, reject2) {
                            con.exec(command, {pty: true}, function(err, stream){
                                if (err) {
                                    reject(err);
                                    resolve2(err);
                                }
                                else {
                                    stream.on('close', function (code, signal) {
                                        if (code !== 0) {
                                            reject(code, signal);
                                            resolve2(code, signal);
                                        }
                                        else {
                                            resolve();
                                            resolve2();
                                        }
                                    }).on('data', function (data) {
                                        if (data.indexOf('sudo') >= 0 && data.indexOf('password') >= 0) {
                                            stream.write(params.password + '\n');
                                        }
                                    }).stderr.on('data', function (data) {
                                        console.log("STDERR " + id + ": " + data);
                                    });
                                }
                            })
                        });
                    });
            });
        };
    }
    return actions;
};