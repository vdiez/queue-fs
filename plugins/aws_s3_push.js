let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let mime = require('mime-types');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('aws_s3_push')) {
        actions.aws_s3_push = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";

            let aws = require('aws-sdk');
            if (params.credentials) aws.config.loadFromPath(params.credentials);
            else if (params.access_key && params.secret) aws.config.update({accessKeyId: params.access_key, secretAccessKey: params.secret});
            else throw "Credentials path not specified";

            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);

            let src_stats;
            let target = params.target || './';
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            let matches = target.match(/^https?:\/\/(.+).s3(-([^.]+))?\.amazonaws\.com\/(.+)|^https?:\/\/s3(-([^.]+))?\.amazonaws\.com\/([^/]+)\/(.+)/);
            if (matches) {
                let bucket = matches[1] || matches[7];
                if (params.bucket && params.bucket !== bucket) throw "Bucket on URL does not match parameters";
                target = matches[4] || matches[8];
                let region = matches[3] || matches[6];

                if (params.region || region) aws.config.update({region: params.region || region});
            }

            let resolve_pause, reject_pause, fileStream;
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect
            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    let state = config.controllers[params.job_id].value;
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (fileStream) fileStream.destroy("Task has been cancelled");
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && fileStream) fileStream.unpipe();
                    else if (state !== "resume" && action === "resume") {
                        if (fileStream) fileStream.pipe(passThrough);
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            let S3 = new aws.S3();
            return new Promise((resolve, reject) => {
                    S3.createBucket({Bucket: params.bucket}, (err, data) => {
                        if (err) reject(err);
                        else resolve();
                    });
                })
                .catch(err => config.logger.error("Error creating AWS S3 bucket: ", err))
                .then(() => new Promise((resolve, reject) => {
                    fs.stat(source, (err, stats) => {
                        if (err) reject({not_found: true});
                        else {
                            src_stats = stats;
                            resolve();
                        }
                    });
                }))
                .then(() => new Promise((resolve, reject) => {
                    S3.headObject({Bucket: params.bucket, Key: target}, (err, data) => {
                        if (err) resolve();
                        else {
                            if (data.ContentLength == src_stats.size) reject({file_exists: true});
                            else resolve();
                        }
                    })
                }))
                .then(() => {
                    if (params.job_id && params.controllable && config.controllers) {
                        if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                        if (config.controllers[params.job_id].value === "pause") {
                            config.logger.info("Transfer to AWS paused: ", source);
                            return new Promise((resolve, reject) => {
                                resolve_pause = resolve;
                                reject_pause = reject;
                            });
                        }
                    }
                })
                .then(() => new Promise((resolve, reject) => {
                    fileStream = fs.createReadStream(source);
                    fileStream.on('error', err => reject(err));
                    let options = params.options || {partSize: 5 * 1024 * 1024, queueSize: 5};
                    let result = S3.upload({Bucket: params.bucket, Key: target, Body: passThrough, ContentType: mime.lookup(source)}, options, (err,data) => {
                        if (err) reject(err);
                        else resolve();
                    });
                    fileStream.pipe(passThrough);
                    let percentage = 0;
                    if (params.publish) result.on('httpUploadProgress', event => {
                        let tmp = Math.round(event.loaded * 100 / (event.total || file.size));
                        if (percentage != tmp) {
                            percentage = tmp;
                            params.publish({
                                current: event.loaded,
                                total: event.total || file.size,
                                percentage: percentage
                            });
                        }
                    });
                }))
                .catch(err => {
                    if (err && err.file_exists) return config.logger.info(source + " already exists on AWS bucket " + params.bucket);
                    throw err;
                })
                .then(() => new Promise((resolve, reject) => {
                    if (params.make_public) {
                        S3.putObjectAcl({Bucket: params.bucket, ACL: "public-read", Key: target}, (err, data) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    }
                    else resolve();
                }));
        };
    }

    return actions;
};