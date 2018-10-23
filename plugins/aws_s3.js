let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');
let mime = require('mime-types');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('aws_s3')) {
        actions.aws_s3 = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";

            let aws = require('aws-sdk');
            if (params.credentials) aws.config.loadFromPath(params.credentials);
            else if (params.access_key && params.secret) aws.config.update({accessKeyId: params.access_key, secretAccessKey: params.secret});
            else if (config.default_aws_credentials) aws.config.loadFromPath(config.default_aws_credentials);
            else throw "Credentials path not specified";

            if (params.region) aws.config.update({region: params.region});

            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);

            let S3 = new aws.S3();
            let src_stats;
            let target = params.target || './';
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            return new Promise((resolve, reject) => {
                    S3.createBucket({Bucket: params.bucket}, (err, data) => {
                        if (err) reject(err);
                        else resolve();
                    });
                })
                .catch(err => winston.error("Error creating AWS S3 bucket: ", err))
                .then(() => new Promise((resolve2, reject2) => {
                    fs.stat(source, (err, stats) => {
                        if (err) reject2({not_found: true});
                        else {
                            src_stats = stats;
                            resolve2();
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
                .then(() => new Promise((resolve, reject) => {
                    let fileStream = fs.createReadStream(source);
                    fileStream.on('error', err => reject(err));
                    let options = params.options || {partSize: 5 * 1024 * 1024, queueSize: 5};
                    let result = S3.upload({Bucket: params.bucket, Key: target, Body: fileStream, ContentType: mime.lookup(source)}, options, (err,data) => {
                        if (err) reject(err);
                        else resolve();
                    });
                    let percentage = 0;
                    if (params.publish) result.on('httpUploadProgress', event => {
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
                }))
                .catch(err => {
                    if (err && err.file_exists) return winston.info(source + " already exists on AWS bucket " + params.bucket);
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