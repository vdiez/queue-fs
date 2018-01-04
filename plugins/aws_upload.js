let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('aws_upload')) {
        actions.aws_upload = function(file, params) {
            if (!params) throw "Missing parameters";
            if (!params.bucket) throw "Bucket not specified";
            if (!params.credentials && !config.aws_credentials) throw "Credentials path not specified";

            let aws = require('aws-sdk');
            aws.config.loadFromPath(params.credentials || config.aws_credentials);
            let S3 = new aws.S3();;

            return new Promise(function (resolve, reject) {
                    S3.createBucket({Bucket: params.bucket}, function(err, data) {
                        if (err) reject(err);
                        else resolve();
                    });
                })
                .catch(err => winston.error("Error creating AWS S3 bucket: ", err))
                .then(function () {
                    return new Promise(function (resolve, reject) {
                        S3.headObject({Bucket: params.bucket, Key: file.filename}, function(err, data) {
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
                        if (!params.source_is_filename) source = path.join(source, file.filename);
                        let fileStream = fs.createReadStream(source);
                        fileStream.on('error', function(err) {reject(err);});
                        S3.upload({Bucket: params.bucket, Key: file.filename, Body: fileStream}, function(err,data) {
                            if (err) reject(err);
                            else {
                                resolve();/*
                                S3.putObjectAcl({Bucket: params.bucket, ACL: "public-read", Key: file.filename}, function(err, data) {
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