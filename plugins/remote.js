let path = require('path');
let onExit = require('signal-exit');
let Client = require('ssh2').Client;
let fs = require('fs-extra');

let queues = {};
let servers = {};
let arbiter = {};
let pending = {};
let parallel_connections;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('remote')) {
        actions.remote = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.cmd) throw "Missing command line";
            if (!params.host) throw "Missing hostname";
            if (!params.username) throw "Missing username";
            if (!params.password) throw "Missing password";
            params.cmd = [].concat(params.cmd);
            if (!parallel_connections && !params.parallel_connections) parallel_connections = 10;
            if (params.parallel_connections) {
                parallel_connections = parseInt(params.parallel_connections, 10);
                if (!parallel_connections && (isNaN(parallel_connections) || parallel_connections < 1)) parallel_connections = 10;
            }

            let parser, logs = [], stderr_log, stdout_log, resolve_pause, reject_pause, process_pid;
            if (params.logs && params.logs.stdout) logs.push({filename: path.basename(params.logs.stdout), path: params.logs.stdout});
            if (params.logs && params.logs.stderr) logs.push({filename: path.basename(params.logs.stderr), path: params.logs.stderr});

            if (params.publish && params.progress) parser = require('./stream_parsers')(config.logger, params.progress, params.publish, params.parser_data);

            let parameters = {host: params.host, username: params.username, password: params.password, port: params.port, mgmt: params.mgmt};
            let id = JSON.stringify(parameters);
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

            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (process_pid) actions.remote({}, {
                            cmd: "kill -SIGKILL " + process_pid,
                            host: params.host,
                            username: params.username,
                            password: params.password,
                            port: params.port,
                            mgmt: true
                        }).catch(err => config.logger.error("Could not kill process:", err));
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && process_pid) {
                        actions.remote({}, {
                            cmd: "kill -SIGSTOP " + process_pid,
                            host: params.host,
                            username: params.username,
                            password: params.password,
                            port: params.port,
                            mgmt: true
                        }).catch(err => config.logger.error("Could not pause process:", err));
                    }
                    else if (action === "resume") {
                        if (process_pid) actions.remote({}, {
                            cmd: "kill -SIGCONT " + process_pid,
                            host: params.host,
                            username: params.username,
                            password: params.password,
                            port: params.port,
                            mgmt: true
                        }).catch(err => config.logger.error("Could not pause process:", err));
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            config.logger.debug("Executing on " + params.host + ":" + params.cmd);
            return new Promise((resolve, reject) => {
                arbiter[id] = Promise.resolve(arbiter[id])
                    .then(() => {
                        return new Promise(resolve_arbiter => {
                            return Promise.race(queues[id])
                                .then(queue => {
                                    let reject_execution;
                                    let current_server = servers[id][queue];
                                    queues[id][queue] = Promise.resolve(queues[id][queue])
                                        .then(() => logs.reduce((p, log) => p.then(() => log && log.path && fs.ensureDir(path.dirname(log.path))), Promise.resolve()))
                                        .then(() => {
                                            return new Promise((resolve_session, reject_session) => {
                                                return new Promise((resolve_connection, reject_connection) => {
                                                    if (current_server) resolve_connection();
                                                    else {
                                                        let client = new Client();
                                                        client
                                                            .on('ready', () => {
                                                                current_server = client;
                                                                resolve_connection();
                                                            })
                                                            .on('error', err => {
                                                                current_server = null;
                                                                servers[id][queue] = null;
                                                                config.logger.error("SSH connection to host " + params.host + " failed with error: ", err);
                                                                reject_connection("SSH connection error: " + err);
                                                                reject_session("SSH connection error: " + err);
                                                            })
                                                            .on('end', () => {
                                                                current_server = null;
                                                                servers[id][queue] = null;
                                                                reject_connection("SSH connection ended to host " + params.host);
                                                                reject_session("SSH connection ended to host " + params.host);
                                                            })
                                                            .on('close', had_error => {
                                                                current_server = null;
                                                                servers[id][queue] = null;
                                                                reject_connection("SSH connection lost to host " + params.host + ". Due to error: " + had_error);
                                                                reject_session("SSH connection lost to host " + params.host + ". Due to error: " + had_error);
                                                            })
                                                            .connect(parameters);
                                                    }
                                                })
                                                .then(() => {
                                                    if (params.logs && params.logs.stdout) stdout_log = fs.createWriteStream(params.logs.stdout);
                                                    if (params.logs && params.logs.stderr) stderr_log = fs.createWriteStream(params.logs.stderr);
                                                    return params.cmd.reduce((p, cmd) => {
                                                        return p
                                                            .then(() => {
                                                                if (params.job_id && params.controllable && config.controllers) {
                                                                    if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                                                                    if (config.controllers[params.job_id].value === "pause") {
                                                                        config.logger.info("Local action paused: ", cmd);
                                                                        return new Promise((resolve, reject) => {
                                                                            resolve_pause = resolve;
                                                                            reject_pause = reject;
                                                                        });
                                                                    }
                                                                }
                                                            })
                                                            .then(() => {
                                                                config.logger.debug("Executing on " + params.host + ":" + cmd);
                                                                return new Promise((resolve_execution, reject) => {
                                                                    reject_execution = reject;
                                                                    current_server.exec("echo 'PROCESS_PID='$$; exec " + cmd, {pty: true, ...(params.options || {})}, (err, stream) => {
                                                                        if (err) reject_execution(err);
                                                                        else {
                                                                            let removeExitHandler = onExit(() => {
                                                                                stream.close();
                                                                                current_server.end();
                                                                            });

                                                                            stream.on('close', (code, signal) => {
                                                                                removeExitHandler();
                                                                                if (code !== 0) reject_execution({code: code, signal: signal, data: parser && parser.data, logs: logs});
                                                                                else resolve_execution();
                                                                            }).on('data', data => {
                                                                                if (data.indexOf('sudo') >= 0 && data.indexOf('password') >= 0) {
                                                                                    stream.write(params.password + '\n');
                                                                                }
                                                                                let match_pid = data.toString('utf8').match(/PROCESS_PID=(\d+)/);
                                                                                if (match_pid) process_pid = match_pid[1];
                                                                                else if (parser) parser.parse(data);
                                                                                if (params.logs && params.logs.stdout) stdout_log.write(data);
                                                                            }).stderr.on('data', data => {
                                                                                config.logger.debug("SSH module: Stderr output of '" + params.cmd + "' on " + params.host + ": " + data);
                                                                                if (parser) parser.parse(data);
                                                                                if (params.logs && params.logs.stderr) stderr_log.write(data);
                                                                            });
                                                                        }
                                                                    })
                                                                })
                                                            })
                                                            .then(() => {
                                                                reject_execution = null;
                                                                process_pid = null;
                                                            })
                                                    }, Promise.resolve());
                                                })
                                                .then(() => resolve_session())
                                                .catch(err => {
                                                    reject_session(err);
                                                    if (typeof reject_execution === "function") reject_execution(err);//if triggered by lost connection (reject_session), clean up execution promise
                                                })
                                            })
                                        })
                                        .catch(err => {
                                            reject(err);
                                        })
                                        .then(() => params.logs && params.logs.stdout && new Promise(resolve => stdout_log.end(resolve)))
                                        .then(() => params.logs && params.logs.stderr && new Promise(resolve => stderr_log.end(resolve)))
                                        .then(() => {
                                            resolve(parser && parser.data);
                                            if (params.logs) setTimeout(() => logs.forEach(log => fs.remove(log.path).catch(err => config.logger.error("Could not remove stdout log file: " + err))), 30000);
                                            pending[id]--;
                                            if (queue >= parallel_connections && current_server) current_server.end();
                                            else servers[id][queue] = current_server;
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
