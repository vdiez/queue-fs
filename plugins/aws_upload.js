let aws = require('aws-sdk');
let fs = require('fs');
let instances = {};

module.exports = function(actions, db, config) {
    if (!actions.hasOwnProperty('aws_upload')) {
        actions.aws_upload = function(params) {
            if (!params.bucket) throw "Bucket not specified";
            if (!params.credentials) throw "Credentials path not specified";

            aws.config.loadFromPath(params.credentials || config.aws_credentials);
            if (!instances.hasOwnProperty(params.credentials)) instances[params.credentials] = new aws.S3();
            let S3 = instances[params.credentials];

            return new Promise(function (resolve, reject) {
                    S3.createBucket({Bucket: params.bucket}, function(err, data) {
                        if (err && err.name !== "BucketAlreadyOwnedByYou") reject(err);
                        else resolve();
                    });
                })
                .then(function () {
                    return new Promise(function (resolve, reject) {
                        S3.headObject({Bucket: params.bucket, Key: params.filename}, function(err, data) {
                            if (err) resolve();
                            else {
                                if (data.ContentLength == params.stat.size) reject("File already exists");
                                else resolve();
                            }
                        })
                    });
                })
                .then(function () {
                    return new Promise(function (resolve, reject) {
                        let fileStream = fs.createReadStream(params.source);
                        fileStream.on('error', function(err) {reject(err);});
                        S3.upload({Bucket: params.bucket, Key: params.filename, Body: fileStream}, function(err,data) {
                            if (err) reject(err);
                            else {
                                resolve();/*
                                S3.putObjectAcl({Bucket: params.bucket, ACL: "public-read", Key: params.filename}, function(err, data) {
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