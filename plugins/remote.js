let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');
let Client = require('ssh2').Client;

let connections = {};
let servers = {};
let arbiter = {};
let pending = {};

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.cmd) throw "Missing command line";
            if (!params.host) throw "Missing hostname";
            if (!params.username) throw "Missing username";
            if (!params.password) throw "Missing password";

            let parser, target, source = file.dirname;

            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            if (params.hasOwnProperty('target')) {
                target = sprintf(params.target, file);
                if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            }

            if (params.publish && params.progress) parser = require('./stream_parsers')(params.progress, params.publish, params.parser_data);

            let parameters = {host: params.host, username: params.username, password: params.password, port: params.port};
            let id = JSON.stringify(parameters);
            if (!arbiter.hasOwnProperty(id)) {
                arbiter[id] = 0;
                pending[id] = 0;
                connections[id] = new Array(config.parallel_connections || 5).fill(1).map((_, idx) => idx);
                servers[id] = new Array(config.parallel_connections || 5).fill(null);
            }

            let cmd = params.cmd_ready && params.cmd || sprintf(params.cmd, {
                source: '"' + source.replace(/"/g, "\\\"") + '"',
                target: target ? '"' + target.replace(/"/g, "\\\"") + '"' : "",
                dirname: '"' + file.dirname.replace(/"/g, "\\\"") + '"',
                filename: '"' + file.filename.replace(/"/g, "\\\"") + '"',
                path: '"' + file.path.replace(/"/g, "\\\"") + '"'
            });

            pending[id]++;
            winston.debug("Executing on " + params.host + ":" + cmd);
            return new Promise((resolve, reject) => {
                arbiter[id] = Promise.resolve(arbiter[id])
                    .then(() => {
                        return new Promise(resolve_arbiter => {
                            return Promise.race(connections[id])
                                .then(queue => {
                                    connections[id][queue] = Promise.resolve(connections[id][queue])
                                        .then(() => {
                                            if (servers[id][queue]) return servers[id][queue];
                                            else {
                                                return new Promise((resolve2, reject2) => {
                                                    let client = new Client();
                                                    client
                                                        .on('ready', () => {
                                                            servers[id][queue] = client;
                                                            resolve2(client);
                                                        })
                                                        .on('error', err => {
                                                            servers[id][queue] = null;
                                                            winston.error("SSH connection to host " + params.host + " failed with error: ", err);
                                                            reject2("SSH connection error: " + err);
                                                        })
                                                        .on('end', () => {
                                                            servers[id][queue] = null;
                                                            reject2("SSH connection ended to host " + params.host);
                                                        })
                                                        .on('close', had_error => {
                                                            servers[id][queue] = null;
                                                            reject2("SSH connection lost to host " + params.host + ". Due to error: " + had_error);
                                                        })
                                                        .connect(parameters);
                                                });
                                            }
                                        })
                                        .then(con => {
                                            return new Promise((resolve2, reject2) => {
                                                con.exec(cmd, {pty: true}, (err, stream) => {
                                                    if (err) {
                                                        reject(err);
                                                        resolve2(err);
                                                    }
                                                    else {
                                                        stream.on('close', (code, signal) => {
                                                            if (code !== 0) {
                                                                reject(code, signal);
                                                                resolve2(code, signal);
                                                            }
                                                            else {
                                                                resolve();
                                                                resolve2();
                                                            }
                                                        }).on('data', data => {
                                                            if (data.indexOf('sudo') >= 0 && data.indexOf('password') >= 0) {
                                                                stream.write(params.password + '\n');
                                                            }
                                                            if (parser) parser.parse(data);
                                                        }).stderr.on('data', data => {
                                                            winston.debug("SSH module: Stderr output of '" + cmd + "' on " + params.host + ": " + data);
                                                            if (parser) parser.parse(data);
                                                        });
                                                    }
                                                })
                                            });
                                        })
                                        .catch(err => {
                                            winston.error("SSH module error: ", err);
                                            reject(err);
                                        })
                                        .then(() => {
                                            pending[id]--;
                                            return queue;
                                        });
                                    resolve_arbiter();
                                })
                        });
                    })
            });
        };
    }
    return actions;
};
