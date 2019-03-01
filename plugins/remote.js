let path = require('path');
let sprintf = require('sprintf-js').sprintf;
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

            if (params.publish && params.progress) parser = require('./stream_parsers')(config.logger, params.progress, params.publish, params.parser_data);

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
            config.logger.debug("Executing on " + params.host + ":" + cmd);
            return new Promise((resolve, reject) => {
                arbiter[id] = Promise.resolve(arbiter[id])
                    .then(() => {
                        return new Promise(resolve_arbiter => {
                            return Promise.race(connections[id])
                                .then(queue => {
                                    let reject_execution;
                                    connections[id][queue] = Promise.resolve(connections[id][queue])
                                        .then(() => new Promise((resolve_session, reject_session) => new Promise((resolve_connection, reject_connection) => {
                                            if (servers[id][queue]) resolve_connection(servers[id][queue]);
                                            else {
                                                let client = new Client();
                                                client
                                                    .on('ready', () => {
                                                        servers[id][queue] = client;
                                                        resolve_connection(client);
                                                    })
                                                    .on('error', err => {
                                                        servers[id][queue] = null;
                                                        config.logger.error("SSH connection to host " + params.host + " failed with error: ", err);
                                                        reject_connection("SSH connection error: " + err);
                                                        reject_session("SSH connection error: " + err);
                                                    })
                                                    .on('end', () => {
                                                        servers[id][queue] = null;
                                                        reject_connection("SSH connection ended to host " + params.host);
                                                        reject_session("SSH connection ended to host " + params.host);
                                                    })
                                                    .on('close', had_error => {
                                                        servers[id][queue] = null;
                                                        reject_connection("SSH connection lost to host " + params.host + ". Due to error: " + had_error);
                                                        reject_session("SSH connection lost to host " + params.host + ". Due to error: " + had_error);
                                                    })
                                                    .connect(parameters);
                                            }
                                        })
                                        .then(con => new Promise((resolve_execution, reject) => {
                                            reject_execution = reject;
                                            con.exec(cmd, {pty: true}, (err, stream) => {
                                                if (err) reject_execution(err);
                                                else {
                                                    stream.on('close', (code, signal) => {
                                                        if (code !== 0) reject_execution(code);
                                                        else resolve_execution();
                                                    }).on('data', data => {
                                                        if (data.indexOf('sudo') >= 0 && data.indexOf('password') >= 0) {
                                                            stream.write(params.password + '\n');
                                                        }
                                                        if (parser) parser.parse(data);
                                                    }).stderr.on('data', data => {
                                                        config.logger.debug("SSH module: Stderr output of '" + cmd + "' on " + params.host + ": " + data);
                                                        if (parser) parser.parse(data, 1);
                                                    });
                                                }
                                            })
                                        }))
                                        .then(() => resolve_session())
                                        .catch(err => {
                                            reject_session(err);
                                            if (typeof reject_execution === "function") reject_execution(err);
                                        })))
                                        .catch(err => {
                                            config.logger.error("SSH error: ", err);
                                            reject({error: err, data: parser && parser.data});
                                        })
                                        .then(() => {
                                            resolve(parser && parser.data);
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
