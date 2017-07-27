let aws = require('aws-sdk');
let fs = require('fs');
aws.config.loadFromPath('./aws.json');

let S3 = new aws.S3();

function create_bucket(name) {
    return new Promise(function (resolve, reject) {
        S3.createBucket({Bucket: name}, function(err, data) {
            if (err && err.name !== "BucketAlreadyOwnedByYou") reject(err);
            else resolve();
        });
    });
}

function file_exists(bucket, key, size) {
    return new Promise(function (resolve, reject) {
        S3.headObject({Bucket: bucket, Key: key}, function(err, data) {
            if (err) resolve();
            else {
                if (data.ContentLength == size) reject("File already exists");
                else resolve();
            }
        })
    });
}

module.exports = function(actions) {
    if (!actions.hasOwnProperty('aws_upload')) {
        actions.aws_upload = function(params) {
            if (!params.bucket) throw "Bucket not specified";
            return create_bucket(params.bucket)
                .then(function () {
                    return file_exists(params.bucket, params.filename, params.stat.size)
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