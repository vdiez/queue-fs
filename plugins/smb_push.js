let path = require('path');
let Client = require('@marsaud/smb2');
let fs = require('fs-extra');
let sprintf = require('sprintf-js').sprintf;

let queues = {};
let servers = {};
let arbiter = {};
let pending = {};
let parallel_connections;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('smb_push')) {
        actions.smb_push = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.host) throw "Missing hostname";
            if (!params.share) throw "Missing share";
            if (!params.domain) throw "Missing domain";
            if (!params.username) throw "Missing username";
            if (!params.password) throw "Missing password";
            if (!parallel_connections && !params.parallel_connections) parallel_connections = 10;
            if (params.parallel_connections) {
                parallel_connections = parseInt(params.parallel_connections, 10);
                if (!parallel_connections && (isNaN(parallel_connections) || parallel_connections < 1)) parallel_connections = 10;
            }

            let resolve_pause, reject_pause, readStream, writeStream, stopped, stats, final;
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect

            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let share = "\\\\" + params.host + "\\" + params.share;
            let parameters = {share: share, username: params.username, password: params.password, port: params.port, domain: params.domain, autoCloseTimeout: 0};
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
                            readStream.destroy("Task has been cancelled");
                            stopped = true;
                        }
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && readStream) passThrough.unpipe();
                    else if (action === "resume") {
                        if (readStream) passThrough.pipe(writeStream);
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
                                    if (!servers[id][queue]) servers[id][queue] = new Client(parameters);
                                    queues[id][queue] = Promise.resolve(queues[id][queue])
                                        .then(() => {
                                            if (params.job_id && params.controllable && config.controllers) {
                                                if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                                                if (config.controllers[params.job_id].value === "pause") {
                                                    config.logger.info("SMB put paused");
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
                                                servers[id][queue].getSize(target.replace(/\//g, "\\"), (err, size) => {
                                                    if (err) resolve_target();
                                                    else {
                                                        if (size === stats.size) reject_target({file_exists: true}) ;
                                                        else resolve_target(servers[id][queue].unlink(target.replace(/\//g, "\\")))
                                                    }
                                                })
                                            })
                                        })
                                        .then(() => {
                                            if (params.direct) {
                                                if (path.posix.dirname(target) === "." || path.posix.dirname(target) === "/") return;
                                                return servers[id][queue].mkdir(path.posix.dirname(target).replace(/\//g, "\\"))
                                                    .catch(err => {
                                                        if (err && err.code === 'STATUS_OBJECT_NAME_COLLISION') return;
                                                        throw err;
                                                    });
                                            }
                                            final = target;
                                            target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                                            return new Promise((resolve_target, reject_target) => {
                                                servers[id][queue].getSize(target.replace(/\//g, "\\"), (err, size) => {
                                                    if (err) resolve_target();
                                                    else {
                                                        if (size === stats.size) reject_target({tmp_exists: true}) ;
                                                        else resolve_target(servers[id][queue].unlink(target.replace(/\//g, "\\")));
                                                    }
                                                })
                                            })
                                            .then(() => servers[id][queue].mkdir(path.posix.dirname(target).replace(/\//g, "\\")).catch(err => {
                                                if (err && err.code === 'STATUS_OBJECT_NAME_COLLISION') return;
                                                throw err;
                                            }))

                                        })
                                        .then(() => servers[id][queue].createWriteStream(target.replace(/\//g, "\\")))
                                        .then(stream => new Promise((resolve_transfer, reject_transfer) => {
                                            writeStream = stream;
                                            readStream = fs.createReadStream(source);
                                            readStream.pipe(passThrough);
                                            writeStream.on('finish', () => {
                                                if (stopped) reject_transfer("Task has been cancelled");
                                                else {
                                                    if (params.direct) resolve_transfer();
                                                    else resolve_transfer(servers[id][queue].rename(target.replace(/\//g, "\\"), final.replace(/\//g, "\\")));
                                                }
                                            });
                                            writeStream.on('error', err => reject_transfer(err));
                                            readStream.on('error', err => reject_transfer(err));
                                            passThrough.on('error', err => reject_transfer(err));

                                            passThrough.pipe(writeStream);

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
                                        .catch(err => {
                                            if (readStream) readStream.destroy();
                                            if (err && err.file_exists) config.logger.info(target + " already exists");
                                            else if (err && err.tmp_exists && !params.direct) {
                                                config.logger.info(target + " already exists. Moving to final destination");
                                                return servers[id][queue].rename(target.replace(/\//g, "\\"), final.replace(/\//g, "\\"));
                                            }
                                            else {
                                                if (reject_pause) reject_pause(err);
                                                reject(err);
                                                return servers[id][queue].unlink(target.replace(/\//g, "\\")).catch(error => error && config.logger.error("Could not remove unfinished destination: ", error));
                                            }
                                        })
                                        .then(() => {
                                            resolve();
                                            pending[id]--;
                                            if (queue >= parallel_connections && servers[id][queue]) servers[id][queue].disconnect();
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
