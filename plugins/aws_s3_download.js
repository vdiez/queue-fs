let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('aws_s3_download')) {
        actions.aws_s3_download = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";

            let aws = require('aws-sdk');
            if (params.credentials) aws.config.loadFromPath(params.credentials);
            else if (params.access_key && params.secret) aws.config.update({accessKeyId: params.access_key, secretAccessKey: params.secret});
            else if (config.default_aws_credentials) aws.config.loadFromPath(config.default_aws_credentials);
            else throw "Credentials path not specified";

            if (params.region) aws.config.update({region: params.region});

            let target = file.dirname;
            if (params.hasOwnProperty('target')) target = params.target;
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let S3 = new aws.S3();
            let src_stats;
            let source = params.source || './';
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            return new Promise((resolve, reject) => {
                    S3.headObject({Bucket: params.bucket, Key: source}, (err, data) => {
                        if (err) reject({not_found: true});
                        else {
                            src_stats = data;
                            resolve();
                        }
                    })
                })
                .then(() => new Promise((resolve, reject) => {
                    fs.stat(target, (err, stats) => {
                        if (err) resolve();
                        else {
                            if (src_stats.ContentLength == stats.size) reject({file_exists: true});
                            else resolve();
                        }
                    });
                }))
                .then(() => new Promise((resolve, reject) => {
                    let fileStream = fs.createWriteStream(target);
                    fileStream.on('error', err => reject(err));
                    let result = S3.getObject({Bucket: params.bucket, Key: source});
                    let percentage = 0;
                    if (params.publish) result.on('httpDownloadProgress', event => {
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
                    fileStream.on('close', () => resolve());
                    fileStream.on('error', err => reject(err));
                    result.createReadStream().pipe(fileStream);
                }))
                .catch(err => {
                    if (err && err.file_exists) return winston.info(target + " already exists");
                    throw err;
                });
        };
    }

    return actions;
};