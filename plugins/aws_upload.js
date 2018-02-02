let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('aws_upload')) {
        actions.aws_upload = function(file, params) {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";
            if (!params.credentials && !config.default_aws_credentials) throw "Credentials path not specified";

            let aws = require('aws-sdk');
            aws.config.loadFromPath(params.credentials || config.default_aws_credentials);
            let S3 = new aws.S3();

            let target = params.target || './';
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            return new Promise(function (resolve, reject) {
                    S3.createBucket({Bucket: params.bucket}, function(err, data) {
                        if (err) reject(err);
                        else resolve();
                    });
                })
                .catch(err => winston.error("Error creating AWS S3 bucket: ", err))
                .then(function () {
                    return new Promise(function (resolve, reject) {
                        S3.headObject({Bucket: params.bucket, Key: target}, function(err, data) {
                            if (err) resolve();
                            else {
                                if (data.ContentLength == file.stat.size) reject("File already exists");
                                else resolve();
                            }
                        })
                    });
                })
                .then(function () {
                    return new Promise(function (resolve, reject) {
                        let source = file.dirname;
                        if (params.hasOwnProperty('source')) source = params.source;
                        source = sprintf(source, file);
                        if (!params.source_is_filename) source = path.posix.join(source, file.filename);
                        let fileStream = fs.createReadStream(source);
                        fileStream.on('error', function(err) {reject(err);});
                        let options = params.options || {partSize: 100 * 1024 * 1024, queueSize: 5};
                        S3.upload({Bucket: params.bucket, Key: target, Body: fileStream}, options, function(err,data) {
                            if (err) reject(err);
                            else {
                                resolve();/*
                                S3.putObjectAcl({Bucket: params.bucket, ACL: "public-read", Key: target}, function(err, data) {
                                    if (err) reject(err);
                                    else resolve();
                                });*/
                            }
                        });
                    });
                });
        }
    }

    return actions;
};