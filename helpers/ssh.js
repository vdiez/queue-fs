let Client = require('ssh2').Client;
let connections = {};
let servers = {};

module.exports = function(params) {
    return new Promise(function(resolve, reject) {
        if (!params.cmd) reject("SSH ERROR: Missing command line");
        if (!params.host) reject("SSH ERROR: Missing hostname");
        if (!params.username) reject("SSH ERROR: Missing username");
        if (!params.password) reject("SSH ERROR: Missing password");
        let id = params.id || params.host;
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
                            .connect({host: params.host, username: params.username, password: params.password, readyTimeout: 60000});
                    });
                }
            })
            .then(function(con) {
                return new Promise(function(resolve2, reject2) {
                    con.exec(params.cmd, {pty: true}, function(err, stream){
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
            })
            .catch((err) => console.log("SSH module error: " + err));
    });
};