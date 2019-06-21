let path = require('path');
let Client = require('ftp');
let fs = require('fs-extra');
let sprintf = require('sprintf-js').sprintf;

let queues = {};
let servers = {};
let arbiter = {};
let pending = {};
let parallel_connections;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('ftp_push')) {
        actions.ftp_push = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.host) throw "Missing hostname";
            if (!params.username) throw "Missing username";
            if (!params.password) throw "Missing password";
            if (!parallel_connections && !params.parallel_connections) parallel_connections = 10;
            if (params.parallel_connections) {
                parallel_connections = parseInt(params.parallel_connections, 10);
                if (!parallel_connections && (isNaN(parallel_connections) || parallel_connections < 1)) parallel_connections = 10;
            }

            let resolve_pause, reject_pause, readStream, stopped, stats, final;
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect

            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let parameters = {host: params.host, user: params.username, password: params.password, port: params.port, secure: params.secure, secureOptions: {rejectUnauthorized: false}};
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
                        if (readStream) {
                            passThrough.end();
                            stopped = true;
                        }
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && readStream) readStream.unpipe();
                    else if (action === "resume") {
                        if (readStream) readStream.pipe(passThrough);
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            return new Promise((resolve, reject) => {
                arbiter[id] = Promise.resolve(arbiter[id])
                    .then(() => {
                        return new Promise(resolve_arbiter => {
                            return Promise.race(queues[id])
                                .then(queue => {
                                    let current_server = servers[id][queue];
                                    queues[id][queue] = Promise.resolve(queues[id][queue])
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
                                                                config.logger.error("FTP connection to host " + params.host + " failed with error: ", err);
                                                                reject_connection("FTP connection error: " + err);
                                                                reject_session("FTP connection error: " + err);
                                                            })
                                                            .on('end', () => {
                                                                current_server = null;
                                                                servers[id][queue] = null;
                                                                reject_connection("FTP connection ended to host " + params.host);
                                                                reject_session("FTP connection ended to host " + params.host);
                                                            })
                                                            .on('close', had_error => {
                                                                current_server = null;
                                                                servers[id][queue] = null;
                                                                reject_connection("FTP connection lost to host " + params.host + ". Due to error: " + had_error);
                                                                reject_session("FTP connection lost to host " + params.host + ". Due to error: " + had_error);
                                                            })
                                                            .connect(parameters);
                                                    }
                                                })
                                                    .then(() => {
                                                        if (params.job_id && params.controllable && config.controllers) {
                                                            if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                                                            if (config.controllers[params.job_id].value === "pause") {
                                                                config.logger.info("FTP put paused");
                                                                return new Promise((resolve, reject) => {
                                                                    resolve_pause = resolve;
                                                                    reject_pause = reject;
                                                                });
                                                            }
                                                        }
                                                    })
                                                    .then(() => fs.stat(source))
                                                    .then(result => {
                                                        stats = result;
                                                        if (stats.isDirectory()) throw "Cannot copy directory";
                                                        return new Promise((resolve_target, reject_target) => {
                                                            current_server.size(target, (err, size) => {
                                                                if (!err && (size === stats.size)) reject_target({file_exists: true}) ;
                                                                else resolve_target();
                                                            })
                                                        })
                                                    })
                                                    .then(() => {
                                                        if (params.direct) return new Promise((resolve_mkdir, reject_mkdir) => {
                                                            if (path.posix.dirname(target) === "." || path.posix.dirname(target) === "/") resolve_mkdir();
                                                            else current_server.mkdir(path.posix.dirname(target), true, err => {
                                                                if (err) reject_mkdir(err);
                                                                else resolve_mkdir();
                                                            });
                                                        });
                                                        final = target;
                                                        target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                                                        return new Promise((resolve_target, reject_target) => {
                                                                current_server.size(target, (err, size) => {
                                                                    if (!err && (size === stats.size)) reject_target({tmp_exists: true}) ;
                                                                    else resolve_target();
                                                                })
                                                            })
                                                            .then(() => {
                                                                return new Promise((resolve_mkdir, reject_mkdir) => {
                                                                    current_server.mkdir(path.posix.dirname(target), true, err => {
                                                                        if (err) reject_mkdir(err);
                                                                        else resolve_mkdir();
                                                                    });
                                                                })
                                                            });
                                                    })
                                                    .then(() => new Promise((resolve_transfer, reject_transfer) => {
                                                        readStream = fs.createReadStream(source);
                                                        readStream.pipe(passThrough);

                                                        current_server.put(passThrough, target, err => {
                                                            if (err) reject_transfer(err);
                                                            else if (stopped) reject_transfer("Task has been cancelled");
                                                            else {
                                                                if (params.direct) resolve_transfer();
                                                                else current_server.rename(target, final, err => {
                                                                    if (err) reject_transfer(err);
                                                                    else resolve_transfer();
                                                                });
                                                            }
                                                        });
                                                        readStream.on('error', err => reject_transfer(err));
                                                        passThrough.on('error', err => reject_transfer(err));

                                                        if (params.publish) {
                                                            let transferred = 0;
                                                            let percentage = 0;
                                                            readStream.on('data', data => {
                                                                transferred += data.length;

                                                                let tmp = Math.round(transferred * 100 / stats.size);
                                                                if (percentage != tmp) {
                                                                    percentage = tmp;
                                                                    params.publish({current: transferred, total: stats.size, percentage: percentage});
                                                                }
                                                            });
                                                        }
                                                    }))
                                                    .then(() => resolve_session())
                                                    .catch(err => {
                                                        if (readStream) readStream.destroy();
                                                        if (passThrough) passThrough.destroy();
                                                        if (err && err.file_exists) {
                                                            resolve_session();
                                                            config.logger.info(target + " already exists");
                                                        }
                                                        else if (err && err.tmp_exists && !params.direct) {
                                                            config.logger.info(target + " already exists. Moving to final destination");
                                                            return new Promise(resolve => {
                                                                current_server.rename(target, final, err => {
                                                                    if (err) reject_session(err);
                                                                    else resolve_session();
                                                                    resolve();
                                                                });
                                                            });
                                                        }
                                                        else {
                                                            if (reject_pause) reject_pause(err);
                                                            if (current_server) return new Promise(resolve => {
                                                                current_server.delete(target, error => {
                                                                    if (error) config.logger.error("Could not remove unfinished destination: ", error);
                                                                    reject_session(err);
                                                                    resolve();
                                                                });
                                                            });
                                                            else reject_session(err);
                                                        }
                                                    })
                                            })
                                        })
                                        .catch(err => {
                                            reject(err);
                                        })
                                        .then(() => {
                                            resolve();
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
