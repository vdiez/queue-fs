let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let request = require('got');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('http_pull')) {
        actions.http_pull = (file, params) => {
            if (!params) throw "Missing parameters";
            let size, final;
            let target = file.dirname;
            if (params.hasOwnProperty('target')) target = params.target;
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            let source = params.source || './';
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);

            let resolve_pause, reject_pause, readStream, writeStream;
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect
            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    let state = config.controllers[params.job_id].value;
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (readStream) writeStream.destroy("Task has been cancelled");
                        if (reject_pause) {
                            reject_pause("CANCELLED");
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && readStream) passThrough.unpipe();
                    else if (state !== "resume" && action === "resume") {
                        if (readStream) passThrough.pipe(writeStream);
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            return request.head(source)
                .then(response => {
                    let headers = response.headers;
                    if (headers && headers['content-length']) size = parseInt(headers['content-length'], 10);
                })
                .then(() => fs.stat(target).catch(() => {}))
                .then(stats_target => {
                    if (stats_target) {
                        if (stats_target.isDirectory()) throw "Target exists and is a directory";
                        else if (size === stats_target.size) throw {file_exists: true};
                        else return fs.remove(target);
                    }
                })
                .then(() => {
                    if (params.direct) return fs.ensureDir(path.posix.dirname(target));
                    final = target;
                    target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                    return fs.stat(target).catch(() => {})
                        .then(stats_target => {
                            if (stats_target) {
                                if (stats_target.isDirectory()) throw "Temporary target exists and is a directory";
                                else if (file.size == stats_target.size) throw {tmp_exists: true};
                                else return fs.remove(target);
                            }
                        })
                        .then(() => fs.ensureDir(path.posix.dirname(target)));
                })
                .then(() => {
                    if (params.job_id && params.controllable && config.controllers) {
                        if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                        if (config.controllers[params.job_id].value === "pause") {
                            config.logger.info("Copy paused: ", source);
                            return new Promise((resolve, reject) => {
                                resolve_pause = resolve;
                                reject_pause = reject;
                            });
                        }
                    }
                })
                .then(() => new Promise((resolve, reject) => {
                    writeStream = fs.createWriteStream(target);
                    writeStream.on('close', () => {
                        if (params.direct) resolve();
                        else {
                            fs.rename(target, final, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        }
                    });
                    writeStream.on('error', err => reject(err));

                    readStream = request({url: source, retry: 0, method: "GET", stream: true});
                    readStream.on('response', response => {
                        if (response.statusCode !== 200) return reject('Response status was ' + response.statusCode);
                        if (!size && response.headers && response.headers['content-length']) size = parseInt(response.headers['content-length'], 10);
                    });
                    readStream.on('error', err => reject(err));
                    readStream.pipe(passThrough);
                    passThrough.pipe(writeStream);

                    if (params.publish) {
                        let transferred = 0;
                        let percentage = 0;
                        readStream.on('data', data => {
                            if (!size) return;
                            transferred += data.length;
                            let tmp = Math.round(transferred * 100 / size);
                            if (percentage != tmp) {
                                percentage = tmp;
                                params.publish({current: transferred, total: size, percentage: percentage});
                            }
                        });
                    }
                }))
                .catch(err => {
                    if (readStream) readStream.destroy();
                    if (writeStream) writeStream.destroy();
                    if (err && err.file_exists) config.logger.info(target + " already exists");
                    else if (err && err.tmp_exists && !params.direct) {
                        config.logger.info(target + " already exists. Moving to final destination");
                        return new Promise((resolve, reject) => {
                            fs.rename(target, final, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                    else throw err;
                });
        };
    }

    return actions;
};