let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('move_push')) {
        actions.move_push = (file, params) => {
            if (!params || !params.hasOwnProperty('target')) throw "Target path not specified";
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            let target = sprintf(params.target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            let stats, final;

            let resolve_pause, reject_pause, readStream, writeStream;
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect
            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    let state = config.controllers[params.job_id].value;
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (readStream) readStream.destroy("Task has been cancelled");
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

            return fs.stat(source)
                .then(result => {
                    stats = result;
                    if (stats.isDirectory()) throw "Cannot copy directory";
                    return fs.stat(target).catch(() => {});
                })
                .then(stats_target => {
                    if (stats_target) {
                        if (stats_target.isDirectory()) throw "Target exists and is a directory";
                        else if (file.size == stats_target.size) throw {file_exists: true};
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
                            config.logger.info("Move paused: ", source);
                            return new Promise((resolve, reject) => {
                                resolve_pause = resolve;
                                reject_pause = reject;
                            });
                        }
                    }
                })
                .then(() => {
                    return new Promise((resolve, reject) => {
                        fs.rename(source, target, err => {
                            if (err) reject(err);
                            else resolve();
                        });
                    })
                    .then(() => {
                        if (params.direct) return;
                        return new Promise((resolve, reject) => {
                            fs.rename(target, final, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        })
                    })
                })
                .catch(err => {
                    if (!err) return;
                    if (err.code !== 'EXDEV') throw err;
                    return new Promise((resolve, reject) => {
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

                        readStream = fs.createReadStream(source);
                        readStream.on('error', err => reject(err));
                        readStream.pipe(passThrough);
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
                    })
                    .then(() => fs.remove(source).catch(err => config.logger.error("Error moving file. Deleting source file failed:", err)));
                })
                .catch(err => {
                    if (readStream) readStream.destroy();
                    if (writeStream) writeStream.destroy();
                    if (err && err.file_exists) {
                        fs.remove(source).catch(err => config.logger.error("Error moving file. Deleting source file failed:", err));
                        config.logger.info(target + " already exists");
                    }
                    else if (err && err.tmp_exists && !params.direct) {
                        config.logger.info(target + " already exists. Moving to final destination");
                        return new Promise((resolve, reject) => {
                            fs.rename(target, final, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        })
                        .then(() => fs.remove(source).catch(err => config.logger.error("Error moving file. Deleting source file failed:", err)));
                    }
                    else throw err;
                });
        };
    }
    return actions;
};