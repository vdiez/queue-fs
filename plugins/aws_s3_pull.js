let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('aws_s3_pull')) {
        actions.aws_s3_pull = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";

            let aws = require('aws-sdk');
            if (params.credentials) aws.config.loadFromPath(params.credentials);
            else if (params.access_key && params.secret) aws.config.update({accessKeyId: params.access_key, secretAccessKey: params.secret});
            else throw "Credentials path not specified";

            if (params.region) aws.config.update({region: params.region});

            let target = file.dirname;
            if (params.hasOwnProperty('target')) target = params.target;
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let S3 = new aws.S3();
            let size, final;
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

            return new Promise((resolve, reject) => {
                    S3.headObject({Bucket: params.bucket, Key: source}, (err, data) => {
                        if (err) reject({not_found: true});
                        else {
                            size = data.ContentLength;
                            resolve();
                        }
                    })
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

                    let result = S3.getObject({Bucket: params.bucket, Key: source});
                    readStream = result.createReadStream();
                    readStream.on('error', err => reject(err));
                    readStream.pipe(passThrough);
                    passThrough.pipe(writeStream);

                    if (params.publish) {
                        let percentage = 0;
                        result.on('httpDownloadProgress', event => {
                            let tmp = Math.round(event.loaded * 100 / event.total);
                            if (percentage != tmp) {
                                percentage = tmp;
                                params.publish({
                                    current: event.loaded,
                                    total: event.total,
                                    percentage: percentage
                                });
                            }
                        });
                    }
                }))
                .catch(err => {
                    if (readStream) readStream.destroy();
                    if (writeStream) writeStream.destroy();
                    if (err && err.file_exists) return config.logger.info(target + " already exists");
                    else if (err && err.tmp_exists && !params.direct) {
                        config.logger.info(target + " already exists. Moving to final destination");
                        return new Promise((resolve, reject) => {
                            fs.rename(target, final, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                    throw err;
                });
        };
    }

    return actions;
};